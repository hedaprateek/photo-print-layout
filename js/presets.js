/* Paper + photo size presets. All internal units are millimetres. */
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

  /* Photo / print sizes. `id` is stable; do not rename once shipped. */
  App.SIZES = [
    { id: 'id_35x45', name: 'Passport 35×45 mm', w: 35, h: 45, group: 'Identity' },
    { id: 'id_2x2', name: 'Passport 2×2 in (US)', w: 2 * IN, h: 2 * IN, group: 'Identity' },
    { id: 'id_35x35', name: 'Visa 35×35 mm', w: 35, h: 35, group: 'Identity' },
    { id: 'id_25x35', name: 'Small ID 25×35 mm', w: 25, h: 35, group: 'Identity' },
    { id: 'id_stamp', name: 'Stamp 20×25 mm', w: 20, h: 25, group: 'Identity' },
    { id: 'id_50x70', name: 'ID 50×70 mm', w: 50, h: 70, group: 'Identity' },
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

  App.QUALITY = [
    { id: 150, name: '150 DPI — draft / fast' },
    { id: 300, name: '300 DPI — photo quality' },
    { id: 600, name: '600 DPI — maximum' }
  ];

  App.findPaper = (id) => App.PAPERS.find((p) => p.id === id) || App.PAPERS[1];
  App.findSize = (id) => App.SIZES.find((s) => s.id === id) || App.SIZES[0];

  /* mm -> device pixels at a given DPI */
  App.mmToPx = (mm, dpi) => Math.max(1, Math.round((mm / IN) * dpi));

  App.fmtMm = (mm) => {
    const r = Math.round(mm * 10) / 10;
    return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)) + ' mm';
  };
})((window.App = window.App || {}));
