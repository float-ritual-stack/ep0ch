// The pictures section (PIE-1555): a note's mermaid and svg fences, an [img::…svg] line and a render script's SVG banner
// drawn as pictures, beside a terminal tile whose program (a made-up icat) draws kitty images of its own.
import { join } from "node:path";
import { ReaderPane } from "../desk/panes";
import { PtyPane } from "../desk/pty";
import type { deskOf as DeskOf, row as Row, Section } from "./showcase";

export const picturesSection = ({ deskOf, row }: { deskOf: typeof DeskOf; row: typeof Row }): Section => (
{
    key: "pictures", need: "draw a diagram or a picture from a note's text, or from a program in a terminal tile", part: "picture fences (PIE-1555, src/diagrams.ts): a ```mermaid fence (pele, laid out for the body's width) or a ```svg fence becomes an SVG file in the media cache, then an image like any [img::] line (media.ts, the kitty layer), its caption saying what it is for text readers; and a terminal tile's kitty graphics (src/desk/tile-graphics.ts): the pty reader takes a program's _G commands out of the stream before xterm, answers them as kitty would, keeps its images under its own ids and places them at the line they were drawn on, through the tile's view placements; an SVG's <a href> links (found by drawing each link alone as a mask) are tagged cells under the picture, the reader's elements", files: "src/diagrams.ts, src/doc.ts (the fence), src/desk/tile-graphics.ts, src/desk/pty.ts, src/kitty.ts, src/media.ts",
    aside: "the header is a render script's SVG (view.image svg=…, its line `plot-banner:: [layout::hero]`), the note's title and properties laid out: [ ] steps to its two links, ⏎ or a click opens them; plot-cards:: draws the same banner on each card of a board (both import it from the plot-art module) · the reader draws three mermaid diagrams, an svg fence and an [img::…svg] line as pictures · each fence's caption says how many chars its source is, and [−] [+] (or + -, or act image.size by=1) make it smaller or bigger, written as a height= word on the fence so it reopens at that size; a selection over a picture counts and copies its source · ~ shows the note as written, the fences' text, and again draws them · without kitty graphics (alt+v to cells) they stay text, each fence's first row saying what it draws · the terminal on the right runs a made-up icat: it asks whether the terminal draws kitty images, is answered, and sends one; the picture is the tile's, cut at its edge, and goes when it scrolls away or the tile closes · a real chafa -f kitty, timg or yazi works the same in any terminal tile",
    stage(n, show) {
      const r = new ReaderPane(), icat = new PtyPane({ cmd: [process.execPath, join(import.meta.dir, "icat.ts")], label: "icat", shows: "icat", temp: true });
      return deskOf({ title: "showcase · pictures", panes: [r, icat], layout: ([a, b]) => row(0.6, a!, b!) }, show, [[r, n.pictures]]);
    },
  });
