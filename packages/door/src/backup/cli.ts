// `ep0ch backup …` (PIE-607): the job the timer runs, its parts one by one, and the restore.
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isInside } from "../state";
import { age, hhmm, readAlert, readBackupState } from "./alert";
import { plainReason } from "./plain";
import { noTint, PALETTE, renderStatus, type Tint, moment } from "./verdict";
import { fg, RESET, width } from "../style";
import { backupConfig, type BackupConfig, type Env, MACHINE_NAME } from "./config";
import { drill, drillHere, hostCopy, hostStartCommand, integrity, maintain, runAll, snapshot, takeLock, waitForLock } from "./jobs";
import { replayArchive, type Replayed } from "@ep0ch/outliner/log-archive";
import { hostUnitCommands } from "@ep0ch/outliner/schema";
import { restoreArchive, OUTLINE_NAME, type OutlineSnapshot, snapshots } from "./restic";
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

/** `ep0ch backup status`: the verdict first, what is wrong now, then the outlines and the history (verdict.ts). Plain unless `colour`. */
export function statusLines(c: BackupConfig, now = Date.now(), o: { verbose?: boolean; colour?: boolean } = {}): string[] {
  const s = readBackupState(c.state), a = readAlert(c.state);
  const tint: Tint = o.colour ? (k, text) => `${fg(PALETTE[k])}${text}${RESET}` : noTint;
  const netmail: string[] = [];
  for (const [m, q] of Object.entries(s.netmail?.queues ?? {}).sort()) {
    netmail.push(`netmail for ${m}: ${q.waiting} queued${q.oldest ? `, oldest ${moment(q.oldest)}` : ""}; its last pull ${q.lastPull ? moment(q.lastPull) : "never"}${q.lastSeen ? `, last seen ${moment(q.lastSeen)}` : ""}`);
  }
  if (s.netmail?.pull) { const p = s.netmail.pull; netmail.push(`netmail from ${p.hub}: pulled ${moment(p.at)}, ${p.ok ? "ok" : `failed: ${plainReason(p.detail, { hub: p.hub })}`}`); }
  else if (c.hub) netmail.push(`netmail from ${c.hub}: not pulled yet (ep0ch mcp pull)`);
  const note = c.machineFrom === "hostname" ? `from the host name; set EP0CH_BACKUP_MACHINE in ${c.file} to change it` : c.machineFrom === "file" ? c.file : "EP0CH_BACKUP_MACHINE";
  return renderStatus({ s, a, now, machine: c.machine, repo: c.repoOf(c.machine), hub: c.hub, machineNote: note, age, tint, visible: width, ...(o.verbose ? { verbose: true } : {}), netmail });
}

async function stateful(sub: "snapshot" | "drill", args: readonly string[], c: BackupConfig, io: IO): Promise<number> {
  const say = (s: string) => io.out(s);
  switch (sub) {
    case "snapshot": {
      const s = readBackupState(c.state);
      const r = await snapshot(c, s, { say, force: args.includes("--force"), ...(args.includes("--verbose") ? { verbose: true } : {}) });
      if (r.uploaded.length) await maintain(c, s, { uploaded: true, say });
      writeBackupState(c.state, s);
      return r.failed.length ? 1 : 0;
    }
    case "drill": {
      // From here, or through the hub when the repository is out of reach (jobs.ts drillHere).
      const s = readBackupState(c.state);
      const d = await drillHere(c, { say, ...(args.includes("--serve") ? { serve: true } : {}) });
      if ("waiting" in d) {
        s.drillWaiting = { since: s.drillWaiting?.since ?? new Date().toISOString(), why: d.waiting };
        writeBackupState(c.state, s);
        say(`· the restore drill waits for the repository: ${d.waiting}`);
        return 1;
      }
      delete s.drillWaiting;
      s.drill = { at: new Date().toISOString(), ...d.drill };
      writeBackupState(c.state, s);
      say(`${d.drill.ok ? "✓" : "✗"} ${d.drill.detail}`);
      return d.drill.ok ? 0 : 1;
    }
  }
}

