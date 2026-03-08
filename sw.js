/**
 * aeyu.io Service Worker
 * Strategy: Cache app shell aggressively, network-first for API calls.
 * All Strava data lives in IndexedDB — SW just needs to serve the app offline.
 */

const CACHE_NAME = "aeyu-v2";

const APP_SHELL = [
  "/",
  "/index.html",
  "/callback.html",
  "/src/app.js",
  "/src/auth.js",
  "/src/awards.js",
  "/src/config.js",
  "/src/db.js",
  "/src/sync.js",
  "/src/components/Landing.js",
  "/src/components/Dashboard.js",
  "/src/components/SyncProgress.js",
  "/src/components/ActivityDetail.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// CDN dependencies — cache on first use
const CDN_HOSTS = ["cdn.tailwindcss.com", "esm.sh"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls (Strava, CF Worker)
  if (
    url.hostname.includes("strava.com") ||
    url.hostname.includes("workers.dev")
  ) {
    return;
  }

  // CDN assets: stale-while-revalidate
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetched = fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
          return cached || fetched;
        })
      )
    );
    return;
  }

  // App shell: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(event.request, clone)
          );
        }
        return response;
      });
    })
  );
});
