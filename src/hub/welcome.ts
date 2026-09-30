// Welcome: the notes with a block-scoped `welcome` property, one at a time. The first ([welcome::1], then
// [welcome::2]…; any other value comes after the numbered ones, by title) is the detail when the screen
// opens. A band across the top holds an ep0ch logo from the WoE packs and a tab per note: 1…9, then 0 for the
// tenth, and "… n more" beyond that (the list down the side shows them all). A link followed in the detail
// (⏎ or a click) opens in the preview beside it; alt+⏎ or a ctrl- or alt-click reads it in the detail instead
// (the door's "open fresh" chord, here: make it the thing read). The detail's backlinks run under it
// and show in the same preview. It is a constrained surface on purpose: one note read, one preview.
//
// Built on the desk (a preset, as the brief and Waiting are): the tiles, their frames, the reader's sessions,
// the mouse, `act` and `peek` are the desk's; the detail is a DetailPane, the preview a PreviewPane following
// the backlinks tile (src/desk/backlinks-pane.ts), which lists the detail's backlinks. This file adds which
// notes are welcome notes, the band, and the actions that pick them (WELCOME_ACTIONS).
//
// With no welcome note on the outline, the detail shows the [[claude-now]] page (the page the menu's C used to
// pin) and the list says how to tag one.
import { basename } from "node:path";
import type { Ctx } from "../app";
import type { Art, Cell } from "../ansi";
import { artBlock } from "../art-view";
import { subject, type Msg } from "../board";
import { DOTTED_BOX, type Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import { artNamed } from "../packs";
import { AGENT_ACTOR_ID, USER, type Actor, type OutlineEvent, type SocketBoard } from "../socket";
import { artLines, bg, C, fg, pad, paint, RESET, width } from "../style";
import type { Key } from "../term";
import { bbsDate, wrap } from "../text";
import { ActionRefused, ActionSet, agentLabel, type ActRequest } from "../surface/actions";
import type { OpenHow } from "../surface/note";
import { BacklinksPane } from "../desk/backlinks-pane";
import { Desk } from "../desk/desk";
import type { LNode } from "../desk/layout";
import type { DeskApi, Pane, PaneView } from "../desk/panes";
import { PreviewPane } from "../desk/preview";
import { DetailPane } from "../desk/tiles";

export const WELCOME_KEY = "welcome";
const WELCOME_LIMIT = 200;
/** The page shown while no note is a welcome note. */
export const WELCOME_FALLBACK = "claude-now";

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

const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");
type ListRow = { i: number } | { more: number };

/** The welcome notes down the side: each with its digit, the one in the detail lit; past the tenth, "more". */
export class WelcomeList implements Pane {
  readonly kind = "exhibit";
  screen: Welcome | null = null;
  private top = 0;
  private rows: ListRow[] = [];
  title() {
    const items = this.screen?.items;
    return !items ? "asking the outline…" : items.length ? `${items.length} note${items.length === 1 ? "" : "s"}` : "none tagged yet";
  }
  hint() { return "j k pick · ⏎ read"; }

  render(w: number, h: number, focused: boolean): PaneView {
    const s = this.screen;
    if (!s) return { lines: [] };
    if (s.problem) return { lines: [fg(C.lred) + pad(s.problem, w) + RESET] };
    if (!s.items) return { lines: [fg(C.dark) + "asking the outline…" + RESET] };
    if (!s.items.length) return {
      lines: [
        ...wrap("No note is a welcome note yet.", w).map(l => fg(C.white) + pad(l, w) + RESET), "",
        ...[`Tag one [${WELCOME_KEY}::1] (then 2, 3…; any value counts) and it opens here, first.`, "",
          s.fallback ? `Meanwhile the detail shows [[${WELCOME_FALLBACK}]].` : `No [[${WELCOME_FALLBACK}]] page either.`]
          .flatMap(t => (t ? wrap(t, w) : [""])).map(l => fg(C.grey) + pad(l, w) + RESET),
      ],
    };
    this.rows = s.items.flatMap((_, i): ListRow[] => (i === 10 ? [{ more: s.items!.length - 10 }, { i }] : [{ i }]));
    const sel = this.rows.findIndex(r => "i" in r && r.i === s.at);
    if (sel >= 0 && sel < this.top) this.top = sel;
    if (sel >= this.top + h) this.top = sel - h + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - h)));
    return {
      lines: this.rows.slice(this.top, this.top + h).map(r => {
        if ("more" in r) return fg(C.dark) + pad(`  … ${r.more} more`, w) + RESET;
        const m = s.items![r.i]!, key = tabKey(r.i) ?? " ";
        if (r.i === s.at) return (focused ? bg(C.blue) : bg(C.magenta)) + fg(C.white) + pad(` ${key} ${subject(m)}`, w) + RESET;
        return pad(` ${fg(C.white)}${key} ${fg(C.lmagenta)}${subject(m)}`, w) + RESET;
      }),
    };
  }

  private run(desk: DeskApi, n: number, read = false) {
    const s = this.screen;
    if (!s) return;
    Promise.resolve().then(() => WELCOME_ACTIONS.runUntyped("welcome.select", { n, ...(read ? { read: true } : {}) }, s, USER))
      .catch(e => desk.ctx.flash(e instanceof Error ? e.message : String(e)))
      .finally(() => desk.redraw());
  }

  key(k: Key, desk: DeskApi): boolean {
    const s = this.screen, n = s?.items?.length ?? 0;
    if (!s || !n) return false;
    const at = Math.max(0, s.at);
    if (k.kind === "down" || ch(k) === "j") { if (at + 1 < n) this.run(desk, at + 2); return true; }
    if (k.kind === "up" || ch(k) === "k") { if (at > 0) this.run(desk, at); return true; }
    if (k.kind === "home") { this.run(desk, 1); return true; }
    if (k.kind === "end") { this.run(desk, n); return true; }
    if (k.kind === "enter") { this.run(desk, at + 1, true); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const r = this.rows[this.top + y];
    if (r && "i" in r) this.run(desk, r.i + 1);
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const s = this.screen, n = s?.items?.length ?? 0, to = (s?.at ?? 0) + dir;
    if (to >= 0 && to < n) this.run(desk, to + 1);
  }
}

