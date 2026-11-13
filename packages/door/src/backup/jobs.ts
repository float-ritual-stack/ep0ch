// The backup job's parts (PIE-607, ADR 0009), each standing alone: a gap, an offline night or a failed upload leaves
// nothing to repair, the next run simply tries again.
//
//   archive   each outline here: the entries of its change log after what its archive holds, asked of its host
//             (`log.range`) and written as one new segment (outliner log-archive.ts); then the outline's archive folder
//             is uploaded to this machine's repository (only new segments travel). An outline whose log didn't move
//             isn't uploaded. Nothing here opens a live outline (PIE-1750).
//   relay     where the repository can't be reached (the work VPN) and a hub is named, the new entries go to the hub
//             over ssh instead (relay.ts); it archives and uploads them for this machine.
//   watch     what's stale (alert.ts), into alert.json for the door's status bar and doctor; each incident announced once.
//   drill     monthly: each outline's newest archive restored into a temp folder, replayed and checked.
//
// Another machine's outlines are followed, not copied (outliner outline-follower.ts): the gateway's and the web
// client's copies apply that machine's log as it changes.
import { Database } from "bun:sqlite";
import { closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { LogRange } from "@ep0ch/outliner/change-log";
import { archivedCursor, replayArchive, trimArchive, writeSegment } from "@ep0ch/outliner/log-archive";
import { alive } from "../state";
import { hostRequest, hostSend } from "../socket";
import { type Alert, type BackupState, followedCopies, type Commands, DRILL_EVERY_MS, type ForgetState, hhmm, type Incident, incidents, FORGET_EVERY_MS, nextAlert, PRUNE_EVERY_MS, PRUNE_RETRY_MS, readAlert, readBackupState, readDiskIncidents, writeAlert, writeBackupState } from "./alert";
import { type BackupConfig, RUN_LIMIT_MS } from "./config";
import { plainReason, repoHost } from "./plain";
import { failedLine, moment, relayedLine } from "./verdict";
import { backupFolder, complaint, forget, LOCKED, lockHolder, NO_REPO, prune, type Ran, restoreArchive, runRestic, snapshots } from "./restic";

type Say = (line: string) => void;
/** A step begins (what a person at a terminal sees spin, `ep0ch backup run`'s progress): its title. */
type Step = (title: string) => void;

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

/** Where this machine keeps the archive of `machine`'s outlines: `<state>/log/<machine>/<outline>/<logId>/…`. */
export const archiveRoot = (c: Pick<BackupConfig, "state">, machine: string) => join(c.state, "log", machine);

/** Entries per range asked of the host. */
const RANGE_LIMIT = 5_000;

/**
 * The entries of `name`'s log after what its archive holds, as its host answers them: ranges until the host's head.
 * A log the archive doesn't hold yet (a new outline, one made again or restored) starts at its genesis.
 */
export async function newRanges(c: Pick<BackupConfig, "host" | "state" | "machine">, name: string): Promise<{ logId: string; schema: number; ranges: LogRange[]; head: number; held: number }> {
  const ask = (after: number) => hostSend(c.host, "log.range", { outline: name, after, limit: RANGE_LIMIT }, 120_000) as Promise<LogRange>;
  // Past its head: no entries, just which log it is.
  const { logId } = await ask(Number.MAX_SAFE_INTEGER);
  const root = archiveRoot(c, c.machine);
  let have = archivedCursor(root, name, logId);
  let range = await ask(have?.lsn ?? 0);
  // The host compacted away what follows the archive (it ran long ago): that chain is kept aside, and a new one starts
  // at the host's newest genesis.
  if (have && range.after !== have.lsn) {
    renameSync(join(root, name, range.logId), join(root, name, `${range.logId}~${have.lsn}`));
    have = null;
  }
  const ranges = [range];
  while (!range.complete) { range = await ask(range.entries.at(-1)!.lsn); ranges.push(range); }
  return { logId: range.logId, schema: range.schema, ranges, head: range.head, held: have?.lsn ?? 0 };
}

/**
 * Each outline's new log entries archived, and each archive that moved uploaded to this machine's repository. Where the
 * repository can't be reached (a probe of its host fails, or restic's upload does) and a hub is named (EP0CH_MCP_HUB),
 * the new entries go to the hub instead, over ssh: it archives them and uploads them on this machine's behalf
 * (relay.ts). A relayed outline is `relayed`, not `failed`: its log is off this machine and checked.
 */
export async function snapshot(c: BackupConfig, s: BackupState, o: { force?: boolean; verbose?: boolean; now?: () => number; say?: Say; step?: Step; probe?: (repo: string) => Promise<string | null> } = {}): Promise<{ uploaded: string[]; failed: string[]; relayed: string[] }> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const repo = c.repoOf(c.machine);
  const uploaded: string[] = [], failed: string[] = [], relayed: string[] = [];
  // The outlines here, as their host says (PIE-1750): nothing here opens an outline's file.
  let outlines: { name: string; schema: number | null }[];
  try {
    outlines = (await hostRequest(c.host, "outlines.list", {}, 30_000)).outlines.map(o => ({ name: o.name, schema: o.schema ?? null }));
  } catch (e) {
    const why = `the outline host doesn't answer at ${c.host} (${(e as Error).message}), so nothing was archived`;
    // Kept apart from the outlines it knows: a first run knows none, and must still fail (never a silent green).
    s.host = { failingSince: s.host?.failingSince ?? new Date(now()).toISOString(), error: why, fix: hostStartCommand() };
    for (const st of Object.values(s.outlines)) { st.pendingSince ??= new Date(now()).toISOString(); st.error = why; }
    say(`✗ ${why}; start it: ${hostStartCommand()}`);
    return { uploaded, failed: [...Object.keys(s.outlines), "(the outline host)"], relayed };
  }
  delete s.host;
  // Archives are the repository's: another repository (or machine name) starts every outline over.
  if (s.repo !== repo) { s.outlines = {}; s.repo = repo; delete s.lastPrune; delete s.forget; delete s.prune; }
  // Outlines that were removed (moved, renamed) are no longer watched.
  for (const name of Object.keys(s.outlines)) if (!outlines.some(x => x.name === name)) delete s.outlines[name];
  const note = (line: string) => { if (o.verbose) say(line); };
  o.step?.(`archiving the log of ${outlines.length} outline${outlines.length === 1 ? "" : "s"}`);
  // Each outline's new entries into its archive, here, first: what is archived is kept whatever the upload does.
  const changed: { name: string; logId: string; lsn: number; schema: number; ranges: LogRange[] }[] = [];
  for (const x of outlines) {
    const st = s.outlines[x.name] ??= {};
    try {
      const got = await newRanges(c, x.name);
      writeSegment(archiveRoot(c, c.machine), x.name, got.ranges);
      const lsn = got.ranges.flatMap(r => r.entries).at(-1)?.lsn ?? got.held;
      // Moved: entries the repository doesn't hold yet (this run's, or an earlier run's whose upload failed).
      const moved = o.force || st.relayed?.uploaded === false || st.logId !== got.logId || st.seq !== lsn || st.schema !== got.schema;
      if (moved) { st.pendingSince ??= new Date(now()).toISOString(); changed.push({ name: x.name, logId: got.logId, lsn, schema: got.schema, ranges: got.ranges }); }
      else { delete st.pendingSince; delete st.error; note(`${x.name}: unchanged since entry ${st.seq ?? "?"}${st.at ? ` (${moment(st.at)})` : ""}, nothing to send`); }
    } catch (e) { st.pendingSince ??= new Date(now()).toISOString(); st.error = `archiving ${x.name}: ${(e as Error).message}`; failed.push(x.name); say(`✗ ${x.name}: ${st.error}`); }
  }
  if (!changed.length) { if (!failed.length) say(`no outline's log moved since its newest upload (${outlines.map(x => x.name).join(", ") || "none here"})`); return { uploaded, failed, relayed }; }
  // The repository, or why not: a quick look at its host first when there's a hub to relay through (restic itself waits minutes).
  let direct: string | null = (c.hub ? await (o.probe ?? (await import("./relay")).unreachable)(repo) : null) ?? null;
  if (!direct) direct = await ensureRepo(c, repo, say);
  note(direct ? `repository check: ${repo} failed: ${direct}` : `repository check: ${repo} answered`);
  if (direct) say(`${plainReason(direct, { repo })}${c.hub ? `; sending the changes through ${c.hub} instead` : ""}`);
  for (const x of changed) {
    const st = s.outlines[x.name]!;
    let why = direct;
    if (!why) {
      o.step?.(`${x.name}: uploading its archive to restic`);
      const began = Date.now();
      const r = await backupFolder(c, repo, join(archiveRoot(c, c.machine), x.name), x.name, x.lsn, x.schema, c.machine, x.logId);
      if ("error" in r) { why = direct = r.error; note(`${x.name}: direct upload to ${repoHost(repo)} failed after ${((Date.now() - began) / 1000).toFixed(1)}s: ${r.error}`); }
      else {
        if (r.cleared) say(`cleared a stale restic lock (${r.cleared})`);
        Object.assign(st, { seq: x.lsn, logId: x.logId, schema: x.schema, at: new Date(now()).toISOString(), snapshot: r.id });
        // Uploaded: what came before the newest genesis is in the repository's earlier snapshots, and goes from here.
        trimArchive(archiveRoot(c, c.machine), x.name, x.logId);
        delete st.pendingSince; delete st.error; delete st.relayed;
        uploaded.push(x.name);
        note(`${x.name}: sent direct to ${repoHost(repo)} in ${((Date.now() - began) / 1000).toFixed(1)}s`);
        say(`✓ ${x.name} (log entry ${x.lsn}) → snapshot ${r.id.slice(0, 8)}`);
        continue;
      }
    }
    if (c.hub) {
      o.step?.(`${x.name}: relaying through ${c.hub}`);
      note(`${x.name}: relayed via ${c.hub} because ${why}`);
      const { relay } = await import("./relay");
      const r = await relay(c, c.hub, { outline: x.name, logId: x.logId, schema: x.schema, root: archiveRoot(c, c.machine) });
      if (r.ok) {
        const at = new Date(now()).toISOString();
        Object.assign(st, { seq: x.lsn, logId: x.logId, schema: x.schema, at, relayed: { via: c.hub, at, why, uploaded: !!r.snapshot, ...(r.snapshot ? {} : { uploadError: r.uploadError ?? "?" }) } });
        delete st.snapshot; delete st.pendingSince; delete st.error;
        relayed.push(x.name);
        say(relayedLine(x.name, x.lsn, c.hub, why!, !!r.snapshot, { repo, ...(r.uploadError ? { uploadError: r.uploadError } : {}) }));
        continue;
      }
      st.error = `${why}; relaying through ${c.hub} failed: ${r.error ?? "?"}`;
    } else st.error = why!;
    failed.push(x.name);
    say(failedLine(x.name, st.error!, { repo, hub: c.hub }));
  }
  return { uploaded, failed, relayed };
}

