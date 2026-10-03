// Reference completion in the edit control (PIE-416): typing `[[`, `((` or `[file::` in a draft offers
// pages and Work IDs, blocks and fragments, or workspace paths, from the service's lookups (`pages.complete`,
// `tree.search`: the one search, Goto's ranker, forgiving punctuation, order and typos; `fragments.candidates`,
// `files.complete`, `blocks.context`), so the door keeps no index, ranking or fragment rules of its own. The
// draft's note is the search's context: nearer notes first, and `((` alone lists what's linked and edited
// around it. A pause asks Jev to re-order the same candidates; the selected one stays selected. Keep typing
// to filter, up/down choose, Enter or Tab inserts, Esc dismisses; Tab or Ctrl+Space asks again. The popup
// never keeps a key it doesn't use: with nothing to choose, Enter, arrows and Esc do what they always do.
import { subject, type Msg } from "../board";
import {
  completionTargetAtCursor, completionWindow, pageAddressCompletion, pageCompletionLookupQuery, parseFragmentCompletionQuery,
  type CompletionTarget,
} from "../completion";
import type { Draft, DraftAction } from "../edit";
import { USER, type Actor, type SocketBoard } from "../socket";
import { bg, C, chip, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { printable } from "../text";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";

/** At most this many candidates per lookup, as in the outliner. */
export const COMPLETION_LIMIT = 20;
/** How long typing pauses before Jev is asked to re-order the candidates: the popup's and the desk's search overlay's. */
export const SEARCH_JEV_PAUSE_MS = 300;
/** Services that said Jev isn't configured there: not asked again this run (each ask is a round trip, and when configured, paid). */
export const jevOff = new WeakSet<object>();
/** The popup's tallest: a header, three candidates with the selected one's context, and the footer. */
export const COMPLETION_ROWS = 8;
export const COMPLETION_HINT = "up/down or wheel choose · enter/tab/click inserts · esc dismisses";

/** The service lookups completion needs (SocketBoard has them). */
export type CompletionBoard = Pick<SocketBoard, "completePages" | "completeFiles" | "searchBlocks" | "blockContext" | "workIdPrefix" | "fragmentCandidates" | "ensureFragment" | "readFragment">;

export interface CompletionItem {
  label: string;
  /** Exactly what choosing it writes in place of the token. */
  insertion: string;
  kind: "page" | "work-id" | "alias" | "block" | "fragment" | "file" | "folder" | string;
  blockId?: string;
  address?: string;
  fragmentId?: string;
  /** Where it sits (ancestors) and how its body starts; read for the selected candidate. */
  context?: string;
  /**
   * A heading without an anchor that gets one when chosen: in the draft's own note, that line's new text
   * (the draft saves it); in another note, the service writes it (`fragments.ensure`), if that note is
   * still at `revision`.
   */
  anchor?: { lineIndex: number; line: string; revision: number };
}

export interface CompletionLookup {
  items: CompletionItem[];
  /** The service cut the list at this many. */
  truncated: number | null;
  /** Empty or partial: said in words instead of an empty popup. */
  message: string;
  /** Jev re-ordered the list (`ranked`), is being asked (`asking`), or never was. */
  jev?: "asking" | "ranked";
  /** The service has no Jev configured: don't ask again. */
  jevOff?: boolean;
}

/** The note a draft's search asks from: its own note, else the note it's about (a comment's, a new card's view). */
export const nearOf = (d: Draft | null | undefined, own?: OwnNote): string | undefined => own?.blockId ?? d?.near;

/** How the lookup is asked: `semantic` has Jev re-order it; `near` is the note the draft writes in. */
export interface LookupOptions { semantic?: boolean; near?: string }

/** The note a note draft is writing, for `((#heading` in itself; comments and replies have none. */
export interface OwnNote { blockId: string; text: string }

const title = (m: Msg) => subject({ ...m, text: m.text.replace(/ \^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/m, "") }).replace(/\s{2,}/g, " ");
const REASON = { linked: "linked from here", near: "near here", yours: "you edited" } as const;
/** The service's snippet of a hit, its first line left out when it's the title the row already shows. */
const hitSnippet = (title: string, text: string) => {
  const lines = text.split(/\r?\n/);
  return (withoutPropertyTokens(lines[0] ?? "").trim().startsWith(title.slice(0, 24)) ? lines.slice(1) : lines)
    .map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
};
const snippet = (text: string) => text.split(/\r?\n/).slice(1).map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);

