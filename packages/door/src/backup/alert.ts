// What the backup job remembers between runs (state.json) and what it found wrong (alert.json), both in
// `<door state>/backup/`. The verdicts are pure (`incidents`), so tests describe a history instead of living it.
//
// An incident is a backup over STALE_AFTER_MS behind while its outline changed: this machine's outline with changes
// no snapshot holds, another machine's outline whose changes (seen over ssh) aren't in its newest snapshot, a mirror
// that couldn't take a newer snapshot, a restore drill that failed. Each is announced once (the door's status bar
// keeps showing it until it clears; the push and `herdr notification` go out when it starts), with the command that
// fixes it.
import { age } from "@ep0ch/outline-core/age";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeState } from "../state";
import { plainFailure } from "./plain";

/** A backup behind its outline for longer than this, while the outline changed, is stale. */
export const STALE_AFTER_MS = 2 * 3_600_000;
/** An alert file older than this means the job itself stopped running. */
export const CHECK_LATE_MS = 60 * 60_000;
/** Queued MCP writes waiting this long while their machine was online since: something stopped its pull. */
export const NETMAIL_LATE_MS = 24 * 3_600_000;
/** How often the restore drill runs. */
export const DRILL_EVERY_MS = 30 * 24 * 3_600_000;

/** One outline of this machine: the change its newest snapshot holds, and changes waiting since when. */
export interface OutlineState {
  /** The newest log entry the repository holds (ADR 0009), of the log `logId`. */
  seq?: number | null;
  logId?: string;
  /** The outline's schema version when it was archived: a migration writes a genesis, and is a change. */
  schema?: number | null;
  /** When that archive was uploaded, and its snapshot's id. */
  at?: string;
  snapshot?: string;
  /** The first run that found changes no snapshot holds (cleared when one does). */
  pendingSince?: string;
  /** The last try's failure, when it failed. */
  error?: string;
  /**
   * The newest entries didn't go to the repository from here: they went to another machine (`via`), which archived them
   * and uploaded them for this one, because `why` (the repository's refusal or silence). `uploaded: false`: the
   * other machine couldn't upload it either (`uploadError`), so the next run tries the repository again. A relayed backup
   * counts as fresh: it is off this machine and checked.
   */
  relayed?: { via: string; at: string; why: string; uploaded: boolean; uploadError?: string };
}

/** A restore drill: how it went, and `via` the hub when this machine couldn't reach its repository (PIE-810). */
export interface Drill { at: string; ok: boolean; detail: string; via?: string }

/**
 * Netmail (PIE-615): on the gateway's machine, each other machine's queued MCP writes; on a home machine, its last
 * pull of them. `lastSeen`: the newest sign the machine was online (its last pull).
 */
export interface NetmailState {
  queues?: Record<string, { waiting: number; oldest: string | null; lastPull: string | null; lastSeen: string | null }>;
  pull?: { hub: string; at: string; ok: boolean; detail: string; failingSince?: string };
}

export interface BackupState {
  /** The repository the outlines' snapshots are in: another one starts them over. */
  repo?: string;
  outlines: Record<string, OutlineState>;
  lastRun?: { at: string; ok: boolean; detail: string };
  lastPrune?: string;
  drill?: Drill;
  /** A drill that was due and couldn't run (the repository out of reach, and the hub too): since when, and why. */
  drillWaiting?: { since: string; why: string };
  /**
   * How this machine's newest backups got to the repository when it couldn't reach it itself (PIE-810): through the
   * hub, since when, and why. Cleared by a direct upload. Status, never an incident: the backups are there.
   */
  route?: { via: string; since: string; why: string };
  netmail?: NetmailState;
  /**
   * The outline host didn't answer the job (PIE-1750): since when, why, and the command that starts it. Kept apart from
   * the outlines, so a run that knows none yet still fails, and cleared by a run the host answers.
   */
  host?: { failingSince: string; error: string; fix: string };
}

export interface Incident { key: string; title: string; detail: string; fix: string; since: string }
export interface Alert {
  machine: string;
  checkedAt: string;
  incidents: Incident[];
  /** The backups go through the hub (the repository out of reach): said on the status bar as status (BackupState.route). */
  route?: { via: string; since: string; why: string };
  /** The incidents already announced (push, herdr): each once. */
  announced: string[];
}

export const emptyState = (): BackupState => ({ outlines: {} });

export function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}
export const readBackupState = (dir: string): BackupState => ({ ...emptyState(), ...readJson<BackupState>(join(dir, "state.json")) });
export const writeBackupState = (dir: string, s: BackupState) => writeState("state.json", s, dir);
export const readAlert = (dir: string): Alert | null => readJson<Alert>(join(dir, "alert.json"));
export const writeAlert = (dir: string, a: Alert) => writeState("alert.json", a, dir);

