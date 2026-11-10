// Leaving a screen for good (PIE-1679, PIE-1697): its running tiles go into the drawer's layout, behind the tab shown,
// nobody's keys moved, each under a name free there; and the leave is said once, its groups' tiles with its own.
import type { Desk, MovedTile } from "./desk";
import type { Pane } from "./panes";

const DOOR = { kind: "agent", id: "door" } as const;
interface Said { panes: Pane[]; kept: boolean; ended: string[] }

export class DrawerKeep {
  /** The keeps of one leave (together), said when it ends. */
  private keeping: Said | null = null;
  constructor(private readonly desk: () => Desk | null, private readonly host: { flash(msg: string, ms?: number): void; redraw(): void }) {}

  /** Why tiles like these couldn't go into the drawer now (its layout locked, say), or null: leaving a screen asks first. */
  refusal(moved: Pick<MovedTile, "name" | "spec" | "kept">[]): string | null {
    const d = this.desk();
    if (!d) return null;
    for (const m of moved) { const why = d.bringRefusal(m, undefined, "tabs", DOOR); if (why) return `${m.name} couldn't go into your drawer: ${why}`; }
    return null;
  }
  /** The panes it took (one it couldn't ends with the screen, and is said with why). */
  keep(moved: MovedTile[]): Pane[] {
    const d = this.desk();
    if (!d) return [];
    const panes: Pane[] = [], ended: string[] = [];
    for (const m of [...moved].sort(/* a name free here first: a clash renames only the tile that clashes (PIE-1679) */ (a, b) => Number(d.freeName(a.name) !== a.name) - Number(d.freeName(b.name) !== b.name))) {
      const why = d.bringRefusal(m, undefined, "tabs", DOOR);
      if (why) { ended.push(`${m.name} (${why})`); continue; }
      d.bringIn(m, undefined, "tabs", DOOR); panes.push(m.pane);
    }
    const said = this.keeping ?? { panes: [], kept: false, ended: [] };
    said.panes.push(...panes); said.ended.push(...ended);
    said.kept ||= moved.some(m => m.kept && panes.includes(m.pane));
    if (!this.keeping) this.say(said);
    if (panes.length) this.host.redraw();
    return panes;
  }
  /** `run`'s keeps said as one, once it ends: a screen and the groups that go with it (each group's desk is its own keep). */
  together(run: () => void): void {
    if (this.keeping) return run();
    const said = this.keeping = { panes: [], kept: false, ended: [] };
    try { run(); } finally { this.keeping = null; this.say(said); }
  }
  /** What went into the drawer, named as the drawer shows them (its layout's order, after any renaming), and what ended. */
  private say({ panes, kept, ended }: Said) {
    const d = this.desk();
    const took = d ? (d.layoutGet().tiles as { name: string }[]).filter(t => panes.includes(d.pane(t.name)!)).map(t => t.name) : [];
    if (took.length) this.host.flash(`${took.join(", ")} went into your drawer${kept ? " · an undo's leftovers in its kept dock" : ""} · alt+a shows ${took.length === 1 ? "it" : "them"}${ended.length ? ` · ended with the screen: ${ended.join(", ")}` : ""}`, 8000);
    else if (ended.length) this.host.flash(`ended with the screen: ${ended.join(", ")}`, 8000);
  }
}
