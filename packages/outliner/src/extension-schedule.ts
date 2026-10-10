import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionSchedule, LoadedExtension } from "./extension-manifest";

/**
 * Schedules (PIE-754): a handler or an action an extension declares with `schedule` runs by itself, every N or on a
 * cron, and each run is recorded (last, next, result) and listed by `extensions.list`, `ext ls` and the door.
 *
 * - A scheduled **action** (`on: "outline"`) runs through `extensions.act` with no block: its returned writes and
 *   whatever its process writes over `EP0CH_SOCKET` are the extension's (`ext:<id>`), with no `requestedBy` (no
 *   person or agent asked).
 * - A scheduled **data handler** fetches again every key the outline asks it for; an **output or component
 *   handler** runs again every line of it in the outline.
 *
 * Runs are per outline, like everything an extension does: a folder in an outline's `extensions/` runs there; one
 * in the user folder serves every outline the host opens, so its schedule runs in each (`EP0CH_WS` says which),
 * unless it says `once: "host"` (PIE-767): then one outline's runner holds it for the whole host (the first to see it,
 * until that outline closes) and the others list where it runs. One run of an entry at a time (a host-wide entry's,
 * across the host); a run missed while the host was down runs once when it comes back, not once per miss.
 *
 * The record is a file beside the outline (`extension-schedules.json` in its state folder), so `next` and `last`
 * survive a restart. It holds times and results, never anything an extension returned beyond its message.
 */

// ── cron ─────────────────────────────────────────────────────────────────

interface CronField { readonly values: ReadonlySet<number>; readonly any: boolean }
interface Cron { readonly minute: CronField; readonly hour: CronField; readonly day: CronField; readonly month: CronField; readonly weekday: CronField }

const RANGES: readonly [string, number, number][] = [["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7]];

function field(text: string, [name, low, high]: readonly [string, number, number]): CronField {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`${name} "${part}" isn't a number, a range, * or a step`);
    const step = match[4] === undefined ? 1 : Number(match[4]);
    const from = match[1] === "*" ? low : Number(match[2]);
    const to = match[1] === "*" ? high : match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? high : from;
    if (step < 1 || from < low || to > high || from > to) throw new Error(`${name} "${part}" is outside ${low}-${high}`);
    for (let value = from; value <= to; value += step) values.add(name === "day of week" && value === 7 ? 0 : value);
  }
  // A field written from `*` (`*`, `*/2`) is unrestricted for cron's day rule, as vixie cron reads it.
  return { values, any: text.startsWith("*") };
}

export function parseCron(expression: string): Cron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`a cron has five fields (minute hour day month weekday), not ${parts.length}`);
  const [minute, hour, day, month, weekday] = parts.map((part, index) => field(part, RANGES[index]!));
  return { minute: minute!, hour: hour!, day: day!, month: month!, weekday: weekday! };
}

