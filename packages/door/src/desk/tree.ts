// The outline tree (a desk tile, the board's outline dock), with the authored links the outliner's Tree
// shows under a block (PIE-259, PIE-324, PIE-329): `L` (`tree.links`) opens, under the selected row, its
// Outlinks and Resources (the service's `blocks.authored-links`) and its Backlinks (`references.backlinks`,
// grouped by kind as Detail groups them through src/backlinks.ts). Each group opens and folds; an outlink or
// a backlink to a block can show its own links beneath it, one hop per request, as the Tree does. ⏎ or a click
// on a link opens its note where the tree's opens go; on a resource it shows the Resource's stored content
// there (registering it first when it isn't, and fetching it once when nothing is stored: src/authored.ts).
//
// A block that is a virtual branch (`[type::virtual-branch]`, PIE-882) shows, when opened, its physical children and
// then what its query matches, the service's answer (`views.read`: members in branch order, within the view's limit,
// with `[child-depth::]`): each match is a row of its own, opened to its children down to the view's child-depth, and a
// `more` row reads the next page. `D` (`tree.depth`) overrides the depth for that view: results only, or one to
// eight levels. The meaning of the view is the service's; the tree only lays its answer out.
//
// Disclosure is read-only: listing links registers nothing and writes nothing. The rows are the service's
// answer laid out; the words are the Tree's (src/authored.ts).
import { subject, type Msg } from "../board";
import { DEFAULT_BACKLINK_VIEW_OPTIONS, backlinkView, type BacklinkCollection } from "../backlinks";
import type { AuthoredLinksSnapshot } from "../authored";
import { linkBlock, linkNote, linkRowLine, linkRows, linkWords, SEP, type LinkGroupName, type LinkRow, type Load } from "../links";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { shortId } from "../refs";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { C, dim, fg, pad, RESET, selectedRow } from "../style";
import { Fold } from "../fold";
import { readView, type ViewRead } from "../views";
import { RowView, type RowPress } from "../scroll";
import { ch, isUp, isDown, type Key } from "../term";
import { askInBar } from "../bar/ask";
import { lastTrashed } from "../note-trash";
import { intentOf, moveNote, moveQuestion, MOVE_UNDO, undoMove, type MoveArgs, type MoveDone } from "../note-move";
import type { WriteBoard } from "../mcp-writes";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";
import { prop } from "../props";


/** The links shown under one row: that occurrence's own (PIE-324), with which groups are folded. */
interface LinkPanel {
  blockId: string;
  shut: Set<LinkGroupName>;
  /** Backlink kind groups the person opened (Detail's rule: folded, but their open sources show). */
  kinds: Set<string>;
  links: Load<AuthoredLinksSnapshot>;
  backlinks: Load<BacklinkCollection>;
  asked: number;
}

/** A row of the tree: a note, or one of the links shown under a row (the shared links model, src/links.ts), by its owner's key. */
export type TreeRow =
  /** A note. `via`: the virtual branch whose match it is (or sits under one), `rel` the levels below that match; `foldId` what the fold knows it by. */
  | { kind: "block"; key: string; depth: number; m: Msg; foldId: string; via?: string; rel?: number }
  /** A line of a virtual branch's results: `results` its header, `more` the next page, `info` why there is none. */
  | { kind: "branch-note"; key: string; depth: number; view: string; role: "results" | "more" | "info"; text: string }
  | (LinkRow & { owner: string });

/** A virtual branch's results as the service answered them, with what the person asked of them. */
interface Branch {
  /** The view's block. */
  def: Msg;
  read: ViewRead | "loading";
  /** The matches read so far, pages appended. */
  items: Msg[];
  /** The person's depth for this view (`D`), over the view's own. */
  depth?: number;
  asked: number;
}

/** A block that is a virtual branch: the service decides what its query means, the tree only asks. */
export const isBranch = (m: Msg) => (prop(m, "type") ?? "").toLowerCase() === "virtual-branch";
/** The id of the note a fold id stands for (a result's is `v:<view>>…>id`). */
const idOfFold = (foldId: string) => foldId.slice(foldId.lastIndexOf(">") + 1);
/** The levels `D` steps through: the view's own, then results only, then 1…3. */
const DEPTHS: readonly (number | undefined)[] = [undefined, 0, 1, 2, 3];

/** The block a row stands for: a tree row's note, a resolved outlink's target, a backlink's source. */
export function rowBlock(r: TreeRow | undefined): string | null {
  if (!r || r.kind === "branch-note") return null;
  return r.kind === "block" ? r.m.id : linkBlock(r);
}

/** A row as words: its mark, its text and its dim context (`peek`, agents, and the drawing). */
export function rowWords(r: TreeRow, panelOpen: boolean): { mark: string; text: string; context: string; problem?: boolean } {
  return r.kind === "block" ? { mark: "", text: subject(r.m), context: r.via ? "matched" : "" } : r.kind === "branch-note" ? { mark: "", text: r.text, context: "" } : linkWords(r, panelOpen);
}

export class TreePane implements Pane {
  readonly kind = "tree";
  private roots: Msg[] | null = null;
  private readonly fold = new Fold();
  /** Authored links shown under a row, by the row's key (an occurrence: the same note twice keeps two). */
  private panels = new Map<string, LinkPanel>();
  /** The resource row last shown (its stored content as a note), for a preview following the tree. */
  private shownResource: { key: string; note: Msg } | null = null;
  /** Notes read for link rows, so a preview following the tree can show the selected one. */
  private targets = new Map<string, Msg>();
  /** Virtual branches opened here: their results, by the view's block id. */
  private branches = new Map<string, Branch>();
  private rows: TreeRow[] = [];
  private sel = 0;
  private view = new RowView();
  /** A row pressed and dragged (PIE-943): where it would land if let go now (`over`, and `beside` with alt held). */
  private drag: { id: string; from: number; over: number | null; beside: boolean; moved: boolean } | null = null;
  /** How many times the person picked a row (a move that finishes later leaves a selection they changed meanwhile). */
  private picks = 0;
  private viaPressed = false;
  private drawnW = 0;
  private drawnH = 0;
  private timer: Timer | null = null;
  private reload: Timer | null = null;
  title() { return "outline"; }
  subject() { const r = this.rows[this.sel]; return r?.kind === "block" ? r.m.id : null; }
  hint() {
    const r = this.rows[this.sel];
    if (r?.kind === "branch-note") return r.role === "more" ? "⏎ read more matches · D depth" : "⏎ D change the depth · h back";
    if (r && r.kind !== "block") return r.kind === "resource" ? "⏎ show the resource · h back" : r.kind === "group" || r.kind === "kind" ? "⏎ space fold · h back" : "⏎ open · l its links · h back";
    return r?.kind === "block" && (isBranch(r.m) || r.via) ? "←→ fold · ⏎ read · L links · D depth" : "←→ fold · ⏎ read · L links · alt+↑↓ or K J move · I in · O out · Z move to";
  }
  /** The row it has selected: a preview tile following the tree starts there. */
  selected(): Msg | null {
    const r = this.rows[this.sel];
    if (r?.kind === "block") return r.m;
    if (r?.kind === "resource") return this.shownResource?.key === r.key ? this.shownResource.note : null;
    const id = rowBlock(r);
    return id ? this.targets.get(id) ?? null : null;
  }
  /** Every row as drawn, in order (tests, `peek`). */
  list(): readonly TreeRow[] { return this.rows; }
  get selectedRow(): number { return this.sel; }