/** What a run stopped before its forget or prune returned (systemd's limit, a reboot, a deploy) leaves on record. */
export const INTERRUPTED = "stopped before it finished (the run's time limit, a reboot or a deploy)";
/** Room the run keeps after its prune for what follows it, and the least time a prune is started with. */
const AFTER_PRUNE_MS = 2 * 60_000, LEAST_PRUNE_MS = 5 * 60_000;

/** How long a prune may run now: its own limit, inside what's left before `deadline`; null when that's too little. */
export function pruneBudget(limitMs: number, deadline: number, nowMs = Date.now()): number | null {
  const ms = Math.min(limitMs, deadline - nowMs - AFTER_PRUNE_MS);
  return ms >= Math.min(limitMs, LEAST_PRUNE_MS) ? ms : null;
}

/**
 * The repository's upkeep, decided every run on its own (PIE-1755): forget (KEEP) when this run uploaded, when the last
 * forget failed, or when none ran for 6 hours; once a day the prune that frees the space, a few hours after one that
 * failed, inside what's left of the run's time (`deadline`). Each attempt is saved as a failure before it starts and
 * replaced by how it went, so a run stopped mid-way (systemd's limit, a reboot) still counts, and still waits its hours.
 * Each counted, so one that keeps failing is an incident (alert.ts), not only a journal line.
 */
