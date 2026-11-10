/* SPDX-License-Identifier: Apache-2.0 */
// OFFLINE GAMES service worker: fetch fresh copies when online, serve the cached site when not.
'use strict';
const VERSION = 'dev'; // stamped with the commit by scripts/site.mjs when the site is published
const PREFIX = 'offline-games:' + self.registration.scope + ':';
const CACHE = PREFIX + VERSION;
const FILES = ['./', './VAGRANT_STARS/', './LICENSE', './NOTICE', './VAGRANT_STARS/NOTICE.md', './VAGRANT_STARS/README.md', './VAGRANT_STARS/index.html', './VAGRANT_STARS/js/app.js', './VAGRANT_STARS/js/audio.js', './VAGRANT_STARS/js/hud.js', './VAGRANT_STARS/js/render.js', './VAGRANT_STARS/js/sim/ai.js', './VAGRANT_STARS/js/sim/data.js', './VAGRANT_STARS/js/sim/missions.js', './VAGRANT_STARS/js/sim/models.js', './VAGRANT_STARS/js/sim/player.js', './VAGRANT_STARS/js/sim/world.js', './VAGRANT_STARS/js/ui.js', './VAGRANT_STARS/style.css', './VAGRANT_STARS/vendor/vanillajs/LICENSE', './VAGRANT_STARS/vendor/vanillajs/NOTICE', './VAGRANT_STARS/vendor/vanillajs/PROVENANCE.json', './VAGRANT_STARS/vendor/vanillajs/modules/audio2d/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/collision/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/flight/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/input/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/interactions/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/lead-solver/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/math/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/projectiles/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/render-webgl/index.js', './VAGRANT_STARS/vendor/vanillajs/modules/time/index.js', './assets/icon.svg', './assets/vagrant-stars.jpg', './index.html', './manifest.webmanifest', './styles.css'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const fromCache = () => caches.open(CACHE).then(cache => cache.match(request, {ignoreSearch: true}));
  const fallback = () => fromCache()
    .then(hit => hit || (request.mode === 'navigate' ? caches.match(new URL('./', self.registration.scope).href) : undefined))
    .then(hit => hit || Response.error());
  // Network first, so a new release is never masked by an old cache. Offline, or when the
  // network stalls for four seconds and a cached copy exists, the cache answers instead.
  const network = fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
    return response;
  });
  const stalled = new Promise(resolve => setTimeout(resolve, 4000)).then(fromCache).then(hit => hit || network);
  stalled.catch(() => {});
  event.respondWith(Promise.race([network, stalled]).catch(fallback));
});
