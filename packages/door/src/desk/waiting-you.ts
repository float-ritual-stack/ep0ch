import type { WaitingAsk } from "@ep0ch/outline-core/protocol";
import type { WaitingAsks } from "../waiting-asks";
import { markReveal } from "../reveal";
import { PROPOSAL_ACTIONS } from "../surface/note";
import { proposalOps } from "../embeds";
import type { Actor } from "../socket";
import { C, dim, fg, pad, RESET, selectedRow } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago } from "../text";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { HeldAsk } from "../socket";
import type { HeldAsks } from "../held-asks";
import type { KindHost, TileKind } from "./tile-kinds";
import { RowView, pressOn, type RowPress } from "../scroll";
import { onStatusChange, recordFacts, recordText, statusMark, waitingOnYou, type WaitingRow } from "./program-status";

export const WAITING_YOU_KIND_NAME = "waiting-you";

/** A row as `peek` and the actions give it: its place (from 1), its tile, and the record. */
export function rowFacts(r: WaitingRow, n: number): Record<string, unknown> {
  return { n, tile: r.tile, name: r.name, ...recordFacts(r.record), since: new Date(r.at).toISOString() };
}

/** A held request as `peek` and the actions give it: its place in the list (the `n` every action takes), where it is and why. */
export function heldFacts(a: HeldAsk, n: number): Record<string, unknown> {
  return { n, kind: "held", block: a.blockId, line: a.line, agent: a.agent, title: a.title, request: a.request, why: a.why, by: a.by, since: a.at };
}

/** A held row's send, at its right end: a click on it is `r`. */
const SEND = " [r send]";

type Entry = { kind: "program"; row: WaitingRow } | { kind: "held"; row: HeldAsk } | { kind: "ask"; row: WaitingAsk };

