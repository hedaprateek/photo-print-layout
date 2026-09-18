/* Sheet layout. Two engines:
     grid  — one size repeated, arranged in the densest rows/columns
     pack  — mixed sizes fitted by MaxRects so the fewest sheets are used
   All dimensions in millimetres. */
(function (App) {
  'use strict';

  const EPS = 1e-6;

  function usable(paper, margin) {
    return { w: paper.w - margin * 2, h: paper.h - margin * 2 };
  }

  /* ------------------------------------------------------------------- grid */

  /* Densest cols×rows for one item size, trying the item on its side too. */
  App.gridFit = function (paper, margin, gap, item, allowRotate) {
    const area = usable(paper, margin);
    const candidates = [{ w: item.w, h: item.h, rot: false }];
    if (allowRotate && Math.abs(item.w - item.h) > EPS) {
      candidates.push({ w: item.h, h: item.w, rot: true });
    }

    let best = null;
    for (const c of candidates) {
      const cols = Math.floor((area.w + gap + EPS) / (c.w + gap));
      const rows = Math.floor((area.h + gap + EPS) / (c.h + gap));
      const perSheet = cols * rows;
      if (perSheet <= 0) continue;
      if (!best || perSheet > best.perSheet) best = { ...c, cols, rows, perSheet };
    }
    return best;
  };

  App.layoutGrid = function (opts) {
    const { paper, margin, gap, item, count, allowRotate, photoId, slotFit } = opts;
    const fit = App.gridFit(paper, margin, gap, item, allowRotate);
    if (!fit) return { pages: [], perSheet: 0, error: 'too-big' };

    const blockW = fit.cols * fit.w + (fit.cols - 1) * gap;
    const blockH = fit.rows * fit.h + (fit.rows - 1) * gap;
    const originX = (paper.w - blockW) / 2;
    const originY = (paper.h - blockH) / 2;

    const pages = [];
    let placed = 0;
    while (placed < count) {
      const items = [];
      for (let r = 0; r < fit.rows && placed < count; r++) {
        for (let c = 0; c < fit.cols && placed < count; c++) {
          items.push({
            photoId,
            x: originX + c * (fit.w + gap),
            y: originY + r * (fit.h + gap),
            w: fit.w,
            h: fit.h,
            rot: fit.rot,
            fit: slotFit
          });
          placed++;
        }
      }
      pages.push({ items });
    }
    return { pages, perSheet: fit.perSheet, cols: fit.cols, rows: fit.rows, rotated: fit.rot };
  };

  /* Largest size with ratio `aspect` (w/h) that still fits `perSheet` per page.
     This is the "use the whole sheet" mode. */
  App.maximiseSize = function (paper, margin, gap, aspect, perSheet, allowRotate) {
    const area = usable(paper, margin);
    let best = null;

    const evaluate = (cols, rows, ratio, rot) => {
      if (cols < 1 || rows < 1 || cols * rows < perSheet) return;
      const wByWidth = (area.w - (cols - 1) * gap) / cols;
      const hByHeight = (area.h - (rows - 1) * gap) / rows;
      // Honour the aspect ratio: whichever axis runs out first sets the size.
      let w = Math.min(wByWidth, hByHeight * ratio);
      let h = w / ratio;
      if (w <= 0 || h <= 0) return;
      const areaUsed = w * h * perSheet;
      if (!best || areaUsed > best.areaUsed + EPS) {
        // Store the photo's own size, not the slot's: a rotated placement means
        // the slot is the photo turned on its side.
        best = { w: rot ? h : w, h: rot ? w : h, rot, cols, rows, areaUsed };
      }
    };

    for (let cols = 1; cols <= perSheet; cols++) {
      const rows = Math.ceil(perSheet / cols);
      evaluate(cols, rows, aspect, false);
      if (allowRotate) evaluate(cols, rows, 1 / aspect, true);
    }
    if (!best) return null;
    return { w: best.w, h: best.h };
  };

  /* ------------------------------------------------------- MaxRects packing */

  /* Maximal-rectangles free-space packing. Chosen over shelf/guillotine
     packing because it handles the awkward mix of tall and wide photos that a
     real print run contains.

     Three placement heuristics are offered because no single one wins
     everywhere: best-short-side-fit is strong on ragged mixtures but will
     happily rotate the first photo and wreck an otherwise perfect grid, which
     bottom-left handles correctly. `layoutPack` runs several and keeps the
     best result. */
  class MaxRects {
    constructor(w, h) {
      this.free = [{ x: 0, y: 0, w, h }];
      this.used = [];
    }

    insert(w, h, allowRotate, heuristic) {
      let best = null;
      for (const fr of this.free) {
        const consider = (rw, rh, rot) => {
          if (rw > fr.w + EPS || rh > fr.h + EPS) return;
          const dw = fr.w - rw;
          const dh = fr.h - rh;
          let primary;
          let secondary;
          if (heuristic === 'bl') {
            // Lowest resulting bottom edge, then leftmost: keeps regular
            // grids regular instead of chasing the tightest single gap.
            primary = fr.y + rh;
            secondary = fr.x;
          } else if (heuristic === 'baf') {
            primary = fr.w * fr.h - rw * rh;
            secondary = Math.min(dw, dh);
          } else {
            primary = Math.min(dw, dh);
            secondary = Math.max(dw, dh);
          }
          // Strict improvement only, so an equally good unrotated placement
          // (considered first) is never displaced by a rotated one.
          if (
            !best ||
            primary < best.primary - EPS ||
            (Math.abs(primary - best.primary) < EPS && secondary < best.secondary - EPS)
          ) {
            best = { x: fr.x, y: fr.y, w: rw, h: rh, rot, primary, secondary };
          }
        };
        consider(w, h, false);
        if (allowRotate && Math.abs(w - h) > EPS) consider(h, w, true);
      }
      if (!best) return null;

      const node = { x: best.x, y: best.y, w: best.w, h: best.h, rot: best.rot };
      this.place(node);
      return node;
    }

    place(node) {
      const next = [];
      for (const fr of this.free) {
        if (this.splitFree(fr, node, next)) continue;
        next.push(fr);
      }
      this.free = next;
      this.prune();
      this.used.push(node);
    }

    /* Carve `fr` around `node`, pushing the surviving strips into `out`.
       Returns false when they don't overlap at all. */
    splitFree(fr, node, out) {
      if (
        node.x >= fr.x + fr.w - EPS ||
        node.x + node.w <= fr.x + EPS ||
        node.y >= fr.y + fr.h - EPS ||
        node.y + node.h <= fr.y + EPS
      ) {
        return false;
      }
      if (node.x < fr.x + fr.w - EPS && node.x + node.w > fr.x + EPS) {
        if (node.y > fr.y + EPS && node.y < fr.y + fr.h - EPS) {
          out.push({ x: fr.x, y: fr.y, w: fr.w, h: node.y - fr.y });
        }
        if (node.y + node.h < fr.y + fr.h - EPS) {
          out.push({ x: fr.x, y: node.y + node.h, w: fr.w, h: fr.y + fr.h - (node.y + node.h) });
        }
      }
      if (node.y < fr.y + fr.h - EPS && node.y + node.h > fr.y + EPS) {
        if (node.x > fr.x + EPS && node.x < fr.x + fr.w - EPS) {
          out.push({ x: fr.x, y: fr.y, w: node.x - fr.x, h: fr.h });
        }
        if (node.x + node.w < fr.x + fr.w - EPS) {
          out.push({ x: node.x + node.w, y: fr.y, w: fr.x + fr.w - (node.x + node.w), h: fr.h });
        }
      }
      return true;
    }

    /* Drop free rectangles wholly contained in another, or the list explodes. */
    prune() {
      const f = this.free;
      for (let i = 0; i < f.length; i++) {
        for (let j = i + 1; j < f.length; j++) {
          if (contains(f[j], f[i])) {
            f.splice(i, 1);
            i--;
            break;
          }
          if (contains(f[i], f[j])) {
            f.splice(j, 1);
            j--;
          }
        }
      }
    }
  }

  function contains(a, b) {
    return (
      b.x >= a.x - EPS &&
      b.y >= a.y - EPS &&
      b.x + b.w <= a.x + a.w + EPS &&
      b.y + b.h <= a.y + a.h + EPS
    );
  }

  const HEURISTICS = ['bl', 'bssf', 'baf'];

  const ORDERS = {
    areaDesc: (a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h),
    maxSideDesc: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
    heightDesc: (a, b) => b.h - a.h || b.w - a.w
  };

  /* One pass of shelf-free packing: fill a sheet, send what's left to the next. */
  function packWith(queue, area, margin, gap, allowRotate, heuristic) {
    const pages = [];
    let remaining = queue;

    // Items are inflated by `gap` and packed into a bin inflated to match, so
    // each one carries its own gutter and the sheet edge lands on `margin`.
    while (remaining.length) {
      const bin = new MaxRects(area.w + gap, area.h + gap);
      const items = [];
      const leftovers = [];

      for (const it of remaining) {
        const node = bin.insert(it.w + gap, it.h + gap, allowRotate, heuristic);
        if (!node) {
          leftovers.push(it);
          continue;
        }
        items.push({
          photoId: it.photoId,
          x: margin + node.x,
          y: margin + node.y,
          w: node.w - gap,
          h: node.h - gap,
          rot: node.rot,
          fit: it.fit
        });
      }

      if (!items.length) return null; // nothing placeable; caller falls back
      pages.push({ items });
      remaining = leftovers;
    }
    return pages;
  }

  /* Fewest sheets wins. Ties go to the arrangement with less rotation, then to
     the tighter one — both read as "neater" on paper and cut more predictably. */
  function scoreOf(pages) {
    let rotations = 0;
    let spread = 0;
    for (const page of pages) {
      let maxX = 0;
      let maxY = 0;
      for (const it of page.items) {
        if (it.rot) rotations++;
        maxX = Math.max(maxX, it.x + it.w);
        maxY = Math.max(maxY, it.y + it.h);
      }
      spread += maxX * maxY;
    }
    return { sheets: pages.length, rotations, spread };
  }

  function better(a, b) {
    if (!b) return true;
    if (a.sheets !== b.sheets) return a.sheets < b.sheets;
    if (a.rotations !== b.rotations) return a.rotations < b.rotations;
    return a.spread < b.spread - EPS;
  }

  /* `entries`: [{ photoId, w, h, copies }] in mm. */
  App.layoutPack = function (opts) {
    const { paper, margin, gap, entries, allowRotate } = opts;
    const area = usable(paper, margin);

    const queue = [];
    for (const e of entries) {
      for (let i = 0; i < Math.max(1, e.copies || 1); i++) {
        queue.push({ photoId: e.photoId, w: e.w, h: e.h, fit: e.fit });
      }
    }

    const oversized = [];
    const fits = queue.filter((it) => {
      const ok =
        (it.w <= area.w + EPS && it.h <= area.h + EPS) ||
        (allowRotate && it.h <= area.w + EPS && it.w <= area.h + EPS);
      if (!ok) oversized.push(it);
      return ok;
    });

    if (!fits.length) return { pages: [], oversized };

    // No arrangement can beat this, so a candidate that reaches it ends the search.
    const totalArea = fits.reduce((s, it) => s + (it.w + gap) * (it.h + gap), 0);
    const floorSheets = Math.max(1, Math.ceil(totalArea / ((area.w + gap) * (area.h + gap)) - EPS));

    let best = null;
    let bestScore = null;

    // A uniform run is the commonest case by far (a sheet of one size) and the
    // regular grid is provably as dense as a lattice gets, so try it first.
    const uniform = fits.every((it) => Math.abs(it.w - fits[0].w) < EPS && Math.abs(it.h - fits[0].h) < EPS);
    if (uniform) {
      const g = App.layoutGrid({
        paper, margin, gap, allowRotate,
        item: { w: fits[0].w, h: fits[0].h },
        count: fits.length,
        photoId: fits[0].photoId
      });
      if (g.pages.length) {
        // layoutGrid assumes a single photo; restore each slot's real owner.
        let k = 0;
        for (const page of g.pages) {
          for (const it of page.items) {
            const src = fits[k++];
            it.photoId = src.photoId;
            it.fit = src.fit;
          }
        }
        best = g.pages;
        bestScore = scoreOf(g.pages);
      }
    }

    if (!best || bestScore.sheets > floorSheets) {
      outer: for (const orderName of Object.keys(ORDERS)) {
        const sorted = fits.slice().sort(ORDERS[orderName]);
        for (const heuristic of HEURISTICS) {
          const pages = packWith(sorted, area, margin, gap, allowRotate, heuristic);
          if (!pages) continue;
          const score = scoreOf(pages);
          if (better(score, bestScore)) {
            best = pages;
            bestScore = score;
          }
          if (bestScore.sheets <= floorSheets) break outer;
        }
      }
    }

    return { pages: best || [], oversized };
  };

  /* Share of the sheet covered by photos — the honest measure of how well the
     arrangement used the paper. */
  App.efficiency = function (pages, paper) {
    if (!pages.length) return 0;
    const sheet = paper.w * paper.h;
    const covered = pages.reduce(
      (sum, p) => sum + p.items.reduce((s, it) => s + it.w * it.h, 0),
      0
    );
    return covered / (sheet * pages.length);
  };
})((window.App = window.App || {}));
