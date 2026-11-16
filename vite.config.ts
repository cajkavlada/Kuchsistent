import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

/** Files that must never be served stale, or app updates would stall (#16). */
const NO_CACHE = { headers: { "cache-control": "no-cache" } };

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    // SPA mode (#4, #11): auth is client-side via the Convex Auth provider.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
    swPrecacheList(),
    nitro({
      // Nitro writes these into the Vercel build output config.
      routeRules: {
        "/sw.js": NO_CACHE,
        "/sw-precache.json": NO_CACHE,
        "/site.webmanifest": {
          headers: {
            "cache-control": "no-cache",
            "content-type": "application/manifest+json",
          },
        },
      },
    }),
  ],
});

/**
 * Emits /sw-precache.json listing every client bundle, so public/sw.js can
 * cache the whole app shell (including lazily loaded route chunks) on install
 * and drop bundles from older deploys.
 */
function swPrecacheList(): Plugin {
  return {
    name: "kuchsistent:sw-precache",
    applyToEnvironment: (env) => env.name === "client",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/") && !file.endsWith(".map"))
        .map((file) => "/" + file)
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "sw-precache.json",
        source: JSON.stringify({ assets }, null, 2) + "\n",
      });
    },
  };
}
