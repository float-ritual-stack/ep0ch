// What changed (PIE-647): the notes others changed since the person last looked, from the service's change feed (the
// live events carry its records; `changes.since` seeds them after a restart). No second log: this is a per-person
// reading of the feed. `WhatChanged` keeps one row per note (its latest change, with whether it was ever created
// here), counted apart from the person's own edits; the status bar's `+N new` is its unseen count.
//
// Seen is the person's. Opening the list as the person marks what it holds seen (and the position is kept per
// outline in the state dir, so a restart resumes from it); an agent's open, read or action never clears it.
//
// A tile kind (`what-changed`), so it's a tile like any other; `changes.open` (alt+o, a click on `+N new`) opens it as
// a tab in the drawer, as the waiting-on-you list opens (src/desk/waiting-you.ts). Its rows are the kind's actions
// (WHAT_CHANGED_ACTIONS): j k pick, ⏎ or a click opens the note where opens land, alt+⏎ (or an alt-click) in a new
// detail, d shows the change itself (the note's earlier text, block.revisions, against what it became).
import { subject } from "../board";
import { C, dim, fg, pad, RESET, selected } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ago } from "../text";
import { RowView } from "../scroll";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { diffRows } from "../unsent";
import { readState, writeState } from "../state";
import type { Actor, Change, OutlineEvent, SocketBoard } from "../socket";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import type { RowPress } from "../scroll";

export const WHAT_CHANGED_KIND_NAME = "what-changed";
const SEEN_FILE = "changes-seen.json";
/** How many notes the list keeps (the newest). */
const KEEP = 200;

/** One note as the list has it: its latest change, and whether anyone has looked since. */
export interface ChangedRow {
  blockId: string;
  /** The latest change's words: created, edited, moved, trashed, restored, commented, property set, reordered, changed. */
  kind: string;
  /** Made here in the span (so a later edit still reads as new). */
  created: boolean;
  /** Who: an agent's or extension's id, or the author (`system`). */
  who: string;
  agent: boolean;
  ext: boolean;
  at: number;
  sequence: number;
  /** The revision the change produced, when the record has one. */
  revision?: number;
  seen: boolean;
  title?: string;
  /** The note's work id and page name, read with its title: a list matches a query by them, and shows the work id. */
  workId?: string;
  page?: string;
  /** The title shown is the one before this change: read it again (a rename). */
  retitle?: boolean;
}

const KIND_WORDS: Record<Change["kind"], string> = { create: "created", edit: "edited", move: "moved", delete: "trashed", restore: "restored", purge: "purged", annotate: "commented", draft: "draft", reorder: "reordered", other: "changed" };
/** What a change record says it was, in the list's words. */
export function kindWord(c: Change): string {
  if (c.kind === "edit" && /propert/i.test(c.action)) return "property set";
  return KIND_WORDS[c.kind] ?? "changed";
}

/** Whether a change is the person's own: their edits are never news to them. */
export const isOwn = (c: Change) => (c.actor?.author ?? "user") === "user" && !c.actor?.actorId?.startsWith("ext:");

export class WhatChanged {
  private readonly rows = new Map<string, ChangedRow>();
  /** The feed position the person last looked at: changes up to it are seen. */
  seenTo = 0;
  /** Whether extensions' writes count (`changes.extensions`). */
  includeExt = false;
  private onChange: () => void = () => {};
  private ready: Promise<void> = Promise.resolve();
  /** Resolves once the changes since the kept position are read (looking before then would skip them). */
  settled(): Promise<void> { return this.ready; }

  /** The outline it reads (its seen position is kept under this name). */
  outline = "";

  /** Tell `fn` when the rows changed (the status bar and the list redraw). */
  subscribe(fn: () => void) { this.onChange = fn; }

  /**
   * Start from where the person last looked: the changes after that position are read from the feed (`changes.since`).
   * With no position kept (a first run), now is where they last looked.
   */
  seed(board: Pick<SocketBoard, "lastSequence" | "changesSince">): Promise<void> {
    const kept = readState<Record<string, number>>(SEEN_FILE)?.[this.outline];
    if (kept === undefined) { this.seenTo = board.lastSequence; this.save(); return (this.ready = Promise.resolve()); }
    this.seenTo = kept;
    this.ready = (async () => {
      try {
        const page = await board.changesSince(kept);
        if (page.kind === "reset") { this.seenTo = page.sequence; this.save(); return; }
        // Replayed oldest first, so each note ends on its latest.
        for (const c of page.changes) this.add(c);
        this.onChange();
      } catch { /* the feed isn't reachable yet: live events fill the list */ }
    })();
    return this.ready;
  }

