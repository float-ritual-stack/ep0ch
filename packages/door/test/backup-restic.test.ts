// The restic backup job (PIE-607): change-gated snapshots, mirrors refreshed from another machine's repository, the
// staleness alert (announced once), the restore and the drill, install's plan for the units, and the door's mark.
// Scratch outlines (fictional notes) and local restic repositories in a temp folder only: no bucket, no real outline,
// no real unit. The restic parts are skipped where restic isn't installed.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alertMark, type BackupState, CHECK_LATE_MS, incidents, nextAlert, readAlert, readBackupState, STALE_AFTER_MS } from "../src/backup/alert";
import { backupConfig, type BackupConfig, parseEnvFile, parseMirrors } from "../src/backup/config";
import { backupCommand, parseAt, pick } from "../src/backup/cli";
import { changeSeq, followersOf, mirror, newer, runAll, snapshot, takeLock } from "../src/backup/jobs";
import { parseSnapshots, resticArgv, summaryId } from "../src/backup/restic";
import { backupPlan, type BackupSetupFacts, fill, resticChecks, UNIT_MARK, unitFiles } from "../src/backup/setup";
import { App } from "../src/app";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { writeAlert } from "../src/backup/alert";
import { outliner, Scratch, scratchDir } from "./scratch";

const root = scratchDir("ep0ch-restic-test-");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const RESTIC = Bun.which("restic") ?? (existsSync(`${process.env.HOME}/.local/bin/restic`) ? `${process.env.HOME}/.local/bin/restic` : null);
const CMD = { run: "ep0ch backup run", log: "journalctl --user -u ep0ch-backup -n 50" };
const T0 = Date.parse("2026-05-02T09:00:00Z");
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
    expect(parseSnapshots(JSON.stringify(rows))).toEqual([{ id: "aa", time: "2026-05-02T09:00:00Z", outline: "garden", seq: 12, host: "laptop" }]);
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
    expect(found[0]!.detail).toContain("connection reset");
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

  test("newer wins: by change, else by time", () => {
    expect(newer({ seq: 5 }, { seq: 4 })).toBe(true);
    expect(newer({ seq: 4 }, { seq: 4 })).toBe(false);
    expect(newer({ seq: null, at: "2026-05-02" }, { seq: 3, at: "2026-05-01" })).toBe(true);
  });
});

describe.skipIf(!RESTIC)("snapshots, mirrors and restores against a local restic repository", () => {
  const laptop = machine("laptop");
  const said: string[] = [];
  const say = (s: string) => said.push(s);

  test("only outlines that changed are snapshotted", async () => {
    outline(join(laptop.outlines, "garden.sqlite"), ["Plant the tomatoes", "Water the beans"]);
    outline(join(laptop.outlines, "pantry.sqlite"), ["Flour"]);
    writeFileSync(join(laptop.outlines, "garden.sqlite.owner.sqlite"), "");   // the host's side file isn't an outline
    const s = readBackupState(laptop.state);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden", "pantry"], failed: [] });
    expect(s.outlines.garden).toMatchObject({ seq: 2 });
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: [], failed: [] });
    // Another repository starts every outline over: nothing counts as backed up there.
    const elsewhere = { ...laptop, repoOf: (m: string) => join(root, "repos-other", m) };
    expect((await snapshot(elsewhere, { ...s, outlines: { ...s.outlines } }, { say })).uploaded).toEqual(["garden", "pantry"]);
    outline(join(laptop.outlines, "garden.sqlite"), ["Stake the peas"]);
    expect(await snapshot(laptop, s, { say })).toEqual({ uploaded: ["garden"], failed: [] });
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
    // A newer copy here (from sqlite3_rsync) isn't replaced by an older snapshot.
    s.mirrors["laptop/garden"] = { ...s.mirrors["laptop/garden"], seq: 99, source: "rsync", snapshot: undefined };
    await mirror(tower, s, { say, follower: async () => false });
    expect(s.mirrors["laptop/garden"]!.seq).toBe(99);
  }, 120_000);

  test("a machine with no backups yet is nothing wrong here: said, never an incident", async () => {
    const porch = machine("porch", { EP0CH_BACKUP_MIRRORS: "attic-box" });
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
    const shed = machine("shed", { EP0CH_RESTIC: offline });
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
    expect(late.alert.incidents[0]!.detail).toContain("connection reset by peer");
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
    expect(p.commands).toContain("systemctl --user enable --now ep0ch-backup.timer");
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
    expect(checks.map(c => [c.name, c.status])).toEqual([["restic job", "ok"], ["restic last run", "missing"], ["restic garden", "ok"], ["restic pantry", "missing"], ["restore drill", "ok"], ["heartbeat", "info"], ["push", "info"]]);
    expect(checks.find(c => c.name === "restic pantry")!.fix).toBe("ep0ch backup run");
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
    const at = A.backupAt;
    key({ kind: "mouse", action: "down", button: 0, x: at.from, y: at.row });
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
