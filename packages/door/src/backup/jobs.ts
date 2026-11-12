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
import { archivedCursor, replayArchive, writeSegment } from "@ep0ch/outliner/log-archive";
import { alive } from "../state";
import { hostRequest, hostSend } from "../socket";
import { type Alert, type BackupState, type Commands, DRILL_EVERY_MS, hhmm, type Incident, incidents, nextAlert, readAlert, readBackupState, writeAlert, writeBackupState } from "./alert";
import type { BackupConfig } from "./config";
import { plainReason, repoHost } from "./plain";
import { failedLine, moment, relayedLine } from "./verdict";
import { backupFolder, complaint, forget, NO_REPO, restoreArchive, runRestic, snapshots } from "./restic";

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
  if (s.repo !== repo) { s.outlines = {}; s.repo = repo; delete s.lastPrune; }
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
      const r = await backupFolder(c, repo, join(archiveRoot(c, c.machine), x.name), x.name, x.lsn, x.schema);
      if ("error" in r) { why = direct = r.error; note(`${x.name}: direct upload to ${repoHost(repo)} failed after ${((Date.now() - began) / 1000).toFixed(1)}s: ${r.error}`); }
      else {
        Object.assign(st, { seq: x.lsn, logId: x.logId, schema: x.schema, at: new Date(now()).toISOString(), snapshot: r.id });
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
  if (uploaded.length) {
    // Retention after each upload; the prune that frees space, once a day.
    const prune = !s.lastPrune || now() - Date.parse(s.lastPrune) >= 24 * 3_600_000;
    const r = await forget(c, repo, prune);
    if (r.code === 0 && prune) s.lastPrune = new Date(now()).toISOString();
    if (r.code !== 0) say(`restic forget failed (the archives are safe; the next run tries again): ${complaint(r)}`);
  }
  return { uploaded, failed, relayed };
}

/** Each outline's newest archive (this machine's repository) restored into a temp folder, replayed and checked. */
export async function drill(c: BackupConfig, o: { now?: () => number; say?: Say; machine?: string } = {}): Promise<{ ok: boolean; detail: string }> {
  const say = o.say ?? (() => {});
  // Another machine's (the hub drilling for one that can't reach its repository): that machine's repository.
  const repo = c.repoOf(o.machine ?? c.machine);
  const list = await snapshots(c, repo);
  if ("error" in list) return { ok: false, detail: `can't list ${repo}: ${list.error}` };
  if (!list.length) return { ok: false, detail: `${repo} holds no outline archives` };
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-drill-"));
  const said: string[] = [];
  let ok = true;
  try {
    for (const snap of list) {
      const out = join(dir, `${snap.outline}.sqlite`);
      const target = mkdtempSync(join(dir, "archive-"));
      const got = await restoreArchive(c, repo, snap, target);
      let verdict: string, blocks: number | null = null;
      if ("error" in got) verdict = got.error;
      else {
        try { const r = replayArchive(got.root, snap.outline, out); blocks = r.rows.blocks ?? null; verdict = r.lsn === snap.seq || snap.seq === null ? integrity(out) : `the replay ends at entry ${r.lsn}, and the archive was taken at ${snap.seq}`; }
        catch (e) { verdict = (e as Error).message; }
      }
      const line = verdict === "ok" ? `${snap.outline} ok (${blocks ?? "?"} blocks, entry ${snap.seq ?? "?"}, ${hhmm(snap.time)})` : `${snap.outline} FAILED: ${verdict}`;
      if (verdict !== "ok") ok = false;
      said.push(line); say(`${verdict === "ok" ? "✓" : "✗"} ${line}`);
      rmSync(out, { force: true });
      rmSync(target, { recursive: true, force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { ok, detail: `replayed ${list.length} outline archive${list.length === 1 ? "" : "s"} from ${repo}: ${said.join("; ")}` };
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
export async function runAll(c: BackupConfig, o: { now?: () => number; say?: Say; step?: Step; drill?: boolean; verbose?: boolean; announce?: (i: Incident[]) => Promise<void>; heartbeat?: (c: BackupConfig) => Promise<void>; probe?: (repo: string) => Promise<string | null> } = {}): Promise<{ ok: boolean; alert: Alert }> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const release = takeLock(c);
  if (typeof release === "string") {
    say(release);
    return { ok: true, alert: readAlert(c.state) ?? nextAlert(null, [], c.machine, now()).alert };
  }
  try {
    const s = readBackupState(c.state);
    // Another machine's outlines are followed now (ADR 0009): a state file the restic mirrors wrote keeps nothing of them.
    for (const old of ["mirrors", "sources", "guard"]) delete (s as unknown as Record<string, unknown>)[old];
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
