// `ep0ch backup …` (PIE-607): the job the timer runs, its parts one by one, and the restore.
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isInside } from "../state";
import { age, alertMark, hhmm, readAlert, readBackupState } from "./alert";
import { backupConfig, type BackupConfig, type Env } from "./config";
import { drill, integrity, mirror, runAll, snapshot, blockCount } from "./jobs";
import { dumpTo, type OutlineSnapshot, snapshots } from "./restic";
import { writeBackupState } from "./alert";
import { BACKUP_USAGE } from "./usage";
export { BACKUP_USAGE };

type IO = { out: (s: string) => void; err: (s: string) => void };

/** `--at`: an ISO time, or `<n>m|h|d` ago. */
export function parseAt(v: string, now = Date.now()): number | null {
  const ago = /^(\d+)\s*([mhd])$/.exec(v.trim());
  if (ago) return now - Number(ago[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[ago[2] as "m" | "h" | "d"];
  const t = Date.parse(v.includes("T") || !/\d \d/.test(v) ? v : v.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

/** The snapshot a restore takes: the newest, or the newest at or before `at`. */
export const pick = (list: OutlineSnapshot[], at: number | null) =>
  [...list].filter(s => at === null || Date.parse(s.time) <= at).sort((a, b) => a.time.localeCompare(b.time)).at(-1) ?? null;

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function statusLines(c: BackupConfig, now = Date.now()): string[] {
  const s = readBackupState(c.state), a = readAlert(c.state);
  const lines = [`backups on ${c.machine} (${c.machineFrom === "hostname" ? `from the host name; set EP0CH_BACKUP_MACHINE in ${c.file} to change it` : c.machineFrom === "file" ? c.file : "EP0CH_BACKUP_MACHINE"}) · ${c.repoOf(c.machine)}`];
  if (s.lastRun) lines.push(`  last run ${hhmm(s.lastRun.at)} (${age(now - Date.parse(s.lastRun.at))} ago): ${s.lastRun.ok ? "ok" : "FAILED"}, ${s.lastRun.detail}`);
  else lines.push("  the job hasn't run here yet (ep0ch backup run)");
  for (const [name, o] of Object.entries(s.outlines).sort()) {
    const newest = o.at ? `newest ${hhmm(o.at)} (${age(now - Date.parse(o.at))} ago, change ${o.seq ?? "?"})` : "never backed up";
    lines.push(`  ${name}: ${newest}${o.pendingSince ? `; changes waiting since ${hhmm(o.pendingSince)}` : ""}${o.error ? `; ${o.error}` : ""}`);
  }
  for (const [key, m] of Object.entries(s.mirrors).sort()) {
    lines.push(`  mirror ${key}: ${m.at ? `${m.source} copy of ${hhmm(m.at)} (change ${m.seq ?? "?"})` : "no copy yet"} in ${m.folder}${m.pendingSince ? `; its machine has changes since ${hhmm(m.pendingSince)} no backup holds` : ""}${m.error ? `; ${m.error}` : ""}`);
  }
  if (s.drill) lines.push(`  restore drill ${hhmm(s.drill.at)}: ${s.drill.ok ? "ok" : "FAILED"}, ${s.drill.detail}`);
  const mark = alertMark(a, now);
  lines.push(mark ? `  alert: ${mark.say}` : a ? "  alert: none" : "  alert: the job hasn't checked yet");
  return lines;
}

export async function backupCommand(args: readonly string[], io: IO = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  const sub = args[1];
  const c = backupConfig(env);
  if ("error" in c) { io.err(`ep0ch backup: ${c.error}`); return 2; }
  const say = (s: string) => io.out(s);
  switch (sub) {
    case "run": {
      const r = await runAll(c, { say, ...(args.includes("--drill") ? { drill: true } : {}) });
      return r.ok ? 0 : 1;
    }
    case "snapshot": {
      const s = readBackupState(c.state);
      const r = await snapshot(c, s, { say, force: args.includes("--force") });
      writeBackupState(c.state, s);
      return r.failed.length ? 1 : 0;
    }
    case "mirror": {
      if (!c.mirrors.length) { io.err(`ep0ch backup: no mirrors here; EP0CH_BACKUP_MIRRORS=<machine>[=<ssh-name>] in ${c.file} names them`); return 2; }
      const s = readBackupState(c.state);
      await mirror(c, s, { say });
      writeBackupState(c.state, s);
      return Object.entries(s.mirrors).some(([, m]) => m.error) ? 1 : 0;
    }
    case "drill": {
      const s = readBackupState(c.state);
      const d = await drill(c, { say });
      s.drill = { at: new Date().toISOString(), ...d };
      writeBackupState(c.state, s);
      say(`${d.ok ? "✓" : "✗"} ${d.detail}`);
      return d.ok ? 0 : 1;
    }
    case "status": {
      if (args.includes("--json")) io.out(JSON.stringify({ machine: c.machine, repo: c.repoOf(c.machine), state: readBackupState(c.state), alert: readAlert(c.state) }, null, 2));
      else statusLines(c).forEach(say);
      return 0;
    }
    case "list": {
      const outline = args[2], machine = flag(args, "--machine") ?? c.machine;
      if (!outline || outline.startsWith("-")) { io.err(`ep0ch backup list <outline> [--machine <name>]`); return 2; }
      const list = await snapshots(c, c.repoOf(machine), { all: true, outline });
      if ("error" in list) { io.err(`ep0ch backup: can't list ${c.repoOf(machine)}: ${list.error}`); return 1; }
      if (!list.length) { io.err(`ep0ch backup: no snapshot of ${outline} in ${c.repoOf(machine)}`); return 1; }
      for (const x of list) say(`${x.id.slice(0, 8)}  ${hhmm(x.time)}  change ${x.seq ?? "?"}`);
      return 0;
    }
    case "restore": {
      const outline = args[2], to = flag(args, "--to"), at = flag(args, "--at"), machine = flag(args, "--machine") ?? c.machine;
      if (!outline || outline.startsWith("-") || !to) { io.err(`ep0ch backup restore <outline> [--machine <name>] [--at <time>] --to <path>`); return 2; }
      const dest = resolve(to);
      if (existsSync(dest)) { io.err(`ep0ch backup: ${dest} exists; restore writes a new file (pick another --to, or move that one away)`); return 2; }
      if (isInside(c.outlines, dest) || isInside(c.mirrorsDir, dest)) {
        io.err(`ep0ch backup: ${dest} is in ${isInside(c.outlines, dest) ? c.outlines : c.mirrorsDir}, which a service has open; restore elsewhere (--to /tmp/${outline}.sqlite), look at it, then swap it in with the host stopped`);
        return 2;
      }
      const when = at === undefined ? null : parseAt(at);
      if (at !== undefined && when === null) { io.err(`ep0ch backup: --at ${at} isn't a time (2026-10-06T14:00, 3h, 2d)`); return 2; }
      const repo = c.repoOf(machine);
      const list = await snapshots(c, repo, { all: true, outline });
      if ("error" in list) { io.err(`ep0ch backup: can't list ${repo}: ${list.error}`); return 1; }
      const snap = pick(list, when);
      if (!snap) { io.err(`ep0ch backup: no snapshot of ${outline}${when !== null ? ` at or before ${hhmm(when)}` : ""} in ${repo}${list.length ? `; the oldest is ${hhmm(list[0]!.time)}` : ""}`); return 1; }
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.incoming`;
      const r = await dumpTo(c, repo, snap, tmp);
      const verdict = "error" in r ? r.error : integrity(tmp);
      if (verdict !== "ok") { rmSync(tmp, { force: true }); io.err(`ep0ch backup: restoring ${snap.id.slice(0, 8)} failed: ${verdict}`); return 1; }
      renameSync(tmp, dest);
      say(`✓ ${outline} from ${machine}'s snapshot ${snap.id.slice(0, 8)} (${hhmm(snap.time)}, change ${snap.seq ?? "?"}, ${blockCount(dest) ?? "?"} blocks) → ${dest}; integrity ok`);
      return 0;
    }
    default:
      io.err(`ep0ch backup: ${sub ? `${sub}? ` : ""}one of run, snapshot, mirror, drill, status, list, restore\n${BACKUP_USAGE}`);
      return 2;
  }
}
