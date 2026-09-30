// Backlinks as a tile (PIE-432, PIE-442): the notes that link to what another tile shows (its `source`, a
// tile's name), grouped, filtered and sorted as Detail does through src/backlinks.ts. Moving the selection,
// or giving the tile the keys, shows the selected source where this tile's selection goes (a preview
// following it, or its link) without moving the current note (so the tile it lists the backlinks of stays
// put); ⏎ or a click opens it, and alt+⏎ or a ctrl- or alt-click opens it "fresh", as a link's alt+⏎ does.
//
// The rows and the status line are drawn by `backlinkRowLine` and `layoutBacklinkStatus`, which the board's
// backlinks drawer draws with too: one drawing of Detail's view, not two.
import { isOutlineNote } from "../authored";
import { subject, type Msg } from "../board";
import {
  backlinkOptionsFrom, backlinkRowSuffix, backlinkRows, backlinkStageSummary, backlinkStatusParts, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS,
  describeBacklinkView, fitBacklinkRow, nextBacklinkKindFilter, nextBacklinkSort, nextBacklinkStageFilter,
  type BacklinkCollection, type BacklinkControl, type BacklinkRow, type BacklinkStatusPart, type BacklinkViewOptions,
} from "../backlinks";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, agentLabel } from "../surface/actions";
import { bg, C, fg, pad, RESET, width } from "../style";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";

const SEL = bg(C.blue) + fg(C.white);

/** One piece of the status line as placed: at x, y in the list's cells, `cols` wide (clipped), a control or not. */
export interface StatusSeg { x: number; y: number; text: string; cols: number; sgr: string; control?: BacklinkControl }

/**
 * The status line's parts laid out in `cols`, wrapping between parts (the " ·" stays at the end of the line)
 * onto at most `maxRows` lines, so every control stays on screen. `sgrOf` colours a part.
 */
export function layoutBacklinkStatus(parts: readonly BacklinkStatusPart[], cols: number, maxRows: number, sgrOf: (p: BacklinkStatusPart) => string): { segs: StatusSeg[]; rows: number } {
  const segs: StatusSeg[] = [];
  let x = 0, y = 0;
  const put = (text: string, sgr: string, control?: BacklinkControl) => {
    const room = cols - x;
    if (room <= 0) return;
    segs.push({ x, y, text, cols: Math.min(room, width(text)), sgr, ...(control ? { control } : {}) });
    x += width(text);
  };
  parts.forEach((p, i) => {
    if (i && x + 3 + width(p.text) > cols && y + 1 < maxRows) { if (x + 2 <= cols) put(" ·", fg(C.dark)); x = 0; y += 1; }
    else if (i) put(" · ", fg(C.dark));
    put(p.text, sgrOf(p), p.control);
  });
  return { segs, rows: y + 1 };
}

/** One row as drawn: a kind group's header (its count and stages), or a source with its dim suffix. */
export function backlinkRowLine(row: BacklinkRow, o: { selected: boolean; focused: boolean; faceted: boolean; cols: number }): string {
  const on = o.selected ? (o.focused ? SEL : bg(C.dark) + fg(C.white)) : "";
  if (row.kind === "group") {
    const g = row.group;
    const head = ` ${row.expanded ? "−" : "+"} ${g.label} ${g.sources.length}`;
    return on + (o.selected ? "" : fg(C.yellow)) + head + (o.selected ? "" : fg(C.grey)) + pad(backlinkStageSummary(g), Math.max(0, o.cols - width(head))) + RESET;
  }
  const indent = o.faceted ? "   " : " ";
  const f = fitBacklinkRow(row.source.title, backlinkRowSuffix(row.source), o.cols - indent.length);
  const tail = f.suffix ? `${o.selected ? "" : fg(C.dark)} — ${f.suffix}` : "";
  return on + (o.selected ? "" : fg(C.white)) + pad(`${indent}${f.title}${tail}`, o.cols) + RESET;
}

