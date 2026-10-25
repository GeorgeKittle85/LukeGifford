// Service worker: keeps the game itself playable offline once it has been
// loaded from a web server. Network-first for the game's own files (so updates
// show up immediately), falling back to the cache when offline.
// Cross-origin requests (OpenStreetMap tiles) are never touched or cached:
// OSM's tile usage policy forbids offline tile storage.

const CACHE = 'kittle-skies-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './assets/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the list of files it loaded so the first visit is fully cached.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS') return;
  const urls = (event.data.urls || []).filter((u) => new URL(u).origin === self.location.origin);
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cache.add(u).catch(() => null)))));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
