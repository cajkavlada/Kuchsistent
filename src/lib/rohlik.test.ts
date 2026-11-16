import { expect, test } from "vitest";
import { handoffLine, handoffLines, type HandoffItem, ROHLIK_CART, rohlikPrompt, rohlikSearchUrl } from "./rohlik";

const item = (label: string, more: Partial<HandoffItem> = {}): HandoffItem => ({
  label,
  checked: false,
  storeSection: "produce",
  plenty: false,
  optional: false,
  ...more,
});

test("search URL encodes the term", () => {
  expect(rohlikSearchUrl("kysaná smetana")).toBe(
    "https://www.rohlik.cz/hledat?companyId=1&q=kysan%C3%A1%20smetana",
  );
});

test("a line is name and amount; vague amounts and top-up '+' are left out", () => {
  expect(handoffLine(item("mrkev", { amount: 1200, unit: "g" }))).toBe("mrkev 1,2 kg");
  expect(handoffLine(item("sůl"))).toBe("sůl");
  expect(handoffLine(item("koriandr", { amount: 1, unit: "svazek", optional: true }))).toBe(
    "koriandr 1 svazek (volitelné)",
  );
});

test("the list skips ticked, Plenty and 'už nepotřeba' items, keeps manual and changed ones", () => {
  const lines = handoffLines([
    item("toaletní papír", { storeSection: "other" }),
    item("cibule", { amount: 2, unit: "ks", note: "+1 ks" }),
    item("mléko", { checked: true, storeSection: "dairyEggs" }),
    item("rýže", { plenty: true, storeSection: "pantry" }),
    item("smetana", { note: "už nepotřeba", storeSection: "dairyEggs" }),
    item("brambory", { amount: 1000, unit: "g" }),
  ]);
  expect(lines).toEqual(["brambory 1 kg", "cibule 2 ks", "toaletní papír"]);
});

test("the prompt starts with /rohlik, ends with the cart link and the items", () => {
  const p = rohlikPrompt("2026-11-18", [item("brambory", { amount: 1000, unit: "g" }), item("sůl", { checked: true })]);
  expect(p.startsWith("/rohlik Vlož mi do košíku tyto položky (doručení ")).toBe(true);
  expect(p).toContain("Objednávku neodesílej.");
  expect(p).toContain(`odkaz na přehled košíku: ${ROHLIK_CART}\n\n- brambory 1 kg`);
  expect(p).not.toContain("sůl");
});
