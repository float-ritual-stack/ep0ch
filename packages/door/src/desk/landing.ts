import type { ListOpenWhere } from "@ep0ch/outline-core/list-row";
import type { Rect } from "../canvas";
import { leaves, MIN_ROWS, node, splitAxis, type AltRule, type Dir, type Place } from "./layout";
import { flowHolding, named, OPEN_READS, policyAt, rects, type Ctx, type LayoutState, type Op, type TileFacts } from "./screen-layout";

/**
 * Where tile `id`'s opens land (PIE-794: every open from a tile asks this, and only this): its own link (when that tile
 * is here), else the opens-into of the nearest container that names a tile here (not itself), else its home (a list's
 * reader), else the open rule: the next column of its flow (`next`), beside it (`beside`), the tile itself (`self`), or none (a reader is its own
 * home: the note replaces its own; anything else lands in the first reader that isn't pinned).
 */
export function landing<I>(s: Pick<LayoutState<I>, "tree" | "policy" | "wires" | "names">, id: I, verb: "open" | "alt" | "hover", facts?: TileFacts, tile?: (id: I) => TileFacts, preferred?: ListOpenWhere): { to: I; full?: true } | { float: true } | { into: string } | { next: true } | { beside: I } | { tab: I } | { across: string; rule: AltRule } | null {
  const wire = s.wires.find(w => w.from === id && w.verb === verb && s.names.has(w.to));
  if (verb === "alt") {
    const open = landing(s, id, "open", facts, tile);
    const policy = policyAt(s, id, facts);
    const altOpens = policy.altOpens;
    const rule = wire?.rule ?? (wire ? "tile" : altOpens ?? "beside");
    const target = wire?.to ?? (open && "to" in open ? open.to : id);
    if (rule === "first-unheld") {
      const available = leaves(s.tree).find(t => { const f = tile?.(t); return f?.notes && !f.follower && !f.pinned && !f.editing && !f.holds; });
      if (available !== undefined) return { to: available };
    }
    if (!wire && open && "across" in open) return { across: open.across, rule };
    if (rule === "tile") return { to: target };
    if (rule === "tab") return { tab: target };
    if (!wire && !policy.by.altOpens && open && ("into" in open || "next" in open)) return open;
    return { beside: target };
  }
  if (wire) return { to: wire.to };
  if (verb === "hover") return null;
  const e = policyAt(s, id, facts);
  const into = e.opensInto ? named(s, e.opensInto) : undefined;
  if (into !== undefined && into !== id) return { to: into };
  // A container by its key (the board's readers row): a tile opened into it holds the note.
  if (into === undefined && e.opensInto && node(s.tree, e.opensInto)) return { into: e.opensInto };
  // In place (PIE-1516): the tile itself, as its own wire says it.
  preferred ??= e.opens === "float" || e.opens === "full" ? e.opens : e.opens === "self" ? "current" : undefined;
  if (preferred === "current" || preferred === "full") return { to: id, ...(preferred === "full" ? { full: true } : {}) };
  if (preferred === "beside") return { beside: id };
  if (preferred === "float") return { float: true };
  // A list (the links tile) opens in its home, the reader it belongs to, when no link or container says otherwise (PIE-794).
  const home = facts?.home !== undefined ? named(s, facts.home) : undefined;
  if (home !== undefined && home !== id) return { to: home };
  if (facts?.home?.includes("/")) return { across: facts.home, rule: "tile" };
  if (e.opens === "beside") return { beside: id };
  if (e.opens === "next" && flowHolding(s.tree, id)) return { next: true };
  return null;
}

/**
 * What an opener beside tile `target` prefers (PIE-1559), each named once; the layout weighs the places in that order
 * (`besideOrder`) and takes the first it allows where the new tile reads at `needs` (OPEN_READS when left out):
 * - `there`: `dir` only, as asked (tile.open with a place: to= or where=)
 * - `beside`: `dir` (right when none), then below when that's left or right; neither reading, it floats (tile.open
 *   naming no place, PIE-1444), unless a float would cover the tile the person types in
 * - `axis`: the longer side (`splitAxis`), then the other (tile.preview, pane.split)
 * - `width`: a list or program that wants width (the keys window, the trail, ctrl+t's picker): `splitAxis` wide; below a
 *   tile too narrow to halve into `needs.cols`, along the screen's bottom edge one already narrower; the screen's edge
 *   last, which a container that takes only its own kind never refuses (none for a pair: it stays with its tile). With
 *   a `dir` on a pair (an answer tile, on the side last chosen, PIE-1757): that side while halving leaves the target `needs.cols`,
 *   else below, so a narrow reader's edit keeps its width; asked above or below, it holds at any width
 * - `height`: under it, beside when it's too short to halve (the tune inspector)
 * Nothing reading: `strict` refuses (the trail, whose reader has a history picker instead); else the place nearest reading.
 */
