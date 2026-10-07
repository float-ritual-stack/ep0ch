// An outline's file removed, moved or made again where Litestream replicates it (PIE-607). Litestream doesn't track a
// database being deleted or replaced: a change to the file under a running replicator can leave its history (the
// `.<name>.sqlite-litestream` folder and the bucket) out of step with the file. Litestream's own rule, from its
// source (db.go): with its meta folder kept, a database made again at the same path is seen (its WAL salt reset) and
// gets a full snapshot at the next transaction of the same lineage, safely; the harm comes from `litestream reset`, or a
// lost meta folder, while the bucket keeps the old history. So the change is made with the replicator stopped, the meta
// folder is kept, and nothing here resets: the only fresh start is doctor's, which clears the bucket's prefix too.
//
// `withLitestreamPaused(files, what, change)`: when a Litestream replicator on this machine (a systemd user unit or a
// launchd agent running `litestream replicate`) has a config covering one of the files (its `path`, or a `dir:` whose
// pattern matches, made yet or not), it's stopped, the change made, and it's started again. The pause is a record on
// disk (a row of `<state>/litestream-paused/pauses.sqlite`) listing the processes holding it, so changes in several processes share
// one stop and the last one out starts it; a holder that died (a crash, a kill) is pruned by the next guard, the host's
// start and the backup job (`recoverPaused`), which start the replicator again. A replicator whose state or config
// can't be read, or that won't stop, refuses the change with the commands that make it by hand. Scratch folders no
// config covers are never touched.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { configEntries, covers, type LitestreamUnit, litestreamUnits, type Platform } from "./litestream-units";

type Env = Record<string, string | undefined>;
type Run = (argv: string[]) => { code: number; out: string };

const runSync: Run = argv => {
  try {
    const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? 1, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
  } catch (e) { return { code: 127, out: (e as Error).message }; }
};

export interface GuardOptions {
  platform?: Platform; home?: string; run?: Run; env?: Env;
  /** Where pause records live (default `$XDG_STATE_HOME/ep0ch/litestream-paused`). */
  records?: string;
  /** Whether a process is alive (a test's fake). */
  alive?: (pid: number) => boolean;
}

const platformOf = (p = process.platform): Platform => (p === "linux" ? "linux" : p === "darwin" ? "macos" : "other");
const homeOf = (o: GuardOptions) => o.home ?? o.env?.HOME ?? process.env.HOME ?? homedir();
const recordsOf = (o: GuardOptions) => o.records ?? join((o.env ?? process.env).XDG_STATE_HOME || join(homeOf(o), ".local/state"), "ep0ch", "litestream-paused");
const aliveDefault = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** Litestream's meta folder for a database: `.<file>-litestream` beside it. */
export const metaDir = (db: string) => resolve(dirname(db), `.${basename(db)}-litestream`);

/** The replicators whose configs cover one of these databases; a config that can't be read or parsed is `unreadable`. */
export function replicatorsFor(files: readonly string[], o: GuardOptions = {}): { units: LitestreamUnit[]; unreadable: LitestreamUnit[] } {
  const units: LitestreamUnit[] = [], unreadable: LitestreamUnit[] = [];
  for (const u of litestreamUnits(o.platform ?? platformOf(), homeOf(o))) {
    if (u.role !== "replicate") continue;
    let entries: ReturnType<typeof configEntries> = null;
    try { entries = configEntries(readFileSync(u.config, "utf8"), { ...(o.env ?? process.env), HOME: homeOf(o) }); } catch { /* unreadable */ }
    if (!entries) unreadable.push(u);
    else if (files.some(f => covers(entries!, f))) units.push(u);
  }
  return { units, unreadable };
}

