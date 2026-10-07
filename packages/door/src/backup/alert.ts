// What the backup job remembers between runs (state.json) and what it found wrong (alert.json), both in
// `<door state>/backup/`. The verdicts are pure (`incidents`), so tests describe a history instead of living it.
//
// An incident is a backup over STALE_AFTER_MS behind while its outline changed: this machine's outline with changes
// no snapshot holds, another machine's outline whose changes (seen over ssh) aren't in its newest snapshot, a mirror
// that couldn't take a newer snapshot, a restore drill that failed. Each is announced once (the door's status bar
// keeps showing it until it clears; the push and `herdr notification` go out when it starts), with the command that
// fixes it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeState } from "../state";

/** A backup behind its outline for longer than this, while the outline changed, is stale. */
export const STALE_AFTER_MS = 2 * 3_600_000;
/** An alert file older than this means the job itself stopped running. */
export const CHECK_LATE_MS = 60 * 60_000;
/** How often the restore drill runs. */
export const DRILL_EVERY_MS = 30 * 24 * 3_600_000;

/** One outline of this machine: the change its newest snapshot holds, and changes waiting since when. */
export interface OutlineState {
  /** The change feed's highest change_id in the newest snapshot (null: the outline has no change feed). */
  seq?: number | null;
  /** When that snapshot was taken, and its id. */
  at?: string;
  snapshot?: string;
  /** The first run that found changes no snapshot holds (cleared when one does). */
  pendingSince?: string;
  /** The last try's failure, when it failed. */
  error?: string;
}

/** One mirrored outline (`<machine>/<outline>`): the copy here, and what the machine itself last said. */
export interface MirrorState {
  folder?: string;
  snapshot?: string;
  seq?: number | null;
  /** The snapshot's time (or, from sqlite3_rsync, when it was copied; a copy found there, its file's time). */
  at?: string;
  /** Where the copy came from: a snapshot, sqlite3_rsync, or found in the folder (Litestream's, a lost state file). */
  source?: "restic" | "rsync" | "found";
  refreshed?: string;
  /** The outline's change on its machine when last asked over ssh, and when. */
  remoteSeq?: number | null;
  remoteAt?: string;
  /** Changes on the machine that no snapshot holds, since. */
  pendingSince?: string;
  /** A newer snapshot this mirror couldn't take, since. */
  behindSince?: string;
  error?: string;
}

export interface Drill { at: string; ok: boolean; detail: string }

export interface BackupState {
  /** The repository the outlines' snapshots are in: another one starts them over. */
  repo?: string;
  outlines: Record<string, OutlineState>;
  /** Other machines' repositories this one reads, when reading one fails. */
  sources?: Record<string, { failingSince?: string; error?: string; missing?: boolean }>;
  mirrors: Record<string, MirrorState>;
  lastRun?: { at: string; ok: boolean; detail: string };
  lastPrune?: string;
  drill?: Drill;
}

export interface Incident { key: string; title: string; detail: string; fix: string; since: string }
export interface Alert {
  machine: string;
  checkedAt: string;
  incidents: Incident[];
  /** The incidents already announced (push, herdr): each once. */
  announced: string[];
}

export const emptyState = (): BackupState => ({ outlines: {}, mirrors: {} });

export function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}
export const readBackupState = (dir: string): BackupState => ({ ...emptyState(), ...readJson<BackupState>(join(dir, "state.json")) });
export const writeBackupState = (dir: string, s: BackupState) => writeState("state.json", s, dir);
export const readAlert = (dir: string): Alert | null => readJson<Alert>(join(dir, "alert.json"));
export const writeAlert = (dir: string, a: Alert) => writeState("alert.json", a, dir);

export const age = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.round(m / 1440)}d`;
};
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
      detail: `${name} changed since ${hhmm(o.pendingSince!)} and ${last}${o.error ? `; the upload fails: ${o.error}` : ""}`,
      fix: `${cmd.run}   (its log: ${cmd.log})` });
  }
  for (const [key, m] of Object.entries(s.mirrors).sort()) {
    const [from, name] = key.split("/");
    if (late(m.pendingSince)) {
      out.push({ key: `pending:${key}`, since: m.pendingSince!, title: `${name} on ${from}: backup stale`,
        detail: `${name} on ${from} has changes since ${hhmm(m.pendingSince!)} (change ${m.remoteSeq}) that no backup holds; its newest is ${m.at ? `${age(now - Date.parse(m.at))} old` : "missing"}`,
        fix: `on ${from}: ep0ch backup run   (and ep0ch doctor there; its log says why the upload fails)` });
    }
    if (late(m.behindSince)) {
      out.push({ key: `mirror:${key}`, since: m.behindSince!, title: `mirror ${key} stale`,
        detail: `${machine}'s copy of ${name} hasn't taken the newer snapshot since ${hhmm(m.behindSince!)}${m.error ? `: ${m.error}` : ""}`,
        fix: `${cmd.run}   (its log: ${cmd.log})` });
    }
  }
  for (const [from, x] of Object.entries(s.sources ?? {}).sort()) {
    if (!late(x.failingSince)) continue;
    out.push({ key: `source:${from}`, since: x.failingSince!, title: `${from}'s backups unreadable from ${machine}`,
      detail: `${machine} hasn't been able to read ${from}'s backups since ${hhmm(x.failingSince!)}, so its mirrors' freshness is unknown: ${x.error ?? "?"}`,
      fix: `ep0ch backup mirror   (it says restic's error; check the secrets: with-secrets --list)` });
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
export function alertMark(a: Alert | null, now: number): { text: string; say: string } | null {
  if (!a) return null;
  if (now - Date.parse(a.checkedAt) >= CHECK_LATE_MS) {
    return { text: "? backup", say: `the backup check last ran ${age(now - Date.parse(a.checkedAt))} ago (${hhmm(a.checkedAt)}) · ep0ch doctor says why` };
  }
  if (!a.incidents.length) return null;
  const first = a.incidents[0]!;
  const more = a.incidents.length > 1 ? ` · +${a.incidents.length - 1} more (ep0ch doctor)` : "";
  return { text: `✗ backup${a.incidents.length > 1 ? ` ${a.incidents.length}` : ""}`, say: `${first.detail} · fix: ${first.fix}${more}` };
}
