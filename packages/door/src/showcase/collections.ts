import { ReaderPane } from "../desk/panes";
import { GLASS_SECTION } from "./glass";
import { PEEK_SECTION } from "./peek";
import { IN_PLACE_SECTION } from "./in-place";
import { SAME_KEYS_SECTION } from "./same-keys";
import { BacklinksPane } from "../desk/backlinks-pane";
import { leaf, pair } from "../desk/screen-layout";
import { deskOf, type Section } from "./showcase";

export const COLLECTION_SECTIONS: Section[] = [
  PEEK_SECTION, GLASS_SECTION, IN_PLACE_SECTION, SAME_KEYS_SECTION,
  {
    key: "quiet-collection", need: "read what is waiting, with controls quiet until wanted",
    part: "the collection's own header and footer, ListView's title and pick, and the existing settings card",
    files: "src/collections.ts, src/surface/list-view.ts, src/surface/settings-card.ts",
    aside: "two notes with type and ticket properties, each keeping its title · hover to reveal one control row · click a note to pick it, arrows or j k move the light (no mode: the [ ] position is the pick), Enter opens · comma or ≡ opens settings · Esc lets go, as of any element · the wheel scrolls the note over it · choose feed to read the notes' callouts, bold, headings and resolved values · Esc, then S lists the collection's query, layout, count and read time; r asks again · try at 44 and 120 columns",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · quiet collection", panes: [r], names: ["garden"] }, show, [[r, n.collectionQuiet]]); },
  },
  {
    key: "collection-tune", need: "tune a collection over its view without editing the source",
    part: "SettingsCard over VIEW in the reader's attached surface (ADR 0007), toggle and pick-order BarQuestions over the matched rows' facets, binding.set at the read revision",
    files: "src/surface/settings.ts, src/surface/settings-card.ts, src/surface/binding.ts, src/bar/ask.ts, src/desk/settings.ts",
    aside: "press , over the garden · ctrl+o or the placement chip offers inline, floating, split, popup and its own tile · choose split and toggle board on: the view redraws beside the card · a long query wraps in its field · ctrl+g moves a float or tile · Esc returns to the picked row · Esc again lets go, then S opens Sources alongside · Sort: J/K reorder · summary-properties: space hides owner · an agent writes the same keys without taking your focus",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · collection settings", panes: [r], names: ["garden"] }, show, [[r, n.collectionTune]]); },
  },
  {
    key: "figure-settings", need: "tune a live figure by the keys it reads, written into its own YAML",
    part: "the one SettingsCard over the figure's own component schema (parts describe themselves), binding.set into the block's YAML, settings.undo for ctrl+z, and the views' collection renderer drawing a ::graph-table's layout",
    files: "src/surface/settings.ts, src/surface/binding.ts, src/collections.ts, outline-core/src/view-spec.ts, outline-core/src/component-schemas-figures.ts",
    aside: "a sprint-like note with one live ::graph-table · hover or enter it: its control row ends in ≡ settings · comma or a click on ≡ opens the table's own keys (title, query, columns, sort, layout…), never the view's · pick layout and space on feed or board: each one you keep is a tab over the same rows, as in a view, written as layout: \"feed, table\" in the block's YAML · click a tab to switch · drag the bottom edge: it follows the pointer, saying its rows, and the reader scrolls to keep it in sight · ctrl+z puts it back · reopen the note: still a feed · columns offers the properties the rows carry · a key the table doesn't take (layot:) is said under the figure, with the one it may mean, and on the save line when it's written · agents: act settings list=^sprint, then settings.set key=layout value=feed",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · figure settings", panes: [r], names: ["sprint"] }, show, [[r, n.figureSettings]]); },
  },
  {
    key: "collection", need: "draw a saved query as a table, gallery, feed or board, inline too", part: "VIEW schema → site.answer → list primitive → ListView over RowView", files: "src/collections.ts, src/surface/list-view.ts, outline-core/src/view-spec.ts, outliner/src/site-producers.ts",
    aside: "one garden record, four layouts in one control row · click a layout or table header to change layout or sort · arrows or j k pick the lit row, h l cross columns or lanes, H L cross groups, PgUp PgDn turn pages; Enter opens; Esc lets go; comma tunes; the wheel scrolls its rows first, then the note (PIE-1501) · feed draws the notes through the reader · / filters with the query grammar · act list.layout layout=board, list.group by=area,owner, list.sort by=owner · NONE is last · a narrow table becomes named record cards, a narrow board offers lane tabs · Tab out, then S explains the collection and r asks again",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · collection", panes: [r], names: ["garden"] }, show, [[r, n.collection]]); },
  },
  {
    key: "long-collection", need: "page through a collection longer than the screen, one screen of rows at a time",
    part: "ListView.pageBy over the reader's room (ListHost.room): a list drawn whole in a note pages by what the reader shows, in every layout",
    files: "src/surface/list-view.ts, src/surface/list-actions.ts, src/surface/note.ts (listHost)",
    aside: "forty seed packets as a table · j steps onto Packet 01 · PgDn moves the pick one screen of rows and the reader follows, PgUp moves back one · the same in gallery and feed (bigger cards, fewer per screen) · act list.step by=1 page=true does what PgDn does · try at 44 columns: the table becomes cards and a page is the cards on screen",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · long collection", panes: [r], names: ["packets"] }, show, [[r, n.collectionLong]]); },
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
