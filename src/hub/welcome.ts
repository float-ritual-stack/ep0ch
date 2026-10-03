// Welcome: the notes with a block-scoped `welcome` property, one at a time. The first ([welcome::1], then
// [welcome::2]…; any other value comes after the numbered ones, by title) is the detail when the screen
// opens. A band across the top holds an ep0ch logo from the WoE packs and a tab per note: 1…9, then 0 for the
// tenth, and "… n more" beyond that (the list down the side shows them all). A link followed in the detail
// (⏎ or a click) opens in the preview beside it; alt+⏎ or a ctrl- or alt-click reads it in the detail instead
// (the door's "open fresh" chord, here: make it the thing read). The detail's backlinks run under it
// and show in the same preview. It is a constrained surface on purpose: one note read, one preview.
//
// A screen spec on the desk (PIE-515: `welcomeSpec`): the tiles, their frames, the reader's sessions, the mouse,
// `act` and `peek` are the desk's. The list is a tile of its own kind (`welcome`, WELCOME_KIND) that knows which
// notes are welcome notes and draws the band (the spec's `band`); its actions pick them (WELCOME_ACTIONS). The
// detail is a detail that says which welcome note it reads (`welcome.detail`), the preview a preview following the
// backlinks tile (src/desk/backlinks-pane.ts), which lists the detail's backlinks, with "⇱ read here"
// (`welcome.preview`). Where opens land is the spec's: the detail's opens in the preview, the preview's own links in
// it, alt+⏎ (`fresh`) reads it in the detail (`welcome.read`), an agent's open in the preview (`lands`).
//
// With no welcome note on the outline, the detail shows the "now" page ([[claude-now]] unless EP0CH_NOW_PAGE
// names another, src/hub/now.ts; the page the menu's C used to pin) and the list says how to tag one.
import { basename } from "node:path";
import type { Art, Cell } from "../ansi";
import { artBlock } from "../art-view";
import { subject, type Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import type { Placement } from "../kitty";
import { artNamed } from "../packs";
import { USER, type Actor, type OutlineEvent, type SocketBoard } from "../socket";
import { artLines, C, chip, ellipsize, fg, pad, paint, RESET, selected, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { bbsDate, wrap } from "../text";
import { ActionRefused, ActionSet } from "../surface/actions";
import type { OpenHow } from "../surface/note";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import { PreviewPane, sourceOf } from "../desk/preview";
import type { ScreenSpec } from "../desk/screen-spec";
import { tileKind, type KindHost, type TileKind, type TileKindName } from "../desk/tile-kinds";
import { DetailPane } from "../desk/tiles";
import { nowPage } from "./now";
import { RowView } from "../scroll";

export const WELCOME_KEY = "welcome";
const WELCOME_LIMIT = 200;
/** The page shown while no note is a welcome note: the "now" page. */
export const welcomeFallback = () => nowPage().address;

/** A welcome value that is a number orders by it; any other value comes after, by title. */
const placeOf = (m: Msg): number | null => {
  const v = m.props[WELCOME_KEY]?.trim() ?? "";
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
};

/** Numbered first, lowest first; then the rest by title; ties by when they were written. */
export function orderWelcome(list: readonly Msg[]): Msg[] {
  return [...list].sort((a, b) => {
    const x = placeOf(a), y = placeOf(b);
    if (x !== null && y !== null && x !== y) return x - y;
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    return subject(a).localeCompare(subject(b)) || a.createdAt - b.createdAt;
  });
}

/** Every note with a block-scoped `welcome` property (the service's filter: has the key, any value), in welcome order. */
export async function findWelcome(board: SocketBoard): Promise<Msg[]> {
  return orderWelcome(await board.query(WELCOME_KEY, WELCOME_LIMIT, "created", "asc", true));
}

/** The digit for the note at place `i` (from 0): 1…9, then 0 for the tenth; none after that. */
export const tabKey = (i: number): string | null => (i < 9 ? String(i + 1) : i === 9 ? "0" : null);
/** The place a digit picks. */
export const placeOfKey = (d: string): number => (d === "0" ? 9 : Number(d) - 1);

// ── the logo ────────────────────────────────────────────────────────────────────────────────────────────

/** A logo from the WoE packs (Shypht's own, 1997), and the rows of it that are the logo (not a menu under it). */
export interface Logo { file: string; rows?: [number, number] }
/** The minimal ones with the dotted `::....::` frames first: that was his style. */
export const LOGOS: readonly Logo[] = [{ file: "SHY-EPO!.ANS" }, { file: "SHY-EP0C.ANS", rows: [0, 10] }, { file: "X!-EPOCH.ANS" }];

/**
 * A signature line with contact details is never drawn: seven or more digits in a run, however they're
 * written (905-555-0199, (905) 555.0199, 555 0199, +1 905 555 0199, 9055550199), with at most two
 * separators between any two digits. A year or a date on its own ("1997", "est. 1996 - 1997") stays.
 */
const CONTACT = /\d(?:[\s().\/+-]{0,2}\d){6,}/;
const rowText = (r: Cell[]) => String.fromCharCode(...r.map(c => c.code));
const blank = (r: Cell[]) => !rowText(r).replace(/[\x00\s\xff]/g, "");

/** The logo's cells: its rows, without contact lines, blank rows at either end and blank columns either side. */
export function logoCells(art: Art, logo: Logo): { rows: Cell[][]; width: number } {
  let rows = art.rows.slice(logo.rows?.[0] ?? 0, logo.rows?.[1] ?? art.rows.length).filter(r => !CONTACT.test(rowText(r)));
  while (rows.length && blank(rows[0]!)) rows = rows.slice(1);
  while (rows.length && blank(rows.at(-1)!)) rows = rows.slice(0, -1);
  const used = (r: Cell[], i: number) => !!r[i] && !/[\x00\s\xff]/.test(String.fromCharCode(r[i]!.code));
  let left = art.width, right = 0;
  for (const r of rows) for (let i = 0; i < r.length; i++) if (used(r, i)) { left = Math.min(left, i); right = Math.max(right, i + 1); }
  if (right <= left) return { rows: [], width: 0 };
  return { rows: rows.map(r => r.slice(left, right)), width: right - left };
}

/** The `n` rows of `rows` with the most ink: a short band keeps the letters, not the frame around them. */
export function densest(rows: Cell[][], n: number): Cell[][] {
  if (rows.length <= n) return rows;
  const ink = rows.map(r => rowText(r).replace(/[\x00\s\xff.:]/g, "").length);
  let best = 0, at = 0;
  for (let i = 0; i + n <= rows.length; i++) { const s = ink.slice(i, i + n).reduce((a, b) => a + b, 0); if (s > best) { best = s; at = i; } }
  return rows.slice(at, at + n);
}

// ── the tiles ───────────────────────────────────────────────────────────────────────────────────────────

type ListRow = { i: number } | { more: number };
/** Changes that never make a note a welcome note or stop it being one. */
const QUIET = new Set(["annotate", "reorder", "move", "draft"]);
/** What `welcome.select` and `welcome.read` answer. */
export type Shown = { id: string; title: string; welcome: string | null; n: number | null; of: number };
/** A click target in the band: rows `y0`..`y1`, columns `from`..`to`. */
type TabHit = { y0: number; y1: number; from: number; to: number } & ({ i: number } | { more: true } | { logo: true });

/**
 * The welcome notes down the side: each with its digit, the one in the detail lit; past the tenth, "more". It is the
 * screen's model too: which notes are welcome notes (read again as the outline changes), the fallback page while
 * there are none, the logo, and the band its kind draws.
 */
export class WelcomeList implements Pane {
  readonly kind = "welcome.list";
  /** The welcome notes, in order; null until read. */
  items: Msg[] | null = null;
  /** The "now" page while there are no welcome notes (null when there's none either). */
  fallback: Msg | null = null;
  problem = "";
  /** Which logo the band draws (LOGOS), by place: the dotted SHY-EPO! first; `L` or a click on it for the next. */
  logo = 0;
  /** The detail it reads its notes in (a `welcome.detail` tile names this list as its source as it starts). */
  detail: WelcomeDetail | null = null;
  private view = new RowView();
  private rows: ListRow[] = [];
  private reload: Timer | null = null;
  private tabs: TabHit[] = [];

  /** The place of the welcome note the detail shows, or -1 (another note, alt+⏎'s, or nothing). */
  get at(): number { const id = this.detail?.msg?.id; return id ? (this.items ?? []).findIndex(m => m.id === id) : -1; }

  title() {
    const items = this.items;
    return !items ? "asking the outline…" : items.length ? `${items.length} note${items.length === 1 ? "" : "s"}` : "none tagged yet";
  }
  hint() { return "j k pick · ⏎ read"; }

  render(w: number, h: number, focused: boolean): PaneView {
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.items) return { lines: [fg(C.dark) + "asking the outline…" + RESET] };
    if (!this.items.length) return {
      lines: [
        ...wrap("No note is a welcome note yet.", w).map(l => fg(C.white) + pad(l, w) + RESET), "",
        ...[`Tag one [${WELCOME_KEY}::1] (then 2, 3…; any value counts) and it opens here, first.`, "",
          this.fallback ? `Meanwhile the detail shows [[${welcomeFallback()}]].` : `No [[${welcomeFallback()}]] page either.`]
          .flatMap(t => (t ? wrap(t, w) : [""])).map(l => fg(C.grey) + pad(l, w) + RESET),
      ],
    };
    this.rows = this.items.flatMap((_, i): ListRow[] => (i === 10 ? [{ more: this.items!.length - 10 }, { i }] : [{ i }]));
    const at = this.at;
    const sel = this.rows.findIndex(r => "i" in r && r.i === at);
    this.view.place(sel >= 0 ? sel : null, this.rows.length, h);
    return {
      lines: this.rows.slice(this.view.top, this.view.top + h).map(r => {
        if ("more" in r) return fg(C.dark) + pad(`  … ${r.more} more`, w) + RESET;
        const m = this.items![r.i]!, key = tabKey(r.i) ?? " ";
        if (r.i === at) return (focused ? selected() : chip(C.magenta)) + pad(` ${key} ${subject(m)}`, w) + RESET;
        return pad(` ${fg(C.white)}${key} ${fg(C.lmagenta)}${subject(m)}`, w) + RESET;
      }),
    };
  }

  private run(desk: DeskApi, n: number, read = false) {
    void desk.press?.(this, WELCOME_ACTIONS, "welcome.select", { n, ...(read ? { read: true } : {}) });
  }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.items?.length ?? 0;
    if (!n) return false;
    const at = Math.max(0, this.at);
    if (isDown(k)) { if (at + 1 < n) this.run(desk, at + 2); return true; }
    if (isUp(k)) { if (at > 0) this.run(desk, at); return true; }
    if (k.kind === "home") { this.run(desk, 1); return true; }
    if (k.kind === "end") { this.run(desk, n); return true; }
    if (k.kind === "enter") { this.run(desk, at + 1, true); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const r = this.rows[this.view.top + y];
    if (r && "i" in r) this.run(desk, r.i + 1);
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const n = this.items?.length ?? 0, to = this.at + dir;
    if (to >= 0 && to < n) this.run(desk, to + 1);
  }

  // ── the model ──

  /** The preview the detail's opens land in. */
  private preview(desk: DeskApi): ReaderPane | null { const p = this.detail ? desk.linked?.(this.detail) : undefined; return p instanceof ReaderPane ? p : null; }

  /** Read the welcome notes again. The detail keeps what it shows unless that was the first read or the fallback. */
  async load(desk: DeskApi, first = false) {
    try {
      this.items = await findWelcome(desk.ctx.board);
      this.problem = "";
    } catch (e) {
      this.problem = `couldn't ask the outline for welcome notes: ${e instanceof Error ? e.message : String(e)}`;
    }
    const items = this.items ?? [], d = this.detail;
    const shown = d?.msg ?? null;
    const keep = shown && !first && shown.id !== this.fallback?.id && !d?.holdsKeys;
    if (items.length) {
      this.fallback = null;
      if (d && (!keep || !shown) && !d.holdsKeys && !d.editing) d.hold(items[0]!, desk);
    } else if (!this.problem) {
      try {
        const r = await desk.ctx.board.resolvePage(welcomeFallback());
        this.fallback = r.status === "resolved" && r.block ? r.block : null;
      } catch { this.fallback = null; }
      if (d && this.fallback && (!shown || shown.id === this.fallback.id || first) && !d.holdsKeys && !d.editing) d.hold(this.fallback, desk);
    }
    desk.redraw();
  }

  /** A note tagged, untagged, renamed, trashed or restored anywhere: the list is asked again (once per burst). */
  onEvent(desk: DeskApi, e?: OutlineEvent) {
    // Without a change record (a reset) it could be anything, so it's asked too. A comment,
    // a lane's order, a move or a draft doesn't change which notes carry the property, or their titles.
    if (e?.change && QUIET.has(e.change.kind)) return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 300);
  }
  dispose() { if (this.reload) clearTimeout(this.reload); }

  /**
   * Show the welcome note at place `i` (from 0) in the detail, as `actor`. The person's pick by digit, tab or ⏎ in
   * the list gives the detail the keys (`read`); an agent's never moves them, and waits while they type.
   */
  pick(i: number, actor: Actor, desk: DeskApi, read = false): Shown {
    const items = this.items;
    if (!items) throw new ActionRefused("the welcome notes are still being read");
    if (!items.length) throw new ActionRefused(`no note is a welcome note yet; tag one [${WELCOME_KEY}::1]`);
    if (i < 0 || i >= items.length) throw new ActionRefused(`pick 1 to ${items.length}`);
    return this.readHere(items[i]!, actor, desk, read);
  }

  /** Make `m` the note read in the detail (a welcome pick, alt+⏎ on a link, `welcome.read`); back returns to the one before. */
  readHere(m: Msg, actor: Actor, desk: DeskApi, focus = true): Shown {
    const d = this.detail;
    if (!d) throw new ActionRefused("the welcome screen has no detail to read it in");
    if (d.holdsKeys || d.editing) throw new ActionRefused("the detail holds an edit or a comment; save or close it first");
    // Another note read by the person: what the preview showed came from the one before (its link, its backlink),
    // so it empties rather than show something the detail no longer points at. An agent's leaves what the person
    // may be reading there. Either way the preview never repeats the note read.
    const other = d.msg?.id !== m.id, pv = this.preview(desk);
    if (other) d.surface.track(() => d.hold(m, desk));
    if (pv && (pv.msg?.id === m.id || (other && actor.kind !== "agent"))) pv.show(null, desk);
    if (focus && actor.kind !== "agent" && !desk.holdsKeys?.()) desk.focusPane?.(d, actor);
    const items = this.items ?? [], i = items.findIndex(x => x.id === m.id);
    const s: Shown = { id: m.id, title: subject(m), welcome: m.props[WELCOME_KEY] ?? null, n: i >= 0 ? i + 1 : null, of: items.length };
    desk.redraw();
    return s;
  }

  nextLogo(by: number, desk: DeskApi) {
    const step = by < 0 ? -1 : 1;
    this.logo = (this.logo + step + LOGOS.length) % LOGOS.length;
    desk.redraw();
    return { logo: LOGOS[this.logo]!.file, drawn: !!artNamed(LOGOS[this.logo]!.file) };
  }

  describe(desk: DeskApi) {
    const items = this.items, d = this.detail?.msg, pv = this.preview(desk)?.msg;
    return {
      welcome: items ? items.map((m, i) => ({ n: i + 1, key: tabKey(i), id: m.id, title: subject(m), value: m.props[WELCOME_KEY] ?? "" })) : null,
      shown: this.at >= 0 ? this.at + 1 : null,
      detail: d ? { id: d.id, title: subject(d) } : null,
      preview: pv ? { id: pv.id, title: subject(pv) } : null,
      fallback: items && !items.length ? (this.fallback ? { page: welcomeFallback(), id: this.fallback.id } : { page: welcomeFallback(), id: null }) : undefined,
      logo: LOGOS[this.logo]!.file,
      problem: this.problem || undefined,
    };
  }

  // ── the band: the logo, and a tab per welcome note ──

  /** The logo as it's drawn at this size: whole, its densest rows, or none. Reading comes first: the tiles keep 24 rows. */
  private logoFor(rows: number): { rows: Cell[][]; width: number } | null {
    const art = artNamed(LOGOS[this.logo]!.file);
    if (!art) return null;
    const cells = logoCells(art, LOGOS[this.logo]!);
    const room = rows - 2 - 1 - 24;
    if (!cells.rows.length || room < 6) return null;
    return cells.rows.length <= room ? cells : { rows: densest(cells.rows, Math.min(room, 8)), width: cells.width };
  }

  bandRows(_cols: number, rows: number): number { const logo = this.logoFor(rows); return logo ? logo.rows.length + 1 : 1; }

  drawBand(canvas: Canvas, r: Rect, desk: DeskApi): Placement[] {
    this.tabs = [];
    const ctx = desk.ctx;
    const logo = this.logoFor(ctx.t.rows);
    let placements: Placement[] = [];
    if (logo) {
      const info = this.info(desk);
      const infoW = Math.max(...info.map(l => width(paint(l))));
      const gap = 4, withInfo = r.cols >= logo.width + gap + infoW + 4;
      const total = logo.width + (withInfo ? gap + infoW : 0);
      const x0 = Math.max(0, Math.floor((r.cols - total) / 2));
      const b = artBlock(logo.rows, logo.width, ctx.t, { key: `welcome-logo-${this.logo}`, at: { col: x0, row: r.row }, maxRows: logo.rows.length, fit: "grid", graphics: ctx.graphics });
      if (ctx.graphics) placements = b.placements;
      else artLines(logo.rows, 0, 0, logo.width, logo.rows.length).forEach((l, i) => canvas.text(x0, r.row + i, l, Math.min(logo.width, r.cols - x0)));
      this.tabs.push({ y0: r.row, y1: r.row + logo.rows.length - 1, from: x0, to: x0 + logo.width, logo: true });
      if (withInfo) {
        const top = r.row + Math.max(0, Math.floor((logo.rows.length - info.length) / 2));
        info.forEach((l, i) => canvas.text(x0 + logo.width + gap, top + i, paint(l), r.cols - x0 - logo.width - gap));
      }
    }
    this.drawTabs(canvas, r.row + r.rows - 1, r.cols, !logo);
    return placements;
  }

  /** A press on the band: a tab reads its note, "… more" goes to the list, the logo is the next logo. */
  pressBand(x: number, y: number, desk: DeskApi) {
    const t = this.tabs.find(h => y >= h.y0 && y <= h.y1 && x >= h.from && x < h.to);
    if (t && "i" in t) void desk.press?.(this, WELCOME_ACTIONS, "welcome.select", { n: t.i + 1, read: true });
    else if (t && "more" in t) { desk.focusPane?.(this, USER); desk.redraw(); }
    else if (t && "logo" in t) void desk.press?.(this, WELCOME_ACTIONS, "welcome.logo", {});
  }

  /** The words beside the logo: real counts only. */
  private info(desk: DeskApi): string[] {
    const n = this.items?.length, ctx = desk.ctx;
    return [
      "|15e p 0 c h |08· |11welcome",
      `|07node 1${ctx.outline ?? ctx.workspace ? ` |08· |03${ctx.outline ?? basename(ctx.workspace)}` : ""}`,
      n === undefined ? "|08asking the outline…" : n ? `|07${n} |08welcome note${n === 1 ? "" : "s"} · |151-9 0|08 pick` : `|08no notes tagged [${WELCOME_KEY}::] yet`,
      `|08last call ${ctx.lastCall ? bbsDate(ctx.lastCall) : "never"}`,
    ];
  }

  /**
   * The tabs, in the logos' own voice: `[= 1 Start here = 2 House rules = … 3 more =====]`. The one in the
   * detail is lit; each is a click target, the logo too (the next logo).
   */
  private drawTabs(canvas: Canvas, row: number, cols: number, named: boolean) {
    const rail = fg(C.blue), items = this.items ?? [], at = this.at;
    let x = 0, s = "";
    const put = (text: string, sgr: string, hit?: { i: number } | { more: true } | { logo: true }, end = cols - 1) => {
      if (x + width(text) > end) text = text.slice(0, Math.max(0, end - x));
      if (!text) return;
      if (hit) this.tabs.push({ y0: row, y1: row, from: x, to: x + width(text), ...hit } as TabHit);
      s += sgr + text + RESET; x += width(text);
    };
    put("[=", rail);
    if (named) put(" e p 0 c h ", fg(C.white), { logo: true }), put("=", rail);
    const shownTabs = items.slice(0, 10);
    const more = items.length - shownTabs.length;
    // Whole titles when they fit; otherwise each gets an even share (at most 28, at least 4).
    const room = cols - x - 2 - (more ? 12 : 0) - shownTabs.length * 5;
    const whole = shownTabs.reduce((a, m) => a + subject(m).length, 0) <= room;
    const titleW = whole ? Infinity : Math.max(4, Math.min(28, Math.floor(room / Math.max(1, shownTabs.length))));
    shownTabs.forEach((m, i) => {
      const on = i === at;
      const t = subject(m);
      const label = ellipsize(t, titleW);
      put(" ", "");
      put(`${tabKey(i)} ${label}`, on ? chip(C.magenta) : fg(C.lmagenta), { i });
      put(" =", rail);
    });
    if (more) { put(" ", ""); put(`… ${more} more`, fg(C.lcyan), { more: true }); put(" =", rail); }
    if (!items.length) put(this.items ? ` no welcome notes yet · showing [[${welcomeFallback()}]] ` : " asking the outline… ", fg(C.dark)), put("=", rail);
    put("=".repeat(Math.max(0, cols - 1 - x)), rail);
    put("]", rail, undefined, cols);
    canvas.text(0, row, s, cols);
    // Each unlit tab's digit bright, as the menu's hot keys are.
    for (const t of this.tabs) if ("i" in t && t.i !== at) canvas.text(t.from, row, fg(C.white) + tabKey(t.i)! + RESET, 1);
  }
}

