// ══════════════════════════════════════
// SERVICE WORKER — AnalytixLoto PRO
// ⚠️ IMPORTANT : change CACHE_NAME à CHAQUE déploiement (ex: v13, v14...)
// Sinon le navigateur pense qu'il n'y a rien de neuf et garde l'ancien cache.
// ══════════════════════════════════════
const CACHE_NAME = 'analytixloto-v14';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

// ── INSTALL : met en cache les fichiers de base et active tout de suite ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting(); // ⚠️ force le nouveau SW à s'activer sans attendre la fermeture des onglets
});

// ── ACTIVATE : supprime les anciens caches et prend le contrôle immédiat ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH : réseau d'abord, cache en secours (pour toujours avoir la dernière version quand il y a du réseau) ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
