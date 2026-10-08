// `ep0ch backup …` (PIE-607): the job the timer runs, its parts one by one, and the restore.
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isInside } from "../state";
import { age, alertMark, hhmm, readAlert, readBackupState } from "./alert";
import { backupConfig, type BackupConfig, type Env } from "./config";
import { blockCount, drill, integrity, mirror, runAll, snapshot, takeLock } from "./jobs";
import { dumpTo, OUTLINE_NAME, type OutlineSnapshot, snapshots } from "./restic";
import { writeBackupState } from "./alert";
import { BACKUP_USAGE } from "./usage";
import { programStatusEmitter } from "@ep0ch/outliner/program-status-emit";
import { Progress, progressMode, type Terminal } from "../setup/progress";
export { BACKUP_USAGE };

/** `terminal`: where a person watches `run` (process.stdout by default): live steps there, as `ep0ch install` draws them. */
type IO = { out: (s: string) => void; err: (s: string) => void; terminal?: Terminal };

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
    const via = o.relayed ? `; relayed via ${o.relayed.via} at ${hhmm(o.relayed.at)} (the repository: ${o.relayed.why})${o.relayed.uploaded ? "" : `; ${o.relayed.via} couldn't upload it either: ${o.relayed.uploadError ?? "?"}`}` : "";
    lines.push(`  ${name}: ${newest}${via}${o.pendingSince ? `; changes waiting since ${hhmm(o.pendingSince)}` : ""}${o.error ? `; ${o.error}` : ""}`);
  }
  for (const [key, m] of Object.entries(s.mirrors).sort()) {
    lines.push(`  mirror ${key}: ${m.at ? `${m.source} copy of ${hhmm(m.at)} (change ${m.seq ?? "?"})` : "no copy yet"} in ${m.folder}${m.pendingSince ? `; its machine has changes since ${hhmm(m.pendingSince)} no backup holds` : ""}${m.error ? `; ${m.error}` : ""}`);
  }
  if (s.drill) lines.push(`  restore drill ${hhmm(s.drill.at)}: ${s.drill.ok ? "ok" : "FAILED"}, ${s.drill.detail}`);
  for (const [m, q] of Object.entries(s.netmail?.queues ?? {}).sort()) {
    lines.push(`  netmail for ${m}: ${q.waiting} queued${q.oldest ? `, oldest ${hhmm(q.oldest)}` : ""}; its last pull ${q.lastPull ? hhmm(q.lastPull) : "never"}${q.lastSeen ? `, last seen ${hhmm(q.lastSeen)}` : ""}`);
  }
  if (s.netmail?.pull) { const p = s.netmail.pull; lines.push(`  netmail from ${p.hub}: pulled ${hhmm(p.at)}, ${p.ok ? "ok" : "FAILED"}: ${p.detail}`); }
  else if (c.hub) lines.push(`  netmail from ${c.hub}: not pulled yet (ep0ch mcp pull)`);
  const mark = alertMark(a, now);
  lines.push(mark ? `  alert: ${mark.say}` : a ? "  alert: none" : "  alert: the job hasn't checked yet");
  return lines;
}

async function stateful(sub: "snapshot" | "mirror" | "drill", args: readonly string[], c: BackupConfig, io: IO): Promise<number> {
  const say = (s: string) => io.out(s);
  switch (sub) {
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
  }
}

