'use strict';

/* =====================================================================
   Сбор нагрузок, продавливание, анкеровка и нахлёст.
   Использует общие функции из app.js и docx.js.
   ===================================================================== */

/* =====================================================================
   Сбор нагрузок на перекрытие, СП 20.13330.2016
   ===================================================================== */
// Табл. 8.3: позиция, нормативное значение, кПа; доля для прогиба (пониженное значение)
var LIVE_83 = [
  ['flat', 'Квартиры жилых зданий (поз. 1)', 1.5, 0.35],
  ['office', 'Служебные помещения, офисы, классные помещения (поз. 2)', 2.0, 0.35],
  ['cafe', 'Обеденные залы кафе, ресторанов (поз. 4б)', 3.0, 0.35],
  ['shop', 'Торговые, выставочные залы (поз. 4г)', 4.0, 0.35],
  ['attic', 'Чердачные помещения (поз. 8)', 0.7, 1.0],
  ['balcony', 'Балконы и лоджии, сплошная нагрузка (поз. 10б)', 2.0, 0.35],
  ['stairs', 'Лестницы, коридоры к помещениям поз. 1–3 (поз. 12а)', 3.0, 0.35],
  ['stairs2', 'Лестницы, коридоры к помещениям поз. 4–6, 11 (поз. 12б)', 4.0, 0.35],
  ['custom', 'Задать своё значение', NaN, 0.35]
];
// Табл. 7.1: коэффициенты надёжности по нагрузке для веса конструкций
var GF_71 = [
  ['1.05', '1,05 — металлические'],
  ['1.1', '1,1 — железобетонные, бетонные > 1600 кг/м³, каменные, деревянные'],
  ['1.2', '1,2 — бетонные ≤ 1600 кг/м³, слои заводского изготовления'],
  ['1.3', '1,3 — изоляционные, выравнивающие, отделочные слои на площадке']
];
var DEFAULT_LOADS = {
  layers: [
    { name: 'Монолитная железобетонная плита', t: '200', w: '25', direct: '', gf: '1.1' },
    { name: 'Стяжка из цементно-песчаного раствора', t: '50', w: '18', direct: '', gf: '1.3' },
    { name: 'Звукоизоляция', t: '20', w: '1.5', direct: '', gf: '1.3' },
    { name: 'Покрытие пола', t: '', w: '', direct: '0.15', gf: '1.2' }
  ],
  live: 'flat', liveVal: '1.5', part: '0.5', partGf: '1.3', B: '6', bb: '300', hr: '400', bw: '25', bgf: '1.1'
};

function loadsCalc(st) {
  var bad = {}, rows = [], gN = 0, gD = 0;
  st.layers.forEach(function (l, i) {
    var dir = String(l.direct).trim() !== '' ? num(l.direct) : NaN;
    var n = isFinite(dir) ? dir : num(l.t) / 1000 * num(l.w);
    var gf = num(l.gf);
    if (!(n >= 0)) { bad['l' + i] = 1; n = 0; }
    rows.push({ name: l.name || 'Слой ' + (i + 1), t: isFinite(dir) ? '' : l.t, w: isFinite(dir) ? '' : l.w, n: n, gf: gf, d: n * gf });
    gN += n; gD += n * gf;
  });
  var pos = LIVE_83.filter(function (p) { return p[0] === st.live; })[0] || LIVE_83[0];
  var pN = num(st.liveVal);
  if (!(pN >= 0)) { bad.liveVal = 1; pN = 0; }
  var pGf = pN < 2.0 ? 1.3 : 1.2;
  var pK = pos[3];
  var part = num(st.part), partGf = num(st.partGf);
  if (!(part >= 0)) { bad.part = 1; part = 0; }
  var B = num(st.B);
  if (!(B > 0)) bad.B = 1;
  var bb = num(st.bb) || 0, hr = num(st.hr) || 0, bw = num(st.bw) || 0, bgf = num(st.bgf);
  var ribN = bb / 1000 * hr / 1000 * bw, ribD = ribN * bgf;
  var area = { n: gN + part + pN, d: gD + part * partGf + pN * pGf, l: gN + part + pK * pN };
  var line = B > 0 ? { n: area.n * B + ribN, d: area.d * B + ribD, l: area.l * B + ribN,
                       g: (gN + part) * B + ribN, p: pN * B } : null;
  return { bad: bad, rows: rows, gN: gN, gD: gD, pos: pos, pN: pN, pGf: pGf, pK: pK, part: part, partGf: partGf,
           B: B, bb: bb, hr: hr, bw: bw, bgf: bgf, ribN: ribN, ribD: ribD, area: area, line: line };
}

