// Backups in `ep0ch doctor` (PIE-371): the Litestream units on this machine, each as it is. A replicator
// (`litestream replicate`) copies every outline to the bucket; a follower (`litestream restore -f`, float-2's mirrors)
// keeps a read-only copy of another machine's outline from that machine's replica. For each: the unit runs (pid,
// uptime), its log's recent ERROR lines, and how far each replica trails its database (or each mirror its replica).
//
// Read-only, like the rest of doctor: units and logs are read, `litestream ltx` lists the replica's files (run the way
// the unit runs Litestream, through its `with-secrets` or its EnvironmentFile, so the keys reach only that process and
// are never printed), and `--backups` restores into a temp folder it removes. The checks are pure (`backupChecks`), so
// tests describe machines; the remote MCP gateway asks `mirrorHealth` the same questions about one mirror.
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { configDatabases as readConfig, instancesIn, isTemplate, litestreamArgv, litestreamUnits as readUnits, type LitestreamUnit as BaseUnit, replicaUrl, templateInstance } from "@ep0ch/outliner/litestream-units";
import type { Platform, UnitState } from "./model";

export { litestreamArgv, replicaUrl };
/** The Litestream units on this machine (the outliner's reader). */
export const litestreamUnits = (platform: Platform, home: string): LitestreamUnit[] => readUnits(platform, home);
export const configDatabases = readConfig;