/** The detail: the welcome note read, or what alt+⏎ made the thing read. Its source is the welcome list. */
export class WelcomeDetail extends DetailPane {
  override readonly kind: TileKindName = "welcome.detail";
  /** The welcome list (the spec names it as this tile's source: `tile:welcome`). */
  list: WelcomeList | null = null;
  constructor(readonly source: string) { super(); }
  override title() {
    const s = this.list, m = this.msg;
    if (!s || !m) return s?.items && !s.items.length && !s.fallback ? "nothing to read yet" : "detail";
    const i = s.items?.findIndex(x => x.id === m.id) ?? -1;
    const tag = i >= 0 ? `welcome ${tabKey(i) ?? i + 1}` : s.fallback?.id === m.id ? `[[${welcomeFallback()}]] · no welcome notes yet` : "read here";
    return `${tag} · ${subject(m)}`;
  }
  /** The detail never follows another note here: no `p`. */
  override hint() { return this.surface.hint(""); }
  override key(k: Key, desk: DeskApi): boolean {
    if (ch(k) === "p" && !this.editing && !this.holdsKeys) { desk.ctx.flash("the detail keeps its note here · 1-9 0 pick a welcome note · alt+⏎ on a link reads it here"); return true; }
    if (super.key(k, desk)) return true;
    // ⏎ with nothing picked yet acts on the note's first element (its first link, most often), as if ] came first.
    if ((k.kind === "enter" || k.kind === "alt-enter") && this.msg && !this.holdsKeys && super.key({ kind: "char", ch: "]" }, desk)) return super.key(k, desk);
    return false;
  }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const s = this.list;
    if (!this.msg && s) {
      const why = !s.items ? "asking the outline…" : s.items.length ? "" : `Nothing to read yet: tag a note [${WELCOME_KEY}::1].`;
      if (why) return { lines: [fg(C.dark) + pad(why, w) + RESET] };
    }
    return super.render(w, h, focused, desk);
  }
  override spec() { return { source: this.source }; }
}