function initLoads() {
  var KEY = 'calc:loads', st;
  var params = new URLSearchParams(location.search);
  try { st = params.has('data') ? JSON.parse(params.get('data')) : null; } catch (e) { st = null; }
  if (!st) st = storeGet(KEY);
  if (!st || !st.layers) st = JSON.parse(JSON.stringify(DEFAULT_LOADS));
  var last = null;

  // Поля, не входящие в список слоёв
  var SCALARS = ['live', 'liveVal', 'part', 'partGf', 'B', 'bb', 'hr', 'bw', 'bgf'];
  $('live').innerHTML = LIVE_83.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + (isFinite(p[2]) ? ' — ' + fmt(p[2], 1) + ' кПа' : '') + '</option>'; }).join('');
  SCALARS.forEach(function (id) { if (st[id] !== undefined) setVal(id, st[id]); });

  function gfOptions(v) {
    return GF_71.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === String(v) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }
  function layerHtml(l, i) {
    var id = 'ly' + i;
    return '<div class="layer" data-i="' + i + '">' +
      '<div class="fld wide"><label for="' + id + 'n">Слой ' + (i + 1) + '</label><input id="' + id + 'n" data-k="name" type="text" value="' + Doc.esc(l.name) + '"></div>' +
      '<div class="fld"><label for="' + id + 't">Толщина, мм</label><input id="' + id + 't" data-k="t" type="number" inputmode="decimal" min="0" value="' + Doc.esc(l.t) + '"></div>' +
      '<div class="fld"><label for="' + id + 'w">Уд. вес, кН/м³</label><input id="' + id + 'w" data-k="w" type="number" inputmode="decimal" min="0" step="0.1" value="' + Doc.esc(l.w) + '"></div>' +
      '<div class="fld"><label for="' + id + 'd">или нагрузка, кПа</label><input id="' + id + 'd" data-k="direct" type="number" inputmode="decimal" min="0" step="0.01" value="' + Doc.esc(l.direct) + '"></div>' +
      '<div class="fld wide"><label for="' + id + 'g">γf по табл. 7.1</label><select id="' + id + 'g" data-k="gf">' + gfOptions(l.gf) + '</select></div>' +
      '<button type="button" class="btn-sec" data-del="' + i + '" aria-label="Удалить слой ' + (i + 1) + '">Удалить</button></div>';
  }
  function drawLayers() { $('layers').innerHTML = st.layers.map(layerHtml).join(''); }

  function save() { storeSet(KEY, st); }

  function render() {
    SCALARS.forEach(function (id) { st[id] = getVal(id); });
    var r = loadsCalc(st);
    last = r;
    save();
    // Подсветка ошибок в слоях
    Array.prototype.forEach.call(document.querySelectorAll('.layer'), function (el) {
      var bad = !!r.bad['l' + el.getAttribute('data-i')];
      el.querySelectorAll('input[type=number]').forEach(function (inp) { inp.classList.toggle('bad', bad && inp.value !== ''); });
    });
    markBad(['liveVal', 'part', 'B'], r.bad);
    var t = '<div class="scroll"><table><thead><tr><th>Нагрузка</th><th>Нормативная, кПа</th><th>γf</th><th>Расчётная, кПа</th></tr></thead><tbody>';
    r.rows.forEach(function (x) {
      t += '<tr><td style="white-space:normal">' + Doc.esc(x.name) + (x.t ? ' (' + fmt(num(x.t), 0) + ' мм × ' + fmt(num(x.w), 1) + ' кН/м³)' : '') + '</td><td>' +
        fmt(x.n, 3) + '</td><td>' + fmt(x.gf, 2) + '</td><td>' + fmt(x.d, 3) + '</td></tr>';
    });
    t += '<tr class="on"><td>Итого постоянная</td><td>' + fmt(r.gN, 3) + '</td><td></td><td>' + fmt(r.gD, 3) + '</td></tr>';
    t += '<tr><td style="white-space:normal">Перегородки (п. 8.2.2)</td><td>' + fmt(r.part, 3) + '</td><td>' + fmt(r.partGf, 2) + '</td><td>' + fmt(r.part * r.partGf, 3) + '</td></tr>';
    t += '<tr><td style="white-space:normal">Полезная: ' + Doc.esc(r.pos[1]) + '</td><td>' + fmt(r.pN, 3) + '</td><td>' + fmt(r.pGf, 2) + '</td><td>' + fmt(r.pN * r.pGf, 3) + '</td></tr>';
    t += '<tr class="on"><td>Всего на 1 м² перекрытия</td><td>' + fmt(r.area.n, 3) + '</td><td></td><td>' + fmt(r.area.d, 3) + '</td></tr>';
    t += '</tbody></table></div>';
    $('out-table').innerHTML = t;

    var o = '<div class="big-row">' +
      '<div class="big"><div class="cap">Расчётная, на 1 м²</div><div class="val">' + fmt(r.area.d, 2) + ' <small>кПа</small></div></div>' +
      '<div class="big"><div class="cap">Нормативная полная</div><div class="val">' + fmt(r.area.n, 2) + ' <small>кПа</small></div></div>' +
      '<div class="big"><div class="cap">Для прогиба</div><div class="val">' + fmt(r.area.l, 2) + ' <small>кПа</small></div></div></div>';
    o += '<div class="hint">Для прогиба: постоянная, перегородки и ' + (r.pK === 1 ? 'полезная полностью (для чердаков пониженное значение равно нормативному)' : 'полезная с коэффициентом 0,35') + ' — по табл. Д.1 и п. 8.2.3 СП 20.13330.2016.</div>';
    if (r.line) {
      o += '<h3 style="font-size:16px; margin-top:6px">На балку с грузовой полосой ' + fmt(r.B, 2) + ' м</h3>';
      o += rowsBox([
        ['Собственный вес ребра балки', fmt(r.ribN, 3) + ' кН/м (нормативный), γf = ' + fmt(r.bgf, 2)],
        ['Расчётная погонная q', fmt(r.line.d, 2) + ' кН/м'],
        ['Нормативная полная qn', fmt(r.line.n, 2) + ' кН/м'],
        ['Для прогиба qn,l', fmt(r.line.l, 2) + ' кН/м']
      ]);
      var toReinf = 'armirovanie-balki.html?loadType=q&q=' + fmt(r.line.d, 2).replace(',', '.');
      var gPass = r.pK === 1 ? r.line.g + r.line.p : r.line.g, pPass = r.pK === 1 ? 0 : r.line.p;
      var toDefl = 'progib-balki.html?loadType=q&g=' + gPass.toFixed(2) + '&p=' + pPass.toFixed(2) + '&s=0';
      o += '<div class="actions"><a class="btn" href="' + toReinf + '">В армирование балки</a><a class="btn-sec" href="' + toDefl + '">В прогиб балки</a></div>';
      o += '<div class="hint">В армирование переносится расчётная нагрузка q, в прогиб — нормативные постоянная (с перегородками и ребром) и полезная нагрузки; остальные данные балки сохраняются.</div>';
    }
    $('out-result').innerHTML = o;
  }

  drawLayers();
  $('layers').addEventListener('input', function (e) {
    var row = e.target.closest('.layer'), k = e.target.getAttribute('data-k');
    if (!row || !k) return;
    st.layers[+row.getAttribute('data-i')][k] = e.target.value;
    render();
  });
  $('layers').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]');
    if (!b) return;
    st.layers.splice(+b.getAttribute('data-del'), 1);
    drawLayers(); render();
  });
  $('add-layer').addEventListener('click', function () {
    st.layers.push({ name: '', t: '', w: '', direct: '', gf: '1.3' });
    drawLayers(); render();
    var ins = document.querySelectorAll('.layer input[data-k="name"]');
    if (ins.length) ins[ins.length - 1].focus();
  });
  $('live').addEventListener('change', function () {
    var p = LIVE_83.filter(function (x) { return x[0] === $('live').value; })[0];
    if (p && isFinite(p[2])) $('liveVal').value = p[2];
    render();
  });
  $('form').addEventListener('input', render);
  $('share').addEventListener('click', function () {
    var link = pageUrl() + '?data=' + encodeURIComponent(JSON.stringify(st));
    var done = function (ok) { $('share-msg').textContent = ok ? 'Ссылка скопирована. По ней откроется этот же сбор нагрузок.' : 'Скопируйте ссылку: ' + link; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });
  $('reset').addEventListener('click', function () { storeDel(KEY); location.href = pageUrl(); });
  setupReport(function () { return loadsReport(last, reportMeta()); }, function () { return 'Сбор нагрузок'; });
  render();
}

