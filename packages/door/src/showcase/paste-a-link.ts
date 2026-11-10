// The showcase's "Paste a link" section (PIE-1401, PIE-1316, PIE-1390): its stage, beside its seed (seed/paste-a-link.ts).
import { BacklinksPane } from "../desk/backlinks-pane";
import { ReaderPane } from "../desk/panes";
import { leaf, pair } from "../desk/screen-layout";
import type { deskOf as DeskOf, Section } from "./showcase";

export const pasteALinkSection = (deskOf: typeof DeskOf): Section => ({
  key: "paste-a-link", need: "paste a note's web link or ep0ch:// address bare into a note and click it to open the note, after copying it from wherever the note is seen", part: "outline-core's link scan (linkOccurrences: a bare address is a `url` link, never inside code, a Markdown link, a reference or a property), the door's destinationOf (a note's web link or ep0ch:// address is the note, any other page the browser), note.copy-ref over the service's notes.address link and the one line-anchor owner (lineRef: fragments.at, fragments.ensure)", files: "outline-core/src/link-syntax.ts, src/refs.ts, src/open.ts, src/note-ref.ts, src/paste-path.ts, outliner/src/server.ts (notes.address)",
  aside: "Click the web link or the ep0ch:// address (or ⏎ on it): the rota opens where a reference would (the preview) · the example.org page opens in the browser · the rota's ⋯ menu, Copy group: copy note web link gives the link the service answers (its publisher's address, by Work ID for a roadmap item); copy line reference on a line of the rota gives ((id^anchor|its words)), the ^anchor added once · the links tile lists the rota (the reference's outlink; a bare address isn't a backlink yet): right-click its row for the same Copy rows · e here, paste on the Paste here line, save, click it · act note.copy-ref kind=link tile=preview, then link.follow · paste any text here without pressing e (try one holding d and x): no letter runs, the power bar offers it (src/paste-path.ts, PIE-1659) · published, the ep0ch:// address links to the rota's page",
  stage(n, show) {
    const a = new ReaderPane(), links = new BacklinksPane("notes", true), b = new ReaderPane();
    return deskOf({ title: "showcase · paste a link", panes: [a, links, b], names: ["notes", "links", "preview"],
      layout: ([x, y, z]) => pair("row", 0.55, leaf(x!), pair("col", 0.4, leaf(y!), leaf(z!))) }, show,
      [[a, n.pasteALink], [b, n.keyRota]]);
  },
});
