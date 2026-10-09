// The backup relay (PIE-645): a machine that can't reach its restic repository hands each snapshot to the hub over ssh,
// which verifies it, installs it as its mirror (never an older one) and uploads it on that machine's behalf.
// Scratch outlines (fictional notes), local restic repositories, and the outliner's fake ssh (the hub is a scratch HOME)
// in a temp folder only: no bucket, no real backup, no ~/outline-mirrors or ~/outlines. Skipped where restic isn't installed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { alertMark, readAlert, readBackupState, writeBackupState } from "../src/backup/alert";
import { backupConfig, type BackupConfig } from "../src/backup/config";
import { statusLines } from "../src/backup/cli";
import { changeSeq, runAll, schemaVersion, snapshot } from "../src/backup/jobs";
import { receive, unreachable } from "../src/backup/relay";
import { snapshots } from "../src/backup/restic";
import { outliner, scratchDir } from "./scratch";

const root = scratchDir("ep0ch-relay-test-");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const RESTIC = Bun.which("restic") ?? (existsSync(`${process.env.HOME}/.local/bin/restic`) ? `${process.env.HOME}/.local/bin/restic` : null);
const DOOR = resolve(import.meta.dir, "..");
const DOWN = async () => "objects.example.test doesn't answer (no reply in 8s)";
const REACHABLE = async () => null;

function outline(path: string, blocks: string[], schema = 3) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path);
  db.run("CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, text TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS change_feed (change_id INTEGER PRIMARY KEY AUTOINCREMENT, sequence INTEGER)");
  for (const b of blocks) { db.run("INSERT INTO blocks VALUES (?, ?)", [crypto.randomUUID(), b]); db.run("INSERT INTO change_feed (sequence) VALUES (1)"); }
  db.run(`PRAGMA user_version = ${schema}`);
  db.close();
}