const stopArgv = (u: LitestreamUnit, uid: number) => (u.kind === "systemd" ? ["systemctl", "--user", "stop", u.name] : ["launchctl", "bootout", `gui/${uid}/${u.name}`]);
const startArgv = (u: LitestreamUnit, uid: number) => (u.kind === "systemd" ? ["systemctl", "--user", "start", u.name] : ["launchctl", "bootstrap", `gui/${uid}`, u.path]);
const said = (argv: string[]) => argv.join(" ").replace(/gui\/\d+/, "gui/$(id -u)");

/** Whether it runs: true, false, or null when that can't be told (then nothing is changed). */
export function running(u: Pick<LitestreamUnit, "kind" | "name">, run: Run, uid: number): boolean | null {
  if (u.kind === "systemd") {
    const out = run(["systemctl", "--user", "is-active", u.name]).out.split("\n")[0]!.trim();
    return ["active", "activating", "reloading", "deactivating"].includes(out) ? true : out === "inactive" || out === "failed" ? false : null;
  }
  const r = run(["launchctl", "print", `gui/${uid}/${u.name}`]);
  if (r.code === 0) return true;
  return /could not find service|not find service|no such process/i.test(r.out) ? false : null;
}

/** A pause on disk: the changes holding it (`<pid>:<n>`, one per change, so nested changes in one process each count). */
interface PauseRecord { unit: string; kind: LitestreamUnit["kind"]; path: string; holders: string[]; since: string; state?: "stopping" | "paused" }
const pidOf = (holder: string | number) => Number(String(holder).split(":")[0]);
let changes = 0;

/** The pause records, read and changed by one process at a time. */
interface Pauses { get(unit: string): PauseRecord | null; put(rec: PauseRecord): void; del(unit: string): void; all(): PauseRecord[] }

/**
 * The records are rows of a small SQLite file (`pauses.sqlite`), changed in an IMMEDIATE transaction: SQLite's own lock
 * makes it one process at a time, and a process that dies holding it releases it, so there's no lock file to take over.
 */
function withPauses<T>(dir: string, f: (p: Pauses) => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "pauses.sqlite"));
  try {
    db.run("PRAGMA busy_timeout = 10000");
    db.run("CREATE TABLE IF NOT EXISTS pauses (unit TEXT PRIMARY KEY, record TEXT NOT NULL)");
    const p: Pauses = {
      get: unit => { const row = db.query("SELECT record FROM pauses WHERE unit = ?").get(unit) as { record: string } | null; return row ? JSON.parse(row.record) as PauseRecord : null; },
      put: rec => { db.run("INSERT OR REPLACE INTO pauses (unit, record) VALUES (?, ?)", [rec.unit, JSON.stringify(rec)]); },
      del: unit => { db.run("DELETE FROM pauses WHERE unit = ?", [unit]); },
      all: () => (db.query("SELECT record FROM pauses").all() as { record: string }[]).map(r => JSON.parse(r.record) as PauseRecord),
    };
    return db.transaction(() => f(p)).immediate();
  } finally { db.close(); }
}

/**
 * Pauses held by processes that are gone (a crash mid-change): their replicators started again, their records removed.
 * Returns what it started, for a log line. Safe to call any time; the host calls it as it starts, the backup job each run.
 */
export function recoverPaused(o: GuardOptions = {}): string[] {
  const dir = recordsOf(o), run = o.run ?? runSync, alive = o.alive ?? aliveDefault, uid = process.getuid?.() ?? 0;
  if (!existsSync(join(dir, "pauses.sqlite"))) return [];
  return withPauses(dir, p => {
    const started: string[] = [];
    for (const rec of p.all()) {
      rec.holders = rec.holders.filter(h => alive(pidOf(h)));
      if (rec.holders.length) { p.put(rec); continue; }
      const r = run(startArgv({ kind: rec.kind, name: rec.unit, path: rec.path } as LitestreamUnit, uid));
      if (r.code === 0) { p.del(rec.unit); started.push(rec.unit); }
    }
    return started;
  });
}

/**
 * Runs `change` (which removes, moves or makes these outline files) with this machine's Litestream replicator for
 * them stopped. `what` names the change in a refusal.
 */