function loadsReport(r, meta) {
  if (!r) return null;
  var B = [];
  B.push({ kind: 'h1', text: '1. Постоянные нагрузки' });
  B.push({ kind: 'p', text: 'Нормативная нагрузка от слоя: g = t·γ. Коэффициенты надёжности по нагрузке γf — по табл. 7.1 СП 20.13330.2016.' });
  B.push({ kind: 'table', head: ['Наименование', 't, мм', 'γ, кН/м³', 'gн, кПа', 'γf', 'g, кПа'], widths: [3555, 900, 1100, 1300, 1000, 1500],
    rows: r.rows.map(function (x) { return [x.name, x.t ? fmt(num(x.t), 0) : '—', x.w ? fmt(num(x.w), 1) : '—', fmt(x.n, 3), fmt(x.gf, 2), fmt(x.d, 3)]; })
      .concat([['Итого постоянная', '', '', fmt(r.gN, 3), '', fmt(r.gD, 3)]]) });
  B.push({ kind: 'h1', text: '2. Временные нагрузки' });
  B.push({ kind: 'p', text: 'Перегородки: равномерно распределённая нагрузка ' + fmt(r.part, 2) + ' кПа (не менее 0,5 кПа по п. 8.2.2), γf = ' + fmt(r.partGf, 2) + ', расчётная ' + fmt(r.part * r.partGf, 3) + ' кПа.' });
  B.push({ kind: 'p', text: 'Полезная нагрузка по табл. 8.3: ' + r.pos[1] + ', нормативное значение ' + fmt(r.pN, 2) + ' кПа, γf = ' + fmt(r.pGf, 1) +
    ' (1,3 при значении менее 2,0 кПа, 1,2 — при 2,0 кПа и более), расчётное ' + fmt(r.pN * r.pGf, 3) + ' кПа.' });
  B.push({ kind: 'h1', text: '3. Итоговые нагрузки на 1 м² перекрытия' });
  B.push({ kind: 'kv', rows: [
    ['Расчётная полная', fmt(r.area.d, 3) + ' кПа'],
    ['Нормативная полная', fmt(r.area.n, 3) + ' кПа'],
    ['Нормативная для прогиба (постоянная, перегородки, ' + (r.pK === 1 ? 'полезная полностью' : '0,35 полезной') + ')', fmt(r.area.l, 3) + ' кПа']
  ] });
  if (r.line) {
    B.push({ kind: 'h1', text: '4. Погонная нагрузка на балку' });
    B.push({ kind: 'p', text: 'Ширина грузовой полосы ' + fmt(r.B, 2) + ' м. Собственный вес ребра балки ' + fmt(r.bb, 0) + ' × ' + fmt(r.hr, 0) + ' мм при γ = ' + fmt(r.bw, 1) +
      ' кН/м³: ' + fmt(r.ribN, 3) + ' кН/м, γf = ' + fmt(r.bgf, 2) + '.' });
    B.push({ kind: 'kv', rows: [
      ['Расчётная q = ' + fmt(r.area.d, 3) + '·' + fmt(r.B, 2) + ' + ' + fmt(r.ribD, 3), fmt(r.line.d, 2) + ' кН/м'],
      ['Нормативная полная qn', fmt(r.line.n, 2) + ' кН/м'],
      ['Нормативная для прогиба qn,l', fmt(r.line.l, 2) + ' кН/м']
    ] });
  }
  return { title: 'Сбор нагрузок на перекрытие', meta: meta, blocks: B };
}

