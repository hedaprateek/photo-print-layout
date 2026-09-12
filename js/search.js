/* Optional online photo search. The app is fully usable without this.
   Keys live in this browser's localStorage only and are never sent anywhere
   except to the provider they belong to. */
(function (App) {
  'use strict';

  const KEY_STORE = 'ppl.apikeys';

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

  App.PROVIDERS = {
    pexels: {
      name: 'Pexels',
      signup: 'https://www.pexels.com/api/new/',
      /* Quality tiers map to the sizes Pexels already renders for us. */
      tiers: [
        { id: 'large2x', name: 'Large (≈1880 px)' },
        { id: 'original', name: 'Original (full size)' }
      ],
      async search(key, query, page) {
        const res = await fetch(
          'https://api.pexels.com/v1/search?per_page=24&query=' +
            encodeURIComponent(query) +
            '&page=' + page,
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
            urls: { large2x: p.src.large2x, original: p.src.original },
            provider: 'pexels'
          }))
        };
      }
    },

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
          'https://api.unsplash.com/search/photos?per_page=24&query=' +
            encodeURIComponent(query) +
            '&page=' + page,
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
            downloadLocation: p.links && p.links.download_location,
            urls: { regular: p.urls.regular, full: p.urls.full, raw: p.urls.raw },
            provider: 'unsplash'
          }))
        };
      },
      /* Unsplash's API terms require pinging this when a photo is actually used. */
      trackDownload(key, result) {
        if (!result.downloadLocation) return;
        fetch(result.downloadLocation, { headers: { Authorization: 'Client-ID ' + key } }).catch(
          () => {}
        );
      }
    }
  };

  App.search = async function (provider, query, page) {
    const def = App.PROVIDERS[provider];
    const key = (App.keys.read() || {})[provider];
    if (!key) throw new Error('Add a free ' + def.name + ' key in Settings to search');
    return def.search(key, query, page || 1);
  };

  /* Fetch the chosen quality tier as a Blob so it behaves exactly like an
     uploaded file from here on — and so printing never depends on the network. */
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