  /** Settles once the top level has been read (a reveal waits for it). */
  private loaded: Promise<void> | null = null;
  init(desk: DeskApi) {
    // Moved to another screen or into the drawer (PIE-498): it keeps its rows; nothing is read again or opened.
    if (this.loaded) return;
    this.loaded = desk.ctx.board.roots().then(r => {
      this.roots = r; this.rebuild();
      // A screen with no current note starts on the first root: only from a tree in sight (PIE-814: one in a shut dock
      // set every following reader's note from where the person couldn't see it).
      if (!desk.current && r[0] && desk.shownNow?.(this) !== false) desk.setCurrent(r[0], { from: this });
      desk.redraw();
    }, () => {});
  }

  private rebuild() {
    const was = this.rows[this.sel]?.key, wasDepth = this.rows[this.sel]?.depth;
    const out: TreeRow[] = [];
    for (const m of this.roots ?? []) this.emit(out, m, 0, `b:${m.id}`, m.id, {});
    this.rows = out;
    // The selection stays on its row; a row folded away hands it to the nearest row it was under.
    let i = was ? out.findIndex(r => r.key === was) : -1;
    // A link whose key changed in place (a resource just registered is keyed by its id now) keeps its place.
    const parent = was?.slice(0, Math.max(0, was.lastIndexOf(SEP)));
    if (i < 0 && parent && out[this.sel]?.key.startsWith(parent + SEP) && out[this.sel]!.depth === wasDepth) i = this.sel;
    if (i < 0 && was) {
      let best = -1;
      out.forEach((r, j) => { if (was.startsWith(r.key + SEP) && (best < 0 || r.key.length > out[best]!.key.length)) best = j; });
      i = best;
    }
    this.sel = i >= 0 ? i : Math.min(this.sel, Math.max(0, out.length - 1));
  }

  /**
   * One note's rows: the note, its links when shown, what is open under it, and, for a virtual branch, its results after
   * its physical children. A match opens to its children down to the view's child-depth (the person's `D` over it).
   */
  private emit(out: TreeRow[], m: Msg, depth: number, key: string, foldId: string, via: { via?: string; rel?: number }) {
    out.push({ kind: "block", key, depth, m, foldId, ...via });
    this.panelRows(key, depth + 1, out);
    if (!this.fold.open.has(foldId)) return;
    const kids = this.fold.kids.get(foldId);
    if (Array.isArray(kids) && (via.via === undefined || via.rel! < this.depthOf(via.via))) {
      for (const c of kids) {
        if (via.via === undefined) this.emit(out, c, depth + 1, `b:${c.id}`, c.id, {});
        else this.emit(out, c, depth + 1, `${key}>${c.id}`, `${key}>${c.id}`, { via: via.via, rel: via.rel! + 1 });
      }
    }
    // Not under a match: a view inside a view's results is a boundary the service stops at.
    if (via.via === undefined && isBranch(m)) this.branchRows(out, m, depth + 1);
  }

  /** The levels a view's matches open to: the person's, else the view's own as the service answered it. */
  private depthOf(view: string): number {
    const b = this.branches.get(view);
    return b?.depth ?? (b && b.read !== "loading" ? b.read.childDepth : undefined) ?? 0;
  }

  /** A virtual branch's results as rows: a header, each match, and the row that reads the next page. */
  private branchRows(out: TreeRow[], view: Msg, depth: number) {
    const b = this.branches.get(view.id);
    const note = (role: "results" | "more" | "info", text: string): TreeRow => ({ kind: "branch-note", key: `n:${view.id}:${role}`, depth, view: view.id, role, text });
    if (!b) return;
    if (b.read === "loading" && !b.items.length) return void out.push(note("info", "reading the view…"));
    const read = b.read === "loading" ? null : b.read;
    if (read && read.status !== "ready") return void out.push(note("info", `can't read this view (${read.status})${read.errors[0] ? `: ${read.errors[0]}` : ""}`));
    const total = read?.total ?? b.items.length;
    const d = this.depthOf(view.id);
    out.push(note("results", b.items.length ? `${total} ${total === 1 ? "match" : "matches"} · ${d === 0 ? "results only" : `children to depth ${d}`}${b.depth !== undefined ? " (D)" : ""}` : "no matches"));
    for (const m of b.items) this.emit(out, m, depth, `v:${view.id}>${m.id}`, `v:${view.id}>${m.id}`, { via: view.id, rel: 0 });
    if (read?.nextOffset !== undefined) out.push(note("more", `… ${Math.max(0, total - b.items.length)} more · ⏎ reads the next ${read.limit}`));
  }

  /** The groups under `owner` (a row's key) when its links are shown (the shared links model), and theirs beneath rows that show theirs. */
  private panelRows(owner: string, depth: number, out: TreeRow[]) {
    const p = this.panels.get(owner);
    if (!p) return;
    for (const r of linkRows(p, { shut: p.shut, kinds: p.kinds, backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS }, owner + SEP, depth)) {
      out.push({ ...r, owner });
      if (r.kind !== "group" && r.kind !== "kind") this.panelRows(r.key, r.depth + 1, out);
    }
  }

  private expand(m: Msg, desk: DeskApi, on = true, foldId = m.id): Promise<void> {
    // A virtual branch's results are read when it opens, beside its children, and again when the outline changes.
    // (One kept from an earlier open may be older than the outline: it is asked again.)
    if (on && foldId === m.id && isBranch(m)) void this.loadBranch(m, desk, this.branches.has(m.id) ? "again" : "first");
    return this.fold.show(foldId, on, id => desk.ctx.board.children(idOfFold(id)), () => { this.rebuild(); desk.redraw(); });
  }