export class WaitingYouPane implements Pane {
  readonly kind = WAITING_YOU_KIND_NAME;
  at = 0;
  private width = 0;
  private view = new RowView();
  private painted: (number | string)[] = [];
  private offs: (() => void)[] = [];
  private door: unknown;
  private heldStore: HeldAsks | null = null;
  private askStore: WaitingAsks | null = null;
  rows(): WaitingRow[] { return waitingOnYou(this.door); }
  held(): readonly HeldAsk[] { return this.heldStore?.list() ?? []; }
  asks(): readonly WaitingAsk[] { return this.askStore?.list() ?? []; }
  entries(): Entry[] {
    return [...this.asks().map(row => ({ kind: "ask" as const, row })), ...this.held().map(row => ({ kind: "held" as const, row })), ...this.rows().map(row => ({ kind: "program" as const, row }))];
  }
  title() { const n = this.entries().length; return `waiting on you · ${n || "nothing"}`; }
  hint() { return "j k pick · click selects · ⏎ opens · alt+⏎ beside · x clear/seen · A apply · X dismiss · r resolve/send"; }
  init(desk: DeskApi) {
    this.dispose();
    this.door = desk.ctx.hostLayer ?? desk.ctx;
    this.heldStore = desk.ctx.heldAsks ?? null;
    this.askStore = desk.ctx.waitingAsks ?? null;
    this.offs.push(onStatusChange(() => desk.redraw(), this.door));
    for (const store of [this.heldStore, this.askStore]) if (store) this.offs.push(store.subscribe(() => desk.redraw()));
  }
  dispose() { for (const off of this.offs) off(); this.offs = []; }
  private controls(e: Entry): string {
    if (e.kind === "held") return SEND;
    if (e.kind !== "ask") return "";
    if (e.row.kind === "decision") return " [x clear]";
    return e.row.kind === "proposal" ? proposalOps(e.row).map(op => op === "apply" ? " [A apply]" : op === "resolve" ? " [r resolve]" : " [X dismiss]").join("") : "";
  }
  render(w: number, h: number, focused: boolean): PaneView {
    this.width = w;
    const entries = this.entries();
    if (!entries.length) return { lines: ["Nothing is waiting on you."] };
    this.at = Math.min(Math.max(0, this.at), entries.length - 1);
    this.painted = [];
    let group = "";
    entries.forEach((e, n) => {
      const next = e.kind === "ask" ? ({ decision: "decisions", proposal: "proposals", call: "calls" }[e.row.kind]) : e.kind === "held" ? "held requests" : "programs";
      if (next !== group) { this.painted.push(next); group = next; }
      this.painted.push(n);
    });
    const selected = this.painted.indexOf(this.at);
    this.view.place(selected, this.painted.length, h, [selected - 1, selected]);
    return { lines: this.painted.slice(this.view.top, this.view.top + h).map(p => {
      if (typeof p === "string") return fg(C.yellow) + pad(p, w) + RESET;
      const e = entries[p]!;
      let text: string;
      if (e.kind === "ask") text = ` ${e.row.title} · ${e.row.reason} · ${e.row.by}`;
      else if (e.kind === "held") text = ` ‼ @${e.row.agent} · ${e.row.title} · ${e.row.why}  ${ago(Date.parse(e.row.at))}`;
      else {
        const r = e.row, m = statusMark(r.record);
        const who = r.record.id ? `${r.name}/${r.record.title || r.record.id}` : r.name;
        const what = recordText(r.record);
        text = ` ${m.glyph} ${who} · ${m.word}${what ? ` · ${what}` : ""}  ${ago(r.at)}`;
      }
      const controls = this.controls(e);
      const line = pad(text, Math.max(0, w - controls.length)) + controls;
      if (p === this.at) return selectedRow(line, w, focused);
      if (e.kind === "program") {
        const r = e.row, m = statusMark(r.record), what = recordText(r.record);
        const who = r.record.id ? `${r.name}/${r.record.title || r.record.id}` : r.name;
        return pad(` ${m.sgr}${m.glyph} ${fg(C.lcyan)}${who}${fg(C.dark)} · ${m.sgr}${m.word}${what ? `${fg(C.dark)} · ${fg(C.grey)}${what}` : ""}  ${dim(ago(r.at))}`, w) + RESET;
      }
      return fg(e.kind === "held" ? C.yellow : C.grey) + line + RESET;
    }) };
  }
  private run(desk: DeskApi, action: string, args: Record<string, unknown> = {}) { void desk.press?.(this, WAITING_YOU_ACTIONS, action, args); }
  private openAction(n: number) { const e = this.entries()[n]; return e?.kind === "ask" ? "ask.open" : e?.kind === "held" ? "held.open" : "status.go"; }
  key(k: Key, desk: DeskApi): boolean {
    const entries = this.entries(), e = entries[this.at];
    if (isUp(k)) { this.wheel(-1, desk); return true; }
    if (isDown(k)) { this.wheel(1, desk); return true; }
    if (!e) return false;
    const args = { n: this.at + 1 };
    if (k.kind === "enter" || k.kind === "alt-enter") { this.run(desk, this.openAction(this.at), { ...args, ...(e.kind !== "program" && k.kind === "alt-enter" ? { fresh: true } : {}) }); return true; }
    if (ch(k) === "r" && e.kind === "held") { this.run(desk, "held.send", args); return true; }
    if (ch(k) === "x" && e.kind === "program") { this.run(desk, "status.seen", args); return true; }
    if (e.kind === "ask") {
      if (ch(k) === "x" && e.row.kind === "decision") { this.run(desk, "ask.clear", args); return true; }
      if ((ch(k) === "A" || ch(k) === "X" || ch(k) === "r") && e.row.kind === "proposal") { this.run(desk, "ask.proposal", { ...args, op: ch(k) === "A" ? "apply" : ch(k) === "r" ? "resolve" : "dismiss" }); return true; }
    }
    return false;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.wheel(k.action === "wheel-up" ? -1 : 1, desk); return true; }
    if (k.action !== "down") return true;
    const n = this.painted[this.view.top + y];
    if (typeof n !== "number") return true;
    const e = this.entries()[n];
    if (e?.kind === "ask" && e.row.kind === "decision" && x >= this.width - 10) { this.run(desk, "ask.clear", { n: n + 1 }); return true; }
    if (e?.kind === "held" && x >= this.width - SEND.length) { this.run(desk, "held.send", { n: n + 1 }); return true; }
    if (e?.kind === "ask" && e.row.kind === "proposal" && x >= this.width - this.controls(e).length) {
      let end = this.width;
      for (const op of [...proposalOps(e.row)].reverse()) {
        end -= op === "apply" ? " [A apply]".length : op === "resolve" ? " [r resolve]".length : " [X dismiss]".length;
        if (x >= end) { this.run(desk, "ask.proposal", { n: n + 1, op }); break; }
      }
      return true;
    }
    const gesture = this.view.press(n, pressOn(k, press, n === this.at));
    if (gesture === "select") this.run(desk, "status.pick", { n: n + 1 });
    else this.run(desk, this.openAction(n), { n: n + 1, ...(e?.kind !== "program" && gesture === "fresh" ? { fresh: true } : {}) });
    return true;
  }
  wheel(dir: 1 | -1, desk: DeskApi) { const n = this.at + dir; if (n >= 0 && n < this.entries().length) this.run(desk, "status.pick", { n: n + 1 }); }
  describe() { return this.entries().map((e, i) => e.kind === "program" ? rowFacts(e.row, i + 1) : e.kind === "held" ? heldFacts(e.row, i + 1) : { n: i + 1, ...e.row }); }
}

