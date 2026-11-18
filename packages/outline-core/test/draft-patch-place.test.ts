// Whether a patch may land in a live draft (draft-patch-place.ts): the one decision the door makes over its own
// buffer and the service makes for a holder that reads no Blockdown. Fictional notes only.
import { expect, test } from "bun:test";
import { applyLocated, mapOffset, type DraftPatchSpan } from "../src/draft-patch-compare";
import { mapCursor, patchDid, patchedSpans, placeDraftPatch, revertSpans, withoutPatched, type DraftStands } from "../src/draft-patch-place";

const TEXT = "Seed list [type::list]\n\nThe beans  go  along the fence.\n\n- lift the onions\n- sow the peas\n\nStill typing he";
const at = (words: string) => TEXT.indexOf(words);
const draft = (cursor: number, more: Partial<DraftStands> = {}): DraftStands => ({ text: TEXT, base: 4, cursor, anchor: cursor, ...more });
const swap = (observed: string, replacement: string): DraftPatchSpan => ({ observed, replacement });
const ask = (patches: DraftPatchSpan[], more: Record<string, unknown> = {}) => ({ revision: 4, patches, ...more });

test("a patch lands anywhere but the block being typed in: the cursor's paragraph, list item or heading", () => {
  const end = TEXT.length;
  expect(placeDraftPatch(draft(end), ask([swap("beans  go  along", "beans go along")]), false)).toMatchObject({ ok: true, spans: [{ start: at("beans"), replacement: "beans go along" }], askEnd: -1 });
  expect(placeDraftPatch(draft(end), ask([swap("Still typing", "Still writing")]), false)).toEqual({ ok: false, reason: "it changes the block being typed in" });
  // A list item is a block of its own: the one above the cursor's may change, the cursor's may not.
  const item = at("sow the peas") + 3;
  expect(placeDraftPatch(draft(item), ask([swap("lift the onions", "lift the red onions")]), false).ok).toBe(true);
  expect(placeDraftPatch(draft(at("the peas") + 2), ask([swap("the peas", "the sweet peas")]), false)).toEqual({ ok: false, reason: "the cursor is in that passage" });
  expect(placeDraftPatch(draft(at("- sow")), ask([swap("the peas", "the sweet peas")]), false)).toEqual({ ok: false, reason: "it changes the block being typed in" });
  // The selection's other end holds its block too.
  expect(placeDraftPatch(draft(end, { anchor: at("beans") }), ask([swap("along the fence", "by the fence")]), false).ok).toBe(false);
});

test("the person's own write, a save under way, a stale revision and a missing passage each say what they are", () => {
  const end = TEXT.length;
  expect(placeDraftPatch(draft(end), ask([swap("Still typing", "Still writing")]), true).ok).toBe(true);
  expect(placeDraftPatch(draft(end, { busy: true }), ask([swap("beans", "peas")]), false)).toEqual({ ok: false, reason: "the draft is being saved" });
  expect(placeDraftPatch(draft(end), { ...ask([swap("beans", "peas")]), revision: 3 }, false)).toEqual({ ok: false, reason: "the draft is on revision 4, not the 3 it was read at" });
  expect(placeDraftPatch(draft(end), ask([swap("the leeks", "the garlic")]), false)).toEqual({ ok: false, reason: "the observed text isn't there any more" });
});

test("a stamp on another line of the block being typed in lands, and a paragraph added at the very end opens below the cursor", () => {
  const title = "Seed list [type::list]\nSown in March and still going";
  const stamped = placeDraftPatch({ text: title, base: 2, cursor: title.length, anchor: title.length }, { revision: 2, patches: [swap("[type::list]", "[type::list] [stage::sown]")] }, false);
  expect(stamped.ok).toBe(true);
  const added = placeDraftPatch(draft(TEXT.length), ask([{ observed: "", replacement: "\n\nRestored on the first frost." }]), false);
  expect(added).toMatchObject({ ok: true, spans: [{ start: TEXT.length, end: TEXT.length, caret: "apart" }] });
  if (added.ok) expect(mapCursor(TEXT.length, added.spans)).toBe(TEXT.length);
});

test("an answer goes under its ask line, whose own words are out of the patch, and a cursor at the ask's end stays there", () => {
  const text = "Plan\n\n@tidy when do the peas go in?\n\nStill typing";
  const line = "@tidy when do the peas go in?";
  const cursor = text.indexOf(line) + line.length;
  const placed = placeDraftPatch({ text, base: 2, cursor, anchor: cursor }, { revision: 2, patches: [swap(line, `${line}\n> [!note] In March.`)], replyTo: line }, false);
  expect(placed).toMatchObject({ ok: true, askEnd: cursor, spans: [{ start: cursor, end: cursor, replacement: "\n> [!note] In March.", caret: "stays" }] });
  if (!placed.ok) return;
  expect([cursor, cursor + 1, 3].map(offset => mapCursor(offset, placed.spans))).toEqual([cursor, cursor + 1 + "\n> [!note] In March.".length, 3]);
  // Typed on since it was read, it is a new ask.
  expect(placeDraftPatch({ text: text.replace("go in?", "go in??"), base: 2, cursor, anchor: cursor }, { revision: 2, patches: [swap(line, `${line}\n> x`)], replyTo: line }, false)).toEqual({ ok: false, reason: "the ask was typed on since it was read" });
});

test("mapCursor is mapOffset for spans that say nothing of the cursor", () => {
  const spans = [{ start: 2, end: 5, replacement: "a" }, { start: 20, end: 20, replacement: "garlic, " }];
  for (const offset of [0, 2, 3, 5, 6, 20, 21, 40]) expect(mapCursor(offset, spans)).toBe(mapOffset(offset, spans));
});

test("a patch is taken back by what it wrote, wherever typing moved it, and never once that has changed", () => {
  const placed = placeDraftPatch(draft(TEXT.length), ask([swap("beans  go  along", "beans go along")]), false);
  if (!placed.ok) throw new Error(placed.reason);
  const after = applyLocated(TEXT, placed.spans);
  const patched = patchedSpans(TEXT, after, placed.spans);
  expect(patched).toEqual([{ start: at("beans"), text: "beans go along", was: "beans  go  along", before: "t]\n\nThe ", after: " the fen" }]);
  const typed = `A line typed above.\n${after}d more`;
  const back = revertSpans(typed, patched);
  expect(back && applyLocated(typed, back)).toBe(`A line typed above.\n${TEXT}d more`);
  expect(revertSpans(after.replace("beans go along", "beans run along"), patched)).toBeNull();
  expect(withoutPatched(after, [patched])).toBe(TEXT);
});

test("what a patch did is said by what its ask was", () => {
  expect([{}, { output: true }, { force: true }, { proposal: { op: "dismiss" as const } }, { standsOn: { revision: 3, text: "" } }].map(patchDid)).toEqual([
    "edited text above your cursor", "placed output in your draft", "applied a proposal in your draft", "took a dismissed proposal's line out of your draft", "set a property: saved, and in your draft beside your words",
  ]);
});
