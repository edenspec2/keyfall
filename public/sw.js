// Mochi MIDI offline support. Online, everything is fetched as usual, so updates arrive at once; a copy of each file is
// kept so the app (and the piano) still opens with no connection. Only the build's assets/ files, whose names change
// with their content, are served straight from the copy. The piano samples keep their names when they are replaced,
// so they are never served from the copy while online.
const CACHE = 'keyfall-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  const keep = (res) => { if (res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))) } return res }
  if (new URL(req.url).pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)))
    return
  }
  e.respondWith(fetch(req).then(keep).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' && (await caches.match(self.registration.scope))) || Response.error()))
})
