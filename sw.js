/**
 * aeyu.io Service Worker
 * Strategy: Network-first for app shell (fast deploys), all deps vendored locally.
 * All Strava data lives in IndexedDB — SW just needs to serve the app offline.
 */

const CACHE_NAME = "aeyu-v32";

const APP_SHELL = [
  "/",
  "/index.html",
  "/app.css",
  "/dashboard.html",
  "/activity.html",
  "/demo.html",
  "/heatmap.html",
  "/power.html",
  "/callback.html",
  "/src/app.js",
  "/src/auth.js",
  "/src/awards.js",
  "/src/share-video.js",
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
  "/src/heatmap.js",
  "/src/heatmap-render.js",
  "/src/places.js",
  "/src/ride-scene.js",
  "/src/ride-render.js",
  "/src/ride-video.js",
  "/src/demo-streams.js",
  "/src/ride-streams.js",
  "/src/fatigue-curve.js",
  "/src/fatigue-gpu.js",
  "/src/wbal.js",
  "/src/wbal-worker.js",
  "/src/components/Landing.js",
  "/src/components/Dashboard.js",
  "/src/components/SyncProgress.js",
  "/src/components/ActivityDetail.js",
  "/src/components/Heatmap.js",
  "/src/components/PowerCurve.js",
  "/src/components/WbalChart.js",
  "/src/components/ZoneBars.js",
  "/src/components/HelpButton.js",
  "/src/components/RideReplay.js",
  "/src/components/InstallBanner.js",
  "/vendor/preact.mjs",
  "/vendor/hooks.mjs",
  "/vendor/signals.mjs",
  "/vendor/signals-core.mjs",
  "/vendor/htm.mjs",
  "/vendor/htm-preact.mjs",
  "/vendor/mp4-muxer.mjs",
  "/vendor/tailwind.css",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

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
