// restic, run for the backups: through `with-secrets <groups> --` unless its password is already in the environment
// (a test's local repository), so the keys reach only restic and are never printed. One snapshot per outline:
// `restic backup --stdin` of a consistent copy, as `/<name>.sqlite`, tagged ep0ch-outline, outline=<name>, seq=<change>.
import { OUTLINE_TAG, type BackupConfig } from "./config";

export interface Ran { code: number; out: string; err: string }

/** restic's exit code for "there's no repository there" (restic 0.17 and later). */
export const NO_REPO = 10;
/** restic's exit code for "the repository is locked by another process" (restic 0.17 and later). */
export const LOCKED = 11;

/** The argv that runs restic with its secrets. */
export function resticArgv(c: Pick<BackupConfig, "restic" | "secrets" | "env">, args: readonly string[]): string[] {
  const has = ["RESTIC_PASSWORD", "RESTIC_PASSWORD_FILE", "RESTIC_PASSWORD_COMMAND"].some(k => c.env[k]);
  return has || !c.secrets.length ? [c.restic, ...args] : ["with-secrets", c.secrets.join(","), "--", c.restic, ...args];
}

export async function runRestic(c: BackupConfig, repo: string, args: readonly string[], o: { stdin?: string; stdout?: string; timeoutMs?: number } = {}): Promise<Ran> {
  const argv = resticArgv(c, ["-r", repo, ...args]);
  let p: Bun.Subprocess<"pipe" | Bun.BunFile, Bun.BunFile | "pipe", "pipe">;
  try {
    p = Bun.spawn(argv, { env: { ...c.env, RESTIC_PROGRESS_FPS: "0" } as Record<string, string>, stdin: o.stdin ? Bun.file(o.stdin) : "ignore" as never,
      stdout: o.stdout ? Bun.file(o.stdout) : "pipe", stderr: "pipe" }) as never;
  } catch (e) { return { code: 127, out: "", err: `can't run ${argv[0]}: ${(e as Error).message}` }; }
  // Stopped at its limit: said as that, whatever restic printed as it went (it catches the signal and exits itself, a
  // Go stack trace as its last line, so the exit code alone doesn't say).
  let timedOut = false;
  const limit = o.timeoutMs ?? 600_000;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, limit);
  try {
    const [out, err, code] = await Promise.all([typeof p.stdout === "number" || !p.stdout || o.stdout ? "" : new Response(p.stdout as ReadableStream).text(), new Response(p.stderr).text(), p.exited]);
    return timedOut || p.signalCode ? { code: 124, out, err: `${err}\n${TIMED_OUT} ${duration(limit)}` } : { code, out, err };
  } finally { clearTimeout(timer); }
}