  private save() {
    const all = readState<Record<string, number>>(SEEN_FILE) ?? {};
    writeState(SEEN_FILE, { ...all, [this.outline]: this.seenTo });
  }

  private add(c: Change) {
    if (!c.blockId || c.kind === "draft" || c.sequence <= this.seenTo || isOwn(c)) return;
    const prev = this.rows.get(c.blockId);
    if (prev && prev.sequence >= c.sequence) return;
    const id = c.actor?.actorId ?? c.actor?.author ?? "?";
    // An extension refreshing a note an agent changed doesn't hide that change: the unseen row stands.
    if (prev && !prev.seen && !prev.ext && id.startsWith("ext:")) return;
    this.rows.set(c.blockId, {
      blockId: c.blockId, kind: kindWord(c), created: c.kind === "create" || !!prev?.created,
      who: id, agent: c.actor?.author === "agent", ext: id.startsWith("ext:"),
      at: Date.parse(c.recordedAt) || Date.now(), sequence: c.sequence,
      ...(c.revision !== undefined ? { revision: c.revision } : {}), seen: false,
      ...(prev?.title !== undefined ? { title: prev.title, retitle: true } : {}),
    });
    // A note made here and trashed here is no news.
    if (c.kind === "delete" && prev?.created) this.rows.delete(c.blockId);
    // Over the limit the oldest seen note goes first: an unseen one is still news (and counted), up to a far larger bound.
    if (this.rows.size > KEEP) {
      const all = [...this.rows.values()].sort((a, b) => a.sequence - b.sequence);
      const drop = all.find(r => r.seen) ?? (this.rows.size > KEEP * 10 ? all[0] : undefined);
      if (drop) this.rows.delete(drop.blockId);
    }
  }

  /** A live (or replayed) event from the service. A `reset` empties the list: the feed no longer reaches back. */
  heard(e: OutlineEvent) {
    if (e.action === "reset") { this.rows.clear(); this.onChange(); return; }
    if (!e.change) return;
    const before = this.count();
    this.add(e.change);
    if (this.count() !== before) this.onChange();
  }

  /** The ids of the notes not yet seen (taken just before the person's look marks them). */
  unseenIds(): string[] { return this.list().filter(r => !r.seen).map(r => r.blockId); }

  /** The rows shown, newest first (extension writes only when asked for). */
  list(): ChangedRow[] {
    return [...this.rows.values()].filter(r => this.includeExt || !r.ext).sort((a, b) => b.sequence - a.sequence);
  }
  /** How many notes changed since the person looked: the status bar's `+N new`. */
  count(): number { return this.list().filter(r => !r.seen).length; }
  /** Extension writes held back from the count (`+N ext`). */
  extCount(): number { return this.includeExt ? 0 : [...this.rows.values()].filter(r => r.ext && !r.seen).length; }

  /** The person looked: everything held is seen, and the position is kept. Never an agent's. */
  markSeen() {
    let top = this.seenTo;
    // What the list shows: an extension's writes it holds back (`changes.extensions`) stay unseen until they're shown.
    for (const r of this.rows.values()) {
      if (r.ext && !this.includeExt) continue;
      r.seen = true; r.created = false; top = Math.max(top, r.sequence);
    }
    if (top !== this.seenTo) { this.seenTo = top; this.save(); }
    this.onChange();
  }

  /** Titles for rows that have none yet, read from the board (a trashed or purged note reads as gone). */
  async titles(board: Pick<SocketBoard, "get">) {
    const todo = [...this.rows.values()].filter(r => r.title === undefined || r.retitle);
    await Promise.all(todo.map(async r => {
      try { const m = await board.get(r.blockId); r.title = m ? subject(m) : "(gone)"; delete r.retitle;
        if (m?.props["work-id"]) r.workId = m.props["work-id"]; else delete r.workId;
        if (m?.props.page) r.page = m.props.page; else delete r.page; } catch { r.title = "(unreadable)"; }
    }));
    if (todo.length) this.onChange();
  }

  /** A fresh store's rows as peek and `changes.list` give them. */
  facts(): Record<string, unknown>[] {
    return this.list().map((r, i) => rowFacts(r, i + 1));
  }
}

