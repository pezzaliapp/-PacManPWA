// Offline cache
const CACHE = 'pacman-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './maze.txt',
  './manifest.json',
  './icons/pacman-192.png',
  './icons/pacman-512.png'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
});
