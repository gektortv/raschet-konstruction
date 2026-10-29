'use strict';

/* =====================================================================
   Справочные данные, СП 63.13330.2018
   ===================================================================== */
// Бетон тяжёлый: класс, Rb, Rbt (табл. 6.8), Eb·10⁻³ (табл. 6.11), Rb,ser, Rbt,ser (табл. 6.7),
// φb,cr при влажности >75 %, 40–75 %, <40 % (табл. 6.12)
var CONC = [
  ['B15', 8.5, 0.75, 24.0, 11.0, 1.10, 2.4, 3.4, 4.8],
  ['B20', 11.5, 0.90, 27.5, 15.0, 1.35, 2.0, 2.8, 4.0],
  ['B25', 14.5, 1.05, 30.0, 18.5, 1.55, 1.8, 2.5, 3.6],
  ['B30', 17.0, 1.15, 32.5, 22.0, 1.75, 1.6, 2.3, 3.2],
  ['B35', 19.5, 1.30, 34.5, 25.5, 1.95, 1.5, 2.1, 3.0],
  ['B40', 22.0, 1.40, 36.0, 29.0, 2.10, 1.4, 1.9, 2.8],
  ['B45', 25.0, 1.50, 37.0, 32.0, 2.25, 1.3, 1.8, 2.6],
  ['B50', 27.5, 1.60, 38.0, 36.0, 2.45, 1.2, 1.6, 2.4],
  ['B55', 30.0, 1.70, 39.0, 39.5, 2.60, 1.1, 1.5, 2.2],
  ['B60', 33.0, 1.80, 39.5, 43.0, 2.75, 1.0, 1.4, 2.0]
];
// Арматура: класс, Rs, Rsc (табл. 6.14)
var STEEL = [
  ['A240', 210, '210'], ['A400', 350, '350'], ['A500', 435, '435 (400)'], ['A600', 520, '470 (400)']
];
var ES = 200000;                          // модуль упругости арматуры, МПа
var EB1_RED = [0.0024, 0.0028, 0.0034];   // εb1,red при продолжительном действии нагрузки (табл. 6.10)
var DIAMETERS = [10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40];

// СП 20.13330.2016, табл. Д.1, поз. 2: пролёт, м → знаменатель предельного прогиба.
// Первый набор — при высоте помещений до 6 м включительно (цифры в скобках), второй — выше 6 м.
var LIMIT_LOW = [[1, 120], [3, 150], [6, 200], [12, 250], [24, 300]];
var LIMIT_HIGH = [[1, 120], [3, 150], [6, 200], [24, 250], [36, 300]];
// Понижающие коэффициенты к нагрузкам при определении прогиба (табл. Д.1, поз. 2)
var K_LIVE = 0.35, K_SNOW = 0.5;

/* =====================================================================
   Общие функции
   ===================================================================== */
function num(v) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : NaN; }
function num0(v) { return String(v).trim() === '' ? 0 : num(v); }     // пустое поле нагрузки = 0
function fmt(x, n) { return isFinite(x) ? x.toFixed(n).replace('.', ',') : '—'; }
function r1(x) { return Math.round(x * 10) / 10; }
function $(id) { return document.getElementById(id); }
function findConc(name) { return CONC.filter(function (c) { return c[0] === name; })[0] || CONC[2]; }
function findSteel(name) { return STEEL.filter(function (c) { return c[0] === name; })[0] || STEEL[2]; }

/* =====================================================================
   Расчёт. Внутренние величины — в Н и мм, если не указано иное.
   ===================================================================== */

// Геометрия сечения и проверка размеров; bad — поля с ошибкой.
// needA — нужно ли расстояние a₁ до центра нижнего ряда арматуры.
function geometry(s, needA) {
  var g = {};
  g.hasTop = s.shape === 'tee' || s.shape === 'ibeam';
  g.hasBot = s.shape === 'ibeam';
  g.b = num(s.b); g.h = num(s.h); g.a1 = needA ? num(s.a) : NaN;
  g.bfc = num(s.bfc); g.hfc = num(s.hfc); g.bft = num(s.bft); g.hft = num(s.hft);
  g.wPlace = g.hasBot ? g.bft : g.b;      // ширина, по которой размещаются стержни
  var bad = {};
  if (!(g.b > 0)) bad.b = 1;
  if (!(g.h > 0)) bad.h = 1;
  if (needA && (!(g.a1 > 0) || !(g.a1 < g.h / 2) || !(g.a1 < g.wPlace / 2))) bad.a = 1;
  if (g.hasTop) { if (!(g.bfc > g.b)) bad.bfc = 1; if (!(g.hfc > 0) || !(g.hfc < g.h)) bad.hfc = 1; }
  if (g.hasBot) { if (!(g.bft > g.b)) bad.bft = 1; if (!(g.hft > 0) || !(g.hfc + g.hft < g.h)) bad.hft = 1; }
  g.bad = bad;
  g.dimsOk = !Object.keys(bad).length;
  return g;
}

// Момент инерции сечения относительно центра тяжести; y — от растянутой грани.
// al·As — приведённая площадь арматуры на расстоянии a от растянутой грани (al = 0 — только бетон).
function sectionProps(g, al, As, a) {
  var b = g.b, h = g.h;
  var hT = g.hasTop ? g.hfc : 0, hB = g.hasBot ? g.hft : 0;
  var ovT = g.hasTop ? (g.bfc - b) * hT : 0, ovB = g.hasBot ? (g.bft - b) * hB : 0;
  var st = al > 0 ? al * As : 0, sa = al > 0 ? a : 0;
  var A = b * h + ovT + ovB + st;
  var S = b * h * h / 2 + ovT * (h - hT / 2) + ovB * hB / 2 + st * sa;
  var y = S / A;
  var I = b * h * h * h / 12 + b * h * Math.pow(h / 2 - y, 2)
    + (g.hasTop ? (g.bfc - b) * Math.pow(hT, 3) / 12 : 0) + ovT * Math.pow(h - hT / 2 - y, 2)
    + (g.hasBot ? (g.bft - b) * Math.pow(hB, 3) / 12 : 0) + ovB * Math.pow(hB / 2 - y, 2)
    + st * Math.pow(y - sa, 2);
  return { y: y, I: I };
}

// Схема: однопролётная шарнирно опёртая балка
function scheme(s) {
  var L = num(s.L), isQ = s.loadType !== 'p';
  return {
    L: L, Lmm: L * 1000, isQ: isQ,
    mom: function (v) { return isQ ? v * L * L / 8 : v * L / 4; },   // кН·м
    shear: function (v) { return isQ ? v * L / 2 : v / 2; },         // кН
    sK: isQ ? 5 / 48 : 1 / 12                                        // коэффициент для прогиба
  };
}

/* ---------- Раскладка стержней по рядам (п. 10.3.5) ---------- */
// Наименьшее расстояние в свету для стержней ряда: два нижних ряда — 25 мм, выше — 50 мм, и не менее диаметра
function minClear(d, row) { return Math.max(d, row >= 2 ? 50 : 25); }

// Положение стержней ряда из m штук на сетке нижнего ряда из n1 стержней: сначала крайние пары, затем средний
function rowXs(n1, m, w, a1) {
  var base = [];
  for (var i = 0; i < n1; i++) base.push(n1 === 1 ? 0 : -w / 2 + a1 + i * (w - 2 * a1) / (n1 - 1));
  if (m >= n1) return base;
  var xs = [];
  for (var k = 0; k < Math.floor(m / 2); k++) xs.push(base[k], base[n1 - 1 - k]);
  if (m % 2) xs.push(0);
  return xs.sort(function (p, q) { return p - q; });
}

// rows — число стержней в рядах снизу вверх, например [4, 2]
function makeLayout(g, d, rows) {
  var ys = [g.a1], xs = [], n = 0, sum = 0, clear = [], okH = true;
  for (var r = 0; r < rows.length; r++) {
    if (r > 0) ys.push(ys[r - 1] + d + minClear(d, r));
    var x = rowXs(rows[0], rows[r], g.wPlace, g.a1);
    xs.push(x);
    var gap = Infinity;
    for (var i = 1; i < x.length; i++) gap = Math.min(gap, x[i] - x[i - 1] - d);
    clear.push(gap);
    if (gap < minClear(d, r)) okH = false;
    n += rows[r]; sum += rows[r] * ys[r];
  }
  return { d: d, rows: rows, n: n, area: n * Math.PI * d * d / 4, ys: ys, xs: xs, ac: sum / n, clear: clear, okH: okH,
           label: n + 'Ø' + d + (rows.length > 1 ? ' (' + rows.join('+') + ')' : '') };
}

// Верхний ряд: не больше стержней, чем в ряду под ним; нечётное число — только при нечётном нижнем ряде
function rowAllowed(n1, below, m) { return m >= 2 && m <= below && (m % 2 === 0 || n1 % 2 === 1); }

/* ---------- Прочность нормального сечения при заданной h0 ---------- */
function bending(g, Rb, Rs, Mn, h0) {
  var b = g.b, bfc = g.bfc, hfc = g.hfc;
  var xiR = 0.8 / (1 + (Rs / ES) / 0.0035), aR = xiR * (1 - 0.5 * xiR);
  var inFlange = false, inRib = false;
  if (g.hasTop) {
    if (Mn <= Rb * bfc * hfc * (h0 - 0.5 * hfc)) inFlange = true; else inRib = true;
  }
  var am = inRib ? (Mn - Rb * (bfc - b) * hfc * (h0 - 0.5 * hfc)) / (Rb * b * h0 * h0)
                 : Mn / (Rb * (inFlange ? bfc : b) * h0 * h0);
  var over = am > aR;
  var xi = over ? NaN : 1 - Math.sqrt(1 - 2 * am);
  var asReq = over ? NaN : (inRib ? (Rb * b * xi * h0 + Rb * (bfc - b) * hfc) / Rs
                                  : (Rb * (inFlange ? bfc : b) * xi * h0) / Rs);
  return { over: over, am: am, aR: aR, xi: xi, xiR: xiR, asReq: asReq, inFlange: inFlange, h0: h0 };
}

