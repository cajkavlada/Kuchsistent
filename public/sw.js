/* Kuchsistent service worker (#16, decisions #4 and #13).
 *
 * Caches the app shell only, so the installed app starts without signal:
 *   - the SPA HTML shell (every route serves the same HTML),
 *   - the hashed JS/CSS bundles listed in /sw-precache.json (written by the
 *     build, see vite.config.ts),
 *   - the manifest and icons.
 * It caches NO data: only same-origin GET requests are handled, and Convex
 * runs on its own origin (WebSocket + HTTPS to *.convex.cloud), which this
 * worker never touches.
 *
 * Updates: Vercel serves this file and /sw-precache.json with no-cache.
 * Navigations go network-first, so a new deploy's HTML (and its new bundles)
 * is used on the next launch with signal; the cache then re-syncs to the new
 * bundle list and drops the old bundles.
 *
 * Bump CACHE when this file's caching scheme changes.
 */
const CACHE = "kuchsistent-shell-v1";
const SHELL_KEY = "/__shell";
const SHELL_SOURCE = "/plan";
const PRECACHE_LIST = "/sw-precache.json";
const STATIC = ["/site.webmanifest", "/icon-192.png", "/icon-512.png", "/icon.svg"];
// With poor signal a navigation can hang; after this, show the cached shell.
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await sync({ requireShell: true });
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("kuchsistent-") && n !== CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Convex and anything else

  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
  } else if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

/** Network first with a timeout; the cached shell when offline or slow. */
async function navigate(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (response) => {
    if (isHtml(response)) {
      // The shell names the hashed bundles, so it changes exactly per deploy.
      const previous = await cache.match(SHELL_KEY);
      const fresh = response.clone();
      const changed = !previous || (await previous.text()) !== (await fresh.clone().text());
      await cache.put(SHELL_KEY, fresh);
      if (changed) event.waitUntil(sync({ requireShell: false }).catch(() => undefined));
    }
    return response;
  });
  const cached = await cache.match(SHELL_KEY);
  if (!cached) return network;
  // Keep the network request alive after a timeout so it still refreshes the cache.
  event.waitUntil(network.catch(() => undefined));
  return Promise.race([
    network.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS)),
  ]);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(url.pathname, response.clone());
  return response;
}

/** Bring the cache in line with the deployed build. */
async function sync({ requireShell }) {
  const cache = await caches.open(CACHE);

  if (requireShell) {
    const shell = await fetch(SHELL_SOURCE, { cache: "no-store" });
    if (!isHtml(shell)) throw new Error("App shell unavailable");
    await cache.put(SHELL_KEY, shell);
  }

  let assets = null;
  try {
    const res = await fetch(PRECACHE_LIST, { cache: "no-store" });
    if (res.ok) assets = (await res.json()).assets;
  } catch {
    // Offline or no list (dev): bundles are still cached as they load.
  }

  const cachedPaths = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const wanted = [...STATIC, ...(assets ?? [])];
  await Promise.all(
    wanted
      .filter((path) => !cachedPaths.has(path))
      .map(async (path) => {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (res.ok) await cache.put(path, res);
        } catch {
          // Best effort: cacheFirst picks it up later.
        }
      }),
  );

  if (assets) {
    const keep = new Set(assets);
    await Promise.all(
      [...cachedPaths]
        .filter((path) => path.startsWith("/assets/") && !keep.has(path))
        .map((path) => cache.delete(path)),
    );
  }
}

function isHtml(response) {
  return (
    response.ok &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}
