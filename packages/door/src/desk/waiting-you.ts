// Waiting on you (PIE-614): what the programs in the door's terminal tiles say asks something of the person: blocked
// (a permission, a question, a login), failed, done and not yet seen, across every terminal tile (the screen's and the
// drawer's), from their program status (OSC 7501, src/desk/program-status.ts). The other half of "waiting on others"
// (src/hub/waiting.ts): that list is the outline's, this one is the terminals'.
//
// A tile kind (`waiting-you`), so it's a tile like any other; `host.waiting` (alt+w, a click on the status bar's count)
// opens it as a tab in your drawer, where it travels with you. Its rows are the kind's actions (WAITING_YOU_ACTIONS):
// j k pick, ⏎ or a click goes to the tile (the person's: the keys go there), x marks it seen. `peek` lists the rows.
import { C, dim, fg, pad, RESET, selected } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago } from "../text";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import { RowView } from "../scroll";
import { onStatusChange, recordFacts, recordText, statusMark, waitingOnYou, type WaitingRow } from "./program-status";

export const WAITING_YOU_KIND_NAME = "waiting-you";

/** A row as `peek` and the actions give it: its place (from 1), its tile, and the record. */
export function rowFacts(r: WaitingRow, n: number): Record<string, unknown> {
  return { n, tile: r.tile, name: r.name, ...recordFacts(r.record), since: new Date(r.at).toISOString() };
}

export class WaitingYouPane implements Pane {
  readonly kind = WAITING_YOU_KIND_NAME;
  /** The row picked (0 is the first), or -1. */
  at = 0;
  private view = new RowView();
  private off: (() => void) | null = null;

  rows(): WaitingRow[] { return waitingOnYou(); }
  title() { const n = this.rows().length; return n ? `waiting on you · ${n}` : "waiting on you · nothing"; }
  hint() { return "j k pick · ⏎ or click goes to it · x seen"; }
  init(desk: DeskApi) { this.off?.(); this.off = onStatusChange(() => desk.redraw()); }
  dispose() { this.off?.(); this.off = null; }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows();
    if (!rows.length) {
      return { lines: [fg(C.white) + "Nothing is waiting on you." + RESET, "", fg(C.grey) + pad("A program in a terminal tile that says it's blocked, done or failed (OSC 7501: Claude Code through the ep0ch mod, ep0ch install, scripts/box-test) shows here until you've seen it.", w) + RESET] };
    }
    this.at = Math.min(Math.max(0, this.at), rows.length - 1);
    this.view.place(this.at, rows.length, h);
    return {
      lines: rows.slice(this.view.top, this.view.top + h).map((r, i) => {
        const n = this.view.top + i, m = statusMark(r.record), age = ago(r.at).padStart(4);
        const who = r.record.id ? `${r.name}/${r.record.title ? r.record.title : r.record.id}` : r.name;
        const what = recordText(r.record);
        if (n === this.at) return selected(focused) + pad(` ${m.glyph} ${who} · ${m.word}${what ? ` · ${what}` : ""}  ${age}`, w) + RESET;
        return pad(` ${m.sgr}${m.glyph} ${fg(C.lcyan)}${who}${fg(C.dark)} · ${m.sgr}${m.word}${what ? `${fg(C.dark)} · ${fg(C.grey)}${what}` : ""}  ${dim(age)}`, w) + RESET;
      }),
    };
  }

  /** Run one of its actions as the person, a refusal said on screen. */
  private run(desk: DeskApi, action: string, args: Record<string, unknown> = {}) { void desk.press?.(this, WAITING_YOU_ACTIONS, action, args); }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows().length;
    if (isUp(k)) { if (this.at > 0) this.run(desk, "status.pick", { n: this.at }); return true; }
    if (isDown(k)) { if (this.at + 1 < n) this.run(desk, "status.pick", { n: this.at + 2 }); return true; }
    if (k.kind === "enter" && n) { this.run(desk, "status.go", { n: this.at + 1 }); return true; }
    if (ch(k) === "x" && n) { this.run(desk, "status.seen", { n: this.at + 1 }); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const n = this.view.top + y;
    if (n < this.rows().length) this.run(desk, "status.go", { n: n + 1 });
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const to = this.at + dir;
    if (to >= 0 && to < this.rows().length) this.run(desk, "status.pick", { n: to + 1 });
  }

  describe() { return this.rows().map((r, i) => rowFacts(r, i + 1)); }
}