// Подбор продольной арматуры; rowsSel — 'auto' или число рядов
function strength(s, pick) {
  var g = geometry(s, true), sc = scheme(s);
  var conc = findConc(s.concrete), steel = findSteel(s.steel);
  var Rb = conc[1] * num(s.gb1), Rs = steel[1];
  var q = num(s.q);
  var bad = g.bad;
  if (!(sc.L > 0)) bad.L = 1;
  if (!(q > 0)) bad.q = 1;
  var loadsOk = sc.L > 0 && q > 0;
  var inputOk = g.dimsOk && loadsOk;
  var M = sc.mom(q), Qmax = sc.shear(q), Mn = M * 1e6;
  var rowsSel = s.rows === 'auto' ? 0 : parseInt(s.rows, 10);

  var out = { g: g, sc: sc, conc: conc, steel: steel, Rb: Rb, Rs: Rs, q: q, M: M, Qmax: Qmax, bad: bad,
              loadsOk: loadsOk, inputOk: inputOk, rowsSel: rowsSel, base: null, cands: [], pickIdx: 0, sel: null, st: null, checks: [] };
  if (!inputOk) return out;

  // Расчёт при арматуре в один ряд — для сообщений, когда подбор не удался
  out.base = bending(g, Rb, Rs, Mn, g.h - g.a1);

  // Перебор раскладок: диаметр, число стержней в каждом ряду
  var all = [];
  var tryLayout = function (d, rows) {
    var lay = makeLayout(g, d, rows);
    if (!lay.okH || !(lay.ys[rows.length - 1] < g.h / 2)) return;
    var st = bending(g, Rb, Rs, Mn, g.h - lay.ac);
    if (st.over) return;
    if (lay.area < Math.max(st.asReq, 0.001 * g.b * st.h0)) return;
    lay.st = st;
    all.push(lay);
  };
  DIAMETERS.forEach(function (d) {
    for (var n1 = 2; n1 <= 8; n1++) {
      tryLayout(d, [n1]);
      for (var n2 = 2; n2 <= n1; n2++) {
        if (!rowAllowed(n1, n1, n2)) continue;
        tryLayout(d, [n1, n2]);
        for (var n3 = 2; n3 <= n2; n3++) {
          if (rowAllowed(n1, n2, n3)) tryLayout(d, [n1, n2, n3]);
        }
      }
    }
  });
  var want = rowsSel;
  if (!want) { for (var R = 1; R <= 3 && !want; R++) if (all.some(function (c) { return c.rows.length === R; })) want = R; }
  var cands = all.filter(function (c) { return c.rows.length === want; });
  cands.sort(function (p, c) { return (p.area - c.area) || (p.ac - c.ac) || (p.n - c.n); });
  // одно сочетание «число и диаметр» — один вариант (с самой низкой раскладкой)
  var seen = {};
  cands = cands.filter(function (c) { var k = c.n + '-' + c.d; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 3);

  out.cands = cands;
  out.rowsUsed = want || 0;
  out.pickIdx = Math.min(pick, Math.max(cands.length - 1, 0));
  var sel = cands.length ? cands[out.pickIdx] : null;
  out.sel = sel;
  if (sel) {
    var st = sel.st;
    out.st = st;
    var mu = sel.area / (g.b * st.h0) * 100;
    var hDetail = sel.rows.map(function (n, r) {
      return (sel.rows.length > 1 ? 'ряд ' + (r + 1) + ': ' : '') + fmt(sel.clear[r], 0) + ' мм ≥ ' + fmt(minClear(sel.d, r), 0) + ' мм';
    }).join('; ');
    out.checks = [
      { name: 'Высота сжатой зоны', pass: st.xi <= st.xiR, detail: 'ξ = ' + fmt(st.xi, 3) + ' ≤ ξR = ' + fmt(st.xiR, 3) },
      { name: 'Минимальный процент армирования, п. 10.3.6', pass: mu >= 0.1, detail: 'μs = ' + fmt(mu, 2) + ' % ≥ 0,1 %' },
      { name: 'Расстояние между стержнями в ряду в свету, п. 10.3.5', pass: sel.okH, detail: hDetail }
    ];
    if (sel.rows.length > 1) {
      var vDetail = [];
      for (var r = 1; r < sel.rows.length; r++) {
        vDetail.push('ряды ' + r + '–' + (r + 1) + ': ' + fmt(sel.ys[r] - sel.ys[r - 1] - sel.d, 0) + ' мм ≥ ' + fmt(minClear(sel.d, r), 0) + ' мм');
      }
      out.checks.push({ name: 'Расстояние между рядами в свету, п. 10.3.5', pass: true, detail: vDetail.join('; ') });
    }
  }
  return out;
}

/* ---------- Предельный прогиб по СП 20.13330.2016, табл. Д.1 ---------- */
// Линейная интерполяция предельных прогибов между табличными пролётами
// byDen = false — интерполируются предельные прогибы в мм; true — интерполируются знаменатели n в L/n
function limitSp20(L, low, byDen) {
  var tbl = low ? LIMIT_LOW : LIMIT_HIGH;
  if (L <= tbl[0][0]) return L * 1000 / tbl[0][1];
  var last = tbl[tbl.length - 1];
  if (L >= last[0]) return L * 1000 / last[1];
  for (var i = 1; i < tbl.length; i++) {
    if (L <= tbl[i][0]) {
      var t0 = tbl[i - 1], t1 = tbl[i], k = (L - t0[0]) / (t1[0] - t0[0]);
      if (byDen) return L * 1000 / (t0[1] + (t1[1] - t0[1]) * k);
      var f0 = t0[0] * 1000 / t0[1], f1 = t1[0] * 1000 / t1[1];
      return f0 + (f1 - f0) * k;
    }
  }
  return NaN;
}

/* ---------- Прогиб ---------- */
// method: 'coef' — по понижающему коэффициенту жёсткости, без арматуры;
//         'exact' — по кривизне с учётом арматуры и трещин (СП 63.13330.2018, раздел 8.2)
function deflection(s) {
  var exact = s.method === 'exact';
  var g = geometry(s, exact), sc = scheme(s);
  var conc = findConc(s.concrete);
  var bad = g.bad;
  if (!(sc.L > 0)) bad.L = 1;

  // Нормативные нагрузки и нагрузка для прогиба по табл. Д.1 СП 20
  var gk = num0(s.g), pk = num0(s.p), sk = num0(s.s);
  if (!(gk >= 0)) bad.g = 1;
  if (!(pk >= 0)) bad.p = 1;
  if (!(sk >= 0)) bad.s = 1;
  var loadsValid = !bad.g && !bad.p && !bad.s;
  var ql = gk + K_LIVE * pk + K_SNOW * sk, qn = gk + pk + sk;
  var loadsOk = loadsValid && ql > 0 && sc.L > 0;

  // Предельный прогиб
  var manual = s.limit === 'manual', nLim = num(s.nLim);
  if (manual && !(nLim > 0)) bad.nLim = 1;
  var fu = manual ? sc.Lmm / nLim : limitSp20(sc.L, s.limit !== 'high', s.interp === 'den');

  var out = { g: g, sc: sc, conc: conc, bad: bad, exact: exact, gk: gk, pk: pk, sk: sk, ql: ql, qn: qn,
              loadsValid: loadsValid, loadsOk: loadsOk, manual: manual, fu: fu, lay: null, barsOk: true, res: null };

  var Eb = conc[3] * 1000, Ml = sc.mom(ql) * 1e6;

  if (!exact) {
    var kred = num(s.kred);
    if (!(kred > 0) || !(kred <= 1)) bad.kred = 1;
    if (!g.dimsOk || !loadsOk || bad.kred || !(fu > 0)) return out;
    var pr = sectionProps(g, 0, 0, 0);
    var D0 = kred * Eb * pr.I;
    var f0 = sc.sK * sc.Lmm * sc.Lmm * Ml / D0;
    out.res = { f: f0, fu: fu, pass: f0 <= fu, Ml: Ml, I: pr.I, Eb: Eb, kred: kred, D: D0 };
    return out;
  }

  // Арматура по рядам
  var d = num(s.d), n1 = num0(s.n1), n2 = num0(s.n2), n3 = num0(s.n3);
  var isInt = function (v) { return v >= 0 && v === Math.floor(v); };
  if (!isInt(n1) || n1 < 1) bad.n1 = 1;
  if (!isInt(n2) || n2 > n1) bad.n2 = 1;
  if (!isInt(n3) || n3 > n2) bad.n3 = 1;
  out.barsOk = !bad.n1 && !bad.n2 && !bad.n3 && d > 0;
  if (!g.dimsOk || !out.barsOk) return out;
  var rows = [n1]; if (n2 > 0) rows.push(n2); if (n3 > 0) rows.push(n3);
  var lay = makeLayout(g, d, rows);
  out.lay = lay;
  if (!loadsOk || !(fu > 0)) return out;

  var b = g.b, bfc = g.bfc, hfc = g.hfc, As = lay.area, a = lay.ac, h0 = g.h - a;
  var hi = s.hum === 'wet' ? 0 : (s.hum === 'dry' ? 2 : 1);
  var phi = conc[6 + hi], eb1 = EB1_RED[hi];
  var gr = sectionProps(g, ES / Eb, As, a);
  var gamma = g.hasBot ? 1.15 : 1.3;
  var Mcrc = conc[5] * gamma * gr.I / gr.y;
  var MnAll = sc.mom(qn) * 1e6;
  var cracked = MnAll > Mcrc;
  var Ired, xm = NaN, psi = NaN, Emod;
  if (!cracked) {
    Emod = Eb / (1 + phi);
    Ired = sectionProps(g, ES / Emod, As, a).I;
  } else {
    psi = Math.max(0.2, 1 - 0.8 * Mcrc / Ml);
    Emod = conc[4] / eb1;
    var aA = ES / (psi * Emod) * As;
    var bc = g.hasTop ? bfc : b;
    xm = (-aA + Math.sqrt(aA * aA + 2 * bc * aA * h0)) / bc;
    var Ib = bc * Math.pow(xm, 3) / 3;
    if (g.hasTop && xm > hfc) {
      var B = (bfc - b) * hfc + aA, C = (bfc - b) * hfc * hfc / 2 + aA * h0;
      xm = (-B + Math.sqrt(B * B + 2 * b * C)) / b;
      Ib = b * Math.pow(xm, 3) / 3 + (bfc - b) * Math.pow(hfc, 3) / 12 + (bfc - b) * hfc * Math.pow(xm - hfc / 2, 2);
    }
    Ired = Ib + aA * Math.pow(h0 - xm, 2);
  }
  var D = Emod * Ired;
  var curv = Ml / D, f = sc.sK * sc.Lmm * sc.Lmm * curv;
  out.res = { f: f, fu: fu, pass: f <= fu, Mcrc: Mcrc, MnAll: MnAll, Ml: Ml, cracked: cracked, psi: psi, xm: xm, h0: h0, ac: a,
              Emod: Emod, Ired: Ired, D: D, curv: curv, phi: phi, eb1: eb1, mu: As / (b * h0) * 100 };
  return out;
}

/* =====================================================================
   Вывод
   ===================================================================== */
var ICON_OK = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#0B6B3A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5l3.5 3.5 7.5-8"/></svg>';
var ICON_BAD = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#B42318" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14"/></svg>';

function checkRow(name, pass, okTxt, badTxt, detail) {
  return '<div class="check">' + (pass ? ICON_OK : ICON_BAD) + '<div><b>' + name + '</b> — ' + (pass ? okTxt : badTxt) +
    '<br><span class="d">' + detail + '</span></div></div>';
}

// Чертёж сечения; lay — раскладка арматуры (makeLayout) или null; note — подпись под чертежом
function drawSection(g, lay, note) {
  if (!g.dimsOk) return '<div class="wait" style="text-align:center">Чертёж появится, когда размеры сечения будут заданы корректно.</div>';
  var maxW = Math.max(g.b, g.hasTop ? g.bfc : 0, g.hasBot ? g.bft : 0);
  var k = Math.min(230 / maxW, 280 / g.h);
  var padL = 46, padR = 46, padT = g.hasTop ? 34 : 10, padB = 36;
  var W = maxW * k, H = g.h * k;
  var xc = padL + W / 2, y0 = padT;
  var wt = (g.hasTop ? g.bfc : g.b) / 2 * k, wb = (g.hasBot ? g.bft : g.b) / 2 * k, wr = g.b / 2 * k;
  var hT = (g.hasTop ? g.hfc : 0) * k, hB = (g.hasBot ? g.hft : 0) * k;
  var pts = [
    [xc - wt, y0], [xc + wt, y0], [xc + wt, y0 + hT], [xc + wr, y0 + hT], [xc + wr, y0 + H - hB], [xc + wb, y0 + H - hB],
    [xc + wb, y0 + H], [xc - wb, y0 + H], [xc - wb, y0 + H - hB], [xc - wr, y0 + H - hB], [xc - wr, y0 + hT], [xc - wt, y0 + hT]
  ].map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ');
  var o = '<svg width="' + Math.round(W + padL + padR) + '" height="' + Math.round(H + padT + padB) + '" viewBox="0 0 ' +
    r1(W + padL + padR) + ' ' + r1(H + padT + padB) + '" role="img" aria-label="Поперечное сечение балки">';
  o += '<polygon points="' + pts + '" fill="#DDE2E8" stroke="#15202B" stroke-width="2" stroke-linejoin="miter"/>';
  if (lay) {
    var rad = Math.max(lay.d * k / 2, 3);
    lay.xs.forEach(function (row, r) {
      row.forEach(function (x) {
        o += '<circle cx="' + r1(xc + x * k) + '" cy="' + r1(y0 + H - lay.ys[r] * k) + '" r="' + r1(rad) + '" fill="#C2410C" stroke="#7C2D12"/>';
      });
    });
  }
  var dim = '#5B6673', tx = 'fill="#47525E" text-anchor="middle"';
  var xl = padL - 12;
  o += '<line x1="' + xl + '" y1="' + y0 + '" x2="' + xl + '" y2="' + r1(y0 + H) + '" stroke="' + dim + '"/>';
  o += '<text ' + tx + ' transform="translate(' + (xl - 8) + ' ' + r1(y0 + H / 2) + ') rotate(-90)">h = ' + fmt(g.h, 0) + '</text>';
  if (lay) {
    var xr = padL + W + 12, yb = y0 + H - lay.ac * k;
    o += '<line x1="' + r1(xr) + '" y1="' + y0 + '" x2="' + r1(xr) + '" y2="' + r1(yb) + '" stroke="' + dim + '"/>';
    o += '<text ' + tx + ' transform="translate(' + r1(xr + 16) + ' ' + r1((y0 + yb) / 2) + ') rotate(-90)">h₀ = ' + fmt(g.h - lay.ac, 0) + '</text>';
  }
  var yd = y0 + H + 12;
  o += '<line x1="' + r1(xc - wb) + '" y1="' + r1(yd) + '" x2="' + r1(xc + wb) + '" y2="' + r1(yd) + '" stroke="' + dim + '"/>';
  o += '<text ' + tx + ' x="' + r1(xc) + '" y="' + r1(yd + 16) + '">' + (g.hasBot ? 'bf = ' + fmt(g.bft, 0) : 'b = ' + fmt(g.b, 0)) + '</text>';
  if (g.hasTop) {
    o += '<line x1="' + r1(xc - wt) + '" y1="' + (y0 - 12) + '" x2="' + r1(xc + wt) + '" y2="' + (y0 - 12) + '" stroke="' + dim + '"/>';
    o += '<text ' + tx + ' x="' + r1(xc) + '" y="' + (y0 - 18) + '">b′f = ' + fmt(g.bfc, 0) + '</text>';
  }
  o += '</svg>';
  var html = '<div class="stack" style="gap:18px"><div class="sect-wrap">' + o + '</div>';
  if (g.hasTop) {
    html += '<div class="mono cap" style="text-align:center">b = ' + fmt(g.b, 0) + ' · h′f = ' + fmt(g.hfc, 0) +
      (g.hasBot ? ' · hf = ' + fmt(g.hft, 0) : '') + '</div>';
  }
  if (lay) {
    html += '<div class="legend"><span class="dot"></span><div>Растянутая арматура <span class="mono" style="font-weight:500">' +
      lay.label + (note ? ' ' + note : '') + '</span>, ' + (lay.rows.length === 1 ? 'один ряд' : 'рядов: ' + lay.rows.length) + '</div></div>';
  }
  return html + '</div>';
}

// Эпюра: fn(t) — ординаты в долях наибольшего значения; axis — положение оси по высоте, 0..1
function diagram(fn, hpx, axis, label) {
  var N = 60, W = 600, H = 100, y0 = axis * H, amp = axis === 0 ? H : H / 2;
  var d = 'M0 ' + y0, hatch = '';
  for (var i = 0; i <= N; i++) {
    var t = i / N, x = r1(t * W), y = r1(y0 + fn(t) * amp);
    if (i % 2 === 0 && fn.jumpAt !== t) hatch += 'M' + x + ' ' + y0 + ' L' + x + ' ' + y + ' ';
    // скачок: вертикальный участок в точке приложения силы
    if (fn.jumpAt === t) { d += ' L' + x + ' ' + r1(y0 + fn.before * amp) + ' L' + x + ' ' + r1(y0 + fn.after * amp); continue; }
    d += ' L' + x + ' ' + y;
  }
  d += ' L' + W + ' ' + y0 + ' Z';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + hpx + '" preserveAspectRatio="none" role="img" aria-label="' + label + '">' +
    '<path d="' + d + '" fill="#E9EEF5"/>' +
    '<path d="' + hatch + '" stroke="#8693A3" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>' +
    '<path d="' + d + '" fill="none" stroke="#15202B" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
    '<line x1="0" y1="' + y0 + '" x2="' + W + '" y2="' + y0 + '" stroke="#15202B" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>';
}

// Формы эпюр для шарнирно опёртой балки
function shapes(isQ) {
  var m = isQ ? function (t) { return 4 * t * (1 - t); } : function (t) { return 2 * Math.min(t, 1 - t); };
  // Q: положительная вверх (у SVG ось y направлена вниз)
  var q = isQ ? function (t) { return -(1 - 2 * t); } : function (t) { return t < 0.5 ? -1 : (t > 0.5 ? 1 : 0); };
  if (!isQ) { q.jumpAt = 0.5; q.before = -1; q.after = 1; }
  var f = isQ ? function (t) { return 3.2 * (t - 2 * t * t * t + t * t * t * t); }
    : function (t) { var u = Math.min(t, 1 - t); return 3 * u - 4 * u * u * u; };
  return { m: m, q: q, f: f };
}

function schemeHtml(isQ, loadTxt, L) {
  return '<div class="scheme"><div class="t">' + loadTxt + '</div>' +
    (isQ ? '<div class="load-q"></div>' : '<div class="load-p"><i></i><u></u></div>') +
    '<div class="beam"></div><div class="sup"><i></i><i></i></div><div class="t">L = ' + fmt(L, 2) + ' м</div></div>';
}

function diagBlock(title, value, svg, hint) {
  return '<div class="diag-b"><div class="diag-h"><b>' + title + '</b><span class="mono">' + value + '</span></div>' + svg +
    (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
}

function rowsBox(rows) {
  var o = '<div class="box rows">';
  rows.forEach(function (r) { o += '<div><span class="k">' + r[0] + '</span><span>' + r[1] + '</span></div>'; });
  return o + '</div>';
}

function tablesHtml(concSel, steelSel) {
  if ($('tbl-conc')) {
    $('tbl-conc').innerHTML = CONC.map(function (c) {
      return '<tr' + (c[0] === concSel ? ' class="on"' : '') + '><td>' + c[0] + '</td><td>' + fmt(c[1], 1) + '</td><td>' + fmt(c[2], 2) +
        '</td><td>' + fmt(c[4], 1) + '</td><td>' + fmt(c[5], 2) + '</td><td>' + fmt(c[3], 1) + '</td><td>' +
        fmt(c[6], 1) + '</td><td>' + fmt(c[7], 1) + '</td><td>' + fmt(c[8], 1) + '</td></tr>';
    }).join('');
  }
  if ($('tbl-steel')) {
    $('tbl-steel').innerHTML = STEEL.map(function (c) {
      return '<tr' + (c[0] === steelSel ? ' class="on"' : '') + '><td>' + c[0] + '</td><td>' + fmt(c[1], 0) + '</td><td>' + c[2] + '</td></tr>';
    }).join('');
  }
}

/* =====================================================================
   Работа с формой
   ===================================================================== */
function getVal(id) { var el = $(id); return el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value; }
function setVal(id, v) {
  var el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = v === true || v === '1' || v === 'true';
  else el.value = v;
}
function readForm(ids) { var s = {}; ids.forEach(function (id) { s[id] = getVal(id); }); return s; }

/* ---------- Сохранение в браузере и ссылка на расчёт ---------- */
function storeGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } }
function storeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } }

// Данные берутся из адреса страницы, а если их там нет — из сохранённых в браузере.
// Возвращает {fromUrl, params}. Каждое изменение формы сохраняется.
function initState(key, ids) {
  var params = new URLSearchParams(location.search), fromUrl = false;
  ids.forEach(function (id) { if (params.has(id)) { setVal(id, params.get(id)); fromUrl = true; } });
  if (!fromUrl) {
    var saved = storeGet('calc:' + key);
    if (saved) ids.forEach(function (id) { if (Object.prototype.hasOwnProperty.call(saved, id)) setVal(id, saved[id]); });
  }
  $('form').addEventListener('input', function () { storeSet('calc:' + key, readForm(ids)); });
  if (fromUrl) storeSet('calc:' + key, readForm(ids));
  return { fromUrl: fromUrl, params: params };
}

function pageUrl() { return location.href.split('?')[0].split('#')[0]; }

// Кнопки «Ссылка на расчёт» и «Сбросить данные»
function setupShare(key, ids) {
  if ($('share')) {
    $('share').addEventListener('click', function () {
      var link = pageUrl() + '?' + ids.map(function (id) { return id + '=' + encodeURIComponent(getVal(id)); }).join('&');
      var done = function (ok) {
        $('share-msg').textContent = ok ? 'Ссылка скопирована. По ней откроется этот же расчёт.' : 'Скопируйте ссылку: ' + link;
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  }
  if ($('reset')) {
    $('reset').addEventListener('click', function () {
      storeDel('calc:' + key);
      location.href = pageUrl();
    });
  }
}

/* ---------- Отчёт: общие кнопки, реквизиты, печать ---------- */
// Готовый PDF: ссылка на случай, если браузер (например, на iPhone) не начал загрузку сам
function pdfReady(r) {
  var box = $('rep-msg');
  if (!box) return;
  box.innerHTML = 'PDF готов. Если загрузка не началась, <a href="' + r.url + '" download="' + r.file.replace(/"/g, '') + '" target="_blank" rel="noopener">откройте PDF по этой ссылке</a>.';
}
function reportMeta() {
  return [['Объект', $('rep-object').value.trim()], ['Выполнил', $('rep-author').value.trim()], ['Дата', new Date().toLocaleDateString('ru-RU')]];
}
function setupMeta() {
  var meta = storeGet('rep-meta') || {};
  if (!$('rep-object')) return;
  if (!$('rep-object').value) $('rep-object').value = meta.object || '';
  if (!$('rep-author').value) $('rep-author').value = meta.author || '';
  ['rep-object', 'rep-author'].forEach(function (id) {
    $(id).addEventListener('input', function () { storeSet('rep-meta', { object: $('rep-object').value, author: $('rep-author').value }); });
  });
}
// build() возвращает модель отчёта или Promise с ней; null — отчёт собрать нельзя
function setupReport(build, fileName) {
  setupMeta();
  var msg = function (t) { if ($('rep-msg')) $('rep-msg').textContent = t || ''; };
  var make = function () {
    return Promise.resolve().then(build).then(function (m) {
      if (!m) msg('Отчёт будет доступен, когда расчёт выполнен без ошибок во входных данных.');
      else msg('');
      return m;
    });
  };
  $('rep-docx').addEventListener('click', function () {
    var b = this; b.disabled = true;
    make().then(function (m) { if (m) Doc.download(m, fileName()); }).catch(function () { msg('Не удалось собрать отчёт.'); })
      .then(function () { b.disabled = false; });
  });
  if ($('rep-pdf')) $('rep-pdf').addEventListener('click', function () {
    var b = this; b.disabled = true; msg('Готовлю PDF…');
    make().then(function (m) { if (m) return Pdf.download(m, fileName()).then(function (r) { pdfReady(r); }); })
      .catch(function (e) { msg('Не удалось собрать PDF: ' + (e && e.message ? e.message : 'ошибка') + '. Можно скачать Word или воспользоваться печатью.'); })
      .then(function () { b.disabled = false; });
  });
  $('rep-print').addEventListener('click', function () {
    make().then(function (m) {
      if (!m) return;
      var p = $('rep-preview');
      p.innerHTML = Doc.previewHtml(m);
      p.hidden = false;
      var imgs = Array.prototype.slice.call(p.querySelectorAll('img'));
      Promise.all(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); }))
        .then(function () { window.print(); });
    });
  });
  window.addEventListener('afterprint', function () { if ($('rep-preview') && $('rep-print')) $('rep-preview').hidden = true; });
}

// Картинка для отчёта из SVG-элемента или строки SVG
function svgFrom(str) { var t = document.createElement('div'); t.innerHTML = str; return t.querySelector('svg'); }
function reportImg(svg, w, h, caption) {
  return Doc.svgImage(svg, w, h).then(function (img) { return { kind: 'img', img: img, caption: caption }; });
}

// Схема балки для отчёта
function schemeSvg(isQ, loadTxt, L) {
  var W = 600, x0 = 30, x1 = 570, yb = 70;
  var o = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' 120" width="' + W + '" height="120">';
  o += '<text x="300" y="16" text-anchor="middle" fill="#15202B">' + loadTxt + '</text>';
  if (isQ) {
    o += '<rect x="' + x0 + '" y="30" width="' + (x1 - x0) + '" height="34" fill="none" stroke="#15202B" stroke-width="1.5"/>';
    for (var x = x0 + 18; x < x1; x += 18) o += '<line x1="' + x + '" y1="30" x2="' + x + '" y2="64" stroke="#15202B"/>';
  } else {
    o += '<line x1="300" y1="26" x2="300" y2="62" stroke="#15202B" stroke-width="2"/><polygon points="293,58 307,58 300,68" fill="#15202B"/>';
  }
  o += '<rect x="' + x0 + '" y="' + yb + '" width="' + (x1 - x0) + '" height="6" fill="#15202B"/>';
  o += '<polygon points="' + x0 + ',' + (yb + 6) + ' ' + (x0 - 9) + ',' + (yb + 20) + ' ' + (x0 + 9) + ',' + (yb + 20) + '" fill="#15202B"/>';
  o += '<polygon points="' + x1 + ',' + (yb + 6) + ' ' + (x1 - 9) + ',' + (yb + 20) + ' ' + (x1 + 9) + ',' + (yb + 20) + '" fill="#15202B"/>';
  o += '<text x="300" y="112" text-anchor="middle" fill="#15202B">L = ' + fmt(L, 2) + ' м</text></svg>';
  return o;
}
// Эпюра для отчёта: та же форма, что на странице, с подписью наибольшего значения
function diagramSvg(fn, axis, label) {
  var s = svgFrom(diagram(fn, 90, axis, ''));
  s.setAttribute('viewBox', '-10 -14 620 128');
  s.insertAdjacentHTML('beforeend', '<text x="600" y="-2" text-anchor="end" fill="#15202B">' + label + '</text>');
  return s;
}

// Пустое поле не подсвечивается: человек ещё не ввёл значение
function markBad(ids, bad) {
  ids.forEach(function (id) {
    var el = $(id);
    if (el.tagName !== 'INPUT') return;
    var on = !!bad[id] && el.value !== '';
    el.classList.toggle('bad', on);
    if (on) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  });
}

function shapeFields(g) {
  $('grp-top').hidden = !g.hasTop;
  $('grp-bot').hidden = !g.hasBot;
  $('lbl-b').textContent = g.hasTop ? 'Ширина ребра b, мм' : 'Ширина b, мм';
}

/* =====================================================================
   Поперечная арматура (хомуты): прочность по наклонным сечениям, СП 63.13330.2018, 8.1.31–8.1.35
   ===================================================================== */
var RSW = { A240: 170, A400: 280, A500: 300 };          // Rsw, МПа (табл. 6.15)
var SW_STEPS = [50, 60, 75, 80, 100, 120, 125, 150, 175, 200, 225, 250, 300];

function shear(s, m) {
  var g = m.g, bad = {};
  var dsw = num(s.dsw), n = num(s.nsw), sw = num(s.sw), Rsw = RSW[s.swClass] || 280;
  if (!(n >= 1) || n !== Math.floor(n)) bad.nsw = 1;
  if (!(sw > 0)) bad.sw = 1;
  var out = { bad: bad, ok: false };
  if (!m.inputOk || bad.nsw || bad.sw) return out;
  var b = g.b, h0 = m.st ? m.st.h0 : g.h - g.a1;
  var Rbt = m.conc[2] * num(s.gb1), Rb = m.Rb;
  var Q0 = m.Qmax * 1000, q = m.sc.isQ ? m.q : 0;         // Н и Н/мм
  var cMax = 3 * h0;
  if (!m.sc.isQ) cMax = Math.min(cMax, m.sc.Lmm / 2);
  var Qstrip = 0.3 * Rb * b * h0;
  var qswMin = 0.25 * Rbt * b;
  var swMax = Rbt * b * h0 * h0 / Q0;
  var swConstr = Math.min(0.5 * h0, 300);

  var calc = function (spacing) {
    var Asw = n * Math.PI * dsw * dsw / 4, qsw = Rsw * Asw / spacing, counted = qsw >= qswMin;
    var worst = null, worst0 = null;
    for (var i = 0; i <= 200; i++) {
      var c = h0 + (cMax - h0) * i / 200;
      if (c < h0) c = h0;
      var Qb = Math.min(Math.max(1.5 * Rbt * b * h0 * h0 / c, 0.5 * Rbt * b * h0), 2.5 * Rbt * b * h0);
      var c0 = Math.min(c, 2 * h0);
      var Qsw = counted ? 0.75 * qsw * c0 : 0;
      var Q = Q0 - q * c;
      var u = Q / (Qb + Qsw), u0 = Q / Qb;
      if (!worst || u > worst.u) worst = { c: c, Qb: Qb, Qsw: Qsw, Q: Q, u: u, c0: c0 };
      if (!worst0 || u0 > worst0.u) worst0 = { c: c, Qb: Qb, Q: Q, u: u0 };
    }
    return { Asw: Asw, qsw: qsw, counted: counted, worst: worst, worst0: worst0 };
  };
  var r = calc(sw);
  var passStrip = Q0 <= Qstrip;
  var passStr = r.worst.u <= 1;
  var checks = [
    { name: 'Прочность бетонной полосы между наклонными трещинами, п. 8.1.32', pass: passStrip,
      detail: 'Q = ' + fmt(Q0 / 1000, 1) + ' кН ≤ 0,3·Rb·b·h₀ = ' + fmt(Qstrip / 1000, 1) + ' кН' },
    { name: 'Прочность по наклонному сечению, п. 8.1.33', pass: passStr,
      detail: 'Q = ' + fmt(r.worst.Q / 1000, 1) + ' кН ≤ Qb + Qsw = ' + fmt(r.worst.Qb / 1000, 1) + ' + ' + fmt(r.worst.Qsw / 1000, 1) +
        ' = ' + fmt((r.worst.Qb + r.worst.Qsw) / 1000, 1) + ' кН при c = ' + fmt(r.worst.c, 0) + ' мм' },
    { name: 'Хомуты учитываются в расчёте: qsw ≥ 0,25·Rbt·b', pass: r.counted || r.worst0.u <= 1,
      detail: 'qsw = ' + fmt(r.qsw, 1) + ' Н/мм ' + (r.counted ? '≥' : '<') + ' ' + fmt(qswMin, 1) + ' Н/мм' + (r.counted ? '' : (r.worst0.u <= 1 ? ', но по расчёту хомуты не требуются' : '')) },
    { name: 'Шаг не больше sw,max = Rbt·b·h₀² / Q, п. 8.1.35', pass: sw <= swMax,
      detail: fmt(sw, 0) + ' мм ≤ ' + fmt(swMax, 0) + ' мм' },
    { name: 'Конструктивный шаг у опор: не более 0,5h₀ и 300 мм, п. 10.3.13', pass: sw <= swConstr + 1e-9,
      detail: fmt(sw, 0) + ' мм ≤ ' + fmt(swConstr, 0) + ' мм' }
  ];
  // Наибольший подходящий шаг из распространённых
  var best = null;
  SW_STEPS.forEach(function (st) {
    if (st > swMax || st > swConstr + 1e-9) return;
    var t = calc(st);
    if (t.worst.u <= 1 && (t.counted || t.worst0.u <= 1)) best = st;
  });
  out = { bad: bad, ok: true, b: b, h0: h0, Rbt: Rbt, Rb: Rb, Rsw: Rsw, dsw: dsw, n: n, sw: sw, Q0: Q0, q: q,
          Qstrip: Qstrip, qswMin: qswMin, swMax: swMax, swConstr: swConstr, r: r, checks: checks,
          pass: checks.every(function (c) { return c.pass; }), best: best, noNeed: r.worst0.u <= 1,
          swMid: Math.min(0.75 * h0, 500) };
  return out;
}

/* =====================================================================
   Страница «Армирование балки»
   ===================================================================== */
function initReinf() {
  var IDS = ['shape', 'b', 'h', 'bfc', 'hfc', 'bft', 'hft', 'a', 'rows', 'L', 'loadType', 'q', 'concrete', 'steel', 'gb1',
             'swClass', 'dsw', 'nsw', 'sw'];
  var pick = 0, last = null;
  initState('reinf', IDS);
  setupShare('reinf', IDS);

  function resultHtml(m) {
    if (!m.inputOk) {
      return '<div class="alert">Проверьте исходные данные: размеры, пролёт и расчётная нагрузка должны быть больше нуля, расстояние a₁ — меньше половины высоты и половины ширины, полки — шире ребра и в сумме тоньше высоты сечения.</div>';
    }
    if (!m.sel) {
      if (m.base.over) {
        return '<div class="alert">Относительная высота сжатой зоны превышает граничную (αm = ' + fmt(m.base.am, 3) + ' больше αR = ' + fmt(m.base.aR, 3) +
          '). Одиночного армирования недостаточно: увеличьте сечение или класс бетона либо предусмотрите сжатую арматуру.</div>';
      }
      return '<div class="big-row"><div class="big"><div class="cap">Требуется при одном ряде</div><div class="val">' + fmt(m.base.asReq, 0) + ' <small>мм²</small></div></div></div>' +
        '<div class="alert">' + (m.rowsSel
          ? 'Арматура не подбирается при числе рядов ' + m.rowsSel + '. Выберите другое число рядов или «Авто», либо измените сечение.'
          : 'Арматура не размещается даже в три ряда. Увеличьте сечение или класс бетона.') + '</div>';
    }
    var st = m.st, sel = m.sel;
    var o = '<div class="big-row"><div class="big"><div class="cap">Требуется по расчёту</div><div class="val">' + fmt(st.asReq, 0) + ' <small>мм²</small></div></div>' +
      '<div class="big"><div class="cap">Принято</div><div class="val">' + sel.label + '</div><div class="cap">As = ' +
      fmt(sel.area, 0) + ' мм², запас ' + fmt((sel.area / st.asReq - 1) * 100, 1) + ' %</div></div></div>';
    o += '<div class="stack" style="gap:8px"><div class="cap">Варианты по сортаменту' + (m.rowsSel ? '' : ', рядов: ' + m.rowsUsed) + '</div><div class="variants">';
    m.cands.forEach(function (c, i) {
      o += '<button type="button" data-pick="' + i + '" aria-pressed="' + (i === m.pickIdx) + '"><b>' + c.label + '</b><small>' + fmt(c.area, 0) + ' мм²</small></button>';
    });
    o += '</div></div>';
    o += '<div class="box"><div class="kv2">' +
      '<div><span>M = </span>' + fmt(m.M, 1) + ' кН·м</div><div><span>Q = </span>' + fmt(m.Qmax, 1) + ' кН</div>' +
      '<div><span>a = </span>' + fmt(sel.ac, 0) + ' мм</div><div><span>h₀ = </span>' + fmt(st.h0, 0) + ' мм</div>' +
      '<div><span>αm = </span>' + fmt(st.am, 3) + '</div><div><span>αR = </span>' + fmt(st.aR, 3) + '</div>' +
      '<div><span>ξ = </span>' + fmt(st.xi, 3) + '</div><div><span>ξR = </span>' + fmt(st.xiR, 3) + '</div>' +
      '<div><span>x = </span>' + fmt(st.xi * st.h0, 0) + ' мм</div></div>';
    if (sel.rows.length > 1) o += '<div style="color:var(--ink-2)">a — расстояние от растянутой грани до центра тяжести всей арматуры, h₀ = h − a.</div>';
    if (m.g.hasTop) {
      o += '<div style="color:var(--ink-2)">' + (st.inFlange
        ? 'Граница сжатой зоны в полке: расчёт как для прямоугольного сечения шириной b′f.'
        : 'Граница сжатой зоны в ребре: учтены свесы сжатой полки.') + '</div>';
    }
    o += '</div>';
    o += '<div class="stack" style="gap:10px"><div class="cap">Проверки</div>';
    m.checks.forEach(function (c) { o += checkRow(c.name, c.pass, 'выполняется', 'не выполняется', c.detail); });
    return o + '</div>';
  }

  function diagHtml(m) {
    if (!m.loadsOk) return '<div class="wait" style="text-align:center">Эпюры появятся, когда будут заданы пролёт и расчётная нагрузка.</div>';
    var sh = shapes(m.sc.isQ);
    return '<div class="diag">' +
      schemeHtml(m.sc.isQ, m.sc.isQ ? 'q = ' + fmt(m.q, 1) + ' кН/м' : 'P = ' + fmt(m.q, 1) + ' кН', m.sc.L) +
      diagBlock('Эпюра M', 'Mmax = ' + fmt(m.M, 1) + ' кН·м', diagram(sh.m, 90, 0, 'Эпюра изгибающих моментов'), 'Построена со стороны растянутых волокон.') +
      diagBlock('Эпюра Q', 'на опорах ±' + fmt(m.Qmax, 1) + ' кН', diagram(sh.q, 90, 0.5, 'Эпюра поперечных сил'), '') +
      '</div>';
  }

  // Ссылка на проверку прогиба с подобранной арматурой
  function nextHtml(m, s) {
    if (!m.sel) return '';
    var p = ['shape', 'b', 'h', 'bfc', 'hfc', 'bft', 'hft', 'a', 'L', 'loadType', 'concrete'].map(function (id) {
      return id + '=' + encodeURIComponent(s[id]);
    });
    p.push('method=exact', 'd=' + m.sel.d, 'n1=' + m.sel.rows[0], 'n2=' + (m.sel.rows[1] || 0), 'n3=' + (m.sel.rows[2] || 0));
    return '<div class="card next"><div><h2>Проверить прогиб</h2><div class="cap">Сечение, пролёт и арматура ' + m.sel.label +
      ' перенесутся в расчёт прогиба. Останется задать нормативные нагрузки.</div></div>' +
      '<a class="btn" href="progib-balki.html?' + p.join('&') + '">Перейти к прогибу</a></div>';
  }

  function shearHtml(m, t) {
    if (!t.ok) return '<div class="wait">Расчёт хомутов появится, когда заданы сечение, нагрузка, шаг и число ветвей.</div>';
    var o = '<div class="big-row"><div class="big"><div class="cap">Хомуты у опоры</div><div class="val">Ø' + fmt(t.dsw, 0) + ' шаг ' + fmt(t.sw, 0) +
      '</div><div class="cap">' + $('swClass').value + ', ветвей: ' + fmt(t.n, 0) + ', Asw = ' + fmt(t.r.Asw, 0) + ' мм²</div></div>' +
      '<div class="big"><div class="cap">Наибольший подходящий шаг</div><div class="val">' + (t.best ? t.best + ' мм' : '—') + '</div>' +
      '<div class="cap">' + (t.best ? 'из ряда 50…300 мм при том же диаметре' : 'увеличьте диаметр или число ветвей') + '</div></div></div>';
    if (t.noNeed) o += '<div style="color:var(--ink-2)">По расчёту бетон воспринимает поперечную силу без хомутов (Q ≤ Qb). Хомуты ставятся по конструктивным требованиям.</div>';
    o += rowsBox([
      ['Q у опоры', fmt(t.Q0 / 1000, 1) + ' кН'],
      ['h₀', fmt(t.h0, 0) + ' мм'],
      ['Rbt (с γb1)', fmt(t.Rbt, 3) + ' МПа'],
      ['qsw = Rsw·Asw / sw', fmt(t.Rsw, 0) + '·' + fmt(t.r.Asw, 1) + ' / ' + fmt(t.sw, 0) + ' = ' + fmt(t.r.qsw, 1) + ' Н/мм'],
      ['Опасное сечение c', fmt(t.r.worst.c, 0) + ' мм'],
      ['Qb = 1,5·Rbt·b·h₀² / c', fmt(t.r.worst.Qb / 1000, 1) + ' кН'],
      ['Qsw = 0,75·qsw·c₀, c₀ = ' + fmt(t.r.worst.c0, 0) + ' мм', fmt(t.r.worst.Qsw / 1000, 1) + ' кН'],
      ['Шаг в средней части пролёта', 'не более ' + fmt(t.swMid, 0) + ' мм']
    ]);
    o += '<div class="stack" style="gap:10px"><div class="cap">Проверки</div>';
    t.checks.forEach(function (c) { o += checkRow(c.name, c.pass, 'выполняется', 'не выполняется', c.detail); });
    return o + '</div>';
  }

  function render() {
    var s = readForm(IDS), m = strength(s, pick);
    var t = shear(s, m);
    last = { s: s, m: m, t: t };
    shapeFields(m.g);
    $('lbl-q').textContent = m.sc.isQ ? 'Расчётная нагрузка q, кН/м' : 'Расчётная сила P, кН';
    var allBad = {}; Object.keys(m.bad).forEach(function (k) { allBad[k] = 1; }); Object.keys(t.bad).forEach(function (k) { allBad[k] = 1; });
    markBad(IDS, allBad);
    $('out-shear').innerHTML = shearHtml(m, t);
    $('mat-used').innerHTML = '<div><span>Rb = </span>' + fmt(m.Rb, 2) + ' МПа</div><div><span>Rs = </span>' + fmt(m.Rs, 0) + ' МПа</div>';
    $('out-section').innerHTML = drawSection(m.g, m.sel, m.steel[0]);
    $('out-result').innerHTML = resultHtml(m);
    $('out-diag').innerHTML = diagHtml(m);
    $('out-next').innerHTML = nextHtml(m, s);
  }

  setupReport(function () { return reinfReport(last, reportMeta()); }, function () { return 'Армирование балки'; });

  $('form').addEventListener('input', function () { pick = 0; render(); });
  $('out-result').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-pick]');
    if (!btn) return;
    pick = +btn.getAttribute('data-pick');
    render();
    var again = $('out-result').querySelector('button[data-pick="' + pick + '"]');
    if (again) again.focus();
  });
  render();
}