export async function maintain(c: BackupConfig, s: BackupState, o: { uploaded: boolean; now?: () => number; say?: Say; step?: Step; deadline?: number }): Promise<void> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const repo = c.repoOf(c.machine);
  const iso = () => new Date(now()).toISOString();
  const f = s.forget;
  if (o.uploaded || !f || !f.ok || now() - Date.parse(f.at) >= FORGET_EVERY_MS) {
    o.step?.("letting old snapshots go (restic forget)");
    const at = iso();
    s.forget = pending(f, at); writeBackupState(c.state, s);
    const r = await forget(c, repo);
    if (r.cleared) say(`cleared a stale restic lock (${r.cleared})`);
    s.forget = counted(f, r, at);
    if (!s.forget.ok) { say(`restic forget failed (the snapshots are safe; the next run tries again): ${s.forget.error}`); return; }
    say("✓ old snapshots let go");
  }
  // Once a day; after a failure, a few hours on, so a prune that can't finish doesn't take every run.
  const p = s.prune, last = p?.at ?? s.lastPrune;
  if (last && now() - Date.parse(last) < (p && !p.ok ? PRUNE_RETRY_MS : PRUNE_EVERY_MS)) return;
  const budget = pruneBudget(c.pruneTimeoutMs, o.deadline ?? Infinity);
  if (budget === null) { say("· the prune waits for a run with time for it (this one is near its limit)"); return; }
  o.step?.("freeing the space (restic prune)");
  const at = iso();
  s.prune = pending(p, at); writeBackupState(c.state, s);
  const r = await prune(c, repo, budget);
  if (r.cleared) say(`cleared a stale restic lock (${r.cleared})`);
  s.prune = counted(p, r, at);
  if (s.prune.ok) { s.lastPrune = iso(); say("✓ pruned: the space old snapshots held is freed"); }
  else say(`restic prune failed (old snapshots are let go; the space comes back with the next prune): ${s.prune.error}`);
}

