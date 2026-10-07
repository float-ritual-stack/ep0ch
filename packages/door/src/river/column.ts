// The River (Quay) as a screen spec on the desk (PIE-515): its columns are tiles of one kind, `river.column`, in a
// flow container, the layout engine's (PIE-513: full → peek → spine around the wide column, opens into the next
// column, back and forward by the trail, held columns). A column is a reader of the shared note surface whose view
// is the river's own: the Library (every top-level note), a note with its replies, or a #value virtual branch (every
// note with key::value). Reading keeps the river's cards; editing, quoting and comment threads draw the surface in the
// column, with the same keys and the same actions as every reader. What the column adds is its own: picking a card,
// replies in place, a filter, a column of the same property, a column stacked under it, its text selected and copied.
// The layout (widen, hold, close, back and forward) is the engine's tile actions.
import { bodyLinesOf, subject, type Msg } from "../board";
import { USER, type Actor, type IndexBlock, type OutlineEvent, type SocketBoard } from "../socket";
import { ActionRefused, actionSet, def, keyName } from "../surface/actions";
import { historyRow, IN_TRASH, type Link } from "../surface/note";
import { inWindow, type Placement } from "../kitty";
import { Gesture, isCopyKey, lineAt, modeKey, paintRange, rowsOf, SELECT_BG, Selection, selectionHint, wordAt, type Pos } from "../surface/selection";
import { presentLinks } from "../refs";
import { describeLinkRow, linkNote, linkRowLine, linkRows, linksOf, type LinkGroupName, type LinkRow } from "../links";
import { isOutlineNote } from "../authored";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS } from "../backlinks";
import { outlineState, readState, writeState } from "../state";
import { C, fg, pad, paint, RESET, selected, visible } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago, wrap } from "../text";
import { lastTop, RowPresses, scrolled, sideways, wheelRows, type RowPress } from "../scroll";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import { ReaderPane, runOwn, type DeskApi, type PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import type { KindHost, TileKind, TileKindName } from "../desk/tile-kinds";
import type { TileSpec } from "../desk/tiles";
import { LineInput } from "../surface/line";
import { COMPLETION_HINT, COMPLETION_ROWS, completerOf, completionOf, lookupCompletion, renderCompletion, type CompletionBoard } from "../surface/completer";
import { filterTargetAtCursor } from "../completion";
import { Fold } from "../fold";
import { matchesSearchText, prepareSearchQuery, type SearchQuery } from "@ep0ch/outline-core/search-match";

/** A property notice or an agent line in a column the person isn't in clears after this long on screen. */
export const BANNER_MS = 30_000;
const CHIP_COLOURS = [C.lgreen, C.lcyan, C.yellow, C.lmagenta, C.lred, C.lblue];
const GLYPH: Record<string, string> = { hub: "◎", workboard: "▦", workspace: "▣", notes: "▤", "virtual-branch": "⑂", "roadmap-item": "◆", proof: "✓", synthesis: "✦", inbox: "✉", note: "·" };

// ── what a column shows ──────────────────────────────────────────────────────

/** The Library (top-level notes), a note and its replies, or a virtual branch (every note with key::value). */
export type Source = { kind: "roots" } | { kind: "block"; id: string } | { kind: "tag"; key: string; value: string };
interface Clause { key: string; value: string; exclude: boolean }
interface Row { m: Msg; depth: number }
/** A row as drawn: its card (-1: none), whether it's the replies toggle, the links on it, the history row's parts. */
type HitRow = { card: number; replies: boolean; linksHead?: boolean; links?: { from: number; to: number; link: Link }[]; history?: { from: number; to: number; dir: -1 | 1 }[]; fold?: { to: number; n: number } };

/** A source as a tile spec writes it: `roots`, `block:<id>`, `tag:<key>=<value>`. */
export const sourceText = (s: Source) => (s.kind === "roots" ? "roots" : s.kind === "block" ? `block:${s.id}` : `tag:${s.key}=${s.value}`);
export function parseSource(x: string | undefined): Source {
  if (x?.startsWith("block:") && x.length > 6) return { kind: "block", id: x.slice(6) };
  const t = /^tag:([^=]+)=(.+)$/.exec(x ?? "");
  return t ? { kind: "tag", key: t[1]!, value: t[2]! } : { kind: "roots" };
}

const repliesWord = (n: number) => `${n} repl${n === 1 ? "y" : "ies"}`;
const authorColour = (a: string | null) => {
  const s = (a ?? "").toLowerCase();
  if (s === "user" || s === "detail" || s === "tree") return C.yellow;
  if (s === "system") return C.cyan;
  return C.lmagenta;
};
const chipColour = (key: string) => CHIP_COLOURS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % CHIP_COLOURS.length]!;
const chips = (props: Record<string, string>) =>
  ["type", "status", "stage", "project", "priority"].filter(k => props[k]).map(k => `${fg(chipColour(k))}#${props[k]}${RESET}`).join(" ");
const glyph = (m: Msg) => GLYPH[m.props.type ?? ""] ?? "◇";
// Properties are in the chips; inside a literal region (PIE-422) `[key::value]` is text, so it stays.
const bodyLines = (m: Msg) => bodyLinesOf(m.text).map(l => (l.literal ? l.text : withoutPropertyTokens(l.text)).trimEnd()).filter(l => l.trim());

export function parseFilter(s: string): Clause[] {
  return s.split(/\s+/).filter(Boolean).map(tok => {
    const exclude = tok.startsWith("-");
    const body = exclude ? tok.slice(1) : tok;
    const at = body.indexOf(":");
    return at > 0 ? { key: body.slice(0, at), value: body.slice(at + 1), exclude } : { key: "text", value: body, exclude };
  });
}
export const filterText = (f: Clause[]) => f.map(c => `${c.exclude ? "-" : ""}${c.key === "text" ? "" : c.key + ":"}${c.value}`).join(" ");
/** The clauses the service's query has no word for: who wrote the note (`author:`) and its text (a bare word). */
/** A word clause's query, prepared once for every row it's matched against. */
const preparedQueries = new WeakMap<Clause, SearchQuery | null>();
const prepared = (c: Clause) => { if (!preparedQueries.has(c)) preparedQueries.set(c, prepareSearchQuery(c.value)); return preparedQueries.get(c)!; };
const ownClause = (c: Clause) => c.key === "author" || c.key === "text";
function passesOwn(m: Msg, f: Clause[]): boolean {
  return f.filter(ownClause).every(c => {
    // A word: outline-core's matcher (punctuation folded, a typo forgiven); `-word` lists exactly what `word` leaves out.
    const hit = c.key === "text" ? matchesSearchText(prepared(c), [m.text]) : c.value === "*" || (m.author ?? "").toLowerCase() === c.value.toLowerCase();
    return c.exclude ? !hit : hit;
  });
}
/** The rest, property clauses, as the service's query (`query.matches` answers which notes it holds for): `key:*` is `key`. */
export const filterQuery = (f: Clause[]) =>
  f.filter(c => !ownClause(c)).map(c => `${c.exclude === !c.value ? "" : "NOT "}${c.key}${c.value === "*" || !c.value ? "" : `="${c.value.replace(/[\\"]/g, "\\$&")}"`}`).join(" ");
/** The properties `#` offers to follow: a note's own, but the machinery the door keeps. */
const followable = (m: Msg | undefined): [string, string][] => (m ? Object.entries(m.props).filter(([key]) => !["source-block", "proof", "work-batch"].includes(key)).slice(0, 9) : []);

// ── the outline's index: reply counts (one per service, shared by every column) ─────────────────