describe.skipIf(!RESTIC || !outliner)("the relay through the hub", () => {
  const dir = join(root, "world");
  const hubEnv: Record<string, string> = {};
  let laptop: BackupConfig, hub: BackupConfig;
  const laptopEnv = (extra: Record<string, string> = {}) => ({
    HOME: join(dir, "laptop-home"), PATH: process.env.PATH!, EP0CH_OUTLINES: join(dir, "laptop-outlines"), EP0CH_STATE: join(dir, "laptop-state"),
    EP0CH_MCP_MIRROR_DIR: join(dir, "laptop-mirrors"), EP0CH_BACKUP_MACHINE: "laptop", EP0CH_BACKUP_REPO: join(dir, "repos", "{machine}"),
    RESTIC_PASSWORD: "fictional-test-password", EP0CH_RESTIC: RESTIC!, EP0CH_MCP_HUB: "hub-box", EP0CH_SSH: join(dir, "bin", "ssh"),
    FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"), FAKE_SSH_LOG: join(dir, "ssh.log"), ...extra,
  });
  const laptopWith = (extra: Record<string, string> = {}) => { const c = backupConfig(laptopEnv(extra)); if ("error" in c) throw new Error(c.error); return c; };
  const say = () => {};

  beforeAll(() => {
    mkdirSync(join(dir, "bin"), { recursive: true }); mkdirSync(join(dir, "hub-home"), { recursive: true }); mkdirSync(join(dir, "hub-outlines"), { recursive: true });
    Object.assign(hubEnv, {
      HOME: join(dir, "hub-home"), PATH: process.env.PATH!, EP0CH_OUTLINES: join(dir, "hub-outlines"), EP0CH_STATE: join(dir, "hub-state"),
      EP0CH_MCP_MIRROR_DIR: join(dir, "hub-mirrors"), EP0CH_BACKUP_MACHINE: "float-2", EP0CH_BACKUP_MIRRORS: "laptop", EP0CH_BACKUP_REPO: join(dir, "repos", "{machine}"),
      RESTIC_PASSWORD: "fictional-test-password", EP0CH_RESTIC: RESTIC!,
    });
    // A restic that fails as the laptop's does behind the work VPN.
    writeFileSync(join(dir, "bin", "restic-blocked"), "#!/bin/sh\necho 'Fatal: unable to open config file: context canceled' >&2\nexit 1\n");
    chmodSync(join(dir, "bin", "restic-blocked"), 0o755);
    writeFileSync(join(dir, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nexec env ${Object.entries(hubEnv).map(([k, v]) => `${k}='${v}'`).join(" ")} ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    chmodSync(join(dir, "bin", "ssh"), 0o755); chmodSync(join(dir, "bin", "ep0ch"), 0o755);
    laptop = laptopWith();
    const h = backupConfig(hubEnv); if ("error" in h) throw new Error(h.error); hub = h;
  });

  const hubCopy = () => join(hub.mirrorsDir, "laptop", "garden.sqlite");
  const hubSnaps = async () => { const l = await snapshots(hub, hub.repoOf("laptop"), { all: true }); return "error" in l ? [] : l; };

  test("a quick probe says when the repository's host doesn't answer", async () => {
    expect(await unreachable("/some/local/repo")).toBeNull();
    // Nothing listens on port 1 here: refused at once, a message that names the host.
    expect(await unreachable("s3:http://127.0.0.1:1/ep0ch/restic/laptop", 2000)).toContain("127.0.0.1:1 doesn't answer");
  });

  test("the repository is out of reach: the copy goes through the hub, which installs it and uploads it for the laptop", async () => {
    outline(join(laptop.outlines, "garden.sqlite"), ["Plant the tomatoes", "Water the beans"]);
    const s = readBackupState(laptop.state);
    const said: string[] = [];
    const r = await snapshot(laptop, s, { say: l => said.push(l), probe: DOWN });
    expect(r).toEqual({ uploaded: [], failed: [], relayed: ["garden"] });
    expect(s.outlines.garden).toMatchObject({ seq: 2, schema: 3, relayed: { via: "hub-box", uploaded: true, why: expect.stringContaining("doesn't answer") } });
    expect(s.outlines.garden!.pendingSince).toBeUndefined();
    expect(said.join("\n")).toContain("via hub-box");
    // The hub holds it as its mirror, checked, and made the snapshot in the laptop's repository under the laptop's name.
    expect(changeSeq(hubCopy())).toBe(2);
    expect(schemaVersion(hubCopy())).toBe(3);
    const snaps = await hubSnaps();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ outline: "garden", seq: 2, schema: 3, host: "laptop" });
    expect(readBackupState(hub.state).mirrors["laptop/garden"]).toMatchObject({ seq: 2, source: "relay" });
    // The incoming folder is private and left empty.
    expect(existsSync(join(hub.state, "incoming", "laptop", ".garden.sqlite.part-1"))).toBe(false);
    // Unchanged: nothing is sent again.
    expect(await snapshot(laptop, s, { say, probe: DOWN })).toEqual({ uploaded: [], failed: [], relayed: [] });
  }, 120_000);

  test("the whole job counts a relayed backup as fresh, and status says so", async () => {
    outline(join(laptop.outlines, "garden.sqlite"), ["Stake the peas"]);
    const t = Date.now();
    const run = await runAll(laptop, { say, probe: DOWN, drill: false, announce: async () => {}, heartbeat: async () => {} });
    expect(run.ok).toBe(true);
    expect(run.alert.incidents).toEqual([]);
    const s = readBackupState(laptop.state);
    expect(s.lastRun?.detail).toContain("relayed garden via hub-box");
    expect(alertMark(readAlert(laptop.state), t + 3 * 3_600_000)?.text ?? null).not.toBe("✗ backup");
    const lines = statusLines(laptop).join("\n");
    expect(lines).toContain("via hub-box");
    expect(lines).toContain("went through hub-box");
    expect(lines).toContain("didn't answer");
    expect(changeSeq(hubCopy())).toBe(3);
  }, 120_000);

  test("restic's own failure relays too, and a direct upload later clears the mark", async () => {
    outline(join(laptop.outlines, "garden.sqlite"), ["Prune the roses"]);
    const broken = laptopWith({ EP0CH_RESTIC: join(dir, "bin", "restic-blocked") });
    const s = readBackupState(laptop.state);
    const r = await snapshot(broken, s, { say, probe: REACHABLE });
    expect(r.relayed).toEqual(["garden"]);
    expect(s.outlines.garden!.relayed?.why).toBeTruthy();
    expect(changeSeq(hubCopy())).toBe(4);
    // The VPN is off again: the next change goes straight to the repository.
    s.repo = laptop.repoOf("laptop");
    outline(join(laptop.outlines, "garden.sqlite"), ["Mulch the beds"]);
    expect(await snapshot(laptop, s, { say, probe: REACHABLE })).toMatchObject({ uploaded: ["garden"], relayed: [] });
    expect(s.outlines.garden!.relayed).toBeUndefined();
  }, 120_000);

  test("the hub unreachable too: the outline fails, with both reasons, and nothing is installed", async () => {
    outline(join(laptop.outlines, "pantry.sqlite"), ["Flour"]);
    const down = laptopWith({ FAKE_SSH_DOWN: "1" });
    const s = readBackupState(laptop.state);
    const r = await snapshot(down, s, { say, probe: DOWN });
    expect(r.failed).toContain("pantry");
    expect(s.outlines.pantry!.error).toContain("relaying through hub-box failed");
    expect(s.outlines.pantry!.error).toContain("hub-box doesn't answer over ssh");
    expect(existsSync(join(hub.mirrorsDir, "laptop", "pantry.sqlite"))).toBe(false);
    expect(s.outlines.pantry!.pendingSince).toBeTruthy();
  }, 120_000);

  test("no hub named: the repository's failure fails the outline, as before", async () => {
    outline(join(laptop.outlines, "attic.sqlite"), ["Maps"]);
    const alone = laptopWith({ EP0CH_MCP_HUB: "", EP0CH_RESTIC: join(dir, "bin", "restic-blocked") });
    expect(alone.hub).toBeUndefined();
    const s = readBackupState(alone.state);
    const r = await snapshot(alone, s, { say, probe: DOWN });
    expect(r.relayed).toEqual([]);
    expect(r.failed).toContain("attic");
  }, 120_000);

  test("the hub never installs an older copy over a newer one, and says so", async () => {
    const part = join(dir, "part.sqlite");
    const make = (blocks: string[], schema: number) => { rmSync(part, { force: true }); outline(part, blocks, schema); };
    const call = (seq: number | null, schema: number | null, sha?: string) => receive(hub, { machine: "laptop", outline: "garden", seq, schema, part, ...(sha ? { sha256: sha } : {}), lockWaitMs: 200 });
    const now = changeSeq(hubCopy())!;
    // An earlier change at the same schema: kept.
    make(["one"], 3);
    expect(await call(1, 3)).toMatchObject({ ok: true, mirror: "current" });
    expect(changeSeq(hubCopy())).toBe(now);
    // An older schema: kept, even at a later change.
    make(Array.from({ length: now + 5 }, (_, i) => `n${i}`), 2);
    expect(await call(now + 5, 2)).toMatchObject({ ok: true, mirror: "older" });
    expect(schemaVersion(hubCopy())).toBe(3);
    // A newer schema at the same change replaces it (a migration doesn't move the change feed).
    make(Array.from({ length: now }, (_, i) => `n${i}`), 4);
    expect(await call(now, 4)).toMatchObject({ ok: true, mirror: "installed" });
    expect(schemaVersion(hubCopy())).toBe(4);
  }, 120_000);

  test("a damaged or misdescribed copy is refused, and so is a machine the hub doesn't mirror", async () => {
    const part = join(dir, "bad.sqlite");
    outline(part, ["x"], 3);
    const r = (o: Partial<Parameters<typeof receive>[1]>) => receive(hub, { machine: "laptop", outline: "garden", seq: 1, schema: 3, part, lockWaitMs: 200, ...o });
    expect(await r({ sha256: "0".repeat(64) })).toMatchObject({ ok: false, error: expect.stringContaining("damaged") });
    expect(await r({ seq: 9 })).toMatchObject({ ok: false, error: expect.stringContaining("change 1, not the 9") });
    expect(await r({ schema: 5 })).toMatchObject({ ok: false, error: expect.stringContaining("schema 3, not the 5") });
    expect(await r({ machine: "stranger" })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't mirror stranger") });
    expect(await r({ machine: "float-2" })).toMatchObject({ ok: false });
    // A database with no change feed has no order to compare by: it never replaces a mirror.
    rmSync(part, { force: true });
    const bare = new Database(part); bare.run("CREATE TABLE blocks (id TEXT)"); bare.run("PRAGMA user_version = 3"); bare.close();
    const before = changeSeq(hubCopy());
    expect(await r({ seq: null })).toMatchObject({ ok: false, error: expect.stringContaining("no readable change feed") });
    expect(changeSeq(hubCopy())).toBe(before);
    writeFileSync(part, "not a database");
    expect(await r({})).toMatchObject({ ok: false, error: expect.stringContaining("integrity") });
  });

  test("a hub that can't upload still holds the copy, and the next run tries the repository again", async () => {
    outline(join(laptop.outlines, "cellar.sqlite"), ["Jam"]);
    // Float-2's view of the laptop's repository is a restic that can't reach it.
    const saved = hubEnv.EP0CH_RESTIC;
    hubEnv.EP0CH_RESTIC = join(dir, "bin", "restic-blocked");
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nexec env ${Object.entries(hubEnv).map(([k, v]) => `${k}='${v}'`).join(" ")} ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    try {
      const s = readBackupState(laptop.state);
      const r = await snapshot(laptop, s, { say, probe: DOWN });
      expect(r.relayed).toContain("cellar");
      expect(s.outlines.cellar!.relayed).toMatchObject({ uploaded: false, uploadError: expect.any(String) });
      expect(existsSync(join(hub.mirrorsDir, "laptop", "cellar.sqlite"))).toBe(true);
      writeBackupState(laptop.state, s);
      expect(statusLines(laptop).join("\n")).toContain("not in the repository yet");
    } finally {
      hubEnv.EP0CH_RESTIC = saved!;
      writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nexec env ${Object.entries(hubEnv).map(([k, v]) => `${k}='${v}'`).join(" ")} ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    }
    // Unchanged, but not uploaded anywhere: tried again, and now the repository takes it.
    const s = readBackupState(laptop.state);
    expect((await snapshot(laptop, s, { say, probe: REACHABLE })).uploaded).toContain("cellar");
    expect(s.outlines.cellar!.relayed).toBeUndefined();
  }, 120_000);
});
