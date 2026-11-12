// The backup job's parts (PIE-607), each standing alone: a gap, an offline night or a failed upload leaves nothing to
// repair, the next run simply tries again.
//
//   snapshot  each outline here whose change feed moved since its newest snapshot, as its host says (`outlines.list`): a
//             consistent copy the host makes (`outlines.backup`, VACUUM INTO in a worker of its own), integrity-checked
//             here and uploaded to this machine's repository. An outline that hasn't changed isn't snapshotted. Nothing
//             here opens a live outline (PIE-1750); the files it opens are copies.
//   mirror    each other machine's outlines (EP0CH_BACKUP_MIRRORS): its newest snapshot, when it's newer than the copy
//             here, replaces `<mirrors>/<machine>/<outline>.sqlite` by an atomic rename. With an ssh name, its host is
//             asked how far each outline is, so changes no snapshot holds yet are said. Newer wins.
//   watch     what's stale (alert.ts), into alert.json for the door's status bar and doctor; each incident announced once.
//   drill     monthly: each outline's newest snapshot restored into a temp folder and checked.
import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { alive } from "../state";
import { hostRequest } from "../socket";
import { type Alert, type BackupState, type Commands, DRILL_EVERY_MS, type ForgetState, hhmm, type Incident, incidents, type MirrorState, nextAlert, PRUNE_EVERY_MS, PRUNE_RETRY_MS, readAlert, readBackupState, writeAlert, writeBackupState } from "./alert";
import type { BackupConfig, MirrorSource } from "./config";
import { plainReason, repoHost } from "./plain";
import { failedLine, moment, relayedLine } from "./verdict";
import { backupFile, complaint, dumpTo, forget, LOCKED, lockHolder, NO_REPO, type OutlineSnapshot, prune, type Ran, runRestic, snapshots } from "./restic";

type Say = (line: string) => void;
/** A step begins (what a person at a terminal sees spin, `ep0ch backup run`'s progress): its title. */
type Step = (title: string) => void;

/** The highest change in a copy's change feed (read-only), or null when it has none. A copy, never a live outline. */
export function changeSeq(path: string): number | null {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const row = db.query("SELECT max(change_id) AS n FROM change_feed").get() as { n: number | null } | null;
    return row?.n ?? 0;
  } catch { return null; } finally { db?.close(); }
}

/** A copy's schema version (`PRAGMA user_version`, read-only), or null when it can't be read. A copy, never a live outline. */
export function schemaVersion(path: string): number | null {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } catch { return null; } finally { db?.close(); }
}

/** How a person starts the outline host here, when the job finds it not answering. */
export const hostStartCommand = (platform = process.platform) =>
  platform === "darwin" ? "launchctl kickstart gui/$(id -u)/io.ep0ch.outliner-host" : "systemctl --user start outliner-host.service";

/**
 * A consistent, integrity-checked copy of one of this machine's outlines at `dest`, made by its host (`outlines.backup`,
 * in a worker of its own, PIE-1750): the job never opens a live outline. What the copy holds comes back with it.
 */