/* =====================================================================
   Продавливание плиты колонной (средняя колонна), СП 63.13330.2018, 8.1.46–8.1.52
   ===================================================================== */
function punchCalc(s) {
  var bad = {};
  var h = num(s.h), a = num(s.ax), ca = num(s.colA), cb = num(s.colB), F = num(s.F);
  var Ma = Math.abs(num0(s.Ma)), Mb = Math.abs(num0(s.Mb));
  if (!(h > 0)) bad.h = 1;
  if (!(a > 0) || !(a < h)) bad.ax = 1;
  if (!(ca > 0)) bad.colA = 1;
  if (!(cb > 0)) bad.colB = 1;
  if (!(F > 0)) bad.F = 1;
  if (!isFinite(Ma)) bad.Ma = 1;
  if (!isFinite(Mb)) bad.Mb = 1;
  var conc = findConc(s.concrete), Rbt = conc[2] * num(s.gb1);
  var useSw = s.useSw === '1';
  var out = { bad: bad, ok: false, conc: conc, Rbt: Rbt, useSw: useSw };
  if (Object.keys(bad).length) return out;
  var h0 = h - a, La = ca + h0, Lb = cb + h0;
  var u = 2 * (La + Lb);
  var Fb = Rbt * u * h0;                                    // Н
  var Wa = La * Lb + La * La / 3, Wb = La * Lb + Lb * Lb / 3; // мм², момент в плоскости стороны a и b
  var Mba = Rbt * Wa * h0, Mbb = Rbt * Wb * h0;              // Н·мм
  var qsw = 0, Fsw = 0, Mswa = 0, Mswb = 0, swNote = '', Asw = 0, swCounted = false;
  if (useSw) {
    var dsw = num(s.pdsw), k = num(s.pk), sw = num(s.psw), Rsw = RSW[s.pswClass] || 280;
    if (!(k >= 1) || k !== Math.floor(k)) bad.pk = 1;
    if (!(sw > 0)) bad.psw = 1;
    if (!bad.pk && !bad.psw) {
      Asw = k * Math.PI * dsw * dsw / 4;
      qsw = Rsw * Asw / sw;
      Fsw = 0.8 * qsw * u;
      swCounted = Fsw >= 0.25 * Fb;
      if (!swCounted) { swNote = 'Fsw,ult < 0,25·Fb,ult — поперечная арматура в расчёте не учитывается.'; Fsw = 0; }
      // Msw,ult = 0,8·qsw·Wsw, Wsw принимается равным Wb (п. 8.1.52)
      Mswa = swCounted ? 0.8 * qsw * Wa : 0;
      Mswb = swCounted ? 0.8 * qsw * Wb : 0;
      out.Rsw = Rsw; out.dsw = dsw; out.k = k; out.sw = sw;
    }
  }
  var Fult = Math.min(Fb + Fsw, 2 * Fb);
  var Maul = Math.min(Mba + Mswa, 2 * Mba), Mbul = Math.min(Mbb + Mswb, 2 * Mbb);
  var Fn = F * 1000, Man = 0.5 * Ma * 1e6, Mbn = 0.5 * Mb * 1e6;   // половина сосредоточенных моментов
  var kF = Fn / Fult, kM = Man / Maul + Mbn / Mbul, kMused = Math.min(kM, 0.5 * kF);
  var util = kF + kMused;
  return { bad: bad, ok: true, conc: conc, Rbt: Rbt, useSw: useSw, h: h, a: a, h0: h0, ca: ca, cb: cb, La: La, Lb: Lb, u: u,
           F: F, Ma: Ma, Mb: Mb, Fb: Fb, Wa: Wa, Wb: Wb, Mba: Mba, Mbb: Mbb, qsw: qsw, Asw: Asw, Fsw: Fsw, swCounted: swCounted,
           swNote: swNote, Mswa: Mswa, Mswb: Mswb, Fult: Fult, Maul: Maul, Mbul: Mbul, kF: kF, kM: kM, kMused: kMused, util: util,
           pass: util <= 1, Rsw: out.Rsw, dsw: out.dsw, k: out.k, sw: out.sw };
}

