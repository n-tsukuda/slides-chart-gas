/**
 * Googleスライド用：設定パネル付き「図形で描くグラフ」
 * 縦棒・横棒・折れ線に対応
 *
 * メニュー「グラフ → グラフを編集」でサイドバーを開き、
 * 種類・数値・色などを画面上で変えて「スライドに反映」を押すだけで描き直せます。
 * グラフを手で拡大・縮小したあとに反映すると、その大きさに合わせて
 * 文字サイズ・余白・線の太さも自動で調整して描き直します。
 */

const PROP_KEY = 'barChartSettings';
const GEOM_KEY = 'barChartGeom_';                 // スライドごとの位置情報
const GROUP_TITLE = 'gas-bar-chart';              // 描き直し用の目印
const AREA = { left: 40, top: 30, width: 640, height: 345 }; // 基準の大きさ（pt）。文字サイズはこの大きさのときの値
const INSET = 7.2;                                // テキストボックスの左右の内側余白（Googleスライドの標準）

const DEFAULTS = {
  type: 'column',          // column＝縦棒 / bar＝横棒 / line＝折れ線
  data: [
    { label: '2017', value: 80, highlight: false },
    { label: '2018', value: 92, highlight: false },
    { label: '2019', value: 88, highlight: false },
    { label: '2020', value: 105, highlight: false },
    { label: '2021', value: 118, highlight: false },
    { label: '2022', value: 110, highlight: false },
    { label: '2023', value: 134, highlight: false },
    { label: '2024', value: 152, highlight: false },
    { label: '2025', value: 176, highlight: false },
    { label: '2026', value: 210, highlight: true },
  ],
  colors: {
    bar: '#42AED0',        // 通常の棒・線
    highlight: '#FF8048',  // 強調する棒・点
    value: '#222222',      // 数値
    text: '#555555',       // 軸の文字
    grid: '#E9E9E9',       // 補助線
  },
  font: 'Noto Sans JP',
  fontSize: 11,            // 基準の大きさのときの文字サイズ
  barRatio: 0.6,
  legend: '売上高',
  yTitle: '',             // 数値の軸の名称（空欄で非表示）例：（百万円）
  xTitle: '',             // 項目の軸の名称（空欄で非表示）例：年度
  // ※縦棒・折れ線では 数値＝縦軸／項目＝横軸、横棒では 項目＝縦軸／数値＝横軸 に表示
  yMax: 250,
  yStep: 50,
};

/* ── メニューとサイドバー ─────────────────────── */