function rowOf(list: WaitingYouPane, a: { n?: number; tile?: string }): { row: WaitingRow; n: number } {
  const entries = list.entries();
  const i = a.tile === undefined ? (a.n ?? list.at + 1) - 1 : entries.findIndex(e => e.kind === "program" && (e.row.tile === a.tile || e.row.name === a.tile));
  const e = entries[i];
  if (!e || e.kind !== "program") throw new ActionRefused("pick a program row from peek");
  return { row: e.row, n: i + 1 };
}
function heldOf(list: WaitingYouPane, a: { n?: number; id?: string }): HeldAsk {
  const e = list.entries()[(a.n ?? list.at + 1) - 1];
  const ask = a.id !== undefined ? list.held().find(r => r.blockId.startsWith(a.id!)) : e?.kind === "held" ? e.row : undefined;
  if (!ask) throw new ActionRefused("pick a held request from peek");
  return ask;
}
function askOf(list: WaitingYouPane, n?: number): WaitingAsk {
  const e = list.entries()[(n ?? list.at + 1) - 1];
  if (!e || e.kind !== "ask") throw new ActionRefused("pick an outline ask from peek");
  return e.row;
}
async function askNote(desk: DeskApi, ask: WaitingAsk, actor: Actor) {
  const m = await desk.ctx.board.get(ask.block);
  if (!m) throw new ActionRefused("that note is gone");
  markReveal(m, { at: ask.at, label: ask.label, says: "waiting on you" }, actor);
  return m;
}

const which = {
  n: { type: "number", optional: true, about: "its place in the list, from 1 (peek lists them)" },
  tile: { type: "string", optional: true, kind: "tile", about: "the terminal tile's id or name, instead of n" },
} as const;

