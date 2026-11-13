// The disk keeper end to end on fixtures (PIE-1787): a scratch home, a fake `df` that measures it against a made-up
// disk, the real `offload` from scripts/disk, real rsync, and the storage box as the fake ssh's "other machine" (a
// scratch folder). Never a real disk, never the real box. The disk is 10 MB, so "2 GB of transcripts" is 2 MB here.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { keep } from "../src/disk/run";
import type { Incident } from "../src/backup/alert";
import { readAlert } from "../src/backup/alert";

const top = resolve(import.meta.dir, "../../..");
const SIZE_KB = 10_000;
const DAY = 86_400_000;
let root: string, home: string, box: string, env: Record<string, string>;
const session = "3f2a9c1e-0b7d-4e55-9a1c-6d2e8f4b7a10";
const project = ".claude/projects/-home-someone-projects-garden";

const file = (rel: string, kb: number, ageDays: number, fill = "a") => {
  const p = join(home, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, fill.repeat(kb * 1024));
  const t = (Date.now() - ageDays * DAY) / 1000;
  utimesSync(p, t, t);
  return p;
};
const duKb = (dir: string) => Number(Bun.spawnSync(["du", "-sk", dir]).stdout.toString().split("\t")[0]);
/** The made-up disk at this share full, counting what's in the scratch home now. */
const fillTo = (pct: number) => { env.FAKE_DF_BASE_KB = String(Math.round((SIZE_KB * pct) / 100) - duKb(home)); };
const boxFiles = () => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name)); };
  if (existsSync(join(box, "archive"))) walk(join(box, "archive"));
  return out;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "disk-keeper-"));
  home = join(root, "home"); box = join(root, "box");
  const bin = join(root, "bin");
  for (const d of [home, box, bin, join(root, "box-outlines"), join(root, "logs")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexec '${process.execPath}' '${top}/packages/outliner/test/fake-ssh.ts' "$@"\n`, { mode: 0o755 });
  // df -Pk <paths>: every path on one made-up disk, its use the base plus what the scratch home holds now.
  writeFileSync(join(bin, "df"), `#!/bin/sh
shift
used=$(( FAKE_DF_BASE_KB + $(du -sk "$FAKE_DF_ROOT" | cut -f1) ))
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
for p in "$@"; do echo "/dev/fake ${SIZE_KB} $used $(( ${SIZE_KB} - used )) 0% /"; done
`, { mode: 0o755 });
  chmodSync(join(bin, "df"), 0o755);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("EP0CH_") && !k.startsWith("XDG_")) as [string, string][]);
  env = {
    ...inherited, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), EP0CH_STATE: join(root, "state"),
    EP0CH_SSH: join(bin, "ssh"), EP0CH_DISK_BOX: "storagebox", EP0CH_OFFLOAD: join(top, "scripts/disk/offload"),
    EP0CH_DISK_LOGS: join(root, "logs"), EP0CH_BACKUP_MACHINE: "box-a",
    FAKE_SSH_HOME: box, FAKE_SSH_OUTLINES: join(root, "box-outlines"), FAKE_DF_ROOT: home, FAKE_DF_BASE_KB: "0",
  };
});
afterEach(() => { Bun.spawnSync([join(top, "scripts/scratch-clean"), root]); });

describe("the disk keeper on a made-up disk", () => {
  test("78% with 2 GB of old transcripts: offload moves and verifies them, the disk is measured again, no alert", async () => {
    const old = [file(`${project}/${session}.jsonl`, 1024, 10), file(`${project}/${session}/subagents/agent-1.jsonl`, 1024, 10, "b")];
    const fresh = file(`${project}/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f.jsonl`, 100, 1);
    const memory = file(`${project}/memory/MEMORY.md`, 4, 40);
    fillTo(78);
    const announced: Incident[] = [];
    const s = await keep({ env, announce: async l => { announced.push(...l); } });

    expect(s.sweeps).toHaveLength(1);
    expect(s.sweeps[0]!).toMatchObject({ code: 0, before: 78 });
    expect(s.sweeps[0]!.after).toBeLessThanOrEqual(60);
    for (const p of old) expect(existsSync(p)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(memory)).toBe(true);
    const copies = boxFiles();
    expect(copies.some(f => f.endsWith(`${session}.jsonl`))).toBe(true);
    expect(copies.some(f => f.endsWith("subagents/agent-1.jsonl"))).toBe(true);
    expect(copies.some(f => f.endsWith("MEMORY.md"))).toBe(false);
    expect(readFileSync(join(home, ".claude/projects/OFFLOADED.txt"), "utf8")).toContain(`${session}.jsonl`);
    expect(announced).toEqual([]);
    expect(s.incidents).toEqual([]);
    expect(readAlert(join(root, "state/backup"))?.incidents ?? []).toEqual([]);
    // Measured again after the sweep: the newest sample is the emptier disk.
    expect(s.samples.at(-1)!.used).toBeLessThan(s.samples.at(-2)!.used);
  }, 60_000);

  test("a checksum mismatch: every file stays, one alert with the retry, no repeat; the retry clears it", async () => {
    const a = file(`${project}/${session}.jsonl`, 1024, 10);
    const b = file(`${project}/${session}/tool-results/out.txt`, 1024, 10, "c");
    // The box already holds a copy of one with the same size and time but other bytes: the quick copy skips it.
    const host = Bun.spawnSync(["hostname", "-s"]).stdout.toString().trim();
    const stale = join(box, "archive", host, project, `${session}.jsonl`);
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "z".repeat(1024 * 1024));
    const t = (Date.now() - 10 * DAY) / 1000;
    utimesSync(stale, t, t);
    fillTo(78);
    const before = readFileSync(a, "utf8");

    const announced: Incident[] = [];
    const s = await keep({ env, announce: async l => { announced.push(...l); } });
    expect(s.sweeps.at(-1)!.code).toBe(4);
    expect(existsSync(a) && existsSync(b)).toBe(true);
    expect(readFileSync(a, "utf8")).toBe(before);
    expect(announced).toHaveLength(1);
    expect(announced[0]!.key).toBe("disk:box-a:/:sweep");
    expect(announced[0]!.detail).toContain("differ");
    expect(announced[0]!.fix).toStartWith("offload --sweep --yes --checksum");
    expect(readAlert(join(root, "state/backup"))!.incidents.map(i => i.key)).toEqual(["disk:box-a:/:sweep"]);

    // The same condition next run: still open, never announced again.
    await keep({ env, announce: async l => { announced.push(...l); } });
    expect(announced).toHaveLength(1);

    // The command the alert gives: copies again by content, then the sweep moves them and the incident clears.
    const retry = Bun.spawnSync([env.EP0CH_OFFLOAD, "--sweep", "--yes", "--checksum"], { env });
    expect(retry.exitCode).toBe(0);
    expect(existsSync(a)).toBe(false);
    expect(readFileSync(stale, "utf8")).toBe(before);
    fillTo(78);
    const after = await keep({ env, announce: async l => { announced.push(...l); } });
    expect(after.incidents).toEqual([]);
    expect(readAlert(join(root, "state/backup"))!.incidents).toEqual([]);
    expect(announced).toHaveLength(1);
  }, 90_000);

  test("the box away: nothing moves, one alert naming the box", async () => {
    const a = file(`${project}/${session}.jsonl`, 1024, 10);
    fillTo(80);
    env.FAKE_SSH_DOWN = "1";
    const announced: Incident[] = [];
    const s = await keep({ env, announce: async l => { announced.push(...l); } });
    expect(s.sweeps.at(-1)!.code).toBe(3);
    expect(existsSync(a)).toBe(true);
    expect(announced.map(i => i.key)).toEqual(["disk:box-a:/:sweep"]);
    expect(announced[0]!.fix).toStartWith("ssh storagebox true");
  }, 60_000);

  test("under the line: no sweep, nothing moved", async () => {
    const a = file(`${project}/${session}.jsonl`, 1024, 10);
    fillTo(60);
    const s = await keep({ env, announce: async () => { throw new Error("no alert expected"); } });
    expect(s.sweeps).toEqual([]);
    expect(existsSync(a)).toBe(true);
    expect(boxFiles()).toEqual([]);
  }, 30_000);
});