/* ---------- Отчёт «Армирование балки» ---------- */
function shapeName(g) { return g.hasBot ? 'двутавровое' : (g.hasTop ? 'тавровое, полка в сжатой зоне' : 'прямоугольное'); }
function sectionRows(g) {
  var r = [['Сечение', shapeName(g)], [g.hasTop ? 'Ширина ребра b' : 'Ширина b', fmt(g.b, 0) + ' мм'], ['Высота h', fmt(g.h, 0) + ' мм']];
  if (g.hasTop) r.push(['Сжатая полка b′f × h′f', fmt(g.bfc, 0) + ' × ' + fmt(g.hfc, 0) + ' мм']);
  if (g.hasBot) r.push(['Растянутая полка bf × hf', fmt(g.bft, 0) + ' × ' + fmt(g.hft, 0) + ' мм']);
  return r;
}

function reinfReport(last, meta) {
  if (!last || !last.m.sel) return null;
  var s = last.s, m = last.m, t = last.t, g = m.g, st = m.st, sel = m.sel, sc = m.sc;
  var unitQ = sc.isQ ? ' кН/м' : ' кН';
  var B = [];
  B.push({ kind: 'h1', text: '1. Исходные данные' });
  B.push({ kind: 'kv', rows: sectionRows(g).concat([
    ['Расстояние до центра нижнего ряда арматуры a₁', fmt(g.a1, 0) + ' мм'],
    ['Расчётная схема', 'однопролётная шарнирно опёртая балка'],
    ['Пролёт L', fmt(sc.L, 2) + ' м'],
    [sc.isQ ? 'Расчётная равномерная нагрузка q' : 'Расчётная сила P в середине пролёта', fmt(m.q, 2) + unitQ],
    ['Бетон', 'тяжёлый ' + m.conc[0] + ', Rb = ' + fmt(m.conc[1], 1) + ' МПа, Rbt = ' + fmt(m.conc[2], 2) + ' МПа (табл. 6.8 СП 63.13330.2018)'],
    ['Коэффициент γb1', fmt(num(s.gb1), 1)],
    ['Продольная арматура', m.steel[0] + ', Rs = ' + fmt(m.Rs, 0) + ' МПа (табл. 6.14)'],
    ['Хомуты', s.swClass + ', Rsw = ' + fmt(RSW[s.swClass], 0) + ' МПа']
  ]) });

  B.push({ kind: 'h1', text: '2. Усилия' });
  B.push({ kind: 'p', text: sc.isQ
    ? 'M = q·L² / 8 = ' + fmt(m.q, 2) + '·' + fmt(sc.L, 2) + '² / 8 = ' + fmt(m.M, 2) + ' кН·м; Q = q·L / 2 = ' + fmt(m.q, 2) + '·' + fmt(sc.L, 2) + ' / 2 = ' + fmt(m.Qmax, 2) + ' кН.'
    : 'M = P·L / 4 = ' + fmt(m.q, 2) + '·' + fmt(sc.L, 2) + ' / 4 = ' + fmt(m.M, 2) + ' кН·м; Q = P / 2 = ' + fmt(m.Qmax, 2) + ' кН.' });

  B.push({ kind: 'h1', text: '3. Подбор продольной арматуры' });
  B.push({ kind: 'p', text: 'Расчёт по прочности нормального сечения по пп. 8.1.8–8.1.10 СП 63.13330.2018. Rb = ' + fmt(m.Rb, 2) + ' МПа с учётом γb1.' });
  B.push({ kind: 'p', text: 'Рабочая высота: h₀ = h − a = ' + fmt(g.h, 0) + ' − ' + fmt(sel.ac, 1) + ' = ' + fmt(st.h0, 1) + ' мм' +
    (sel.rows.length > 1 ? ', где a — расстояние до центра тяжести арматуры в ' + sel.rows.length + ' рядах.' : '.') });
  var xiR = st.xiR;
  B.push({ kind: 'p', text: 'Граничная высота сжатой зоны: ξR = 0,8 / (1 + Rs / (Es·εb2)) = 0,8 / (1 + ' + fmt(m.Rs, 0) + ' / (200000·0,0035)) = ' + fmt(xiR, 3) +
    '; αR = ξR·(1 − 0,5ξR) = ' + fmt(st.aR, 3) + '.' });
  var Mn = m.M * 1e6;
  if (g.hasTop) {
    var Mf = m.Rb * g.bfc * g.hfc * (st.h0 - 0.5 * g.hfc);
    B.push({ kind: 'p', text: 'Момент, воспринимаемый полкой: Mf = Rb·b′f·h′f·(h₀ − 0,5h′f) = ' + fmt(m.Rb, 2) + '·' + fmt(g.bfc, 0) + '·' + fmt(g.hfc, 0) + '·(' +
      fmt(st.h0, 1) + ' − 0,5·' + fmt(g.hfc, 0) + ') = ' + fmt(Mf / 1e6, 1) + ' кН·м ' + (st.inFlange ? '≥' : '<') + ' M = ' + fmt(m.M, 1) + ' кН·м — граница сжатой зоны ' +
      (st.inFlange ? 'в полке, сечение рассчитывается как прямоугольное шириной b′f.' : 'в ребре.') });
  }
  if (g.hasTop && !st.inFlange) {
    B.push({ kind: 'p', text: 'αm = (M − Rb·(b′f − b)·h′f·(h₀ − 0,5h′f)) / (Rb·b·h₀²) = ' + fmt(st.am, 4) + ' ≤ αR = ' + fmt(st.aR, 3) + '.' });
    B.push({ kind: 'p', text: 'ξ = 1 − √(1 − 2αm) = ' + fmt(st.xi, 4) + '; As = (Rb·b·ξ·h₀ + Rb·(b′f − b)·h′f) / Rs = ' + fmt(st.asReq, 0) + ' мм².' });
  } else {
    var bw = g.hasTop ? g.bfc : g.b;
    B.push({ kind: 'p', text: 'αm = M / (Rb·b·h₀²) = ' + fmt(m.M, 2) + '·10⁶ / (' + fmt(m.Rb, 2) + '·' + fmt(bw, 0) + '·' + fmt(st.h0, 1) + '²) = ' + fmt(st.am, 4) +
      ' ≤ αR = ' + fmt(st.aR, 3) + '.' });
    B.push({ kind: 'p', text: 'ξ = 1 − √(1 − 2αm) = ' + fmt(st.xi, 4) + '; As = Rb·b·ξ·h₀ / Rs = ' + fmt(m.Rb, 2) + '·' + fmt(bw, 0) + '·' + fmt(st.xi, 4) + '·' +
      fmt(st.h0, 1) + ' / ' + fmt(m.Rs, 0) + ' = ' + fmt(st.asReq, 0) + ' мм².' });
  }
  B.push({ kind: 'p', text: 'Принята арматура ' + sel.label + ' ' + m.steel[0] + ', As = ' + fmt(sel.area, 0) + ' мм² ≥ ' + fmt(st.asReq, 0) + ' мм² (запас ' +
    fmt((sel.area / st.asReq - 1) * 100, 1) + ' %).', bold: true });
  m.checks.forEach(function (c) { B.push({ kind: 'check', text: c.name + ': ' + c.detail + ' — ' + (c.pass ? 'выполняется.' : 'не выполняется.'), pass: c.pass }); });

  if (t.ok) {
    B.push({ kind: 'h1', text: '4. Поперечная арматура' });
    B.push({ kind: 'p', text: 'Расчёт по наклонным сечениям по пп. 8.1.31–8.1.35 СП 63.13330.2018 у опоры, Q = ' + fmt(t.Q0 / 1000, 1) + ' кН, h₀ = ' + fmt(t.h0, 1) +
      ' мм, b = ' + fmt(t.b, 0) + ' мм, Rbt = ' + fmt(t.Rbt, 3) + ' МПа.' });
    B.push({ kind: 'p', text: 'Хомуты ' + s.swClass + ' Ø' + fmt(t.dsw, 0) + ', ' + fmt(t.n, 0) + ' ветви, шаг ' + fmt(t.sw, 0) + ' мм: Asw = ' + fmt(t.r.Asw, 1) +
      ' мм², qsw = Rsw·Asw / sw = ' + fmt(t.Rsw, 0) + '·' + fmt(t.r.Asw, 1) + ' / ' + fmt(t.sw, 0) + ' = ' + fmt(t.r.qsw, 1) + ' Н/мм.' });
    B.push({ kind: 'p', text: 'Опасное наклонное сечение c = ' + fmt(t.r.worst.c, 0) + ' мм: Qb = 1,5·Rbt·b·h₀² / c = ' + fmt(t.r.worst.Qb / 1000, 1) +
      ' кН (в пределах 0,5…2,5·Rbt·b·h₀); Qsw = 0,75·qsw·c₀ = ' + fmt(t.r.worst.Qsw / 1000, 1) + ' кН при c₀ = ' + fmt(t.r.worst.c0, 0) +
      ' мм; поперечная сила в конце сечения Q = ' + fmt(t.r.worst.Q / 1000, 1) + ' кН.' });
    if (t.noNeed) B.push({ kind: 'p', text: 'Бетон воспринимает поперечную силу без хомутов (Q ≤ Qb); хомуты назначаются по конструктивным требованиям.' });
    t.checks.forEach(function (c) { B.push({ kind: 'check', text: c.name + ': ' + c.detail + ' — ' + (c.pass ? 'выполняется.' : 'не выполняется.'), pass: c.pass }); });
    B.push({ kind: 'p', text: 'В средней части пролёта шаг хомутов — не более 0,75h₀ и 500 мм, то есть не более ' + fmt(t.swMid, 0) + ' мм (п. 10.3.13).' });
  }

  var allPass = m.checks.every(function (c) { return c.pass; }) && (!t.ok || t.pass);
  B.push({ kind: 'h1', text: (t.ok ? '5' : '4') + '. Вывод' });
  B.push({ kind: 'check', text: allPass ? 'Прочность балки по нормальным и наклонным сечениям обеспечена.' : 'Не все проверки выполняются — сечение или армирование нужно изменить.', pass: allPass });

  // Рисунки: схема, эпюры, сечение
  var sh = shapes(sc.isQ);
  var jobs = [
    reportImg(svgFrom(schemeSvg(sc.isQ, (sc.isQ ? 'q = ' : 'P = ') + fmt(m.q, 2) + unitQ, sc.L)), 600, 120, 'Расчётная схема'),
    reportImg(diagramSvg(sh.m, 0, 'Mmax = ' + fmt(m.M, 1) + ' кН·м'), 620, 128, 'Эпюра изгибающих моментов M, кН·м'),
    reportImg(diagramSvg(sh.q, 0.5, 'Qmax = ±' + fmt(m.Qmax, 1) + ' кН'), 620, 128, 'Эпюра поперечных сил Q, кН')
  ];
  var secSvg = $('out-section').querySelector('svg');
  jobs.push(reportImg(secSvg, +secSvg.getAttribute('width'), +secSvg.getAttribute('height'), 'Поперечное сечение и продольная арматура, мм'));
  return Promise.all(jobs).then(function (imgs) {
    var at = function (title) { for (var i = 0; i < B.length; i++) if (B[i].kind === 'h1' && B[i].text.indexOf(title) > 0) return i + 1; return B.length; };
    B.splice(at('Подбор продольной') + 1, 0, imgs[3]);
    B.splice(at('Усилия') + 1, 0, imgs[0], imgs[1], imgs[2]);
    return { title: 'Расчёт армирования железобетонной балки', meta: meta, blocks: B };
  });
}

