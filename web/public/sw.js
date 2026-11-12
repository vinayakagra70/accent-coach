/*
 * Accent Coach offline cache (phone build only).
 * - The page: network first, so an update shows up on the next visit; cache when offline.
 * - Everything else of ours (scripts, styles, character, audio) and the speech
 *   runtime from jsDelivr: cache first.
 * - The 242 MB speech model is cached by the speech worker itself, not here.
 */
const CACHE = "accent-coach-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("accent-coach-v") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  const runtime = url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/onnxruntime-web@");
  if (!ours && !runtime) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./"))),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
