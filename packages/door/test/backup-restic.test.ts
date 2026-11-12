// The restic backup job (PIE-607, ADR 0009): each outline's change log archived and the archive uploaded when it moved,
// the staleness alert (announced once), the restore and the drill (a replay of the archive), install's plan for the
// units, and the door's mark.
// Scratch outlines (fictional notes) and local restic repositories in a temp folder only: no bucket, no real outline,
// no real unit. The restic parts are skipped where restic isn't installed.
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alertMark, type BackupState, CHECK_LATE_MS, incidents, nextAlert, readAlert, readBackupState, STALE_AFTER_MS, writeBackupState } from "../src/backup/alert";
import { backupConfig, type BackupConfig, parseMirrors } from "../src/backup/config";
import { backupCommand, parseAt, pick } from "../src/backup/cli";
import { archiveRoot, hostCopy, runAll, snapshot, takeLock } from "../src/backup/jobs";
import { canonicalDump } from "@ep0ch/outliner/change-log";
import { parseSnapshots, resticArgv, summaryId } from "../src/backup/restic";
import { backupPlan, type BackupSetupFacts, fill, resticChecks, UNIT_MARK, unitFiles } from "../src/backup/setup";
import { App } from "../src/app";
import { MainMenu } from "../src/screens";
import { hostRequest, SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { writeAlert } from "../src/backup/alert";
import { outliner, Scratch, scratchDir } from "./scratch";
import { OutlineHost } from "@ep0ch/outliner/outline-host";

const root = scratchDir("ep0ch-restic-test-");
const hosts: OutlineHost[] = [];
afterAll(async () => { for (const h of hosts.splice(0)) await h.close(); rmSync(root, { recursive: true, force: true }); });

/** The outline host that serves a machine's outlines (PIE-1750): the job asks it, and never opens an outline's file. */
async function served(c: BackupConfig): Promise<BackupConfig> {
  mkdirSync(c.outlines, { recursive: true });
  const host = new OutlineHost({ outlinesFolder: c.outlines, log: () => {} });
  await host.start();
  hosts.push(host);
  return c;
}
const RESTIC = Bun.which("restic") ?? (existsSync(`${process.env.HOME}/.local/bin/restic`) ? `${process.env.HOME}/.local/bin/restic` : null);
const CMD = { run: "ep0ch backup run", log: "journalctl --user -u ep0ch-backup -n 50" };
const T0 = Date.parse("2026-05-02T09:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

/**
 * Notes written to one of a machine's outlines, through the host that serves it (made on first use): what the job then
 * archives. Only the host opens an outline (PIE-1750), and the job asks it for the log (`log.range`).
 */
async function write(c: BackupConfig, name: string, texts: string[]): Promise<void> {
  if (!(await hostRequest(c.host, "outlines.list", {})).outlines.some(o => o.name === name)) await hostRequest(c.host, "outlines.create", { name });
  const board = new SocketBoard(c.host, 15_000, name);
  try { for (const text of texts) await board.request("create", { parentId: null, text, author: "user" }); } finally { board.close(); }
}

/** Whether a copy of an outline holds a note with this text. */
const holds = (path: string, text: string) => {
  const db = new Database(path, { readonly: true });
  try { return !!db.query("SELECT 1 FROM blocks WHERE text = ?").get(text); } finally { db.close(); }
};
/** The replicated rows of a copy (the log's canonical dump), read-only. */
const dumpOf = (path: string) => { const db = new Database(path, { readonly: true }); try { return canonicalDump(db); } finally { db.close(); } };

/** A machine: its own outlines, state and home, and the shared repositories folder. */
function machine(name: string, extra: Record<string, string> = {}): BackupConfig {
  const dir = join(root, name);
  mkdirSync(join(dir, "home"), { recursive: true });
  const c = backupConfig({ HOME: join(dir, "home"), PATH: process.env.PATH, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"),
    EP0CH_MCP_MIRROR_DIR: join(dir, "mirrors"), EP0CH_BACKUP_MACHINE: name, EP0CH_BACKUP_REPO: join(root, "repos", "{machine}"),
    RESTIC_PASSWORD: "fictional-test-password", ...(RESTIC ? { EP0CH_RESTIC: RESTIC } : {}), ...extra });
  if ("error" in c) throw new Error(c.error);
  return c;
}

describe("settings", () => {
  test("the env file, mirrors and the machine's name", () => {
    expect(parseEnvFile("# a comment\nEP0CH_BACKUP_MACHINE=laptop\nexport X='y'\n")).toEqual({ EP0CH_BACKUP_MACHINE: "laptop", X: "y" });
    expect(parseMirrors("laptop, tower=tower.example")).toEqual([{ machine: "laptop" }, { machine: "tower", ssh: "tower.example" }]);
    expect(parseMirrors("Laptop!")).toHaveProperty("error");
    const home = join(root, "settings-home");
    mkdirSync(join(home, ".config/ep0ch"), { recursive: true });
    writeFileSync(join(home, ".config/ep0ch/backup.env"), "EP0CH_BACKUP_MACHINE=garden-shed\nEP0CH_BACKUP_MIRRORS=laptop\n");
    const c = backupConfig({ HOME: home });
    expect(c).toMatchObject({ machine: "garden-shed", machineFrom: "file", mirrors: [{ machine: "laptop" }] });
    expect(backupConfig({ HOME: home, EP0CH_BACKUP_MACHINE: "porch" })).toMatchObject({ machine: "porch", machineFrom: "env" });
    expect(backupConfig({ HOME: home, EP0CH_BACKUP_MIRRORS: "garden-shed" })).toHaveProperty("error");
    if (!("error" in c)) expect(c.repoOf("laptop")).toBe("s3:https://hel1.your-objectstorage.com/ep0ch/restic/laptop");
  });

  test("restic runs through with-secrets unless its password is in the environment", () => {
    const base = { restic: "restic", secrets: ["bucket", "restic"] };
    expect(resticArgv({ ...base, env: {} }, ["snapshots"])).toEqual(["with-secrets", "bucket,restic", "--", "restic", "snapshots"]);
    expect(resticArgv({ ...base, env: { RESTIC_PASSWORD: "x" } }, ["snapshots"])).toEqual(["restic", "snapshots"]);
  });

  test("restic's answers: outline snapshots and the summary line", () => {
    const rows = [{ id: "aa", time: "2026-05-02T09:00:00Z", paths: ["/fictional/state/backup/log/laptop/garden"], tags: ["ep0ch-outline", "outline=garden", "seq=12", "schema=12"], hostname: "laptop" },
      { id: "bb", time: "2026-05-02T09:00:00Z", paths: ["/home"], tags: ["nightly"] },
      // A sqlite copy from before the archive (ADR 0009): not an archive this build replays.
      { id: "cc", time: "2026-05-01T09:00:00Z", paths: ["/garden.sqlite"], tags: ["ep0ch-outline", "outline=garden", "seq=3"], hostname: "laptop" }];
    expect(parseSnapshots(JSON.stringify(rows))).toEqual([{ id: "aa", time: "2026-05-02T09:00:00Z", outline: "garden", seq: 12, schema: 12, host: "laptop", path: "/fictional/state/backup/log/laptop/garden" }]);
    // A tag naming a path is no outline: its name becomes a file name.
    expect(parseSnapshots(JSON.stringify([{ ...rows[0], tags: ["ep0ch-outline", "outline=../../etc/x"] }]))).toEqual([]);
    expect(summaryId('{"message_type":"status"}\n{"message_type":"summary","snapshot_id":"cafe"}\n')).toBe("cafe");
    expect(parseAt("3h", T0)).toBe(T0 - 3 * 3_600_000);
    expect(parseAt("2026-05-01 08:00", T0)).toBe(Date.parse("2026-05-01T08:00"));
    const snaps = [{ id: "1", time: "2026-05-01T08:00:00Z", outline: "g", seq: 1, host: "", path: "/l/g" }, { id: "2", time: "2026-05-02T08:00:00Z", outline: "g", seq: 2, host: "", path: "/l/g" }];
    expect(pick(snaps, null)?.id).toBe("2");
    expect(pick(snaps, Date.parse("2026-05-01T12:00:00Z"))?.id).toBe("1");
    expect(pick(snaps, Date.parse("2026-04-01T00:00:00Z"))).toBeNull();
  });
});

describe("the alert", () => {
  const state = (o: Partial<BackupState>): BackupState => ({ outlines: {}, ...o });

  test("changes waiting longer than 2 hours are stale; a fresh change isn't", () => {
    const s = state({ outlines: {
      garden: { seq: 4, at: iso(T0 - 5 * 3_600_000), pendingSince: iso(T0 - STALE_AFTER_MS - 60_000), error: "Fatal: unable to open repository: connection reset" },
      pantry: { seq: 9, at: iso(T0 - 9 * 3_600_000), pendingSince: iso(T0 - 30 * 60_000) },
      attic: { seq: 1, at: iso(T0 - 30 * 24 * 3_600_000) },
    } });
    const found = incidents(s, "laptop", T0, CMD);
    expect(found.map(i => i.key)).toEqual(["outline:laptop/garden"]);
    expect(found[0]!.detail).toContain("didn't answer");
    expect(found[0]!.fix).toContain("ep0ch backup run");
  });

  test("a failed drill is an incident", () => {
    const s = state({ drill: { at: iso(T0), ok: false, detail: "garden FAILED" } });
    expect(incidents(s, "float", T0, CMD).map(i => i.key)).toEqual(["drill:float"]);
  });

  test("each incident is announced once, and forgotten when it clears", () => {
    const i = { key: "outline:laptop/garden", title: "t", detail: "d", fix: "f", since: iso(T0) };
    const first = nextAlert(null, [i], "laptop", T0);
    expect(first.announce).toEqual([i]);
    const again = nextAlert(first.alert, [i], "laptop", T0 + 900_000);
    expect(again.announce).toEqual([]);
    const cleared = nextAlert(again.alert, [], "laptop", T0 + 1_800_000);
    expect(cleared.alert.announced).toEqual([]);
    expect(nextAlert(cleared.alert, [i], "laptop", T0 + 2_700_000).announce).toEqual([i]);
  });

  test("the status bar's mark: an incident, a check that stopped, or nothing", () => {
    const i = { key: "k", title: "t", detail: "garden changed", fix: "ep0ch backup run", since: iso(T0) };
    expect(alertMark({ machine: "m", checkedAt: iso(T0), incidents: [i, { ...i, key: "j" }], announced: [] }, T0)).toEqual({ text: "✗ backup 2", say: "garden changed · fix: ep0ch backup run · +1 more (ep0ch doctor)" });
    expect(alertMark({ machine: "m", checkedAt: iso(T0), incidents: [], announced: [] }, T0)).toBeNull();
    expect(alertMark({ machine: "m", checkedAt: iso(T0 - CHECK_LATE_MS), incidents: [], announced: [] }, T0)?.text).toBe("? backup");
    expect(alertMark(null, T0)).toBeNull();
  });

  test("one backup command at a time: the lock is exclusive, and a dead holder's is taken over", () => {
    const c = machine("locks");
    const release = takeLock(c);
    expect(typeof release).toBe("function");
    expect(takeLock(c)).toContain("is running");
    (release as () => void)();
    writeFileSync(join(c.state, "run.lock"), "999999999");
    const again = takeLock(c);
    expect(typeof again).toBe("function");
    (again as () => void)();
  });

});

describe.skipIf(!RESTIC)("archives and restores against a local restic repository", () => {
  const laptop = machine("laptop");
  const said: string[] = [];
  beforeAll(() => served(laptop));
  const say = (s: string) => said.push(s);

  test("only outlines whose log moved are uploaded, each its archive of the log", async () => {
    await write(laptop, "garden", ["Plant the tomatoes", "Water the beans"]);
    await write(laptop, "pantry", ["Flour"]);
    const s = readBackupState(laptop.state);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden", "pantry"], failed: [], relayed: [] });
    const first = s.outlines.garden!.seq!;
    expect(first).toBeGreaterThan(0);
    expect([typeof s.outlines.garden!.logId, typeof s.outlines.garden!.schema]).toEqual(["string", "number"]);
    // The archive is the log, as segments of whole ranges, in the job's state.
    expect(existsSync(join(archiveRoot(laptop, "laptop"), "garden", s.outlines.garden!.logId!))).toBe(true);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: [], failed: [], relayed: [] });
    // Another repository starts every outline over: nothing counts as backed up there.
    const elsewhere = { ...laptop, repoOf: (m: string) => join(root, "repos-other", m) };
    expect((await snapshot(elsewhere, { ...s, outlines: { ...s.outlines } }, { say })).uploaded).toEqual(["garden", "pantry"]);
    await write(laptop, "garden", ["Stake the peas"]);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden"], failed: [], relayed: [] });
    expect(s.outlines.garden!.seq).toBeGreaterThan(first);
    writeBackupState(laptop.state, s);
  }, 120_000);

  test("restore: the archive replayed, integrity-checked, to a new file; never before the outline began; never over an outline in use", async () => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    const env = laptop.env;
    const to = join(root, "restored", "garden.sqlite");
    expect(await backupCommand(["backup", "restore", "garden", "--to", to], io, env)).toBe(0);
    expect(out.at(-1)).toMatch(/✓ garden from laptop's archive [0-9a-f]{8}, replayed to entry \d+ .*\d+ blocks → .*garden\.sqlite; integrity ok/);
    for (const note of ["Plant the tomatoes", "Water the beans", "Stake the peas"]) expect(holds(to, note)).toBe(true);
    expect(await backupCommand(["backup", "restore", "garden", "--to", to], io, env)).toBe(2);   // exists
    expect(await backupCommand(["backup", "restore", "garden", "--to", join(laptop.outlines, "garden-copy.sqlite")], io, env)).toBe(2);
    expect(err.at(-1)).toContain("a service has open");
    expect(err.at(-1)).not.toContain("Litestream");
    // Before the outline began there is nothing to replay.
    expect(await backupCommand(["backup", "restore", "garden", "--at", "2020-01-01T00:00:00Z", "--to", join(root, "restored", "old.sqlite")], io, env)).toBe(1);
    expect(err.at(-1)).toContain("no genesis");
    expect(await backupCommand(["backup", "list", "garden"], io, env)).toBe(0);
    expect(out.filter(l => /log entry \d/.test(l)).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  test("a restore from the archive holds what the live outline holds", async () => {
    await write(laptop, "pantry", ["Oats", "Lentils"]);
    const s = readBackupState(laptop.state);
    expect((await snapshot(laptop, s, { say })).uploaded).toContain("pantry");
    writeBackupState(laptop.state, s);
    // The live outline, as its host copies it (only the host opens it), beside the archive replayed.
    const live = join(root, "compare", "pantry-live.sqlite"), restored = join(root, "compare", "pantry-restored.sqlite");
    mkdirSync(join(root, "compare"), { recursive: true });
    await hostCopy(laptop, "pantry", live);
    const out: string[] = [], err: string[] = [];
    expect(await backupCommand(["backup", "restore", "pantry", "--to", restored], { out: l => out.push(l), err: l => err.push(l) }, laptop.env)).toBe(0);
    expect(dumpOf(restored)).toBe(dumpOf(live));
  }, 120_000);

  test("a repository it can't reach: changes wait, then one alert (announced once) with the fix; it clears when the upload works", async () => {
    // restic that can't reach its repository (a VPN resetting connections), without restic's minutes of retries.
    const offline = join(root, "restic-offline.sh");
    writeFileSync(offline, "#!/bin/sh\necho 'Fatal: unable to open repository at s3:example.invalid: connection reset by peer' >&2\nexit 1\n", { mode: 0o755 });
    const shed = await served(machine("shed", { EP0CH_RESTIC: offline }));
    await write(shed, "garden", ["Sharpen the hoe"]);
    const announced: string[] = [];
    const announce = async (i: { key: string }[]) => { announced.push(...i.map(x => x.key)); };
    const heartbeats: number[] = [];
    let now = T0;
    expect((await runAll(shed, { now: () => now, announce, drill: false, heartbeat: async () => { heartbeats.push(now); } })).ok).toBe(false);
    expect(readAlert(shed.state)?.incidents).toEqual([]);
    now += STALE_AFTER_MS + 60_000;
    const late = await runAll(shed, { now: () => now, announce, drill: false, heartbeat: async () => { heartbeats.push(now); } });
    expect(late.alert.incidents.map(i => i.key)).toEqual(["outline:shed/garden"]);
    expect(late.alert.incidents[0]!.fix).toContain("ep0ch backup run");
    expect(late.alert.incidents[0]!.detail).toContain("didn't answer");
    now += 900_000;
    await runAll(shed, { now: () => now, announce, drill: false, heartbeat: async () => { heartbeats.push(now); } });
    expect(announced).toEqual(["outline:shed/garden"]);
    // The repository comes back.
    const fixed = { ...shed, restic: RESTIC! };
    now += 900_000;
    const ok = await runAll(fixed, { now: () => now, announce, drill: false, heartbeat: async () => { heartbeats.push(now); } });
    expect(ok.ok).toBe(true);
    // The dead-man's ping only after a clean run.
    expect(heartbeats).toEqual([now]);
    expect(ok.alert.incidents).toEqual([]);
  }, 120_000);

  test("the drill replays every outline's newest archive and checks it", async () => {
    const out: string[] = [];
    const env = laptop.env;
    expect(await backupCommand(["backup", "drill"], { out: s => out.push(s), err: s => out.push(s) }, env)).toBe(0);
    expect(out.join("\n")).toMatch(/garden ok \(\d+ blocks, entry \d+/);
    expect(out.join("\n")).toMatch(/pantry ok \(\d+ blocks/);
    expect(readBackupState(join(root, "laptop", "state", "backup")).drill?.ok).toBe(true);
  }, 120_000);

  test("`backup run` at a terminal: each step spins and ends with its time, as install's do; piped, the plain lines", async () => {
    const drawn: string[] = [], out: string[] = [], err: string[] = [];
    const terminal = { isTTY: true, columns: 100, write: (s: string) => { drawn.push(s); return true; } };
    const env = { ...laptop.env, TERM: "xterm-256color", EP0CH_PROGRAM_STATUS: "0" };
    await write(laptop, "garden", ["Net the brassicas"]);
    expect(await backupCommand(["backup", "run"], { out: s => out.push(s), err: s => err.push(s), terminal }, env)).toBe(0);
    const text = drawn.join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    expect(text).toContain("archiving 2 outlines' logs");
    expect(text).toContain("garden: uploading its archive to restic");
    expect(text).toMatch(/✓ garden \(log entry \d+\) → snapshot [0-9a-f]{8}/);
    expect(out).toEqual([]);
    // Piped (the timer's run): the lines as before, no steps drawn.
    const piped: string[] = [];
    expect(await backupCommand(["backup", "run"], { out: s => piped.push(s), err: s => err.push(s) }, env)).toBe(0);
    expect(piped.join("\n")).toContain("no outline's log moved since its newest upload");
  }, 120_000);
});

describe.skipIf(!RESTIC)("only the host opens a live outline (PIE-1750)", () => {
  test("the job backs up what the host serves, though it can't see the outlines' folder: it opens no outline's file", async () => {
    // The host's folder, and a job whose own outlines folder holds nothing: every answer is the host's.
    const vault = await served(machine("vault"));
    await write(vault, "ledger", ["Seed money", "Fence posts"]);
    const job = machine("vault-job", { EP0CH_SOCKET: vault.host, EP0CH_BACKUP_MACHINE: "vault" });
    expect(job.outlines).not.toBe(vault.outlines);
    const s = readBackupState(job.state), said: string[] = [];
    expect(await snapshot(job, s, { say: l => said.push(l) })).toEqual({ uploaded: ["ledger"], failed: [], relayed: [] });
    expect(s.outlines.ledger!.seq).toBeGreaterThan(0);
    const out: string[] = [];
    const to = join(root, "vault-restored", "ledger.sqlite");
    expect(await backupCommand(["backup", "restore", "ledger", "--to", to], { out: l => out.push(l), err: l => out.push(l) }, job.env)).toBe(0);
    expect(out.join("\n")).toMatch(/\d+ blocks/);
    expect(holds(to, "Fence posts")).toBe(true);
  }, 120_000);

  test("with no host answering, nothing is copied, the outlines wait, and the line says the command that starts it", async () => {
    const attic = machine("attic", { EP0CH_SOCKET: join(root, "attic", "no-host.sock") });
    const s = readBackupState(attic.state);
    s.outlines.recipes = { seq: 4, at: iso(T0) };
    const said: string[] = [];
    expect(await snapshot(attic, s, { now: () => T0, say: l => said.push(l) })).toEqual({ uploaded: [], failed: ["recipes", "(the outline host)"], relayed: [] });
    expect(said.join("\n")).toMatch(/the outline host doesn't answer at .*no-host\.sock.*start it: (systemctl --user start outliner-host\.service|launchctl kickstart)/);
    expect(s.outlines.recipes).toMatchObject({ seq: 4, pendingSince: iso(T0) });
  });

  test("with no host answering on a first run (no outlines known yet), the run still fails: never a silent green", async () => {
    const cellar = machine("cellar", { EP0CH_SOCKET: join(root, "cellar", "no-host.sock") });
    const s = readBackupState(cellar.state);
    const r = await snapshot(cellar, s, { now: () => T0, say: () => {} });
    expect(r.failed.length).toBeGreaterThan(0);
    expect(s.host).toMatchObject({ failingSince: iso(T0), error: expect.stringContaining("doesn't answer") });
    // The whole run: not ok, no heartbeat, and the state says so.
    const beats: number[] = [];
    let now = T0;
    const run = await runAll(cellar, { now: () => now, announce: async () => {}, heartbeat: async () => { beats.push(now); }, drill: false });
    expect(run.ok).toBe(false);
    expect(beats).toEqual([]);
    expect(readBackupState(cellar.state).lastRun).toMatchObject({ ok: false, detail: expect.stringContaining("the outline host") });
    // Lasting, it is an incident with the command that starts the host.
    now = T0 + STALE_AFTER_MS + 60_000;
    const late = await runAll(cellar, { now: () => now, announce: async () => {}, heartbeat: async () => { beats.push(now); }, drill: false });
    expect(late.alert.incidents.map(i => i.key)).toEqual(["host:cellar"]);
    expect(late.alert.incidents[0]!.fix).toMatch(/systemctl --user start outliner-host\.service|launchctl kickstart/);
    expect(beats).toEqual([]);
    // `ep0ch backup snapshot` says it with its exit code too.
    const out: string[] = [];
    expect(await backupCommand(["backup", "snapshot"], { out: l => out.push(l), err: l => out.push(l) }, cellar.env)).toBe(1);
  });

  test("`ep0ch backup copy`: the host's copy, checked, to a new file; never over one", async () => {
    const mill = await served(machine("mill"));
    await write(mill, "flour", ["Rye", "Spelt", "Emmer"]);
    const out: string[] = [], err: string[] = [];
    const to = join(root, "mill-copies", "flour.sqlite");
    expect(await backupCommand(["backup", "copy", "flour", to], { out: l => out.push(l), err: l => err.push(l) }, mill.env)).toBe(0);
    expect(out.at(-1)).toMatch(/✓ flour \(change \d+, schema \d+, \d+ bytes\) → .*flour\.sqlite; integrity ok/);
    for (const note of ["Rye", "Spelt", "Emmer"]) expect(holds(to, note)).toBe(true);
    expect(await backupCommand(["backup", "copy", "flour", to], { out: l => out.push(l), err: l => err.push(l) }, mill.env)).toBe(1);
    expect(err.at(-1)).toContain("already exists; not overwritten");
  }, 60_000);
});

describe("install and doctor", () => {
  const facts = (o: Partial<BackupSetupFacts> = {}): BackupSetupFacts => ({
    platform: "linux", loaded: false, units: [{ path: "/fictional/home/.config/systemd/user/ep0ch-backup.service", want: `# ${UNIT_MARK}\nA`, have: null }, { path: "/fictional/home/.config/systemd/user/ep0ch-backup.timer", want: `# ${UNIT_MARK}\nB`, have: null }],
    config: { path: "/fictional/home/.config/ep0ch/backup.env", exists: false, machine: "garden-shed", named: true }, restic: "/fictional/bin/restic", groups: ["bucket", "restic"],
    secrets: ["bucket", "restic"], passwordInEnv: false, repo: "s3:https://example.invalid/restic/garden-shed", state: null, alert: null, stateDir: "/fictional/state/backup", ...o,
  });

  test("a new machine: the units and the settings written, the timer loaded", () => {
    const p = backupPlan(facts());
    expect(p.status).toBe("do");
    expect(p.writes.map(w => w.path)).toEqual([...facts().units.map(u => u.path), "/fictional/home/.config/ep0ch/backup.env"]);
    expect(p.writes.at(-1)!.text).toContain("EP0CH_BACKUP_MACHINE=garden-shed");
    expect(p.commands).toContain("systemctl --user restart ep0ch-backup.timer");
  });

  test("a machine not named yet: asked for in the plan, never taken from the host name silently", () => {
    const p = backupPlan(facts({ platform: "macos", config: { ...facts().config, machine: "my-macbook", named: false }, units: [{ path: "/fictional/LaunchAgents/io.ep0ch.backup.plist", want: "x", have: null }] }));
    expect(p).toMatchObject({ status: "manual", writes: [] });
    expect(p.why).toContain("EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply");
    expect(p.why).toContain("EP0CH_BACKUP_MIRRORS");
  });

  test("a machine renamed at install (EP0CH_BACKUP_MACHINE in the shell): the settings file is updated, since the job reads only the file", () => {
    const text = "# mine\nEP0CH_BACKUP_MACHINE=my-macbook\nEP0CH_BACKUP_MIRRORS=tower\n";
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const p = backupPlan(facts({ units, loaded: true, config: { ...facts().config, exists: true, machine: "laptop", named: true, kept: { EP0CH_BACKUP_MACHINE: "laptop" }, text } }));
    expect(p.status).toBe("do");
    expect(p.why).toContain("EP0CH_BACKUP_MACHINE my-macbook → laptop");
    expect(p.writes).toEqual([{ path: facts().config.path, text: "# mine\nEP0CH_BACKUP_MACHINE=laptop\nEP0CH_BACKUP_MIRRORS=tower\n" }]);
    // The file then names it: the job's config reads laptop, and nothing more to do.
    const home = join(root, "renamed-home");
    mkdirSync(join(home, ".config/ep0ch"), { recursive: true });
    writeFileSync(join(home, ".config/ep0ch/backup.env"), p.writes[0]!.text);
    expect(backupConfig({ HOME: home })).toMatchObject({ machine: "laptop", machineFrom: "file" });
    expect(backupPlan(facts({ units, loaded: true, config: { ...facts().config, exists: true, machine: "laptop", named: true, kept: {}, text: p.writes[0]!.text } })).status).toBe("skip");
  });

  test("a Mac's settings name float-2 as the gateway it pulls queued MCP writes from, unless its file names one or none (PIE-615)", () => {
    const mac = { platform: "macos" as const, units: [{ path: "/fictional/LaunchAgents/io.ep0ch.backup.plist", want: "x", have: "x" }], loaded: true };
    const text = "# ep0ch backups\nEP0CH_BACKUP_MACHINE=laptop\n";
    const p = backupPlan(facts({ ...mac, config: { ...facts().config, exists: true, machine: "laptop", text } }));
    expect(p).toMatchObject({ status: "do", writes: [{ path: facts().config.path, text: `${text}EP0CH_MCP_HUB=float-2\n` }] });
    expect(p.why).toContain("EP0CH_MCP_HUB=float-2");
    for (const kept of [`${text}EP0CH_MCP_HUB=other-hub\n`, `${text}EP0CH_MCP_HUB=\n`]) {
      expect(backupPlan(facts({ ...mac, config: { ...facts().config, exists: true, machine: "laptop", text: kept } })).status).toBe("skip");
    }
    // Not on Linux: float-2 is the gateway.
    expect(backupPlan(facts({ units: facts().units.map(u => ({ ...u, have: u.want })), loaded: true, config: { ...facts().config, exists: true, text: "EP0CH_BACKUP_MACHINE=garden-shed\n" } })).status).toBe("skip");
  });

  test("current and loaded: nothing to do", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const text = "# ep0ch backups\nEP0CH_BACKUP_MACHINE=garden-shed\n";
    expect(backupPlan(facts({ units, loaded: true, config: { ...facts().config, exists: true, text } })).status).toBe("skip");
    // An empty settings file is filled in.
    expect(backupPlan(facts({ units, loaded: true, config: { ...facts().config, exists: true, text: "" } })).writes.map(w => w.text)).toEqual([expect.stringContaining("EP0CH_BACKUP_MACHINE=garden-shed")]);
  });

  test("restic or a secret missing, or a unit of the person's own: said with the commands, nothing written", () => {
    const noRestic = backupPlan(facts({ restic: null, platform: "macos", units: [{ path: "/fictional/LaunchAgents/io.ep0ch.backup.plist", want: "x", have: null }] }));
    expect(noRestic).toMatchObject({ status: "manual", writes: [] });
    expect(noRestic.why).toContain("brew install restic");
    const noKey = backupPlan(facts({ groups: ["bucket"] }));
    expect(noKey.why).toContain("~/.config/secrets/restic.env");
    const theirs = backupPlan(facts({ units: [{ ...facts().units[0]!, have: "[Service]\nExecStart=/bin/true\n" }] }));
    expect(theirs.status).toBe("manual");
    expect(theirs.why).toContain("yours");
  });

  test("the templates in scripts/backup fill in to units that run this checkout's `ep0ch backup run`", () => {
    const repoRoot = join(import.meta.dir, "../../..");
    const [service, timer] = unitFiles({ platform: "linux", home: "/fictional/home", bun: "/fictional/bin/bun", main: "/fictional/ep0ch/packages/door/src/main.ts", repoRoot, env: {} });
    expect(service!.want).toContain("ExecStart=/fictional/bin/bun /fictional/ep0ch/packages/door/src/main.ts backup run");
    expect(service!.want).toContain(UNIT_MARK);
    expect(timer!.want).toContain("OnUnitInactiveSec=15min");
    const [plist] = unitFiles({ platform: "macos", home: "/fictional/home", bun: "/fictional/bin/bun", main: "/m.ts", repoRoot, env: {} });
    expect(plist!.want).toContain("<integer>900</integer>");
    expect(plist!.want).not.toContain("{{");
    expect(fill("{{A}} {{B}}", { A: "1" })).toBe("1 {{B}}");
    // Paths that need quoting: a space and a % in the checkout for systemd, an & for launchd.
    const [odd] = unitFiles({ platform: "linux", home: "/fictional/home", bun: "/fictional/bin/bun", main: "/fictional/my ep0ch/100%/main.ts", repoRoot, env: {} });
    expect(odd!.want).toContain('ExecStart=/fictional/bin/bun "/fictional/my ep0ch/100%%/main.ts" backup run');
    const [amp] = unitFiles({ platform: "macos", home: "/fictional/home", bun: "/fictional/bin/bun", main: "/fictional/R&D/main.ts", repoRoot, env: {} });
    expect(amp!.want).toContain("<string>/fictional/R&amp;D/main.ts</string>");
  });

  test("doctor: each outline's newest snapshot, an incident with its fix, the drill", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const now = Date.now();
    const checks = resticChecks(facts({ units, loaded: true, config: { ...facts().config, exists: true, text: "EP0CH_BACKUP_MACHINE=garden-shed\n" }, state: {
      outlines: { garden: { seq: 3, at: iso(now - 600_000) }, pantry: { seq: 1, at: iso(now - 5 * 3_600_000), pendingSince: iso(now - 3 * 3_600_000) } },
      lastRun: { at: iso(now - 300_000), ok: false, detail: "failed: pantry" }, drill: { at: iso(now - 86_400_000), ok: true, detail: "restored 2 outlines" },
    }, alert: { machine: "garden-shed", checkedAt: iso(now), announced: [], incidents: [{ key: "outline:garden-shed/pantry", title: "t", detail: "pantry changed", fix: "ep0ch backup run", since: iso(now) }] } }), now);
    expect(checks.map(c => [c.name, c.status])).toEqual([["restic job", "ok"], ["restic verdict", "missing"], ["restic last run", "missing"], ["restic garden", "ok"], ["restic pantry", "missing"], ["restore drill", "ok"], ["heartbeat", "info"], ["push", "info"]]);
    expect(checks.find(c => c.name === "restic pantry")!.fix).toBe("ep0ch backup run");
  });

  test("doctor: a relayed backup says where it went and why, and is not a stale one", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const now = Date.now();
    const relayed = { via: "tool-shed", at: iso(now - 600_000), why: "Fatal: unable to open config file: context canceled", uploaded: true };
    const state = { outlines: { garden: { seq: 4, at: iso(now - 600_000), relayed } }, lastRun: { at: iso(now - 300_000), ok: true, detail: "relayed garden via tool-shed" } };
    const check = (st: typeof state) => resticChecks(facts({ units, loaded: true, state: st }), now).find(c => c.name === "restic garden");
    expect(check(state)).toMatchObject({ status: "ok", detail: expect.stringContaining("relayed via tool-shed because ") });
    const stuck = { ...state, outlines: { garden: { ...state.outlines.garden, relayed: { ...relayed, uploaded: false, uploadError: "no route" } } } };
    expect(check(stuck)?.detail).toContain("tool-shed couldn't upload it either (no route)");
  });

  test("doctor: a machine that names a gateway hub says so before its first pull, and says the pull once there is one", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const now = Date.now();
    const state = { outlines: {}, lastRun: { at: iso(now - 300_000), ok: true, detail: "ok" } };
    const config = { ...facts().config, exists: true, text: "EP0CH_BACKUP_MACHINE=garden-shed\nEP0CH_MCP_HUB=tool-shed\n" };
    const before = resticChecks(facts({ units, loaded: true, config, state }), now).find(c => c.name === "netmail from tool-shed");
    expect(before).toMatchObject({ status: "info", detail: expect.stringContaining("no pull recorded yet"), fix: "ep0ch mcp pull" });
    const pulled = resticChecks(facts({ units, loaded: true, config, state: { ...state, netmail: { pull: { hub: "tool-shed", at: iso(now - 60_000), ok: true, detail: "nothing queued" } } } }), now);
    expect(pulled.find(c => c.name === "netmail from tool-shed")).toMatchObject({ status: "ok", detail: expect.stringContaining("nothing queued") });
    // No hub named: no netmail line at all.
    expect(resticChecks(facts({ units, loaded: true, config: { ...config, text: "EP0CH_BACKUP_MACHINE=garden-shed\n" }, state }), now).some(c => c.name.startsWith("netmail"))).toBe(false);
  });
});

describe.skipIf(!outliner)("the door's status bar", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, key: (k: Key) => void = () => {};
  const was = process.env.EP0CH_STATE;
  afterAll(async () => { app?.quit(); board?.close(); await scratch.stop(); if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; });

  test("a stale backup is marked until it clears; a click (or backups.alert, an agent's too) says what and the fix", async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    writeAlert(join(scratch.root, "door", "backup"), { machine: "laptop", checkedAt: new Date().toISOString(), announced: ["outline:laptop/garden"],
      incidents: [{ key: "outline:laptop/garden", title: "garden on laptop: backup stale", detail: "garden changed since 09:00Z and the newest backup is 3h old", fix: "ep0ch backup run", since: new Date().toISOString() }] });
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: (k: Key) => void) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    const A = app as any;
    const bar = () => A.statusBar(A.stack.at(-1), 160).replace(/\x1b\[[0-9;]*m/g, "");
    expect(bar()).toContain("✗ backup │");
    const at = ((await app.dispatch.act({ action: "status.bar.items" }, { kind: "user" })) as { items: { id: string; from?: number }[] }).items.find(i => i.id === "backup")!;
    key({ kind: "mouse", action: "down", button: 0, x: at.from!, y: 39 });
    await Bun.sleep(20);
    expect(A.message).toContain("garden changed since 09:00Z");
    expect(A.message).toContain("fix: ep0ch backup run");
    expect(await app.act({ action: "backups.alert", as: "helper" })).toEqual({ alert: "garden changed since 09:00Z and the newest backup is 3h old · fix: ep0ch backup run" });
    // Cleared: the mark goes with the next read (once a minute).
    writeAlert(join(scratch.root, "door", "backup"), { machine: "laptop", checkedAt: new Date().toISOString(), announced: [], incidents: [] });
    A.backupRead.at = -Infinity;
    expect(bar()).not.toContain("✗ backup");
  }, 30_000);
});