/** Why a cron can't be used, in words; null when it parses. */
export function cronProblem(expression: string): string | null {
  try {
    parseCron(expression);
    // One that parses but never matches (`0 0 31 2 *`) is refused too.
    nextCron(expression, Date.UTC(2026, 0, 1));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The first minute after `after` a cron matches (the host's local time), within about four years. */
export function nextCron(expression: string, after: number): number {
  const cron = parseCron(expression);
  const at = new Date(after);
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + 1);
  // Cron's rule: when both day fields are restricted, either may match.
  const dayMatches = (date: Date) => cron.day.any || cron.weekday.any
    ? cron.day.values.has(date.getDate()) && cron.weekday.values.has(date.getDay())
    : cron.day.values.has(date.getDate()) || cron.weekday.values.has(date.getDay());
  for (let guard = 0; guard < 4 * 366 * 24 * 60; guard += 1) {
    if (!cron.month.values.has(at.getMonth() + 1)) { at.setMonth(at.getMonth() + 1, 1); at.setHours(0, 0, 0, 0); continue; }
    if (!dayMatches(at)) { at.setDate(at.getDate() + 1); at.setHours(0, 0, 0, 0); continue; }
    if (!cron.hour.values.has(at.getHours())) { at.setHours(at.getHours() + 1, 0, 0, 0); continue; }
    if (!cron.minute.values.has(at.getMinutes())) { at.setMinutes(at.getMinutes() + 1, 0, 0); continue; }
    return at.getTime();
  }
  throw new Error(`the cron ${expression} never matches`);
}

/** When a schedule runs next, from its last run (or, never run, from when it was first seen). */
export function nextRun(schedule: ExtensionSchedule, from: number): number {
  if (schedule.cron !== undefined) return nextCron(schedule.cron, from);
  const match = /^([1-9][0-9]{0,4})([smh])$/.exec(schedule.every ?? "");
  const every = match ? Number(match[1]) * (match[2] === "s" ? 1_000 : match[2] === "m" ? 60_000 : 3_600_000) : 3_600_000;
  return from + every;
}

// ── the runner ───────────────────────────────────────────────────────────

/** One scheduled entry of an extension: `action:<id>` or `handler:<key>`. */
export interface ScheduledEntry {
  readonly extension: LoadedExtension;
  readonly entry: string;
  readonly schedule: ExtensionSchedule;
}

export interface ScheduleRun {
  readonly at: string;
  readonly ok: boolean;
  readonly message?: string;
  readonly error?: string;
  readonly ms: number;
}

/** What `extensions.list` says of one schedule. */
export interface ScheduleListEntry {
  readonly entry: string;
  readonly every?: string;
  readonly cron?: string;
  /** `"host"`: it runs in one outline of the host (PIE-767). */
  readonly once?: "host";
  /** A host-wide schedule another outline runs: that outline's name. `next`, `running` and `last` are its. */
  readonly runsIn?: string;
  readonly next: string;
  readonly running?: true;
  readonly last?: ScheduleRun;
}

interface Kept { firstSeen: string; last?: ScheduleRun; next: string }

export interface ExtensionSchedulesOptions {
  /** The extensions serving now. */
  readonly serving: () => readonly LoadedExtension[];
  /** Runs one entry (`at`: when, by this runner's clock); resolves to what it did, in a few words. */
  readonly run: (entry: ScheduledEntry, at: string) => Promise<string | undefined>;
  /** Where runs are recorded; none keeps them in memory (a bare test harness). */
  readonly file?: string;
  readonly now?: () => number;
  /** How often due schedules are looked for. Default 15 s. */
  readonly tickMs?: number;
  /** A run finished: listings change. */
  readonly ran?: (extensionId: string) => void;
  /** The outline this runner serves (a host-wide schedule's listing says where it runs). */
  readonly outline?: () => string | undefined;
}

/**
 * Host-wide schedules (`once: "host"`, PIE-767): which runner holds each, and which are running, across the process.
 * An outline host is one process serving every outline, so a module-level table is the host's. Keyed by the
 * extension's folder and the entry: the user folder's copy is one entry for every outline it serves.
 */
const hostHolders = new Map<string, ExtensionSchedules>();
const hostRunning = new Set<string>();
/**
 * A host-wide entry's latest run, whichever runner ran it (its schedule's run, or `ext run` in another outline): each
 * runner works out `next` from it, so a handover or a run asked for elsewhere never repeats or restarts the interval.
 */
const hostLast = new Map<string, ScheduleRun>();

const MAX_MESSAGE = 300;

export class ExtensionSchedules {
  private kept = new Map<string, Kept>();
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly options: ExtensionSchedulesOptions) {
    this.load();
  }

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  private load(): void {
    if (!this.options.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.options.file, "utf8")) as { schedules?: Record<string, Kept> };
      this.kept = new Map(Object.entries(raw.schedules ?? {}));
    } catch {
      // No file yet, or one this version can't read: schedules start from now.
    }
  }

  private save(): void {
    if (!this.options.file) return;
    try {
      mkdirSync(dirname(this.options.file), { recursive: true });
      const temporary = `${this.options.file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ schedules: Object.fromEntries(this.kept) }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.options.file);
    } catch {
      // A record that can't be written loses only `last` across a restart.
    }
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.options.tickMs ?? 15_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Its host-wide schedules go to the next outline whose runner looks for them.
    for (const [key, holder] of hostHolders) if (holder === this) hostHolders.delete(key);
  }

  /** A host-wide entry's key in the host's table; undefined for a per-outline entry. */
  private hostKey(entry: ScheduledEntry): string | undefined {
    return entry.schedule.once === "host" ? `${entry.extension.directory}#${entry.entry}` : undefined;
  }

  /**
   * The runner that runs `entry`: this one, or (host-wide) the one that holds it. When nobody holds it, a started
   * runner takes it (the first to tick or list it); one never started (a read-only copy's) takes nothing.
   */
  private holder(entry: ScheduledEntry, take = this.timer !== null): ExtensionSchedules {
    const key = this.hostKey(entry);
    if (!key) return this;
    const held = hostHolders.get(key);
    // A holder that stopped, or no longer serves the entry (the extension left its outline), lets it go.
    if (held && !held.stopped && (held === this || held.entries().some((candidate) => held.hostKey(candidate) === key))) return held;
    if (take && !this.stopped) hostHolders.set(key, this);
    return this;
  }

  /** Whether a run of `entry` is going: here, or for a host-wide entry anywhere on the host. */
  private isRunning(entry: ScheduledEntry): boolean {
    const key = this.hostKey(entry);
    return key ? hostRunning.has(key) : this.running.has(this.key(entry));
  }

  /** Every scheduled entry the serving extensions declare. */
  entries(): ScheduledEntry[] {
    return this.options.serving().flatMap((extension) => [
      ...(extension.manifest.handlers ?? []).flatMap((handler) => handler.schedule ? [{ extension, entry: `handler:${handler.key}`, schedule: handler.schedule }] : []),
      ...(extension.manifest.actions ?? []).flatMap((action) => action.schedule ? [{ extension, entry: `action:${action.id}`, schedule: action.schedule }] : []),
    ]);
  }

  private key(entry: ScheduledEntry): string {
    return `${entry.extension.id}/${entry.entry}`;
  }

  /** What is kept for an entry, its next run worked out again when the schedule itself changed. */
  private state(entry: ScheduledEntry): Kept {
    const key = this.key(entry);
    let kept = this.kept.get(key);
    // A host-wide entry run since by another outline's runner: its run is this one's last too.
    const shared = this.hostKey(entry) ? hostLast.get(this.hostKey(entry)!) : undefined;
    if (shared && (!kept?.last || Date.parse(shared.at) > Date.parse(kept.last.at))) kept = { firstSeen: kept?.firstSeen ?? shared.at, last: shared, next: "" };
    const firstSeen = kept?.firstSeen ?? new Date(this.now).toISOString();
    const from = Date.parse(kept?.last?.at ?? firstSeen);
    const next = new Date(nextRun(entry.schedule, from)).toISOString();
    const state: Kept = { firstSeen, ...(kept?.last ? { last: kept.last } : {}), next };
    if (!kept || kept.next !== next) {
      this.kept.set(key, state);
      this.save();
    }
    return state;
  }

  /** Runs every entry that is due now (one run each, however many were missed). */
  async tick(): Promise<void> {
    if (this.stopped) return;
    // One entry that can't say when it runs next never stops the others.
    const due = this.entries().filter((entry) => {
      try { return this.holder(entry, true) === this && !this.isRunning(entry) && Date.parse(this.state(entry).next) <= this.now; } catch { return false; }
    });
    await Promise.all(due.map((entry) => this.runOne(entry)));
  }

  /** Runs one entry now, whether due or not (`extensions.schedule.run`), and records it as any run. */
  async runNow(extensionId: string, entryName: string): Promise<ScheduleRun> {
    const entry = this.entries().find((candidate) => candidate.extension.id === extensionId && candidate.entry === entryName);
    if (!entry) {
      const names = this.entries().filter((candidate) => candidate.extension.id === extensionId).map((candidate) => candidate.entry);
      throw new Error(`${extensionId} has no schedule ${entryName}${names.length ? ` (its schedules: ${names.join(", ")})` : " (it declares none)"}`);
    }
    if (this.isRunning(entry)) {
      const elsewhere = this.holder(entry) !== this ? this.holder(entry).options.outline?.() : undefined;
      throw new Error(`${extensionId}'s ${entryName} is running now${elsewhere ? ` (in ${elsewhere})` : ""}; it runs once at a time`);
    }
    return this.runOne(entry);
  }

  private async runOne(entry: ScheduledEntry): Promise<ScheduleRun> {
    const key = this.key(entry);
    const hostKey = this.hostKey(entry);
    this.running.add(key);
    if (hostKey) hostRunning.add(hostKey);
    const started = this.now;
    let run: ScheduleRun;
    try {
      const said = await this.options.run(entry, new Date(started).toISOString());
      run = { at: new Date(started).toISOString(), ok: true, ...(said ? { message: said.slice(0, MAX_MESSAGE) } : {}), ms: Math.max(0, this.now - started) };
    } catch (error) {
      const said = (error instanceof Error ? error.message : String(error)).replace(/^Resource extension: /, "");
      run = { at: new Date(started).toISOString(), ok: false, error: said.slice(0, MAX_MESSAGE), ms: Math.max(0, this.now - started) };
    } finally {
      this.running.delete(key);
      if (hostKey) hostRunning.delete(hostKey);
    }
    if (hostKey) hostLast.set(hostKey, run);
    const firstSeen = this.kept.get(key)?.firstSeen ?? run.at;
    this.kept.set(key, { firstSeen, last: run, next: new Date(nextRun(entry.schedule, started)).toISOString() });
    this.save();
    this.options.ran?.(entry.extension.id);
    return run;
  }

  /** An extension's schedules as `extensions.list` shows them. */
  list(extensionId: string): ScheduleListEntry[] {
    return this.entries().filter((entry) => entry.extension.id === extensionId).flatMap((entry) => {
      // A host-wide schedule another outline holds is listed as that outline's: when it runs there, and how it went.
      const holder = this.holder(entry);
      let state: Kept;
      try { state = holder.state(entry); } catch { return []; }
      const runsIn = holder !== this ? holder.options.outline?.() : undefined;
      return [{
        entry: entry.entry,
        ...(entry.schedule.every ? { every: entry.schedule.every } : {}),
        ...(entry.schedule.cron ? { cron: entry.schedule.cron } : {}),
        ...(entry.schedule.once ? { once: entry.schedule.once } : {}),
        ...(runsIn ? { runsIn } : {}),
        next: state.next,
        ...(this.isRunning(entry) ? { running: true as const } : {}),
        ...(state.last ? { last: state.last } : {}),
      }];
    });
  }
}
