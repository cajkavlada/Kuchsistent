import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    // SPA mode (#4, #11): auth is client-side via the Convex Auth provider.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
    nitro(),
  ],
});
