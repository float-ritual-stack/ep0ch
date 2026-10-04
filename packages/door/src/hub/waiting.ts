// Waiting on others: every outbox item still waiting for an answer (`type::outbox-item outbox::waiting`),
// grouped by who it waits on, the longest wait first. Picking one shows it in the reader beside.
//
// An outbox item names who it waits on in `waiting-on` ("Ada: which shelf do the jars go on?"); the
// name before the colon is the group, the rest is the question. `sent` ("2026-01-05 4:23 PM", local
// time) is when the wait began; an item without it waits from when it was written.
//
// A screen spec on the desk (PIE-515: `waitingSpec`): the list is a tile of its own kind (`waiting`, WAITING_KIND),
// beside a reader that follows what it picks; the reader, its sessions, the mouse and `act` are the desk's. Picking
// an item is the list kind's action (WAITING_ACTIONS): the keys, a click and `act` call the same code.
import { subject, type Msg } from "../board";
import { type Actor, type SocketBoard } from "../socket";
import { C, fg, pad, RESET, selected } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago } from "../text";
import { newNoteOffer } from "../new-note";
import { ActionRefused, actionSet, def, type ActRequest } from "../surface/actions";
import type { DeskApi, Pane, PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import type { KindHost, TileKind } from "../desk/tile-kinds";
import { RowView } from "../scroll";

export const WAITING_QUERY = "type=outbox-item outbox=waiting";
const WAITING_LIMIT = 500;

/** When the wait began: `sent` read as local time, or when the item was written. */
export function sentAt(m: Msg): number {
  const s = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i.exec(m.props.sent?.trim() ?? "");
  if (!s) return m.createdAt;
  let h = Number(s[4] ?? 0);
  const pm = s[6]?.toLowerCase();
  if (pm === "pm" && h < 12) h += 12;
  if (pm === "am" && h === 12) h = 0;
  return new Date(Number(s[1]), Number(s[2]) - 1, Number(s[3]), h, Number(s[5] ?? 0)).getTime();
}

/** Who it waits on and what it waits for: `waiting-on`'s "Name: question", else `to` and the item's title. */
export function waitingOn(m: Msg): { who: string; what: string } {
  const w = m.props["waiting-on"]?.trim() ?? "";
  const i = w.indexOf(":");
  if (i > 0 && i < 40) return { who: w.slice(0, i).trim(), what: w.slice(i + 1).trim() || subject(m) };
  return { who: m.props.to?.trim() || "someone", what: w || subject(m) };
}

export interface WaitGroup { who: string; items: Msg[]; since: number }

/** Grouped by who (any case), each group oldest first, the group waited on longest first. */
export function groupWaiting(list: readonly Msg[]): WaitGroup[] {
  const groups = new Map<string, WaitGroup>();
  for (const m of [...list].sort((a, b) => sentAt(a) - sentAt(b))) {
    const who = waitingOn(m).who;
    const g = groups.get(who.toLowerCase()) ?? { who, items: [], since: sentAt(m) };
    g.items.push(m);
    groups.set(who.toLowerCase(), g);
  }
  return [...groups.values()].sort((a, b) => a.since - b.since);
}

export async function findWaiting(board: SocketBoard): Promise<Msg[]> {
  return board.query(WAITING_QUERY, WAITING_LIMIT, "updated", "desc", true);
}

type Row = { head: WaitGroup } | { item: Msg; n: number };

/** What `waiting.pick` answers: the item shown, and its place in the list (1 is the longest wait). */
export type Picked = { n: number; of: number; id: string; who: string; title: string };

/** The list: a header per person, a row per item (how long, the ticket, the question). */
export class WaitingPane implements Pane {
  readonly kind = "waiting";
  items: Msg[] | null = null;
  problem = "";
  private rows: Row[] = [];
  /** The item picked, by its place in list order (0 is the longest wait), or -1. */
  at = -1;
  private view = new RowView();
  private reload: Timer | null = null;

  title() {
    if (!this.items) return "waiting on others · asking the outline…";
    if (!this.items.length) return "waiting on others · none";
    const people = new Set(this.items.map(m => waitingOn(m).who.toLowerCase())).size;
    return `outbox · ${this.items.length} waiting on ${people} ${people === 1 ? "person" : "people"}`;
  }
  hint() { return "j k pick · ⏎ read · r reload"; }
  init(desk: DeskApi) { void this.load(desk); }

  /** The items in list order: by group, longest wait first. */
  ordered(): Msg[] { return this.rows.flatMap(r => ("item" in r ? [r.item] : [])); }

  /** Read the list again; the item picked stays picked, or the longest wait when it's gone or first read. */
  async load(desk: DeskApi) {
    const was = this.ordered()[this.at]?.id;
    try {
      this.items = await findWaiting(desk.ctx.board);
      this.problem = "";
    } catch (e) {
      this.problem = `couldn't ask the outline what's waiting: ${e instanceof Error ? e.message : String(e)}`;
    }
    let n = 0;
    this.rows = groupWaiting(this.items ?? []).flatMap((g): Row[] => [{ head: g }, ...g.items.map(item => ({ item, n: n++ }))]);
    const list = this.ordered();
    const keep = was ? list.findIndex(m => m.id === was) : -1;
    this.at = keep >= 0 ? keep : list.length ? 0 : -1;
    const m = list[this.at];
    if (m && m.id !== desk.current?.id) desk.setCurrent(m, { from: this });
    desk.redraw();
  }

  onEvent(desk: DeskApi) {
    // Any change may start or end a wait (an item filed, marked done, trashed); one read per burst.
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 400);
  }

  render(w: number, h: number, focused: boolean): PaneView {
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.items) return { lines: [fg(C.dark) + "asking the outline…" + RESET] };
    if (!this.items.length) {
      const { line, spot } = newNoteOffer(4);
      return { lines: [fg(C.white) + "Nobody owes you an answer." + RESET, "", fg(C.grey) + pad("An outbox item waits while it has [type::outbox-item] [outbox::waiting].", w) + RESET, "", line], spots: [spot] };
    }
    const sel = this.rows.findIndex(r => "item" in r && r.n === this.at);
    // The group header above the picked item comes into view with it.
    this.view.place(sel >= 0 ? sel : null, this.rows.length, h, [sel - ("head" in (this.rows[sel - 1] ?? {}) ? 1 : 0), sel]);
    const tw = Math.min(10, Math.max(0, ...this.items.map(m => (m.props.ticket ?? "").length)));
    return {
      lines: this.rows.slice(this.view.top, this.view.top + h).map(r => {
        if ("head" in r) return pad(`${fg(C.yellow)}${r.head.who}${fg(C.dark)} · ${r.head.items.length} waiting · longest ${ago(r.head.since)}`, w) + RESET;
        const m = r.item, age = ago(sentAt(m)).padStart(4), ticket = (m.props.ticket ?? "").padEnd(tw), what = waitingOn(m).what;
        if (r.n === this.at) return selected(focused) + pad(` ${age} ${ticket} ${what}`, w) + RESET;
        const old = Date.now() - sentAt(m) > 3 * 86_400_000;
        return pad(` ${fg(old ? C.lred : C.brown)}${age} ${fg(C.lcyan)}${ticket} ${fg(C.grey)}${what}`, w) + RESET;
      }),
    };
  }

  /** Run a list action as the person, saying a refusal on screen. */
  private run(desk: DeskApi, req: ActRequest) {
    void desk.press?.(this, WAITING_ACTIONS, req.action, { ...(req.args ?? {}) });
  }

  key(k: Key, desk: DeskApi): boolean {
    if (isUp(k)) { if (this.at > 0) this.run(desk, { action: "waiting.pick", args: { n: this.at } }); return true; }
    if (isDown(k)) { if (this.at + 1 < this.ordered().length) this.run(desk, { action: "waiting.pick", args: { n: this.at + 2 } }); return true; }
    if (k.kind === "enter" && this.at >= 0) { desk.focusKind("reader"); return true; }
    if (ch(k) === "r") { this.run(desk, { action: "waiting.reload" }); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const r = this.rows[this.view.top + y];
    if (r && "item" in r) this.run(desk, { action: "waiting.pick", args: { n: r.n + 1 } });
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const to = this.at + dir;
    if (to >= 0 && to < this.ordered().length) this.run(desk, { action: "waiting.pick", args: { n: to + 1 } });
  }

  describe() {
    let n = 0;
    return groupWaiting(this.items ?? []).map(g => ({
      who: g.who,
      items: g.items.map(m => ({ n: ++n, id: m.id, title: subject(m), ticket: m.props.ticket ?? null, waitingFor: waitingOn(m).what, sent: new Date(sentAt(m)).toISOString(), link: m.props.link ?? null })),
    }));
  }
}

