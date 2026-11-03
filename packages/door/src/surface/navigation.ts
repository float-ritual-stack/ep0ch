import type { Key } from "../term";
import { printable } from "../props";
import { C, drawEllipsized, fg, RESET, width } from "../style";
import { subject, type Msg } from "../board";
import type { NoteAddress } from "../desk/outline-boards";
import type { FragmentKind } from "@ep0ch/outline-core/protocol";
import type { Density } from "../graphs";
import type { ReaderPosition } from "../reader-position";

/**
 * Where a reader was (PIE-453), so back comes back to it as it was: the note, how far down, the `[ ]`
 * position (the current element and link), and the reading state kept per note (folds, expanded threads).
 */
export interface Place { msg: Msg; position: ReaderPosition; cur: string | null; link: number; folded: string[]; previewLists: [string, boolean][]; previewOpen: string[]; expanded: string[]; foldedThreads: string[]; seen: string[]; figures: [string, FigureChoice][]; zoom?: Zoom | null }
/**
 * The part of its note a reader is zoomed into (PIE-780): the lines the service says it covers (`fragments.at`, the part
 * element.detach takes), its anchor when it has one, and the revision they were read at. Reading state, never the note's.
 */
export interface Zoom { start: number; end: number; line: number; kind: FragmentKind; label: string; anchor?: string; revision: number; head?: string }
/** What the person (or an agent) chose for one live figure in a reader: its tab, its density. Never the note's text. */
export type FigureChoice = { tab?: string; density?: Density; expanded?: number[] };
/** How many places back (and forward) a reader keeps. */
export const HISTORY = 50;

/**
 * A reader's place and history as a layout file keeps them (PIE-643). `v` is this shape's version: a file of another
 * version (an older daemon's, a newer one's) is read as having no history, never half-read.
 */
export const NAV_VERSION = 2;
export interface SavedPlace { address?: NoteAddress; id: string; title: string; position: ReaderPosition; cur: string | null; link: number; folded: string[]; previewLists?: [string, boolean][]; previewOpen?: string[]; expanded: string[]; foldedThreads: string[]; seen: string[]; figures: [string, FigureChoice][]; zoom?: Zoom }
export interface SavedNav { v: typeof NAV_VERSION; here?: SavedPlace; backs: SavedPlace[]; aheads: SavedPlace[] }

export const savedPlace = (p: Place): SavedPlace => ({ ...(p.msg.address ? { address: p.msg.address } : {}), id: p.msg.id, title: subject(p.msg), position: structuredClone(p.position), cur: p.cur, link: p.link, folded: p.folded, previewLists: p.previewLists, previewOpen: p.previewOpen, expanded: p.expanded, foldedThreads: p.foldedThreads, seen: p.seen, figures: p.figures, ...(p.zoom ? { zoom: p.zoom } : {}) });
/** A saved place as a stub the reader reads whole when it goes there (a list row's shape: `partial`). */
export const placeOf = (s: SavedPlace): Place => ({
  msg: { ...(s.address ? { address: s.address } : {}), id: s.id, text: s.title, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, properties: [], partial: true },
  position: structuredClone(s.position), cur: s.cur, link: s.link, folded: s.folded, previewLists: s.previewLists ?? [], previewOpen: s.previewOpen ?? [], expanded: s.expanded, foldedThreads: s.foldedThreads, seen: s.seen, figures: s.figures, zoom: s.zoom ?? null,
});
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
function readPlace(x: any): SavedPlace | null {
  if (!x || typeof x.id !== "string" || !x.id || typeof x.title !== "string") return null;
  const int = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(d < 0 ? -1 : 0, Math.floor(n)) : d);
  const figures = (Array.isArray(x.figures) ? x.figures : []).filter((f: unknown): f is [string, FigureChoice] => Array.isArray(f) && typeof f[0] === "string" && !!f[1] && typeof f[1] === "object");
  if (x.previewLists !== undefined && (!Array.isArray(x.previewLists) || !x.previewLists.every((p: unknown) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "boolean")) || x.previewOpen !== undefined && !Array.isArray(x.previewOpen)) return null;
  const p = x.position;
  if (!p || !p.cursor || (p.view !== null && (!p.view || !Number.isFinite(p.view.line) || !Number.isFinite(p.view.row)))) return null;
  const position: ReaderPosition = { reading: int(p.reading, 0), cursor: { row: int(p.cursor.row, 0), col: int(p.cursor.col, 0) }, view: p.view === null ? null : { line: int(p.view.line, 0), row: Math.floor(p.view.row) } };
  return { ...(x.address && typeof x.address.outline === "string" && (x.address.machine === undefined || typeof x.address.machine === "string") ? { address: x.address } : {}), id: x.id, title: x.title, position, cur: typeof x.cur === "string" ? x.cur : null, link: int(x.link, -1), folded: strings(x.folded), previewLists: x.previewLists ?? [], previewOpen: strings(x.previewOpen), expanded: strings(x.expanded), foldedThreads: strings(x.foldedThreads), seen: strings(x.seen), figures, ...(readZoom(x.zoom) ? { zoom: readZoom(x.zoom)! } : {}) };
}
/** A saved zoom (PIE-780), or null for anything that isn't one: it's left out, never half-read. */
function readZoom(z: any): Zoom | null {
  const n = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return z && n(z.start) && n(z.end) && n(z.line) && n(z.revision) && z.end >= z.start && typeof z.kind === "string" && typeof z.label === "string" && (z.anchor === undefined || typeof z.anchor === "string") && (z.head === undefined || typeof z.head === "string") ? z : null;
}
/** The note a saved history was taken on, if it is one this version reads. */
export const navNote = (raw: unknown): string | null => readNav(raw)?.here?.id ?? null;
/** A saved history as this version reads it: null for another version or anything that isn't one. */
export function readNav(raw: unknown): SavedNav | null {
  const x = raw as any;
  if (!x || typeof x !== "object" || x.v !== NAV_VERSION) return null;
  const list = (l: unknown) => (Array.isArray(l) ? l.map(readPlace).filter((p): p is SavedPlace => !!p).slice(-HISTORY) : []);
  const here = readPlace(x.here);
  return { v: NAV_VERSION, ...(here ? { here } : {}), backs: list(x.backs), aheads: list(x.aheads) };
}

