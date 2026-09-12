/* Turns layout pages into: an on-screen preview, a print-exact DOM, or a PDF.
   Sheets are always built in real millimetres; the preview is merely scaled. */
(function (App) {
  'use strict';

  const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  /* Total clockwise rotation of a photo inside its slot: what the user chose,
     plus the 90° the packer may have applied to make it fit. */
  function totalRotation(photo, item) {
    return (((photo.rotate || 0) + (item.rot ? 90 : 0)) % 360 + 360) % 360;
  }

  function slotFrame(photo, item) {
    const rot = totalRotation(photo, item);
    const swapped = rot === 90 || rot === 270;
    return {
      rot,
      w: swapped ? item.h : item.w,
      h: swapped ? item.w : item.h
    };
  }

  /* ---------------------------------------------------------------- preview */

  /* `getSrc(photo)` supplies the image URL — a cheap thumbnail on screen,
     a full-resolution render when printing. */
  App.buildSheet = function (page, paper, photosById, settings, getSrc) {
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.width = paper.w + 'mm';
    sheet.style.height = paper.h + 'mm';

    for (const item of page.items) {
      const photo = photosById[item.photoId];
      if (!photo) continue;

      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.left = item.x + 'mm';
      slot.style.top = item.y + 'mm';
      slot.style.width = item.w + 'mm';
      slot.style.height = item.h + 'mm';

      const frame = slotFrame(photo, item);
      const holder = document.createElement('div');
      holder.className = 'slot-frame';
      holder.style.width = frame.w + 'mm';
      holder.style.height = frame.h + 'mm';
      holder.style.transform = 'translate(-50%, -50%) rotate(' + frame.rot + 'deg)';

      const img = document.createElement('img');
      img.src = getSrc(photo, item);
      img.alt = photo.name || '';
      img.style.objectFit = settings.fit === 'contain' ? 'contain' : 'cover';
      const focus = photo.focus || { x: 0.5, y: 0.5 };
      img.style.objectPosition = focus.x * 100 + '% ' + focus.y * 100 + '%';

      holder.appendChild(img);
      slot.appendChild(holder);

      if (settings.cutLines) {
        const guide = document.createElement('div');
        guide.className = 'cut-guide';
        slot.appendChild(guide);
      }
      sheet.appendChild(slot);
    }
    return sheet;
  };

  /* ------------------------------------------------ full-resolution renders */

  const slotCache = new Map();

  App.clearSlotCache = function () {
    for (const url of slotCache.values()) URL.revokeObjectURL(url);
    slotCache.clear();
  };

  function adjKey(adj) {
    const a = Object.assign({}, App.DEFAULT_ADJ, adj || {});
    return [a.auto ? 1 : 0, a.exposure, a.contrast, a.saturation, a.warmth, a.sharpen].join(',');
  }

  /* One cache entry per distinct (photo, slot geometry, DPI, adjustments).
     Grid mode repeats the same slot dozens of times, so this is the difference
     between one render and fifty. */
  function slotKey(photo, item, settings) {
    const frame = slotFrame(photo, item);
    return [
      photo.id,
      photo.version || 0,
      round2(item.w),
      round2(item.h),
      frame.rot,
      settings.dpi,
      settings.fit,
      photo.focus ? round2(photo.focus.x) + ':' + round2(photo.focus.y) : '',
      adjKey(photo.adj)
    ].join('|');
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  /* Render every distinct slot on these pages at print resolution.
     Returns a map of cache key -> blob URL. */
  App.renderSlots = async function (pages, photosById, settings, onStatus) {
    const needed = new Map();
    for (const page of pages) {
      for (const item of page.items) {
        const photo = photosById[item.photoId];
        if (!photo) continue;
        const key = slotKey(photo, item, settings);
        if (!slotCache.has(key) && !needed.has(key)) needed.set(key, { photo, item });
      }
    }

    let done = 0;
    for (const [key, { photo, item }] of needed) {
      if (onStatus) onStatus('Rendering ' + ++done + ' of ' + needed.size + '…');
      const source = await App.photoSource(photo);
      const canvas = App.renderSlot(source, App.mmToPx(item.w, settings.dpi), App.mmToPx(item.h, settings.dpi), {
        fit: settings.fit,
        rotate: totalRotation(photo, item),
        focus: photo.focus,
        adj: photo.adj,
        dpi: settings.dpi
      });
      const blob = await App.canvasToBlob(canvas, 'image/jpeg', settings.dpi >= 600 ? 0.95 : 0.92);
      slotCache.set(key, URL.createObjectURL(blob));
      canvas.width = 0; // free the backing store promptly
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    return (photo, item) => slotCache.get(slotKey(photo, item, settings));
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

    const root = document.createElement('div');
    root.id = 'print-root';
    for (const page of pages) {
      root.appendChild(App.buildSheet(page, paper, photosById, settings, getSrc));
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

    const quality = settings.dpi >= 600 ? 0.95 : 0.92;
    let n = 0;
    const total = pages.reduce((s, p) => s + p.items.length, 0);

    for (let p = 0; p < pages.length; p++) {
      if (p > 0) doc.addPage([paper.w, paper.h], landscape ? 'landscape' : 'portrait');

      for (const item of pages[p].items) {
        const photo = photosById[item.photoId];
        if (!photo) continue;
        if (onStatus) onStatus('Building PDF — image ' + ++n + ' of ' + total + '…');

        const source = await App.photoSource(photo);
        // Rotation and cropping are baked into the bitmap, so the PDF needs no
        // transform matrix and stays predictable across viewers and printers.
        const canvas = App.renderSlot(
          source,
          App.mmToPx(item.w, settings.dpi),
          App.mmToPx(item.h, settings.dpi),
          {
            fit: settings.fit,
            rotate: totalRotation(photo, item),
            focus: photo.focus,
            adj: photo.adj,
            dpi: settings.dpi
          }
        );
        doc.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', item.x, item.y, item.w, item.h);
        canvas.width = 0;

        if (settings.cutLines) {
          doc.setDrawColor(190);
          doc.setLineWidth(0.1);
          doc.rect(item.x, item.y, item.w, item.h);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (onStatus) onStatus('Saving…');
    doc.save('print-sheet-' + paper.name.replace(/\s+/g, '') + '-' + pages.length + 'p.pdf');
  };
})((window.App = window.App || {}));
