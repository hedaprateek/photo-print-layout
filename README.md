# Print Sheet

Arrange any number of photos onto a sheet of paper with as little waste as
possible, enhance them for print, then send them straight to the printer.

**Live: https://hedaprateek.github.io/photo-print-layout/**

Everything runs in your browser. Photos are never uploaded anywhere.

---

## What it does

**Add photos** — drop in any number from your device, search Wikimedia Commons
(no key, no setup), search Pexels or Unsplash with a free key of your own, or
paste an image URL. Drag entries in the list to reorder them.

**Pick a paper size** — A3, A4, A5, A6, Letter, Legal, Tabloid, 4×6, 5×7, 8×10,
or a custom size in millimetres. Portrait or landscape.

**Pick a print size** — passport 35×45, US 2×2, visa 35×35, stamp 20×25, 3R, 4R,
5R, 6R, 8R, squares, postcard, wallet, or a custom size. Or choose *Fill the
sheet* and it works out the largest size that fits the number you want per page.

**Three ways to arrange:**

- **One size** — one photo at one size, any number of copies, in the densest
  grid that fits. A4 holds 30 passport photos with a 5 mm margin and 2 mm gaps.
  Switch to "Every photo, own sheets" to do a whole batch at once.
- **Mixed sizes** — every photo can carry *several* sizes at once. One 4R plus
  eight passport plus six stamp of the same face is a single job, not three.
  Sheets are then packed to use the fewest pages.
- **Contact sheet** — every photo as a labelled thumbnail, for choosing which
  ones to print properly.

**Then print or save a PDF** at 150, 300 or 600 DPI.

Save any combination as a named setup ("8 passport on A4") and pull it back in
one click. `Ctrl+Z` undoes removals, reordering and edits.

## The parts that matter for printing

**It tells you when a photo is too small.** Every photo shows the resolution it
will actually achieve at the size you chose — `214 DPI · Acceptable`,
`96 DPI · Too low`. This is the usual reason prints disappoint, and you find out
before you waste paper rather than after.

**It warns before your printer clips the page.** Almost no consumer printer
reaches the paper edge. Tell it what you have — typical inkjet, wide-bottom
inkjet, laser, borderless — and it flags any photo straying into the band that
physically cannot be printed, and says what margin to use instead.

**It sharpens for paper.** Ink spreads slightly when it hits paper, so a file
that looks crisp on screen prints soft. Unsharp masking is applied after the
image reaches its final print resolution, which is the correct order and the
step most tools skip. Default 35; 30–50 suits most photos.

**Auto-enhance** stretches each colour channel's histogram to its true black and
white points, which fixes flat contrast and neutralises colour casts at the same
time. Dull phone photos improve a lot.

**Proper cropping, with identity guides.** Drag the photo to reposition it, zoom
up to 4×, or pick one of nine anchors. For passport and visa sizes an overlay
shows where the head and eyes have to sit — the rules that get applications
rejected.

**AI upscaling** for photos that are genuinely too small. It runs an ESRGAN
super-resolution model in your browser via TensorFlow.js — it reconstructs
detail rather than just stretching pixels. The model (~5 MB) downloads only when
you first click the button. Without WebGL, or if the model can't load, it falls
back to high-quality stepped resampling with a sharpening pass, and says so.

**Cutting guides that don't land on the photo.** Corner marks sit out in the
gutter, which is what you actually cut to; a dashed rectangle drawn on the trim
line ends up printed on the picture. With no gutter to put them in, it falls
back to shared hairlines automatically. An optional white border can be added
inside each print.

**It flags wide-gamut photos.** A Display P3 or Adobe RGB file is converted to
sRGB the moment it is drawn, and saturated reds and greens shift. The embedded
ICC profile is read and the photo badged, so the change isn't a surprise.

**Exact millimetres.** Sheets are built at true size and the page size is handed
to the browser directly, so the printer doesn't rescale them. Rotation and
cropping are baked into the bitmaps, so PDFs print identically everywhere.
`Ctrl+P` renders real sheets rather than whatever happens to be on screen.