/** The detail: the welcome note read, or what alt+⏎ made the thing read. */
export class WelcomeDetail extends DetailPane {
  screen: Welcome | null = null;
  override title() {
    const s = this.screen, m = this.msg;
    if (!s || !m) return s?.items && !s.items.length && !s.fallback ? "nothing to read yet" : "detail";
    const i = s.items?.findIndex(x => x.id === m.id) ?? -1;
    const tag = i >= 0 ? `welcome ${tabKey(i) ?? i + 1}` : s.fallback?.id === m.id ? `[[${WELCOME_FALLBACK}]] · no welcome notes yet` : "read here";
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
    const s = this.screen;
    if (!this.msg && s) {
      const why = !s.items ? "asking the outline…" : s.items.length ? "" : `Nothing to read yet: tag a note [${WELCOME_KEY}::1].`;
      if (why) return { lines: [fg(C.dark) + pad(why, w) + RESET] };
    }
    return super.render(w, h, focused, desk);
  }
}

/** What the preview's title row offers: the note it shows, read in the detail. */
const READ_HERE = " ⇱ read here ";

/**
 * The preview: what a link in the detail, or a backlink, points at. Its own links open in it. alt+⏎ with no
 * link picked, or a click on "⇱ read here" in its title row, reads the note it shows in the detail.
 */
