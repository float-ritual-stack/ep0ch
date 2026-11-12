// The restic backup job (PIE-607): change-gated snapshots, mirrors refreshed from another machine's repository, the
// staleness alert (announced once), the restore and the drill, install's plan for the units, and the door's mark.
// Scratch outlines (fictional notes) and local restic repositories in a temp folder only: no bucket, no real outline,
// no real unit. The restic parts are skipped where restic isn't installed.
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alertMark, type BackupState, CHECK_LATE_MS, incidents, nextAlert, readAlert, readBackupState, STALE_AFTER_MS } from "../src/backup/alert";
import { backupConfig, type BackupConfig, parseMirrors, RUN_LIMIT_MS } from "../src/backup/config";
import { backupCommand, parseAt, pick, statusLines } from "../src/backup/cli";
import { changeSeq, ensureRepo, followersOf, mirror, newer, runAll, schemaVersion, snapshot, snapshotNewer, takeLock } from "../src/backup/jobs";
import { forget, parseSnapshots, resticArgv, summaryId } from "../src/backup/restic";
import { verdict } from "../src/backup/verdict";
import { backupPlan, type BackupSetupFacts, fill, resticChecks, UNIT_MARK, unitFiles } from "../src/backup/setup";
import { App } from "../src/app";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
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
/** restic's exit code for a repository locked by another process. */
const LOCKED_EXIT = 11;
const CMD = { run: "ep0ch backup run", log: "journalctl --user -u ep0ch-backup -n 50" };
const T0 = Date.parse("2026-05-02T09:00:00Z");
/** One timer run (the whole job, as systemd starts it), with nothing pushed or pinged. */
const job = (c: BackupConfig, o: { now?: () => number; say?: (l: string) => void; deadline?: number } = {}) =>
  runAll(c, { drill: false, announce: async () => {}, heartbeat: async () => {}, ...o });
const iso = (t: number) => new Date(t).toISOString();

/** A scratch outline: blocks and a change feed, one change per block. */
function outline(path: string, blocks: string[]) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path);
  db.run("CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, text TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS change_feed (change_id INTEGER PRIMARY KEY AUTOINCREMENT, sequence INTEGER)");
  for (const b of blocks) { db.run("INSERT INTO blocks VALUES (?, ?)", [crypto.randomUUID(), b]); db.run("INSERT INTO change_feed (sequence) VALUES (1)"); }
  db.close();
}

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
    const rows = [{ id: "aa", time: "2026-05-02T09:00:00Z", paths: ["/garden.sqlite"], tags: ["ep0ch-outline", "outline=garden", "seq=12"], hostname: "laptop" },
      { id: "bb", time: "2026-05-02T09:00:00Z", paths: ["/home"], tags: ["nightly"] }];
    expect(parseSnapshots(JSON.stringify(rows))).toEqual([{ id: "aa", time: "2026-05-02T09:00:00Z", outline: "garden", seq: 12, schema: null, host: "laptop" }]);
    // A tag naming a path is no outline: its name becomes a file name.
    expect(parseSnapshots(JSON.stringify([{ ...rows[0], tags: ["ep0ch-outline", "outline=../../etc/x"] }]))).toEqual([]);
    expect(summaryId('{"message_type":"status"}\n{"message_type":"summary","snapshot_id":"cafe"}\n')).toBe("cafe");
    expect(parseAt("3h", T0)).toBe(T0 - 3 * 3_600_000);
    expect(parseAt("2026-05-01 08:00", T0)).toBe(Date.parse("2026-05-01T08:00"));
    const snaps = [{ id: "1", time: "2026-05-01T08:00:00Z", outline: "g", seq: 1, host: "" }, { id: "2", time: "2026-05-02T08:00:00Z", outline: "g", seq: 2, host: "" }];
    expect(pick(snaps, null)?.id).toBe("2");
    expect(pick(snaps, Date.parse("2026-05-01T12:00:00Z"))?.id).toBe("1");
    expect(pick(snaps, Date.parse("2026-04-01T00:00:00Z"))).toBeNull();
  });
});

