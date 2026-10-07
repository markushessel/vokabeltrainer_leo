const CACHE_NAME = 'vokabeltrainer-v1-2026-10-07';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './seed-data.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('vokabeltrainer-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Cache app assets and optional OCR/PDF libraries at runtime.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      if (url.origin === self.location.origin) {
        return new Response('Offline', {status: 503, statusText: 'Offline'});
      }
      throw err;
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const url of event.data.urls) {
        try {
          const req = new Request(url, {mode: url.startsWith(self.location.origin) ? 'same-origin' : 'no-cors'});
          const res = await fetch(req);
          await cache.put(req, res);
        } catch (_) {}
      }
    })());
  }
});
