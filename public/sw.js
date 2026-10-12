/* Lets the customer page and the staff desk open without a connection.
   It saves a copy of the two pages and the logo. It never saves anything from /api (customer and job data). */
const VERSION = 'nook-v1';
const PRECACHE = ['/', '/desk/', '/logo.png', '/logo-mark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(PRECACHE.map((u) => fetch(u, { cache: 'reload' }).then((r) => (r.ok && !r.redirected ? cache.put(u, r) : null)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/sw.js') return;

  const isPage = req.mode === 'navigate';
  const key = isPage ? (url.pathname.startsWith('/desk') ? '/desk/' : '/') : url.pathname;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(key);
    const network = fetch(req).then((res) => {
      if (res.ok && !res.redirected && res.type === 'basic') {
        const saved = cache.put(key, res.clone());
        try { event.waitUntil(saved); } catch (e) { /* page already answered; the copy still saves */ }
      }
      return res;
    });
    if (!isPage) {                      // logos and the like: show the saved copy, refresh in the background
      if (hit) { network.catch(() => {}); return hit; }
      return network;
    }
    if (!hit) return network;           // first visit: nothing saved yet
    // pages: use the live version, but if the connection is down or slow, open the saved one
    return Promise.race([
      network.catch(() => hit),
      new Promise((resolve) => setTimeout(() => resolve(hit), 3500)),
    ]);
  })());
});
