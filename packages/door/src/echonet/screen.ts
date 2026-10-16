// EchoNet's message areas (PIE-779): a classic BBS message base over echomail. The areas of every outline this door
// can reach on its host (each named view or tag that starts there, and each subscription's source boards), an area's messages, the message itself
// with its FidoNet footer, and the nodelist, under a band in the ep0ch BBS's own letters.
//
// A screen spec on the desk (`echonetSpec`), its tiles four kinds of its own: the area list (`echo.areas`, the
// screen's model: the areas, the boards they're read on, the nodelists, and the band), the message list
// (`echo.messages`), the reader (`echo.reader`, a ReaderPane: the one NoteSurface, with the message's header and
// footer through SurfaceHost and its outline's board through its host's ctx) and the nodelist (`echo.nodelist`). Every
// key, click and `act` runs one of their actions. Every list is a query the service answers (src/echonet/net.ts).
import { basename } from "node:path";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import type { Ctx } from "../app";
import { subject, type Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import type { Placement } from "../kitty";
import { artNamed } from "../packs";
import { RowView, wheelRows, type RowPress } from "../scroll";
import { authorName, hostRequest, SocketBoard, USER, type Actor, type OutlineEvent } from "../socket";
import { C, fg, pad, paint, RESET, selected, width } from "../style";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { HeaderInfo, OpenHow, SurfaceHost } from "../surface/note";
import { ch, isDown, isUp, type Key } from "../term";
import { ago, bbsDate } from "../text";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import { tileKind, type KindHost, type TileKind, type TileKindName } from "../desk/tile-kinds";
import { densest, drawLogo, logoCells } from "../hub/welcome";
import {
  areasIn, footerOf, fromOf, headerOf, inArrivalOrder, isMessage, messageFrom, nodelistLines, NODELIST_QUERY, nodeName, nodesOf, postsTo, seenByMarks, SOURCES_QUERY,
  SUBSCRIPTIONS_QUERY, TAGGED_QUERY, tossesQuery, tossOf, unreadOf, arrived,
  type Area, type Message, type NodeEntry, type TossLog,
} from "./net";

/** How many outlines on the host it reads areas from (the door's own first). */
const MAX_OUTLINES = 24;
/** How many messages an area lists. */
const MESSAGE_LIMIT = 1000;

/**
 * An area's messages on its board, each once: its queries' answers and, for a local area, the notes tagged with its
 * name (asked as `echo`, filtered here: a tag's value can be a list). `unread`: only the ones new to the person.
 */
async function messagesOf(b: SocketBoard, a: Area, unread = false): Promise<Msg[]> {
  const ask = (q: string) => b.queryNotes(unread ? unreadOf(q) : q, MESSAGE_LIMIT).then(r => r.notes);
  const found = await Promise.all([...a.queries.map(ask), ...(a.tagged ? [ask(TAGGED_QUERY).then(ms => ms.filter(m => postsTo(m, a.tagged!)))] : [])]);
  const out = new Map<string, Msg>();
  for (const m of found.flat()) if (!out.has(m.id) && !m.deleted && (a.kind === "sub" ? !!fromOf(m) : isMessage(m))) out.set(m.id, m);
  return [...out.values()];
}

// ── the band: EchoNet in the BBS's letters, beside the ep0ch logo where there's room ─────────────────────────

const LETTERS: Record<string, readonly [string, string, string]> = {
  E: ["█▀▀", "█▀ ", "▀▀▀"], C: ["█▀▀", "█  ", "▀▀▀"], H: ["█ █", "█▀█", "▀ ▀"], O: ["█▀█", "█ █", "▀▀▀"], N: ["█▀▄", "█ █", "▀ ▀"], T: ["▀█▀", " █ ", " ▀ "],
};
/** A word in three rows of half blocks, lit from the top: white, light cyan, blue. */
export function banner(word: string): string[] {
  const shades = ["|15", "|11", "|09"];
  return [0, 1, 2].map(r => shades[r] + [...word.toUpperCase()].map(c => LETTERS[c]?.[r] ?? "   ").join(" "));
}
const LOGO = { file: "SHY-EP0C.ANS", rows: [0, 10] as [number, number] };

// ── reaching the other outlines ──────────────────────────────────────────────────────────────────────────────

/** A ctx whose board (and outline) is another outline's: the reader reads, comments and re-reads there. Kept per board. */
const ctxs = new WeakMap<SocketBoard, { of: Ctx; ctx: Ctx }>();
function ctxOn(ctx: Ctx, board: SocketBoard, outline: string): Ctx {
  if (ctx.board === board) return ctx;
  const had = ctxs.get(board);
  if (had?.of === ctx) return had.ctx;
  const made = new Proxy(ctx, {
    get(t, p) {
      if (p === "board") return board;
      if (p === "outline") return outline;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  ctxs.set(board, { of: ctx, ctx: made });
  return made;
}

/** The door's own outline by name: the host's name for it, else its folder's. */
const ownName = (ctx: Ctx) => ctx.outline ?? (basename(ctx.workspace ?? "") || "here");

/** A nodelist as read: where it's kept, its title, its nodes, its last tosses (newest first). */
export interface Nodelist { node: string; title: string; nodes: NodeEntry[]; tosses: TossLog[] }
/** How many toss logs the nodelist shows. */
const TOSSES_SHOWN = 5;

// ── the area list, and the screen's model ──────────────────────────────────────────────────────────────────

/**
 * The message areas of every outline this door reaches: what `M` listed on a Renegade board. It is the screen's model:
 * the areas (read again as any of those outlines changes), the board each is read on, the nodelists, and the band.
 */
export class EchoAreas implements Pane {
  readonly kind: TileKindName = "echo.areas";
  areas: Area[] | null = null;
  nodelists: Nodelist[] = [];
  problem = "";
  /** The area picked (its messages are listed beside), by its place, or -1. */
  at = -1;
  messages: EchoMessages | null = null;
  reader: EchoReader | null = null;
  machine = "";
  /** The door's own outline, as the areas name where they're read. */
  own = "";
  private view = new RowView();
  /** The other outlines' boards, by name; the door's own is its ctx's. */
  private boards = new Map<string, SocketBoard>();
  private reload: Timer | null = null;
  private desk: DeskApi | null = null;
  private loading: Promise<void> | null = null;
  /** A change came in while it was reading: it reads again once that read is done. */
  private again = false;
  private disposed = false;

  title() {
    if (!this.areas) return "message areas · dialing…";
    const fresh = this.areas.reduce((n, a) => n + (a.fresh ?? 0), 0);
    return `message areas · ${this.areas.length}${fresh ? ` · ${fresh} new` : ""}`;
  }
  hint() { return "j k area · ⏎ its messages · r reload"; }
  init(desk: DeskApi) { this.desk = desk; }

  /** The board an area is read on, and a ctx on it for the reader. */
  boardOf(a: Area): SocketBoard { return this.boards.get(a.outline) ?? this.desk!.ctx.board; }
  /** The board of a node on this door's host (`outline@machine`), or null: another machine's, or one it doesn't read. */
  boardOfNode(node: string): SocketBoard | null {
    const [outline, machine] = node.split("@");
    if (!outline || machine !== this.machine || !this.desk) return null;
    return outline === this.own ? this.desk.ctx.board : this.boards.get(outline) ?? null;
  }
  ctxOf(a: Area, desk: DeskApi): Ctx { return ctxOn(desk.ctx, this.boardOf(a), a.outline); }

  /** The outlines on the door's host, its own first; a door on a single-outline service has only its own. */
  private async reach(desk: DeskApi): Promise<{ outline: string; board: SocketBoard }[]> {
    const ctx = desk.ctx, own = ctx.outline;
    this.own = ownName(ctx);
    const out = [{ outline: this.own, board: ctx.board }];
    if (!own) return out;
    let names: string[] = [];
    try { names = (await hostRequest<{ outlines: { name: string; archived?: boolean }[] }>(ctx.board.path, "outlines.list", {}, 4000)).outlines.filter(o => !o.archived).map(o => o.name); } catch { return out; }
    const wanted = names.filter(n => n !== own).slice(0, MAX_OUTLINES - 1);
    // An outline the host no longer serves (archived, deleted) lets its board go.
    for (const [name, b] of this.boards) if (!wanted.includes(name)) { b.close(); this.boards.delete(name); }
    for (const name of wanted) {
      let b = this.boards.get(name);
      if (!b) {
        b = new SocketBoard(ctx.board.path, 8000, name);
        try { await b.info(); } catch { b.close(); continue; }
        if (this.disposed) { b.close(); return out; }
        this.boards.set(name, b);
        // Another outline's change counts its areas again, and reads its message again when it's the one shown.
        b.subscribe(e => this.changed(e, name));
      }
      out.push({ outline: name, board: b });
    }
    return out;
  }

  /** Read every outline's areas and nodelists, and count each area's messages; the area picked stays picked. */
  load(desk: DeskApi): Promise<void> {
    this.desk = desk;
    if (this.loading) { this.again = true; return this.loading; }
    return (this.loading = this.read(desk).finally(() => {
      this.loading = null;
      if (this.again && !this.disposed) { this.again = false; void this.load(desk); }
    }));
  }
  private async read(desk: DeskApi) {
    this.machine = desk.ctx.machine ?? canonicalLocalMachineName();
    let was: string | undefined;
    try {
      const reached = await this.reach(desk);
      const areas: Area[] = [], nodelists: Nodelist[] = [];
      for (const { outline, board } of reached) {
        const [tagged, subs, sources, lists] = await Promise.all([TAGGED_QUERY, SUBSCRIPTIONS_QUERY, SOURCES_QUERY, NODELIST_QUERY].map(q => board.queryNotes(q, q === NODELIST_QUERY ? 10 : MESSAGE_LIMIT, "show")));
        areas.push(...areasIn(tagged!.notes, subs!.notes, sources!.notes, outline, this.machine));
        for (const l of lists!.notes) {
          const [whole, logs] = await Promise.all([board.get(l.id), board.queryNotes(tossesQuery(l.id), 200, "show")]);
          const tosses = logs.notes.map(tossOf).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, TOSSES_SHOWN);
          nodelists.push({ node: nodeName(outline, this.machine), title: subject(l), nodes: nodesOf(whole?.text ?? ""), tosses });
        }
      }
      await Promise.all(areas.map(a => this.count(a)));
      // By where they're read (the door's own outline first, as reached), then by tag.
      const order = new Map(reached.map((r, i) => [r.outline, i]));
      areas.sort((a, b) => (order.get(a.outline)! - order.get(b.outline)!) || a.tag.localeCompare(b.tag));
      if (this.disposed) return;
      // The area picked now (the person may have picked another while this read) stays picked.
      was = this.areas?.[this.at]?.key;
      this.areas = areas;
      this.nodelists = nodelists;
      this.problem = "";
    } catch (e) {
      this.problem = `couldn't ask the outlines for their areas: ${e instanceof Error ? e.message : String(e)}`;
      was = this.areas?.[this.at]?.key;
      this.areas ??= [];
    }
    const keep = was ? this.areas.findIndex(a => a.key === was) : -1;
    this.at = keep >= 0 ? keep : this.areas.length ? 0 : -1;
    const a = this.areas[this.at];
    if (a && this.messages) await this.messages.showArea(a, this, desk);
    desk.redraw();
  }

  /** An area's message count, how many are new to the person, and its last toss. */
  private async count(a: Area) {
    if (a.problem) return;
    const b = this.boardOf(a);
    try {
      const [all, fresh] = await Promise.all([messagesOf(b, a), messagesOf(b, a, true)]);
      a.total = all.length;
      a.fresh = fresh.length;
      a.lastToss = all.length ? Math.max(...all.map(arrived)) : null;
    } catch (e) { a.problem = `its query was refused: ${e instanceof Error ? e.message : String(e)}`; }
  }

  /** Any outline it reads changed: count again (once per burst), and read the message shown again when it's there. */
  changed(_e: OutlineEvent | undefined, outline: string | null) {
    const desk = this.desk;
    if (!desk) return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => {
      this.reload = null;
      void this.load(desk);
      const r = this.reader;
      if (outline !== null && r?.area?.outline === outline) r.reread(desk);
    }, 400);
  }
  onEvent(desk: DeskApi) { this.desk = desk; this.changed(undefined, null); }

  /** Pick area `i`: its messages are listed beside. */
  async pick(i: number, desk: DeskApi): Promise<Area> {
    const a = this.areas?.[i];
    if (!a) throw new ActionRefused(this.areas?.length ? `pick 1 to ${this.areas.length}` : "no message areas yet");
    this.at = i;
    desk.redraw();
    if (this.messages) await this.messages.showArea(a, this, desk);
    return a;
  }

  render(w: number, h: number, focused: boolean): PaneView {
    if (this.problem && !this.areas?.length) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.areas) return { lines: [fg(C.dark) + "dialing the outlines for their message areas…" + RESET] };
    if (!this.areas.length) return {
      lines: [
        fg(C.white) + "No message areas yet." + RESET, "",
        ...["An area is a view named with [echo::<name>] (or any note tagged [echo::<name>]);", "another outline carries it with [subscribe::<outline>@<machine>] [echo::<name>],", "and the tosser copies its messages under a board per node there."].map(l => fg(C.grey) + pad(l, w) + RESET),
      ],
    };
    // Renegade's area list: number, tag, name, where it comes from, messages, new, last toss.
    const tagW = Math.min(14, Math.max(4, ...this.areas.map(a => a.tag.length))), nodeW = Math.min(24, Math.max(5, ...this.areas.map(a => (a.kind === "sub" ? a.origin : a.node).length)));
    const nameW = Math.max(6, w - 4 - tagW - nodeW - 5 - 5 - 6 - 6);
    const head = paint(`|09 #  ${"Tag".padEnd(tagW)} ${"Area".padEnd(nameW)} ${"From".padEnd(nodeW)}  Msgs  |14New|09  Toss`);
    const rows = this.areas.map((a, i) => {
      const n = String(i + 1).padStart(2), total = a.total === null ? "  …" : String(a.total).padStart(4), fresh = a.fresh ? String(a.fresh).padStart(4) : "   ·";
      // A board the origin has more for than the last toss brought: `+n` waiting, after its name.
      const named = a.waiting ? `${a.name} +${a.waiting} waiting` : a.name;
      // Where it comes from: an area that starts in the door's own outline is local; another outline's, that outline.
      const toss = a.lastToss ? ago(a.lastToss).padStart(5) : "    -", from = a.kind === "sub" ? a.origin : a.outline === this.own ? "local" : a.node;
      const text = ` ${n}  ${pad(a.tag.toUpperCase(), tagW)} ${pad(named, nameW)} ${pad(from, nodeW)} ${total} ${fresh} ${toss}`;
      if (i === this.at) return selected(focused) + pad(text, w) + RESET;
      if (a.problem) return pad(`${fg(C.dark)} ${n}  ${pad(a.tag.toUpperCase(), tagW)} ${fg(C.lred)}${pad(a.problem, w - tagW - 6)}`, w) + RESET;
      return pad(`${fg(C.dark)} ${n}  ${fg(a.fresh ? C.lcyan : C.cyan)}${pad(a.tag.toUpperCase(), tagW)} ${fg(a.fresh ? C.white : C.grey)}${pad(named, nameW)} ${fg(from === "local" ? C.brown : C.lblue)}${pad(from, nodeW)} ${fg(C.grey)}${total} ${fg(a.fresh ? C.yellow : C.dark)}${fresh} ${fg(C.dark)}${toss}`, w) + RESET;
    });
    const room = Math.max(1, h - 1);
    const top = this.view.place(this.at >= 0 ? this.at : null, rows.length, room);
    this.top = top;
    return { lines: [pad(head, w), ...rows.slice(top, top + room)] };
  }
  /** The first area row drawn (the header row is above it). */
  private top = 0;

  private run(desk: DeskApi, name: "echo.area" | "echo.reload", args: Record<string, unknown> = {}) { void desk.press?.(this, ECHO_AREA_ACTIONS, name, args); }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.areas?.length ?? 0, to = listMove(k, this.at, n, 8);
    if (to !== null) { if (to !== this.at) this.run(desk, "echo.area", { n: to + 1 }); return true; }
    if (k.kind === "enter" && this.at >= 0) { this.run(desk, "echo.area", { n: this.at + 1, open: true }); return true; }
    if (ch(k) === "r") { this.run(desk, "echo.reload"); return true; }
    return false;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    const n = this.areas?.length ?? 0;
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const to = Math.max(0, Math.min(n - 1, this.at + wheelRows(k.action === "wheel-up" ? -1 : 1)));
      if (n && to !== this.at) this.run(desk, "echo.area", { n: to + 1 });
      return true;
    }
    if (k.action !== "down" || y < 1) return true;
    const i = this.top + y - 1;
    if (i >= n) return true;
    const g = this.view.press(i, press ?? { mods: k.mods ?? 0, button: k.button });
    if (g !== "focus" || i !== this.at) this.run(desk, "echo.area", { n: i + 1, ...(g === "open" || g === "fresh" ? { open: true } : {}) });
    return true;
  }

  describe() {
    return {
      node: this.desk ? nodeName(ownName(this.desk.ctx), this.machine) : null,
      picked: this.at >= 0 ? this.at + 1 : null,
      areas: this.areas?.map((a, i) => ({ n: i + 1, tag: a.tag, name: a.name, kind: a.kind, at: a.node, from: a.origin, id: a.block?.id ?? null, messages: a.total, new: a.fresh, ...(a.waiting ? { waiting: a.waiting } : {}), lastToss: a.lastToss ? new Date(a.lastToss).toISOString() : null, ...(a.problem ? { problem: a.problem } : {}) })) ?? null,
      nodelists: this.nodelists.map(l => ({ at: l.node, title: l.title, nodes: l.nodes.map(n => ({ node: n.node, reachable: n.reachable, dialsIn: n.dialsIn, held: n.held, lastToss: n.lastToss ? new Date(n.lastToss).toISOString() : null, areas: n.areas })), tosses: l.tosses.length })),
      problem: this.problem || undefined,
    };
  }

  dispose() {
    this.disposed = true;
    if (this.reload) clearTimeout(this.reload);
    for (const b of this.boards.values()) b.close();
    this.boards.clear();
  }

  // ── the band ──

  /** The logo as drawn at this size (reading comes first: the tiles keep 24 rows), or none. */
  private logoFor(rows: number): { rows: ReturnType<typeof logoCells>["rows"]; width: number } | null {
    const art = artNamed(LOGO.file);
    if (!art) return null;
    const cells = logoCells(art, LOGO);
    const room = rows - 2 - 1 - 24 - 1;
    if (!cells.rows.length || room < 6) return null;
    return { rows: densest(cells.rows, Math.min(room, 6)), width: cells.width };
  }
  bandRows(cols: number, rows: number): number { return (this.logoFor(rows) && cols >= 100 ? 6 : 3) + 1; }

  /** The words beside the letters: real counts only. */
  private info(desk: DeskApi): string[] {
    const areas = this.areas ?? [], fresh = areas.reduce((n, a) => n + (a.fresh ?? 0), 0);
    const nodes = [...new Map(this.nodelists.flatMap(l => l.nodes).map(n => [n.node, n])).values()], up = nodes.filter(n => n.reachable).length;
    const last = Math.max(0, ...areas.map(a => a.lastToss ?? 0));
    return [
      `|15the ep0ch bbs |08· |11echomail |08· |07node |11${nodeName(ownName(desk.ctx), this.machine || canonicalLocalMachineName())}`,
      this.areas ? `|07${areas.length} |08area${areas.length === 1 ? "" : "s"} · ${fresh ? `|14${fresh} new` : "|08nothing new"}|08 · ${nodes.length ? `${up} of ${nodes.length} nodes up` : "no nodelist yet"}` : "|08dialing…",
      `|08last toss ${last ? `${bbsDate(last)} |08(${ago(last)} ago)` : "never"}`,
    ];
  }

  drawBand(canvas: Canvas, r: Rect, desk: DeskApi): Placement[] {
    const logo = r.cols >= 100 ? this.logoFor(desk.ctx.t.rows) : null, letters = banner("echonet"), info = this.info(desk);
    let placements: Placement[] = [];
    if (logo) placements = drawLogo(canvas, { ...r, rows: r.rows - 1 }, desk.ctx, logo, "echonet-logo", [...letters, "", ...info.slice(0, 2)]).placements;
    else {
      const lw = Math.max(...letters.map(l => width(paint(l))));
      letters.forEach((l, i) => canvas.text(r.col + 2, r.row + i, paint(l), r.cols - 2));
      info.forEach((l, i) => canvas.text(r.col + 2 + lw + 4, r.row + i, paint(l), Math.max(0, r.cols - lw - 6)));
    }
    // The rail under it, as the BBS's headers: ─=[ MESSAGE AREAS ]=──── and where the network is.
    const label = `|09─=|11[ |15MESSAGE AREAS |11]|09=`, said = `|08 echomail across ${new Set((this.areas ?? []).map(a => a.outline)).size || 1} outline${new Set((this.areas ?? []).map(a => a.outline)).size === 1 ? "" : "s"} |09`;
    const used = width(paint(label + said));
    canvas.text(r.col, r.row + r.rows - 1, paint(label + said + "─".repeat(Math.max(0, r.cols - used))), r.cols);
    return placements;
  }
}

