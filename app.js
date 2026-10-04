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

/* =====================================================================
   Общие функции
   ===================================================================== */
function num(v) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : NaN; }
function fmt(x, n) { return isFinite(x) ? x.toFixed(n).replace('.', ',') : '—'; }
function r1(x) { return Math.round(x * 10) / 10; }
function $(id) { return document.getElementById(id); }
function findConc(name) { return CONC.filter(function (c) { return c[0] === name; })[0] || CONC[2]; }
function findSteel(name) { return STEEL.filter(function (c) { return c[0] === name; })[0] || STEEL[2]; }

/* =====================================================================
   Расчёт. Внутренние величины — в Н и мм, если не указано иное.
   ===================================================================== */

// Геометрия сечения и проверка размеров; bad — поля с ошибкой
function geometry(s) {
  var g = {};
  g.hasTop = s.shape === 'tee' || s.shape === 'ibeam';
  g.hasBot = s.shape === 'ibeam';
  g.b = num(s.b); g.h = num(s.h); g.a = num(s.a);
  g.bfc = num(s.bfc); g.hfc = num(s.hfc); g.bft = num(s.bft); g.hft = num(s.hft);
  g.h0 = g.h - g.a;
  g.wPlace = g.hasBot ? g.bft : g.b;      // ширина, по которой размещаются стержни
  var bad = {};
  if (!(g.b > 0)) bad.b = 1;
  if (!(g.h > 0)) bad.h = 1;
  if (!(g.a > 0) || !(g.a < g.h / 2) || !(g.a < g.wPlace / 2)) bad.a = 1;
  if (g.hasTop) { if (!(g.bfc > g.b)) bad.bfc = 1; if (!(g.hfc > 0) || !(g.hfc < g.h)) bad.hfc = 1; }
  if (g.hasBot) { if (!(g.bft > g.b)) bad.bft = 1; if (!(g.hft > 0) || !(g.hfc + g.hft < g.h)) bad.hft = 1; }
  g.bad = bad;
  g.dimsOk = !Object.keys(bad).length;
  return g;
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

// Подбор продольной арматуры по прочности нормального сечения
function strength(s, pick) {
  var g = geometry(s), sc = scheme(s);
  var conc = findConc(s.concrete), steel = findSteel(s.steel);
  var Rb = conc[1] * num(s.gb1), Rs = steel[1];
  var q = num(s.q);
  var bad = g.bad;
  if (!(sc.L > 0)) bad.L = 1;
  if (!(q > 0)) bad.q = 1;
  var loadsOk = sc.L > 0 && q > 0;
  var inputOk = g.dimsOk && loadsOk;
  var M = sc.mom(q), Qmax = sc.shear(q), Mn = M * 1e6;
  var b = g.b, h0 = g.h0, bfc = g.bfc, hfc = g.hfc;

  var xiR = 0.8 / (1 + (Rs / ES) / 0.0035);
  var aR = xiR * (1 - 0.5 * xiR);

  // Положение границы сжатой зоны для сечений с полкой
  var inFlange = false, inRib = false, am = NaN;
  if (inputOk) {
    if (g.hasTop) {
      var Mf = Rb * bfc * hfc * (h0 - 0.5 * hfc);
      if (Mn <= Mf) inFlange = true; else inRib = true;
    }
    if (inRib) am = (Mn - Rb * (bfc - b) * hfc * (h0 - 0.5 * hfc)) / (Rb * b * h0 * h0);
    else am = Mn / (Rb * (inFlange ? bfc : b) * h0 * h0);
  }
  var overR = inputOk && am > aR;
  var showResult = inputOk && !overR;

  var xi = showResult ? 1 - Math.sqrt(1 - 2 * am) : NaN;
  var asReq = NaN;
  if (showResult) {
    asReq = inRib ? (Rb * b * xi * h0 + Rb * (bfc - b) * hfc) / Rs
                  : (Rb * (inFlange ? bfc : b) * xi * h0) / Rs;
  }
  var need = Math.max(asReq, showResult ? 0.001 * b * h0 : NaN);

  // Подбор по сортаменту: наименьшая площадь, стержни в один ряд
  var cands = [];
  if (showResult) {
    DIAMETERS.forEach(function (d) {
      for (var n = 2; n <= 8; n++) {
        var area = n * Math.PI * d * d / 4;
        if (area < need) continue;
        var clear = (g.wPlace - 2 * g.a) / (n - 1) - d;
        if (clear < Math.max(d, 25)) continue;
        cands.push({ d: d, n: n, area: area, clear: clear });
      }
    });
    cands.sort(function (p, c) { return (p.area - c.area) || (p.n - c.n); });
    cands = cands.slice(0, 3);
  }
  var pickIdx = Math.min(pick, Math.max(cands.length - 1, 0));
  var sel = cands.length ? cands[pickIdx] : null;

  var checks = [];
  if (sel) {
    var mu = sel.area / (b * h0) * 100, minClear = Math.max(sel.d, 25);
    checks = [
      { name: 'Высота сжатой зоны', pass: xi <= xiR, detail: 'ξ = ' + fmt(xi, 3) + ' ≤ ξR = ' + fmt(xiR, 3) },
      { name: 'Минимальный процент армирования, п. 10.3.6', pass: mu >= 0.1, detail: 'μs = ' + fmt(mu, 2) + ' % ≥ 0,1 %' },
      { name: 'Расстояние между стержнями в свету, п. 10.3.5', pass: sel.clear >= minClear, detail: fmt(sel.clear, 0) + ' мм ≥ ' + fmt(minClear, 0) + ' мм' }
    ];
  }
  return {
    g: g, sc: sc, conc: conc, steel: steel, Rb: Rb, Rs: Rs, q: q, M: M, Qmax: Qmax, bad: bad,
    loadsOk: loadsOk, inputOk: inputOk, overR: overR, showResult: showResult, inFlange: inFlange,
    am: am, aR: aR, xi: xi, xiR: xiR, asReq: asReq, cands: cands, pickIdx: pickIdx, sel: sel, checks: checks
  };
}

// Прогиб от постоянных и длительных нагрузок при заданной арматуре (продолжительное действие)
function deflection(s) {
  var g = geometry(s), sc = scheme(s);
  var conc = findConc(s.concrete);
  var n = num(s.n), d = num(s.d);
  var qn = num(s.qn), qnl = num(s.qnl), nLim = num(s.nLim);
  var bad = g.bad;
  if (!(n >= 1) || n !== Math.floor(n)) bad.n = 1;
  if (!(sc.L > 0)) bad.L = 1;
  if (!(qn > 0)) bad.qn = 1;
  if (!(qnl > 0) || !(qnl <= qn)) bad.qnl = 1;
  if (!(nLim > 0)) bad.nLim = 1;
  var barsOk = !bad.n && d > 0;
  var As = barsOk ? n * Math.PI * d * d / 4 : NaN;
  var loadsOk = sc.L > 0 && qn > 0 && qnl > 0 && qnl <= qn && nLim > 0;
  var out = { g: g, sc: sc, conc: conc, bad: bad, n: n, d: d, As: As, qn: qn, qnl: qnl, nLim: nLim,
              barsOk: barsOk, loadsOk: loadsOk, res: null };
  if (!g.dimsOk || !barsOk || !loadsOk) return out;

  var b = g.b, h = g.h, a = g.a, h0 = g.h0, bfc = g.bfc, hfc = g.hfc, bft = g.bft, hft = g.hft;
  var Eb = conc[3] * 1000;
  var hi = s.hum === 'wet' ? 0 : (s.hum === 'dry' ? 2 : 1);
  var phi = conc[6 + hi], eb1 = EB1_RED[hi];
  var hT = g.hasTop ? hfc : 0, hB = g.hasBot ? hft : 0;
  var ovT = g.hasTop ? (bfc - b) * hfc : 0, ovB = g.hasBot ? (bft - b) * hft : 0;

  // Приведённое сечение без трещин; y — от растянутой грани до центра тяжести
  var sect = function (al) {
    var A = b * h + ovT + ovB + al * As;
    var S = b * h * h / 2 + ovT * (h - hT / 2) + ovB * hB / 2 + al * As * a;
    var y = S / A;
    var I = b * h * h * h / 12 + b * h * Math.pow(h / 2 - y, 2)
      + (g.hasTop ? (bfc - b) * Math.pow(hT, 3) / 12 : 0) + ovT * Math.pow(h - hT / 2 - y, 2)
      + (g.hasBot ? (bft - b) * Math.pow(hB, 3) / 12 : 0) + ovB * Math.pow(hB / 2 - y, 2)
      + al * As * Math.pow(y - a, 2);
    return { y: y, I: I };
  };
  var gr = sect(ES / Eb);
  var gamma = g.hasBot ? 1.15 : 1.3;
  var Mcrc = conc[5] * gamma * gr.I / gr.y;
  var MnAll = sc.mom(qn) * 1e6, Ml = sc.mom(qnl) * 1e6;
  var cracked = MnAll > Mcrc;
  var Ired, xm = NaN, psi = NaN, Emod;
  if (!cracked) {
    Emod = Eb / (1 + phi);
    Ired = sect(ES / Emod).I;
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
  var curv = Ml / D, f = sc.sK * sc.Lmm * sc.Lmm * curv, fu = sc.Lmm / nLim;
  out.res = { f: f, fu: fu, pass: f <= fu, Mcrc: Mcrc, MnAll: MnAll, Ml: Ml, cracked: cracked, psi: psi, xm: xm,
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

// Чертёж сечения; bars — {n, d} или null; barsName — подпись арматуры
function drawSection(g, bars, barsName) {
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
    r1(W + padL + padR) + ' ' + r1(H + padT + padB) + '" role="img" aria-label="Поперечное сечение балки с арматурой">';
  o += '<polygon points="' + pts + '" fill="#DDE2E8" stroke="#15202B" stroke-width="2" stroke-linejoin="miter"/>';
  if (bars) {
    var rad = Math.max(bars.d * k / 2, 3);
    for (var i = 0; i < bars.n; i++) {
      var off = bars.n === 1 ? 0 : -g.wPlace / 2 + g.a + i * (g.wPlace - 2 * g.a) / (bars.n - 1);
      o += '<circle cx="' + r1(xc + off * k) + '" cy="' + r1(y0 + H - g.a * k) + '" r="' + r1(rad) + '" fill="#C2410C" stroke="#7C2D12"/>';
    }
  }
  var dim = '#5B6673', tx = 'fill="#47525E" text-anchor="middle"';
  var xl = padL - 12;
  o += '<line x1="' + xl + '" y1="' + y0 + '" x2="' + xl + '" y2="' + r1(y0 + H) + '" stroke="' + dim + '"/>';
  o += '<text ' + tx + ' transform="translate(' + (xl - 8) + ' ' + r1(y0 + H / 2) + ') rotate(-90)">h = ' + fmt(g.h, 0) + '</text>';
  var xr = padL + W + 12, yb = y0 + H - g.a * k;
  o += '<line x1="' + r1(xr) + '" y1="' + y0 + '" x2="' + r1(xr) + '" y2="' + r1(yb) + '" stroke="' + dim + '"/>';
  o += '<text ' + tx + ' transform="translate(' + r1(xr + 16) + ' ' + r1((y0 + yb) / 2) + ') rotate(-90)">h₀ = ' + fmt(g.h0, 0) + '</text>';
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
  if (bars) {
    html += '<div class="legend"><span class="dot"></span><div>Растянутая арматура <span class="mono" style="font-weight:500">' +
      barsName + '</span>, один ряд</div></div>';
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
function readForm(ids) { var s = {}; ids.forEach(function (id) { s[id] = $(id).value; }); return s; }

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
   Страница «Армирование балки»
   ===================================================================== */
function initReinf() {
  var IDS = ['shape', 'b', 'h', 'bfc', 'hfc', 'bft', 'hft', 'a', 'L', 'loadType', 'q', 'concrete', 'steel', 'gb1'];
  var pick = 0;

  function resultHtml(m) {
    if (!m.inputOk) {
      return '<div class="alert">Проверьте исходные данные: размеры, пролёт и расчётная нагрузка должны быть больше нуля, расстояние a — меньше половины высоты и половины ширины, полки — шире ребра и в сумме тоньше высоты сечения.</div>';
    }
    if (m.overR) {
      return '<div class="alert">Относительная высота сжатой зоны превышает граничную (αm = ' + fmt(m.am, 3) + ' больше αR = ' + fmt(m.aR, 3) +
        '). Одиночного армирования недостаточно: увеличьте сечение или класс бетона либо предусмотрите сжатую арматуру.</div>';
    }
    var o = '<div class="big-row"><div class="big"><div class="cap">Требуется по расчёту</div><div class="val">' + fmt(m.asReq, 0) + ' <small>мм²</small></div></div>';
    if (m.sel) {
      o += '<div class="big"><div class="cap">Принято</div><div class="val">' + m.sel.n + 'Ø' + m.sel.d + '</div><div class="cap">As = ' +
        fmt(m.sel.area, 0) + ' мм², запас ' + fmt((m.sel.area / m.asReq - 1) * 100, 1) + ' %</div></div>';
    }
    o += '</div>';
    if (!m.sel) {
      o += '<div class="alert">Требуемая арматура не размещается в один ряд при заданной ширине. Увеличьте ширину сечения или предусмотрите второй ряд.</div>';
    } else {
      o += '<div class="stack" style="gap:8px"><div class="cap">Варианты по сортаменту</div><div class="variants">';
      m.cands.forEach(function (c, i) {
        o += '<button type="button" data-pick="' + i + '" aria-pressed="' + (i === m.pickIdx) + '"><b>' + c.n + 'Ø' + c.d + '</b><small>' + fmt(c.area, 0) + ' мм²</small></button>';
      });
      o += '</div></div>';
    }
    o += '<div class="box"><div class="kv2">' +
      '<div><span>M = </span>' + fmt(m.M, 1) + ' кН·м</div><div><span>Q = </span>' + fmt(m.Qmax, 1) + ' кН</div>' +
      '<div><span>h₀ = </span>' + fmt(m.g.h0, 0) + ' мм</div><div><span>x = </span>' + fmt(m.xi * m.g.h0, 0) + ' мм</div>' +
      '<div><span>αm = </span>' + fmt(m.am, 3) + '</div><div><span>αR = </span>' + fmt(m.aR, 3) + '</div>' +
      '<div><span>ξ = </span>' + fmt(m.xi, 3) + '</div><div><span>ξR = </span>' + fmt(m.xiR, 3) + '</div></div>';
    if (m.g.hasTop) {
      o += '<div style="color:var(--ink-2)">' + (m.inFlange
        ? 'Граница сжатой зоны в полке: расчёт как для прямоугольного сечения шириной b′f.'
        : 'Граница сжатой зоны в ребре: учтены свесы сжатой полки.') + '</div>';
    }
    o += '</div>';
    if (m.sel) {
      o += '<div class="stack" style="gap:10px"><div class="cap">Проверки</div>';
      m.checks.forEach(function (c) { o += checkRow(c.name, c.pass, 'выполняется', 'не выполняется', c.detail); });
      o += '</div>';
    }
    return o;
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
    p.push('n=' + m.sel.n, 'd=' + m.sel.d);
    return '<div class="card next"><div><h2>Проверить прогиб</h2><div class="cap">Сечение, пролёт и арматура ' + m.sel.n + 'Ø' + m.sel.d +
      ' перенесутся в расчёт прогиба. Останется задать нормативные нагрузки.</div></div>' +
      '<a class="btn" href="progib-balki.html?' + p.join('&') + '">Перейти к прогибу</a></div>';
  }

  function render() {
    var s = readForm(IDS), m = strength(s, pick);
    shapeFields(m.g);
    $('lbl-q').textContent = m.sc.isQ ? 'Расчётная нагрузка q, кН/м' : 'Расчётная сила P, кН';
    markBad(IDS, m.bad);
    $('mat-used').innerHTML = '<div><span>Rb = </span>' + fmt(m.Rb, 2) + ' МПа</div><div><span>Rs = </span>' + fmt(m.Rs, 0) + ' МПа</div>';
    $('out-section').innerHTML = drawSection(m.g, m.sel, m.sel ? m.sel.n + 'Ø' + m.sel.d + ' ' + m.steel[0] : '');
    $('out-result').innerHTML = resultHtml(m);
    $('out-diag').innerHTML = diagHtml(m);
    $('out-next').innerHTML = nextHtml(m, s);
  }

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

/* =====================================================================
   Страница «Прогиб балки»
   ===================================================================== */
function initDefl() {
  var IDS = ['shape', 'b', 'h', 'bfc', 'hfc', 'bft', 'hft', 'a', 'n', 'd', 'L', 'loadType', 'qn', 'qnl', 'nLim', 'concrete', 'hum'];

  // Данные, переданные со страницы армирования
  var params = new URLSearchParams(location.search), came = false;
  IDS.forEach(function (id) {
    if (params.has(id)) { $(id).value = params.get(id); came = true; }
  });
  if (came && !params.has('qn')) { $('qn').value = ''; $('qnl').value = ''; }

  function resultHtml(m) {
    if (!m.g.dimsOk) return '<div class="alert">Проверьте размеры сечения: они должны быть больше нуля, расстояние a — меньше половины высоты и половины ширины, полки — шире ребра и в сумме тоньше высоты сечения.</div>';
    if (!m.barsOk) return '<div class="alert">Задайте арматуру: целое число стержней и диаметр.</div>';
    if (!m.loadsOk) {
      if ($('qn').value === '' || $('qnl').value === '') return '<div class="wait">Задайте нормативные нагрузки, чтобы получить прогиб.</div>';
      return '<div class="alert">Проверьте пролёт и нормативные нагрузки: все значения должны быть больше нуля, длительная нагрузка — не больше полной.</div>';
    }
    var d = m.res;
    var rows = [
      ['Арматура As', fmt(m.As, 0) + ' мм², μs = ' + fmt(d.mu, 2) + ' %'],
      ['Mn, полная нормативная', fmt(d.MnAll / 1e6, 1) + ' кН·м'],
      ['Ml, длительная', fmt(d.Ml / 1e6, 1) + ' кН·м'],
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
    var o = '<div class="big-row"><div class="big"><div class="cap">Расчётный прогиб</div><div class="val">' + fmt(d.f, 1) + ' <small>мм</small></div></div>' +
      '<div class="big"><div class="cap">Предельный, L/' + fmt(m.nLim, 0) + '</div><div class="val">' + fmt(d.fu, 1) + ' <small>мм</small></div></div></div>';
    o += checkRow('Жёсткость', d.pass, 'обеспечена', 'не обеспечена', 'f = ' + fmt(d.f, 1) + ' мм ' + (d.pass ? '≤' : '>') + ' fu = ' + fmt(d.fu, 1) + ' мм');
    o += '<div class="box rows">';
    rows.forEach(function (r) { o += '<div><span class="k">' + r[0] + '</span><span>' + r[1] + '</span></div>'; });
    return o + '</div>';
  }

  function diagHtml(m) {
    if (!(m.sc.L > 0)) return '<div class="wait" style="text-align:center">Схема появится, когда будет задан пролёт.</div>';
    var sh = shapes(m.sc.isQ);
    var loadTxt = m.qnl > 0 ? (m.sc.isQ ? 'qn,l = ' + fmt(m.qnl, 1) + ' кН/м' : 'Pn,l = ' + fmt(m.qnl, 1) + ' кН') : (m.sc.isQ ? 'qn,l' : 'Pn,l');
    var o = '<div class="diag">' + schemeHtml(m.sc.isQ, loadTxt, m.sc.L);
    if (m.res) {
      o += diagBlock('Эпюра M от длительной нагрузки', 'Mmax = ' + fmt(m.res.Ml / 1e6, 1) + ' кН·м', diagram(sh.m, 90, 0, 'Эпюра изгибающих моментов'), '');
      o += diagBlock('Эпюра прогибов', 'fmax = ' + fmt(m.res.f, 1) + ' мм', diagram(sh.f, 60, 0, 'Эпюра прогибов'),
        'Форма линии — как для балки постоянной жёсткости, наибольшая ордината — по расчёту.');
    }
    return o + '</div>';
  }

  function render() {
    var s = readForm(IDS), m = deflection(s);
    shapeFields(m.g);
    $('lbl-qn').textContent = m.sc.isQ ? 'Нормативная полная qn, кН/м' : 'Нормативная полная Pn, кН';
    $('lbl-qnl').textContent = m.sc.isQ ? 'Нормативная постоянная и длительная qn,l, кН/м' : 'Нормативная постоянная и длительная Pn,l, кН';
    markBad(IDS, m.bad);
    $('as-used').innerHTML = '<div><span>As = </span>' + fmt(m.As, 0) + ' мм²</div><div><span>Es = </span>2,0·10⁵ МПа</div>';
    $('out-section').innerHTML = drawSection(m.g, m.barsOk ? { n: m.n, d: m.d } : null, m.barsOk ? m.n + 'Ø' + m.d : '');
    $('out-result').innerHTML = resultHtml(m);
    $('out-diag').innerHTML = diagHtml(m);
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
  if (page === 'materials') tablesHtml('', '');
})();
