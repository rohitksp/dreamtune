// Small service worker so DreamTune can be installed as an app.
// It only remembers the font files (so icons and text appear instantly after the first visit).
// Everything else always comes fresh from the network, so you always get the latest version.
const FONTS = 'dreamtune-fonts-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    let host = '';
    try { host = new URL(req.url).hostname; } catch (err) { return; }
    if (host === 'fonts.gstatic.com') {                       // the font files themselves: keep them
        e.respondWith(caches.open(FONTS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
            if (res && res.ok) c.put(req, res.clone());
            return res;
        }))));
    } else if (host === 'fonts.googleapis.com') {             // the font stylesheets: show the saved copy, refresh in the background
        e.respondWith(caches.open(FONTS).then((c) => c.match(req).then((hit) => {
            const net = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
            return hit || net;
        })));
    }
});
