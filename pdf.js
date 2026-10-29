'use strict';

/* =====================================================================
   Pdf — отчёт в PDF без внешних библиотек.
   Принимает ту же модель отчёта, что и Doc (docx.js), и раскладывает её на листы A4.
   Шрифт Liberation Serif (лицензия SIL OFL 1.1, папка fonts) встраивается целиком,
   текст остаётся текстом: его можно выделять и искать.
   ===================================================================== */
var Pdf = (function () {
  var MM = 72 / 25.4;                       // пунктов в миллиметре
  var PW = 210, PH = 297;                   // A4, мм
  var ML = 30, MR = 15, MT = 20, MB = 20;   // поля, мм
  var CW = PW - ML - MR;                    // ширина текста, мм
  var fontCache = null;

  /* ---------- Разбор TrueType: таблицы символов и ширины ---------- */
  function parseTTF(buf) {
    var dv = new DataView(buf), n = dv.getUint16(4), t = {};
    for (var i = 0; i < n; i++) {
      var o = 12 + 16 * i;
      var tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      t[tag] = dv.getUint32(o + 8);
    }
    var upm = dv.getUint16(t.head + 18);
    var bbox = [dv.getInt16(t.head + 36), dv.getInt16(t.head + 38), dv.getInt16(t.head + 40), dv.getInt16(t.head + 42)];
    var ascent = dv.getInt16(t.hhea + 4), descent = dv.getInt16(t.hhea + 6), nHM = dv.getUint16(t.hhea + 34);
    // cmap: Unicode BMP (3,1, формат 4) или полный (3,10, формат 12)
    var cm = t.cmap, nSub = dv.getUint16(cm + 2), sub4 = 0, sub12 = 0;
    for (var k = 0; k < nSub; k++) {
      var pid = dv.getUint16(cm + 4 + 8 * k), eid = dv.getUint16(cm + 6 + 8 * k), off = cm + dv.getUint32(cm + 8 + 8 * k);
      var fmt = dv.getUint16(off);
      if (pid === 3 && eid === 10 && fmt === 12) sub12 = off;
      if (pid === 3 && eid === 1 && fmt === 4) sub4 = off;
    }
    var cache = {};
    function gid(c) {
      if (cache[c] !== undefined) return cache[c];
      var g = 0;
      if (sub12) {
        var ng = dv.getUint32(sub12 + 12);
        for (var j = 0; j < ng; j++) {
          var p = sub12 + 16 + 12 * j, s = dv.getUint32(p), e = dv.getUint32(p + 4);
          if (c >= s && c <= e) { g = dv.getUint32(p + 8) + (c - s); break; }
        }
      } else if (sub4 && c <= 0xFFFF) {
        var seg = dv.getUint16(sub4 + 6) / 2;
        var ends = sub4 + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
        for (var q = 0; q < seg; q++) {
          if (dv.getUint16(ends + 2 * q) >= c) {
            var st = dv.getUint16(starts + 2 * q);
            if (c >= st) {
              var dl = dv.getInt16(deltas + 2 * q), ro = dv.getUint16(ranges + 2 * q);
              if (ro === 0) g = (c + dl) & 0xFFFF;
              else { g = dv.getUint16(ranges + 2 * q + ro + 2 * (c - st)); if (g) g = (g + dl) & 0xFFFF; }
            }
            break;
          }
        }
      }
      cache[c] = g;
      return g;
    }
    function adv(g) { return dv.getUint16(t.hmtx + 4 * Math.min(g, nHM - 1)); }
    return { buf: buf, upm: upm, bbox: bbox, ascent: ascent, descent: descent, gid: gid, adv: adv };
  }

  // Шрифты лежат рядом со страницей в font-regular.js и font-bold.js и подгружаются только при первом PDF.
  // Подключение через <script> работает и на сайте, и при открытии страницы из файла.
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Не загрузился файл шрифта ' + src.split('?')[0])); };
      document.head.appendChild(s);
    });
  }
  function b64ToBuf(b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }
  function loadFonts() {
    if (fontCache) return fontCache;
    var have = window.PDF_FONTS && window.PDF_FONTS.R && window.PDF_FONTS.B;
    fontCache = (have ? Promise.resolve() : Promise.all([loadScript('font-regular.js?v=8'), loadScript('font-bold.js?v=8')])).then(function () {
      return { R: parseTTF(b64ToBuf(window.PDF_FONTS.R)), B: parseTTF(b64ToBuf(window.PDF_FONTS.B)) };
    });
    fontCache.catch(function () { fontCache = null; });
    return fontCache;
  }

  /* ---------- Вспомогательное ---------- */
  function clean(s) { return String(s).replace(/⁻/g, '-').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hexColor(h) { h = h || '000000'; return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
  function n2(x) { return (Math.round(x * 100) / 100).toString(); }
  // Сжатие шрифта, если браузер умеет; иначе шрифт встраивается без сжатия
  function deflate(u8) {
    try {
      if (typeof CompressionStream === 'undefined' || !Blob.prototype.stream) return Promise.resolve(null);
      var s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  // Любая картинка → JPEG на белом фоне (DCTDecode встраивается в PDF как есть)
  function toJpeg(img) {
    return new Promise(function (resolve, reject) {
      var src = img.url || URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(im, 0, 0);
        c.toBlob(function (b) {
          b.arrayBuffer().then(function (buf) { resolve({ bytes: new Uint8Array(buf), w: c.width, h: c.height }); });
        }, 'image/jpeg', 0.92);
      };
      im.onerror = function () { reject(new Error('image')); };
      im.src = src;
    });
  }

  /* ---------- Раскладка на листы ---------- */
  function layout(m, F, images) {
    var pages = [], page, y;
    var used = { R: {}, B: {} };
    function newPage() { page = { ops: [], imgs: [] }; pages.push(page); y = MT; }
    function width(text, f, size) {
      var w = 0, font = F[f];
      for (var ch of text) w += font.adv(font.gid(ch.codePointAt(0)));
      return w / font.upm * size / MM;     // мм
    }
    function wrap(text, f, size, maxW) {
      var words = clean(text).split(' '), lines = [], cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (width(t, f, size) <= maxW || !cur) {
          if (!cur && width(w, f, size) > maxW) {          // слишком длинное слово режется
            var part = '';
            for (var ch of w) { if (width(part + ch, f, size) > maxW && part) { lines.push(part); part = ''; } part += ch; }
            cur = part;
          } else cur = t;
        } else { lines.push(cur); cur = w; }
      });
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    }
    function text(str, x, yTop, f, size, color) {
      var font = F[f], hex = '';
      for (var ch of str) { var g = font.gid(ch.codePointAt(0)); used[f][g] = ch; hex += ('000' + g.toString(16)).slice(-4); }
      var base = PH - (yTop + size / MM * 0.8);         // базовая линия
      var c = hexColor(color);
      page.ops.push(c[0] + ' ' + c[1] + ' ' + c[2] + ' rg BT /' + (f === 'B' ? 'F2' : 'F1') + ' ' + size + ' Tf 1 0 0 1 ' + n2(x * MM) + ' ' + n2(base * MM) + ' Tm <' + hex + '> Tj ET');
    }
    function lh(size) { return size / MM * 1.25; }
    function need(h) { if (y + h > PH - MB) newPage(); }
    function para(str, o) {
      o = o || {};
      var f = o.bold ? 'B' : 'R', size = o.size || 12, lines = wrap(str, f, size, o.maxW || CW), h = lh(size);
      lines.forEach(function (ln) {
        need(h);
        var x = ML;
        if (o.center) x = ML + (CW - width(ln, f, size)) / 2;
        text(ln, x, y, f, size, o.color);
        y += h;
      });
      y += o.after === undefined ? 2 : o.after;
    }
    function heading(str, size, before) {
      var h = lh(size) * wrap(str, 'B', size, CW).length;
      if (y > MT) y += before;
      need(h + lh(12) * 3);                                // заголовок не остаётся один внизу листа
      para(str, { bold: true, size: size, after: 2 });
    }
    function table(head, rows, widths) {
      var total = widths.reduce(function (s, w) { return s + w; }, 0);
      var cols = widths.map(function (w) { return w / total * CW; });
      var size = 10, pad = 1.3, h1 = lh(size);
      function rowH(cells, f) {
        return Math.max.apply(null, cells.map(function (c, i) { return wrap(String(c), f, size, cols[i] - 2 * pad).length; })) * h1 + 2 * pad;
      }
      function drawRow(cells, f, shade) {
        var h = rowH(cells, f), x = ML;
        cells.forEach(function (c, i) {
          var X = x * MM, Y = (PH - y - h) * MM, W = cols[i] * MM, H = h * MM;
          if (shade) page.ops.push('0.902 0.925 0.961 rg ' + n2(X) + ' ' + n2(Y) + ' ' + n2(W) + ' ' + n2(H) + ' re f');
          page.ops.push('0 0 0 RG 0.5 w ' + n2(X) + ' ' + n2(Y) + ' ' + n2(W) + ' ' + n2(H) + ' re S');
          wrap(String(c), f, size, cols[i] - 2 * pad).forEach(function (ln, k) {
            var tx = shade ? x + (cols[i] - width(ln, f, size)) / 2 : x + pad;
            text(ln, tx, y + pad + k * h1, f, size);
          });
          x += cols[i];
        });
        y += h;
      }
      if (head) { need(rowH(head, 'B') + rowH(rows[0] || head, 'R')); drawRow(head, 'B', true); }
      rows.forEach(function (r) {
        var h = rowH(r, 'R');
        if (y + h > PH - MB) { newPage(); if (head) drawRow(head, 'B', true); }
        drawRow(r, 'R', false);
      });
      y += 4;
    }

    newPage();
    para(m.title, { bold: true, size: 16, center: true, after: 5 });
    (m.meta || []).forEach(function (r) {
      if (!r[1]) return;
      var lab = r[0] + ': ', lw = width(lab, 'B', 12), lines = wrap(r[1], 'R', 12, CW - lw);
      lines.forEach(function (ln, k) {
        need(lh(12));
        if (k === 0) text(lab, ML, y, 'B', 12);
        text(ln, ML + lw, y, 'R', 12);
        y += lh(12);
      });
      y += 1.5;
    });
    var fig = 0;
    m.blocks.forEach(function (b, bi) {
      if (b.kind === 'h1') heading(b.text, 14, 5);
      else if (b.kind === 'h2') heading(b.text, 13, 3);
      else if (b.kind === 'h3') heading(b.text, 12, 2);
      else if (b.kind === 'p') para(b.text, { bold: b.bold, color: b.color, center: b.center });
      else if (b.kind === 'check') para(b.text, { bold: true, color: b.pass ? '0B6B3A' : 'B42318' });
      else if (b.kind === 'kv') table(null, b.rows, [5900, 3455]);
      else if (b.kind === 'table') table(b.head, b.rows, b.widths || b.head.map(function () { return 1; }));
      else if (b.kind === 'img') {
        fig++;
        var im = images[bi];
        var pxW = b.img.dispW || b.img.w, pxH = b.img.dispH || b.img.h;
        var w = Math.min(CW, pxW * 25.4 / 96), h = w * pxH / pxW;
        if (h > 180) { w = w * 180 / h; h = 180; }
        var capLines = b.caption ? wrap('Рисунок ' + fig + ' — ' + b.caption, 'R', 11, CW).length : 0;
        need(h + 2 + capLines * lh(11) + 2);
        var name = 'Im' + (page.imgs.length + 1) + 'p' + pages.length;
        page.imgs.push({ name: name, img: im });
        page.ops.push('q ' + n2(w * MM) + ' 0 0 ' + n2(h * MM) + ' ' + n2((ML + (CW - w) / 2) * MM) + ' ' + n2((PH - y - h) * MM) + ' cm /' + name + ' Do Q');
        y += h + 2;
        if (b.caption) para('Рисунок ' + fig + ' — ' + b.caption, { size: 11, center: true, after: 4 });
      }
    });
    // Номера страниц
    pages.forEach(function (p, i) {
      page = p;
      var s = 'Страница ' + (i + 1) + ' из ' + pages.length;
      text(s, ML + (CW - width(s, 'R', 9)) / 2, PH - MB + 8, 'R', 9, '5B6673');
    });
    return { pages: pages, used: used };
  }

  /* ---------- Сборка файла PDF ---------- */
  function build(L, F) {
    var enc = new TextEncoder(), objs = [], chunks = [];
    function add(parts) { objs.push(parts); return objs.length; }               // номер объекта
    function stream(dict, bytes) { return [enc.encode(dict.replace('%LEN%', bytes.length) + '\nstream\n'), bytes, enc.encode('\nendstream')]; }
    function fontObjs(f, key, fileBytes, compressed) {
      var font = F[f], k = 1000 / font.upm;
      var gids = Object.keys(L.used[f]).map(Number).sort(function (a, b) { return a - b; });
      var W = gids.map(function (g) { return g + ' [' + Math.round(font.adv(g) * k) + ']'; }).join(' ');
      var file = add(stream('<< /Length %LEN% /Length1 ' + font.buf.byteLength + (compressed ? ' /Filter /FlateDecode' : '') + ' >>', fileBytes));
      var desc = add([enc.encode('<< /Type /FontDescriptor /FontName /' + key + ' /Flags 6 /FontBBox [' + font.bbox.map(function (v) { return Math.round(v * k); }).join(' ') +
        '] /ItalicAngle 0 /Ascent ' + Math.round(font.ascent * k) + ' /Descent ' + Math.round(font.descent * k) + ' /CapHeight 660 /StemV 80 /FontFile2 ' + file + ' 0 R >>')]);
      var cid = add([enc.encode('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + key + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' +
        desc + ' 0 R /CIDToGIDMap /Identity /DW 1000 /W [' + W + '] >>')]);
      // ToUnicode: чтобы текст копировался и искался
      var bf = '', list = gids.filter(function (g) { return g; });
      for (var i = 0; i < list.length; i += 100) {
        var part = list.slice(i, i + 100);
        bf += part.length + ' beginbfchar\n' + part.map(function (g) {
          var ch = L.used[f][g], cp = ch.codePointAt(0), u;
          if (cp > 0xFFFF) { cp -= 0x10000; u = ('000' + (0xD800 + (cp >> 10)).toString(16)).slice(-4) + ('000' + (0xDC00 + (cp & 0x3FF)).toString(16)).slice(-4); }
          else u = ('000' + cp.toString(16)).slice(-4);
          return '<' + ('000' + g.toString(16)).slice(-4) + '> <' + u + '>';
        }).join('\n') + '\nendbfchar\n';
      }
      var cmap = enc.encode('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
        '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' + bf + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend');
      var tu = add(stream('<< /Length %LEN% >>', cmap));
      return add([enc.encode('<< /Type /Font /Subtype /Type0 /BaseFont /' + key + ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + tu + ' 0 R >>')]);
    }
    return Promise.all([deflate(new Uint8Array(F.R.buf)), deflate(new Uint8Array(F.B.buf))]).then(function (z) {
      var f1 = fontObjs('R', 'LiberationSerif', z[0] || new Uint8Array(F.R.buf), !!z[0]);
      var f2 = fontObjs('B', 'LiberationSerif-Bold', z[1] || new Uint8Array(F.B.buf), !!z[1]);
      var pagesId = objs.length + L.pages.reduce(function (s, p) { return s + 2 + p.imgs.length; }, 0) + 1;
      var kids = [];
      L.pages.forEach(function (p) {
        var xo = p.imgs.map(function (it) {
          return '/' + it.name + ' ' + add(stream('<< /Type /XObject /Subtype /Image /Width ' + it.img.w + ' /Height ' + it.img.h +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %LEN% >>', it.img.bytes)) + ' 0 R';
        }).join(' ');
        var content = add(stream('<< /Length %LEN% >>', enc.encode(p.ops.join('\n'))));
        kids.push(add([enc.encode('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595.28 841.89] /Contents ' + content + ' 0 R /Resources << /Font << /F1 ' +
          f1 + ' 0 R /F2 ' + f2 + ' 0 R >>' + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> >>')]));
      });
      var pid = add([enc.encode('<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>')]);
      if (pid !== pagesId) throw new Error('pdf pages id');
      var cat = add([enc.encode('<< /Type /Catalog /Pages ' + pid + ' 0 R >>')]);
      var offsets = [], pos = 0;
      var push = function (u8) { chunks.push(u8); pos += u8.length; };
      push(enc.encode('%PDF-1.7\n%âãÏÓ\n'));
      objs.forEach(function (parts, i) {
        offsets.push(pos);
        push(enc.encode((i + 1) + ' 0 obj\n'));
        parts.forEach(push);
        push(enc.encode('\nendobj\n'));
      });
      var xref = pos, x = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
      offsets.forEach(function (o) { x += ('000000000' + o).slice(-10) + ' 00000 n \n'; });
      push(enc.encode(x + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
      return new Blob(chunks, { type: 'application/pdf' });
    });
  }

  // Собирает PDF по модели отчёта; возвращает Promise<Blob>
  function make(m) {
    return loadFonts().then(function (F) {
      var jobs = m.blocks.map(function (b) { return b.kind === 'img' ? toJpeg(b.img) : null; });
      return Promise.all(jobs).then(function (images) { return build(layout(m, F, images), F); });
    });
  }

  function download(m, name) {
    return make(m).then(function (blob) {
      var file = String(name || m.title || 'Отчёт').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      return { url: url, file: file };
    });
  }

  return { make: make, download: download };
})();