export type Prefers = "there" | "beside" | "axis" | "width" | "height";
export interface Beside<I = number> {
  kind: "beside"; target: I; prefers: Prefers; dir?: Dir; needs?: { cols?: number; rows?: number }; strict?: boolean;
  /** Opened as a pair with its tile, at this share of their place (a reader's attached tiles). */
  pair?: boolean; weight?: number;
  /** What the target must keep for a place to be taken (PIE-1757: an edit beside its answer keeps room to type). */
  keeps?: { cols?: number; rows?: number };
  /** With no place beside that reads, a tab behind the target in its container, the target still shown (PIE-1757). */
  tab?: boolean;
}
/** What an edit keeps beside a tile opened with it (PIE-1757): its header, a few rows of text, at the width a tile reads. */
export const EDIT_KEEPS = { rows: 11 };
/** Where an answer tile opens beside reader `target` (PIE-1757): the side last chosen, else below, else a tab behind it. */
export const answerLands = (dir: Dir, editing: boolean) => ({ prefers: "width" as const, dir, keeps: editing ? { cols: OPEN_READS.cols, ...EDIT_KEEPS } : OPEN_READS, tab: true });
/** The places `b` weighs beside a target drawn at `r`, best first: every opener's preference, in one rule. */
export function besideOrder<I>(b: Beside<I>, r: Rect | undefined): Place<I>[] {
  const split = (dir: Dir): Place<I> => ({ kind: "split", target: b.target, dir, ...(b.pair ? { pair: true } : {}), ...(b.weight !== undefined ? { weight: b.weight } : {}) });
  const edgeOf = (dir: Dir): Place<I> => ({ kind: "edge", dir });
  const dir = b.dir ?? "right";
  const at = (ws: string[]) => [...ws.map(w => (w.startsWith("edge-") ? edgeOf(w.slice(5) as Dir) : split(w as Dir))).filter(p => !b.pair || p.kind === "split"),
    ...(b.tab ? [{ kind: "tabs" as const, target: b.target, behind: true as const }] : [])];
  switch (b.prefers) {
    case "there": return [split(dir)];
    case "beside": return at([dir, ...(dir === "left" || dir === "right" ? ["down"] : [])]);
    case "axis": return at(r && splitAxis(r) === "col" ? ["down", "right"] : ["right", "down"]);
    case "height": return at(r && r.rows < MIN_ROWS * 2 ? ["right", "down"] : ["down", "right"]);
    case "width": {
      const min = b.needs?.cols ?? OPEN_READS.cols;
      // A pair (an attached tile, the side last chosen) takes its side; above or below keeps the target its width, so a
      // side asked that way holds however narrow it is. Any other opener's `dir` is no side for width (^T's picker).
      const side = b.pair ? b.dir : undefined, across = side === "up" || side === "down" ? side : "down";
      if (r && r.cols < min) return at(["edge-down", across, "right"]);
      if (r && Math.floor(r.cols / 2) < min) return at([across, "edge-down", "right"]);
      if (side) return at([side, side === across ? "right" : "down", "edge-right"]);
      return at(r && splitAxis(r, true) === "row" ? ["right", "down", "edge-right"] : ["down", "right", "edge-right"]);
    }
  }
}
const PLACE_WORDS: Record<Dir, string> = { left: "left of", right: "right of", up: "above", down: "below" };
const whereWord = <I>(p: Place<I>): string => (p.kind === "edge" ? `edge-${p.dir}` : p.kind === "split" ? p.dir : p.kind);

/**
 * Where a new tile beside another goes (PIE-1559): the one question every open beside a tile asks, "beside tile T,
 * needing N columns", for the person and an agent alike. Each place `besideOrder` gives is tried as the open itself
 * (every rule of the step: containers, locks, the typing guard), and the first allowed one where the tile reads at its
 * `needs` is taken. The answer says where it went (`where`) and, when that wasn't the first choice, why.
 */
