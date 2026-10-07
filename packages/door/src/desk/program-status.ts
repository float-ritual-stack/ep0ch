// Program status in the door's terminal tiles (OSC 7501, PIE-614). The door is the terminal here: each terminal tile
// keeps the records its program reports (outline-core's `StatusRecords`, the one reader, read off what the program
// writes through the emulator's OSC handler, src/desk/pty.ts), answers the feature query, and drops them on the
// spec's events (the program exits, a new prompt, a full reset). What the door does with them is its own: a glyph on
// the tile's header, the drawer's chip, the status bar's count, the "waiting on you" list (blocked, done and failed
// across every terminal tile), `peek` and the live feed, and the door's own report to the terminal it runs in.
//
// Seeing is the person's: a `done` or `error` goes when they come back to the tile (a key, a click, the keys given
// to it) or dismiss it from the list. Nothing here guesses: a tile with no records keeps the old ways (its output's
// timing, Herdr's status) as the fallback.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ATTENTION, encodeProgramStatus, parseProgramStatus, PROGRAM_STATUS_QUERY, PROGRAM_STATUS_TERMINFO, statusDisplayText,
  StatusRecords, statusSegment, type StatusInput, type StatusRecord,
} from "@ep0ch/outline-core/program-status";
import { C, fg } from "../style";

/** What holds a tile's records: a terminal tile (PtyPane), named as the door names it. */
export interface StatusHolder {
  readonly status: TileStatus;
  /** What the list and the door's own report call it (the tile's name, else its program). */
  statusName(): string;
  /** Its tile id (`t3`, a drawer tab's `k2`), once it has one. */
  readonly tileId: string | null;
  /** The layout it was started in (`desk`, `daily`): its child id in the door's own report. */
  readonly place?: string | null;
}

/** One terminal tile's records and when they last changed. */
export class TileStatus {
  readonly records = new StatusRecords();
  /** When its records last changed (Date.now()). */
  at = 0;

  /**
   * One OSC 7501 body the program wrote. The feature query is answered through `reply` (null while a kept program's
   * output is replayed: it was answered then); a report is applied whole or not at all.
   */
  feed(body: string, reply: ((bytes: string) => void) | null): void {
    const p = parseProgramStatus(body);
    if (p.t === "query") { reply?.(PROGRAM_STATUS_QUERY); return; }
    if (p.t === "report" && this.records.apply(p.report)) this.changed();
  }
  /** The program exited: `working` and `blocked` go; `done` and `error` stay for the person. */
  exited(): void { if (this.records.exited()) this.changed(); }
  /** A new shell prompt (OSC 133 A). */
  prompt(): void { if (this.records.prompt()) this.changed(); }
  /** A full reset (RIS). */
  reset(): void { if (this.records.reset()) this.changed(); }
  /** The person saw it: `done` and `error` go. True when something went. */
  seen(): boolean { const gone = this.records.seen(); if (gone) this.changed(); return gone; }
  /** The record asking most of the person, or null. */
  urgent(): StatusRecord | null { return this.records.urgent(); }
  private changed() { this.at = Date.now(); notify(); }
}

const HOLDERS = new Set<StatusHolder>();
const LISTENERS = new Set<() => void>();
let notifying = false;
/** Something changed: listeners hear once per tick, however many reports came in it. */
function notify() {
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => { notifying = false; for (const f of [...LISTENERS]) f(); });
}

/** A terminal tile is on the door (its first start); `dropStatus` when it closes. */
export function holdStatus(h: StatusHolder): void { if (!HOLDERS.has(h)) { HOLDERS.add(h); if (h.status.records.size) notify(); } }
export function dropStatus(h: StatusHolder): void { if (HOLDERS.delete(h) && h.status.records.size) notify(); }
/** Hear every change to any tile's records (the status bar, the list, the door's own report). Returns the unsubscribe. */
export function onStatusChange(f: () => void): () => void { LISTENERS.add(f); return () => LISTENERS.delete(f); }
/** Every terminal tile with records now. */
export function statusHolders(): StatusHolder[] { return [...HOLDERS].filter(h => h.status.records.size > 0); }

