const CACHE_NAME = 'little-day-v3'
const APP_SHELL = [
  '/manifest.webmanifest',
  '/nap-icon.svg',
  '/nap-icon-192.png',
  '/nap-icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch('/index.html')
    if (!response.ok) throw new Error('Unable to cache the app shell.')
    const html = await response.clone().text()
    await cache.put('/', response.clone())
    await cache.put('/index.html', response)
    await cache.addAll(APP_SHELL)

    const assets = Array.from(
      html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css))"/g),
      (match) => match[1],
    )
    await cache.addAll(assets)
  })())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('little-day-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse
      return fetch(event.request)
        .then((response) => {
          if (!response.ok) return response
          return caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, response.clone()))
            .then(() => response)
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html')
          }
          throw new Error(`Offline resource unavailable: ${event.request.url}`)
        })
    }),
  )
})
