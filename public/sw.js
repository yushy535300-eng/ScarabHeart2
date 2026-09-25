/* ScarabHeart v2.60: ATG heavy-resource bypass.
   The manifest remains same-origin because ATG does not advertise CORS for it.
   Everything under the versioned slotFramework path is redirected client-side
   to play.godeebxp.com, avoiding Render/Cloudflare 429/502/503 bursts. */
self.addEventListener('install', function(event) {
  self.skipWaiting();
});
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function(event) {
  try {
    var u = new URL(event.request.url);
    if (u.origin !== self.location.origin) return;
    if (/^\/slotFramework\/manifest\.json$/i.test(u.pathname)) return;
    if (/^\/slotFramework\/[a-f0-9]{40}\//i.test(u.pathname)) {
      var remote = 'https://play.godeebxp.com' + u.pathname + u.search;
      event.respondWith(Response.redirect(remote, 307));
      return;
    }
  } catch (_) {}
});
