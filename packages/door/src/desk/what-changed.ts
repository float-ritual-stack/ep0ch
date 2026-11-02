// What changed (PIE-647): the notes others changed since the person last looked, from the service's change feed (the
// live events carry its records; `changes.since` seeds them after a restart). No second log: this is a per-person
// reading of the feed. `WhatChanged` keeps one row per note (its latest change, with whether it was ever created
// here), counted apart from the person's own edits; the status bar's `+N new` is its unseen count.
//
// Seen is the person's. Opening the list as the person marks what it holds seen (and the position is kept per
// outline in the state dir, so a restart resumes from it); an agent's open, read or action never clears it.
//
// The list itself is the `what-changed` extension's tile (PIE-1506, outliner/extensions/what-changed: a render script
// over tools.outline_changes, drawn as a service tile): `changes.open` (alt+o, a click on `+N new`, src/drawer.ts)
// opens it as a tab in the drawer with `since` and `unseen` from this store, as the waiting-on-you list opens. The
// door keeps what only it knows: the count, the seen position, and the one revision diff (revisionDiff) the reader's
// revision compare draws.
import { subject } from "../board";
import { C, fg } from "../style";
import { ActionRefused } from "../surface/actions";
import { diffRows } from "../unsent";
import { readState, writeState } from "../state";
import type { Change, OutlineEvent, SocketBoard } from "../socket";
import type { BlockRevisionEntry, BlockRevisions } from "@ep0ch/outline-core/protocol";
import { OutlineStore } from "../outline-store";
import { prop } from "../props";

/** The list's tile kind: the what-changed extension's (`<extension>.<kind>`). */
export const WHAT_CHANGED_TILE = "what-changed.list";
const SEEN_FILE = "changes-seen.json";
/** How many notes the list keeps (the newest). */
const KEEP = 200;
/** The most pages of the feed a start reads (500 changes each): far past what anyone looks at, so it ends in a reset, never a truncated list. */
const MAX_SEED_PAGES = 400;

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
  /** The note is one a tool stamped `[machine::…]` (outline-core machinery.ts): held back like an extension's write. */
  machine: boolean;
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
  if (c.kind === "edit" && (c.bookkeeping || /propert/i.test(c.action))) return "property set";
  return KIND_WORDS[c.kind] ?? "changed";
}

/** Whether a row is held back by default: a note a tool stamped `[machine::…]`, or an extension's write. */
const held = (r: Pick<ChangedRow, "ext" | "machine">) => r.ext || r.machine;

/** Whether a change is the person's own: their edits are never news to them. */
export const isOwn = (c: Change) => (c.actor?.author ?? "user") === "user" && !c.actor?.actorId?.startsWith("ext:");

export class WhatChanged extends OutlineStore {
  private readonly rows = new Map<string, ChangedRow>();
  /** The feed position the person last looked at: changes up to it are seen. */
  seenTo = 0;
  /** Whether what tools wrote for their own bookkeeping counts (`changes.machinery`): `[machine::…]` notes and extensions' writes. */
  showMachinery = false;
  private ready: Promise<void> = Promise.resolve();
  /** Resolves once the changes since the kept position are read (looking before then would skip them). */
  settled(): Promise<void> { return this.ready; }

