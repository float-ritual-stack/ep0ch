// Waiting on you (PIE-614): what the programs in the door's terminal tiles say asks something of the person: blocked
// (a permission, a question, a login), failed, done and not yet seen, across every terminal tile (the screen's and the
// drawer's), from their program status (OSC 7501, src/desk/program-status.ts). The other half of "waiting on others"
// (src/hub/waiting.ts): that list is the outline's, this one is the terminals'.
//
// A tile kind (`waiting-you`), so it's a tile like any other; `host.waiting` (alt+w, a click on the status bar's count)
// opens it as a tab in your drawer, where it travels with you. Its rows are the kind's actions (WAITING_YOU_ACTIONS):
// j k pick, ⏎ or a click goes to the tile (the person's: the keys go there), x marks it seen. `peek` lists the rows.
//
// Beside the programs, the requests held for the person's `r` (PIE-888): an `@name` line an agent or an extension wrote
// that no grant lets wake its agent, as the service lists them (`agents.held`, src/held-asks.ts). ⏎ or a click opens the
// note it's in; `r` sends it (the same `r` as on the line: asked as the person); an agent reads them and may open one.
import { C, dim, fg, pad, RESET, selected } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago } from "../text";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { HeldAsk } from "../socket";
import type { KindHost, TileKind } from "./tile-kinds";
import { RowView } from "../scroll";
import { onStatusChange, recordFacts, recordText, statusMark, waitingOnYou, type WaitingRow } from "./program-status";

export const WAITING_YOU_KIND_NAME = "waiting-you";

/** A row as `peek` and the actions give it: its place (from 1), its tile, and the record. */
export function rowFacts(r: WaitingRow, n: number): Record<string, unknown> {
  return { n, tile: r.tile, name: r.name, ...recordFacts(r.record), since: new Date(r.at).toISOString() };
}

/** A held request as `peek` and the actions give it: its place in the list, its place among the held, where it is and why. */
export function heldFacts(a: HeldAsk, n: number, held: number): Record<string, unknown> {
  return { n, held, kind: "held", block: a.blockId, line: a.line, agent: a.agent, title: a.title, request: a.request, why: a.why, by: a.by, since: a.at };
}

export class WaitingYouPane implements Pane {
  readonly kind = WAITING_YOU_KIND_NAME;
  /** The row picked (0 is the first), or -1. */
  at = 0;
  private view = new RowView();
  private off: (() => void) | null = null;

