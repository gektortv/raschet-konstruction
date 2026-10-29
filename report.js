'use strict';

/* =====================================================================
   Отчёт по проверке прогибов: элементы, картинки из расчётного комплекса,
   ввод таблицы из Excel, хранение в браузере, выгрузка в Word и печать.
   Использует функции из app.js ($, num, fmt, limitSp20, setupMeta, reportMeta) и Doc из docx.js.
   ===================================================================== */
var Report = (function () {
  var items = [], seq = 0, imgSeq = 0, active = null, saveTimer = null;

  /* ---------- Хранение в браузере (IndexedDB: картинки бывают большими) ---------- */
  var DB = {
    open: function () {
      return new Promise(function (res, rej) {
        if (!window.indexedDB) { rej(new Error('no idb')); return; }
        var r = indexedDB.open('raschet-zhbk', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    },
    get: function (k) {
      return DB.open().then(function (db) {
        return new Promise(function (res, rej) {
          var q = db.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
        });
      });
    },
    set: function (k, v) {
      return DB.open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(v, k);
          tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
        });
      });
    }
  };
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var data = { title: $('rep-title').value, items: items.map(function (it) {
        return { group: it.group, type: it.type, t: it.t, b: it.b, h: it.h, L: it.L, f: it.f, cant: it.cant, caption: it.caption,
                 images: it.images.map(function (im) { return { mime: im.mime, bytes: im.bytes, w: im.w, h: im.h }; }) };
      }) };
      DB.set('defl-report', data).catch(function () { /* хранилище недоступно */ });
    }, 400);
  }

  /* ---------- Расчёт по элементу ---------- */
  function settings() { return { limit: $('limit').value, interp: $('interp').value, nLim: num($('nLim').value) }; }
  function txtNum(v) { return String(v).trim().replace(/^-/, '').replace('.', ','); }
  function fmtDen(x) { return Math.abs(x - Math.round(x)) < 0.05 ? fmt(x, 0) : fmt(x, 1); }

  function evalItem(it, st) {
    var L = num(it.L), f = Math.abs(num(it.f));
    var Lc = it.cant ? 2 * L : L, fu = NaN;
    if (L > 0) fu = st.limit === 'manual' ? Lc * 1000 / st.nLim : limitSp20(Lc, st.limit !== 'high', st.interp === 'den');
    var ok = L > 0 && isFinite(f) && String(it.f).trim() !== '' && fu > 0;
    return { L: L, Lc: Lc, f: f, fu: fu, ok: ok, pass: ok && f <= fu, den: Lc * 1000 / fu };
  }
  function shortName(it) {
    if (it.type === 'beam') return (it.cant ? 'Консольная балка' : 'Балка') + (String(it.b).trim() && String(it.h).trim() ? ' ' + txtNum(it.b) + '×' + txtNum(it.h) + ' мм' : '');
    return (it.cant ? 'Консоль плиты' : 'Плита') + (String(it.t).trim() ? ' t = ' + txtNum(it.t) + ' мм' : '');
  }
  function describe(it, r) {
    var t;
    if (it.type === 'beam') t = (it.cant ? 'Консольная балка' : 'Балка') + (String(it.b).trim() && String(it.h).trim() ? ' сечением b × h = ' + txtNum(it.b) + ' × ' + txtNum(it.h) + ' мм' : '');
    else t = (it.cant ? 'Консоль плиты перекрытия' : 'Плита перекрытия') + (String(it.t).trim() ? ' толщиной ' + txtNum(it.t) + ' мм' : '');
    if (r.L > 0) t += it.cant ? ', вылет ' + fmt(r.L, 2) + ' м, расчётный пролёт l = 2 × ' + fmt(r.L, 2) + ' = ' + fmt(r.Lc, 2) + ' м' : ', пролёт l = ' + fmt(r.L, 2) + ' м';
    return t + '.';
  }

  /* ---------- Модель отчёта ---------- */
  function model() {
    var st = settings(), rows = [], blocks = [], lastGroup = null, bad = [];
    blocks.push({ kind: 'h1', text: '1. Результаты проверки' });
    items.forEach(function (it, i) {
      var r = evalItem(it, st), group = String(it.group).trim();
      if (group && group !== lastGroup) blocks.push({ kind: 'h2', text: group });
      lastGroup = group;
      blocks.push({ kind: 'h3', text: (i + 1) + '. ' + shortName(it) });
      if (!r.ok) blocks.push({ kind: 'check', text: 'Данные не заполнены: укажите пролёт и прогиб.', pass: false });
      else {
        blocks.push({ kind: 'p', text: describe(it, r) });
        blocks.push({ kind: 'p', text: 'Максимальный прогиб по результатам расчёта f = ' + txtNum(it.f) + ' мм. Предельный прогиб по табл. Д.1 СП 20.13330.2016: fu = l/' +
          fmtDen(r.den) + ' = ' + fmt(r.fu, 1) + ' мм.' });
      }
      it.images.forEach(function (im) { blocks.push({ kind: 'img', img: im, caption: String(it.caption).trim() || 'Перемещения по оси Z, мм' }); });
      if (r.ok) blocks.push({ kind: 'check', pass: r.pass, text: 'f = ' + txtNum(it.f) + ' мм ' + (r.pass ? '≤' : '>') + ' fu = ' + fmt(r.fu, 1) +
        ' мм — требование по прогибу ' + (r.pass ? 'выполняется.' : 'не выполняется.') });
      rows.push([String(i + 1), group || '—', shortName(it), r.ok ? fmt(r.Lc, 2) : '—', r.ok ? txtNum(it.f) : '—',
                 r.ok ? fmt(r.fu, 1) : '—', r.ok ? (r.pass ? 'выполняется' : 'не выполняется') : 'нет данных']);
      if (!r.pass) bad.push(i + 1);
    });
    if (!items.length) blocks.push({ kind: 'p', text: 'Элементы для проверки не добавлены.' });
    blocks.push({ kind: 'h1', text: '2. Сводная таблица' });
    blocks.push({ kind: 'table', head: ['№', 'Этаж, раздел', 'Элемент', 'l, м', 'f, мм', 'fu, мм', 'Требование'],
                  widths: [500, 1600, 2455, 900, 1000, 1000, 1900], rows: rows });
    blocks.push({ kind: 'h1', text: '3. Заключение' });
    if (!items.length) blocks.push({ kind: 'p', text: 'Элементы для проверки не добавлены.' });
    else blocks.push({ kind: 'check', pass: !bad.length, text: !bad.length ? 'Требования по прогибам выполняются для всех проверенных элементов.'
      : 'Требования по прогибам не выполняются или не проверены для элементов № ' + bad.join(', ') + '.' });
    return { title: $('rep-title').value.trim() || 'Проверка прогибов', meta: reportMeta(), blocks: blocks };
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
        var c = document.createElement('canvas');
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
      drawThumbs(it); refresh();
    });
  }

  /* ---------- Элементы на странице ---------- */
  function fieldHtml(it, key, label, attrs) {
    var id = 'it' + it.id + '-' + key;
    return '<div class="fld"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-f="' + key + '" ' + attrs + ' value="' + Doc.esc(it[key]) + '"></div>';
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
      '<div class="thumbs"></div>' + fieldHtml(it, 'caption', 'Подпись к рисункам', 'type="text"') +
      '<div class="rep-res"></div></div>';
  }
  function itemEl(it) { return $('rep-items').querySelector('.rep-item[data-id="' + it.id + '"]'); }
  function findItem(el) { var box = el.closest('.rep-item'); if (!box) return null; var id = +box.getAttribute('data-id'); return items.filter(function (x) { return x.id === id; })[0] || null; }
  function drawThumbs(it) {
    itemEl(it).querySelector('.thumbs').innerHTML = it.images.map(function (im, k) {
      return '<div class="thumb"><img src="' + im.url + '" alt="Рисунок ' + (k + 1) + '"><button type="button" class="btn-sec" data-act="rmimg" data-img="' + im.id +
        '" aria-label="Убрать картинку ' + (k + 1) + '">Убрать</button></div>';
    }).join('');
  }
  function syncType(it) {
    var el = itemEl(it);
    el.querySelector('.rep-plate').hidden = it.type !== 'plate';
    el.querySelector('.rep-beam').hidden = it.type !== 'beam';
    el.querySelector('label[for="it' + it.id + '-L"]').textContent = it.cant ? 'Вылет консоли, м' : 'Пролёт l, м';
  }
  function addItem(data, quiet) {
    var prev = items[items.length - 1];
    var it = { id: ++seq, type: 'plate', group: prev ? prev.group : '', t: '', b: '', h: '', L: '', f: '', cant: false, caption: 'Перемещения по оси Z, мм', images: [] };
    Object.keys(data || {}).forEach(function (k) { it[k] = data[k]; });
    items.push(it);
    $('rep-items').insertAdjacentHTML('beforeend', itemHtml(it));
    syncType(it);
    if (it.images.length) drawThumbs(it);
    active = it;
    if (!quiet) { var first = itemEl(it).querySelector('input'); if (first) first.focus(); }
    return it;
  }

  /* ---------- Ввод таблицы из Excel ---------- */
  // Столбцы: этаж | элемент | толщина или b×h | пролёт, м | прогиб, мм
  function parseTable(text) {
    var out = [];
    text.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var c = line.split(line.indexOf('\t') >= 0 ? '\t' : ';').map(function (x) { return x.trim(); });
      if (c.length < 5) return;
      var L = num(c[3]), f = num(c[4]);
      if (!isFinite(L) || !isFinite(f)) return;              // строка заголовков пропускается
      var kind = c[1].toLowerCase();
      var it = { group: c[0], type: /балк|ригел/.test(kind) ? 'beam' : 'plate', cant: /консол/.test(kind), L: String(L), f: String(f) };
      var sec = c[2].replace(/\s/g, '').replace(',', '.').split(/[x×х*]/i);
      if (it.type === 'beam' && sec.length === 2) { it.b = sec[0]; it.h = sec[1]; }
      else if (sec[0]) it.t = sec[0];
      out.push(it);
    });
    return out;
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
    $('rep-preview').innerHTML = Doc.previewHtml(model());
    scheduleSave();
  }
  function removeItem(it) {
    it.images.forEach(function (im) { URL.revokeObjectURL(im.url); });
    items = items.filter(function (x) { return x !== it; });
    itemEl(it).remove();
    if (active === it) active = items[items.length - 1] || null;
  }

  function init() {
    setupMeta();
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
      if (e.target.getAttribute('data-f') === 'files') addFiles(it, e.target.files).then(function () { e.target.value = ''; });
      if (e.target.getAttribute('data-f') === 'type') { it.type = e.target.value; syncType(it); refresh(); }
    });
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]'), it = btn && findItem(btn);
      if (!it) return;
      if (btn.getAttribute('data-act') === 'del') { removeItem(it); refresh(); }
      else if (btn.getAttribute('data-act') === 'rmimg') {
        var idImg = +btn.getAttribute('data-img');
        it.images = it.images.filter(function (im) { if (im.id === idImg) { URL.revokeObjectURL(im.url); return false; } return true; });
        drawThumbs(it); refresh();
      }
    });
    box.addEventListener('focusin', function (e) { var it = findItem(e.target); if (it) active = it; });
    box.addEventListener('dragover', function (e) { if (findItem(e.target)) e.preventDefault(); });
    box.addEventListener('drop', function (e) {
      var it = findItem(e.target);
      if (!it || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); active = it; addFiles(it, e.dataTransfer.files);
    });
    document.addEventListener('paste', function (e) {
      if (!active || !e.clipboardData || e.target === $('rep-paste')) return;
      var files = [];
      Array.prototype.forEach.call(e.clipboardData.items || [], function (ci) { if (ci.kind === 'file' && /^image\//.test(ci.type)) files.push(ci.getAsFile()); });
      if (!files.length) return;
      e.preventDefault(); addFiles(active, files);
    });
    $('rep-add-plate').addEventListener('click', function () { addItem({ type: 'plate' }); refresh(); });
    $('rep-add-beam').addEventListener('click', function () { addItem({ type: 'beam' }); refresh(); });
    $('rep-paste-add').addEventListener('click', function () {
      var rows = parseTable($('rep-paste').value);
      // пустой элемент, созданный по умолчанию, заменяется данными из таблицы
      if (rows.length && items.length === 1 && !items[0].L && !items[0].f && !items[0].images.length) removeItem(items[0]);
      rows.forEach(function (d) { addItem(d, true); });
      $('rep-paste-msg').textContent = rows.length ? 'Добавлено элементов: ' + rows.length + '.' : 'Не нашёл строк с пятью столбцами: этаж, элемент, сечение, пролёт, прогиб.';
      if (rows.length) $('rep-paste').value = '';
      refresh();
    });
    $('rep-clear').addEventListener('click', function () {
      items.slice().forEach(removeItem);
      addItem({ type: 'plate' }, true);
      $('rep-restored').hidden = true;
      refresh();
    });
    $('rep-meta').addEventListener('input', refresh);
    $('form').addEventListener('input', refresh);
    $('rep-docx').addEventListener('click', function () { Doc.download(model(), $('rep-title').value.trim() || 'Проверка прогибов'); });
    $('rep-pdf').addEventListener('click', function () {
      var btn = this; btn.disabled = true; $('rep-msg').textContent = 'Готовлю PDF…';
      Pdf.download(model(), $('rep-title').value.trim() || 'Проверка прогибов')
        .then(function (res) { pdfReady(res); })
        .catch(function (e) { $('rep-msg').textContent = 'Не удалось собрать PDF: ' + (e && e.message ? e.message : 'ошибка') + '. Можно скачать Word или воспользоваться печатью.'; })
        .then(function () { btn.disabled = false; });
    });
    $('rep-print').addEventListener('click', function () { refresh(); window.print(); });

    // Восстановление сохранённого отчёта
    DB.get('defl-report').then(function (data) {
      if (data && data.items && data.items.length) {
        if (data.title) $('rep-title').value = data.title;
        data.items.forEach(function (d) {
          d.images = (d.images || []).map(function (im) {
            var bytes = im.bytes instanceof Uint8Array ? im.bytes : new Uint8Array(im.bytes);
            return { id: ++imgSeq, mime: im.mime, bytes: bytes, w: im.w, h: im.h, url: URL.createObjectURL(new Blob([bytes], { type: im.mime })) };
          });
          addItem(d, true);
        });
        $('rep-restored').hidden = false;
      } else addItem({ type: 'plate' }, true);
      refresh();
    }).catch(function () { addItem({ type: 'plate' }, true); refresh(); });
  }

  return { init: init, _model: model };
})();

if (document.body.getAttribute('data-page') === 'check') Report.init();
