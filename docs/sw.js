// Service worker: guarda a app (e o SDK do Firebase) para abrir sem rede.
// Os dados (preços, plano, preferências) não passam por aqui: o Firestore tem a sua própria cache
// e a app guarda cópias no dispositivo (ver app.js e backend.js).
//
// Os caminhos são relativos porque no GitHub Pages a app vive numa subpasta (…github.io/<repositório>/).
const CACHE = "receitas-v13";
const SHELL = [
  "./",
  "style.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/backend.js",
  "js/planner.js",
  "js/nutrition.js",
  "js/status.js",
  "js/theme.js",
  "js/firebase-config.js",
  "data/recipes.json",
  "data/ingredients.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // SDK do Firebase: o URL leva a versão, por isso o conteúdo nunca muda. Primeiro a cópia guardada.
  if (event.request.url.startsWith(FIREBASE_SDK)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Tudo o resto que é de fora (Firestore, login) não é connosco.
  if (url.origin !== location.origin) return;

  // Ficheiros da app: responde logo com a cópia guardada e atualiza-a em segundo plano.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
