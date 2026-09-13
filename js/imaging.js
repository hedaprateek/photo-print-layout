/* Image loading, print-oriented enhancement, and optional AI super-resolution.
   Everything here runs client-side; nothing is uploaded anywhere. */
(function (App) {
  'use strict';

  const IN = App.MM_PER_IN;

  App.DEFAULT_ADJ = Object.freeze({
    auto: false,      // auto-levels + implicit white balance
    exposure: 0,      // -100..100
    contrast: 0,      // -100..100
    saturation: 0,    // -100..100
    warmth: 0,        // -100..100
    sharpen: 35       // 0..100, unsharp mask applied after resampling
  });

  /* ---------------------------------------------------------------- loading */

  App.loadImage = function (src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = src;
    });
  };

  App.blobToImage = function (blob) {
    const url = URL.createObjectURL(blob);
    return App.loadImage(url).then(
      (img) => {
        img._revoke = url;
        return img;
      },
      (e) => {
        URL.revokeObjectURL(url);
        throw e;
      }
    );
  };

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function ctx2d(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  App.canvasToBlob = function (canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
        type || 'image/jpeg',
        quality === undefined ? 0.92 : quality
      );
    });
  };

  /* Downscale in halving steps: far cleaner than one big drawImage, which
     point-samples and produces aliased edges on large reductions. */
  App.resampleStepped = function (source, targetW, targetH) {
    let sw = source.naturalWidth || source.width;
    let sh = source.naturalHeight || source.height;
    let cur = source;

    while (sw / 2 >= targetW && sh / 2 >= targetH && sw > 2 && sh > 2) {
      const next = canvasOf(sw / 2, sh / 2);
      ctx2d(next).drawImage(cur, 0, 0, next.width, next.height);
      if (cur !== source && cur.width) cur.width = 0; // release
      cur = next;
      sw = next.width;
      sh = next.height;
    }

    const out = canvasOf(targetW, targetH);
    ctx2d(out).drawImage(cur, 0, 0, out.width, out.height);
    if (cur !== source && cur !== out && cur.width) cur.width = 0;
    return out;
  };

  App.makeThumb = function (source, maxEdge) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const k = Math.min(1, maxEdge / Math.max(sw, sh));
    return App.resampleStepped(source, Math.round(sw * k), Math.round(sh * k));
  };

  /* ------------------------------------------------------------ print maths */

  /* How the image is scaled inside its box. Shared by the renderer and the
     crop editor so the preview and the print cannot disagree. */
  App.slotGeometry = function (imgW, imgH, boxW, boxH, fit, zoom) {
    const z = Math.max(1, zoom || 1);
    const imgRatio = imgW / imgH;
    const boxRatio = boxW / boxH;
    let drawW;
    let drawH;
    if ((fit === 'cover') === (imgRatio > boxRatio)) {
      drawH = boxH;
      drawW = boxH * imgRatio;
    } else {
      drawW = boxW;
      drawH = boxW / imgRatio;
    }
    return { drawW: drawW * z, drawH: drawH * z };
  };

  /* Pixels-per-inch a photo will actually achieve in a slot of this size. */
  App.effectiveDpi = function (imgW, imgH, slotWmm, slotHmm, fit) {
    if (!imgW || !imgH || !slotWmm || !slotHmm) return 0;
    const slotRatio = slotWmm / slotHmm;
    const imgRatio = imgW / imgH;
    // In `cover` the short side binds and the overflow is cropped; in `contain`
    // the long side binds and the remainder is left as margin.
    const heightBinds = fit === 'contain' ? imgRatio <= slotRatio : imgRatio > slotRatio;
    return heightBinds ? imgH / (slotHmm / IN) : imgW / (slotWmm / IN);
  };

  App.dpiVerdict = function (dpi) {
    if (dpi >= 280) return { level: 'good', label: 'Sharp' };
    if (dpi >= 180) return { level: 'ok', label: 'Acceptable' };
    if (dpi >= 110) return { level: 'warn', label: 'Soft' };
    return { level: 'bad', label: 'Too low' };
  };

  /* Smallest upscale factor that lifts a photo to `targetDpi` in this slot. */
  App.upscaleFactorFor = function (imgW, imgH, slotWmm, slotHmm, fit, targetDpi, zoom) {
    const dpi = App.effectiveDpi(imgW, imgH, slotWmm, slotHmm, fit) / Math.max(1, zoom || 1);
    if (!dpi) return 1;
    return Math.max(1, (targetDpi || 300) / dpi);
  };

  /* Rendering more pixels than the source can supply costs memory and seconds
     and adds no detail, so cap the bitmap at the photo's own resolution. The
     printed size is unaffected — only the bitmap behind it gets smaller. */
  App.renderDpiFor = function (imgW, imgH, slotWmm, slotHmm, fit, zoom, requestedDpi) {
    const available = App.effectiveDpi(imgW, imgH, slotWmm, slotHmm, fit) / Math.max(1, zoom || 1);
    if (!available) return requestedDpi;
    return Math.max(72, Math.min(requestedDpi, Math.ceil(available)));
  };

  /* ------------------------------------------------------------ tone / colour */

  function histogramBounds(data, clipFraction) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < data.length; i += 4) {
      hist[0][data[i]]++;
      hist[1][data[i + 1]]++;
      hist[2][data[i + 2]]++;
    }
    const total = data.length / 4;
    const clip = Math.floor(total * clipFraction);
    const bounds = [];
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      let lo = 0;
      let hi = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[c][v];
        if (acc > clip) {
          lo = v;
          break;
        }
      }
      acc = 0;
      for (let v = 255; v >= 0; v--) {
        acc += hist[c][v];
        if (acc > clip) {
          hi = v;
          break;
        }
      }
      if (hi - lo < 8) {
        lo = 0;
        hi = 255;
      } // near-flat channel: leave it alone
      bounds.push([lo, hi]);
    }
    return bounds;
  }

  /* Per-channel black/white point stretch. Doubles as a white balance fix,
     which is why dull phone photos improve so much from it. */
  function autoLevels(imageData, clipFraction) {
    const d = imageData.data;
    const bounds = histogramBounds(d, clipFraction === undefined ? 0.005 : clipFraction);
    const luts = bounds.map(([lo, hi]) => {
      const lut = new Uint8ClampedArray(256);
      const span = Math.max(1, hi - lo);
      for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / span;
      return lut;
    });
    for (let i = 0; i < d.length; i += 4) {
      d[i] = luts[0][d[i]];
      d[i + 1] = luts[1][d[i + 1]];
      d[i + 2] = luts[2][d[i + 2]];
    }
  }

  function applyAdjustments(imageData, adj) {
    const d = imageData.data;
    const exposure = 1 + (adj.exposure || 0) / 100;
    const contrast = 1 + (adj.contrast || 0) / 100;
    const warmth = (adj.warmth || 0) / 100;
    const sat = 1 + (adj.saturation || 0) / 100;

    if (exposure !== 1 || contrast !== 1 || warmth !== 0) {
      const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
      const warmShift = [warmth * 22, warmth * 4, -warmth * 22];
      for (let c = 0; c < 3; c++) {
        for (let v = 0; v < 256; v++) {
          let x = v * exposure;
          x = (x - 128) * contrast + 128;
          x += warmShift[c];
          lut[c][v] = x;
        }
      }
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[0][d[i]];
        d[i + 1] = lut[1][d[i + 1]];
        d[i + 2] = lut[2][d[i + 2]];
      }
    }

    if (sat !== 1) {
      for (let i = 0; i < d.length; i += 4) {
        // Rec. 601 luma, which is what eyes weight colour by.
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = y + (d[i] - y) * sat;
        d[i + 1] = y + (d[i + 1] - y) * sat;
        d[i + 2] = y + (d[i + 2] - y) * sat;
      }
    }
  }

  /* Separable single-channel box blur, run three times to approximate a
     Gaussian. Sharpening works on luminance only: it is three times cheaper
     than blurring each colour channel, and it cannot introduce the coloured
     fringes that per-channel sharpening leaves along high-contrast edges. */
  function boxBlurPlane(src, w, h, radius) {
    const tmp = new Uint8ClampedArray(src.length);
    const out = new Uint8ClampedArray(src);
    const div = radius * 2 + 1;

    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += out[row + Math.min(w - 1, Math.max(0, k))];
        for (let x = 0; x < w; x++) {
          tmp[row + x] = sum / div;
          sum += out[row + Math.min(w - 1, x + radius + 1)] - out[row + Math.max(0, x - radius)];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = sum / div;
          sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
        }
      }
    }
    return out;
  }

  function lumaPlane(data, w, h) {
    const luma = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
      luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return luma;
  }

  function downsamplePlane(src, w, h, k) {
    const sw = Math.ceil(w / k);
    const sh = Math.ceil(h / k);
    const out = new Uint8ClampedArray(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = 0; dy < k; dy++) {
          const yy = y * k + dy;
          if (yy >= h) break;
          for (let dx = 0; dx < k; dx++) {
            const xx = x * k + dx;
            if (xx >= w) break;
            sum += src[yy * w + xx];
            n++;
          }
        }
        out[y * sw + x] = sum / n;
      }
    }
    return { plane: out, sw, sh };
  }

  function upsamplePlane(src, sw, sh, w, h) {
    const out = new Uint8ClampedArray(w * h);
    const xr = sw / w;
    const yr = sh / h;
    for (let y = 0; y < h; y++) {
      const sy = y * yr;
      const y0 = sy | 0;
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = sy - y0;
      const row0 = y0 * sw;
      const row1 = y1 * sw;
      const orow = y * w;
      for (let x = 0; x < w; x++) {
        const sx = x * xr;
        const x0 = sx | 0;
        const x1 = Math.min(sw - 1, x0 + 1);
        const fx = sx - x0;
        const a = src[row0 + x0];
        const b = src[row0 + x1];
        const c = src[row1 + x0];
        const d = src[row1 + x1];
        out[orow + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      }
    }
    return out;
  }

  /* Ink spreads on paper, so prints need more sharpening than screens. This is
     the step that stops prints looking soft.

     Big slots blur a reduced copy, but only by a factor the kernel can absorb:
     `k` never exceeds the radius, and the reduced blur uses radius/k, so the
     effective kernel stays the size that was asked for. Shrinking further would
     be much faster but would quietly widen the kernel and turn fine-detail
     sharpening into a local-contrast effect — a different filter, not a cheaper
     one. */
  function sharpen(data, w, h, amount, radius) {
    if (amount <= 0) return;
    const luma = lumaPlane(data, w, h);

    let blurred;
    const k = Math.max(1, Math.min(Math.floor(radius), 4));
    if (k < 2) {
      blurred = boxBlurPlane(luma, w, h, radius);
    } else {
      const small = downsamplePlane(luma, w, h, k);
      const reduced = boxBlurPlane(small.plane, small.sw, small.sh, Math.max(1, Math.round(radius / k)));
      blurred = upsamplePlane(reduced, small.sw, small.sh, w, h);
    }

    const gain = amount / 100;
    const threshold = 2;
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
      const diff = luma[p] - blurred[p];
      if (diff > threshold || diff < -threshold) {
        const add = diff * gain;
        // Uint8ClampedArray clamps for us.
        data[i] += add;
        data[i + 1] += add;
        data[i + 2] += add;
      }
    }
  }

  /* ------------------------------------------------------- the print pipeline */

  /* Draw `source` into a pxW×pxH canvas: optional white border, rotation,
     cover/contain fit with a focal point and zoom, then tone and sharpening.
     Order matters — sharpening must come last, at final print resolution. */
  App.renderSlot = function (source, pxW, pxH, opts) {
    const o = opts || {};
    const fit = o.fit || 'cover';
    const rot = (((o.rotate || 0) % 360) + 360) % 360;
    const focus = o.focus || { x: 0.5, y: 0.5 };
    const zoom = Math.max(1, o.zoom || 1);
    const adj = Object.assign({}, App.DEFAULT_ADJ, o.adj || {});
    const dpi = o.dpi || 300;

    const canvas = canvasOf(pxW, pxH);
    const ctx = ctx2d(canvas);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // A white border reduces the area the photo occupies; everything below
    // works against that inner box.
    const border = Math.max(0, Math.round(((o.borderMm || 0) / IN) * dpi));
    const innerW = Math.max(1, canvas.width - border * 2);
    const innerH = Math.max(1, canvas.height - border * 2);

    const swapped = rot === 90 || rot === 270;
    const boxW = swapped ? innerH : innerW;
    const boxH = swapped ? innerW : innerH;

    const iw = source.naturalWidth || source.width;
    const ih = source.naturalHeight || source.height;
    const { drawW, drawH } = App.slotGeometry(iw, ih, boxW, boxH, fit, zoom);

    // Pre-shrink big sources so the final draw is a mild resize, not a 10x one.
    let src = source;
    if (iw > drawW * 2 && ih > drawH * 2) {
      src = App.resampleStepped(source, Math.ceil(drawW), Math.ceil(drawH));
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(border, border, innerW, innerH);
    ctx.clip();
    ctx.translate(border + innerW / 2, border + innerH / 2);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(
      src,
      -boxW / 2 + (boxW - drawW) * focus.x,
      -boxH / 2 + (boxH - drawH) * focus.y,
      drawW,
      drawH
    );
    ctx.restore();
    if (src !== source && src.width) src.width = 0;

    const touchesTone =
      adj.auto || adj.exposure || adj.contrast || adj.saturation || adj.warmth || adj.sharpen > 0;
    if (touchesTone) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (adj.auto) autoLevels(data, 0.005);
      applyAdjustments(data, adj);
      ctx.putImageData(data, 0, 0);

      if (adj.sharpen > 0) {
        // Radius scales with output resolution so 600 DPI isn't under-sharpened.
        const radius = Math.max(1, Math.round(dpi / 300));
        sharpen(data.data, canvas.width, canvas.height, adj.sharpen, radius);
        ctx.putImageData(data, 0, 0);
      }
    }

    // Text goes on last: it must not be auto-levelled or sharpened, which would
    // halo every glyph edge. It sits in the photo's own frame rather than the
    // paper's, so a photo the packer turned sideways carries its caption round
    // with it and reads correctly once the print is cut out.
    if (o.texts && o.texts.length && App.drawTexts) {
      const packRot = (((o.packRot || 0) % 360) + 360) % 360;
      const packSwapped = packRot === 90 || packRot === 270;
      ctx.save();
      ctx.translate(border + innerW / 2, border + innerH / 2);
      if (packRot) ctx.rotate((packRot * Math.PI) / 180);
      App.drawTexts(ctx, o.texts, packSwapped ? innerH : innerW, packSwapped ? innerW : innerH);
      ctx.restore();
    }

    return canvas;
  };

  /* Preview-sized render of a photo with its adjustments applied, used for the
     library thumbnails. */
  App.previewAdjusted = function (source, maxEdge, adj) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const k = Math.min(1, maxEdge / Math.max(sw, sh));
    return App.renderSlot(source, Math.round(sw * k), Math.round(sh * k), {
      fit: 'contain',
      adj: Object.assign({}, adj, { sharpen: 0 }), // sharpening misleads at preview scale
      dpi: 96
    });
  };

  /* --------------------------------------------- optional AI super-resolution */

  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const AI = {
    scripts: [
      CDN + '@tensorflow/tfjs@4.22.0/dist/tf.min.js',
      CDN + '@upscalerjs/default-model@1.0.0/dist/umd/index.min.js',
      CDN + 'upscaler@1.0.0/dist/browser/umd/upscaler.min.js'
    ],
    model: (scale) => CDN + '@upscalerjs/esrgan-slim@1.0.0/models/x' + scale + '/model.json',
    loaded: null,
    instances: {}
  };

  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  App.aiAvailable = function () {
    // WebGL is what makes this tolerably fast; the CPU backend takes minutes.
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      return false;
    }
  };

  function loadAi(onStatus) {
    if (AI.loaded) return AI.loaded;
    AI.loaded = (async () => {
      for (let i = 0; i < AI.scripts.length; i++) {
        if (onStatus) onStatus('Loading AI model… (' + (i + 1) + '/' + AI.scripts.length + ')');
        await injectScript(AI.scripts[i]);
      }
      if (typeof window.Upscaler !== 'function') throw new Error('Upscaler unavailable');
      return window.Upscaler;
    })().catch((e) => {
      AI.loaded = null; // allow a retry on a flaky network
      throw e;
    });
    return AI.loaded;
  }

  function upscalerFor(Upscaler, scale) {
    if (!AI.instances[scale]) {
      AI.instances[scale] = new Upscaler({
        model: { path: AI.model(scale), scale: scale, modelType: 'layers' }
      });
    }
    return AI.instances[scale];
  }

  App.aiUpscale = async function (source, scale, onProgress) {
    const factor = scale >= 3 ? 4 : 2;
    const Upscaler = await loadAi(onProgress);
    if (onProgress) onProgress('Enhancing… 0%');
    const upscaler = upscalerFor(Upscaler, factor);

    const result = await upscaler.execute(source, {
      output: 'base64',
      patchSize: 64,
      padding: 4,
      progress: (rate) => {
        if (onProgress) onProgress('Enhancing… ' + Math.round((rate || 0) * 100) + '%');
      }
    });

    const img = await App.loadImage(result);
    const out = canvasOf(img.naturalWidth, img.naturalHeight);
    out.getContext('2d').drawImage(img, 0, 0);
    return out;
  };

  /* Public entry point: reach the requested factor by the best available means,
     preferring AI and silently degrading to stepped resampling. */
  App.enlarge = async function (source, factor, onProgress) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const targetW = Math.round(sw * factor);
    const targetH = Math.round(sh * factor);

    if (App.aiAvailable() && sw * sh <= 4000000) {
      try {
        let canvas = await App.aiUpscale(source, factor, onProgress);
        // ESRGAN only does fixed 2x/4x. Trim surplus resolution away, but never
        // stretch past what the model produced — that would just re-blur it.
        if (canvas.width > targetW + 2) {
          canvas = App.resampleStepped(canvas, targetW, targetH);
        }
        return { canvas, method: 'ai' };
      } catch (e) {
        console.warn('AI upscale unavailable, falling back to resampling:', e && e.message);
      }
    }

    if (onProgress) onProgress('Resampling…');
    const out = canvasOf(targetW, targetH);
    const ctx = ctx2d(out);
    ctx.drawImage(source, 0, 0, targetW, targetH);
    // A gentle unsharp pass restores the bite that any interpolation removes.
    const data = ctx.getImageData(0, 0, out.width, out.height);
    sharpen(data.data, out.width, out.height, 45, Math.max(1, Math.round(factor)));
    ctx.putImageData(data, 0, 0);
    return { canvas: out, method: 'resample' };
  };
})((window.App = window.App || {}));