const TIMED_OUT = "timed out after";
/** `3s`, `40 min`. */
const duration = (ms: number) => ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`;

/** restic's complaint, one line (its last), for a state file and a status bar. */
export const complaint = (r: Ran) => {
  const lines = r.err.split("\n").map(l => l.trim()).filter(l => l && !/^(open repository|repository [0-9a-f]+ opened|using parent|reading|created restic repository|no parent snapshot)/i.test(l));
  return (lines.find(l => l.startsWith(TIMED_OUT)) ?? lines.find(l => /^Fatal:/.test(l)) ?? lines.at(-1) ?? `exit ${r.code}`).slice(0, 240);
};

/** An outline's name as a snapshot may carry it: a file name, never a path (the tags are read from a repository). */
export const OUTLINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const safeName = (n: string) => OUTLINE_NAME.test(n) && !n.includes("..");

export interface OutlineSnapshot { id: string; time: string; outline: string; seq: number | null; /** The outline's schema version when it was copied (null: a snapshot from before the tag). */ schema?: number | null; host: string }

/** `restic snapshots --json`'s answer, as outline snapshots (others are left out). */
export function parseSnapshots(json: string): OutlineSnapshot[] | { error: string } {
  let rows: { id?: string; time?: string; paths?: string[]; tags?: string[]; hostname?: string }[];
  try { rows = JSON.parse(json || "[]"); } catch { return { error: `restic snapshots answered ${JSON.stringify(json.slice(0, 120))}` }; }
  if (!Array.isArray(rows)) return { error: "restic snapshots didn't answer a list" };
  return rows.flatMap(r => {
    const tags = r.tags ?? [];
    if (!r.id || !r.time || !tags.includes(OUTLINE_TAG)) return [];
    const outline = tags.find(t => t.startsWith("outline="))?.slice(8) ?? r.paths?.[0]?.replace(/^\//, "").replace(/\.sqlite$/, "");
    if (!outline || !safeName(outline)) return [];
    const seq = tags.find(t => t.startsWith("seq="))?.slice(4);
    const schema = tags.find(t => t.startsWith("schema="))?.slice(7);
    return [{ id: r.id, time: r.time, outline, seq: seq && /^\d+$/.test(seq) ? Number(seq) : null, schema: schema && /^\d+$/.test(schema) ? Number(schema) : null, host: r.hostname ?? "" }];
  });
}

/** Each outline's newest snapshot in a repository, or every one (`all`), oldest first. */
export async function snapshots(c: BackupConfig, repo: string, o: { all?: boolean; outline?: string } = {}): Promise<OutlineSnapshot[] | { error: string; code: number }> {
  const r = await runRestic(c, repo, ["snapshots", "--json", "--no-lock", "--tag", OUTLINE_TAG, ...(o.outline ? ["--path", `/${o.outline}.sqlite`] : []), ...(o.all ? [] : ["--latest", "1"])], { timeoutMs: 120_000 });
  if (r.code !== 0) return { error: complaint(r), code: r.code };
  const s = parseSnapshots(r.out);
  return "error" in s ? { ...s, code: 1 } : s.sort((a, b) => a.time.localeCompare(b.time));
}

/** The snapshot `restic backup --json` made (its summary line), or null. */
export function summaryId(out: string): string | null {
  for (const line of out.split("\n").reverse()) {
    try { const m = JSON.parse(line); if (m?.message_type === "summary" && m.snapshot_id) return m.snapshot_id; } catch { /* a status line */ }
  }
  return null;
}

/** A consistent copy, uploaded as `/<name>.sqlite` (`host`: the machine it belongs to, when another uploads it: a relay). */
export async function backupFile(c: BackupConfig, repo: string, copy: string, name: string, seq: number | null, schema: number | null = null, host: string = c.machine): Promise<{ id: string; cleared?: string } | { error: string; code: number }> {
  // An exclusive lock a hard-killed prune left (an OOM, a reboot) refuses uploads too: cleared like forget's.
  const r = await clearingStale(c, repo, ["backup", "--json", "--stdin", "--stdin-filename", `${name}.sqlite`, "--host", host,
    "--tag", OUTLINE_TAG, "--tag", `outline=${name}`, ...(seq !== null ? ["--tag", `seq=${seq}`] : []), ...(schema !== null ? ["--tag", `schema=${schema}`] : [])], { stdin: copy, timeoutMs: 600_000, wait: "2m" });
  if (r.code !== 0) return { error: r.code === LOCKED ? lockHolder(r) : complaint(r), code: r.code };
  return { id: summaryId(r.out) ?? "?", ...(r.cleared ? { cleared: r.cleared } : {}) };
}

/** A snapshot's outline, written to `dest`. */
export async function dumpTo(c: BackupConfig, repo: string, s: Pick<OutlineSnapshot, "id" | "outline">, dest: string): Promise<{ ok: true } | { error: string }> {
  // With a lock: a prune on the other machine holds the repository exclusively; this waits for it.
  const r = await runRestic(c, repo, ["dump", "--retry-lock", "10m", s.id, `/${s.outline}.sqlite`], { stdout: dest });
  return r.code === 0 ? { ok: true } : { error: complaint(r) };
}

/** The retention PIE-607 set: every snapshot of two days, then hourly for three, daily for a month, weekly for 12. */
export const KEEP = ["--keep-within", "48h", "--keep-hourly", "72", "--keep-daily", "30", "--keep-weekly", "12"];

/**
 * Who holds the lock restic couldn't take, as it says it ("repository is already locked by PID 41 on garden by evan …,
 * lock was created at …"): one line, for a state file and a status bar. complaint() keeps only restic's last line,
 * which is its advice to unlock, not who holds it.
 */
export function lockHolder(r: Ran): string {
  const lines = r.err.split("\n").map(l => l.trim());
  const by = lines.find(l => /already locked/i.test(l))?.replace(/^.*?(repository is already locked)/i, "$1");
  const at = lines.find(l => /^lock was created at/i.test(l));
  return by ? [by, at].filter(Boolean).join(", ").slice(0, 240) : complaint(r);
}

/** How many locks `restic unlock` said it removed. */
export const removedLocks = (r: Ran) => Number(/removed (\d+) locks?/i.exec(r.out + r.err)?.[1] ?? 0);

/**
 * A command that a lock left behind refuses: forget and prune (they take the repository exclusively, so any lock a run
 * killed mid-upload left refuses them while backups still land), and a backup (which a killed prune's exclusive lock
 * refuses) (PIE-1755). So a refused lock is cleared and the command tried again: `restic unlock`
 * without `--remove-all` removes only stale locks, those whose process on this machine is gone or that nobody refreshed
 * for 30 minutes; a live one stays, and the second try waits `wait` for it. `cleared`: the lock it found, when unlock
 * removed it; `unlockError`: why unlock itself failed. `timeoutMs` is for all of it, the tries and the unlock.
 */
async function clearingStale(c: BackupConfig, repo: string, args: string[], o: { timeoutMs: number; wait?: string; stdin?: string }): Promise<Ran & { cleared?: string; unlockError?: string }> {
  const began = Date.now();
  const first = await runRestic(c, repo, args, { timeoutMs: o.timeoutMs, ...(o.stdin ? { stdin: o.stdin } : {}) });
  if (first.code !== LOCKED) return first;
  const held = lockHolder(first);
  const unlocked = await runRestic(c, repo, ["unlock"], { timeoutMs: 120_000 });
  const left = Math.max(60_000, o.timeoutMs - (Date.now() - began));
  const again = await runRestic(c, repo, ["--retry-lock", o.wait ?? "5m", ...args], { timeoutMs: left, ...(o.stdin ? { stdin: o.stdin } : {}) });
  if (unlocked.code !== 0) return { ...again, unlockError: complaint(unlocked) };
  return removedLocks(unlocked) > 0 ? { ...again, cleared: held } : again;
}

/** Retention (KEEP), every run that uploads: the snapshots it lets go are gone at once; their space, at the next prune. */
export function forget(c: BackupConfig, repo: string, o: { host?: string; wait?: string } = {}) {
  return clearingStale(c, repo, ["forget", "--host", o.host ?? c.machine, "--tag", OUTLINE_TAG, "--group-by", "host,paths", ...KEEP], { timeoutMs: 900_000 + 300_000, ...(o.wait ? { wait: o.wait } : {}) });
}

/**
 * The prune that frees the space forgotten snapshots held, once a day, in a step of its own: bounded
 * (`--max-repack-size`), so a backlog (a month of snapshots no forget let go) finishes over a few days inside its limit
 * rather than starting over each run and being stopped at it (PIE-1755, float-2 on Nov 11). Packs nothing uses any more
 * are deleted whatever the bound; only rewriting the partly used ones is held to it.
 */
export function prune(c: BackupConfig, repo: string, timeoutMs: number) {
  return clearingStale(c, repo, ["prune", "--max-repack-size", PRUNE_REPACK], { timeoutMs });
}
/** How much a prune rewrites in one go. */
export const PRUNE_REPACK = "1G";
