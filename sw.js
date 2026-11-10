/* Cache-first service worker: Mewdoku works fully offline once installed. */
var CACHE = 'mewdoku-v11';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './puzzle.js',
  './progression.js',
  './app.js',
  './worker.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      // 'reload' bypasses the browser HTTP cache so an updated build never
      // repopulates the offline cache with stale CSS/JS.
      .then(function (cache) {
        return cache.addAll(ASSETS.map(function (url) {
          return new Request(url, { cache: 'reload' });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Network-first: players online always get the latest build, while the
// precached copy keeps the game fully playable offline / on the home screen.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (hit) {
        if (hit) return hit;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