  /**
   * Ask the service for a virtual branch's matches (`views.read`): the first page, or with `more` the next, or the
   * pages read so far again. What was shown stays until the answer comes.
   */
  private async loadBranch(view: Msg, desk: DeskApi, how: "first" | "more" | "again" = "first") {
    const had = this.branches.get(view.id);
    const b: Branch = had ?? { def: view, read: "loading", items: [], asked: 0 };
    this.branches.set(view.id, b);
    const n = ++b.asked, was = b.read;
    if (how === "first") b.read = "loading";
    const board = desk.ctx.board;
    const have = b.items.length;
    const page = how === "more" && was !== "loading" && was.nextOffset !== undefined ? { limit: was.limit, offset: was.nextOffset } : how === "again" && have > 0 ? { limit: Math.min(1000, have) } : {};
    const r = await readView(board, view, page);
    if (this.branches.get(view.id) !== b || b.asked !== n) return;
    // A read that failed keeps what was shown (the pages already read), saying nothing new.
    if (r.status === "failed" && have) return;
    b.read = r;
    // A next page read while the outline moved may repeat a match already shown: each shows once.
    const seen = new Set(b.items.map(x => x.id));
    b.items = how === "more" ? [...b.items, ...r.items.filter(x => !seen.has(x.id))] : r.items;
    this.rebuild(); desk.redraw();
  }

  /** The selection moved to row `sel`: the row's note becomes the current one (a link row's is read first). */
  private pick(desk: DeskApi) {
    if (this.timer) clearTimeout(this.timer);
    const r = this.rows[this.sel];
    const id = r?.kind === "block" ? null : rowBlock(r);
    // While the rows are due to be read again (a change just came), the row's copy may be older than the outline: the
    // note is read itself, so the reader never shows what was there before a save.
    if (r?.kind === "block") this.timer = setTimeout(() => {
      if (!this.reload && !this.due && !this.rereading) return desk.setCurrent(r.m, { from: this });
      void desk.ctx.board.get(r.m.id).catch(() => null).then(m => { if (this.rows[this.sel]?.key === r.key) desk.setCurrent(m ?? r.m, { from: this }); });
    }, 90);
    else if (id) this.timer = setTimeout(() => void this.target(id, desk).then(m => { if (m && rowBlock(this.rows[this.sel]) === id) desk.setCurrent(m, { from: this }); }, () => {}), 90);
    // A resource shows what is stored for it (a ticket's block, a file's content) where the tree's selection goes (a
    // preview following it), read only: nothing registers, and the current note stays (an open meanwhile isn't undone).
    else if (r?.kind === "resource") {
      const key = r.key;
      this.timer = setTimeout(() => void linkNote(r, desk.ctx.board, "show").then(({ note }) => {
        this.shownResource = { key, note };
        if (this.rows[this.sel]?.key === key) desk.showFrom?.(this, note);
      }, () => {}), 90);
    }
    desk.redraw();
  }

  /** A link row's note, read once. */
  private async target(id: string, desk: DeskApi): Promise<Msg | null> {
    const had = this.targets.get(id);
    if (had) return had;
    const m = await desk.ctx.board.get(id);
    if (m) { if (this.targets.size > 200) this.targets.clear(); this.targets.set(id, m); }
    return m;
  }

  async reveal(m: Msg, desk: DeskApi) {
    await this.loaded;
    try {
      const chain = await desk.ctx.board.ancestors(m.id);
      for (const a of chain) await this.expand(a, desk);
    } catch { /* reveal is best effort */ }
    const i = this.rows.findIndex(r => r.kind === "block" && r.m.id === m.id);
    if (i >= 0) { this.sel = i; desk.redraw(); }
  }

  /** Show note `m` open under its row, a virtual branch with its matches (a view that opens with them shown). */
  async showOpen(m: Msg, desk: DeskApi) {
    await this.reveal(m, desk);
    await this.expand(m, desk);
    const i = this.rows.findIndex(r => r.kind === "block" && r.m.id === m.id && !r.via);
    if (i >= 0) { this.sel = i; desk.redraw(); }
  }

  // ── the links under a row ──────────────────────────────────────────────────

  /** Show the links under note `m`'s row, revealing it first (a view that opens with them shown). */
  async showLinksOf(m: Msg, desk: DeskApi) {
    await this.reveal(m, desk);
    const i = this.rows.findIndex(r => r.kind === "block" && r.m.id === m.id);
    if (i >= 0) this.toggleLinks(i, desk, true);
  }

  /**
   * Show or hide the links under row `i` (`on`: which, else the other way). A row that stands for no note (a
   * group, a resource) is refused. The rows are the person's to move through: an agent's leaves the
   * selection on the row it was on.
   */
  toggleLinks(i: number, desk: DeskApi, on?: boolean, agent = false): boolean {
    const r = this.rows[i];
    const id = rowBlock(r);
    if (!r || !id) throw new ActionRefused(r ? `row ${i + 1} is ${r.kind === "resource" ? "a resource" : "a group"}: only a note has links to show` : `no row ${i + 1}; the tree has ${this.rows.length}`);
    const shown = this.panels.has(r.key);
    if (agent && shown && !(on ?? !shown)) this.refuseAgentFold(r.key, i);
    if (on ?? !shown) {
      if (!shown) { this.panels.set(r.key, { blockId: id, shut: new Set(), kinds: new Set(), links: { kind: "loading" }, backlinks: { kind: "loading" }, asked: 0 }); this.load(r.key, desk); }
    } else if (shown) {
      for (const k of [...this.panels.keys()]) if (k === r.key || k.startsWith(r.key + SEP)) this.panels.delete(k);
    }
    this.rebuild(); desk.redraw();
    return this.panels.has(r.key);
  }