export async function hostCopy(c: Pick<BackupConfig, "host">, name: string, dest: string): Promise<{ seq: number; schema: number; bytes: number }> {
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  // Made beside it and published by a hard link once checked: `dest` is never half a copy, nor a failed one.
  const part = join(dirname(dest), `.${basename(dest)}.incoming-${process.pid}`);
  rmSync(part, { force: true });
  try {
    const made = await hostRequest(c.host, "outlines.backup", { name, out: part }, 600_000);
    const verdict = integrity(part);
    if (verdict !== "ok") throw new Error(`the copy failed its integrity check: ${verdict}`);
    try { linkSync(part, dest); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${dest} already exists; not overwritten`);
      throw e;
    }
    return { seq: made.changeSeq, schema: made.schema, bytes: made.bytes };
  } finally { rmSync(part, { force: true }); }
}

/** `PRAGMA integrity_check`, as one line. */
export function integrity(path: string): string {
  try {
    const db = new Database(path, { readonly: true });
    try { return (db.query("PRAGMA integrity_check").all() as { integrity_check: string }[]).map(r => r.integrity_check).slice(0, 3).join("; "); }
    finally { db.close(); }
  } catch (e) { return (e as Error).message; }
}

/** Blocks in an outline (a restored copy's sanity check), or null. */
export function blockCount(path: string): number | null {
  try {
    const db = new Database(path, { readonly: true });
    try { return (db.query("SELECT count(*) AS n FROM blocks").get() as { n: number }).n; } finally { db.close(); }
  } catch { return null; }
}

const tempDir = (c: BackupConfig) => { mkdirSync(c.state, { recursive: true, mode: 0o700 }); return mkdtempSync(join(c.state, "tmp-")); };

/** The repository exists, or is made (restic init); null when it's there. */
export async function ensureRepo(c: BackupConfig, repo: string, say: Say): Promise<string | null> {
  const r = await runRestic(c, repo, ["cat", "config", "--no-lock"], { timeoutMs: 120_000 });
  if (r.code === 0) return null;
  if (r.code !== NO_REPO) return complaint(r);
  const init = await runRestic(c, repo, ["init"], { timeoutMs: 120_000 });
  if (init.code !== 0) return `restic init ${repo} failed: ${complaint(init)}`;
  say(`made the repository ${repo}`);
  return null;
}

/**
 * Each changed outline's consistent copy to this machine's repository. Where the repository can't be reached (a probe
 * of its host fails, or restic's upload does) and a hub is named (EP0CH_MCP_HUB), the copy goes to the hub instead, over
 * ssh: it installs it as its mirror and uploads it on this machine's behalf (relay.ts). A relayed outline is `relayed`,
 * not `failed`: the backup exists, off this machine and checked.
 */
export async function snapshot(c: BackupConfig, s: BackupState, o: { force?: boolean; verbose?: boolean; now?: () => number; say?: Say; step?: Step; probe?: (repo: string) => Promise<string | null> } = {}): Promise<{ uploaded: string[]; failed: string[]; relayed: string[] }> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const repo = c.repoOf(c.machine);
  const uploaded: string[] = [], failed: string[] = [], relayed: string[] = [];
  // The outlines here and where each one is, as its host says (PIE-1750): nothing here opens an outline's file.
  let outlines: { name: string; seq: number | null; schema: number | null }[];
  try {
    outlines = (await hostRequest(c.host, "outlines.list", {}, 30_000)).outlines.map(o => ({ name: o.name, seq: o.changeSeq ?? null, schema: o.schema ?? null }));
  } catch (e) {
    const why = `the outline host doesn't answer at ${c.host} (${(e as Error).message}), so nothing was copied`;
    // Kept apart from the outlines it knows: a first run knows none, and must still fail (never a silent green).
    s.host = { failingSince: s.host?.failingSince ?? new Date(now()).toISOString(), error: why, fix: hostStartCommand() };
    for (const st of Object.values(s.outlines)) { st.pendingSince ??= new Date(now()).toISOString(); st.error = why; }
    say(`✗ ${why}; start it: ${hostStartCommand()}`);
    return { uploaded, failed: [...Object.keys(s.outlines), "(the outline host)"], relayed };
  }
  delete s.host;
  // Snapshots are the repository's: another repository (or machine name) starts every outline over.
  if (s.repo !== repo) { s.outlines = {}; s.repo = repo; delete s.lastPrune; delete s.forget; delete s.prune; }
  // Outlines that were removed (moved, renamed) are no longer watched.
  for (const name of Object.keys(s.outlines)) if (!outlines.some(x => x.name === name)) delete s.outlines[name];
  o.step?.(`checking ${outlines.length} outline${outlines.length === 1 ? "" : "s"} for changes`);
  const changed = outlines.filter(x => {
    const st = s.outlines[x.name] ??= {};
    // A migration changes the schema and not the change feed: a different schema than the newest snapshot's is a change.
    const moved = o.force || st.relayed?.uploaded === false || x.seq === null || st.seq === undefined || st.seq !== x.seq || (x.schema !== null && st.schema !== x.schema);
    if (moved) st.pendingSince ??= new Date(now()).toISOString();
    else { delete st.pendingSince; delete st.error; }
    return moved;
  });
  // --verbose: the decision for each outline and its reason (the raw reasons, not the plain ones).
  const note = (line: string) => { if (o.verbose) say(line); };
  for (const x of outlines) {
    if (changed.some(y => y.name === x.name)) continue;
    const st = s.outlines[x.name];
    note(`${x.name}: unchanged since change ${st?.seq ?? "?"}${st?.at ? ` (${moment(st.at)})` : ""}, nothing to send`);
  }
  if (!changed.length) { say(`no outline changed since its newest snapshot (${outlines.map(x => x.name).join(", ") || "none here"})`); return { uploaded, failed, relayed }; }
  // The repository, or why not: a quick look at its host first when there's a hub to relay through (restic itself waits minutes).
  let direct: string | null = (c.hub ? await (o.probe ?? (await import("./relay")).unreachable)(repo) : null) ?? null;
  if (!direct) direct = await ensureRepo(c, repo, say);
  note(direct ? `repository check: ${repo} failed: ${direct}` : `repository check: ${repo} answered`);
  if (direct) say(`${plainReason(direct, { repo })}${c.hub ? `; sending the changes through ${c.hub} instead` : ""}`);
  const tmp = tempDir(c);
  try {
    for (const x of changed) {
      const st = s.outlines[x.name]!;
      const copy = join(tmp, `${x.name}.sqlite`);
      o.step?.(`${x.name}: snapshotting (VACUUM INTO, by the host)`);
      // What the copy holds, which an edit between the check above and the copy may have moved on from.
      try { const made = await hostCopy(c, x.name, copy); x.seq = made.seq; x.schema = made.schema; }
      catch (e) { st.error = `copying ${x.name}: ${(e as Error).message}`; failed.push(x.name); say(`✗ ${x.name}: ${st.error}`); continue; }
      let why = direct;
      if (!why) {
        o.step?.(`${x.name}: uploading to restic`);
        const began = Date.now();
        const r = await backupFile(c, repo, copy, x.name, x.seq, x.schema);
        if ("error" in r) { why = direct = r.error; note(`${x.name}: direct upload to ${repoHost(repo)} failed after ${((Date.now() - began) / 1000).toFixed(1)}s: ${r.error}`); }
        else {
          rmSync(copy, { force: true });
          Object.assign(st, { seq: x.seq, schema: x.schema, at: new Date(now()).toISOString(), snapshot: r.id });
          delete st.pendingSince; delete st.error; delete st.relayed;
          uploaded.push(x.name);
          note(`${x.name}: sent direct to ${repoHost(repo)} in ${((Date.now() - began) / 1000).toFixed(1)}s`);
          say(`✓ ${x.name} (change ${x.seq ?? "?"}) → snapshot ${r.id.slice(0, 8)}`);
          continue;
        }
      }
      if (c.hub) {
        o.step?.(`${x.name}: relaying through ${c.hub}`);
        note(`${x.name}: relayed via ${c.hub} because ${why}`);
        const { relay } = await import("./relay");
        const r = await relay(c, c.hub, copy, { outline: x.name, seq: x.seq, schema: x.schema });
        rmSync(copy, { force: true });
        if (r.ok) {
          const at = new Date(now()).toISOString();
          Object.assign(st, { seq: x.seq, schema: x.schema, at, relayed: { via: c.hub, at, why, uploaded: !!r.snapshot, ...(r.snapshot ? {} : { uploadError: r.uploadError ?? "?" }) } });
          delete st.snapshot; delete st.pendingSince; delete st.error;
          relayed.push(x.name);
          say(relayedLine(x.name, x.seq, c.hub, why!, !!r.snapshot, { repo, ...(r.uploadError ? { uploadError: r.uploadError } : {}) }));
          continue;
        }
        st.error = `${why}; relaying through ${c.hub} failed: ${r.error ?? "?"}`;
      } else { rmSync(copy, { force: true }); st.error = why!; }
      failed.push(x.name);
      say(failedLine(x.name, st.error!, { repo, hub: c.hub }));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (uploaded.length) await retention(c, s, repo, now, say);
  return { uploaded, failed, relayed };
}

/**
 * After each upload, forget (KEEP) at once; once a day, the prune that frees their space, in a step of its own (PIE-1755).
 * Each counted, so one that keeps failing is an incident (alert.ts), not only a journal line.
 */
async function retention(c: BackupConfig, s: BackupState, repo: string, now: () => number, say: Say): Promise<void> {
  const r = await forget(c, repo);
  const at = new Date(now()).toISOString();
  if (r.cleared) say(`cleared a stale restic lock (${r.cleared})`);
  s.forget = counted(s.forget, r, at);
  if (!s.forget.ok) { say(`restic forget failed (the snapshots are safe; the next run tries again): ${s.forget.error}`); return; }
  say("✓ old snapshots let go");
  // Once a day; after a failure, a few hours on, so a prune that can't finish doesn't take every run.
  const last = s.prune?.at ?? s.lastPrune;
  if (last && now() - Date.parse(last) < (s.prune && !s.prune.ok ? PRUNE_RETRY_MS : PRUNE_EVERY_MS)) return;
  const p = await prune(c, repo);
  const done = new Date(now()).toISOString();
  if (p.cleared) say(`cleared a stale restic lock (${p.cleared})`);
  s.prune = counted(s.prune, p, done);
  if (s.prune.ok) { s.lastPrune = done; say("✓ pruned: the space old snapshots held is freed"); }
  else say(`restic prune failed (old snapshots are let go; the space comes back with the next prune): ${s.prune.error}`);
}

/** A forget's or a prune's result, with the failures in a row before it. */
function counted(was: ForgetState | undefined, r: Ran & { cleared?: string; unlockError?: string }, at: string): ForgetState {
  if (r.code === 0) return { at, ok: true, failures: 0, ...(r.cleared ? { cleared: r.cleared } : {}) };
  const error = (r.code === LOCKED ? lockHolder(r) : complaint(r)) + (r.unlockError ? `; restic unlock failed: ${r.unlockError}` : "");
  const failing = was?.ok === false ? was : undefined;
  return { at, ok: false, failures: (failing?.failures ?? 0) + 1, since: failing?.since ?? at, error };
}

/**
 * The Litestream follower units that would write this mirror, by the name systemctl or launchctl knows each by: a
 * template unit's (`litestream-mirror@.service`, `%i` in its output) instance for this outline.
 */
export function followersOf(units: { kind: "systemd" | "launchd"; name: string; role: string; output?: string }[], file: string): string[] {
  const outline = basename(file).replace(/\.sqlite$/, "");
  return units.flatMap(u => {
    if (u.role !== "follow" || !u.output) return [];
    const templated = u.kind === "systemd" && u.name.endsWith("@.service");
    if (resolve(templated ? u.output.replaceAll("%i", outline) : u.output) !== resolve(file)) return [];
    return [templated ? u.name.replace("@.service", `@${outline}.service`) : u.name];
  });
}

/**
 * Whether a Litestream follower may still write this mirror: a follower unit for it that isn't both stopped and
 * disabled (a restarting, failed or enabled one may write again), or whose state can't be asked. Retired means
 * `systemctl --user disable --now` (scripts/backup/README.md).
 */
async function followerRuns(c: BackupConfig, file: string): Promise<boolean> {
  const { litestreamUnits } = await import("../setup/backups");
  const { detectPlatform } = await import("../setup/model");
  const platform = detectPlatform();
  const ask = (argv: string[]) => { try { return Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim(); } catch { return null; } };
  for (const name of followersOf(litestreamUnits(platform, c.env.HOME!), file)) {
    if (platform !== "linux") return true;   // a launchd follower: present is enough
    const active = ask(["systemctl", "--user", "is-active", name]), enabled = ask(["systemctl", "--user", "is-enabled", name]);
    if (active !== "inactive" || !["disabled", "masked", "not-found", ""].includes(enabled ?? "?")) return true;
  }
  return false;
}

/**
 * The folder a machine's mirrors go to: `<mirrors>/<machine>`, or `<mirrors>/.restic/<machine>` while a Litestream
 * follower still writes the real one (the three days both run), so the two never write one file.
 */
export async function mirrorFolder(c: BackupConfig, machine: string, outline: string, follower = followerRuns): Promise<string> {
  const real = join(c.mirrorsDir, machine);
  return (await follower(c, join(real, `${outline}.sqlite`))) ? join(c.mirrorsDir, ".restic", machine) : real;
}

/** Puts a checked copy in place of the mirror: its old WAL and Litestream's leftovers go first, then one rename. */
export function replaceMirror(copy: string, file: string): void {
  for (const side of ["-wal", "-shm", "-txid"]) rmSync(file + side, { force: true });
  renameSync(copy, file);
}

/** Which copy wins: a newer change, else (no change feed to compare) a newer time. */
export const newer = (a: { seq?: number | null; at?: string }, b: { seq?: number | null; at?: string }) =>
  a.seq != null && b.seq != null ? a.seq > b.seq : (a.at ?? "") > (b.at ?? "");

/** Whether a snapshot is newer than the mirror's copy: by change, else (no change feed) by the snapshot's `time` against the copy's `at`. */
export const snapshotNewer = (snap: { seq: number | null; time: string }, m: { seq?: number | null; at?: string }) => newer({ seq: snap.seq, at: snap.time }, m);

/**
 * The outlines' changes on another machine, as its host says them (`ep0ch outline list --json` there, over ssh, which asks
 * that machine's host: PIE-1750, nothing opens its files), or null when it doesn't answer.
 */
export async function remoteSeqs(ssh: string, names: string[], c: Pick<BackupConfig, "env">): Promise<Record<string, number> | null> {
  const p = Bun.spawn([c.env.EP0CH_SSH || "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "--", ssh, REMOTE_LIST], { stdout: "pipe", stderr: "pipe", env: c.env as Record<string, string> });
  const timer = setTimeout(() => p.kill(), 30_000);
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]).finally(() => clearTimeout(timer));
  if (code !== 0) return null;
  try {
    const listed = (JSON.parse(out) as { outlines?: { name: string; changeSeq?: number }[] }).outlines ?? [];
    // A host there on older code lists no changes: that's no answer, said as one, never "nothing pending".
    if (listed.length && listed.every(o => o.changeSeq === undefined)) return null;
    const seqs: Record<string, number> = {};
    for (const o of listed) if (names.includes(o.name) && typeof o.changeSeq === "number") seqs[o.name] = o.changeSeq;
    return seqs;
  } catch { return null; }
}

/** The other machine's `ep0ch outline list --json`, in its login shell (as outline-core's REMOTE_STATUS runs `ep0ch status`). */
const REMOTE_LIST = `exec env -u EP0CH_SOCKET -u EP0CH_MACHINE -u EP0CH_WS "\${SHELL:-/bin/sh}" -lc 'command -v ep0ch >/dev/null || PATH="$HOME/.local/bin:$PATH"; ep0ch outline list --json'`;

export async function mirror(c: BackupConfig, s: BackupState, o: { now?: () => number; say?: Say; follower?: typeof followerRuns } = {}): Promise<void> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const iso = () => new Date(now()).toISOString();
  for (const src of c.mirrors) {
    const list = await snapshots(c, c.repoOf(src.machine));
    const keys = Object.keys(s.mirrors).filter(k => k.startsWith(`${src.machine}/`));
    const source = (s.sources ??= {})[src.machine] ??= {};
    if ("error" in list && list.code === NO_REPO) {
      // Not set up there yet: nothing to mirror, and nothing wrong here (doctor says how to set it up).
      source.missing = true; delete source.failingSince; delete source.error;
      say(`${src.machine} has no backups yet (${c.repoOf(src.machine)}): on ${src.machine}, EP0CH_BACKUP_MACHINE=${src.machine} ep0ch install --apply`);
      continue;
    }
    delete source.missing;
    if ("error" in list) {
      // Unreadable: nothing is known about its mirrors' freshness; that lasting is an incident of its own.
      for (const k of keys) s.mirrors[k]!.error = list.error;
      source.failingSince ??= iso(); source.error = list.error;
      say(`can't read ${src.machine}'s backups: ${list.error}`);
      continue;
    }
    delete source.failingSince; delete source.error;
    const remote = src.ssh ? await remoteSeqs(src.ssh, list.map(x => x.outline), c) : null;
    if (src.ssh && !remote) say(`${src.machine} (${src.ssh}) doesn't answer over ssh: mirrors come from its backups only`);
    for (const snap of list) await mirrorOne(c, s, src, snap, remote, { now, iso, say, follower: o.follower });
  }
}

async function mirrorOne(c: BackupConfig, s: BackupState, src: MirrorSource, snap: OutlineSnapshot, remote: Record<string, number> | null,
  o: { now: () => number; iso: () => string; say: Say; follower?: typeof followerRuns }): Promise<void> {
  const key = `${src.machine}/${snap.outline}`;
  const m: MirrorState = s.mirrors[key] ??= {};
  const folder = await mirrorFolder(c, src.machine, snap.outline, o.follower);
  if (m.folder && m.folder !== folder) { delete m.snapshot; delete m.seq; delete m.at; delete m.source; }
  m.folder = folder;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${snap.outline}.sqlite`);
  // What the file there holds, read from it: a copy this job didn't make (Litestream's, before it retired) or a
  // state file that was lost is never replaced by an older snapshot.
  if (existsSync(file) && m.source === undefined) {
    const seq = changeSeq(file);
    if (seq !== null) { m.seq = seq; m.at = new Date(statSync(file).mtimeMs).toISOString(); m.source = "found"; }
  }
  // What the machine says it has: changes no snapshot holds are pending (watch says when that's too long).
  if (remote && snap.outline in remote) {
    m.remoteSeq = remote[snap.outline]!; m.remoteAt = o.iso();
  }
  // Pending until a snapshot holds the change the machine last showed (asked now or before).
  if (m.remoteSeq != null && snap.seq !== null && m.remoteSeq > snap.seq) m.pendingSince ??= o.iso(); else delete m.pendingSince;
  const tmp = join(folder, `.${snap.outline}.sqlite.incoming-${process.pid}`);
  try {
    // A snapshot of a newer schema replaces the copy even at the same change: a migration doesn't move the change feed.
    const have = existsSync(file) ? schemaVersion(file) : null;
    const migrated = have !== null && snap.schema != null && snap.schema > have && m.snapshot !== snap.id;
    // A copy here newer than the newest snapshot (relayed, or found) stays.
    if (!existsSync(file) || migrated || (m.snapshot !== snap.id && snapshotNewer(snap, m) && !(have !== null && snap.schema != null && snap.schema < have))) {
      const r = await dumpTo(c, c.repoOf(src.machine), snap, tmp);
      const verdict = "error" in r ? r.error : integrity(tmp);
      if (verdict !== "ok") { m.behindSince ??= snap.time; m.error = `restoring snapshot ${snap.id.slice(0, 8)}: ${verdict}`; o.say(`✗ mirror ${key}: ${m.error}`); return; }
      // A snapshot from before the schema tag may be older than the copy here: its file says.
      const got = schemaVersion(tmp);
      if (have !== null && got !== null && got < have) { m.snapshot = snap.id; delete m.behindSince; delete m.error; o.say(`mirror ${key}: snapshot ${snap.id.slice(0, 8)} is schema ${got}, older than the copy here (${have}); kept the copy`); return; }
      chmodSync(tmp, 0o600);
      replaceMirror(tmp, file);
      Object.assign(m, { snapshot: snap.id, seq: snap.seq, at: snap.time, source: "restic", refreshed: o.iso() });
      if (migrated) o.say(`mirror ${key}: schema ${have} → ${snap.schema} (the machine migrated)`);
      delete m.behindSince; delete m.error;
      o.say(`✓ mirror ${key} ← snapshot ${snap.id.slice(0, 8)} (change ${snap.seq ?? "?"}, ${hhmm(snap.time)})${folder.includes("/.restic/") ? " (beside the Litestream follower)" : ""}`);
    } else { delete m.behindSince; delete m.error; }
  } catch (e) {
    m.behindSince ??= snap.time; m.error = (e as Error).message;
    o.say(`✗ mirror ${key}: ${m.error}`);
  } finally { rmSync(tmp, { force: true }); }
}

/** Restores each outline's newest snapshot (this machine's repository) into a temp folder and checks it. */
export async function drill(c: BackupConfig, o: { now?: () => number; say?: Say; machine?: string } = {}): Promise<{ ok: boolean; detail: string }> {
  const say = o.say ?? (() => {});
  // Another machine's (the hub drilling for one that can't reach its repository): that machine's repository.
  const repo = c.repoOf(o.machine ?? c.machine);
  const list = await snapshots(c, repo);
  if ("error" in list) return { ok: false, detail: `can't list ${repo}: ${list.error}` };
  if (!list.length) return { ok: false, detail: `${repo} holds no outline snapshots` };
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-drill-"));
  const said: string[] = [];
  let ok = true;
  try {
    for (const snap of list) {
      const out = join(dir, `${snap.outline}.sqlite`);
      const r = await dumpTo(c, repo, snap, out);
      const verdict = "error" in r ? r.error : integrity(out);
      const blocks = verdict === "ok" ? blockCount(out) : null;
      const line = verdict === "ok" ? `${snap.outline} ok (${blocks ?? "?"} blocks, ${hhmm(snap.time)})` : `${snap.outline} FAILED: ${verdict}`;
      if (verdict !== "ok") ok = false;
      said.push(line); say(`${verdict === "ok" ? "✓" : "✗"} ${line}`);
      rmSync(out, { force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { ok, detail: `restored ${list.length} outline${list.length === 1 ? "" : "s"} from ${repo}: ${said.join("; ")}` };
}

/**
 * The restore drill from here (PIE-810): against the repository when it answers; when it doesn't and a hub is named, on
 * the hub, which restores this machine's snapshots from the same repository (`ep0ch backup drill --machine <this>`
 * there); when neither can, it waits, said, and the last drill stands.
 */
export async function drillHere(c: BackupConfig, o: { now?: () => number; say?: Say; probe?: (repo: string) => Promise<string | null> } = {}): Promise<{ drill: { ok: boolean; detail: string; via?: string } } | { waiting: string }> {
  const repo = c.repoOf(c.machine);
  const why = c.hub ? await (o.probe ?? (await import("./relay")).unreachable)(repo) : null;
  if (!why) return { drill: await drill(c, o) };
  const { drillVia } = await import("./relay");
  const r = await drillVia(c, c.hub!);
  if ("error" in r) return r.unreachable ? { waiting: `${plainReason(why, { repo })}, and ${r.error}` }
    : { drill: { ok: false, detail: `through ${c.hub} (${plainReason(why, { repo })}): ${r.error}`, via: c.hub! } };
  return { drill: { ok: r.ok, detail: `through ${c.hub} (${plainReason(why, { repo })}): ${r.detail}`, via: c.hub! } };
}

/** How the job is run and read on this platform (what a fix says). */
export const commandsHere = (platform = process.platform): Commands => ({
  run: "ep0ch backup run",
  log: platform === "darwin" ? "tail -50 ~/Library/Logs/ep0ch-backup.log" : "journalctl --user -u ep0ch-backup -n 50",
});

/** The incidents now, into alert.json; the new ones announced (once each). */
export async function watch(c: BackupConfig, s: BackupState, o: { now?: () => number; announce?: (i: Incident[]) => Promise<void> } = {}): Promise<Alert> {
  const now = (o.now ?? Date.now)();
  const found = incidents(s, c.machine, now, commandsHere());
  const { alert, announce } = nextAlert(readAlert(c.state), found, c.machine, now);
  if (s.route) alert.route = s.route;
  writeAlert(c.state, alert);
  if (announce.length) await (o.announce ?? (i => announceAll(c, i)))(announce);
  return alert;
}

/** Whether with-secrets has this group (its names only are listed, never values). */
export function hasSecretsGroup(c: BackupConfig, group: string): boolean {
  try {
    const r = Bun.spawnSync(["with-secrets", "--list"], { stdout: "pipe", stderr: "ignore", env: c.env as Record<string, string> });
    return r.exitCode === 0 && new RegExp(`^${group}\\s`, "m").test(r.stdout.toString());
  } catch { return false; }
}

/**
 * The dead-man's ping (a secrets group `heartbeat` with HEARTBEAT_URL, a healthchecks.io-style check): after a run that
 * found nothing wrong, so a job that stops running, or keeps failing, is noticed somewhere other than this machine.
 * The request is made inside the process with-secrets started: the URL is never in an argv.
 */
export async function heartbeat(c: BackupConfig): Promise<void> {
  if (!hasSecretsGroup(c, "heartbeat")) return;
  const ping = 'await fetch(process.env.HEARTBEAT_URL, { signal: AbortSignal.timeout(20000) })';
  try { await Bun.spawn(["with-secrets", "heartbeat", "--", process.execPath, "-e", ping], { stdout: "ignore", stderr: "ignore", env: c.env as Record<string, string> }).exited; } catch { /* the next run pings */ }
}

/** One push per new incident: Herdr's notification here, and ntfy when a secrets group `ntfy` (NTFY_URL) exists. */
export async function announceAll(c: BackupConfig, list: Incident[]): Promise<void> {
  for (const i of list) {
    const body = `${i.detail}\nfix: ${i.fix}`;
    const quiet = { stdout: "ignore", stderr: "ignore", env: c.env as Record<string, string> } as const;
    try { await Bun.spawn(["herdr", "notification", "show", i.title, "--body", body, "--sound", "request"], quiet).exited; } catch { /* no Herdr here */ }
    if (hasSecretsGroup(c, "ntfy")) {
      // The request is made inside the process with-secrets started, so the topic's URL is never in an argv.
      const push = 'await fetch(process.env.NTFY_URL, { method: "POST", headers: { Title: process.argv[1], Tags: "floppy_disk" }, body: process.argv[2], signal: AbortSignal.timeout(20000) })';
      try { await Bun.spawn(["with-secrets", "ntfy", "--", process.execPath, "-e", push, i.title, body], quiet).exited; }
      catch { /* the status bar still shows it */ }
    }
  }
}

/** The whole job, as the timer runs it: one at a time (a lock in the state folder). */
export async function runAll(c: BackupConfig, o: { now?: () => number; say?: Say; step?: Step; drill?: boolean; verbose?: boolean; announce?: (i: Incident[]) => Promise<void>; follower?: typeof followerRuns; heartbeat?: (c: BackupConfig) => Promise<void>; probe?: (repo: string) => Promise<string | null> } = {}): Promise<{ ok: boolean; alert: Alert }> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const release = takeLock(c);
  if (typeof release === "string") {
    say(release);
    return { ok: true, alert: readAlert(c.state) ?? nextAlert(null, [], c.machine, now()).alert };
  }
  try {
    // A change to an outline's file that crashed while Litestream was paused for it left the replicator stopped.
    const s = readBackupState(c.state);
    try {
      const { recoverPaused, stuckPauses } = await import("@ep0ch/outliner/litestream-guard");
      for (const unit of recoverPaused({ env: c.env })) say(`Litestream ${unit}: started again (a change to an outline paused it and didn't finish)`);
      // One that still won't start is an incident (the alert's), said every run until it does.
      s.guard = stuckPauses({ env: c.env });
      for (const g of s.guard) say(`✗ Litestream ${g.unit} is stopped and didn't start (${g.error}): ${g.fix}`);
    } catch (e) { say(`✗ Litestream guard: ${(e as Error).message}`); }
    // Each part stands alone: one failing never stops the others.
    const snap = await snapshot(c, s, { now, say, step: o.step, probe: o.probe, ...(o.verbose ? { verbose: true } : {}) }).catch(e => { say(`✗ snapshot: ${(e as Error).message}`); return { uploaded: [], failed: ["(all)"], relayed: [] }; });
    writeBackupState(c.state, s);
    if (c.mirrors.length) { o.step?.(`mirroring ${c.mirrors.length} machine${c.mirrors.length === 1 ? "" : "s"}`); await mirror(c, s, { now, say, follower: o.follower }).catch(e => say(`✗ mirror: ${(e as Error).message}`)); writeBackupState(c.state, s); }
    // The remote MCP gateway's queued writes: those held here for other machines, and this machine's own pull (PIE-615).
    const { netmailStep } = await import("./netmail");
    o.step?.("netmail queues");
    await netmailStep(c, s, { now, say, ...(o.verbose ? { verbose: true } : {}) });
    writeBackupState(c.state, s);
    // A drill that waited (nowhere to run it) is due again at the next run.
    const due = o.drill ?? (!s.drill || !!s.drillWaiting || now() - Date.parse(s.drill.at) >= DRILL_EVERY_MS);
    if (due && Object.values(s.outlines).some(x => x.snapshot || x.relayed?.uploaded)) {
      o.step?.("restore drill");
      const d = await drillHere(c, { now, say, probe: o.probe });
      if ("waiting" in d) {
        s.drillWaiting = { since: s.drillWaiting?.since ?? new Date(now()).toISOString(), why: d.waiting };
        say(`· restore drill waits for the repository: ${d.waiting}`);
      } else {
        delete s.drillWaiting;
        s.drill = { at: new Date(now()).toISOString(), ...d.drill };
        say(`${d.drill.ok ? "✓" : "✗"} restore drill: ${d.drill.detail}`);
      }
    }
    // How the newest backups got there: through the hub while the repository is out of reach, else straight (status).
    if (snap.relayed.length && !snap.uploaded.length) {
      const why = snap.relayed.map(n => s.outlines[n]?.relayed?.why).find(Boolean) ?? "the repository didn't answer";
      s.route = { via: c.hub!, since: s.route?.since ?? new Date(now()).toISOString(), why };
    } else if (snap.uploaded.length) delete s.route;
    const sources = Object.entries(s.sources ?? {}).filter(([, x]) => x.error).map(([m]) => `${m}'s backups unreadable`);
    const ok = !snap.failed.length && !sources.length;
    s.lastRun = { at: new Date(now()).toISOString(), ok, detail: [...(snap.failed.length ? [`failed: ${snap.failed.join(", ")}`] : []), ...(snap.uploaded.length ? [`uploaded ${snap.uploaded.join(", ")}`] : []), ...(snap.relayed.length ? [`relayed ${snap.relayed.join(", ")} via ${c.hub}`] : []), ...(!snap.failed.length && !snap.uploaded.length && !snap.relayed.length ? ["nothing changed"] : []), ...sources].join("; ") };
    writeBackupState(c.state, s);
    o.step?.("checking what's stale");
    const alert = await watch(c, s, { now, announce: o.announce });
    if (alert.incidents.length) for (const i of alert.incidents) say(`! ${i.title}: ${i.detail} · fix: ${i.fix}`);
    else if (ok) await (o.heartbeat ?? heartbeat)(c);
    return { ok, alert };
  } finally { release(); }
}

/**
 * One backup command at a time on a machine: `run.lock` made exclusively (O_EXCL), holding its pid. A lock whose
 * process is gone is taken over. Returns the release, or why it can't run now.
 */
export function takeLock(c: BackupConfig): (() => void) | string {
  mkdirSync(c.state, { recursive: true, mode: 0o700 });
  const lock = join(c.state, "run.lock");
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, String(process.pid)); closeSync(fd);
      return () => { try { if (readFileSync(lock, "utf8") === String(process.pid)) rmSync(lock); } catch { /* gone */ } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return `can't make ${lock}: ${(e as Error).message}`;
      const pid = Number(readFileSync(lock, "utf8").trim() || 0);
      if (pid && alive(pid)) return `another backup command (pid ${pid}) is running; this one stops`;
      rmSync(lock, { force: true });   // its process is gone
    }
  }
  return `couldn't take ${lock}`;
}