describe("the alert", () => {
  const state = (o: Partial<BackupState>): BackupState => ({ outlines: {}, mirrors: {}, ...o });

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

  test("a mirror behind, another machine's unbacked changes, a failed drill", () => {
    const s = state({ mirrors: {
      "laptop/garden": { behindSince: iso(T0 - 3 * 3_600_000), error: "restoring: integrity" },
      "laptop/pantry": { remoteSeq: 40, seq: 30, at: iso(T0 - 6 * 3_600_000), pendingSince: iso(T0 - 3 * 3_600_000) },
    }, drill: { at: iso(T0), ok: false, detail: "garden FAILED" } });
    expect(incidents(s, "float", T0, CMD).map(i => i.key)).toEqual(["mirror:laptop/garden", "pending:laptop/pantry", "drill:float"]);
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

  test("the Litestream follower that writes a mirror: a template unit's instance for the outline", () => {
    const units = [{ kind: "systemd" as const, name: "litestream-mirror@.service", role: "follow", output: "/u/outline-mirrors/laptop/%i.sqlite" },
      { kind: "systemd" as const, name: "litestream.service", role: "replicate" }];
    expect(followersOf(units, "/u/outline-mirrors/laptop/garden.sqlite")).toEqual(["litestream-mirror@garden.service"]);
    expect(followersOf(units, "/u/outline-mirrors/tower/garden.sqlite")).toEqual([]);
  });

  test("another machine's backups unreadable for 2 hours is an incident of its own", () => {
    const s = state({ sources: { laptop: { failingSince: iso(T0 - 3 * 3_600_000), error: "Fatal: wrong password" } } });
    expect(incidents(s, "float", T0, CMD).map(i => i.key)).toEqual(["source:laptop"]);
  });

  test("a Litestream replicator a change stopped and that won't start again is an incident, with the command that starts it", () => {
    const guard = [{ unit: "litestream.service", since: iso(T0 - 600_000), failedAt: iso(T0 - 60_000), error: "Unit is masked", attempts: 3, fix: "systemctl --user start litestream.service" }];
    const found = incidents(state({ guard }), "float", T0, CMD);
    expect(found.map(i => i.key)).toEqual(["guard:float/litestream.service"]);
    expect(found[0]).toMatchObject({ fix: "systemctl --user start litestream.service" });
    expect(found[0]!.detail).toContain("failed 3 times");
  });

  test("forget failing once is a live lock the next run waits out; twice in a row is an incident, said in status (PIE-1755)", () => {
    const error = "repository is already locked by PID 4242 on potting-shed by gardener (UID 1000, GID 1000), lock was created at 2026-05-02 08:40:00 (20m ago)";
    const once = state({ forget: { at: iso(T0), ok: false, failures: 1, since: iso(T0), error } });
    expect(incidents(once, "float", T0, CMD)).toEqual([]);
    const twice = state({ forget: { at: iso(T0 + 900_000), ok: false, failures: 2, since: iso(T0), error } });
    const found = incidents(twice, "float", T0 + 900_000, CMD);
    expect(found.map(i => i.key)).toEqual(["forget:float"]);
    expect(found[0]!.detail).toContain("failed 2 runs in a row");
    expect(found[0]!.detail).toContain("PID 4242 on potting-shed");
    const v = verdict(twice, { machine: "float", checkedAt: iso(T0 + 900_000), incidents: found, announced: [] }, T0 + 900_000, { machine: "float", repo: "/fictional/repo" });
    expect(v.level).toBe("bad");
    expect(v.problems[0]!.text).toContain("old backups on float aren't pruned");
    expect(incidents(state({ forget: { at: iso(T0), ok: true, failures: 0 } }), "float", T0, CMD)).toEqual([]);
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

  test("a snapshot with no change feed replaces an older mirror by its time, never a newer one", () => {
    const mirrored = { seq: null, at: "2026-05-02T10:00:00Z" };
    expect(snapshotNewer({ seq: null, time: "2026-05-02T11:00:00Z" }, mirrored)).toBe(true);
    expect(snapshotNewer({ seq: null, time: "2026-05-02T09:00:00Z" }, mirrored)).toBe(false);
    expect(snapshotNewer({ seq: 4, time: "2026-05-02T09:00:00Z" }, { seq: 3, at: "2026-05-02T10:00:00Z" })).toBe(true);
  });

  test("newer wins: by change, else by time", () => {
    expect(newer({ seq: 5 }, { seq: 4 })).toBe(true);
    expect(newer({ seq: 4 }, { seq: 4 })).toBe(false);
    expect(newer({ seq: null, at: "2026-05-02" }, { seq: 3, at: "2026-05-01" })).toBe(true);
  });
});

describe.skipIf(!RESTIC)("snapshots, mirrors and restores against a local restic repository", () => {
  const laptop = machine("laptop");
  const said: string[] = [];
  beforeAll(() => served(laptop));
  const say = (s: string) => said.push(s);

  test("only outlines that changed are snapshotted", async () => {
    outline(join(laptop.outlines, "garden.sqlite"), ["Plant the tomatoes", "Water the beans"]);
    outline(join(laptop.outlines, "pantry.sqlite"), ["Flour"]);
    writeFileSync(join(laptop.outlines, "garden.sqlite.owner.sqlite"), "");   // the host's side file isn't an outline
    const s = readBackupState(laptop.state);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden", "pantry"], failed: [], relayed: [] });
    expect(s.outlines.garden).toMatchObject({ seq: 2 });
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: [], failed: [], relayed: [] });
    // Another repository starts every outline over: nothing counts as backed up there.
    const elsewhere = { ...laptop, repoOf: (m: string) => join(root, "repos-other", m) };
    expect((await snapshot(elsewhere, { ...s, outlines: { ...s.outlines } }, { say })).uploaded).toEqual(["garden", "pantry"]);
    outline(join(laptop.outlines, "garden.sqlite"), ["Stake the peas"]);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden"], failed: [], relayed: [] });
    expect(s.outlines.garden).toMatchObject({ seq: 3 });
    expect(changeSeq(join(laptop.outlines, "garden.sqlite"))).toBe(3);
  }, 120_000);

  test("restore: the newest snapshot, integrity-checked, to a new file; never over an outline in use", async () => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    const env = laptop.env;
    const to = join(root, "restored", "garden.sqlite");
    expect(await backupCommand(["backup", "restore", "garden", "--to", to], io, env)).toBe(0);
    const db = new Database(to, { readonly: true });
    expect((db.query("SELECT count(*) AS n FROM blocks").get() as { n: number }).n).toBe(3);
    db.close();
    expect(await backupCommand(["backup", "restore", "garden", "--to", to], io, env)).toBe(2);   // exists
    expect(await backupCommand(["backup", "restore", "garden", "--to", join(laptop.outlines, "garden-copy.sqlite")], io, env)).toBe(2);
    expect(err.at(-1)).toContain("a service has open");
    expect(await backupCommand(["backup", "restore", "garden", "--at", "2020-01-01T00:00:00Z", "--to", join(root, "restored", "old.sqlite")], io, env)).toBe(1);
    expect(await backupCommand(["backup", "list", "garden"], io, env)).toBe(0);
    expect(out.filter(l => /change \d/.test(l))).toHaveLength(2 + 1);   // two snapshots listed, one restore line
  }, 120_000);

  test("another machine's mirror: refreshed from its newest snapshot, beside a Litestream follower while one runs", async () => {
    const tower = machine("tower", { EP0CH_BACKUP_MIRRORS: "laptop" });
    const s = readBackupState(tower.state);
    await mirror(tower, s, { say, follower: async () => true });
    const shadow = join(tower.mirrorsDir, ".restic", "laptop", "garden.sqlite");
    expect(existsSync(shadow)).toBe(true);
    expect(existsSync(join(tower.mirrorsDir, "laptop", "garden.sqlite"))).toBe(false);
    // The follower is retired, its copy (change 9, newer than any snapshot) still there: it isn't rolled back.
    outline(join(tower.mirrorsDir, "laptop", "garden.sqlite"), Array.from({ length: 9 }, (_, i) => `Bed ${i}`));
    await mirror(tower, s, { say, follower: async () => false });
    expect(changeSeq(join(tower.mirrorsDir, "laptop", "garden.sqlite"))).toBe(9);
    expect(s.mirrors["laptop/garden"]).toMatchObject({ seq: 9, source: "found" });
    // An older copy there (Litestream's, behind) is replaced; Litestream's leftovers beside it go.
    rmSync(join(tower.mirrorsDir, "laptop"), { recursive: true });
    delete s.mirrors["laptop/garden"];
    outline(join(tower.mirrorsDir, "laptop", "garden.sqlite"), ["Bed 1"]);
    writeFileSync(join(tower.mirrorsDir, "laptop", "garden.sqlite-txid"), "00000000000000a0");
    await mirror(tower, s, { say, follower: async () => false });
    const real = join(tower.mirrorsDir, "laptop", "garden.sqlite");
    expect(changeSeq(real)).toBe(3);
    expect(existsSync(`${real}-txid`)).toBe(false);
    expect(s.mirrors["laptop/garden"]).toMatchObject({ seq: 3, source: "restic", folder: join(tower.mirrorsDir, "laptop") });
    // The laptop showed change 3 over ssh once; the snapshot holds it, so nothing is pending, ssh or not.
    s.mirrors["laptop/garden"]!.remoteSeq = 3; s.mirrors["laptop/garden"]!.pendingSince = iso(T0);
    await mirror(tower, s, { say, follower: async () => false });
    expect(s.mirrors["laptop/garden"]!.pendingSince).toBeUndefined();
    // A newer copy here (a relayed one) isn't replaced by an older snapshot.
    s.mirrors["laptop/garden"] = { ...s.mirrors["laptop/garden"], seq: 99, source: "relay", snapshot: undefined };
    await mirror(tower, s, { say, follower: async () => false });
    expect(s.mirrors["laptop/garden"]!.seq).toBe(99);
  }, 120_000);

  test("a machine with no backups yet is nothing wrong here: said, never an incident", async () => {
    const porch = await served(machine("porch", { EP0CH_BACKUP_MIRRORS: "attic-box" }));
    const r = await runAll(porch, { now: () => T0, announce: async () => {}, heartbeat: async () => {}, drill: false });
    expect(r.ok).toBe(true);
    expect(readBackupState(porch.state).sources?.["attic-box"]).toEqual({ missing: true });
    const later = await runAll(porch, { now: () => T0 + 3 * STALE_AFTER_MS, announce: async () => {}, heartbeat: async () => {}, drill: false });
    expect(later.alert.incidents).toEqual([]);
  }, 120_000);

  test("a repository it can't reach: changes wait, then one alert (announced once) with the fix; it clears when the upload works", async () => {
    // restic that can't reach its repository (a VPN resetting connections), without restic's minutes of retries.
    const offline = join(root, "restic-offline.sh");
    writeFileSync(offline, "#!/bin/sh\necho 'Fatal: unable to open repository at s3:example.invalid: connection reset by peer' >&2\nexit 1\n", { mode: 0o755 });
    const shed = await served(machine("shed", { EP0CH_RESTIC: offline }));
    outline(join(shed.outlines, "garden.sqlite"), ["Sharpen the hoe"]);
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

  test("the drill restores every outline's newest snapshot and checks it", async () => {
    const out: string[] = [];
    const env = laptop.env;
    expect(await backupCommand(["backup", "drill"], { out: s => out.push(s), err: s => out.push(s) }, env)).toBe(0);
    expect(out.join("\n")).toMatch(/garden ok \(3 blocks/);
    expect(readBackupState(join(root, "laptop", "state", "backup")).drill?.ok).toBe(true);
  }, 120_000);

  test("`backup run` at a terminal: each step spins and ends with its time, as install's do; piped, the plain lines", async () => {
    const drawn: string[] = [], out: string[] = [], err: string[] = [];
    const terminal = { isTTY: true, columns: 100, write: (s: string) => { drawn.push(s); return true; } };
    const env = { ...laptop.env, TERM: "xterm-256color", EP0CH_PROGRAM_STATUS: "0" };
    outline(join(laptop.outlines, "garden.sqlite"), ["Net the brassicas"]);
    expect(await backupCommand(["backup", "run"], { out: s => out.push(s), err: s => err.push(s), terminal }, env)).toBe(0);
    const text = drawn.join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    expect(text).toContain("checking 2 outlines for changes");
    expect(text).toContain("garden: snapshotting (VACUUM INTO, by the host)");
    expect(text).toContain("garden: uploading to restic");
    expect(text).toMatch(/✓ garden \(change \d+\) → snapshot [0-9a-f]{8}/);
    expect(out).toEqual([]);
    // Piped (the timer's run): the lines as before, no steps drawn.
    const piped: string[] = [];
    expect(await backupCommand(["backup", "run"], { out: s => piped.push(s), err: s => err.push(s) }, env)).toBe(0);
    expect(piped.join("\n")).toContain("no outline changed since its newest snapshot");
  }, 120_000);
  test("a schema migration is a change: the outline is snapshotted again, tagged, and the mirror takes it at the same change", async () => {
    const home = await served(machine("harbor")), far = machine("dock", { EP0CH_BACKUP_MIRRORS: "harbor" });
    const path = join(home.outlines, "orchard.sqlite");
    outline(path, ["Prune the pears"]);
    const db = new Database(path); db.run("PRAGMA user_version = 3"); db.close();
    const s = readBackupState(home.state), t = readBackupState(far.state);
    expect((await snapshot(home, s, { say })).uploaded).toEqual(["orchard"]);
    expect(s.outlines.orchard).toMatchObject({ seq: 1, schema: 3 });
    await mirror(far, t, { say, follower: async () => false });
    const copy = join(far.mirrorsDir, "harbor", "orchard.sqlite");
    expect(schemaVersion(copy)).toBe(3);
    // Nothing changed: not snapshotted again.
    expect(await snapshot(home, s, { say })).toEqual({ uploaded: [], failed: [], relayed: [] });
    // The host migrates it (user_version moves, the change feed doesn't): that is a change.
    const moved = new Database(path); moved.run("PRAGMA user_version = 4"); moved.close();
    expect((await snapshot(home, s, { say })).uploaded).toEqual(["orchard"]);
    expect(s.outlines.orchard).toMatchObject({ seq: 1, schema: 4 });
    expect(parseSnapshots(JSON.stringify([{ id: "a", time: "2026-05-02T10:00:00Z", paths: ["/orchard.sqlite"], tags: ["ep0ch-outline", "outline=orchard", "seq=1", "schema=4"] }]))).toEqual([expect.objectContaining({ seq: 1, schema: 4 })]);
    // The mirror holds change 1 at schema 3, and the new snapshot is change 1 at schema 4: it replaces the copy.
    await mirror(far, t, { say, follower: async () => false });
    expect(schemaVersion(copy)).toBe(4);
    // An older snapshot never replaces a copy at a newer schema.
    const back = new Database(copy); back.run("PRAGMA user_version = 5"); back.close();
    t.mirrors["harbor/orchard"] = { ...t.mirrors["harbor/orchard"], snapshot: undefined, seq: 0 };
    await mirror(far, t, { say, follower: async () => false });
    expect(schemaVersion(copy)).toBe(5);
  }, 120_000);
});

describe.skipIf(!RESTIC)("retention clears a stale lock and says when it can't (PIE-1755)", () => {
  /** A restic process holding the repository's lock: an upload whose stdin never ends. */
  async function holder(c: BackupConfig) {
    const repo = c.repoOf(c.machine), locks = join(repo, "locks");
    const before = existsSync(locks) ? readdirSync(locks).length : 0;
    const p = Bun.spawn([RESTIC!, "-r", repo, "backup", "--stdin", "--stdin-filename", "held.sqlite", "--host", c.machine],
      { env: { ...c.env, RESTIC_PROGRESS_FPS: "0" } as Record<string, string>, stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 100 && !(existsSync(locks) && readdirSync(locks).length > before); i++) await Bun.sleep(100);
    if (readdirSync(locks).length !== before + 1) { p.kill(9); throw new Error(`restic took no lock in ${repo}`); }
    return p;
  }
  const locksOf = (c: BackupConfig) => readdirSync(join(c.repoOf(c.machine), "locks"));

  test("a lock left by a killed run is cleared by the next run, and forget runs", async () => {
    const c = await served(machine("allotment"));
    outline(join(c.outlines, "garden.sqlite"), ["Turn the compost"]);
    const said: string[] = [];
    await job(c, { say: l => said.push(l) });
    expect(readBackupState(c.state).forget).toMatchObject({ ok: true, failures: 0 });
    expect(readBackupState(c.state).prune).toMatchObject({ ok: true, failures: 0 });
    // A run killed mid-upload (a reboot, a deploy): its lock stays in the repository.
    const killed = await holder(c);
    killed.kill(9); await killed.exited;
    expect(locksOf(c)).toHaveLength(1);
    outline(join(c.outlines, "garden.sqlite"), ["Mulch the beds"]);
    said.splice(0);
    await job(c, { say: l => said.push(l) });
    expect(said.filter(l => /✓ garden/.test(l))).toHaveLength(1);
    expect(said.filter(l => /forget failed/.test(l))).toEqual([]);
    expect(locksOf(c)).toEqual([]);
    const told = said.filter(l => /stale restic lock|let go/.test(l));
    expect(told).toHaveLength(2);
    expect(told[0]).toStartWith(`cleared a stale restic lock (repository is already locked by PID ${killed.pid} on `);
    expect(told[1]).toBe("✓ old snapshots let go");
    const s = readBackupState(c.state);
    expect(s.forget).toMatchObject({ ok: true, failures: 0 });
    expect(s.forget?.cleared).toContain(`already locked by PID ${killed.pid}`);
  }, 120_000);

  test("a live process's lock stays: forget waits for it, then fails, and the lock is still there", async () => {
    const c = machine("cold-frame");
    expect(await ensureRepo(c, c.repoOf(c.machine), () => {})).toBeNull();
    const live = await holder(c);
    try {
      const r = await forget(c, c.repoOf(c.machine), { wait: "1s" });
      expect(r.code).toBe(LOCKED_EXIT);
      expect(r.cleared).toBeUndefined();
      expect(locksOf(c)).toHaveLength(1);
    } finally { live.stdin.end(); await live.exited; }   // its upload ends, and it lets go of its lock
  }, 120_000);

  test("forget failing two runs in a row is an incident in status and the alert; a run that forgets clears it", async () => {
    // restic whose forget meets a lock nobody can clear (a live restic on another machine), everything else real.
    const locked = join(root, "restic-locked.sh");
    writeFileSync(locked, `#!/bin/sh\nfor a in "$@"; do if [ "$a" = forget ]; then\n  echo 'unable to create lock in backend: repository is already locked by PID 4242 on potting-shed by gardener (UID 1000, GID 1000)' >&2\n  echo 'lock was created at 2026-05-02 08:40:00 (20m ago)' >&2\n  exit ${LOCKED_EXIT}\nfi; done\nexec ${RESTIC} "$@"\n`, { mode: 0o755 });
    const real = await served(machine("greenhouse"));
    const c = { ...real, restic: locked };
    const announced: string[] = [];
    const o = { drill: false, announce: async (i: { key: string }[]) => { announced.push(...i.map(x => x.key)); }, heartbeat: async () => {} };
    let now = T0;
    const run = async (cfg: BackupConfig, blocks: string[]) => { outline(join(cfg.outlines, "seeds.sqlite"), blocks); now += 900_000; return runAll(cfg, { ...o, now: () => now }); };
    expect((await run(c, ["Sow the chard"])).alert.incidents).toEqual([]);
    expect(readBackupState(c.state).forget).toMatchObject({ ok: false, failures: 1 });
    const second = await run(c, ["Thin the carrots"]);
    expect(second.ok).toBe(true);   // the snapshots landed
    expect(second.alert.incidents.map(i => i.key)).toEqual(["forget:greenhouse"]);
    expect(announced).toEqual(["forget:greenhouse"]);
    const status = statusLines(c, now).join("\n");
    expect(status).toContain("old backups on greenhouse aren't pruned");
    expect(status).toContain("PID 4242 on potting-shed");
    // The lock goes: the next run forgets, and the incident clears.
    const fixed = await run(real, ["Water the seedlings"]);
    expect(fixed.alert.incidents).toEqual([]);
    expect(readBackupState(c.state).forget).toMatchObject({ ok: true, failures: 0 });
    expect(statusLines(c, now).join("\n")).toContain("old snapshots let go");
  }, 120_000);
});

describe.skipIf(!RESTIC)("the prune finishes: forget every run, prune once a day in its own bounded step (PIE-1755)", () => {
  /**
   * restic, every call written down; its prune hangs past the job's limit (a month of backlog), dying the way restic
   * does, and first copies the job's state as it stands then (what a run stopped by systemd mid-prune leaves).
   */
  function slowPrune(name: string, state: string) {
    const log = join(root, `${name}-argv.log`), fake = join(root, `${name}-restic.sh`), seen = join(root, `${name}-state-at-prune.json`);
    writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${log}\nfor a in "$@"; do if [ "$a" = prune ]; then\n  cp ${join(state, "state.json")} ${seen}\n  echo 'goroutine 1 [running]:' >&2\n  echo '/usr/local/go/src/runtime/asm_amd64.s:1771' >&2\n  exec sleep 30\nfi; done\nexec ${RESTIC} "$@"\n`, { mode: 0o755 });
    return { fake, seen, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []).map(l => l.split(" ")) };
  }
  const orchard = async (name: string) => {
    const dir = join(root, name, "state", "backup");
    const slow = slowPrune(name, dir);
    const c = await served(machine(name, { EP0CH_RESTIC: slow.fake, EP0CH_BACKUP_PRUNE_MINUTES: "0.05" }));
    expect(c.state).toBe(dir);
    return { c, ...slow };
  };

  test("forget never carries --prune; a prune killed at its limit says so, and leaves the forget done", async () => {
    const { c, calls } = await orchard("orchard");
    const said: string[] = [];
    let now = T0;
    outline(join(c.outlines, "apples.sqlite"), ["Pick the russets"]);
    await job(c, { say: l => said.push(l), now: () => now });
    const forgets = calls().filter(a => a.includes("forget")), prunes = calls().filter(a => a.includes("prune"));
    expect(forgets.length).toBeGreaterThan(0);
    expect(forgets.filter(a => a.includes("--prune"))).toEqual([]);
    const s = readBackupState(c.state);
    expect(s.forget).toMatchObject({ ok: true, failures: 0 });
    // The prune, bounded so a backlog finishes over a few days rather than never.
    expect(prunes).toHaveLength(1);
    expect(prunes[0]).toContain("--max-repack-size");
    expect(s.prune).toMatchObject({ ok: false, failures: 1 });
    expect(s.prune?.error).toBe("timed out after 3s");
    expect(said.filter(l => /prune/.test(l))).toEqual(["restic prune failed (old snapshots are let go; the space comes back with the next prune): timed out after 3s"]);
    expect(s.lastPrune).toBeUndefined();
    // The next run soon after forgets again, and doesn't start the prune over.
    now += 900_000;
    outline(join(c.outlines, "apples.sqlite"), ["Store the bramleys"]);
    await job(c, { say: l => said.push(l), now: () => now });
    expect(calls().filter(a => a.includes("prune"))).toHaveLength(1);
    expect(calls().filter(a => a.includes("forget")).length).toBeGreaterThan(forgets.length);
  }, 120_000);

  test("the prune's attempt is saved before it starts: a run systemd stops mid-prune still counts, and waits its hours", async () => {
    const { c, seen } = await orchard("quince");
    outline(join(c.outlines, "quinces.sqlite"), ["Wrap the quinces"]);
    await job(c, { now: () => T0 });
    // What a run stopped at that moment leaves on disk: the attempt, as a failure, from when it began.
    const left = JSON.parse(readFileSync(seen, "utf8")) as BackupState;
    expect(left.prune).toMatchObject({ at: iso(T0), ok: false, failures: 1 });
    expect(left.prune?.error).toContain("stopped before it finished");
    // The next run starts from that state: within the hours it waits, no prune, and the count goes on from it.
    writeFileSync(join(c.state, "state.json"), JSON.stringify(left));
    const said: string[] = [];
    await job(c, { now: () => T0 + 900_000, say: l => said.push(l) });
    expect(said.filter(l => /prune/.test(l))).toEqual([]);
    expect(readBackupState(c.state).prune).toMatchObject({ at: iso(T0), failures: 1 });
  }, 120_000);

  test("a prune that wouldn't fit in what's left of the run's time waits for the next run", async () => {
    const { c, calls } = await orchard("medlar");
    outline(join(c.outlines, "medlars.sqlite"), ["Blet the medlars"]);
    const said: string[] = [];
    // systemd stops the run a minute from now: no room for a prune.
    await job(c, { now: () => T0, say: l => said.push(l), deadline: Date.now() + 60_000 });
    expect(calls().filter(a => a.includes("prune"))).toEqual([]);
    expect(said.some(l => /^· the prune waits for a run with time for it/.test(l))).toBe(true);
    expect(readBackupState(c.state).prune).toBeUndefined();
  }, 120_000);

  test("a quiet run (nothing changed) still retries a failed forget and runs a due prune", async () => {
    // restic whose forget fails while a flag file is there (a live lock elsewhere), everything else real.
    const flag = join(root, "pear-locked"), fake = join(root, "pear-restic.sh"), log = join(root, "pear-argv.log");
    writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${log}\nfor a in "$@"; do if [ "$a" = forget ] && [ -e ${flag} ]; then\n  echo 'unable to create lock in backend: repository is already locked by PID 4242 on potting-shed by gardener (UID 1000, GID 1000)' >&2\n  exit ${LOCKED_EXIT}\nfi; done\nexec ${RESTIC} "$@"\n`, { mode: 0o755 });
    writeFileSync(flag, "");
    const c = await served(machine("pear", { EP0CH_RESTIC: fake }));
    outline(join(c.outlines, "pears.sqlite"), ["Pick the conference pears"]);
    let now = T0;
    await job(c, { now: () => now });
    expect(readBackupState(c.state).forget).toMatchObject({ ok: false, failures: 1 });
    // Nothing changes; the next run forgets again, and the second failure is the incident.
    now += 900_000;
    const quiet = await job(c, { now: () => now });
    expect(readBackupState(c.state).forget).toMatchObject({ ok: false, failures: 2 });
    expect(quiet.alert.incidents.map(i => i.key)).toEqual(["forget:pear"]);
    // The lock goes; still nothing changes: the quiet run forgets, and the prune it owes runs too.
    rmSync(flag);
    now += 900_000;
    const said: string[] = [];
    await job(c, { now: () => now, say: l => said.push(l) });
    expect(said).toContain("✓ old snapshots let go");
    expect(said).toContain("✓ pruned: the space old snapshots held is freed");
    expect(readBackupState(c.state).lastPrune).toBe(iso(now));
  }, 120_000);

  test("an exclusive lock a hard-killed prune left doesn't stop the uploads: it's cleared and the upload goes", async () => {
    const c = await served(machine("damson"));
    expect(await ensureRepo(c, c.repoOf(c.machine), () => {})).toBeNull();
    // `restic key passwd` holds the repository exclusively while it waits for a password: killed, it leaves that lock.
    const repo = c.repoOf(c.machine);
    const p = Bun.spawn([RESTIC!, "-r", repo, "key", "passwd"], { env: { ...c.env, RESTIC_PROGRESS_FPS: "0" } as Record<string, string>, stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 100 && !readdirSync(join(repo, "locks")).length; i++) await Bun.sleep(100);
    p.kill(9); await p.exited;
    expect(readdirSync(join(repo, "locks"))).toHaveLength(1);
    outline(join(c.outlines, "damsons.sqlite"), ["Stone the damsons"]);
    const said: string[] = [];
    const r = await job(c, { now: () => T0, say: l => said.push(l) });
    expect(r.ok).toBe(true);
    expect(said.filter(l => /✓ damsons \(change/.test(l))).toHaveLength(1);
    expect(said.some(l => l.startsWith("cleared a stale restic lock"))).toBe(true);
  }, 120_000);

  test("a prune that finishes is once a day; two failed in a row is an incident", async () => {
    const c = await served(machine("vinery", { EP0CH_BACKUP_PRUNE_MINUTES: "5" }));
    let now = T0;
    const run = async (text: string) => { outline(join(c.outlines, "grapes.sqlite"), [text]); return job(c, { now: () => now }); };
    await run("Thin the bunches");
    expect(readBackupState(c.state).prune).toMatchObject({ ok: true, failures: 0 });
    expect(readBackupState(c.state).lastPrune).toBe(iso(T0));
    now += 3_600_000;
    await run("Net the vines");
    expect(readBackupState(c.state).prune?.at).toBe(iso(T0));   // not due yet
    const failing = { ...readBackupState(c.state), prune: { at: iso(T0), ok: false, failures: 2, since: iso(T0 - 4 * 3_600_000), error: "timed out after 40 min" } };
    expect(incidents(failing, "vinery", now, CMD).map(i => i.key)).toEqual(["prune:vinery"]);
    expect(incidents(failing, "vinery", now, CMD)[0]!.detail).toContain("timed out after 40 min");
  }, 120_000);

  test("the job's deadline is the unit's: systemd's TimeoutStartSec", () => {
    const unit = readFileSync(join(import.meta.dir, "../../../scripts/backup/ep0ch-backup.service"), "utf8");
    expect(Number(/^TimeoutStartSec=(\d+)min$/m.exec(unit)?.[1]) * 60_000).toBe(RUN_LIMIT_MS);
  });
});

describe.skipIf(!RESTIC)("only the host opens a live outline (PIE-1750)", () => {
  test("the job backs up what the host serves, though it can't see the outlines' folder: it opens no outline's file", async () => {
    // The host's folder, and a job whose own outlines folder holds nothing: every answer is the host's.
    const vault = await served(machine("vault"));
    outline(join(vault.outlines, "ledger.sqlite"), ["Seed money", "Fence posts"]);
    const job = machine("vault-job", { EP0CH_SOCKET: vault.host, EP0CH_BACKUP_MACHINE: "vault" });
    expect(job.outlines).not.toBe(vault.outlines);
    const s = readBackupState(job.state), said: string[] = [];
    expect(await snapshot(job, s, { say: l => said.push(l) })).toEqual({ uploaded: ["ledger"], failed: [], relayed: [] });
    expect(s.outlines.ledger).toMatchObject({ seq: 2 });
    const out: string[] = [];
    const to = join(root, "vault-restored", "ledger.sqlite");
    expect(await backupCommand(["backup", "restore", "ledger", "--to", to], { out: l => out.push(l), err: l => out.push(l) }, job.env)).toBe(0);
    expect(out.join("\n")).toContain("2 blocks");
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
    outline(join(mill.outlines, "flour.sqlite"), ["Rye", "Spelt", "Emmer"]);
    const out: string[] = [], err: string[] = [];
    const to = join(root, "mill-copies", "flour.sqlite");
    expect(await backupCommand(["backup", "copy", "flour", to], { out: l => out.push(l), err: l => err.push(l) }, mill.env)).toBe(0);
    expect(out.at(-1)).toMatch(/✓ flour \(change 3, schema 0, \d+ bytes\) → .*flour\.sqlite; integrity ok/);
    const db = new Database(to, { readonly: true });
    expect((db.query("SELECT count(*) AS n FROM blocks").get() as { n: number }).n).toBe(3);
    db.close();
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
      mirrors: {}, lastRun: { at: iso(now - 300_000), ok: false, detail: "failed: pantry" }, drill: { at: iso(now - 86_400_000), ok: true, detail: "restored 2 outlines" },
    }, alert: { machine: "garden-shed", checkedAt: iso(now), announced: [], incidents: [{ key: "outline:garden-shed/pantry", title: "t", detail: "pantry changed", fix: "ep0ch backup run", since: iso(now) }] } }), now);
    expect(checks.map(c => [c.name, c.status])).toEqual([["restic job", "ok"], ["restic verdict", "missing"], ["restic last run", "missing"], ["restic garden", "ok"], ["restic pantry", "missing"], ["restore drill", "ok"], ["heartbeat", "info"], ["push", "info"]]);
    expect(checks.find(c => c.name === "restic pantry")!.fix).toBe("ep0ch backup run");
  });

  test("doctor: a relayed backup says where it went and why, and is not a stale one", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const now = Date.now();
    const relayed = { via: "tool-shed", at: iso(now - 600_000), why: "Fatal: unable to open config file: context canceled", uploaded: true };
    const state = { outlines: { garden: { seq: 4, at: iso(now - 600_000), relayed } }, mirrors: {}, lastRun: { at: iso(now - 300_000), ok: true, detail: "relayed garden via tool-shed" } };
    const check = (st: typeof state) => resticChecks(facts({ units, loaded: true, state: st }), now).find(c => c.name === "restic garden");
    expect(check(state)).toMatchObject({ status: "ok", detail: expect.stringContaining("relayed via tool-shed because ") });
    const stuck = { ...state, outlines: { garden: { ...state.outlines.garden, relayed: { ...relayed, uploaded: false, uploadError: "no route" } } } };
    expect(check(stuck)?.detail).toContain("tool-shed couldn't upload it either (no route)");
  });

  test("doctor: a machine that names a gateway hub says so before its first pull, and says the pull once there is one", () => {
    const units = facts().units.map(u => ({ ...u, have: u.want }));
    const now = Date.now();
    const state = { outlines: {}, mirrors: {}, lastRun: { at: iso(now - 300_000), ok: true, detail: "ok" } };
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
