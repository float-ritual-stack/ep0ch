// PIE-1357: a part the person drops into the note they're typing in comes as their own draft.patch: it lands at the
// cursor's block too, one undo step. An agent's patch there is still refused (it becomes a proposal). Made-up text.
import { expect, test } from "bun:test";
import { Draft } from "../src/edit";
import { USER } from "../src/socket";

const patch = (d: Draft) => ({ patchId: "p1", revision: d.base, patches: [{ observed: "Kept here.", range: { start: 4, end: 14 }, replacement: "Kept here.\n\n((n2^part))" }] });

test("the person's own patch at the cursor lands, one undo step; an agent's there is refused", () => {
  const mine = new Draft("n1", 1, "Pad\nKept here.");
  mine.place(1, 4);
  expect(mine.applyPatch(patch(mine), USER)).toEqual({ applied: true });
  expect(mine.text).toBe("Pad\nKept here.\n\n((n2^part))");
  mine.undo(USER);
  expect(mine.text).toBe("Pad\nKept here.");
  const theirs = new Draft("n1", 1, "Pad\nKept here.");
  theirs.place(1, 4);
  expect(theirs.applyPatch(patch(theirs), { kind: "agent", id: "fern" })).toMatchObject({ applied: false });
});