/** The list's actions: the keys, a click and `act` call the same code. */
export const WAITING_YOU_ACTIONS = actionSet<KindHost>()("waiting-you", {
  "status.pick": def({
    summary: "pick a row of the waiting-on-you list (n from 1, or tile=<the terminal's id or name>)",
    keys: [{ keys: "j k ↑ ↓", does: "pick a row" }, { keys: "wheel", does: "pick a row" }, { keys: "click", does: "on a row" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's row (peek lists the rows)",
    args: which,
    examples: [
      { act: "status.pick n=1", does: "selects the first row waiting on you in the list" },
    ],
    async run(a, { pane, desk }, actor) {
      const w = pane as WaitingYouPane;
      const n = a.tile === undefined ? a.n ?? w.at + 1 : rowOf(w, a).n;
      const e = w.entries()[n - 1];
      if (!e) throw new ActionRefused("pick a row from peek");
      w.at = n - 1;
      const m = e.kind === "ask" ? await askNote(desk, e.row, actor) : e.kind === "held" ? await desk.ctx.board.get(e.row.blockId) : null;
      if (m && w.at === n - 1) desk.showFrom?.(w, m, actor);
      desk.redraw();
      return { n };
    },
  }),
  "status.go": def({
    summary: "go to the terminal tile a row of the waiting-on-you list is about (n from 1, or tile=): on the screen, the drawer put away and the keys given to it; in the drawer, its tab shown and the keys in it. Its done and failed records go once the person is in it. The person's only: going takes their keys",
    keys: "⏎, alt+⏎, a double click on a row",
    touches: "screen", replay: "ask",
    person: "going to a tile takes the person's keys; an agent reads the rows (peek) and types with tile.type",
    args: which,
    examples: [
      { act: "status.go n=1", does: "takes the person to the first waiting terminal, keys in it" },
    ],
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
    summary: "open the note a held request is in (n: its row in the list, as peek numbers it, or id=<the note's id>; left out, the selected row): where the waiting list's opens go. The request is not sent (held.send does that); the person's keys stay where they are for an agent",
    keys: "⏎, alt+⏎, a double click or alt-click on a held row",
    touches: "nothing", replay: "safe", says: r => `opened ${r.title}`,
    args: { n: { type: "number", optional: true, about: "its row in the list, from 1, as peek lists them" }, id: { type: "string", optional: true, about: "the note's id, instead of n" }, fresh: { type: "boolean", optional: true, about: "use the alt wire, as alt+Enter does" } },
    examples: [
      { act: "held.open n=2", does: "opens the note the second held request is in, where the list's opens go" },
      { act: "held.open id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens that note, the request still held" },
    ],
    async run(a, { pane, desk }, actor) {
      const w = pane as WaitingYouPane, ask = heldOf(w, a);
      const m = await desk.ctx.board.get(ask.blockId);
      if (!m) throw new ActionRefused("that note is gone");
      await desk.setCurrent(m, { from: w, link: true, fresh: a.fresh, by: actor });
      return { n: w.asks().length + w.held().indexOf(ask) + 1, id: ask.blockId, title: ask.title };
    },
  }),
  "held.send": def({
    summary: "send a held request (n: its row in the list, as peek numbers it, or id=<the note's id>; left out, the selected row): ask its agent now, as the person who pressed r (the line's own `r`). An agent's is refused: a held request waits for a person",
    keys: "r, a click on a held row's [r send]",
    touches: "nothing", replay: "ask", says: r => `asked @${r.agent} (${r.title})`,
    person: "a request an agent or an extension wrote waits for a person's r: an agent's is refused, as the line's own r is",
    args: { n: { type: "number", optional: true, about: "its row in the list, from 1, as peek lists them" }, id: { type: "string", optional: true, about: "the note's id, instead of n" } },
    examples: [
      { act: "held.send n=1", does: "sends the first held request: its agent is asked now" },
    ],
    async run(a, { pane, desk }, actor) {
      if (actor.kind === "agent") throw new ActionRefused("a held request waits for a person's r: an agent can't send it");
      const ask = heldOf(pane as WaitingYouPane, a);
      await desk.ctx.board.refreshProjections(ask.blockId, ask.line >= 0 ? ask.line : undefined, actor);
      return { id: ask.blockId, title: ask.title, agent: ask.agent };
    },
  }),
  "ask.open": def({
    summary: "open an outline ask where this tile's opens land", keys: "⏎ alt+⏎ double click",
    touches: "nothing", replay: "safe",
    args: { n: { type: "number", optional: true, about: "row number from peek" }, fresh: { type: "boolean", optional: true, about: "use the alt wire" } },
    examples: [{ act: "ask.open n=1", does: "opens the first outline ask where this tile opens notes" }],
    async run(a, { pane, desk }, actor) {
      const w = pane as WaitingYouPane, ask = askOf(w, a.n);
      const m = await askNote(desk, ask, actor);
      await desk.setCurrent(m, { from: w, link: true, fresh: a.fresh, by: actor });
      return { id: m.id };
    },
  }),
  "ask.clear": def({
    summary: "clear a decision and leave a note saying cleared by you", keys: "x",
    touches: "nothing", replay: "ask", person: "only the person clears their decision; answer the note as an agent",
    args: { n: { type: "number", optional: true, about: "row number from peek" } },
    examples: [{ act: "ask.clear n=1", does: "clears the first decision and comments cleared by you" }],
    async run(a, { pane, desk }, actor) {
      const ask = askOf(pane as WaitingYouPane, a.n);
      if (ask.kind !== "decision") throw new ActionRefused("x clears a decision; tick a call in its note");
      const board = desk.ctx.board, props = await board.propertyTokens(ask.block, "needs");
      const operations = props.tokens.filter(p => /^sysop(?:\s*:|$)/i.test(p.value)).map(p => ({ op: "remove" as const, ordinal: p.ordinal }));
      const m = await board.patchProperties(ask.block, ask.revision, operations, actor);
      await board.comment(crypto.randomUUID(), m.id, m.revision!, "cleared by you", null, actor);
      return { id: m.id };
    },
  }),
  "ask.proposal": def({
    summary: "apply, resolve or dismiss an open proposal", keys: [{ keys: "A", does: "apply" }, { keys: "r", does: "resolve" }, { keys: "X", does: "dismiss" }, { via: "row controls" }],
    touches: "nothing", replay: "ask",
    args: { n: { type: "number", optional: true, about: "row number from peek" }, op: { type: "string", about: "apply, resolve or dismiss" } },
    examples: [
      { act: "ask.proposal n=2 op=apply", does: "applies the proposal in the second row" },
      { act: "ask.proposal n=2 op=dismiss", does: "dismisses the proposal in the second row" },
    ],
    async run(a, { pane, desk }, actor) {
      const ask = askOf(pane as WaitingYouPane, a.n);
      if (ask.kind !== "proposal") throw new ActionRefused("pick a proposal row");
      const m = await askNote(desk, ask, actor);
      if (a.op !== "apply" && a.op !== "dismiss" && a.op !== "resolve") throw new ActionRefused("op is apply, resolve or dismiss");
      if (!proposalOps(m).includes(a.op)) throw new ActionRefused("the passage is gone; dismiss this proposal");
      return a.op === "resolve" ? PROPOSAL_ACTIONS.run("proposal.resolve", { block: m.id }, { host: { ctx: desk.ctx, redraw: () => desk.redraw() } }, actor) : a.op === "apply" ? desk.ctx.board.applyProposal(m.id, actor) : desk.ctx.board.dismissProposal(m.id, actor);
    },
  }),
  "status.seen": def({
    summary: "mark a terminal's finished work seen (n from 1, or tile=): its done and failed records go from the list, its header and the chip. Its blocked ones stay: only answering the program clears those",
    keys: "x",
    touches: "screen", replay: "ask", says: r => `marked ${r.name} seen`,
    // Seen is the person's: an agent reading or acting on a tile never clears what they haven't seen (peek and subscribe don't either).
    person: "seen is the person's: an agent never clears a done they haven't seen (it reads the rows with status.list or peek)",
    args: which,
    examples: [
      { act: "status.seen n=1", does: "clears the first terminal's done and failed records from the list" },
    ],
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
  kind: WAITING_YOU_KIND_NAME, previews: true, opensOnScreen: true, about: "decisions, proposals, calls, held requests and programs waiting on you", noun: "the waiting-on-you list",
  make: () => new WaitingYouPane(), actions: WAITING_YOU_ACTIONS,
  peek: p => ({ waitingOnYou: (p as WaitingYouPane).describe() }),
  describe: p => ({ rows: (p as WaitingYouPane).describe() }),
};
