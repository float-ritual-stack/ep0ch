import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const PEEK_SECTION: Section = {
  key: "peek", need: "browse a garden gallery while its picked card follows in a float, then read it or land it beside",
  part: "ListView over RowView → landing() → a select wire to a floating reader → screen-layout",
  files: "src/surface/list-view.ts, src/desk/landing.ts, src/desk/screen-layout.ts",
  aside: "two pages of garden cards · click selects and previews; j k keep the gallery live · Enter enters the peek, Esc closes it · ⤢ lands it beside · h l cross columns or lanes, H L cross groups · ◀ ▶ turn pages · an agent's list.pick and list.page keep their own place",
  stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · peek", panes: [r], names: ["garden"] }, show, [[r, n.peek]]); },
};