/** `29s`, `5m`, `2h`, `3d`: outline-core's `age`. */
export { age };
export const hhmm = (t: string | number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z";

/** How the person runs the job and reads its log, here. */
export interface Commands { run: string; log: string }

/** What's wrong now, from the job's state: each an incident with the command that fixes it. */
export function incidents(s: BackupState, machine: string, now: number, cmd: Commands): Incident[] {
  const out: Incident[] = [];
  const late = (since?: string) => !!since && now - Date.parse(since) >= STALE_AFTER_MS;
  for (const [name, o] of Object.entries(s.outlines).sort()) {
    if (!late(o.pendingSince)) continue;
    const last = o.at ? `the newest backup is ${age(now - Date.parse(o.at))} old (${hhmm(o.at)})` : "it has never been backed up";
    out.push({ key: `outline:${machine}/${name}`, since: o.pendingSince!, title: `${name} on ${machine}: backup stale`,
      detail: `${name} changed since ${hhmm(o.pendingSince!)} and ${last}${o.error ? `; the upload fails: ${plainFailure(o.error)}` : ""}`,
      fix: `${cmd.run}   (its log: ${cmd.log})` });
  }
  if (s.host && late(s.host.failingSince)) {
    out.push({ key: `host:${machine}`, since: s.host.failingSince, title: `the outline host on ${machine} doesn't answer the backup job`,
      detail: `nothing has been copied since ${hhmm(s.host.failingSince)}: ${s.host.error}`, fix: s.host.fix });
  }
  for (const [m, q] of Object.entries(s.netmail?.queues ?? {}).sort()) {
    if (!q.waiting || !q.oldest || now - Date.parse(q.oldest) < NETMAIL_LATE_MS || !q.lastSeen || q.lastSeen <= q.oldest) continue;
    out.push({ key: `netmail:${m}`, since: q.oldest, title: `${m}'s queued MCP writes waiting`,
      detail: `${q.waiting} remote MCP write${q.waiting === 1 ? "" : "s"} for ${m}'s outlines ${q.waiting === 1 ? "has" : "have"} waited on ${machine} since ${hhmm(q.oldest)}, though ${m} was online at ${hhmm(q.lastSeen)}; its last pull: ${q.lastPull ? hhmm(q.lastPull) : "never"}`,
      fix: `on ${m}: ep0ch mcp pull   (EP0CH_MCP_HUB=<${machine}'s ssh name> in ~/.config/ep0ch/backup.env makes its backup job pull every run)` });
  }
  const pull = s.netmail?.pull;
  if (pull && !pull.ok && late(pull.failingSince)) {
    out.push({ key: `netmail-pull:${pull.hub}`, since: pull.failingSince!, title: `pulling queued MCP writes from ${pull.hub} fails`,
      detail: `${machine} hasn't pulled its queued writes from ${pull.hub} since ${hhmm(pull.failingSince!)}: ${pull.detail}`,
      fix: `ep0ch mcp pull   (it says why; ssh ${pull.hub} ep0ch mcp queue status shows what waits)` });
  }
  if (s.drill && !s.drill.ok) {
    out.push({ key: `drill:${machine}`, since: s.drill.at, title: `restore drill failed on ${machine}`, detail: s.drill.detail,
      fix: `ep0ch backup drill   (then ep0ch backup restore <outline> --to /tmp/check.sqlite to look at one)` });
  }
  return out;
}

/** The new alert: these incidents, and which of them are new (to announce). Resolved ones are forgotten. */
export function nextAlert(prev: Alert | null, found: Incident[], machine: string, now: number): { alert: Alert; announce: Incident[] } {
  const was = new Set(prev?.announced ?? []);
  const announce = found.filter(i => !was.has(i.key));
  return { alert: { machine, checkedAt: new Date(now).toISOString(), incidents: found, announced: found.map(i => i.key) }, announce };
}

/** What the door's status bar shows for the alert: nothing, a stale backup, or a check that stopped running. */
export function alertMark(a: Alert | null, now: number): { text: string; say: string; status?: boolean } | null {
  if (!a) return null;
  if (now - Date.parse(a.checkedAt) >= CHECK_LATE_MS) {
    return { text: "? backup", say: `the backup check last ran ${age(now - Date.parse(a.checkedAt))} ago (${hhmm(a.checkedAt)}) · ep0ch doctor says why` };
  }
  if (!a.incidents.length) {
    // Backed up, the long way round: a status, not a problem (the work VPN keeps the laptop off the bucket).
    if (a.route) return { text: `→ backup`, say: `repository unreachable (work VPN?): sent through ${a.route.via} since ${hhmm(a.route.since)}`, status: true };
    return null;
  }
  const first = a.incidents[0]!;
  const more = a.incidents.length > 1 ? ` · +${a.incidents.length - 1} more (ep0ch doctor)` : "";
  return { text: `✗ backup${a.incidents.length > 1 ? ` ${a.incidents.length}` : ""}`, say: `${first.detail} · fix: ${first.fix}${more}` };
}
