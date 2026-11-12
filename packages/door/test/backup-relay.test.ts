// The backup relay (PIE-645, ADR 0009): a machine that can't reach its restic repository hands each outline's archived log
// to the hub over ssh, which adds what its own archive of it lacks (never over a log that differs) and uploads it on that
// machine's behalf. Scratch outlines (fictional notes), local restic repositories, and the outliner's fake ssh (the hub is
// a scratch HOME) in a temp folder only: no bucket, no real backup, no ~/outlines. Skipped where restic isn't installed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { alertMark, readAlert, readBackupState, writeBackupState } from "../src/backup/alert";
import { backupConfig, type BackupConfig } from "../src/backup/config";
import { statusLines } from "../src/backup/cli";
import { archiveRoot, runAll, snapshot } from "../src/backup/jobs";
import { receive, unreachable } from "../src/backup/relay";
import { snapshots } from "../src/backup/restic";
import { hostRequest, SocketBoard } from "../src/socket";
import { archivedCursor, archivedRanges } from "@ep0ch/outliner/log-archive";
import { outliner, scratchDir } from "./scratch";
import { OutlineHost } from "@ep0ch/outliner/outline-host";

const root = scratchDir("ep0ch-relay-test-");
let host: OutlineHost | undefined;
afterAll(async () => { await host?.close(); rmSync(root, { recursive: true, force: true }); });
const RESTIC = Bun.which("restic") ?? (existsSync(`${process.env.HOME}/.local/bin/restic`) ? `${process.env.HOME}/.local/bin/restic` : null);
const DOOR = resolve(import.meta.dir, "..");
const DOWN = async () => "objects.example.test doesn't answer (no reply in 8s)";
const REACHABLE = async () => null;

/** Notes written to one of the laptop's outlines, through its host (made on first use): what its job archives. */
async function write(socket: string, name: string, texts: string[]): Promise<void> {
  if (!(await hostRequest(socket, "outlines.list", {})).outlines.some(o => o.name === name)) await hostRequest(socket, "outlines.create", { name });
  const board = new SocketBoard(socket, 15_000, name);
  try { for (const text of texts) await board.request("create", { parentId: null, text, author: "user" }); } finally { board.close(); }
}