export function besideAttempt<I, D extends Pick<LayoutState<I>, "tree" | "floats" | "collapsed" | "policy"> & { answer: Record<string, unknown> }>(
  s: LayoutState<I>, op: Extract<Op<I>, { op: "open"; at: unknown }>, b: Beside<I>, ctx: Ctx<I>, attempt: (s: LayoutState<I>, op: Op<I>, ctx: Ctx<I>) => D | string,
): D | string {
  const needs = { cols: b.needs?.cols ?? OPEN_READS.cols, rows: b.needs?.rows ?? OPEN_READS.rows };
  const holds = (id: I) => !!ctx.tile(id).holds;
  const name = s.names.get(b.target) ?? String(b.target);
  // The target as it's drawn (zoomed, it has the screen): what the person sees is what the sides are weighed by.
  const order = besideOrder(b, rects(s, ctx.area, holds).get(b.target)), was = rects({ ...s, zoom: null }, ctx.area, holds).get(b.target);
  let refused: string | null = null, first: { d: D; at: Place<I>; why: string } | null = null;
  let squeezed = false, best: { d: D; at: Place<I>; fit: number } | null = null;
  for (const at of order) {
    // A tab behind the target is for keeping it room (`keeps`): taken only when a place would squeeze a target that has it.
    if (at.kind === "tabs" && b.tab && !squeezed) continue;
    const d = attempt(s, { ...op, at }, ctx);
    if (typeof d === "string") { refused ??= d; continue; }
    const placed = rects({ ...d, zoom: null }, ctx.area, holds), size = placed.get(op.tile), kept = placed.get(b.target);
    // A float, a tab or a container's own room isn't measured: only a split or an edge is beside.
    // The target keeps what it reads at too, when it says (an edit beside its answer, PIE-1757), or what it had when that
    // was less: a side split takes no rows from a short tile.
    const keeps = { cols: Math.min(b.keeps?.cols ?? 0, was?.cols ?? Infinity), rows: Math.min(b.keeps?.rows ?? 0, was?.rows ?? Infinity) }, short = !!kept && (kept.cols < keeps.cols || kept.rows < keeps.rows);
    if (!size || !short && size.cols >= needs.cols && size.rows >= needs.rows) {
      d.answer = { ...d.answer, where: whereWord(at), ...(first ? { why: `${first.why}, so it went ${at.kind === "split" && at.dir === "down" ? "below it" : at.kind === "edge" ? `along the screen's ${at.dir} edge` : at.kind === "tabs" ? `into a tab behind ${name}` : `${PLACE_WORDS[(at as { dir: Dir }).dir]} ${name}`}` } : {}) };
      return d;
    }
    // The target had its room whole: a tab behind it keeps that, where a split here would take it (Codex on #1452: a
    // 44×12 edit, below too short for the answer to read).
    squeezed ||= short && !!was && was.cols >= (b.keeps?.cols ?? 0) && was.rows >= (b.keeps?.rows ?? 0);
    // Nothing reading, the place nearest reading is taken (PIE-1757: below a 42×3 reader, an answer tile 0 rows tall).
    const fit = Math.min(size.cols / needs.cols, size.rows / needs.rows);
    if (!best || fit > best.fit) best = { d, at, fit };
    first ??= { d, at, why: short ? `${name} would keep ${kept!.cols}×${kept!.rows}, under the ${keeps.cols}×${keeps.rows} it reads at` : narrowWhy(name, size, needs) };
  }
  const floats = (why: string): D | string => {
    const d = attempt(s, { ...op, at: { kind: "float" } }, ctx);
    if (typeof d !== "string") d.answer = { ...d.answer, where: "float", why: `${why}, so it floats (layout.move tile=<it> to=<a tile> places it)` };
    return d;
  };
  if (!first) {
    const why = refused ?? `there's no place beside ${name}`;
    // An open that named no place, with no place beside its target that takes it (a board's lanes take only their own
    // kind): it floats, as when there's no room; refused there too, the first refusal says why.
    // Beside the tile the person types in, a float would cover their edit: the refusal (the typing guard's) stands.
    if (b.prefers !== "beside" || ctx.protectTyping && b.target === ctx.person.typingIn) return why;
    const d = floats(`beside ${name}: ${why}`);
    return typeof d === "string" ? why : d;
  }
  const narrow = first.why;
  if (b.strict) return narrow;
  const took = best ?? first;
  const place = took.at.kind === "split" ? `${PLACE_WORDS[took.at.dir]} ${name}` : `along the screen's ${(took.at as { dir: Dir }).dir} edge`;
  if (b.prefers === "beside") {
    // A float would cover the tile the person types in: it stays beside, said.
    if (ctx.protectTyping && b.target === ctx.person.typingIn) { took.d.answer = { ...took.d.answer, where: whereWord(took.at), why: `${narrow}, so it went ${place}: floating, it would cover the tile being typed in` }; return took.d; }
    return floats(narrow);
  }
  took.d.answer = { ...took.d.answer, where: whereWord(took.at), why: `${narrow}, and it went ${place}${b.prefers === "there" ? ", as asked" : ""}` };
  return took.d;
}
const narrowWhy = (name: string, r: Rect, needs: { cols: number; rows: number }) => `beside ${name} it is ${r.cols}×${r.rows}, under the ${needs.cols}×${needs.rows} a tile reads at`;