export async function backupCommand(args: readonly string[], io: IO = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  const sub = args[1];
  const c = backupConfig(env);
  if ("error" in c) { io.err(`ep0ch backup: ${c.error}`); return 2; }
  const say = (s: string) => io.out(s);
  // The parts that write the job's state run one at a time, as the timer's run does (takeLock).
  if (sub === "snapshot" || sub === "mirror" || sub === "drill") {
    const release = takeLock(c);
    if (typeof release === "string") { io.err(`ep0ch backup: ${release}`); return 1; }
    try { return await stateful(sub, args, c, io); } finally { release(); }
  }
  switch (sub) {
    case "receive": {
      // The relay's receiving side, run over ssh by a machine that can't reach the repository (relay.ts): the file on stdin.
      const { receiveCommand } = await import("./relay");
      return receiveCommand(args, c, io);
    }
    case "run": {
      // What the run is doing, to a terminal that speaks the Program Status Protocol (OSC 7501); the timer's has none.
      const status = await programStatusEmitter("ep0ch-backup", { env });
      status.report({ state: "working", msg: "backing up the outlines" });
      // At a terminal, each step spins with its time and ends ✓ (install's own reporter); under the timer, the plain lines.
      const terminal = io.terminal ?? (io.out === console.log ? process.stdout : undefined);
      const progress = new Progress({ mode: progressMode({ json: false, terminal, env }), out: say, terminal, env });
      let task: ReturnType<Progress["task"]> | null = null;
      const step = (title: string) => { task?.end(true); task = progress.task({ mark: "·", title }); status.report({ state: "working", msg: title }); };
      const line = (s: string) => { if (task && progress.mode === "live") { if (/^[✓✗!]/.test(s)) task.say(s); else task.child(s); } else say(s); };
      try {
        const r = await runAll(c, { say: line, step, ...(args.includes("--drill") ? { drill: true } : {}) });
        (task as ReturnType<Progress["task"]> | null)?.end(r.ok);
        task = null;
        status.report(r.ok ? { state: "done", msg: "backup run finished" } : { state: "error", msg: "backup run failed: ep0ch backup status says what" });
        return r.ok ? 0 : 1;
      } finally { progress.close(); }
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
      if (!outline || !OUTLINE_NAME.test(outline) || !to) { io.err(`ep0ch backup restore <outline> [--machine <name>] [--at <time>] --to <path>`); return 2; }
      const dest = resolve(to);
      if (existsSync(dest) || (() => { try { lstatSync(dest); return true; } catch { return false; } })()) { io.err(`ep0ch backup: ${dest} exists; restore writes a new file (pick another --to, or move that one away)`); return 2; }
      if (isInside(c.outlines, dest) || isInside(c.mirrorsDir, dest)) {
        const live = join(c.outlines, `${outline}.sqlite`);
        const stop = process.platform === "darwin" ? "launchctl bootout gui/$(id -u)/<the host's and Litestream's agents>" : "systemctl --user stop outliner-host.service litestream.service";
        const start = process.platform === "darwin" ? "launchctl bootstrap gui/$(id -u) <each agent's plist>" : "systemctl --user start litestream.service outliner-host.service";
        io.err(`ep0ch backup: ${dest} is in ${isInside(c.outlines, dest) ? c.outlines : c.mirrorsDir}, which a service has open; restore elsewhere and swap it in with the host and Litestream stopped, keeping Litestream's .${outline}.sqlite-litestream folder (never litestream reset):\n`
          + `  ep0ch backup restore ${outline} --to /tmp/${outline}.sqlite\n  ${stop}\n  mv ${live} ~/backups/ && rm -f ${live}-wal ${live}-shm && cp /tmp/${outline}.sqlite ${live}\n  ${start}`);
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
      // Staged in a private folder beside it (the same file system), then linked in: link never replaces a file
      // that appeared meanwhile.
      const stage = mkdtempSync(join(dirname(dest), ".restore-"));
      const tmp = join(stage, "restored.sqlite");
      try {
        const r = await dumpTo(c, repo, snap, tmp);
        const verdict = "error" in r ? r.error : integrity(tmp);
        if (verdict !== "ok") { io.err(`ep0ch backup: restoring ${snap.id.slice(0, 8)} failed: ${verdict}`); return 1; }
        try { linkSync(tmp, dest); } catch (e) { io.err(`ep0ch backup: ${dest}: ${(e as Error).message}; nothing written`); return 1; }
      } finally { rmSync(stage, { recursive: true, force: true }); }
      say(`✓ ${outline} from ${machine}'s snapshot ${snap.id.slice(0, 8)} (${hhmm(snap.time)}, change ${snap.seq ?? "?"}, ${blockCount(dest) ?? "?"} blocks) → ${dest}; integrity ok`);
      return 0;
    }
    default:
      io.err(`ep0ch backup: ${sub ? `${sub}? ` : ""}one of run, snapshot, mirror, drill, status, list, restore, receive\n${BACKUP_USAGE}`);
      return 2;
  }
}