export const notConfigured = (semantic: { status: string; message?: string }) => semantic.status === "unavailable" && /not configured/i.test(semantic.message ?? "");

/** The candidates for one token: the same lookups and insertions the outliner's editors use. */
export async function lookupCompletion(board: CompletionBoard, target: CompletionTarget, prefix: string | null, own?: OwnNote, opts: LookupOptions = {}): Promise<CompletionLookup> {
  let items: CompletionItem[] = [], truncated: number | null = null, empty = "", partial = "", ranked = false, off = false;
  if (target.kind === "file") {
    const files = await board.completeFiles(target.query);
    items = files.slice(0, COMPLETION_LIMIT).map(f => ({ label: f.sourcePath, kind: f.isDirectory ? "folder" : "file", insertion: `[file::${f.sourcePath}${f.isDirectory ? "" : "]"}` }));
    if (files.length > COMPLETION_LIMIT) truncated = COMPLETION_LIMIT;
    empty = "no matching files";
  } else if (target.kind === "page") {
    const r = await board.completePages(pageCompletionLookupQuery(target.query, prefix) || undefined, COMPLETION_LIMIT, opts);
    items = r.addresses.map(a => ({ ...pageAddressCompletion(a, target.query, prefix), blockId: a.blockId, address: a.address, kind: a.kind }));
    if (r.completeness.kind === "truncated") truncated = r.completeness.limit ?? COMPLETION_LIMIT;
    ranked = r.semantic?.status === "ranked";
    off = !!r.semantic && notConfigured(r.semantic);
    empty = "no matching named addresses; [[target|label]] labels a target, ((...)) searches blocks";
  } else {
    const fragment = parseFragmentCompletionQuery(target.query);
    if (!fragment) {
      // The one search (`tree.search`), from the draft's note: what Goto, the desk's `/` and Jev rank.
      const r = await board.searchBlocks(target.query, opts);
      if (r.matches.length > COMPLETION_LIMIT || r.completeness.kind === "truncated") truncated = COMPLETION_LIMIT;
      items = r.matches.slice(0, COMPLETION_LIMIT).map(m => ({
        label: m.title, blockId: m.block.id, kind: m.reason ? `block · ${REASON[m.reason]}` : "block", insertion: `((${m.block.id}))`,
        context: [m.path, hitSnippet(m.title, m.snippet)].filter(Boolean).join(" » "),
      }));
      ranked = r.semantic.status === "ranked";
      off = notConfigured(r.semantic);
      empty = "no matching blocks";
    } else {
      // `((garden#beds` / `((garden^be`: the service searches every note by its own fragment rules
      // (PIE-424), the draft's own note first as typed. A heading without an anchor comes with the anchor
      // it would get; choosing it adds that anchor (in the draft, or through the service in another note).
      const r = await board.fragmentCandidates({ ...(fragment.blockQuery ? { noteQuery: fragment.blockQuery } : {}), fragmentQuery: fragment.fragmentQuery, mode: fragment.mode, limit: COMPLETION_LIMIT, ...(own ? { draft: own } : {}) });
      items = r.items.map(c => {
        const id = c.fragmentId ?? c.anchor!.fragmentId;
        return {
          label: `${c.title} » ${c.kind === "heading" ? "#" : "^"} ${c.label}${c.fragmentId ? ` · ^${c.fragmentId}` : " · adds anchor"}`,
          blockId: c.blockId, fragmentId: id, kind: "fragment", insertion: `((${c.blockId}^${id}))`,
          ...(c.anchor ? { anchor: { lineIndex: c.lineIndex, line: c.anchor.line, revision: c.revision } } : {}),
        };
      });
      if (r.completeness.kind === "truncated") { truncated = r.completeness.limit ?? COMPLETION_LIMIT; partial = `showing the first ${truncated} fragments`; }
      empty = "no matching fragments";
    }
  }
  const message = items.length ? partial || (truncated ? `showing the first ${truncated} matches` : "") : [partial && `partial search: ${partial}`, empty].filter(Boolean).join(" · ");
  return { items, truncated, message, ...(ranked ? { jev: "ranked" as const } : {}), ...(off ? { jevOff: true } : {}) };
}

