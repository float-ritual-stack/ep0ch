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
      const f = new FacetsPane("facets", { query: "stage=ready", open: ["tag"], calendar: false }), r = new ReaderPane();
      return deskOf({ title: "showcase · query words", panes: [f, r], names: ["facets", "guide"], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[r, n.queryWords]]);
    },
  },
  {
    key: "facets", need: "see the properties the notes have with how often each value is used and when it was last used, and narrow notes by including or excluding values", part: "the facets tile (PIE-881): a tile kind (`facets`, ^W o f; `tags` is the same opened on the tags facet, ^W o #) that asks the service (`blocks.query` with the selection as `where` and `facets=true`, which counts every match and says each value's last update), so the door never counts or narrows: every property is a facet and a tag is one of them; a value is included (+) or excluded (−), ORed within a facet and ANDed across facets; a path value (`plot=x/y/z`, a nested tag) is a tree, and picking x includes x/…; the selection is the views' query text (e edits it, facets.query sets it) and v saves it as a view; sorted by uses, name or last use; the first row always counts matches out of all notes; matching notes keep their own resizable share below the keys and open as every list's do (PIE-1220); whole-key picks write key or NOT key, with values still narrowing them", files: "src/desk/facets.ts, src/socket.ts (facetList), outline-core src/property-grammar.ts (path values), protocol.ts (QuestionFacet), outliner src/question-answer.ts",
    aside: "matches stay visible below the keys: drag the Matches divider, click less/more or press [ ] to resize their share · a key row has [+] to require any value and [-] to require its absence; + and - on the key do the same, and 0 drops it · the tags facet is open: ⏎ or a click on #frost-jobs includes it (+), again excludes it (−), again drops it · the query line shows the selection in the views' grammar (`#frost-jobs NOT #compost`): e types one, v saves it as a view on the board hub · ⏎ on a facet (▸) opens its values; path values group as a tree · s or a click on a header word sorts by uses, name or last use · z lists what the selection leaves at 0, dimmed · x clears · ⏎ on a note opens it in the reader beside · the tile is the service's answer: write a #tag or [key::value] in any note and the counts move · agents: facets.set key=tag value=compost mode=exclude, facets.query text=…, facets.save, facets.list",
    stage(n, show) {
      const t = new FacetsPane("tags"), r = new ReaderPane();
      return deskOf({ title: "showcase · tags", panes: [t, r], names: ["tags", "reader"], layout: ([x, y]) => row(0.45, x!, y!) }, show, [[r, n.notebook]], d => { if (n.notebook) fill(d, n.notebook); });
    },
  },
  ];
}
