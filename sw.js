/**
 * aeyu.io Service Worker
 * Strategy: Network-first for app shell (fast deploys), cache-first for CDN assets.
 * All Strava data lives in IndexedDB — SW just needs to serve the app offline.
 */

const CACHE_NAME = "aeyu-v8";

const APP_SHELL = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/activity.html",
  "/demo.html",
  "/callback.html",
  "/src/app.js",
  "/src/auth.js",
  "/src/awards.js",
  "/src/config.js",
  "/src/db.js",
  "/src/sync.js",
  "/src/install.js",
  "/src/demo.js",
  "/src/units.js",
  "/src/icons.js",
  "/src/award-config.js",
  "/src/power-curve.js",
  "/src/routes.js",
  "/src/components/Landing.js",
  "/src/components/Dashboard.js",
  "/src/components/SyncProgress.js",
  "/src/components/ActivityDetail.js",
  "/src/components/InstallBanner.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

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

  // CDN assets: cache-first (these are versioned by URL, rarely change)
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

  // App shell: network-first, cache fallback (deploys are immediately visible)
  // Use cache: "no-cache" to bypass browser HTTP cache and always revalidate
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(event.request, clone)
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