function onOpen() {
  SlidesApp.getUi()
    .createMenu('グラフ')
    .addItem('グラフを編集', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('グラフ');
  SlidesApp.getUi().showSidebar(html);
}

/* ── サイドバーから呼ばれる関数 ───────────────── */

function getSettings() {
  const raw = PropertiesService.getDocumentProperties().getProperty(PROP_KEY);
  if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
  const s = JSON.parse(raw);
  return Object.assign({}, DEFAULTS, s, {
    colors: Object.assign({}, DEFAULTS.colors, s.colors),
  });
}

function resetSettings() {
  PropertiesService.getDocumentProperties().deleteProperty(PROP_KEY);
  return getSettings();
}

function saveAndDraw(input) {
  const s = normalize_(input);
  PropertiesService.getDocumentProperties().setProperty(PROP_KEY, JSON.stringify(s));
  return drawChart_(s);
}

/* ── 描画（共通部分） ─────────────────────────── */

function drawChart_(s) {
  const pres = SlidesApp.getActivePresentation();
  const slide = getTargetSlide_(pres);
  const props = PropertiesService.getDocumentProperties();
  const geomKey = GEOM_KEY + slide.getObjectId();

  // 既存のグラフがあれば、いまの位置・大きさから描く範囲を割り出す
  const cur = removeOldChart_(slide);
  const area = resolveArea_(cur, JSON.parse(props.getProperty(geomKey) || 'null'));

  // 基準の大きさに対する倍率。文字・余白・線の太さをすべてこれで調整する
  const k = Math.min(area.width / AREA.width, area.height / AREA.height);

  const maxVal = Math.max(...s.data.map(d => d.value));
  const autoMax = Math.ceil(maxVal / s.yStep) * s.yStep || s.yStep;
  const max = s.yMax && s.yMax >= maxVal ? s.yMax : autoMax;
  if (max / s.yStep > 20) throw new Error('目盛りの間隔が小さすぎます。もう少し大きい数にしてください。');

  // 左上に置く名称と、下に置く名称（横棒は数値と項目の軸が入れ替わる）
  const topTitle = s.type === 'bar' ? s.xTitle : s.yTitle;
  const bottomTitle = s.type === 'bar' ? s.yTitle : s.xTitle;

  const ctx = {
    slide: slide, s: s, els: [], max: max, area: area, k: k,
    fs: Math.max(5, Math.round(s.fontSize * k * 10) / 10),
    topTitle: topTitle, bottomTitle: bottomTitle,
    headH: s.legend || topTitle ? 28 * k : 0,   // 上に凡例・縦軸の名称を置く分
    footH: bottomTitle ? 18 * k : 0,            // 下に横軸の名称を置く分
  };

  const plot = s.type === 'bar' ? drawHorizontalBars_(ctx) : drawVertical_(ctx, s.type === 'line');
  if (s.legend) drawLegend_(ctx);
  drawAxisTitles_(ctx, plot);

  // 目印は部品1つ1つに付ける（グループには付けられないため）
  ctx.els.forEach(el => { try { el.setTitle(GROUP_TITLE); } catch (e) {} });
  const group = slide.group(ctx.els);

  // 次に描き直すとき用に「描いた範囲」と「できあがったグループの枠」を保存
  props.setProperty(geomKey, JSON.stringify({
    area: area,
    box: { left: group.getLeft(), top: group.getTop(), width: group.getWidth(), height: group.getHeight() },
  }));

  const no = pres.getSlides().findIndex(sl => sl.getObjectId() === slide.getObjectId()) + 1;
  let msg = `${no}枚目のスライドに反映しました。`;
  if (s.yMax && s.yMax < maxVal) msg += `（目盛りの最大が値より小さかったので ${autoMax} にしました）`;
  return msg;
}

// 手で動かしたり拡大縮小したりした分を、描く範囲に反映する
function resolveArea_(cur, geom) {
  if (!cur) return Object.assign({}, AREA);
  if (!geom) return cur; // 以前のバージョンで描いたグラフ
  const sx = cur.width / geom.box.width;
  const sy = cur.height / geom.box.height;
  return {
    left: cur.left + (geom.area.left - geom.box.left) * sx,
    top: cur.top + (geom.area.top - geom.box.top) * sy,
    width: geom.area.width * sx,
    height: geom.area.height * sy,
  };
}

/* ── 縦棒・折れ線 ─────────────────────────────── */

function drawVertical_(ctx, isLine) {
  const { slide, s, max, area: a, k } = ctx;
  const C = s.colors;
  const plot = {
    left: a.left + 40 * k,
    right: a.left + a.width,
    top: a.top + ctx.headH + (isLine ? 22 : 8) * k, // 折れ線は点の上に数値を出すので余白を多めに
    bottom: a.top + a.height - 24 * k - ctx.footH,
  };
  const yPos = v => plot.bottom - ((plot.bottom - plot.top) * v) / max;

  // 補助線と目盛り
  for (let v = 0; v <= max; v += s.yStep) {
    const y = yPos(v);
    ctx.els.push(line_(slide, plot.left, y, plot.right, y, C.grid, Math.max(0.5, 0.75 * k)));
    label_(ctx, formatNum_(v), plot.left - 6 * k, y, 'end', C.text);
  }

  const slot = (plot.right - plot.left) / s.data.length;

  // 横軸のラベル
  s.data.forEach((d, i) => {
    label_(ctx, d.label, plot.left + (i + 0.5) * slot, plot.bottom + 13 * k, 'center', C.text);
  });

  if (!isLine) {
    // 縦棒
    const bw = slot * s.barRatio;
    s.data.forEach((d, i) => {
      const x = plot.left + i * slot + (slot - bw) / 2;
      const top = yPos(d.value);
      const h = plot.bottom - top;
      if (h > 0.5) {
        const bar = slide.insertShape(SlidesApp.ShapeType.ROUND_2_SAME_RECTANGLE, x, top, bw, h);
        fill_(bar, d.highlight ? C.highlight : C.bar);
        ctx.els.push(bar);
      }
      const inside = h >= ctx.fs * 2.4; // 棒が低いときは数値を棒の上に出す
      label_(ctx, formatNum_(d.value), x + bw / 2, inside ? top + ctx.fs * 1.1 : top - ctx.fs * 0.9, 'center', C.value);
    });
    return plot;
  }

  // 折れ線
  const pts = s.data.map((d, i) => ({ x: plot.left + (i + 0.5) * slot, y: yPos(d.value), d: d }));

  // 線（強調する点へ向かう区間は強調色の点線）
  for (let i = 0; i < pts.length - 1; i++) {
    const to = pts[i + 1];
    const ln = line_(slide, pts[i].x, pts[i].y, to.x, to.y, to.d.highlight ? C.highlight : C.bar, Math.max(1, 2.5 * k));
    if (to.d.highlight) ln.setDashStyle(SlidesApp.DashStyle.DASH);
    ctx.els.push(ln);
  }

  // 点と数値
  pts.forEach((p, i) => {
    const r = (p.d.highlight ? 6 : 4.5) * k;
    const color = p.d.highlight ? C.highlight : C.bar;
    const dot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, p.x - r, p.y - r, r * 2, r * 2);
    dot.getFill().setSolidFill(p.d.highlight ? color : '#FFFFFF');
    dot.getBorder().getLineFill().setSolidFill(color);
    dot.getBorder().setWeight(Math.max(0.75, 2 * k));
    ctx.els.push(dot);
    const below = isValley_(pts, i); // 谷になっている点は、線と重ならないよう数値を下に出す
    const off = r + ctx.fs * 0.9;
    label_(ctx, formatNum_(p.d.value), p.x, below ? p.y + off : p.y - off, 'center', C.value);
  });
  return plot;
}

