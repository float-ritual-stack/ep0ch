// An outline's file removed, moved or made again where Litestream replicates it (PIE-607). Litestream doesn't track a
// database being deleted or replaced: a change to the file under a running replicator can leave its history (the
// `.<name>.sqlite-litestream` folder and the bucket) out of step with the file. Litestream's own rule, from its
// source (db.go): with its meta folder kept, a database made again at the same path is seen (its WAL salt reset) and
// gets a full snapshot at the next transaction of the same lineage, safely; the harm comes from `litestream reset`, or a
// lost meta folder, while the bucket keeps the old history. So the change is made with the replicator stopped, the meta
// folder is kept, and nothing here resets: the only fresh start is doctor's, which clears the bucket's prefix too.
//
// `withLitestreamPaused(files, change)`: when a Litestream replicator on this machine (a systemd user unit or a
// launchd agent running `litestream replicate`) has a config naming one of the files or its folder, and it runs, it's
// stopped, the change made, and it's started again; several changes at once share one stop. A replicator it can't
// stop refuses the change, with the commands that make it by hand. Scratch folders no config names are never touched.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { configDatabases, type LitestreamUnit, litestreamUnits, type Platform } from "./litestream-units";

type Run = (argv: string[]) => { code: number; out: string };

const runSync: Run = argv => {
  try {
    const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? 1, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
  } catch (e) { return { code: 127, out: (e as Error).message }; }
};

export interface GuardOptions { platform?: Platform; home?: string; run?: Run; env?: Record<string, string | undefined> }

const platformOf = (p = process.platform): Platform => (p === "linux" ? "linux" : p === "darwin" ? "macos" : "other");

/** Litestream's meta folder for a database: `.<file>-litestream` beside it. */
export const metaDir = (db: string) => resolve(dirname(db), `.${basename(db)}-litestream`);

/** The replicators whose configs name one of these databases (by path, or a `dir:` entry holding it). */
export function replicatorsFor(files: readonly string[], o: GuardOptions = {}): LitestreamUnit[] {
  const home = o.home ?? process.env.HOME ?? homedir();
  const wanted = new Set(files.map(f => resolve(f)));
  const folders = new Set(files.map(f => resolve(dirname(f))));
  return litestreamUnits(o.platform ?? platformOf(), home).filter(u => {
    if (u.role !== "replicate") return false;
    let text = "";
    try { text = readFileSync(u.config, "utf8"); } catch { return false; }
    // A `dir:` entry names its folder; a file not made yet isn't listed under it, so the folder is matched too.
    const dirs = [...text.matchAll(/^\s*-?\s*dir:\s*["']?([^"'\n#]+?)["']?\s*$/gm)].map(m => resolve(m[1]!.replace(/^~(?=\/)/, home)));
    return configDatabases(text, o.env ?? process.env).some(d => wanted.has(resolve(d.path))) || dirs.some(d => folders.has(d));
  });
}

const stopArgv = (u: LitestreamUnit, uid: number) => (u.kind === "systemd" ? ["systemctl", "--user", "stop", u.name] : ["launchctl", "bootout", `gui/${uid}/${u.name}`]);
const startArgv = (u: LitestreamUnit, uid: number) => (u.kind === "systemd" ? ["systemctl", "--user", "start", u.name] : ["launchctl", "bootstrap", `gui/${uid}`, u.path]);
const said = (argv: string[]) => argv.join(" ").replace(/gui\/\d+/, "gui/$(id -u)");

function running(u: LitestreamUnit, run: Run, uid: number): boolean | null {
  if (u.kind === "systemd") {
    const r = run(["systemctl", "--user", "is-active", u.name]);
    return r.out === "active" || r.out === "activating" || r.out === "reloading" ? true : r.out === "inactive" || r.out === "failed" ? false : null;
  }
  const r = run(["launchctl", "print", `gui/${uid}/${u.name}`]);
  return r.code === 0;
}

/** Stops held by changes in progress, per unit: the first change stops it, the last one starts it again. */
const held = new Map<string, number>();

/**
 * Runs `change` (which removes, moves or makes these outline files) with this machine's Litestream replicator for
 * them stopped. `what` names the change in a refusal.
 */
export async function withLitestreamPaused<T>(files: readonly string[], what: string, change: () => T | Promise<T>, o: GuardOptions = {}): Promise<T> {
  const run = o.run ?? runSync, uid = process.getuid?.() ?? 0;
  const units = replicatorsFor(files, o);
  const stopped: LitestreamUnit[] = [];
  try {
    for (const u of units) {
      if (held.has(u.path)) { held.set(u.path, held.get(u.path)! + 1); stopped.push(u); continue; }
      const now = running(u, run, uid);
      if (now === false) continue;
      const r = now === null ? { code: 1, out: "its state couldn't be read" } : run(stopArgv(u, uid));
      if (r.code !== 0) {
        throw new Error(`Litestream (${u.name}) replicates ${files.map(f => basename(f)).join(", ")} and couldn't be stopped for ${what} (${r.out.split("\n").at(-1) || `exit ${r.code}`}); nothing was changed. `
          + `Make the change with it stopped: ${said(stopArgv(u, uid))}, then ${what} again, then ${said(startArgv(u, uid))}. Keep ${files.map(metaDir).filter(existsSync).join(", ") || "its .<name>.sqlite-litestream folder"}: never litestream reset while the bucket keeps the old history`);
      }
      held.set(u.path, 1);
      stopped.push(u);
    }
    return await change();
  } finally {
    for (const u of stopped) {
      const n = (held.get(u.path) ?? 1) - 1;
      if (n > 0) { held.set(u.path, n); continue; }
      held.delete(u.path);
      const r = run(startArgv(u, uid));
      if (r.code !== 0) console.error(`litestream guard: ${u.name} didn't start again after ${what}: ${r.out}; start it: ${said(startArgv(u, uid))}`);
    }
  }
}