/** Where ↑ ↓ j k PgUp PgDn Home End move a list's light, or null when `k` isn't one of them. */
function listMove(k: Key, at: number, n: number, page: number): number | null {
  if (!n) return isUp(k) || isDown(k) || k.kind === "pgup" || k.kind === "pgdn" || k.kind === "home" || k.kind === "end" ? at : null;
  if (isUp(k)) return Math.max(0, at - 1);
  if (isDown(k)) return Math.min(n - 1, at + 1);
  if (k.kind === "pgup") return Math.max(0, at - page);
  if (k.kind === "pgdn") return Math.min(n - 1, at + page);
  if (k.kind === "home") return 0;
  if (k.kind === "end") return n - 1;
  return null;
}

// ── an area's messages ─────────────────────────────────────────────────────────────────────────────────────

/** The messages of the area picked, oldest first, the new ones lit; ⏎ reads one in the reader. */
export class EchoMessages implements Pane {
  readonly kind: TileKindName = "echo.messages";
  area: Area | null = null;
  items: Message[] | null = null;
  at = -1;
  problem = "";
  net: EchoAreas | null = null;
  private view = new RowView();
  private top = 0;
  /** Counts the lists asked for: an answer for one asked before the last is let go. */
  private asked = 0;

  title() {
    if (!this.area) return "messages";
    const fresh = this.items?.filter(m => m.fresh).length ?? 0;
    return `${this.area.tag.toUpperCase()} · ${this.items ? `${this.items.length} message${this.items.length === 1 ? "" : "s"}` : "scanning…"}${fresh ? ` · ${fresh} new` : ""}`;
  }
  hint() { return "j k message · ⏎ read it"; }