function isValley_(pts, i) {
  const nb = [pts[i - 1], pts[i + 1]].filter(Boolean);
  return nb.length > 0 && nb.every(q => q.y < pts[i].y); // yは下ほど大きい
}

/* ── 横棒 ──────────────────────────────────── */

function drawHorizontalBars_(ctx) {
  const { slide, s, max, area: a, k } = ctx;
  const C = s.colors;
  const plot = {
    left: a.left + 56 * k,
    right: a.left + a.width - 16 * k,
    top: a.top + ctx.headH + 8 * k,
    bottom: a.top + a.height - 22 * k - ctx.footH,
  };
  const xPos = v => plot.left + ((plot.right - plot.left) * v) / max;

  // 補助線と目盛り（縦線・下に数値）
  for (let v = 0; v <= max; v += s.yStep) {
    const x = xPos(v);
    ctx.els.push(line_(slide, x, plot.top, x, plot.bottom, C.grid, Math.max(0.5, 0.75 * k)));
    label_(ctx, formatNum_(v), x, plot.bottom + 13 * k, 'center', C.text);
  }

  const slot = (plot.bottom - plot.top) / s.data.length;
  const bh = slot * s.barRatio;

  s.data.forEach((d, i) => {
    const cy = plot.top + (i + 0.5) * slot;
    const len = xPos(d.value) - plot.left;

    if (len > 0.5) {
      // 「上の角だけ丸い長方形」を90度回して、右端だけ丸い横棒にする
      const bar = slide.insertShape(SlidesApp.ShapeType.ROUND_2_SAME_RECTANGLE,
        plot.left + len / 2 - bh / 2, cy - len / 2, bh, len);
      bar.setRotation(90);
      fill_(bar, d.highlight ? C.highlight : C.bar);
      ctx.els.push(bar);
    }

    // 棒が十分に長ければ内側の右端、短ければ棒の右に数値を置く
    const v = formatNum_(d.value);
    const inside = len >= textWidth_(v, ctx.fs) + 14 * k;
    if (inside) label_(ctx, v, plot.left + len - 6 * k, cy, 'end', C.value);
    else label_(ctx, v, plot.left + len + 6 * k, cy, 'start', C.value);

    label_(ctx, d.label, plot.left - 6 * k, cy, 'end', C.text);
  });
  return plot;
}

/* ── 軸の名称 ──────────────────────────────── */

// 縦軸の名称は左上に横書き、横軸の名称は目盛りの下の中央に置く（空欄なら何も描かない）
function drawAxisTitles_(ctx, plot) {
  const { s, area: a, k } = ctx;
  if (ctx.topTitle) label_(ctx, ctx.topTitle, a.left, a.top + 13 * k, 'start', s.colors.text);
  if (ctx.bottomTitle) label_(ctx, ctx.bottomTitle, (plot.left + plot.right) / 2, plot.bottom + 33 * k, 'center', s.colors.text);
}

/* ── 凡例 ──────────────────────────────────── */