const rowKey = (r: BacklinkRow | undefined) => (r ? (r.kind === "group" ? `g:${r.group.kind}` : `s:${r.source.blockId}`) : undefined);
const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");

/** How a picked source opens: shown where the selection goes (moving), opened (⏎, a click), or fresh (alt+⏎). */
export type PickHow = "show" | "open" | "fresh";

export class BacklinksPane implements Pane {
  readonly kind = "backlinks" as const;
  /** The note whose backlinks are listed (what the source tile shows), and what the service sent for it. */
  target: Msg | null = null;
  data: BacklinkCollection | null = null;
  problem = "";
  /** The selected row, and the first row drawn. */
  sel = 0;
  private top = 0;
  options: BacklinkViewOptions = { ...DEFAULT_BACKLINK_VIEW_OPTIONS };
  expanded = new Set<string>();
  /** The status line's controls as last drawn (for clicks), and how many rows it took. */
  private controls: StatusSeg[] = [];
  private head = 1;
  private reload: Timer | null = null;
  private asked = 0;
  private openedFor: string | null = null;
  /** Given the keys before its rows were read: the selected row shows once they are (and as whom). */
  private showOnLoad: Actor | null = null;

  /**
   * `source`: the tile whose note's backlinks this lists. `openGroups`: every kind group starts open (a screen
   * with room for only a few rows, where a folded "+ Note 2" would hide the only links); Detail's default,
   * folded, otherwise.
   */
  constructor(public source: string, readonly openGroups = false) {}

  title() {
    if (!this.target) return `backlinks · of ${this.source}`;
    const n = this.data ? ` · ${this.data.sources.length} source${this.data.sources.length === 1 ? "" : "s"}` : " · …";
    return `backlinks · ${subject(this.target).slice(0, 50)}${n}`;
  }
  hint() { return "j k pick · ⏎ open · alt+⏎ fresh · s K w h n . view"; }
  spec() { return { source: `tile:${this.source}` }; }

  init(desk: DeskApi) { this.sync(desk); }

  /** The source tile shows another note: its backlinks are asked for. */
  private sync(desk: DeskApi) {
    // A Resource or a file shown in the source tile isn't a block: nothing links to it here.
    const shown = desk.tileShowing?.(this.source) ?? null, m = isOutlineNote(shown) ? shown : null;
    if (m?.id === this.target?.id) { if (m) this.target = m; return; }
    this.load(m, desk);
  }

  /** Ask the service for `m`'s backlinks (the list keeps its view options, as Detail's panel does). */
  load(m: Msg | null, desk: DeskApi, keepSel = false): Promise<void> {
    const was = keepSel ? rowKey(this.rows()[this.sel]) : undefined;
    if (m?.id !== this.target?.id) { this.options = { ...this.options, filter: "", kind: null }; this.expanded = new Set(); }
    this.target = m;
    if (!keepSel) { this.data = null; this.sel = 0; this.top = 0; }
    this.problem = "";
    if (!m) return Promise.resolve();
    const n = ++this.asked;
    return desk.ctx.board.backlinks(m.id).then(data => {
      if (n !== this.asked) return;
      this.data = data;
      // Opened once per note (a later read keeps what the person folded).
      if (this.openGroups && this.openedFor !== m.id) { this.openedFor = m.id; for (const k of backlinkView(data, { ...this.options, kind: null }).kinds) this.expanded.add(k.kind); }
      const rows = this.rows(), kept = was ? rows.findIndex(r => rowKey(r) === was) : -1;
      this.sel = kept >= 0 ? kept : Math.max(0, rows.findIndex(r => r.kind === "source"));
      const by = this.showOnLoad;
      this.showOnLoad = null;
      if (by) this.showSelected(desk, by);
      desk.redraw();
    }, (e: Error) => { if (n === this.asked) { this.problem = `couldn't ask for backlinks: ${e.message}`; this.data = null; desk.redraw(); } });
  }

  /** The tile was given the keys: the selected source shows where its selection goes, as moving to it would. */
  focused(desk: DeskApi, actor: Actor) {
    if (this.data) this.showSelected(desk, actor);
    else if (this.target) this.showOnLoad = actor;
  }

