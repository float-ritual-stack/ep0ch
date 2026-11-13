// The disk keeper in `ep0ch install` (PIE-1787): written where a storage box is named, with the backup job's unit
// writer and with-secrets' script installer; a unit a person wrote is left alone, with the command that moves it.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diskChecks, diskPlan, diskSetupFacts } from "../src/disk/setup";

const top = resolve(import.meta.dir, "../../..");
let root: string, home: string;
const ok = async () => ({ code: 0, out: "", err: "" });
const no = async () => ({ code: 3, out: "", err: "" });
const facts = (env: Record<string, string> = {}, run = no) =>
  diskSetupFacts({ platform: "linux", home, env: { XDG_CONFIG_HOME: join(home, ".config"), EP0CH_STATE: join(root, "state"), ...env }, bun: "/opt/bun/bin/bun", main: join(top, "packages/door/src/main.ts"), repoRoot: top, run, etc: join(root, "etc") });

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "disk-install-")); home = join(root, "home"); mkdirSync(home, { recursive: true }); });
afterEach(() => { Bun.spawnSync([join(top, "scripts/scratch-clean"), root]); });

test("no storage box named: nothing written, and the one command that turns it on", async () => {
  const p = diskPlan(await facts());
  expect(p.status).toBe("skip");
  expect(p.why).toContain("EP0CH_DISK_BOX=<its ssh name> ep0ch install --apply");
});

test("a box given: both timers, offload in ~/.local/bin (755) and the settings file are written, then loaded", async () => {
  const p = diskPlan(await facts({ EP0CH_DISK_BOX: "storagebox" }));
  expect(p.status).toBe("do");
  const paths = p.writes.map(w => w.path.replace(home, "~"));
  expect(paths).toEqual(["~/.config/systemd/user/ep0ch-disk.service", "~/.config/systemd/user/ep0ch-disk.timer", "~/.config/systemd/user/offload-sweep.service", "~/.config/systemd/user/offload-sweep.timer", "~/.local/bin/offload", "~/.config/ep0ch/disk.env"]);
  expect(p.writes.find(w => w.path.endsWith("offload"))!.mode).toBe(0o755);
  expect(p.writes.find(w => w.path.endsWith("disk.env"))!.text).toContain("EP0CH_DISK_BOX=storagebox");
  expect(p.writes[0]!.text).toContain("ExecStart=/opt/bun/bin/bun");
  expect(p.writes[0]!.text).toContain("disk keep");
  expect(p.commands).toContain("systemctl --user enable ep0ch-disk.timer");
  expect(p.commands).toContain("systemctl --user enable offload-sweep.timer");
});

test("written and running: nothing to do; an older offload (no version line) is replaced", async () => {
  const first = diskPlan(await facts({ EP0CH_DISK_BOX: "storagebox" }));
  for (const w of first.writes) { mkdirSync(resolve(w.path, ".."), { recursive: true }); writeFileSync(w.path, w.text); }
  expect(diskPlan(await facts({}, ok)).status).toBe("skip");
  writeFileSync(join(home, ".local/bin/offload"), "#!/usr/bin/env bash\n# offload: the hand-made one\n");
  const p = diskPlan(await facts({}, ok));
  expect(p.writes.map(w => w.path)).toEqual([join(home, ".local/bin/offload")]);
});

test("a sweep timer a person wrote is theirs: said with the command that moves it, nothing written", async () => {
  const dir = join(home, ".config/systemd/user");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "offload-sweep.timer"), "[Timer]\nOnCalendar=monthly\n");
  const p = diskPlan(await facts({ EP0CH_DISK_BOX: "storagebox" }));
  expect(p.status).toBe("manual");
  expect(p.writes).toEqual([]);
  expect(p.why).toContain(`mv ${join(dir, "offload-sweep.timer")} ~/backups/units/`);
});

test("doctor says journald has no cap, with the one sudo command", async () => {
  const rows = diskChecks(await facts({ EP0CH_DISK_BOX: "storagebox" }));
  expect(rows.find(r => r.name === "journald cap")).toMatchObject({ status: "behind" });
  expect(rows.find(r => r.name === "journald cap")!.fix).toContain("SystemMaxUse=300M");
  mkdirSync(join(root, "etc/journald.conf.d"), { recursive: true });
  writeFileSync(join(root, "etc/journald.conf.d/ep0ch.conf"), "[Journal]\nSystemMaxUse=300M\n");
  expect(diskChecks(await facts({ EP0CH_DISK_BOX: "storagebox" })).find(r => r.name === "journald cap")).toMatchObject({ status: "ok" });
});
