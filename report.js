'use strict';

/* =====================================================================
   Отчёт по прогибам: элементы, картинки из расчётного комплекса,
   выгрузка в Word (.docx) и печать. Всё выполняется в браузере.
   Использует функции из app.js: $, num, fmt, limitSp20.
   ===================================================================== */
var Report = (function () {
  var items = [], seq = 0, imgSeq = 0, active = null;
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* ---------- Расчёт по элементу ---------- */
  function settings() {
    return { limit: $('limit').value, interp: $('interp').value, nLim: num($('nLim').value) };
  }

  function txtNum(v) { return String(v).trim().replace(/^-/, '').replace('.', ','); }
  function fmtDen(x) { return Math.abs(x - Math.round(x)) < 0.05 ? fmt(x, 0) : fmt(x, 1); }

  function evalItem(it, st) {
    var L = num(it.L), f = Math.abs(num(it.f));
    var Lc = it.cant ? 2 * L : L;
    var fu = NaN;
    if (L > 0) fu = st.limit === 'manual' ? Lc * 1000 / st.nLim : limitSp20(Lc, st.limit !== 'high', st.interp === 'den');
    var ok = L > 0 && isFinite(f) && String(it.f).trim() !== '' && fu > 0;
    return { L: L, Lc: Lc, f: f, fu: fu, ok: ok, pass: ok && f <= fu, den: Lc * 1000 / fu };
  }

  function shortName(it) {
    if (it.type === 'beam') {
      return (it.cant ? 'Консольная балка' : 'Балка') + (String(it.b).trim() && String(it.h).trim() ? ' ' + txtNum(it.b) + '×' + txtNum(it.h) + ' мм' : '');
    }
    return (it.cant ? 'Консоль плиты' : 'Плита') + (String(it.t).trim() ? ' t = ' + txtNum(it.t) + ' мм' : '');
  }

  function describe(it, r) {
    var t;
    if (it.type === 'beam') {
      t = (it.cant ? 'Консольная балка' : 'Балка') +
        (String(it.b).trim() && String(it.h).trim() ? ' сечением b × h = ' + txtNum(it.b) + ' × ' + txtNum(it.h) + ' мм' : '');
    } else {
      t = (it.cant ? 'Консоль плиты перекрытия' : 'Плита перекрытия') + (String(it.t).trim() ? ' толщиной ' + txtNum(it.t) + ' мм' : '');
    }
    if (r.L > 0) {
      t += it.cant ? ', вылет ' + fmt(r.L, 2) + ' м, расчётный пролёт l = 2 × ' + fmt(r.L, 2) + ' = ' + fmt(r.Lc, 2) + ' м'
                   : ', пролёт l = ' + fmt(r.L, 2) + ' м';
    }
    return t + '.';
  }

  // Строки текста для элемента: описание, прогибы, вывод
  function itemText(it, r) {
    if (!r.ok) return null;
    return {
      desc: describe(it, r),
      defl: 'Максимальный прогиб по результатам расчёта f = ' + txtNum(it.f) + ' мм. Предельный прогиб по табл. Д.1 СП 20.13330.2016: fu = l/' +
        fmtDen(r.den) + ' = ' + fmt(r.fu, 1) + ' мм.',
      verdict: 'f = ' + txtNum(it.f) + ' мм ' + (r.pass ? '≤' : '>') + ' fu = ' + fmt(r.fu, 1) + ' мм — требование по прогибу ' +
        (r.pass ? 'выполняется.' : 'не выполняется.')
    };
  }

  function basisText(st) {
    var t = 'Прогибы определены в расчётном комплексе от постоянных и длительных нагрузок (полезная нагрузка по табл. 8.3 — с коэффициентом 0,35, снеговая — с коэффициентом 0,5). ';
    if (st.limit === 'manual') return t + 'Предельный прогиб принят l/' + fmtDen(st.nLim) + '.';
    t += 'Предельные прогибы приняты по табл. Д.1 СП 20.13330.2016, поз. 2 (эстетико-психологические требования), для помещений высотой ' +
      (st.limit === 'high' ? 'более 6 м' : 'до 6 м включительно') + '. Для промежуточных пролётов применена линейная интерполяция ' +
      (st.interp === 'den' ? 'знаменателей n в l/n' : 'предельных прогибов') + '. Для консолей вместо l принят удвоенный вылет.';
    return t;
  }

  /* ---------- Модель отчёта, общая для предпросмотра и Word ---------- */
  function model() {
    var st = settings(), fig = 0, rows = [], blocks = [], lastGroup = null, bad = [];
    items.forEach(function (it, i) {
      var r = evalItem(it, st), txt = itemText(it, r);
      var group = String(it.group).trim();
      if (group && group !== lastGroup) blocks.push({ kind: 'h2', text: group });
      lastGroup = group;
      blocks.push({ kind: 'h3', text: (i + 1) + '. ' + shortName(it) });
      if (!txt) { blocks.push({ kind: 'p', text: 'Данные не заполнены: укажите пролёт и прогиб.', warn: true }); }
      else {
        blocks.push({ kind: 'p', text: txt.desc });
        blocks.push({ kind: 'p', text: txt.defl });
      }
      it.images.forEach(function (im) {
        fig++;
        blocks.push({ kind: 'img', img: im });
        blocks.push({ kind: 'cap', text: 'Рисунок ' + fig + ' — ' + (String(it.caption).trim() || 'Перемещения по оси Z, мм') });
      });
      if (txt) blocks.push({ kind: 'p', text: txt.verdict, bold: true, color: r.pass ? '0B6B3A' : 'B42318' });
      rows.push([String(i + 1), group || '—', shortName(it), r.ok ? fmt(r.Lc, 2) : '—', r.ok ? txtNum(it.f) : '—',
                 r.ok ? fmt(r.fu, 1) : '—', r.ok ? (r.pass ? 'выполняется' : 'не выполняется') : 'нет данных']);
      if (!r.pass) bad.push(i + 1);
    });
    var concl;
    if (!items.length) concl = 'Элементы для проверки не добавлены.';
    else if (!bad.length) concl = 'Требования по прогибам выполняются для всех проверенных элементов.';
    else concl = 'Требования по прогибам не выполняются или не проверены для элементов № ' + bad.join(', ') + '.';
    return {
      title: $('rep-title').value.trim() || 'Проверка прогибов',
      object: $('rep-object').value.trim(),
      author: $('rep-author').value.trim(),
      date: new Date().toLocaleDateString('ru-RU'),
      basis: basisText(st), blocks: blocks, rows: rows, concl: concl
    };
  }

  var HEAD = ['№', 'Этаж, раздел', 'Элемент', 'l, м', 'f, мм', 'fu, мм', 'Требование'];

  /* ---------- Предпросмотр (он же печатная форма) ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function previewHtml(m) {
    var o = '<h1>' + esc(m.title) + '</h1>';
    if (m.object) o += '<p><b>Объект:</b> ' + esc(m.object) + '</p>';
    if (m.author) o += '<p><b>Выполнил:</b> ' + esc(m.author) + '</p>';
    o += '<p><b>Дата:</b> ' + esc(m.date) + '</p>';
    o += '<h2>1. Результаты проверки</h2>';
    m.blocks.forEach(function (b) {
      if (b.kind === 'h2') o += '<h3 class="grp">' + esc(b.text) + '</h3>';
      else if (b.kind === 'h3') o += '<h4>' + esc(b.text) + '</h4>';
      else if (b.kind === 'p') o += '<p' + (b.bold ? ' class="res ' + (b.color === '0B6B3A' ? 'yes' : 'no') + '"' : (b.warn ? ' class="warn"' : '')) + '>' + esc(b.text) + '</p>';
      else if (b.kind === 'img') o += '<figure><img src="' + b.img.url + '" alt=""></figure>';
      else if (b.kind === 'cap') o += '<p class="fcap">' + esc(b.text) + '</p>';
    });
    if (!m.blocks.length) o += '<p class="warn">Добавьте хотя бы один элемент.</p>';
    o += '<h2>2. Сводная таблица</h2><div class="scroll"><table><thead><tr>' + HEAD.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>';
    m.rows.forEach(function (r) { o += '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; });
    o += '</tbody></table></div>';
    o += '<h2>3. Заключение</h2><p>' + esc(m.concl) + '</p>';
    return o;
  }

  /* ---------- Word (.docx): разметка OOXML и упаковка в ZIP без сжатия ---------- */
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var CONTENT_W = 9355;            // ширина текста, twip: A4, поля 30 / 15 мм
  var CONTENT_EMU = 9355 * 635;    // то же в EMU
  var MAX_IMG_H_EMU = 18 * 360000; // наибольшая высота рисунка 18 см

  function xe(s) { return esc(s); }

  function run(text, o) {
    o = o || {};
    var rpr = (o.b ? '<w:b/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r>';
  }
  function para(content, o) {
    o = o || {};
    var ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') + (o.center ? '<w:jc w:val="center"/>' : '') +
      (o.justify ? '<w:jc w:val="both"/>' : '');
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + content + '</w:p>';
  }
  function imagePara(rid, n, cx, cy) {
    return '<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + n + '" name="Рисунок ' + n + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  function tableXml(head, rows) {
    var widths = [500, 1600, 2455, 900, 1000, 1000, 1900];
    var cell = function (text, w, o) {
      return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E6ECF5"/>' : '') +
        '</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>' + (o.center ? '<w:jc w:val="center"/>' : '') + '</w:pPr>' + run(text, { b: o.b, sz: 20 }) + '</w:p></w:tc>';
    };
    var b = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    var o = '<w:tbl><w:tblPr><w:tblW w:w="' + CONTENT_W + '" w:type="dxa"/><w:tblBorders>' + b + '</w:tblBorders><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
    o += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + head.map(function (h, i) { return cell(h, widths[i], { b: true, shade: true, center: true }); }).join('') + '</w:tr>';
    rows.forEach(function (r) {
      o += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + r.map(function (c, i) { return cell(c, widths[i], { center: i === 0 || (i >= 3 && i <= 5) }); }).join('') + '</w:tr>';
    });
    return o + '</w:tbl>';
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="' + NS_W + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU" w:eastAsia="ru-RU" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="240"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
    '</w:styles>';

  function buildDocx(m) {
    var enc = new TextEncoder(), media = [], rels = [], body = '', n = 0;
    body += para(run(m.title), { style: 'Title' });
    if (m.object) body += para(run('Объект: ', { b: true }) + run(m.object));
    if (m.author) body += para(run('Выполнил: ', { b: true }) + run(m.author));
    body += para(run('Дата: ', { b: true }) + run(m.date));
    body += para(run('1. Результаты проверки'), { style: 'Heading1' });
    m.blocks.forEach(function (b) {
      if (b.kind === 'h2') body += para(run(b.text), { style: 'Heading2' });
      else if (b.kind === 'h3') body += para(run(b.text), { style: 'Heading3' });
      else if (b.kind === 'p') body += para(run(b.text, { b: b.bold, color: b.color || (b.warn ? 'B42318' : '') }), { justify: !b.bold });
      else if (b.kind === 'cap') body += para(run(b.text), { style: 'Caption' });
      else if (b.kind === 'img') {
        n++;
        var ext = b.img.mime === 'image/jpeg' ? 'jpeg' : 'png', file = 'image' + n + '.' + ext, rid = 'rIdImg' + n;
        media.push({ name: 'word/media/' + file, data: b.img.bytes });
        rels.push('<Relationship Id="' + rid + '" Type="' + NS_R + '/image" Target="media/' + file + '"/>');
        var cx = CONTENT_EMU, cy = Math.round(cx * b.img.h / b.img.w);
        if (cy > MAX_IMG_H_EMU) { cx = Math.round(cx * MAX_IMG_H_EMU / cy); cy = MAX_IMG_H_EMU; }
        if (b.img.w * 9525 < cx) { cx = b.img.w * 9525; cy = b.img.h * 9525; }   // мелкую картинку не растягиваем
        body += imagePara(rid, n, cx, cy);
      }
    });
    body += para(run('2. Сводная таблица'), { style: 'Heading1' });
    body += tableXml(HEAD, m.rows);
    body += para(run('3. Заключение'), { style: 'Heading1' });
    body += para(run(m.concl), { justify: true });

    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="' + NS_R + '/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>';
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="word/document.xml"/></Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode(types) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'word/document.xml', data: enc.encode(doc) },
      { name: 'word/styles.xml', data: enc.encode(STYLES) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) }
    ].concat(media));
  }

  // ZIP без сжатия: этого достаточно для .docx
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, d = new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: DOCX_MIME });
  }

  /* ---------- Картинки ---------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var keep = file.type === 'image/png' || file.type === 'image/jpeg';
        var done = function (blob, mime) {
          blob.arrayBuffer().then(function (buf) {
            resolve({ id: ++imgSeq, mime: mime, bytes: new Uint8Array(buf), url: keep ? url : URL.createObjectURL(blob), w: img.naturalWidth, h: img.naturalHeight });
          });
        };
        if (keep) { done(file, file.type); return; }
        var c = document.createElement('canvas');            // прочие форматы переводим в PNG
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(function (b) { URL.revokeObjectURL(url); done(b, 'image/png'); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  function addFiles(it, files) {
    var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    return Promise.all(list.map(function (f) { return loadImage(f).catch(function () { return null; }); })).then(function (imgs) {
      imgs.forEach(function (im) { if (im) it.images.push(im); });
      drawThumbs(it);
      refresh();
    });
  }

  /* ---------- Элементы на странице ---------- */
  function fieldHtml(it, key, label, attrs) {
    var id = 'it' + it.id + '-' + key;
    return '<div class="fld"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-f="' + key + '" ' + attrs + ' value="' + esc(it[key]) + '"></div>';
  }
  function itemHtml(it) {
    var id = 'it' + it.id;
    return '<div class="rep-item" data-id="' + it.id + '">' +
      '<div class="rep-item-h"><b class="rep-num"></b><button type="button" class="btn-sec" data-act="del">Удалить</button></div>' +
      '<div class="two">' + fieldHtml(it, 'group', 'Этаж или раздел', 'type="text" placeholder="например, 3-й этаж"') +
      '<div class="fld"><label for="' + id + '-type">Элемент</label><select id="' + id + '-type" data-f="type">' +
      '<option value="plate"' + (it.type === 'plate' ? ' selected' : '') + '>Плита перекрытия</option>' +
      '<option value="beam"' + (it.type === 'beam' ? ' selected' : '') + '>Балка</option></select></div></div>' +
      '<div class="two rep-plate">' + fieldHtml(it, 't', 'Толщина плиты, мм', 'type="number" inputmode="decimal" min="0"') + '<div></div></div>' +
      '<div class="two rep-beam">' + fieldHtml(it, 'b', 'Ширина b, мм', 'type="number" inputmode="decimal" min="0"') +
      fieldHtml(it, 'h', 'Высота h, мм', 'type="number" inputmode="decimal" min="0"') + '</div>' +
      '<div class="two">' + fieldHtml(it, 'L', it.cant ? 'Вылет консоли, м' : 'Пролёт l, м', 'type="number" inputmode="decimal" min="0" step="0.01"') +
      fieldHtml(it, 'f', 'Прогиб f, мм', 'type="number" inputmode="decimal" step="0.01"') + '</div>' +
      '<label class="chk"><input type="checkbox" data-f="cant"' + (it.cant ? ' checked' : '') + '> Консоль: вводится вылет, в расчёт идёт удвоенный</label>' +
      '<div class="fld"><label for="' + id + '-files">Картинки из расчётного комплекса</label>' +
      '<input id="' + id + '-files" type="file" accept="image/*" multiple data-f="files">' +
      '<div class="hint">Можно выбрать файлы, перетащить их сюда или вставить скриншот: щёлкните по полю этого элемента и нажмите Ctrl + V.</div></div>' +
      '<div class="thumbs"></div>' +
      fieldHtml(it, 'caption', 'Подпись к рисункам', 'type="text"') +
      '<div class="rep-res"></div></div>';
  }
  function itemEl(it) { return $('rep-items').querySelector('.rep-item[data-id="' + it.id + '"]'); }
  function findItem(el) { var box = el.closest('.rep-item'); if (!box) return null; var id = +box.getAttribute('data-id'); return items.filter(function (x) { return x.id === id; })[0] || null; }

  function drawThumbs(it) {
    var box = itemEl(it).querySelector('.thumbs');
    box.innerHTML = it.images.map(function (im, k) {
      return '<div class="thumb"><img src="' + im.url + '" alt="Рисунок ' + (k + 1) + '"><button type="button" class="btn-sec" data-act="rmimg" data-img="' + im.id + '" aria-label="Убрать картинку ' + (k + 1) + '">Убрать</button></div>';
    }).join('');
  }
  function syncType(it) {
    var el = itemEl(it);
    el.querySelector('.rep-plate').hidden = it.type !== 'plate';
    el.querySelector('.rep-beam').hidden = it.type !== 'beam';
    el.querySelector('label[for="it' + it.id + '-L"]').textContent = it.cant ? 'Вылет консоли, м' : 'Пролёт l, м';
  }

  function addItem(type, quiet) {
    var prev = items[items.length - 1];
    var it = { id: ++seq, type: type, group: prev ? prev.group : '', t: '', b: '', h: '', L: '', f: '', cant: false,
               caption: 'Перемещения по оси Z, мм', images: [] };
    items.push(it);
    $('rep-items').insertAdjacentHTML('beforeend', itemHtml(it));
    syncType(it);
    active = it;
    refresh();
    if (quiet) return;
    var first = itemEl(it).querySelector('input');
    if (first) first.focus();
  }

  /* ---------- Обновление ---------- */
  function refresh() {
    var st = settings();
    items.forEach(function (it, i) {
      var el = itemEl(it), r = evalItem(it, st);
      el.querySelector('.rep-num').textContent = 'Элемент ' + (i + 1);
      el.querySelector('.rep-res').innerHTML = !r.ok ? '<span class="cap">Укажите пролёт и прогиб.</span>'
        : '<span class="mono ' + (r.pass ? 'ok-t' : 'bad-t') + '">fu = l/' + fmtDen(r.den) + ' = ' + fmt(r.fu, 1) + ' мм — ' + (r.pass ? 'проходит' : 'не проходит') + '</span>';
    });
    $('rep-empty').hidden = items.length > 0;
    $('rep-preview').innerHTML = previewHtml(model());
  }

  function download() {
    var blob = buildDocx(model());
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ($('rep-title').value.trim() || 'Проверка прогибов').replace(/[\\/:*?"<>|]+/g, ' ') + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  function init() {
    var box = $('rep-items');
    box.addEventListener('input', function (e) {
      var it = findItem(e.target), f = e.target.getAttribute('data-f');
      if (!it || !f || f === 'files') return;
      it[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (f === 'type' || f === 'cant') syncType(it);
      refresh();
    });
    box.addEventListener('change', function (e) {
      var it = findItem(e.target);
      if (!it) return;
      if (e.target.getAttribute('data-f') === 'files') { addFiles(it, e.target.files).then(function () { e.target.value = ''; }); }
      if (e.target.getAttribute('data-f') === 'type') { it.type = e.target.value; syncType(it); refresh(); }
    });
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var it = findItem(btn);
      if (!it) return;
      if (btn.getAttribute('data-act') === 'del') {
        it.images.forEach(function (im) { URL.revokeObjectURL(im.url); });
        items = items.filter(function (x) { return x !== it; });
        itemEl(it).remove();
        if (active === it) active = items[items.length - 1] || null;
        refresh();
      } else if (btn.getAttribute('data-act') === 'rmimg') {
        var idImg = +btn.getAttribute('data-img');
        it.images = it.images.filter(function (im) { if (im.id === idImg) { URL.revokeObjectURL(im.url); return false; } return true; });
        drawThumbs(it); refresh();
      }
    });
    box.addEventListener('focusin', function (e) { var it = findItem(e.target); if (it) active = it; });
    box.addEventListener('dragover', function (e) { if (findItem(e.target)) { e.preventDefault(); } });
    box.addEventListener('drop', function (e) {
      var it = findItem(e.target);
      if (!it || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); active = it; addFiles(it, e.dataTransfer.files);
    });
    // Скриншот из буфера обмена — в элемент, с которым работали последним
    document.addEventListener('paste', function (e) {
      if (!active || !e.clipboardData) return;
      var files = [];
      Array.prototype.forEach.call(e.clipboardData.items || [], function (ci) { if (ci.kind === 'file' && /^image\//.test(ci.type)) files.push(ci.getAsFile()); });
      if (!files.length) return;
      e.preventDefault(); addFiles(active, files);
    });
    $('rep-add-plate').addEventListener('click', function () { addItem('plate'); });
    $('rep-add-beam').addEventListener('click', function () { addItem('beam'); });
    $('rep-meta').addEventListener('input', refresh);
    $('form').addEventListener('input', refresh);          // настройки предельного прогиба
    $('rep-docx').addEventListener('click', download);
    $('rep-print').addEventListener('click', function () { refresh(); window.print(); });
    addItem('plate', true);
  }

  return { init: init, _model: model, _build: buildDocx };
})();

if (document.body.getAttribute('data-page') === 'check') Report.init();
