import { describe, expect, test } from "vitest";
import { allowedRedirectOrigins, mayCreateHousehold } from "./config";

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