/** What the preview's title row offers: the note it shows, read in the detail. */
const READ_HERE = " ⇱ read here ";

/**
 * The preview: what a link in the detail, or a backlink, points at. Its own links open in it. alt+⏎ with no
 * link picked, or a click on "⇱ read here" in its title row, reads the note it shows in the detail.
 */
export class WelcomePreview extends PreviewPane {
  override readonly kind: TileKindName = "welcome.preview";
  /** Where "⇱ read here" starts in the title row as last drawn (null: not drawn). */
  private readFrom: number | null = null;
  override title() { return this.msg ? `preview · ${subject(this.msg)}` : "preview"; }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    this.readFrom = null;
    if (!this.msg) return {
      lines: ["⏎ or a click on a link in the detail, or a backlink, shows it here.", "", "alt+⏎, or a ctrl- or alt-click, reads it in the detail instead."]
        .flatMap(t => (t ? wrap(t, w) : [""])).map(l => fg(C.dark) + pad(l, w) + RESET),
    };
    const v = super.render(w, h, focused, desk);
    const lw = width(READ_HERE);
    if (v.lines.length && !this.holdsKeys && w >= lw + 8) {
      this.readFrom = w - lw;
      v.lines[0] = fg(C.white) + pad(subject(this.msg), w - lw) + chip(C.magenta) + READ_HERE + RESET;
    }
    return v;
  }

  /** Read the note shown here in the detail (welcome.read, as the person). */
  private promote(desk: DeskApi) {
    const m = this.msg;
    // The welcome list's action, as the person's key (it runs in the list: this tile only asks).
    if (m) void desk.perform?.("welcome.read", { id: m.id }, USER);
  }

  override key(k: Key, desk: DeskApi): boolean {
    if (super.key(k, desk)) return true;
    if (k.kind === "alt-enter" && this.msg && !this.holdsKeys) { this.promote(desk); return true; }
    return false;
  }

  override release(x: number, y: number, desk: DeskApi, open?: (m: Msg, how?: OpenHow) => void): boolean {
    if (y === 0 && this.readFrom !== null && x >= this.readFrom) { this.promote(desk); return true; }
    return super.release(x, y, desk, open);
  }
}

