// The outline tree (a desk tile, the board's outline drawer), with the authored links the outliner's Tree
// shows under a block (PIE-259, PIE-324, PIE-329): `L` (`tree.links`) opens, under the selected row, its
// Outlinks and Resources (the service's `blocks.authored-links`) and its Backlinks (`references.backlinks`,
// grouped by kind as Detail groups them through src/backlinks.ts). Each group opens and folds; an outlink or
// a backlink to a block can show its own links beneath it, one hop per request, as the Tree does. ⏎ or a click
// on a link opens its note where the tree's opens go; on a resource it shows the Resource's stored content
// there (registering it first when it isn't, and fetching it once when nothing is stored: src/authored.ts).
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
import { C, dim, fg, pad, RESET, selected } from "../style";
import { Fold } from "../fold";
import { RowView, type RowPress } from "../scroll";
import { ch, isUp, isDown, type Key } from "../term";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";


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
export type TreeRow = { kind: "block"; key: string; depth: number; m: Msg } | (LinkRow & { owner: string });

/** The block a row stands for: a tree row's note, a resolved outlink's target, a backlink's source. */
export function rowBlock(r: TreeRow | undefined): string | null {
  if (!r) return null;
  return r.kind === "block" ? r.m.id : linkBlock(r);
}

/** A row as words: its mark, its text and its dim context (`peek`, agents, and the drawing). */
export function rowWords(r: TreeRow, panelOpen: boolean): { mark: string; text: string; context: string; problem?: boolean } {
  return r.kind === "block" ? { mark: "", text: subject(r.m), context: "" } : linkWords(r, panelOpen);
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
  private rows: TreeRow[] = [];
  private sel = 0;
  private view = new RowView();
  private timer: Timer | null = null;
  private reload: Timer | null = null;
  title() { return "outline"; }
  hint() {
    const r = this.rows[this.sel];
    if (r && r.kind !== "block") return r.kind === "resource" ? "⏎ show the resource · h back" : r.kind === "group" || r.kind === "kind" ? "⏎ space fold · h back" : "⏎ open · l its links · h back";
    return "←→ fold · ⏎ read · L links";
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
    this.loaded = desk.ctx.board.roots().then(r => {
      this.roots = r; this.rebuild();
      if (!desk.current && r[0]) desk.setCurrent(r[0], { from: this });
      desk.redraw();
    }, () => {});
  }

  private rebuild() {
    const was = this.rows[this.sel]?.key, wasDepth = this.rows[this.sel]?.depth;
    const out: TreeRow[] = [];
    this.fold.walk(this.roots ?? [], (m, depth) => { const key = `b:${m.id}`; out.push({ kind: "block", key, depth, m }); this.panelRows(key, depth + 1, out); });
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

  /** The groups under `owner` (a row's key) when its links are shown (the shared links model), and theirs beneath rows that show theirs. */
  private panelRows(owner: string, depth: number, out: TreeRow[]) {
    const p = this.panels.get(owner);
    if (!p) return;
    for (const r of linkRows(p, { shut: p.shut, kinds: p.kinds, backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS }, owner + SEP, depth)) {
      out.push({ ...r, owner });
      if (r.kind !== "group" && r.kind !== "kind") this.panelRows(r.key, r.depth + 1, out);
    }
  }

  private expand(m: Msg, desk: DeskApi, on = true): Promise<void> {
    return this.fold.show(m.id, on, id => desk.ctx.board.children(id), () => { this.rebuild(); desk.redraw(); });
  }

  /** The selection moved to row `sel`: the row's note becomes the current one (a link row's is read first). */
  private pick(desk: DeskApi) {
    if (this.timer) clearTimeout(this.timer);
    const r = this.rows[this.sel];
    const id = r?.kind === "block" ? null : rowBlock(r);
    if (r?.kind === "block") this.timer = setTimeout(() => desk.setCurrent(r.m, { from: this }), 90);
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
    const isOpen = r.kind === "block" ? this.fold.open.has(r.m.id) : r.kind === "group" ? r.open : r.kind === "kind" ? r.expanded : this.panels.has(r.key);
    const want = open ?? !isOpen;
    if (want === isOpen) return { row: i + 1, open: isOpen };
    if (agent && !want) {
      const d = r.depth;
      for (let j = i + 1; j < this.rows.length && this.rows[j]!.depth > d; j++) if (j === this.sel) throw new ActionRefused(`the person's selection is under row ${i + 1}; an agent doesn't fold it away`);
    }
    if (r.kind === "block") void this.expand(r.m, desk, want);
    else if (r.kind === "group" || r.kind === "kind") this.foldGroup(r, want);
    else this.toggleLinks(i, desk, want, agent);
    desk.redraw();
    return { row: i + 1, open: want };
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

  /** Something changed in the outline: the links shown are asked again (once per burst). A draft changes none. */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (!this.panels.size || e?.change?.kind === "draft") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; this.targets.clear(); for (const k of this.panels.keys()) this.load(k, desk); }, 500);
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
    const land = (m: Msg) => {
      const routed = desk.routes?.(this);
      desk.setCurrent(m, { from: this, link: true, by: actor });
      if (!routed && !agent) desk.focusKind("reader");
    };
    if (r.kind === "block") { land(r.m); return { row: i + 1, id: r.m.id }; }
    // A link: its note, a ticket's block, or a Resource registered if it must be and shown (the shared model's open).
    if (r.kind === "resource" && !r.link.recordBlockId) desk.ctx.flash(`reading ${r.link.label}…`);
    const { note, registered, ticket } = await linkNote(r, desk.ctx.board, "open", actor);
    land(note);
    if (r.kind !== "resource") return { row: i + 1, id: note.id };
    if (ticket) return { row: i + 1, id: note.id, ticket };
    if (registered) { desk.ctx.flash(`${r.link.label} registered and shown`); this.load(r.owner, desk); }
    return { row: i + 1, resource: note.id.slice("resource:".length), title: subject(note), registered: !!registered };
  }

  /** The person moved the selection to row `i` (a key, a click, `tree.pick`); `show`: its note becomes the current one. */
  selectRow(i: number, desk: DeskApi, show = true) {
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
    if (desk.showFrom) desk.showFrom(this, m); else desk.setCurrent(m, { from: this, by: actor });
    return { row: i + 1, id: m.id };
  }

  /** The rows in words, numbered from 1, as agents pick them. */
  describe() {
    const r = this.rows[this.sel];
    return {
      selected: r ? { n: this.sel + 1, kind: r.kind, key: r.key, id: rowBlock(r) ?? undefined, text: rowWords(r, this.panels.has(r.key)).text } : null,
      linksShown: [...this.panels.entries()].map(([key, p]) => ({ row: this.rows.findIndex(x => x.key === key) + 1, id: p.blockId })).filter(p => p.row > 0),
      rows: this.rows.slice(0, 400).map((x, i) => {
        const w = rowWords(x, this.panels.has(x.key));
        return { n: i + 1, depth: x.depth, kind: x.kind, text: w.text, ...(w.context ? { context: w.context } : {}), ...(rowBlock(x) ? { id: rowBlock(x) } : {}), ...(this.panels.has(x.key) ? { links: true } : {}), ...(i === this.sel ? { selected: true } : {}) };
      }),
      ...(this.rows.length > 400 ? { more: this.rows.length - 400 } : {}),
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    if (!this.roots) return { lines: [dim("dialing the outline…")] };
    this.view.place(this.sel, this.rows.length, h);
    const lines = this.rows.slice(this.view.top, this.view.top + h).map((r, i) => {
      const on = this.view.top + i === this.sel;
      const indent = "  ".repeat(r.depth);
      if (r.kind === "block") {
        const k = this.fold.kids.get(r.m.id);
        const leaf = Array.isArray(k) && k.length === 0 && !this.panels.has(r.key);
        const mark = k === "loading" ? "…" : leaf ? "·" : this.fold.open.has(r.m.id) || this.panels.has(r.key) ? "▾" : "▸";
        const tag = (r.m.props["work-id"] ?? r.m.props.status ?? r.m.props.type ?? "").slice(0, 14);
        const room = Math.max(4, w - (tag ? tag.length + 1 : 0));
        if (on) return selected(focused) + pad(`${indent}${mark} ${subject(r.m)}`, room) + (tag ? " " + tag : "") + RESET;
        const here = desk.current?.id === r.m.id;
        return pad(`${indent}${fg(C.lcyan)}${mark} ${fg(here ? C.yellow : C.grey)}${subject(r.m)}`, room) + (tag ? " " + fg(C.brown) + tag : "") + RESET;
      }
      return linkRowLine(r, { cols: w, selected: on, focused, nest: this.panels.has(r.key) });
    });
    return { lines };
  }

  // ── keys and the mouse ─────────────────────────────────────────────────────

  private run(desk: DeskApi, name: "tree.links" | "tree.pick" | "tree.fold", args: Record<string, unknown>) { runOwn(TREE_ACTIONS, name, args, { pane: this, desk }); }

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
    if (ch(k) === "L") { this.run(desk, "tree.links", { n: this.sel + 1 }); return true; }
    const right = k.kind === "right" || ch(k) === "l", left = k.kind === "left" || ch(k) === "h", space = ch(k) === " ";
    const linkRow = row.kind !== "block" && row.kind !== "group" && row.kind !== "kind";
    const open = row.kind === "block" ? this.fold.open.has(row.m.id) : row.kind === "group" ? row.open : row.kind === "kind" ? row.expanded : this.panels.has(row.key);
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
    if (k.action !== "down") return true;
    const i = this.view.top + y, row = this.rows[i];
    if (!row) return true;
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
    run({ n, id, open }, { pane, desk }, actor) {
      const i = rowOf(pane, n, id);
      return pane.foldRow(i, open, desk, actor.kind === "agent");
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
    run({ n, id, show }, { pane, desk }, actor) {
      const i = rowOf(pane, n, id);
      return { row: i + 1, shown: pane.toggleLinks(i, desk, show, actor.kind === "agent") };
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