/* =====================================================================
   Страница «Прогиб балки»
   ===================================================================== */
function initDefl() {
  var IDS = ['shape', 'b', 'h', 'bfc', 'hfc', 'bft', 'hft', 'L', 'loadType', 'g', 'p', 's', 'limit', 'interp', 'nLim',
             'method', 'kred', 'a', 'd', 'n1', 'n2', 'n3', 'hum', 'concrete'];

  // Данные из адреса (например, со страницы армирования) или сохранённые в браузере
  var state = initState('defl', IDS), last = null;
  if (state.fromUrl && !state.params.has('g')) { $('g').value = ''; $('p').value = ''; $('s').value = ''; }
  setupShare('defl', IDS);

  function limitTxt(m) {
    var den = m.sc.Lmm / m.fu;
    return 'L/' + fmt(den, 0);
  }

  function resultHtml(m) {
    if (!m.g.dimsOk) return '<div class="alert">Проверьте размеры сечения: они должны быть больше нуля, полки — шире ребра и в сумме тоньше высоты сечения' +
      (m.exact ? ', расстояние a₁ — меньше половины высоты и половины ширины' : '') + '.</div>';
    if (m.exact && !m.barsOk) return '<div class="alert">Проверьте арматуру: в нижнем ряду — не меньше одного стержня, в каждом ряду выше — не больше, чем в ряду под ним.</div>';
    if (!(m.sc.L > 0)) return '<div class="alert">Задайте пролёт балки.</div>';
    if (!m.loadsValid) return '<div class="alert">Нагрузки не могут быть отрицательными.</div>';
    if (!(m.ql > 0)) return '<div class="wait">Задайте нормативные нагрузки, чтобы получить прогиб.</div>';
    if (!m.res) return '<div class="alert">Проверьте ' + (m.manual ? 'знаменатель предельного прогиба' : 'понижающий коэффициент: он должен быть больше 0 и не больше 1') + '.</div>';
    var d = m.res, rows;
    if (!m.exact) {
      rows = [
        ['Нагрузка для прогиба', fmt(m.ql, 2) + (m.sc.isQ ? ' кН/м' : ' кН')],
        ['Момент M', fmt(d.Ml / 1e6, 1) + ' кН·м'],
        ['Момент инерции бетонного сечения I', fmt(d.I / 1e4, 0) + ' см⁴'],
        ['Модуль упругости Eb', fmt(d.Eb, 0) + ' МПа'],
        ['Понижающий коэффициент k', fmt(d.kred, 2)],
        ['Жёсткость D = k·Eb·I', fmt(d.D / 1e9, 0) + ' кН·м²'],
        ['Коэффициент схемы S', m.sc.isQ ? '5/48' : '1/12'],
        ['Формула', 'f = S·M·L² / D']
      ];
    } else {
      rows = [
        ['Арматура As', fmt(m.lay.area, 0) + ' мм², μs = ' + fmt(d.mu, 2) + ' %'],
        ['a до центра тяжести арматуры', fmt(d.ac, 0) + ' мм, h₀ = ' + fmt(d.h0, 0) + ' мм'],
        ['Нагрузка для прогиба', fmt(m.ql, 2) + (m.sc.isQ ? ' кН/м' : ' кН')],
        ['Mn, полная нормативная', fmt(d.MnAll / 1e6, 1) + ' кН·м'],
        ['Ml, для прогиба', fmt(d.Ml / 1e6, 1) + ' кН·м'],
        ['Mcrc', fmt(d.Mcrc / 1e6, 1) + ' кН·м'],
        ['Трещины', d.cracked ? 'образуются' : 'не образуются'],
        ['ψs', d.cracked ? fmt(d.psi, 3) : '—'],
        ['Высота сжатой зоны xm', d.cracked ? fmt(d.xm, 0) + ' мм' : '—'],
        [d.cracked ? 'Eb,red = Rb,ser / εb1,red' : 'Eb1 = Eb / (1 + φb,cr)', fmt(d.Emod, 0) + ' МПа'],
        [d.cracked ? 'εb1,red' : 'φb,cr', d.cracked ? fmt(d.eb1 * 1000, 1) + '·10⁻³' : fmt(d.phi, 1)],
        ['Ired', fmt(d.Ired / 1e4, 0) + ' см⁴'],
        ['Жёсткость D', fmt(d.D / 1e9, 0) + ' кН·м²'],
        ['Кривизна 1/r', fmt(d.curv * 1e6, 2) + '·10⁻³ 1/м'],
        ['Коэффициент схемы S', m.sc.isQ ? '5/48' : '1/12']
      ];
    }
    var o = '<div class="big-row"><div class="big"><div class="cap">Расчётный прогиб</div><div class="val">' + fmt(d.f, 1) + ' <small>мм</small></div></div>' +
      '<div class="big"><div class="cap">Предельный, ' + limitTxt(m) + '</div><div class="val">' + fmt(d.fu, 1) + ' <small>мм</small></div></div></div>';
    o += checkRow('Жёсткость', d.pass, 'обеспечена', 'не обеспечена', 'f = ' + fmt(d.f, 1) + ' мм ' + (d.pass ? '≤' : '>') + ' fu = ' + fmt(d.fu, 1) + ' мм');
    return o + rowsBox(rows);
  }

  function diagHtml(m) {
    if (!(m.sc.L > 0)) return '<div class="wait" style="text-align:center">Схема появится, когда будет задан пролёт.</div>';
    var sh = shapes(m.sc.isQ), unit = m.sc.isQ ? ' кН/м' : ' кН';
    var loadTxt = m.ql > 0 ? (m.sc.isQ ? 'q = ' : 'P = ') + fmt(m.ql, 2) + unit : (m.sc.isQ ? 'q' : 'P');
    var o = '<div class="diag">' + schemeHtml(m.sc.isQ, loadTxt, m.sc.L);
    if (m.res) {
      o += diagBlock('Эпюра M от нагрузки для прогиба', 'Mmax = ' + fmt(m.res.Ml / 1e6, 1) + ' кН·м', diagram(sh.m, 90, 0, 'Эпюра изгибающих моментов'), '');
      o += diagBlock('Эпюра прогибов', 'fmax = ' + fmt(m.res.f, 1) + ' мм', diagram(sh.f, 60, 0, 'Эпюра прогибов'),
        m.exact ? 'Форма линии — как для балки постоянной жёсткости, наибольшая ордината — по расчёту.' : '');
    }
    return o + '</div>';
  }

  function render() {
    var s = readForm(IDS), m = deflection(s);
    last = { s: s, m: m };
    shapeFields(m.g);
    $('grp-coef').hidden = m.exact;
    $('grp-exact').hidden = !m.exact;
    $('grp-nlim').hidden = !m.manual;
    $('grp-interp').hidden = m.manual;
    var u = m.sc.isQ ? ', кН/м' : ', кН';
    $('lbl-g').textContent = 'Постоянная' + u;
    $('lbl-p').textContent = 'Полезная по табл. 8.3' + u;
    $('lbl-s').textContent = 'Снеговая' + u;
    markBad(IDS, m.bad);
    $('load-used').innerHTML = m.loadsValid
      ? '<div><span>Для прогиба: </span>' + fmt(m.gk, 2) + ' + 0,35·' + fmt(m.pk, 2) + ' + 0,5·' + fmt(m.sk, 2) + ' = ' + fmt(m.ql, 2) + '</div>' +
        '<div><span>Полная: </span>' + fmt(m.qn, 2) + '</div>'
      : '';
    $('lim-used').innerHTML = m.fu > 0 ? '<div><span>fu = </span>' + fmt(m.fu, 1) + ' мм</div><div><span>это </span>' + limitTxt(m) + '</div>' : '';
    if (m.exact) $('as-used').innerHTML = m.lay ? '<div><span>As = </span>' + fmt(m.lay.area, 0) + ' мм²</div><div><span>a = </span>' + fmt(m.lay.ac, 0) + ' мм</div>' : '';
    $('out-section').innerHTML = drawSection(m.g, m.exact ? m.lay : null, '');
    $('out-result').innerHTML = resultHtml(m);
    $('out-diag').innerHTML = diagHtml(m);
  }

  setupReport(function () { return deflReport(last, reportMeta()); }, function () { return 'Прогиб балки'; });
  $('form').addEventListener('input', render);
  render();
}