/** An attempt starting, kept as the failure it is until it returns. */
function pending(was: ForgetState | undefined, at: string): ForgetState {
  const failing = was?.ok === false ? was : undefined;
  return { at, ok: false, failures: (failing?.failures ?? 0) + 1, since: failing?.since ?? at, error: INTERRUPTED };
}

/** A forget's or a prune's result, with the failures in a row before it. */
function counted(was: ForgetState | undefined, r: Ran & { cleared?: string; unlockError?: string }, at: string): ForgetState {
  if (r.code === 0) return { at, ok: true, failures: 0, ...(r.cleared ? { cleared: r.cleared } : {}) };
  const error = (r.code === LOCKED ? lockHolder(r) : complaint(r)) + (r.unlockError ? `; restic unlock failed: ${r.unlockError}` : "");
  const failing = was?.ok === false ? was : undefined;
  return { at, ok: false, failures: (failing?.failures ?? 0) + 1, since: failing?.since ?? at, error };
}

/** Each outline's newest archive (this machine's repository) restored into a temp folder, replayed and checked. */
/** A served drill's times for one outline (PIE-1786): restic's restore, the replay, and a scratch host opening it to read. */
export interface DrillTimes { outline: string; logId: string | null; restoreMs: number; replayMs: number; serveMs: number; blocks: number | null }

/**
 * The restore drill: each outline's newest archive restored into a temp folder, replayed and checked. `serve` (PIE-1786)
 * also opens each replayed file with a scratch outline host of its own (its own folder and socket, read-only) and reads
 * its notes through it, timing each part: the proof install needs before it stops copying outlines.
 */
