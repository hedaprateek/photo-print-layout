/* Text overlays for photos — names, dates, captions, watermarks.

   Every overlay is drawn twice: once onto the canvas for printing and PDF, and
   once as DOM for the on-screen sheet and the editor. Both live here so the two
   cannot drift apart, in the same way the image positioning is shared. */
(function (App) {
  'use strict';

  App.TEXT_FONTS = [
    { id: 'sans', name: 'Sans', stack: '"Segoe UI", Arial, Helvetica, sans-serif' },
    { id: 'serif', name: 'Serif', stack: 'Georgia, "Times New Roman", Times, serif' },
    { id: 'mono', name: 'Typewriter', stack: '"Courier New", Courier, monospace' },
    { id: 'script', name: 'Handwriting', stack: '"Segoe Script", "Brush Script MT", "Comic Sans MS", cursive' },
    { id: 'poster', name: 'Poster', stack: 'Impact, Haettenschweiler, "Arial Black", sans-serif' }
  ];

  App.TEXT_STYLES = [
    { id: 'plain', name: 'Plain' },
    { id: 'shadow', name: 'Soft shadow' },
    { id: 'outline', name: 'Outlined' },
    { id: 'banner', name: 'Banner behind' },
    { id: 'bar', name: 'Caption bar' }
  ];

  const LINE_HEIGHT = 1.18;
  const findFont = (id) => App.TEXT_FONTS.find((f) => f.id === id) || App.TEXT_FONTS[0];

  App.defaultText = function () {
    return {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: 'Your text',
      xPct: 0.5,
      yPct: 0.88,
      sizePct: 0.09, // of the photo's height, so it scales with the print size
      color: '#ffffff',
      accent: '#000000',
      style: 'shadow',
      font: 'sans',
      bold: true,
      italic: false,
      align: 'center',
      opacity: 1
    };
  };

  /* Identity of a photo's text, for the render cache. */
  App.textKey = function (texts) {
    if (!texts || !texts.length) return '';
    return texts
      .map((t) =>
        [t.text, t.xPct.toFixed(4), t.yPct.toFixed(4), t.sizePct.toFixed(4), t.color, t.accent,
         t.style, t.font, t.bold ? 1 : 0, t.italic ? 1 : 0, t.align, t.opacity].join('~')
      )
      .join('|');
  };

  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
    if (!m) return 'rgba(0,0,0,' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  const lines = (t) => String(t.text || '').split('\n');

  function fontSpec(t, sizePx) {
    return (
      (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '400 ') + sizePx + 'px ' + findFont(t.font).stack
    );
  }

  /* ------------------------------------------------------------------ canvas */

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* Draws into a box of boxW x boxH whose centre is the current origin, which is
     the coordinate system renderSlot already sets up for the photo. */
  App.drawTexts = function (ctx, texts, boxW, boxH) {
    if (!texts || !texts.length) return;

    for (const t of texts) {
      const rows = lines(t);
      if (!rows.join('').trim()) continue;

      const size = Math.max(1, t.sizePct * boxH);
      const lh = size * LINE_HEIGHT;
      const x = -boxW / 2 + t.xPct * boxW;
      const y = -boxH / 2 + t.yPct * boxH;
      const alpha = t.opacity === undefined ? 1 : t.opacity;

      ctx.save();
      ctx.font = fontSpec(t, size);
      ctx.textAlign = t.align;
      ctx.textBaseline = 'middle';

      const widest = rows.reduce((m, r) => Math.max(m, ctx.measureText(r).width), 0);
      const blockH = rows.length * lh;
      const top = y - blockH / 2 + lh / 2;
      const pad = size * 0.36;

      // Backgrounds first, so the glyphs land on top of them.
      if (t.style === 'bar') {
        ctx.fillStyle = hexToRgba(t.accent, 0.62 * alpha);
        ctx.fillRect(-boxW / 2, y - blockH / 2 - pad * 0.5, boxW, blockH + pad);
      } else if (t.style === 'banner') {
        const bx = t.align === 'center' ? x - widest / 2 : t.align === 'right' ? x - widest : x;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = t.accent;
        roundRect(ctx, bx - pad, y - blockH / 2 - pad * 0.5, widest + pad * 2, blockH + pad, size * 0.26);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      if (t.style === 'shadow') {
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = size * 0.18;
        ctx.shadowOffsetY = size * 0.06;
      }

      rows.forEach((row, i) => {
        const ly = top + i * lh;
        if (t.style === 'outline') {
          ctx.lineWidth = Math.max(1, size * 0.14);
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeStyle = t.accent;
          ctx.strokeText(row, x, ly);
        }
        ctx.fillStyle = t.color;
        ctx.fillText(row, x, ly);
      });

      ctx.restore();
    }
  };

  /* --------------------------------------------------------------------- DOM */

  /* `unit` is 'mm' for a real sheet and 'px' for the editor preview. */
  App.buildTextEl = function (t, boxW, boxH, unit) {
    const rows = lines(t);
    if (!rows.join('').trim()) return null;

    const size = t.sizePct * boxH;
    const el = document.createElement('div');
    el.className = 'ptext';
    el.textContent = t.text;

    const s = el.style;
    s.fontFamily = findFont(t.font).stack;
    s.fontSize = size + unit;
    s.fontWeight = t.bold ? '700' : '400';
    s.fontStyle = t.italic ? 'italic' : 'normal';
    s.lineHeight = String(LINE_HEIGHT);
    s.color = t.color;
    s.textAlign = t.align;
    s.opacity = String(t.opacity === undefined ? 1 : t.opacity);
    s.top = t.yPct * boxH + unit;

    if (t.style === 'bar') {
      // A caption bar spans the full width regardless of where it was dragged.
      s.left = '0';
      s.width = boxW + unit;
      s.transform = 'translateY(-50%)';
      s.background = hexToRgba(t.accent, 0.62);
      s.padding = size * 0.18 + unit + ' ' + size * 0.36 + unit;
    } else {
      s.left = t.xPct * boxW + unit;
      const shiftX = t.align === 'center' ? '-50%' : t.align === 'right' ? '-100%' : '0';
      s.transform = 'translate(' + shiftX + ', -50%)';
      if (t.style === 'banner') {
        s.background = t.accent;
        s.padding = size * 0.18 + unit + ' ' + size * 0.36 + unit;
        s.borderRadius = size * 0.26 + unit;
      }
    }

    if (t.style === 'shadow') {
      s.textShadow = '0 ' + size * 0.06 + unit + ' ' + size * 0.18 + unit + ' rgba(0,0,0,.55)';
    } else if (t.style === 'outline') {
      // paint-order keeps the stroke behind the fill, matching strokeText.
      s.webkitTextStrokeWidth = size * 0.14 + unit;
      s.webkitTextStrokeColor = t.accent;
      s.paintOrder = 'stroke';
    }

    return el;
  };
})((window.App = window.App || {}));
