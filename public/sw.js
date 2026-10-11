/*
 * iRadio's service worker. It keeps the app's own files so the installed app
 * opens instantly and still opens with no connection. It never touches audio
 * streams, station artwork or the station search, which must always be live.
 */

const SHELL = 'iradio-shell-v1';
const FILES = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/catalogue/')) return;

  // Built files carry a hash in their name and never change: keep them for good.
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const kept = await cache.match(request);
        if (kept) return kept;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // The page and its icons: the newest when online, the kept copy when not.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const kept = (await caches.match(request)) ?? (request.mode === 'navigate' ? await caches.match('/') : null);
        return kept ?? Response.error();
      }),
  );
});
