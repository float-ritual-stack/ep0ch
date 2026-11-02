import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const GLASS_SECTION: Section = {
  key: "glass", need: "hover, peel, dock, tuck and drop a post-it; collect refs on a named coloured shelf and travel back and forward",
  part: "the glass extension (PIE-1505, ADR 0008: outliner/extensions/glass, its door module ext/glass, on by default) on core's primitives: the hover event (src/hover.ts, door.hover on the door event wire), an extension's status chip (registerStatusChip: ◇), a Tune section and the float layer (host floats through apply) · PostIt and ReaderPane share NoteSurface history · Shelf lends ListView its refs · shared drop zones",
  files: "ext/glass/glass.ts, ext/glass/post-it.ts, ext/glass/shelf.ts, src/hover.ts, src/float-layer.ts, src/door-modules.ts, src/status-bar.ts (registerStatusChip), src/desk/tune.ts (registerTuneSection), src/desk/drop.ts, src/drawer.ts, outliner/extensions/glass",
  aside: "click ◇ to turn hover on · point at two links, then enter the post-it · peel keeps its stack; drop removes the shown stop · its arrows are the reader's back and forward · the tile menu docks or tucks it; peel returns it from the drawer · Three refs on a shelf makes a named, coloured shelf · drag post-its onto it; its header switches list/grid and colour · one click previews, the second opens · rename with the tile menu · the glyph counts pins and shelves; alt-click clears · Tune → Glass adjusts delays and limits · it's an extension: ctrl+k then & lists Glass beside the others; act extensions.uninstall id=glass demo=keep turns hover and ◇ off (the layer stays: ^W U still floats a tile), act extensions.install id=glass brings both back",
  stage(n, show) {
    const links = new ReaderPane(true), title = new ReaderPane(true);
    return deskOf({ title: "showcase · glass", panes: [links, title], names: ["links", "title"] }, show, [[links, n.glass], [title, n.glassTitle]]);
  },
};
