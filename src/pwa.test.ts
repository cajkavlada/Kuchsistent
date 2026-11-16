import { describe, expect, it } from "vitest";
import { isChunkLoadError, shouldOfferInstall, shouldReloadForChunk } from "./pwa";

describe("install offer", () => {
  const base = { hasPrompt: true, standalone: false, dismissed: false };
  it("shows when Chrome offers installation", () => {
    expect(shouldOfferInstall(base)).toBe(true);
  });
  it("hides when running installed, once dismissed, or without a prompt", () => {
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, hasPrompt: false })).toBe(false);
  });
});

describe("stale chunk recovery", () => {
  it("recognises failed lazy imports in Chrome, Firefox and Safari", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/plan-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("ConvexError"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
  it("reloads once, then not again within 30 s", () => {
    expect(shouldReloadForChunk(null, 1_000_000)).toBe(true);
    expect(shouldReloadForChunk(1_000_000, 1_010_000)).toBe(false);
    expect(shouldReloadForChunk(1_000_000, 1_031_000)).toBe(true);
  });
});