  /** List `a`'s messages (the one lit stays lit; first shown, the first new one). */
  async showArea(a: Area, net: EchoAreas, desk: DeskApi) {
    const same = this.area?.key === a.key;
    // An answer for a list asked before this one is let go, whatever this one turns out to be.
    const ask = ++this.asked;
    this.net = net;
    this.area = a;
    if (!same) { this.items = null; this.at = -1; this.view.reset(); }
    if (a.problem) { this.items = []; this.problem = a.problem; desk.redraw(); return; }
    const b = net.boardOf(a);
    let was: string | undefined;
    try {
      const [all, fresh] = await Promise.all([messagesOf(b, a), messagesOf(b, a, true)]);
      if (ask !== this.asked) return;
      // The message lit when the answer came, not when it was asked: the person may have moved meanwhile.
      was = same ? this.items?.[this.at]?.msg.id : undefined;
      const unread = new Set(fresh.map(m => m.id));
      this.items = inArrivalOrder(all).map((msg, i) => ({ msg, n: i + 1, fresh: unread.has(msg.id) }));
      this.problem = "";
    } catch (e) {
      if (ask !== this.asked) return;
      this.items = [];
      this.problem = `couldn't list ${a.tag}: ${e instanceof Error ? e.message : String(e)}`;
    }
    // The reader on this area steps through the list as it is now (a toss brought more, one changed upstream).
    net.reader?.relist(a, this.items);
    const keep = was ? this.items.findIndex(m => m.msg.id === was) : -1;
    const first = this.items.findIndex(m => m.fresh);
    this.at = keep >= 0 ? keep : first >= 0 ? first : this.items.length - 1;
    desk.redraw();
  }

