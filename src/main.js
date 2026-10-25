// Entry point: create the save store, the local game host, and the UI.

import { LocalHost } from './host/LocalHost.js';
import { createLocalStore } from './storage/localStore.js';
import { createApp } from './ui/app.js';

const store = createLocalStore();
const host = new LocalHost({ store });
const app = createApp(document.getElementById('app'), { host, storagePersistent: store.persistent });

// Exposed for debugging in the console and for the end-to-end smoke test.
window.kittleSkies = { host, ctx: app.ctx };

app.boot();

// Cache the game's own files so a hosted copy keeps working offline.
// (Map tiles are never cached: OpenStreetMap's usage policy forbids it.)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.KS_SINGLE_FILE) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((e) => e.name)]
        .filter((u) => u.startsWith(location.origin));
      reg.active?.postMessage({ type: 'CACHE_URLS', urls });
    }).catch((err) => console.warn('Service worker unavailable:', err.message));
  });
}
