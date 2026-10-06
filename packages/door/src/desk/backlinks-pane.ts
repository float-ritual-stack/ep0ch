// The links tile (kind `backlinks`, PIE-432, PIE-442): the links of what another tile shows (its `source`, a
// tile's name) in the shared links model (src/links.ts): its Outlinks, its Resources and its Backlinks, the
// backlinks grouped, filtered and sorted as Detail does through src/backlinks.ts. Moving the selection, or giving
// the tile the keys, shows the selected row where this tile's selection goes (a preview following it, or its
// link) without moving the current note (so the tile it lists the links of stays put): a note, a ticket's block,
// a Resource's stored content (read only: nothing is registered or fetched by showing it). ⏎ opens it, alt+⏎
// opens it "fresh", as a link's alt+⏎ does; the mouse escalates the same way (RowView.press): a click selects, a
// double click is ⏎, an alt-, ctrl- or middle-click is alt+⏎, and the click that gives the tile the keys only selects.
//
// The rows are drawn by `linkRowLine`, as the tree's links and the inline `::links` component are; the status
// line by `layoutBacklinkStatus`. One model and one drawing, not three.
import { isOutlineNote, type AuthoredLinksSnapshot } from "../authored";
import { describeLinkRow, isLinkEntry, isLinkGroup, linkBlock, linkNote, linkRowLine, linkRows, type LinkData, type LinkGroupName, type LinkRow, type Load } from "../links";
import { subject, type Msg } from "../board";
import {
  backlinkOptionsFrom, backlinkStatusParts, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS,
  describeBacklinkView, nextBacklinkKindFilter, nextBacklinkSort, nextBacklinkStageFilter,
  type BacklinkCollection, type BacklinkControl, type BacklinkStatusPart, type BacklinkViewOptions,
} from "../backlinks";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, actionSet, def, agentLabel } from "../surface/actions";
import { C, fg, pad, RESET, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";
import { RowView, type RowPress } from "../scroll";
import { LineInput } from "../surface/line";


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

const rowKey = (r: LinkRow | undefined) => r?.key;
/** The first row that opens something (the selection starts there), else the first. */
const firstEntry = (rows: readonly LinkRow[]) => Math.max(0, rows.findIndex(r => isLinkEntry(r)));

/** How a picked source opens: shown where the selection goes (moving), opened (⏎, a click), or fresh (alt+⏎). */
export type PickHow = "show" | "open" | "fresh";

export class BacklinksPane implements Pane {
  readonly kind = "backlinks" as const;
  /** The note whose links are listed (what the source tile shows), and what the service sent for it: its backlinks, its authored links. */
  target: Msg | null = null;
  data: BacklinkCollection | null = null;
  authored: Load<AuthoredLinksSnapshot> = { kind: "loading" };
  /** The groups (Outlinks, Resources, Backlinks) folded to their header. */
  shut = new Set<LinkGroupName>();
  problem = "";
  /** The selected row, and the first row drawn. */
  sel = 0;
  private view = new RowView();
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
  /** A filter being typed (`/`): applied as it's typed; ⏎ keeps it, esc goes back to what it was. Null when not typing. */
  draft: LineInput | null = null;
  /**
   * A note named outright (`backlinks id=<id>` on the board, a note no tile shows): listed instead of what the
   * source tile shows, until the source shows another note.
   */
  private named: { m: Msg; over: string | null } | null = null;

  /**
   * `source`: the tile whose note's backlinks this lists. `openGroups`: every kind group starts open (a screen
   * with room for only a few rows, where a folded "+ Note 2" would hide the only links); Detail's default,
   * folded, otherwise.
   */
  constructor(public source: string, readonly openGroups = false) {}

  title() {
    if (!this.target) return `links · of ${this.source}`;
    const n = this.data ? ` · ${this.data.sources.length} source${this.data.sources.length === 1 ? "" : "s"}` : " · …";
    return `links · ${subject(this.target).slice(0, 50)}${n}`;
  }
  hint() { return this.draft !== null ? "type to filter the links · ⏎ keep · esc undo · backspace ctrl+u erase" : "j k pick · ⏎ open · alt+⏎ fresh · . fold · s K w h n view"; }
  spec() { return { source: `tile:${this.source}`, ...(this.openGroups ? { groups: "open" as const } : {}) }; }

  init(desk: DeskApi) { this.sync(desk); }

  /** The source tile shows another note: its backlinks are asked for. */
  private sync(desk: DeskApi) {
    // A Resource or a file shown in the source tile isn't a block: nothing links to it, so the list stays on the note
    // it listed (one of its resources opened from here: the list is still there to go on from).
    const shown = desk.tileShowing?.(this.source) ?? null;
    let m = isOutlineNote(shown) ? shown : shown ? this.target : null;
    // A note named outright stays until the source moves on from what it showed then.
    if (this.named && (m?.id ?? null) === this.named.over) m = this.named.m;
    else this.named = null;
    if (m?.id === this.target?.id) { if (m) this.target = m; return; }
    this.load(m, desk);
  }

  /** List `m`'s backlinks now, asked of the service again (a note named outright, or the source's), whatever the source tile shows. */
  show(m: Msg, desk: DeskApi): Promise<void> {
    const shown = desk.tileShowing?.(this.source) ?? null;
    this.named = { m, over: shown && isOutlineNote(shown) ? shown.id : null };
    // Asked again each time it's opened on a note, as Detail's panel is (the note's options stay while it's the same).
    return this.load(m, desk, m.id === this.target?.id);
  }
  /** The person is typing a filter: their keys are its. */
  typing() { return this.draft !== null; }
  /** The view as shown now: a filter being typed applies as it's typed. */
  private opts(): BacklinkViewOptions { return this.draft === null ? this.options : { ...this.options, filter: this.draft.text.trim() }; }

  /** Ask the service for `m`'s backlinks (the list keeps its view options, as Detail's panel does). */
  load(m: Msg | null, desk: DeskApi, keepSel = false): Promise<void> {
    const was = keepSel ? rowKey(this.rows()[this.sel]) : undefined;
    if (m?.id !== this.target?.id) { this.options = { ...this.options, filter: "", kind: null }; this.expanded = new Set(); this.headerPicked = false; }
    this.target = m;
    if (!keepSel) { this.data = null; this.authored = { kind: "loading" }; this.sel = 0; this.view.reset(); }
    this.problem = "";
    if (!m) return Promise.resolve();
    const n = ++this.asked;
    // Its authored links (Outlinks, Resources) come beside the backlinks; the list draws each as it lands.
    void desk.ctx.board.authoredLinks(m.id).then(v => {
      if (n !== this.asked) return;
      const before = rowKey(this.rows()[this.sel]);
      this.keepSel(() => { this.authored = { kind: "ready", value: v }; }, !keepSel && !this.data);
      // The selection moved onto a link that came with them: shown, as moving to it would, while the list has the keys.
      if (this.data && rowKey(this.rows()[this.sel]) !== before && desk.hasFocus?.(this)) this.showSelected(desk, USER);
      desk.redraw();
    },
      (e: Error) => { if (n === this.asked) { this.authored = { kind: "error", message: `couldn't ask: ${e.message}` }; desk.redraw(); } });
    return desk.ctx.board.backlinks(m.id).then(data => {
      if (n !== this.asked) return;
      this.data = data;
      // Opened once per note (a later read keeps what the person folded).
      if (this.openGroups && this.openedFor !== m.id) { this.openedFor = m.id; for (const k of backlinkView(data, { ...this.options, kind: null }).kinds) this.expanded.add(k.kind); }
      const rows = this.rows(), kept = was ? rows.findIndex(r => rowKey(r) === was) : -1;
      this.sel = kept >= 0 && (isLinkEntry(rows[kept]) || this.headerPicked) ? kept : firstEntry(rows);
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

  /** Show the selected row's note (a group's header shows nothing). */
  private showSelected(desk: DeskApi, actor: Actor) {
    if (!isLinkEntry(this.rows()[this.sel])) return;
    void this.pick(this.sel, "show", desk, actor).catch(() => {});
  }

  /** Something changed in the outline: the list is asked again (once per burst), its selection kept. A draft isn't a change to what links here. */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    if (!this.target || e?.change?.kind === "draft") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(this.target, desk, true); }, 500);
  }
  dispose() { if (this.reload) clearTimeout(this.reload); }

  /** The selected backlink's first occurrence, as quoted text on one line ("" for anything else). */
  snippet(): string {
    const r = this.rows()[this.sel];
    return r?.kind === "backlink" ? String(r.source.occurrences[0]?.snippet ?? "").replace(/\s+/g, " ").trim() : "";
  }
  /** What the service sent, as the shared model reads it. */
  private linkData(): LinkData { return { links: this.authored, backlinks: this.data ? { kind: "ready", value: this.data } : { kind: "loading" } }; }
  /** The rows as shown: Outlinks, Resources and Backlinks (the shared links model), each folding, the filter on all three. */
  rows(): LinkRow[] { return this.target ? linkRows(this.linkData(), { shut: this.shut, kinds: this.expanded, backlinks: this.opts() }) : []; }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.sync(desk);
    this.controls = [];
    if (!this.target) return { lines: [fg(C.dark) + pad(`the links of what ${this.source} shows land here`, w) + RESET] };
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.data) return { lines: [fg(C.dark) + pad("asking the service…", w) + RESET] };
    const rows = this.rows();
    // The status on the header when it fitted there (headControls), else its own lines at the top.
    // Drawn without its header asking (a host that draws no headers): the status is its own.
    if (!this.headAsked) this.inHead = false;
    this.headAsked = false;
    const st = this.inHead ? { segs: [], rows: 0 } : layoutBacklinkStatus(this.statusParts(), w, Math.max(1, Math.floor(h / 2)), p => this.sgrOf(p));
    const lines: string[] = Array.from({ length: st.rows }, () => "");
    const xs: number[] = Array.from({ length: st.rows }, () => 0);
    for (const s of st.segs) { lines[s.y] += " ".repeat(Math.max(0, s.x - xs[s.y]!)) + s.sgr + pad(s.text, s.cols) + RESET; xs[s.y] = s.x + s.cols; }
    this.controls = st.segs.filter(s => s.control);
    this.head = st.rows;
    const fit = Math.max(1, h - this.head);
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    this.view.place(this.sel, rows.length, fit);
    rows.slice(this.view.top, this.view.top + fit).forEach((row, j) => lines.push(linkRowLine(row, { selected: this.view.top + j === this.sel, focused, cols: w })));
    if (!rows.some(isLinkEntry) && this.opts().filter) lines.push(fg(C.dark) + " nothing matches · the status line's controls, / and esc change what shows" + RESET);
    return { lines };
  }

  /** The status line's parts: the filter (as it's typed), the view's controls, and how much the service sent. */
  private statusParts(): BacklinkStatusPart[] {
    const o = this.opts(), typing = this.draft;
    const parts = backlinkStatusParts(backlinkView(this.data, o), o).filter(p => typing === null || p.control !== "filter");
    if (typing !== null) parts.unshift({ text: `Filter: ${typing.plain()}`, control: "filter" });
    if (this.data?.completeness.kind === "truncated") parts.push({ text: `first ${this.data.completeness.limit ?? this.data.sources.length} sources` });
    return parts;
  }
  private sgrOf(p: BacklinkStatusPart) { return this.draft !== null && p.control === "filter" ? fg(C.yellow) : p.control ? fg(C.lcyan) : fg(C.grey); }
  /** The status went on the header this frame (its controls clicked there), and whether the header asked this frame. */
  private inHead = false;
  private headAsked = false;
  /** The status on the header, when it fits there: each control a click, as its key. */
  headControls(room: number, desk: DeskApi): { text: string; sgr: string; press?: () => void }[] | null {
    this.inHead = false;
    this.headAsked = true;
    this.sync(desk);
    if (!this.target || this.problem || !this.data) return null;
    const parts = this.statusParts();
    if (parts.reduce((n, p) => n + width(p.text) + 3, 0) > room) return null;
    this.inHead = true;
    return parts.map(p => ({ text: p.text, sgr: this.sgrOf(p), ...(p.control ? { press: () => this.run(desk, "backlinks.view", { step: p.control! }) } : {}) }));
  }

  /**
   * Pick row `i`: a group opens or folds (on open); a link is shown where this tile's selection goes (read only),
   * or opened (a Resource registered if it must be, as the Tree's ⏎). As `actor`: an agent's never moves the
   * person's keys (the desk's rule for every open).
   */
  async pick(i: number, how: PickHow, desk: DeskApi, actor: Actor = USER): Promise<{ row: number; id?: string; group?: string; resource?: string; registered?: boolean }> {
    const rows = this.rows();
    const r = rows[i];
    if (!r) throw new ActionRefused(this.data ? `pick a row from 1 to ${rows.length}` : "the links are still being read");
    const agent = actor.kind === "agent";
    // An agent's pick is its own: the person's selection stays where it is.
    if (!agent) { this.sel = i; this.headerPicked = !isLinkEntry(r); }
    if (r.kind === "group" || r.kind === "kind") {
      const g = r.kind === "group" ? r.group : r.group.kind;
      if (how !== "show" && agent) throw new ActionRefused("which groups are folded is the person's view; an agent reads every row with backlinks.view or peek");
      if (how !== "show") { if (r.kind === "group") this.fold(r.group); else this.toggle(r.group.kind, desk); }
      desk.redraw();
      return { row: i + 1, group: g };
    }
    const { note: m, registered } = await linkNote(r, desk.ctx.board, how === "show" ? "show" : "open", actor);
    // The selection may have moved on while the note was read: only the latest pick shows.
    if (!agent && rowKey(this.rows()[this.sel]) !== rowKey(r)) return { row: i + 1, id: m.id };
    // Shown: the previews following this tile (and its link) only; the current note stays, or a reader that
    // follows it, whose links these are, would move to the row and the list with it.
    if (how === "show" && desk.showFrom) desk.showFrom(this, m);
    else {
      // The person's open moves their selection there too: the preview following this tile shows it as well.
      if (!agent && desk.showFrom) desk.showFrom(this, m);
      desk.setCurrent(m, { from: this, ...(how !== "show" ? { link: true } : {}), ...(how === "fresh" ? { fresh: true } : {}), by: actor });
    }
    // A Resource just registered: the list asks again, so its row says so.
    if (registered && this.target) { desk.ctx.flash(`${r.kind === "resource" ? r.link.label : "it"} registered and shown`); void this.load(this.target, desk, true); }
    desk.redraw();
    const res = m.id.startsWith("resource:") ? { resource: m.id.slice("resource:".length), registered: !!registered } : { id: m.id };
    return { row: i + 1, ...res };
  }

  /** Fold or open one of the three groups, keeping the selection on its row (or the group's header). */
  fold(group: LinkGroupName) {
    this.keepSel(() => { if (this.shut.has(group)) this.shut.delete(group); else this.shut.add(group); });
    if (!this.rows()[this.sel] || this.rows()[this.sel]!.key.startsWith(group + " > ")) this.sel = Math.max(0, this.rows().findIndex(r => r.key === group));
  }

  /** Open or fold a kind group. A narrowing filter opens every group, as in Detail. */
  toggle(kind: string, desk: DeskApi) {
    const o = this.opts();
    if (o.filter !== "" || o.kind !== null || o.stage !== "all") return desk.ctx.flash("every group is open while filtering · clear the kind and stage to fold them");
    this.keepSel(() => { if (this.expanded.has(kind)) this.expanded.delete(kind); else this.expanded.add(kind); });
  }

  /** Change the view, keeping the selected row where it still shows (else the first link). `fresh`: a first read, the first link. */
  private keepSel(change: () => void, fresh = false) {
    const was = rowKey(this.rows()[this.sel]);
    change();
    // A selection on a header the person didn't pick (nothing to pick when it last moved) goes to the first link once there is one.
    const rows = this.rows(), kept = fresh ? -1 : rows.findIndex(r => rowKey(r) === was);
    this.sel = kept >= 0 && (isLinkEntry(rows[kept]) || this.headerPicked) ? kept : firstEntry(rows);
  }
  /** The person put the selection on a group's header themselves (a key, a click): it stays there. */
  private headerPicked = false;

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
      else if (c === "filter") { this.draft ??= new LineInput(o.filter); said = ""; }
    });
    return said;
  }

  describe() {
    const brief = this.target ? { id: this.target.id, title: subject(this.target) } : null;
    if (!this.data) return { source: this.source, target: brief, loading: !!this.target && !this.problem, problem: this.problem || undefined };
    const o = this.opts();
    // Detail's backlink view (its counts, options, kind groups), and every row as the list numbers them.
    return { source: this.source, target: brief, ...describeBacklinkView(backlinkView(this.data, o), o, this.expanded), rows: this.rows().map((r, i) => describeLinkRow(r, i + 1, i === this.sel)), folded: [...this.shut], typing: this.draft?.text ?? null };
  }

  run(desk: DeskApi, name: "backlinks.pick" | "backlinks.view" | "backlinks.fold", args: Record<string, unknown>) { runOwn(BACKLINKS_ACTIONS, name, args, { pane: this, desk }); }

  /** Typing a filter: letters go into it and the list follows; ⏎ keeps it (`backlinks.view filter=`), esc goes back to what it was. */
  private filterKey(k: Key, desk: DeskApi): boolean {
    if (k.kind === "enter") { const f = this.draft?.text.trim() ?? ""; this.draft = null; this.run(desk, "backlinks.view", { filter: f }); return true; }
    if (k.kind === "esc") this.draft = null;
    else if (!this.draft?.key(k)) return k.kind !== "tab" && k.kind !== "backtab";
    this.keepSel(() => {});
    desk.redraw();
    return true;
  }
  /** It loses the keys while a filter is typed: what's typed is kept, as leaving Detail's filter keeps it. */
  blur() { if (this.draft !== null) { this.options = { ...this.options, filter: this.draft.text.trim() }; this.draft = null; } }

  key(k: Key, desk: DeskApi): boolean {
    if (this.draft !== null && k.kind !== "mouse") return this.filterKey(k, desk);
    const n = this.rows().length, c = ch(k);
    // The selection moves at once (the next key counts from it); the source is read and shown after.
    const to = (i: number) => { if (n && i >= 0 && i < n && i !== this.sel) this.run(desk, "backlinks.pick", { n: i + 1 }); return true; };
    const by = (d: number) => { const i = this.sel + d; if (n && i >= 0 && i < n) this.run(desk, "backlinks.pick", { by: d }); return true; };
    if (isDown(k)) return by(1);
    if (isUp(k)) return by(-1);
    if (k.kind === "home") return to(0);
    if (k.kind === "end") return to(n - 1);
    if (k.kind === "enter" || k.kind === "alt-enter") { if (n) this.run(desk, "backlinks.pick", { n: this.sel + 1, open: true, ...(k.kind === "alt-enter" ? { fresh: true } : {}) }); return true; }
    if (c === "." || c === " ") { this.run(desk, "backlinks.fold", {}); return true; }
    const control: Record<string, BacklinkControl> = { s: "sort", K: "kind", w: "stage", h: "resolved", n: "related" };
    if (control[c]) { this.run(desk, "backlinks.view", { step: control[c]! }); return true; }
    if (c === "/") { this.run(desk, "backlinks.view", { step: "filter" }); return true; }
    return false;
  }

  /**
   * A click on a control does what its key does. A press on a row escalates as the keys do (RowView.press): a
   * click selects it and shows it (j k), a double click opens it (⏎), an alt-, ctrl- or middle-click opens it
   * fresh (alt+⏎); the press that gave the tile the keys only selects. A click on a group's mark (▾ ▸ + −) folds
   * it at once. The wheel moves the selection.
   */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, desk); return true; }
    if (k.action !== "down") return true;
    const c = this.controls.find(s => s.y === y && x >= s.x && x < s.x + s.cols);
    if (c?.control) { this.run(desk, "backlinks.view", { step: c.control }); return true; }
    const i = this.view.top + y - this.head, row = this.rows()[i];
    if (y < this.head || !row) return true;
    const gesture = this.view.press(i, press ?? { mods: k.mods ?? 0, button: k.button });
    const header = row.kind === "group" || row.kind === "kind";
    if (header && gesture !== "focus" && x <= row.depth * 2 + 1) { this.run(desk, "backlinks.pick", { n: i + 1, open: true }); return true; }
    if (gesture === "open" || gesture === "fresh") this.run(desk, "backlinks.pick", { n: i + 1, open: true, ...(gesture === "fresh" && !header ? { fresh: true } : {}) });
    else if (i !== this.sel) this.run(desk, "backlinks.pick", { n: i + 1 });
    return true;
  }
}