/**
 * Put a chosen candidate into the draft, after checking with the service that it still answers: the
 * named address still names that note, the note isn't gone, the fragment is still there once. Throws
 * with the reason (and changes nothing) when it doesn't.
 */
export async function insertCompletion(board: CompletionBoard, d: Draft, target: CompletionTarget, item: CompletionItem, own: OwnNote | undefined, still: () => boolean, by: Actor = USER, commit?: () => void): Promise<boolean> {
  if (item.blockId) {
    if (item.address) {
      const r = await board.completePages(item.address, COMPLETION_LIMIT);
      if (!still()) return false;
      if (!r.addresses.some(a => a.address === item.address && a.blockId === item.blockId)) throw new Error("that address changed; search again");
    }
    const ctx = await board.blockContext(item.blockId);
    if (!still()) return false;
    if ((!ctx.selected || ctx.selected.id !== item.blockId || ctx.selected.deleted)) throw new Error("that note is no longer there; search again");
    const mine = own?.blockId === item.blockId;
    // Another note's fragment: the service says it's still there, once (the draft's own was read as typed).
    if (item.fragmentId && !item.anchor && !mine) {
      const f = await board.readFragment(item.blockId, item.fragmentId);
      if (!still()) return false;
      if (f.status !== "resolved") throw new Error("that fragment changed or is ambiguous; search again");
    }
    // Another note's heading gets its anchor from the service, if that note hasn't changed since it was offered.
    if (item.fragmentId && item.anchor && !mine) {
      const written = await board.ensureFragment(item.blockId, item.anchor.lineIndex, item.anchor.revision, by)
        .catch((e: Error) => { throw new Error(`the anchor wasn't added: ${e.message}`); });
      if (!still()) return false;
      if (written.fragmentId !== item.fragmentId) throw new Error("that heading changed; search again");
    }
  }
  // Right before the splice, with no wait between: what the insert uses up (an invitation) is spent only when it lands.
  commit?.();
  d.splice(target.start, target.end, item.insertion, item.anchor && own?.blockId === item.blockId ? { [item.anchor.lineIndex]: item.anchor.line } : {}, by);
  return true;
}

export interface CompletionState extends CompletionLookup {
  target: CompletionTarget;
  index: number;
  loading: boolean;
  /** Where the cursor was when it was asked: a reply for anywhere else is dropped. */
  at: { row: number; col: number; line: string };
}

/** One draft's completion popup: a lookup at a time, newer typing or a dismissal dropping older answers. */
export class Completer {
  state: CompletionState | null = null;
  private generation = 0;
  private accepting = false;
  private prefix: string | null | undefined;
  constructor(private readonly d: Draft, private readonly board: CompletionBoard, private readonly redraw: () => void, private readonly own: () => OwnNote | undefined = () => undefined) {}

  /** The token the cursor is in, if any. */
  target(): CompletionTarget | null { return completionTargetAtCursor(this.d.lines[this.d.row] ?? "", this.d.col); }

  /** The popup still belongs where the cursor is (the wheel, or an agent's edit.text, can move it without a key). */
  get shown(): CompletionState | null {
    const s = this.state, h = this.here();
    return s && s.at.row === h.row && s.at.col === h.col && s.at.line === h.line ? s : null;
  }

