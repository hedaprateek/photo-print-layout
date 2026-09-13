/* Reads the embedded colour profile so wide-gamut photos can be flagged.

   A Display-P3 photo from a phone, or an Adobe RGB file from a camera, is
   converted to sRGB the moment it touches a canvas. That conversion is mostly
   fine, but saturated reds and greens shift visibly in print, and people are
   surprised by it. Detecting the profile lets the app say so up front.

   Only ICC profiles and PNG colour chunks are read. Exif-only colour-space
   signalling is skipped deliberately: it is rare, ambiguous, and the formats
   that matter here (Display P3, Adobe RGB, ProPhoto) all embed real ICC. */
(function (App) {
  'use strict';

  function ascii(dv, off, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      if (off + i >= dv.byteLength) break;
      const c = dv.getUint8(off + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /* Pull the human-readable name out of an ICC profile's `desc` tag. */
  function iccDescription(dv, base, length) {
    if (length < 132 || base + 132 > dv.byteLength) return null;
    const count = dv.getUint32(base + 128);
    if (!count || count > 200) return null;

    for (let i = 0; i < count; i++) {
      const entry = base + 132 + i * 12;
      if (entry + 12 > dv.byteLength) break;
      if (ascii(dv, entry, 4) !== 'desc') continue;

      const tag = base + dv.getUint32(entry + 4);
      if (tag + 12 > dv.byteLength) return null;
      const type = ascii(dv, tag, 4);

      if (type === 'desc') {
        // ICC v2: a plain ASCII string with its length at +8.
        const n = dv.getUint32(tag + 8);
        return ascii(dv, tag + 12, Math.min(Math.max(n - 1, 0), 120));
      }
      if (type === 'mluc') {
        // ICC v4: UTF-16BE records, offsets relative to the tag start.
        const records = dv.getUint32(tag + 8);
        if (!records) return null;
        const len = dv.getUint32(tag + 20);
        const off = dv.getUint32(tag + 24);
        let s = '';
        for (let k = 0; k + 1 < len && k < 240; k += 2) {
          const code = dv.getUint16(tag + off + k);
          if (!code) break;
          s += String.fromCharCode(code);
        }
        return s;
      }
      return null;
    }
    return null;
  }

  function jpegProfile(dv) {
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return undefined; // not a JPEG
    let i = 2;
    while (i + 4 < dv.byteLength) {
      if (dv.getUint8(i) !== 0xff) {
        i++;
        continue;
      }
      const marker = dv.getUint8(i + 1);
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      if (marker === 0xda) break; // start of scan: no more metadata
      const len = dv.getUint16(i + 2);
      if (len < 2) break;

      if (marker === 0xe2 && ascii(dv, i + 4, 11) === 'ICC_PROFILE') {
        // Skip the 14-byte ICC_PROFILE\0 + chunk-number preamble.
        const base = i + 4 + 14;
        return iccDescription(dv, base, len - 2 - 14);
      }
      i += 2 + len;
    }
    return null;
  }

  function pngProfile(dv) {
    if (dv.byteLength < 8 || dv.getUint32(0) !== 0x89504e47) return undefined; // not a PNG
    let i = 8;
    while (i + 8 < dv.byteLength) {
      const len = dv.getUint32(i);
      const type = ascii(dv, i + 4, 4);
      if (type === 'sRGB') return 'sRGB';
      if (type === 'iCCP') return ascii(dv, i + 8, Math.min(79, len)) || 'embedded ICC';
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return null;
  }

  /* Resolves to { name, srgb } when a profile is present, else null. */
  App.readColourProfile = async function (blob) {
    try {
      const buf = await blob.slice(0, 1024 * 1024).arrayBuffer();
      const dv = new DataView(buf);

      let name = jpegProfile(dv);
      if (name === undefined) name = pngProfile(dv);
      if (name === undefined || name === null || !name.trim()) return null;

      name = name.trim();
      // "sRGB IEC61966-2.1" and friends all count as the expected case.
      const srgb = /srgb/i.test(name);
      return { name, srgb };
    } catch (e) {
      return null;
    }
  };

  /* Short, plain-language warning, or null when nothing needs saying. */
  App.profileWarning = function (profile) {
    if (!profile || profile.srgb) return null;
    return (
      profile.name + ' colour profile — wider than sRGB, so strong reds and ' +
      'greens will print a little duller than they look on screen.'
    );
  };
})((window.App = window.App || {}));