class OutlineIndex {
  counts = new Map<string, number>();
  loaded = false;
  private asking = false;
  private at = 0;
  set(list: IndexBlock[]) {
    this.counts = new Map();
    for (const b of list) if (b.parentId) this.counts.set(b.parentId, (this.counts.get(b.parentId) ?? 0) + 1);
    this.loaded = true;
  }
  count(id: string): number | undefined { return this.loaded ? this.counts.get(id) ?? 0 : undefined; }
  /** Read again from the service (at most once a minute unless `now`), cached in the door's state for the next start. */
  refresh(board: SocketBoard, redraw: () => void, now = false) {
    if (this.asking || (!now && Date.now() - this.at < 60_000)) return;
    this.asking = true;
    board.index().then(list => { this.set(list); this.at = Date.now(); this.asking = false; writeState("river-index.json", { blocks: list }, outlineState()); redraw(); }, () => { this.asking = false; });
  }
}
const indexes = new WeakMap<SocketBoard, OutlineIndex>();
function indexOf(board: SocketBoard): OutlineIndex {
  let i = indexes.get(board);
  if (!i) {
    indexes.set(board, i = new OutlineIndex());
    const cached = readState<{ blocks: IndexBlock[] }>("river-index.json", outlineState());
    if (cached?.blocks?.length) i.set(cached.blocks);
  }
  return i;
}

/** A column's filter line: its words are `key:value` (the property index and schemas complete them) or text. */
const filterInput = (text = "") => new LineInput(text, false, { complete: { grammar: "filter" } });

// ── a column ─────────────────────────────────────────────────────────────────

export class RiverColumn extends ReaderPane {
  override readonly kind: TileKindName = "river.column";
  /** A block column's note, as read; the Library's and a #tag's list. */
  root: Msg | null = null;
  items: Msg[] | null = null;
  /** Notes whose replies show in place, and those replies as read. */
  readonly fold = new Fold();
  /** The selected card (by row) and the first row drawn. */
  sel = 0;
  top = 0;
  error?: string;
  /** An input state of its own: the filter being typed (`/`), or the properties `#` offers. */
  mode: "" | "filter" | "tags" = "";
  input = filterInput();
  tagChoices: [string, string][] = [];
  /** Text the person selected in the column's drawn rows (PIE-419); only y copies it. */
  text: Selection | null = null;
  private shownSel?: number;
  private shownElem?: string | null;
  private height = 10;
  private maxTop = 0;
  private drawn: { lines: string[]; w: number } | null = null;
  private rows: HitRow[] = [];
  /** A block column's sticky header (the reader's, PIE-598): its rows, kept above the scroll, and where the digest starts. */
  private sticky: HitRow[] = [];
  private digestAt = 0;
  /** Rows above the cards (the filter's line): a click's row there isn't a card's. */
  private headRows = 0;
  /** The note's images on the column's rows (before its scroll), from its digest. */
  private images: Placement[] = [];
  private digestOf_: { key: string; m: Msg; s: Msg | null; dg: ReturnType<ReaderPane["surface"]["digest"]> } | undefined;
  private shown?: { key: string; at: number };
  private gesture = new Gesture();
  /** Presses on its cards: a second on the same card soon after is a double click. */
  private presses = new RowPresses();
  /**
   * A block column's links, under its replies (the shared links model, src/links.ts, as the links tile and the
   * inline `::links` draw them): whether they show (`b`, a click on their header), and which groups are folded.
   * Their rows follow the cards in the column's selection: j k walk on into them, ⏎ opens one in the next column.
   */
  linksShown = true;
  private linkShut = new Set<LinkGroupName>();
  private down: { row?: HitRow; link?: Link; fold?: number; same: boolean; fresh?: boolean; dragging: boolean } | null = null;
  private editDrag = false;
  /** The keys came here just now (a click that focuses it only focuses it). */
  private justFocused = false;
  private reload: Timer | null = null;
  private gen = 0;
  /** The listed notes the filter's property clauses hold for (`query.matches`), and which ask it is. */
  private matched: Set<string> | null = null;
  private asked = 0;
  /** Which load is the latest: an older one's answer, back after it, is dropped. */
  private loads = 0;
  private desk: DeskApi | null = null;

  constructor(public source: Source, public filter: Clause[] = []) { super(false); }

  /** What the tile needs to be built again: its source and its filter. */
  spec(): Record<string, unknown> { return { source: sourceText(this.source), ...(this.filter.length ? { filter: filterText(this.filter) } : {}) }; }

  /** The note the column's note actions act on: a block column's own; in the Library and a #tag, the selected one. */
  noteOf(): Msg | undefined {
    if (this.surface.editing) return this.surface.msg ?? undefined;
    return this.source.kind === "block" ? this.rootOf() ?? undefined : this.flat()[this.sel]?.m;
  }
  /** A block column's note: the newer of what the column read and what its surface has (after a save, a trash). */
  private rootOf(): Msg | null {
    const s = this.surface.msg, r = this.root;
    if (s && r && s.id === r.id && !s.partial && ((s.revision ?? 0) > (r.revision ?? 0) || (s.revision === r.revision && !!s.deleted !== !!r.deleted))) return s;
    return r;
  }

  titleOf(): string {
    if (this.source.kind === "roots") return "Library";
    if (this.source.kind === "tag") return `#${this.source.value}`;
    return this.root ? subject(this.root) : "…";
  }
  override title() {
    const st = this.surface.state();
    return `${this.titleOf()}${this.items ? ` ${this.listed()}` : ""}${st ? ` · ${st}` : ""}`;
  }
  /** Its header: its title (the Library, a note, #value), then how many it lists and what it holds. */
  headName() { return this.titleOf(); }
  headLabel() { const st = this.surface.state(); return `${fg(C.dark)}${this.items ? this.listed() : ""}${st ? `${fg(C.yellow)} · ${st}` : ""}${RESET}`; }
  override hint() {
    // Typing a filter or choosing a property: the hint row is its prompt (the screen's row shows a typing tile's own).
    if (this.mode === "filter") return completionOf(this.input) ? paint(`|08${COMPLETION_HINT}`) : paint(`|14/ filter this column: |15${this.input.plain()}|08 · type:hub -status:done author:codex word · |15⏎|08 apply · |15esc|08 cancel`);
    if (this.mode === "tags") return paint(this.tagChoices.length ? `|14same property|08 · ${this.tagChoices.map(([k, v], i) => `|15${i + 1}|08 ${k}:: |11${v}`).join("|08 · ")}|08 · |15esc|08 cancel` : "|14same property|08 · this note has no properties to follow · |15esc|08 back");
    if (this.surface.editing || this.linked()) return this.surface.hint();
    return "j k notes and links · ⏎ open beside · space replies · b links · / filter this column · # same property · s split · v select";
  }
  override spine() {
    const hold = this.surface.draft ? "✎" : this.surface.session ? "¶" : "";
    return { title: this.titleOf(), marks: [hold ? fg(C.yellow) + hold + RESET : fg(C.dark) + "·" + RESET] };
  }
  /** The desk's current note moved: a column keeps its own. */
  override select() {}
  /** Typing a filter, choosing a property, or selecting text by keys: its keys are its own. */
  typing() { return this.mode !== "" || !!this.text?.keys; }
  /** The filter's completion popup is open: tab chooses a candidate, as ⏎ does. */
  completing() { return this.mode === "filter" && !!completionOf(this.input); }
  blur() { if (this.mode) { this.mode = ""; this.input = filterInput(); } }
  focused(desk: DeskApi) { this.justFocused = true; this.desk = desk; }

  /** A note opened into this column (an open from the column before it): it becomes that note's column. */
  override hold(m: Msg, desk: DeskApi) {
    this.desk = desk;
    this.source = { kind: "block", id: m.id };
    this.root = m; this.items = null; this.sel = 0; this.top = 0; this.matched = null; this.asked++; this.fold.clear();
    this.surface.show(m, this.host(desk));
    this.load(desk);
  }

