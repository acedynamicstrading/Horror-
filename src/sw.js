// ---------------------------------------------------------------------------
// Service worker — caches the heavy, rarely-changing 8th Wall SLAM engine
// binary so repeat visits don't re-download it, without hiding fresh app
// code behind a stale cache while actively developing.
//
// Two strategies, split by path:
//   - external/xr/**  (the 8th Wall engine binary, SLAM chunk): CACHE-FIRST.
//     This is the big, slow-to-fetch, rarely-changing asset — exactly what
//     you want a one-time download for on later visits.
//   - everything else (index.html, bundle.js, this app's own code):
//     NETWORK-FIRST, falling back to cache only if offline. This is what
//     keeps `git push` -> reload always showing your latest code instead of
//     a stale cached bundle.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'ar-haunted-house-v1'
const HEAVY_ASSET_PATTERN = /\/external\/xr\//

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const isHeavyAsset = HEAVY_ASSET_PATTERN.test(event.request.url)

  if (isHeavyAsset) {
    // Cache-first: serve instantly from cache if we have it, only hit the
    // network the first time (or if it somehow got evicted).
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone())
            return response
          })
        }),
      ),
    )
    return
  }

  // Network-first for everything else (your app code): always try to get
  // the freshest version first. Only fall back to cache if the network
  // fails (offline), so development never shows stale code.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
        }
        return response
      })
      .catch(() => caches.match(event.request)),
  )
})
