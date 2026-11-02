import { filterLine } from "../surface/line";
import { standsAsPerson } from "../surface/dispatch";
import { NOBODY } from "../whereabouts";
import { outlineBoards, readTarget } from "./outline-boards";
// The links tile (kind `backlinks`, PIE-432, PIE-442): the links of a note, its *subject*, in the shared links model
// (src/links.ts): its Outlinks, its Resources, its Backlinks and its
// Children (PIE-693: the notes under it, a thread's replies), the backlinks grouped, filtered and sorted as Detail
// does through src/backlinks.ts, and Kind, Stage and Sort on every group. Which groups it lists is the tile's own
// (`groups`, saved with the layout, `backlinks.groups`): the thread tile is this tile with Children alone. Moving the selection, or giving
// the tile the keys, shows the selected row where this tile's selection goes (a preview following it, or its
// link) and nowhere else (so its home keeps its note): a note, a ticket's block, a Resource's stored content
// (read only: nothing is registered or fetched by showing it). ⏎ opens it for real (`backlinks.open`, PIE-646): in the
// tile its opens land in, the tile linked to this one as a target, else its *home* (its `source`, a tile's name: the
// reader it was opened beside), whose note it replaces (the layout's `landing`); alt+⏎ in a new detail beside its home.
// The mouse escalates the same way (RowView.press): a click selects and previews, a double click is ⏎, an alt-, ctrl- or
// middle-click is alt+⏎, and the click that gives the tile the keys only selects.
//
// One list model (PIE-794): the subject changes when the person says so (`b`, in a reader or here), never because an
// open from the list landed in its home. A list whose subject follows its home (`subject=follows`: the welcome's, the
// desk's replies) takes what its home shows as it changes, but not a note it opened there itself.
//
// The rows are drawn by `linkRowLines`, as the tree's links and the inline `::links` component are; the status
// line by `layoutLinksStatus`. One model and one drawing, not three.
import { BASE_STYLE } from "@ep0ch/outline-core/style-cascade";
import { isOutlineNote, type AuthoredLinksSnapshot } from "../authored";
import { DEFAULT_LINK_GROUPS, ALL_LINK_GROUPS, describeLinkRow, isLinkEntry, isLinkGroup, LINK_GROUPS, linkAcross, linkBlock, linkListRow, linkNote, linkTargetOf, linkRows, readChildren, type ChildLink, type LinkData, type LinkGroupName, type LinkRow, type Load } from "../links";
import { headedTitle, subject, type Msg } from "../board";
import {
  backlinkOptionsFrom, backlinkStatusParts, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS,
  describeBacklinkView, nextBacklinkKindFilter, nextBacklinkSort, nextBacklinkStageFilter,
  type BacklinkCollection, type BacklinkControl, type BacklinkStatusPart, type BacklinkViewOptions,
  LINK_GROUPS_ARE_THE_PERSONS,
} from "../backlinks";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { ActionRefused, actionSet, def, agentLabel } from "../surface/actions";
import { C, drawEllipsized, fg, pad, RESET, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { runOwn, type DeskApi, type Pane, type PaneView, type TileTrail } from "./panes";
import { HISTORY, historyKey } from "../surface/note";
import { pressOn, type RowPress } from "../scroll";
import { LISTVIEW_ACTIONS, type ListHost } from "../surface/list-actions";
import { ListView, PERSON, type ListHandle, type ListViewRow } from "../surface/list-view";
import { centred, ListPicker, pickRows, pickRow } from "../surface/picker";

/**
 * A tile spec's `linkGroups` (`children`, `outlinks,backlinks`) as the groups it names, in the model's order; null
 * for every group (left out, or `all`). Throws with the reason for a name that isn't a group, or none at all.
 */
export function linkGroupsFrom(spec: string | readonly string[] | undefined): LinkGroupName[] | null {
  if (spec === undefined) return null;
  const names = (typeof spec === "string" ? spec.split(/[\s,]+/) : [...spec]).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (names.length === 1 && names[0] === "all") return null;
  const bad = names.find(n => !(ALL_LINK_GROUPS as readonly string[]).includes(n));
  if (bad !== undefined) throw new ActionRefused(`${bad} isn't a group; the groups are ${ALL_LINK_GROUPS.join(", ")} (or all)`);
  if (!names.length) throw new ActionRefused(`name at least one group: ${ALL_LINK_GROUPS.join(", ")} (or all)`);
  return ALL_LINK_GROUPS.filter(g => names.includes(g));
}


/** One piece of the status line as placed: at x, y in the list's cells, `cols` wide (clipped), a control or not. */
export interface StatusSeg { x: number; y: number; text: string; cols: number; sgr: string; control?: BacklinkControl }

/**
 * The status line's parts placed in `cols`, each in a slot of its own so changing one value never moves another:
 * line 1 the counts (all and per group), line 2 Kind, Stage and Sort. A value too long for its slot is cut with …
 * rather than pushing the next along. What comes and goes follows on the lines after, wrapping between parts onto at
 * most `maxRows` lines in all: the filter first (whole, so what is typed shows), then the notes (what is hidden or
 * filtered, a truncated read). Nothing above it moves. `sgrOf` colours a part.
 */
export function layoutLinksStatus(parts: readonly BacklinkStatusPart[], cols: number, maxRows: number, sgrOf: (p: BacklinkStatusPart) => string): { segs: StatusSeg[]; rows: number } {
  const segs: StatusSeg[] = [];
  const sep = fg(C.dark);
  const slot = (p: BacklinkStatusPart | undefined, x: number, y: number, room: number) => {
    const w = Math.min(room, cols - x);
    if (!p || w <= 0) return;
    const text = drawEllipsized(p.text, w);
    segs.push({ x, y, text, cols: width(text), sgr: sgrOf(p), ...(p.control ? { control: p.control } : {}) });
  };
  const dot = (x: number, y: number) => { if (x + 3 <= cols) segs.push({ x, y, text: " · ", cols: 3, sgr: sep }); };
  const part = (s: NonNullable<BacklinkStatusPart["slot"]>) => parts.find(p => p.slot === s);
  const COUNT = 17, BY = 22, STAGE = 16, SORT = 17;
  const KIND = Math.max(14, Math.min(28, cols - (STAGE + SORT + 6)));
  slot(part("count"), 0, 0, COUNT); dot(COUNT, 0);
  slot(part("by"), COUNT + 3, 0, BY);
  // Kind, Stage and Sort in slots of fixed widths, packed onto lines by those widths alone (a narrow tile uses more
  // lines, but the same ones whatever the values are).
  let cx = 0, cy = 1;
  for (const [name, w] of [["kind", KIND], ["stage", STAGE], ["sort", SORT]] as const) {
    if (cx && cx + w > cols) { cx = 0; cy += 1; }
    slot(part(name), cx, cy, w);
    if (name !== "sort" && cx + w + 3 < cols) dot(cx + w, cy);
    cx += w + 3;
  }
  let x = 0, y = cy + 1;
  const base = y;
  for (const p of [...parts.filter(p => p.slot === "filter"), ...parts.filter(p => p.slot === "note" || p.slot === undefined)]) {
    if (x && x + 3 + width(p.text) > cols && y + 1 < maxRows) { y += 1; x = 0; }
    else if (x) { dot(x, y); x += 3; }
    const room = cols - x;
    if (room <= 0) continue;
    segs.push({ x, y, text: drawEllipsized(p.text, room), cols: Math.min(room, width(p.text)), sgr: sgrOf(p), ...(p.control ? { control: p.control } : {}) });
    x += width(p.text);
  }
  // The filter's line is kept whatever the budget: what is typed in it shows.
  const rows = Math.max(base + (part("filter") ? 1 : 0), Math.min(maxRows, x || y > base ? y + 1 : base));
  return { segs: segs.filter(s => s.y < rows), rows };
}

const rowKey = (r: LinkRow | undefined) => r?.key;
/** The first row that opens something (the selection starts there), else the first. */
const firstEntry = (rows: readonly LinkRow[]) => Math.max(0, rows.findIndex(r => isLinkEntry(r)));

/** How a picked source opens: shown where the selection goes (moving), opened (⏎, a click), or fresh (alt+⏎). */
export type PickHow = "show" | "open" | "fresh";

export class BacklinksPane implements Pane {
  readonly kind = "backlinks" as const;
  /** The note whose links are listed (its subject), and what the service sent for it: its backlinks, its authored links. */
  target: Msg | null = null;
  data: BacklinkCollection | null = null;
  authored: Load<AuthoredLinksSnapshot> = { kind: "loading" };
  /** The groups (Outlinks, Resources, Backlinks, Children) folded to their header. */
  shut = new Set<LinkGroupName>();
  /** The groups this tile lists (PIE-693), in the model's order: every one unless its spec names some. */
  groups: LinkGroupName[] = [...DEFAULT_LINK_GROUPS];
  parents: Load<ChildLink[]> = { kind: "loading" };
  /** The notes under the target, with their facets, while Children is listed (read only then). */
  children: Load<ChildLink[]> = { kind: "loading" };
  /** Children's own reads: only the latest one lands (it can be asked again without the rest, as its group comes on). */
  private kidsAsked = 0;
  problem = "";
  /**
   * The list this tile draws (PIE-747): the one ListView, which holds the person's pick, each agent's own pick and
   * the typed filter, and scrolls (a RowView). The tile gives it the links model's rows and keeps what it decides:
   * the groups, the status line's controls, what a pick shows and where an open lands.
   */
  readonly list = new ListView<LinkRow>("links", false);
  /** The rows of the list as last drawn, one per drawn line (null: spacing, a say-so line), for the mouse. */
  private rowAt: (number | null)[] = [];
  /** The selected row: an index into `rows()`, kept as the person's pick in the list by the row's key. */
  get sel(): number {
    const id = this.list.pickedId(PERSON);
    return id === null ? 0 : Math.max(0, this.rows().findIndex(r => r.key === id));
  }
  set sel(i: number) { const r = this.rows()[i]; this.list.setPick(PERSON, r ? r.key : null); }
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
  get draft() { return this.list.typing; }
  /**
   * A note named outright (`backlinks id=<id>` on the board, a note no tile shows): listed instead of what the
   * source tile shows, until the source shows another note.
   */
  private named: { m: Msg; over: string | null } | null = null;

  /**
   * `source`: its home, the tile it belongs to (a reader), whose note it lists until it holds one of its own.
   * `openGroups`: every kind group starts open (a screen with room for only a few rows, where a folded "+ Note 2"
   * would hide the only links); Detail's default, folded, otherwise. `follows`: its subject follows what its home shows
   * (`subject=follows`); otherwise it keeps its subject until `b`.
   */
  constructor(public source: string, readonly openGroups = false, groups: readonly LinkGroupName[] | null = null, public follows = false) {
    if (groups?.length) this.groups = ALL_LINK_GROUPS.filter(g => groups.includes(g));
  }
  /** Its home (PIE-794): the reader it belongs to, where ⏎ lands unless a link says otherwise. */
  get home() { return this.source; }
  /** The note its last open put in its home: a following list doesn't take it as its subject. */
  private landed: string | null = null;

  /** Every group listed (the tile's default), or only some. */
  private get every() { return this.groups.length === DEFAULT_LINK_GROUPS.length && !this.groups.includes("parents"); }
  /** Children alone: the replies of a thread, as the thread tile was. */
  private get childrenOnly() { return this.groups.length === 1 && this.groups[0] === "children"; }

  subject() { const r = this.rows()[this.sel]; return r?.kind === "backlink" ? r.source.blockId : r?.kind === "child" ? r.child.block.id : null; }
  /** Its rows are the target's outline's: another outline's note lists that outline's links and replies. */
  noteAt() { const id = this.subject(); return id ? { id, ...(this.target?.address ? { address: this.target.address } : {}) } : null; }
  get titleNote() { return this.target; }
  title() {
    const word = this.childrenOnly ? "children" : this.every ? "links" : `links (${this.groups.join(", ")})`;
    if (!this.target) return `${word} · of ${this.sourceLabel()}`;
    if (this.childrenOnly) {
      const c = this.children;
      return `${word} · ${headedTitle(this.target)} · ${c.kind === "ready" ? `${c.value.length} repl${c.value.length === 1 ? "y" : "ies"}` : "…"}`;
    }
    return `${word} · ${headedTitle(this.target)}`;
  }
  headControls(_room: number, desk: DeskApi) {
    if (!this.target || this.childrenOnly) return null;
    return [{ text: this.data ? `${this.data.sources.length} source${this.data.sources.length === 1 ? "" : "s"}` : "… sources", sgr: fg(C.lcyan),
      chip: true as const, press: () => this.run(desk, "backlinks.groups", { choose: true }) }];
  }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() { return this.draft !== null ? "type to filter the links · ⏎ keep · esc undo · backspace ctrl+u erase" : `j k preview${this.backs.length ? ` · alt+← back to ${subject(this.backs.at(-1)!)}` : ""} · ⏎ open in ${this.desk?.wireDescription?.(this.desk.nameOfPane?.(this), "open")} · alt+⏎ ${this.desk?.wireDescription?.(this.desk.nameOfPane?.(this), "alt")} · b ${this.follows ? "aim" : "re-aim"} at ${this.sourceLabel()}'s note · . fold · s K w h n view · v groups`; }
  spec() { return { source: this.source ? `tile:${this.source}` : "", ...(this.openGroups ? { groups: "open" as const } : {}), ...(this.every ? {} : { linkGroups: this.groups.join(",") }), subject: this.follows ? "follows" as const : "held" as const, ...(this.options.stages?.length ? { stages: this.options.stages.join(",") } : {}) }; }

  /**
   * List these groups (at least one), in the model's order; the selection stays on its row where it still shows.
   * Children is read when it comes on.
   */
  setGroups(groups: readonly LinkGroupName[], desk: DeskApi) {
    if (!groups.length) throw new ActionRefused("a links tile lists at least one group");
    const had = new Set(this.groups);
    this.keepSel(() => { this.groups = ALL_LINK_GROUPS.filter(g => groups.includes(g)); });
    // Backlinks coming on are read (a tile without them never asked); Children alone is read on its own.
    if (this.target && !had.has("backlinks") && this.groups.includes("backlinks")) void this.load(this.target, desk, true);
    else if (this.target && !had.has("children") && this.groups.includes("children")) void this.loadChildren(this.target, desk);
    if (this.target && !had.has("parents") && this.groups.includes("parents")) void this.loadParents(this.target, desk);
    desk.redraw();
  }

  /** The person's choice of groups: a list over the tile whose rows switch a group on or off, one click each (it stays). */
  chooseGroups(desk: DeskApi) {
    if (!desk.overlay) throw new ActionRefused("this screen has no room for the groups' list; backlinks.groups show=<groups> chooses them");
    const counts = () => this.across().by;
    desk.overlay(new ListPicker<LinkGroupName, unknown>({
      name: "links-groups", stays: true, items: () => ALL_LINK_GROUPS,
      row: (g, _i, on, w) => {
        const glyph = LINK_GROUPS.find(x => x.group === g)!.glyph, c = counts()[g];
        return [...pickRows(` [${this.groups.includes(g) ? "x" : " "}] ${glyph} ${g}${c ? ` (${c.matching})` : ""}`, on, w)];
      },
      choose: g => void desk.press?.(this, BACKLINKS_ACTIONS, "backlinks.groups", { toggle: g }),
      frame: a => ({ rect: centred(a, Math.min(44, a.cols - 4), ALL_LINK_GROUPS.length + 4), title: "groups this tile lists" }),
    }));
  }

  private desk: DeskApi | null = null;
  private sourceLabel() {
    if (!this.source) return "no source";
    const pane = this.desk?.pane?.(this.source);
    return pane ? this.desk?.pathTo?.(pane) || this.desk?.nameOfPane?.(pane) || this.source : this.source;
  }
  init(desk: DeskApi) { this.desk = desk; this.sync(desk); }

  /**
   * Its home shows another note: a list whose subject follows it lists that one's links; one holding its subject keeps
   * it (only `b` aims it again), and takes its home's note only while it has none.
   */
  private sync(desk: DeskApi) {
    if (this.target && !this.follows) { const now = desk.tileShowing?.(this.source); if (now?.id === this.target.id) this.target = now; return; }
    // A Resource or a file shown in its home isn't a block: nothing links to it, so the list stays on the note it
    // listed (one of its resources opened from here: the list is still there to go on from).
    const shown = desk.tileShowing?.(this.source) ?? null;
    // A note this list opened in its home is its row, not its subject: it stays where it was.
    if (this.target && shown && shown.id === this.landed) return;
    this.landed = null;
    let m = isOutlineNote(shown) ? shown : shown ? this.target : null;
    // A note named outright stays until the source moves on from what it showed then.
    if (this.named && (m?.id ?? null) === this.named.over) m = this.named.m;
    else this.named = null;
    if (m?.id === this.target?.id) { if (m) this.target = m; return; }
    this.load(m, desk);
  }

  /** List `m`'s backlinks now, asked of the service again (a note named outright, or the source's), whatever the source tile shows. */
  show(m: Msg, desk: DeskApi): Promise<void> {
    this.follows = false;
    const shown = desk.tileShowing?.(this.source) ?? null;
    this.named = { m, over: shown && isOutlineNote(shown) ? shown.id : null };
    // Asked again each time it's opened on a note, as Detail's panel is (the note's options stay while it's the same).
    return this.load(m, desk, m.id === this.target?.id);
  }
  /** The person is typing a filter: their keys are its. */
  typing() { return this.draft !== null; }
  lineField() { return this.draft; }
  /** The view as shown now: a filter being typed applies as it's typed. */
  private opts(): BacklinkViewOptions { return this.draft === null ? this.options : { ...this.options, filter: this.draft.text.trim() }; }

  /**
   * Back and forward (PIE-1426): the notes it listed before, nearest last, whoever changed it (`b`, its home moving
   * while it follows, an agent naming one). Back lists that note again until its home moves on, as a named one does.
   */
  private backs: Msg[] = [];
  private aheads: Msg[] = [];
  private travelling = false;
  readonly trail: TileTrail = {
    stops: () => { const t = (ms: Msg[]) => ms.map(m => ({ id: m.id, title: subject(m), ...(m.address ? { address: m.address } : {}) })).reverse(); return { here: this.target ? { id: this.target.id, title: subject(this.target) } : null, back: t(this.backs), forward: t(this.aheads) }; },
    go: async (dir, steps, desk) => {
      const stack = dir < 0 ? this.backs : this.aheads, other = dir < 0 ? this.aheads : this.backs;
      if (!stack.length) return dir < 0 ? "nothing to go back to: this list hasn't listed another note's links here" : "nothing ahead: go back first";
      if (steps > stack.length) return `only ${stack.length} ${dir < 0 ? "back" : "ahead"}: steps=${stack.length} at most`;
      if (this.draft !== null) return "finish the filter first · ⏎ keeps it, esc goes back";
      const passed = stack.splice(stack.length - steps), to = passed.shift()!;
      if (this.target) other.push(this.target);
      other.push(...passed.reverse());
      const shown = desk.tileShowing?.(this.source) ?? null;
      if (this.follows) this.named = { m: to, over: shown && isOutlineNote(shown) ? shown.id : null };
      this.travelling = true;
      let read: Promise<void>;
      try { read = this.load(to, desk); } finally { this.travelling = false; }
      desk.redraw();
      await read;
      return null;
    },
  };

  /** Ask the service for `m`'s backlinks (the list keeps its view options, as Detail's panel does). */
  async load(m: Msg | null, desk: DeskApi, keepSel = false): Promise<void> {
    if (!this.travelling && this.target && m && m.id !== this.target.id) {
      this.backs.push(this.target);
      if (this.backs.length > HISTORY) this.backs.shift();
      this.aheads = [];
    }
    // Another note: its groups start as a first read opens them. `openedFor` goes with `expanded`: a read cut short (the
    // person moved on before it came) never left them shut on the way back to a note opened before.
    if (m?.id !== this.target?.id) { this.options = { ...this.options, filter: "", kind: null }; this.expanded = new Set(); this.openedFor = null; this.headerPicked = false; }
    this.target = m;
    if (!keepSel) { this.data = null; this.authored = { kind: "loading" }; this.sel = 0; this.list.view.reset(); }
    this.problem = "";
    const n = ++this.asked;
    if (!m) return;
    const board = m.address ? (await outlineBoards(desk.ctx).on(m.address)).board : desk.ctx.board;
    if (n !== this.asked) return;
    if (!keepSel) { this.children = { kind: "loading" }; this.parents = { kind: "loading" }; }
    if (this.groups.includes("children")) void this.loadChildren(m, desk);
    if (this.groups.includes("parents")) void this.loadParents(m, desk);
    // Its authored links (Outlinks, Resources) come beside the backlinks; the list draws each as it lands.
    void board.authoredLinks(m.id).then(v => {
      if (n !== this.asked) return;
      const before = rowKey(this.rows()[this.sel]);
      this.keepSel(() => { this.authored = { kind: "ready", value: v }; }, !keepSel && !this.data);
      // The selection moved onto a link that came with them: shown, as moving to it would, while the list has the keys.
      if (this.data && rowKey(this.rows()[this.sel]) !== before && desk.hasFocus?.(this)) this.showSelected(desk, USER);
      desk.redraw();
    },
      (e: Error) => { if (n === this.asked) { this.authored = { kind: "error", message: `couldn't ask: ${e.message}` }; desk.redraw(); } });
    // A tile that doesn't list Backlinks doesn't ask for them: an empty collection stands in, so a slow or failed
    // backlinks read never holds up (or hides) the groups it does list.
    const backlinks = this.groups.includes("backlinks") ? board.backlinks(m.id) : Promise.resolve<BacklinkCollection>({ targetBlockId: m.id, sources: [], completeness: { kind: "complete" } } as BacklinkCollection);
    return backlinks.then(data => {
      if (n !== this.asked) return;
      // A re-read keeps the selected row: the one selected now, not when it was asked (the person may have moved since).
      const was = keepSel ? rowKey(this.rows()[this.sel]) : undefined;
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

  /** The notes under `m` and their facets (the Children group), drawn as they land, the selection kept. */
  private loadChildren(m: Msg, desk: DeskApi): Promise<void> {
    const n = ++this.kidsAsked;
    const current = () => n === this.kidsAsked && this.target?.id === m.id;
    const board = m.address ? outlineBoards(desk.ctx).peek(m.address)!.board : desk.ctx.board;
    return readChildren(board, m.id).then(value => {
      if (!current()) return;
      this.keepSel(() => { this.children = { kind: "ready", value }; }, !this.data);
      desk.redraw();
    }, (e: Error) => { if (current()) { this.children = { kind: "error", message: `couldn't ask: ${e.message}` }; desk.redraw(); } });
  }

  private async loadParents(m: Msg, desk: DeskApi) {
    const board = m.address ? outlineBoards(desk.ctx).peek(m.address)!.board : desk.ctx.board;
    await board.ancestors(m.id).then(ancestors => {
      if (this.target?.id !== m.id) return;
      this.keepSel(() => { this.parents = { kind: "ready", value: ancestors.map(block => ({ block })) }; });
      desk.redraw();
    }, (e: Error) => { if (this.target?.id === m.id) { this.parents = { kind: "error", message: `couldn't ask: ${e.message}` }; desk.redraw(); } });
  }

  /** Given the keys: its selection fills a preview that shows nothing yet, and never replaces what one shows (PIE-1426). */
  focused(desk: DeskApi, actor: Actor) { if (desk.previewsEmpty?.(this)) this.showSelected(desk, actor); }

  /**
   * Show the selected row's note (a group's header shows nothing): when the selection changes (a step, a pick, `b`
   * listing another note's links), never because the tile was given the keys (PIE-1426: a preview gone back stays).
   * Asked before its rows are read, it shows once they are.
   */
  showSelected(desk: DeskApi, actor: Actor) {
    if (!this.data) { if (this.target) this.showOnLoad = actor; return; }
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
  private linkData(): LinkData {
    return { links: this.authored, backlinks: this.data ? { kind: "ready", value: this.data } : { kind: "loading" }, ...(this.groups.includes("children") ? { children: this.children } : {}), ...(this.groups.includes("parents") ? { parents: this.parents } : {}) };
  }
  /** The groups listed, as the model's `only` (left out when every one is). */
  private only(): ReadonlySet<LinkGroupName> | undefined { return new Set(this.groups); }
  /** The rows as shown: the groups this tile lists (the shared links model), each folding, the filter on all of them. */
  rows(): LinkRow[] {
    const only = this.only();
    return this.target ? linkRows(this.linkData(), { shut: this.shut, kinds: this.expanded, backlinks: this.opts(), sortAll: true, ...(only ? { only } : {}) }) : [];
  }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.sync(desk);
    this.controls = [];
    if (!this.target) return { lines: [fg(C.dark) + pad(`the links of what ${this.sourceLabel()} shows land here`, w) + RESET] };
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.data) return { lines: [fg(C.dark) + pad("asking the service…", w) + RESET] };
    const rows = this.rows();
    // The status is the first lines of the list, in slots that stay where they are (layoutLinksStatus).
    const st = layoutLinksStatus(this.statusParts(), w, Math.max(2, Math.floor(h / 2)), p => this.sgrOf(p));
    const lines: string[] = Array.from({ length: st.rows }, () => "");
    const xs: number[] = Array.from({ length: st.rows }, () => 0);
    for (const s of st.segs) { lines[s.y] += " ".repeat(Math.max(0, s.x - xs[s.y]!)) + s.sgr + pad(s.text, s.cols) + RESET; xs[s.y] = s.x + s.cols; }
    this.controls = st.segs.filter(s => s.control);
    this.head = st.rows;
    const fit = Math.max(1, h - this.head);
    // The selection kept within the rows (one pass over them: `sel` asks the model again each time it is read).
    const kept = rows.findIndex(r => r.key === this.list.pickedId(PERSON));
    const sel = Math.max(0, Math.min(kept < 0 ? 0 : kept, rows.length - 1));
    if (rows[sel]) this.list.setPick(PERSON, rows[sel].key);
    // The look's list rows (PIE-673): gaps between rows, a divider between groups (dots by default), zebra on every other.
    const v = desk.lookOf?.(this)?.values ?? BASE_STYLE;
    this.syncList(rows);
    const drawn = this.list.draw({ cols: w, lines: v["rows.lines"], focused, selection: true, room: fit, look: v, divide: r => r.source?.kind === "group", filterLine: false, empty: "" });
    this.rowAt = drawn.rowAt;
    lines.push(...drawn.lines);
    if (!rows.some(isLinkEntry) && this.opts().filter) lines.push(fg(C.dark) + " nothing matches · the status line's controls, / and esc change what shows" + RESET);
    return { lines };
  }

  /** The status line's parts: the filter (as it's typed), the view's controls, and how much the service sent. */
  private statusParts(): BacklinkStatusPart[] {
    const o = this.opts(), typing = this.draft;
    // The counters per group are the groups' control: a click on them chooses which this tile lists.
    const parts = backlinkStatusParts(backlinkView(this.data, o), o, o.filter, this.across(o)).filter(p => typing === null || p.control !== "filter")
      .map(p => (p.slot === "by" ? { ...p, control: "groups" as const } : p));
    if (typing !== null) parts.unshift({ text: `Filter: ${typing.plain()}`, control: "filter", slot: "filter" });
    if (this.data?.completeness.kind === "truncated") parts.push({ text: `first ${this.data.completeness.limit ?? this.data.sources.length} sources` });
    return parts;
  }
  /** How the view narrowed all three groups, and the kinds in any of them. */
  across(o: BacklinkViewOptions = this.opts()) { return linkAcross(this.linkData(), o, this.only()); }
  private sgrOf(p: BacklinkStatusPart) { return this.draft !== null && p.control === "filter" ? fg(C.yellow) : p.control ? fg(C.lcyan) : fg(C.grey); }
  /**
   * Pick row `i`: a group opens or folds (on open); a link is shown where this tile's selection goes (read only),
   * or opened (a Resource registered if it must be, as the Tree's ⏎). As `actor`: an agent's never moves the
   * person's keys (the desk's rule for every open).
   */
  async pick(i: number, how: PickHow, desk: DeskApi, actor: Actor = USER, standing = standsAsPerson(actor, desk.ctx.person?.() ?? NOBODY, "tile")): Promise<{ row: number; id?: string; group?: string; resource?: string; registered?: boolean }> {
    const rows = this.rows();
    const r = rows[i];
    if (!r) throw new ActionRefused(this.data ? `pick a row from 1 to ${rows.length}` : "the links are still being read");
    const agent = !standing;
    // An agent's pick is its own: the person's selection stays where it is.
    if (!agent) { this.sel = i; this.headerPicked = !isLinkEntry(r); }
    // A header shows nothing; opening one is its fold (the list's `run` activation: listHost.open).
    if (r.kind === "group" || r.kind === "kind") {
      desk.redraw();
      return { row: i + 1, group: r.kind === "group" ? r.group : r.group.kind };
    }
    const address = this.target?.address;
    const ctx = address ? await outlineBoards(desk.ctx).on(address) : desk.ctx;
    const target = linkTargetOf(r);
    let result: { note: Msg; registered?: boolean };
    if (target?.outline) {
      const at = { outline: target.outline, machine: target.machine ?? ctx.machine };
      const note = await readTarget(ctx, { ...target, ...at });
      if (!note) throw new ActionRefused(`nothing answers at ${target.block ?? target.page} in ${target.outline}`);
      note.address = at;
      result = { note };
    } else {
      result = await linkNote(r, ctx.board, how === "show" ? "show" : "open", actor, this.target?.id);
      result.note.address = address;
    }
    const { note: m, registered } = result;
    // The selection may have moved on while the note was read: only the latest pick shows.
    if (!agent && rowKey(this.rows()[this.sel]) !== rowKey(r)) return { row: i + 1, id: m.id };
    // Shown: where this tile's select wires go only (its previews); its home, whose links these are, keeps its note.
    if (how === "show" && desk.showFrom) desk.showFrom(this, m, actor);
    else {
      // The person's open moves their selection there too: the preview following this tile shows it as well.
      if (!agent && how === "open" && desk.showFrom) desk.showFrom(this, m);
      // Opened in its home, it's a row of this list, never its subject (PIE-794).
      if (how === "open") this.landed = m.id;
      if (how === "show") desk.showFrom?.(this, m, actor);
      else desk.openFromTile(m, { from: this, link: true, ...(how === "fresh" ? { fresh: true } : {}), by: actor });
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
        const kinds = this.across({ ...o, kind: null }).kinds;
        if (!kinds.length) { said = "nothing to pick: no link has a kind (this service sends no facets)"; return; }
        o.kind = nextBacklinkKindFilter(o.kind, kinds);
        said = o.kind ? `links: only ${kinds.find(k => k.kind === o.kind)?.label ?? o.kind}` : "links: every kind";
      } else if (c === "stage") { o.stage = nextBacklinkStageFilter(o.stage, this.across({ ...o, stage: "all" }).stages); said = o.stage === "all" ? "links: every stage" : `links: only ${o.stage}`; }
      else if (c === "resolved") { o.showResolved = !o.showResolved; said = o.showResolved ? "showing resolved comments" : "hiding resolved comments"; }
      else if (c === "related") { o.showRelated = !o.showRelated; said = o.showRelated ? "showing this note and its descendants" : "hiding this note and its descendants"; }
      // With nothing listed (no note aimed at, the answer not in, a problem) the filter would draw nowhere and take the
      // next key unseen (PIE-1459): say so instead, and keep the keys the tile's.
      else if (c === "filter" && (!this.target || !this.data || this.problem)) said = `nothing to filter: ${!this.target ? `this tile lists the links of what ${this.sourceLabel()} shows, and it shows no note` : this.problem ? this.problem : "the links are still being read"}`;
      else if (c === "filter") { if (!this.draft) { this.list.setFilter(PERSON, o.filter); this.list.startTyping(filterLine); } said = ""; }   // plain words over rows already listed
      else if (c === "groups") said = "";   // the groups' list is backlinks.groups's (it needs the screen)
    });
    return said;
  }

  describe() {
    const brief = this.target ? { id: this.target.id, title: subject(this.target) } : null;
    if (!this.data) return { source: this.source, target: brief, linkGroups: [...this.groups], loading: !!this.target && !this.problem, problem: this.problem || undefined };
    const o = this.opts();
    // Detail's backlink view (its counts, options, kind groups), and every row as the list numbers them. The rows and
    // the pick are found once: `sel` lists the rows to find its row, so asked per row it was a layout.get that took
    // seconds with a few hundred links (PIE-1303).
    const rows = this.rows(), sel = this.sel;
    return { source: this.source, target: brief, ...describeBacklinkView(backlinkView(this.data, o), o, this.expanded, undefined, this.across(o)), rows: rows.map((r, i) => describeLinkRow(r, i + 1, i === sel)), folded: [...this.shut], linkGroups: [...this.groups], typing: this.draft?.text ?? null };
  }

  run(desk: DeskApi, name: "backlinks" | "backlinks.view" | "backlinks.fold" | "backlinks.groups", args: Record<string, unknown>) { runOwn(BACKLINKS_ACTIONS, name, args, { pane: this, desk }); }
  /** A list action (list.pick, list.open, …) on this tile's list, through the desk's dispatcher as the person's key or click. */
  runList(desk: DeskApi, name: "list.pick" | "list.step" | "list.open" | "list.filter", args: Record<string, unknown>) { runOwn(LISTVIEW_ACTIONS, name, args, { pane: this, desk }); }

  /** Give the list the model's rows as they are now (the tile's rows are computed, so it is told before it draws or answers). */
  private syncList(rows: readonly LinkRow[] = this.rows()) {
    this.list.set(rows.map(r => linkListRow(r, { folds: true, select: "all" })));
  }

  /** This tile's one list, as the lists' actions run over it. */
  private handle(desk: DeskApi): ListHandle<LinkRow> {
    this.syncList();
    return {
      n: 1, key: "links", title: this.title(), view: this.list, entered: !!desk.hasFocus?.(this),
      describeRow: (row, n) => ({ kind: row.source!.kind, ...(linkBlock(row.source) ? { id: linkBlock(row.source)! } : {}), n }),
    };
  }

  /** The lists' actions over this tile (PIE-747): one list, whose picks and opens are this tile's. */
  listHost(desk: DeskApi): ListHost {
    return {
      lists: () => (this.target ? [this.handle(desk)] : []),
      current: () => "links",
      none: this.target ? "the links are still being read" : `no links are listed here: the links of what ${this.sourceLabel()} shows land in this tile (b aims it at a note)`,
      // The person's pick moved: the row shows where this tile's selection goes (a preview following), as moving to it always did.
      picked: (_l, row) => {
        const rows = this.rows(), i = rows.findIndex(r => r.key === row.id);
        if (i < 0) return;
        this.sel = i; this.headerPicked = !isLinkEntry(rows[i]);
        return this.pick(i, "show", desk, USER).then(() => {}, () => {});
      },
      open: async (_l, row, where, actor, standing) => {
        const i = this.rows().findIndex(r => r.key === row.id);
        if (i < 0) throw new ActionRefused(`${row.label} isn't listed now`);
        const act = row.do && "run" in row.do ? row.do.run : null;
        // A header's activation is its fold: the person's view, an agent's is refused (LINK_GROUPS_ARE_THE_PERSONS).
        if (act) {
          if (!standing) throw new ActionRefused(LINK_GROUPS_ARE_THE_PERSONS);
          this.sel = i; this.headerPicked = true;
          this.run(desk, act.action as "backlinks.fold", act.args ?? {});
          return { row: i + 1, group: act.args?.kind };
        }
        return this.pick(i, where === "new" ? "fresh" : "open", desk, actor, standing);
      },
      enter: () => { throw new ActionRefused("a links tile's list has the keys whenever the tile does: focus the tile (tile.focus) rather than going into it"); },
      type: () => this.run(desk, "backlinks.view", { step: "filter" }),
      keep: (_l, words) => this.run(desk, "backlinks.view", { filter: words }),
      redraw: () => desk.redraw(),
    };
  }

  /** Typing a filter: letters go into it and the list follows; ⏎ keeps it (`backlinks.view filter=`), esc goes back to what it was. */
  private filterKey(k: Key, desk: DeskApi): boolean {
    if (k.kind === "enter") { const f = this.draft?.text.trim() ?? ""; this.list.stopTyping(false); this.run(desk, "backlinks.view", { filter: f }); return true; }
    if (k.kind === "esc") this.list.stopTyping(false);
    else if (!this.draft?.take(k)) return k.kind !== "tab" && k.kind !== "backtab";
    this.keepSel(() => {});
    desk.redraw();
    return true;
  }
  /** It loses the keys while a filter is typed: what's typed is kept, as leaving Detail's filter keeps it. */
  blur() { if (this.draft !== null) { this.options = { ...this.options, filter: this.draft.text.trim() }; this.list.stopTyping(false); } }

  key(k: Key, desk: DeskApi): boolean {
    if (this.draft !== null && k.kind !== "mouse") return this.filterKey(k, desk);
    const n = this.rows().length, c = ch(k);
    // The selection moves at once (the next key counts from it); the source is read and shown after.
    const to = (i: number) => { if (n && i >= 0 && i < n && i !== this.sel) this.runList(desk, "list.pick", { n: i + 1 }); return true; };
    const by = (d: number) => { const i = this.sel + d; if (n && i >= 0 && i < n) this.runList(desk, "list.step", { by: d }); return true; };
    if (isDown(k)) return by(1);
    if (isUp(k)) return by(-1);
    if (k.kind === "home") return to(0);
    if (k.kind === "end") return to(n - 1);
    if (k.kind === "enter" || k.kind === "alt-enter") { if (n) this.runList(desk, "list.open", { n: this.sel + 1, where: k.kind === "alt-enter" ? "new" : "home" }); return true; }
    // Back and forward (PIE-1426): the note it listed before, as in a reader (tile.travel walks this tile's trail).
    const travel = historyKey(k);
    if (travel) { void desk.perform?.("tile.travel", { dir: travel < 0 ? "back" : "forward" }, USER, this)?.catch((e: Error) => desk.ctx.flash(e.message)); return true; }
    // b: the list aims at its home's note now (PIE-794), as b in that reader does.
    if (c === "b") { this.run(desk, "backlinks", {}); return true; }
    if (c === "." || c === " ") { this.run(desk, "backlinks.fold", {}); return true; }
    const control: Record<string, BacklinkControl> = { s: "sort", K: "kind", w: "stage", h: "resolved", n: "related" };
    if (control[c]) { this.run(desk, "backlinks.view", { step: control[c]! }); return true; }
    if (c === "/") { this.run(desk, "backlinks.view", { step: "filter" }); return true; }
    if (c === "v") { this.run(desk, "backlinks.groups", { choose: true }); return true; }
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
    if (c?.control === "groups") { this.run(desk, "backlinks.groups", { choose: true }); return true; }
    if (c?.control) { this.run(desk, "backlinks.view", { step: c.control }); return true; }
    // A gap or a divider row is the list's drawing, not a row: a press there selects nothing.
    const i = this.rowAt[y - this.head] ?? -1, row = this.rows()[i];
    if (y < this.head || !row) return true;
    const gesture = this.list.press(i, pressOn(k, press, i === this.sel));
    const header = row.kind === "group" || row.kind === "kind";
    if (header && gesture !== "focus" && x <= row.depth * 2 + 1) { this.runList(desk, "list.open", { n: i + 1 }); return true; }
    if (gesture === "open" || gesture === "fresh") this.runList(desk, "list.open", { n: i + 1, where: gesture === "fresh" && !header ? "new" : "home" });
    else if (gesture === "select" || i !== this.sel) this.runList(desk, "list.pick", { n: i + 1 });
    return true;
  }
}

/** A backlinks tile's actions: which row is picked (and where it opens), and the view's options. */
export interface BacklinksOn { pane: BacklinksPane; desk: DeskApi; standing: boolean }
export const BACKLINKS_ACTIONS = actionSet<BacklinksOn>()("backlinks", {
  "backlinks": def({
    summary: "a backlinks tile's view as Detail groups it: counts, groups with stage counts, each row. An agent's reads the person's view (or id=<block id>'s) with its own options on top and changes nothing of theirs; the person's (b, as=you) aims the list: it lists the links of id (else of the note in the reader they read through; in the list itself, its home's), and that reader becomes its home, its dock sliding open, and sets their options; its rows and controls are backlinks.pick, backlinks.view and backlinks.fold",
    keys: "b",
    touches: "nothing", replay: "safe",
    args: {
      id: { type: "string", optional: true, about: "the note whose backlinks to read; default the tile's" },
      filter: { type: "string", optional: true, about: "text to match, as / filters" },
      kind: { type: "string", optional: true, about: "one kind (its key or label), or all" },
      stage: { type: "string", optional: true, about: "all, open, a family (waiting, draft, active, done), a value as the notes write it (answered), or other (a value stages= doesn't name)" },
      stages: { type: "string", optional: true, about: "the stage values the list names, in order (next,doing,waiting): its headers and Stage control use them, other values are said as other, never hidden; all clears it. Saved with the layout" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
    },
    examples: [
      { act: "backlinks tile=replies filter=seed", does: "answers the replies tile's rows that match seed, changing nothing of the person's" },
      { act: "backlinks id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 stage=open", does: "answers that note's backlinks still open, grouped as Detail does" },
    ],
    async run(args, { pane: L, desk, standing }, actor) {
      const { id, ...want } = args;
      const open = (desk.shownNow?.(L) ?? true) && !!L.target;
      const same = !id || (open && (L.target!.id === id || (id.length >= 8 && L.target!.id.startsWith(id))));
      const viewing = Object.values(want).some(v => v !== undefined);
      const kindsOf = (data: BacklinkCollection | null, o: BacklinkViewOptions, links: Load<AuthoredLinksSnapshot>) => linkAcross({ links, backlinks: data ? { kind: "ready", value: data } : { kind: "loading" } }, { ...o, kind: null }).kinds;
      const parse = (base: BacklinkViewOptions, data: BacklinkCollection | null, links: Load<AuthoredLinksSnapshot> = L.authored) => { try { return backlinkOptionsFrom(base, want, kindsOf(data, base, links)); } catch (e) { throw new ActionRefused((e as Error).message); } };
      if (standing) {
        // The person's b (or one naming a note): the list aims at it; their view options alone keep the list where it is.
        if (id || !viewing || !open) {
          const m = id ? await desk.ctx.board.get(id) : null;
          if (id && !m) throw new ActionRefused(`no block ${id}`);
          if (!desk.aimBacklinks) throw new ActionRefused("backlinks aim at a reader's note on a screen with readers");
          await desk.aimBacklinks(L, m, undefined, actor);
        } else if (!L.data && L.target) await L.load(L.target, desk, true);
        if (!viewing) return { backlinks: L.describe() };
        const next = parse(L.options, L.data);
        L.list.stopTyping(false);
        L.options = next;
        desk.redraw();
        return { backlinks: L.describe() };
      }
      if (!id && !open) throw new ActionRefused("no backlinks are listed here; id=<block id> reads a note's backlinks (b opens them on a reader's note)");
      const target = same ? L.target! : await desk.ctx.board.get(id!);
      if (!target) throw new ActionRefused(`no block ${id}`);
      const board = target.address ? (await outlineBoards(desk.ctx).on(target.address)).board : desk.ctx.board;
      const data = same && L.data ? L.data : await board.backlinks(target.id);
      // The person's options carry over only for the note they're looking at; another note starts as Detail's.
      const base = same ? { ...L.options } : { ...DEFAULT_BACKLINK_VIEW_OPTIONS, sortField: L.options.sortField, sortDirection: L.options.sortDirection };
      // Its authored links too: the counts and kinds are across all three groups, as the person's.
      const links: Load<AuthoredLinksSnapshot> = same && L.authored.kind === "ready" ? L.authored : await board.authoredLinks(target.id).then(value => ({ kind: "ready" as const, value }), () => ({ kind: "loading" as const }));
      const o = parse(base, data, links);
      desk.ctx.flash(`${agentLabel(actor)} read the backlinks of ${subject(target)}`);
      const all: LinkData = { links, backlinks: { kind: "ready", value: data } };
      const listed = linkRows(all, { shut: new Set(), kinds: same ? L.expanded : new Set(), backlinks: o, sortAll: true }).map((r, i) => describeLinkRow(r, i + 1, false));
      return { backlinks: { target: { id: target.id, title: subject(target) }, ...describeBacklinkView(backlinkView(data, o), o, same ? L.expanded : new Set(), undefined, linkAcross(all, o)), rows: listed } };
    },
  }),
  "backlinks.fold": def({
    summary: "open or fold a group in a links tile: one of the three (outlinks, resources, backlinks) or a backlink kind (kind=<its key or label>); default the selected row's, as . or space on it does (a link's: its own group). Every backlink kind is open while a filter is set. The person's view: an agent's is refused",
    keys: ". space, a click on a group's ▾ ▸ + −, a double click on its header",
    touches: "tile", replay: "safe", person: LINK_GROUPS_ARE_THE_PERSONS,
    args: { kind: { type: "string", optional: true, about: "outlinks, resources or backlinks, or a backlink kind (its key, as peek's rows give it, or its label); default the selected row's" } },
    examples: [
      { act: "backlinks.fold tile=replies kind=outlinks", does: "opens or folds the outlinks group in the links tile" },
    ],
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
  "backlinks.groups": def({
    summary: "which groups a links tile lists: show=<groups> (outlinks, resources, backlinks, children, parents, comma-separated, or all), toggle=<group> one on or off, choose=true opens the person's list of them. Parents lists the ancestor path and starts off. Saved with the layout. Children alone is the thread tile's replies. At least one group stays",
    keys: "v, a click on N sources or the counters (→ ♦ ← ↓); in its list ⏎ or a click switches one",
    touches: "tile", replay: "safe", way: "an agent changes the groups of a links tile the person isn't in", says: r => (r.groups ? `links tile lists ${(r.groups as string[]).join(", ")}` : null),
    menu: { label: "choose its groups", group: "Links", key: "v", args: { choose: true } },
    args: {
      show: { type: "string", optional: true, about: "the groups, comma-separated (outlinks, resources, backlinks, children, parents), or all" },
      toggle: { type: "string", optional: true, about: "one group to switch on or off" },
      choose: { type: "boolean", optional: true, about: "open the list of groups (the person's)" },
    },
    examples: [
      { act: "backlinks.groups tile=replies show=outlinks,backlinks", does: "lists only the outlinks and backlinks groups" },
      { act: "backlinks.groups tile=replies toggle=resources", does: "switches the resources group on or off" },
    ],
    run({ show, toggle, choose }, { pane, desk, standing }, actor) {
      if ([show, toggle, choose].filter(x => x !== undefined && x !== false).length !== 1) throw new ActionRefused("backlinks.groups takes one of show, toggle or choose");
      if (choose) {
        if (!standing) throw new ActionRefused("the groups' list is the person's; an agent passes show= or toggle=");
        pane.chooseGroups(desk);
        return { choosing: true, groups: undefined };
      }
      let next: LinkGroupName[];
      if (show !== undefined) next = linkGroupsFrom(show) ?? [...ALL_LINK_GROUPS];
      else {
        const g = toggle!.trim().toLowerCase();
        if (!(ALL_LINK_GROUPS as readonly string[]).includes(g) || !isLinkGroup(g)) throw new ActionRefused(`${toggle} isn't a group; the groups are ${ALL_LINK_GROUPS.join(", ")}`);
        next = pane.groups.includes(g) ? pane.groups.filter(x => x !== g) : [...pane.groups, g];
        if (!next.length) throw new ActionRefused(`${g} is the only group this tile lists; turn another on first`);
      }
      pane.setGroups(next, desk);
      return { groups: [...pane.groups] };
    },
  }),
  "backlinks.view": def({
    summary: "change a backlinks tile's view as Detail's controls do: filter (text to match), kind (a kind or all), stage (all, open, waiting, draft, active, done), resolved, related, sort (updated, created, title, -asc or -desc); step=filter starts typing one (the person's)",
    keys: [{ keys: "K w h n s", does: "a setting of the view" }, { keys: "click", does: "on the status line" }, { keys: "/", does: "then typing sets the filter" }, { keys: "backspace ctrl+u", does: "edit the filter" }, { keys: "⏎", does: "keeps it", says: "keep the typed filter" }, { keys: "esc", does: "goes back", says: "leave the filter box" }],
    touches: "nothing", replay: "safe", says: r => (r.said ? `· ${r.said}` : "changed the backlinks view"),
    args: {
      filter: { type: "string", optional: true, about: "text to match, as / filters (empty clears)" },
      kind: { type: "string", optional: true, about: "a kind or its label, or all" },
      stage: { type: "string", optional: true, about: "all, open, a family (waiting, draft, active, done), a value as the notes write it (answered), or other (a value stages= doesn't name)" },
      stages: { type: "string", optional: true, about: "the stage values the list names, in order (next,doing,waiting): its headers and Stage control use them, other values are said as other, never hidden; all clears it. Saved with the layout" },
      resolved: { type: "boolean", optional: true, about: "show resolved comments" },
      related: { type: "boolean", optional: true, about: "show this note and its descendants" },
      sort: { type: "string", optional: true, about: "updated, created or title, optionally -asc or -desc" },
      step: { type: "string", optional: true, about: "a control stepped to its next value, as its key does: kind, stage, resolved, related or sort; filter starts typing one" },
    },
    examples: [
      { act: "backlinks.view tile=replies filter=seed sort=updated-desc", does: "lists the links matching seed, newest first" },
      { act: "backlinks.view tile=replies step=stage", does: "steps the Stage control to its next value" },
    ],
    run({ step, ...args }, { pane, desk, standing }, actor) {
      if (step !== undefined) {
        if (!(["kind", "stage", "resolved", "related", "sort", "filter"] as string[]).includes(step)) throw new ActionRefused(`step is filter, kind, stage, resolved, related or sort, not ${step}`);
        if (step === "filter" && !standing) throw new ActionRefused("typing a filter is the person's; an agent passes filter=<text>");
        const said = pane.control(step as BacklinkControl);
        if (said) desk.ctx.flash(said);
        desk.redraw();
        return { backlinks: pane.describe(), ...(said ? { said } : {}) };
      }
      const kinds = pane.across({ ...pane.options, kind: null }).kinds;
      let next: BacklinkViewOptions;
      try { next = backlinkOptionsFrom(pane.options, args, kinds); } catch (e) { throw new ActionRefused((e as Error).message); }
      pane.options = next;
      desk.redraw();
      return { backlinks: pane.describe() };
    },
  }),
});