describe.skipIf(!RESTIC || !outliner)("the relay through the hub", () => {
  const dir = join(root, "world");
  const hubEnv: Record<string, string> = {};
  let laptop: BackupConfig, hub: BackupConfig;
  const laptopEnv = (extra: Record<string, string> = {}) => ({
    HOME: join(dir, "laptop-home"), PATH: process.env.PATH!, EP0CH_OUTLINES: join(dir, "laptop-outlines"), EP0CH_STATE: join(dir, "laptop-state"),
    EP0CH_MCP_MIRROR_DIR: join(dir, "laptop-mirrors"), EP0CH_BACKUP_MACHINE: "laptop", EP0CH_BACKUP_REPO: join(dir, "repos", "{machine}"),
    RESTIC_PASSWORD: "fictional-test-password", EP0CH_RESTIC: RESTIC!, EP0CH_MCP_HUB: "hub-box", EP0CH_SSH: join(dir, "bin", "ssh"),
    FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: join(dir, "hub-home"), FAKE_SSH_OUTLINES: join(dir, "hub-outlines"), FAKE_SSH_BIN: join(dir, "bin"), FAKE_SSH_LOG: join(dir, "ssh.log"), ...extra,
  });
  const laptopWith = (extra: Record<string, string> = {}) => { const c = backupConfig(laptopEnv(extra)); if ("error" in c) throw new Error(c.error); return c; };
  const say = () => {};

  beforeAll(async () => {
    // The laptop's outlines are its host's (PIE-1750): the job asks it for their changes and copies.
    mkdirSync(join(dir, "laptop-outlines"), { recursive: true });
    host = new OutlineHost({ outlinesFolder: join(dir, "laptop-outlines"), log: () => {} });
    await host.start();
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

  /** How far the hub's archive of one of the laptop's outlines is (the laptop's log id), or null. */
  const hubHolds = (outline: string) => { const st = readBackupState(laptop.state).outlines[outline]; return st?.logId ? archivedCursor(archiveRoot(hub, "laptop"), outline, st.logId)?.lsn ?? null : null; };
  const hubSnaps = async () => { const l = await snapshots(hub, hub.repoOf("laptop"), { all: true }); return "error" in l ? [] : l; };

  test("a quick probe says when the repository's host doesn't answer", async () => {
    expect(await unreachable("/some/local/repo")).toBeNull();
    // Nothing listens on port 1 here: refused at once, a message that names the host.
    expect(await unreachable("s3:http://127.0.0.1:1/ep0ch/restic/laptop", 2000)).toContain("127.0.0.1:1 doesn't answer");
  });

  test("the repository is out of reach: the log goes through the hub, which archives it and uploads it for the laptop", async () => {
    await write(laptop.host, "garden", ["Plant the tomatoes", "Water the beans"]);
    const s = readBackupState(laptop.state);
    const said: string[] = [];
    const r = await snapshot(laptop, s, { say: l => said.push(l), probe: DOWN, verbose: true });
    expect(r).toEqual({ uploaded: [], failed: [], relayed: ["garden"] });
    expect(said.join("\n")).toContain("garden: relayed via hub-box because ");
    expect(said.join("\n")).toContain("repository check: ");
    expect(s.outlines.garden).toMatchObject({ relayed: { via: "hub-box", uploaded: true } });
    expect(s.outlines.garden!.relayed!.why).toContain("doesn't answer");
    expect(s.outlines.garden!.pendingSince).toBeUndefined();
    expect(said.join("\n")).toContain("via hub-box");
    writeBackupState(laptop.state, s);
    const lsn = s.outlines.garden!.seq!;
    expect(lsn).toBeGreaterThan(0);
    // The hub holds the log as far as the laptop's archive, and made the snapshot in the laptop's repository under its name.
    expect(hubHolds("garden")).toBe(lsn);
    const snaps = await hubSnaps();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ outline: "garden", seq: lsn, host: "laptop" });
    // The incoming folder is private and left empty.
    expect(readdirSync(join(hub.state, "incoming", "laptop"))).toEqual([]);
    // Unchanged: nothing is sent again, and --verbose says so.
    const again: string[] = [];
    expect(await snapshot(laptop, s, { say: l => again.push(l), probe: DOWN, verbose: true })).toEqual({ uploaded: [], failed: [], relayed: [] });
    expect(again.join("\n")).toMatch(new RegExp(`garden: unchanged since entry ${lsn} \\(\\w{3} \\d+`));
    expect(await snapshot(laptop, s, { say, probe: DOWN })).toEqual({ uploaded: [], failed: [], relayed: [] });
  }, 120_000);

  test("the whole job counts a relayed backup as fresh, and status says so", async () => {
    await write(laptop.host, "garden", ["Stake the peas"]);
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
    expect(hubHolds("garden")).toBe(s.outlines.garden!.seq);
  }, 120_000);

  test("on the work VPN: the run says it went through the hub as status, the drill runs on the hub, and waits when the hub is out of reach too (PIE-810)", async () => {
    await write(laptop.host, "orchard", ["Prune the apples"]);
    const t = Date.now();
    const quiet = { say, probe: DOWN, drill: true, announce: async () => {}, heartbeat: async () => {} };
    const run = await runAll(laptop, quiet);
    expect(run.alert.incidents).toEqual([]);
    const s = readBackupState(laptop.state);
    expect(s.route).toMatchObject({ via: "hub-box", why: expect.stringContaining("doesn't answer") });
    // The drill ran on the hub, from the laptop's repository, which the hub can reach.
    const drilled = { ...s.drill! };
    expect([drilled.ok, drilled.via]).toEqual([true, "hub-box"]);
    expect(drilled.detail).toContain("through hub-box");
    expect(drilled.detail).toContain("orchard ok");
    // Status, not a problem: the status bar's mark is quiet, and doctor's verdict says the route.
    expect(alertMark(readAlert(laptop.state), t)).toMatchObject({ text: "→ backup", status: true, say: expect.stringContaining("repository unreachable (work VPN?): sent through hub-box") });
    expect(statusLines(laptop).join("\n")).toContain("✓ all backed up · repository unreachable (work VPN?): sent through hub-box");
    // The hub out of reach too: the drill waits, said, and the last one stands; it isn't an incident.
    const down = laptopWith({ FAKE_SSH_DOWN: "1" });
    const after = await runAll(down, quiet);
    expect(after.alert.incidents).toEqual([]);
    const waited = readBackupState(laptop.state);
    expect(waited.drill).toEqual(drilled);
    expect(waited.drillWaiting?.why).toContain("hub-box doesn't answer over ssh");
    // The next run retries the waiting drill: the hub answering again, it runs there.
    await runAll(laptop, { ...quiet, drill: undefined });
    expect(readBackupState(laptop.state).drillWaiting).toBeUndefined();
    // A direct upload ends the long way round: the route and the mark go.
    await write(laptop.host, "orchard", ["Pick the pears"]);
    await runAll(laptop, { ...quiet, probe: REACHABLE, drill: false });
    expect(readBackupState(laptop.state).route).toBeUndefined();
    expect(alertMark(readAlert(laptop.state), Date.now())).toBeNull();
  }, 240_000);

  test("restic's own failure relays too, and a direct upload later clears the mark", async () => {
    await write(laptop.host, "garden", ["Prune the roses"]);
    const broken = laptopWith({ EP0CH_RESTIC: join(dir, "bin", "restic-blocked") });
    const s = readBackupState(laptop.state);
    const r = await snapshot(broken, s, { say, probe: REACHABLE });
    expect(r.relayed).toEqual(["garden"]);
    expect(s.outlines.garden!.relayed?.why).toBeTruthy();
    expect(hubHolds("garden")).toBe(s.outlines.garden!.seq);
    // The VPN is off again: the next change goes straight to the repository.
    s.repo = laptop.repoOf("laptop");
    await write(laptop.host, "garden", ["Mulch the beds"]);
    expect(await snapshot(laptop, s, { say, probe: REACHABLE })).toMatchObject({ uploaded: ["garden"], relayed: [] });
    expect(s.outlines.garden!.relayed).toBeUndefined();
  }, 120_000);

  test("the hub unreachable too: the outline fails, with both reasons, and the hub holds nothing of it", async () => {
    await write(laptop.host, "pantry", ["Flour"]);
    const down = laptopWith({ FAKE_SSH_DOWN: "1" });
    const s = readBackupState(laptop.state);
    const r = await snapshot(down, s, { say, probe: DOWN });
    expect(r.failed).toContain("pantry");
    expect(s.outlines.pantry!.error).toContain("relaying through hub-box failed");
    expect(s.outlines.pantry!.error).toContain("hub-box doesn't answer over ssh");
    expect(existsSync(join(archiveRoot(hub, "laptop"), "pantry"))).toBe(false);
    expect(s.outlines.pantry!.pendingSince).toBeTruthy();
  }, 120_000);

  test("no hub named: the repository's failure fails the outline, as before", async () => {
    await write(laptop.host, "attic", ["Maps"]);
    const alone = laptopWith({ EP0CH_MCP_HUB: "", EP0CH_RESTIC: join(dir, "bin", "restic-blocked") });
    expect(alone.hub).toBeUndefined();
    const s = readBackupState(alone.state);
    const r = await snapshot(alone, s, { say, probe: DOWN });
    expect(r.relayed).toEqual([]);
    expect(r.failed).toContain("attic");
  }, 120_000);

  test("a log that differs from the hub's archive is refused, and the archive is left as it was", async () => {
    const logId = readBackupState(laptop.state).outlines.garden!.logId!;
    const held = hubHolds("garden")!;
    const ranges = archivedRanges(archiveRoot(laptop, "laptop"), "garden", logId);
    const part = join(dir, "differs.jsonl");
    const call = () => receive(hub, { machine: "laptop", outline: "garden", part, lockWaitMs: 200 });
    // The same log, with the newest entry the hub holds written otherwise.
    const changed = ranges.map(r => ({ ...r, entries: r.entries.map(e => e.lsn === held ? { ...e, row: (e.row ?? "{}").replace("}", ', "x": 1}') } : e) }));
    writeFileSync(part, changed.map(r => JSON.stringify(r)).join("\n") + "\n");
    expect(await call()).toMatchObject({ ok: false, error: expect.stringContaining("differs from its archive") });
    // Entries of another log that don't start at its genesis follow nothing the hub holds.
    const other = ranges.slice(-1).map(r => ({ ...r, logId: "00000000-0000-4000-8000-000000000000", entries: r.entries.filter(e => e.op !== "g") }));
    writeFileSync(part, other.map(r => JSON.stringify(r)).join("\n") + "\n");
    expect(await call()).toMatchObject({ ok: false, error: expect.stringContaining("don't follow") });
    expect(hubHolds("garden")).toBe(held);
    // The log as it is: nothing new, taken as it stands.
    writeFileSync(part, ranges.map(r => JSON.stringify(r)).join("\n") + "\n");
    expect(await call()).toMatchObject({ ok: true, lsn: held });
  }, 120_000);

  test("a damaged or misdescribed log is refused, and so is the hub's own name", async () => {
    const part = join(dir, "bad.jsonl");
    const logId = readBackupState(laptop.state).outlines.garden!.logId!;
    const ranges = archivedRanges(archiveRoot(laptop, "laptop"), "garden", logId);
    writeFileSync(part, ranges.map(r => JSON.stringify(r)).join("\n") + "\n");
    const r = (o: Partial<Parameters<typeof receive>[1]>) => receive(hub, { machine: "laptop", outline: "garden", part, lockWaitMs: 200, ...o });
    expect(await r({ sha256: "0".repeat(64) })).toMatchObject({ ok: false, error: expect.stringContaining("damaged") });
    expect(await r({ machine: "float-2" })).toMatchObject({ ok: false });
    expect(await r({ outline: "../garden" })).toMatchObject({ ok: false, error: expect.stringContaining("isn't an outline name") });
    writeFileSync(part, [ranges[0], { ...ranges.at(-1)!, logId: "00000000-0000-4000-8000-000000000000" }].map(x => JSON.stringify(x)).join("\n") + "\n");
    expect(await r({})).toMatchObject({ ok: false, error: expect.stringContaining("aren't of one log") });
    writeFileSync(part, "not a log");
    expect(await r({})).toMatchObject({ ok: false, error: expect.stringContaining("one range a line") });
    writeFileSync(part, "");
    expect(await r({})).toMatchObject({ ok: false, error: expect.stringContaining("no log arrived") });
  });

  test("a hub that can't upload still holds the log, and the next run tries the repository again", async () => {
    await write(laptop.host, "cellar", ["Jam"]);
    // Float-2's view of the laptop's repository is a restic that can't reach it.
    const saved = hubEnv.EP0CH_RESTIC;
    hubEnv.EP0CH_RESTIC = join(dir, "bin", "restic-blocked");
    writeFileSync(join(dir, "bin", "ep0ch"), `#!/bin/sh\nexec env ${Object.entries(hubEnv).map(([k, v]) => `${k}='${v}'`).join(" ")} ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
    try {
      const s = readBackupState(laptop.state);
      const r = await snapshot(laptop, s, { say, probe: DOWN });
      expect(r.relayed).toContain("cellar");
      expect(s.outlines.cellar!.relayed).toMatchObject({ uploaded: false, uploadError: expect.any(String) });
      expect(existsSync(join(archiveRoot(hub, "laptop"), "cellar"))).toBe(true);
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