  /** Ask the service for what the column lists (a block column: its note again too). */
  load(desk: DeskApi) {
    this.desk = desk;
    const b = desk.ctx.board;
    indexOf(b).refresh(b, () => desk.redraw());
    // The replies shown under a note are read again with it, so a reply edited elsewhere never reads as it was.
    const ask = ++this.loads;
    const done = (items: Msg[]) => void this.fold.reread(id => b.children(id)).then(() => took(items));
    const took = (items: Msg[]) => { if (this.loads !== ask) return; this.items = items; this.error = undefined; this.sel = Math.min(this.sel, Math.max(0, items.length - 1)); this.showSelected(desk); void this.match(desk); desk.redraw(); };
    const fail = (e: Error) => { this.error = e.message; desk.redraw(); };
    if (this.source.kind === "roots") b.roots().then(done, fail);
    else if (this.source.kind === "tag") b.byProp(this.source.key, this.source.value).then(done, fail);
    else {
      const id = this.source.id;
      // The column's surface gets the new text too; an open draft is only marked "changed elsewhere".
      b.get(id).then(m => { this.root = m; if (m) this.surface.refresh(m); desk.redraw(); }, () => {});
      b.children(id).then(done, fail);
    }
  }

  /** In the Library and a #tag the surface shows the selected note (what e, C and m act on); a block column's, its own. */
  private showSelected(desk: DeskApi) {
    if (this.surface.editing) return;
    const m = this.source.kind === "block" ? this.rootOf() : this.flat()[this.sel]?.m;
    if (m && this.surface.msg?.id !== m.id) this.surface.show(m, this.host(desk));
  }

  /** The rows the column lists: its notes (the filter applied), with replies shown in place under theirs. */
  flat(): Row[] {
    const out: Row[] = [];
    this.fold.walk(this.items ?? [], (m, depth) => { if (depth === 0 && !this.passes(m)) return false; out.push({ m, depth }); });
    return out;
  }
  /** A block column's links as rows (none in the Library or a #tag column, or while they're hidden). */
  linkList(): LinkRow[] {
    const root = this.source.kind === "block" ? this.rootOf() : null;
    if (!root || !this.linksShown || !isOutlineNote(root)) return [];
    const data = linksOf(root.id) ?? { links: { kind: "loading" }, backlinks: { kind: "loading" } };
    // Every backlink kind open: a column is read top to bottom, not unfolded row by row.
    const kinds = data.backlinks.kind === "ready" ? new Set(backlinkView(data.backlinks.value, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds.map(k => k.kind)) : new Set<string>();
    return linkRows(data, { shut: this.linkShut, kinds, backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS });
  }
  /** Show or hide its links (`b`, a click on their header). */
  toggleLinks(on: boolean | undefined, desk: DeskApi): { shown: boolean } {
    this.linksShown = on ?? !this.linksShown;
    const n = this.flat().length;
    if (!this.linksShown && this.sel >= n) this.sel = Math.max(0, n - 1);
    desk.redraw();
    return { shown: this.linksShown };
  }
  /** ⏎ (or a double click) on link row `j`: a group folds or opens; a link opens in the next column (alt+⏎: a new one). */
  async openLink(j: number, fresh: boolean, desk: DeskApi, actor: Actor = USER): Promise<Record<string, unknown>> {
    const r = this.linkList()[j];
    if (!r) throw new ActionRefused(`no link row ${j + 1} in ${this.titleOf()}`);
    if (r.kind === "group" || r.kind === "kind") {
      if (actor.kind === "agent") throw new ActionRefused("which groups are folded is the person's view · peek reads every row (noteLinks)");
      if (r.kind === "group") { if (this.linkShut.has(r.group)) this.linkShut.delete(r.group); else this.linkShut.add(r.group); }
      desk.redraw();
      return { group: r.kind === "group" ? r.group : r.group.kind };
    }
    const { note } = await linkNote(r, desk.ctx.board, "open", actor);
    this.host(desk).navigate(note, { link: true, by: actor, ...(fresh ? { fresh: true } : {}) });
    return { opened: note.id };
  }

  /** How many notes it lists (its filter applied), not counting replies shown in place. */
  listed(): number { return (this.items ?? []).filter(m => this.passes(m)).length; }
  /** A listed note its filter keeps: the property clauses as the service answered them (none while it's asked). */
  private passes(m: Msg): boolean { return passesOwn(m, this.filter) && (!filterQuery(this.filter) || !!this.matched?.has(m.id)); }
  /** Ask the service which listed notes the filter's property clauses hold for (the last answer stands meanwhile). */
  private async match(desk: DeskApi): Promise<void> {
    const q = filterQuery(this.filter), items = this.items, asked = ++this.asked;
    if (!q || !items) { this.matched = null; return; }
    try { const ids = await desk.ctx.board.matchQuery(q, items.map(m => m.id)); if (asked === this.asked) { this.matched = ids; this.showSelected(desk); } }
    catch (e) { if (asked === this.asked) this.error = `filter: ${(e as Error).message}`; }
    desk.redraw();
  }

  /** A link is selected in its note: ⏎ follows it instead of opening the selected card. */
  private linked(): boolean { return !!this.surface.msg && this.surface.msg.id === this.noteOf()?.id && this.surface.describe().links.some(l => l.selected); }

  // ── drawing ──

  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    if (desk) this.desk = desk;
    // Editing, quoting, the thread list: the shared surface, drawn in the column.
    if (this.surface.editing && this.surface.msg) return super.render(w, h, focused, desk);
    const head: string[] = [];
    if (this.filter.length && this.mode !== "filter") head.push(fg(C.yellow) + pad(`≡ ${filterText(this.filter)}`, w) + RESET);
    const popup = this.mode === "filter" ? this.popupRows(w, h) : null;
    const foot = this.mode === "filter" ? [...(popup?.lines ?? []), paint("|14/ ") + this.input.show(w - 2)] : this.mode === "tags" ? this.tagLines(w) : [];
    // A block column keeps its note's header above the scroll, as a reader does: the reader's own (the surface's
    // stickyHeader), with the backdrop of a picture that has scrolled under it (PIE-598).
    const root = this.source.kind === "block" && desk ? this.rootOf() : undefined;
    const stuck = root && desk ? this.surface.stickyHeader(root, w, this.host(desk), 0).lines.length : 0;
    const room = Math.max(1, h - head.length - stuck - foot.length);
    const view = this.view(w, room, focused);
    const sticky = root && desk ? this.surface.stickyHeader(root, w, this.host(desk), this.top - this.digestAt) : null;
    this.sticky = (sticky?.lines ?? []).map((_, r) => ({ card: -1, replies: false, links: sticky!.links.filter(l => l.row === r) }));
    this.headRows = head.length + this.sticky.length;
    // Where the popup went, so a click on a candidate chooses it: right under the cards drawn above it.
    const pc = popup && completerOf(this.input);
    if (pc && popup) pc.drawn = { row: this.headRows + view.length, items: popup.rows };
    // The note's images, as a reader tile hands its own to the desk: cut to the rows the column shows.
    const placements = [...(sticky?.placements ?? []).map(p => ({ ...p, row: p.row + head.length })), ...this.images.flatMap(p => inWindow(p, this.top, room, this.headRows) ?? [])];
    return { lines: [...head, ...(sticky?.lines ?? []), ...view, ...foot].slice(0, h).map(l => pad(l, w)), placements };
  }

  /**
   * The filter's completion popup (PIE-626): its keys and values from the outline's property index, drawn above the
   * line being typed, over the cards. Where it went is kept, so a click on a candidate chooses it.
   */
  private popupRows(w: number, h: number): { lines: string[]; rows: (number | null)[] } | null {
    const pop = completionOf(this.input), c = completerOf(this.input);
    if (c) c.drawn = null;
    if (!pop || !c) return null;
    const rows: (number | null)[] = [];
    return { lines: renderCompletion(pop, w, Math.min(COMPLETION_ROWS, Math.max(0, h - 3)), rows), rows };
  }

  private tagLines(w: number): string[] {
    const head = paint("|14same property |08· a column of every note with it · 1-9 · esc");
    if (!this.tagChoices.length) return [head, fg(C.dark) + pad("this note has no properties to follow", w) + RESET];
    return [head, ...this.tagChoices.map(([k, v], i) => paint(`|15${i + 1} |08${k}:: |11${v}`))];
  }

