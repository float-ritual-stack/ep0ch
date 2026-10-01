// River: Quay's model (niri placement, Andy-style compression, Twitter threads) in character cells.
// Columns sit in one horizontal strip. Opening a note inserts a column beside its source; columns
// compress full → peek → spine as they recede from the wide column. Replies expand in place.
//
// Focus and the layout are two things. Focus is which column has the keys: a click in a column, h l or
// tab move it and change nothing else on screen. The wide column (`anchor`) is what the layout is built
// around; only an explicit shift moves it: `w` (the `widen` action), a click on a column's header, or an
// open that wouldn't otherwise show the new column full. A peek column draws its whole note at reading
// width, covered by its right-hand neighbour like a drawer and dimmed; only the far ones become spines.
//
// Every pane hosts the shared note surface (src/surface/note.ts) for its note: the note a block column
// was opened on, or the selected one in the Library and a #tag column. Reading keeps the river's own
// cards; editing, quoting and comment threads draw the surface in the column, with the same keys and
// the same named actions as the board. Peek and spine columns stay read-only views.
import { scrolled, wheelRows } from "../scroll";
import type { Ctx, Frame, Screen } from "../app";
import { bodyLinesOf, subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { Draft } from "../edit";
import type { CommentSession } from "../comment";
import { shellKeyOf } from "../shell-keys";
import { USER, type Actor, type IndexBlock, type OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, runAsPerson, agentLabel, type ActRequest } from "../surface/actions";
import { historyKey, historyRow, IN_TRASH, leaveSaid, NOTE_ACTIONS, NoteSurface, sessionStart, type Link, type ReaderHistory, type SurfaceHost } from "../surface/note";
import { Gesture, lineAt, modeKey, paintRange, rowsOf, SELECT_BG, Selection, selectionHint, wordAt, type Pos } from "../surface/selection";
import { presentLinks, stripMarks } from "../refs";
import { readState, writeState } from "../state";
import { bg, C, extractLinks, fg, INPUT_CURSOR, pad, paint, RESET, visible } from "../style";
import type { Key } from "../term";
import { ago, colourBody, wrap } from "../text";
import { drawSpine, SPINE } from "../spine";
import { withoutPropertyTokens } from "../vendor/property-grammar";

type Source = { kind: "roots" } | { kind: "block"; id: string } | { kind: "tag"; key: string; value: string };
interface Clause { key: string; value: string; exclude: boolean }
interface PaneS {
  /** Stable for the pane's life, whatever opens or closes around it: its reader name is `r<id>`. */
  id: number;
  source: Source;
  root: Msg | null;
  items: Msg[] | null;
  open: Set<string>;
  kids: Map<string, Msg[] | "loading">;
  sel: number;
  top: number;
  /** The selection the column last brought into view: it jumps to a reply only when this changes (PIE-465). */
  shownSel?: number;
  /** The note's element (`[ ]`) the column last brought into view, likewise. */
  shownElem?: string | null;
  /** The column's height when last drawn, for paging. */
  height?: number;
  /** The last top that still fills the column, when last drawn (the wheel stops there). */
  maxTop?: number;
  filter: Clause[];
  error?: string;
  /** The note surface for this pane's note: editing, quoting, comment threads, links. */
  surface: NoteSurface;
  /** The agents that acted in the surface's current edit or comment (`of`); stale once that ends. */
  agents: { of: Draft | CommentSession | null; ids: Set<string> };
  /** A covered column's last digest of its note, reused while nothing it depends on has changed (`River.gen`). */
  digest?: { key: string; m: Msg; s: Msg | null; dg: ReturnType<NoteSurface["digest"]> };
  /** When the property notice or agent line now showing was first drawn. */
  shown?: { key: string; at: number };
  /** Every row the pane drew last (not just those in view), for selecting text (PIE-419). */
  drawn?: { lines: string[]; w: number };
}
/** `from`: the column this one was opened from (back goes there); `ahead`: the one back last came from (forward). */
interface Col { uid: number; panes: PaneS[]; pane: number; pinned: boolean; from?: number; ahead?: number }
type Cover = "full" | "peek" | "spine";
interface Row { m: Msg; depth: number }
/** "1 reply", "3 replies". */
const repliesWord = (n: number) => `${n} repl${n === 1 ? "y" : "ies"}`;
/** A row of a pane as drawn: its card, whether it's the replies toggle, and the links on it (PIE-415). */
type HitRow = { card: number; replies: boolean; links?: { from: number; to: number; link: Link }[]; history?: { from: number; to: number; dir: -1 | 1 }[] };
interface Hit { rect: Rect; col: number; pane: number; rows: HitRow[]; cover: Cover }

const PEEK = 24;
/** A property notice or an agent line in a pane the person isn't in clears on their first action after this long on screen. */
export const BANNER_MS = 30_000;
/** Note actions that start or continue an edit or a comment: positional addressing is checked for these. */
const SESSION_ACTIONS = new Set(["edit", "edit.text", "edit.save", "edit.reload", "edit.close", "passage.select", "comment.write", "comment.send", "comment", "comment.close", "threads", "reply", "resolve"]);
const SEL = bg(C.blue) + fg(C.white);
const CHIP_COLOURS = [C.lgreen, C.lcyan, C.yellow, C.lmagenta, C.lred, C.lblue];
const GLYPH: Record<string, string> = { hub: "◎", workboard: "▦", workspace: "▣", notes: "▤", "virtual-branch": "⑂", "roadmap-item": "◆", proof: "✓", synthesis: "✦", inbox: "✉", note: "·" };

// ── the index: counts, titles, instant search ────────────────────────────────

class OutlineIndex {
  byId = new Map<string, IndexBlock>();
  counts = new Map<string, number>();
  loaded = false;
  set(list: IndexBlock[]) {
    this.byId = new Map(list.map(b => [b.id, b]));
    this.counts = new Map();
    for (const b of list) if (b.parentId) this.counts.set(b.parentId, (this.counts.get(b.parentId) ?? 0) + 1);
    this.loaded = true;
  }
  count(id: string): number | undefined { return this.loaded ? this.counts.get(id) ?? 0 : undefined; }
  search(q: string, limit = 40): IndexBlock[] {
    const s = q.toLowerCase().trim();
    if (!s) return [...this.byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    const scored: [number, IndexBlock][] = [];
    for (const b of this.byId.values()) {
      const t = b.title.toLowerCase(), w = (b.props["work-id"] ?? "").toLowerCase();
      const score = w === s ? 0 : t.startsWith(s) || w.startsWith(s) ? 1 : t.includes(s) || w.includes(s) ? 2 : -1;
      if (score >= 0) scored.push([score, b]);
    }
    return scored.sort((a, b) => a[0] - b[0] || b[1].updatedAt - a[1].updatedAt).slice(0, limit).map(x => x[1]);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

function parseFilter(s: string): Clause[] {
  return s.split(/\s+/).filter(Boolean).map(tok => {
    const exclude = tok.startsWith("-");
    const body = exclude ? tok.slice(1) : tok;
    const at = body.indexOf(":");
    return at > 0 ? { key: body.slice(0, at), value: body.slice(at + 1), exclude } : { key: "text", value: body, exclude };
  });
}
const filterText = (f: Clause[]) => f.map(c => `${c.exclude ? "-" : ""}${c.key === "text" ? "" : c.key + ":"}${c.value}`).join(" ");
function passes(m: Msg, f: Clause[]): boolean {
  return f.every(c => {
    const v = c.key === "author" ? m.author ?? "" : c.key === "text" ? m.text : m.props[c.key];
    const hit = c.key === "text" ? m.text.toLowerCase().includes(c.value.toLowerCase())
      : c.value === "*" ? v !== undefined : (v ?? "").toLowerCase() === c.value.toLowerCase();
    return c.exclude ? !hit : hit;
  });
}

// ── the river ────────────────────────────────────────────────────────────────

interface SavedRiver { cols: { panes: { source: Source; filter: Clause[] }[]; pinned: boolean; from?: number }[]; focus: number; anchor?: number; keep?: number }
/** How much a peek column's visible part is dimmed, so the wide and focused columns read first. */
const COVER_DIM = 0.55;

export class River implements Screen {
  title = "river";
  ctx!: Ctx;
  private cols: Col[] = [];
  private focus = 0;
  /**
   * The column the layout is built around (its uid): it gets the wide place, and the others compress by
   * their distance from it. Focus never moves it; `w`, a header click, `widen` and an open that needs it do.
   */
  private anchorUid: number | null = null;
  /** The column the person was reading when the anchor last moved: it stays full after the anchor if it can. */
  private keepUid: number | null = null;
  /** The column the person had the keys in before the one they're in now: what a widen keeps full beside it. */
  private readUid: number | null = null;
  private uid = 1;
  private idx = new OutlineIndex();
  private indexing: number | null = null;
  private lastIndex = 0;
  private lastTick = 0;
  /**
   * Bumped by everything that can change what a note's digest draws without the note itself changing: a
   * surface's redraw (a title or an embed read, a fold, a step, a comment) and every outline event. A
   * covered (peek) column reuses its digest while this, its width, its note and its cursor stay the same,
   * so a long note under its neighbour costs nothing per frame (a key over ssh repaints every column).
   */
  private gen = 0;
  private mode: "" | "filter" | "palette" | "tags" | "help" = "";
  private input = "";
  private matches: IndexBlock[] = [];
  private msel = 0;
  private tagChoices: [string, string][] = [];
  private hits: Hit[] = [];
  private colRects: { col: number; rect: Rect; cover: Cover }[] = [];
  private reloads = new Map<PaneS, Timer>();
  private pid = 1;
  /**
   * The pane whose edit or comment the person is in, and which one: only then do keys go to the surface.
   * A session they started by key is entered; one an agent started, or one they come back to by moving
   * focus, is entered with e or ⏎. Until then h l, tab and the rest keep navigating.
   */
  private entered: { p: PaneS; of: Draft | CommentSession } | null = null;
  /**
   * Text the person selected in a pane (PIE-419), in the pane's drawn rows: the same selection model as
   * a reader's (src/surface/selection.ts). Only y copies it; selecting never does.
   */
  private sel: { p: PaneS; s: Selection } | null = null;
  private gesture = new Gesture();
  /** Where the mouse went down: the row and link it was on then (a release there is a click on them). */
  private down: { p: PaneS; rect: Rect; row?: HitRow; link?: Link; same: boolean; dragging: boolean } | null = null;
  /** A press placed the cursor in the draft being written: a drag selects there. */
  private editDrag: { p: PaneS; rect: Rect } | null = null;

  enter(ctx: Ctx) {
    this.ctx = ctx;
    const cached = readState<{ blocks: IndexBlock[] }>("river-index.json");
    if (cached?.blocks?.length) this.idx.set(cached.blocks);
    this.refreshIndex();
    const saved = readState<SavedRiver>("river.json");
    if (saved?.cols?.length) {
      for (const c of saved.cols) this.cols.push({ uid: this.uid++, pinned: c.pinned, pane: 0, panes: c.panes.map(p => this.pane(p.source, p.filter)) });
      saved.cols.forEach((c, i) => { if (c.from !== undefined && this.cols[c.from]) this.cols[i]!.from = this.cols[c.from]!.uid; });
      this.focus = Math.min(saved.focus, this.cols.length - 1);
      this.anchorUid = this.cols[Math.min(saved.anchor ?? saved.focus, this.cols.length - 1)]?.uid ?? null;
      this.keepUid = saved.keep !== undefined ? this.cols[saved.keep]?.uid ?? null : null;
    } else {
      this.cols.push({ uid: this.uid++, pinned: true, pane: 0, panes: [this.pane({ kind: "roots" })] });
    }
    for (const c of this.cols) for (const p of c.panes) this.load(p);
  }

  private pane(source: Source, filter: Clause[] = []): PaneS {
    return { id: this.pid++, source, root: null, items: null, open: new Set(), kids: new Map(), sel: 0, top: 0, filter, surface: new NoteSurface(), agents: { of: null, ids: new Set() } };
  }

  private save() {
    writeState("river.json", {
      cols: this.cols.map(c => {
        const from = this.cols.findIndex(x => x.uid === c.from);
        return { pinned: c.pinned, panes: c.panes.map(p => ({ source: p.source, filter: p.filter })), ...(from >= 0 ? { from } : {}) };
      }),
      focus: this.focus,
      anchor: this.anchor,
      ...(this.keepAt >= 0 ? { keep: this.keepAt } : {}),
    } satisfies SavedRiver);
  }

  private refreshIndex() {
    if (this.indexing !== null) return;
    this.indexing = Date.now();
    this.ctx.board.index().then(list => {
      this.idx.set(list); this.lastIndex = Date.now(); this.indexing = null;
      writeState("river-index.json", { blocks: list });
      this.ctx.redraw();
    }, () => { this.indexing = null; });
  }

  private load(p: PaneS) {
    const b = this.ctx.board;
    const done = (items: Msg[]) => { p.items = items; p.error = undefined; p.sel = Math.min(p.sel, Math.max(0, items.length - 1)); this.ctx.redraw(); };
    const fail = (e: Error) => { p.error = e.message; this.ctx.redraw(); };
    if (p.source.kind === "roots") b.roots().then(done, fail);
    else if (p.source.kind === "tag") b.byProp(p.source.key, p.source.value).then(done, fail);
    else {
      const id = p.source.id;
      // The column's surface gets the new text too; an open draft is only marked "changed elsewhere".
      b.get(id).then(m => { p.root = m; if (m) p.surface.refresh(m); this.ctx.redraw(); }, () => {});
      b.children(id).then(done, fail);
    }
  }

  private titleOf(p: PaneS): string {
    if (p.source.kind === "roots") return "Library";
    if (p.source.kind === "tag") return `#${p.source.value}`;
    return p.root ? subject(p.root) : this.idx.byId.get(p.source.id)?.title ?? "…";
  }

  private flat(p: PaneS): Row[] {
    const out: Row[] = [];
    const walk = (list: Msg[], depth: number) => {
      for (const m of list) {
        if (depth === 0 && !passes(m, p.filter)) continue;
        out.push({ m, depth });
        const k = p.kids.get(m.id);
        if (p.open.has(m.id) && Array.isArray(k)) walk(k, depth + 1);
      }
    };
    walk(p.items ?? [], 0);
    return out;
  }

  /** How many notes the pane lists (its filter applied), not counting replies shown in place. */
  private listed(p: PaneS): number { return (p.items ?? []).filter(m => passes(m, p.filter)).length; }

  private get col() { return this.cols[this.focus]; }
  private panes(): PaneS[] { return this.cols.flatMap(c => c.panes); }
  /** A column holding an edit or a comment: it resists compression, and can't be closed. */
  private holds(c: Col) { return c.panes.some(p => p.surface.editing); }
  private get paneS() { const c = this.col; return c ? c.panes[c.pane] : undefined; }
  /** What the river has selected (the focused column's card, else its note): a preview tile beside a river tile follows it. */
  get current(): Msg | null { const p = this.paneS; return p?.items?.[p.sel] ?? p?.root ?? null; }
  private selected(): Msg | undefined { const p = this.paneS; return p ? this.flat(p)[p.sel]?.m : undefined; }

  // ── layout: progressive compression ───────────────────────────────────────

  /** The wide column's index: the anchor, or the focused column when the anchor has closed. */
  private get anchor(): number {
    const i = this.anchorUid === null ? -1 : this.cols.findIndex(c => c.uid === this.anchorUid);
    if (i >= 0) return i;
    // None yet (a new river) or it closed: settle on one, so later focus moves don't carry the layout along.
    const at = Math.min(this.focus, Math.max(0, this.cols.length - 1));
    this.anchorUid = this.cols[at]?.uid ?? null;
    return at;
  }
  private get keepAt(): number { return this.keepUid === null ? -1 : this.cols.findIndex(c => c.uid === this.keepUid); }

  /**
   * Where each column goes, built around the wide column (never around focus, so moving focus moves
   * nothing). `natural` is the width a column is drawn at: a peek is drawn at reading width and shows
   * only its first `width` cells, the rest under its right-hand neighbour.
   */
  private layout(W: number, anchor = this.anchor, keep = this.keepAt): { col: number; cover: Cover; width: number; natural: number }[] {
    const FULL = Math.max(40, Math.min(76, Math.round(W * 0.42)));
    // Too many columns even as spines: keep the ones nearest the wide one.
    const visible = [...this.cols.keys()].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || b - a)
      .slice(0, Math.max(1, Math.floor(W / SPINE))).sort((a, b) => a - b);
    const cover = new Map<number, Cover>(visible.map(i => [i, "spine"]));
    let spare = W - visible.length * SPINE;
    // The wide column first, then the one the person was just reading, then docked ones, then by distance.
    // (Docking a column lets go of the one kept, so a dock always widens what it can.)
    const rank = (i: number) => i === anchor ? -1 : i === keep ? 0.25 : this.cols[i]!.pinned || this.holds(this.cols[i]!) ? 0.5 : Math.abs(i - anchor);
    const order = [...visible].sort((a, b) => rank(a) - rank(b) || b - a);
    for (const i of order) {
      if (spare >= FULL - SPINE) { cover.set(i, "full"); spare -= FULL - SPINE; }
      else if (spare >= PEEK - SPINE) { cover.set(i, "peek"); spare -= PEEK - SPINE; }
    }
    const width = new Map<number, number>(visible.map(i => [i, cover.get(i) === "full" ? FULL : cover.get(i) === "peek" ? PEEK : SPINE]));
    // Leftover room shows more of the peeks' text first (each up to its reading width), then goes to the
    // wide column, so the strip fills the screen.
    const peeks = visible.filter(i => cover.get(i) === "peek");
    for (let left = peeks.length; left > 0 && spare > 0; left--) {
      const i = peeks[peeks.length - left]!, add = Math.min(FULL - PEEK, Math.floor(spare / left));
      width.set(i, width.get(i)! + add); spare -= add;
    }
    width.set(anchor, (width.get(anchor) ?? FULL) + Math.max(0, spare));
    return visible.map(i => ({ col: i, cover: cover.get(i)!, width: width.get(i)!, natural: cover.get(i) === "peek" ? FULL : width.get(i)! }));
  }

  /**
   * The explicit shift: column `ci` takes the wide place. The column that had it stays full after it where
   * there's room, so the text the person was reading doesn't collapse. Focus is untouched.
   */
  private widen(ci: number) {
    const col = this.cols[ci];
    // Already the wide one: nothing moves (w or its header again is never a second shift).
    if (!col || ci === this.anchor) return;
    // Keep full the column the person was reading: the one they were in before this one, else the old wide one.
    const read = this.cols.find(c => c.uid === this.readUid && c !== col) ?? this.cols[this.anchor];
    if (read && read !== col) this.keepUid = read.uid;
    this.anchorUid = col.uid;
    if (this.keepUid === col.uid) this.keepUid = null;
  }

  /** The person's w or header click: the `widen` action, as an agent would call it. */
  private shift(ci: number) { void runAsPerson(RIVER_ACTIONS, "widen", {}, { r: this, reader: String(ci + 1) }, msg => this.ctx.flash(msg)); }

  /** Focus moved by key to a column the strip doesn't show at all: the wide place steps toward it until it's on screen. */
  private reveal(ci: number) {
    const W = this.ctx.t.cols;
    let a = this.anchor;
    while (a !== ci && !this.layout(W, a).some(l => l.col === ci)) a += ci > a ? 1 : -1;
    if (a !== this.anchor) this.anchorUid = this.cols[a]!.uid;
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols: W, rows } = ctx.t;
    const H = rows - 2;
    const canvas = new Canvas(W, rows - 1);
    const placements: Placement[] = [];
    this.hits = []; this.colRects = [];
    let x = 0;
    const anchor = this.anchor;
    for (const { col: ci, cover, width, natural } of this.layout(W)) {
      const col = this.cols[ci]!;
      // `rect` is what shows; `box` is where the column is drawn. A peek's box runs on under its right-hand
      // neighbour, which is drawn next and slides over it like a drawer.
      const rect: Rect = { col: x, row: 0, cols: width, rows: H };
      const box: Rect = { ...rect, cols: natural };
      this.colRects.push({ col: ci, rect, cover });
      x += width;
      const focused = ci === this.focus;
      canvas.clear({ ...box, cols: Math.min(box.cols, W - box.col) });
      if (cover === "spine") { this.spine(canvas, placements, col, rect, focused, ctx); continue; }
      const p0 = col.panes[0]!;
      const count = p0.items ? ` ${fg(C.dark)}${this.listed(p0)}` : "";
      const state = col.panes.map(p => p.surface.state()).find(Boolean);
      canvas.box(box, fg(focused ? C.lcyan : col.pinned ? C.cyan : C.blue),
        `${col.pinned ? fg(C.yellow) + "⊙ " : ""}${fg(focused ? C.white : C.grey)}${this.titleOf(p0)}${count}${state ? ` ${fg(C.yellow)}· ${state}` : ""}`,
        focused && !this.paneS?.surface.editing ? fg(C.dark) + (cover === "full" && ci === anchor ? "space replies · ⏎ open · s split · f filter · # tags" : cover === "full" ? "w widen · space replies · ⏎ open" : "w widen") : "");
      const inner: Rect = { col: box.col + 1, row: box.row + 1, cols: box.cols - 2, rows: box.rows - 2 };
      const n = col.panes.length;
      const each = Math.floor(inner.rows / n);
      col.panes.forEach((p, pi) => {
        const r: Rect = { col: inner.col, row: inner.row + pi * each, cols: inner.cols, rows: pi === n - 1 ? inner.rows - pi * each : each };
        let body = r;
        if (n > 1 || p.filter.length) {
          const active = focused && pi === col.pane;
          const head = `${fg(active ? C.lcyan : C.blue)}── ${fg(active ? C.white : C.grey)}${this.titleOf(p)} ${p.filter.length ? fg(C.yellow) + "≡ " + filterText(p.filter) + " " : ""}`;
          canvas.text(r.col, r.row, pad(head + fg(active ? C.lcyan : C.blue) + "─".repeat(r.cols), r.cols), r.cols);
          body = { ...r, row: r.row + 1, rows: r.rows - 1 };
        }
        // A peek draws the same view as a full column, at the same width, so nothing rewraps or jumps when it widens.
        const view = this.full(p, body, focused && pi === col.pane, cover === "peek");
        view.lines.forEach((l, i) => canvas.text(body.col, body.row + i, l, body.cols));
        // What a click can reach: the part of the pane in view (a peek's right side is under its neighbour).
        const seen: Rect = { ...body, cols: Math.max(0, Math.min(body.cols, rect.col + rect.cols - 1 - body.col)) };
        this.hits.push({ rect: seen, col: ci, pane: pi, rows: view.rows, cover });
      });
      if (cover === "peek") this.cover(canvas, rect, focused);
    }
    if (this.mode === "palette") this.drawPalette(canvas, W, rows);
    if (this.mode === "tags") this.drawTags(canvas, W, rows);
    if (this.mode === "help") this.drawHelp(canvas, W, rows);
    canvas.text(0, rows - 2, this.hints(W), W);
    return { lines: canvas.lines(), placements: this.mode === "" || this.mode === "filter" ? placements : [] };
  }

  private spine(canvas: Canvas, placements: Placement[], col: Col, r: Rect, focused: boolean, ctx: Ctx) {
    const colour = focused ? C.white : col.pinned ? C.yellow : C.lcyan;
    // A spine has no room for a draft: it says one is there, and the column resists compressing this far.
    const mark = this.holds(col) ? fg(C.yellow) + "✎" + RESET : fg(col.pinned ? C.yellow : C.dark) + (col.pinned ? "⊙" : "·") + RESET;
    const p = drawSpine(canvas, r, { key: `spine:${col.uid}`, title: this.titleOf(col.panes[0]!), colour, marks: [mark] }, ctx);
    if (p) placements.push(p);
  }

  /**
   * A peek column under its neighbour: its text dimmed, and a drawer's edge where the neighbour slides over
   * it (the board's drawer and float shadow, ▒). The column the person is in is dimmed less.
   */
  private cover(canvas: Canvas, r: Rect, focused: boolean) {
    const edge = r.col + r.cols - 1;
    canvas.dim({ ...r, cols: r.cols - 1 }, focused ? 0.8 : COVER_DIM);
    for (let y = r.row; y < r.row + r.rows; y++) canvas.text(edge, y, fg(C.dark) + "▒" + RESET, 1);
  }

  private full(p: PaneS, r: Rect, active: boolean, covered = false): { lines: string[]; rows: Hit["rows"] } {
    const w = r.cols;
    // Editing, quoting, the thread list: the shared surface, drawn in the column.
    if (p.surface.editing && p.surface.msg) return { lines: p.surface.render(w, r.rows, this.hostFor(p)).lines, rows: [] };
    const all: (HitRow & { text: string })[] = [];
    const push = (text: string, card = -1, replies = false) => all.push({ text, card, replies });
    if (p.error) push(fg(C.lred) + p.error + RESET);
    const root = this.rootOf(p);
    if (p.source.kind === "block" && root) {
      const m = root;
      push(fg(C.white) + pad(`${glyph(m)} ${subject(m)}`, w) + RESET);
      push(`${fg(authorColour(m.author))}${m.author ?? "?"}${fg(C.dark)} · ${ago(m.updatedAt)}  ${chips(m.props)}`);
      // Where back and forward go (the reader's history row, PIE-453), under the title where it's always in reach.
      const h = this.historyOf(p), hr = historyRow(w, h.peek(-1), h.peek(1));
      if (hr) all.push({ text: hr.line, card: -1, replies: false, history: hr.hits });
      for (const l of this.banner(p, m, w)) push(l);
      // The note's body through the shared surface's renderer (its digest): Markdown, links as Detail reads
      // them, transclusions nested and sliced as the service projects them, and step controls (PIE-424,
      // PIE-472). A click on a link opens it beside (PIE-415); `[ ]` walks its elements. The whole note: the
      // column scrolls, so nothing is cut short or sent elsewhere (PIE-465).
      const host = this.hostFor(p);
      if (p.surface.msg?.id !== m.id) p.surface.show(m, host);
      const dg = this.digestOf(p, m, w - 1, host, covered), at = all.length;
      // The links by row, once (a long note has thousands of each: filtering per row was quadratic).
      const byRow = new Map<number, { from: number; to: number; link: Link }[]>();
      for (const x of dg.links) { const at = byRow.get(x.row); const l = { from: x.from + 1, to: x.to + 1, link: x.link }; if (at) at.push(l); else byRow.set(x.row, [l]); }
      dg.lines.forEach((l, i) => all.push({ text: " " + l, card: -1, replies: false, links: byRow.get(i) ?? [] }));
      // The element `[ ]` just stepped to comes into view (only when it changed: the wheel still reads on).
      if (dg.key !== (p.shownElem ?? null)) {
        p.shownElem = dg.key;
        if (dg.current !== null) { const row = at + dg.current; if (row < p.top) p.top = Math.max(0, row - 1); else if (row >= p.top + r.rows) p.top = row - r.rows + 2; }
      }
      const label = `── ${p.items ? repliesWord(this.listed(p)) : "… replies"} `;
      push(fg(C.blue) + label + "─".repeat(Math.max(0, w - label.length)) + RESET);
    }
    const rows = this.flat(p);
    if (p.source.kind !== "block" && rows[p.sel]) for (const l of this.banner(p, rows[p.sel]!.m, w)) push(l);
    rows.forEach((row, n) => {
      const m = row.m, on = n === p.sel;
      const rail = fg(C.blue) + "│ ".repeat(row.depth) + RESET;
      const mark = on ? fg(active ? C.lcyan : C.grey) + "▌" + RESET : " ";
      const tw = Math.max(8, w - row.depth * 2 - 2);
      const title = `${glyph(m)} ${subject(m)}`;
      push(rail + mark + (on && active ? SEL : fg(C.white)) + pad(title, tw) + RESET, n);
      push(rail + " " + pad(`${fg(authorColour(m.author))}${m.author ?? "?"}${fg(C.dark)} · ${ago(m.updatedAt)}  ${chips(m.props)}`, tw), n);
      // Links read as their titles here too, as in the note above (not as raw ((ids))); an embed reads as its title.
      const gist = visible(presentLinks(bodyLines(m).slice(0, 2).join(" ").replace(/!\(\(/g, "(("), false, { board: this.ctx.board, redraw: () => this.ctx.redraw() }, m.text));
      for (const l of wrap(gist, tw).slice(0, 2)) push(rail + " " + fg(C.grey) + pad(l, tw) + RESET, n);
      const count = this.idx.count(m.id) ?? (Array.isArray(p.kids.get(m.id)) ? (p.kids.get(m.id) as Msg[]).length : undefined);
      if (p.kids.get(m.id) === "loading") push(rail + " " + fg(C.dark) + "» loading replies…" + RESET, n, true);
      else if (count) push(rail + " " + fg(C.cyan) + (p.open.has(m.id) ? `▾ ${repliesWord(count)} · hide` : `» ${repliesWord(count)}`) + RESET, n, true);
      push(rail, n);
    });
    if (!p.items && !p.error) push(fg(C.dark) + "dialing…" + RESET);
    // Bring the selected card into view only when the selection moved to it (keys, a click). A repaint or the
    // wheel leaves the scroll alone, so a note longer than the column can be read to its end (PIE-465).
    const first = all.findIndex(l => l.card === p.sel), last = all.findLastIndex(l => l.card === p.sel);
    const moved = p.shownSel !== undefined && p.shownSel !== p.sel;
    p.shownSel = p.sel;
    p.height = r.rows;
    if (first >= 0 && moved) {
      if (first < p.top) p.top = Math.max(0, first - (p.source.kind === "block" && p.sel === 0 ? first : 0));
      if (last >= p.top + r.rows) p.top = last - r.rows + 1;
    }
    p.maxTop = Math.max(0, all.length - r.rows);
    p.top = scrolled(p.top, 0, p.maxTop);
    this.keepRows(p, all.map(l => l.text), w);
    const view = all.slice(p.top, p.top + r.rows);
    return { lines: view.map((l, i) => this.paintSel(p, l.text, p.top + i)), rows: view.map(l => ({ card: l.card, replies: l.replies, links: l.links, history: l.history })) };
  }

  /**
   * The note's digest through the shared surface. A covered column reuses its last one while nothing it
   * depends on changed (see `gen`): a peek draws the whole note, and rendering a long one every frame would
   * make every key cost as much as the longest note under a neighbour.
   */
  private digestOf(p: PaneS, m: Msg, w: number, host: SurfaceHost, reuse: boolean): ReturnType<NoteSurface["digest"]> {
    const key = `${this.gen}|${w}|${m.revision ?? ""}|${p.surface.cursorKey}`, d = p.digest;
    if (reuse && d && d.key === key && d.m === m && d.s === p.surface.msg) return d.dg;
    const dg = p.surface.digest(m, w, host);
    p.digest = { key, m, s: p.surface.msg, dg };
    return dg;
  }

  /** Scroll a column by lines, within its content as last drawn (the next draw keeps it there too). */
  private scroll(p: PaneS, by: number) { p.top = scrolled(p.top, by, p.maxTop); }

  /** How a pane was last drawn: full, peek or spine (a pane not drawn yet counts as full). */
  private coverOf(p: PaneS): Cover {
    const h = this.hits.find(h => this.cols[h.col]?.panes[h.pane] === p);
    return h?.cover ?? "full";
  }

  /** A press and release on the same cell of a pane: what a click there always did. */
  private clickPane(d: NonNullable<River["down"]>) {
    const p = d.p;
    if (this.sel?.p === p) this.sel = null;                 // a click lets go of the selection
    if (d.link) {
      this.gesture.forget();
      // A link in the column's note: it opens beside, as [ ] then ⏎ on it would.
      try { void this.ready(p).open(d.link, this.hostFor(p)); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e)); }
      if (this.entered && this.entered.p !== this.paneS) this.entered = null;
      this.save();
      return;
    }
    const row = d.row;
    if (!row || row.card < 0) return;
    const m = this.flat(p)[row.card]?.m;
    if (m && row.replies) return this.run("replies", { id: m.id }, this.readerId(p));
    if (m && d.same) this.run("open", { id: m.id }, this.readerId(p));
  }

  // ── selecting text (PIE-419) ───────────────────────────────────────────────

  /** A pane's drawn rows; a selection made at another width no longer points at the same text. */
  private keepRows(p: PaneS, lines: string[], w: number) {
    p.drawn = { lines, w };
    if (this.sel?.p === p && this.sel.s.w !== w) this.sel = null;
  }

  private paintSel(p: PaneS, line: string, row: number): string {
    const span = this.sel?.p === p ? this.sel.s.span(row) : null;
    return span ? paintRange(line, span[0], span[1], SELECT_BG) : line;
  }

  /** The pane cell under the pointer, clamped to the pane (the river keeps its own scroll while selecting). */
  private posIn(d: { p: PaneS; rect: Rect }, x: number, y: number): Pos {
    const r = d.rect;
    return { row: d.p.top + Math.max(0, Math.min(r.rows - 1, y - r.row)), col: Math.max(0, Math.min(r.cols - 1, x - r.col)) };
  }

  /** v, y, Y, and while there's a selection esc and the keyboard mode's keys. True when the key was the selection's. */
  private selectKey(k: Key, p: PaneS | undefined): boolean {
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    const sel = this.sel;
    if (!sel) {
      if (c === "y" || c === "Y") { this.ctx.flash("nothing is selected · drag across the text, or v and move"); return true; }
      if (c !== "v" || !p?.drawn) return false;
      const at = { row: p.top, col: 0 };
      this.sel = { p, s: new Selection({ ...at }, { ...at }, true, p.drawn.w) };
      this.ctx.redraw();
      return true;
    }
    const rows = rowsOf(sel.p.drawn?.lines ?? []);
    if (c === "y") { this.run("copy", {}); return true; }
    if (c === "Y") { this.ctx.flash("a river column draws a digest of the note, so its source isn't mapped here · y copies what's drawn; a reader's Y copies the source"); return true; }
    if (!sel.s.keys) {
      if (c === "v") { sel.s.keys = true; this.ctx.redraw(); return true; }
      if (k.kind === "esc") { this.sel = null; this.ctx.redraw(); return true; }
      return false;
    }
    const r = modeKey(k, sel.s, rows, 10);
    if (r === null) return false;
    if (r === "done") this.sel = null;
    this.ctx.redraw();
    return true;
  }

  private hints(W: number): string {
    const sp = this.paneS;
    const s = this.sel;
    if (!this.mode && s) return pad(` ${fg(C.grey)}${selectionHint(s.s, [...s.s.text(rowsOf(s.p.drawn?.lines ?? []))].length).replace(" · Y source", "")}${RESET}`, W);
    if (!this.mode && sp && sp.surface.editing && !sp.surface.panel && !this.isEntered(sp)) return pad(paint(`|15 e ⏎|08 enter ${this.whose(sp)} (${sp.surface.state()}) · |07h l|08 columns · |07tab|08 panes · |15?|08 keys`), W);
    if (!this.mode && sp && (sp.surface.editing || this.linked(sp))) return pad(` ${fg(C.grey)}${sp.surface.hint()}${RESET}`, W);
    if (this.mode === "filter") return pad(paint(`|14filter this pane: |15${this.input}|07${INPUT_CURSOR} |08 type:hub -status:done author:codex word · ⏎ apply · esc cancel`), W);
    const meter = this.indexing !== null ? ` · |14indexing ${"▒▓█▓"[Math.floor(Date.now() / 150) % 4]} ${((Date.now() - this.indexing) / 1000).toFixed(0)}s` : this.idx.loaded ? ` · |08${this.idx.byId.size} indexed` : "";
    return pad(paint(`|08 h l columns · |15w|08 widen · j k notes · |15⏎|08 open beside · |15alt⏎|08 duplicate · |15space|08 replies · |15/|08 jump · |15?|08 keys · |15q|08 menu${meter}`), W);
  }

  private overlay(canvas: Canvas, W: number, rows: number, wFrac: number, hFrac: number, title: string): Rect {
    const r: Rect = { col: Math.floor(W * (1 - wFrac) / 2), row: Math.floor(rows * (1 - hFrac) / 3), cols: Math.floor(W * wFrac), rows: Math.floor(rows * hFrac) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + title);
    return { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
  }

  private drawPalette(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.6, 0.6, `jump · ${this.idx.loaded ? `${this.idx.byId.size} notes, local` : "index loading…"}`);
    canvas.text(r.col, r.row, paint(`|14/ |15${this.input}|07${INPUT_CURSOR}`), r.cols);
    this.matches.slice(0, r.rows - 2).forEach((b, i) => {
      const parent = b.parentId ? this.idx.byId.get(b.parentId)?.title ?? "" : "top level";
      const line = `${pad(`${b.props["work-id"] && !b.title.startsWith(b.props["work-id"]) ? b.props["work-id"] + " " : ""}${b.title}`, Math.floor(r.cols * 0.6))} ${fg(C.dark)}${parent}`;
      canvas.text(r.col, r.row + 2 + i, (i === this.msel ? SEL : fg(C.grey)) + pad(line, r.cols) + RESET, r.cols);
    });
  }

  private drawTags(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.4, 0.4, "open a virtual branch");
    this.tagChoices.forEach(([k, v], i) => canvas.text(r.col + 1, r.row + i, paint(`|15${i + 1} |08${k}:: |11#${v}`), r.cols - 1));
    if (!this.tagChoices.length) canvas.text(r.col + 1, r.row, paint("|08this note has no properties"), r.cols);
  }

  private drawHelp(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.6, 0.75, "river · keys");
    const help = [
      "h l / ← →      previous / next column (the keys move; the layout stays)",
      "w              widen: the focused column takes the wide place",
      "j k / ↑ ↓      previous / next note",
      "⏎              reveal if open, else insert beside the source",
      "alt ⏎          force a duplicate column",
      "space          expand replies in place",
      "s              split this note down as its own pane",
      "tab            next stacked pane in the column",
      "p              dock / undock the column (resists compression)",
      "x              close pane, or the column when it has one",
      "f              filter this pane (type:hub -status:done author:x word)",
      "#              open a virtual branch from this note's properties",
      "/              jump: instant search over the whole index",
      "e / ctrl+e     edit the column's note here / in $EDITOR",
      "C              comment: pick a passage, write, ctrl+s sends",
      "m              the note's comment threads (r reply · x resolve)",
      "[ ] u          select a link (⏎ follows it beside) · the parent",
      "               the column's note: the one it opened on; in the Library and a #tag, the selected one",
      "click          in a column: its keys, a note, replies · on its header or a spine: widen it",
      "q / esc        back to the menu (esc first lets go of a selected link)",
    ];
    help.forEach((l, i) => canvas.text(r.col + 1, r.row + i, fg(C.grey) + l + RESET, r.cols - 1));
  }

  // ── actions ───────────────────────────────────────────────────────────────

  /**
   * A note as a column right after column `from` (default the focused one), or the column it already has.
   * The person's ⏎ moves focus there; an agent's open (`focus` false) leaves the person's focus where it
   * is, on the same column even when the new one is inserted before it. Returns the column's index.
   */
  /**
   * The person's keys go to column `ci`. The column they leave is the one they were reading (`readUid`): a
   * widen keeps it full beside the wide one. `was`: that column's uid, read before columns were inserted.
   */
  private give(ci: number, was = this.cols[this.focus]?.uid) {
    if (ci !== this.focus || this.cols[ci]?.uid !== was) { if (was !== undefined && this.cols.some(c => c.uid === was) && this.cols[ci]?.uid !== was) this.readUid = was; }
    this.focus = ci;
  }

  private open(m: Msg, duplicate: boolean, from = this.focus, focus = true): number {
    const was = this.cols[this.focus]?.uid;
    if (!duplicate) {
      const at = this.cols.findIndex(c => c.panes[0]!.source.kind === "block" && (c.panes[0]!.source as { id: string }).id === m.id);
      if (at >= 0) {
        // The person's open finds the column: back from there returns to where they opened it from.
        if (focus) { if (at !== from && this.cols[from]) this.cols[at]!.from = this.cols[from]!.uid; this.give(at, was); this.place(at, from); }
        this.save(); this.ctx.redraw(); return at;
      }
    }
    const p = this.pane({ kind: "block", id: m.id });
    p.root = m;
    const at = Math.min(from + 1, this.cols.length);
    this.cols.splice(at, 0, { uid: this.uid++, panes: [p], pane: 0, pinned: false, from: this.cols[from]?.uid });
    if (focus) { this.give(at, was); this.place(at, at - 1); }
    else if (at <= this.focus) this.focus += 1;
    this.load(p);
    this.save();
    this.ctx.redraw();
    return at;
  }

  /** A #value column right after column `from`; `focus` (the person's) gives them it, else their focus stays on the same column. */
  private openTag(key: string, value: string, from = this.focus, focus = true): PaneS {
    const was = this.cols[this.focus]?.uid;
    const p = this.pane({ kind: "tag", key, value });
    const at = from + 1;
    this.cols.splice(at, 0, { uid: this.uid++, panes: [p], pane: 0, pinned: false, from: this.cols[from]?.uid });
    if (focus) { this.give(at, was); this.place(at, from); this.entered = null; }
    else if (at <= this.focus) this.focus += 1;
    this.load(p); this.save(); this.ctx.redraw();
    return p;
  }

  /**
   * The person opened column `ci` from column `from`: the layout moves only if it must. When the new column
   * already shows full, and `from` stays full, nothing shifts; otherwise the new column takes the wide place
   * and `from` (the text they were reading) stays full beside it.
   */
  private place(ci: number, from: number) {
    const now = this.layout(this.ctx.t.cols);
    const full = (i: number) => now.find(l => l.col === i)?.cover === "full";
    if (full(ci) && (from < 0 || full(from))) return;
    this.anchorUid = this.cols[ci]!.uid;
    this.keepUid = from >= 0 && from !== ci ? this.cols[from]?.uid ?? null : null;
  }

  private toggle(p: PaneS, m: Msg) {
    if (p.open.has(m.id)) { p.open.delete(m.id); return this.ctx.redraw(); }
    p.open.add(m.id);
    if (!p.kids.has(m.id)) {
      p.kids.set(m.id, "loading");
      this.ctx.board.children(m.id).then(k => { p.kids.set(m.id, k); this.ctx.redraw(); }, () => { p.kids.set(m.id, []); this.ctx.redraw(); });
    }
    this.ctx.redraw();
  }

  /** `s`: the selected note as its own stacked pane in the same column (the person's `s` moves to it; an agent's doesn't). */
  private split(col: Col, m: Msg, focus = true): PaneS {
    const np = this.pane({ kind: "block", id: m.id });
    np.root = m; col.panes.push(np); if (focus) col.pane = col.panes.length - 1; this.load(np); this.save();
    return np;
  }

  /** `x`: close the pane, or the column when it has one. A pane holding an edit or a comment isn't closed. */
  private close(ci: number, pi: number): string | null {
    const col = this.cols[ci];
    if (!col) return "there is no such column";
    const p = col.panes[pi]!;
    if (p.surface.editing) return `it's ${p.surface.state()}; save or close that first`;
    if (col.panes.length > 1) { col.panes.splice(pi, 1); if (pi <= col.pane) col.pane = Math.max(0, col.pane - 1); }
    else if (this.cols.length > 1) {
      // The wide place passes to the column that slides into the gap from the left (the one it opened from).
      const full = this.covers().get(ci) === "full";
      if (col.uid === this.anchorUid) this.anchorUid = this.cols[Math.max(0, ci - 1)] === col ? this.cols[ci + 1]!.uid : this.cols[Math.max(0, ci - 1)]!.uid;
      // A full column's place goes to the one that slides into the gap from the right, so nothing left of it moves
      // (unless the column the person was reading still holds a place of its own).
      const kept = this.keepUid !== null && this.keepUid !== col.uid && this.keepUid !== this.anchorUid;
      if ((full || col.uid === this.keepUid) && !kept) this.keepUid = [this.cols[ci + 1], this.cols[ci - 1]].find(c => c && c.uid !== this.anchorUid)?.uid ?? null;
      if (col.uid === this.keepUid) this.keepUid = null;
      this.cols.splice(ci, 1); if (this.focus >= ci) this.focus = Math.max(0, this.focus - 1);
    }
    else return "it's the last column";
    if (this.sel?.p === p) this.sel = null;                 // its selected text went with it
    this.save();
    return null;
  }

  // ── the note surface in each pane ────────────────────────────────────────

  /**
   * A block column's note: the newer of what the column read and what its surface has (after a save, or a
   * trash or restore, which moves no revision: the surface reads it again on any, NoteSurface.staleOn).
   */
  private rootOf(p: PaneS): Msg | null {
    const s = p.surface.msg, r = p.root;
    if (s && r && s.id === r.id && !s.partial && ((s.revision ?? 0) > (r.revision ?? 0) || (s.revision === r.revision && !!s.deleted !== !!r.deleted))) return s;
    return r;
  }

  /** The note `e`, `c` and `m` act on: the one a block column opened on; in the Library and a #tag column, the selected one. */
  private noteOf(p: PaneS): Msg | undefined {
    if (p.surface.editing) return p.surface.msg ?? undefined;
    return p.source.kind === "block" ? this.rootOf(p) ?? undefined : this.flat(p)[p.sel]?.m;
  }

  /**
   * The surface's host: this door, and a followed link (or `u`) opening beside this pane's column. The
   * person follows it there; an agent's follow opens the column and leaves the person's focus alone.
   */
  private hostFor(p: PaneS, actor?: Actor): SurfaceHost {
    return {
      ctx: this.ctx,
      redraw: () => { this.gen++; this.ctx.redraw(); },
      // alt+⏎ (PIE-441) opens it in a new column even when one shows it already.
      navigate: (m, how) => {
        const at = this.cols.findIndex(c => c.panes.includes(p));
        if (actor?.kind === "agent" || how?.agent) { this.open(m, !!how?.fresh, at >= 0 ? at : this.focus, false); return; }
        if (at >= 0) this.give(at);
        this.open(m, !!how?.fresh);
      },
      history: this.historyOf(p),
    };
  }

  /**
   * Back and forward in the river (PIE-453): the columns themselves are the history. Back gives the keys to
   * the column this one was opened from, forward to the one back last left; either widens it only if it's
   * covered, so the text comes back where it was, not rewrapped or scrolled.
   */
  private historyOf(p: PaneS): ReaderHistory {
    const colOf = () => this.cols.find(c => c.panes.includes(p));
    const target = (dir: -1 | 1) => { const c = colOf(); const uid = dir < 0 ? c?.from : c?.ahead; return uid === undefined ? undefined : this.cols.find(x => x.uid === uid); };
    return {
      peek: dir => { const t = target(dir); return t ? this.titleOf(t.panes[0]!) : null; },
      go: dir => {
        const c = colOf(), t = target(dir);
        if (!c || !t) return dir < 0 ? "nothing to go back to: this column wasn't opened from one still open" : "nothing ahead: go back first";
        if (dir < 0) t.ahead = c.uid;
        const ti = this.cols.indexOf(t);
        this.readUid = c.uid;
        this.focus = ti;
        if (this.covers().get(ti) !== "full") this.widen(ti);
        this.entered = null;
        this.save(); this.ctx.redraw();
        return null;
      },
      agentRefusal: "back and forward in the river move the person's keys between columns; an agent opens beside (open, link.follow) instead",
    };
  }

  /** The edit or comment the pane's surface holds, if any. */
  private sessionOf(p: PaneS): Draft | CommentSession | null { return p.surface.draft ?? p.surface.session ?? null; }
  /** The agents that acted in the pane's current edit or comment. */
  private agentsIn(p: PaneS): Set<string> { const s = this.sessionOf(p); return s && p.agents.of === s ? p.agents.ids : new Set(); }
  private track(p: PaneS, actor: Actor) {
    const s = this.sessionOf(p);
    if (!s || actor.kind !== "agent") return;
    if (p.agents.of !== s) p.agents = { of: s, ids: new Set() };
    p.agents.ids.add(actor.id);
  }
  /** The person is in this pane's edit or comment: it's the focused pane and it's the session they entered. */
  private isEntered(p: PaneS): boolean {
    const e = this.entered;
    return !!e && e.p === p && p === this.paneS && e.of === this.sessionOf(p);
  }
  /** "an agent's (x) edit", "your comment": for the hint and refusals on a session the person hasn't entered. */
  private whose(p: PaneS): string {
    const ids = [...this.agentsIn(p)];
    const what = p.surface.draft ? "edit" : "comment";
    return ids.length ? `an agent's (${ids.join(", ")}) ${what}` : `the ${what}`;
  }

  /** The person acted in `here`: its notice and agent line have been read; elsewhere they clear once shown BANNER_MS. */
  private seen(here: PaneS | undefined) {
    const now = Date.now();
    for (const q of this.panes()) {
      if (q !== here && !(q.shown && now - q.shown.at >= BANNER_MS)) continue;
      q.surface.notice = ""; q.surface.agent = null; q.shown = undefined;
    }
  }

  /** Point the pane's surface at its note (a no-op while it holds an edit or a comment). */
  private ready(p: PaneS): NoteSurface {
    const s = p.surface;
    if (s.editing) return s;
    const m = this.noteOf(p);
    if (!m) throw new ActionRefused(p.source.kind === "block" ? "the column's note is still being read" : "nothing is selected in this column");
    if (s.msg?.id !== m.id) s.show(m, this.hostFor(p));
    return s;
  }

  /** A link is selected in the pane's note: ⏎ follows it instead of opening the selected card. */
  private linked(p: PaneS): boolean {
    return !!p.surface.msg && p.surface.msg.id === this.noteOf(p)?.id && p.surface.describe().links.some(l => l.selected);
  }

  /** In read mode, what the surface has to say under the note: that it's in the Trash, a save that changed properties, what an agent did. */
  private banner(p: PaneS, m: Msg, w: number): string[] {
    const s = p.surface;
    if (s.msg?.id !== m.id) return [];
    const key = `${s.notice}|${s.agent?.at ?? ""}`;
    if (key !== "|" && p.shown?.key !== key) p.shown = { key, at: Date.now() };
    return [
      // A note trashed while it's shown (with an ancestor, too: the surface reads it again) says so, as the reader does.
      ...(m.deleted ? [fg(C.lred) + pad(IN_TRASH, w) + RESET] : []),
      ...(s.notice ? [fg(C.yellow) + pad(s.notice, w) + RESET] : []),
      ...(s.agent ? [fg(C.lmagenta) + pad(`an agent (${s.agent.id}) ${s.agent.did}`, w) + RESET] : []),
    ];
  }

  tick() {
    if (this.indexing === null) return false;
    const now = Date.now();
    if (now - this.lastTick < 250) return false;
    this.lastTick = now;
    return true;
  }

  openBlock(m: Msg) { this.open(m, false); }

  describe() {
    const covers = this.covers();
    return {
      kind: "river", focus: this.focus, wide: this.anchor + 1,
      columns: this.cols.map((c, i) => ({
        n: i + 1, pinned: c.pinned, focused: i === this.focus, wide: i === this.anchor, cover: covers.get(i) ?? "off screen",
        panes: c.panes.map((p, pi) => {
          const note = this.noteOf(p);
          return {
            reader: this.readerId(p), at: this.readerName(i, pi), title: this.titleOf(p), source: p.source, filter: filterText(p.filter), selected: this.flat(p)[p.sel]?.m.id ?? null,
            note: note ? { id: note.id, title: subject(note) } : null,
            ...(p.surface.msg ? { surface: p.surface.describe() } : {}),
          };
        }),
      })),
    };
  }

  // ── draft safety: leaving the river or a signal copies unsaved text out ──

  unsaved() { return this.panes().some(p => p.surface.unsaved()); }
  /**
   * Screen.holdsKeys: the person's keys are the river's own business right now: the filter, the jump palette
   * or the tag choice being typed, the keys' help open, a selection being made by keys (v), or in the focused column the property panel, a step's status choice, or an
   * edit or comment they're in. A tile around the river gives it every key then, and an agent doesn't move the
   * person's screen (agentMayMove, PIE-489).
   */
  holdsKeys(): boolean {
    const p = this.paneS;
    return this.mode !== "" || !!this.sel?.s.keys || !!p?.surface.panel || !!p?.surface.choosing || (!!p?.surface.editing && this.isEntered(p));
  }
  keepDrafts() { return this.panes().flatMap(p => p.surface.keepDrafts()); }
  /** Screen.dispose: the river is left; its readers' drafts let go of their holds on the service (PIE-501). */
  dispose() { for (const p of this.panes()) p.surface.dispose(); }

  // ── actions: what the keys do, by name, for agents (`ep0ch-door act`) ─────

  private covers(): Map<number, Cover> { return new Map(this.layout(this.ctx.t.cols).map(l => [l.col, l.cover])); }
  /** Where a pane is now: "3", or "3.2" in a column of stacked panes. It moves as columns open and close. */
  private readerName(ci: number, pi: number) { return this.cols[ci]!.panes.length > 1 ? `${ci + 1}.${pi + 1}` : `${ci + 1}`; }
  /** Which pane it is: "r7", for as long as the pane is open. */
  private readerId(p: PaneS) { return `r${p.id}`; }
  private locate(p: PaneS): { ci: number; pi: number } | null {
    for (let ci = 0; ci < this.cols.length; ci++) { const pi = this.cols[ci]!.panes.indexOf(p); if (pi >= 0) return { ci, pi }; }
    return null;
  }
  private named(p: PaneS): { reader: string; at: string } {
    const w = this.locate(p);
    return { reader: this.readerId(p), at: w ? this.readerName(w.ci, w.pi) : "closed" };
  }

  actions() {
    return {
      // A note action the river has its own of (select, back, forward) is the river's here.
      actions: [...RIVER_ACTIONS.list(), ...NOTE_ACTIONS.list().filter(a => !RIVER_ACTIONS.has(a.name))],
      readers: this.panes().map(p => this.readerId(p)),
      at: Object.fromEntries(this.cols.flatMap((c, ci) => c.panes.map((p, pi) => [this.readerName(ci, pi), this.readerId(p)]))),
    };
  }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (RIVER_ACTIONS.has(req.action)) return RIVER_ACTIONS.runUntyped(req.action, args, { r: this, reader: req.reader }, actor);
    if (!NOTE_ACTIONS.has(req.action)) throw new ActionRefused(`no action ${req.action} in the river; \`actions\` lists them`);
    const t = this.pick(req.reader, actor);
    // A column number is a convenience: columns shift as others open and close. An edit or a comment
    // an agent is in carries on only in the pane that holds it, whatever number that pane has now.
    if (SESSION_ACTIONS.has(req.action) && actor.kind === "agent" && (t.by === "position" || t.by === "focused")) {
      const mine = this.panes().filter(q => q.surface.editing && this.agentsIn(q).has(actor.id));
      if (mine.length && !mine.includes(t.p)) {
        const q = mine[0]!, n = this.named(q), note = q.surface.msg ? subject(q.surface.msg) : "its note";
        throw new ActionRefused(`${t.by === "focused" ? "the focused pane" : `column ${t.at}`} isn't where your ${q.surface.draft ? "edit" : "comment"} is: that's reader ${n.reader} (column ${n.at} now, ${note}); columns move as others open and close, so name it reader=${n.reader}`);
      }
    }
    // Peek and spine columns are read-only views; an edit or a comment already open in one still takes
    // its actions (it draws when the column widens), so an agent can always finish or close its own.
    if (!t.p.surface.editing) {
      const cover = this.covers().get(t.ci);
      if (cover !== "full") throw new ActionRefused(`column ${t.at} is ${cover === undefined ? "off screen" : `a ${cover}`}; a compressed column is a read-only view until it's full width · widen reader=${t.name} or dock it (pin reader=${t.name}); neither takes the person's keys`);
    }
    let out: unknown;
    try { out = await this.ready(t.p).act(req.action, args, this.hostFor(t.p, actor), actor); }
    finally { this.track(t.p, actor); }
    return { ...this.named(t.p), ...(out && typeof out === "object" ? out : { result: out }) };
  }

  /**
   * The pane an action names: "r7" (a pane's own id, stable while it's open), "3" (column 3's active
   * pane), "3.2" (its second stacked pane), "focused", or a block id. No name: the focused pane.
   * A block id prefers the pane holding the actor's own edit or comment on that note, then a full-width
   * column opened on it, then any pane editing it, then a full-width list selecting it, then the rest.
   */
  pick(sel?: string, actor?: Actor): { name: string; at: string; ci: number; pi: number; p: PaneS; by: "focused" | "id" | "position" | "block" } {
    let ci = this.focus, pi = this.cols[ci]?.pane ?? 0, by: "focused" | "id" | "position" | "block" = "focused";
    if (sel && sel !== "focused") {
      const n = riverPosition(sel), r = /^r(\d+)$/.exec(sel);
      if (r) {
        const p = this.panes().find(x => x.id === Number(r[1]));
        if (!p) throw new ActionRefused(`there is no reader ${sel} in the river; it was closed (\`actions\` lists the open ones)`);
        ({ ci, pi } = this.locate(p)!); by = "id";
      } else if (n) {
        by = "position";
        ci = Number(n[1]) - 1;
        const col = this.cols[ci];
        if (!col) throw new ActionRefused(`there is no column ${n[1]}; the river has ${this.cols.length}`);
        pi = n[2] ? Number(n[2]) - 1 : col.pane;
        if (!col.panes[pi]) throw new ActionRefused(`column ${n[1]} has ${col.panes.length} pane${col.panes.length === 1 ? "" : "s"}`);
      } else if (/^[0-9a-f-]{8,}$/.test(sel)) {
        by = "block";
        const covers = this.covers();
        const rank = (x: { ci: number; p: PaneS }) => {
          const full = covers.get(x.ci) === "full", ed = x.p.surface.editing;
          if (ed && actor?.kind === "agent" && this.agentsIn(x.p).has(actor.id)) return 0;
          if (full && x.p.source.kind === "block") return ed ? 2 : 1;
          if (ed) return 3;
          return full ? 4 : 5;
        };
        const showing = this.cols.flatMap((c, i) => c.panes.map((p, j) => ({ ci: i, pi: j, p })))
          .filter(x => this.noteOf(x.p)?.id.startsWith(sel))
          .sort((a, b) => rank(a) - rank(b) || Number(b.ci === this.focus) - Number(a.ci === this.focus));
        const hit = showing[0];
        if (!hit) throw new ActionRefused(`no column's note is ${sel}; open it first (open id=${sel})`);
        ({ ci, pi } = hit);
      } else throw new ActionRefused(`no reader ${sel} in the river; readers are pane ids (r7, from open or peek), column numbers (2, or 2.1 for a stacked pane), focused, or a block id`);
    }
    const col = this.cols[ci];
    if (!col) throw new ActionRefused("the river has no columns");
    const p = col.panes[pi]!;
    return { name: this.readerId(p), at: this.readerName(ci, pi), ci, pi, p, by };
  }

  /**
   * `open`: a note as a column beside `reader`'s column (default the focused one), or the column it already
   * has. `focus` (the person's ⏎) gives them the column; an agent's leaves their focus put. A note the river
   * already lists opens at once (the key's column is there before the next key); another is read first.
   */
  openById(id: string, reader: string | undefined, duplicate: boolean, focus = false, listed = true): { reader: string; at: string; id: string } | Promise<{ reader: string; at: string; id: string }> {
    const go = (m: Msg) => {
      const from = reader ? this.pick(reader).ci : this.focus;
      const at = this.open(m, duplicate, from, focus);
      if (focus) this.entered = null;
      return { ...this.named(this.cols[at]!.panes[0]!), id: m.id };
    };
    const known = listed && this.panes().flatMap(p => [...(p.items ?? []), ...[...p.kids.values()].flatMap(k => (Array.isArray(k) ? k : []))]).find(m => m.id === id);
    if (known) return go(known);
    return this.ctx.board.get(id).then(m => { if (!m) throw new ActionRefused(`no block ${id}`); return go(m); });
  }

  /** The `/` palette's search over the local index (titles, work ids). */
  search(q: string): IndexBlock[] { return this.idx.search(q); }

  /** `column.scroll`: the column's view moves; what it lists, its selection and the keys stay. */
  scrollIn(sel: string | undefined, by: number, actor: Actor = USER): { reader: string; at: string; top: number } {
    const t = this.pick(sel);
    this.notTheirs(t, actor, "scroll what they're reading", "peek reads the column whole");
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} scrolled column ${t.at}`);
    this.scroll(t.p, by);
    t.p.surface.clearLink();
    this.ctx.redraw();
    return { reader: t.name, at: t.at, top: t.p.top };
  }

  /** `filter`: what the pane lists, by the river's own filter grammar; the selection goes back to the top. */
  filterIn(sel: string | undefined, query: string, actor: Actor = USER): { reader: string; at: string; filter: string; listed: number } {
    const t = this.pick(sel);
    this.notTheirs(t, actor, "change what it lists under them (a filter goes back to the top)", "jump query= finds notes; open or tag puts a column of your own beside");
    t.p.filter = parseFilter(query); t.p.sel = 0; t.p.top = 0;
    this.save(); this.ctx.redraw();
    return { reader: t.name, at: t.at, filter: filterText(t.p.filter), listed: this.listed(t.p) };
  }

  /** `tag`: a #value column beside the pane's column; `focus` (the person's) gives them it. */
  tagIn(sel: string | undefined, key: string, value: string | undefined, focus: boolean): { reader: string; at: string; key: string; value: string } {
    const t = this.pick(sel);
    const v = value ?? this.flat(t.p)[t.p.sel]?.m.props[key];
    if (!v) throw new ActionRefused(`the selected note in column ${t.at} has no ${key}::; pass value=`);
    const p = this.openTag(key, v, t.ci, focus);
    return { ...this.named(p), key, value: v };
  }

  /** `back` and `forward`: the column this one was opened from, or the one back left. The person's only. */
  travel(sel: string | undefined, dir: -1 | 1, actor: Actor): { focus: string; at: string } {
    const t = this.pick(sel), h = this.historyOf(t.p);
    if (actor.kind === "agent") throw new ActionRefused(h.agentRefusal ?? "the person's keys only");
    const why = h.go(dir);
    if (why) throw new ActionRefused(why);
    const p = this.paneS!;
    return { focus: this.readerId(p), at: this.named(p).at };
  }

  /** `copy`: the text selected in a column. The person's goes to the clipboard; an agent's is given back. */
  copySelection(actor: Actor): { chars: number; text: string } {
    const sel = this.sel;
    if (!sel) throw new ActionRefused("nothing is selected · drag across the text, or v and move");
    const text = sel.s.text(rowsOf(sel.p.drawn?.lines ?? []));
    if (!text.trim()) throw new ActionRefused("nothing to copy: only blanks are selected");
    if (actor.kind !== "agent") { this.ctx.copy?.(text); this.ctx.flash(`copied ${[...text].length} chars`); }
    return { chars: [...text].length, text };
  }

  /** A person's key or click: the river's action, as `you`, on their pane; a refusal is said on the status bar. */
  private run<K extends keyof RiverArgs & string>(name: K, args: RiverArgs[K], reader?: string, refused?: (why: string) => string | null) {
    void runAsPerson(RIVER_ACTIONS, name, args, { r: this, reader }, m => { const s = refused ? refused(m) : m; if (s) this.ctx.flash(s); }).then(() => this.ctx.redraw());
  }

  /** The explicit shift: the column takes the wide place; the person's keys stay where they are. */
  widenIn(sel?: string): { reader: string; at: string; wide: boolean } {
    const t = this.pick(sel);
    this.widen(t.ci);
    this.save(); this.ctx.redraw();
    return { reader: t.name, at: t.at, wide: this.anchor === t.ci };
  }

  focusOn(sel: string): { focus: string; at: string } {
    const t = this.pick(sel);
    const moved = this.focus !== t.ci || this.cols[t.ci]!.pane !== t.pi;
    this.give(t.ci); this.cols[t.ci]!.pane = t.pi;
    this.reveal(t.ci);                         // as h l: a column off the strip altogether is brought on, nothing else moves
    if (moved) this.entered = null;          // the person comes back to an edit by moving: they enter it again
    this.save(); this.ctx.redraw();
    return { focus: t.name, at: t.at };
  }

  /** Select a note in the pane's list, as j k would (a block column's note stays its own): by id, nth row, or rows from the selected one. */
  selectIn(to: { id?: string; n?: number; by?: number; scroll?: boolean }, sel?: string, actor: Actor = USER): { reader: string; at: string; selected: string } {
    const t = this.pick(sel);
    const rows = this.flat(t.p), { id, n, by } = to;
    // id= is how an agent picks the note its note actions act on (as it always was); a move by row is the cursor's.
    if (id === undefined) this.notTheirs(t, actor, "move their cursor", "select id= picks a note for your note actions; peek reads the column");
    if (!rows.length) throw new ActionRefused(`column ${t.at} lists nothing${t.p.filter.length ? " (it's filtered)" : ""}`);
    const i = id !== undefined ? rows.findIndex(r => r.m.id === id || (id.length >= 8 && r.m.id.startsWith(id)))
      : n !== undefined ? (Number.isInteger(n) && n >= 1 && n <= rows.length ? n - 1 : -2)
      : by !== undefined ? Math.max(0, Math.min(rows.length - 1, t.p.sel + Math.trunc(by)))
      : -3;
    if (i === -3) throw new ActionRefused("select needs id=, n= or by=");
    if (i === -2) throw new ActionRefused(`column ${t.at} lists ${rows.length}; n is 1-${rows.length}`);
    if (i < 0) throw new ActionRefused(`column ${t.at} doesn't list ${id}${t.p.filter.length ? " (it's filtered)" : ""}`);
    t.p.sel = i;
    if (to.scroll === false) t.p.shownSel = i;               // already in view (a click): nothing scrolls
    if (!t.p.surface.editing) t.p.surface.clearLink();
    if (actor.kind === "agent" && id === undefined) this.ctx.flash(`${agentLabel(actor)} selected row ${i + 1} in column ${t.at}`);
    this.save(); this.ctx.redraw();
    return { reader: t.name, at: t.at, selected: this.flat(t.p)[i]!.m.id };
  }

  /**
   * The column the person has the keys in is theirs: an agent's move of its cursor, its scroll or its filter is
   * refused there, with the agent's own way named. On any other column it runs, said on the status bar.
   */
  private notTheirs(t: { p: PaneS; at: string }, actor: Actor, what: string, way: string) {
    if (actor.kind === "agent" && t.p === this.paneS) throw new ActionRefused(`the person has the keys in column ${t.at}; an agent's wouldn't ${what} there · ${way}, or act on another column`);
  }

  /** Show or hide a listed note's replies in place (space). */
  repliesIn(sel: string | undefined, id: string | undefined, open: boolean | undefined): { reader: string; at: string; id: string; open: boolean } {
    const t = this.pick(sel);
    const m = id ? this.flat(t.p).find(r => r.m.id === id || (id.length >= 8 && r.m.id.startsWith(id)))?.m : this.flat(t.p)[t.p.sel]?.m;
    if (!m) throw new ActionRefused(id ? `column ${t.at} doesn't list ${id}` : `nothing is selected in column ${t.at}`);
    if (open === undefined || open !== t.p.open.has(m.id)) this.toggle(t.p, m);
    return { reader: t.name, at: t.at, id: m.id, open: t.p.open.has(m.id) };
  }

  /** `s`: the new pane is stacked in the column; an agent's leaves the column's active pane (the person's) where it was. */
  splitIn(sel?: string, focus = false): { reader: string; at: string; id: string } {
    const t = this.pick(sel);
    const m = this.flat(t.p)[t.p.sel]?.m;
    if (!m) throw new ActionRefused(`nothing is selected in column ${t.at}`);
    const np = this.split(this.cols[t.ci]!, m, focus);
    this.ctx.redraw();
    return { ...this.named(np), id: m.id };
  }

  dock(sel: string | undefined, docked: boolean | undefined): { reader: string; at: string; docked: boolean } {
    const t = this.pick(sel), col = this.cols[t.ci]!;
    col.pinned = docked ?? !col.pinned;
    if (col.pinned) this.keepUid = null;                     // the dock is the newer choice: it takes the kept column's place
    this.save(); this.ctx.redraw();
    return { reader: t.name, at: t.at, docked: col.pinned };
  }

  closeIn(sel?: string): { closed: string; at: string } {
    const t = this.pick(sel);
    const why = this.close(t.ci, t.pi);
    if (why) throw new ActionRefused(`column ${t.at} wasn't closed: ${why}`);
    this.ctx.redraw();
    return { closed: t.name, at: t.at };
  }

  onEvent(e: OutlineEvent) {
    this.gen++;
    this.refreshSurfaces(e);
    if (e.action === "reset") {                        // reconnected without a catch-up: every pane again
      for (const c of this.cols) for (const p of c.panes) this.load(p);
      return this.refreshIndex();
    }
    const id = e.blockId;
    if (id) for (const c of this.cols) for (const p of c.panes) {
      const shows = (p.source.kind === "block" && p.source.id === id) || p.items?.some(m => m.id === id || m.parentId === id);
      if (!shows) continue;
      clearTimeout(this.reloads.get(p));
      this.reloads.set(p, setTimeout(() => this.load(p), 800));
    }
    if (Date.now() - this.lastIndex > 60_000) this.refreshIndex();
  }

  /**
   * Each surface that shows a note re-reads it when the change makes it stale (NoteSurface.staleOn: a change
   * to that note it hasn't seen, a reset, a trash or restore), and re-reads its comment threads (debounced; a
   * comment's event names the comment, not the note). A draft is never replaced, only marked "changed elsewhere".
   */
  private refreshSurfaces(e: OutlineEvent) {
    for (const p of this.panes()) {
      const s = p.surface, m = s.msg;
      if (!m) continue;
      const host = this.hostFor(p);
      if (e.action === "reconnected") s.retry(host);
      s.onEvent(host);
      if (s.staleOn(e)) s.reread(host);
    }
  }

  key(k: Key, ctx: Ctx) { this.keyIn(k, ctx); }

  private keyIn(k: Key, ctx: Ctx) {
    if (this.mode) return this.modal(k);
    if (k.kind === "mouse") return this.mouse(k);
    const col = this.col, p = this.paneS;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    this.seen(p);
    // The property panel (and a value field in it) is only ever opened by the person's `i`, so it holds
    // their keys first; Esc closes the field, then the panel.
    if (p && p.surface.panel) { p.surface.key(k, this.hostFor(p)); return ctx.redraw(); }
    // So does a step's status choice (PIE-472), until they choose or cancel.
    if (p && p.surface.choosing) { p.surface.key(k, this.hostFor(p)); return ctx.redraw(); }
    const held = !!p?.surface.editing;
    // An edit, a passage being picked, a comment being written, the thread list, that the person is in:
    // every key is the surface's.
    if (p && held && this.isEntered(p)) { p.surface.key(k, this.hostFor(p)); return; }
    if (!held && this.selectKey(k, p)) return;
    // One they aren't in (an agent's, or theirs after moving focus away and back): e or ⏎ enters it; the
    // other keys keep navigating the river, so an agent's session never takes the person's keys.
    if (p && held && (c === "e" || k.kind === "enter")) {
      this.entered = { p, of: this.sessionOf(p)! };
      ctx.flash(`in ${this.whose(p)} · ${p.surface.hint()}`);
      return ctx.redraw();
    }
    // Reading: the surface's own keys act on the column's note (e C m i ctrl+e [ ] u, ⏎ or alt+⏎ on a
    // selected link: without it, alt+⏎ would open the selected card in a new column instead, PIE-441).
    const linked = !!p && !held && this.linked(p);
    const ctrlE = k.kind === "char" && !!k.ctrl && k.ch === "e";
    // An element the column's [ ] is on (PIE-441): ⏎ acts on it (a link or an embed opens beside, a step's
    // box opens its status choice); on a step, space toggles it (PIE-472). ctrl+z undoes a step change.
    const current = p && !held && p.surface.msg?.id === this.noteOf(p)?.id ? p.surface.currentKind() : null;
    const undo = k.kind === "char" && !!k.ctrl && k.ch === "z";
    // u on a top-level note: nothing to go up to (said, and the column's surface isn't pointed at it for nothing).
    if (p && !held && c === "u" && !this.noteOf(p)?.parentId) return ctx.flash("this note has no parent");
    if (p && !held && (c === "e" || c === "C" || c === "m" || c === "i" || c === "[" || c === "]" || c === "u" || ctrlE || undo || (current === "task" && c === " ") || ((linked || current) && (k.kind === "enter" || k.kind === "alt-enter")))) {
      // A step change's Undo isn't an edit: it works in a compressed column too.
      if (this.covers().get(this.focus) !== "full" && !undo) return ctx.flash("this column is covered; w (or a click on its header) widens it to edit or comment here");
      try {
        const s = this.ready(p), host = this.hostFor(p);
        // Starting an edit or a comment by key: the person is in it once it opens.
        // e ctrl+e C m run the note's action (PIE-510), as `act` does; i and the rest are the surface's own keys.
        const kind = sessionStart(k), start = kind && kind !== "props" && kind !== "props-full" ? s.startAsPerson(kind, host) : null;
        if (start) start.then(() => { const now = this.sessionOf(p); if (now && this.paneS === p) this.entered = { p, of: now }; ctx.redraw(); }, e => ctx.flash(e instanceof Error ? e.message : String(e)));
        else if (!s.key(k, host)) ctx.flash(c === "u" ? "this note has no parent" : "nothing to do");
      } catch (e) { ctx.flash(e instanceof Error ? e.message : String(e)); }
      return ctx.redraw();
    }
    if ((linked || current) && k.kind === "esc") { p!.surface.clearLink(); return ctx.redraw(); }
    // Back and forward (alt+← alt+→, backspace, the mouse's side buttons): between the columns a follow opened.
    const dir = p && !held ? historyKey(k) : 0;
    if (dir) return this.run(dir < 0 ? "back" : "forward", {}, this.readerId(p!));
    if (p) p.surface.clearLink();
    // Every key below is a river action, run as the person on the pane that has their keys (PIE-506).
    const me = p ? this.readerId(p) : undefined;
    const paneAt = (ci: number) => { const to = this.cols[ci]; return to ? this.readerId(to.panes[to.pane]!) : undefined; };
    // h l move the keys only; the layout stays (a column off the strip altogether is brought on).
    if (k.kind === "left" || c === "h" || k.kind === "right" || c === "l") {
      const to = paneAt(Math.max(0, Math.min(this.cols.length - 1, this.focus + (k.kind === "left" || c === "h" ? -1 : 1))));
      if (to && to !== me) this.run("focus", {}, to);
      return;
    }
    // w: the explicit shift. The focused column takes the wide place.
    if (c === "w" && col) return this.shift(this.focus);
    if (p && (k.kind === "down" || c === "j" || k.kind === "up" || c === "k")) return this.run("select", { by: k.kind === "down" || c === "j" ? 1 : -1 }, me);
    // A page of the column in a full column, as in any reader; in a peek (a list of titles) eight cards.
    if (p && (k.kind === "pgdn" || k.kind === "pgup")) {
      const dirn = k.kind === "pgdn" ? 1 : -1;
      return this.coverOf(p) !== "spine" ? this.run("column.scroll", { by: dirn * Math.max(1, (p.height ?? 10) - 2) }, me) : this.run("select", { by: dirn * 8 }, me);
    }
    if (p && (k.kind === "home" || k.kind === "end")) return this.run("select", { by: k.kind === "home" ? -1e9 : 1e9 }, me);
    if (col && (k.kind === "tab" || k.kind === "backtab")) {
      if (col.panes.length < 2) return;
      const pi = (col.pane + (k.kind === "tab" ? 1 : col.panes.length - 1)) % col.panes.length;
      return this.run("focus", {}, this.readerId(col.panes[pi]!));
    }
    if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.selected(); if (m) this.run("open", { id: m.id, ...(k.kind === "alt-enter" ? { duplicate: true } : {}) }, me); return; }
    if (c === " ") { if (p && this.selected()) this.run("replies", {}, me); return; }
    if (c === "s" && p) return this.run("split", {}, me);
    if (c === "p" && p) return this.run("pin", {}, me);
    if (c === "x" && p) return this.run("close", {}, me, why => (why.includes("it's the last") ? null : `${why.replace(/^column \S+ wasn't closed: /, "not closed: ")}${held ? " · e or ⏎ enters it" : ""}`));
    // f, # and /: an input state (the filter, the tag choice, the jump palette) that ⏎ (or a digit) ends in an action.
    if (c === "f" && p) { this.mode = "filter"; this.input = filterText(p.filter); return ctx.redraw(); }
    if (c === "#") { const m = this.selected(); this.tagChoices = m ? Object.entries(m.props).filter(([key]) => !["source-block", "proof", "work-batch"].includes(key)).slice(0, 9) : []; this.mode = "tags"; return ctx.redraw(); }
    if (c === "/") { this.mode = "palette"; this.input = ""; this.matches = this.idx.search(""); this.msel = 0; return ctx.redraw(); }
    if (c === "?") { this.mode = "help"; return ctx.redraw(); }
    if (c === "c") return ctx.flash("the river squeezes columns itself (w widens one, p docks one) · C comments on a passage");
    // " is quote-to-be (q is back, as on every screen: PIE-489).
    if (c === "\"") return ctx.flash("quote (a new note quoting this one) isn't in the door yet; C comments on a passage");
    if (c === "V") return shellKeyOf("video.cycle", this, ctx);
    if (k.kind === "esc" || c === "q") return shellKeyOf("screen.back", this, ctx);
  }

  private modal(k: Key) {
    const ctx = this.ctx;
    if (this.mode === "help") { this.mode = ""; return ctx.redraw(); }
    if (k.kind === "esc") { this.mode = ""; return ctx.redraw(); }
    if (this.mode === "tags") {
      const i = k.kind === "char" && !k.ctrl ? Number(k.ch) - 1 : -1;
      const t = this.tagChoices[i];
      this.mode = "";
      const p = this.paneS;
      if (t) return this.run("tag", { key: t[0], value: t[1] }, p ? this.readerId(p) : undefined);
      return ctx.redraw();
    }
    if (this.mode === "palette" && (k.kind === "up" || k.kind === "down")) {
      this.msel = Math.max(0, Math.min(this.matches.length - 1, this.msel + (k.kind === "down" ? 1 : -1)));
      return ctx.redraw();
    }
    if (k.kind === "enter" || k.kind === "alt-enter") {
      const mode = this.mode, p = this.paneS, me = p ? this.readerId(p) : undefined;
      this.mode = "";
      if (mode === "filter" && p) return this.run("filter", { query: this.input }, me);
      const b = this.matches[this.msel];
      if (mode === "palette" && b) return this.run("jump", { id: b.id, ...(k.kind === "alt-enter" ? { duplicate: true } : {}) }, me);
      return ctx.redraw();
    }
    if (k.kind === "backspace") this.input = this.input.slice(0, -1);
    else if (k.kind === "char" && !k.ctrl) this.input += k.ch;
    if (this.mode === "palette") { this.matches = this.idx.search(this.input); this.msel = 0; }
    ctx.redraw();
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const inside = (r: Rect) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    if (k.action === "drag") {
      // A drag from a click in the edit the person is in selects in the draft.
      const e = this.editDrag;
      if (e) { e.p.surface.drag(k.x - e.rect.col, k.y - e.rect.row, this.hostFor(e.p)); return this.ctx.redraw(); }
      const d = this.down;
      if (!d || !this.gesture.drag(k.x, k.y) || !d.p.drawn) return;
      // A drag off the pressed cell selects (PIE-419); from a link or a card it selects too, never opens.
      if (!d.dragging) { d.dragging = true; const a = this.posIn(d, this.gesture.pressed!.x, this.gesture.pressed!.y); this.sel = { p: d.p, s: new Selection(a, { ...a }, false, d.p.drawn.w) }; }
      if (this.sel?.p === d.p) this.sel.s.head = this.posIn(d, k.x, k.y);
      return this.ctx.redraw();
    }
    if (k.action === "up") {
      if (this.editDrag) { this.editDrag = null; return this.ctx.redraw(); }
      const d = this.down, r = this.gesture.release(k.x, k.y);
      this.down = null;
      if (d && r.click) this.clickPane(d);
      return this.ctx.redraw();
    }
    if (k.action === "down") {
      this.editDrag = null;
      const h = this.hits.find(h => inside(h.rect));
      const cr = this.colRects.find(c => inside(c.rect));
      // A click on another pane leaves the edit or comment the person is in, as any editor does
      // (session.leave: saved, closed, or kept as unsent), then does what it does. Its own pane keeps it.
      const was = this.paneS;
      if (was && was.surface.editing && this.isEntered(was) && (!h || this.cols[h.col]?.panes[h.pane] !== was)) {
        const why = was.surface.leaveRefusal();
        if (why) { this.ctx.flash(why); return this.ctx.redraw(); }
        this.entered = null;
        was.surface.act("session.leave", {}, this.hostFor(was), USER).then(r => { const said = leaveSaid(r); if (said) this.ctx.flash(said, 10000); this.ctx.redraw(); }, e => { this.ctx.flash(e instanceof Error ? e.message : String(e)); this.ctx.redraw(); });
      }
      // Only a click in the column that already has the keys can open a card: the first one only focuses.
      const wasIn = !!h && this.focus === h.col && this.cols[h.col]!.pane === h.pane;
      // A click in a column gives it the keys and nothing else: no column moves, widens or scrolls. A click
      // on its header (the top border) is the shift: it takes the wide place too. A spine is all title strip,
      // header and nothing else, so a click anywhere on it is the shift, as a click on a board spine opens it.
      // Each of these is the river's action (focus, widen, select), run as the person (PIE-506).
      if (cr) {
        const c = this.cols[cr.col]!, target = h && h.col === cr.col ? c.panes[h.pane]! : c.panes[c.pane]!;
        if (target !== this.paneS) this.run("focus", {}, this.readerId(target));
        if (k.y === cr.rect.row || cr.cover === "spine") this.shift(cr.col);
      }
      this.down = null;
      if (h) {
        const col = this.cols[h.col]!, p = col.panes[h.pane]!;
        if (col.pane !== h.pane) this.run("focus", {}, this.readerId(p));
        this.seen(p);
        // In the edit the person is in: a completion candidate (PIE-416), the preview control, or the cursor placed.
        if (p.surface.editing && this.isEntered(p) && p.surface.click(k.x - h.rect.col, k.y - h.rect.row, this.hostFor(p))) { this.editDrag = { p, rect: h.rect }; return this.ctx.redraw(); }
        const row = h.rows[k.y - h.rect.row];
        const back = row?.history?.find(x => k.x - h.rect.col >= x.from && k.x - h.rect.col < x.to);
        if (back && !p.surface.editing) { this.run(back.dir < 0 ? "back" : "forward", {}, this.readerId(p)); return this.ctx.redraw(); }
        const link = row?.links?.find(l => k.x - h.rect.col >= l.from && k.x - h.rect.col < l.to);
        const same = wasIn && !!row && row.card >= 0 && p.sel === row.card;
        if (row && row.card >= 0 && !(link && !p.surface.editing)) {
          // It's where the pointer is: already in view, so nothing scrolls (scroll=false). The clicked card is
          // what ⏎ opens now, not a link selected in the note before (select lets go of it).
          this.run("select", { n: row.card + 1, scroll: false }, this.readerId(p));
        }
        // What the click does (open a link or the card, show replies) waits for the release: a drag selects instead.
        this.down = { p, rect: h.rect, row, link: link && !p.surface.editing ? link.link : undefined, same, dragging: false };
        // On a card's row a second click opens it, as it always did; double and triple clicks select in the note's text.
        if (row && row.card >= 0) this.gesture.forget();
        const n = this.gesture.press(k.x, k.y);
        const rows = p.drawn && rowsOf(p.drawn.lines);
        if (n > 1 && rows && !p.surface.editing) {
          const at = this.posIn(this.down, k.x, k.y);
          this.sel = { p, s: n === 2 ? wordAt(rows, at) : lineAt(rows, at.row) };
          this.sel.s.w = p.drawn!.w;
        }
      }
      // A press anywhere else lets go of the selection (a click in its own pane does, on release).
      if (this.sel && this.sel.p !== this.down?.p) this.sel = null;
      if (this.entered && this.entered.p !== this.paneS) this.entered = null;
      this.save();
      return this.ctx.redraw();
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const h = this.hits.find(h => inside(h.rect));
      if (!h) return;
      const p = this.cols[h.col]!.panes[h.pane]!;
      // In an edit the wheel is the surface's (it moves a completion popup's choice, or the cursor).
      if (p.surface.editing) { if (this.isEntered(p)) p.surface.wheel(k.action === "wheel-down" ? 1 : -1, this.hostFor(p)); return; }
      this.seen(p);
      // The wheel scrolls a column by lines, like the desk reader, a peek under its neighbour too; nothing else moves.
      this.run("column.scroll", { by: wheelRows(k.action === "wheel-down" ? 1 : -1) }, this.readerId(p));
    }
  }
}

