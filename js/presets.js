/* Paper, print-size, printer and quality tables. All internal units are mm. */
(function (App) {
  'use strict';

  const IN = 25.4; // mm per inch

  App.MM_PER_IN = IN;
  App.MM_TO_CSSPX = 96 / IN; // CSS reference pixel

  App.PAPERS = [
    { id: 'a3', name: 'A3', w: 297, h: 420, group: 'ISO' },
    { id: 'a4', name: 'A4', w: 210, h: 297, group: 'ISO' },
    { id: 'a5', name: 'A5', w: 148, h: 210, group: 'ISO' },
    { id: 'a6', name: 'A6', w: 105, h: 148, group: 'ISO' },
    { id: 'letter', name: 'Letter', w: 215.9, h: 279.4, group: 'US' },
    { id: 'legal', name: 'Legal', w: 215.9, h: 355.6, group: 'US' },
    { id: 'tabloid', name: 'Tabloid', w: 279.4, h: 431.8, group: 'US' },
    { id: 'photo4x6', name: '4×6 in photo', w: 4 * IN, h: 6 * IN, group: 'Photo paper' },
    { id: 'photo5x7', name: '5×7 in photo', w: 5 * IN, h: 7 * IN, group: 'Photo paper' },
    { id: 'photo8x10', name: '8×10 in photo', w: 8 * IN, h: 10 * IN, group: 'Photo paper' },
    { id: 'custom', name: 'Custom…', w: 210, h: 297, group: 'Custom' }
  ];

  /* Where the head and eyes must sit for an identity photo to be accepted,
     as fractions of the photo height measured from the top edge. Derived from
     the published head-height and eye-height ranges for each format; the
     midpoint of each range is used, which is what the overlay draws. */
  const PASSPORT_GUIDE = { headTop: 0.07, headBottom: 0.82, eyeLine: 0.53 };
  const US_GUIDE = { headTop: 0.12, headBottom: 0.78, eyeLine: 0.38 };
  const SQUARE_GUIDE = { headTop: 0.1, headBottom: 0.85, eyeLine: 0.45 };

  /* `id` is stable; do not rename once shipped. */
  App.SIZES = [
    { id: 'id_35x45', name: 'Passport 35×45 mm', w: 35, h: 45, group: 'Identity', guide: PASSPORT_GUIDE },
    { id: 'id_2x2', name: 'Passport 2×2 in (US)', w: 2 * IN, h: 2 * IN, group: 'Identity', guide: US_GUIDE },
    { id: 'id_35x35', name: 'Visa 35×35 mm', w: 35, h: 35, group: 'Identity', guide: SQUARE_GUIDE },
    { id: 'id_25x35', name: 'Small ID 25×35 mm', w: 25, h: 35, group: 'Identity', guide: PASSPORT_GUIDE },
    { id: 'id_stamp', name: 'Stamp 20×25 mm', w: 20, h: 25, group: 'Identity', guide: PASSPORT_GUIDE },
    { id: 'id_50x70', name: 'ID 50×70 mm', w: 50, h: 70, group: 'Identity', guide: PASSPORT_GUIDE },
    { id: 'p_3r', name: '3R · 3.5×5 in', w: 3.5 * IN, h: 5 * IN, group: 'Prints' },
    { id: 'p_4r', name: '4R · 4×6 in', w: 4 * IN, h: 6 * IN, group: 'Prints' },
    { id: 'p_5r', name: '5R · 5×7 in', w: 5 * IN, h: 7 * IN, group: 'Prints' },
    { id: 'p_6r', name: '6R · 6×8 in', w: 6 * IN, h: 8 * IN, group: 'Prints' },
    { id: 'p_8r', name: '8R · 8×10 in', w: 8 * IN, h: 10 * IN, group: 'Prints' },
    { id: 'sq_sm', name: 'Square 50 mm', w: 50, h: 50, group: 'Square' },
    { id: 'sq_md', name: 'Square 100 mm', w: 100, h: 100, group: 'Square' },
    { id: 'postcard', name: 'Postcard 148×105 mm', w: 148, h: 105, group: 'Other' },
    { id: 'wallet', name: 'Wallet 64×89 mm', w: 64, h: 89, group: 'Other' },
    { id: 'custom', name: 'Custom…', w: 60, h: 80, group: 'Custom' }
  ];

  /* Unprintable edges. Almost no consumer printer reaches the paper edge, so
     a page margin smaller than this silently clips the outer row of photos. */
  App.PRINTERS = [
    { id: 'inkjet', name: 'Inkjet — typical (3.5 mm)', edge: 3.5 },
    { id: 'inkjet_foot', name: 'Inkjet — wide bottom (3 / 14 mm)', edge: 3, bottom: 14 },
    { id: 'laser', name: 'Laser — typical (4.2 mm)', edge: 4.2 },
    { id: 'safe', name: 'Conservative (5 mm)', edge: 5 },
    { id: 'borderless', name: 'Borderless / edge-to-edge', edge: 0 },
    { id: 'custom', name: 'Custom…', edge: 3.5 }
  ];

  App.QUALITY = [
    { id: 150, name: '150 DPI — draft / fast' },
    { id: 300, name: '300 DPI — photo quality' },
    { id: 600, name: '600 DPI — maximum' }
  ];

  /* One-click recipes for the jobs people actually come here to do. Setting
     paper, size, margins and counts by hand is the main thing standing between
     "I need passport photos" and a sheet ready to print. */
  App.JOB_PRESETS = [
    {
      id: 'pp8',
      name: '8 passport',
      hint: 'Eight 35×45 mm passport photos on A4',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 2, fit: 'cover' },
      grid: { source: 'one', sizeId: 'id_35x45', fill: false, count: 8 }
    },
    {
      id: 'ppfull',
      name: 'Passport, full sheet',
      hint: 'As many 35×45 mm passport photos as an A4 sheet holds',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 2, fit: 'cover' },
      grid: { source: 'one', sizeId: 'id_35x45', fill: false, count: 30 }
    },
    {
      id: 'stamp16',
      name: '16 stamp',
      hint: 'Sixteen 20×25 mm stamp photos on A4',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 2, fit: 'cover' },
      grid: { source: 'one', sizeId: 'id_stamp', fill: false, count: 16 }
    },
    {
      id: 'r4x2',
      name: '2 × 4R',
      hint: 'Two 4×6 inch prints on one A4 sheet',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 3, fit: 'cover' },
      grid: { source: 'one', sizeId: 'p_4r', fill: false, count: 2 }
    },
    {
      id: 'fullpage',
      name: 'Full page',
      hint: 'One photo as large as the sheet allows',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 0, fit: 'cover' },
      grid: { source: 'one', fill: true, fillCount: 1 }
    },
    {
      id: 'everyone',
      name: 'One sheet each',
      hint: 'Every photo gets its own sheet of 8 passport photos',
      settings: { mode: 'grid', paperId: 'a4', orientation: 'portrait', margin: 5, gap: 2, fit: 'cover' },
      grid: { source: 'each', sizeId: 'id_35x45', fill: false, count: 8 }
    },
    {
      id: 'contact',
      name: 'Contact sheet',
      hint: 'Every photo as a labelled thumbnail, to choose from',
      settings: { mode: 'contact', paperId: 'a4', orientation: 'portrait', margin: 8, gap: 3, contactCols: 4 },
      grid: {}
    }
  ];

  App.findPaper = (id) => App.PAPERS.find((p) => p.id === id) || App.PAPERS[1];
  App.findSize = (id) => App.SIZES.find((s) => s.id === id) || App.SIZES[0];
  App.findPrinter = (id) => App.PRINTERS.find((p) => p.id === id) || App.PRINTERS[0];

  /* Unprintable band on each side, in mm. */
  App.printerEdges = function (printerId, customEdge) {
    const p = App.findPrinter(printerId);
    const edge = printerId === 'custom' ? (customEdge || 0) : p.edge;
    return { top: edge, right: edge, left: edge, bottom: p.bottom !== undefined ? p.bottom : edge };
  };

  /* mm -> device pixels at a given DPI */
  App.mmToPx = (mm, dpi) => Math.max(1, Math.round((mm / IN) * dpi));

  App.fmtMm = (mm) => {
    const r = Math.round(mm * 10) / 10;
    return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)) + ' mm';
  };
})((window.App = window.App || {}));