  /** The column's rows as they show: its note (a block column) and its cards, scrolled; what a click reaches kept. */
  private view(w: number, rows: number, active: boolean): string[] {
    const desk = this.desk;
    const all: (HitRow & { text: string })[] = [];
    this.images = [];
    const push = (text: string, card = -1, replies = false) => all.push({ text, card, replies });
    if (this.error) push(fg(C.lred) + this.error + RESET);
    const root = this.rootOf();
    if (this.source.kind === "block" && root && desk) {
      // Its title, summary, byline and crumbs are the sticky header above the scroll (render).
      const m = root, host = this.host(desk);
      // Where back and forward go (its flow's trail), under the title where it's always in reach.
      const hr = historyRow(w, desk.travelPeek?.(this, -1) ?? null, desk.travelPeek?.(this, 1) ?? null);
      if (hr) all.push({ text: hr.line, card: -1, replies: false, history: hr.hits });
      for (const l of this.banner(m, w)) push(l);
      // The note's body through the shared surface's renderer (its digest): links as Detail reads them, transclusions,
      // step controls; a click on a link opens it in the next column; `[ ]` walks its elements; the column scrolls.
      if (this.surface.msg?.id !== m.id) this.surface.show(m, host);
      const dg = this.digest(m, w - 1, Math.max(4, Math.round(rows * 0.8))), at = all.length;
      this.digestAt = at;
      this.images = dg.placements.map(p => ({ ...p, row: p.row + at, col: p.col + 1 }));
      const byRow = new Map<number, { from: number; to: number; link: Link }[]>();
      for (const x of dg.links) { const r = byRow.get(x.row); const l = { from: x.from + 1, to: x.to + 1, link: x.link }; if (r) r.push(l); else byRow.set(x.row, [l]); }
      // A heading (or a list item's mark) is a fold point, as in a reader: a click on it folds or unfolds it.
      const folds = new Map(dg.folds.map(f => [f.row, { to: f.cols + 1, n: f.n }] as const));
      dg.lines.forEach((l, i) => all.push({ text: " " + l, card: -1, replies: false, links: byRow.get(i) ?? [], ...(folds.has(i) ? { fold: folds.get(i)! } : {}) }));
      // The element `[ ]` just stepped to comes into view (only when it changed: the wheel still reads on).
      if (dg.key !== (this.shownElem ?? null)) {
        this.shownElem = dg.key;
        if (dg.current !== null) { const row = at + dg.current; if (row < this.top) this.top = Math.max(0, row - 1); else if (row >= this.top + rows) this.top = row - rows + 2; }
      }
      const label = `── ${this.items ? repliesWord(this.listed()) : "… replies"} `;
      push(fg(C.blue) + label + "─".repeat(Math.max(0, w - label.length)) + RESET);
    }
    const flat = this.flat(), idx = desk ? indexOf(desk.ctx.board) : null;
    if (this.source.kind !== "block" && flat[this.sel]) for (const l of this.banner(flat[this.sel]!.m, w)) push(l);
    flat.forEach((row, n) => {
      const m = row.m, on = n === this.sel;
      const rail = fg(C.blue) + "│ ".repeat(row.depth) + RESET;
      const mark = on ? fg(active ? C.lcyan : C.grey) + "▌" + RESET : " ";
      const tw = Math.max(8, w - row.depth * 2 - 2);
      push(rail + mark + (on && active ? selected() : fg(C.white)) + pad(`${glyph(m)} ${subject(m)}`, tw) + RESET, n);
      push(rail + " " + pad(`${fg(authorColour(m.author))}${m.author ?? "?"}${fg(C.dark)} · ${ago(m.updatedAt)}  ${chips(m.props)}`, tw), n);
      // Links read as their titles here too (not as raw ((ids))); an embed reads as its title.
      const gist = visible(presentLinks(bodyLines(m).slice(0, 2).join(" ").replace(/!\(\(/g, "(("), false, desk ? { board: desk.ctx.board, redraw: () => desk.redraw() } : null, m.text));
      for (const l of wrap(gist, tw).slice(0, 2)) push(rail + " " + fg(C.grey) + pad(l, tw) + RESET, n);
      const k = this.fold.kids.get(m.id), count = idx?.count(m.id) ?? (Array.isArray(k) ? k.length : undefined);
      if (k === "loading") push(rail + " " + fg(C.dark) + "» loading replies…" + RESET, n, true);
      else if (count) push(rail + " " + fg(C.cyan) + (this.fold.open.has(m.id) ? `▾ ${repliesWord(count)} · hide` : `» ${repliesWord(count)}`) + RESET, n, true);
      push(rail, n);
    });
    // Its links under its replies, a group that folds as replies do: the links tile's rows, in the column's selection.
    if (this.source.kind === "block" && root && isOutlineNote(root)) {
      const label = `── ${this.linksShown ? "▾" : "▸"} links `;
      all.push({ text: fg(C.blue) + label + "─".repeat(Math.max(0, w - label.length)) + RESET, card: -1, replies: false, linksHead: true });
      this.linkList().forEach((r, j) => {
        const n = flat.length + j, on = n === this.sel;
        push((on ? fg(active ? C.lcyan : C.grey) + "▌" + RESET : " ") + linkRowLine(r, { cols: w - 1, selected: on && active, focused: active }), n);
      });
    }
    if (!this.items && !this.error) push(fg(C.dark) + "dialing…" + RESET);
    else if (filterQuery(this.filter) && !this.matched && !this.error) push(fg(C.dark) + "filtering…" + RESET);
    // The selected card comes into view only when the selection moved to it (keys, a click); a repaint or the wheel
    // leaves the scroll alone, so a note longer than the column can be read to its end (PIE-465).
    const first = all.findIndex(l => l.card === this.sel), last = all.findLastIndex(l => l.card === this.sel);
    const moved = this.shownSel !== undefined && this.shownSel !== this.sel;
    this.shownSel = this.sel;
    this.height = rows;
    if (first >= 0 && moved) {
      if (first < this.top) this.top = Math.max(0, first - (this.source.kind === "block" && this.sel === 0 ? first : 0));
      if (last >= this.top + rows) this.top = last - rows + 1;
    }
    // Past the end as every reader scrolls (PIE-622, reader.overscroll): the last row up to the middle.
    this.maxTop = lastTop(all.length, rows);
    this.top = scrolled(this.top, 0, this.maxTop);
    this.drawn = { lines: all.map(l => l.text), w };
    if (this.text && this.text.w !== w) this.text = null;
    const shown = all.slice(this.top, this.top + rows);
    this.rows = shown.map(l => ({ card: l.card, replies: l.replies, links: l.links, history: l.history, fold: l.fold, ...(l.linksHead ? { linksHead: true } : {}) }));
    return shown.map((l, i) => { const span = this.text?.span(this.top + i); return span ? paintRange(l.text, span[0], span[1], SELECT_BG) : l.text; });
  }

  /** The surface's host: this desk's, and a redraw it asks for means its digest may draw differently now. */
  override host(desk: DeskApi) {
    const h = super.host(desk), redraw = h.redraw;
    h.redraw = () => { this.gen++; redraw(); };
    // `b` (the note action links): this column's own links, under its replies, rather than a links tile beside it.
    h.links = async actor => {
      if (actor.kind === "agent") throw new ActionRefused("showing or hiding a column's links changes what the person reads · peek reads them (noteLinks)");
      return this.toggleLinks(undefined, desk);
    };
    // Back and forward are the flow's (its trail): the surface's own history keys and actions go there.
    h.history = {
      peek: dir => desk.travelPeek?.(this, dir) ?? null,
      go: dir => { void desk.perform?.("tile.travel", { dir: dir < 0 ? "back" : "forward" }, USER, this); return null; },
      agentRefusal: "back and forward in the river move the person's keys between columns; an agent opens beside (open, link.follow) instead",
    };
    return h;
  }

  /**
   * The note's digest through the shared surface. A peek reuses its last one while nothing it depends on changed (it
   * draws its whole note under its neighbour, and a long one every frame would make every key cost that much).
   */
  private digest(m: Msg, w: number, maxImageRows: number) {
    const t = this.desk?.ctx.t;
    const key = `${this.gen}|${w}|${maxImageRows}|${this.desk?.ctx.graphics ? 1 : 0}|${t?.kitty ? 1 : 0}|${t?.cellW}x${t?.cellH}|${m.revision ?? ""}|${this.surface.cursorKey}`, d = this.digestOf_;
    if (d && d.key === key && d.m === m && d.s === this.surface.msg && this.desk?.coverOf?.(this) === "peek") return d.dg;
    const dg = this.surface.digest(m, w, this.host(this.desk!), maxImageRows);
    this.digestOf_ = { key, m, s: this.surface.msg, dg };
    return dg;
  }

  /** Under the note: that it's in the Trash, a save that changed properties, what an agent did. */
  private banner(m: Msg, w: number): string[] {
    const s = this.surface;
    if (s.msg?.id !== m.id) return [];
    const key = `${s.notice}|${s.agent?.at ?? ""}`;
    if (key !== "|" && this.shown?.key !== key) this.shown = { key, at: Date.now() };
    if (this.shown && key !== "|" && Date.now() - this.shown.at >= BANNER_MS && !this.desk?.hasFocus?.(this)) { s.notice = ""; s.agent = null; this.shown = undefined; return []; }
    return [
      ...(m.deleted ? [fg(C.lred) + pad(IN_TRASH, w) + RESET] : []),
      ...(s.notice ? [fg(C.yellow) + pad(s.notice, w) + RESET] : []),
      ...(s.agent ? [fg(C.lmagenta) + pad(`an agent (${s.agent.id}) ${s.agent.did}`, w) + RESET] : []),
    ];
  }

  /** The person acted here: its property notice and agent line have been read. */
  private seen() { const s = this.surface; if (s.notice || s.agent) { s.notice = ""; s.agent = null; this.shown = undefined; } }

  // ── keys ──

  private run(desk: DeskApi, name: string, args: Record<string, unknown> = {}) { runOwn(COLUMN_ACTIONS, name, args, { pane: this, desk }); }

  override key(k: Key, desk: DeskApi): boolean {
    this.desk = desk;
    this.seen();
    if (this.mode) return this.modal(k, desk);
    // The property panel, a step's status choice, an edit or a comment the person is in: every key is the surface's.
    if (this.holdsKeys) return super.key(k, desk);
    if (this.selectKey(k, desk)) return true;
    // The mouse's back and forward buttons: back and forward in the flow, as alt+← and alt+→.
    if (k.kind === "back" || k.kind === "forward") { void desk.perform?.("tile.travel", { dir: k.kind }, USER, this); return true; }
    const c = ch(k);
    const held = this.surface.editing;
    const current = !held && this.surface.msg?.id === this.noteOf()?.id ? this.surface.currentKind() : null;
    // A live figure's element is current: tab, shift+tab, ← → and = are its (its tabs, its density), not the flow's.
    // So is an image's + - ← → H (its size, place and the header).
    if (current && (this.surface.claims(k) || this.surface.imageKeyOf(k))) return super.key(k, desk);
    if (!held) {
      // A link or an element `[ ]` is on: ⏎ (and space on a step) are the surface's, as in any reader.
      if ((this.linked() || current) && (k.kind === "enter" || k.kind === "alt-enter")) return super.key(k, desk);
      if (current === "task" && c === " ") return super.key(k, desk);
      if (isDown(k) || isUp(k)) { this.run(desk, "column.select", { by: isDown(k) ? 1 : -1 }); return true; }
      if (k.kind === "pgdn" || k.kind === "pgup") { this.run(desk, "column.scroll", { by: (k.kind === "pgdn" ? 1 : -1) * Math.max(1, this.height - 2) }); return true; }
      if (k.kind === "home" || k.kind === "end") { this.run(desk, "column.select", { by: k.kind === "home" ? -1e9 : 1e9 }); return true; }
      // ⏎ opens the selected note in the next column (the flow's), alt+⏎ in a new one even when a column has it.
      if (k.kind === "enter" || k.kind === "alt-enter") {
        const fl = this.flat().length;
        if (this.sel >= fl && this.linkList()[this.sel - fl]) { this.run(desk, "column.link", { n: this.sel - fl + 1, ...(k.kind === "alt-enter" ? { fresh: true } : {}) }); return true; }
        const m = this.flat()[this.sel]?.m;
        if (m) void desk.perform?.("open", { id: m.id, from: desk.nameOfPane?.(this) ?? "", ...(k.kind === "alt-enter" ? { fresh: true } : {}) }, USER);
        return true;
      }
      if (c === " ") {
        const fl = this.flat().length, r = this.linkList()[this.sel - fl];
        if (this.sel >= fl && (r?.kind === "group" || r?.kind === "kind")) this.run(desk, "column.link", { n: this.sel - fl + 1 });
        else if (this.flat()[this.sel]) this.run(desk, "column.replies");
        return true;
      }
      if (c === "s") { this.run(desk, "column.split"); return true; }
      if (c === "/") { this.mode = "filter"; this.input = filterInput(filterText(this.filter)); desk.redraw(); return true; }
      if (c === "#") { this.tagChoices = followable(this.flat()[this.sel]?.m ?? (this.source.kind === "block" ? this.rootOf() ?? undefined : undefined)); this.mode = "tags"; desk.redraw(); return true; }
      if (k.kind === "esc" && (this.linked() || current)) { this.surface.clearLink(); desk.redraw(); return true; }
    }
    return super.key(k, desk);
  }

  /** The filter being typed, or a property being chosen: ⏎ (or a digit) ends it in an action, esc cancels. */
  private modal(k: Key, desk: DeskApi): boolean {
    // An open completion popup takes ⏎, tab, esc and the arrows first (the line's own keys); what it leaves goes on below.
    if (this.mode === "filter" && completionOf(this.input) && this.input.key(k)) { desk.redraw(); return true; }
    if (k.kind === "esc") { this.mode = ""; desk.redraw(); return true; }
    if (this.mode === "tags") {
      const t = this.tagChoices[k.kind === "char" && !k.ctrl ? Number(k.ch) - 1 : -1];
      this.mode = "";
      if (t) this.run(desk, "column.tag", { key: t[0], value: t[1] });
      desk.redraw();
      return true;
    }
    if (k.kind === "enter" || k.kind === "alt-enter") { this.mode = ""; this.run(desk, "column.filter", { query: this.input.text }); return true; }
    if (!this.input.key(k) && (k.kind === "tab" || k.kind === "backtab")) return false;
    desk.redraw();
    return true;
  }

  /** v, y, Y; and while there's a selection, esc and the keyboard mode's keys. True when the key was the selection's. */
  private selectKey(k: Key, desk: DeskApi): boolean {
    const c = isCopyKey(k) ? "y" : ch(k);
    const sel = this.text;
    if (!sel) {
      if (this.surface.editing) return false;
      if (c === "y" || c === "Y") { desk.ctx.flash("nothing is selected · drag across the text, or v and move"); return true; }
      if (c !== "v" || !this.drawn) return false;
      const at = { row: this.top, col: 0 };
      this.text = new Selection({ ...at }, { ...at }, true, this.drawn.w);
      desk.redraw();
      return true;
    }
    if (c === "y") { this.run(desk, "column.copy"); return true; }
    if (c === "Y") { desk.ctx.flash("a river column draws a digest of the note, so its source isn't mapped here · y copies what's drawn; a reader's Y copies the source"); return true; }
    if (!sel.keys) {
      if (c === "v") { sel.keys = true; desk.redraw(); return true; }
      if (k.kind === "esc") { this.text = null; desk.redraw(); return true; }
      return false;
    }
    const r = modeKey(k, sel, rowsOf(this.drawn?.lines ?? []), 10);
    if (r === null) return false;
    if (r === "done") this.text = null;
    desk.redraw();
    return true;
  }
  /** The hint while text is selected (the screen's hint row says the rest). */
  selectionHint(): string | null { return this.text ? selectionHint(this.text, [...this.text.text(rowsOf(this.drawn?.lines ?? []))].length).replace(" · Y source", "") : null; }

  // ── the mouse (every event inside the tile; x, y in it) ──

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    this.desk = desk;
    if (sideways(k)) return false;                                              // the flow's: its kind steps to the column beside
    if (this.surface.editing && this.surface.msg) {
      // In an edit: the surface's own press, drag and release, as on the desk (the cursor placed, a completion picked,
      // a drag selecting in the draft and copied when the button comes up, a double click's word).
      if (k.action === "down") { this.editDrag = true; this.surface.press(x, y, this.host(desk), !!((k.mods ?? 0) & 4)); }
      else if (k.action === "drag" && this.editDrag) this.surface.drag(x, y, this.host(desk));
      else if (k.action === "up" && this.editDrag) { this.editDrag = false; this.surface.release(x, y, this.host(desk)); }
      else if (k.action === "wheel-up" || k.action === "wheel-down") this.surface.wheel(k.action === "wheel-down" ? 1 : -1, this.host(desk));
      desk.redraw();
      return true;
    }
    const pos = (px: number, py: number): Pos => ({ row: this.top + Math.max(0, Math.min(this.height - 1, py - this.headRows)), col: Math.max(0, px) });
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.run(desk, "column.scroll", { by: wheelRows(k.action === "wheel-down" ? 1 : -1) }); return true; }
    if (k.action === "drag") {
      const d = this.down;
      if (!d || !this.gesture.drag(x, y) || !this.drawn) return true;
      // A drag off the pressed cell selects (PIE-419); from a link or a card it selects too, never opens.
      if (!d.dragging) { d.dragging = true; const a = pos(this.gesture.pressed!.x, this.gesture.pressed!.y); this.text = new Selection(a, { ...a }, false, this.drawn.w); }
      if (this.text) this.text.head = pos(x, y);
      desk.redraw();
      return true;
    }
    if (k.action === "up") {
      const d = this.down, r = this.gesture.release(x, y);
      this.down = null;
      if (d && r.click) this.click_(d, desk);
      // A drag, a double or a triple click copies what it selected (copy on select), as y does.
      else if (d && r.copy && this.text?.text(rowsOf(this.drawn?.lines ?? [])).trim()) this.run(desk, "column.copy");
      this.justFocused = false;
      desk.redraw();
      return true;
    }
    if (k.action !== "down") return true;
    this.seen();
    // A candidate of the filter's completion popup: chosen as ⏎ does.
    if (this.mode === "filter" && completerOf(this.input)?.click(y)) { desk.redraw(); return true; }
    const row = y >= this.headRows ? this.rows[y - this.headRows] : this.sticky[y - (this.headRows - this.sticky.length)];
    if (row?.linksHead) { this.run(desk, "column.links"); return true; }
    const back = row?.history?.find(h => x >= h.from && x < h.to);
    if (back) { void desk.perform?.("tile.travel", { dir: back.dir < 0 ? "back" : "forward" }, USER, this); return true; }
    const link = row?.links?.find(l => x >= l.from && x < l.to);
    // A card escalates as every list's row does (RowPresses): a click selects it, a double click or an alt-, ctrl- or
    // middle-click opens it in the next column (⏎); the click that gave the column the keys only selects.
    const g = row && row.card >= 0 && !link ? this.presses.press(row.card, { mods: k.mods ?? 0, button: k.button, focusing: press?.focusing ?? this.justFocused }) : "select";
    const same = g === "open" || g === "fresh";
    if (!(row && row.card >= 0 && !link)) this.presses.forget();                 // a press elsewhere: the next on a card starts afresh
    if (row && row.card >= 0 && !link) this.run(desk, "column.select", { n: row.card + 1, scroll: false });
    const fold = !link && row?.fold && x >= 1 && x <= row.fold.to ? row.fold.n : undefined;
    this.down = { row, link: link?.link, ...(fold !== undefined ? { fold } : {}), same, ...(g === "fresh" ? { fresh: true } : {}), dragging: false };
    if (row && row.card >= 0) this.gesture.forget();
    const n = this.gesture.press(x, y);
    const rows = this.drawn && rowsOf(this.drawn.lines);
    if (n > 1 && rows) { const at = pos(x, y); this.text = n === 2 ? wordAt(rows, at) : lineAt(rows, at.row); this.text.w = this.drawn!.w; }
    else if (this.text && n === 1) this.text = null;
    desk.redraw();
    return true;
  }

