// A path as a terminal writes it (PIE-1656): the one reader the media line and the door's drop share.
import { expect, test } from "bun:test";
import { shellPath, shellWords } from "../src/shell-words";

test("a drop's line reads as a shell reads it: words, escapes and quotes", () => {
  expect(shellWords(String.raw`/made/up/a\ b.png '/made/up/c d.html' "/made/up/e \"f\".jsx"`)).toEqual(["/made/up/a b.png", "/made/up/c d.html", '/made/up/e "f".jsx']);
  expect(shellWords("'/made/up/open quote.png")).toBeNull();
});

test("a path is one word: a blank left as it is stays, a lone quote stays, and a clean path reads as itself", () => {
  expect(shellPath(String.raw`/made/up/LATE\ SHIFT.html`)).toBe("/made/up/LATE SHIFT.html");
  expect(shellPath("  '/made/up/LATE SHIFT.html' ")).toBe("/made/up/LATE SHIFT.html");
  expect(shellPath(String.raw`/made/up/half\ escaped copy.html`)).toBe("/made/up/half escaped copy.html");
  expect(shellPath("/made/up/orbit lamp.html")).toBe("/made/up/orbit lamp.html");
  expect(shellPath("/made/up/Robin's page.html")).toBe("/made/up/Robin's page.html");
  expect(shellPath("'/made/up/never closed.html")).toBe("'/made/up/never closed.html");
  for (const clean of ["/made/up/LATE SHIFT.html", "~/made/up/lamp (night).html", "shots/a [1].png"]) expect(shellPath(shellPath(clean))).toBe(clean);
});