  /** Ask the service for a panel's links and backlinks; what it showed stays until the answer comes. */
  private load(key: string, desk: DeskApi) {
    const p = this.panels.get(key);
    if (!p) return;
    const n = ++p.asked, board = desk.ctx.board;
    const current = () => this.panels.get(key) === p && p.asked === n;
    const why = (e: unknown) => `couldn't ask: ${e instanceof Error ? e.message : String(e)}`;
    board.authoredLinks(p.blockId).then(v => { if (current()) { p.links = { kind: "ready", value: v }; this.rebuild(); desk.redraw(); } },
      e => { if (current()) { p.links = { kind: "error", message: why(e) }; this.rebuild(); desk.redraw(); } });
    board.backlinks(p.blockId).then(v => {
      if (!current()) return;
      // Every kind group starts open the first time (a tree row is short on room; Detail's folded group
      // would show only its open sources). What the person folds after stays folded.
      if (p.backlinks.kind === "loading") for (const k of backlinkView(v, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds) p.kinds.add(k.kind);
      p.backlinks = { kind: "ready", value: v }; this.rebuild(); desk.redraw();
    },
      e => { if (current()) { p.backlinks = { kind: "error", message: why(e) }; this.rebuild(); desk.redraw(); } });
  }

  /** An agent never folds away the row the person has selected: that would move their selection. */
  private refuseAgentFold(key: string, i: number) {
    if (this.rows[this.sel]?.key.startsWith(key + SEP)) throw new ActionRefused(`the person's selection is under row ${i + 1}; an agent doesn't fold it away`);
  }

  /**
   * Open (open=true) or fold (false) row `i`, else the other way: a note's children, or a group of links. An
   * agent never folds away the rows the person's selection is in.
   */
  foldRow(i: number, open: boolean | undefined, desk: DeskApi, agent = false): { row: number; open: boolean } {
    const r = this.rows[i];
    if (!r) throw new ActionRefused(`no row ${i + 1}; the tree has ${this.rows.length}`);
    if (r.kind === "branch-note") throw new ActionRefused(`row ${i + 1} is a line of a view's results: ⏎ reads more matches or changes the depth (D); it has nothing to fold`);
    const isOpen = r.kind === "block" ? this.fold.open.has(r.foldId) : r.kind === "group" ? r.open : r.kind === "kind" ? r.expanded : this.panels.has(r.key);
    const want = open ?? !isOpen;
    if (want === isOpen) return { row: i + 1, open: isOpen };
    if (agent && !want) {
      const d = r.depth;
      for (let j = i + 1; j < this.rows.length && this.rows[j]!.depth > d; j++) if (j === this.sel) throw new ActionRefused(`the person's selection is under row ${i + 1}; an agent doesn't fold it away`);
    }
    if (r.kind === "block") void this.expand(r.m, desk, want, r.foldId);
    else if (r.kind === "group" || r.kind === "kind") this.foldGroup(r, want);
    else this.toggleLinks(i, desk, want, agent);
    desk.redraw();
    return { row: i + 1, open: want };
  }

  /** The virtual branch row `i` belongs to: its own row, a match (or a note under one), or a line of its results; null for any other. */
  viewOf(i: number): string | null {
    const r = this.rows[i];
    if (!r) return null;
    if (r.kind === "branch-note") return r.view;
    if (r.kind === "block") return r.via ?? (isBranch(r.m) && this.branches.has(r.m.id) ? r.m.id : null);
    return null;
  }

  /**
   * How far the matches of the virtual branch row `i` belongs to open, for this view (PIE-882): `depth` levels (0 is
   * results only), "authored" for the view's own `[child-depth::]`, else the next of authored, 0, 1, 2, 3. A row that
   * is no view's is refused. Nothing is written: the property stays as its author set it.
   */
  setDepth(i: number, depth: number | "authored" | undefined, desk: DeskApi, agent = false): { view: string; depth: number; authored: boolean } {
    const view = this.viewOf(i);
    const b = view ? this.branches.get(view) : undefined;
    if (!view || !b) throw new ActionRefused(`row ${i + 1} is no virtual branch's: open a note with [type::virtual-branch] and its matches show beneath it`);
    if (depth !== undefined && depth !== "authored" && !(Number.isInteger(depth) && depth >= 0 && depth <= 8)) throw new ActionRefused("depth is 0 (results only) to 8, or authored (the view's own child-depth)");
    const next = depth === "authored" ? undefined : depth ?? DEPTHS[(DEPTHS.indexOf(b.depth) + 1) % DEPTHS.length];
    // An agent never folds away the row the person has selected: a shallower depth would hide it.
    const own = (next ?? (b.read !== "loading" ? b.read.childDepth : undefined) ?? 0);
    const there = this.rows[this.sel];
    if (agent && there?.kind === "block" && there.via === view && there.rel! > own) throw new ActionRefused(`the person's selection is ${there.rel} levels under a match of this view; an agent doesn't set a depth of ${own} over it`);
    b.depth = next;
    this.rebuild(); desk.redraw();
    return { view, depth: this.depthOf(view), authored: b.depth === undefined };
  }

  /** Whether the person's last move of note `id` is newer than the last note they trashed (ctrl+z then means the move). */
  private undoable(id: string, desk: DeskApi): boolean {
    const e = MOVE_UNDO.last("you", id);
    if (!e) return false;
    const trashed = lastTrashed(desk.ctx.board, USER)?.seq;
    return trashed === undefined || (e.seq ?? 0) > trashed;
  }

  /** Whether row `i` is among the rows under row `from` (a note can't be dropped inside itself). */
  private under(i: number, from: number): boolean {
    const d = this.rows[from]?.depth ?? 0;
    for (let j = from + 1; j < this.rows.length && this.rows[j]!.depth > d; j++) if (j === i) return true;
    return false;
  }

  /** The row above `i` that it sits under, or -1. */
  parentRow(i: number): number { const d = this.rows[i]?.depth ?? 0; return this.rows.findLastIndex((r, j) => j < i && r.depth < d); }

  /** Open or fold a group row (Outlinks, Resources, Backlinks, or a backlink kind). */
  private foldGroup(r: TreeRow, open?: boolean) {
    const p = this.panels.get(r.kind === "group" || r.kind === "kind" ? r.owner : "");
    if (!p) return;
    if (r.kind === "group") { if (open ?? !r.open) p.shut.delete(r.group); else p.shut.add(r.group); }
    else if (r.kind === "kind") { if (open ?? !r.expanded) p.kinds.add(r.group.kind); else p.kinds.delete(r.group.kind); }
    this.rebuild();
  }

  /**
   * Something changed in the outline: the lists it may touch are read again (the top level, or the open note it's under),
   * and the links shown are asked again, once per burst. A row's note is what a pick shows in the reader, so a row never
   * keeps the copy read when the tree opened (a note saved here, in Detail or by an agent read as it was). A draft changes none.
   */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (e?.change?.kind === "draft") return;
    const lists = this.touches(e);
    if (!lists && !this.panels.size) return;
    if (lists) this.due = lists === "all" || this.due === "all" ? "all" : new Set([...(this.due ?? []), ...lists]);
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => {
      this.reload = null;
      this.targets.clear();
      for (const k of this.panels.keys()) this.load(k, desk);
      // A virtual branch's matches follow the outline: the pages shown are asked again.
      for (const [id, b] of this.branches) if (this.fold.open.has(id)) void this.loadBranch(b.def, desk, "again");
      void this.reread(desk);
    }, 300);
  }
  /** The lists to read again (a note's id, null for the top level), or all of them; null: none. */
  private due: Set<string | null> | "all" | null = null;
  private rereading = false;
  /**
   * The lists a change can alter: the one its note is in (or was in, before a move), when that list is shown. A change
   * naming no list (a reset, a reconnect, a record without its parent) can alter any.
   */
  private touches(e?: OutlineEvent): Set<string | null> | "all" | null {
    const c = e?.change;
    // An open virtual branch lists what any change may match: it asks them all again.
    if (!c || [...this.branches.keys()].some(id => this.fold.open.has(id))) return "all";
    const roots = this.roots ?? [];
    const lists = new Set<string | null>();
    for (const p of [c.parentId, c.previousParentId]) if (p === null || (p !== undefined && this.fold.kids.has(p))) lists.add(p);
    if (c.parentId === undefined && c.blockId && this.fold.shows(roots, c.blockId)) return "all";
    return lists.size ? lists : null;
  }
  /** Read the lists due again, one round at a time (changes meanwhile make one more); the selection stays on its row. */
  private async reread(desk: DeskApi) {
    if (this.rereading) return;
    this.rereading = true;
    try {
      while (this.due) {
        const due = this.due;
        this.due = null;
        const b = desk.ctx.board;
        const [roots] = await Promise.all([
          due === "all" || due.has(null) ? b.roots().catch(() => null) : null,
          this.fold.reread(id => b.children(idOfFold(id)), due === "all" ? undefined : new Set([...due].filter((x): x is string => x !== null))),
        ]);
        if (roots) this.roots = roots;
        this.rebuild();
        desk.redraw();
      }
    } finally { this.rereading = false; }
  }
  dispose() { if (this.reload) clearTimeout(this.reload); if (this.timer) clearTimeout(this.timer); }

  /**
   * Open row `i` as ⏎ does, as `actor`: a group folds or opens; a note opens where the tree's opens go (the keys
   * follow the person's own there, never an agent's); a resource is registered if it has to be and shown.
   */
  async openRow(i: number, desk: DeskApi, actor: Actor = USER): Promise<Record<string, unknown>> {
    const r = this.rows[i];
    if (!r) throw new ActionRefused(this.roots ? `no row ${i + 1}; the tree has ${this.rows.length}` : "the outline is still being read");
    const agent = actor.kind === "agent";
    if (r.kind === "group" || r.kind === "kind") {
      if (agent && (r.kind === "group" ? r.open : r.expanded)) this.refuseAgentFold(r.key, i);
      this.foldGroup(r); desk.redraw();
      const p = this.panels.get(r.owner);
      return { row: i + 1, open: r.kind === "group" ? !p?.shut.has(r.group) : !!p?.kinds.has(r.group.kind) };
    }
    if (r.kind === "branch-note") {
      const b = this.branches.get(r.view);
      if (r.role === "more" && b) { await this.loadBranch(b.def, desk, "more"); return { row: i + 1, view: r.view, matches: b.items.length }; }
      return { row: i + 1, ...this.setDepth(i, undefined, desk, actor.kind === "agent") };
    }
    const land = (m: Msg) => {
      const routed = desk.routes?.(this);
      desk.setCurrent(m, { from: this, link: true, by: actor });
      if (!routed && !agent) desk.focusKind("reader");
    };
    if (r.kind === "block") { land(r.m); return { row: i + 1, id: r.m.id }; }
    // A link: its note, a ticket's block, or a Resource registered if it must be and shown (the shared model's open).
    if (r.kind === "resource" && !r.link.recordBlockId) desk.ctx.flash(`reading ${r.link.label}…`);
    const { note, registered, ticket } = await linkNote(r, desk.ctx.board, "open", actor, this.panels.get(r.owner)?.blockId);
    land(note);
    if (r.kind !== "resource") return { row: i + 1, id: note.id };
    if (ticket) return { row: i + 1, id: note.id, ticket };
    if (registered) { desk.ctx.flash(`${r.link.label} registered and shown`); this.load(r.owner, desk); }
    return { row: i + 1, resource: note.id.slice("resource:".length), title: subject(note), registered: !!registered };
  }

  /** The person moved the selection to row `i` (a key, a click, `tree.pick`); `show`: its note becomes the current one. */
  selectRow(i: number, desk: DeskApi, show = true) {
    this.picks++;
    this.sel = Math.max(0, Math.min(this.rows.length - 1, i));
    if (show) this.pick(desk); else desk.redraw();
  }

  /** An agent picked row `i`: its note shows where the tree's selection goes; the person's selection stays. */
  async showRow(i: number, desk: DeskApi, actor: Actor): Promise<Record<string, unknown>> {
    const id = rowBlock(this.rows[i]);
    if (!id) throw new ActionRefused(`row ${i + 1} stands for no note: open=true opens a group or shows a resource`);
    const m = await this.target(id, desk);
    if (!m) throw new ActionRefused(`nothing answers at ${shortId(id)}`);
    // Where the tree's selection goes (a desk's previews and link); a view without that, its tree's own preview.
    if (desk.showFrom) desk.showFrom(this, m, actor); else desk.setCurrent(m, { from: this, by: actor });
    return { row: i + 1, id: m.id };
  }

  /**
   * Move the note of row `i` (PIE-943), as `actor`: `undo` puts back its last move; `step` (up, down, in, out) or
   * `to`/`before`/`after` say where (the shared `moveBy`, so a key here, the reader's picker and `act` agree); with none
   * the person is asked in the power bar. The lists it left and joined are read again, a note moved in opens its new
   * parent, and the person's selection follows the note (an agent's leaves it).
   */
  async moveRow(at: number | string, a: Omit<MoveArgs, "id"> & { undo?: boolean }, desk: DeskApi, actor: Actor): Promise<Record<string, unknown>> {
    // A row of the tree, or (act's id= for a note the tree isn't showing) a note by its id.
    const r = typeof at === "number" ? this.rows[at] : undefined;
    if (typeof at === "number") {
      if (!r) throw new ActionRefused(this.roots ? `no row ${at + 1}; the tree has ${this.rows.length}` : "the outline is still being read");
      if (r.kind !== "block") throw new ActionRefused(`row ${at + 1} is ${r.kind === "resource" ? "a resource" : r.kind === "branch-note" ? "a line of a view's results" : "a link or a group"}: only a note moves`);
    }
    const pickedAtStart = this.picks;
    const id = r?.kind === "block" ? r.m.id : String(at), board = desk.ctx.board as WriteBoard, agent = actor.kind === "agent";
    const finish = async (done: MoveDone) => {
      this.due = new Set([...(this.due instanceof Set ? this.due : []), done.previousParent, done.parent]);
      await this.reread(desk);
      // Moved into another note that's in sight (a step in, a drop on a row): it opens, so the note is seen where it went.
      const into = !agent && done.parent && done.parent !== done.previousParent ? this.rows.find(x => x.kind === "block" && x.m.id === done.parent && !x.via) : undefined;
      if (into && into.kind === "block") await this.expand(into.m, desk, true, into.foldId);
      const j = this.rows.findIndex(x => x.kind === "block" && x.m.id === id && x.via === undefined);
      // (Not if the person moved the selection while this was read.)
      if (j >= 0 && !agent && this.picks === pickedAtStart) this.sel = j;
      desk.ctx.flash(done.said);
      desk.redraw();
      return { row: j + 1, ...done };
    };
    if (a.undo) return finish(await undoMove(board, actor, id));
    const { undo: _, ...where } = a;
    const revision = where.revision ?? (r?.kind === "block" ? r.m.revision : undefined);
    if ([where.to, where.before, where.after, where.step].some(x => x !== undefined)) return finish(await moveNote(board, id, intentOf(where), actor, { revision }));
    if (agent) throw new ActionRefused("say where: step=up|down|in|out, to=<inbox, root, or a note's id, ((ref)), [[page]], Work ID>, before= or after=");
    return askInBar(desk.ctx as never, "Move the note", [moveQuestion(id)], {}, actor, answers => moveNote(board, id, intentOf({ ...where, to: answers.to! }), actor, { revision }).then(finish)) as Promise<Record<string, unknown>>;
  }

  /** The rows in words, numbered from 1, as agents pick them. */
  describe() {
    const r = this.rows[this.sel];
    return {
      selected: r ? { n: this.sel + 1, kind: r.kind, key: r.key, id: rowBlock(r) ?? undefined, text: rowWords(r, this.panels.has(r.key)).text } : null,
      linksShown: [...this.panels.entries()].map(([key, p]) => ({ row: this.rows.findIndex(x => x.key === key) + 1, id: p.blockId })).filter(p => p.row > 0),
      rows: this.rows.slice(0, 400).map((x, i) => {
        const w = rowWords(x, this.panels.has(x.key));
        return { n: i + 1, depth: x.depth, kind: x.kind, text: w.text, ...(w.context ? { context: w.context } : {}), ...(rowBlock(x) ? { id: rowBlock(x) } : {}), ...(x.kind === "block" && x.via ? { matchOf: x.via, ...(x.rel === 0 ? { match: true } : {}) } : {}), ...(x.kind === "branch-note" ? { view: x.view, role: x.role } : {}), ...(this.panels.has(x.key) ? { links: true } : {}), ...(i === this.sel ? { selected: true } : {}) };
      }),
      ...(this.rows.length > 400 ? { more: this.rows.length - 400 } : {}),
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.drawnW = w; this.drawnH = h;
    if (!this.roots) return { lines: [dim("dialing the outline…")] };
    this.view.place(this.sel, this.rows.length, h);
    const lines = this.rows.slice(this.view.top, this.view.top + h).map((r, i) => {
      const on = this.view.top + i === this.sel;
      const indent = "  ".repeat(r.depth);
      if (r.kind === "branch-note") {
        const text = `${indent}${r.role === "results" ? "◇ " : r.role === "more" ? "▸ " : "  "}${r.text}`;
        return on ? selectedRow(text, w, focused) : fg(r.role === "more" ? C.lcyan : C.dark) + pad(text, w) + RESET;
      }
      if (r.kind === "block") {
        const k = this.fold.kids.get(r.foldId);
        // A match past the view's child-depth has nothing under it to open; a view always may (its matches follow its children).
        const capped = r.via !== undefined && r.rel! >= this.depthOf(r.via);
        const leaf = (Array.isArray(k) && k.length === 0 && !this.panels.has(r.key) && !isBranch(r.m)) || (capped && !this.panels.has(r.key));
        const mark = k === "loading" ? "…" : leaf ? (r.via !== undefined && r.rel === 0 ? "◇" : "·") : this.fold.open.has(r.foldId) || this.panels.has(r.key) ? "▾" : "▸";
        const branch = !r.via && isBranch(r.m) ? this.branches.get(r.m.id) : undefined;
        const found = branch && branch.read !== "loading" && branch.read.status === "ready" ? `V:${branch.read.total ?? branch.items.length}` : "";
        const tag = (found || (prop(r.m, "work-id") ?? prop(r.m, "status") ?? prop(r.m, "type") ?? "")).slice(0, 14);
        const room = Math.max(4, w - (tag ? tag.length + 1 : 0));
        if (on) return selectedRow(pad(`${indent}${mark} ${subject(r.m)}`, room - (indent ? 0 : 1)) + (tag ? " " + tag : ""), w, focused);
        const here = desk.current?.id === r.m.id;
        return pad(`${indent}${fg(C.lcyan)}${mark} ${fg(here ? C.yellow : r.via !== undefined && r.rel === 0 ? C.lgreen : C.grey)}${subject(r.m)}`, room) + (tag ? " " + fg(C.brown) + tag : "") + RESET;
      }
      return linkRowLine(r, { cols: w, selected: on, focused, nest: this.panels.has(r.key) });
    });
    // A note being dragged (PIE-943): the row it would land on says how, and which note it is.
    const d = this.drag;
    const at = d?.over != null ? d.over - this.view.top : -1;
    if (d && d.moved && at >= 0 && at < lines.length) {
      const target = this.rows[d.over!], dragged = this.rows.find(x => x.kind === "block" && x.m.id === d.id);
      if (target?.kind === "block" && dragged?.kind === "block") {
        const how = d.beside ? (d.over! < d.from ? "above" : "below") : "under";
        lines[at] = fg(C.black) + "\x1b[43m" + pad(`${"  ".repeat(target.depth)}→ ${how} ${subject(target.m)}  ← ${subject(dragged.m).slice(0, 30)}`, w) + RESET;
      }
    }
    return { lines };
  }

  // ── keys and the mouse ─────────────────────────────────────────────────────

  private run(desk: DeskApi, name: "tree.links" | "tree.pick" | "tree.fold" | "tree.depth" | "tree.move", args: Record<string, unknown>) { runOwn(TREE_ACTIONS, name, args, { pane: this, desk }); }

  key(k: Key, desk: DeskApi): boolean {
    const row = this.rows[this.sel], n = this.rows.length;
    const pickTo = (i: number) => { const to = Math.max(0, Math.min(n - 1, i)); if (n && to !== this.sel) this.run(desk, "tree.pick", { n: to + 1 }); return true; };
    if (isUp(k)) return pickTo(this.sel - 1);
    if (isDown(k)) return pickTo(this.sel + 1);
    if (k.kind === "pgup") return pickTo(this.sel - 15);
    if (k.kind === "pgdn") return pickTo(this.sel + 15);
    if (k.kind === "home") return pickTo(0);
    if (k.kind === "end") return pickTo(n - 1);
    if (!row) return false;
    // alt+↑ alt+↓ put the note up or down among its siblings (as in a reader, the board's lanes and the Welcome list); K and J do
    // too, for a terminal that doesn't send Option+arrows (a Mac's); I moves it in under the note above, O out after its parent.
    // alt+← alt+→ are never move keys: a reader reads them as back and forward. Tab is the tiles', Cmd the terminal's.
    const c = ch(k);
    const step = k.kind === "alt-up" || c === "K" ? "up" : k.kind === "alt-down" || c === "J" ? "down" : c === "I" ? "in" : c === "O" ? "out" : undefined;
    if (step) { if (row.kind === "block") this.run(desk, "tree.move", { n: this.sel + 1, step }); return true; }
    if (ch(k) === "Z" && row.kind === "block") { this.run(desk, "tree.move", { n: this.sel + 1 }); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "z" && row.kind === "block" && this.undoable(row.m.id, desk)) { this.run(desk, "tree.move", { n: this.sel + 1, undo: true }); return true; }
    if (ch(k) === "L") { this.run(desk, "tree.links", { n: this.sel + 1 }); return true; }
    const right = k.kind === "right" || ch(k) === "l", left = k.kind === "left" || ch(k) === "h", space = ch(k) === " ";
    const linkRow = row.kind !== "block" && row.kind !== "group" && row.kind !== "kind";
    if (ch(k) === "D") { this.run(desk, "tree.depth", { n: this.sel + 1 }); return true; }
    if (row.kind === "branch-note") {
      if (k.kind === "enter" || space || right) { this.run(desk, "tree.pick", { n: this.sel + 1, open: true }); return true; }
      if (left) { const p = this.parentRow(this.sel); if (p >= 0) this.run(desk, "tree.pick", { n: p + 1 }); return true; }
      return false;
    }
    const open = row.kind === "block" ? this.fold.open.has(row.foldId) : row.kind === "group" ? row.open : row.kind === "kind" ? row.expanded : this.panels.has(row.key);
    // A note's children, a group of links, a link's own links (one hop, as the Tree's ▸): → l open, ← h fold, space either way.
    const foldable = !linkRow || !!rowBlock(row);
    if (foldable && (space || (right && !open) || (left && open))) {
      if (linkRow) this.run(desk, "tree.links", { n: this.sel + 1, show: space ? !open : right });
      else this.run(desk, "tree.fold", { n: this.sel + 1, ...(space ? {} : { open: right }) });
      return true;
    }
    if (left) { const p = this.parentRow(this.sel); if (p >= 0) this.run(desk, "tree.pick", { n: p + 1 }); return true; }
    if (right || space) return true;
    // ⏎ opens it: in the tile this one links to (PIE-473), else as the current note, the keys to a reader.
    if (k.kind === "enter") { this.run(desk, "tree.pick", { n: this.sel + 1, open: true }); return true; }
    return false;
  }

  /**
   * A press on a row escalates as the keys do (RowView.press): a click selects it (its note shows where the tree's
   * selection goes, as j k), a double click opens it (⏎), an alt-, ctrl- or middle-click opens it too (the tree's
   * opens have no "fresh"); a press that gave the tree the keys only selects. A click on a row's mark folds or
   * unfolds it (a note's children, a group, a link's own links) at once, as its disclosure.
   */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.wheel(k.action === "wheel-up" ? -1 : 1, desk); return true; }
    // A note dragged (PIE-943): over another row it goes under it, with alt held beside it (above it when that row is
    // above where it started, else below); let go on its own row it was a click, and the press already did that.
    if (this.viaPressed && k.action === "drag") { this.viaPressed = false; desk.ctx.flash("that row is a match of a view, not the note: drag the note from its own place in the outline"); return true; }
    const d = this.drag;
    if (d && (k.action === "drag" || k.action === "up")) {
      // Let go outside the tile (over the reader beside it) moves nothing.
      const inside = x >= 0 && x < this.drawnW && y >= 0 && y < this.drawnH;
      const over = this.view.top + y, target = inside ? this.rows[over] : undefined;
      d.over = target?.kind === "block" && target.m.id !== d.id && !this.under(over, d.from) ? over : null;
      // Dropped on the row: under it. On its ▸ mark (the left edge): beside it, above it when it's above where the note started, else below.
      d.beside = !!target && x <= (target.depth * 2 + 1);
      if (k.action === "drag") { d.moved = d.moved || over !== d.from; desk.redraw(); return true; }
      this.drag = null;
      if (d.over !== null && target?.kind === "block") {
        const to = target.m.id;
        this.run(desk, "tree.move", { id: d.id, ...(d.beside ? { [d.over < d.from ? "before" : "after"]: to } : { to }) });
      }
      desk.redraw();
      return true;
    }
    if (k.action !== "down") return true;
    const i = this.view.top + y, row = this.rows[i];
    if (!row) return true;
    // A match of a view is a copy of the note, not the note: only the note's own row drags.
    this.viaPressed = row.kind === "block" && !!row.via;
    if (row.kind === "block" && k.button === 0 && !row.via) this.drag = { id: row.m.id, from: i, over: null, beside: false, moved: false };
    // The press that starts a drag (PIE-943) never opens on a slow second click: the tree keeps the double click.
    const gesture = this.view.press(i, press ?? { mods: k.mods ?? 0, button: k.button });
    if (i !== this.sel) this.run(desk, "tree.pick", { n: i + 1 });
    const onMark = x <= row.depth * 2 + 1;
    const nests = row.kind === "block" || row.kind === "group" || row.kind === "kind" || !!rowBlock(row);
    if (onMark && nests && gesture !== "focus") {
      if (row.kind === "block" || row.kind === "group" || row.kind === "kind") this.run(desk, "tree.fold", { n: i + 1 });
      else this.run(desk, "tree.links", { n: i + 1 });
      return true;
    }
    if (gesture === "open" || gesture === "fresh") this.run(desk, "tree.pick", { n: i + 1, open: true });
    return true;
  }

  wheel(dir: 1 | -1, desk: DeskApi) { const to = this.sel + dir; if (to >= 0 && to < this.rows.length) this.run(desk, "tree.pick", { n: to + 1 }); }
}