export class WelcomePreview extends PreviewPane {
  screen: Welcome | null = null;
  /** Where "⇱ read here" starts in the title row as last drawn (null: not drawn). */
  private readFrom: number | null = null;
  constructor() { super({ tile: "backlinks" }); }
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
      v.lines[0] = fg(C.white) + pad(subject(this.msg), w - lw) + bg(C.magenta) + fg(C.white) + READ_HERE + RESET;
    }
    return v;
  }

  /** Read the note shown here in the detail (welcome.read, as the person). */
  private promote(desk: DeskApi) {
    const s = this.screen, m = this.msg;
    if (!s || !m) return;
    Promise.resolve().then(() => WELCOME_ACTIONS.runUntyped("welcome.read", { id: m.id }, s, USER))
      .catch(e => desk.ctx.flash(e instanceof Error ? e.message : String(e)))
      .finally(() => desk.redraw());
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

/** Changes that never make a note a welcome note or stop it being one. */
const QUIET = new Set(["annotate", "reorder", "move", "draft"]);

// ── the screen ──────────────────────────────────────────────────────────────────────────────────────────

/** What `welcome.select` and `welcome.read` answer. */
export type Shown = { id: string; title: string; welcome: string | null; n: number | null; of: number };
/** A click target in the band: rows `y0`..`y1`, columns `from`..`to`. */
type TabHit = { y0: number; y1: number; from: number; to: number } & ({ i: number } | { more: true } | { logo: true });

export class Welcome extends Desk {
  readonly list: WelcomeList;
  readonly detail: WelcomeDetail;
  readonly preview: WelcomePreview;
  readonly backlinks: BacklinksPane;
  /** The welcome notes, in order; null until read. */
  items: Msg[] | null = null;
  /** The place of the welcome note the detail shows, or -1 (another note, alt+⏎'s, or nothing). */
  get at(): number { const id = this.detail.msg?.id; return id ? (this.items ?? []).findIndex(m => m.id === id) : -1; }
  /** The [[claude-now]] page while there are no welcome notes (null when there's none either). */
  fallback: Msg | null = null;
  problem = "";
  /** Which logo the band draws (LOGOS), by place: the dotted SHY-EPO! first; `L` or a click on it for the next. */
  logo = 0;
  private reload: Timer | null = null;
  private tabs: TabHit[] = [];
  private band = 0;
  private sizedFor = "";

  constructor() {
    const list = new WelcomeList(), detail = new WelcomeDetail(), preview = new WelcomePreview(), backlinks = new BacklinksPane("detail", true);
    super({
      title: "welcome", panes: [list, detail, backlinks, preview], names: ["welcome", "detail", "backlinks", "preview"],
      // The detail's opens land in the preview; the preview follows the backlinks' selection. The digits pick
      // welcome notes here, so the tiles aren't numbered.
      links: [[1, 3]], focus: 1, frame: DOTTED_BOX, digits: false,
      // The list, the detail with its backlinks under it, the preview the whole height: in reading order,
      // so Tab goes list → detail → backlinks → preview, as it follows reading order on the desk.
      layout: ([l, d, b, p]): LNode => ({
        t: "split", dir: "row", weights: [0.16, 0.48, 0.36], kids: [
          { t: "leaf", id: l! },
          { t: "split", dir: "col", weights: [0.75, 0.25], kids: [{ t: "leaf", id: d! }, { t: "leaf", id: b! }] },
          { t: "leaf", id: p! },
        ],
      }),
    });
    this.list = list; this.detail = detail; this.preview = preview; this.backlinks = backlinks;
    list.screen = this; detail.screen = this; preview.screen = this;
  }

  override enter(ctx: Ctx) {
    super.enter(ctx);
    void this.load(true);
  }

  /** Read the welcome notes again. The detail keeps what it shows unless that was the first read or the fallback. */
  async load(first = false) {
    try {
      this.items = await findWelcome(this.ctx.board);
      this.problem = "";
    } catch (e) {
      this.problem = `couldn't ask the outline for welcome notes: ${e instanceof Error ? e.message : String(e)}`;
    }
    const items = this.items ?? [];
    const shown = this.detail.msg;
    const keep = shown && !first && shown.id !== this.fallback?.id && !this.detail.holdsKeys;
    if (items.length) {
      this.fallback = null;
      if ((!keep || !shown) && !this.detail.holdsKeys && !this.detail.editing) this.detail.hold(items[0]!, this);
    } else if (!this.problem) {
      try {
        const r = await this.ctx.board.resolvePage(WELCOME_FALLBACK);
        this.fallback = r.status === "resolved" && r.block ? r.block : null;
      } catch { this.fallback = null; }
      if (this.fallback && (!shown || shown.id === this.fallback.id || first) && !this.detail.holdsKeys && !this.detail.editing) this.detail.hold(this.fallback, this);
    }
    this.redraw();
  }

  /**
   * Show the welcome note at place `i` (from 0) in the detail, as `actor`. The person's pick by digit, tab or
   * ⏎ in the list gives the detail the keys (`read`); an agent's never moves them, and waits while they type.
   */
  select(i: number, actor: Actor, read = false): Shown {
    const items = this.items;
    if (!items) throw new ActionRefused("the welcome notes are still being read");
    if (!items.length) throw new ActionRefused(`no note is a welcome note yet; tag one [${WELCOME_KEY}::1]`);
    if (i < 0 || i >= items.length) throw new ActionRefused(`pick 1 to ${items.length}`);
    return this.readHere(items[i]!, actor, read);
  }

  /** Make `m` the note read in the detail (a welcome pick, alt+⏎ on a link, `welcome.read`); back returns to the one before. */
  readHere(m: Msg, actor: Actor, focus = true): Shown {
    if (actor.kind === "agent" && this.personTyping()) throw new ActionRefused("the person is typing here; the detail stays");
    if (this.detail.holdsKeys || this.detail.editing) throw new ActionRefused("the detail holds an edit or a comment; save or close it first");
    // Another note read by the person: what the preview showed came from the one before (its link, its
    // backlink), so it empties rather than show something the detail no longer points at. An agent's leaves
    // what the person may be reading there. Either way the preview never repeats the note read.
    const other = this.detail.msg?.id !== m.id;
    if (other) this.detail.surface.track(() => this.detail.hold(m, this));
    if (this.preview.msg?.id === m.id || (other && actor.kind !== "agent")) this.preview.show(null, this);
    if (focus && actor.kind !== "agent" && !this.personTyping()) this.focusTile("detail", actor);
    const items = this.items ?? [], i = items.findIndex(x => x.id === m.id);
    const s: Shown = { id: m.id, title: subject(m), welcome: m.props[WELCOME_KEY] ?? null, n: i >= 0 ? i + 1 : null, of: items.length };
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} put ${s.title.slice(0, 40)} in the detail${s.n ? ` (welcome ${tabKey(s.n - 1) ?? s.n})` : ""}`);
    this.redraw();
    return s;
  }

  nextLogo(by: number, actor: Actor) {
    const step = by < 0 ? -1 : 1;
    this.logo = (this.logo + step + LOGOS.length) % LOGOS.length;
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} changed the logo`);
    this.redraw();
    return { logo: LOGOS[this.logo]!.file, drawn: !!artNamed(LOGOS[this.logo]!.file) };
  }

  /**
   * Where opens go on this screen. alt+⏎ (or a ctrl- or alt-click) on a link in the detail, the preview or a
   * backlink reads it in the detail. The preview's own links open in the preview. The rest is the desk's: the
   * detail's opens land in the preview (its link), and the preview follows the backlinks' selection.
   */
  override setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    const actor: Actor = opts.agent ? { kind: "agent", id: AGENT_ACTOR_ID } : USER;
    const here = opts.from === this.detail || opts.from === this.preview || opts.from === this.backlinks;
    if (m && opts.fresh && here) {
      try { this.readHere(m, actor); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e)); }
      return;
    }
    if (m && opts.from === this.preview) {
      if (this.preview.msg?.id !== m.id) this.preview.surface.track(() => this.preview.follow(m, this));
      return this.redraw();
    }
    super.setCurrent(m, opts);
  }

  /** `ep0ch open <id>` (an agent's): the note shows in the preview; the detail and the person's keys stay. */
  override openBlock(m: Msg) {
    if (this.preview.msg?.id !== m.id) this.preview.surface.track(() => this.preview.follow(m, this));
    this.redraw();
  }

  override onEvent(e: OutlineEvent) {
    super.onEvent(e);
    // A note tagged, untagged, renamed, trashed or restored anywhere: the list is asked again (once per burst).
    // Without a change record (a service with no feed, a reset) it could be anything, so it's asked too. A
    // comment, a lane's order, a move or a draft doesn't change which notes carry the property, or their titles.
    if (e.change && QUIET.has(e.change.kind)) return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(); }, 300);
  }

  override dispose() {
    if (this.reload) clearTimeout(this.reload);
    return super.dispose();
  }

  // ── the band: the logo, and a tab per welcome note ─────────────────────────────────────────────────────

  /** The logo as it's drawn at this size: whole, its densest rows, or none. Reading comes first: the tiles keep 24 rows. */
  private logoFor(rows: number): { rows: Cell[][]; width: number } | null {
    const art = artNamed(LOGOS[this.logo]!.file);
    if (!art) return null;
    const cells = logoCells(art, LOGOS[this.logo]!);
    const room = rows - 2 - 1 - 24;
    if (!cells.rows.length || room < 6) return null;
    return cells.rows.length <= room ? cells : { rows: densest(cells.rows, Math.min(room, 8)), width: cells.width };
  }

  protected override bandRows(cols: number, rows: number): number {
    this.fit(cols, rows);
    const logo = this.logoFor(rows);
    return (this.band = logo ? logo.rows.length + 1 : 1);
  }

  /**
   * The list is about 30 columns (narrower on a small terminal), the detail a little wider than the preview,
   * the backlinks about a fifth of the height; set once per size, and only while the tiles are where the
   * screen put them (a person who moved them keeps their arrangement).
   */
  private fit(cols: number, rows: number) {
    const size = `${cols}x${rows}`;
    const root = this.root, mid = root.t === "split" ? root.kids[1] : undefined;
    if (size === this.sizedFor || root.t !== "split" || root.kids.length !== 3 || mid?.t !== "split" || mid.kids.length !== 2) return;
    this.sizedFor = size;
    const list = Math.max(0.12, Math.min(0.24, 30 / cols));
    root.weights = [list, (1 - list) * 0.57, (1 - list) * 0.43];
    const area = Math.max(10, rows - 2 - (this.logoFor(rows)?.rows.length ?? 1) - 1);
    const b = Math.max(7, Math.min(12, Math.round(area * 0.3))) / area;
    mid.weights = [1 - b, b];
  }

  protected override drawBand(canvas: Canvas, r: Rect): Placement[] {
    this.tabs = [];
    const logo = this.logoFor(this.ctx.t.rows);
    let placements: Placement[] = [];
    if (logo) {
      const info = this.info();
      const infoW = Math.max(...info.map(l => width(paint(l))));
      const gap = 4, withInfo = r.cols >= logo.width + gap + infoW + 4;
      const total = logo.width + (withInfo ? gap + infoW : 0);
      const x0 = Math.max(0, Math.floor((r.cols - total) / 2));
      const b = artBlock(logo.rows, logo.width, this.ctx.t, { key: `welcome-logo-${this.logo}`, at: { col: x0, row: r.row }, maxRows: logo.rows.length, fit: "grid", graphics: this.ctx.graphics });
      if (this.ctx.graphics) placements = b.placements;
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

  /** The words beside the logo: real counts only. */
  private info(): string[] {
    const n = this.items?.length;
    return [
      "|15e p 0 c h |08· |11welcome",
      `|07node 1${this.ctx.outline ?? this.ctx.workspace ? ` |08· |03${this.ctx.outline ?? basename(this.ctx.workspace)}` : ""}`,
      n === undefined ? "|08asking the outline…" : n ? `|07${n} |08welcome note${n === 1 ? "" : "s"} · |151-9 0|08 pick` : `|08no notes tagged [${WELCOME_KEY}::] yet`,
      `|08last call ${this.ctx.lastCall ? bbsDate(this.ctx.lastCall) : "never"}`,
    ];
  }

  /**
   * The tabs, in the logos' own voice: `[= 1 Start here = 2 House rules = … 3 more =====]`. The one in the
   * detail is lit; each is a click target, the logo too (the next logo).
   */
  private drawTabs(canvas: Canvas, row: number, cols: number, named: boolean) {
    const rail = fg(C.blue), items = this.items ?? [];
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
      const on = i === this.at;
      const t = subject(m);
      const label = t.length > titleW ? t.slice(0, titleW - 1) + "…" : t;
      put(" ", "");
      put(`${tabKey(i)} ${label}`, on ? bg(C.magenta) + fg(C.white) : fg(C.lmagenta), { i });
      put(" =", rail);
    });
    if (more) { put(" ", ""); put(`… ${more} more`, fg(C.lcyan), { more: true }); put(" =", rail); }
    if (!items.length) put(this.items ? ` no welcome notes yet · showing [[${WELCOME_FALLBACK}]] ` : " asking the outline… ", fg(C.dark)), put("=", rail);
    put("=".repeat(Math.max(0, cols - 1 - x)), rail);
    put("]", rail, undefined, cols);
    canvas.text(0, row, s, cols);
    // Each unlit tab's digit bright, as the menu's hot keys are.
    for (const t of this.tabs) if ("i" in t && t.i !== this.at) canvas.text(t.from, row, fg(C.white) + tabKey(t.i)! + RESET, 1);
  }

  protected override screenHint(): string {
    return `|15 1-9 0|08 notes · |15⏎|08 → preview · |15alt+⏎|08 read here · |15alt+←|08 back · |15Tab|08 panes · |15L|08 logo · |15q|08 menu`;
  }

  override key(k: Key, ctx: Ctx) {
    // The band: a tab reads its note, "… more" goes to the list, the logo is the next logo.
    // Only presses: a release or drag over it is the desk's, so a border or tile drag still ends.
    if (k.kind === "mouse" && k.y < this.band && k.action === "down") {
      const t = this.tabs.find(h => k.y >= h.y0 && k.y <= h.y1 && k.x >= h.from && k.x < h.to);
      if (t && "i" in t) this.runWelcome({ action: "welcome.select", args: { n: t.i + 1 } });
      else if (t && "more" in t) { this.focusTile("welcome", USER); this.redraw(); }
      else if (t && "logo" in t) this.runWelcome({ action: "welcome.logo" });
      return;
    }
    const c = ch(k);
    if (!this.personTyping() && !this.picking() && !this.linkingNow()) {
      if (/^[0-9]$/.test(c)) return this.runWelcome({ action: "welcome.select", args: { n: placeOfKey(c) + 1 } });
      if (c === "L") return this.runWelcome({ action: "welcome.logo" });
    }
    super.key(k, ctx);
  }

  /** A reader's step choice is open (its keys are its own). */
  private picking() { return !!this.detail.surface.choosing || !!this.preview.surface.choosing; }

  /** Run a welcome action as the person, saying a refusal on screen. */
  private runWelcome(req: ActRequest) {
    Promise.resolve().then(() => WELCOME_ACTIONS.runUntyped(req.action, { ...(req.args ?? {}), ...(req.action === "welcome.select" ? { read: true } : {}) }, this, USER))
      .catch(e => this.ctx.flash(e instanceof Error ? e.message : String(e)))
      .finally(() => this.redraw());
  }

  override describe() {
    const items = this.items;
    return {
      ...super.describe(), kind: "welcome",
      welcome: items ? items.map((m, i) => ({ n: i + 1, key: tabKey(i), id: m.id, title: subject(m), value: m.props[WELCOME_KEY] ?? "" })) : null,
      shown: this.at >= 0 ? this.at + 1 : null,
      detail: this.detail.msg ? { id: this.detail.msg.id, title: subject(this.detail.msg) } : null,
      preview: this.preview.msg ? { id: this.preview.msg.id, title: subject(this.preview.msg) } : null,
      fallback: items && !items.length ? (this.fallback ? { page: WELCOME_FALLBACK, id: this.fallback.id } : { page: WELCOME_FALLBACK, id: null }) : undefined,
      logo: LOGOS[this.logo]!.file,
      problem: this.problem || undefined,
    };
  }

  override actions() {
    const d = super.actions();
    return { ...d, actions: [...WELCOME_ACTIONS.list(), ...d.actions] };
  }

  override async act(req: ActRequest, actor: Actor): Promise<unknown> {
    if (WELCOME_ACTIONS.has(req.action)) return WELCOME_ACTIONS.runUntyped(req.action, { ...(req.args ?? {}) }, this, actor);
    return super.act(req, actor);
  }
}

