/* Service worker: deja la app disponible sin señal.
   Al cambiar VERSION se renueva el caché completo en la próxima visita. */
var VERSION = 'calibracion-v7';

var ARCHIVOS = [
  './',
  'index.html',
  'css/estilos.css',
  'js/app.js',
  'js/xlsx.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(ARCHIVOS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (clave) {
        if (clave !== VERSION) return caches.delete(clave);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (ev) {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then(function (respuesta) {
      return respuesta || fetch(ev.request);
    })
  );
});