/* ---------- Отчёт «Прогиб балки» ---------- */
function deflReport(last, meta) {
  if (!last || !last.m.res) return null;
  var s = last.s, m = last.m, d = m.res, g = m.g, sc = m.sc;
  var u = sc.isQ ? ' кН/м' : ' кН', B = [];
  var limitWay = m.manual ? 'задан вручную: L/' + fmt(num(s.nLim), 0)
    : 'по табл. Д.1 СП 20.13330.2016, поз. 2, для помещений высотой ' + (s.limit === 'high' ? 'более 6 м' : 'до 6 м') +
      ', интерполяция ' + (s.interp === 'den' ? 'знаменателей' : 'предельных прогибов');
  B.push({ kind: 'h1', text: '1. Исходные данные' });
  var rows = sectionRows(g).concat([
    ['Расчётная схема', 'однопролётная шарнирно опёртая балка'],
    ['Пролёт L', fmt(sc.L, 2) + ' м'],
    ['Бетон', 'тяжёлый ' + m.conc[0] + ', Eb = ' + fmt(m.conc[3] * 1000, 0) + ' МПа (табл. 6.11 СП 63.13330.2018)'],
    ['Нормативная постоянная нагрузка', fmt(m.gk, 2) + u],
    ['Нормативная полезная нагрузка (табл. 8.3)', fmt(m.pk, 2) + u],
    ['Нормативная снеговая нагрузка', fmt(m.sk, 2) + u],
    ['Предельный прогиб', limitWay]
  ]);
  if (m.exact) rows.push(['Растянутая арматура', m.lay.label + ', As = ' + fmt(m.lay.area, 0) + ' мм², a₁ = ' + fmt(g.a1, 0) + ' мм'],
                         ['Относительная влажность воздуха', $('hum').selectedOptions[0].textContent]);
  else rows.push(['Понижающий коэффициент к жёсткости k', fmt(d.kred, 2) + ' (п. 6.2.9 СП 430.1325800.2018)']);
  B.push({ kind: 'kv', rows: rows });

  B.push({ kind: 'h1', text: '2. Нагрузка для прогиба' });
  B.push({ kind: 'p', text: 'По табл. Д.1 СП 20.13330.2016 прогиб определяется от постоянных и длительных нагрузок: полезная нагрузка по табл. 8.3 — с коэффициентом 0,35, снеговая — с коэффициентом 0,5.' });
  B.push({ kind: 'p', text: (sc.isQ ? 'q' : 'P') + ' = ' + fmt(m.gk, 2) + ' + 0,35·' + fmt(m.pk, 2) + ' + 0,5·' + fmt(m.sk, 2) + ' = ' + fmt(m.ql, 2) + u +
    '; M = ' + (sc.isQ ? 'q·L² / 8' : 'P·L / 4') + ' = ' + fmt(d.Ml / 1e6, 2) + ' кН·м.' });

  B.push({ kind: 'h1', text: '3. Жёсткость и прогиб' });
  var S = sc.isQ ? '5/48' : '1/12';
  if (!m.exact) {
    B.push({ kind: 'p', text: 'Жёсткость определена по понижающему коэффициенту к жёсткости бетонного сечения без учёта арматуры: D = k·Eb·I.' });
    B.push({ kind: 'p', text: 'I = ' + fmt(d.I / 1e4, 0) + ' см⁴; D = ' + fmt(d.kred, 2) + '·' + fmt(d.Eb, 0) + '·' + fmt(d.I / 1e4, 0) + '·10⁴ = ' + fmt(d.D / 1e9, 0) + ' кН·м².' });
    B.push({ kind: 'p', text: 'f = S·M·L² / D = ' + S + '·' + fmt(d.Ml / 1e6, 2) + '·' + fmt(sc.L, 2) + '² / ' + fmt(d.D / 1e9, 0) + '·10³ = ' + fmt(d.f, 1) + ' мм.' });
  } else {
    B.push({ kind: 'p', text: 'Прогиб определён по кривизне в наиболее напряжённом сечении при продолжительном действии нагрузки (раздел 8.2 СП 63.13330.2018): f = S·(1/r)·L².' });
    B.push({ kind: 'kv', rows: [
      ['Рабочая высота h₀', fmt(d.h0, 1) + ' мм'],
      ['Момент от полной нормативной нагрузки Mn', fmt(d.MnAll / 1e6, 2) + ' кН·м'],
      ['Момент образования трещин Mcrc', fmt(d.Mcrc / 1e6, 2) + ' кН·м'],
      ['Трещины', d.cracked ? 'образуются (Mn > Mcrc)' : 'не образуются'],
      ['ψs', d.cracked ? fmt(d.psi, 3) : '—'],
      ['Высота сжатой зоны xm', d.cracked ? fmt(d.xm, 1) + ' мм' : '—'],
      [d.cracked ? 'Eb,red = Rb,ser / εb1,red' : 'Eb1 = Eb / (1 + φb,cr)', fmt(d.Emod, 0) + ' МПа'],
      ['Ired', fmt(d.Ired / 1e4, 0) + ' см⁴'],
      ['Жёсткость D', fmt(d.D / 1e9, 0) + ' кН·м²'],
      ['Кривизна 1/r = M / D', fmt(d.curv * 1e6, 3) + '·10⁻³ 1/м'],
      ['Прогиб f = ' + S + '·(1/r)·L²', fmt(d.f, 1) + ' мм']
    ] });
  }
  B.push({ kind: 'p', text: 'Предельный прогиб: fu = L/' + fmt(sc.Lmm / d.fu, 1) + ' = ' + fmt(d.fu, 1) + ' мм.' });
  B.push({ kind: 'check', text: 'f = ' + fmt(d.f, 1) + ' мм ' + (d.pass ? '≤' : '>') + ' fu = ' + fmt(d.fu, 1) + ' мм — требование по прогибу ' + (d.pass ? 'выполняется.' : 'не выполняется.'), pass: d.pass });

  var sh = shapes(sc.isQ);
  var jobs = [
    reportImg(svgFrom(schemeSvg(sc.isQ, (sc.isQ ? 'q = ' : 'P = ') + fmt(m.ql, 2) + u, sc.L)), 600, 120, 'Расчётная схема, нагрузка для прогиба'),
    reportImg(diagramSvg(sh.m, 0, 'Mmax = ' + fmt(d.Ml / 1e6, 1) + ' кН·м'), 620, 128, 'Эпюра изгибающих моментов M, кН·м'),
    reportImg(diagramSvg(sh.f, 0, 'fmax = ' + fmt(d.f, 1) + ' мм'), 620, 128, 'Эпюра прогибов, мм')
  ];
  var secSvg = $('out-section').querySelector('svg');
  if (secSvg) jobs.push(reportImg(secSvg, +secSvg.getAttribute('width'), +secSvg.getAttribute('height'), 'Поперечное сечение, мм'));
  return Promise.all(jobs).then(function (imgs) {
    var i3 = B.findIndex(function (b) { return b.kind === 'h1' && b.text.indexOf('Жёсткость') > 0; });
    var i2 = B.findIndex(function (b) { return b.kind === 'h1' && b.text.indexOf('Нагрузка') > 0; });
    if (imgs[3]) B.splice(i3 + 1, 0, imgs[3]);
    B.splice(i2 + 3, 0, imgs[0], imgs[1], imgs[2]);
    return { title: 'Расчёт прогиба железобетонной балки', meta: meta, blocks: B };
  });
}

