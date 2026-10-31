// 静态资源离线缓存。改动任何前端文件后必须把 VERSION 加 1，否则手机还在用旧缓存
const VERSION = 'review-v2';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/ui.js',
  './js/store.js',
  './js/db.js',
  './js/rules.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(VERSION).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
