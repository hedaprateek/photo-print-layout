/* Turns layout pages into: an on-screen preview, a print-exact DOM, or a PDF.
   Sheets are always built in real millimetres; the preview is merely scaled. */
(function (App) {
  'use strict';

  const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const round2 = (n) => Math.round(n * 100) / 100;

  /* Total clockwise rotation of a photo inside its slot: what the user chose,
     plus the 90° the packer may have applied to make it fit. */
  function totalRotation(photo, item) {
    return ((((photo.rotate || 0) + (item.rot ? 90 : 0)) % 360) + 360) % 360;
  }

  /* The photo's box inside the slot, after the white border is taken off. */
  function innerBox(item, settings) {
    const b = Math.max(0, settings.borderMm || 0);
    // Never let the border swallow the photo entirely.
    const bw = Math.min(b, (item.w - 1) / 2, (item.h - 1) / 2);
    return { border: Math.max(0, bw), w: item.w - bw * 2, h: item.h - bw * 2 };
  }

  function fitOf(item, settings) {
    return item.fit || settings.fit || 'cover';
  }

  /* ---------------------------------------------------------------- preview */

  /* `getSrc(photo, item)` supplies the image URL — a cheap thumbnail on screen,
     a full-resolution render when printing. */
  App.buildSheet = function (page, paper, photosById, settings, getSrc) {
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.width = paper.w + 'mm';
    sheet.style.height = paper.h + 'mm';

    for (const item of page.items) {
      const photo = photosById[item.photoId];
      if (!photo) continue;

      const captionH = settings.contactLabels && item.caption ? item.captionH || 0 : 0;

      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.left = item.x + 'mm';
      slot.style.top = item.y + 'mm';
      slot.style.width = item.w + 'mm';
      slot.style.height = item.h + captionH + 'mm';

      const photoBox = document.createElement('div');
      photoBox.className = 'photo-box';
      photoBox.style.width = item.w + 'mm';
      photoBox.style.height = item.h + 'mm';

      const inner = innerBox(item, settings);
      const clip = document.createElement('div');
      clip.className = 'slot-clip';
      clip.style.inset = inner.border + 'mm';

      const rot = totalRotation(photo, item);
      const swapped = rot === 90 || rot === 270;
      const boxW = swapped ? inner.h : inner.w;
      const boxH = swapped ? inner.w : inner.h;

      const frame = document.createElement('div');
      frame.className = 'slot-frame';
      frame.style.width = boxW + 'mm';
      frame.style.height = boxH + 'mm';
      frame.style.transform = 'translate(-50%, -50%) rotate(' + rot + 'deg)';

      // Position the image explicitly rather than leaning on object-fit, so the
      // preview reproduces the canvas renderer exactly, zoom and all.
      const geo = App.slotGeometry(photo.w, photo.h, boxW, boxH, fitOf(item, settings), photo.zoom);
      const focus = photo.focus || { x: 0.5, y: 0.5 };
      const img = document.createElement('img');
      img.src = getSrc(photo, item);
      img.alt = photo.name || '';
      img.draggable = false;
      img.style.width = geo.drawW + 'mm';
      img.style.height = geo.drawH + 'mm';
      img.style.left = (boxW - geo.drawW) * focus.x + 'mm';
      img.style.top = (boxH - geo.drawH) * focus.y + 'mm';

      frame.appendChild(img);
      clip.appendChild(frame);

      // On screen the images are plain thumbnails, so the words are added as
      // DOM. When printing, getSrc hands back full-resolution renders that
      // already have the text drawn into them — adding it again would print
      // every caption twice.
      if (!settings.textBaked && photo.texts && photo.texts.length && App.buildTextEl) {
        const packRot = item.rot ? 90 : 0;
        const packSwapped = packRot === 90 || packRot === 270;
        const tW = packSwapped ? inner.h : inner.w;
        const tH = packSwapped ? inner.w : inner.h;
        const layer = document.createElement('div');
        layer.className = 'text-layer';
        layer.style.width = tW + 'mm';
        layer.style.height = tH + 'mm';
        layer.style.transform = 'translate(-50%, -50%) rotate(' + packRot + 'deg)';
        for (const t of photo.texts) {
          const el = App.buildTextEl(t, tW, tH, 'mm');
          if (el) layer.appendChild(el);
        }
        clip.appendChild(layer);
      }

      photoBox.appendChild(clip);
      slot.appendChild(photoBox);

      if (captionH) {
        const cap = document.createElement('div');
        cap.className = 'slot-caption';
        cap.style.height = captionH + 'mm';
        cap.style.fontSize = captionH * 0.5 + 'mm';
        cap.textContent = item.caption;
        slot.appendChild(cap);
      }

      sheet.appendChild(slot);
    }

    const marks = buildMarks(page, paper, settings);
    if (marks) sheet.appendChild(marks);
    return sheet;
  };

  /* Crop marks. Ticks sitting in the gutter are what you actually cut to — a
     dashed rectangle drawn on the trim line ends up printed on the photo. When
     there is no gutter to put them in, fall back to shared hairlines. */
  function markMode(settings) {
    const mode = settings.cutMarks || 'ticks';
    if (mode === 'none') return 'none';
    if (mode === 'lines' || mode === 'dotted') return mode;
    // Corner ticks need a gutter to sit in. Without one, fall back to a dotted
    // outline, which is still something to cut along.
    const gap = settings.gap || 0;
    const margin = settings.margin || 0;
    if (gap <= 0) return 'dotted';
    let space = gap / 2;
    if (margin > 0) space = Math.min(space, margin);
    return space < 0.6 ? 'dotted' : 'ticks';
  }

  function markGeometry(settings) {
    const gap = settings.gap || 0;
    const margin = settings.margin || 0;
    let space = gap / 2;
    if (margin > 0) space = Math.min(space, margin);
    return Math.min(2.5, Math.max(0.6, space));
  }

  function markPath(page, settings) {
    const mode = markMode(settings);
    if (mode === 'none') return '';
    let d = '';

    for (const item of page.items) {
      const capH = settings.contactLabels && item.caption ? item.captionH || 0 : 0;
      const x0 = item.x;
      const y0 = item.y;
      const x1 = item.x + item.w;
      const y1 = item.y + item.h + capH;

      if (mode === 'lines' || mode === 'dotted') {
        d += 'M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z';
        continue;
      }
      const L = markGeometry(settings);
      const corners = [
        [x0, y0, -1, -1],
        [x1, y0, 1, -1],
        [x0, y1, -1, 1],
        [x1, y1, 1, 1]
      ];
      for (const [x, y, sx, sy] of corners) {
        d += 'M' + x + ' ' + y + 'L' + (x + sx * L) + ' ' + y;
        d += 'M' + x + ' ' + y + 'L' + x + ' ' + (y + sy * L);
      }
    }
    return d;
  }

  function buildMarks(page, paper, settings) {
    const d = markPath(page, settings);
    if (!d) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'cut-marks');
    svg.setAttribute('viewBox', '0 0 ' + paper.w + ' ' + paper.h);
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#9a9a9a');
    path.setAttribute('stroke-width', '0.15'); // user units are mm here
    if (markMode(settings) === 'dotted') path.setAttribute('stroke-dasharray', '1.4 1.1');
    svg.appendChild(path);
    return svg;
  }

  /* ------------------------------------------------ full-resolution renders */

  const slotCache = new Map();

  App.clearSlotCache = function () {
    for (const entry of slotCache.values()) URL.revokeObjectURL(entry.url);
    slotCache.clear();
  };

  function adjKey(adj) {
    const a = Object.assign({}, App.DEFAULT_ADJ, adj || {});
    return [a.auto ? 1 : 0, a.exposure, a.contrast, a.saturation, a.warmth, a.sharpen].join(',');
  }

  /* What a slot needs, and the identity that lets identical slots share one
     render. Grid mode repeats the same slot dozens of times, so this is the
     difference between one render and fifty. */
  function slotPlan(photo, item, settings) {
    const inner = innerBox(item, settings);
    const fit = fitOf(item, settings);
    // Rendering beyond the source's own resolution costs memory and seconds and
    // adds nothing, so cap the bitmap at what the photo can actually supply.
    const dpi = App.renderDpiFor(photo.w, photo.h, inner.w, inner.h, fit, photo.zoom, settings.dpi);
    const key = [
      photo.id,
      photo.version || 0,
      round2(item.w),
      round2(item.h),
      totalRotation(photo, item),
      dpi,
      fit,
      round2(inner.border),
      round2(photo.zoom || 1),
      photo.focus ? round2(photo.focus.x) + ':' + round2(photo.focus.y) : '',
      adjKey(photo.adj),
      App.textKey(photo.texts)
    ].join('|');
    return { key, dpi, fit, inner };
  }

  function renderOptions(photo, item, plan, settings) {
    return {
      fit: plan.fit,
      rotate: totalRotation(photo, item),
      focus: photo.focus,
      zoom: photo.zoom,
      adj: photo.adj,
      dpi: plan.dpi,
      borderMm: plan.inner.border,
      texts: photo.texts,
      // Only the packer's rotation, not the user's: text is placed on the photo
      // as the editor shows it, then turns with it if it is laid sideways.
      packRot: item.rot ? 90 : 0
    };
  }

  /* Render every distinct slot at print resolution. Returns a getSrc function. */
  App.renderSlots = async function (pages, photosById, settings, onStatus) {
    const needed = new Map();
    for (const page of pages) {
      for (const item of page.items) {
        const photo = photosById[item.photoId];
        if (!photo) continue;
        const plan = slotPlan(photo, item, settings);
        if (!slotCache.has(plan.key) && !needed.has(plan.key)) needed.set(plan.key, { photo, item, plan });
      }
    }

    let done = 0;
    for (const [key, { photo, item, plan }] of needed) {
      if (onStatus) onStatus('Rendering ' + ++done + ' of ' + needed.size + '…');
      const source = await App.photoSource(photo);
      const canvas = App.renderSlot(
        source,
        App.mmToPx(item.w, plan.dpi),
        App.mmToPx(item.h, plan.dpi),
        renderOptions(photo, item, plan, settings)
      );
      // Print is unforgiving, so keep the encoding close to lossless.
      const blob = await App.canvasToBlob(canvas, 'image/jpeg', plan.dpi >= 600 ? 0.97 : 0.95);
      slotCache.set(key, { url: URL.createObjectURL(blob) });
      canvas.width = 0; // free the backing store promptly
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    return (photo, item) => {
      const entry = slotCache.get(slotPlan(photo, item, settings).key);
      return entry ? entry.url : '';
    };
  };

  /* ------------------------------------------------------------------ print */

  function pageStyle(paper) {
    let el = document.getElementById('page-size-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'page-size-style';
      document.head.appendChild(el);
    }
    // Give the browser the exact sheet size so it doesn't rescale to fit.
    el.textContent = '@page { size: ' + paper.w + 'mm ' + paper.h + 'mm; margin: 0; }';
  }

  App.printSheets = async function (pages, paper, photosById, settings, onStatus) {
    const getSrc = await App.renderSlots(pages, photosById, settings, onStatus);
    if (onStatus) onStatus('Preparing print…');

    // renderSlots has already drawn the text into each bitmap.
    const printSettings = Object.assign({}, settings, { textBaked: true });

    const root = document.createElement('div');
    root.id = 'print-root';
    for (const page of pages) {
      root.appendChild(App.buildSheet(page, paper, photosById, printSettings, getSrc));
    }

    const old = document.getElementById('print-root');
    if (old) old.remove();
    document.body.appendChild(root);
    pageStyle(paper);
    document.documentElement.classList.add('printing');

    // Wait for every <img> to decode, or the printed sheets come out blank.
    await Promise.all(
      Array.from(root.querySelectorAll('img')).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.onload = img.onerror = res;
            })
      )
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const cleanup = () => {
      document.documentElement.classList.remove('printing');
      const node = document.getElementById('print-root');
      if (node) node.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    window.print();
    // Safari and some mobile browsers never fire afterprint.
    setTimeout(cleanup, 60000);
  };

  /* ------------------------------------------------------------ test sheet */

  /* A page to hold a ruler against. Browsers quietly rescale printouts unless
     margins are None and scale is 100%, which is the usual reason a 35 mm
     passport photo comes out at 33 mm — and nothing on screen reveals it. */
  App.printTestSheet = function (paper) {
    const existing = document.getElementById('print-root');
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = 'print-root';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.width = paper.w + 'mm';
    sheet.style.height = paper.h + 'mm';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + paper.w + ' ' + paper.h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';

    const add = (tag, attrs, text) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      if (text !== undefined) el.textContent = text;
      svg.appendChild(el);
      return el;
    };
    const label = (x, y, text, size) =>
      add('text', { x, y, 'font-size': size || 3.2, fill: '#222', 'font-family': 'sans-serif' }, text);

    const x0 = 20;
    const rulerY = 58;

    add('text', { x: x0, y: 28, 'font-size': 6, 'font-weight': '700', fill: '#000', 'font-family': 'sans-serif' },
      'Printer test sheet');
    label(x0, 37, 'Measure the bar and the box below with a ruler.');
    label(x0, 43, 'If they are correct, your printer is not rescaling.');

    // 100 mm ruler with 10 mm ticks.
    add('line', { x1: x0, y1: rulerY, x2: x0 + 100, y2: rulerY, stroke: '#000', 'stroke-width': 0.35 });
    for (let mm = 0; mm <= 100; mm += 10) {
      const major = mm % 50 === 0;
      add('line', {
        x1: x0 + mm, y1: rulerY, x2: x0 + mm, y2: rulerY - (major ? 7 : 3.5),
        stroke: '#000', 'stroke-width': 0.35
      });
      if (major) {
        add('text', {
          x: x0 + mm, y: rulerY - 8.5, 'font-size': 3.4, fill: '#000',
          'text-anchor': 'middle', 'font-family': 'sans-serif'
        }, String(mm));
      }
    }
    label(x0, rulerY + 6, 'This bar must measure exactly 100 mm.');

    // A real passport photo footprint.
    const boxY = rulerY + 18;
    add('rect', {
      x: x0, y: boxY, width: 35, height: 45, fill: 'none',
      stroke: '#000', 'stroke-width': 0.35, 'stroke-dasharray': '2 1.5'
    });
    label(x0 + 40, boxY + 10, 'This box must measure 35 × 45 mm —');
    label(x0 + 40, boxY + 16, 'the size of a standard passport photo.');

    label(x0, boxY + 60, 'If they come out smaller, open the print dialog and set:');
    label(x0, boxY + 67, '   •  Margins:  None', 3.6);
    label(x0, boxY + 74, '   •  Scale:  100%   (not "Fit to page")', 3.6);
    label(x0, boxY + 84, 'Then print this sheet again to confirm.');

    sheet.appendChild(svg);
    root.appendChild(sheet);
    document.body.appendChild(root);
    pageStyle(paper);
    document.documentElement.classList.add('printing');

    const cleanup = () => {
      document.documentElement.classList.remove('printing');
      const node = document.getElementById('print-root');
      if (node) node.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 60000);
  };

  /* -------------------------------------------------------------------- PDF */

  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDF_URL;
      s.onload = () =>
        window.jspdf && window.jspdf.jsPDF
          ? resolve(window.jspdf.jsPDF)
          : reject(new Error('jsPDF failed to initialise'));
      s.onerror = () => reject(new Error('Could not load the PDF library — check your connection'));
      document.head.appendChild(s);
    });
  }

  App.exportPdf = async function (pages, paper, photosById, settings, onStatus) {
    const jsPDF = await loadJsPdf();
    const landscape = paper.w > paper.h;
    const doc = new jsPDF({
      unit: 'mm',
      format: [paper.w, paper.h],
      orientation: landscape ? 'landscape' : 'portrait',
      compress: true
    });

    const rendered = new Map(); // slot key -> JPEG data URL
    let n = 0;
    const total = pages.reduce((s, p) => s + p.items.length, 0);

    for (let p = 0; p < pages.length; p++) {
      if (p > 0) doc.addPage([paper.w, paper.h], landscape ? 'landscape' : 'portrait');

      for (const item of pages[p].items) {
        const photo = photosById[item.photoId];
        if (!photo) continue;
        if (onStatus) onStatus('Building PDF — image ' + ++n + ' of ' + total + '…');

        const plan = slotPlan(photo, item, settings);
        let dataUrl = rendered.get(plan.key);
        if (!dataUrl) {
          const source = await App.photoSource(photo);
          // Rotation and cropping are baked into the bitmap, so the PDF needs no
          // transform matrix and stays predictable across viewers and printers.
          const canvas = App.renderSlot(
            source,
            App.mmToPx(item.w, plan.dpi),
            App.mmToPx(item.h, plan.dpi),
            renderOptions(photo, item, plan, settings)
          );
          dataUrl = canvas.toDataURL('image/jpeg', plan.dpi >= 600 ? 0.97 : 0.95);
          canvas.width = 0;
          rendered.set(plan.key, dataUrl);
        }
        // Repeated slots are drawn from one cached bitmap and share an alias, so
        // a sheet of 30 identical passport photos renders and stores one image
        // rather than thirty. jsPDF needs the data every time — handing it null
        // for the repeats throws and loses the whole export.
        doc.addImage(dataUrl, 'JPEG', item.x, item.y, item.w, item.h, plan.key, 'FAST');

        if (settings.contactLabels && item.caption && item.captionH) {
          doc.setTextColor(60);
          doc.setFontSize(Math.max(4, item.captionH * 0.5 * (72 / 25.4)));
          doc.text(String(item.caption), item.x + item.w / 2, item.y + item.h + item.captionH * 0.7, {
            align: 'center',
            maxWidth: item.w
          });
        }
        await new Promise((r) => setTimeout(r, 0));
      }

      drawPdfMarks(doc, pages[p], settings);
    }

    if (onStatus) onStatus('Saving…');
    doc.save('print-sheet-' + paper.name.replace(/\s+/g, '') + '-' + pages.length + 'p.pdf');
  };

  function drawPdfMarks(doc, page, settings) {
    const mode = markMode(settings);
    if (mode === 'none') return;
    doc.setDrawColor(150);
    doc.setLineWidth(0.12);
    const dashed = mode === 'dotted' && typeof doc.setLineDashPattern === 'function';
    if (dashed) doc.setLineDashPattern([1.4, 1.1], 0);

    for (const item of page.items) {
      const capH = settings.contactLabels && item.caption ? item.captionH || 0 : 0;
      const x0 = item.x;
      const y0 = item.y;
      const x1 = item.x + item.w;
      const y1 = item.y + item.h + capH;

      if (mode === 'lines' || mode === 'dotted') {
        doc.rect(x0, y0, item.w, item.h + capH);
        continue;
      }
      const L = markGeometry(settings);
      for (const [x, y, sx, sy] of [
        [x0, y0, -1, -1],
        [x1, y0, 1, -1],
        [x0, y1, -1, 1],
        [x1, y1, 1, 1]
      ]) {
        doc.line(x, y, x + sx * L, y);
        doc.line(x, y, x, y + sy * L);
      }
    }
    // Turn the dash off again, or every later line inherits it.
    if (dashed) doc.setLineDashPattern([], 0);
  }
})((window.App = window.App || {}));
