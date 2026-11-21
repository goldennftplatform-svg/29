/* LITEcrib PWA shell.
 *
 * Static-host safe: only same-origin GETs are cached. API calls, Privy's
 * cross-domain iframe, the LiteForge RPC and font CDN always go to the network.
 * Asset URLs in index.html are explicitly versioned, so bumping CACHE also
 * refreshes the exact files the new page asks for.
 */
const CACHE = 'litecrib-v20261121-pwa-mobile3';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './styles.css?v=20261121-pwa-mobile3',
  './safari-brand.css?v=country1',
  './app-layout.css?v=4',
  './wallet-dropdown.css?v=20261121-pwa-mobile3',
  './app-shell.css?v=20261121-pwa-mobile3',
  './map-atmosphere.css?v=20261119-living-atlas-activity3',
  './map-grass.svg',
  './map-contours.svg',
  './country-boards.js?v=country1',
  './player-profile.js?v=country1',
  './game.js?v=20261119-scoring-shell-rejoin3',
  './network.js?v=20261119-rejoin-seat2',
  './cribbage-engine.js?v=20261119-stop-at-121-rejoin',
  './main.js?v=20261121-pwa-mobile3',
  './config.js?v=20261121-pwa-mobile3',
  './square.js?v=20261121-pwa-mobile3',
  './wallet.js?v=20261119-token-play',
  './metamask.js?v=20261118-metamask-network',
  './wallet-assets/wallet.js?v=wallet-send-export-20261118',
  './wallet-setup.html',
  './social-preview.png?v=1'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