  render(w: number, h: number, focused: boolean): PaneView {
    if (!this.area) return { lines: [fg(C.dark) + "pick an area" + RESET] };
    if (this.problem) return { lines: [fg(C.lred) + pad(this.problem, w) + RESET] };
    if (!this.items) return { lines: [fg(C.dark) + `scanning ${this.area.tag.toUpperCase()}…` + RESET] };
    if (!this.items.length) return { lines: [fg(C.dark) + pad(`No messages in ${this.area.tag.toUpperCase()} yet.`, w) + RESET] };
    const dateW = 16, fromW = Math.min(18, Math.max(4, ...this.items.map(m => messageFrom(m.msg).length))), subjW = Math.max(8, w - 6 - fromW - dateW - 3);
    const head = paint(`|09  #   ${"From".padEnd(fromW)} ${"Subject".padEnd(subjW)} Date`);
    const rows = this.items.map((m, i) => {
      const mark = m.fresh ? "●" : " ", n = String(m.n).padStart(3), from = pad(messageFrom(m.msg), fromW), subj = pad(subject(m.msg), subjW), date = bbsDate(arrived(m.msg));
      if (i === this.at) return selected(focused) + pad(`${n} ${mark} ${from} ${subj} ${date}`, w) + RESET;
      return pad(`${fg(C.dark)}${n} ${fg(C.yellow)}${mark} ${fg(m.fresh ? C.brown : C.dark)}${from} ${fg(m.fresh ? C.white : C.grey)}${subj} ${fg(C.dark)}${date}`, w) + RESET;
    });
    const room = Math.max(1, h - 1);
    this.top = this.view.place(this.at >= 0 ? this.at : null, rows.length, room);
    return { lines: [pad(head, w), ...rows.slice(this.top, this.top + room)] };
  }