/** A backlinks tile's actions: which row is picked (and where it opens), and the view's options. */
export interface BacklinksOn { pane: BacklinksPane; desk: DeskApi }
export const BACKLINKS_ACTIONS = actionSet<BacklinksOn>()("backlinks", {
  "backlinks": def({
    summary: "a backlinks tile's view as Detail groups it: counts, groups with stage counts, each row. An agent's reads the person's view (or id=<block id>'s) with its own options on top and changes nothing of theirs; the person's (b, as=you) lists the backlinks of id (else of the note in the reader they read through), following the reader that shows it, its dock sliding open, and sets their options; its rows and controls are backlinks.pick, backlinks.view and backlinks.fold",
    keys: "b",
    touches: "nothing", replay: "safe",
    args: {
      id: { type: "string", optional: true, about: "the note whose backlinks to read; default the tile's" },
      filter: { type: "string", optional: true, about: "text to match, as / filters" },
      kind: { type: "string", optional: true, about: "one kind (its key or label), or all" },
      stage: { type: "string", optional: true, about: "all, open, waiting, draft, active or done" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
    },
    async run(args, { pane: L, desk }, actor) {
      const { id, ...want } = args;
      const open = (desk.shownNow?.(L) ?? true) && !!L.target;
      const same = !id || (open && (L.target!.id === id || (id.length >= 8 && L.target!.id.startsWith(id))));
      const viewing = Object.values(want).some(v => v !== undefined);
      const kindsOf = (data: BacklinkCollection | null, o: BacklinkViewOptions) => backlinkView(data, { ...o, kind: null }).kinds;
      const parse = (base: BacklinkViewOptions, data: BacklinkCollection | null) => { try { return backlinkOptionsFrom(base, want, kindsOf(data, base)); } catch (e) { throw new ActionRefused((e as Error).message); } };
      if (actor.kind !== "agent") {
        // The person's b (or one naming a note): the list aims at it; their view options alone keep the list where it is.
        if (id || !viewing || !open) {
          const m = id ? await desk.ctx.board.get(id) : null;
          if (id && !m) throw new ActionRefused(`no block ${id}`);
          if (!desk.aimBacklinks) throw new ActionRefused("backlinks aim at a reader's note on a screen with readers");
          await desk.aimBacklinks(L, m);
        } else if (!L.data && L.target) await L.load(L.target, desk, true);
        if (!viewing) return { backlinks: L.describe() };
        const next = parse(L.options, L.data);
        L.draft = null;
        L.options = next;
        desk.redraw();
        return { backlinks: L.describe() };
      }
      if (!id && !open) throw new ActionRefused("no backlinks are listed here; id=<block id> reads a note's backlinks (b opens them on a reader's note)");
      const target = same ? L.target! : await desk.ctx.board.get(id!);
      if (!target) throw new ActionRefused(`no block ${id}`);
      const data = same && L.data ? L.data : await desk.ctx.board.backlinks(target.id);
      // The person's options carry over only for the note they're looking at; another note starts as Detail's.
      const base = same ? { ...L.options } : { ...DEFAULT_BACKLINK_VIEW_OPTIONS, sortField: L.options.sortField, sortDirection: L.options.sortDirection };
      const o = parse(base, data);
      desk.ctx.flash(`${agentLabel(actor)} read the backlinks of ${subject(target).slice(0, 40)}`);
      return { backlinks: { target: { id: target.id, title: subject(target) }, ...describeBacklinkView(backlinkView(data, o), o, same ? L.expanded : new Set()) } };
    },
  }),
  "backlinks.fold": def({
    summary: "open or fold a group in a links tile: one of the three (outlinks, resources, backlinks) or a backlink kind (kind=<its key or label>); default the selected row's, as . or space on it does (a link's: its own group). Every backlink kind is open while a filter is set. The person's view: an agent's is refused",
    keys: ". space, a click on a group's ▾ ▸ + −, a double click on its header",
    touches: "tile", replay: "safe", person: "which groups are folded is the person's view; an agent reads every row with backlinks.view or peek",
    args: { kind: { type: "string", optional: true, about: "outlinks, resources or backlinks, or a backlink kind (its key, as peek's rows give it, or its label); default the selected row's" } },
    run({ kind }, { pane, desk }) {
      const r = pane.rows()[pane.sel];
      if (kind !== undefined && isLinkGroup(kind.toLowerCase())) { pane.fold(kind.toLowerCase() as LinkGroupName); desk.redraw(); return { backlinks: pane.describe() }; }
      if (kind === undefined && r?.kind === "group") { pane.fold(r.group); desk.redraw(); return { backlinks: pane.describe() }; }
      // A link's own group: an outlink or a resource folds its group; a backlink its kind (or Backlinks, unfaceted).
      if (kind === undefined && (r?.kind === "outlink" || r?.kind === "resource" || (r?.kind === "backlink" && !r.source.facets?.kind))) {
        pane.fold(r.kind === "outlink" ? "outlinks" : r.kind === "resource" ? "resources" : "backlinks"); desk.redraw(); return { backlinks: pane.describe() };
      }
      const kinds = backlinkView(pane.data, { ...pane.options, kind: null }).kinds;
      const k = kind === undefined ? (r?.kind === "kind" ? r.group.kind : r?.kind === "backlink" ? r.source.facets?.kind : undefined) : kinds.find(x => x.kind === kind || x.label.toLowerCase() === kind.toLowerCase())?.kind ?? kind;
      if (!k) throw new ActionRefused(kind === undefined ? "the selected row has no group" : `no group or backlink kind ${kind}`);
      pane.toggle(k, desk);
      desk.redraw();
      return { backlinks: pane.describe() };
    },
  }),
  "backlinks.pick": def({
    summary: "pick a row of a links tile (tile=<its name>): n (as peek's rows, from 1) or id (a block's, or a resource's); it shows where the tile's selection goes (a note, a ticket's block, a Resource's stored content: read only); open=true as ⏎ (a Resource is registered if it must be), fresh=true as alt+⏎. An agent's never moves the person's keys",
    keys: "j k ↑ ↓ Home End wheel click (show) · ⏎ double click (open) · alt+⏎ alt-click ctrl-click middle-click (fresh); the click that gives the tile the keys only selects",
    touches: "nothing", replay: "safe", says: r => `picked a link (row ${r.row})`,
    args: {
      n: { type: "number", optional: true, about: "the row, from 1, as peek lists them" },
      id: { type: "string", optional: true, about: "a linked block's id or a resource's (or its start)" },
      by: { type: "number", optional: true, about: "rows on from the selected one (1 the next, -1 the one before), as j k do" },
      open: { type: "boolean", optional: true, about: "open it, as ⏎ does (a group opens or folds)" },
      fresh: { type: "boolean", optional: true, about: "open it fresh, as alt+⏎ does" },
    },
    async run({ n, id, by, open, fresh }, { pane, desk }, actor) {
      if ([n, id, by].filter(x => x !== undefined).length !== 1) throw new ActionRefused("backlinks.pick takes one of n, id or by");
      const rows = pane.rows();
      const idOf = (r: LinkRow) => linkBlock(r) ?? (r.kind === "resource" ? r.link.recordBlockId ?? r.link.resourceId ?? (r.link.resolution.kind === "ready" ? r.link.resolution.target.resourceId : null) : null);
      const i = id !== undefined ? rows.findIndex(r => idOf(r)?.startsWith(id)) : by !== undefined ? pane.sel + Math.trunc(by) : n! - 1;
      if (by !== undefined && (i < 0 || i >= rows.length)) throw new ActionRefused(`no row ${by > 0 ? "after" : "before"} row ${pane.sel + 1}`);
      if (id !== undefined && i < 0) throw new ActionRefused(`no link to or from ${id} here`);
      return pane.pick(i, fresh ? "fresh" : open ? "open" : "show", desk, actor);
    },
  }),
  "backlinks.view": def({
    summary: "change a backlinks tile's view as Detail's controls do: filter (text to match), kind (a kind or all), stage (all, open, waiting, draft, active, done), resolved, related, sort (updated, created, title, -asc or -desc); step=filter starts typing one (the person's)",
    keys: "K w h n s, click on the status line; / then typing, backspace ctrl+u, ⏎ keeps it, esc goes back",
    touches: "nothing", replay: "safe", says: r => (r.said ? `· ${r.said}` : "changed the backlinks view"),
    args: {
      filter: { type: "string", optional: true, about: "text to match, as / filters (empty clears)" },
      kind: { type: "string", optional: true, about: "a kind or its label, or all" },
      stage: { type: "string", optional: true, about: "all, open, waiting, draft, active or done" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
      step: { type: "string", optional: true, about: "a control stepped to its next value, as its key does: kind, stage, resolved, related or sort; filter starts typing one" },
    },
    run({ step, ...args }, { pane, desk }, actor) {
      if (step !== undefined) {
        if (!(["kind", "stage", "resolved", "related", "sort", "filter"] as string[]).includes(step)) throw new ActionRefused(`step is filter, kind, stage, resolved, related or sort, not ${step}`);
        if (step === "filter" && actor.kind === "agent") throw new ActionRefused("typing a filter is the person's; an agent passes filter=<text>");
        const said = pane.control(step as BacklinkControl);
        if (said) desk.ctx.flash(said);
        desk.redraw();
        return { backlinks: pane.describe(), ...(said ? { said } : {}) };
      }
      const kinds = backlinkView(pane.data, { ...pane.options, kind: null }).kinds;
      let next: BacklinkViewOptions;
      try { next = backlinkOptionsFrom(pane.options, args, kinds); } catch (e) { throw new ActionRefused((e as Error).message); }
      pane.options = next;
      desk.redraw();
      return { backlinks: pane.describe() };
    },
  }),
});