function punchSvg(r) {
  var maxL = Math.max(r.La, r.Lb), k = 240 / maxL, pad = 40;
  var W = r.La * k + 2 * pad, H = r.Lb * k + 2 * pad, cx = W / 2, cy = H / 2;
  var o = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W) + '" height="' + Math.round(H + 20) + '" viewBox="0 0 ' + r1(W) + ' ' + r1(H + 20) + '" role="img" aria-label="План: колонна и расчётный контур">';
  o += '<rect x="' + r1(cx - r.La * k / 2) + '" y="' + r1(cy - r.Lb * k / 2) + '" width="' + r1(r.La * k) + '" height="' + r1(r.Lb * k) + '" fill="#E9EEF5" stroke="#1F4FD8" stroke-width="2" stroke-dasharray="7 5"/>';
  o += '<rect x="' + r1(cx - r.ca * k / 2) + '" y="' + r1(cy - r.cb * k / 2) + '" width="' + r1(r.ca * k) + '" height="' + r1(r.cb * k) + '" fill="#5B6673" stroke="#15202B" stroke-width="2"/>';
  o += '<text x="' + r1(cx) + '" y="' + r1(cy - r.Lb * k / 2 - 10) + '" text-anchor="middle" fill="#47525E">a + h₀ = ' + fmt(r.La, 0) + '</text>';
  o += '<text transform="translate(' + r1(cx + r.La * k / 2 + 16) + ' ' + r1(cy) + ') rotate(-90)" text-anchor="middle" fill="#47525E">b + h₀ = ' + fmt(r.Lb, 0) + '</text>';
  o += '<text x="' + r1(cx) + '" y="' + r1(H + 10) + '" text-anchor="middle" fill="#47525E">колонна ' + fmt(r.ca, 0) + ' × ' + fmt(r.cb, 0) + ', u = ' + fmt(r.u, 0) + ' мм</text>';
  return o + '</svg>';
}

function initPunch() {
  var IDS = ['h', 'ax', 'colA', 'colB', 'F', 'Ma', 'Mb', 'concrete', 'gb1', 'useSw', 'pswClass', 'pdsw', 'pk', 'psw'];
  initState('punch', IDS);
  setupShare('punch', IDS);
  var last = null;
  function resultHtml(r) {
    if (!r.ok) return '<div class="alert">Проверьте данные: толщина, размеры колонны и сила должны быть больше нуля, расстояние a — меньше толщины плиты.</div>';
    var o = '<div class="verdict ' + (r.pass ? 'yes' : 'no') + '">' + (r.pass ? ICON_OK : ICON_BAD) +
      '<div><div class="v">' + (r.pass ? 'Прочность обеспечена' : 'Прочность не обеспечена') + '</div><div class="mono">коэффициент использования ' + fmt(r.util, 3) + (r.pass ? ' ≤ 1' : ' > 1') + '</div></div></div>';
    var rows = [
      ['h₀ = h − a', fmt(r.h0, 0) + ' мм'],
      ['Периметр контура u = 2(a + h₀ + b + h₀)', fmt(r.u, 0) + ' мм'],
      ['Rbt с учётом γb1', fmt(r.Rbt, 3) + ' МПа'],
      ['Fb,ult = Rbt·u·h₀', fmt(r.Fb / 1000, 1) + ' кН']
    ];
    if (r.useSw) {
      rows.push(['qsw = Rsw·Asw / sw', fmt(r.qsw, 1) + ' Н/мм']);
      rows.push(['Fsw,ult = 0,8·qsw·u', r.swCounted ? fmt(r.Fsw / 1000, 1) + ' кН' : 'не учитывается']);
    }
    rows.push(['Fult (не более 2Fb,ult)', fmt(r.Fult / 1000, 1) + ' кН']);
    rows.push(['F / Fult', fmt(r.kF, 3)]);
    if (r.Ma || r.Mb) {
      rows.push(['Wb в плоскости a / b', fmt(r.Wa / 100, 0) + ' / ' + fmt(r.Wb / 100, 0) + ' см²']);
      rows.push(['Mult в плоскости a / b', fmt(r.Maul / 1e6, 1) + ' / ' + fmt(r.Mbul / 1e6, 1) + ' кН·м']);
      rows.push(['Σ 0,5Mloc / Mult', fmt(r.kM, 3) + (r.kM > 0.5 * r.kF ? ', принято 0,5·F/Fult = ' + fmt(r.kMused, 3) : '')]);
    }
    o += rowsBox(rows);
    if (r.swNote) o += '<div class="alert">' + r.swNote + '</div>';
    return o;
  }
  function render() {
    var s = readForm(IDS), r = punchCalc(s);
    last = { s: s, r: r };
    $('grp-psw').hidden = s.useSw !== '1';
    markBad(IDS, r.bad);
    $('out-plan').innerHTML = r.ok ? '<div class="sect-wrap">' + punchSvg(r) + '</div><div class="hint" style="text-align:center">Пунктир — расчётный контур на расстоянии 0,5h₀ от граней колонны.</div>' :
      '<div class="wait" style="text-align:center">План появится, когда данные заданы корректно.</div>';
    $('out-result').innerHTML = resultHtml(r);
  }
  setupReport(function () { return punchReport(last, reportMeta()); }, function () { return 'Продавливание'; });
  $('form').addEventListener('input', render);
  render();
}