type Env = Record<string, string | undefined>;
type Run = (argv: string[], o: { env?: Env; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;

/** A replica behind its database for longer than this, while the database changed, is stale. */
export const STALE_AFTER_MS = 10 * 60_000;

/** A replica's newest file: the highest transaction it holds, and when that file was written. */
export interface ReplicaPosition { txid: number; at: string; files: { txid: number; minTxid: number; at: string; level: number }[] }

/** One database a unit replicates (or a mirror it follows), and where each side is. */
export interface ReplicaFacts {
  name: string;
  path: string;
  url: string | null;
  /** The database's own replication position: Litestream's local state (`.<file>-litestream/ltx`), and the last write. */
  local?: { txid: number | null; lastWrite: number | null; written?: { txid: number; at: number }[] };
  /** A follower's mirror: the transaction it has applied (`<file>-txid`). */
  mirror?: { txid: number | null };
  replica: ReplicaPosition | { error: string };
  /** `--backups`: the newest snapshot restored into a temp folder and checked. */
  restore?: { ok: boolean; detail: string };
}

export interface LogFacts {
  errorsLastHour: number; latest?: { at: string; line: string }; byDb: Record<string, string>;
  /** The databases whose latest error is a lost file of Litestream's local state (`open ltx file … no such file`). */
  lostState?: string[];
  unavailable?: string;
}

export interface BackupUnitFacts {
  unit: LitestreamUnit; log: LogFacts; dbs: ReplicaFacts[]; problem?: string;
  /**
   * A follower: whether its unit restores fresh on every start (ExecStartPre removing the mirror and its -txid), the
   * way round Litestream 0.5.17 refusing to resume a follow whose saved txid is past the newest snapshot (#1385).
   * A replicator: its config's snapshot interval and retention (the restore history), when it sets them.
   */
  freshOnStart?: boolean;
  snapshot?: { interval?: string; retention?: string };
}
export interface BackupFacts { units: BackupUnitFacts[]; now: number }

/** A Litestream unit, as doctor sees it: the outliner's reading of its file, and what launchd or systemd says now. */
export interface LitestreamUnit extends BaseUnit { state?: UnitState & { since?: string } }

/** A unit restarted, as a person would type it. */
export const restartCommand = (u: Pick<LitestreamUnit, "kind" | "name">) =>
  u.kind === "systemd" ? `systemctl --user restart ${u.name}` : `launchctl kickstart -k gui/$(id -u)/${u.name}`;
const stopCommand = (u: LitestreamUnit) => u.kind === "systemd" ? `systemctl --user stop ${u.name}` : `launchctl bootout gui/$(id -u)/${u.name}`;
const startCommand = (u: LitestreamUnit) => u.kind === "systemd" ? `systemctl --user start ${u.name}` : `launchctl bootstrap gui/$(id -u) ${u.path}`;

// ── positions ────────────────────────────────────────────────────────────────────────────────────────────────

/** An LTX file's name, `<min txid>-<max txid>.ltx` in hex. */
export const ltxRange = (name: string): [number, number] | null => {
  const m = /^([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/i.exec(name);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16)] : null;
};

/** The highest transaction in Litestream's local state for a database (`.<file>-litestream/ltx/<level>/`), or null. */
export function localTxid(db: string): number | null {
  const state = join(dirname(db), `.${basename(db)}-litestream`, "ltx");
  let best: number | null = null;
  let levels: string[] = [];
  try { levels = readdirSync(state); } catch { return null; }
  for (const level of levels) {
    let names: string[] = [];
    try { names = readdirSync(join(state, level)); } catch { continue; }
    for (const n of names) { const r = ltxRange(n); if (r && (best === null || r[1] > best)) best = r[1]; }
  }
  return best;
}

/** Litestream's local level-0 files for a database: each one's last transaction, and when it was written here. */
export function localWrites(db: string): { txid: number; at: number }[] {
  const dir = join(dirname(db), `.${basename(db)}-litestream`, "ltx", "0");
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap(n => { const r = ltxRange(n); if (!r) return []; try { return [{ txid: r[1], at: statSync(join(dir, n)).mtimeMs }]; } catch { return []; } });
}

/** When a database was last written: its file or its WAL, whichever is newer. */
export function lastWrite(db: string): number | null {
  const times = ["", "-wal"].flatMap(s => { try { return [statSync(db + s).mtimeMs]; } catch { return []; } });
  return times.length ? Math.max(...times) : null;
}

/** `litestream ltx -level all -json`'s answer, read: the highest transaction, and when its file was written. */
export function parseLtxList(json: string): ReplicaPosition | { error: string } {
  let rows: { level?: number; min_txid?: string; max_txid?: string; timestamp?: string }[];
  try { rows = JSON.parse(json); } catch { return { error: `litestream ltx answered ${JSON.stringify(json.trim().slice(0, 120))}` }; }
  if (!Array.isArray(rows)) return { error: "litestream ltx didn't answer a list" };
  const files = rows.flatMap(r => r.max_txid && r.timestamp ? [{ txid: parseInt(r.max_txid, 16), minTxid: parseInt(r.min_txid ?? r.max_txid, 16), at: r.timestamp, level: r.level ?? 0 }] : []);
  if (!files.length) return { error: "the replica holds no files" };
  const newest = files.reduce((a, b) => (b.txid > a.txid || (b.txid === a.txid && b.at > a.at) ? b : a));
  return { txid: newest.txid, at: newest.at, files };
}

/** The environment a unit's Litestream runs with: ours, plus its EnvironmentFile's KEY=value lines (never printed). */
export function unitEnv(u: LitestreamUnit, env: Env): Env {
  if (!u.envFile) return env;
  let text = "";
  try { text = readFileSync(u.envFile, "utf8"); } catch { return env; }
  const vars: Env = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) vars[m[1]!] = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { ...env, ...vars };
}

/**
 * Text from a Litestream run or log with anything key-shaped taken out: the unit's EnvironmentFile values, a URL's
 * user:password, and `<name>=<value>` / `<name>: <value>` for names that say key, secret, token or password.
 */
export function redact(text: string, u?: LitestreamUnit, env: Env = {}): string {
  let out = text;
  void env;
  if (u?.envFile) for (const v of Object.values(unitEnv(u, {}))) if (v && v.length >= 6) out = out.split(v).join("<redacted>");
  return out
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1<redacted>@")
    .replace(/\b([A-Za-z_-]*(?:key|secret|token|password)[A-Za-z_-]*)(\s*[=:]\s*)("[^"]*"|[^\s",}]+)/gi, "$1$2<redacted>");
}