export async function drill(c: BackupConfig, o: { now?: () => number; say?: Say; machine?: string; serve?: boolean } = {}): Promise<{ ok: boolean; detail: string; served?: DrillTimes[]; repo?: string; machine?: string }> {
  const say = o.say ?? (() => {});
  // Another machine's (the hub drilling for one that can't reach its repository): that machine's repository.
  const repo = c.repoOf(o.machine ?? c.machine);
  const list = await snapshots(c, repo);
  if ("error" in list) return { ok: false, detail: `can't list ${repo}: ${list.error}` };
  if (!list.length) return { ok: false, detail: `${repo} holds no outline archives` };
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-drill-"));
  const said: string[] = [], served: DrillTimes[] = [];
  let ok = true;
  try {
    for (const snap of list) {
      const folder = join(dir, `served-${snap.outline}`), out = join(folder, `${snap.outline}.sqlite`);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const target = mkdtempSync(join(dir, "archive-"));
      const t0 = performance.now();
      const got = await restoreArchive(c, repo, snap, target);
      const t1 = performance.now();
      let verdict: string, blocks: number | null = null, t2 = t1;
      if ("error" in got) verdict = got.error;
      else {
        try { const r = replayArchive(got.root, snap.outline, out, snap.logId ? { logId: snap.logId } : {}); t2 = performance.now(); blocks = r.rows.blocks ?? null; verdict = r.lsn === snap.seq || snap.seq === null ? integrity(out) : `the replay ends at entry ${r.lsn}, and the archive was taken at ${snap.seq}`; }
        catch (e) { verdict = (e as Error).message; }
      }
      let line = verdict === "ok" ? `${snap.outline} ok (${blocks ?? "?"} blocks, entry ${snap.seq ?? "?"}, ${hhmm(snap.time)})` : `${snap.outline} FAILED: ${verdict}`;
      if (verdict === "ok" && o.serve) {
        const s = await serveDrilled(folder, snap.outline);
        if ("error" in s) { verdict = s.error; line = `${snap.outline} FAILED to serve: ${s.error}`; }
        else {
          const times = { outline: snap.outline, logId: snap.logId ?? null, restoreMs: Math.round(t1 - t0), replayMs: Math.round(t2 - t1), serveMs: s.ms, blocks: s.blocks };
          served.push(times);
          // The host serves the notes out of the Trash: the file's own count of those is what it must read.
          const live = (() => { const db = new Database(out, { readonly: true }); try { return (db.query("SELECT COUNT(*) AS n FROM blocks WHERE effective_deleted_root_id IS NULL").get() as { n: number }).n; } finally { db.close(); } })();
          if (s.blocks !== live) { verdict = `served ${s.blocks} notes, and the replayed file holds ${live} out of the Trash`; line = `${snap.outline} FAILED: ${verdict}`; }
          else line += `; served by a scratch host: ${s.blocks} notes read (restore ${(times.restoreMs / 1000).toFixed(1)} s, replay ${(times.replayMs / 1000).toFixed(1)} s, open and read ${(times.serveMs / 1000).toFixed(1)} s)`;
        }
      }
      if (verdict !== "ok") ok = false;
      said.push(line); say(`${verdict === "ok" ? "✓" : "✗"} ${line}`);
      rmSync(folder, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { ok, detail: `${o.serve ? "restored, replayed and served" : "replayed"} ${list.length} outline archive${list.length === 1 ? "" : "s"} from ${repo}: ${said.join("; ")}`, ...(o.serve ? { served, repo, machine: o.machine ?? c.machine } : {}) };
}

/** A replayed outline opened by a scratch host of its own (read-only, in `folder`), its notes read through its socket. */
async function serveDrilled(folder: string, outline: string): Promise<{ blocks: number; ms: number } | { error: string }> {
  const { OutlineHost } = await import("@ep0ch/outliner/outline-host");
  const started = performance.now();
  const host = new OutlineHost({ outlinesFolder: folder, readOnly: true, log: () => {} });
  try {
    await host.start();
    const index = await hostSend(host.socketPath, "tree.index", { outline }, 120_000) as { blocks?: unknown[] };
    return { blocks: index.blocks?.length ?? 0, ms: Math.round(performance.now() - started) };
  } catch (e) { return { error: (e as Error).message }; }
  finally { await host.close().catch(() => {}); }
}

/**
 * The restore drill from here (PIE-810): against the repository when it answers; when it doesn't and a hub is named, on
 * the hub, which restores this machine's snapshots from the same repository (`ep0ch backup drill --machine <this>`
 * there); when neither can, it waits, said, and the last drill stands.
 */
export async function drillHere(c: BackupConfig, o: { now?: () => number; say?: Say; probe?: (repo: string) => Promise<string | null>; serve?: boolean } = {}): Promise<{ drill: { ok: boolean; detail: string; via?: string; served?: DrillTimes[]; repo?: string; machine?: string } } | { waiting: string }> {
  const repo = c.repoOf(c.machine);
  const why = c.hub ? await (o.probe ?? (await import("./relay")).unreachable)(repo) : null;
  if (!why) return { drill: await drill(c, o) };
  const { drillVia } = await import("./relay");
  const r = await drillVia(c, c.hub!, undefined, !!o.serve);
  if ("error" in r) return r.unreachable ? { waiting: `${plainReason(why, { repo })}, and ${r.error}` }
    : { drill: { ok: false, detail: `through ${c.hub} (${plainReason(why, { repo })}): ${r.error}`, via: c.hub! } };
  return { drill: { ok: r.ok, detail: `through ${c.hub} (${plainReason(why, { repo })}): ${r.detail}`, via: c.hub!, ...(r.served ? { served: r.served, repo: r.repo, machine: r.machine } : {}) } };
}

/** How the job is run and read on this platform (what a fix says). */
export const commandsHere = (platform = process.platform): Commands => ({
  run: "ep0ch backup run",
  log: platform === "darwin" ? "tail -50 ~/Library/Logs/ep0ch-backup.log" : "journalctl --user -u ep0ch-backup -n 50",
});

/** The incidents now, into alert.json; the new ones announced (once each). */
export async function watch(c: BackupConfig, s: BackupState, o: { now?: () => number; announce?: (i: Incident[]) => Promise<unknown> } = {}): Promise<Alert> {
  const now = (o.now ?? Date.now)();
  // The disk keeper's open incidents stay in the alert beside the job's own (it announces them itself).
  const found = [...incidents(s, c.machine, now, commandsHere()), ...readDiskIncidents(c.state)];
  const { alert, announce } = nextAlert(readAlert(c.state), found, c.machine, now);
  if (s.route) alert.route = s.route;
  writeAlert(c.state, alert);
  if (announce.length) await (o.announce ?? (i => announceAll(c, i)))(announce);
  return alert;
}

/** Whether with-secrets has this group (its names only are listed, never values). */
export function hasSecretsGroup(c: Pick<BackupConfig, "env">, group: string): boolean {
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

/**
 * One push per new incident: Herdr's notification here, and ntfy when a secrets group `ntfy` (NTFY_URL) exists.
 * Answers the keys that reached someone (Herdr or ntfy said yes), so a caller can try the rest again.
 */
export async function announceAll(c: Pick<BackupConfig, "env">, list: Incident[]): Promise<string[]> {
  const reached: string[] = [];
  const ntfy = list.length > 0 && hasSecretsGroup(c, "ntfy");
  for (const i of list) {
    const body = `${i.detail}\nfix: ${i.fix}`;
    const quiet = { stdout: "ignore", stderr: "ignore", env: c.env as Record<string, string> } as const;
    let ok = false;
    try { ok = (await Bun.spawn(["herdr", "notification", "show", i.title, "--body", body, "--sound", "request"], quiet).exited) === 0; } catch { /* no Herdr here */ }
    if (ntfy) {
      // The request is made inside the process with-secrets started, so the topic's URL is never in an argv.
      const push = 'const r = await fetch(process.env.NTFY_URL, { method: "POST", headers: { Title: process.argv[1], Tags: "floppy_disk" }, body: process.argv[2], signal: AbortSignal.timeout(20000) }); process.exit(r.ok ? 0 : 1)';
      try { ok = (await Bun.spawn(["with-secrets", "ntfy", "--", process.execPath, "-e", push, i.title, body], quiet).exited) === 0 || ok; }
      catch { /* the status bar still shows it */ }
    }
    if (ok) reached.push(i.key);
  }
  return reached;
}

/** The whole job, as the timer runs it: one at a time (a lock in the state folder). */
export async function runAll(c: BackupConfig, o: { now?: () => number; say?: Say; step?: Step; drill?: boolean; verbose?: boolean; announce?: (i: Incident[]) => Promise<void>; heartbeat?: (c: BackupConfig) => Promise<void>; probe?: (repo: string) => Promise<string | null>; deadline?: number } = {}): Promise<{ ok: boolean; alert: Alert }> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  // When systemd stops this run (the unit's TimeoutStartSec): the prune is fitted inside it.
  const deadline = o.deadline ?? Date.now() + RUN_LIMIT_MS;
  const release = takeLock(c);
  if (typeof release === "string") {
    say(release);
    return { ok: true, alert: readAlert(c.state) ?? nextAlert(null, [], c.machine, now()).alert };
  }
  try {
    const s = readBackupState(c.state);
    // Another machine's outlines are followed now (ADR 0009): a state file the restic mirrors wrote keeps nothing of them.
    for (const old of ["mirrors", "sources", "guard"]) delete (s as unknown as Record<string, unknown>)[old];
    // The followers' word on their copies, for the alert (a copy that stopped following is an incident).
    s.follows = followedCopies(c.mirrorsDir, c.following);
    // Each part stands alone: one failing never stops the others.
    const snap = await snapshot(c, s, { now, say, step: o.step, probe: o.probe, ...(o.verbose ? { verbose: true } : {}) }).catch(e => { say(`✗ snapshot: ${(e as Error).message}`); return { uploaded: [], failed: ["(all)"], relayed: [] }; });
    writeBackupState(c.state, s);
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
    // The repository's upkeep, every run on its own, when there's something to keep in a repository that answers: not
    // when this run couldn't upload (the repository or the host failing is an incident of its own), nor before any
    // snapshot is there, nor while the repository is out of reach (sent through the hub, or a quick look at it fails).
    const kept = snap.uploaded.length > 0 || Object.values(s.outlines).some(x => x.snapshot);
    const away = !kept || (snap.failed.length && !snap.uploaded.length) ? "" : snap.relayed.length && !snap.uploaded.length ? "the repository is out of reach"
      : !snap.uploaded.length && c.hub ? await (o.probe ?? (await import("./relay")).unreachable)(c.repoOf(c.machine)) : null;
    if (away) say(`· old snapshots wait for the repository: ${away}`);
    else if (away === null) await maintain(c, s, { uploaded: snap.uploaded.length > 0, now, say, deadline, ...(o.step ? { step: o.step } : {}) }).catch(e => say(`✗ restic upkeep: ${(e as Error).message}`));
    writeBackupState(c.state, s);
    // How the newest backups got there: through the hub while the repository is out of reach, else straight (status).
    if (snap.relayed.length && !snap.uploaded.length) {
      const why = snap.relayed.map(n => s.outlines[n]?.relayed?.why).find(Boolean) ?? "the repository didn't answer";
      s.route = { via: c.hub!, since: s.route?.since ?? new Date(now()).toISOString(), why };
    } else if (snap.uploaded.length) delete s.route;
    const ok = !snap.failed.length;
    s.lastRun = { at: new Date(now()).toISOString(), ok, detail: [...(snap.failed.length ? [`failed: ${snap.failed.join(", ")}`] : []), ...(snap.uploaded.length ? [`uploaded ${snap.uploaded.join(", ")}`] : []), ...(snap.relayed.length ? [`relayed ${snap.relayed.join(", ")} via ${c.hub}`] : []), ...(!snap.failed.length && !snap.uploaded.length && !snap.relayed.length ? ["nothing changed"] : [])].join("; ") };
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
/**
 * The job's lock (`run.lock` in its state folder): a release, or the pid of the live backup command that holds it, or why
 * it couldn't be taken. A lock whose process is gone is taken over.
 */
export function lockOrHolder(c: Pick<BackupConfig, "state">, name = "run.lock"): { release: () => void } | { holder: number } | { error: string } {
  mkdirSync(c.state, { recursive: true, mode: 0o700 });
  const lock = join(c.state, name);
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, String(process.pid)); closeSync(fd);
      return { release: () => { try { if (readFileSync(lock, "utf8") === String(process.pid)) rmSync(lock); } catch { /* gone */ } } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return { error: `can't make ${lock}: ${(e as Error).message}` };
      const pid = Number(readFileSync(lock, "utf8").trim() || 0);
      if (pid && alive(pid)) return { holder: pid };
      rmSync(lock, { force: true });   // its process is gone
    }
  }
  return { error: `couldn't take ${lock}` };
}

export function takeLock(c: Pick<BackupConfig, "state">, name = "run.lock", who = "another backup command"): (() => void) | string {
  const got = lockOrHolder(c, name);
  return "release" in got ? got.release : "holder" in got ? `${who} (pid ${got.holder}) is running; this one stops` : got.error;
}

/**
 * The job's lock, waited for while another backup command holds it (a relay arriving during the hub's run; install's
 * rollback point during the scheduled run, PIE-1800), up to `waitMs`. `waiting` is told once, with the holder's pid,
 * when it has to wait; past the wait, the refusal says the holder was still running.
 */
export async function waitForLock(c: Pick<BackupConfig, "state">, waitMs: number, waiting?: (pid: number) => void): Promise<(() => void) | string> {
  const until = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const got = lockOrHolder(c);
    if ("release" in got) return got.release;
    if ("error" in got) return got.error;
    if (Date.now() >= until) return `another backup command (pid ${got.holder}) was still running after ${Math.round(waitMs / 1000)} s; this one stops`;
    if (!told) { told = true; waiting?.(got.holder); }
    await Bun.sleep(Math.min(2_000, Math.max(50, waitMs / 10)));
  }
}
