import { ReaderPane } from "../desk/panes";
import { PEEK_SECTION } from "./peek";
import { BacklinksPane } from "../desk/backlinks-pane";
import { leaf, pair } from "../desk/screen-layout";
import { deskOf, type Section } from "./showcase";

export const COLLECTION_SECTIONS: Section[] = [
  PEEK_SECTION,
  {
    key: "collection", need: "draw a saved query as a table, gallery, feed or board, inline too", part: "VIEW schema → site.answer → list primitive → ListView over RowView", files: "src/collections.ts, src/surface/list-view.ts, outline-core/src/view-spec.ts, outliner/src/site-producers.ts",
    aside: "one garden record, four layouts · enter the list then tab changes layouts; click a table header to cycle sort · j k pick; Enter opens · / filters with the query grammar · act list.layout layout=board, list.group by=area,owner, list.sort by=owner · NONE is last · a narrow table becomes record cards, a narrow board offers lane tabs · the saved note's keys and inline ::view blocks are the same record",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · collection", panes: [r], names: ["garden"] }, show, [[r, n.collection]]); },
  },
  {
    key: "list-view", need: "get a real list (selectable, filterable, with a preview) in every client without a door feature: a ::links block, the links tile and an extension's view draw the same rows the same way", part: "the list primitive and the door's one ListView (PIE-747, ADR 0004 contract 3): outline-core's ListRow (one activation each: open, run, copy, insert) in the view primitives, a component's ^name its id, ListView over RowView with each actor's own pick and filter (an agent's drawn in its tint, never moving yours), one ActionSet for every list: list.blocks, list.pick, list.step, list.open, list.filter, list.enter; the links tile, the inline ::links and the tree's links rows are drawn by the same row drawer; Detail draws the rows as text, a page as <ul>", files: "src/surface/list-view.ts, src/surface/list-actions.ts, src/links.ts (linkListRow, renderLinkBlock), src/desk/backlinks-pane.ts, src/surface/list-drawing.ts (renderPrimitiveList), src/surface/note.ts (listHost), src/components.ts, outline-core src/list-row.ts, outliner src/component-primitives.ts",
    aside: "left, the note: a ::links block (^outbox) over a query with its preview beside, and under it an extension's list view (the seed-shelf script: view.list); right, the links tile on the same note · [ ] steps a note's rows, ⏎ on a frame's ⏎ in goes into a list: j k, / filters, esc comes out · a click selects and previews, a double click opens · the shelf's rows do one thing each: open a letter, copy their titles, run note.copy · agents act on any of them with act list.blocks / list.pick / list.open, tile=reader or tile=links: an agent's pick is its own, drawn in its tint on that row and a line under the list; yours does not move",
    stage(n, show) {
      const r = new ReaderPane(true), links = new BacklinksPane("reader", true);
      return deskOf({ title: "showcase · one list", panes: [r, links], names: ["reader", "links"], layout: ([a, b]) => pair("row", 0.62, leaf(a!), leaf(b!)) }, show, [[r, n.listDemo]]);
    },
  },
];
