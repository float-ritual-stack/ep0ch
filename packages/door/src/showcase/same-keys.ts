import { TreePane } from "../desk/panes";
import { leaf, pair } from "../desk/screen-layout";
import { deskOf, detailPane, type Section } from "./showcase";

/** PIE-1293: one page step, one confirm rule, hint rows from key tables, shown on the outline and a note. */
export const SAME_KEYS_SECTION: Section = {
  key: "same-keys", need: "press PgDn, ⏎ on a yes/no, or read a hint row in any tile and have it mean the same thing", part: "the door's one page step and one confirm rule (PIE-1293): pageRows, listMove and RowView.page in src/scroll.ts (PgUp PgDn move the rows shown, less one, in every list and reader: ListView.pageBy, the tree, the board's lanes, a picker, the completion list); confirmPicker in src/surface/picker.ts (every yes/no: the safe row first, so ⏎ keeps, the destructive row second and red; trash's d d, the board's d d and a Claude split's stop all ask through it); Again in src/arm.ts (press-it-again: the same key within 5 s, any other key lets it go); hint rows drawn from key tables (modeHint, partsHint), held by test/hint-literals.test.ts; waiting() and moreRow() in src/text.ts", files: "src/scroll.ts, src/surface/picker.ts, src/arm.ts, src/surface/list-view.ts, src/text.ts, test/hint-literals.test.ts",
  aside: "the outline on the left, the Compost heap on the right · Enter on the outline, then PgDn: the pick moves the rows shown less one, as it does in every list here; PgUp comes back · Tab to the detail, press d: the yes/no comes up with \"keep it\" first, so ⏎ keeps the heap; d again (or Delete, or a click on the red row) would trash it · each tile's hint row is drawn from its key table, so a rebind shows on it",
  stage(n, show) { const tree = new TreePane(), d = detailPane(); return deskOf({ title: "showcase · same keys", panes: [tree, d], names: ["tree", "detail"], layout: ([a, b]) => pair("row", 0.45, leaf(a!), leaf(b!)) }, show, [[d, n.heap]]); },
};