  /** A press and release on the same cell: a link opens in the next column, a heading folds, a card's replies show, a selected card opens. */
  private click_(d: NonNullable<RiverColumn["down"]>, desk: DeskApi) {
    if (d.fold !== undefined) { void this.surface.runKey("fold.toggle", { n: d.fold }, this.host(desk)); return; }
    if (d.link) {
      this.gesture.forget();
      try { void this.surface.open(d.link, this.host(desk)); } catch (e) { desk.ctx.flash(e instanceof Error ? e.message : String(e)); }
      return;
    }
    const row = d.row;
    if (!row || row.card < 0) return;
    const m = this.flat()[row.card]?.m;
    if (m && row.replies) return this.run(desk, "column.replies", { id: m.id });
    if (m && d.same) void desk.perform?.("open", { id: m.id, from: desk.nameOfPane?.(this) ?? "" }, USER);
    // A link row: the same escalation (a double click or a modifier click opens it in the next column).
    const fl = this.flat().length;
    if (!m && d.same && row.card >= fl) this.run(desk, "column.link", { n: row.card - fl + 1, ...(d.fresh ? { fresh: true } : {}) });
  }

  // ── the outline changed ──

  override onEvent(desk: DeskApi, e?: OutlineEvent) {
    this.desk = desk;
    this.gen++;
    super.onEvent(desk);
    if (!e) return;
    if (e.action === "reconnected") this.surface.retry(this.host(desk));
    if (e.action === "reset") { this.load(desk); indexOf(desk.ctx.board).refresh(desk.ctx.board, () => desk.redraw(), true); return; }
    const id = e.blockId;
    const shows = !!id && ((this.source.kind === "block" && this.source.id === id) || !!this.items?.some(m => m.id === id || m.parentId === id) || this.fold.shows(this.items ?? [], id));
    if (shows) { if (this.reload) clearTimeout(this.reload); this.reload = setTimeout(() => { this.reload = null; this.load(desk); }, 800); }
    indexOf(desk.ctx.board).refresh(desk.ctx.board, () => desk.redraw());
  }
  override dispose() { if (this.reload) clearTimeout(this.reload); super.dispose(); }

