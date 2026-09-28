// Waiting on others: every outbox item still waiting for an answer (`type::outbox-item outbox::waiting`),
// grouped by who it waits on, the longest wait first. Selecting one shows it in the reader beside.
//
// An outbox item names who it waits on in `waiting-on` ("Felipe: does QA have staging CMS logins?"); the
// name before the colon is the group, the rest is the question. `sent` ("2026-09-25 4:23 PM", local
// time) is when the wait began; an item without it waits from when it was written.
//
// Built on the desk (a preset, as the brief is): the reader, its sessions, the mouse and `act` are the desk's.
import { subject, type Msg } from "../board";
import type { SocketBoard } from "../socket";
import { bg, C, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { Desk } from "../desk/desk";
import { pair } from "../desk/layout";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";

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

/** Grouped by who, each group oldest first, the group waited on longest first. */
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

type Row = { head: WaitGroup } | { item: Msg };
const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");

/** The list: a header per person, a row per item (how long, the ticket, the question). */
export class WaitingPane implements Pane {
  readonly kind = "exhibit";
  items: Msg[] | null = null;
  problem = "";
  private rows: Row[] = [];
  private sel = 0;
  private top = 0;
  private reload: Timer | null = null;

  title() {
    if (!this.items) return "waiting on others · asking the outline…";
    const people = new Set(this.items.map(m => waitingOn(m).who.toLowerCase())).size;
    if (!this.items.length) return "waiting on others · none";
    return `outbox · ${this.items.length} waiting on ${people} ${people === 1 ? "person" : "people"}`;
  }
  hint() { return "j k pick · ⏎ read · r reload"; }
  init(desk: DeskApi) { void this.load(desk); }

  async load(desk: DeskApi) {
    const was = this.selected()?.id;
    try {
      this.items = await findWaiting(desk.ctx.board);
      this.problem = "";
    } catch (e) {
      this.problem = `couldn't ask the outline what's waiting: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.rows = groupWaiting(this.items ?? []).flatMap((g): Row[] => [{ head: g }, ...g.items.map(item => ({ item }))]);
    const at = was ? this.rows.findIndex(r => "item" in r && r.item.id === was) : -1;
    this.sel = at >= 0 ? at : this.firstItem(0, 1);
    const m = this.selected();
    if (m && m.id !== desk.current?.id) desk.setCurrent(m, { from: this });
    desk.redraw();
  }

  /** The item selected, if any. */
  selected(): Msg | null { const r = this.rows[this.sel]; return r && "item" in r ? r.item : null; }

  /** The nearest item row from `i` going `dir`, or `i` when there is none that way. */
  private firstItem(i: number, dir: 1 | -1): number {
    for (let j = i; j >= 0 && j < this.rows.length; j += dir) if ("item" in this.rows[j]!) return j;
    return this.rows.some(r => "item" in r) ? this.sel : 0;
  }

  private move(dir: 1 | -1, desk: DeskApi) {
    const to = this.firstItem(this.sel + dir, dir);
    if (to === this.sel || !("item" in (this.rows[to] ?? {}))) return;
    this.sel = to;
    desk.setCurrent(this.selected(), { from: this });
  }

  onEvent(desk: DeskApi) {
    // Any change may start or end a wait (an item filed, marked done, trashed); one read per burst.
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 400);
  }

  render(w: number, h: number, focused: boolean): PaneView {
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.items) return { lines: [fg(C.dark) + "asking the outline…" + RESET] };
    if (!this.items.length) return {
      lines: [fg(C.white) + "Nobody owes you an answer." + RESET, "", fg(C.grey) + pad("An outbox item waits while it has [type::outbox-item] [outbox::waiting].", w) + RESET],
    };
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + h) this.top = this.sel - h + 1;
    // The group header above the selection stays in view when the list scrolls to it.
    if (this.top > 0 && this.top === this.sel && "head" in (this.rows[this.sel - 1] ?? {})) this.top--;
    const tw = Math.min(10, Math.max(0, ...this.items.map(m => (m.props.ticket ?? "").length)));
    return {
      lines: this.rows.slice(this.top, this.top + h).map((r, i) => {
        if ("head" in r) {
          const n = r.head.items.length;
          return pad(`${fg(C.yellow)}${r.head.who}${fg(C.dark)} · ${n} waiting · longest ${ago(r.head.since)}`, w) + RESET;
        }
        const m = r.item, age = ago(sentAt(m)).padStart(4), ticket = (m.props.ticket ?? "").padEnd(tw), what = waitingOn(m).what;
        if (this.top + i === this.sel) return (focused ? bg(C.blue) : "\x1b[48;2;22;30;58m") + fg(C.white) + pad(` ${age} ${ticket} ${what}`, w) + RESET;
        const old = Date.now() - sentAt(m) > 3 * 86_400_000;
        return pad(` ${fg(old ? C.lred : C.brown)}${age} ${fg(C.lcyan)}${ticket} ${fg(C.grey)}${what}`, w) + RESET;
      }),
    };
  }

  key(k: Key, desk: DeskApi): boolean {
    if (k.kind === "up" || ch(k) === "k") { this.move(-1, desk); desk.redraw(); return true; }
    if (k.kind === "down" || ch(k) === "j") { this.move(1, desk); desk.redraw(); return true; }
    if (k.kind === "enter" && this.selected()) { desk.setCurrent(this.selected(), { from: this }); desk.focusKind("reader"); return true; }
    if (ch(k) === "r") { void this.load(desk); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const at = this.top + y;
    if (!("item" in (this.rows[at] ?? {}))) return;
    this.sel = at;
    desk.setCurrent(this.selected(), { from: this });
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.move(dir, desk); desk.redraw(); }

  describe() {
    return groupWaiting(this.items ?? []).map(g => ({
      who: g.who, items: g.items.map(m => ({ id: m.id, title: subject(m), ticket: m.props.ticket ?? null, waitingFor: waitingOn(m).what, sent: new Date(sentAt(m)).toISOString(), link: m.props.link ?? null })),
    }));
  }
}

export class Waiting extends Desk {
  readonly list: WaitingPane;
  constructor() {
    const list = new WaitingPane();
    super({ title: "waiting on others", panes: [list, new ReaderPane(true)], layout: ([l, r]) => pair("row", 0.5, { t: "leaf", id: l! }, { t: "leaf", id: r! }) });
    this.list = list;
  }
  override describe() {
    return { ...super.describe(), kind: "waiting", waiting: this.list.items ? this.list.describe() : null, problem: this.list.problem || undefined };
  }
}
