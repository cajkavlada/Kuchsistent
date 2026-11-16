import { expect, test } from "vitest";
import { movePage, removePage } from "./pages";

test("moves a page one place either way, never past the ends", () => {
  expect(movePage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(movePage(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(movePage(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  expect(movePage(["a", "b"], 1, 1)).toEqual(["a", "b"]);
});

test("removes a page", () => {
  expect(removePage(["a", "b", "c"], 1)).toEqual(["a", "c"]);
});