/** The flags each subcommand takes (`value`: followed by one). An unknown one is refused, never ignored (PIE-660's rule). */
export const BACKUP_FLAGS: Record<string, { bare: string[]; value: string[] }> = {
  run: { bare: ["--drill", "--verbose"], value: [] },
  snapshot: { bare: ["--force", "--verbose"], value: ["--wait"] },
  drill: { bare: ["--json", "--serve"], value: ["--machine"] },
  status: { bare: ["--json", "--verbose"], value: [] },
  list: { bare: [], value: ["--machine"] },
  restore: { bare: [], value: ["--machine", "--at", "--to", "--log", "--entry"] },
  copy: { bare: [], value: [] },
  receive: { bare: [], value: ["--machine", "--outline", "--sha256"] },
  follow: { bare: ["--once"], value: [] },
};

/** The refusal for the first flag a subcommand doesn't take, or null. */
export function unknownFlag(sub: string, rest: readonly string[]): string | null {
  const known = BACKUP_FLAGS[sub];
  if (!known) return null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("-")) continue;
    if (known.value.includes(a)) { i++; continue; }
    if (known.bare.includes(a)) continue;
    const valid = [...known.bare, ...known.value.map(v => `${v} <value>`)];
    return `ep0ch backup ${sub}: unknown flag ${a}; ${valid.length ? `${sub} takes ${valid.join(", ")}` : `${sub} takes no flags`}`;
  }
  return null;
}

