// `ep0ch backup status` and the run's progress lines in plain words (PIE-702): golden outputs for a person to read.
// Pure: a described history in a scratch state folder, a fixed clock, fictional machines.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type Alert, type BackupState, writeAlert, writeBackupState } from "../src/backup/alert";
import { backupCommand, statusLines } from "../src/backup/cli";
import { backupConfig, type BackupConfig } from "../src/backup/config";
import { plainFailure, plainReason } from "../src/backup/plain";
import { resticChecks } from "../src/backup/setup";
import { failedLine, relayedLine, verdict } from "../src/backup/verdict";
import { scratchDir } from "./scratch";

const root = scratchDir("ep0ch-backup-status-");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const NOW = Date.parse("2026-10-09T09:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const REPO = "s3:https://objects.hetzner.example/ep0ch/restic/{machine}";
let n = 0;

function config(): BackupConfig {
  const dir = join(root, `m${n++}`);
  const c = backupConfig({ HOME: dir, EP0CH_STATE: join(dir, "state"), EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_BACKUP_MACHINE: "float-hub", EP0CH_BACKUP_REPO: REPO, EP0CH_MCP_HUB: "float-2" });
  if ("error" in c) throw new Error(c.error);
  return c;
}
function world(s: Partial<BackupState>, incidents: Alert["incidents"] = [], checkedMinAgo = 5): BackupConfig {
  const c = config();
  writeBackupState(c.state, { outlines: {}, mirrors: {}, ...s });
  writeAlert(c.state, { machine: "float-hub", checkedAt: iso(checkedMinAgo), incidents, announced: [] });
  return c;
}
const drill = { at: "2026-10-07T04:16:00Z", ok: true, detail: "restored 3 outlines from s3:https://objects.hetzner.example/ep0ch/restic/float-hub: pie ok (1204 blocks, 2026-10-07 04:15Z); notes ok (88 blocks, 2026-10-07 04:15Z); scratch ok (3 blocks, 2026-10-07 04:15Z)" };
const RAW_FETCH = "objects.hetzner.example doesn't answer (The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch())";

describe("backup status, in plain words", () => {
  test("all ok: the verdict first, one row per outline, the drill as a summary", () => {
    const c = world({
      lastRun: { at: iso(10), ok: true, detail: "nothing changed" }, drill,
      outlines: { notes: { seq: 88, at: iso(240) }, pie: { seq: 1204, at: iso(12) } },
    });
    expect(statusLines(c, NOW).join("\n")).toBe(`✓ all backed up

float-hub (EP0CH_BACKUP_MACHINE) · ${c.repoOf("float-hub")}
  outline  newest        age  route   state
  notes    Oct 9 05:00Z  4h   direct  ok
  pie      Oct 9 08:48Z  12m  direct  ok

history
  last run Oct 9 08:50Z (10m ago): ok, nothing changed
  restore drill Oct 7 04:16Z: 3 of 3 restored ok
  netmail from float-2: not pulled yet (ep0ch mcp pull)`);
  });

  test("ok, the last run relayed: the old reason is history, not a problem", () => {
    const c = world({
      lastRun: { at: iso(600), ok: true, detail: "relayed float-hub via float-2" },
      outlines: { "float-hub": { seq: 40, at: iso(600), relayed: { via: "float-2", at: iso(600), why: RAW_FETCH, uploaded: true } } },
    });
    const text = statusLines(c, NOW).join("\n");
    expect(text).toBe(`✓ all backed up

float-hub (EP0CH_BACKUP_MACHINE) · ${c.repoOf("float-hub")}
  outline    newest        age  route        state
  float-hub  Oct 8 23:00Z  10h  via float-2  ok

history
  last run Oct 8 23:00Z (10h ago): ok, relayed float-hub via float-2
  float-hub's last upload went through float-2 at Oct 8 23:00Z because Hetzner didn't answer then
  netmail from float-2: not pulled yet (ep0ch mcp pull)`);
    expect(text).not.toContain("verbose: true");
  });

  test("failing now: Hetzner down and the relay down; the command, plain reasons", () => {
    const error = `${RAW_FETCH}; relaying through float-2 failed: float-2 doesn't answer over ssh`;
    const c = world({
      lastRun: { at: iso(3), ok: false, detail: "failed: float-hub" },
      outlines: { "float-hub": { seq: 40, at: iso(300), pendingSince: iso(200), error } },
    }, [{ key: "outline:float-hub/float-hub", title: "float-hub on float-hub: backup stale", since: iso(200), detail: "x", fix: "ep0ch backup run   (its log: journalctl)" }]);
    const text = statusLines(c, NOW).join("\n");
    expect(text).toBe(`✗ failing
  ✗ float-hub: not backed up: Hetzner didn't answer (probably the VPN, or no network), and float-2 didn't answer over ssh
  run: ep0ch backup run

float-hub (EP0CH_BACKUP_MACHINE) · ${c.repoOf("float-hub")}
  outline    newest        age  route   state
  float-hub  Oct 9 04:00Z  5h   direct  failing

history
  last run Oct 9 08:57Z (3m ago): failed, failed: float-hub
  netmail from float-2: not pulled yet (ep0ch mcp pull)`);
    // The raw text is kept for --verbose and --json.
    const raw = statusLines(c, NOW, { verbose: true }).join("\n");
    expect(raw).toContain("The socket connection was closed unexpectedly");
    expect(text).not.toContain("verbose: true");
  });

  test("stale with no change for a long time is fine", () => {
    const c = world({ lastRun: { at: iso(5), ok: true, detail: "nothing changed" }, outlines: { archive: { seq: 7, at: iso(60 * 24 * 20) } } });
    const lines = statusLines(c, NOW);
    expect(lines[0]).toBe("✓ all backed up");
    expect(lines.join("\n")).toContain("archive  Sep 19 09:00Z  20d  direct  ok");
  });

  test("piped: no colour; at a terminal: green, amber, red", async () => {
    const c = world({ lastRun: { at: iso(5), ok: true, detail: "nothing changed" }, outlines: { pie: { seq: 1, at: iso(5) } } });
    const out: string[] = [];
    expect(await backupCommand(["backup", "status"], { out: s => out.push(s), err: () => {} }, { ...c.env, NO_COLOR: "" })).toBe(0);
    expect(out.join("\n")).not.toContain("\x1b");
    const bad = world({ lastRun: { at: iso(5), ok: false, detail: "failed: pie" }, outlines: { pie: { seq: 1, at: iso(5), error: "disk is full: ENOSPC" } } });
    const coloured = statusLines(bad, NOW, { colour: true }).join("\n");
    expect(coloured).toContain("\x1b[38;2;");
    expect(statusLines(bad, NOW).join("\n")).not.toContain("\x1b");
  });

  test("--json keeps everything", async () => {
    const c = world({ lastRun: { at: iso(5), ok: true, detail: "nothing changed" }, outlines: { pie: { seq: 1, at: iso(5), relayed: { via: "float-2", at: iso(5), why: RAW_FETCH, uploaded: true } } } });
    const out: string[] = [];
    await backupCommand(["backup", "status", "--json"], { out: s => out.push(s), err: () => {} }, c.env);
    expect(JSON.parse(out.join("\n")).state.outlines.pie.relayed.why).toBe(RAW_FETCH);
  });
});

function c0() { return "s3:https://objects.hetzner.example/ep0ch/restic/float-hub"; }

describe("the run says the same thing", () => {
  test("raw errors become plain reasons", () => {
    expect(plainReason(RAW_FETCH, { repo: REPO })).toBe("Hetzner didn't answer (probably the VPN, or no network)");
    expect(plainReason("Fatal: unable to open config file: context canceled")).toContain("didn't answer");
    expect(plainFailure(`x doesn't answer; relaying through float-2 failed: float-2 has no ep0ch on a login shell's PATH`, { repo: REPO })).toBe("Hetzner didn't answer (probably the VPN, or no network), and float-2 has no ep0ch on its login shell's PATH");
    expect(plainReason("a".repeat(300))).toBe("it failed for a reason --verbose shows");
  });

  test("a failed outline's progress line names the next step", () => {
    const line = failedLine("float-hub", `${RAW_FETCH}; relaying through float-2 failed: float-2 doesn't answer over ssh`, { repo: REPO, hub: "float-2" });
    expect(line).toBe("✗ float-hub: not backed up: Hetzner didn't answer (probably the VPN, or no network), and float-2 didn't answer over ssh. Next: turn the VPN off, or check the other machine (ssh <it> true), then ep0ch backup run");
    expect(line).not.toContain("verbose: true");
  });

  test("a relayed outline's line says why and that it is safe", () => {
    expect(relayedLine("pie", 12, "float-2", RAW_FETCH, true, { repo: REPO })).toBe("✓ pie (change 12) backed up via float-2: Hetzner didn't answer (probably the VPN, or no network), so it went through float-2 and is in the repository");
  });

  test("doctor's backup line is the same verdict", () => {
    const state: BackupState = { outlines: { pie: { seq: 1, at: iso(5), error: RAW_FETCH } }, mirrors: {}, lastRun: { at: iso(2), ok: false, detail: "failed: pie" } };
    const v = verdict(state, null, NOW, { machine: "float-hub", repo: REPO });
    expect(v.headline).toBe("✗ failing");
    expect(v.fix).toBe("ep0ch backup run");
    const checks = resticChecks({
      platform: "linux", loaded: true, units: [], config: { path: "/fictional/backup.env", exists: true, machine: "float-hub", named: true }, restic: "/fictional/restic",
      groups: ["restic", "bucket", "heartbeat", "ntfy"], secrets: [], passwordInEnv: false, repo: REPO, state, alert: null, stateDir: "/fictional/state",
    }, NOW);
    const line = checks.find(x => x.name === "restic verdict")!;
    expect(line).toMatchObject({ status: "missing", fix: "ep0ch backup run" });
    expect(line.detail).toStartWith("✗ failing: pie: not backed up: Hetzner didn't answer");
  });
});
