const CACHE_NAME = 'tracker-cache-v1';
const STATIC_ASSETS = [
    '.',
    'index.html',
    'styles.css',
    'app.js',
    'leaflet.css',
    'leaflet.js',
    'manifest.json',
    'icon-192.png',
    'icon-512.png'
];

// 高德地图瓦片缓存策略：Network First with Cache Fallback
const TILE_CACHE = 'tracker-tiles-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME && key !== TILE_CACHE)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 高德地图瓦片请求：Network First
    if (url.hostname.includes('is.autonavi.com') ||
        url.hostname.includes('amap.com')) {
        event.respondWith(networkFirstTile(event.request));
        return;
    }

    // 静态资源：Cache First
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request);
        })
    );
});

function networkFirstTile(request) {
    return fetch(request)
        .then((response) => {
            if (response.ok) {
                const cloned = response.clone();
                caches.open(TILE_CACHE).then((cache) => {
                    cache.put(request, cloned);
                });
            }
            return response;
        })
        .catch(() => {
            return caches.match(request);
        });
}