function drawLegend_(ctx) {
  const { slide, s, area: a, k } = ctx;
  const cx = a.left + a.width / 2;
  const cy = a.top + 13 * k;
  const r = 5.5 * k;
  const dot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, cx - 30 * k - r, cy - r, r * 2, r * 2);
  fill_(dot, s.colors.bar);
  ctx.els.push(dot);
  label_(ctx, s.legend, cx - 20 * k, cy, 'start', s.colors.text);
}

/* ── 補助関数 ─────────────────────────────── */

/**
 * 文字を置く。x は揃える位置（center＝中央、start＝左端、end＝右端）、cy は文字の縦の中心。
 * 枠は文字の長さから計算するので、文字サイズを変えても折り返さない。
 */
function label_(ctx, str, x, cy, align, color) {
  str = String(str);
  const fs = ctx.fs;
  const w = textWidth_(str, fs) + INSET * 2 + fs;
  const h = fs * 1.6 + 8;
  const left = align === 'center' ? x - w / 2 : align === 'end' ? x - w + INSET : x - INSET;
  const A = SlidesApp.ParagraphAlignment;

  const tb = ctx.slide.insertTextBox(str, left, cy - h / 2, w, h);
  tb.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  const t = tb.getText();
  t.getTextStyle().setFontFamily(ctx.s.font).setFontSize(fs).setForegroundColor(color);
  t.getParagraphStyle().setParagraphAlignment(align === 'center' ? A.CENTER : align === 'end' ? A.END : A.START);
  ctx.els.push(tb);
  return tb;
}

// 文字の幅のおおよその見積もり（半角0.62文字分、全角1文字分）
function textWidth_(str, fs) {
  let w = 0;
  for (const ch of String(str)) w += /[\x20-\x7E]/.test(ch) ? 0.62 : 1.0;
  return w * fs;
}

function removeOldChart_(slide) {
  // 既にグラフがあれば、その位置と大きさを返してから削除
  let cur = null;
  slide.getPageElements().forEach(el => {
    if (el.getPageElementType() === SlidesApp.PageElementType.GROUP) {
      const isChart = el.asGroup().getChildren().some(c => titleOf_(c) === GROUP_TITLE);
      if (isChart) {
        if (!cur) cur = { left: el.getLeft(), top: el.getTop(), width: el.getWidth(), height: el.getHeight() };
        el.remove();
      }
    } else if (titleOf_(el) === GROUP_TITLE) {
      el.remove(); // グループ解除された部品も消す
    }
  });
  return cur;
}

function normalize_(input) {
  const d = DEFAULTS;
  const num = (v, def) => (v === '' || v === null || isNaN(Number(v)) ? def : Number(v));

  const data = (input.data || [])
    .filter(r => String(r.label).trim() !== '' && r.value !== '' && r.value !== null && !isNaN(Number(r.value)))
    .map(r => ({ label: String(r.label).trim(), value: Number(r.value), highlight: !!r.highlight }));

  if (!data.length) throw new Error('データが1件もありません。ラベルと値を入れてください。');
  if (data.some(r => r.value < 0)) throw new Error('マイナスの値には対応していません。');

  const step = num(input.yStep, d.yStep);
  return {
    type: ['column', 'bar', 'line'].includes(input.type) ? input.type : d.type,
    data: data,
    colors: Object.assign({}, d.colors, input.colors),
    font: input.font || d.font,
    fontSize: Math.min(36, Math.max(6, num(input.fontSize, d.fontSize))),
    barRatio: Math.min(0.95, Math.max(0.2, num(input.barRatio, d.barRatio))),
    legend: String(input.legend || '').trim(),
    yTitle: String(input.yTitle || '').trim(),
    xTitle: String(input.xTitle || '').trim(),
    yMax: num(input.yMax, 0),
    yStep: step > 0 ? step : d.yStep,
  };
}

function getTargetSlide_(pres) {
  const sel = pres.getSelection();
  const page = sel ? sel.getCurrentPage() : null;
  return page ? page.asSlide() : pres.getSlides()[0];
}

function titleOf_(el) {
  try { return el.getTitle(); } catch (e) { return ''; }
}

function fill_(shape, color) {
  shape.getFill().setSolidFill(color);
  shape.getBorder().setTransparent();
}

function line_(slide, x1, y1, x2, y2, color, weight) {
  const ln = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, x1, y1, x2, y2);
  ln.setWeight(weight);
  ln.getLineFill().setSolidFill(color);
  return ln;
}

function formatNum_(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