  /** Show the selected row's source (a group's header shows nothing). */
  private showSelected(desk: DeskApi, actor: Actor) {
    if (this.rows()[this.sel]?.kind !== "source") return;
    void this.pick(this.sel, "show", desk, actor).catch(() => {});
  }

  /** Something changed in the outline: the list is asked again (once per burst), its selection kept. A draft isn't a change to what links here. */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (!this.target || e?.change?.kind === "draft") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(this.target, desk, true); }, 500);
  }
  dispose() { if (this.reload) clearTimeout(this.reload); }

  rows(): BacklinkRow[] { return this.data ? backlinkRows(backlinkView(this.data, this.options), this.options, this.expanded) : []; }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.sync(desk);
    this.controls = [];
    if (!this.target) return { lines: [fg(C.dark) + pad(`the backlinks of what ${this.source} shows land here`, w) + RESET] };
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.data) return { lines: [fg(C.dark) + pad("asking the service…", w) + RESET] };
    const view = backlinkView(this.data, this.options), rows = this.rows();
    const parts = backlinkStatusParts(view, this.options);
    if (this.data.completeness.kind === "truncated") parts.push({ text: `first ${this.data.completeness.limit ?? this.data.sources.length} sources` });
    const st = layoutBacklinkStatus(parts, w, Math.max(1, Math.floor(h / 2)), p => (p.control ? fg(C.lcyan) : fg(C.grey)));
    const lines: string[] = Array.from({ length: st.rows }, () => "");
    const xs: number[] = Array.from({ length: st.rows }, () => 0);
    for (const s of st.segs) { lines[s.y] += " ".repeat(Math.max(0, s.x - xs[s.y]!)) + s.sgr + pad(s.text, s.cols) + RESET; xs[s.y] = s.x + s.cols; }
    this.controls = st.segs.filter(s => s.control);
    this.head = st.rows;
    const fit = Math.max(1, h - this.head);
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + fit) this.top = this.sel - fit + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - fit)));
    rows.slice(this.top, this.top + fit).forEach((row, j) => lines.push(backlinkRowLine(row, { selected: this.top + j === this.sel, focused, faceted: view.faceted, cols: w })));
    if (!this.data.sources.length) lines.push(fg(C.dark) + " nothing links here yet" + RESET);
    else if (!rows.length) lines.push(fg(C.dark) + " nothing matches · the status line's controls change what shows" + RESET);
    return { lines };
  }

  /**
   * Pick row `i`: a group opens or folds (on open); a source is shown where this tile's selection goes. As
   * `actor`: an agent's never moves the person's keys (the desk's rule for every open).
   */
  async pick(i: number, how: PickHow, desk: DeskApi, actor: Actor = USER): Promise<{ row: number; id?: string; group?: string }> {
    const rows = this.rows();
    const r = rows[i];
    if (!r) throw new ActionRefused(this.data ? `pick a row from 1 to ${rows.length}` : "the backlinks are still being read");
    this.sel = i;
    if (r.kind === "group") {
      if (how !== "show") this.toggle(r.group.kind, desk);
      desk.redraw();
      return { row: i + 1, group: r.group.kind };
    }
    const m = await desk.ctx.board.get(r.source.blockId);
    if (!m) throw new ActionRefused("that source isn't in the outline any more");
    // The selection may have moved on while the source was read: only the latest pick shows.
    if (rowKey(this.rows()[this.sel]) !== rowKey(r)) return { row: i + 1, id: m.id };
    const agent = actor.kind === "agent";
    // Shown: the previews following this tile (and its link) only; the current note stays, or a reader that
    // follows it, whose backlinks these are, would move to the row and the list with it.
    if (how === "show" && desk.showFrom) desk.showFrom(this, m, agent);
    else desk.setCurrent(m, { from: this, ...(how !== "show" ? { link: true } : {}), ...(how === "fresh" ? { fresh: true } : {}), ...(agent ? { agent: true } : {}) });
    desk.redraw();
    return { row: i + 1, id: m.id };
  }

  /** Open or fold a kind group. A narrowing filter opens every group, as in Detail. */
  toggle(kind: string, desk: DeskApi) {
    const o = this.options;
    if (o.filter !== "" || o.kind !== null || o.stage !== "all") return desk.ctx.flash("every group is open while filtering · clear the kind and stage to fold them");
    this.keepSel(() => { if (this.expanded.has(kind)) this.expanded.delete(kind); else this.expanded.add(kind); });
  }

  /** Change the view, keeping the selected row where it still shows (else the first source). */
  private keepSel(change: () => void) {
    const was = rowKey(this.rows()[this.sel]);
    change();
    const rows = this.rows(), kept = rows.findIndex(r => rowKey(r) === was);
    this.sel = kept >= 0 ? kept : Math.max(0, rows.findIndex(r => r.kind === "source"));
  }

  /** One control, as its key, its click in the status line and `backlinks.view` do it; what it did, in words. */
  control(c: BacklinkControl): string {
    const o = this.options;
    let said = "";
    this.keepSel(() => {
      if (c === "sort") { [o.sortField, o.sortDirection] = nextBacklinkSort(o.sortField, o.sortDirection); said = `backlinks sorted by ${o.sortField} ${o.sortDirection === "asc" ? "↑" : "↓"}`; }
      else if (c === "kind") {
        const v = backlinkView(this.data, { ...o, kind: null });
        if (!v.faceted) { said = "nothing to pick: this service sends no backlink kinds"; return; }
        o.kind = nextBacklinkKindFilter(o.kind, v.kinds);
        said = o.kind ? `backlinks: only ${v.kinds.find(k => k.kind === o.kind)?.label ?? o.kind}` : "backlinks: every kind";
      } else if (c === "stage") { o.stage = nextBacklinkStageFilter(o.stage); said = o.stage === "all" ? "backlinks: every stage" : `backlinks: only ${o.stage}`; }
      else if (c === "resolved") { o.showResolved = !o.showResolved; said = o.showResolved ? "showing resolved comments" : "hiding resolved comments"; }
      else if (c === "related") { o.showRelated = !o.showRelated; said = o.showRelated ? "showing this note and its descendants" : "hiding this note and its descendants"; }
      else if (c === "filter") { o.filter = ""; said = "backlink filter cleared"; }
    });
    return said;
  }

  describe() {
    const brief = this.target ? { id: this.target.id, title: subject(this.target) } : null;
    if (!this.data) return { source: this.source, target: brief, loading: !!this.target && !this.problem, problem: this.problem || undefined };
    return { source: this.source, target: brief, ...describeBacklinkView(backlinkView(this.data, this.options), this.options, this.expanded, this.sel) };
  }

  private run(desk: DeskApi, name: "backlinks.pick" | "backlinks.view", args: Record<string, unknown>) {
    Promise.resolve().then(() => BACKLINKS_ACTIONS.runUntyped(name, args, { pane: this, desk }, USER))
      .catch(e => desk.ctx.flash(e instanceof Error ? e.message : String(e)))
      .finally(() => desk.redraw());
  }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows().length, c = ch(k);
    // The selection moves at once (the next key counts from it); the source is read and shown after.
    const to = (i: number) => { if (n) { this.sel = Math.max(0, Math.min(n - 1, i)); this.run(desk, "backlinks.pick", { n: this.sel + 1 }); desk.redraw(); } return true; };
    if (k.kind === "down" || c === "j") return to(this.sel + 1);
    if (k.kind === "up" || c === "k") return to(this.sel - 1);
    if (k.kind === "home") return to(0);
    if (k.kind === "end") return to(n - 1);
    if (k.kind === "enter" || k.kind === "alt-enter") { if (n) this.run(desk, "backlinks.pick", { n: this.sel + 1, open: true, ...(k.kind === "alt-enter" ? { fresh: true } : {}) }); return true; }
    if (c === "." || c === " ") { const r = this.rows()[this.sel]; const kind = r?.kind === "group" ? r.group.kind : r?.source.facets?.kind; if (kind) { this.toggle(kind, desk); desk.redraw(); } return true; }
    const control: Record<string, BacklinkControl> = { s: "sort", K: "kind", w: "stage", h: "resolved", n: "related" };
    if (control[c]) { const said = this.control(control[c]!); if (said) desk.ctx.flash(said); desk.redraw(); return true; }
    return false;
  }

  /** A click on a control does what its key does; on a row it opens it (a ctrl- or alt-click: fresh); the wheel moves the selection. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, desk); return true; }
    if (k.action !== "down") return true;
    const c = this.controls.find(s => s.y === y && x >= s.x && x < s.x + s.cols);
    if (c?.control) { const said = this.control(c.control); if (said) desk.ctx.flash(said); desk.redraw(); return true; }
    const i = this.top + y - this.head;
    if (y >= this.head && i < this.rows().length) this.run(desk, "backlinks.pick", { n: i + 1, open: true, ...((k.mods ?? 0) & 24 ? { fresh: true } : {}) });
    return true;
  }
}

/** A backlinks tile's actions: which row is picked (and where it opens), and the view's options. */
export interface BacklinksOn { pane: BacklinksPane; desk: DeskApi }
export const BACKLINKS_ACTIONS = new ActionSet<{
  "backlinks.pick": { n?: number; id?: string; open?: boolean; fresh?: boolean };
  "backlinks.view": { kind?: string; stage?: string; resolved?: boolean; related?: boolean; sort?: string };
}, BacklinksOn>("backlinks", {
  "backlinks.pick": {
    summary: "pick a row of a backlinks tile (reader=<its name>): n (as peek's rows, from 1) or id; the source shows where the tile's selection goes; open=true as ⏎, fresh=true as alt+⏎. An agent's never moves the person's keys",
    keys: "j k ↑ ↓ (show) · ⏎ click (open) · alt+⏎ ctrl-click alt-click (fresh)",
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a source's block id (or its start)" },
      open: { type: "boolean", optional: true, about: "open it, as ⏎ does (a group opens or folds)" },
      fresh: { type: "boolean", optional: true, about: "open it fresh, as alt+⏎ does" },
    },
    async run({ n, id, open, fresh }, { pane, desk }, actor) {
      if ((n === undefined) === (id === undefined)) throw new ActionRefused("backlinks.pick takes n or id, one of them");
      const rows = pane.rows();
      const i = id !== undefined ? rows.findIndex(r => r.kind === "source" && r.source.blockId.startsWith(id)) : n! - 1;
      if (id !== undefined && i < 0) throw new ActionRefused(`no backlink from ${id} here`);
      const r = await pane.pick(i, fresh ? "fresh" : open ? "open" : "show", desk, actor);
      if (actor.kind === "agent") desk.ctx.flash(`${agentLabel(actor)} picked a backlink (row ${r.row})`);
      return r;
    },
  },
  "backlinks.view": {
    summary: "change a backlinks tile's view as Detail's controls do: kind (a kind or all), stage (all, open, waiting, draft, active, done), resolved, related, sort (updated, created, title, -asc or -desc)",
    keys: "K w h n s, a click on the status line",
    args: {
      kind: { type: "string", optional: true, about: "a kind or its label, or all" },
      stage: { type: "string", optional: true, about: "all, open, waiting, draft, active or done" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
    },
    run(args, { pane, desk }, actor) {
      const kinds = backlinkView(pane.data, { ...pane.options, kind: null }).kinds;
      let next: BacklinkViewOptions;
      try { next = backlinkOptionsFrom(pane.options, args, kinds); } catch (e) { throw new ActionRefused((e as Error).message); }
      pane.options = next;
      if (actor.kind === "agent") desk.ctx.flash(`${agentLabel(actor)} changed the backlinks view`);
      desk.redraw();
      return { backlinks: pane.describe() };
    },
  },
});
