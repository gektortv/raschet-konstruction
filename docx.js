'use strict';

/* =====================================================================
   Doc — общий генератор отчётов: предпросмотр (он же печать) и Word (.docx).
   Модель отчёта:
     { title, meta: [[подпись, значение], ...], blocks: [...] }
   Блоки:
     { kind: 'h1' | 'h2' | 'h3', text }
     { kind: 'p', text, bold, color, center }
     { kind: 'kv', rows: [[название, значение], ...] }          — таблица из двух столбцов
     { kind: 'table', head: [...], rows: [[...]], widths: [twip] }
     { kind: 'img', img: {bytes, mime, w, h, url}, caption }   — рисунки нумеруются сами
     { kind: 'check', text, pass }                             — вывод проверки, зелёный или красный
   ===================================================================== */
var Doc = (function () {
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var CONTENT_W = 9355;            // ширина текста, twip: A4, поля 30 / 15 мм
  var CONTENT_EMU = 9355 * 635;
  var MAX_IMG_H_EMU = 18 * 360000;
  var OK = '0B6B3A', BAD = 'B42318';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------- Предпросмотр ---------- */
  function previewHtml(m) {
    var o = '<h1>' + esc(m.title) + '</h1>', fig = 0;
    (m.meta || []).forEach(function (r) { if (r[1]) o += '<p class="meta"><b>' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</p>'; });
    m.blocks.forEach(function (b) {
      if (b.kind === 'h1') o += '<h2>' + esc(b.text) + '</h2>';
      else if (b.kind === 'h2') o += '<h3 class="grp">' + esc(b.text) + '</h3>';
      else if (b.kind === 'h3') o += '<h4>' + esc(b.text) + '</h4>';
      else if (b.kind === 'p') o += '<p' + (b.bold ? ' style="font-weight:700"' : '') + (b.center ? ' class="c"' : '') + '>' + esc(b.text) + '</p>';
      else if (b.kind === 'check') o += '<p class="res ' + (b.pass ? 'yes' : 'no') + '">' + esc(b.text) + '</p>';
      else if (b.kind === 'kv') {
        o += '<table class="kv"><tbody>' + b.rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
      } else if (b.kind === 'table') {
        o += '<div class="scroll"><table><thead><tr>' + b.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          b.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      } else if (b.kind === 'img') {
        fig++;
        o += '<figure><img src="' + b.img.url + '" alt=""></figure>';
        if (b.caption) o += '<p class="fcap">Рисунок ' + fig + ' — ' + esc(b.caption) + '</p>';
      }
    });
    return o;
  }

  /* ---------- OOXML ---------- */
  function run(text, o) {
    o = o || {};
    var rpr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
      (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }
  function para(content, o) {
    o = o || {};
    var ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') +
      (o.center ? '<w:jc w:val="center"/>' : (o.justify ? '<w:jc w:val="both"/>' : ''));
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
  var BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
    return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  }).join('');
  function tableXml(head, rows, widths) {
    var cols = (head || rows[0] || []).length;
    if (!widths) { widths = []; for (var i = 0; i < cols; i++) widths.push(Math.floor(CONTENT_W / cols)); }
    var cell = function (text, w, o) {
      return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E6ECF5"/>' : '') +
        '</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>' + (o.center ? '<w:jc w:val="center"/>' : '') + '</w:pPr>' + run(text, { b: o.b, sz: 20 }) + '</w:p></w:tc>';
    };
    var o = '<w:tbl><w:tblPr><w:tblW w:w="' + CONTENT_W + '" w:type="dxa"/><w:tblBorders>' + BORDERS + '</w:tblBorders><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
    if (head) o += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + head.map(function (h, i) { return cell(h, widths[i], { b: true, shade: true, center: true }); }).join('') + '</w:tr>';
    rows.forEach(function (r) {
      o += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + r.map(function (c, i) { return cell(c, widths[i], {}); }).join('') + '</w:tr>';
    });
    return o + '</w:tbl>' + para('', {});
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
    (m.meta || []).forEach(function (r) { if (r[1]) body += para(run(r[0] + ': ', { b: true }) + run(r[1])); });
    m.blocks.forEach(function (b) {
      if (b.kind === 'h1') body += para(run(b.text), { style: 'Heading1' });
      else if (b.kind === 'h2') body += para(run(b.text), { style: 'Heading2' });
      else if (b.kind === 'h3') body += para(run(b.text), { style: 'Heading3' });
      else if (b.kind === 'p') body += para(run(b.text, { b: b.bold, color: b.color }), { justify: !b.center, center: b.center });
      else if (b.kind === 'check') body += para(run(b.text, { b: true, color: b.pass ? OK : BAD }));
      else if (b.kind === 'kv') body += tableXml(null, b.rows, [5900, CONTENT_W - 5900]);
      else if (b.kind === 'table') body += tableXml(b.head, b.rows, b.widths);
      else if (b.kind === 'img') {
        n++;
        var ext = b.img.mime === 'image/jpeg' ? 'jpeg' : 'png', file = 'image' + n + '.' + ext, rid = 'rIdImg' + n;
        media.push({ name: 'word/media/' + file, data: b.img.bytes });
        rels.push('<Relationship Id="' + rid + '" Type="' + NS_R + '/image" Target="media/' + file + '"/>');
        var pxW = b.img.dispW || b.img.w, pxH = b.img.dispH || b.img.h;   // размер на листе, px при 96 dpi
        var cx = Math.min(CONTENT_EMU, pxW * 9525), cy = Math.round(cx * pxH / pxW);
        if (cy > MAX_IMG_H_EMU) { cx = Math.round(cx * MAX_IMG_H_EMU / cy); cy = MAX_IMG_H_EMU; }
        body += imagePara(rid, n, cx, cy);
        if (b.caption) body += para(run('Рисунок ' + n + ' — ' + b.caption), { style: 'Caption' });
      }
    });
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

  /* ---------- ZIP без сжатия ---------- */
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

  function download(m, name) {
    var blob = buildDocx(m), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(name || m.title || 'Отчёт').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  /* ---------- Чертёж SVG → PNG для отчёта ---------- */
  // svg — элемент на странице; w, h — размер на листе в px (96 dpi); рисуется с двойной чёткостью
  function svgImage(svg, w, h) {
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    clone.setAttribute('font-family', 'Consolas, "Courier New", monospace');
    clone.setAttribute('font-size', '12');
    var src = new XMLSerializer().serializeToString(clone);
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var k = 2, c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          blob.arrayBuffer().then(function (buf) {
            resolve({ bytes: new Uint8Array(buf), mime: 'image/png', w: c.width, h: c.height, dispW: w, dispH: h, url: URL.createObjectURL(blob) });
          });
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('svg')); };
      img.src = url;
    });
  }

  return { previewHtml: previewHtml, buildDocx: buildDocx, download: download, svgImage: svgImage, esc: esc };
})();
