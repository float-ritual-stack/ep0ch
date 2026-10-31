import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const GLASS_SECTION: Section = {
  key: "glass", need: "hover, peel, dock, tuck and drop a post-it; collect refs on a named coloured shelf and travel back and forward",
  part: "host floats through apply · PostIt and ReaderPane share NoteSurface history · Shelf lends ListView its refs · shared drop zones",
  files: "src/glass.ts, src/desk/post-it.ts, src/desk/shelf.ts, src/desk/drop.ts, src/drawer.ts",
  aside: "click ◇ to turn hover on · point at two links, then enter the post-it · peel keeps its stack; drop removes the shown stop · its arrows are the reader's back and forward · the tile menu docks or tucks it; peel returns it from the drawer · Three refs on a shelf makes a named, coloured shelf · drag post-its onto it; its header switches list/grid and colour · one click previews, the second opens · rename with the tile menu · the glyph counts pins and shelves; alt-click clears · Tune → Glass adjusts delays and limits",
  stage(n, show) {
    const links = new ReaderPane(true), title = new ReaderPane(true);
    return deskOf({ title: "showcase · glass", panes: [links, title], names: ["links", "title"] }, show, [[links, n.glass], [title, n.glassTitle]]);
  },
};
