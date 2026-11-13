// The disk keeper's run (PIE-1787), as its timer (ep0ch-disk.timer, every 15 minutes) runs `ep0ch disk keep`: measure
// each filesystem with df and du, sweep cold Claude files to the storage box through offload when home's filesystem is
// past 75%, measure again, record it, and raise what's wrong through the backup job's alert path. It deletes nothing
// itself: offload removes what it copied and verified, and everything else is its owner's (keeper.ts, OWNERS).
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { type Incident, mergeDisk, readJson } from "../backup/alert";
import { backupConfig, machineNameOf } from "../backup/config";
import { writeState, defaultStateDir } from "../state";
import { backupDirOf } from "../setup/plan";
import { type DiskState, diskIncidents, emptyDisk, escalate, type Fs, parseDf, parsePlaces, percent, type Sample, shouldSweep, type SweepRecord, type Thresholds, thresholds, trimmed } from "./keeper";

type Env = Record<string, string | undefined>;
export type Run = (argv: string[], o: { env: Env; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;

/** The keeper's settings: ~/.config/ep0ch/disk.env (EP0CH_DISK_BOX names the storage box), under what the environment says. */
export const diskSettingsFile = (env: Env) => join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "ep0ch", "disk.env");
export function diskSettings(env: Env): Env {
  const file = diskSettingsFile(env);
  const fromFile = existsSync(file) ? (() => { try { return parseEnvFile(readFileSync(file, "utf8")); } catch { return {}; } })() : {};
  return { ...fromFile, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")) };
}

/** Where the keeper keeps disk.json: beside the backup job's alert.json, so doctor and the status bar read one folder. */
export const diskStateDir = (env: Env) => join(env.EP0CH_STATE ?? defaultStateDir(env), "backup");
export const readDisk = (dir: string): DiskState => ({ ...emptyDisk(), ...readJson<DiskState>(join(dir, "disk.json")) });

export const spawnRun: Run = async (argv, o) => {
  try {
    const p = Bun.spawn(argv, { env: o.env as Record<string, string>, stdout: "pipe", stderr: "pipe", ...(o.timeoutMs ? { timeout: o.timeoutMs } : {}) });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
  } catch (e) { return { code: 127, out: "", err: (e as Error).message }; }
};

export interface KeepOptions {
  env: Env;
  now?: () => number;
  run?: Run;
  announce?: (list: Incident[]) => Promise<void>;
  say?: (line: string) => void;
}

interface Watched { fs: Fs; paths: string[] }

/** df for home, the install backups and /, one filesystem each, with the paths that sit on it. */
async function look(run: Run, env: Env, home: string, logs: string): Promise<Watched[]> {
  const backups = backupDirOf(home);
  const paths = [home, ...(existsSync(backups) ? [(() => { try { return realpathSync(backups); } catch { return backups; } })()] : []), logs, "/"];
  const r = await run(["df", "-Pk", ...paths], { env, timeoutMs: 30_000 });
  const rows = parseDf(r.out);
  if (rows.length !== paths.length) throw new Error(`df -Pk ${paths.join(" ")} answered ${rows.length} rows for ${paths.length} paths${r.err.trim() ? `: ${r.err.trim()}` : ""}`);
  const by = new Map<string, Watched>();
  rows.forEach((fs, i) => { const w = by.get(fs.mount) ?? { fs, paths: [] }; w.paths.push(paths[i]!); by.set(fs.mount, w); });
  return [...by.values()];
}

/** The size of each place on a filesystem: home two levels down and /var/log one, else the mount itself two levels down. */
async function places(run: Run, env: Env, w: Watched, home: string, logs: string): Promise<Record<string, number>> {
  const roots: [string, number][] = [];
  if (w.paths.includes(home)) roots.push([home, 2]);
  if (w.paths.includes(logs)) roots.push([logs, 1]);
  if (!roots.length) roots.push([w.fs.mount, 2]);
  const out: Record<string, number> = {};
  for (const [root, depth] of roots) {
    // du says "Permission denied" for what it can't read and still answers for the rest.
    const r = await run(["du", "-x", "-k", "-d", String(depth), root], { env, timeoutMs: 120_000 });
    Object.assign(out, parsePlaces(r.out, root, depth, home));
  }
  return out;
}

const sample = (fs: Fs, at: number, p?: Record<string, number>): Sample => ({ at: new Date(at).toISOString(), mount: fs.mount, size: fs.size, used: fs.used, avail: fs.avail, ...(p ? { places: p } : {}) });

/** One run of the keeper: what it measured, swept, found and announced, kept in disk.json and alert.json. */
export async function keep(o: KeepOptions): Promise<DiskState & { announced: Record<string, number>; justAnnounced: Incident[] }> {
  const env = diskSettings(o.env);
  const home = env.HOME || homedir();
  const now = o.now ?? Date.now, run = o.run ?? spawnRun, say = o.say ?? (() => {});
  const t: Thresholds = thresholds(env);
  const logs = env.EP0CH_DISK_LOGS || "/var/log";
  const c = backupConfig(env);
  const machine = "error" in c ? machineNameOf(env.EP0CH_HOSTNAME || hostname()) : c.machine;
  const dir = diskStateDir(env);
  let s = readDisk(dir);

  const watched = await look(run, env, home, logs);
  for (const w of watched) s.samples.push(sample(w.fs, now(), await places(run, env, w, home, logs)));
  const mine = watched.find(w => w.paths.includes(home))!;
  say(watched.map(w => `${w.fs.mount}: ${percent(w.fs)}% full`).join("; "));

  if (shouldSweep(mine.fs, t)) {
    const before = percent(mine.fs);
    const offload = env.EP0CH_OFFLOAD || "offload";
    say(`${mine.fs.mount} is ${before}% full (the line is ${t.sweepAt}%): offload --sweep --yes`);
    const r = await run([offload, "--sweep", "--yes"], { env, timeoutMs: 45 * 60_000 });
    const again = (await look(run, env, home, logs)).find(w => w.paths.includes(home))!;
    s.samples.push(sample(again.fs, now(), await places(run, env, again, home, logs)));
    const record: SweepRecord = { at: new Date(now()).toISOString(), mount: mine.fs.mount, code: r.code, before, after: percent(again.fs),
      said: [...r.out.trim().split("\n"), ...r.err.trim().split("\n")].filter(Boolean).slice(-4).join("; ") || "nothing to move" };
    s.sweeps.push(record);
    say(`swept: ${record.before}% → ${record.after}% (offload exit ${record.code}: ${record.said})`);
  }

  const found = watched.flatMap(w => diskIncidents({ machine, box: env.EP0CH_DISK_BOX, samples: s.samples, sweeps: w === mine ? s.sweeps : [], mount: w.fs.mount, t, now: now() }));
  const { announce, announced } = escalate(s.announced, found);
  s = trimmed({ ...s, incidents: found, announced, checkedAt: new Date(now()).toISOString() }, now());
  writeState("disk.json", s, dir);
  mergeDisk(dir, machine, found, now());
  if (announce.length) {
    const send = o.announce ?? (async list => (await import("../backup/jobs")).announceAll({ env }, list));
    await send(announce);
  }
  for (const i of found) say(`${announce.includes(i) ? "announced" : "open"}: ${i.title} · ${i.fix}`);
  return { ...s, justAnnounced: announce };
}
