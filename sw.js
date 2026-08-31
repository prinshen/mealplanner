// Legacy Mise entry point only. Protein Log retains its more-specific scope.
// No CacheStorage, localStorage, IndexedDB, or registration is deleted here.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin === scope.origin &&
      (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html')) {
    event.respondWith(Promise.resolve(Response.redirect(new URL('../mise/', scope).href, 302)));
  }
});
