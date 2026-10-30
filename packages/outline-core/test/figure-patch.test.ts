// PIE-1252: a figure suggestion arrives as a patch code built from the note's own lines.
import { expect, test } from "bun:test";
import { figurePatch } from "../src/figure-patch";

test("dated items become a timeline, boxes a checklist, dotted rows a table; other shapes say why there is none", () => {
  const dated = "Garden\n\n- 2026-03 seeds sown\n- 2026-05: first flowers\n- **2026-08 — open garden**\n\nAfter.";
  expect(figurePatch(dated, "graph-timeline")).toEqual({ patch: [{ observed: "- 2026-03 seeds sown\n- 2026-05: first flowers\n- **2026-08 — open garden**", replacement: "::graph-timeline\n---\n---\n- 2026-03: seeds sown\n- 2026-05: first flowers\n- **2026-08: open garden**\n::" }] });
  expect(figurePatch("Plan\n- [x] dig\n- [ ] sow\n- [ ] water", "graph-check")).toEqual({ patch: [{ observed: "- [x] dig\n- [ ] sow\n- [ ] water", replacement: "::graph-check\n---\n---\n- [x] dig\n- [ ] sow\n- [ ] water\n::" }] });
  expect("patch" in figurePatch("Jars\n- beans · 4 · full\n- peas · 2 · half\n- corn · 0 · empty", "graph-table")).toBe(true);
  expect(figurePatch(dated, "graph-check")).toEqual({ why: "no list whose every row has its shape" });
  expect(figurePatch(dated, "graph-funnel")).toMatchObject({ why: expect.stringContaining("write it yourself") });
});

// PIE-1252 walked (PIE-1402): check, compare, decision and table each come as a patch from the lines a writer types.
test("done and open words make a check; label: A | B rows a compare, its columns from the line above; chosen and rejected a decision", () => {
  const apply = (text: string, r: ReturnType<typeof figurePatch>) => ("patch" in r ? r.patch.reduce((t, p) => t.replace(p.observed, p.replacement), text) : text);
  const plan = "Plan\n\n- Done: sheet built and shared\n- Todo: three fields, all or nothing\n- ✓ frost list drafted";
  expect(apply(plan, figurePatch(plan, "graph-check"))).toBe("Plan\n\n::graph-check\n---\n---\n- [x] sheet built and shared\n- [ ] three fields, all or nothing\n- [x] frost list drafted\n::");
  const change = "Change\n\nToday on the sheet | After the fix\n- frost list sent: no | yes, two crates\n- saved where: our side only | the co-op form\n- **reaches the co-op: no | on the Friday run**";
  expect(apply(change, figurePatch(change, "graph-compare"))).toBe("Change\n\n::graph-compare\n---\ncolumns: [Today on the sheet, After the fix]\n---\n- frost list sent: no | yes, two crates\n- saved where: our side only | the co-op form\n- **reaches the co-op: no | on the Friday run**\n::");
  const send = "Send\n\n- Chosen: 2 crates at most — Priya, Sam confirmed\n- Chosen: saved on the co-op form — only that form changes\n- Rejected: 3 crates — the co-op caps at 2";
  expect(apply(send, figurePatch(send, "graph-decision"))).toBe("Send\n\n::graph-decision\n---\n---\n- **2 crates at most** — Priya, Sam confirmed\n- **saved on the co-op form** — only that form changes\n- *3 crates* — the co-op caps at 2\n::");
  // A plain list with dashes is no decision: nothing in it was chosen.
  expect(figurePatch("Notes\n\n- beans — sown\n- peas — sown\n- corn — late", "graph-decision")).toEqual({ why: "no list whose every row has its shape" });
  const edges = "Edges\n\n- a standing order · by design · yes\n- frost list in spring only · by design · no\n- a write replaces the list · answered no · no";
  expect(apply(edges, figurePatch(edges, "graph-table"))).toStartWith("Edges\n\n::graph-table\n---\nrows: [[a standing order, by design, yes]");
});