/** A tree's actions: which row is picked (and opened), and the links shown under a row. */
export interface TreeOn { pane: TreePane; desk: DeskApi }

/** Row `n` (from 1), or the first row that stands for block `id` (or its start), or the selected row. */
function rowOf(pane: TreePane, n: number | undefined, id: string | undefined): number {
  if (n !== undefined) return n - 1;
  if (id !== undefined) {
    const i = pane.list().findIndex(r => rowBlock(r)?.startsWith(id));
    if (i < 0) throw new ActionRefused(`no row for ${id} in the tree: open its parents first, or peek for the rows`);
    return i;
  }
  return pane.selectedRow;
}

export const TREE_ACTIONS = actionSet<TreeOn>()("tree", {
  "tree.fold": def({
    summary: "open (open=true) or fold (open=false) a row of the outline tree, else the other way: a note's children, a group of links. n (from 1) or id, else the selected row. An agent's never folds away the rows the person's selection is in",
    keys: "l → space h ←, click on a row's mark",
    touches: "nothing", replay: "safe", says: r => `${r.open ? "opened" : "folded"} row ${r.row} of the outline`,
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a block id (or its start): the first row that stands for it" },
      open: { type: "boolean", optional: true, about: "true opens, false folds; left out, the other way" },
    },
    examples: [
      { act: "tree.fold tile=tree n=3 open=true", does: "opens row 3 of the outline tree, showing its children" },
      { act: "tree.fold tile=tree id=7d9a1f40 open=false", does: "folds the row for that note, hiding its children" },
    ],
    run({ n, id, open }, { pane, desk }, actor) {
      const i = rowOf(pane, n, id);
      return pane.foldRow(i, open, desk, actor.kind === "agent");
    },
  }),
  "tree.depth": def({
    summary: "set how far the matches of a virtual branch open in the outline tree (tile=<its name>): depth=0 is results only, 1 to 8 levels of children under each match, authored the view's own [child-depth::]; left out, the next of authored, 0, 1, 2, 3. n or id is the view's row, one of its matches, or a line of its results, else the selected row. A view that isn't open has no matches to set. Writes nothing: the view's property stays as its author set it",
    keys: "D · ⏎ or a click on the results line",
    touches: "nothing", replay: "safe", says: r => `${r.authored ? "the view's own depth" : `depth ${r.depth}`} for the matches of ${r.view.slice(0, 8)}`,
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a block id (or its start): the first row that stands for it" },
      depth: { type: "string", optional: true, about: "0 to 8, or authored; left out, the next step" },
    },
    examples: [
      { act: "tree.depth tile=tree n=2 depth=1", does: "shows one level of children under each match of the view on row 2" },
      { act: "tree.depth tile=tree n=2 depth=authored", does: "goes back to the depth the view itself sets (its child-depth)" },
    ],
    run({ n, id, depth }, { pane, desk }, actor) {
      const d = depth === undefined || depth === "" ? undefined : depth === "authored" ? "authored" as const : Number(depth);
      if (typeof d === "number" && Number.isNaN(d)) throw new ActionRefused("depth is 0 to 8, or authored");
      return pane.setDepth(rowOf(pane, n, id), d, desk, actor.kind === "agent");
    },
  }),
  "tree.links": def({
    summary: "show or hide the authored links under a row of the outline tree (tile=<its name>), as the outliner's Tree does: its outlinks, resources and backlinks, grouped; n (as peek's rows, from 1) or id, else the selected row; show=true or false, else the other way. Registers nothing",
    keys: "L · l → space on a link · a click on a link's mark",
    touches: "nothing", replay: "safe", says: r => `${r.shown ? "showed" : "hid"} the links under row ${r.row}`,
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a block id (or its start): the first row that stands for it" },
      show: { type: "boolean", optional: true, about: "true shows, false hides; left out, the other way" },
    },
    examples: [
      { act: "tree.links tile=tree n=4 show=true", does: "lists the links, resources and backlinks under row 4" },
    ],
    run({ n, id, show }, { pane, desk }, actor) {
      const i = rowOf(pane, n, id);
      return { row: i + 1, shown: pane.toggleLinks(i, desk, show, actor.kind === "agent") };
    },
  }),
  "tree.move": def({
    summary: "move the note of a row of the outline tree (tile=<its name>): n (from 1) or id, else the selected row; step=up or down (one place among its siblings), in (last under the note above it) or out (right after its parent), or to= (inbox, root, an id, ((ref)), [[page]] or Work ID; position= its place among the children, from 1, default first), before= or after= a sibling, or undo=true (puts its last move back). With none of them the person is asked in the power bar (\"Move to…\"). The shared note move (note.move): the service's move, revision= checked when given, recorded as who asks; the lists it left and joined are read again, a note moved into one in sight opens it, and the person's selection follows it (an agent's never moves it)",
    keys: "alt+up alt+down or K J (up, down), I (in), O (out), Z (move to…), ctrl+z (undo), a drag onto a row (under it; onto its ▸ mark: above or below it)",
    touches: "nothing", replay: "ask", says: r => String((r as { said?: string }).said ?? "moved a note"),
    menu: [
      { label: "move up", group: "Outline", key: "K", args: { step: "up" }, now: (host, _t) => host.pane.selected() ? undefined : { hide: true } },
      { label: "move down", group: "Outline", key: "J", args: { step: "down" }, now: (host, _t) => host.pane.selected() ? undefined : { hide: true } },
      { label: "indent (in under the note above)", group: "Outline", key: "I", args: { step: "in" }, now: (host, _t) => host.pane.selected() ? undefined : { hide: true } },
      { label: "outdent (out to its parent's level)", group: "Outline", key: "O", args: { step: "out" }, now: (host, _t) => host.pane.selected() ? undefined : { hide: true } },
      { label: "move to…", group: "Outline", key: "Z", now: (host, _t) => host.pane.selected() ? undefined : { hide: true } },
    ],
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a block id (or its start): the first row that stands for it" },
      step: { type: "string", optional: true, about: "up, down, in or out" },
      to: { type: "string", optional: true, about: "under this note: inbox, root, or an id, ((ref)), [[page]] or Work ID" },
      before: { type: "string", optional: true, about: "a sibling to go just above" },
      after: { type: "string", optional: true, about: "a sibling to go just below" },
      position: { type: "number", optional: true, about: "with to=: its place among the children, from 1 (default first)" },
      revision: { type: "number", optional: true, about: "the note's revision as you read it; one changed since is refused" },
      undo: { type: "boolean", optional: true, about: "put its last move back" },
    },
    examples: [
      { act: "tree.move tile=tree id=7d9a1f40 step=up", does: "moves that note one place up among its siblings" },
      { act: "tree.move tile=tree n=5 to=inbox", does: "moves the note on row 5 under the inbox, first among its children" },
    ],
    run({ n, id, undo, ...where }, { pane, desk }, actor) {
      const i = n === undefined && id !== undefined ? pane.list().findIndex(r => rowBlock(r)?.startsWith(id)) : rowOf(pane, n, id);
      return pane.moveRow(i >= 0 ? i : id!, { ...where, ...(undo ? { undo } : {}) }, desk, actor);
    },
  }),
  "tree.pick": def({
    summary: "pick a row of the outline tree: n (from 1) or id. As the person: the selection moves there; open=true opens it as ⏎ does (a note where the tree's opens go, a group folds, a resource is registered if it must be and its stored content shown). An agent's never moves the person's selection or keys: its pick shows the row's note where the tree's selection goes, its open opens it there",
    keys: "j k ↑ ↓ PgUp PgDn Home End h ← (to the row above), click, wheel (pick) · ⏎, double click, alt- ctrl- or middle-click (open)",
    // open=true may register a resource and opens a note: a restarted door asks first (replay is per action).
    touches: "nothing", replay: "ask", says: (r, a) => `${a.open ? "opened" : "picked"} row ${r.row} of the outline`,
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a block id (or its start): the first row that stands for it" },
      open: { type: "boolean", optional: true, about: "open it, as ⏎ does" },
    },
    examples: [
      { act: "tree.pick tile=tree n=2", does: "picks row 2: the person's selection moves there; an agent's shows its note" },
      { act: "tree.pick tile=tree id=7d9a1f40 open=true", does: "opens that note where the tree's opens go" },
    ],
    async run({ n, id, open }, { pane, desk }, actor) {
      const i = rowOf(pane, n, id);
      if (!pane.list()[i]) throw new ActionRefused(`no row ${i + 1}; the tree has ${pane.list().length}`);
      // The person's pick moves their selection; an agent's is its own: the row's note shown where the tree's selection goes.
      const agent = actor.kind === "agent";
      if (!agent) pane.selectRow(i, desk, !open);
      return open ? pane.openRow(i, desk, actor) : agent ? pane.showRow(i, desk, actor) : { row: i + 1, id: rowBlock(pane.list()[i]) ?? undefined };
    },
  }),
});