  private run(desk: DeskApi, args: Record<string, unknown>) { void desk.press?.(this, ECHO_MESSAGE_ACTIONS, "echo.message", args); }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.items?.length ?? 0, to = listMove(k, this.at, n, 10);
    if (to !== null) { if (to !== this.at) this.run(desk, { n: to + 1 }); return true; }
    if (k.kind === "enter" && this.at >= 0) { this.run(desk, { n: this.at + 1, read: true }); return true; }
    return false;
  }
  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    const n = this.items?.length ?? 0;
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const to = Math.max(0, Math.min(n - 1, this.at + wheelRows(k.action === "wheel-up" ? -1 : 1)));
      if (n && to !== this.at) this.run(desk, { n: to + 1 });
      return true;
    }
    if (k.action !== "down" || y < 1) return true;
    const i = this.top + y - 1;
    if (i >= n) return true;
    const g = this.view.press(i, press ?? { mods: k.mods ?? 0, button: k.button });
    if (g !== "focus" || i !== this.at) this.run(desk, { n: i + 1, ...(g === "open" || g === "fresh" ? { read: true } : {}) });
    return true;
  }

  describe() {
    return {
      area: this.area ? { tag: this.area.tag, name: this.area.name, at: this.area.node } : null, picked: this.at >= 0 ? this.at + 1 : null,
      messages: this.items?.map(m => ({ n: m.n, id: m.msg.id, from: messageFrom(m.msg), subject: subject(m.msg), date: new Date(arrived(m.msg)).toISOString(), new: m.fresh })) ?? null,
      problem: this.problem || undefined,
    };
  }
}

// ── the reader ─────────────────────────────────────────────────────────────────────────────────────────────

/** What a read or a step answers. */
export type Read = { n: number; of: number; id: string; area: string; subject: string; new: boolean };

/**
 * The message reader: the one NoteSurface (a ReaderPane), on the message's own outline (its host's ctx is that
 * outline's), GoldED's header over the message and the FidoNet footer under it (SurfaceHost.header and .footer). It
 * keeps the list it was opened from: `]` `[` step through it, each message marked read as it's shown. `r` replies and `q`
 * quote-replies in the shared comment composer; the comment is on the copy, and the tosser carries it home as netmail.
 */
export class EchoReader extends ReaderPane {
  override readonly kind: TileKindName = "echo.reader";
  net: EchoAreas | null = null;
  /** The area and the messages it was opened on, and which one it shows. */
  area: Area | null = null;
  list: Message[] = [];
  index = -1;
  constructor() { super(false); }

  /** The message shown, when it is one of the list's (a link followed in it shows another note). */
  get message(): Message | null { const m = this.list[this.index]; return m && this.msg?.id === m.msg.id ? m : null; }

  override title() {
    const m = this.message;
    return m && this.area ? `${this.area.tag.toUpperCase()} · message ${m.n} of ${this.list.length}` : this.msg ? `reading · ${subject(this.msg).slice(0, 40)}` : "message reader";
  }
  override hint() { return this.message ? `] [ next prev · r reply · q quote · ${super.hint()}` : super.hint(); }
  /** It reads what its list opens: the desk's current note doesn't move it. */
  override select() {}
  protected override emptyFor(): string { return "⏎ on a message in the list reads it here · ] [ then step through the area · r replies · q quotes"; }

  override host(desk: DeskApi): SurfaceHost {
    const base = super.host(desk), a = this.area, net = this.net;
    if (!a || !net) return base;
    const h: SurfaceHost = {
      ...base,
      conference: true,
      ctx: net.ctxOf(a, desk),
      // A link followed in a message is read here, on the message's own outline (alt+← comes back); ] [ go on through the list.
      navigate: (m: Msg, how?: OpenHow) => { if (how?.by?.kind === "agent" && this.holdsKeys) { desk.ctx.flash(`not opened while you're in ${this.surface.sessionWord() ?? "a session"} here: ${subject(m).slice(0, 50)}`); return; } this.surface.show(m, h); desk.redraw(); },
      header: (m: Msg, _w: number, info: HeaderInfo) => {
        const found = this.list.find(x => x.msg.id === m.id);
        const comments = info.comments?.total ? [`|08■ ${info.comments.open ? `${info.comments.open} open` : `${info.comments.total} earlier`} repl${info.comments.total === 1 ? "y" : "ies"} on this copy · m lists them`] : [];
        return (found ? [...headerOf(found, this.list.length, a), ...comments] : [`|15${subject(m)}`, `|08${authorName(m.author)} · ${bbsDate(m.updatedAt)} · not a message of ${a.tag.toUpperCase()} · ] [ back to the list`]).map(paint);
      },
      // SEEN-BY names the nodes the tosser's seen-by marks on it name, once its threads are read.
      footer: (m: Msg, w: number) => (this.list.some(x => x.msg.id === m.id) ? footerOf(m, a, w, this.msg?.id === m.id ? this.seen(m, desk) : []).map(paint) : []),
      ownKeys: "[]rq",
    };
    return h;
  }