  // ── what the column's actions do ──

  /** `column.select`: a card by id, the nth row, or rows from the selected one, as j k and a click do. */
  pick(to: { id?: string; n?: number; by?: number; scroll?: boolean }, desk: DeskApi, actor: Actor = USER): { selected: string; n: number } {
    const rows = this.flat(), links = this.linkList(), total = rows.length + links.length, { id, n, by } = to;
    if (!total) throw new ActionRefused(`${this.titleOf()} lists nothing${this.filter.length ? " (it's filtered)" : ""}`);
    // Its cards, then its links' rows (j k walk on into them).
    const i = id !== undefined ? rows.findIndex(r => r.m.id === id || (id.length >= 8 && r.m.id.startsWith(id)))
      : n !== undefined ? (Number.isInteger(n) && n >= 1 && n <= total ? n - 1 : -2)
      : by !== undefined ? Math.max(0, Math.min(total - 1, this.sel + Math.trunc(by)))
      : -3;
    if (i === -3) throw new ActionRefused("column.select needs id=, n= or by=");
    if (i === -2) throw new ActionRefused(`${this.titleOf()} lists ${total}; n is 1-${total}`);
    if (i >= rows.length) {
      this.sel = i;
      if (to.scroll === false) this.shownSel = i;
      if (!this.surface.editing) this.surface.clearLink();
      const r = links[i - rows.length]!;
      // The person's pick shows the row's note where the river's selection goes (a preview following it), read only.
      if (actor.kind !== "agent" && desk.showFrom) void linkNote(r, desk.ctx.board, "show").then(({ note }) => { if (this.sel === i) desk.showFrom?.(this, note); }, () => {});
      desk.redraw();
      return { selected: r.key, n: i + 1 };
    }
    if (i < 0) throw new ActionRefused(`${this.titleOf()} doesn't list ${id}${this.filter.length ? " (it's filtered)" : ""}`);
    this.sel = i;
    if (to.scroll === false) this.shownSel = i;              // already in view (a click): nothing scrolls
    if (!this.surface.editing) this.surface.clearLink();
    this.showSelected(desk);
    // The person's pick is the column's selection: a preview following the river shows it (desk.showFrom).
    if (actor.kind !== "agent") desk.showFrom?.(this, rows[i]!.m);
    desk.redraw();
    return { selected: rows[i]!.m.id, n: i + 1 };
  }

