// PIE-1252: a figure suggestion arrives as a patch code built from the note's own lines.
import { expect, test } from "bun:test";
import { figurePatch } from "../src/figure-patch";

test("dated items become a timeline, boxes a checklist, dotted rows a table; other shapes say why there is none", () => {
  const dated = "Garden\n\n- 2026-03 seeds sown\n- 2026-05: first flowers\n- **2026-08 — open garden**\n\nAfter.";
  expect(figurePatch(dated, "graph-timeline")).toEqual({ patch: [{ observed: "- 2026-03 seeds sown\n- 2026-05: first flowers\n- **2026-08 — open garden**", replacement: "::graph-timeline\n---\n---\n- 2026-03: seeds sown\n- 2026-05: first flowers\n- **2026-08: open garden**\n::" }] });
  expect(figurePatch("Plan\n- [x] dig\n- [ ] sow\n- [ ] water", "graph-check")).toEqual({ patch: [{ observed: "- [x] dig\n- [ ] sow\n- [ ] water", replacement: "::graph-check\n---\n---\n- [x] dig\n- [ ] sow\n- [ ] water\n::" }] });
  expect("patch" in figurePatch("Jars\n- beans · 4 · full\n- peas · 2 · half\n- corn · 0 · empty", "graph-table")).toBe(true);
  expect(figurePatch(dated, "graph-check")).toEqual({ why: "no list whose every row has its shape" });
  expect(figurePatch(dated, "graph-decision")).toMatchObject({ why: expect.stringContaining("write it yourself") });
});