  /** The seen-by marks on a copy's original, by the copy's id, read from its origin's outline (null while asked). */
  private originMarks = new Map<string, string[] | null>();
  /**
   * The nodes a message's seen-by marks name: an original's own (its threads, read with the note); a copy's are on its
   * original, read from the origin when this door reaches it (the same host), once per copy.
   */
  private seen(m: Msg, desk: DeskApi): string[] {
    const from = fromOf(m);
    if (!from) return seenByMarks(this.surface.comments ?? []);
    const had = this.originMarks.get(m.id);
    if (had !== undefined) return had ?? [];
    const b = this.net?.boardOfNode(from.node);
    this.originMarks.set(m.id, b ? null : []);
    if (b) b.comments(from.id).then(t => { this.originMarks.set(m.id, seenByMarks(t)); desk.redraw(); }, () => this.originMarks.set(m.id, []));
    return [];
  }

  /** The area's messages were read again: ] [ step through the new list, from the message shown. */
  relist(area: Area, items: Message[]) {
    if (this.area?.key !== area.key) return;
    const shown = this.message?.msg.id;
    this.area = area;
    this.list = items;
    if (shown) { const i = items.findIndex(m => m.msg.id === shown); if (i >= 0) this.index = i; }
  }

  /** Read message `i` of `list` in `area` (marked read, as `actor`: the person's marks are theirs, an agent's its own). */
  read(area: Area, list: Message[], i: number, desk: DeskApi, actor: Actor = USER): Read {
    const m = list[i];
    if (!m) throw new ActionRefused(list.length ? `${area.tag} has messages 1 to ${list.length}` : `${area.tag} has no messages`);
    const was = { area: this.area, list: this.list, index: this.index };
    this.area = area; this.list = list; this.index = i;
    if (this.msg?.id !== m.msg.id && !this.show(m.msg, desk)) {
      Object.assign(this, was);
      throw new ActionRefused("the reader holds an edit or a comment; save or close it first");
    }
    const fresh = m.fresh;
    // Read at the revision listed: a change since then is still new.
    const board = this.net?.boardOf(area), shown = [{ id: m.msg.id, revision: m.msg.revision ?? 0 }];
    if (fresh && actor.kind === "user") {
      m.fresh = false;
      if (area.fresh) area.fresh--;
      void board?.markRead(shown).catch(e => {
        m.fresh = true;
        if (area.fresh !== null) area.fresh++;
        desk.ctx.flash(`couldn't mark ${subject(m.msg).slice(0, 40)} read: ${e instanceof Error ? e.message : String(e)}`);
        desk.redraw();
      });
    } else if (actor.kind === "agent") void board?.markRead(shown, actor.id).catch(() => {});
    // The list beside lights it, when it lists the same area.
    const ms = this.net?.messages;
    if (ms?.area?.key === area.key && ms.items === list) ms.at = i;
    desk.redraw();
    return { n: m.n, of: list.length, id: m.msg.id, area: area.tag, subject: subject(m.msg), new: fresh };
  }

  /** The next (1) or previous (-1) message of the list it was opened on. */
  step(by: number, desk: DeskApi, actor: Actor): Read {
    if (!this.area || !this.list.length) throw new ActionRefused("no message is open · ⏎ on a message in the list reads it");
    const to = this.message ? this.index + Math.sign(by) : this.index;
    if (to < 0) throw new ActionRefused("this is the first message");
    if (to >= this.list.length) throw new ActionRefused(`end of ${this.area.tag.toUpperCase()}: no more messages`);
    return this.read(this.area, this.list, to, desk, actor);
  }

  override key(k: Key, desk: DeskApi): boolean {
    const c = ch(k);
    if (this.message && !this.holdsKeys && !desk.holdsKeys?.()) {
      if (c === "}" || c === "{") { void desk.press?.(this, ECHO_READER_ACTIONS, "echo.step", { by: c === "}" ? 1 : -1 }); return true; }
      if (c === "r") { void desk.press?.(this, ECHO_READER_ACTIONS, "echo.reply", {}); return true; }
      if (c === "q") { void desk.press?.(this, ECHO_READER_ACTIONS, "echo.quote", {}); return true; }
    }
    return super.key(k, desk);
  }

  override describe() {
    const m = this.message;
    return { ...super.describe(), echo: m && this.area ? { area: this.area.tag, at: this.area.node, n: m.n, of: this.list.length } : null };
  }
}

/** The passage a quote-reply quotes: the person's selection, else the message's body (its title when it has none). */
function quoted(r: EchoReader, actor: Actor, quote: string | undefined): { quote: string; near?: number } {
  const m = r.msg!;
  if (quote !== undefined) return { quote };
  if (actor.kind === "user" && r.surface.selection) { const p = r.surface.passageFor(actor); return { quote: p.note.quote, near: p.note.start }; }
  const body = m.text.split("\n").slice(1).join("\n").trim();
  return { quote: body || m.text.split("\n")[0]!.trim() };
}
/** FidoNet's quoting: each line of the passage after `> `, then a blank line to write under. */
export const quoteLines = (text: string) => `${text.split("\n").map(l => `> ${l}`.trimEnd()).join("\n")}\n\n`;

// ── the nodelist ───────────────────────────────────────────────────────────────────────────────────────────

/** Every `[type::nodelist]` the screen reads, as FidoNet's nodelist file: a node a line, its status, last toss and areas. */
export class EchoNodelist implements Pane {
  readonly kind: TileKindName = "echo.nodelist";
  net: EchoAreas | null = null;
  title() {
    const lists = this.net?.nodelists ?? [];
    return lists.length ? `nodelist · ${new Set(lists.flatMap(l => l.nodes.map(n => n.node))).size} nodes` : "nodelist";
  }
  hint() { return ""; }
  render(w: number): PaneView {
    const lists = this.net?.nodelists;
    if (!lists) return { lines: [fg(C.dark) + "dialing…" + RESET] };
    if (!lists.length) return { lines: [pad(paint("|08;A no [type::nodelist] block in these outlines yet: the tosser keeps one"), w)] };
    return { lines: lists.flatMap((l, i) => [...(i ? [""] : []), ...nodelistLines(`${l.title} · kept at ${l.node}`, l.nodes, l.tosses)]).map(l => pad(paint(l), w) + RESET) };
  }
  key() { return false; }
}