interface RiverOn { r: River; reader?: string }


/** Each river action's arguments: what its keys, its clicks and `act` pass. */
type RiverArgs = {
  "open": { id: string; duplicate?: boolean };
  "focus": Record<string, never>;
  "select": { id?: string; n?: number; by?: number; scroll?: boolean };
  "replies": { id?: string; open?: boolean };
  "split": Record<string, never>;
  "pin": { docked?: boolean };
  "widen": Record<string, never>;
  "close": Record<string, never>;
  "column.scroll": { by: number };
  "filter": { query: string };
  "tag": { key: string; value?: string };
  "jump": { query?: string; id?: string; n?: number; duplicate?: boolean };
  "back": Record<string, never>;
  "forward": Record<string, never>;
  "copy": Record<string, never>;
};

/**
 * What the river adds to a column's note actions: which note is a column, which has the keys, and the threads.
 * Every river key and click runs one of these (PIE-506), as the person; an agent runs the same code.
 */
export const RIVER_ACTIONS = new ActionSet<RiverArgs, RiverOn>("river", {
  "open": {
    summary: "open a note as a column beside reader= (default the focused column), or find the column it has; returns its stable reader id (r7). An agent's leaves the person's focus where it is; the person's (⏎) gives them the column", keys: "enter, alt+enter, click a selected card",
    args: { id: { type: "string", about: "the block id" }, duplicate: { type: "boolean", optional: true, about: "a second column even if it has one (alt+enter)" } },
    async run({ id, duplicate }, { r, reader }, actor) {
      const out = await r.openById(id, reader, !!duplicate, actor.kind !== "agent");
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} opened a note in column ${out.at}`);
      return out;
    },
  },
  "focus": {
    summary: "give the person's keys to reader= (r7, a column, or <column>.<pane>); only the keys move, the layout stays (widen shifts it). Only when the person asked: it moves their focus", keys: "h l ← →, tab, shift+tab, click in a column",
    args: {},
    run(_, { r, reader }, actor) {
      if (!reader) throw new ActionRefused("focus needs reader=<r7 or a column number>");
      const out = r.focusOn(reader);
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} gave the keys to column ${out.at}`);
      return out;
    },
  },
  "select": {
    summary: "select a note listed in the column (in the Library and a #tag column, that's the note e and c act on): id=, the nth listed (n=, from 1), or by= rows from the selected one (j k: 1 -1). An agent's n= or by= is refused on the column the person has the keys in (that's their cursor); id= works as it always did", keys: "j k ↑↓, PgUp PgDn and Home End in a spine, click",
    args: {
      id: { type: "string", optional: true, about: "the note's block id (or its first 8+ characters)" },
      n: { type: "number", optional: true, about: "the nth row listed, from 1 (replies shown in place count)" },
      by: { type: "number", optional: true, about: "rows from the selected one: 1 next, -1 previous" },
      scroll: { type: "boolean", optional: true, about: "false leaves the column's scroll as it is (a click on a card in view); default brings the card into view" },
    },
    run: ({ id, n, by, scroll }, { r, reader }, actor) => r.selectIn({ id, n, by, scroll }, reader, actor),
  },
  "replies": {
    summary: "show or hide a listed note's replies in place (the selected one, or id=)", keys: "space, click on » replies",
    args: { id: { type: "string", optional: true, about: "which listed note; default the selected one" }, open: { type: "boolean", optional: true, about: "true shows, false hides; default toggles" } },
    run: ({ id, open }, { r, reader }) => r.repliesIn(reader, id, open),
  },
  "split": {
    summary: "stack the selected note as its own pane in the same column; returns its reader id (an agent's leaves the column's active pane as it was; the person's s moves to it)", keys: "s",
    args: {},
    run: (_, { r, reader }, actor) => r.splitIn(reader, actor.kind !== "agent"),
  },
  "pin": {
    summary: "dock the column so it resists compression, widening a peek or spine without moving the person's focus (docked=false undocks; default toggles)", keys: "p",
    args: { docked: { type: "boolean", optional: true, about: "dock or undock" } },
    run: ({ docked }, { r, reader }) => r.dock(reader, docked),
  },
  "widen": {
    summary: "give reader='s column the wide place (the layout is built around it; the column that had it stays full beside it when there's room). The person's keys stay where they are", keys: "w, click a column's header or a spine",
    args: {},
    run(_, { r, reader }, actor) {
      const out = r.widenIn(reader);
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} widened column ${out.at}`);
      return out;
    },
  },
  "close": {
    summary: "close the pane, or the column when it has one; refused while it holds an edit or a comment", keys: "x",
    args: {},
    run: (_, { r, reader }) => r.closeIn(reader),
  },
  "column.scroll": {
    summary: "scroll reader='s column by= rows (a page is its height less two); what it lists, its selection and the person's keys stay. An agent's is refused on the column the person has the keys in, and said on the status bar elsewhere", keys: "PgUp PgDn in a full column, wheel",
    args: { by: { type: "number", about: "rows: positive down, negative up" } },
    run: ({ by }, { r, reader }, actor) => r.scrollIn(reader, by, actor),
  },
  "filter": {
    summary: "filter what reader='s pane lists: type:hub -status:done author:codex word (query= empty clears it). The person's f, typing, ⏎; an agent's is refused on the column the person has the keys in, and said on the status bar elsewhere", keys: "f then typing, ⏎ (or alt+⏎)",
    args: { query: { type: "string", about: "clauses: key:value, -key:value, author:x, or words" } },
    run({ query }, { r, reader }, actor) {
      const out = r.filterIn(reader, query, actor);
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} filtered column ${out.at}${out.filter ? ` by ${out.filter}` : " (cleared)"}`);
      return out;
    },
  },
  "tag": {
    summary: "open a virtual branch: a #value column of every note with key::value, beside reader='s column (value defaults to the selected note's). The person's # then 1-9 gives them the column; an agent's leaves their focus", keys: "# then 1-9",
    args: { key: { type: "string", about: "the property key" }, value: { type: "string", optional: true, about: "its value; default the selected note's" } },
    run({ key, value }, { r, reader }, actor) {
      const out = r.tagIn(reader, key, value, actor.kind !== "agent");
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} opened #${out.value} in column ${out.at}`);
      return out;
    },
  },
  "jump": {
    summary: "search the whole index (the / palette): query= alone lists the matches; id= or n= (the nth match, from 1) opens it as a column, as ⏎ in the palette does. An agent's open leaves the person's focus", keys: "/ then typing, ↑↓, ⏎, alt+enter",
    args: {
      query: { type: "string", optional: true, about: "words to find (titles, work ids)" },
      id: { type: "string", optional: true, about: "the block to open" },
      n: { type: "number", optional: true, about: "open the nth match of query=, from 1" },
      duplicate: { type: "boolean", optional: true, about: "a second column even if it has one (alt+enter)" },
    },
    async run({ query, id, n, duplicate }, { r, reader }, actor) {
      const matches = r.search(query ?? "");
      const pick = id ?? (n !== undefined ? matches[n - 1]?.id : undefined);
      if (n !== undefined && !pick) throw new ActionRefused(`there are ${matches.length} matches for ${JSON.stringify(query ?? "")}; n is 1-${matches.length}`);
      if (!pick) return { query: query ?? "", matches: matches.slice(0, 40).map((b, i) => ({ n: i + 1, id: b.id, title: b.title })) };
      const out = await r.openById(pick, reader, !!duplicate, actor.kind !== "agent", false);
      if (actor.kind === "agent") r.ctx.flash(`${agentLabel(actor)} jumped to a note in column ${out.at}`);
      return out;
    },
  },
  "back": {
    summary: "give the person's keys to the column this one was opened from (the river's history is its columns). The person's only: an agent opens beside instead", keys: "alt+←, alt+b (macOS Option+←), backspace, the mouse's back button, click on ← back",
    args: {},
    run: (_, { r, reader }, actor) => r.travel(reader, -1, actor),
  },
  "forward": {
    summary: "give the person's keys to the column back last left. The person's only", keys: "alt+→, alt+f (macOS Option+→), the mouse's forward button, click on forward →",
    args: {},
    run: (_, { r, reader }, actor) => r.travel(reader, 1, actor),
  },
  "copy": {
    summary: "copy the text selected in a column (drawn rows; drag, or v and move): the person's goes to their clipboard; an agent's is given back, the clipboard left alone", keys: "y",
    args: {},
    run: (_, { r }, actor) => r.copySelection(actor),
  },
});

/**
 * A reader named by position: "3" (column 3) or "3.2" (its second stacked pane). At most three digits
 * each, so a block id that happens to start with eight digits ("12345678") is still read as a block id.
 */
export function riverPosition(sel: string): RegExpExecArray | null { return /^(\d{1,3})(?:\.(\d{1,3}))?$/.exec(sel); }
