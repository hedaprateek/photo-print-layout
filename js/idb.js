/* Tiny IndexedDB wrapper so an accidental reload doesn't lose the photo library. */
(function (App) {
  'use strict';

  const DB_NAME = 'photo-print-layout';
  const DB_VERSION = 1;
  const STORE = 'photos';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      // Private windows and blocked site-data land here. The app stays usable, just without persistence.
      console.warn('Photo persistence disabled:', err && err.message);
      return null;
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then((db) => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let out;
        try {
          out = fn(store);
        } catch (e) {
          return reject(e);
        }
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    });
  }

  App.idb = {
    /* `rec` must be structured-cloneable: Blobs are, object URLs are not. */
    put(rec) {
      return tx('readwrite', (s) => s.put(rec)).catch((e) => console.warn('idb put failed', e));
    },
    delete(id) {
      return tx('readwrite', (s) => s.delete(id)).catch((e) => console.warn('idb delete failed', e));
    },
    clear() {
      return tx('readwrite', (s) => s.clear()).catch((e) => console.warn('idb clear failed', e));
    },
    all() {
      return tx('readonly', (s) => s.getAll())
        .then((r) => r || [])
        .catch(() => []);
    }
  };
})((window.App = window.App || {}));