  scroll(by: number, desk: DeskApi): { top: number } {
    this.top = scrolled(this.top, by, this.maxTop);
    this.surface.clearLink();
    desk.redraw();
    return { top: this.top };
  }

  /** `column.replies`: a listed note's replies in place, shown or hidden (default toggles). */
  replies(id: string | undefined, open: boolean | undefined, desk: DeskApi): { id: string; open: boolean } {
    const m = id ? this.flat().find(r => r.m.id === id || (id.length >= 8 && r.m.id.startsWith(id)))?.m : this.flat()[this.sel]?.m;
    if (!m) throw new ActionRefused(id ? `${this.titleOf()} doesn't list ${id}` : `nothing is selected in ${this.titleOf()}`);
    const shown = this.fold.open.has(m.id);
    if (open !== shown) void this.fold.show(m.id, !shown, id => desk.ctx.board.children(id), () => desk.redraw());
    return { id: m.id, open: this.fold.open.has(m.id) };
  }

  /** `column.filter`: what it lists, by the river's filter grammar (its property clauses the service's query); the selection goes back to the top. */
  async setFilter(query: string, desk: DeskApi): Promise<{ filter: string; listed: number }> {
    this.filter = parseFilter(query); this.sel = 0; this.top = 0; this.matched = null;
    if (this.error?.startsWith("filter:")) this.error = undefined;
    await this.match(desk);
    this.showSelected(desk);
    desk.redraw();
    return { filter: filterText(this.filter), listed: this.listed() };
  }

  /** `column.copy`: the text selected in the column. The person's goes to the clipboard; an agent's is given back. */
  copy(actor: Actor, desk: DeskApi): { chars: number; text: string } {
    const sel = this.text;
    if (!sel) throw new ActionRefused("nothing is selected · drag across the text, or v and move");
    const text = sel.text(rowsOf(this.drawn?.lines ?? []));
    if (!text.trim()) throw new ActionRefused("nothing to copy: only blanks are selected");
    if (actor.kind !== "agent") {
      if (desk.ctx.copy?.(text) === false) throw new ActionRefused(`not copied: ${[...text].length} chars is more than the clipboard takes`);
      desk.ctx.flash(`copied ${[...text].length} chars`);
    }
    return { chars: [...text].length, text };
  }

  describe() {
    const note = this.noteOf();
    return {
      ...super.describe(), title: this.titleOf(), source: this.source, filter: filterText(this.filter), listed: this.items ? this.listed() : null,
      selected: this.flat()[this.sel]?.m.id ?? null, note: note ? { id: note.id, title: subject(note) } : null,
      ...(this.source.kind === "block" ? { noteLinks: { shown: this.linksShown, rows: this.linkList().map((r, j) => describeLinkRow(r, this.flat().length + j + 1, this.flat().length + j === this.sel)) } } : {}),
      ...(this.mode ? { typing: this.mode } : {}),
    };
  }
}

// ── its actions: what its keys and clicks run, and what an agent runs ────────

const columnOf = (pane: unknown): RiverColumn => { if (!(pane instanceof RiverColumn)) throw new ActionRefused("that tile isn't a river column"); return pane; };