/**
 * A reader's history keys (PIE-453): alt+←, backspace or the mouse's back button go back; alt+→ or its forward
 * button go forward. alt+b and alt+f too: some macOS terminals send them for option+← and option+→.
 */
/** The trail's key (PIE-208): alt+T, beside back's alt+← and forward's alt+→. */
export const isTrailKey = (k: Key) => k.kind === "alt" && k.ch === "T";

export function historyKey(k: Key): -1 | 1 | 0 {
  if (k.kind === "alt-left" || k.kind === "backspace" || k.kind === "back" || (k.kind === "alt" && k.ch === "b")) return -1;
  if (k.kind === "alt-right" || k.kind === "forward" || (k.kind === "alt" && k.ch === "f")) return 1;
  return 0;
}

/**
 * The history row a reader draws last while it has somewhere to go (PIE-453): `← back · <title>` on the left,
 * `<title> · forward →` on the right, each a click (`hits`, in the row's cells). Null with nowhere to go.
 */
export function historyRow(w: number, back: string | null, forward: string | null, trail = true): { line: string; hits: { from: number; to: number; dir: TrailDir }[] } | null {
  if ((!back && !forward) || w < 8) return null;
  // The trail's chip (PIE-208) after back, where the row has room for it beside both titles.
  const chip = trail && w >= TRAIL_CHIP_MIN ? TRAIL_CHIP : "", chipW = chip ? width(chip) + 2 : 0;
  const room = back && forward ? Math.floor((w - 3 - chipW) / 2) : w - 2 - chipW;
  // Narrow (a preview at 40 columns, PIE-1426): the title goes before the words do, and the words before the arrow,
  // so the row always says which way each click goes, never "← ba…".
  const side = (word: string, title: string, arrow: string, before: boolean) => {
    if (room >= width(word) + 6) {
      const t = `${fg(C.dark)}${drawEllipsized(printable(title), room - width(word) - 3)}`;
      return before ? `${fg(C.lcyan)}${word}${fg(C.dark)} · ${t}` : `${t}${fg(C.dark)} · ${fg(C.lcyan)}${word}`;
    }
    return `${fg(C.lcyan)}${room >= width(word) ? word : arrow}`;
  };
  const b = back ? side("← back", back, "←", true) : "", f = forward ? side("forward →", forward, "→", false) : "";
  const hits: { from: number; to: number; dir: TrailDir }[] = [];
  let line = "", at = 0;
  if (b) { line += " " + b + RESET; hits.push({ from: 0, to: 1 + width(b), dir: -1 }); at = 1 + width(b); }
  if (chip) {
    const from = at + (b ? 2 : 1);
    line += " ".repeat(from - at) + fg(C.lcyan) + chip + RESET;
    hits.push({ from, to: from + width(chip), dir: 0 });
    at = from + width(chip);
  }
  if (f) {
    const from = w - 1 - width(f);
    line += " ".repeat(Math.max(1, from - at)) + f + RESET;
    hits.push({ from, to: w, dir: 1 });
  }
  return { line, hits };
}

/** A history row's click: back (-1), the trail (0, PIE-208) or forward (1). */
export type TrailDir = -1 | 0 | 1;
/** The action a history row's click runs. */
export const historyAction = (dir: TrailDir) => (dir < 0 ? "back" : dir > 0 ? "forward" : "trail") as "back" | "forward" | "trail";
/** The trail's chip on the history row, and the narrowest row that draws it. */
export const TRAIL_CHIP = "≡ trail";
const TRAIL_CHIP_MIN = 40;
/** One stop on a reader's trail (PIE-208): the note there, by its title as it was when the reader was there. */
export interface TrailStop { id?: string; title: string; address?: Msg["address"] }
/** A reader's trail as the trail answers it: the note shown, the stops back and forward, nearest first. */
export interface Trail { here: { id: string; title: string } | null; back: TrailStop[]; forward: TrailStop[]; keptBy?: string }
/** One row of the trail as its list and its tile draw it: the stops ahead (→) above the note shown (●), the ones back (←) below. */
export interface TrailRow { dir: -1 | 0 | 1; steps: number; title: string }
export const trailRows = (t: Trail): TrailRow[] => [
  ...t.forward.map((s, i) => ({ dir: 1 as const, steps: i + 1, title: s.title })).reverse(),
  { dir: 0, steps: 0, title: t.here?.title ?? "(nothing shown)" },
  ...t.back.map((s, i) => ({ dir: -1 as const, steps: i + 1, title: s.title })),
];
/** A trail row's words: `← title · 2 back`, `● title · here`. */
export const trailLine = (r: TrailRow) => ` ${r.dir < 0 ? "←" : r.dir > 0 ? "→" : "●"} ${printable(r.title)}${r.dir ? ` · ${r.steps} ${r.dir < 0 ? "back" : "ahead"}` : " · here"}`;