/** A row as `peek` and the actions give it: its place (from 1), the note, who, what and when. */
export function rowFacts(r: ChangedRow, n: number): Record<string, unknown> {
  return { n, id: r.blockId, title: r.title ?? null, ...(r.workId ? { workId: r.workId } : {}), who: r.who, agent: r.agent, kind: r.kind, created: r.created, at: new Date(r.at).toISOString(), seen: r.seen, ...(r.revision !== undefined ? { revision: r.revision } : {}) };
}

/** A change as diff rows: the note's text before it and after, from the revisions the service keeps (block.revisions). */
export async function changeDiff(board: Pick<SocketBoard, "get" | "revisions" | "revisionText">, r: ChangedRow): Promise<string[]> {
  if (r.kind === "trashed" || r.kind === "moved" || r.kind === "reordered") return [`(${r.kind}: no text changed)`];
  const list = await board.revisions(r.blockId);
  const after = r.revision ?? list.revision;
  const earlier = list.revisions.find(x => x.revision < after);
  const text = async (rev: number) => rev === list.revision ? (await board.get(r.blockId))?.text ?? "" : (await board.revisionText(r.blockId, rev)).text;
  if (r.created && !earlier) return (await text(after)).split("\n").map(l => `+ ${l}`);
  if (!earlier) return ["(no earlier text is kept for this note)"];
  return diffRows(await text(earlier.revision), await text(after));
}

const MAX_DIFF = 40;

export class WhatChangedPane implements Pane {
  readonly kind = WHAT_CHANGED_KIND_NAME;
  /** The row picked (0 is the first). */
  at = 0;
  private view = new RowView();
  /** The notes whose change is shown, with its rows (or "…" while it's read). */
  private diffs = new Map<string, string[]>();
  private keyOf(r: ChangedRow) { return `${r.blockId}@${r.revision ?? r.sequence}`; }
  private store: WhatChanged | null = null;
  /** The notes that were unseen when the person opened the list: they keep their mark while it's open, though they're seen now. */
  private fresh = new Set<string>();
  private board: SocketBoard | null = null;

  rows(): ChangedRow[] { return this.store?.list() ?? []; }
  title() { const n = this.store?.count() ?? 0; return n ? `what changed · ${n} new` : "what changed"; }
  hint() { return "j k pick · ⏎ or click opens · alt+⏎ in a new detail · d the change · x seen"; }
  init(desk: DeskApi) {
    const door = desk.ctx as unknown as { whatChanged?: WhatChanged; board: SocketBoard };
    this.store = door.whatChanged ?? null;
    this.board = door.board;
    void this.store?.titles(door.board);
  }

  /** Keep the mark on these notes: they were new when the list was opened. */
  keepFresh(ids: string[]) { for (const id of ids) this.fresh.add(id); }
  isNew(r: ChangedRow) { return !r.seen || this.fresh.has(r.blockId); }

  /** A row's diff, read once (the first look asks the service for the revisions). */
  async diff(r: ChangedRow, desk: DeskApi): Promise<string[]> {
    const had = this.diffs.get(this.keyOf(r));
    if (had) return had;
    this.diffs.set(this.keyOf(r), ["…"]);
    let lines: string[];
    try { lines = await changeDiff(this.board!, r); } catch (e) { lines = [`(${e instanceof Error ? e.message : String(e)})`]; }
    this.diffs.set(this.keyOf(r), lines.slice(0, MAX_DIFF).concat(lines.length > MAX_DIFF ? [`… ${lines.length - MAX_DIFF} more lines`] : []));
    desk.redraw();
    return this.diffs.get(this.keyOf(r))!;
  }
  /** Show or fold a row's diff. */
  fold(r: ChangedRow) { if (this.diffs.has(this.keyOf(r))) this.diffs.delete(this.keyOf(r)); }
  showing(r: ChangedRow) { return this.diffs.has(this.keyOf(r)); }

