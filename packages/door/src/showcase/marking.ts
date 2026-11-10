import { FacetsPane } from "../desk/facets";
import { ReaderPane } from "../desk/panes";
import type { Section, deskOf, row, fill } from "./showcase";
import { leaf, pair } from "../desk/screen-layout";

/** PIE-1237: marks, the outline's, made by key, click and act, and gathered by `marked:today`. */
export function markingSections(parts: { deskOf: typeof deskOf; row: typeof row; fill: typeof fill }): Section[] {
  const { deskOf } = parts;
  return [
  {
    key: "marks", need: "mark what I'm looking at with one key, a click or an agent's act, see the mark in my other door and on my phone, and list what I marked today",
    part: "marks in the service (PIE-1237): one verb, marks.add / marks.remove (outliner src/marks.ts, a table of facts and removals, schema 10), that the door's block.mark and block.mark-toggle (alt+m, the tile menu's mark this note), the MCP tool outline_mark, `ep0ch mark` and the web reader's /_marginalia/mark all call; the atoms marked:<when>, marked-by:<who>, marked-since:<when> in the views' grammar (outline-core query-atoms.ts), which leave a mark with a reason (an agent's look-here) out; the door's DoorMarks (src/desk/marks.ts, a ServiceList) read again on the service's marks event, so the ◆ frame is in every door",
    files: "outliner src/marks.ts, src/server.ts, src/schema.ts; outline-core src/query-atoms.ts, src/query-expression.ts; src/desk/marks.ts, src/desk/desk.ts (markBlock, toggleMark), src/desk/tile-actions.ts",
    aside: "alt+m on the bed reader marks Seed potatoes chitting: its frame says ◆ marked · by you, and the guide's marked:today table and the facets tile list it · alt+m again takes it off · right-click a row, mark this note · alt+' steps to a mark · act block.mark-toggle tile=bed, block.mark id=… reason=\"needs your call\" (a look-here frame, not in marked:today), block.unmark n=…, marks.list · ep0ch mark <id>, ep0ch marks · in another door on this outline the same frames show at once",
    stage(n, show) {
      const guide = new ReaderPane(), bed = new ReaderPane(), today = new FacetsPane({ query: "marked:today", open: [], calendar: false });
      return deskOf({ title: "showcase · marks", panes: [guide, bed, today], names: ["guide", "bed", "today"], layout: ([g, b, t]) => pair("row", 0.45, leaf(g!), pair("col", 0.5, leaf(b!), leaf(t!))) }, show, [[guide, n.marking], [bed, n.markPotatoes]]);
    },
  },
  ];
}