/* =====================================================================
   Страница «Проверка прогиба»: известный прогиб против предельного по СП 20
   ===================================================================== */
function checkDeflection(s) {
  var f = num(s.f), L = num(s.L), cant = s.elem === 'cant';
  var manual = s.limit === 'manual', nLim = num(s.nLim);
  var bad = {};
  if (!(f >= 0)) bad.f = 1;
  if (!(L > 0)) bad.L = 1;
  if (manual && !(nLim > 0)) bad.nLim = 1;
  var Lcalc = cant ? 2 * L : L;                       // для консоли — удвоенный вылет
  var fu = manual ? Lcalc * 1000 / nLim : limitSp20(Lcalc, s.limit !== 'high', s.interp === 'den');
  var ok = !bad.f && !bad.L && !bad.nLim && fu > 0;
  return { f: f, L: L, cant: cant, manual: manual, Lcalc: Lcalc, fu: fu, bad: bad, ok: ok, pass: ok && f <= fu };
}

function initCheck() {
  var IDS = ['f', 'L', 'elem', 'limit', 'interp', 'nLim'];
  initState('check-v2', IDS);
  setupShare('check-v2', IDS);

  $('tbl-limit').innerHTML = [['не более 1', '1/120', '1/120'], ['3', '1/150', '1/150'], ['6', '1/200', '1/200'],
    ['12', '1/250', 'интерполяция'], ['24', '1/300', '1/250'], ['36 и более', '1/300', '1/300']].map(function (r) {
    return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>';
  }).join('');

  function resultHtml(m) {
    if (!m.ok) {
      if ($('f').value === '' || $('L').value === '') return '<div class="wait">Введите прогиб и пролёт.</div>';
      return '<div class="alert">Проверьте данные: прогиб не может быть отрицательным, пролёт и знаменатель должны быть больше нуля.</div>';
    }
    var mm = m.Lcalc * 1000;
    var rows = [
      [m.cant ? 'Расчётный пролёт l = 2 × вылет' : 'Расчётный пролёт l', fmt(m.Lcalc, 2) + ' м'],
      ['Предельный прогиб fu', fmt(m.fu, 1) + ' мм, это l/' + fmt(mm / m.fu, 0)],
      ['Фактический прогиб f', fmt(m.f, 1) + ' мм' + (m.f > 0 ? ', это l/' + fmt(mm / m.f, 0) : '')],
      ['Использование f / fu', fmt(m.f / m.fu * 100, 0) + ' %'],
      [m.pass ? 'Запас' : 'Превышение', fmt(Math.abs(m.fu - m.f), 1) + ' мм']
    ];
    return '<div class="verdict ' + (m.pass ? 'yes' : 'no') + '">' + (m.pass ? ICON_OK : ICON_BAD) +
      '<div><div class="v">' + (m.pass ? 'Проходит' : 'Не проходит') + '</div><div class="mono">f = ' + fmt(m.f, 1) + ' мм ' +
      (m.pass ? '≤' : '>') + ' fu = ' + fmt(m.fu, 1) + ' мм</div></div></div>' + rowsBox(rows);
  }

  function render() {
    var m = checkDeflection(readForm(IDS));
    $('grp-nlim').hidden = !m.manual;
    $('grp-interp').hidden = m.manual;
    $('lbl-L').textContent = m.cant ? 'Вылет консоли, м' : 'Пролёт L, м';
    markBad(IDS, m.bad);
    $('out-result').innerHTML = resultHtml(m);
  }
  $('form').addEventListener('input', render);
  render();
}

/* =====================================================================
   Запуск по типу страницы
   ===================================================================== */
(function () {
  var page = document.body.getAttribute('data-page');
  if (page === 'reinf') initReinf();
  if (page === 'defl') initDefl();
  if (page === 'check') initCheck();
  if (page === 'materials') tablesHtml('', '');
})();
