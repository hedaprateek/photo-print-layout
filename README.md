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
  *All photos, shared sheets* runs a whole batch at that size and fills each
  sheet right up before starting another — three photos at four copies each is
  one sheet, not three. *Every photo, own sheets* keeps them separate when that
  is what you want.
- **Mixed sizes** — every photo can carry *several* sizes at once. One 4R plus
  eight passport plus six stamp of the same face is a single job, not three.
  Sheets are then packed to use the fewest pages.
- **Contact sheet** — every photo as a labelled thumbnail, for choosing which
  ones to print properly.

**Or skip all of that.** *Quick start* has one-click recipes for the jobs people
actually come here to do — 8 passport, a full sheet of passport photos, 16 stamp,
2 × 4R, a full-page print, one sheet each, or a contact sheet. Each sets the
paper, size, margins and count in one go, and can be undone.

**Or arrange the sheet yourself.** Every sheet has an *Arrange by hand* switch.
Turn it on and the packer stops rearranging: drag any print where you want it,
pull its corner to resize, and use the buttons above it to turn it 90°, add
another copy, or take it off the sheet. Arrow keys nudge, Shift+arrow nudges
further, Delete removes. Prints snap to the page margins, the centre and each
other's edges, so arranging by hand still comes out square instead of undoing
the packing. *Back to automatic* returns to the packed layout, and undo brings
your arrangement back if you change your mind.

**The preview is at a scale you set.** It opens at *Actual size* — 100%, the
sheet at its real dimensions on screen — and says so. *Fit* shrinks it to the
window and labels itself "(fit)" so you always know what you are looking at, and
the − / + buttons step between 10% and 400%. **Gridlines** puts a 10 mm grid over
the sheet, heavier every 50 mm, for judging alignment by eye. It is drawn on
screen only and never reaches the paper.

**Then print or save a PDF** at 150, 300 or 600 DPI.

Save any combination as a named setup ("8 passport on A4") and pull it back in
one click. `Ctrl+Z` undoes removals, reordering and edits.

## The parts that matter for printing

**The size you ask for is the size you get.** Type 50 × 70 and every print is
50 × 70, whatever shape the photo is — nothing is turned round, resized or
cropped behind your back. A photo that does not match sits inside its frame with
a white margin, and the read-out tells you what the photo itself measures so the
difference is never a surprise. Two other modes are a click away: *Fill & crop*
keeps the size and cuts the overflow away, so the photo really is 50 × 70; and
*Trim to photo* shrinks each print to its own photo's shape — no crop and no
white edge, at the cost of prints coming out at different sizes.

*Turn the print to match the photo* is a switch, off by default. On, a landscape
photo at 4R prints 152 × 102 instead of 102 × 152, which is usually what you want
for a mixed batch — but it changes the size you typed, so it only happens if you
ask.

Identity sizes are the deliberate exception. A passport photo is 35 × 45 mm
whatever shape the original is, so those keep their official size and are
cropped to it — that one is not the app's call to make.

**It tells you when a photo is too small.** Every photo shows the resolution it
will actually achieve at the size you chose — `214 DPI · Acceptable`,
`96 DPI · Too low`. This is the usual reason prints disappoint, and you find out
before you waste paper rather than after.

**It warns before your printer clips the page.** Almost no consumer printer
reaches the paper edge. Tell it what you have — typical inkjet, wide-bottom
inkjet, laser, borderless — and it flags any photo straying into the band that
physically cannot be printed, and says what margin to use instead.

**It tells you about the print dialog.** Browsers shrink printouts unless
margins are set to *None* and scale to *100%*, and nothing on screen reveals it
— which is the usual reason a 35 mm passport photo comes out at 33 mm. The app
says so once, before the paper is spent, and remembers when you tell it not to
mention it again. If you are not sure your printer is behaving, **print a test
sheet**: a 100 mm ruler and a real 35 × 45 mm box to hold a ruler against.

**Low resolution is a way in, not a dead end.** The badge on each photo is a
button — click `96 DPI · Too low` and it opens that photo's enhance panel, where
you can upscale it. *Improve all* auto-enhances the whole batch in one go, and
undo puts it back.

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

**Text on the photo** — a name, a date, a caption, a watermark. Add as many
pieces as you like and drag each one into place on the preview. Five styles:
plain, soft shadow, outlined, a banner panel behind the words, or a caption bar
across the photo. Five typefaces, any colour, bold and italic, left/centre/right,
and multiple lines. Size is a share of the photo rather than a pixel count, so
the same text looks right whether it prints at stamp size or 8R.

Text is drawn into the print at full resolution *after* sharpening, so glyph
edges never pick up halos, and it sits in the photo's own frame — a print the
packer lays sideways to save paper carries its caption round with it and still
reads correctly once cut out.

**AI upscaling** for photos that are genuinely too small. It runs an ESRGAN
super-resolution model in your browser via TensorFlow.js — it reconstructs
detail rather than just stretching pixels. The model (~5 MB) downloads only when
you first click the button. Without WebGL, or if the model can't load, it falls
back to high-quality stepped resampling with a sharpening pass, and says so.

**Cutting guides, four ways.** *Corner marks* sit out in the gutter, so no line
is printed on the picture itself — the tidiest option when there is a gap to put
them in. *Dotted cut lines* draw a dashed rectangle round every print, which is
the easier thing to follow with scissors. *Solid cut lines* do the same
undashed, and *None* leaves the sheet clean. Corner marks fall back to dotted
automatically when there is no gutter to sit in. An optional white border can be
added inside each print.

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
| `js/text.js` | Text overlays: styles, and the canvas and DOM renderers |
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

Surplus resolution is trimmed, but only what sits *above* a good print
resolution. Asking 600 DPI of a photo that holds only 340 renders at 340 and
prints at exactly the same physical size, for a third of the pixels.

It never drops below 300, and that limit was learned the hard way. An earlier
version capped straight down to whatever the source held, which sounds harmless
and is not: the bitmap is then scaled up by the printer or the PDF viewer rather
than by us, which magnifies the sharpening halos and turns 8-pixel JPEG blocks
into visible ones. Measured against a clean render, a 4×6 print from a 1024×768
photo came out 2.45× further off that way — and a full A4 page was being sent to
the printer as 567×814 pixels.

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