/** A column's own actions (the layout's, widen, hold, close, back and forward, are the desk's tile actions). */
export const COLUMN_ACTIONS = actionSet<KindHost>()("river", {
  "column.select": def({
    summary: "select a note a river column lists (in the Library and a #tag column, that's the note e and C act on): id=, the nth row (n=, from 1), or by= rows from the selected one (j k: 1 -1). An agent's is refused on the column the person has the keys in (its selection is their cursor, id= too); elsewhere it picks a note for its own note actions",
    keys: "j k ↑↓ Home End, a click on a card",
    touches: "tile", replay: "safe", way: "an agent doesn't move their cursor there · act on another column, or open the note in a column of its own (open id= from=<column>); peek reads the column", says: (r, a) => (a.id === undefined ? `selected row ${r.n} in ${r.tile}` : `selected ${String(r.selected).slice(0, 8)} in ${r.tile}`),
    args: {
      id: { type: "string", optional: true, about: "the note's block id (or its first 8+ characters)" },
      n: { type: "number", optional: true, about: "the nth row listed, from 1 (replies shown in place count)" },
      by: { type: "number", optional: true, about: "rows from the selected one: 1 next, -1 previous" },
      scroll: { type: "boolean", optional: true, about: "false leaves the column's scroll as it is (a click on a card in view)" },
    },
    run: ({ id, n, by, scroll }, { pane, desk, tile }, actor) => ({ tile, ...columnOf(pane).pick({ id, n, by, scroll }, desk, actor) }),
  }),
  "column.links": def({
    summary: "show or hide a river column's links under its replies: its note's Outlinks, Resources and Backlinks, the links tile's rows (on=true or false, default toggles). Their rows follow the cards in column.select's n",
    keys: "b, a click on the ── links header",
    touches: "tile", replay: "safe", way: "an agent doesn't change what they're reading · peek reads the column's links, or act on another column",
    args: { on: { type: "boolean", optional: true, about: "true shows, false hides; default toggles" } },
    run: ({ on }, { pane, desk, tile }) => ({ tile, ...columnOf(pane).toggleLinks(on, desk) }),
  }),
  "column.link": def({
    summary: "open link row n (from 1, counted from the first links row) of a river column in the next column, as ⏎ on it does (fresh=true: a new column, as alt+⏎); on a group's header it folds or opens the group. A Resource is registered if it must be and shown",
    keys: "⏎ alt+⏎ space on a links row, a double click or an alt-, ctrl- or middle-click on one",
    touches: "nothing", replay: "ask", says: () => "opened a link",
    args: { n: { type: "number", about: "the links row, from 1" }, fresh: { type: "boolean", optional: true, about: "a new column, as alt+⏎" } },
    run: async ({ n, fresh }, { pane, desk, tile }, actor) => ({ tile, ...(await columnOf(pane).openLink(n - 1, !!fresh, desk, actor)) }),
  }),
  "column.replies": def({
    summary: "show or hide a listed note's replies in place in a river column (the selected one, or id=; open= true or false, default toggles)", keys: "space, a click on » replies",
    touches: "tile", replay: "safe", way: "an agent doesn't change what they're reading · peek reads the column, or act on another column",
    args: { id: { type: "string", optional: true, about: "which listed note; default the selected one" }, open: { type: "boolean", optional: true, about: "true shows, false hides; default toggles" } },
    run: ({ id, open }, { pane, desk, tile }) => ({ tile, ...columnOf(pane).replies(id, open, desk) }),
  }),
  "column.complete": def({
    summary: "what a filter's word offers in a river column's `/`: text=<the filter as typed, ending in the word> (`ty`, `type:`, `-status:do`) answers the keys, or the values of the key before its colon, each with the insertion a choice writes, from the outline's property index (`properties.catalog`, most used first) and the component schemas. Nothing on screen moves and nothing is typed: an agent's filter is `column.filter query=`",
    keys: "typing in /: ↑↓ choose, ⏎ or tab insert, esc dismiss, a click on a candidate, ctrl+space asks again",
    touches: "nothing", replay: "safe",
    args: { text: { type: "string", about: "the filter text ending in the word to complete" } },
    async run({ text }, { desk, tile }) {
      const t = filterTargetAtCursor(text, text.length);
      if (!t) throw new ActionRefused(`nothing to complete: the text should end in a property key or a key: with its value begun (it ends ${JSON.stringify(text.slice(-20))})`);
      const r = await lookupCompletion(desk.ctx.board as unknown as CompletionBoard, { ...t, words: true }, null);
      return { tile, kind: t.kind, query: t.query, ...(t.key ? { key: t.key } : {}), items: r.items.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion, kind: it.kind, context: it.context })) };
    },
  }),
  "column.scroll": def({
    summary: "scroll a river column by= rows (a page is its height less two); what it lists, its selection and the keys stay", keys: "PgUp PgDn, the wheel",
    touches: "tile", replay: "safe", way: "an agent doesn't scroll what they're reading · peek reads the column whole, or act on another column", says: r => `scrolled ${r.tile}`,
    args: { by: { type: "number", about: "rows: positive down, negative up" } },
    run: ({ by }, { pane, desk, tile }) => ({ tile, ...columnOf(pane).scroll(by, desk) }),
  }),
  "column.filter": def({
    summary: "filter what a river column lists: type:hub -status:done author:codex word (query= empty clears it). The person's /, typing, ⏎",
    keys: "/ then typing, ⏎ or alt+⏎ (esc cancels)",
    touches: "tile", replay: "safe", way: "an agent doesn't change what it lists under them (a filter goes back to the top) · search finds notes; open or column.tag puts a column of your own beside, or act on another column", says: r => `filtered ${r.tile}${r.filter ? ` by ${r.filter}` : " (cleared)"}`,
    args: { query: { type: "string", about: "clauses: key:value, -key:value, author:x, or words" } },
    run: async ({ query }, { pane, desk, tile }) => ({ tile, ...(await columnOf(pane).setFilter(query, desk)) }),
  }),
  "column.tag": def({
    summary: "open a column of every note with the same property (key::value, the river's virtual branch) next to a river column; value defaults to the selected note's. The person's # then 1-9 gives them the column; an agent's leaves their keys",
    keys: "# then 1-9",
    touches: "shape", replay: "safe", says: r => `opened #${r.value} beside ${r.from}`,
    args: { key: { type: "string", about: "the property key" }, value: { type: "string", optional: true, about: "its value; default the selected note's" } },
    async run({ key, value }, { pane, desk, tile }, actor) {
      const c = columnOf(pane), m = c.flat()[c.sel]?.m ?? c.noteOf();
      const v = value ?? m?.props[key];
      if (!v) throw new ActionRefused(`the selected note in ${tile} has no ${key}::; pass value=`);
      if (!desk.within) throw new ActionRefused("a column of the same property opens on a screen with tiles");
      const r = await desk.within("tile.open", { kind: "river.column", source: `tag:${key}=${v}`, where: "next" }, actor, pane) as { tile: string };
      if (actor.kind !== "agent") await desk.within("tile.focus", {}, actor, desk.pane?.(r.tile));
      return { tile: r.tile, from: tile, key, value: v };
    },
  }),
  "column.split": def({
    summary: "stack the selected note of a river column as its own column tile under it, in the same column of the flow; the person's s moves to it, an agent's leaves the keys",
    keys: "s",
    touches: "shape", replay: "safe", says: r => `stacked ${r.tile} under ${r.from}`,
    args: {},
    async run(_, { pane, desk, tile }, actor) {
      const c = columnOf(pane), m = c.flat()[c.sel]?.m;
      if (!m) throw new ActionRefused(`nothing is selected in ${tile}`);
      if (!desk.within) throw new ActionRefused("a column splits on a screen with tiles");
      const r = await desk.within("tile.open", { kind: "river.column", source: `block:${m.id}`, where: "down" }, actor, pane) as { tile: string };
      if (actor.kind !== "agent") await desk.within("tile.focus", {}, actor, desk.pane?.(r.tile));
      return { tile: r.tile, from: tile, id: m.id };
    },
  }),
  "column.copy": def({
    summary: "copy the text selected in a river column (its drawn rows: drag, or v and move): the person's goes to their clipboard (a drag's when the button comes up); an agent's is given back, the clipboard left alone",
    keys: "y, cmd+c, the release of a drag (or a double or triple click)",
    touches: "nothing", replay: "safe",
    args: {},
    run: (_, { pane, desk }, actor) => columnOf(pane).copy(actor, desk),
  }),
});

/**
 * A column's keys for the flow it's in (the layout's tile actions), the column's own on any screen: h l and ← → the
 * column beside, w widen, p hold (keep full), x close, g search. Back and forward (alt+← backspace alt+→) are its surface's history,
 * which goes along the flow's trail (`host`).
 */
const FLOW_KEYS: Record<string, { action: string; args?: Record<string, unknown> }> = {
  h: { action: "tile.focus", args: { dir: "left" } }, left: { action: "tile.focus", args: { dir: "left" } },
  l: { action: "tile.focus", args: { dir: "right" } }, right: { action: "tile.focus", args: { dir: "right" } },
  w: { action: "tile.widen" }, p: { action: "tile.hold" }, x: { action: "tile.close" }, g: { action: "search" },
};

/** The river column as a tile kind: a reader of the river's own view, opening a column of its own kind next. */
export function riverColumnKind(): TileKind {
  return {
    kind: "river.column", word: "column", noun: "a river column",
    about: "a river column (Quay): the Library (source=roots), a note with its replies (source=block:<id>), or every note with a property (source=tag:<key>=<value>); filter=<clauses>",
    make: s => new RiverColumn(parseSource(s.source), parseFilter(s.filter ?? "")),
    save: p => (p as RiverColumn).spec(),
    start: (p, env) => (p as RiverColumn).load(env.desk),
    actions: COLUMN_ACTIONS,
    press: (_p, k) => FLOW_KEYS[keyName(k) ?? ""] ?? null,
    // A swipe sideways steps to the column beside, as h and l do.
    sideways: (_p, dir) => FLOW_KEYS[dir < 0 ? "left" : "right"] ?? null,
    accepts: { notes: true },
    take: (p, m, desk) => { const c = p as RiverColumn; if (c.holdsKeys || c.editing) return "holds an edit or a comment"; c.hold(m, desk); return null; },
    holdsWork: p => (p as RiverColumn).unsaved() || (p as RiverColumn).editing,
    shows: p => (p as RiverColumn).noteOf() ?? null,
    opensNext: (_p, m) => ({ t: "leaf", kind: "river.column", source: `block:${m.id}` } as TileSpec),
    lists: p => (p as RiverColumn).source.kind !== "block",
    describe: (p, full) => { const c = p as RiverColumn; return { source: sourceText(c.source), ...(c.filter.length ? { filter: filterText(c.filter) } : {}), ...(full ? { column: c.describe() } : {}) }; },
  };
}

const HINT = "|08 |15h l|08 columns · |15w|08 widen · |15j k|08 notes · |15⏎|08 open beside · |15alt⏎|08 duplicate · |15space|08 replies · |15/|08 filter this column · |15#|08 same property · |15s|08 split · |15p|08 hold full · |15x|08 close · |15alt+←|08 back · |15g|08 go to · |15q|08 menu";

/** The river as a screen spec: a flow of columns, the Library first; opens go into the next column. */
export function riverSpec(): ScreenSpec {
  return {
    name: "river", title: "river", digits: false, saves: "river.json", lands: "river",
    // The Library is what the river is made around: it doesn't close (closable off, held by its tab set of one, as the
    // board's preview's is), so a saved river always comes back with it.
    layout: { focus: "library", root: { t: "flow", key: "river", held: [0], kids: [{ t: "tabs", tabs: [{ t: "leaf", kind: "river.column", name: "library", source: "roots" } as TileSpec], active: 0, policy: { closable: false } }] } },
    hint: { "river.column": HINT },
  };
}
