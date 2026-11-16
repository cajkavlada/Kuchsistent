import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@convex/*` and `~/*` from tsconfig, for app tests.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: { name: "app", include: ["src/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