  private here() { return { row: this.d.row, col: this.d.col, line: this.d.lines[this.d.row] ?? "" }; }
  private current(generation: number): boolean {
    const s = this.state, h = this.here();
    return generation === this.generation && !!s && s.at.row === h.row && s.at.col === h.col && s.at.line === h.line;
  }

  dismiss(): void {
    this.generation++;
    this.stopJev();
    if (!this.state) return;
    this.state = null;
    this.redraw();
  }

  private near(): string | undefined { return nearOf(this.d, this.own()); }

  private jevTimer: ReturnType<typeof setTimeout> | null = null;
  private stopJev(): void { if (this.jevTimer) clearTimeout(this.jevTimer); this.jevTimer = null; }

  /**
   * After a pause, ask the service again with Jev re-ordering the same candidates. The answer is used only if
   * nothing moved meanwhile (the query, the cursor, the selection), and the selected candidate stays selected.
   */
  private askJev(generation: number, target: CompletionTarget): void {
    this.stopJev();
    const fragment = target.kind === "block" && parseFragmentCompletionQuery(target.query);
    if (target.kind === "file" || fragment || target.query.trim().length < 3 || jevOff.has(this.board)) return;
    // Jev re-orders the service's candidates (up to 30 for ((): one beyond the 20 shown can come into view.
    this.jevTimer = setTimeout(async () => {
      this.jevTimer = null;
      const s = this.state;
      if (!s || !this.current(generation) || s.loading || s.items.length < 2 || this.accepting || this.d.busy) return;
      const index = s.index, chosen = s.items[index]?.insertion;
      s.jev = "asking";
      this.redraw();
      try {
        const r = await lookupCompletion(this.board, target, this.prefix ?? null, this.own(), { semantic: true, near: this.near() });
        if (r.jevOff) jevOff.add(this.board);
        const now = this.state;
        if (now !== s) return;
        // Anything moved meanwhile (the pick, the cursor, a save or an insert under way): the answer isn't used.
        if (!this.current(generation) || now.index !== index || now.items[index]?.insertion !== chosen || this.accepting || this.d.busy) { now.jev = undefined; this.redraw(); return; }
        const at = r.items.findIndex(i => i.insertion === chosen);
        if (at < 0) { now.jev = undefined; this.redraw(); return; }
        this.state = { ...r, target, index: at, loading: false, at: now.at };
        this.redraw();
        void this.enrich(generation);
      } catch {
        if (this.state === s) { s.jev = undefined; this.redraw(); }
      }
    }, SEARCH_JEV_PAUSE_MS);
  }

  /** Look up the token at the cursor (or close the popup when the cursor isn't in one). */
  async refresh(): Promise<void> {
    const target = this.target();
    if (!target || this.d.busy) { this.dismiss(); return; }
    this.stopJev();
    // A re-ask of the same query keeps the pick; a changed query picks its best match.
    const same = this.state?.target.kind === target.kind && this.state.target.query === target.query;
    const generation = ++this.generation, was = same ? this.state?.items[this.state.index]?.insertion : undefined;
    this.state = { target, items: this.state?.items ?? [], index: this.state?.index ?? 0, truncated: null, message: "finding references...", loading: true, at: this.here() };
    this.redraw();
    try {
      // Only an answer is kept for the draft: a failed lookup is asked again next time, as the outliner does.
      if (this.prefix === undefined) this.prefix = await this.board.workIdPrefix().catch(() => undefined);
      const r = await lookupCompletion(this.board, target, this.prefix ?? null, this.own(), { near: this.near() });
      if (r.jevOff) jevOff.add(this.board);
      if (!this.current(generation)) return;
      const index = Math.max(0, r.items.findIndex(i => i.insertion === was));
      this.state = { ...r, target, index, loading: false, at: this.state!.at };
      this.redraw();
      void this.enrich(generation);
      this.askJev(generation, target);
    } catch (e) {
      if (this.current(generation)) { this.state = { ...this.state!, items: [], loading: false, message: `lookup failed: ${e instanceof Error ? e.message : String(e)}` }; this.redraw(); }
    }
  }

