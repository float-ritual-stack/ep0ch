import { ReaderPane } from "../desk/panes";
import { TrailPane } from "../desk/trail-tile";
import { USER } from "../socket";
import type { deskOf as DeskOf, Section } from "./showcase";

export const trailSections = (deskOf: typeof DeskOf): Section[] => [
  {
    key: "trail", need: "find the note in a tile you closed, in the day's forest of what opened what",
    part: "The Trail observes door.open at placement, keeps visits in the session's state, and uses graph-tree's branches. Back/forward and layout undo keep their own histories.",
    files: "src/trail.ts, src/trail-view.ts, src/desk/trail-tile.ts, src/desk/return-place.ts",
    aside: "Walk the five linked notes with ] and Enter, or click a link. Open one beside it with alt+Enter; close its tile, then alt+T: Today lists the visits and their dwell (· flipped, ◐ read, ● held). Enter restores the chosen visit where it was; o opens it here, f folds flips, t switches history/forest/timeline/tile, / searches, s saves a branch, a dims or hides agents. In the river, alt+T starts with the column’s back/forward history; t opens the forest. The tile menu has every action. trail.settings sets days, linger, read, held and idle; trail.forget clears a branch, day or all. Agent queries: trail.recent, children, visits, branch, closed, held, from.",
    stage(n, show) {
      const walk = new ReaderPane();
      return deskOf({ title: "showcase · trail", panes: [walk], names: ["walk"] }, show, [[walk, n.trailGate]], d => { if (n.trailGate) void d.openBy(n.trailGate.id, { tile: "walk" }, USER).catch(() => {}); });
    },
  },
  {
    key: "events", need: "see each note opening with who opened it, its source, destination and method",
    part: "Desk.applyPlacement emits door.open on App.subscribe and sends the same envelope through door.event. Extensions subscribe by kind; on.events rules and scripts receive input.trigger.event (on.open also gives input.trigger.open).",
    files: "src/desk/open-event.ts, src/open-events.ts, outline-core/src/door-open.ts, outliner/src/extension-rules.ts",
    aside: "Follow links by click or ] and Enter, go back/forward, or use act open. The timeline beside the walk shows the method, source tile and actor. act door.opens since=0 returns the envelopes, including source and target visit ids. Every select preview reaches the local feed immediately; the service hears it once it lingers, is scrolled or selected in, or becomes the source of a jump. The Trail uses that same linger threshold. Select the Trail and press t to cycle history, forest, timeline and per-tile views.",
    stage(n, show) {
      const walk = new ReaderPane(), events = new TrailPane("walk", { view: "timeline", folded: false, agents: "show" });
      return deskOf({ title: "showcase · events", panes: [walk, events], names: ["walk", "trail"] }, show, [[walk, n.trailGate]], d => { if (n.trailGate) void d.openBy(n.trailGate.id, { tile: "walk" }, USER).catch(() => {}); });
    },
  },
];