/** Which note the welcome's detail reads, and the logo. The keys, the mouse and `act` call the same code. */
export const WELCOME_ACTIONS = new ActionSet<{
  "welcome.select": { n?: number; id?: string; read?: boolean };
  "welcome.read": { id: string };
  "welcome.logo": { by?: number };
  "welcome.reload": Record<string, never>;
}, KindHost>("welcome", {
  "welcome.select": {
    summary: "read a welcome note in the detail: n (its place from 1, as the tabs number them: 1-9, then 10 is the 0 key) or id; read=true also gives the detail the person's keys (never an agent's). Refused to an agent while the person is typing here",
    keys: "1-9 0, a click on a tab, j k ⏎ in the list",
    touches: "screen", replay: "safe", says: r => `put ${r.title.slice(0, 40)} in the detail${r.n ? ` (welcome ${tabKey(r.n - 1) ?? r.n})` : ""}`,
    args: {
      n: { type: "number", optional: true, about: "its place, from 1" },
      id: { type: "string", optional: true, about: "the welcome note's block id" },
      read: { type: "boolean", optional: true, about: "give the detail the keys (the person's pick)" },
    },
    run({ n, id, read }, { pane, desk }, actor) {
      const w = pane as WelcomeList;
      if ((n === undefined) === (id === undefined)) throw new ActionRefused("welcome.select takes n or id, one of them");
      const i = id !== undefined ? (w.items ?? []).findIndex(m => m.id.startsWith(id)) : n! - 1;
      if (id !== undefined && i < 0 && w.items) throw new ActionRefused(`${id} isn't a welcome note`);
      return w.pick(i, actor, desk, !!read);
    },
  },
  "welcome.read": {
    summary: "read any note in the detail (as alt+⏎ or a ctrl-click on a link does); back (alt+←) returns to the one before",
    keys: "alt+⏎, ctrl-click, alt-click on a link or a backlink",
    touches: "screen", replay: "safe", says: r => `put ${r.title.slice(0, 40)} in the detail`,
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { pane, desk }, actor) {
      const m = await desk.ctx.board.get(id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      return (pane as WelcomeList).readHere(m, actor, desk);
    },
  },
  "welcome.logo": {
    summary: "draw the next ep0ch logo (by=-1: the one before) in the band",
    keys: "L, a click on the logo",
    touches: "screen", replay: "safe", says: () => "changed the logo",
    args: { by: { type: "number", optional: true, about: "1 (the default) or -1" } },
    run({ by }, { pane, desk }) { return (pane as WelcomeList).nextLogo(by ?? 1, desk); },
  },
  "welcome.reload": {
    summary: "ask the outline again which notes are welcome notes (it also does when the outline changes)",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { pane, desk }) { const w = pane as WelcomeList; await w.load(desk); return { welcome: w.items?.length ?? 0 }; },
  },
});