/** The replica's position, asked the way the unit runs Litestream. Errors are said without the command's environment. */
export async function replicaPosition(u: LitestreamUnit, url: string, run: Run, env: Env): Promise<ReplicaPosition | { error: string }> {
  const r = await run([...u.wrapper, u.litestream, "ltx", "-level", "all", "-json", url], { env: unitEnv(u, env), timeoutMs: 30_000 });
  if (r.code !== 0) return { error: `litestream ltx failed: ${redact((r.err.trim().split("\n").at(-1) ?? "").slice(0, 200), u, env) || `exit ${r.code}`}` };
  return parseLtxList(r.out);
}

// ── logs ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A Litestream log's ERROR lines (slog text: `time=… level=ERROR msg=… db=…`): how many in the hour before `now` (and
 * since `started`, the running process's start: what an earlier process logged is history), the latest, and the
 * latest for each database.
 */
export function logErrors(text: string, now: number, started?: number): LogFacts {
  const from = Math.max(now - 3_600_000, started ?? 0);
  let count = 0, latest: LogFacts["latest"];
  const byDb: Record<string, string> = {};
  const lost = new Map<string, boolean>();
  for (const line of text.split("\n")) {
    if (!line.includes("level=ERROR")) continue;
    const at = /time=(\S+)/.exec(line)?.[1];
    const t = at ? Date.parse(at) : NaN;
    const clean = redact(line);
    const short = clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
    latest = { at: at ?? "", line: short };
    if (!(Number.isFinite(t) && t >= from)) continue;
    count++;
    const db = /\bdb=(\S+)/.exec(line)?.[1];
    if (db) { byDb[db] = short; lost.set(db, /open ltx file .*no such file/i.test(line)); }
  }
  const lostState = [...lost].filter(([, l]) => l).map(([db]) => db).sort();
  return { errorsLastHour: count, ...(latest ? { latest } : {}), byDb, ...(lostState.length ? { lostState } : {}) };
}

async function unitLog(u: LitestreamUnit, run: Run, now: number, started?: number): Promise<LogFacts> {
  if (u.kind === "launchd") {
    if (!u.logPaths?.length) return { errorsLastHour: 0, byDb: {}, unavailable: "the agent names no log file" };
    try {
      const texts = await Promise.all(u.logPaths.filter(existsSync).map(p => Bun.file(p).slice(Math.max(0, statSync(p).size - 2 * 1024 * 1024)).text()));
      // Lines in time order across both files (each line starts with its time=).
      return logErrors(texts.join("\n").split("\n").sort().join("\n"), now, started);
    } catch (e) { return { errorsLastHour: 0, byDb: {}, unavailable: `can't read ${u.logPaths.join(", ")}: ${(e as Error).message}` }; }
  }
  const r = await run(["journalctl", "--user", "-u", u.name, "-n", "5000", "-o", "cat", "--no-pager"], { timeoutMs: 10_000 });
  if (r.code !== 0) return { errorsLastHour: 0, byDb: {}, unavailable: `journalctl failed: ${r.err.trim().slice(0, 160)}` };
  return logErrors(r.out, now, started);
}

// ── gathering ────────────────────────────────────────────────────────────────────────────────────────────────

/** How long a process has run, from `ps -o etime=` ([[dd-]hh:]mm:ss). */
export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  return m ? ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]) : null;
}

async function unitStateOf(u: LitestreamUnit, run: Run, now: number): Promise<UnitState & { since?: string }> {
  const { launchdState, systemdState } = await import("./facts");
  const uid = process.getuid?.() ?? 0;
  const state = u.kind === "launchd"
    ? launchdState(await run(["launchctl", "print", `gui/${uid}/${u.name}`], { timeoutMs: 5000 }).then(r => r.code === 0 ? r.out : null))
    : systemdState(await run(["systemctl", "--user", "show", u.name, "-p", "ActiveState,SubState,MainPID,ExecMainStatus"], { timeoutMs: 5000 }).then(r => r.code === 0 ? r.out : null));
  if (!state.pid) return state;
  const ps = await run(["ps", "-o", "etime=", "-p", String(state.pid)], { timeoutMs: 5000 });
  const secs = ps.code === 0 ? etimeSeconds(ps.out) : null;
  return secs === null ? state : { ...state, since: new Date(now - secs * 1000).toISOString() };
}

