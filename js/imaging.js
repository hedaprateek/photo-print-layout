/* Image loading, print-oriented enhancement, and optional AI super-resolution.
   Everything here runs client-side; nothing is uploaded anywhere. */
(function (App) {
  'use strict';

  const IN = App.MM_PER_IN;

  App.DEFAULT_ADJ = Object.freeze({
    auto: false,      // auto-levels + grey-world white balance
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
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, next.width, next.height);
      if (cur !== source && cur.width) cur.width = 0; // release
      cur = next;
      sw = next.width;
      sh = next.height;
    }

    const out = canvasOf(targetW, targetH);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cur, 0, 0, out.width, out.height);
    return out;
  };

  App.makeThumb = function (source, maxEdge) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const k = Math.min(1, maxEdge / Math.max(sw, sh));
    return App.resampleStepped(source, Math.round(sw * k), Math.round(sh * k));
  };

  /* ------------------------------------------------------------ print maths */

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
  App.upscaleFactorFor = function (imgW, imgH, slotWmm, slotHmm, fit, targetDpi) {
    const dpi = App.effectiveDpi(imgW, imgH, slotWmm, slotHmm, fit);
    if (!dpi) return 1;
    return Math.max(1, (targetDpi || 300) / dpi);
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

    const needsTone = exposure !== 1 || contrast !== 1 || warmth !== 0;
    if (needsTone) {
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

  /* Separable box blur, run three times to approximate a Gaussian. */
  function boxBlur(src, w, h, radius) {
    const tmp = new Uint8ClampedArray(src.length);
    const out = new Uint8ClampedArray(src);
    const div = radius * 2 + 1;

    for (let pass = 0; pass < 3; pass++) {
      // horizontal
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const x = Math.min(w - 1, Math.max(0, k));
            sum += out[row + x * 4 + c];
          }
          for (let x = 0; x < w; x++) {
            tmp[row + x * 4 + c] = sum / div;
            const addX = Math.min(w - 1, x + radius + 1);
            const subX = Math.max(0, x - radius);
            sum += out[row + addX * 4 + c] - out[row + subX * 4 + c];
          }
        }
      }
      // vertical
      for (let x = 0; x < w; x++) {
        const col = x * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const y = Math.min(h - 1, Math.max(0, k));
            sum += tmp[y * w * 4 + col + c];
          }
          for (let y = 0; y < h; y++) {
            out[y * w * 4 + col + c] = sum / div;
            const addY = Math.min(h - 1, y + radius + 1);
            const subY = Math.max(0, y - radius);
            sum += tmp[addY * w * 4 + col + c] - tmp[subY * w * 4 + col + c];
          }
        }
      }
    }
    return out;
  }

  /* Unsharp mask. Ink spreads slightly on paper, so prints need more
     sharpening than screens — this is the step that stops prints looking soft. */
  function unsharpMask(imageData, w, h, amount, radius, threshold) {
    if (amount <= 0) return;
    const d = imageData.data;
    const blurred = boxBlur(d, w, h, Math.max(1, radius));
    const k = amount / 100;
    const thr = threshold || 2;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = d[i + c] - blurred[i + c];
        if (diff > thr || diff < -thr) d[i + c] = d[i + c] + diff * k;
      }
    }
  }

  /* ------------------------------------------------------- the print pipeline */

  /* Draw `source` into a w×h pixel canvas: rotate, cover/contain-fit with a
     focal point, then tone-correct and sharpen. Order matters — sharpening
     must come last, after the image is at its final print resolution. */
  App.renderSlot = function (source, pxW, pxH, opts) {
    const o = opts || {};
    const fit = o.fit || 'cover';
    const rot = ((o.rotate || 0) % 360 + 360) % 360;
    const focus = o.focus || { x: 0.5, y: 0.5 };
    const adj = Object.assign({}, App.DEFAULT_ADJ, o.adj || {});

    const canvas = canvasOf(pxW, pxH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const swapped = rot === 90 || rot === 270;
    const boxW = swapped ? canvas.height : canvas.width;
    const boxH = swapped ? canvas.width : canvas.height;

    const iw = source.naturalWidth || source.width;
    const ih = source.naturalHeight || source.height;
    const imgRatio = iw / ih;
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

    // Pre-shrink big sources so the final draw is a mild resize, not a 10x one.
    let src = source;
    if (iw > drawW * 2 && ih > drawH * 2) {
      src = App.resampleStepped(source, Math.ceil(drawW), Math.ceil(drawH));
    }

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(src, -boxW / 2 + (boxW - drawW) * focus.x, -boxH / 2 + (boxH - drawH) * focus.y, drawW, drawH);
    ctx.restore();

    const touchesTone =
      adj.auto || adj.exposure || adj.contrast || adj.saturation || adj.warmth || adj.sharpen > 0;
    if (touchesTone) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (adj.auto) autoLevels(data, 0.005);
      applyAdjustments(data, adj);
      if (adj.sharpen > 0) {
        // Scale radius with output resolution so 600 DPI isn't under-sharpened.
        const radius = Math.max(1, Math.round((o.dpi || 300) / 300));
        unsharpMask(data, canvas.width, canvas.height, adj.sharpen, radius, 2);
      }
      ctx.putImageData(data, 0, 0);
    }

    return canvas;
  };

  /* Preview-sized render of a single photo with its adjustments applied,
     used for the library thumbnails and the editor. */
  App.previewAdjusted = function (source, maxEdge, adj) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const k = Math.min(1, maxEdge / Math.max(sw, sh));
    return App.renderSlot(source, Math.round(sw * k), Math.round(sh * k), {
      fit: 'contain',
      adj: Object.assign({}, adj, { sharpen: 0 }), // sharpening is misleading at preview scale
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

  /* Super-resolve `source` by 2x or 4x. Resolves to a canvas.
     Rejects only if the AI path is unusable — callers fall back to resampling. */
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

  /* Public entry point: reach `targetLongEdge` pixels by the best available
     means, preferring AI and silently degrading to stepped resampling. */
  App.enlarge = async function (source, factor, onProgress) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const targetW = Math.round(sw * factor);
    const targetH = Math.round(sh * factor);

    if (App.aiAvailable() && sw * sh <= 4_000_000) {
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
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, targetW, targetH);
    // A gentle unsharp pass restores the bite that any interpolation removes.
    const data = ctx.getImageData(0, 0, out.width, out.height);
    unsharpMask(data, out.width, out.height, 45, Math.max(1, Math.round(factor)), 2);
    ctx.putImageData(data, 0, 0);
    return { canvas: out, method: 'resample' };
  };
})((window.App = window.App || {}));