/** The row at `n` (from 1), or the one named by its tile; refused with what there is. */
function rowOf(list: WaitingYouPane, a: { n?: number; tile?: string }): { row: WaitingRow; n: number } {
  const rows = list.rows();
  if (!rows.length) throw new ActionRefused("nothing is waiting on you");
  const i = a.tile !== undefined ? rows.findIndex(r => r.tile === a.tile || r.name === a.tile) : (a.n ?? list.at + 1) - 1;
  if (i < 0 || i >= rows.length) throw new ActionRefused(a.tile !== undefined ? `no terminal ${a.tile} is waiting on you · waiting: ${rows.map(r => r.tile ?? r.name).join(", ")}` : `pick 1 to ${rows.length}`);
  return { row: rows[i]!, n: i + 1 };
}

const which = {
  n: { type: "number", optional: true, about: "its place in the list, from 1 (peek lists them)" },
  tile: { type: "string", optional: true, about: "the terminal tile's id or name, instead of n" },
} as const;

/** The list's actions: the keys, a click and `act` call the same code. */
export const WAITING_YOU_ACTIONS = actionSet<KindHost>()("waiting-you", {
  "status.pick": def({
    summary: "pick a row of the waiting-on-you list (n from 1, or tile=<the terminal's id or name>)",
    keys: "j k ↑ ↓, the wheel",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's row (peek lists the rows)",
    args: which,
    run(a, { pane, desk }) { const w = pane as WaitingYouPane, { row, n } = rowOf(w, a); w.at = n - 1; desk.redraw(); return { n, tile: row.tile, name: row.name }; },
  }),
  "status.go": def({
    summary: "go to the terminal tile a row of the waiting-on-you list is about (n from 1, or tile=): on the screen, the drawer put away and the keys given to it; in the drawer, its tab shown and the keys in it. Its done and failed records go once the person is in it. The person's only: going takes their keys",
    keys: "⏎, a click on a row",
    touches: "screen", replay: "ask",
    person: "going to a tile takes the person's keys; an agent reads the rows (peek) and types with tile.type",
    args: which,
    run(a, { pane, desk }, actor) {
      const { row, n } = rowOf(pane as WaitingYouPane, a);
      // The host layer knows the drawer's desk and the screen's: it goes there (src/drawer.ts goTo).
      const host = desk.ctx.hostLayer;
      if (!host) throw new ActionRefused("this door has no drawer to go from");
      const went = host.goTo(row.holder as unknown as Pane, actor);
      return { n, ...went, name: row.name, state: row.record.state };
    },
  }),
  "status.seen": def({
    summary: "mark a terminal's finished work seen (n from 1, or tile=): its done and failed records go from the list, its header and the chip. Its blocked ones stay: only answering the program clears those",
    keys: "x",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't clear what the person is looking at", says: r => `marked ${r.name} seen`,
    args: which,
    run(a, { pane, desk }) {
      const { row } = rowOf(pane as WaitingYouPane, a);
      const gone = row.holder.status.seen();
      desk.redraw();
      return { tile: row.tile, name: row.name, cleared: gone };
    },
  }),
});

/** The list as a tile kind: its rows, its actions, and what `peek` says. */
export const WAITING_YOU_KIND: TileKind = {
  kind: WAITING_YOU_KIND_NAME, about: "what the programs in terminal tiles say waits on you (blocked, failed, done unseen; OSC 7501)", noun: "the waiting-on-you list",
  make: () => new WaitingYouPane(), actions: WAITING_YOU_ACTIONS,
  peek: p => ({ waitingOnYou: (p as WaitingYouPane).describe() }),
  describe: p => ({ rows: (p as WaitingYouPane).describe() }),
};