  /** The outline it reads (its seen position is kept under this name). */
  outline = "";

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
        // The feed answers a page at a time, oldest first: read on until it says it is complete, or the list's own bound
        // is far past (a door started long after the person looked would otherwise list only the oldest page, PIE-891).
        let from = kept;
        for (let pages = 0; ; pages++) {
          const page = await board.changesSince(from);
          // The feed no longer reaches back (or, past the bound, there is too much to list): what the list held is dropped and
          // the person's position is now.
          if (page.kind === "reset" || pages >= MAX_SEED_PAGES) { this.rows.clear(); this.seenTo = page.sequence; this.save(); break; }
          // Replayed oldest first, so each note ends on its latest.
          for (const c of page.changes) this.add(c);
          if (page.completeness.kind === "complete" || page.nextSequence <= from) break;
          from = page.nextSequence;
        }
      } catch { /* the feed isn't reachable yet: live events fill the list */ }
      finally { this.notify(); }
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
      who: id, agent: c.actor?.author === "agent", ext: id.startsWith("ext:"), machine: !!c.machinery,
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
    if (e.action === "reset") { this.rows.clear(); this.notify(); return; }
    if (!e.change) return;
    const before = this.count();
    this.add(e.change);
    if (this.count() !== before) this.notify();
  }

  /** The ids of the notes not yet seen (taken just before the person's look marks them). */
  unseenIds(): string[] { return this.list().filter(r => !r.seen).map(r => r.blockId); }
  /**
   * Where the list starts (the extension's `since`): a little before the oldest change held (a change is recorded in the
   * feed after its block's edit time, which is what the activity the rows come from carries), else a week ago.
   */
  since(): string {
    const oldest = Math.min(...[...this.rows.values()].map(r => r.at));
    return new Date(Number.isFinite(oldest) ? oldest - 2000 : Date.now() - 7 * 24 * 3600_000).toISOString();
  }

  /** The rows shown, newest first (machinery and extension writes only when asked for). */
  list(): ChangedRow[] {
    return [...this.rows.values()].filter(r => this.showMachinery || !held(r)).sort((a, b) => b.sequence - a.sequence);
  }
  /** How many notes changed since the person looked: the status bar's `+N new`. */
  count(includeMachinery = this.showMachinery): number { return [...this.rows.values()].filter(r => !r.seen && (includeMachinery || !held(r))).length; }
  /** What tools wrote for their own bookkeeping, held back from the count (`+N machine`). */
  machineryCount(): number { return this.showMachinery ? 0 : [...this.rows.values()].filter(r => held(r) && !r.seen).length; }
  /** Whether any note the list holds is machinery (`machine on` shows while they are shown). */
  hasMachinery(): boolean { return [...this.rows.values()].some(held); }
  /** Every note changed since the person looked, machinery too: the new scan's "73" beside its "12 by people". */
  allCount(): number { return [...this.rows.values()].filter(r => !r.seen).length; }

  /** The person looked: everything held is seen, and the position is kept. Never an agent's. */
  markSeen() {
    let top = this.seenTo;
    // What the list shows: the machinery it holds back (`changes.machinery`) stays unseen until it's shown.
    for (const r of this.rows.values()) {
      if (held(r) && !this.showMachinery) continue;
      r.seen = true; r.created = false; top = Math.max(top, r.sequence);
    }
    if (top !== this.seenTo) { this.seenTo = top; this.save(); }
    this.notify();
  }

  /** Titles for rows that have none yet, read from the board (a purged note's row goes). */
  async titles(board: Pick<SocketBoard, "read">) {
    const todo = [...this.rows.values()].filter(r => r.title === undefined || r.retitle);
    await Promise.all(todo.map(async r => {
      // A note the service no longer has (purged from the trash, with the notes under it) is no news: its row goes, where it
      // used to stay as "(gone)", a stack of them (PIE-891). A trashed one is still read, and says so.
      // `read` answers null only for a note the service says it has not found: any other refusal reads as unreadable.
      try { const m = await board.read(r.blockId); if (!m) { this.rows.delete(r.blockId); return; } r.title = subject(m); delete r.retitle;
        if (prop(m, "work-id")) r.workId = prop(m, "work-id"); else delete r.workId;
        if (prop(m, "page")) r.page = prop(m, "page"); else delete r.page; } catch { r.title = "(unreadable)"; }
    }));
    if (todo.length) this.notify();
  }

  /** A fresh store's rows as peek and `changes.list` give them. */
  facts(): Record<string, unknown>[] {
    return this.list().map((r, i) => rowFacts(r, i + 1));
  }
}