// ── the actions: keys, clicks and act call the same code ───────────────────────────────────────────────────

const areasOf = (p: Pane): EchoAreas => {
  if (p instanceof EchoAreas) return p;
  const net = (p as { net?: EchoAreas | null }).net;
  if (!net) throw new ActionRefused("the message areas aren't on this screen");
  return net;
};

export const ECHO_AREA_ACTIONS = actionSet<KindHost>()("echo", {
  "echo.area": def({
    summary: "pick a message area (n= its place, as peek lists them, or tag=): its messages are listed beside; open=true goes to them (the person's keys move there; an agent's never moves them)",
    keys: "j k ↑ ↓ PgUp PgDn Home End, click, wheel (pick) · ⏎, double click (its messages)",
    touches: "screen", replay: "safe", says: r => `picked ${r.tag.toUpperCase()} (${r.messages ?? "?"} messages, ${r.new ?? 0} new)`,
    args: {
      n: { type: "number", optional: true, about: "its place in the list, from 1" },
      tag: { type: "string", optional: true, about: "its echo tag (any case)" },
      open: { type: "boolean", optional: true, about: "go to its messages, as ⏎ does" },
    },
    async run({ n, tag, open }, { pane, desk }, actor) {
      const net = areasOf(pane);
      if ((n === undefined) === (tag === undefined)) throw new ActionRefused("echo.area takes n or tag, one of them");
      const i = tag !== undefined ? (net.areas ?? []).findIndex(a => a.tag.toLowerCase() === tag.trim().toLowerCase()) : n! - 1;
      if (i < 0) throw new ActionRefused(`no area tagged ${tag}; the areas are ${(net.areas ?? []).map(a => a.tag).join(", ") || "none yet"}`);
      const a = await net.pick(i, desk);
      if (open && actor.kind === "user" && net.messages) desk.focusPane?.(net.messages, actor);
      return { n: i + 1, tag: a.tag, name: a.name, at: a.node, from: a.origin, messages: a.total, new: a.fresh };
    },
  }),
  "echo.reload": def({
    summary: "dial the outlines again: their areas, counts and nodelists (it also does when one of them changes)", keys: "r",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { pane, desk }) { const net = areasOf(pane); await net.load(desk); return { areas: net.areas?.length ?? 0, nodelists: net.nodelists.length }; },
  }),
});

export const ECHO_MESSAGE_ACTIONS = actionSet<KindHost>()("echo", {
  "echo.message": def({
    summary: "light a message of the area listed (n= its number, or id=); read=true reads it in the reader, marked read (the person's read marks; an agent's are its own) and, for the person, with their keys there",
    keys: "j k ↑ ↓ PgUp PgDn Home End, click, wheel (light) · ⏎, double click (read it)",
    touches: "screen", replay: "safe", says: r => (r.read ? `read message ${r.n} of ${r.of}: ${r.subject.slice(0, 40)}` : `lit message ${r.n}`),
    args: {
      n: { type: "number", optional: true, about: "its number in the area, from 1 (oldest first)" },
      id: { type: "string", optional: true, about: "its block id" },
      read: { type: "boolean", optional: true, about: "read it in the reader, as ⏎ does" },
    },
    run({ n, id, read }, { pane, desk }, actor) {
      const ms = pane as EchoMessages, items = ms.items;
      if (!ms.area || !items) throw new ActionRefused("no area's messages are listed yet · pick an area");
      if ((n === undefined) === (id === undefined)) throw new ActionRefused("echo.message takes n or id, one of them");
      const i = id !== undefined ? items.findIndex(m => m.msg.id === id || (id.length >= 8 && m.msg.id.startsWith(id))) : n! - 1;
      if (i < 0 || i >= items.length) throw new ActionRefused(id !== undefined ? `no message ${id} in ${ms.area.tag}` : items.length ? `${ms.area.tag} has messages 1 to ${items.length}` : `${ms.area.tag} has no messages`);
      ms.at = i;
      desk.redraw();
      const r = ms.net?.reader;
      if (!read) return { n: i + 1, of: items.length, id: items[i]!.msg.id, subject: subject(items[i]!.msg), read: false };
      if (!r) throw new ActionRefused("there's no message reader on this screen");
      const out = r.read(ms.area, items, i, desk, actor);
      if (actor.kind === "user") desk.focusPane?.(r, actor);
      return { ...out, read: true };
    },
  }),
});

export const ECHO_READER_ACTIONS = actionSet<KindHost>()("echo", {
  "echo.step": def({
    summary: "read the next (by=1) or previous (by=-1) message of the area the reader was opened on, marked read as it's shown", keys: "} {",
    touches: "screen", replay: "safe", says: r => `read message ${r.n} of ${r.of}: ${r.subject.slice(0, 40)}`,
    args: { by: { type: "number", about: "1 the next, -1 the previous" } },
    run({ by }, { pane, desk }, actor) {
      if (by !== 1 && by !== -1) throw new ActionRefused("echo.step: by is 1 or -1");
      return (pane as EchoReader).step(by, desk, actor);
    },
  }),
  "echo.reply": def({
    summary: "reply to the message read: a comment on the copy (on its subject line), which the tosser carries back to the origin as netmail. The person writes it in the shared comment composer; an agent says body=, sent at once",
    keys: "r",
    touches: "draft", draft: "type", replay: "ask",
    args: { body: { type: "string", optional: true, about: "the reply, sent at once (an agent's; the person's opens the composer)" } },
    async run({ body }, { pane, desk }, actor) {
      const r = pane as EchoReader, m = r.message;
      if (!m) throw new ActionRefused("no message is open to reply to");
      if (r.msg?.partial) throw new ActionRefused("the message is still being read; r again in a moment");
      if (actor.kind !== "user" && body === undefined) throw new ActionRefused("say body=: an agent's reply is sent at once");
      const title = m.msg.text.includes(subject(m.msg)) && subject(m.msg) ? subject(m.msg) : m.msg.text.split("\n")[0]!.trim();
      const args = { action: "comment", quote: title, ...(body !== undefined ? { body } : {}) };
      return actor.kind === "user" ? r.surface.runKey("passage.act", args, r.host(desk)) : r.act("passage.act", args, desk, actor);
    },
  }),
  "echo.quote": def({
    summary: "quote-reply: the composer opens on the passage quoted with > before each line (quote= the words; the person's selection, else the whole message), the reply written under it. An agent says quote= and body=, sent at once",
    keys: "q",
    touches: "draft", draft: "type", replay: "ask",
    args: {
      quote: { type: "string", optional: true, about: "the exact words to quote, as stored (default: the person's selection, else the message's body)" },
      body: { type: "string", optional: true, about: "the reply under the quote, sent at once (an agent's)" },
    },
    async run({ quote, body }, { pane, desk }, actor) {
      const r = pane as EchoReader;
      if (!r.message) throw new ActionRefused("no message is open to quote");
      if (r.msg?.partial) throw new ActionRefused("the message is still being read; q again in a moment");
      if (actor.kind !== "user" && (quote === undefined || body === undefined)) throw new ActionRefused("say quote= and body=: an agent's quote-reply is sent at once");
      const q = quoted(r, actor, quote);
      const lines = quoteLines(q.quote);
      const args = { action: "comment", quote: q.quote, ...(q.near !== undefined ? { near: q.near } : {}), ...(body !== undefined ? { body: lines + body } : { text: lines }) };
      return actor.kind === "user" ? r.surface.runKey("passage.act", args, r.host(desk)) : r.act("passage.act", args, desk, actor);
    },
  }),
});