  private loadingTitles = false;

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows();
    // A note changed since the list was opened: its title is read when it first shows.
    if (this.store && this.board && !this.loadingTitles && rows.some(r => r.title === undefined || r.retitle)) {
      this.loadingTitles = true;
      void this.store.titles(this.board).finally(() => { this.loadingTitles = false; });
    }
    if (!rows.length) {
      return { lines: [fg(C.white) + "Nothing has changed since you looked." + RESET, "", fg(C.grey) + pad("Notes an agent, another client or an extension changes show here, newest first, and the status bar counts the ones you haven't seen.", w) + RESET] };
    }
    this.at = Math.min(Math.max(0, this.at), rows.length - 1);
    // One display line per row, then its diff lines: the view is placed in display lines.
    const lines: { text: string; row: number }[] = [];
    rows.forEach((r, n) => {
      const isNew = this.isNew(r), mark = isNew ? "●" : " ", title = r.title ?? "…", age = ago(r.at).padStart(4);
      const tag = r.ext ? "ext" : r.agent ? "agent" : "";
      const who = `${r.who}${tag && !r.who.startsWith(tag) ? ` (${tag})` : ""}`;
      if (n === this.at) lines.push({ row: n, text: selected(focused) + pad(` ${mark} ${title} · ${who} · ${r.kind}  ${age}`, w) + RESET });
      else lines.push({ row: n, text: pad(` ${isNew ? fg(C.yellow) + mark : dim(mark)} ${fg(C.lcyan)}${title}${fg(C.dark)} · ${r.agent ? fg(C.lmagenta) : fg(C.grey)}${who}${fg(C.dark)} · ${fg(C.grey)}${r.kind}  ${dim(age)}`, w) + RESET });
      for (const d of this.diffs.get(this.keyOf(r)) ?? []) {
        const sgr = d.startsWith("+") ? fg(C.lgreen) : d.startsWith("-") ? fg(C.lred) : fg(C.grey);
        lines.push({ row: n, text: pad(`    ${sgr}${d}`, w) + RESET });
      }
    });
    const first = lines.findIndex(l => l.row === this.at), last = lines.findLastIndex(l => l.row === this.at);
    this.view.place(first, lines.length, h, [first, last]);
    return { lines: lines.slice(this.view.top, this.view.top + h).map(l => l.text) };
  }

  /** Run one of its actions as the person, a refusal said on screen. */
  private run(desk: DeskApi, action: string, args: Record<string, unknown> = {}) { void desk.press?.(this, WHAT_CHANGED_ACTIONS, action, args); }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows().length;
    if (isUp(k)) { if (this.at > 0) this.run(desk, "changes.pick", { n: this.at }); return true; }
    if (isDown(k)) { if (this.at + 1 < n) this.run(desk, "changes.pick", { n: this.at + 2 }); return true; }
    if (k.kind === "enter" && n) { this.run(desk, "changes.go", { n: this.at + 1 }); return true; }
    if (k.kind === "alt-enter" && n) { this.run(desk, "changes.go", { n: this.at + 1, fresh: true }); return true; }
    if (ch(k) === "d" && n) { this.run(desk, "changes.diff", { n: this.at + 1 }); return true; }
    if (ch(k) === "x" && n) { this.run(desk, "changes.seen"); return true; }
    return false;
  }

  /** The row at screen line `y`: a diff line belongs to its row. */
  private rowAt(y: number): number {
    const rows = this.rows();
    let line = 0;
    for (let n = 0; n < rows.length; n++) {
      const size = 1 + (this.diffs.get(this.keyOf(rows[n]!))?.length ?? 0);
      if (y + this.view.top < line + size) return n;
      line += size;
    }
    return -1;
  }

  /** A press as the keys escalate: select, a double click opens (⏎), an alt-, ctrl- or middle-click opens in a new detail (alt+⏎). */
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, desk); return true; }
    if (k.action !== "down") return true;
    const n = this.rowAt(y);
    if (n < 0) return true;
    const gesture = this.view.press(n, press ?? { mods: k.mods ?? 0, button: k.button });
    if (gesture === "open") this.run(desk, "changes.go", { n: n + 1 });
    else if (gesture === "fresh") this.run(desk, "changes.go", { n: n + 1, fresh: true });
    else if (n !== this.at) this.run(desk, "changes.pick", { n: n + 1 });
    return true;
  }

  describe() { return this.rows().map((r, i) => ({ ...rowFacts(r, i + 1), diff: this.diffs.get(this.keyOf(r)) ?? null })); }
}

/** The row at `n` (from 1), or the one for the note `id`; refused with what there is. */
function rowOf(list: WhatChangedPane, a: { n?: number; id?: string }): { row: ChangedRow; n: number } {
  const rows = list.rows();
  if (!rows.length) throw new ActionRefused("nothing has changed since the person looked");
  const i = a.id !== undefined ? rows.findIndex(r => r.blockId.startsWith(a.id!)) : (a.n ?? list.at + 1) - 1;
  if (i < 0 || i >= rows.length) throw new ActionRefused(a.id !== undefined ? `no change to ${a.id} is listed` : `pick 1 to ${rows.length}`);
  return { row: rows[i]!, n: i + 1 };
}

