/* global self, caches */

const CACHE_PREFIX = "migra-mobile-static-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/mobile-offline.html";
const PUBLIC_ASSETS = [
  OFFLINE_URL,
  "/favicon.svg",
  "/icons/migra-192.png",
  "/icons/migra-512.png",
  "/icons/migra-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});

function isPublicStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname === "/favicon.svg" ||
      url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    request.mode === "navigate" &&
    (url.pathname === "/m" || url.pathname.startsWith("/m/"))
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (!isPublicStaticAsset(url)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.redirected || response.type !== "basic") return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
