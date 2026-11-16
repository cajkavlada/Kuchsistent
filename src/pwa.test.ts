import { describe, expect, it } from "vitest";
import { shouldOfferInstall } from "./pwa";

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
