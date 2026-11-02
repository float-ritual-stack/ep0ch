import { ReaderPane } from "../desk/panes";
import type { Section, deskOf, row } from "./showcase";

export const SPACING_NOTE = `Room around the tiles
Choose a spacing, then compare the edges of these two readers.
::button{label="0 cells" act="layout.policy node=screen gap=0 inset=0"}
::button{label="1 cell" act="layout.policy node=screen gap=1 inset=1"}
::button{label="2 cells" act="layout.policy node=screen gap=2 inset=2"}

Ctrl+W then P opens the policy. Choose screen with h, then gap or inset.
Enter or a click cycles the value; + and - adjust it. The saved layout keeps both.

The layout leaves the space. The readers use the room they receive.`;

export const HYPER_NOTE = `Lift from a note [script::lift-from-note] [keys::hyper+b]
\`\`\`actions
agent.lift
\`\`\`
Turn on the hyper layer with hyper.set on=true, then press ✦b inside a draft or terminal.
The hint row and power bar show this binding. Hyper+l is held by tile.focus (focus right).
A clashing note stays saved and names the owner; it cannot take that chord.`;

export function spacingSection(parts: { deskOf: typeof deskOf; row: typeof row }): Section {
  return {
    key: "spacing", need: "leave room between tiles and inside the terminal edge",
    part: "screen-layout gap and inset policy, shared placement and the policy panel",
    files: "src/desk/screen-layout.ts, src/desk/layout.ts, src/desk/flow.ts",
    aside: "Try 0, 1 and 2 using the note's buttons, ^W P on screen, or act layout.policy gap=1 inset=1. The same policy sizes readers, terminals, flows and docks; it is saved with the layout.",
    stage(n, show) {
      const guide = new ReaderPane(true), reader = new ReaderPane(true);
      return parts.deskOf({ title: "showcase · spacing", panes: [guide, reader], names: ["guide", "reader"], layout: ([a, b]) => parts.row(0.5, a!, b!) }, show, [[guide, n.spacing], [reader, n.notebook]]);
    },
  };
}