/** What the extension's tile draws from (its args, PIE-1506): where the list starts, and the rows that wear ●. */
export function changesArgs(store: WhatChanged, keep: string[] = []): { since: string; unseen: string; machinery?: string } {
  return { since: store.since(), unseen: [...new Set([...keep, ...store.unseenIds()])].join(","), ...(store.showMachinery ? { machinery: "show" } : {}) };
}

/**
 * Keep a what-changed tile's args in step with the store while it's open: what arrives unseen reaches it (a note made
 * new or a comment, which the activity feed the rows come from doesn't list, is read by itself in the tile), and the
 * marks it keeps gain the new ones. Returns the unsubscribe.
 */
export function followChanges(tile: { state: Record<string, unknown>; invalidate(): void }, store: WhatChanged): () => void {
  const sync = () => {
    const next = changesArgs(store, String(tile.state.unseen ?? "").split(",").filter(Boolean));
    if (next.unseen === tile.state.unseen && next.since === tile.state.since && (next.machinery ?? "") === (tile.state.machinery ?? "")) return;
    Object.assign(tile.state, next);
    tile.invalidate();
  };
  sync();
  return store.subscribe(sync);
}

/** A row as `peek` and the actions give it: its place (from 1), the note, who, what and when. */
export function rowFacts(r: ChangedRow, n: number): Record<string, unknown> {
  return { n, id: r.blockId, title: r.title ?? null, ...(r.workId ? { workId: r.workId } : {}), who: r.who, agent: r.agent, kind: r.kind, created: r.created, at: new Date(r.at).toISOString(), seen: r.seen, ...(r.revision !== undefined ? { revision: r.revision } : {}) };
}

/** A revision's text: the note's own when it's the current one, else the service's kept text (block.revisions). */
async function textAt(board: Pick<SocketBoard, "get" | "revisionText">, list: BlockRevisions, rev: number): Promise<string> {
  // The note now only while it is still that revision: a save since the list was read is read by its number.
  const now = rev === list.revision ? await board.get(list.blockId) : null;
  return now && now.revision === rev ? now.text : (await board.revisionText(list.blockId, rev)).text;
}

/** Two of a note's revisions compared: `from`'s text against `to`'s, as diff rows (`-` only in `from`, `+` only in `to`). */
export interface RevisionDiff { from: BlockRevisionEntry; to: BlockRevisionEntry; rows: string[]; current: number; list: BlockRevisions }

/**
 * Revision `from` against `to` (PIE-1433), or, left out, against the next revision kept after it; the newest is compared
 * with itself (nothing after it). The reader's revision compare draws it: the one diff.
 */
export async function revisionDiff(board: Pick<SocketBoard, "get" | "revisions" | "revisionText">, blockId: string, from: number, to?: number, list?: BlockRevisions): Promise<RevisionDiff> {
  list ??= await board.revisions(blockId);
  const entry = (n: number) => list!.revisions.find(x => x.revision === n);
  const a = entry(from);
  if (!a) throw new ActionRefused(`revision ${from} isn't kept for this note (kept: ${list.revisions.map(x => x.revision).join(", ") || "none"})`);
  const b = to !== undefined ? entry(to) : [...list.revisions].reverse().find(x => x.revision > from) ?? a;
  if (!b) throw new ActionRefused(`revision ${to} isn't kept for this note (kept: ${list.revisions.map(x => x.revision).join(", ")})`);
  return { from: a, to: b, rows: diffRows(await textAt(board, list, a.revision), await textAt(board, list, b.revision)), current: list.revision, list };
}

/** A diff row's ink: `+` added, `-` taken out, the rest as it was. The reader's revision compare draws with it. */
export const diffInk = (row: string) => (row.startsWith("+") ? fg(C.lgreen) : row.startsWith("-") ? fg(C.lred) : fg(C.grey));