  /** The selected candidate's ancestors and first lines, from `blocks.context`. */
  private async enrich(generation = this.generation): Promise<void> {
    const item = this.state?.items[this.state.index];
    if (!item?.blockId) return;
    try {
      const ctx = await this.board.blockContext(item.blockId);
      if (!this.current(generation) || this.state?.items[this.state.index] !== item) return;
      item.context = ctx.selected ? [...ctx.ancestors.map(title), snippet(ctx.selected.text)].filter(Boolean).join(" » ") : "target unavailable";
      this.redraw();
    } catch { /* the snippet from the lookup stays */ }
  }

  /** Where the last render drew the popup, in the editor's rows: its first row and each row's candidate. */
  drawn: { row: number; items: (number | null)[] } | null = null;

  /**
   * A click on row `y` of the editor: on a candidate, it's chosen and inserted (as Enter does); anywhere
   * else on the popup, nothing. True when the popup was there (the click is the popup's either way).
   */
  click(y: number): boolean {
    const s = this.shown, at = this.drawn;
    if (!s || !at || y < at.row || y >= at.row + at.items.length) return false;
    const i = at.items[y - at.row];
    if (i !== null && i !== undefined && s.items[i] && !s.loading) { s.index = i; this.redraw(); void this.accept(i); }
    return true;
  }

  move(delta: number): void {
    const s = this.state;
    if (!s?.items.length) return;
    s.index = Math.max(0, Math.min(s.items.length - 1, s.index + delta));
    this.redraw();
    void this.enrich();
  }

  /** Enter / Tab: insert the selected candidate (checked with the service first). */
  async accept(index = this.state?.index ?? 0): Promise<boolean> {
    const s = this.state, item = s?.items[index], generation = this.generation;
    if (this.accepting || !s || !item || s.loading || !this.current(generation)) return false;
    this.accepting = true;
    try {
      if (!await insertCompletion(this.board, this.d, s.target, item, this.own(), () => this.current(generation))) return false;
      this.dismiss();
      // A folder leaves `[file::notes/` open: its entries are offered next.
      if (this.target()) void this.refresh();
      return true;
    } catch (e) {
      if (this.current(generation)) { s.message = e instanceof Error ? e.message : String(e); this.redraw(); }
      return false;
    } finally { this.accepting = false; }
  }
}

const byDraft = new WeakMap<Draft, Completer>();

/** The draft's completer, made on first use; null when the board can't look anything up (a test double). */
export function completerFor(d: Draft, board: unknown, redraw: () => void, own?: () => OwnNote | undefined): Completer | null {
  const had = byDraft.get(d);
  if (had) return had;
  const b = board as Partial<CompletionBoard> | null;
  if (!b || typeof b.completePages !== "function" || typeof b.searchBlocks !== "function") return null;
  const c = new Completer(d, b as CompletionBoard, redraw, own);
  byDraft.set(d, c);
  return c;
}

/** The draft's completer, if it has one. */
export const completerOf = (d: Draft): Completer | null => byDraft.get(d) ?? null;

/** The draft's popup, if one is open (for drawing). */
export const completionOf = (d: Draft): CompletionState | null => byDraft.get(d)?.shown ?? null;

const isCtrlSpace = (k: Key) => k.kind === "char" && !!k.ctrl && (k.ch === "`" || k.ch === " " || k.ch === "@");

/**
 * A key in a draft, with completion first: while the popup has candidates, up/down choose and Enter/Tab
 * insert; Esc closes the popup (and only the popup). Tab or Ctrl+Space in a token asks again; Tab
 * anywhere else indents as before. Every other key goes to the draft, then the popup follows the cursor.
 */