function punchReport(last, meta) {
  if (!last || !last.r.ok) return null;
  var r = last.r, s = last.s, B = [];
  B.push({ kind: 'h1', text: '1. Исходные данные' });
  var rows = [
    ['Плита', 'толщина h = ' + fmt(r.h, 0) + ' мм, a = ' + fmt(r.a, 0) + ' мм до центра тяжести растянутой арматуры'],
    ['Колонна (средняя)', fmt(r.ca, 0) + ' × ' + fmt(r.cb, 0) + ' мм'],
    ['Сосредоточенная сила F', fmt(r.F, 2) + ' кН'],
    ['Сосредоточенные моменты Mloc в плоскости сторон a / b', fmt(r.Ma, 2) + ' / ' + fmt(r.Mb, 2) + ' кН·м'],
    ['Бетон', 'тяжёлый ' + r.conc[0] + ', Rbt = ' + fmt(r.conc[2], 2) + ' МПа, γb1 = ' + fmt(num(s.gb1), 1)]
  ];
  if (r.useSw) rows.push(['Поперечная арматура', s.pswClass + ' Ø' + fmt(r.dsw, 0) + ', стержней в полосе ±0,5h₀: ' + fmt(r.k, 0) + ', шаг вдоль контура ' + fmt(r.sw, 0) + ' мм']);
  B.push({ kind: 'kv', rows: rows });
  B.push({ kind: 'h1', text: '2. Расчёт' });
  B.push({ kind: 'p', text: 'Расчёт на продавливание по пп. 8.1.46–8.1.52 СП 63.13330.2018. Расчётный контур — на расстоянии 0,5h₀ от граней колонны.' });
  B.push({ kind: 'p', text: 'h₀ = ' + fmt(r.h, 0) + ' − ' + fmt(r.a, 0) + ' = ' + fmt(r.h0, 0) + ' мм; u = 2·(' + fmt(r.La, 0) + ' + ' + fmt(r.Lb, 0) + ') = ' + fmt(r.u, 0) + ' мм.' });
  B.push({ kind: 'p', text: 'Fb,ult = Rbt·u·h₀ = ' + fmt(r.Rbt, 3) + '·' + fmt(r.u, 0) + '·' + fmt(r.h0, 0) + ' = ' + fmt(r.Fb / 1000, 1) + ' кН.' });
  if (r.useSw) {
    B.push({ kind: 'p', text: 'qsw = Rsw·Asw / sw = ' + fmt(r.Rsw, 0) + '·' + fmt(r.Asw, 1) + ' / ' + fmt(r.sw, 0) + ' = ' + fmt(r.qsw, 1) + ' Н/мм; Fsw,ult = 0,8·qsw·u = ' +
      fmt(0.8 * r.qsw * r.u / 1000, 1) + ' кН' + (r.swCounted ? '.' : ' < 0,25·Fb,ult — не учитывается.') });
  }
  B.push({ kind: 'p', text: 'Fult = ' + fmt(r.Fult / 1000, 1) + ' кН' + (r.useSw ? ' (не более 2Fb,ult)' : '') + '; F / Fult = ' + fmt(r.F, 2) + ' / ' + fmt(r.Fult / 1000, 1) + ' = ' + fmt(r.kF, 3) + '.' });
  if (r.Ma || r.Mb) {
    B.push({ kind: 'p', text: 'Момент сопротивления контура: Wb = La·Lb + La²/3 = ' + fmt(r.Wa / 100, 0) + ' см² в плоскости стороны a и Lb·La + Lb²/3 = ' + fmt(r.Wb / 100, 0) + ' см² в плоскости стороны b.' });
    B.push({ kind: 'p', text: 'Mb,ult = Rbt·Wb·h₀: ' + fmt(r.Maul / 1e6, 2) + ' и ' + fmt(r.Mbul / 1e6, 2) + ' кН·м. В расчёте учитывается половина сосредоточенных моментов: Σ 0,5Mloc / Mult = ' +
      fmt(r.kM, 3) + (r.kM > 0.5 * r.kF ? '; принимается не более 0,5·F/Fult = ' + fmt(r.kMused, 3) : '') + '.' });
  }
  B.push({ kind: 'check', text: 'F/Fult + ΣM/Mult = ' + fmt(r.kF, 3) + ' + ' + fmt(r.kMused, 3) + ' = ' + fmt(r.util, 3) + (r.pass ? ' ≤ 1 — прочность на продавливание обеспечена.' : ' > 1 — прочность на продавливание не обеспечена.'), pass: r.pass });
  var plan = svgFrom(punchSvg(r));
  return reportImg(plan, +plan.getAttribute('width'), +plan.getAttribute('height'), 'План: колонна и расчётный контур, мм')
    .then(function (img) {
      B.splice(4, 0, img);
      return { title: 'Расчёт плиты на продавливание', meta: meta, blocks: B };
    });
}

