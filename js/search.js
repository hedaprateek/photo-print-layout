/* Online photo search. Wikimedia Commons needs no key and works out of the
   box; Pexels and Unsplash are optional and need a free key of your own.
   Keys live in this browser's localStorage and go only to their own provider. */
(function (App) {
  'use strict';

  const KEY_STORE = 'ppl.apikeys';
  const PER_PAGE = 24;

  App.keys = {
    read() {
      try {
        return JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
      } catch (e) {
        return {};
      }
    },
    write(keys) {
      try {
        localStorage.setItem(KEY_STORE, JSON.stringify(keys));
      } catch (e) {
        console.warn('Could not save API keys', e);
      }
    }
  };

  const stripTags = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  App.PROVIDERS = {
    /* ------------------------------------------------------------ Wikimedia */
    wikimedia: {
      name: 'Wikimedia Commons',
      keyless: true,
      note: 'Free, no key needed. Photos are reusable but most require crediting the author.',
      /* Widths are requested from the API, which snaps up to a size it is
         willing to render — hand-built thumbnail URLs are rejected outright. */
      tiers: [
        { id: '1024', name: 'Large (≈1280 px)' },
        { id: '2048', name: 'Very large (≈3840 px)' },
        { id: 'original', name: 'Original file' }
      ],

      async search(key, query, page) {
        const url =
          'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
          '&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + query) +
          '&gsrnamespace=6&gsrlimit=' + PER_PAGE +
          '&gsroffset=' + (page - 1) * PER_PAGE +
          '&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=320' +
          '&format=json&origin=*';

        const res = await fetch(url);
        if (!res.ok) throw new Error('Wikimedia search failed (' + res.status + ')');
        const data = await res.json();
        const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
        // A generator returns pages keyed by id, losing the ranking; `index`
        // carries the original search order.
        pages.sort((a, b) => (a.index || 0) - (b.index || 0));

        return {
          total: (data.query && data.query.searchinfo && data.query.searchinfo.totalhits) || pages.length,
          results: pages
            .filter((p) => p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl)
            .map((p) => {
              const ii = p.imageinfo[0];
              const meta = ii.extmetadata || {};
              return {
                id: 'wm-' + p.pageid,
                title: p.title,
                thumb: ii.thumburl,
                width: ii.width,
                height: ii.height,
                credit: stripTags(meta.Artist && meta.Artist.value) || 'Wikimedia Commons',
                creditUrl: ii.descriptionurl,
                licence: stripTags(meta.LicenseShortName && meta.LicenseShortName.value),
                originalUrl: ii.url,
                provider: 'wikimedia'
              };
            })
        };
      },

      async resolve(result, tier) {
        if (tier === 'original') return result.originalUrl;
        const url =
          'https://commons.wikimedia.org/w/api.php?action=query&titles=' +
          encodeURIComponent(result.title) +
          '&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=' + encodeURIComponent(tier) +
          '&format=json&origin=*';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Could not reach Wikimedia (' + res.status + ')');
        const data = await res.json();
        const page = data.query && data.query.pages && Object.values(data.query.pages)[0];
        const ii = page && page.imageinfo && page.imageinfo[0];
        if (!ii) throw new Error('That file is no longer available');
        return ii.thumburl || ii.url;
      }
    },

    /* --------------------------------------------------------------- Pexels */
    pexels: {
      name: 'Pexels',
      signup: 'https://www.pexels.com/api/new/',
      tiers: [
        { id: 'large2x', name: 'Large (≈1880 px)' },
        { id: 'original', name: 'Original (full size)' }
      ],

      async search(key, query, page) {
        const res = await fetch(
          'https://api.pexels.com/v1/search?per_page=' + PER_PAGE +
            '&query=' + encodeURIComponent(query) + '&page=' + page,
          { headers: { Authorization: key } }
        );
        if (res.status === 401) throw new Error('Pexels rejected that key');
        if (!res.ok) throw new Error('Pexels search failed (' + res.status + ')');
        const data = await res.json();
        return {
          total: data.total_results,
          results: (data.photos || []).map((p) => ({
            id: 'pexels-' + p.id,
            thumb: p.src.medium,
            width: p.width,
            height: p.height,
            credit: p.photographer,
            creditUrl: p.url,
            licence: 'Pexels licence',
            urls: { large2x: p.src.large2x, original: p.src.original },
            provider: 'pexels'
          }))
        };
      },

      resolve(result, tier) {
        return Promise.resolve(result.urls[tier] || result.urls.original);
      }
    },

    /* ------------------------------------------------------------- Unsplash */
    unsplash: {
      name: 'Unsplash',
      signup: 'https://unsplash.com/oauth/applications',
      tiers: [
        { id: 'regular', name: 'Regular (1080 px)' },
        { id: 'full', name: 'Full (≈2048 px)' },
        { id: 'raw', name: 'Raw (full size)' }
      ],

      async search(key, query, page) {
        const res = await fetch(
          'https://api.unsplash.com/search/photos?per_page=' + PER_PAGE +
            '&query=' + encodeURIComponent(query) + '&page=' + page,
          { headers: { Authorization: 'Client-ID ' + key } }
        );
        if (res.status === 401) throw new Error('Unsplash rejected that Access Key');
        if (res.status === 403) throw new Error('Unsplash rate limit reached — try again later');
        if (!res.ok) throw new Error('Unsplash search failed (' + res.status + ')');
        const data = await res.json();
        return {
          total: data.total,
          results: (data.results || []).map((p) => ({
            id: 'unsplash-' + p.id,
            thumb: p.urls.small,
            width: p.width,
            height: p.height,
            credit: p.user && p.user.name,
            creditUrl: p.links && p.links.html,
            licence: 'Unsplash licence',
            downloadLocation: p.links && p.links.download_location,
            urls: { regular: p.urls.regular, full: p.urls.full, raw: p.urls.raw },
            provider: 'unsplash'
          }))
        };
      },

      resolve(result, tier) {
        return Promise.resolve(result.urls[tier] || result.urls.regular);
      },

      /* Unsplash's API terms require pinging this when a photo is actually used. */
      trackDownload(key, result) {
        if (!result.downloadLocation) return;
        fetch(result.downloadLocation, { headers: { Authorization: 'Client-ID ' + key } }).catch(() => {});
      }
    }
  };

  App.search = async function (provider, query, page) {
    const def = App.PROVIDERS[provider];
    const key = (App.keys.read() || {})[provider];
    if (!def.keyless && !key) {
      throw new Error('Add a free ' + def.name + ' key in Settings, or search Wikimedia Commons instead');
    }
    return def.search(key, query, page || 1);
  };

  App.resolveResultUrl = function (result, tier) {
    return App.PROVIDERS[result.provider].resolve(result, tier);
  };

  /* Fetch the chosen quality as a Blob so it behaves exactly like an uploaded
     file from here on — and so printing never depends on the network. */
  App.fetchRemote = async function (url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Download failed (' + res.status + ')');
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('That URL is not an image');
    return blob;
  };

  App.trackUnsplashDownload = function (result) {
    const def = App.PROVIDERS.unsplash;
    const key = (App.keys.read() || {}).unsplash;
    if (key && def.trackDownload) def.trackDownload(key, result);
  };
})((window.App = window.App || {}));