/** Show the item at `n` (1 is the longest wait) or with `id`, as `actor`; an agent's is said on screen. */
function pick(list: WaitingPane, desk: DeskApi, which: { n?: number; id?: string }, actor: Actor): Picked {
  const items = list.ordered();
  if (!list.items) throw new ActionRefused("the waiting items are still being read");
  if (!items.length) throw new ActionRefused("nothing is waiting");
  const i = which.id !== undefined ? items.findIndex(m => m.id === which.id) : (which.n ?? 0) - 1;
  if (i < 0 || i >= items.length) throw new ActionRefused(which.id !== undefined ? `no waiting item ${which.id}` : `pick 1 to ${items.length}`);
  const m = items[i]!;
  list.at = i;
  desk.setCurrent(m, { from: list, by: actor });
  return { n: i + 1, of: items.length, id: m.id, who: waitingOn(m).who, title: subject(m) };
}

/** Which waiting item is shown, and reading the list again. The keys, a click and `act` call the same code. */
export const WAITING_ACTIONS = actionSet<KindHost>()("waiting", {
  "waiting.pick": def({
    summary: "show a waiting item in the reader: n (1 is the longest wait, as describe lists them) or id; refused to an agent while the person is typing here", keys: "j k ↑ ↓ click",
    touches: "screen", replay: "safe", says: r => `showed what ${r.who} owes (${r.n} of ${r.of})`,
    args: { n: { type: "number", about: "its place in the list, from 1", optional: true }, id: { type: "string", about: "the item's block id", optional: true } },
    run(a, { pane, desk }, actor) {
      if ((a.n === undefined) === (a.id === undefined)) throw new ActionRefused("waiting.pick takes n or id, one of them");
      return pick(pane as WaitingPane, desk, a, actor);
    },
  }),
  "waiting.reload": def({
    summary: "ask the outline again what's waiting (it also does when the outline changes)", keys: "r",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { pane, desk }) { const w = pane as WaitingPane; await w.load(desk); return { waiting: w.items?.length ?? 0 }; },
  }),
});

/** The waiting list as a tile kind: the list, its actions, and what `peek` says about it. */
export const WAITING_KIND: TileKind = {
  kind: "waiting", about: "the outbox items still waiting for an answer, by who they wait on", noun: "the waiting list",
  make: () => new WaitingPane(), actions: WAITING_ACTIONS,
  peek: p => { const w = p as WaitingPane; return { picked: w.at >= 0 ? w.at + 1 : null, waiting: w.items ? w.describe() : null, problem: w.problem || undefined }; },
};

/** Waiting on others: the list beside a reader that follows what it picks. */
export function waitingSpec(): ScreenSpec {
  return {
    name: "waiting", title: "waiting on others",
    layout: { focus: "waiting", root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "waiting", name: "waiting" }, b: { t: "leaf", kind: "reader", name: "reader" } } },
  };
}
