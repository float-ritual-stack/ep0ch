import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const GLASS_SECTION: Section = {
  key: "glass", need: "hover a link or cut-off title, read its post-it, flip the stack and keep a tile above every screen",
  part: "the host desk's floats through apply · PostIt over ReaderPane and NoteSurface · hover wires through placement",
  files: "src/glass.ts, src/desk/post-it.ts, src/drawer.ts, src/desk/screen-layout.ts",
  aside: "click ◇ on the status bar (alt+u): off → on → sticky · point at a link or the long title · the post-it opens in the opposite corner and stays there · move into it; ← → or wheel over its title flips · alt-hover makes this one sticky · Esc or × dismisses it · ^W U or tile.float to=glass keeps any tile here across screens · alt-click ◇ or alt+U clears · Tune's Glass tab adjusts the delays and limits",
  stage(n, show) {
    const links = new ReaderPane(true), title = new ReaderPane(true);
    return deskOf({ title: "showcase · glass", panes: [links, title], names: ["links", "title"] }, show, [[links, n.glass], [title, n.glassTitle]]);
  },
};
