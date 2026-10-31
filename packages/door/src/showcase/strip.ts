import { BacklinksPane } from "../desk/backlinks-pane";
import { ReaderPane, TreePane } from "../desk/panes";
import { leaf, splitOf } from "../desk/screen-layout";
import { deskOf, type Section } from "./showcase";

export const STRIP_SECTION: Section = {
  key: "strip", need: "keep the current choice readable when a tile gets narrow",
  part: "tabStrip, ListPicker, NoteSurface, links and the dock container",
  files: "src/surface/chip-rows.ts, src/surface/note.ts, src/desk/desk.ts",
  aside: "drag the border narrower · seven tabs keep the current name; +N lists them all · crumbs show an ancestor's links without moving your keys · dock segments swap on click, open beside on alt+click",
  stage(n, show) {
    const readers = Array.from({ length: 7 }, () => new ReaderPane(true));
    const docks = Array.from({ length: 3 }, () => new ReaderPane(true));
    return deskOf({
      title: "showcase · strip", panes: [...readers, new TreePane(), new BacklinksPane("Build logs"), ...docks],
      names: ["Overview", "Build logs", "Planting", "Harvest", "Watering", "Supplies", "Weather", "tree", "links", "Garden plan", "Seed stock", "Weekend jobs"],
      layout: ids => splitOf("col", [
        splitOf("row", [{ t: "tabs", ids: ids.slice(0, 7), active: 1 }, splitOf("col", [leaf(ids[7]!), leaf(ids[8]!)])], [0.6, 0.4]),
        ...ids.slice(9).map(id => ({ t: "dock" as const, edge: "down" as const, kid: leaf(id), open: false })),
      ], [0.7, 0.1, 0.1, 0.1]),
    }, show, [...readers, ...docks].map(r => [r, n.stripLog]), d => {
      for (const name of ["Overview", "Build logs", "Planting", "Harvest", "Watering", "Supplies", "Weather", "Garden plan", "Seed stock", "Weekend jobs"]) void d.dispatch.press("tile.title", { text: name }, name);
      void d.dispatch.press("tab.select", {}, "Build logs");
    });
  },
};
