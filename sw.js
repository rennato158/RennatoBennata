/* Banco de Atletas — service worker: deixa o app abrir e funcionar sem internet.
   - Páginas e scripts: tenta a rede e guarda uma cópia; sem rede, usa a cópia.
   - Fotos (/_blob/…): usa a cópia do aparelho; fotos novas tiradas offline já ficam aqui.
   - Dados (/api/…): não passam por aqui; o próprio app guarda e sincroniza. */
const VERSAO = 'v1';
const APP = 'ba-app-' + VERSAO;
const CDN = 'ba-cdn-' + VERSAO;
const BLOBS = 'ba-blobs';
const SHELL = ['/', '/vercel-adapter.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP && k !== CDN && k !== BLOBS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(fallbackUrl || req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

async function blobFirst(req) {
  const cache = await caches.open(BLOBS);
  const key = new URL(req.url).pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(key, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;               // dados: o app cuida
    if (url.pathname.startsWith('/_blob/')) return e.respondWith(blobFirst(req));
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, APP, '/'));
    if (url.pathname === '/sw.js') return;
    return e.respondWith(networkFirst(req, APP));
  }
  if (CDN_HOSTS.includes(url.hostname)) return e.respondWith(staleWhileRevalidate(req, CDN));
});
