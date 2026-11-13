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
    const s = await keep({ env, announce: async l => { announced.push(...l); return l.map(i => i.key); } });

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
    const s = await keep({ env, announce: async l => { announced.push(...l); return l.map(i => i.key); } });
    expect(s.sweeps.at(-1)!.code).toBe(4);
    expect(existsSync(a) && existsSync(b)).toBe(true);
    expect(readFileSync(a, "utf8")).toBe(before);
    expect(announced).toHaveLength(1);
    expect(announced[0]!.key).toBe("disk:box-a:/:sweep");
    expect(announced[0]!.detail).toContain("differ");
    expect(announced[0]!.fix).toStartWith("offload --sweep --yes --checksum");
    expect(readAlert(join(root, "state/backup"))!.incidents.map(i => i.key)).toEqual(["disk:box-a:/:sweep"]);

    // The same condition next run: still open, never announced again.
    await keep({ env, announce: async l => { announced.push(...l); return l.map(i => i.key); } });
    expect(announced).toHaveLength(1);

    // The command the alert gives: copies again by content, then the sweep moves them and the incident clears.
    const retry = Bun.spawnSync([env.EP0CH_OFFLOAD!, "--sweep", "--yes", "--checksum"], { env });
    expect(retry.exitCode).toBe(0);
    expect(existsSync(a)).toBe(false);
    expect(readFileSync(stale, "utf8")).toBe(before);
    fillTo(78);
    const after = await keep({ env, announce: async l => { announced.push(...l); return l.map(i => i.key); } });
    expect(after.incidents).toEqual([]);
    expect(readAlert(join(root, "state/backup"))!.incidents).toEqual([]);
    expect(announced).toHaveLength(1);
  }, 90_000);

  test("the box away: nothing moves, one alert naming the box", async () => {
    const a = file(`${project}/${session}.jsonl`, 1024, 10);
    fillTo(80);
    env.FAKE_SSH_DOWN = "1";
    const announced: Incident[] = [];
    const s = await keep({ env, announce: async l => { announced.push(...l); return l.map(i => i.key); } });
    expect(s.sweeps.at(-1)!.code).toBe(3);
    expect(existsSync(a)).toBe(true);
    expect(announced.map(i => i.key)).toEqual(["disk:box-a:/:sweep"]);
    expect(announced[0]!.fix).toStartWith("ssh storagebox true");
  }, 60_000);

  test("offload takes a folder outside home (a volume's) to root/<path> on the box, and brings it back", () => {
    const parked = join(root, "volume/claude-archive");
    mkdirSync(join(parked, "proj"), { recursive: true });
    writeFileSync(join(parked, "proj/old.jsonl"), "x".repeat(4096));
    const out = Bun.spawnSync([env.EP0CH_OFFLOAD!, parked], { env });
    expect(out.exitCode).toBe(0);
    expect(existsSync(parked)).toBe(false);
    expect(readFileSync(`${parked}.offloaded`, "utf8")).toContain(`offload --restore ${parked}`);
    expect(boxFiles().some(f => f.endsWith(`/root${parked}/proj/old.jsonl`))).toBe(true);
    expect(Bun.spawnSync([env.EP0CH_OFFLOAD!, "--restore", parked], { env }).exitCode).toBe(0);
    expect(readFileSync(join(parked, "proj/old.jsonl"), "utf8")).toHaveLength(4096);
    expect(existsSync(`${parked}.offloaded`)).toBe(false);
  }, 30_000);

  test("under the line: no sweep, nothing moved", async () => {
    const a = file(`${project}/${session}.jsonl`, 1024, 10);
    fillTo(60);
    const s = await keep({ env, announce: async () => { throw new Error("no alert expected"); } });
    expect(s.sweeps).toEqual([]);
    expect(existsSync(a)).toBe(true);
    expect(boxFiles()).toEqual([]);
  }, 30_000);
});

