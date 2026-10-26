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
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTENTION, encodeProgramStatus, parseProgramStatus, PROGRAM_STATUS_QUERY, PROGRAM_STATUS_TERMINFO, statusDisplayText,
  StatusRecords, statusSegment, tileReply, type ProgramState, type StatusInput, type StatusRecord, type StatusReport,
} from "@ep0ch/outline-core/program-status";
import { C, ellipsize, fg } from "../style";


/**
 * The terminal's foreground process group, read from the tile's own process (Linux's /proc/<pid>/stat `tpgid`); null
 * where there's no /proc (macOS) or the process is gone.
 */
export function foregroundGroup(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const tpgid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[5]);
    return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
  } catch { return null; }
}

/** What holds a tile's records: a terminal tile (PtyPane), named as the door names it. */
export interface StatusHolder {
  readonly status: TileStatus;
  /** What the list and the door's own report call it (the tile's name, else its program). */
  statusName(): string;
  /** Its tile id (`t3`, a drawer tab's `k2`), once it has one. */
  readonly tileId: string | null;
  /**
   * The door it's on, by its host layer (the drawer: one per App, the same through a screen's frame): each door shows
   * and reports its own tiles, never another door's in the same process.
   */
  readonly door?: unknown;
  /** Its child id in the door's own report: given once (`newStatusKey`), kept wherever the tile moves. */
  readonly statusKey: string;
}

/** One terminal tile's records and when they last changed. */
export class TileStatus {
  readonly records = new StatusRecords();
  /** When its records last changed (the clock's now). */
  at = 0;
  /**
   * How long each record's job has run, by the record's id: `since` is when it turned `working` (kept through a `blocked`
   * ask, whose wait is taken out), and a `done` or `error` closes it into `ran`. A record's own clock: a child finishing
   * never ends its parent's.
   */
  private readonly runs = new Map<string, { since: number | null; ran: number | null; state: ProgramState; blockedAt: number | null }>();
  constructor(private readonly now: () => number = Date.now) {}
  /**
   * Who runs here, by what the program says (the `app` of the latest root report): the one answer to "which
   * agent is in this terminal" that needs no /proc (agent-sessions.ts `agentOfApp` reads it). It is not a record: `idle`,
   * `done` and `error` stay for the person after the program is gone, but the program isn't there. So it goes when the
   * program says so (a `clear` that leaves no record), exits, a new prompt begins (OSC 133 A) or the terminal is reset.
   */
  app: string | null = null;

