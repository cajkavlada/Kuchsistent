import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { errorMessage, formatAmount, parseAmount, portionsLabel } from "./format";
import { fitWithin } from "./photo";

describe("amounts", () => {
  test.each([
    ["", undefined],
    ["  ", undefined],
    ["25", 25],
    ["2,5", 2.5],
    ["2.5", 2.5],
    ["½", 0.5],
    ["1 ½", 1.5],
    ["1/4", 0.25],
    ["abc", NaN],
    ["-1", NaN],
  ])("parseAmount(%j) = %s", (text, expected) => {
    expect(parseAmount(text)).toEqual(expected);
  });

  test("formatAmount uses a decimal comma and trims noise", () => {
    expect(formatAmount(2.5)).toBe("2,5");
    expect(formatAmount(10)).toBe("10");
    expect(formatAmount(1 / 3)).toBe("0,333");
    expect(formatAmount(undefined)).toBe("");
  });

  test("portions are declined", () => {
    expect([1, 2, 4, 5].map(portionsLabel)).toEqual(["1 porce", "2 porce", "4 porce", "5 porcí"]);
  });
});

describe("errorMessage", () => {
  test("maps codes to Czech and falls back otherwise", () => {
    expect(errorMessage(new ConvexError({ code: "NAME_REQUIRED" }))).toBe("Doplň název receptu.");
    expect(errorMessage(new Error("x"), "Jinak")).toBe("Jinak");
  });
});

describe("fitWithin", () => {
  test("scales the long edge down to 2576 px and keeps the ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2576, height: 1932 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1932, height: 2576 });
  });

  test("never upscales", () => {
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});
