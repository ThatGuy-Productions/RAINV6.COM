// RAIN V6 — Service Worker (offline-capable cached shell for SEO/performance)
const CACHE_NAME = 'rain-v6-shell-v1';
const SHELL_ASSETS = [
  '/', '/sitemap.xml', '/robots.txt', '/manifest.json',
  '/globals.css', '/favicon.svg'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL_ASSETS))); self.skipWaiting(); });
self.addEventListener('fetch', e => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
