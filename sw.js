/* ══════════════════════════════════════════
   CLIMAHORA — Service Worker PWA
   Estrategia: Cache First para assets locales,
   Network First para llamadas a APIs externas
   ══════════════════════════════════════════ */

const CACHE_NAME = "climahora-v7";

// Assets locales que se cachean al instalar
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./climahora.css",
  "./climahora.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./offline.html"
];

// Dominios externos que siempre van a la red (APIs, fuentes, mapas)
const NETWORK_ONLY_ORIGINS = [
  "api.openweathermap.org",
  "ipapi.co",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "flagcdn.com",
  "openstreetmap.org"
];

// ── INSTALL: guarda todos los assets locales ──
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpia caches viejos ──
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estrategia por tipo de recurso ──
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // APIs y recursos externos → siempre red, sin caché
  if (NETWORK_ONLY_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: "Sin conexión" }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // Assets locales → Cache First (con fallback a red y luego offline.html)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Guarda en caché si es una respuesta válida
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Fallback offline solo para navegación HTML
          if (event.request.mode === "navigate") {
            return caches.match("./offline.html");
          }
        });
    })
  );
});
