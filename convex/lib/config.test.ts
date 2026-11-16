import { describe, expect, test } from "vitest";
import {
  DEFAULT_EXTRACTION_MODELS,
  allowedRedirectOrigins,
  extractionModels,
  mayCreateHousehold,
} from "./config";

describe("extraction models", () => {
  test("default: Claude Sonnet, then Gemini Flash", () => {
    expect(extractionModels({})).toEqual(["claude-sonnet-5-5", "gemini-3.8-flash"]);
    expect(extractionModels({ EXTRACTION_MODELS: " , " })).toEqual(DEFAULT_EXTRACTION_MODELS);
  });

  test("EXTRACTION_MODELS sets the order and skips unknown vendors", () => {
    expect(
      extractionModels({ EXTRACTION_MODELS: "claude-haiku-5-5, gpt-6-luna,gemini-3.8-flash,claude-haiku-5-5" }),
    ).toEqual(["claude-haiku-5-5", "gemini-3.8-flash"]);
  });
});

describe("config", () => {
  test("redirect origins: SITE_URL plus localhost, bare origins only", () => {
    expect(allowedRedirectOrigins({ SITE_URL: "https://kuchsistent.vercel.app/" })).toEqual([
      "http://localhost:3000",
      "https://kuchsistent.vercel.app",
    ]);
    expect(allowedRedirectOrigins({})).toEqual(["http://localhost:3000"]);
  });

  test("allowlist is case- and space-insensitive and needs a verified email", () => {
    const env = { HOUSEHOLD_CREATOR_EMAILS: "A@x.cz, b@x.cz" };
    expect(mayCreateHousehold("a@X.cz", true, env)).toBe(true);
    expect(mayCreateHousehold("b@x.cz", false, env)).toBe(false);
    expect(mayCreateHousehold("c@x.cz", true, env)).toBe(false);
    expect(mayCreateHousehold(undefined, true, env)).toBe(false);
    expect(mayCreateHousehold("a@x.cz", true, {})).toBe(false);
  });
});