// ── the kinds and the screen ──────────────────────────────────────────────────────────────────────────────

/** Each tile finds the screen's model, the area list, by its name on the screen. */
const AREAS_TILE = "areas";
function joinNet(p: Pane & { net: EchoAreas | null }, tile: (name: string) => Pane | undefined): EchoAreas | null {
  const net = tile(AREAS_TILE);
  if (!(net instanceof EchoAreas)) return null;
  p.net = net;
  return net;
}

export function echoKinds(): TileKind[] {
  const reader = tileKind("reader")!;
  return [
    {
      kind: "echo.areas", word: "areas", about: "EchoNet's message areas: every echo area and subscription in the outlines this door reaches, with their counts, and the band", noun: "the area list",
      make: () => new EchoAreas(), actions: ECHO_AREA_ACTIONS,
      start: (p, env) => void (p as EchoAreas).load(env.desk),
      band: {
        rows: (p, cols, rows) => (p as EchoAreas).bandRows(cols, rows),
        draw: (p, canvas, r, desk) => (p as EchoAreas).drawBand(canvas, r, desk),
      },
      peek: p => (p as EchoAreas).describe(),
    },
    {
      kind: "echo.messages", word: "messages", about: "the messages of the area picked in EchoNet's area list, new ones lit", noun: "the message list",
      make: () => new EchoMessages(), actions: ECHO_MESSAGE_ACTIONS,
      start: (p, env) => {
        const net = joinNet(p as EchoMessages, env.tile);
        if (!net) return;
        net.messages = p as EchoMessages;
        const a = net.areas?.[net.at];
        if (a) void (p as EchoMessages).showArea(a, net, env.desk);
      },
      peek: p => ({ list: (p as EchoMessages).describe() }),
    },
    {
      ...reader, kind: "echo.reader", word: "reader", about: "an EchoNet message: its header, the note, its FidoNet footer; ] [ step, r reply, q quote", noun: "the message reader", keys: undefined,
      make: () => new EchoReader(), actions: ECHO_READER_ACTIONS, inherits: reader.actions ? [reader.actions] : undefined,
      start: (p, env) => { const net = joinNet(p as EchoReader, env.tile); if (net) net.reader = p as EchoReader; },
      // An agent's open (`ep0ch open <id>`): a message of the area listed is read there; another note is shown in the reader.
      take: (p, m, desk, by) => {
        const r = p as EchoReader, ms = r.net?.messages, i = ms?.items?.findIndex(x => x.msg.id === m.id) ?? -1;
        try {
          if (ms?.area && ms.items && i >= 0) r.read(ms.area, ms.items, i, desk, by ?? USER);
          else {
            // Not one of the area's messages: read on the door's own outline, where `open` found it.
            if (r.holdsKeys) return "the reader holds an edit or a comment";
            const was = { area: r.area, list: r.list, index: r.index };
            r.area = null; r.list = []; r.index = -1;
            if (!r.show(m, desk)) { Object.assign(r, was); return "the reader holds an edit or a comment"; }
          }
          return null;
        } catch (e) { return e instanceof Error ? e.message : String(e); }
      },
      peek: p => ({ reading: (p as EchoReader).describe().echo }),
    },
    {
      kind: "echo.nodelist", word: "nodelist", about: "EchoNet's nodelist ([type::nodelist] and its [type::toss] entries) as FidoNet wrote it", noun: "the nodelist",
      make: () => new EchoNodelist(),
      start: (p, env) => void joinNet(p as EchoNodelist, env.tile),
    },
  ];
}

/**
 * The message areas: the band across the top, the areas over the nodelist down the left, an area's messages over the
 * message reader on the right. Esc and q come back to the areas.
 */
export function echonetSpec(): ScreenSpec {
  return {
    name: "echonet", title: "echonet · message areas", band: AREAS_TILE, lands: "reader", home: AREAS_TILE,
    hint: {
      "echo.areas": "|15j k|08 area · |15⏎|08 messages · |15r|08 reload · |15Tab|08 tiles · |15q|08 back",
      "echo.messages": "|15j k|08 message · |15⏎|08 read · |15Tab|08 tiles · |15q|08 areas",
      "echo.reader": "|15} {|08 next prev · |15r|08 reply · |15q|08 quote · |15[ ]|08 elements · |15esc|08 areas",
      "*": "|15Tab|08 tiles · |15q|08 areas",
    },
    layout: {
      focus: AREAS_TILE,
      root: {
        t: "split", dir: "row", weights: [0.46, 0.54], kids: [
          { t: "split", dir: "col", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "echo.areas", name: AREAS_TILE }, { t: "leaf", kind: "echo.nodelist", name: "nodelist" }] },
          { t: "split", dir: "col", weights: [0.36, 0.64], kids: [{ t: "leaf", kind: "echo.messages", name: "messages" }, { t: "leaf", kind: "echo.reader", name: "reader" }] },
        ],
      },
    },
  };
}
