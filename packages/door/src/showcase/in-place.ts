import { BacklinksPane } from "../desk/backlinks-pane";
import { ReaderPane } from "../desk/panes";
import { leaf, pair } from "../desk/screen-layout";
import { deskOf, type Section } from "./showcase";

/** PIE-1516: a links tile wired to itself. An open in it shows the note there; ← back walks its trail, then the list. */
export const IN_PLACE_SECTION: Section = {
  key: "in-place", need: "open a note where the list was: no new tile, no sliding river, ← back returns to the list",
  part: "an open wire from a tile to itself (tile.link) through placement()'s one landing (inPlace), the reader's one trail with the list beneath it (ReaderHistory.beneath), and the `self` open rule for a whole container",
  files: "src/desk/screen-layout.ts (placement), src/desk/in-place.ts, src/desk/landing.ts, src/surface/note.ts (travel, describeHistory)",
  aside: "right, the walk's links, wired to itself: the frame says open → in place · ⏎ or a double click on a row shows that note in the links tile, links followed there land there too · ← back (alt+←, the ← back on its header) walks back, and once more puts the list back · wire your own: alt+l, o, then click the same tile (the card's \"itself: open in place\" row, or its number) · ^W P's opens row steps to self for every tile in a container · act tile.link tile=links to=links",
  stage(n, show) {
    const walk = new ReaderPane(true), links = new BacklinksPane("walk", true);
    return deskOf({ title: "showcase · open in place", panes: [walk, links], names: ["walk", "links"], wires: [[], [{ verb: "open", to: 1 }]], layout: ([a, b]) => pair("row", 0.5, leaf(a!), leaf(b!)) }, show, [[walk, n.trailGate]]);
  },
};