/** The welcome's kinds: the list (its model, actions and band), its detail and its preview. */
export function welcomeKinds(): TileKind[] {
  const detail = tileKind("detail")!, preview = tileKind("preview")!;
  return [
    {
      kind: "welcome.list", word: "list", about: "the welcome notes ([welcome::1]…) and the band with their tabs", noun: "the welcome list",
      make: () => new WelcomeList(), actions: WELCOME_ACTIONS,
      start: (p, env) => void (p as WelcomeList).load(env.desk, true),
      band: {
        rows: (p, cols, rows) => (p as WelcomeList).bandRows(cols, rows),
        draw: (p, canvas, r, desk) => (p as WelcomeList).drawBand(canvas, r, desk),
        press: (p, x, y, desk) => (p as WelcomeList).pressBand(x, y, desk),
      },
      peek: (p, desk) => (p as WelcomeList).describe(desk),
    },
    {
      ...detail, kind: "welcome.detail", word: "detail", about: "the welcome note read (its source: the welcome list)", keys: undefined,
      make: s => { const src = s.source && sourceOf(s.source); return new WelcomeDetail(src && "tile" in src ? s.source! : "tile:welcome"); },
      start: (p, env) => {
        const d = p as WelcomeDetail, src = sourceOf(d.source), list = src && "tile" in src ? env.tile(src.tile) : undefined;
        if (list instanceof WelcomeList) { d.list = list; list.detail = d; }
      },
    },
    {
      ...preview, kind: "welcome.preview", word: "preview", about: "what a link in the welcome's detail, or a backlink, points at", keys: undefined,
      make: s => new WelcomePreview((s.source && sourceOf(s.source)) || { tile: "backlinks" }),
    },
  ];
}

