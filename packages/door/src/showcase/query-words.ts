import { FacetsPane } from "../desk/facets";
import { ReaderPane } from "../desk/panes";
import type { Section, deskOf, row, fill } from "./showcase";

export function queryWordSections(parts: { deskOf: typeof deskOf; row: typeof row; fill: typeof fill }): Section[] {
  const { deskOf, row, fill } = parts;
  return [
  {
    key: "query-words", need: "type words on any query line and accept a proposed filter (PIE-1238)",
    part: "the facets tile's LineField and shared Completer, completion.rows and query.suggest; outline-core's selectionQuery writes the filter, Jev chooses code-made candidates, and acceptance teaches the query words rule note",
    files: "src/surface/completer.ts, src/desk/facets.ts, outliner/src/query-suggest.ts, outline-core/src/query-clauses.ts",
    aside: "Go in (Enter), e edits where: · type trellises copper and pause · Tab or a click accepts the ghost · right shows why and runner-ups · e, type trellises again: the learned alias is free · Esc drops a ghost · act: facets.edit, complete.ask, complete.accept, complete.dismiss; agents use query.suggest",
    stage(n, show) {
      const f = new FacetsPane({ query: "stage=ready", open: ["tag"], calendar: false }), r = new ReaderPane();
      return deskOf({ title: "showcase · query words", panes: [f, r], names: ["facets", "guide"], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[r, n.queryWords]]);
    },
  },
  {
    key: "query-sources", need: "write my own words for a filter as an extension, and see its rows on a query line and in the power bar (PIE-1508)",
    part: "the query trigger for extensions' completion sources (outline-core EXTENSION_TRIGGERS: `query`), asked by completion.rows beside query words on every query line (the facets tile's where:, [query::, a figure's query:), its rows writing the whole line; a source with picks hears completion.picked (accepted, edited, ignored) through its picked operation; a bar source's grammar: query makes its line a query line (the bar's grammar(), the = scope its first user)",
    files: "outline-core/src/completion-source.ts, outliner src/completion-sources.ts (asksQuery, queryInsert), outliner src/completion-requests.ts (picked), outliner src/extension-calls.ts (picked), outliner extensions/issues (issue-words, issue-notes), src/surface/completer.ts (tellIgnored, tellEdited), src/bar/bar.ts (grammar)",
    aside: "Go in (Enter), e edits where: · type seed sw and pause: Issues offers issue=\"#15\" beside the query words · ↓ to it, then Tab or a click writes the line, ⏎ applies it: Seed swap table is the one note · Esc with the list open tells Issues its rows were left · ctrl+k then $: Issues' notes, its line a query line as = is · act: facets.edit text=…, complete.ask, complete.accept n=…",
    stage(n, show) {
      const f = new FacetsPane({ query: "stage=ready", open: ["issue"], calendar: false }), r = new ReaderPane();
      return deskOf({ title: "showcase · your words for a filter", panes: [f, r], names: ["facets", "guide"], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[r, n.querySources]]);
    },
  },
  {
    key: "facets", need: "see the properties the notes have with how often each value is used and when it was last used, and narrow notes by including or excluding values", part: "the facets tile (PIE-881): a tile kind (`facets`, ^W o f; `tags` is the same opened on the tags facet, ^W o #) that asks a facet source for rows and counts: notes still use `blocks.query`, trail and extension rows use the shared outline-core query evaluator and counter; every property is a facet and a tag is one of them; a value is included (+) or excluded (−), ORed within a facet and ANDed across facets; a path value (`plot=x/y/z`, a nested tag) is a tree, and picking x includes x/…; the selection is the views' query text (e edits it, facets.query sets it) and v saves it as a view; sorted by uses, name or last use; the first row always counts matches out of all notes; matching notes keep their own resizable share below the keys and open as every list's do (PIE-1220); whole-key picks write key or NOT key, with values still narrowing them", files: "src/desk/facets.ts, src/socket.ts (facetList), outline-core src/property-grammar.ts (path values), protocol.ts (QuestionFacet), outliner src/question-answer.ts",
    aside: "S or a click on source switches Notes → Trail → Garden seeds (the installed facet-garden extension). Trail picks: dwell=held, day=today, from-tile=links. Garden seeds: family=beans/* colour=red leaves Runner beans. The same picks, counts, calendar and saved searches serve all three. Keep Trail beside the reader and follow a link: the new visit appears without reload. facets.view restores a saved search’s source and query together. matches stay visible below the keys: drag the Matches divider, click less/more or press [ ] to resize their share · a key row has [+] to require any value and [-] to require its absence; + and - on the key do the same, and 0 drops it · the tags facet is open: ⏎ or a click on #frost-jobs includes it (+), again excludes it (−), again drops it · the query line shows the selection in the views' grammar (`#frost-jobs NOT #compost`): e types one, v saves it as a view on the board hub · ⏎ on a facet (▸) opens its values; path values group as a tree · s or a click on a header word sorts by uses, name or last use · z lists what the selection leaves at 0, dimmed · x clears · ⏎ on a note opens it in the reader beside · the tile is the service's answer: write a #tag or [key::value] in any note and the counts move · agents: facets.set key=tag value=compost mode=exclude, facets.query text=…, facets.save, facets.list",
    stage(n, show) {
      const t = new FacetsPane({ open: ["tag"] }), r = new ReaderPane();
      return deskOf({ title: "showcase · tags", panes: [t, r], names: ["tags", "reader"], layout: ([x, y]) => row(0.45, x!, y!) }, show, [[r, n.notebook]], d => { if (n.notebook) fill(d, n.notebook); });
    },
  },
  ];
}