## Optional: Pexels and Unsplash

Wikimedia Commons search needs nothing. To add the other two, open **Settings**
and paste a free key:

- **Pexels** — [pexels.com/api](https://www.pexels.com/api/new/), instant, copy the API key.
- **Unsplash** — [unsplash.com/developers](https://unsplash.com/oauth/applications),
  create an application, copy the *Access Key*.

Keys are kept in your browser's `localStorage` and are only ever sent to the
provider they belong to. There is no server involved, which is also why the keys
can't be bundled in for you — anything shipped in a static page is public.

Searched photos are downloaded to your device at the quality you choose before
being placed, so printing never depends on the network.

## Privacy

No accounts, no uploads, no analytics. Photos stay on your device. They're kept
in IndexedDB so an accidental reload doesn't lose your work — turn that off in
Settings, which also clears what's stored.

## Running it locally

No build step, no dependencies to install:

```
git clone https://github.com/hedaprateek/photo-print-layout.git
cd photo-print-layout
python -m http.server 8000     # or: npx serve
```

Then open `http://localhost:8000`. Opening `index.html` directly from disk works
too, though some browsers restrict `file://` pages.

## How it's built

Plain HTML, CSS and JavaScript — no framework and no build, so what's in the repo
is exactly what runs.

| File | Purpose |
|---|---|
| `js/presets.js` | Paper, print-size and printer tables; millimetre/DPI conversions |
| `js/layout.js` | Grid fitting, area maximising, MaxRects packing, contact sheets |
| `js/imaging.js` | Resampling, auto-levels, unsharp masking, AI upscaling |
| `js/profile.js` | ICC / PNG colour-profile reader |
| `js/render.js` | Screen preview, print DOM, crop marks, PDF export |
| `js/search.js` | Wikimedia Commons, Pexels and Unsplash providers |
| `js/idb.js` | IndexedDB photo persistence |
| `js/app.js` | State and UI |

Two external libraries load lazily from a CDN, only when used:
[jsPDF](https://github.com/parallax/jsPDF) for PDF export and
[UpscalerJS](https://upscalerjs.com/) + TensorFlow.js for AI upscaling. Nothing
else is fetched.

### The packing

For a uniform run the regular grid is used, since a lattice can't be beaten for
identical rectangles. For mixed sizes it runs MaxRects under three placement
heuristics (bottom-left, best-short-side-fit, best-area-fit) across three sort
orders and keeps the best result — fewest sheets first, then least rotation,
then tightest. No single heuristic wins everywhere: best-short-side-fit is
strong on ragged mixtures but will rotate the first photo and wreck an otherwise
perfect grid, which bottom-left gets right. The whole search runs in a few
milliseconds, so the preview stays live while you type.

### Keeping it fast

The largest win is simply not doing pointless work: bitmaps are never rendered
beyond the source photo's own resolution. Asking for 600 DPI from a 1200×1800
file renders at 300 and prints at exactly the same physical size, with no detail
lost and a quarter of the pixels.

Sharpening is then made cheaper in two ways that do not change the filter. It
runs on luminance rather than each colour channel, which is three times less
work and also avoids the coloured fringes that per-channel sharpening leaves
along edges. And for large slots the blur is computed on a reduced copy — but
only by a factor the kernel can absorb, never more than the radius itself, with
the reduced blur using `radius / k` so the effective kernel stays the size that
was asked for.

That restraint matters. Shrinking by an arbitrary factor is far faster and was
tried first, but at 600 DPI it turned a 2-pixel kernel into a ~12-pixel one:
fine-detail sharpening quietly became a local-contrast effect, differing from
the true blur by about 10 levels out of 255. It was a different filter, not a
cheaper one, so it was reverted.

Repeated slots are rendered once and embedded once: a sheet of 30 identical
passport photos stores one bitmap, not thirty.

---

**Stunity Tech** · by Prateek
