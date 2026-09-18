/* Print Sheet — state, UI wiring and the glue between layout and rendering. */
(function (App) {
  'use strict';

  const SETTINGS_KEY = 'ppl.settings';
  const PRESETS_KEY = 'ppl.presets';
  const PREVIEW_SHEET_LIMIT = 15;
  const CONTACT_CAPTION_MM = 6;

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
      // Every print the same size, and nothing cropped: the photo sits inside
      // the chosen size. 'whole' trims each print to its own photo instead.
      fit: 'contain',
      autoOrient: true,    // turn the print to match the photo
      fitChosen: false,    // true once the user picks a fit themselves
      cutMarks: 'ticks',
      dpi: 300,
      allowRotate: true,
      mode: 'grid',
      persist: true,
      borderMm: 0,
      printerId: 'inkjet',
      printerEdge: 3.5,
      contactCols: 4,
      contactLabels: true
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

  let searchPage = { page: 1 };
  let searchResults = [];
  let editing = null;

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

  const isTyping = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

  /* ------------------------------------------------------------------ undo */

  const undoStack = [];

  function pushUndo(label, fn) {
    undoStack.push({ label, fn });
    if (undoStack.length > 40) undoStack.shift();
    syncUndo();
  }

  function syncUndo() {
    const btn = $('btn-undo');
    const top = undoStack[undoStack.length - 1];
    btn.disabled = !top;
    btn.title = top ? 'Undo ' + top.label : 'Nothing to undo';
  }

  function doUndo() {
    const entry = undoStack.pop();
    if (!entry) return;
    entry.fn();
    syncUndo();
    App.clearSlotCache();
    refresh();
    notice('Undid: ' + entry.label);
  }

  /* -------------------------------------------------------------- settings */

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ settings: state.settings, grid: state.grid })
      );
    } catch (e) {
      /* storage blocked — the app still works, it just won't remember */
    }
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      const s = raw.settings || {};
      // Older versions stored a boolean; corner marks are the new default.
      if (s.cutMarks === undefined && s.cutLines !== undefined) {
        s.cutMarks = s.cutLines ? 'ticks' : 'none';
      }
      delete s.cutLines;
      Object.assign(state.settings, s);
      // Cropping should never be the default. Anyone still on the old
      // fill-and-crop setting who never picked it deliberately moves across.
      if (!state.settings.fitChosen) state.settings.fit = 'contain';
      Object.assign(state.grid, raw.grid || {});
    } catch (e) {
      /* ignore corrupt settings */
    }
  }

  /* --------------------------------------------------------- saved presets */

  function readPresets() {
    try {
      const list = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writePresets(list) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    } catch (e) {
      notice('Could not save that setup — this browser is blocking storage.', 'error');
    }
  }

  function fillPresetSelect(selected) {
    const sel = $('preset-select');
    sel.innerHTML = '<option value="">Current settings</option>';
    for (const p of readPresets()) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.value = selected || '';
    $('btn-preset-delete').disabled = !sel.value;
  }

  function saveCurrentPreset() {
    const name = (prompt('Name this setup (e.g. "8 passport on A4"):') || '').trim();
    if (!name) return;
    const list = readPresets().filter((p) => p.name !== name);
    list.push({
      name,
      settings: Object.assign({}, state.settings),
      grid: Object.assign({}, state.grid)
    });
    writePresets(list);
    fillPresetSelect(name);
    notice('Saved "' + name + '".');
  }

  function applyPreset(name) {
    const preset = readPresets().find((p) => p.name === name);
    if (!preset) return;
    // `persist` is a privacy choice, not part of a layout setup.
    const keepPersist = state.settings.persist;
    Object.assign(state.settings, preset.settings, { persist: keepPersist });
    Object.assign(state.grid, preset.grid);
    saveSettings();
    App.clearSlotCache();
    refresh();
  }

  function deletePreset(name) {
    if (!name) return;
    writePresets(readPresets().filter((p) => p.name !== name));
    fillPresetSelect('');
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

  function defaultSizeRow() {
    return { sizeId: state.grid.sizeId || 'id_35x45', customW: 60, customH: 80, copies: 1 };
  }

  function rowDims(row) {
    if (row.sizeId === 'custom') return { w: row.customW || 60, h: row.customH || 80 };
    const s = App.findSize(row.sizeId);
    return { w: s.w, h: s.h };
  }

  /* The slot a photo should actually occupy.

     Two things go wrong when the slot's shape is dictated by the print size
     instead of the picture. A portrait photo dropped into a landscape slot
     loses its sides — which is what "cropped at the landscape ends" is — and
     fitting the whole photo instead pads the difference with white, wasting
     paper. So the slot is turned to match the photo's orientation, and in
     "whole photo" mode trimmed to the photo's exact shape: no crop, no padding.

     Identity sizes are the deliberate exception. A passport photo is 35×45
     whatever shape the original is, so it keeps its official size and is
     cropped to it — that one is not ours to decide. */
  function shapedSize(box, photo, sizeId) {
    const s = state.settings;
    let w = box.w;
    let h = box.h;
    if (!photo || !photo.w || !photo.h) return { w, h };

    const def = sizeId && sizeId !== 'custom' ? App.findSize(sizeId) : null;
    if (def && def.guide) return { w, h };

    const rot = (((photo.rotate || 0) % 360) + 360) % 360;
    const turned = rot === 90 || rot === 270;
    const aspect = (turned ? photo.h : photo.w) / (turned ? photo.w : photo.h);

    // A near-square photo has no orientation worth matching.
    if (s.autoOrient && Math.abs(aspect - 1) > 0.02 && (aspect > 1) !== (w > h)) {
      const t = w;
      w = h;
      h = t;
    }

    if (s.fit === 'whole') {
      let nw = w;
      let nh = w / aspect;
      if (nh > h) {
        nh = h;
        nw = h * aspect;
      }
      w = nw;
      h = nh;
    }
    return { w, h };
  }

  /* An identity photo has to fill its official frame whatever the global
     setting says — a passport photo with white bands down it is not a passport
     photo, and the head-height guides assume the picture reaches the edges. */
  function forcedFit(sizeId) {
    const def = sizeId && sizeId !== 'custom' ? App.findSize(sizeId) : null;
    return def && def.guide ? 'cover' : undefined;
  }

  function photoSizeRows(photo) {
    const rows = photo.sizes && photo.sizes.length ? photo.sizes : [defaultSizeRow()];
    return rows.map((r) =>
      Object.assign(
        { sizeId: r.sizeId, copies: r.copies || 0 },
        shapedSize(rowDims(r), photo, r.sizeId)
      )
    );
  }

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
      licence: photo.licence,
      profile: photo.profile,
      rotate: photo.rotate,
      focus: photo.focus,
      zoom: photo.zoom,
      adj: photo.adj,
      sizes: photo.sizes,
      texts: photo.texts,
      version: photo.version,
      enhanced: photo.enhanced
    });
  }

  async function buildThumbs(photo, source) {
    const thumbCanvas = App.makeThumb(source, 160);
    photo.thumbBlob = await App.canvasToBlob(thumbCanvas, 'image/jpeg', 0.85);
    if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    photo.thumbUrl = URL.createObjectURL(photo.thumbBlob);
    thumbCanvas.width = 0;
    await refreshPreviewImage(photo, source);
  }

  /* A tone-adjusted preview so the sheet on screen looks like what the printer
     will produce. */
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

  const previewSrc = (photo) => photo.previewUrl || photo.thumbUrl || '';

  async function addPhotoFromBlob(blob, meta) {
    const img = await App.blobToImage(blob);
    const photo = {
      id: uid(),
      name: (meta && meta.name) || 'Photo',
      blob,
      originalBlob: null,
      w: img.naturalWidth,
      h: img.naturalHeight,
      source: (meta && meta.source) || 'upload',
      credit: meta && meta.credit,
      creditUrl: meta && meta.creditUrl,
      licence: meta && meta.licence,
      profile: await App.readColourProfile(blob),
      rotate: 0,
      focus: { x: 0.5, y: 0.5 },
      zoom: 1,
      adj: Object.assign({}, App.DEFAULT_ADJ),
      sizes: [defaultSizeRow()],
      texts: [],
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
    const index = state.photos.findIndex((p) => p.id === id);
    if (index < 0) return;
    const photo = state.photos[index];
    state.photos.splice(index, 1);
    App.idb.delete(id);
    if (state.selectedId === id) state.selectedId = state.photos.length ? state.photos[0].id : null;

    pushUndo('removing ' + photo.name, () => {
      state.photos.splice(Math.min(index, state.photos.length), 0, photo);
      persistPhoto(photo);
    });
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
      photo.zoom = r.zoom || 1;
      photo.rotate = r.rotate || 0;
      photo.version = r.version || 0;
      // Older records carried a single size; sizes are a list now.
      photo.sizes =
        r.sizes && r.sizes.length
          ? r.sizes
          : [{ sizeId: r.sizeId || 'id_35x45', customW: r.customW || 60, customH: r.customH || 80, copies: r.copies || 1 }];
      photo.texts = r.texts || [];
      photo.thumbUrl = r.thumbBlob ? URL.createObjectURL(r.thumbBlob) : null;
      photo.previewUrl = null;
      state.photos.push(photo);
      // Re-derive the adjusted preview lazily; the plain thumb shows meanwhile.
      refreshPreviewImage(photo).then(refreshSoon);
    }
    if (state.photos.length) state.selectedId = state.photos[0].id;
  }

  /* ------------------------------------------------------------ geometry */

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

  const selectedPhoto = () => state.photos.find((p) => p.id === state.selectedId) || null;

  function gridItemSize(paper, photo) {
    const g = state.grid;
    if (g.fill) {
      const ref = photo || selectedPhoto() || state.photos[0];
      const aspect = ref ? ref.w / ref.h : 3 / 4;
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
    const ref = photo || selectedPhoto();
    if (g.sizeId === 'custom') {
      return shapedSize({ w: g.customW, h: g.customH }, ref, 'custom');
    }
    const s = App.findSize(g.sizeId);
    return shapedSize({ w: s.w, h: s.h }, ref, g.sizeId);
  }

  function contactCellSize(paper) {
    const s = state.settings;
    const cols = clamp(s.contactCols, 1, 12);
    const usableW = paper.w - s.margin * 2;
    const cellW = (usableW - (cols - 1) * s.gap) / cols;
    return { w: Math.max(1, cellW), h: Math.max(1, cellW) };
  }

  /* Settings as the renderer should see them for the current mode. */
  function renderSettings() {
    const s = Object.assign({}, state.settings);
    if (s.mode === 'contact') {
      s.fit = 'contain'; // a contact sheet must never crop
      s.borderMm = 0;
    } else {
      s.contactLabels = false;
      // The slot was already trimmed to the photo's shape, so filling it crops
      // nothing. Identity sizes kept their official shape, and those do crop.
      if (s.fit === 'whole') s.fit = 'cover';
    }
    return s;
  }

  /* The size a photo's image area will occupy, border excluded — the only
     figure for which a DPI number is meaningful. */
  function targetSizeFor(photo) {
    const s = state.settings;
    const paper = currentPaper();
    let box;
    if (s.mode === 'contact') box = contactCellSize(paper);
    else if (s.mode === 'pack') {
      const rows = photoSizeRows(photo);
      box = rows.length ? { w: rows[0].w, h: rows[0].h } : { w: 35, h: 45 };
    } else box = gridItemSize(paper, photo);

    const rs = renderSettings();
    const b = Math.min(rs.borderMm || 0, (box.w - 1) / 2, (box.h - 1) / 2);
    const border = Math.max(0, b);
    return { w: box.w - border * 2, h: box.h - border * 2 };
  }

  function targetSizeDef(photo) {
    const s = state.settings;
    if (s.mode === 'contact') return null;
    if (s.mode === 'pack') {
      const rows = photo.sizes && photo.sizes.length ? photo.sizes : [defaultSizeRow()];
      return App.findSize(rows[0].sizeId);
    }
    return state.grid.fill ? null : App.findSize(state.grid.sizeId);
  }

  /* What will really happen to this photo, which is not always the global
     setting: an identity size fills its frame whatever else is chosen. The
     editor and the resolution badge have to agree with the print. */
  function effectiveFit(photo) {
    const def = targetSizeDef(photo);
    if (def && def.guide) return 'cover';
    return renderSettings().fit;
  }

  /* ---------------------------------------------------------------- layout */

  function computeLayout() {
    const paper = currentPaper();
    const s = state.settings;
    const margin = clamp(s.margin, 0, Math.min(paper.w, paper.h) / 2 - 1);
    const gap = Math.max(0, s.gap);
    const base = { paper, margin, gap, allowRotate: s.allowRotate };

    if (!state.photos.length) return { paper, pages: [], perSheet: 0 };

    if (s.mode === 'contact') {
      const res = App.layoutContact({
        paper,
        margin,
        gap,
        photos: state.photos,
        cols: clamp(s.contactCols, 1, 12),
        captionMm: s.contactLabels ? CONTACT_CAPTION_MM : 0
      });
      return {
        paper,
        pages: res.pages,
        perSheet: res.perSheet,
        itemSize: contactCellSize(paper)
      };
    }

    if (s.mode === 'pack') {
      const entries = [];
      for (const photo of state.photos) {
        for (const row of photoSizeRows(photo)) {
          if (row.copies > 0) {
            entries.push({
              photoId: photo.id,
              w: row.w,
              h: row.h,
              copies: row.copies,
              fit: forcedFit(row.sizeId)
            });
          }
        }
      }
      if (!entries.length) return { paper, pages: [], perSheet: 0 };
      const res = App.layoutPack(Object.assign({ entries }, base));
      return {
        paper,
        pages: res.pages,
        perSheet: res.pages.length ? res.pages[0].items.length : 0,
        oversized: res.oversized
      };
    }

    const g = state.grid;

    if (g.source === 'all') {
      // Every photo at the same size, sheets filled right up before a new one
      // is started. Giving each photo its own sheet leaves most of the paper
      // empty when only a couple of copies are wanted.
      const count = g.fill ? Math.max(1, g.fillCount) : Math.max(1, g.count);
      const entries = state.photos.map((photo) =>
        Object.assign(
          { photoId: photo.id, copies: count, fit: forcedFit(g.sizeId) },
          gridItemSize(paper, photo)
        )
      );
      if (!entries.length) return { paper, pages: [], perSheet: 0 };
      const res = App.layoutPack(Object.assign({ entries }, base));
      return {
        paper,
        pages: res.pages,
        perSheet: res.pages.length ? res.pages[0].items.length : 0,
        oversized: res.oversized,
        itemSize: gridItemSize(paper, state.photos[0])
      };
    }

    const targets = g.source === 'each' ? state.photos : [selectedPhoto()].filter(Boolean);
    if (!targets.length) return { paper, pages: [], perSheet: 0 };

    const pages = [];
    let perSheet = 0;
    let tooBig = 0;
    for (const photo of targets) {
      const item = gridItemSize(paper, photo);
      const count = g.fill ? Math.max(1, g.fillCount) : Math.max(1, g.count);
      const res = App.layoutGrid(
        Object.assign({ item, count, photoId: photo.id, slotFit: forcedFit(g.sizeId) }, base)
      );
      if (res.error === 'too-big') {
        tooBig++;
        continue;
      }
      perSheet = res.perSheet;
      pages.push(...res.pages);
    }
    return { paper, pages, perSheet, tooBig, itemSize: gridItemSize(paper, targets[0]) };
  }

  /* How many photos stray into the band the printer physically cannot reach. */
  function clippedCount(layout, paper) {
    const s = state.settings;
    const edges = App.printerEdges(s.printerId, s.printerEdge);
    if (!edges.top && !edges.bottom && !edges.left && !edges.right) return 0;
    const rs = renderSettings();
    let clipped = 0;
    for (const page of layout.pages) {
      for (const item of page.items) {
        const capH = rs.contactLabels && item.caption ? item.captionH || 0 : 0;
        if (
          item.x < edges.left - 0.01 ||
          item.y < edges.top - 0.01 ||
          item.x + item.w > paper.w - edges.right + 0.01 ||
          item.y + item.h + capH > paper.h - edges.bottom + 0.01
        ) {
          clipped++;
        }
      }
    }
    return clipped;
  }

  /* --------------------------------------------------------------- preview */

  let lastLayout = { paper: currentPaper(), pages: [] };

  function refresh() {
    renderLibrary();
    syncControls();

    const layout = computeLayout();
    lastLayout = layout;
    const paper = layout.paper;
    const rs = renderSettings();

    $('stat-sheets').textContent = layout.pages.length;
    $('stat-per').textContent = layout.perSheet || 0;
    $('stat-fill').textContent = Math.round(App.efficiency(layout.pages, paper) * 100) + '%';
    $('stat-size').textContent =
      state.settings.mode === 'pack'
        ? 'mixed'
        : layout.itemSize
        ? App.fmtMm(layout.itemSize.w) + ' × ' + App.fmtMm(layout.itemSize.h)
        : '—';

    const messages = [];
    let isError = false;
    if (layout.tooBig) {
      messages.push(layout.tooBig + ' photo(s) will not fit this sheet at that size.');
      isError = true;
    }
    if (layout.oversized && layout.oversized.length) {
      messages.push(layout.oversized.length + ' photo(s) are larger than the sheet and were skipped.');
      isError = true;
    }

    const clipped = clippedCount(layout, paper);
    if (clipped) {
      const edges = App.printerEdges(state.settings.printerId, state.settings.printerEdge);
      const needed = Math.max(edges.top, edges.bottom, edges.left, edges.right);
      messages.push(
        clipped + ' photo(s) reach into the area your printer cannot print — raise the page ' +
        'margin to about ' + App.fmtMm(needed) + ', or choose a borderless printer.'
      );
      isError = true;
    }

    const wide = state.photos.filter((p) => App.profileWarning(p.profile)).length;
    if (wide) {
      messages.push(
        wide + ' photo(s) use a wider-than-sRGB colour profile, so strong colours will print a little duller.'
      );
    }

    if (layout.pages.length > PREVIEW_SHEET_LIMIT) {
      messages.push(
        'Showing the first ' + PREVIEW_SHEET_LIMIT + ' of ' + layout.pages.length +
        ' sheets — all of them will print.'
      );
    }
    notice(messages.join(' '), isError ? 'error' : '');

    renderSheets(layout, paper, rs);
    const hasPages = layout.pages.length > 0;
    ['btn-print', 'btn-print-2', 'btn-pdf', 'btn-pdf-2'].forEach((id) => ($(id).disabled = !hasPages));
  }

  function renderSheets(layout, paper, rs) {
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
      wrap.appendChild(App.buildSheet(page, paper, byId, rs, previewSrc));

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

  let dragId = null;

  function renderLibrary() {
    const host = $('library');
    host.innerHTML = '';
    const n = state.photos.length;
    $('library-count').textContent = n ? n + (n === 1 ? ' photo' : ' photos') : 'No photos yet';
    $('btn-clear').hidden = !n;
    $('btn-enhance-all').hidden = !n;

    const rs = renderSettings();

    for (const photo of state.photos) {
      const li = document.createElement('li');
      li.className = 'lib-item' + (photo.id === state.selectedId ? ' is-selected' : '');
      li.draggable = true;
      li.dataset.id = photo.id;
      wireReorder(li, photo);

      const thumb = document.createElement('img');
      thumb.className = 'lib-thumb';
      thumb.src = previewSrc(photo);
      thumb.alt = photo.name;
      thumb.title = 'Select this photo — drag to reorder';
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
      const dpi =
        App.effectiveDpi(photo.w, photo.h, target.w, target.h, effectiveFit(photo)) /
        Math.max(1, photo.zoom || 1);
      const verdict = App.dpiVerdict(dpi);

      // A poor resolution badge is exactly the moment someone needs help, so
      // make it the way in rather than a dead label.
      const dpiBadge = document.createElement('button');
      dpiBadge.type = 'button';
      dpiBadge.className = 'badge ' + verdict.level;
      dpiBadge.textContent = Math.round(dpi) + ' DPI · ' + verdict.label;
      dpiBadge.title =
        'Resolution at ' + App.fmtMm(target.w) + ' × ' + App.fmtMm(target.h) +
        ' — click to enhance or upscale this photo';
      dpiBadge.addEventListener('click', () => openEditor(photo.id));
      meta.appendChild(dpiBadge);

      if (photo.enhanced) {
        const tag = document.createElement('span');
        tag.className = 'badge ai';
        tag.textContent = photo.enhanced === 'ai' ? 'AI upscaled' : 'Upscaled';
        meta.appendChild(tag);
      }

      const profileNote = App.profileWarning(photo.profile);
      if (profileNote) {
        const tag = document.createElement('span');
        tag.className = 'badge warn';
        tag.textContent = 'Wide gamut';
        tag.title = profileNote;
        meta.appendChild(tag);
      }

      const px = document.createElement('span');
      px.textContent = photo.w + '×' + photo.h;
      meta.appendChild(px);

      body.append(name, meta);

      if (state.settings.mode === 'pack') body.appendChild(buildSizeRows(photo));

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

  /* A photo can be wanted at several sizes at once — one 4R plus eight passport
     is an ordinary request, and duplicating the photo to express it is not. */
  function buildSizeRows(photo) {
    const wrap = document.createElement('div');
    wrap.className = 'size-rows';
    const rows = photo.sizes && photo.sizes.length ? photo.sizes : (photo.sizes = [defaultSizeRow()]);

    rows.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'size-row';

      const sel = buildSizeSelect(row.sizeId, false);
      sel.addEventListener('change', () => {
        row.sizeId = sel.value;
        persistPhoto(photo);
        refresh();
      });

      const copies = document.createElement('input');
      copies.type = 'number';
      copies.min = '0';
      copies.max = '500';
      copies.value = row.copies;
      copies.title = 'Number of copies';
      copies.addEventListener('change', () => {
        row.copies = clamp(parseInt(copies.value, 10) || 0, 0, 500);
        persistPhoto(photo);
        refresh();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.textContent = '×';
      del.title = 'Remove this size';
      del.disabled = rows.length < 2;
      del.addEventListener('click', () => {
        const removed = rows.splice(index, 1)[0];
        pushUndo('removing a size from ' + photo.name, () => {
          rows.splice(index, 0, removed);
          persistPhoto(photo);
        });
        persistPhoto(photo);
        refresh();
      });

      line.append(sel, copies, del);
      wrap.appendChild(line);

      if (row.sizeId === 'custom') {
        const custom = document.createElement('div');
        custom.className = 'size-custom';
        custom.append(
          numberInput(row.customW || 60, (v) => {
            row.customW = v;
            persistPhoto(photo);
            refresh();
          }, 'Width mm'),
          numberInput(row.customH || 80, (v) => {
            row.customH = v;
            persistPhoto(photo);
            refresh();
          }, 'Height mm')
        );
        wrap.appendChild(custom);
      }
    });

    const add = linkButton('+ Add another size', () => {
      rows.push(defaultSizeRow());
      persistPhoto(photo);
      refresh();
    });
    wrap.appendChild(add);
    return wrap;
  }

  function wireReorder(li, photo) {
    li.addEventListener('dragstart', (e) => {
      dragId = photo.id;
      li.classList.add('is-dragging');
      // Marks this as an internal reorder so the file drop handler ignores it.
      e.dataTransfer.setData('text/x-ppl-photo', photo.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      li.classList.remove('is-dragging');
      document.querySelectorAll('.lib-item').forEach((n) => n.classList.remove('drop-target'));
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === photo.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', (e) => {
      if (!dragId || dragId === photo.id) return;
      e.preventDefault();
      e.stopPropagation();
      const from = state.photos.findIndex((p) => p.id === dragId);
      const to = state.photos.findIndex((p) => p.id === photo.id);
      if (from < 0 || to < 0) return;
      const [moved] = state.photos.splice(from, 1);
      state.photos.splice(to, 0, moved);
      pushUndo('reordering photos', () => {
        const back = state.photos.findIndex((p) => p.id === moved.id);
        state.photos.splice(back, 1);
        state.photos.splice(from, 0, moved);
      });
      dragId = null;
      refresh();
    });
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
    for (const s of App.SIZES) (groups[s.group] = groups[s.group] || []).push(s);
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

    const printerSel = $('printer');
    for (const p of App.PRINTERS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      printerSel.appendChild(o);
    }

    fillTextSelects();
    fillJobRow();
    fillPresetSelect('');
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
    $('border-mm').value = s.borderMm;
    $('cut-marks').value = s.cutMarks;
    $('allow-rotate').checked = s.allowRotate;
    $('auto-orient').checked = s.autoOrient;
    $('printer').value = s.printerId;
    $('printer-custom').hidden = s.printerId !== 'custom';
    $('printer-edge').value = s.printerEdge;
    $('contact-cols').value = s.contactCols;
    $('contact-labels').checked = s.contactLabels;

    document.querySelectorAll('[data-orient]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.orient === s.orientation)
    );
    document.querySelectorAll('[data-fit]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.fit === s.fit)
    );

    const modes = { grid: 'tab-grid', pack: 'tab-pack', contact: 'tab-contact' };
    for (const [mode, id] of Object.entries(modes)) {
      const active = s.mode === mode;
      $(id).classList.toggle('is-active', active);
      $(id).setAttribute('aria-selected', String(active));
    }
    $('mode-grid').hidden = s.mode !== 'grid';
    $('mode-pack').hidden = s.mode !== 'pack';
    $('mode-contact').hidden = s.mode !== 'contact';

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

  /* ---------------------------------------------------------------- editor */

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
      editing = {
        id,
        source: work,
        beforeUrl: URL.createObjectURL(beforeBlob),
        before: Object.assign({}, photo.adj),
        beforeFocus: Object.assign({}, photo.focus),
        beforeZoom: photo.zoom || 1,
        beforeRotate: photo.rotate || 0,
        beforeTexts: JSON.parse(JSON.stringify(photo.texts || [])),
        selectedTextId: null,
        frame: null
      };

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

    const zoom = photo.zoom || 1;
    $('s-zoom').value = Math.round(zoom * 100);
    $('v-zoom').textContent = zoom.toFixed(1) + '×';

    const f = photo.focus || { x: 0.5, y: 0.5 };
    const key = f.x + ',' + f.y;
    document.querySelectorAll('[data-focus]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.focus === key)
    );

    const warning = App.profileWarning(photo.profile);
    $('editor-profile').hidden = !warning;
    if (warning) $('editor-profile').textContent = warning;

    if (editing) {
      const texts = photo.texts || [];
      const stillThere = texts.some((t) => t.id === editing.selectedTextId);
      if (!stillThere) editing.selectedTextId = texts.length ? texts[0].id : null;
      renderTextList(photo);
      syncTextControls(photo);
    }
  }

  /* Live preview of exactly what will land in the slot: cropped, rotated and
     tone-corrected, at the size this photo will actually print. */
  function renderEditorPreview() {
    if (!editing) return;
    const photo = state.photos.find((p) => p.id === editing.id);
    if (!photo) return;

    const rs = renderSettings();
    // The preview has to show what will print, and an identity size fills its
    // frame whatever the global setting says.
    rs.fit = effectiveFit(photo);
    const target = targetSizeFor(photo);
    const rot = (((photo.rotate || 0) % 360) + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const slotW = swapped ? target.h : target.w;
    const slotH = swapped ? target.w : target.h;

    const scale = 520 / Math.max(slotW, slotH);
    const canvasW = Math.max(1, Math.round(slotW * scale));
    const canvasH = Math.max(1, Math.round(slotH * scale));

    const canvas = App.renderSlot(editing.source, canvasW, canvasH, {
      fit: rs.fit,
      rotate: rot,
      focus: photo.focus,
      zoom: photo.zoom,
      adj: Object.assign({}, photo.adj, { sharpen: 0 }),
      dpi: 96
    });
    $('editor-after').src = canvas.toDataURL('image/jpeg', 0.9);
    canvas.width = 0;

    // Remember the geometry so dragging can translate pointer movement into a
    // focal-point change without guessing.
    const boxW = swapped ? canvasH : canvasW;
    const boxH = swapped ? canvasW : canvasH;
    const geo = App.slotGeometry(editing.source.width, editing.source.height, boxW, boxH, rs.fit, photo.zoom);
    editing.frame = {
      rot,
      canvasW,
      overflowX: Math.max(0, geo.drawW - boxW),
      overflowY: Math.max(0, geo.drawH - boxH)
    };

    const canPan = editing.frame.overflowX > 0.5 || editing.frame.overflowY > 0.5;
    $('crop-hint').hidden = !canPan;
    $('crop-stage').style.cursor = canPan ? 'grab' : 'default';

    updateGuide(targetSizeDef(photo), rot);
    updateDpiReport(photo, target, rs);
    // The preview image has just been replaced, so its box may have resized.
    renderTextOverlay();
  }

  /* Identity photos are rejected when the head is the wrong size or the eyes sit
     at the wrong height, so show where they need to be. */
  function updateGuide(sizeDef, rot) {
    const svg = $('crop-guide');
    const guide = sizeDef && sizeDef.guide;
    if (!guide || rot % 180 !== 0) {
      svg.hidden = true;
      svg.innerHTML = '';
      return;
    }
    const top = guide.headTop * 100;
    const bottom = guide.headBottom * 100;
    const ry = (bottom - top) / 2;
    const cy = top + ry;
    const eye = guide.eyeLine * 100;
    svg.innerHTML =
      '<ellipse cx="50" cy="' + cy + '" rx="31" ry="' + ry + '"></ellipse>' +
      '<line x1="6" y1="' + eye + '" x2="94" y2="' + eye + '"></line>';
    svg.hidden = false;
  }

  function updateDpiReport(photo, target, rs) {
    const zoom = Math.max(1, photo.zoom || 1);
    const dpi = App.effectiveDpi(photo.w, photo.h, target.w, target.h, rs.fit) / zoom;
    const verdict = App.dpiVerdict(dpi);
    $('editor-dpi').innerHTML =
      'At <b>' + App.fmtMm(target.w) + ' × ' + App.fmtMm(target.h) + '</b> this prints at ' +
      '<b>' + Math.round(dpi) + ' DPI</b> — <span class="badge ' + verdict.level + '">' +
      verdict.label + '</span><br><span class="muted small">Source ' + photo.w + ' × ' + photo.h +
      ' px. 300 DPI is the usual target for photo prints; below about 150 DPI softness is visible.</span>';

    const factor = App.upscaleFactorFor(photo.w, photo.h, target.w, target.h, rs.fit, 300, zoom);
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

  /* Pointer movement is in screen space; the photo may be rotated inside its
     slot, so map the drag back onto the image's own axes first. */
  function mapDrag(rot, dx, dy) {
    switch (rot) {
      case 90:
        return { du: dy, dv: -dx };
      case 180:
        return { du: -dx, dv: -dy };
      case 270:
        return { du: -dy, dv: dx };
      default:
        return { du: dx, dv: dy };
    }
  }

  function wireCropDrag() {
    const stage = $('crop-stage');
    let active = false;
    let lastX = 0;
    let lastY = 0;

    stage.addEventListener('pointerdown', (e) => {
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo || !editing.frame) return;
      if (editing.frame.overflowX < 0.5 && editing.frame.overflowY < 0.5) return;
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      stage.classList.add('is-dragging');
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer id not active (synthetic events, odd input devices) */
      }
      e.preventDefault();
    });

    stage.addEventListener('pointermove', (e) => {
      if (!active) return;
      const photo = state.photos.find((p) => p.id === editing.id);
      if (!photo) return;

      const img = $('editor-after');
      const shown = img.clientWidth || 1;
      // Screen pixels -> preview-canvas pixels.
      const k = editing.frame.canvasW / shown;
      const { du, dv } = mapDrag(editing.frame.rot, (e.clientX - lastX) * k, (e.clientY - lastY) * k);
      lastX = e.clientX;
      lastY = e.clientY;

      const focus = photo.focus || { x: 0.5, y: 0.5 };
      if (editing.frame.overflowX > 0.5) focus.x = clamp(focus.x - du / editing.frame.overflowX, 0, 1);
      if (editing.frame.overflowY > 0.5) focus.y = clamp(focus.y - dv / editing.frame.overflowY, 0, 1);
      photo.focus = focus;
      renderEditorPreview();
    });

    const stop = (e) => {
      if (!active) return;
      active = false;
      stage.classList.remove('is-dragging');
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already gone */
      }
      document.querySelectorAll('[data-focus]').forEach((b) => b.classList.remove('is-active'));
    };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
  }

  async function commitEditor() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;

    const snapshot = editing;
    const changed =
      JSON.stringify(snapshot.before) !== JSON.stringify(photo.adj) ||
      JSON.stringify(snapshot.beforeTexts) !== JSON.stringify(photo.texts || []) ||
      snapshot.beforeZoom !== (photo.zoom || 1) ||
      snapshot.beforeRotate !== (photo.rotate || 0) ||
      snapshot.beforeFocus.x !== photo.focus.x ||
      snapshot.beforeFocus.y !== photo.focus.y;

    if (changed) {
      pushUndo('editing ' + photo.name, () => {
        photo.adj = Object.assign({}, snapshot.before);
        photo.focus = Object.assign({}, snapshot.beforeFocus);
        photo.zoom = snapshot.beforeZoom;
        photo.rotate = snapshot.beforeRotate;
        photo.texts = JSON.parse(JSON.stringify(snapshot.beforeTexts));
        refreshPreviewImage(photo).then(refreshSoon);
        persistPhoto(photo);
      });
    }

    App.clearSlotCache();
    await refreshPreviewImage(photo);
    persistPhoto(photo);
    refresh();
  }

  /* ------------------------------------------------------------------ text */

  function selectedText(photo) {
    if (!editing || !editing.selectedTextId) return null;
    return (photo.texts || []).find((t) => t.id === editing.selectedTextId) || null;
  }

  function fillTextSelects() {
    const style = $('text-style');
    for (const s of App.TEXT_STYLES) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      style.appendChild(o);
    }
    const font = $('text-font');
    for (const f of App.TEXT_FONTS) {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.name;
      font.appendChild(o);
    }
  }

  function renderTextList(photo) {
    const host = $('text-list');
    host.innerHTML = '';
    for (const t of photo.texts || []) {
      const li = document.createElement('li');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'text-chip' + (t.id === editing.selectedTextId ? ' is-active' : '');
      chip.textContent = (t.text || '(empty)').replace(/\n/g, ' ').slice(0, 30);
      chip.addEventListener('click', () => {
        editing.selectedTextId = t.id;
        renderTextList(photo);
        syncTextControls(photo);
        renderTextOverlay();
      });
      li.appendChild(chip);
      host.appendChild(li);
    }
    $('text-editor').hidden = !selectedText(photo);
  }

  function syncTextControls(photo) {
    const t = selectedText(photo);
    $('text-editor').hidden = !t;
    if (!t) return;
    // Don't fight the caret while the user is typing in the box.
    if (document.activeElement !== $('text-content')) $('text-content').value = t.text;
    $('text-style').value = t.style;
    $('text-font').value = t.font;
    $('text-size').value = Math.round(t.sizePct * 100);
    $('v-text-size').textContent = Math.round(t.sizePct * 100) + '%';
    $('text-color').value = t.color;
    $('text-accent').value = t.accent;
    document.querySelectorAll('[data-align]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.align === t.align)
    );
    $('btn-text-bold').classList.toggle('is-active', !!t.bold);
    $('btn-text-italic').classList.toggle('is-active', !!t.italic);
  }

  function renderTextOverlay() {
    const host = $('text-overlay');
    if (!host) return;
    host.innerHTML = '';
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo || !photo.texts || !photo.texts.length) return;

    const img = $('editor-after');
    const boxW = img.clientWidth;
    const boxH = img.clientHeight;
    if (!boxW || !boxH) {
      // Opening the editor sets the preview's src but the browser has not laid
      // it out yet, so there is no box to place words in. Come back when there
      // is, or a photo that already has text would open showing none of it.
      img.addEventListener('load', renderTextOverlay, { once: true });
      return;
    }

    for (const t of photo.texts) {
      const el = App.buildTextEl(t, boxW, boxH, 'px');
      if (!el) continue;
      el.dataset.textId = t.id;
      if (t.id === editing.selectedTextId) el.classList.add('is-selected');
      host.appendChild(el);
    }
  }

  function textChanged(photo) {
    App.clearSlotCache();
    renderTextOverlay();
    persistPhoto(photo);
    refreshSoon();
  }

  function addText() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    photo.texts = photo.texts || [];
    const t = App.defaultText();
    photo.texts.push(t);
    editing.selectedTextId = t.id;
    renderTextList(photo);
    syncTextControls(photo);
    textChanged(photo);
    $('text-content').focus();
    $('text-content').select();
  }

  function deleteText() {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    const t = photo && selectedText(photo);
    if (!t) return;
    photo.texts = photo.texts.filter((x) => x.id !== t.id);
    editing.selectedTextId = photo.texts.length ? photo.texts[photo.texts.length - 1].id : null;
    renderTextList(photo);
    syncTextControls(photo);
    textChanged(photo);
  }

  /* `resync` repaints the controls too — needed for toggles, but not while
     typing, where rewriting the textarea would move the caret. */
  function updateSelectedText(apply, resync) {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    const t = photo && selectedText(photo);
    if (!t) return;
    apply(t);
    renderTextList(photo);
    if (resync) syncTextControls(photo);
    textChanged(photo);
  }

  /* Words are dragged directly on the preview. The overlay itself ignores
     pointer events, so a drag starting on empty space still pans the photo. */
  function wireTextDrag() {
    const host = $('text-overlay');
    let active = null;
    let startX = 0;
    let startY = 0;
    let fromX = 0;
    let fromY = 0;
    let boxW = 1;
    let boxH = 1;

    const onMove = (e) => {
      if (!active) return;
      active.xPct = clamp(fromX + (e.clientX - startX) / boxW, 0, 1);
      active.yPct = clamp(fromY + (e.clientY - startY) / boxH, 0, 1);
      renderTextOverlay();
    };
    const onUp = () => {
      if (!active) return;
      active = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (photo) textChanged(photo);
    };

    host.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.ptext');
      if (!el) return;
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo) return;
      const t = (photo.texts || []).find((x) => x.id === el.dataset.textId);
      if (!t) return;

      e.preventDefault();
      e.stopPropagation(); // keep the photo from panning underneath
      editing.selectedTextId = t.id;

      const img = $('editor-after');
      boxW = img.clientWidth || 1;
      boxH = img.clientHeight || 1;
      active = t;
      startX = e.clientX;
      startY = e.clientY;
      fromX = t.xPct;
      fromY = t.yPct;

      renderTextList(photo);
      syncTextControls(photo);
      renderTextOverlay();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
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
      if (editing.source && editing.source.width) editing.source.width = 0;
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
      if (editing.source && editing.source.width) editing.source.width = 0;
      editing.source = App.makeThumb(img, 900);
      persistPhoto(photo);
      syncEditorControls(photo);
      renderEditorPreview();
      refresh();
    } finally {
      unbusy();
    }
  }

  /* ------------------------------------------------------ quick start & help */

  const PRINT_HELP_KEY = 'ppl.skipPrintHelp';

  function fillJobRow() {
    const host = $('job-row');
    for (const job of App.JOB_PRESETS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'job-chip';
      chip.textContent = job.name;
      chip.title = job.hint;
      chip.dataset.job = job.id;
      host.appendChild(chip);
    }
  }

  /* One click should be enough for the job someone actually came here to do. */
  function applyJobPreset(id) {
    const job = App.JOB_PRESETS.find((j) => j.id === id);
    if (!job) return;
    const beforeSettings = Object.assign({}, state.settings);
    const beforeGrid = Object.assign({}, state.grid);

    Object.assign(state.settings, job.settings);
    Object.assign(state.grid, job.grid || {});

    pushUndo('the "' + job.name + '" quick start', () => {
      Object.assign(state.settings, beforeSettings);
      Object.assign(state.grid, beforeGrid);
    });
    App.clearSlotCache();
    saveSettings();
    refresh();
    notice(job.hint + '.');
  }

  async function enhanceAll() {
    if (!state.photos.length) return;
    busy('Improving photos…');
    try {
      const before = state.photos.map((p) => Object.assign({}, p.adj));
      for (const p of state.photos) {
        p.adj.auto = true;
        await refreshPreviewImage(p);
        persistPhoto(p);
      }
      pushUndo('improving all photos', () => {
        state.photos.forEach((p, i) => {
          if (before[i]) p.adj = before[i];
          refreshPreviewImage(p);
          persistPhoto(p);
        });
      });
      App.clearSlotCache();
      refresh();
      notice(
        'Auto-enhanced all ' + state.photos.length + ' photos — undo if you preferred them as they were.'
      );
    } finally {
      unbusy();
    }
  }

  function doTestSheet() {
    const open = openModalEl();
    if (open) closeModal(open);
    App.printTestSheet(currentPaper());
  }

  /* ---------------------------------------------------------------- search */

  async function doSearch(reset) {
    const provider = $('search-provider').value;
    const query = $('search-query').value.trim();
    const status = $('search-status');
    if (!query) {
      status.className = 'search-status';
      status.textContent = 'Type something to search for.';
      return;
    }
    if (reset) {
      searchPage = { page: 1 };
      searchResults = [];
      $('search-results').innerHTML = '';
    }
    status.className = 'search-status';
    status.textContent = 'Searching ' + App.PROVIDERS[provider].name + '…';

    try {
      const res = await App.search(provider, query, searchPage.page);
      status.textContent = res.total
        ? Number(res.total).toLocaleString() + ' results — click a photo to add it'
        : 'No results for that search.';
      renderResults(res.results);
    } catch (e) {
      status.className = 'search-status error';
      status.textContent = e.message;
    }
  }

  function renderResults(results) {
    const host = $('search-results');
    const oldMore = host.querySelector('.load-more');
    if (oldMore) oldMore.remove();

    for (const r of results) {
      searchResults.push(r);
      const fig = document.createElement('figure');
      fig.className = 'result';
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');

      const img = document.createElement('img');
      img.src = r.thumb;
      img.alt = r.credit ? 'Photo by ' + r.credit : 'Search result';
      img.loading = 'lazy';

      const cap = document.createElement('figcaption');
      cap.textContent =
        (r.credit ? r.credit + ' · ' : '') + r.width + '×' + r.height + (r.licence ? ' · ' + r.licence : '');
      cap.title = cap.textContent;

      fig.append(img, cap);
      const add = () => addSearchResult(r, fig);
      fig.addEventListener('click', add);
      fig.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          add();
        }
      });
      host.appendChild(fig);
    }

    if (results.length >= 24) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-soft load-more';
      more.textContent = 'Load more';
      more.addEventListener('click', () => {
        more.remove();
        searchPage.page++;
        doSearch(false);
      });
      host.appendChild(more);
    }
  }

  async function addSearchResult(result, node) {
    const tier = $('search-quality').value;
    busy('Downloading photo…');
    try {
      const url = await App.resolveResultUrl(result, tier);
      const blob = await App.fetchRemote(url);
      await addPhotoFromBlob(blob, {
        name: (result.credit || result.provider) + ' — ' + (result.title || result.id),
        source: result.provider,
        credit: result.credit,
        creditUrl: result.creditUrl,
        licence: result.licence
      });
      if (result.provider === 'unsplash') App.trackUnsplashDownload(result);
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
    const tiers = App.PROVIDERS[provider].tiers;
    sel.innerHTML = '';
    for (const t of tiers) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    }
    // Default to the largest tier: print needs the pixels.
    sel.value = tiers[tiers.length - 1].id;
  }

  /* ---------------------------------------------------------------- modals */

  let lastFocused = null;

  function focusables(root) {
    return Array.from(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
  }

  function openModal(id) {
    lastFocused = document.activeElement;
    const modal = $(id);
    modal.hidden = false;
    const first = focusables(modal)[0];
    if (first) first.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openModalEl() {
    return Array.from(document.querySelectorAll('.modal')).find((m) => !m.hidden);
  }

  function wireModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) dismiss(modal);
      });
      modal.querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => dismiss(modal))
      );
    });

    document.addEventListener('keydown', (e) => {
      const modal = openModalEl();
      if (!modal) return;

      if (e.key === 'Escape') {
        dismiss(modal);
        return;
      }
      // Keep Tab inside the dialog while it is open.
      if (e.key === 'Tab') {
        const items = focusables(modal);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  function dismiss(modal) {
    closeModal(modal);
    if (modal.id === 'modal-editor') commitEditor();
  }

  /* ------------------------------------------------------------ print / pdf */

  function photosById() {
    const byId = {};
    for (const p of state.photos) byId[p.id] = p;
    return byId;
  }

  async function doPrint(skipHelp) {
    const layout = computeLayout();
    if (!layout.pages.length) return;

    // Browsers rescale printouts unless told otherwise, and nothing on screen
    // reveals it — so say it once, before the paper is spent.
    if (skipHelp !== true) {
      let seen = false;
      try {
        seen = !!localStorage.getItem(PRINT_HELP_KEY);
      } catch (e) {
        /* storage blocked; just show the reminder */
      }
      if (!seen) {
        openModal('modal-print-help');
        return;
      }
    }

    busy('Rendering sheets…');
    try {
      await App.printSheets(layout.pages, layout.paper, photosById(), renderSettings(), busy);
    } catch (e) {
      notice('Printing failed: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  async function doPdf() {
    const layout = computeLayout();
    if (!layout.pages.length) return;
    busy('Building PDF…');
    try {
      await App.exportPdf(layout.pages, layout.paper, photosById(), renderSettings(), busy);
    } catch (e) {
      notice('PDF export failed: ' + e.message, 'error');
    } finally {
      unbusy();
    }
  }

  /* ----------------------------------------------------------------- wiring */

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

  function setMode(mode) {
    state.settings.mode = mode;
    App.clearSlotCache();
    saveSettings();
    refresh();
  }

  function rotateEditing(delta) {
    const photo = editing && state.photos.find((p) => p.id === editing.id);
    if (!photo) return;
    photo.rotate = (((photo.rotate || 0) + delta + 360) % 360);
    renderEditorPreview();
  }

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
      // Internal library reordering carries no files, so it lands here harmlessly.
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    $('btn-clear').addEventListener('click', () => {
      if (!confirm('Remove all ' + state.photos.length + ' photos?')) return;
      const removed = state.photos.slice();
      state.photos = [];
      state.selectedId = null;
      App.idb.clear();
      pushUndo('removing all photos', () => {
        state.photos = removed;
        state.selectedId = removed.length ? removed[0].id : null;
        removed.forEach(persistPhoto);
      });
      App.clearSlotCache();
      refresh();
    });

    $('btn-undo').addEventListener('click', doUndo);

    /* quick start & help */
    $('job-row').addEventListener('click', (e) => {
      const chip = e.target.closest('.job-chip');
      if (chip) applyJobPreset(chip.dataset.job);
    });
    $('btn-enhance-all').addEventListener('click', enhanceAll);
    $('btn-help').addEventListener('click', () => openModal('modal-help'));
    $('btn-help-test-sheet').addEventListener('click', doTestSheet);
    $('btn-test-sheet').addEventListener('click', doTestSheet);
    $('btn-print-anyway').addEventListener('click', () => {
      if ($('chk-skip-print-help').checked) {
        try {
          localStorage.setItem(PRINT_HELP_KEY, '1');
        } catch (e) {
          /* storage blocked; the reminder will simply show again */
        }
      }
      closeModal($('modal-print-help'));
      doPrint(true);
    });

    /* mode + layout controls */
    $('tab-grid').addEventListener('click', () => setMode('grid'));
    $('tab-pack').addEventListener('click', () => setMode('pack'));
    $('tab-contact').addEventListener('click', () => setMode('contact'));

    $('grid-source').addEventListener('change', (e) => {
      state.grid.source = e.target.value;
      saveSettings();
      refresh();
    });

    $('grid-size').addEventListener('change', (e) => {
      const v = e.target.value;
      state.grid.fill = v === '__fill';
      if (!state.grid.fill) state.grid.sizeId = v;
      App.clearSlotCache();
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
        const item = state.grid.fill ? null : gridItemSize(paper, selectedPhoto());
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
      const before = state.photos.map((p) => JSON.parse(JSON.stringify(p.sizes || [])));
      state.photos.forEach((p) => {
        p.sizes = [{ sizeId: e.target.value, customW: 60, customH: 80, copies: 1 }];
        persistPhoto(p);
      });
      pushUndo('applying one size to all', () => {
        state.photos.forEach((p, i) => {
          if (before[i]) p.sizes = before[i];
          persistPhoto(p);
        });
      });
      e.target.value = '';
      App.clearSlotCache();
      refresh();
    });

    bindNumber('contact-cols', (v) => (state.settings.contactCols = Math.round(v)), 1, 12);
    $('contact-labels').addEventListener('change', (e) => {
      state.settings.contactLabels = e.target.checked;
      App.clearSlotCache();
      saveSettings();
      refresh();
    });

    /* presets */
    $('preset-select').addEventListener('change', (e) => {
      $('btn-preset-delete').disabled = !e.target.value;
      if (e.target.value) applyPreset(e.target.value);
    });
    $('btn-preset-save').addEventListener('click', saveCurrentPreset);
    $('btn-preset-delete').addEventListener('click', () => deletePreset($('preset-select').value));

    /* paper + printer */
    $('paper').addEventListener('change', (e) => {
      state.settings.paperId = e.target.value;
      saveSettings();
      refresh();
    });
    bindNumber('paper-w', (v) => (state.settings.paperW = v), 20, 2000);
    bindNumber('paper-h', (v) => (state.settings.paperH = v), 20, 2000);
    bindNumber('margin', (v) => (state.settings.margin = v), 0, 50);
    bindNumber('gap', (v) => (state.settings.gap = v), 0, 30);

    $('printer').addEventListener('change', (e) => {
      state.settings.printerId = e.target.value;
      saveSettings();
      refresh();
    });
    bindNumber('printer-edge', (v) => (state.settings.printerEdge = v), 0, 25);

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
        // From here on this is the user's choice, not a default to migrate.
        state.settings.fitChosen = true;
        App.clearSlotCache();
        saveSettings();
        refresh();
      })
    );

    $('auto-orient').addEventListener('change', (e) => {
      state.settings.autoOrient = e.target.checked;
      App.clearSlotCache();
      saveSettings();
      refresh();
    });

    $('dpi').addEventListener('change', (e) => {
      state.settings.dpi = parseInt(e.target.value, 10);
      App.clearSlotCache();
      saveSettings();
      refresh();
    });
    bindNumber('border-mm', (v) => {
      state.settings.borderMm = v;
      App.clearSlotCache();
    }, 0, 25);
    $('cut-marks').addEventListener('change', (e) => {
      state.settings.cutMarks = e.target.value;
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

    $('s-zoom').addEventListener('input', (e) => {
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo) return;
      photo.zoom = clamp((parseInt(e.target.value, 10) || 100) / 100, 1, 4);
      $('v-zoom').textContent = photo.zoom.toFixed(1) + '×';
      renderEditorPreview();
    });

    $('btn-reset-frame').addEventListener('click', () => {
      const photo = editing && state.photos.find((p) => p.id === editing.id);
      if (!photo) return;
      photo.zoom = 1;
      photo.focus = { x: 0.5, y: 0.5 };
      syncEditorControls(photo);
      renderEditorPreview();
    });

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
        const before = state.photos.map((p) => Object.assign({}, p.adj));
        for (const p of state.photos) {
          if (p.id === photo.id) continue;
          p.adj = Object.assign({}, photo.adj);
          await refreshPreviewImage(p);
          persistPhoto(p);
        }
        pushUndo('applying adjustments to all', () => {
          state.photos.forEach((p, i) => {
            if (before[i]) p.adj = before[i];
            refreshPreviewImage(p);
            persistPhoto(p);
          });
        });
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
        document.querySelectorAll('[data-focus]').forEach((o) => o.classList.toggle('is-active', o === b));
        renderEditorPreview();
      })
    );

    wireCropDrag();
    wireTextDrag();

    /* text on the photo */
    $('btn-add-text').addEventListener('click', addText);
    $('btn-text-delete').addEventListener('click', deleteText);
    $('text-content').addEventListener('input', (e) =>
      updateSelectedText((t) => (t.text = e.target.value))
    );
    $('text-style').addEventListener('change', (e) =>
      updateSelectedText((t) => (t.style = e.target.value))
    );
    $('text-font').addEventListener('change', (e) =>
      updateSelectedText((t) => (t.font = e.target.value))
    );
    $('text-size').addEventListener('input', (e) => {
      const pct = clamp(parseInt(e.target.value, 10) || 9, 2, 30);
      $('v-text-size').textContent = pct + '%';
      updateSelectedText((t) => (t.sizePct = pct / 100));
    });
    $('text-color').addEventListener('input', (e) =>
      updateSelectedText((t) => (t.color = e.target.value))
    );
    $('text-accent').addEventListener('input', (e) =>
      updateSelectedText((t) => (t.accent = e.target.value))
    );
    $('btn-text-bold').addEventListener('click', () =>
      updateSelectedText((t) => (t.bold = !t.bold), true)
    );
    $('btn-text-italic').addEventListener('click', () =>
      updateSelectedText((t) => (t.italic = !t.italic), true)
    );
    document.querySelectorAll('[data-align]').forEach((b) =>
      b.addEventListener('click', () => updateSelectedText((t) => (t.align = b.dataset.align), true))
    );

    /* search */
    $('btn-search').addEventListener('click', () => {
      fillQualityTiers();
      openModal('modal-search');
      $('search-query').focus();
      const st = $('search-status');
      st.className = 'search-status';
      st.textContent = App.PROVIDERS[$('search-provider').value].note || '';
    });
    $('btn-do-search').addEventListener('click', () => doSearch(true));
    $('search-query').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch(true);
    });
    $('search-provider').addEventListener('change', () => {
      fillQualityTiers();
      $('search-results').innerHTML = '';
      searchResults = [];
      const def = App.PROVIDERS[$('search-provider').value];
      const st = $('search-status');
      st.className = 'search-status';
      st.textContent = def.keyless
        ? def.note
        : App.keys.read()[$('search-provider').value]
        ? ''
        : 'This source needs a free key — add one in Settings, or use Wikimedia Commons.';
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

    /* output — wrapped so the click event is never mistaken for `skipHelp` */
    $('btn-print').addEventListener('click', () => doPrint());
    $('btn-print-2').addEventListener('click', () => doPrint());
    $('btn-pdf').addEventListener('click', doPdf);
    $('btn-pdf-2').addEventListener('click', doPdf);

    /* keyboard */
    document.addEventListener('keydown', (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === 'p') {
        // The browser's own print would produce a blank page, because the
        // sheets only exist once the app has rendered them.
        e.preventDefault();
        doPrint();
      } else if (key === 'z' && !e.shiftKey && !isTyping(document.activeElement) && !openModalEl()) {
        e.preventDefault();
        doUndo();
      }
    });

    /* keep the preview scaled to the window */
    window.addEventListener('resize', () => {
      scalePreview();
      // The editor's preview image resizes with the dialog, and the words are
      // positioned against its box, so they have to be laid out again.
      if (!$('modal-editor').hidden) renderTextOverlay();
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => scalePreview()).observe($('preview'));
    }
  }

  /* -------------------------------------------------------------- start-up */

  async function init() {
    loadSettings();
    fillSelects();
    wire();
    wireModals();
    syncControls();
    syncUndo();

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
