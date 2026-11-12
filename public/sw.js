// Minimal service worker so DreamTune can be installed as an app.
// It does not cache anything, so you always get the latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