export function completionKey(d: Draft, k: Key, c: Completer | null): DraftAction {
  if (!c || d.busy || k.kind === "mouse") return d.key(k);
  // A line break or tab inside a paste is text: it never chooses a candidate.
  if ("pasted" in k) { c.dismiss(); return d.key(k); }
  if (c.state && !c.shown) c.dismiss();
  const s = c.state;
  if (s) {
    if (k.kind === "esc") { c.dismiss(); return "keep"; }
    if (s.items.length && !s.loading) {
      if (k.kind === "up" || k.kind === "down") { c.move(k.kind === "up" ? -1 : 1); return "keep"; }
      if (k.kind === "enter" || k.kind === "tab") { void c.accept(); return "keep"; }
    }
  }
  if (k.kind === "tab" || isCtrlSpace(k)) {
    if (c.target()) { void c.refresh(); return "keep"; }
    if (k.kind !== "tab") { d.note = "completion works inside [[, (( or [file::"; return "keep"; }
  }
  const before = d.text, open = c.state?.target;
  const a = d.key(k);
  // The popup opens and refreshes only on typing. Moving the cursor never opens it (landing inside
  // `[[garden]]` or after an unclosed `((` must not take the next Down or Enter): an open popup
  // follows the cursor within its token and closes once the cursor leaves it. Tab or Ctrl+Space asks.
  // An Esc the draft took (arming discard) doesn't bring it back.
  if (a !== "keep" || k.kind === "esc") { c.dismiss(); return a; }
  if (d.text !== before) { void c.refresh(); return a; }
  const now = c.target();
  if (open && now && now.kind === open.kind && now.start === open.start) void c.refresh(); else c.dismiss();
  return a;
}

/**
 * The popup as lines `w` wide, at most `h` tall: header, candidates (the selected one with its context),
 * footer. `rows`, when given, gets each line's candidate index (null for the header, context and footer).
 */
export function renderCompletion(s: CompletionState, w: number, h: number, rows: (number | null)[] = []): string[] {
  rows.length = 0;
  if (h <= 0) return [];
  // Titles come from notes: text.ts's printable takes out what a terminal acts on, pad cuts by cells, and a glyph
  // the VGA font lacks goes as its lookalike at the sink (App, CP437_NEAREST).
  const line = (text: string, colour: string, back = "") => back + colour + pad(printable(text, " "), w) + RESET;
  if (!s.items.length) { rows.push(null); return [line(` ${s.message || "no matches"}`, fg(s.loading ? C.grey : C.yellow), bg(C.blue))]; }
  const header = h >= 3, footer = h >= 2;
  const room = Math.max(1, h - Number(header) - Number(footer) - 1);
  const win = completionWindow(s.items.length, s.index, room);
  const out: string[] = [];
  if (header) rows.push(null), out.push(line(` references ${s.index + 1}/${s.items.length}${s.truncated ? ` · first ${s.truncated}` : ""}${s.loading ? " · finding..." : ""}`, fg(C.lcyan), bg(C.blue)));
  for (let i = win.start; i < win.end; i++) {
    const it = s.items[i]!, sel = i === s.index;
    rows.push(i);
    out.push(sel ? line(`» ${it.label}`, chip(C.cyan)) : line(`  ${it.label}`, fg(C.grey), bg(C.blue)));
    if (sel && out.length < h - Number(footer)) rows.push(i), out.push(line(`    ${it.kind} · ${it.context || it.insertion}`, fg(C.lcyan), bg(C.blue)));
  }
  // Whether Jev ordered the list, said quietly first, where a narrow popup doesn't cut it.
  const jev = s.jev === "ranked" ? "jev ranked · " : s.jev === "asking" ? "jev… · " : "";
  if (footer) rows.push(null), out.push(line(` ${jev}${s.message || COMPLETION_HINT}`, fg(s.message ? C.yellow : C.grey), bg(C.blue)));
  rows.length = Math.min(rows.length, h);
  return out.slice(0, h);
}