/* =====================================================================
   Анкеровка и нахлёст арматуры, СП 63.13330.2018, 10.3.24–10.3.31
   ===================================================================== */
function anchorCalc(s) {
  var bad = {};
  var steel = findSteel(s.steel), d = num(s.d), conc = findConc(s.concrete);
  var Rbt = conc[2] * num(s.gb1), Rs = steel[1];
  var ratio = num(s.ratio);
  if (!(ratio > 0) || ratio > 1) bad.ratio = 1;
  var out = { bad: bad, ok: false };
  if (bad.ratio || !(d > 0)) return out;
  var eta1 = steel[0] === 'A240' ? 1.5 : 2.5;
  var eta2 = d <= 32 ? 1.0 : 0.9;
  var Rbond = eta1 * eta2 * Rbt;
  var l0 = Rs * d / (4 * Rbond);
  var tension = s.state !== 'comp';
  var aAn = tension ? 1.0 : 0.75;
  var lanCalc = aAn * l0 * ratio;
  var lanMin = Math.max(0.3 * l0, 15 * d, 200);
  var lan = Math.max(lanCalc, lanMin);
  var full = s.share === '100' && tension;
  var aL = tension ? (full ? 2.0 : 1.2) : 0.9;
  var llCalc = aL * l0 * ratio;
  var llMin = Math.max(0.4 * aL * l0, 20 * d, 250);
  var ll = Math.max(llCalc, llMin);
  var up = function (x) { return Math.ceil(x / 10 - 1e-9) * 10; };
  return { bad: bad, ok: true, steel: steel, d: d, conc: conc, Rbt: Rbt, Rs: Rs, ratio: ratio, eta1: eta1, eta2: eta2, Rbond: Rbond, l0: l0,
           tension: tension, aAn: aAn, lanCalc: lanCalc, lanMin: lanMin, lan: lan, lanR: up(lan), full: full, aL: aL,
           llCalc: llCalc, llMin: llMin, ll: ll, llR: up(ll), gb1: num(s.gb1) };
}