export async function backupCommand(args: readonly string[], io: IO = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  const sub = args[1];
  const refused = sub ? unknownFlag(sub, args.slice(2)) : null;
  if (refused) { io.err(refused); return 2; }
  const c = backupConfig(env);
  if ("error" in c) { io.err(`ep0ch backup: ${c.error}`); return 2; }
  const say = (s: string) => io.out(s);
  // The hub's drill for another machine (PIE-810, relay.ts drillVia): reads that machine's repository, writes no state here.
  if (sub === "drill" && flag(args, "--machine")) {
    const machine = flag(args, "--machine")!;
    const answer = (x: unknown) => { io.out(JSON.stringify(x)); };
    if (!MACHINE_NAME.test(machine) || machine === c.machine) { answer({ error: `${machine} isn't another machine's name` }); return 2; }
    if (!c.mirrors.some(m => m.machine === machine)) { answer({ error: `${c.machine} doesn't mirror ${machine}: add it to EP0CH_BACKUP_MIRRORS in ${c.file}` }); return 2; }
    const d = await drill(c, { machine, say: args.includes("--json") ? () => {} : say, ...(args.includes("--serve") ? { serve: true } : {}) });
    if (args.includes("--json")) answer(d); else say(`${d.ok ? "✓" : "✗"} ${d.detail}`);
    return d.ok ? 0 : 1;
  }
  // The parts that write the job's state run one at a time, as the timer's run does (takeLock).
  if (sub === "snapshot" || sub === "drill") {
    // `--wait <seconds>` (install's rollback point, PIE-1800): a backup already running is waited for, said once.
    const wait = sub === "snapshot" && flag(args, "--wait") !== undefined ? Number(flag(args, "--wait")) : 0;
    if (!Number.isFinite(wait) || wait < 0) { io.err("ep0ch backup snapshot: --wait takes a number of seconds"); return 2; }
    const release = wait > 0 ? await waitForLock(c, wait * 1000, pid => say(`· waiting for another backup command (pid ${pid}) to finish, up to ${wait} s`)) : takeLock(c);
    if (typeof release === "string") { io.err(`ep0ch backup: ${release}`); return 1; }
    try { return await stateful(sub, args, c, io); } finally { release(); }
  }
  switch (sub) {
    case "follow": {
      // The followers (ADR 0009): each outline EP0CH_MCP_MIRRORS names, applied from its home's log as it changes.
      const { followCommand } = await import("./follow");
      return followCommand(c, io, { once: args.includes("--once"), env });
    }
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
        const r = await runAll(c, { say: line, step, ...(args.includes("--drill") ? { drill: true } : {}), ...(args.includes("--verbose") ? { verbose: true } : {}) });
        (task as ReturnType<Progress["task"]> | null)?.end(r.ok);
        task = null;
        status.report(r.ok ? { state: "done", msg: "backup run finished" } : { state: "error", msg: "backup run failed: ep0ch backup status says what" });
        return r.ok ? 0 : 1;
      } finally { progress.close(); }
    }
    case "status": {
      if (args.includes("--json")) io.out(JSON.stringify({ machine: c.machine, repo: c.repoOf(c.machine), state: readBackupState(c.state), alert: readAlert(c.state) }, null, 2));
      else {
        const terminal = io.terminal ?? (io.out === console.log ? process.stdout : undefined);
        statusLines(c, Date.now(), { verbose: args.includes("--verbose"), colour: !!terminal?.isTTY && !env.NO_COLOR && env.TERM !== "dumb" }).forEach(say);
      }
      return 0;
    }
    case "list": {
      const outline = args[2], machine = flag(args, "--machine") ?? c.machine;
      if (!outline || outline.startsWith("-")) { io.err(`ep0ch backup list <outline> [--machine <name>]`); return 2; }
      const list = await snapshots(c, c.repoOf(machine), { all: true, outline });
      if ("error" in list) { io.err(`ep0ch backup: can't list ${c.repoOf(machine)}: ${list.error}`); return 1; }
      if (!list.length) { io.err(`ep0ch backup: no snapshot of ${outline} in ${c.repoOf(machine)}`); return 1; }
      for (const x of list) say(`${x.id.slice(0, 8)}  ${hhmm(x.time)}  log entry ${x.seq ?? "?"}`);
      return 0;
    }
    case "copy": {
      // A consistent copy of a live outline, made by its host (PIE-1750): what a script takes instead of opening the file.
      const outline = args[2], to = args[3];
      if (!outline || !OUTLINE_NAME.test(outline) || !to || to.startsWith("-")) { io.err(`ep0ch backup copy <outline> <file>`); return 2; }
      const dest = resolve(to);
      mkdirSync(dirname(dest), { recursive: true });
      try {
        const made = await hostCopy(c, outline, dest);
        say(`✓ ${outline} (change ${made.seq}, schema ${made.schema}, ${made.bytes} bytes) → ${dest}; integrity ok`);
        return 0;
      } catch (e) {
        io.err(`ep0ch backup copy: ${(e as Error).message}${["ENOENT", "ECONNREFUSED"].includes(String((e as NodeJS.ErrnoException).code)) ? `; the outline host doesn't answer at ${c.host}: ${hostStartCommand()}` : ""}`);
        return 1;
      }
    }
    case "restore": {
      const outline = args[2], to = flag(args, "--to"), at = flag(args, "--at"), machine = flag(args, "--machine") ?? c.machine;
      // `--log <id> --entry <n>` (install's rollback point, Codex on #1502): exactly that entry of that log, checked.
      const logId = flag(args, "--log"), entryText = flag(args, "--entry"), entry = entryText === undefined ? undefined : Number(entryText);
      if (!outline || !OUTLINE_NAME.test(outline) || !to || (entry !== undefined && (!Number.isSafeInteger(entry) || entry < 1 || !logId)) || (logId !== undefined && entry === undefined) || (entry !== undefined && at !== undefined)) { io.err(`ep0ch backup restore <outline> [--machine <name>] [--at <time> | --log <id> --entry <n>] --to <path>`); return 2; }
      const dest = resolve(to);
      if (existsSync(dest) || (() => { try { lstatSync(dest); return true; } catch { return false; } })()) { io.err(`ep0ch backup: ${dest} exists; restore writes a new file (pick another --to, or move that one away)`); return 2; }
      if (isInside(c.outlines, dest) || isInside(c.mirrorsDir, dest)) {
        const live = join(c.outlines, `${outline}.sqlite`);
        const { stop, start } = hostUnitCommands(process.platform);
        io.err(`ep0ch backup: ${dest} is in ${isInside(c.outlines, dest) ? c.outlines : c.mirrorsDir}, which a service has open; restore elsewhere and swap it in with the host stopped:\n`
          + `  ep0ch backup restore ${outline} --to /tmp/${outline}.sqlite\n  ${stop}\n  mkdir -p ~/backups/${outline}-before-restore && mv ${live}* ~/backups/${outline}-before-restore/ && cp /tmp/${outline}.sqlite ${live}\n  ${start}`);
        return 2;
      }
      const when = at === undefined ? null : parseAt(at);
      if (at !== undefined && when === null) { io.err(`ep0ch backup: --at ${at} isn't a time (2026-10-06T14:00, 3h, 2d)`); return 2; }
      const repo = c.repoOf(machine);
      // The newest archive holds the log since its newest genesis; --at replays up to that moment, from an earlier
      // snapshot when the moment is before it (ADR 0009 §6).
      const list = await snapshots(c, repo, { all: true, outline });
      if ("error" in list) { io.err(`ep0ch backup: can't list ${repo}: ${list.error}`); return 1; }
      if (!list.length) { io.err(`ep0ch backup: no archive of ${outline} in ${repo}`); return 1; }
      mkdirSync(dirname(dest), { recursive: true });
      // Staged in a private folder beside it (the same file system), then linked in: link never replaces a file
      // that appeared meanwhile.
      const stage = mkdtempSync(join(dirname(dest), ".restore-"));
      let replayed: Replayed | null = null, snap = list.at(-1)!, why = "";
      const skipped: string[] = [];
      try {
        for (const candidate of [...list].reverse()) {
          // An exact entry: only a snapshot of that log that reaches it.
          if (entry !== undefined && (candidate.logId !== logId || (candidate.seq ?? 0) < entry)) continue;
          const tmp = join(stage, `${candidate.id}.sqlite`);
          const got = await restoreArchive(c, repo, candidate, join(stage, candidate.id));
          if ("error" in got) { why = `restoring ${candidate.id.slice(0, 8)} failed: ${got.error}`; skipped.push(why); continue; }
          try { replayed = replayArchive(got.root, outline, tmp, { ...(when === null ? {} : { until: when }), ...(entry !== undefined ? { through: entry } : {}), ...(candidate.logId ? { logId: candidate.logId } : {}) }); snap = candidate; }
          catch (e) { why = `replaying ${candidate.id.slice(0, 8)} failed: ${(e as Error).message}`; skipped.push(why); continue; }
          if (entry !== undefined && replayed.lsn !== entry) { io.err(`ep0ch backup: the replay of ${candidate.id.slice(0, 8)} ends at entry ${replayed.lsn}, not ${entry}; nothing written`); return 1; }
          const verdict = integrity(tmp);
          if (verdict !== "ok") { io.err(`ep0ch backup: the replay of ${candidate.id.slice(0, 8)} failed its check: ${verdict}`); return 1; }
          try { linkSync(tmp, dest); } catch (e) { io.err(`ep0ch backup: ${dest}: ${(e as Error).message}; nothing written`); return 1; }
          break;
        }
        if (!replayed) { io.err(`ep0ch backup: ${why || (entry !== undefined ? `no snapshot of log ${logId} reaches entry ${entry}` : "nothing to restore")}`); return 1; }
      } finally { rmSync(stage, { recursive: true, force: true }); }
      say(`✓ ${outline} from ${machine}'s archive ${snap.id.slice(0, 8)}, replayed to entry ${replayed.lsn}${replayed.at ? ` (${hhmm(replayed.at)})` : ""}, ${replayed.rows.blocks ?? "?"} blocks → ${dest}; integrity ok`);
      // Not the newest: said, with how far it reaches, so a restore that falls short of --at never reads as complete.
      if (skipped.length) say(`! ${skipped.length} newer archive${skipped.length === 1 ? "" : "s"} couldn't be used (${skipped.join("; ")}): this one was taken ${hhmm(snap.time)}${when !== null && Date.parse(snap.time) < when ? `, before --at ${hhmm(when)}, so the changes after it are not in this copy` : ""}`);
      return 0;
    }
    default:
      io.err(`ep0ch backup: ${sub ? `${sub}? ` : ""}one of run, snapshot, follow, drill, status, list, restore, copy, receive\n${BACKUP_USAGE}`);
      return 2;
  }
}