/** One row of the "waiting on you" list: a record that asks something of the person, and its tile. */
export interface WaitingRow { holder: StatusHolder; name: string; tile: string | null; record: StatusRecord; at: number }

/** What asks something of the person, across every terminal tile: blocked first, then failed, then done; newest first within each. */
export function waitingOnYou(): WaitingRow[] {
  const rows: WaitingRow[] = [];
  for (const h of HOLDERS) for (const r of h.status.records.list()) {
    if (r.state === "blocked" || r.state === "done" || r.state === "error") rows.push({ holder: h, name: h.statusName(), tile: h.tileId, record: r, at: h.status.at });
  }
  return rows.sort((a, b) => ATTENTION[b.record.state] - ATTENTION[a.record.state] || b.at - a.at);
}

/** How many of each the list holds: the status bar's count. */
export function waitingCounts(rows = waitingOnYou()): { blocked: number; error: number; done: number } {
  const n = { blocked: 0, error: 0, done: 0 };
  for (const r of rows) n[r.record.state as keyof typeof n]++;
  return n;
}

const SPIN = ["◴", "◷", "◶", "◵"] as const;
/** How a state is drawn: its glyph, its colour, and its word. Calm: the spinner turns once a second, when the screen is painted anyway. */
export function statusMark(r: Pick<StatusRecord, "state" | "kind" | "progress">, now = Date.now()): { glyph: string; sgr: string; word: string } {
  switch (r.state) {
    case "working": return { glyph: SPIN[Math.floor(now / 1000) % SPIN.length]!, sgr: fg(C.yellow), word: r.progress !== undefined ? `working ${r.progress}%` : "working" };
    case "blocked": return { glyph: r.kind === "question" ? "?" : r.kind === "auth" ? "⚿" : "◆", sgr: fg(C.lmagenta), word: r.kind === "question" ? "asks you" : r.kind === "auth" ? "needs a login" : "needs you" };
    case "done": return { glyph: "✓", sgr: fg(C.lgreen), word: "done" };
    case "error": return { glyph: "✗", sgr: fg(C.lred), word: "failed" };
    default: return { glyph: "·", sgr: fg(C.dark), word: "idle" };
  }
}

/** A record's text as the door shows it, outside the program's own grid: invisible formatting taken out. */
export function recordText(r: StatusRecord): string { return statusDisplayText(r.msg ?? r.title ?? ""); }

/** A record as `peek`, the live feed and `status.list` give it. */
export function recordFacts(r: StatusRecord): Record<string, unknown> {
  return { id: r.id, state: r.state, ...(r.kind ? { kind: r.kind } : {}), ...(r.progress !== undefined ? { progress: r.progress } : {}), ...(r.app ? { app: r.app } : {}), ...(r.title ? { title: statusDisplayText(r.title) } : {}), ...(r.msg ? { msg: statusDisplayText(r.msg) } : {}) };
}

/** The last state dir asked about, and its answer: asked again when the dir changes or its folder went. */
let terminfoTried: { state: string; dir: string | null } | null = null;
/**
 * A terminfo folder whose xterm-256color (the TERM a terminal tile gets) carries `Pst`, the spec's capability saying the
 * door speaks the protocol: compiled once, from this machine's own entry plus Pst, into the door's state (`tic -x`).
 * Prepended to TERMINFO_DIRS for a tile's program, so `tput Pst` finds it and everything else is found as before. Null
 * where there is no infocmp or tic (the query, OSC 7501 ; ?, still says so).
 */