  /**
   * One OSC 7501 body the program wrote. The feature query is answered through `reply` (null while a kept program's
   * output is replayed: it was answered then, and a marker in it was asked about then); a report is applied whole or not at all.
   */
  feed(body: string, reply: ((bytes: string) => void) | null, tile?: () => string): void {
    const p = parseProgramStatus(body);
    if (p.t === "query") { reply?.(PROGRAM_STATUS_QUERY); return; }
    // Which tile (PIE-1306): asked on the program's input when it can read it, else kept as a marker for `host.tileOf mark=`.
    if (p.t === "tile") { if (tile) reply?.(tileReply(tile())); return; }
    if (p.t === "mark") { if (reply) this.marked(p.token); return; }
    if (p.t !== "report") return;
    this.report(p.report);
  }
  /** The markers its program wrote, newest last (a few: a program asks right after it writes one). */
  private readonly marks: string[] = [];
  private marked(token: string) {
    if (!this.marks.includes(token)) this.marks.push(token);
    if (this.marks.length > 8) this.marks.shift();
  }
  /** Whether its program wrote the marker `token` (`host.tileOf mark=`). */
  saw(token: string): boolean { return this.marks.includes(token); }
  /** One report as read, whoever wrote it: the escape sequence above, or a test. */
  report(r: StatusReport): void {
    const applied = this.records.apply(r);
    this.track(r);
    // Only the root record names who runs here: a door's child records name its tiles' programs, not the door's.
    if (r.state === "clear") { if (this.records.size === 0) this.app = null; }
    else if (r.id === "") this.app = r.app ?? null;
    if (applied) this.changed();
  }
  /** The program exited: `working` and `blocked` go; `done` and `error` stay for the person. */
  exited(): void { this.app = null; if (this.records.exited()) this.changed(); }
  /** A new shell prompt (OSC 133 A). */
  prompt(): void { this.app = null; if (this.records.prompt()) this.changed(); }
  /** A full reset (RIS). */
  reset(): void { this.app = null; if (this.records.reset()) this.changed(); }
  /** The person saw it: `done` and `error` go. True when something went. */
  seen(): boolean { const gone = this.records.seen(); if (gone) this.changed(); return gone; }
  /** The record asking most of the person, or null. */
  urgent(): StatusRecord | null { return this.records.urgent(); }
  private changed() { this.prune(); this.at = this.now(); notify(this); }
  /** How long `id`'s job ran, once it is `done` or `failed`; null when the door never saw it work. */
  ranOf(id: string): number | null { return this.runs.get(id)?.ran ?? null; }
  private track(r: StatusReport) {
    if (r.state === "clear") return;
    const now = this.now(), run = this.runs.get(r.id) ?? { since: null, ran: null, state: r.state, blockedAt: null };
    // Time spent waiting on the person is theirs, not the job's: a run that sat blocked for ten minutes and then took five seconds took five seconds.
    if (r.state === "blocked") run.blockedAt ??= now;
    else if (run.blockedAt !== null) { if (run.since !== null) run.since += now - run.blockedAt; run.blockedAt = null; }
    if (r.state === "working") run.since ??= now;
    else if (r.state === "done" || r.state === "error") {
      if (run.since !== null) run.ran = now - run.since;
      else if (run.state !== r.state) run.ran = null;
      run.since = null;
    } else if (r.state !== "blocked") { run.since = null; run.ran = null; }
    run.state = r.state;
    this.runs.set(r.id, run);
  }
  /** A record that went (cleared, seen, its program exited) takes its clock with it. */
  private prune() { for (const id of this.runs.keys()) if (!this.records.get(id)) this.runs.delete(id); }
}

const HOLDERS = new Set<StatusHolder>();
const LISTENERS = new Map<() => void, unknown>();
/** The doors whose tiles changed since listeners last heard (undefined: a tile on no door yet, heard by all). */
const changedDoors = new Set<unknown>();
let notifying = false;
const doorOf = (s: TileStatus | StatusHolder): unknown => ("status" in s ? s : [...HOLDERS].find(h => h.status === s))?.door;
/** Something changed: each door's listeners hear once per tick, however many reports came in it, and only for their own tiles. */
function notify(from: TileStatus | StatusHolder) {
  changedDoors.add(doorOf(from));
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    const doors = [...changedDoors];
    changedDoors.clear();
    for (const [f, door] of [...LISTENERS]) if (door === undefined || doors.includes(door) || doors.includes(undefined)) f();
  });
}

/** A terminal tile is on the door (its first start); `dropStatus` when it closes. */
export function holdStatus(h: StatusHolder): void { if (!HOLDERS.has(h)) { HOLDERS.add(h); if (h.status.records.size) notify(h); } }
export function dropStatus(h: StatusHolder): void { if (HOLDERS.has(h)) { const had = h.status.records.size > 0; if (had) notify(h); HOLDERS.delete(h); } }
/**
 * Hear changes to the records of `door`'s tiles (its status bar, its list, its own report); undefined: every door's.
 * Returns the unsubscribe.
 */
export function onStatusChange(f: () => void, door?: unknown): () => void { LISTENERS.set(f, door); return () => LISTENERS.delete(f); }
/** `door`'s terminal tiles with records now (undefined: every door's in this process). */
export function statusHolders(door?: unknown): StatusHolder[] { return [...HOLDERS].filter(h => h.status.records.size > 0 && (door === undefined || h.door === door)); }

/** One row of the "waiting on you" list: a record that asks something of the person, and its tile. */
export interface WaitingRow { holder: StatusHolder; name: string; tile: string | null; record: StatusRecord; at: number }

