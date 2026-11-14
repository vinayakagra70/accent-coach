/*
 * Accent Coach offline cache (phone build only).
 * - The page: network first, so an update shows up on the next visit; cache when offline.
 * - Hashed build files (/assets/), voice clips (/audio/*.mp3) and the speech runtime
 *   from jsDelivr never change under the same address: cache first. Clips are kept
 *   the first time they are played; nothing is downloaded ahead of time.
 * - Our other files (character, manifest, icons): cache now, refresh in the background.
 * - /api/ and anything that is not a GET are left alone.
 * - The 242 MB speech model is cached by the speech worker itself, not here.
 * Bump the number to throw away everything cached by older versions.
 */
const CACHE = "accent-coach-v2";
const INDEX = new URL("./", self.location.href).href;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("accent-coach-v") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

const keep = (key, res) => {
  // only whole, successful answers: a 206 cannot be stored, an error page must not be
  if (res.status !== 200) return res;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => undefined);
  return res;
};

/** A voice clip. Audio players ask for byte ranges; keep the whole file and cut the range out of it. */
async function clip(req) {
  // fetched by address, so no Range header goes out and the answer is a storable 200
  const res = (await caches.match(req.url)) || keep(req.url, await fetch(req.url));
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") || "");
  if (!range || res.status !== 200) return res;
  const buf = await res.arrayBuffer();
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : Infinity, buf.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${buf.byteLength}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  const runtime = url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/onnxruntime-web@");
  if ((!ours && !runtime) || url.pathname.includes("/api/")) return;

  if (req.mode === "navigate") {
    // one copy of the page, whatever the query string (?lesson=...)
    e.respondWith(
      fetch(req)
        .then((res) => (res.redirected ? res : keep(INDEX, res)))
        .catch(() => caches.match(INDEX).then((r) => r || Response.error())),
    );
    return;
  }
  if (ours && /\/audio\/.*\.mp3$/.test(url.pathname)) {
    e.respondWith(clip(req));
    return;
  }
  const fresh = () => fetch(req).then((res) => keep(req, res));
  if (runtime || url.pathname.includes("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fresh()));
    return;
  }
  // unhashed files: answer from the cache at once, pick up changes for next time
  e.respondWith(
    caches.match(req).then((hit) => {
      const next = fresh();
      if (!hit) return next;
      e.waitUntil(next.catch(() => undefined));
      return hit;
    }),
  );
});