export async function withLitestreamPaused<T>(files: readonly string[], what: string, change: () => T | Promise<T>, o: GuardOptions = {}): Promise<T> {
  const run = o.run ?? runSync, alive = o.alive ?? aliveDefault, uid = process.getuid?.() ?? 0, dir = recordsOf(o);
  const { units, unreadable } = replicatorsFor(files, o);
  const names = files.map(f => basename(f)).join(", ");
  const by = (u: LitestreamUnit, why: string) => new Error(`Litestream (${u.name}) may replicate ${names} and ${why}, so ${what} was refused; nothing was changed. `
    + `Make the change with it stopped: ${said(stopArgv(u, uid))}, then ${what} again, then ${said(startArgv(u, uid))}. Keep ${files.map(metaDir).filter(existsSync).join(", ") || "its .<name>.sqlite-litestream folder"}: never litestream reset while the bucket keeps the old history`);
  const live = unreadable.find(u => running(u, run, uid) !== false);
  if (live) throw by(live, `its config ${live.config} can't be read`);
  if (units.length) recoverPaused(o);
  const held: LitestreamUnit[] = [];
  const me = `${process.pid}:${++changes}`;
  const release = () => {
    if (!held.length) return;
    withPauses(dir, p => {
      for (const u of held) {
        const rec = p.get(u.name);
        const holders = (rec?.holders ?? []).filter(h => h !== me && alive(pidOf(h)));
        if (rec && holders.length) { p.put({ ...rec, holders }); continue; }
        const r = run(startArgv(u, uid));
        if (r.code === 0) p.del(u.name);
        // Left for recoverPaused (the next guard, the host's start, the backup job), and said.
        else console.error(`litestream guard: ${u.name} didn't start again after ${what}: ${r.out}; start it: ${said(startArgv(u, uid))}`);
      }
    });
  };
  try {
    // One unit at a time, each in short transactions of its own, so a unit already paused keeps its committed record
    // whatever happens to the next one:
    //   1. the record, marked `stopping`, committed before the stop (a crash from here on leaves it for recoverPaused);
    //   2. the stop, outside any transaction;
    //   3. the record marked `paused` (or taken back, when the stop failed).
    // A change elsewhere that finds a `stopping` record waits for it to settle before it joins.
    for (const u of units) {
      for (let waited = 0; ; waited += 50) {
        const step = withPauses(dir, p => {
          const rec = p.get(u.name);
          const live = (rec?.holders ?? []).filter(h => alive(pidOf(h)));
          if (rec && live.length && rec.state === "stopping") return "wait" as const;
          // Already paused by a live change elsewhere: held here too, so it isn't started under this change.
          if (rec && live.length) { p.put({ ...rec, holders: [...live, me] }); return "held" as const; }
          const now = running(u, run, uid);
          if (now === false) return "stopped" as const;
          if (now === null) return "unknown" as const;
          p.put({ unit: u.name, kind: u.kind, path: u.path, holders: [me], since: new Date().toISOString(), state: "stopping" });
          return "stop" as const;
        });
        if (step === "wait") { if (waited > 120_000) throw by(u, "another change has been stopping it for two minutes"); Bun.sleepSync(50); continue; }
        if (step === "unknown") throw by(u, "its state can't be read");
        if (step === "held") held.push(u);
        if (step === "stop") {
          held.push(u);
          const r = run(stopArgv(u, uid));
          withPauses(dir, p => {
            const rec = p.get(u.name);
            if (r.code === 0 && rec) p.put({ ...rec, state: "paused" });
            else if (r.code !== 0) { p.del(u.name); held.pop(); }
          });
          if (r.code !== 0) throw by(u, `couldn't be stopped (${r.out.split("\n").at(-1) || `exit ${r.code}`})`);
        }
        break;
      }
    }
    return await change();
  } finally { release(); }
}