/** What asks something of the person, across every terminal tile: blocked first, then failed, then done; newest first within each. */
export function waitingOnYou(door?: unknown): WaitingRow[] {
  const rows: WaitingRow[] = [];
  for (const h of statusHolders(door)) for (const r of h.status.records.list()) {
    if (r.state === "blocked" || r.state === "done" || r.state === "error") rows.push({ holder: h, name: h.statusName(), tile: h.tileId, record: r, at: h.status.at });
  }
  return rows.sort((a, b) => ATTENTION[b.record.state] - ATTENTION[a.record.state] || b.at - a.at);
}

/** How many of each the list holds: the status bar's count. */
export function waitingCounts(rows: readonly WaitingRow[]): { blocked: number; error: number; done: number } {
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

/** The tiles the door's own report names, most urgent first: 63, and the root makes the 64 records a terminal must keep. */
export const DOOR_CHILDREN = 63;
let keys = 0;
/** A tile's key in the door's report: its name and a number, given once, so it stays the same wherever the tile moves. */
export function newStatusKey(name: string): string { return `${statusSegment(name).slice(0, 24)}.${++keys}`; }

/** How long a change to the root waits to see whether it holds: a flap back inside it is never sent. */
export const NUDGE_SETTLE_MS = 4000;
/** A job that ran this long is one a person who left it wants to hear is done. */
export const LONG_JOB_MS = 2 * 60_000;
/** The most a nudge's words say of what the program wrote. */
const NUDGE_WORDS = 100;

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
/** A program's own words as one short line. */
const wordsOf = (r: StatusRecord) => { const t = recordText(r).split("\n").map(l => l.trim()).find(l => l) ?? ""; return t ? ellipsize(t, NUDGE_WORDS) : ""; };

/** What a blocked record asks, by its kind. */
const ASKS = { permission: "approve", question: "asks", auth: "login" } as const;

/**
 * What a tile says to a person who isn't looking at the door, as the root's report: who and where (the tile, in the
 * outline), then what, in the program's own words: a blocked record's ask by its kind, a failure's reason, a long job's
 * last line and how long it ran. Never a bare state word. Null for what asks nothing of an absent person: working,
 * idle, and a done that wasn't a long job.
 */
export function nudgeOf(h: StatusHolder, r: StatusRecord, where: string): StatusInput | null {
  const who = `${h.statusName()} in ${where}`, words = wordsOf(r);
  switch (r.state) {
    case "blocked": {
      const msg = r.kind === "permission" ? (words ? `${who} · ${ASKS.permission}: ${words}` : `${who} wants your approval`)
        : r.kind === "question" ? (words ? `${who} · ${ASKS.question}: ${words}` : `${who} asks you a question`)
        : r.kind === "auth" ? (words ? `${who} · ${ASKS.auth}: ${words}` : `${who} needs a login`)
        : words ? `${who} needs you: ${words}` : `${who} needs you`;
      return { state: "blocked", app: "ep0ch", ...(r.kind ? { kind: r.kind } : {}), msg };
    }
    case "error": {
      const ran = h.status.ranOf(r.id);
      return { state: "error", app: "ep0ch", msg: words ? `${who} failed: ${words}` : ran !== null ? `${who} failed after ${minutes(ran)}` : `${who} failed` };
    }
    case "done": {
      const ran = h.status.ranOf(r.id);
      if (ran === null || ran < LONG_JOB_MS) return null;
      return { state: "done", app: "ep0ch", msg: words ? `${who} · ${minutes(ran)}: ${words}` : `${who} finished after ${minutes(ran)}` };
    }
    default: return null;
  }
}

/**
 * The door's own report (the door as a program in Ghostty, Rex, Tern, Herdr): the root record holds what a person away
 * from the door needs to hear (a tile blocked on them, then a failure, then a long job's done; the order is
 * blocked, error, done, newest first), worded by `nudgeOf`; with nothing to say it is a quiet idle, and working, idle,
 * progress and rewording never move it. Each tile with records is a child one level down, by its key (`claude.3`): its
 * program's app and words, the tile's name as its title, for a terminal that shows the tree (Herdr's sidebar; the
 * painter leaves them out for the rest). `where` is the outline the door is on.
 */
export function doorReport(holders: readonly StatusHolder[], where: string): Map<string, StatusInput> { return doorReportOf(holders, where).want; }

/**
 * `doorReport` and the root's identity: which nudge it is (its state, its kind and the tile it is about, "" for none),
 * so that a program rewording itself is the same nudge, and a different tile asking is a new one.
 */
export function doorReportOf(holders: readonly StatusHolder[], where: string): { want: Map<string, StatusInput>; key: string } {
  const want = new Map<string, StatusInput>();
  // Most urgent first, at most CHILDREN of them: with the root, within the 64 records every terminal must keep.
  const shown = holders.map(h => ({ h, r: h.status.urgent() })).filter((x): x is { h: StatusHolder; r: StatusRecord } => !!x.r)
    .sort((a, b) => ATTENTION[b.r.state] - ATTENTION[a.r.state] || b.h.status.at - a.h.status.at).slice(0, DOOR_CHILDREN);
  for (const { h, r } of shown) {
    // One level, by the tile's own key (kept for its life, wherever it's moved): a program's own child records stay its tile's.
    const id = h.statusKey;
    const name = h.statusName();
    // Progress in tens: a program ticking its percentage isn't a storm of reports upward.
    const progress = r.progress === undefined ? undefined : Math.round(r.progress / 10) * 10;
    want.set(id, { state: r.state, id, ...(r.kind ? { kind: r.kind } : {}), ...(progress !== undefined ? { progress } : {}), ...(r.app ? { app: r.app } : {}), title: name, ...(r.msg ? { msg: statusDisplayText(r.msg) } : {}) });
  }
  // The root: the first tile (in that order) with something to say. A tile's own most urgent record is the one told.
  let nudge: StatusInput | null = null, key = "";
  for (const x of shown) {
    nudge = nudgeOf(x.h, x.r, where);
    if (nudge) { key = `${nudge.state}|${nudge.kind ?? ""}|${x.h.statusKey}`; break; }
  }
  want.set("", nudge ?? QUIET);
  return { want, key };
}

/** The root with nothing to say. */
const QUIET: StatusInput = { state: "idle", app: "ep0ch" };

/**
 * What the door says to its terminal, as a policy over `doorReport`: the children as they are, and the root only
 * once a change of nudge has held for `settleMs` (a tile that asked and was answered within it, or a flap of any kind,
 * sends nothing; a program rewording its ask is the same nudge, sent once). Leaving a nudge sends an idle that says what
 * is no longer waiting. One per door, with the door's clock;
 * the App asks `report` when something changed and `due` from its tick, so a held change goes out on time.
 */
export class DoorReporter {
  /** The root the terminals have, and which nudge it is (`doorReportOf`'s key; "" for none): the same nudge reworded is not a new one. */
  private told: StatusInput = QUIET;
  private toldKey = "";
  /** A change waiting out its hold: which nudge, and since when. */
  private held: { key: string; at: number } | null = null;
  constructor(private readonly where: () => string, private readonly now: () => number, private readonly settleMs = NUDGE_SETTLE_MS) {}

  report(holders: readonly StatusHolder[]): Map<string, StatusInput> {
    const where = this.where();
    const { want, key } = doorReportOf(holders, where);
    const now = this.now();
    if (key === this.toldKey) this.held = null;
    else {
      if (this.held?.key !== key) this.held = { key, at: now };
      if (now - this.held.at >= this.settleMs) {
        this.held = null;
        this.toldKey = key;
        this.told = key === "" ? { state: "idle", app: "ep0ch", msg: `nothing waits on you in ${where}` } : want.get("")!;
      }
    }
    want.set("", this.told);
    return want;
  }
  /** A change has waited out its hold: ask `report` again. */
  due(): boolean { return this.held !== null && this.now() - this.held.at >= this.settleMs; }
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