// Codex's pass on #1489: what offload must never lose, each red before its fix.
describe("offload keeps everything it hasn't verified", () => {
  const offload = (...args: string[]) => Bun.spawnSync([env.EP0CH_OFFLOAD!, ...args], { env, stdout: "pipe", stderr: "pipe" });
  /** A real rsync that runs a script of the test's right after each checking (--dry-run) pass: writes after the verify. */
  const afterVerify = (script: string) => {
    const bin = join(root, "bin");
    writeFileSync(join(root, "after-verify.sh"), script);
    const real = Bun.which("rsync", { PATH: process.env.PATH! })!;
    writeFileSync(join(bin, "rsync"), `#!/bin/sh\n'${real}' "$@"; code=$?\ncase " $* " in *" --dry-run "*) . '${join(root, "after-verify.sh")}' ;; esac\nexit $code\n`, { mode: 0o755 });
  };

  test("refusing home deletes nothing", () => {
    const keepMe = file("notes/keep.txt", 1, 1);
    const r = offload(home);
    expect(r.exitCode).toBe(2);
    expect(existsSync(keepMe)).toBe(true);
    expect(boxFiles()).toEqual([]);
  });

  test("a folder: a file appended after the check and one made after the copy both stay; the rest goes", () => {
    const a = file("proj/a.txt", 2, 30), b = file("proj/b.txt", 2, 30, "b");
    afterVerify(`printf more >> '${a}'\nprintf new > '${join(home, "proj/new.txt")}'\n`);
    const r = offload(join(home, "proj"));
    expect(r.exitCode).toBe(0);
    expect(existsSync(b)).toBe(false);
    expect(readFileSync(a, "utf8").endsWith("more")).toBe(true);
    expect(readFileSync(join(home, "proj/new.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(home, "proj.offloaded"), "utf8")).toContain("2 files changed or made during the move stay here");
  });

  test("a sweep: a transcript appended after the check stays", async () => {
    const a = file(`${project}/${session}.jsonl`, 4, 10);
    afterVerify(`printf more >> '${a}'\n`);
    expect(offload("--sweep", "--yes").exitCode).toBe(0);
    expect(readFileSync(a, "utf8").endsWith("more")).toBe(true);
  });

  test("a recon clone is cold by its newest file, not its folder's time", () => {
    const warm = file("recon/warm/src/today.ts", 1, 0), cold = file("recon/cold/src/old.ts", 1, 30);
    for (const d of ["recon/warm", "recon/cold"]) { const t = (Date.now() - 20 * DAY) / 1000; utimesSync(join(home, d), t, t); }
    expect(offload("--sweep", "--yes").exitCode).toBe(0);
    expect(existsSync(warm)).toBe(true);
    expect(existsSync(cold)).toBe(false);
  });

  test("a session goes or stays whole: a fresh transcript keeps its older tool results", () => {
    const fresh = file(`${project}/${session}.jsonl`, 1, 1);
    const old = file(`${project}/${session}/tool-results/out.txt`, 1, 10);
    expect(offload("--sweep", "--yes").exitCode).toBe(0);
    expect(existsSync(fresh) && existsSync(old)).toBe(true);
    expect(boxFiles()).toEqual([]);
  });

  test("a file name with a newline in it can't point the removal at another file", () => {
    const keepMe = file("#keep", 1, 1);
    const evil = file(".claude/uploads/u1/evil\n#keep", 1, 40);
    expect(offload("--sweep", "--yes").exitCode).toBe(0);
    expect(existsSync(keepMe)).toBe(true);
    expect(existsSync(evil)).toBe(false);
    expect(boxFiles().some(f => f.endsWith("evil\n#keep"))).toBe(true);
  });

  test("a folder with a space in its name comes back where it was, and its marker goes", () => {
    file("cold folder/f.txt", 1, 30);
    expect(offload(join(home, "cold folder")).exitCode).toBe(0);
    expect(existsSync(join(home, "cold folder.offloaded"))).toBe(true);
    expect(offload("--restore", join(home, "cold folder")).exitCode).toBe(0);
    expect(readFileSync(join(home, "cold folder/f.txt"), "utf8")).toHaveLength(1024);
    expect(existsSync(join(home, "cold folder/cold folder"))).toBe(false);
    expect(existsSync(join(home, "cold folder.offloaded"))).toBe(false);
  });
});

describe("the keeper's own run", () => {
  test("an announcement that didn't reach anyone is tried again next run", async () => {
    fillTo(90);
    const tries: string[][] = [];
    await keep({ env, announce: async l => { tries.push(l.map(i => i.key)); return []; } });
    await keep({ env, announce: async l => { tries.push(l.map(i => i.key)); return l.map(i => i.key); } });
    await keep({ env, announce: async l => { tries.push(l.map(i => i.key)); return l.map(i => i.key); } });
    expect(tries).toEqual([["disk:box-a:/:full"], ["disk:box-a:/:full"]]);
  }, 60_000);

  test("the weekly sweep is the keeper's run: under the line, it sweeps and records", async () => {
    const a = file(`${project}/${session}.jsonl`, 4, 10);
    fillTo(40);
    const s = await keep({ env, sweep: true, announce: async () => [] });
    expect(s.sweeps).toHaveLength(1);
    expect(existsSync(a)).toBe(false);
  }, 60_000);

  test("one run at a time: a second while the first holds the lock does nothing", async () => {
    const a = file(`${project}/${session}.jsonl`, 4, 10);
    fillTo(80);
    mkdirSync(join(root, "state/backup"), { recursive: true });
    writeFileSync(join(root, "state/backup/disk.lock"), String(process.pid));
    const s = await keep({ env, announce: async () => [] });
    expect(s.busy).toContain("another disk keeper run");
    expect(existsSync(a)).toBe(true);
    expect(existsSync(join(root, "state/backup/disk.json"))).toBe(false);
  }, 30_000);
});

// Codex's recheck of 6674319c: four more, each red before its fix.
describe("offload keeps what changed, even by stealth, and what it can't put back", () => {
  const offload = (...args: string[]) => Bun.spawnSync([env.EP0CH_OFFLOAD!, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const afterVerify = (script: string) => {
    const bin = join(root, "bin");
    writeFileSync(join(root, "after-verify.sh"), script);
    const real = Bun.which("rsync", { PATH: process.env.PATH! })!;
    writeFileSync(join(bin, "rsync"), `#!/bin/sh\n'${real}' "$@"; code=$?\ncase " $* " in *" --dry-run "*) . '${join(root, "after-verify.sh")}' ;; esac\nexit $code\n`, { mode: 0o755 });
  };

  test("a replacement with the same size and time, in place or by rename, stays", () => {
    const a = file("proj/a.txt", 2, 30), b = file("proj/b.txt", 2, 30, "b");
    afterVerify(`printf '%2048s' '' | tr ' ' Z > '${a}.new'; touch -r '${a}' '${a}.new'; mv '${a}.new' '${a}'
t=$(stat -c %Y '${b}'); printf '%2048s' '' | tr ' ' Y > '${b}'; touch -d @$t '${b}'
`);
    expect(offload(join(home, "proj")).exitCode).toBe(0);
    expect(readFileSync(a, "utf8")).toBe("Z".repeat(2048));
    expect(readFileSync(b, "utf8")).toBe("Y".repeat(2048));
  });

  test("a session resumed after the check stays whole: its transcript and its tool results", () => {
    const t = file(`${project}/${session}.jsonl`, 2, 10);
    const r = file(`${project}/${session}/tool-results/out.txt`, 2, 10, "r");
    afterVerify(`printf more >> '${t}'\n`);
    expect(offload("--sweep", "--yes").exitCode).toBe(0);
    expect(existsSync(t) && existsSync(r)).toBe(true);
  });

  test("an empty folder makes the round trip", () => {
    file("proj/f.txt", 1, 30);
    mkdirSync(join(home, "proj/empty/deeper"), { recursive: true });
    expect(offload(join(home, "proj")).exitCode).toBe(0);
    expect(existsSync(join(home, "proj"))).toBe(false);
    expect(offload("--restore", join(home, "proj")).exitCode).toBe(0);
    expect(existsSync(join(home, "proj/empty/deeper"))).toBe(true);
    expect(existsSync(join(home, "proj/f.txt"))).toBe(true);
  });

  test("a restore onto something of another kind is refused, and the marker stays", () => {
    file("item.txt", 1, 30);
    expect(offload(join(home, "item.txt")).exitCode).toBe(0);
    mkdirSync(join(home, "item.txt"));
    const r = offload("--restore", join(home, "item.txt"));
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain("is a folder here");
    expect(existsSync(join(home, "item.txt/item.txt"))).toBe(false);
    expect(existsSync(join(home, "item.txt.offloaded"))).toBe(true);
  });
});
