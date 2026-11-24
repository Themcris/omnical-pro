/* OmniCalc Pro — Service Worker (generado/sellado por tools/stamp-sw.mjs al compilar).
 * Estrategia: precarga EXACTA de los archivos de la app y respuesta "cache-first".
 * VERSION cambia solo cuando cambia algún archivo -> la caché antigua se elimina sola. */
const VERSION = '321c976613';
const ASSETS = ["./","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./index.html","./js/app.js","./js/core.js","./js/frac.js","./js/graph.js","./js/learn.js","./js/poly.js","./js/ratio.js","./js/sets.js","./js/tools.js","./js/ui.js","./js/venn.js","./manifest.json","./omnicalc.wasm","./style.css"];
const CACHE = `omnicalc-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('omnicalc-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;     // no tocamos nada externo
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      return res;
    } catch {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
