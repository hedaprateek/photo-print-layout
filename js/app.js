/* Print Sheet — state, UI wiring and the glue between layout and rendering. */
(function (App) {
  'use strict';

  const SETTINGS_KEY = 'ppl.settings';
  const PREVIEW_SHEET_LIMIT = 15;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const state = {
    photos: [],
    selectedId: null,
    settings: {
      paperId: 'a4',
      paperW: 210,
      paperH: 297,
      orientation: 'portrait',
      margin: 5,
      gap: 2,
      fit: 'cover',
      cutLines: true,
      dpi: 300,
      allowRotate: true,
      mode: 'grid',
      persist: true
    },
    grid: {
      source: 'one',
      sizeId: 'id_35x45',
      customW: 60,
      customH: 80,
      count: 8,
      fill: false,
      fillCount: 4
    }
  };

  let searchPage = { provider: null, query: null, page: 1 };
  let editing = null; // { id, source (downscaled canvas), beforeUrl }

  /* ------------------------------------------------------------- utilities */

  function busy(text) {
    $('busy-text').textContent = text || 'Working…';
    $('busy').hidden = false;
  }
  function unbusy() {
    $('busy').hidden = true;
  }

  function notice(msg, kind) {
    const el = $('notice');
    if (!msg) {
      el.hidden = true;
      return;
    }
    el.textContent = msg;
    el.className = 'notice' + (kind === 'error' ? ' error' : '');
    el.hidden = false;
  }

  let debounceTimer = null;
  function refreshSoon() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 60);
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings: state.settings, grid: state.grid }));
    } catch (e) {
      /* storage blocked — the app still works, it just won't remember */
    }
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      Object.assign(state.settings, raw.settings || {});
      Object.assign(state.grid, raw.grid || {});
    } catch (e) {
      /* ignore corrupt settings */
    }
  }

  /* ---------------------------------------------------------------- photos */

  const sourceCache = new Map();

  /* Decoded full-resolution image, memoised. Kept small: a dozen 20-megapixel
     bitmaps is hundreds of megabytes. */
  App.photoSource = async function (photo) {
    const key = photo.id + '|' + (photo.version || 0);
    if (sourceCache.has(key)) return sourceCache.get(key);

    const img = await App.blobToImage(photo.blob);
    sourceCache.set(key, img);
    if (sourceCache.size > 6) {
      const oldestKey = sourceCache.keys().next().value;
      const old = sourceCache.get(oldestKey);
      sourceCache.delete(oldestKey);
      // Safe: an Image that has already loaded keeps its bitmap after revoke.
      if (old && old._revoke) URL.revokeObjectURL(old._revoke);
    }
    return img;
  };

  function persistPhoto(photo) {
    if (!state.settings.persist) return;
    App.idb.put({
      id: photo.id,
      name: photo.name,
      blob: photo.blob,
      originalBlob: photo.originalBlob || null,
      thumbBlob: photo.thumbBlob,
      w: photo.w,
      h: photo.h,
      source: photo.source,
      credit: photo.credit,
      creditUrl: photo.creditUrl,
      rotate: photo.rotate,
      focus: photo.focus,
      adj: photo.adj,
      copies: photo.copies,
      sizeId: photo.sizeId,
      customW: photo.customW,
      customH: photo.customH,
      version: photo.version,
      enhanced: photo.enhanced
    });
  }

  async function buildThumbs(photo, source) {
    const thumbCanvas = App.makeThumb(source, 160);
    photo.thumbBlob = await App.canvasToBlob(thumbCanvas, 'image/jpeg', 0.85);
    if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    photo.thumbUrl = URL.createObjectURL(photo.thumbBlob);
    await refreshPreviewImage(photo, source);
  }

  /* A tone-adjusted, print-sized-agnostic preview so the sheet on screen
     actually looks like what will come out of the printer. */
  async function refreshPreviewImage(photo, source) {
    const a = photo.adj || {};
    const plain = !a.auto && !a.exposure && !a.contrast && !a.saturation && !a.warmth;
    if (photo.previewUrl) {
      URL.revokeObjectURL(photo.previewUrl);
      photo.previewUrl = null;
    }
    if (plain) return;
    const src = source || (await App.photoSource(photo));
    const canvas = App.previewAdjusted(src, 700, photo.adj);
    const blob = await App.canvasToBlob(canvas, 'image/jpeg', 0.88);
    photo.previewUrl = URL.createObjectURL(blob);
    canvas.width = 0;
  }

  const previewSrc = (photo) => photo.previewUrl || photo.thumbUrl;

  async function addPhotoFromBlob(blob, meta) {
    const img = await App.blobToImage(blob);
    const photo = {
      id: uid(),
      name: (meta && meta.name) || 'Photo',
      blob,
      w: img.naturalWidth,
      h: img.naturalHeight,
      source: (meta && meta.source) || 'upload',
      credit: meta && meta.credit,
      creditUrl: meta && meta.creditUrl,
      rotate: 0,
      focus: { x: 0.5, y: 0.5 },
      adj: Object.assign({}, App.DEFAULT_ADJ),
      copies: 1,
      sizeId: state.grid.sizeId,
      customW: 60,
      customH: 80,
      version: 0,
      enhanced: null
    };
    await buildThumbs(photo, img);
    if (img._revoke) URL.revokeObjectURL(img._revoke);

    state.photos.push(photo);
    if (!state.selectedId) state.selectedId = photo.id;
    persistPhoto(photo);
    return photo;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /^image\//.test(f.type));
    if (!files.length) {
      notice('Those files are not images.', 'error');
      return;
    }
    notice('');
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      busy('Reading photo ' + (i + 1) + ' of ' + files.length + '…');
      try {
        await addPhotoFromBlob(files[i], { name: files[i].name, source: 'upload' });
      } catch (e) {
        failed++;
      }
    }
    unbusy();
    if (failed) notice(failed + ' file(s) could not be read as images.', 'error');
    refresh();
  }

  function releasePhoto(photo) {
    if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  }

  function removePhoto(id) {
    const i = state.photos.findIndex((p) => p.id === id);
    if (i < 0) return;
    releasePhoto(state.photos[i]);
    state.photos.splice(i, 1);
    App.idb.delete(id);
    if (state.selectedId === id) state.selectedId = state.photos.length ? state.photos[0].id : null;
    App.clearSlotCache();
    refresh();
  }

  async function restorePhotos() {
    const rows = await App.idb.all();
    if (!rows.length) return;
    rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const r of rows) {
      if (!r.blob) continue;
      const photo = Object.assign({}, r);
      photo.adj = Object.assign({}, App.DEFAULT_ADJ, r.adj || {});
      photo.focus = r.focus || { x: 0.5, y: 0.5 };
      photo.rotate = r.rotate || 0;
      photo.copies = r.copies || 1;
      photo.version = r.version || 0;
      photo.thumbUrl = r.thumbBlob ? URL.createObjectURL(r.thumbBlob) : null;
      state.photos.push(photo);
      // Re-derive the adjusted preview lazily; the plain thumb shows meanwhile.
      refreshPreviewImage(photo).then(refreshSoon);
    }
    if (state.photos.length) state.selectedId = state.photos[0].id;
  }

  /* ----------------------------------------------------------- size lookup */

  function sizeOf(photo) {
    const id = photo.sizeId || state.grid.sizeId;
    if (id === 'custom') return { w: photo.customW || 60, h: photo.customH || 80 };
    const s = App.findSize(id);
    return { w: s.w, h: s.h };
  }

  function currentPaper() {
    const s = state.settings;
    const base = App.findPaper(s.paperId);
    let w = s.paperId === 'custom' ? s.paperW : base.w;
    let h = s.paperId === 'custom' ? s.paperH : base.h;
    if (s.orientation === 'landscape') {
      const t = w;
      w = h;
      h = t;
    }
    return { id: base.id, name: base.name, w, h };
  }

  function gridItemSize(paper, photo) {
    const g = state.grid;
    if (g.fill) {
      const ref = photo || selectedPhoto() || state.photos[0];
      const aspect = ref ? ref.w / ref.h : 3 / 4;
      // Respect the photo's own shape, unless it has been turned on its side.
      const turned = ref && (ref.rotate === 90 || ref.rotate === 270);
      const best = App.maximiseSize(
        paper,
        state.settings.margin,
        state.settings.gap,
        turned ? 1 / aspect : aspect,
        Math.max(1, g.fillCount),
        state.settings.allowRotate
      );
      return best || { w: 50, h: 70 };
    }
    if (g.sizeId === 'custom') return { w: g.customW, h: g.customH };
    const s = App.findSize(g.sizeId);
    return { w: s.w, h: s.h };
  }

  const selectedPhoto = () => state.photos.find((p) => p.id === state.selectedId) || null;

  /* Slot size a given photo will occupy in the current mode — used for the
     DPI advice, which is only meaningful against a real target size. */
  function targetSizeFor(photo) {
    return state.settings.mode === 'pack' ? sizeOf(photo) : gridItemSize(currentPaper(), photo);
  }

  /* ---------------------------------------------------------------- layout */

  function computeLayout() {
    const paper = currentPaper();
    const s = state.settings;
    const margin = clamp(s.margin, 0, Math.min(paper.w, paper.h) / 2 - 1);
    const base = { paper, margin, gap: Math.max(0, s.gap), allowRotate: s.allowRotate };

    if (!state.photos.length) return { paper, pages: [], perSheet: 0 };

    if (s.mode === 'pack') {
      const entries = state.photos
        .filter((p) => (p.copies || 1) > 0)
        .map((p) => Object.assign({ photoId: p.id, copies: p.copies || 1 }, sizeOf(p)));
      const res = App.layoutPack(Object.assign({ entries }, base));
      return { paper, pages: res.pages, perSheet: res.pages.length ? res.pages[0].items.length : 0, oversized: res.oversized };
    }

    const g = state.grid;
    const targets = g.source === 'each' ? state.photos : [selectedPhoto()].filter(Boolean);
    if (!targets.length) return { paper, pages: [], perSheet: 0 };

    const pages = [];
    let perSheet = 0;
    let tooBig = 0;
    for (const photo of targets) {
      const item = gridItemSize(paper, photo);
      const count = g.fill ? Math.max(1, g.fillCount) : Math.max(1, g.count);
      const res = App.layoutGrid(Object.assign({ item, count, photoId: photo.id }, base));
      if (res.error === 'too-big') {
        tooBig++;
        continue;
      }
      perSheet = res.perSheet;
      pages.push(...res.pages);
    }
    return { paper, pages, perSheet, tooBig, itemSize: gridItemSize(paper, targets[0]) };
  }

  /* --------------------------------------------------------------- preview */

  let lastLayout = { paper: currentPaper(), pages: [] };

  function refresh() {
    renderLibrary();
    syncControls();

    const layout = computeLayout();
    lastLayout = layout;
    const paper = layout.paper;

    $('stat-sheets').textContent = layout.pages.length;
    $('stat-per').textContent = layout.perSheet || 0;
    $('stat-fill').textContent = Math.round(App.efficiency(layout.pages, paper) * 100) + '%';

    const size =
      state.settings.mode === 'pack'
        ? 'mixed'
        : layout.itemSize
        ? App.fmtMm(layout.itemSize.w) + ' × ' + App.fmtMm(layout.itemSize.h)
        : '—';
    $('stat-size').textContent = size;

    const messages = [];
    if (layout.tooBig) messages.push(layout.tooBig + ' photo(s) will not fit this sheet at that size.');
    if (layout.oversized && layout.oversized.length) {
      messages.push(layout.oversized.length + ' photo(s) are larger than the sheet and were skipped.');
    }
    if (layout.pages.length > PREVIEW_SHEET_LIMIT) {
      messages.push(
        'Showing the first ' + PREVIEW_SHEET_LIMIT + ' of ' + layout.pages.length +
        ' sheets — all of them will print.'
      );
    }
    notice(messages.join(' '), layout.tooBig || (layout.oversized && layout.oversized.length) ? 'error' : '');

    renderSheets(layout, paper);
    const hasPages = layout.pages.length > 0;
    ['btn-print', 'btn-print-2', 'btn-pdf', 'btn-pdf-2'].forEach((id) => ($(id).disabled = !hasPages));
  }

  function renderSheets(layout, paper) {
    const host = $('preview');
    host.innerHTML = '';

    if (!layout.pages.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = state.photos.length
        ? '<h3>Nothing to arrange yet</h3><p>Pick a print size that fits the sheet, or raise the number of copies.</p>'
        : '<h3>Add photos to begin</h3><p>Choose a paper size and a photo size on the right. Sheets are filled to waste as little paper as possible, and you can print straight from here.</p>';
      host.appendChild(empty);
      return;
    }

    const byId = {};
    for (const p of state.photos) byId[p.id] = p;
    const shown = layout.pages.slice(0, PREVIEW_SHEET_LIMIT);

    shown.forEach((page, i) => {
      const block = document.createElement('div');
      block.className = 'sheet-block';

      const label = document.createElement('div');
      label.className = 'sheet-label';
      label.textContent =
        'Sheet ' + (i + 1) + ' of ' + layout.pages.length + ' · ' + paper.name + ' ' +
        App.fmtMm(paper.w) + ' × ' + App.fmtMm(paper.h) + ' · ' + page.items.length + ' photos';

      const wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      wrap.appendChild(App.buildSheet(page, paper, byId, state.settings, previewSrc));

      block.append(label, wrap);
      host.appendChild(block);
    });

    scalePreview(paper);
  }

  /* Sheets are built at true size, then scaled down to fit the viewport. */
  function scalePreview(paper) {
    const host = $('preview');
    const p = paper || lastLayout.paper;
    const pxW = p.w * App.MM_TO_CSSPX;
    const pxH = p.h * App.MM_TO_CSSPX;
    const availW = Math.max(120, host.clientWidth - 44);
    const availH = Math.max(200, window.innerHeight * 0.74);
    const k = Math.min(1, availW / pxW, availH / pxH);

    host.querySelectorAll('.sheet-wrap').forEach((wrap) => {
      wrap.style.width = pxW * k + 'px';
      wrap.style.height = pxH * k + 'px';
      const sheet = wrap.firstElementChild;
      if (sheet) sheet.style.transform = 'scale(' + k + ')';
    });
  }

  /* --------------------------------------------------------------- library */

  function renderLibrary() {
    const host = $('library');
    host.innerHTML = '';
    const n = state.photos.length;
    $('library-count').textContent = n ? n + (n === 1 ? ' photo' : ' photos') : 'No photos yet';
    $('btn-clear').hidden = !n;

    for (const photo of state.photos) {
      const li = document.createElement('li');
      li.className = 'lib-item' + (photo.id === state.selectedId ? ' is-selected' : '');

      const thumb = document.createElement('img');
      thumb.className = 'lib-thumb';
      thumb.src = previewSrc(photo) || '';
      thumb.alt = photo.name;
      thumb.title = 'Select this photo';
      thumb.addEventListener('click', () => {
        state.selectedId = photo.id;
        refresh();
      });

      const body = document.createElement('div');
      body.className = 'lib-body';

      const name = document.createElement('div');
      name.className = 'lib-name';
      name.textContent = photo.name;
      name.title = photo.credit ? photo.name + ' — by ' + photo.credit : photo.name;

      const meta = document.createElement('div');
      meta.className = 'lib-meta';
      const target = targetSizeFor(photo);
      const dpi = App.effectiveDpi(photo.w, photo.h, target.w, target.h, state.settings.fit);
      const verdict = App.dpiVerdict(dpi);

      const dpiBadge = document.createElement('span');
      dpiBadge.className = 'badge ' + verdict.level;
      dpiBadge.textContent = Math.round(dpi) + ' DPI · ' + verdict.label;
      dpiBadge.title = 'Resolution at ' + App.fmtMm(target.w) + ' × ' + App.fmtMm(target.h);
      meta.appendChild(dpiBadge);

      if (photo.enhanced) {
        const tag = document.createElement('span');
        tag.className = 'badge ai';
        tag.textContent = photo.enhanced === 'ai' ? 'AI upscaled' : 'Upscaled';
        meta.appendChild(tag);
      }

      const px = document.createElement('span');
      px.textContent = photo.w + '×' + photo.h;
      meta.appendChild(px);

      body.append(name, meta);

      if (state.settings.mode === 'pack') {
        const controls = document.createElement('div');
        controls.className = 'lib-controls';

        const sel = buildSizeSelect(photo.sizeId || state.grid.sizeId, false);
        sel.addEventListener('change', () => {
          photo.sizeId = sel.value;
          persistPhoto(photo);
          refresh();
        });

        const copies = document.createElement('input');
        copies.type = 'number';
        copies.min = '0';
        copies.max = '500';
        copies.value = photo.copies || 1;
        copies.title = 'Number of copies';
        copies.addEventListener('change', () => {
          photo.copies = clamp(parseInt(copies.value, 10) || 0, 0, 500);
          persistPhoto(photo);
          refresh();
        });

        controls.append(sel, copies);
        body.appendChild(controls);

        if ((photo.sizeId || state.grid.sizeId) === 'custom') {
          const row = document.createElement('div');
          row.className = 'lib-controls';
          row.append(
            numberInput(photo.customW || 60, (v) => {
              photo.customW = v;
              persistPhoto(photo);
              refresh();
            }, 'Width mm'),
            numberInput(photo.customH || 80, (v) => {
              photo.customH = v;
              persistPhoto(photo);
              refresh();
            }, 'Height mm')
          );
          body.appendChild(row);
        }
      }

      const actions = document.createElement('div');
      actions.className = 'lib-actions';
      actions.append(
        linkButton('Enhance', () => openEditor(photo.id)),
        linkButton('Remove', () => removePhoto(photo.id))
      );
      body.appendChild(actions);

      li.append(thumb, body);
      host.appendChild(li);
    }
  }

  function numberInput(value, onChange, title) {
    const el = document.createElement('input');
    el.type = 'number';
    el.min = '5';
    el.max = '1000';
    el.step = '0.5';
    el.value = value;
    el.title = title;
    el.addEventListener('change', () => onChange(clamp(parseFloat(el.value) || 10, 5, 1000)));
    return el;
  }

  function linkButton(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------------------------------------------------------- select fills */

  function buildSizeSelect(selected, includeFill) {
    const sel = document.createElement('select');
    const groups = {};
    for (const s of App.SIZES) {
      (groups[s.group] = groups[s.group] || []).push(s);
    }
    for (const group of Object.keys(groups)) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const s of groups[group]) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    if (includeFill) {
      const og = document.createElement('optgroup');
      og.label = 'Automatic';
      const o = document.createElement('option');
      o.value = '__fill';
      o.textContent = 'Fill the sheet (largest that fits)';
      og.appendChild(o);
      sel.appendChild(og);
    }
    sel.value = selected;
    return sel;
  }

  function fillSelects() {
    const paperSel = $('paper');
    const groups = {};
    for (const p of App.PAPERS) (groups[p.group] = groups[p.group] || []).push(p);
    for (const group of Object.keys(groups)) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const p of groups[group]) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.id === 'custom' ? p.name : p.name + ' — ' + p.w + '×' + p.h + ' mm';
        og.appendChild(o);
      }
      paperSel.appendChild(og);
    }

    const gridSizeSel = buildSizeSelect(state.grid.sizeId, true);
    gridSizeSel.id = 'grid-size';
    $('grid-size').replaceWith(gridSizeSel);

    const bulk = $('pack-bulk-size');
    for (const s of App.SIZES) {
      if (s.id === 'custom') continue;
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      bulk.appendChild(o);
    }

    const dpiSel = $('dpi');
    for (const q of App.QUALITY) {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = q.name;
      dpiSel.appendChild(o);
    }
  }

  /* Push state into the controls (called after any state change). */
  function syncControls() {
    const s = state.settings;
    const g = state.grid;

    $('paper').value = s.paperId;
    $('paper-custom').hidden = s.paperId !== 'custom';
    $('paper-w').value = s.paperW;
    $('paper-h').value = s.paperH;
    $('margin').value = s.margin;
    $('gap').value = s.gap;
    $('dpi').value = s.dpi;
    $('cut-lines').checked = s.cutLines;
    $('allow-rotate').checked = s.allowRotate;

    document.querySelectorAll('[data-orient]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.orient === s.orientation)
    );
    document.querySelectorAll('[data-fit]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.fit === s.fit)
    );

    $('tab-grid').classList.toggle('is-active', s.mode === 'grid');
    $('tab-pack').classList.toggle('is-active', s.mode === 'pack');
    $('tab-grid').setAttribute('aria-selected', s.mode === 'grid');
    $('tab-pack').setAttribute('aria-selected', s.mode === 'pack');
    $('mode-grid').hidden = s.mode !== 'grid';
    $('mode-pack').hidden = s.mode !== 'pack';

    $('grid-source').value = g.source;
    $('grid-size').value = g.fill ? '__fill' : g.sizeId;
    $('grid-custom').hidden = g.fill || g.sizeId !== 'custom';
    $('grid-custom-w').value = g.customW;
    $('grid-custom-h').value = g.customH;
    $('grid-fill-field').hidden = !g.fill;
    $('grid-fill-count').value = g.fillCount;
    $('grid-count-field').hidden = !!g.fill;
    $('grid-count').value = g.count;
  }

  /* --------------------------------------------------------------- editor */

  async function openEditor(id) {
    const photo = state.photos.find((p) => p.id === id);
    if (!photo) return;
    state.selectedId = id;

    busy('Opening photo…');
    try {
      const source = await App.photoSource(photo);
      // Work on a modest copy: sliders must feel instant, and a 20 MP source
      // would make every keystroke a half-second wait.
      const work = App.makeThumb(source, 900);
      const beforeBlob = await App.canvasToBlob(work, 'image/jpeg', 0.9);
      if (editing && editing.beforeUrl) URL.revokeObjectURL(editing.beforeUrl);
      editing = { id, source: work, beforeUrl: URL.createObjectURL(beforeBlob) };

      $('editor-before').src = editing.beforeUrl;
      $('editor-title').textContent = 'Enhance — ' + photo.name;
      syncEditorControls(photo);
      renderEditorPreview();
      openModal('modal-editor');
    } catch (e) {
      notice('Could not open that photo: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  function syncEditorControls(photo) {
    const a = photo.adj;
    ['exposure', 'contrast', 'saturation', 'warmth', 'sharpen'].forEach((k) => {
      $('s-' + k).value = a[k];
      $('v-' + k).textContent = a[k];
    });
    $('btn-auto').textContent = a.auto ? 'Auto-enhance: on' : 'Auto-enhance';
    $('btn-revert').hidden = !photo.originalBlob;

    const f = photo.focus || { x: 0.5, y: 0.5 };
    const key = f.x + ',' + f.y;
    document.querySelectorAll('[data-focus]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.focus === key)
    );
  }

  /* Live preview of exactly what will land in the slot: cropped, rotated and
     tone-corrected, at the size this photo will actually print. */
  function renderEditorPreview() {
    if (!editing) return;
    const photo = state.photos.find((p) => p.id === editing.id);
    if (!photo) return;

    const target = targetSizeFor(photo);
    const rot = ((photo.rotate || 0) % 360 + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const slotW = swapped ? target.h : target.w;
    const slotH = swapped ? target.w : target.h;

    const longEdge = 520;
    const scale = longEdge / Math.max(slotW, slotH);
    const canvas = App.renderSlot(
      editing.source,
      Math.round(slotW * scale),
      Math.round(slotH * scale),
      {
        fit: state.settings.fit,
        rotate: rot,
        focus: photo.focus,
        adj: Object.assign({}, photo.adj, { sharpen: 0 }),
        dpi: 96
      }
    );
    $('editor-after').src = canvas.toDataURL('image/jpeg', 0.9);
    canvas.width = 0;

    const dpi = App.effectiveDpi(photo.w, photo.h, target.w, target.h, state.settings.fit);
    const verdict = App.dpiVerdict(dpi);
    $('editor-dpi').innerHTML =
      'At <b>' + App.fmtMm(target.w) + ' × ' + App.fmtMm(target.h) + '</b> this prints at ' +
      '<b>' + Math.round(dpi) + ' DPI</b> — <span class="badge ' + verdict.level + '">' +
      verdict.label + '</span><br><span class="muted small">Source ' + photo.w + ' × ' + photo.h +
      ' px. 300 DPI is the usual target for photo prints; below about 150 DPI softness is visible.</span>';

    const factor = App.upscaleFactorFor(photo.w, photo.h, target.w, target.h, state.settings.fit, 300);
    const btn = $('btn-upscale');
    if (factor <= 1.05) {
      btn.disabled = true;
      $('upscale-note').textContent = 'Already sharp enough for a 300 DPI print at this size.';
    } else {
      btn.disabled = false;
      // Keep the exact factor: enlarge() picks the model and trims the surplus,
      // so asking for 1.2× doesn't produce a needlessly huge 2× file.
      btn.dataset.factor = factor.toFixed(2);
      $('upscale-note').textContent =
        'This photo needs about ' + factor.toFixed(1) + '× more detail for a crisp 300 DPI print. ' +
        (App.aiAvailable()
          ? 'AI upscaling reconstructs detail rather than just stretching pixels; the first run downloads the model (~5 MB).'
          : 'Your browser has no WebGL, so high-quality resampling will be used instead.');
    }
  }

  function onAdjChange() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    ['exposure', 'contrast', 'saturation', 'warmth', 'sharpen'].forEach((k) => {
      const v = parseInt($('s-' + k).value, 10) || 0;
      photo.adj[k] = v;
      $('v-' + k).textContent = v;
    });
    renderEditorPreview();
  }

  async function commitEditor() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    App.clearSlotCache();
    await refreshPreviewImage(photo);
    persistPhoto(photo);
    refresh();
  }

  /* ------------------------------------------------------------- upscaling */

  async function runUpscale() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    const factor = parseFloat($('btn-upscale').dataset.factor || '2');

    busy('Preparing…');
    try {
      const source = await App.photoSource(photo);
      const { canvas, method } = await App.enlarge(source, factor, (msg) => busy(msg));
      busy('Saving result…');
      const blob = await App.canvasToBlob(canvas, 'image/jpeg', 0.95);

      if (!photo.originalBlob) photo.originalBlob = photo.blob;
      photo.blob = blob;
      photo.w = canvas.width;
      photo.h = canvas.height;
      photo.version = (photo.version || 0) + 1;
      photo.enhanced = method;
      canvas.width = 0;

      App.clearSlotCache();
      const fresh = await App.photoSource(photo);
      await buildThumbs(photo, fresh);
      editing.source = App.makeThumb(fresh, 900);
      persistPhoto(photo);
      syncEditorControls(photo); // reveals "Revert to original"
      renderEditorPreview();
      refresh();
      notice(
        method === 'ai'
          ? 'Upscaled with AI super-resolution.'
          : 'Upscaled by high-quality resampling (AI was unavailable).'
      );
    } catch (e) {
      notice('Upscaling failed: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  async function revertPhoto() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo || !photo.originalBlob) return;
    busy('Restoring original…');
    try {
      photo.blob = photo.originalBlob;
      photo.originalBlob = null;
      photo.version = (photo.version || 0) + 1;
      photo.enhanced = null;
      App.clearSlotCache();
      const img = await App.photoSource(photo);
      photo.w = img.naturalWidth;
      photo.h = img.naturalHeight;
      await buildThumbs(photo, img);
      editing.source = App.makeThumb(img, 900);
      persistPhoto(photo);
      syncEditorControls(photo);
      renderEditorPreview();
      refresh();
    } finally {
      unbusy();
    }
  }

  /* ---------------------------------------------------------------- search */

  async function doSearch(reset) {
    const provider = $('search-provider').value;
    const query = $('search-query').value.trim();
    const status = $('search-status');
    if (!query) {
      status.textContent = 'Type something to search for.';
      status.className = 'search-status';
      return;
    }
    if (reset) {
      searchPage = { provider, query, page: 1 };
      $('search-results').innerHTML = '';
    }
    status.className = 'search-status';
    status.textContent = 'Searching ' + App.PROVIDERS[provider].name + '…';

    try {
      const res = await App.search(provider, query, searchPage.page);
      status.textContent = res.total
        ? res.total.toLocaleString() + ' results — click a photo to add it'
        : 'No results for that search.';
      renderResults(res.results, provider);
    } catch (e) {
      status.className = 'search-status error';
      status.textContent = e.message;
    }
  }

  function renderResults(results, provider) {
    const host = $('search-results');
    for (const r of results) {
      const fig = document.createElement('figure');
      fig.className = 'result';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.all = 'unset';

      const img = document.createElement('img');
      img.src = r.thumb;
      img.alt = r.credit ? 'Photo by ' + r.credit : 'Search result';
      img.loading = 'lazy';

      const cap = document.createElement('figcaption');
      cap.textContent = (r.credit ? r.credit + ' · ' : '') + r.width + '×' + r.height;

      fig.append(img, cap);
      fig.addEventListener('click', () => addSearchResult(r, provider, fig));
      host.appendChild(fig);
    }

    if (results.length >= 24) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-soft';
      more.textContent = 'Load more';
      more.addEventListener('click', () => {
        more.remove();
        searchPage.page++;
        doSearch(false);
      });
      host.appendChild(more);
    }
  }

  async function addSearchResult(result, provider, node) {
    const tier = $('search-quality').value;
    const url = result.urls[tier] || result.urls[Object.keys(result.urls)[0]];
    busy('Downloading photo…');
    try {
      const blob = await App.fetchRemote(url);
      await addPhotoFromBlob(blob, {
        name: (result.credit || provider) + ' — ' + result.id,
        source: provider,
        credit: result.credit,
        creditUrl: result.creditUrl
      });
      if (provider === 'unsplash') App.trackUnsplashDownload(result);
      node.classList.add('is-added');
      refresh();
    } catch (e) {
      notice('Could not add that photo: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  function fillQualityTiers() {
    const provider = $('search-provider').value;
    const sel = $('search-quality');
    sel.innerHTML = '';
    for (const t of App.PROVIDERS[provider].tiers) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    }
    // Default to the largest tier: print needs the pixels.
    sel.value = App.PROVIDERS[provider].tiers[App.PROVIDERS[provider].tiers.length - 1].id;
  }

  /* ---------------------------------------------------------------- modals */

  function openModal(id) {
    $(id).hidden = false;
  }
  function closeModal(el) {
    el.hidden = true;
  }

  function wireModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
      modal.querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => {
          closeModal(modal);
          if (modal.id === 'modal-editor') commitEditor();
        })
      );
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = Array.from(document.querySelectorAll('.modal')).find((m) => !m.hidden);
      if (!open) return;
      closeModal(open);
      if (open.id === 'modal-editor') commitEditor();
    });
  }

  /* ------------------------------------------------------------ print / pdf */

  async function doPrint() {
    const layout = computeLayout();
    if (!layout.pages.length) return;
    const byId = {};
    for (const p of state.photos) byId[p.id] = p;
    busy('Rendering sheets at ' + state.settings.dpi + ' DPI…');
    try {
      await App.printSheets(layout.pages, layout.paper, byId, state.settings, busy);
    } catch (e) {
      notice('Printing failed: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  async function doPdf() {
    const layout = computeLayout();
    if (!layout.pages.length) return;
    const byId = {};
    for (const p of state.photos) byId[p.id] = p;
    busy('Building PDF…');
    try {
      await App.exportPdf(layout.pages, layout.paper, byId, state.settings, busy);
    } catch (e) {
      notice('PDF export failed: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  /* ----------------------------------------------------------------- wiring */

  function wire() {
    /* photo input */
    const dz = $('dropzone');
    const input = $('file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', () => {
      if (input.files.length) addFiles(input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add('is-over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, () => dz.classList.remove('is-over'))
    );
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    // Dropping anywhere on the page works too; browsers otherwise navigate away.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    $('btn-clear').addEventListener('click', () => {
      if (!confirm('Remove all ' + state.photos.length + ' photos?')) return;
      state.photos.forEach(releasePhoto);
      state.photos = [];
      state.selectedId = null;
      App.idb.clear();
      App.clearSlotCache();
      refresh();
    });

    /* mode + layout controls */
    $('tab-grid').addEventListener('click', () => setMode('grid'));
    $('tab-pack').addEventListener('click', () => setMode('pack'));

    $('grid-source').addEventListener('change', (e) => {
      state.grid.source = e.target.value;
      saveSettings();
      refresh();
    });

    $('grid-size').addEventListener('change', (e) => {
      const v = e.target.value;
      state.grid.fill = v === '__fill';
      if (!state.grid.fill) state.grid.sizeId = v;
      saveSettings();
      refresh();
    });

    bindNumber('grid-custom-w', (v) => (state.grid.customW = v), 5, 1000);
    bindNumber('grid-custom-h', (v) => (state.grid.customH = v), 5, 1000);
    bindNumber('grid-count', (v) => (state.grid.count = v), 1, 2000);
    bindNumber('grid-fill-count', (v) => (state.grid.fillCount = v), 1, 200);

    $('grid-quick').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.count === 'fill') {
        const paper = currentPaper();
        const photo = selectedPhoto();
        const item = state.grid.fill ? null : gridItemSize(paper, photo);
        const fit =
          item &&
          App.gridFit(paper, state.settings.margin, state.settings.gap, item, state.settings.allowRotate);
        state.grid.count = fit ? fit.perSheet : state.grid.count;
      } else {
        state.grid.count = parseInt(chip.dataset.count, 10);
      }
      saveSettings();
      refresh();
    });

    $('pack-bulk-size').addEventListener('change', (e) => {
      if (!e.target.value) return;
      state.photos.forEach((p) => {
        p.sizeId = e.target.value;
        persistPhoto(p);
      });
      e.target.value = '';
      refresh();
    });

    $('paper').addEventListener('change', (e) => {
      state.settings.paperId = e.target.value;
      saveSettings();
      refresh();
    });
    bindNumber('paper-w', (v) => (state.settings.paperW = v), 20, 2000);
    bindNumber('paper-h', (v) => (state.settings.paperH = v), 20, 2000);
    bindNumber('margin', (v) => (state.settings.margin = v), 0, 50);
    bindNumber('gap', (v) => (state.settings.gap = v), 0, 30);

    document.querySelectorAll('[data-orient]').forEach((b) =>
      b.addEventListener('click', () => {
        state.settings.orientation = b.dataset.orient;
        saveSettings();
        refresh();
      })
    );
    document.querySelectorAll('[data-fit]').forEach((b) =>
      b.addEventListener('click', () => {
        state.settings.fit = b.dataset.fit;
        App.clearSlotCache();
        saveSettings();
        refresh();
      })
    );

    $('dpi').addEventListener('change', (e) => {
      state.settings.dpi = parseInt(e.target.value, 10);
      App.clearSlotCache();
      saveSettings();
      refresh();
    });
    $('cut-lines').addEventListener('change', (e) => {
      state.settings.cutLines = e.target.checked;
      saveSettings();
      refresh();
    });
    $('allow-rotate').addEventListener('change', (e) => {
      state.settings.allowRotate = e.target.checked;
      saveSettings();
      refresh();
    });

    /* editor */
    ['exposure', 'contrast', 'saturation', 'warmth', 'sharpen'].forEach((k) =>
      $('s-' + k).addEventListener('input', onAdjChange)
    );

    $('btn-auto').addEventListener('click', () => {
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo) return;
      photo.adj.auto = !photo.adj.auto;
      $('btn-auto').textContent = photo.adj.auto ? 'Auto-enhance: on' : 'Auto-enhance';
      renderEditorPreview();
    });

    $('btn-rot-l').addEventListener('click', () => rotateEditing(-90));
    $('btn-rot-r').addEventListener('click', () => rotateEditing(90));
    $('btn-upscale').addEventListener('click', runUpscale);
    $('btn-revert').addEventListener('click', revertPhoto);
    $('btn-editor-done').addEventListener('click', () => {
      closeModal($('modal-editor'));
      commitEditor();
    });

    $('btn-apply-all').addEventListener('click', async () => {
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo) return;
      busy('Applying to all photos…');
      try {
        for (const p of state.photos) {
          if (p.id === photo.id) continue;
          p.adj = Object.assign({}, photo.adj);
          await refreshPreviewImage(p);
          persistPhoto(p);
        }
        App.clearSlotCache();
        refresh();
        notice('Applied those adjustments to all ' + state.photos.length + ' photos.');
      } finally {
        unbusy();
      }
    });

    document.querySelectorAll('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => {
        const photo = editing && state.photos.find((p) => p.id === editing.id);
        if (!photo) return;
        const [x, y] = b.dataset.focus.split(',').map(Number);
        photo.focus = { x, y };
        document.querySelectorAll('[data-focus]').forEach((o) =>
          o.classList.toggle('is-active', o === b)
        );
        renderEditorPreview();
      })
    );

    /* search */
    $('btn-search').addEventListener('click', () => {
      fillQualityTiers();
      openModal('modal-search');
      $('search-query').focus();
      const keys = App.keys.read();
      if (!keys.pexels && !keys.unsplash) {
        const st = $('search-status');
        st.className = 'search-status';
        st.textContent =
          'Online search needs a free API key — open Settings to paste one. Everything else in the app works without it.';
      }
    });
    $('btn-do-search').addEventListener('click', () => doSearch(true));
    $('search-query').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch(true);
    });
    $('search-provider').addEventListener('change', () => {
      fillQualityTiers();
      $('search-results').innerHTML = '';
      $('search-status').textContent = '';
    });

    /* url */
    $('btn-url').addEventListener('click', () => {
      $('url-status').textContent = '';
      openModal('modal-url');
      $('url-input').focus();
    });
    $('btn-add-url').addEventListener('click', async () => {
      const url = $('url-input').value.trim();
      const st = $('url-status');
      if (!url) return;
      st.className = 'search-status';
      st.textContent = 'Fetching…';
      try {
        const blob = await App.fetchRemote(url);
        const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'Photo';
        await addPhotoFromBlob(blob, { name, source: 'url' });
        closeModal($('modal-url'));
        $('url-input').value = '';
        refresh();
      } catch (e) {
        st.className = 'search-status error';
        st.textContent =
          e.message + '. That site probably blocks other websites from reading its images — ' +
          'save the photo to your device and drop it in instead.';
      }
    });

    /* settings */
    $('btn-settings').addEventListener('click', () => {
      const keys = App.keys.read();
      $('key-pexels').value = keys.pexels || '';
      $('key-unsplash').value = keys.unsplash || '';
      $('opt-persist').checked = state.settings.persist;
      openModal('modal-settings');
    });
    $('btn-save-keys').addEventListener('click', () => {
      App.keys.write({
        pexels: $('key-pexels').value.trim(),
        unsplash: $('key-unsplash').value.trim()
      });
      const wasPersisting = state.settings.persist;
      state.settings.persist = $('opt-persist').checked;
      saveSettings();
      if (!state.settings.persist) App.idb.clear();
      else if (!wasPersisting) state.photos.forEach(persistPhoto);
      closeModal($('modal-settings'));
    });

    /* output */
    $('btn-print').addEventListener('click', doPrint);
    $('btn-print-2').addEventListener('click', doPrint);
    $('btn-pdf').addEventListener('click', doPdf);
    $('btn-pdf-2').addEventListener('click', doPdf);

    /* keep the preview scaled to the window */
    window.addEventListener('resize', () => scalePreview());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => scalePreview()).observe($('preview'));
    }
  }

  function rotateEditing(delta) {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    photo.rotate = ((photo.rotate || 0) + delta + 360) % 360;
    renderEditorPreview();
  }

  function setMode(mode) {
    state.settings.mode = mode;
    saveSettings();
    refresh();
  }

  function bindNumber(id, setter, lo, hi) {
    const el = $(id);
    const apply = () => {
      setter(clamp(parseFloat(el.value) || 0, lo, hi));
      saveSettings();
      refreshSoon();
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  }

  /* -------------------------------------------------------------- start-up */

  async function init() {
    loadSettings();
    fillSelects();
    wire();
    wireModals();
    syncControls();

    if (state.settings.persist) {
      busy('Restoring your photos…');
      try {
        await restorePhotos();
      } finally {
        unbusy();
      }
    }
    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
})((window.App = window.App || {}));
