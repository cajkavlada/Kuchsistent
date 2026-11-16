import { describe, expect, test, vi } from "vitest";
import {
  USER_PROMPT,
  draftFromExtraction,
  draftsFromExtraction,
  extractWithFallback,
  userPrompt,
  type Extraction,
  type ModelCaller,
} from "./extraction";

const recipe = (over: Partial<Extraction["recipes"][number]> = {}) => ({
  name: " Kuře na paprice ",
  servingsText: "pro 4 osoby",
  servings: 4,
  ingredientGroups: [
    {
      title: "",
      lines: [
        { raw: "25 dkg hladké mouky", quantity: 25, unit: "dkg", ingredient: "hladká mouka", note: "" },
        { raw: "½ l smetany", quantity: 0.5, unit: "l", ingredient: "smetana", note: "" },
      ],
    },
    {
      title: "Na ozdobu",
      lines: [{ raw: "sůl", quantity: null, unit: "", ingredient: "sůl", note: "dle chuti" }],
    },
  ],
  steps: ["Osmahneme cibuli.", "  ", "Podlijeme vodou. "],
  pageSide: "single" as const,
  continuesOffPage: false,
  uncertain: [],
  ...over,
});

const ok: Extraction = { recipes: [recipe()] };
const images = [{ data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }];
const caller = (model: string, call: ModelCaller["call"]): ModelCaller => ({ model, call });

describe("extractWithFallback", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  test("uses the first model when it succeeds", async () => {
    const second = vi.fn();
    const out = await extractWithFallback(
      [caller("claude-sonnet-5-5", async () => ok), caller("gemini-3.8-flash", second)],
      images,
    );
    expect(out).toEqual({ ok: true, model: "claude-sonnet-5-5", result: ok });
    expect(second).not.toHaveBeenCalled();
  });

  test("falls back to Gemini when Claude errors, and records the model", async () => {
    const out = await extractWithFallback(
      [
        caller("claude-sonnet-5-5", async () => {
          throw new Error("stop_reason refusal");
        }),
        caller("gemini-3.8-flash", async () => JSON.stringify(ok)),
      ],
      images,
    );
    expect(out).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
  });

  test.each([
    ["invalid JSON", "{not json"],
    ["schema mismatch", { recipes: [{ name: 1 }] }],
    ["no recipe", { recipes: [] }],
  ])("falls back on %s", async (_label, bad) => {
    const out = await extractWithFallback(
      [caller("a", async () => bad), caller("b", async () => ok)],
      images,
    );
    expect(out).toMatchObject({ ok: true, model: "b" });
  });

  test("reports every model's error when all fail", async () => {
    const out = await extractWithFallback(
      [
        caller("claude-sonnet-5-5", async () => {
          throw new Error("overloaded");
        }),
        caller("gemini-3.8-flash", async () => "{}"),
      ],
      images,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("claude-sonnet-5-5: overloaded");
      expect(out.error).toContain("gemini-3.8-flash: invalid output");
    }
  });

  test("passes the images to the model", async () => {
    const call = vi.fn(async () => ok);
    await extractWithFallback([caller("a", call)], images);
    expect(call).toHaveBeenCalledWith(images);
  });
});

describe("draftFromExtraction", () => {
  test("keeps Ingredient Lines as printed with parsed amount and unit", () => {
    expect(draftFromExtraction(ok)).toEqual({
      name: "Kuře na paprice",
      baseServings: 4,
      steps: ["Osmahneme cibuli.", "Podlijeme vodou."],
      lines: [
        { raw: "25 dkg hladké mouky", amount: 25, unit: "dkg", name: "hladká mouka", optional: false },
        { raw: "½ l smetany", amount: 0.5, unit: "l", name: "smetana", optional: false },
        // In the "Na ozdobu" group, so optional.
        { raw: "sůl", amount: undefined, unit: undefined, name: "sůl", optional: true },
      ],
      continuesOffPage: false,
    });
  });

  test.each([
    [null, undefined],
    [0, undefined],
    [3.6, 4],
    [500, undefined],
  ])("servings %s → baseServings %s", (servings, expected) => {
    expect(draftFromExtraction({ recipes: [recipe({ servings })] }).baseServings).toBe(expected);
  });

  test("takes the first recipe of a spread and drops blank or negative values", () => {
    const first = recipe({
      ingredientGroups: [
        {
          title: "",
          lines: [
            { raw: "  ", quantity: 1, unit: "", ingredient: "", note: "" },
            { raw: "2 vejce", quantity: -2, unit: " ", ingredient: "vejce", note: "" },
          ],
        },
      ],
    });
    const draft = draftFromExtraction({ recipes: [first, recipe({ name: "Polévka" })] });
    expect(draft.name).toBe("Kuře na paprice");
    expect(draft.lines).toEqual([
      { raw: "2 vejce", amount: undefined, unit: undefined, name: "vejce", optional: false },
    ]);
  });

  test("marks lines optional when the model says so or the text does", () => {
    const line = (raw: string, note = "", optional?: boolean) => ({
      raw, quantity: null, unit: "", ingredient: "x", note, optional,
    });
    const draft = draftFromExtraction({
      recipes: [
        recipe({
          ingredientGroups: [
            {
              title: "",
              lines: [
                line("petrželka", "", true),
                line("případně trochu smetany"),
                line("kopr", "na ozdobu"),
                line("2 vejce"),
              ],
            },
          ],
        }),
      ],
    });
    expect(draft.lines.map((l) => l.optional)).toEqual([true, true, true, false]);
  });

  test("marks lines the model was unsure of, and keeps continuesOffPage", () => {
    const draft = draftFromExtraction({
      recipes: [recipe({ uncertain: ["½ L  smetany", "něco jiného"], continuesOffPage: true })],
    });
    expect(draft.lines.map((l) => l.uncertain ?? false)).toEqual([false, true, false]);
    expect(draft.continuesOffPage).toBe(true);
  });
});

test("several photos are read as consecutive pages of one recipe", () => {
  expect(userPrompt(1)).toBe(USER_PROMPT);
  expect(userPrompt(3)).toMatch(/\(3\) jsou po sobě jdoucí stránky jednoho receptu/);
});

describe("draftsFromExtraction (#21)", () => {
  test("every recipe on a spread becomes a draft, with its page side", () => {
    const drafts = draftsFromExtraction({
      recipes: [recipe({ pageSide: "left" }), recipe({ name: "Polévka", pageSide: "right" })],
    });
    expect(drafts.map((d) => [d.name, d.pageSide])).toEqual([
      ["Kuře na paprice", "left"],
      ["Polévka", "right"],
    ]);
  });

  test("drops empty recipes, but keeps one if all are empty", () => {
    const empty = recipe({ name: " ", ingredientGroups: [], steps: [] });
    expect(draftsFromExtraction({ recipes: [empty, recipe()] }).map((d) => d.name)).toEqual([
      "Kuře na paprice",
    ]);
    expect(draftsFromExtraction({ recipes: [empty, empty] })).toHaveLength(1);
  });
});
