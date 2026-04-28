const VERSION = 'v1';
const APP_SHELL_CACHE = `trailerswipe-shell-${VERSION}`;
const TMDB_CACHE = `trailerswipe-tmdb-${VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/animations.css',
  '/css/layout.css',
  '/css/cards.css',
  '/css/settings.css',
  '/js/app.js',
  '/js/feed.js',
  '/js/card.js',
  '/js/youtube.js',
  '/js/settings.js',
  '/js/toast.js',
  '/js/i18n.js',
  '/js/store.js',
  '/js/locales/fr.json',
  '/js/api/tmdb.js',
  '/js/api/seerr.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't cache anything outside our origin
  if (url.origin !== self.location.origin) return;

  // Seerr never cached
  if (url.pathname.startsWith('/api/seerr/')) return;

  // TMDB: network-first, cache as fallback (30 min TTL)
  if (url.pathname.startsWith('/api/tmdb/')) {
    event.respondWith(networkFirstWithTtl(event.request, TMDB_CACHE, 30 * 60 * 1000));
    return;
  }

  // App shell: cache-first
  event.respondWith(cacheFirst(event.request, APP_SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok && request.method === 'GET') cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithTtl(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok && request.method === 'GET') {
      const meta = new Response(fresh.clone().body, {
        status: fresh.status,
        headers: appendHeader(fresh.headers, 'sw-cached-at', String(Date.now())),
      });
      cache.put(request, meta);
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get('sw-cached-at') || 0);
      if (Date.now() - cachedAt < ttlMs) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}

function appendHeader(headers, name, value) {
  const out = new Headers();
  for (const [k, v] of headers.entries()) out.set(k, v);
  out.set(name, value);
  return out;
}