  /** The door it's on: its list is that door's terminals. */
  private door: unknown = undefined;
  rows(): WaitingRow[] { return waitingOnYou(this.door); }
  /** The requests held for the person's r, after the terminals' rows. */
  private heldStore: { list(): readonly HeldAsk[]; subscribe(f: () => void): () => void } | null = null;
  held(): readonly HeldAsk[] { return this.heldStore?.list() ?? []; }
  /** Every row: the terminals' programs, then the held requests. */
  private total(): number { return this.rows().length + this.held().length; }
  title() { const n = this.total(); return n ? `waiting on you · ${n}` : "waiting on you · nothing"; }
  hint() { return this.at >= this.rows().length && this.held().length ? "j k pick · ⏎ opens the note · r sends the request" : "j k pick · ⏎ or click goes to it · x seen"; }
  private offHeld: (() => void) | null = null;
  init(desk: DeskApi) {
    this.door = desk.ctx.hostLayer ?? desk.ctx; this.off?.(); this.off = onStatusChange(() => desk.redraw(), this.door);
    this.heldStore = (desk.ctx as unknown as { heldAsks?: NonNullable<WaitingYouPane["heldStore"]> }).heldAsks ?? null;
    this.offHeld?.(); this.offHeld = this.heldStore?.subscribe(() => desk.redraw()) ?? null;
  }
  dispose() { this.off?.(); this.off = null; this.offHeld?.(); this.offHeld = null; }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows(), held = this.held(), total = rows.length + held.length;
    if (!total) {
      return { lines: [fg(C.white) + "Nothing is waiting on you." + RESET, "", fg(C.grey) + pad("A program in a terminal tile that says it's blocked, done or failed (OSC 7501: Claude Code through the ep0ch mod, ep0ch install, scripts/box-test) shows here until you've seen it; so does a request an agent or an extension wrote that no grant lets wake its agent (held: r sends it).", w) + RESET] };
    }
    this.at = Math.min(Math.max(0, this.at), total - 1);
    this.view.place(this.at, total, h);
    return {
      lines: Array.from({ length: total }, (_, k) => k).slice(this.view.top, this.view.top + h).map((n) => {
        if (n >= rows.length) {
          const a = held[n - rows.length]!, age = ago(Date.parse(a.at)).padStart(4);
          const plain = ` ‖ @${a.agent} · ${a.title} · ${a.why.replace(/^held: /, "")}  ${age}`;
          return n === this.at ? selected(focused) + pad(plain, w) + RESET : pad(` ${fg(C.yellow)}‖ ${fg(C.lcyan)}@${a.agent}${fg(C.dark)} · ${fg(C.grey)}${a.title}${fg(C.dark)} · ${fg(C.grey)}${a.why.replace(/^held: /, "")}  ${dim(age)}`, w) + RESET;
        }
        const r = rows[n]!, m = statusMark(r.record), age = ago(r.at).padStart(4);
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
    const n = this.total(), terminals = this.rows().length;
    if (isUp(k)) { if (this.at > 0) this.run(desk, "status.pick", { n: this.at }); return true; }
    if (isDown(k)) { if (this.at + 1 < n) this.run(desk, "status.pick", { n: this.at + 2 }); return true; }
    const onHeld = this.at >= terminals && this.at < n;
    if (k.kind === "enter" && n) { this.run(desk, onHeld ? "held.open" : "status.go", { n: onHeld ? this.at - terminals + 1 : this.at + 1 }); return true; }
    if (ch(k) === "r" && onHeld) { this.run(desk, "held.send", { n: this.at - terminals + 1 }); return true; }
    if (ch(k) === "x" && n && !onHeld) { this.run(desk, "status.seen", { n: this.at + 1 }); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const n = this.view.top + y, terminals = this.rows().length;
    if (n < terminals) this.run(desk, "status.go", { n: n + 1 });
    else if (n < this.total()) { this.at = n; this.run(desk, "held.open", { n: n - terminals + 1 }); }
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const to = this.at + dir;
    if (to >= 0 && to < this.total()) this.run(desk, "status.pick", { n: to + 1 });
  }

  describe() {
    const terminals = this.rows();
    return [...terminals.map((r, i) => rowFacts(r, i + 1)), ...this.held().map((a, i) => heldFacts(a, terminals.length + i + 1, i + 1))];
  }
}

/** The row at `n` (from 1), or the one named by its tile; refused with what there is. */
function rowOf(list: WaitingYouPane, a: { n?: number; tile?: string }): { row: WaitingRow; n: number } {
  const rows = list.rows();
  if (!rows.length) throw new ActionRefused("nothing is waiting on you");
  if (a.tile === undefined && (a.n ?? list.at + 1) > rows.length && list.held().length) throw new ActionRefused(`row ${a.n ?? list.at + 1} is a held request, not a terminal: held.open opens its note, held.send sends it`);
  const i = a.tile !== undefined ? rows.findIndex(r => r.tile === a.tile || r.name === a.tile) : (a.n ?? list.at + 1) - 1;
  if (i < 0 || i >= rows.length) throw new ActionRefused(a.tile !== undefined ? `no terminal ${a.tile} is waiting on you · waiting: ${rows.map(r => r.tile ?? r.name).join(", ")}` : `pick 1 to ${rows.length}`);
  return { row: rows[i]!, n: i + 1 };
}

/** The held request at `n` (from 1 among the held) or in note `id`, or why not. */
function heldOf(list: WaitingYouPane, a: { n?: number; id?: string }): HeldAsk {
  const held = list.held();
  if (!held.length) throw new ActionRefused("no request is held for a person's r");
  const ask = a.id !== undefined ? held.find(x => x.blockId.startsWith(a.id!)) : held[(a.n ?? Math.max(1, list.at - list.rows().length + 1)) - 1];
  if (!ask) throw new ActionRefused(a.id !== undefined ? `no held request in ${a.id}` : `pick 1 to ${held.length}`);
  return ask;
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
    run(a, { pane, desk }) {
      const w = pane as WaitingYouPane, terminals = w.rows().length;
      if (a.tile === undefined && a.n !== undefined && a.n > terminals && a.n <= terminals + w.held().length) { w.at = a.n - 1; desk.redraw(); return { n: a.n, held: true }; }
      const { row, n } = rowOf(w, a); w.at = n - 1; desk.redraw(); return { n, tile: row.tile, name: row.name };
    },
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
  "held.open": def({
    summary: "open the note a held request is in (n from 1 among the held requests, as peek lists them, or id=<the note's id>): where the waiting list's opens go. The request is not sent (held.send does that); the person's keys stay where they are for an agent",
    keys: "⏎, a click on a held row",
    touches: "screen", replay: "safe", says: r => `opened ${r.title}`,
    args: { n: { type: "number", optional: true, about: "its place among the held requests, from 1" }, id: { type: "string", optional: true, about: "the note's id, instead of n" } },
    async run(a, { pane, desk }, actor) {
      const w = pane as WaitingYouPane, ask = heldOf(w, a);
      await desk.perform?.("open", { id: ask.blockId }, actor);
      return { n: w.held().indexOf(ask) + 1, id: ask.blockId, title: ask.title };
    },
  }),
  "held.send": def({
    summary: "send a held request (n from 1 among the held requests, or id=<the note's id>): ask its agent now, as the person who pressed r (the line's own `r`). An agent's is refused: a held request waits for a person",
    keys: "r",
    touches: "nothing", replay: "ask", says: r => `asked @${r.agent} (${r.title})`,
    person: "a request an agent or an extension wrote waits for a person's r: an agent's is refused, as the line's own r is",
    args: { n: { type: "number", optional: true, about: "its place among the held requests, from 1" }, id: { type: "string", optional: true, about: "the note's id, instead of n" } },
    async run(a, { pane, desk }, actor) {
      if (actor.kind === "agent") throw new ActionRefused("a held request waits for a person's r: an agent can't send it");
      const ask = heldOf(pane as WaitingYouPane, a);
      await desk.ctx.board.refreshProjections(ask.blockId, ask.line >= 0 ? ask.line : undefined, actor);
      return { id: ask.blockId, title: ask.title, agent: ask.agent };
    },
  }),
  "status.seen": def({
    summary: "mark a terminal's finished work seen (n from 1, or tile=): its done and failed records go from the list, its header and the chip. Its blocked ones stay: only answering the program clears those",
    keys: "x",
    touches: "screen", replay: "ask", says: r => `marked ${r.name} seen`,
    // Seen is the person's: an agent reading or acting on a tile never clears what they haven't seen (peek and subscribe don't either).
    person: "seen is the person's: an agent never clears a done they haven't seen (it reads the rows with status.list or peek)",
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