export function terminfoWithPst(stateDir: string): string | null {
  if (terminfoTried?.state === stateDir && (terminfoTried.dir === null || existsSync(terminfoTried.dir))) return terminfoTried.dir;
  terminfoTried = { state: stateDir, dir: null };
  const dir = join(stateDir, "terminfo");
  try {
    // Compiled already (by an earlier door on this state): ncurses files it under x/ (Linux) or 78/ (macOS).
    if (existsSync(dir) && readdirSync(dir).some(d => d === "x" || d === "78")) return (terminfoTried.dir = dir);
    const src = spawnSync("infocmp", ["-x", "xterm-256color"], { encoding: "utf8", timeout: 3000 });
    if (src.status !== 0 || !src.stdout.includes("xterm-256color")) return null;
    const entry = `${src.stdout.trimEnd().replace(/,\s*$/, ",")}\n\t${PROGRAM_STATUS_TERMINFO},\n`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tic = spawnSync("tic", ["-x", "-o", dir, "-"], { input: entry, encoding: "utf8", timeout: 5000 });
    if (tic.status !== 0) return null;
    return (terminfoTried.dir = dir);
  } catch { return null; }
}

// ── the door as a program: what it reports to the terminal it runs in ─────────

/**
 * The door's own report (the door as a program in Ghostty, Rex, maybe Herdr): the root record holds what asks most of
 * the person across its terminal tiles (idle when nothing does), and each tile with records is a child,
 * `<layout>/<tile>` (`desk/claude`, `drawer/shell`), with its program's app and words and the tile's name as its
 * title. Herdr's sidebar (or any terminal) can then see what waits inside a door without reading its screen.
 */
export function doorReport(holders: readonly StatusHolder[] = statusHolders()): Map<string, StatusInput> {
  const want = new Map<string, StatusInput>();
  let top: { r: StatusRecord; name: string } | null = null;
  for (const h of holders) {
    const r = h.status.urgent();
    if (!r) continue;
    const name = h.statusName();
    const layout = statusSegment(h.place || "door"), base = statusSegment(name);
    let id = `${layout}/${base}`;
    // Two tiles of one name: the later one's segment ends in its tile id, kept within a segment's 32 bytes.
    for (let n = 0; want.has(id); n++) {
      const tag = `-${statusSegment(h.tileId ?? "t").slice(0, 8)}${n ? n : ""}`;
      id = `${layout}/${base.slice(0, 32 - tag.length)}${tag}`;
    }
    want.set(id, { state: r.state, id, ...(r.kind ? { kind: r.kind } : {}), ...(r.progress !== undefined ? { progress: r.progress } : {}), ...(r.app ? { app: r.app } : {}), title: name, ...(r.msg ? { msg: statusDisplayText(r.msg) } : {}) });
    if (!top || ATTENTION[r.state] > ATTENTION[top.r.state]) top = { r, name };
  }
  const msg = top && top.r.state !== "idle" ? `${top.name} ${statusMark(top.r).word}${top.r.msg ? `: ${statusDisplayText(top.r.msg)}` : ""}` : undefined;
  want.set("", { state: top?.r.state ?? "idle", app: "ep0ch", ...(top?.r.state === "blocked" && top.r.kind ? { kind: top.r.kind } : {}), ...(msg ? { msg } : {}) });
  return want;
}

/**
 * What one terminal has been told (the door's own, or a session's client's): `sync` writes only what changed since, a
 * child that went as `clear` for its id, all in one write. A terminal attached later starts with nothing told.
 */
export class StatusReporter {
  private told = new Map<string, string>();
  constructor(private readonly write: (bytes: string) => void) {}
  sync(want: ReadonlyMap<string, StatusInput>): void {
    let out = "";
    for (const id of this.told.keys()) if (!want.has(id)) { out += encodeProgramStatus({ state: "clear", id }); this.told.delete(id); }
    for (const [id, r] of want) {
      const seq = encodeProgramStatus(r);
      if (this.told.get(id) !== seq) { out += seq; this.told.set(id, seq); }
    }
    if (out) this.write(out);
  }
  /** Forget what the terminal was told (a program had it meanwhile, and may have changed or cleared it): the next sync says all again. */
  forget(): void { this.told.clear(); }
  /** Every record this door put on the terminal goes (it quits, or the terminal detaches). */
  clear(): void { if (this.told.size) { this.told.clear(); this.write(encodeProgramStatus({ state: "clear" })); } }
}