function initAnchor() {
  var IDS = ['steel', 'd', 'concrete', 'gb1', 'state', 'ratio', 'share'];
  initState('anchor', IDS);
  setupShare('anchor', IDS);
  var last = null;
  function resultHtml(r) {
    if (!r.ok) return '<div class="alert">Отношение As,cal / As,ef должно быть больше 0 и не больше 1.</div>';
    var o = '<div class="big-row">' +
      '<div class="big"><div class="cap">Длина анкеровки lan</div><div class="val">' + fmt(r.lanR, 0) + ' <small>мм</small></div><div class="cap">' + fmt(r.lanR / r.d, 1) + 'd</div></div>' +
      '<div class="big"><div class="cap">Длина нахлёста ll</div><div class="val">' + fmt(r.llR, 0) + ' <small>мм</small></div><div class="cap">' + fmt(r.llR / r.d, 1) + 'd</div></div></div>';
    o += rowsBox([
      ['Rbt с учётом γb1', fmt(r.Rbt, 3) + ' МПа'],
      ['η₁ / η₂', fmt(r.eta1, 1) + ' / ' + fmt(r.eta2, 1)],
      ['Rbond = η₁·η₂·Rbt', fmt(r.Rbond, 3) + ' МПа'],
      ['l0,an = Rs·d / (4·Rbond)', fmt(r.l0, 1) + ' мм'],
      ['lan = ' + fmt(r.aAn, 2) + '·l0,an·' + fmt(r.ratio, 2), fmt(r.lanCalc, 1) + ' мм'],
      ['Минимум: 0,3l0,an; 15d; 200 мм', fmt(r.lanMin, 1) + ' мм'],
      ['ll = ' + fmt(r.aL, 1) + '·l0,an·' + fmt(r.ratio, 2), fmt(r.llCalc, 1) + ' мм'],
      ['Минимум: 0,4α·l0,an; 20d; 250 мм', fmt(r.llMin, 1) + ' мм']
    ]);
    o += '<div class="hint">Длины округлены вверх до 10 мм. Стыки считаются расположенными в одном сечении, если расстояние между их центрами меньше 1,3ll = ' + fmt(1.3 * r.llR, 0) + ' мм.</div>';
    if (r.steel[0] === 'A240') o += '<div class="hint">Гладкие стержни A240 в растянутой зоне анкеруются с крюками или петлями.</div>';
    if (!r.tension && $('share').value === '100') o += '<div class="hint">Для сжатых стержней коэффициент 0,9 принят независимо от доли стыкуемых стержней.</div>';
    return o;
  }
  function render() {
    var s = readForm(IDS), r = anchorCalc(s);
    last = { s: s, r: r };
    markBad(IDS, r.bad);
    $('out-result').innerHTML = resultHtml(r);
  }
  setupReport(function () { return anchorReport(last, reportMeta()); }, function () { return 'Анкеровка и нахлёст'; });
  $('form').addEventListener('input', render);
  render();
}

function anchorReport(last, meta) {
  if (!last || !last.r.ok) return null;
  var r = last.r, B = [];
  B.push({ kind: 'h1', text: '1. Исходные данные' });
  B.push({ kind: 'kv', rows: [
    ['Арматура', r.steel[0] + ' Ø' + fmt(r.d, 0) + ', Rs = ' + fmt(r.Rs, 0) + ' МПа'],
    ['Бетон', 'тяжёлый ' + r.conc[0] + ', Rbt = ' + fmt(r.conc[2], 2) + ' МПа, γb1 = ' + fmt(r.gb1, 1)],
    ['Работа стержня', r.tension ? 'растяжение' : 'сжатие'],
    ['As,cal / As,ef', fmt(r.ratio, 2)],
    ['Стыкуемых стержней в одном сечении', r.tension ? (r.full ? 'более 50 %' : 'не более 50 %') : '—']
  ] });
  B.push({ kind: 'h1', text: '2. Расчёт' });
  B.push({ kind: 'p', text: 'По пп. 10.3.24–10.3.31 СП 63.13330.2018.' });
  B.push({ kind: 'p', text: 'Сопротивление сцепления: Rbond = η₁·η₂·Rbt = ' + fmt(r.eta1, 1) + '·' + fmt(r.eta2, 1) + '·' + fmt(r.Rbt, 3) + ' = ' + fmt(r.Rbond, 3) + ' МПа.' });
  B.push({ kind: 'p', text: 'Базовая длина анкеровки: l0,an = Rs·d / (4·Rbond) = ' + fmt(r.Rs, 0) + '·' + fmt(r.d, 0) + ' / (4·' + fmt(r.Rbond, 3) + ') = ' + fmt(r.l0, 1) + ' мм.' });
  B.push({ kind: 'p', text: 'Длина анкеровки: lan = α·l0,an·As,cal/As,ef = ' + fmt(r.aAn, 2) + '·' + fmt(r.l0, 1) + '·' + fmt(r.ratio, 2) + ' = ' + fmt(r.lanCalc, 1) +
    ' мм; не менее 0,3l0,an, 15d и 200 мм, то есть ' + fmt(r.lanMin, 1) + ' мм. Принято lan = ' + fmt(r.lanR, 0) + ' мм (' + fmt(r.lanR / r.d, 1) + 'd).', bold: true });
  B.push({ kind: 'p', text: 'Длина нахлёста: ll = α·l0,an·As,cal/As,ef = ' + fmt(r.aL, 1) + '·' + fmt(r.l0, 1) + '·' + fmt(r.ratio, 2) + ' = ' + fmt(r.llCalc, 1) +
    ' мм; не менее 0,4α·l0,an, 20d и 250 мм, то есть ' + fmt(r.llMin, 1) + ' мм. Принято ll = ' + fmt(r.llR, 0) + ' мм (' + fmt(r.llR / r.d, 1) + 'd).', bold: true });
  B.push({ kind: 'p', text: 'Стыки считаются расположенными в одном расчётном сечении, если расстояние между их центрами меньше 1,3ll = ' + fmt(1.3 * r.llR, 0) + ' мм.' });
  return { title: 'Расчёт анкеровки и нахлёста арматуры', meta: meta, blocks: B };
}

(function () {
  var page = document.body.getAttribute('data-page');
  if (page === 'loads') initLoads();
  if (page === 'punch') initPunch();
  if (page === 'anchor') initAnchor();
})();
