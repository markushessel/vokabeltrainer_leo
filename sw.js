const CACHE_NAME = 'vokabeltrainer-v3-2026-10-09';
const BASE = new URL('./', self.location.href);
const INDEX_URL = new URL('index.html', BASE).href;
const APP_SHELL = [
  BASE.href,
  INDEX_URL,
  new URL('styles.css', BASE).href,
  new URL('app.js', BASE).href,
  new URL('seed-data.js', BASE).href,
  new URL('manifest.webmanifest', BASE).href,
  new URL('icons/icon-192.png', BASE).href,
  new URL('icons/icon-512.png', BASE).href,
  new URL('icons/apple-touch-icon.png', BASE).href
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
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
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put(INDEX_URL, fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(INDEX_URL)) || (await cache.match(BASE.href)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, {ignoreSearch:true});
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      if (url.origin === self.location.origin) return new Response('Offline', {status:503});
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
