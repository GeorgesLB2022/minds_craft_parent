// SW v20250426j — revert forgotPassword to original (no redirectTo — was blocking emails)
const SW_VERSION = '20250426j';

self.addEventListener('install', () => {
  console.log('[SW] Installing version', SW_VERSION);
  self.skipWaiting(); // activate immediately without waiting
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version', SW_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => {
        console.log('[SW] Deleting cache:', k);
        return caches.delete(k);
      })))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs there's a new version
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION }));
        });
      })
  );
});

// ZERO caching — every request goes straight to the network
self.addEventListener('fetch', (event) => {
  // Skip non-GET and cross-origin API calls
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .catch(() => new Response('Offline — please check your connection', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      }))
  );
});
