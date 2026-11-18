// Service worker: guarda o "casco" do app pra abrir rápido; os dados sempre vêm da rede.
const CACHE = "onde-parei-v3";
const CASCO = ["/", "/index.html", "/estilo.css?v=11", "/app.js?v=11", "/manifest.webmanifest", "/icones/icone.svg", "/icones/icone-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCO)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // rede primeiro (pra pegar atualizações), cache se estiver offline
  e.respondWith(
    fetch(e.request)
      .then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