/**
 * The welcome screen: the list, the detail with its backlinks under it, the preview the whole height, in reading
 * order (Tab goes list → detail → backlinks → preview). The digits pick welcome notes, so tiles aren't numbered.
 * The list is about 30 columns (narrower on a small terminal), the detail a little wider than the preview, the
 * backlinks about a third of the height: as policy, so a person's arrangement inside it is theirs.
 */
export function welcomeSpec(): ScreenSpec {
  const digits = [..."1234567890"].map((d, i) => ({ key: d, action: "welcome.select", args: { n: i + 1, read: true } }));
  return {
    name: "welcome", title: "welcome", frame: "dotted", digits: false, band: "welcome", lands: "preview", fresh: "welcome.read",
    keys: [...digits, { key: "L", action: "welcome.logo", unless: ["tree"] }],
    hint: "|15 1-9 0|08 notes · |15⏎|08 → preview · |15alt+⏎|08 read here · |15alt+←|08 back · |15Tab|08 tiles · |15L|08 logo · |15q|08 menu",
    layout: {
      focus: "detail",
      root: {
        t: "split", dir: "row", weights: [0.24, 0.4332, 0.3268], kids: [
          { t: "tabs", tabs: [{ t: "leaf", kind: "welcome.list", name: "welcome" }], active: 0, policy: { max: 30 } },
          {
            t: "split", dir: "col", weights: [0.7, 0.3], kids: [
              { t: "leaf", kind: "welcome.detail", name: "detail", source: "tile:welcome", link: "preview" },
              { t: "tabs", tabs: [{ t: "leaf", kind: "backlinks", name: "backlinks", source: "tile:detail", groups: "open" }], active: 0, policy: { min: 7, max: 12 } },
            ],
          },
          // Its own links open in it: its link is itself.
          { t: "leaf", kind: "welcome.preview", name: "preview", source: "tile:backlinks", link: "preview" },
        ],
      },
    },
  };
}