/** Restore a replica's newest snapshot into a temp folder, check it, and remove the folder. */
async function restoreTest(u: LitestreamUnit, url: string, run: Run, env: Env): Promise<{ ok: boolean; detail: string }> {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-restore-"));
  try {
    const out = join(dir, "restored.sqlite");
    const r = await run([...u.wrapper, u.litestream, "restore", "-o", out, url], { env: unitEnv(u, env), timeoutMs: 300_000 });
    if (r.code !== 0) return { ok: false, detail: `restore failed: ${redact((r.err.trim().split("\n").at(-1) ?? "").slice(0, 200), u, env) || `exit ${r.code}`}` };
    const db = new Database(out, { readonly: true });
    try {
      const rows = db.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
      const ok = rows.length === 1 && rows[0]!.integrity_check === "ok";
      return { ok, detail: ok ? `restored (${Math.round(statSync(out).size / 1024)} KiB) and integrity_check ok` : `integrity_check: ${rows.slice(0, 3).map(x => x.integrity_check).join("; ")}` };
    } finally { db.close(); }
  } catch (e) { return { ok: false, detail: (e as Error).message }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Every Litestream unit here, as it is: read-only (with `restore`, a temp folder is written and removed). */
/**
 * The units as they run: a systemd template (`litestream-mirror@.service`) is each of its instances systemd knows
 * (`litestream-mirror@float-hub.service`), never the bare template, which never runs itself.
 */
export async function runningUnits(platform: Platform, home: string, run: Run): Promise<LitestreamUnit[]> {
  const out: LitestreamUnit[] = [];
  for (const u of litestreamUnits(platform, home)) {
    if (!isTemplate(u)) { out.push(u); continue; }
    const r = await run(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", u.name.replace("@.service", "@*.service")], { timeoutMs: 5000 });
    for (const i of r.code === 0 ? instancesIn(r.out, u.name) : []) out.push(templateInstance(u, i));
  }
  return out;
}

export async function gatherBackups(o: { platform: Platform; home: string; env: Env; run: Run; now?: number; restore?: boolean }): Promise<BackupFacts> {
  const now = o.now ?? Date.now();
  const units = await runningUnits(o.platform, o.home, o.run);
  return {
    now,
    units: await Promise.all(units.map(async (u): Promise<BackupUnitFacts> => {
      const state = await unitStateOf(u, o.run, now);
      const log = await unitLog(u, o.run, now, state.since ? Date.parse(state.since) : undefined);
      const unit = { ...u, state };
      let text: string;
      try { text = readFileSync(u.config, "utf8"); } catch (e) { return { unit, log, dbs: [], problem: `can't read its config ${u.config}: ${(e as Error).message}` }; }
      const all = u.url ? [{ path: u.output!, url: u.url }] : configDatabases(text, unitEnv(u, o.env));
      const named = u.role === "follow" ? all.filter(d => resolve(d.path) === resolve(u.output!)) : all;
      const dbs = await Promise.all(named.map(async (d): Promise<ReplicaFacts> => {
        const name = basename(d.path).replace(/\.sqlite$/, "");
        const replica = d.url ? await replicaPosition(u, d.url, o.run, o.env) : { error: "no replica URL in the config this check can read" };
        const side = u.role === "follow"
          ? { mirror: { txid: (() => { try { return parseInt(readFileSync(`${d.path}-txid`, "utf8").trim(), 16); } catch { return null; } })() } }
          : { local: { txid: localTxid(d.path), lastWrite: lastWrite(d.path), written: localWrites(d.path) } };
        const restore = o.restore && d.url && !("error" in replica) ? { restore: await restoreTest(u, d.url, o.run, o.env) } : {};
        return { name, path: d.path, url: d.url, ...side, replica, ...restore };
      }));
      let unitText = "";
      try { unitText = readFileSync(u.path, "utf8"); } catch { /* said elsewhere */ }
      const extra = u.role === "follow"
        ? { freshOnStart: /^\s*ExecStartPre\s*=.*\brm\b.*-txid/m.test(unitText) }
        : { snapshot: (() => { try { const y = Bun.YAML.parse(text) as { snapshot?: { interval?: string; retention?: string } } | null; return y?.snapshot ?? {}; } catch { return {}; } })() };
      return { unit, log, dbs, ...extra };
    })),
  };
}

// ── verdicts ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Verdict = { status: "ok" | "behind" | "missing" | "info" | "unknown"; detail: string; fix?: string };

const hhmm = (t: number | string) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z";
const hex = (n: number) => n.toString(16);

/** The commands that give databases' replication a fresh start: each one's local state and its replica's old history go. */
export function freshStart(u: LitestreamUnit, dbs: Pick<ReplicaFacts, "path" | "url">[], home: string): string {
  const moves = dbs.map(db => `mv ${join(dirname(db.path), `.${basename(db.path)}-litestream`)} ${join(home, "backups", "ep0ch", `litestream-state-$(date +%Y%m%dT%H%M%S)-${basename(db.path)}`)}`);
  const prefixes = dbs.map(db => db.url ? `${db.url.replace(/\?.*$/, "")}/` : `${basename(db.path)}'s replica`);
  // Litestream 0.5 keeps no generations: history left in the bucket outranks a fresh start (a restore takes the highest txid).
  return `(1) ${stopCommand(u)}  (2) ${moves.join(" && ")}  (3) in the bucket, delete ${prefixes.join(", ")} (the Hetzner console, or any S3 client)  (4) ${startCommand(u)}`;
}

/** One replicated database: how far its replica trails it. */
export function replicaVerdict(u: LitestreamUnit, db: ReplicaFacts, now: number, home: string): Verdict {
  if ("error" in db.replica) return { status: "unknown", detail: `couldn't read the replica: ${db.replica.error}` };
  const r = db.replica, local = db.local?.txid ?? null, wrote = db.local?.lastWrite ?? null;
  const replicated = `replica at txid ${hex(r.txid)} (${hhmm(r.at)})`;
  const written = wrote ? `; last write ${hhmm(wrote)}` : "";
  if (local === null) return { status: "missing", detail: `no Litestream state beside it: it has never been replicated from here; ${replicated}${written}`, fix: restartCommand(u) };
  if (r.txid > local) return { status: "missing", detail: `the replica holds txid ${hex(r.txid)} but the database's replication is at ${hex(local)}: its local state was reset while the replica kept the old history, so a restore would bring back the copy from ${hhmm(r.at)}`, fix: freshStart(u, [db], home) };
  if (r.txid === local) return { status: "ok", detail: `${replicated}, as the database${written}` };
  // Behind: fine while the writes it lacks are recent. The oldest of them (Litestream's local file for the first
  // transaction past the replica's) says how long they've waited; without it, the last write does.
  const waiting = (db.local?.written ?? []).filter(w => w.txid > r.txid).map(w => w.at);
  const behindSince = waiting.length ? Math.min(...waiting) : wrote ?? now;
  if (now - behindSince < STALE_AFTER_MS) return { status: "ok", detail: `${replicated}; the database is at ${hex(local)}, written in the last ${Math.round(STALE_AFTER_MS / 60_000)} minutes, uploading` };
  return { status: "missing", detail: `stale since ${hhmm(behindSince)}: ${replicated}, but the database is at txid ${hex(local)}${written}`, fix: restartCommand(u) };
}

/** A follower's mirror against the replica it follows: "stale since" when the replica has moved on and it hasn't. */
export function mirrorVerdict(u: LitestreamUnit, db: ReplicaFacts, now: number): Verdict & { staleSince?: string } {
  if ("error" in db.replica) return { status: "unknown", detail: `couldn't read the replica: ${db.replica.error}` };
  const r = db.replica, have = db.mirror?.txid ?? null;
  if (have === null) return { status: "missing", detail: `no copy yet (${db.path}-txid is missing); the replica is at txid ${hex(r.txid)} (${hhmm(r.at)})`, fix: restartCommand(u) };
  // The replica's history restarted under the mirror (the source's state was reset): level-0 files, which are uploaded
  // in transaction order, at txids below the mirror's but uploaded after the one it holds. (Compactions at higher levels
  // are uploaded later than the files they cover, and say nothing.)
  const heldAt = r.files.filter(x => x.level === 0 && x.txid === have).map(x => x.at).sort()[0] ?? r.files.filter(x => x.txid === have).map(x => x.at).sort()[0] ?? "";
  const restarted = r.files.filter(f => f.level === 0 && f.txid < have && f.at > heldAt).sort((a, b) => a.at.localeCompare(b.at));
  if (restarted.length && r.txid === have) {
    return { status: "missing", staleSince: restarted[0]!.at, detail: `stale since ${hhmm(restarted[0]!.at)}: the replica's history restarted (newer files at txid ${hex(restarted.at(-1)!.txid)}, below the mirror's ${hex(have)}), so the follower can't apply them; the source's replica needs a fresh start`, fix: `fix the source machine's replica (its doctor says how), then ${stopCommand(u)} && mkdir -p ~/backups/mirrors && mv ${db.path}* ~/backups/mirrors/ && ${startCommand(u)}` };
  }
  // Ahead of its replica: the replica was started over (its old history deleted), and the follower can't apply the new one.
  if (have > r.txid) {
    const since = r.files.map(f => f.at).sort()[0] ?? r.at;
    return { status: "missing", staleSince: since, detail: `stale since ${hhmm(since)}: the mirror is at txid ${hex(have)}, past its replica's newest (${hex(r.txid)}): the replica was started over, so the follower needs a fresh copy`, fix: `${stopCommand(u)} && mkdir -p ~/backups/mirrors && mv ${db.path}* ~/backups/mirrors/ && ${startCommand(u)}` };
  }
  if (r.txid === have) return { status: "ok", detail: `mirror at txid ${hex(have)}, the replica's newest (${hhmm(r.at)})` };
  const missed = r.files.filter(f => f.txid > have).sort((a, b) => a.at.localeCompare(b.at));
  const since = missed[0]?.at ?? r.at;
  if (now - Date.parse(since) < STALE_AFTER_MS) return { status: "ok", detail: `mirror at txid ${hex(have)}; the replica's ${hex(r.txid)} arrived ${hhmm(since)}, following` };
  return { status: "missing", staleSince: since, detail: `stale since ${hhmm(since)}: the mirror is at txid ${hex(have)}, the replica at ${hex(r.txid)} (${hhmm(r.at)})`, fix: restartCommand(u) };
}

/** Doctor's lines for backups: each unit, its log, each database or mirror. */
export function backupChecks(b: BackupFacts, home: string): { name: string; status: Verdict["status"]; detail: string; fix?: string }[] {
  const out: { name: string; status: Verdict["status"]; detail: string; fix?: string }[] = [];
  const add = (name: string, v: Verdict) => out.push({ name, status: v.status, detail: v.detail, ...(v.fix ? { fix: v.fix } : {}) });
  if (!b.units.length) { out.push({ name: "litestream", status: "info", detail: "no Litestream unit here: nothing replicates this machine's outlines" }); return out; }
  for (const { unit: u, log, dbs, problem, freshOnStart, snapshot } of b.units) {
    const label = u.role === "follow" ? `follower ${u.name}` : `replicator ${u.name}`;
    const s = u.state;
    const running = s?.active === true;
    add(label, running
      ? { status: "ok", detail: `${s!.detail}${s!.since ? `, up since ${hhmm(s!.since)}` : ""}; ${u.config}` }
      : { status: "missing", detail: `not running (${s?.detail ?? "state unknown"}); ${u.path}`, fix: s?.detail === "not loaded in launchd" ? startCommand(u) : restartCommand(u) });
    // Restore history: Litestream's default is a snapshot a day kept a day; restic (PIE-607) is the long history.
    if (u.role === "replicate" && snapshot && !snapshot.interval) add(`${label} snapshots`, { status: "behind", detail: `${u.config} sets no snapshot interval: Litestream's default (a snapshot every 24h, kept 24h) leaves about a day to restore from`, fix: `add to ${u.config}, then ${restartCommand(u)}:  snapshot: { interval: 4h, retention: 168h }` });
    else if (u.role === "replicate" && snapshot?.interval) add(`${label} snapshots`, { status: "ok", detail: `a snapshot every ${snapshot.interval}, kept ${snapshot.retention ?? "24h (the default)"}` });
    if (u.role === "follow" && u.kind === "systemd" && freshOnStart === false) add(`${label} start`, { status: "behind", detail: `it resumes from the mirror it left; Litestream 0.5.17 refuses that (crash loop) whenever the saved txid is past the newest snapshot (upstream #1385)`, fix: `in ${u.path}, before ExecStart: ExecStartPre=/bin/rm -f ${u.output} ${u.output}-txid ${u.output}-wal ${u.output}-shm; then systemctl --user daemon-reload && ${restartCommand(u)}` });
    // A follower that restores fresh on every start heals the #1385 refusal by itself (Restart=always): said, not failed.
    const healed = u.role === "follow" && freshOnStart && !!log.latest && /ahead of|saved txid|txid .* (?:past|beyond)/i.test(log.latest.line);
    if (log.unavailable) add(`${label} log`, { status: "unknown", detail: log.unavailable });
    else if (log.errorsLastHour && healed) add(`${label} log`, { status: "ok", detail: `${log.errorsLastHour} ERROR line${log.errorsLastHour === 1 ? "" : "s"} in the last hour, the follow-resume refusal (upstream #1385), healed by the fresh restore on restart; latest: ${log.latest!.line}` });
    else if (log.errorsLastHour) {
      const ltx = log.lostState ?? [];
      const detail = `${log.errorsLastHour} ERROR line${log.errorsLastHour === 1 ? "" : "s"} in the last hour; latest: ${log.latest!.line}`;
      const fix = ltx.length
        ? `${ltx.join(", ")}: Litestream lost a file of its local state; give ${ltx.length === 1 ? "it" : "them"} a fresh start: ${freshStart(u, ltx.map(name => dbs.find(d => basename(d.path) === name) ?? { path: join("<outlines>", name), url: null }), home)}`
        : `read it (${u.kind === "systemd" ? `journalctl --user -u ${u.name} -n 50` : `tail -50 ${u.logPaths?.join(" ")}`}), then ${restartCommand(u)}`;
      add(`${label} log`, { status: "missing", detail, fix });
    } else add(`${label} log`, { status: "ok", detail: `no ERROR in the last hour${log.latest ? ` (the last one: ${hhmm(log.latest.at)})` : ""}` });
    if (problem) add(label, { status: "missing", detail: problem });
    for (const db of dbs) {
      add(u.role === "follow" ? `mirror ${db.name}` : `replica ${db.name}`, u.role === "follow" ? mirrorVerdict(u, db, b.now) : replicaVerdict(u, db, b.now, home));
      if (db.restore) add(`restore ${db.name}`, { status: db.restore.ok ? "ok" : "missing", detail: db.restore.detail });
    }
  }
  return out;
}

// ── one mirror, for the gateway ──────────────────────────────────────────────────────────────────────────────

/** Whether a mirror is stale, and since when: its follower stopped, erroring, or behind its replica. Null: current, or unknown. */
export async function mirrorHealth(followed: string, o: { platform: Platform; home: string; env: Env; run: Run; now?: number }): Promise<{ since: string | null; why: string } | null> {
  const now = o.now ?? Date.now();
  const u = (await runningUnits(o.platform, o.home, o.run)).find(x => x.role === "follow" && resolve(x.output!) === resolve(followed));
  if (!u) return null;
  const state = await unitStateOf(u, o.run, now);
  if (state.active === false) return { since: null, why: `its follower ${u.name} isn't running (${state.detail})` };
  let text: string;
  try { text = readFileSync(u.config, "utf8"); } catch { return null; }
  const d = u.url ? { path: followed, url: u.url } : configDatabases(text, unitEnv(u, o.env)).find(x => resolve(x.path) === resolve(followed));
  if (!d?.url) return null;
  const replica = await replicaPosition(u, d.url, o.run, o.env);
  if ("error" in replica) return null;
  let txid: number | null = null;
  try { txid = parseInt(readFileSync(`${followed}-txid`, "utf8").trim(), 16); } catch { /* none yet */ }
  const v = mirrorVerdict(u, { name: basename(followed), path: followed, url: d.url, mirror: { txid }, replica }, now);
  return v.status === "missing" ? { since: v.staleSince ?? null, why: v.detail } : null;
}
