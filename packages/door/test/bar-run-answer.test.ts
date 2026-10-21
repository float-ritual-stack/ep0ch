import { expect, test } from "bun:test";
import "../src/desk/tile-actions";
import { runAnswer } from "../src/bar/command";

// A run kept under the power bar's line reads as the action says it, not as its raw answer.
test("a run's answer is the action's own words", () => {
  expect(runAnswer("tile.collapse tile=activity on=true", { tile: "activity", collapsed: true, dir: "h" })).toBe("folded activity");
  expect(runAnswer("tile.collapse tile=activity", "already folded")).toBe("already folded");
  expect(runAnswer("no.such.action", { ok: 1 })).toBe('{"ok":1}');
});