const which = {
  n: { type: "number", optional: true, about: "its place in the list, from 1 (peek lists them)" },
  id: { type: "string", optional: true, about: "the note's id (or its start), instead of n" },
} as const;

/** The list's actions: the keys, a click and `act` call the same code. */
export const WHAT_CHANGED_ACTIONS = actionSet<KindHost>()("what-changed", {
  "changes.pick": def({
    summary: "pick a row of the what-changed list (n from 1, or id=<the note's id>)",
    keys: "j k ↑ ↓, the wheel, a click",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's row (peek lists the rows)",
    args: which,
    run(a, { pane, desk }) { const w = pane as WhatChangedPane, { row, n } = rowOf(w, a); w.at = n - 1; desk.redraw(); return { n, id: row.blockId }; },
  }),
  "changes.go": def({
    summary: "open the note a row of the what-changed list is about (n from 1, or id=), where opens land; fresh=true in a new detail, as alt+⏎ does. An agent's open never takes the person's focus or keys",
    keys: "⏎, a double click · alt+⏎, an alt-click",
    touches: "nothing", replay: "safe", says: r => `opened ${r.title ?? r.id}`,
    args: { ...which, fresh: { type: "boolean", optional: true, about: "open it in a new detail, as alt+⏎ does" } },
    async run({ fresh, ...a }, { pane, desk }, actor: Actor) {
      const w = pane as WhatChangedPane, { row, n } = rowOf(w, a);
      const m = await desk.ctx.board.get(row.blockId);
      if (!m) throw new ActionRefused("that note is gone (trashed notes open from the trash)");
      if (actor.kind !== "agent") w.at = n - 1;
      // In the drawer a tile has no reader of its own: the open lands on the screen shown, as its details open.
      const host = desk.ctx.hostLayer;
      if (host?.isDrawer(desk)) { const landed = await host.openOnScreen(m.id, !!fresh, actor); desk.redraw(); return { n, id: row.blockId, title: subject(m), reader: landed.reader }; }
      desk.setCurrent(m, { from: w, link: true, ...(fresh ? { fresh: true } : {}), by: actor });
      desk.redraw();
      return { n, id: row.blockId, title: subject(m) };
    },
  }),
  "changes.diff": def({
    summary: "show or fold the change itself under a row (n from 1, or id=): the note's earlier text against what it became, from the revisions the service keeps (block.revisions). An agent's reads the lines without changing what the person has open",
    keys: "d",
    touches: "tile", while: "typing", replay: "safe", way: "an agent reads the diff from the answer; the person's rows stay as they are",
    args: which,
    async run(a, { pane, desk }, actor: Actor) {
      const w = pane as WhatChangedPane, { row, n } = rowOf(w, a);
      if (actor.kind === "agent") return { n, id: row.blockId, diff: await changeDiff(desk.ctx.board, row) };
      if (w.showing(row)) { w.fold(row); desk.redraw(); return { n, id: row.blockId, diff: null }; }
      return { n, id: row.blockId, diff: await w.diff(row, desk) };
    },
  }),
  "changes.seen": def({
    summary: "mark everything in the what-changed list seen: the status bar's count goes to 0, and the position is kept for this outline. The person's only: an agent reading, opening or acting on notes never clears what they haven't looked at",
    keys: "x",
    touches: "screen", replay: "ask", says: () => "marked what changed seen",
    person: "seen is the person's: an agent reads the rows (changes.list, peek) and never clears them",
    args: {},
    run(_, { desk }) {
      const store = (desk.ctx as unknown as { whatChanged?: WhatChanged }).whatChanged;
      store?.markSeen();
      desk.redraw();
      return { seenTo: store?.seenTo ?? 0 };
    },
  }),
});

/** The list as a tile kind: its rows, its actions, and what `peek` says. */
export const WHAT_CHANGED_KIND: TileKind = {
  kind: WHAT_CHANGED_KIND_NAME, about: "the notes others changed since you last looked: who, when, what (from the service's change feed)", noun: "the what-changed list",
  make: () => new WhatChangedPane(), actions: WHAT_CHANGED_ACTIONS,
  peek: p => ({ whatChanged: (p as WhatChangedPane).describe() }),
  describe: p => ({ rows: (p as WhatChangedPane).describe() }),
};