/** Which note the welcome's detail reads, and the logo. The keys, the mouse and `act` call the same code. */
export const WELCOME_ACTIONS = new ActionSet<{
  "welcome.select": { n?: number; id?: string; read?: boolean };
  "welcome.read": { id: string };
  "welcome.logo": { by?: number };
  "welcome.reload": Record<string, never>;
}, Welcome>("welcome", {
  "welcome.select": {
    summary: "read a welcome note in the detail: n (its place from 1, as the tabs number them: 1-9, then 10 is the 0 key) or id; read=true also gives the detail the person's keys (never an agent's). Refused to an agent while the person is typing here",
    keys: "1-9 0, a click on a tab, j k ⏎ in the list",
    args: {
      n: { type: "number", optional: true, about: "its place, from 1" },
      id: { type: "string", optional: true, about: "the welcome note's block id" },
      read: { type: "boolean", optional: true, about: "give the detail the keys (the person's pick)" },
    },
    run({ n, id, read }, w, actor) {
      if ((n === undefined) === (id === undefined)) throw new ActionRefused("welcome.select takes n or id, one of them");
      const i = id !== undefined ? (w.items ?? []).findIndex(m => m.id.startsWith(id)) : n! - 1;
      if (id !== undefined && i < 0 && w.items) throw new ActionRefused(`${id} isn't a welcome note`);
      return w.select(i, actor, !!read);
    },
  },
  "welcome.read": {
    summary: "read any note in the detail (as alt+⏎ or a ctrl-click on a link does); back (alt+←) returns to the one before",
    keys: "alt+⏎, ctrl-click, alt-click on a link or a backlink",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, w, actor) {
      const m = await w.ctx.board.get(id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      return w.readHere(m, actor);
    },
  },
  "welcome.logo": {
    summary: "draw the next ep0ch logo (by=-1: the one before) in the band",
    keys: "L, a click on the logo",
    args: { by: { type: "number", optional: true, about: "1 (the default) or -1" } },
    run({ by }, w, actor) { return w.nextLogo(by ?? 1, actor); },
  },
  "welcome.reload": {
    summary: "ask the outline again which notes are welcome notes (it also does when the outline changes)",
    args: {},
    async run(_, w) { await w.load(); return { welcome: w.items?.length ?? 0 }; },
  },
});
