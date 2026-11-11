// scripts/scratch-clean --old (PIE-1742): the sweep loki or the nightly runs over what test runs left in the temp folder.
// It takes this user's test folders more than a day old, and leaves a running test's own, anything else, and a file.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../../../scripts/scratch-clean");

test("--old sweeps the test folders a day old from the temp folder, and nothing newer or else", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sweep-"));
  try {
    const uid = process.getuid!();
    const day = (Date.now() - 2 * 86_400_000) / 1000;
    const dir = (name: string, old: boolean) => { const p = join(tmp, name); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "x"), ""); if (old) utimesSync(p, day, day); return p; };
    const gone = [
      dir("ep0ch-test-state-aaaaaa", true), dir("fake-ssh-owner-bbbbbb", true), dir("outliner-test-no-user-extensions-123", true),
      dir("ep0ch-scratch-cccccc", true), dir(`ep0ch-${uid}/ep0ch-scratch-dddddd`, true), dir("ep0ch-fold-ffffff", true), dir("outliner-script-site-gggggg", true),
    ];
    const kept = [
      dir("ep0ch-test-state-running", false), dir(`ep0ch-${uid}/ep0ch-scratch-running`, false),
      dir("someone-elses-old-folder", true), dir(`ep0ch-${uid}/ep0ch-host-eeeeee`, true),
    ];
    writeFileSync(join(tmp, "ep0ch-test-state-a-file"), "");
    utimesSync(join(tmp, "ep0ch-test-state-a-file"), day, day);
    kept.push(join(tmp, "ep0ch-test-state-a-file"));
    const r = Bun.spawnSync([script, "--old"], { env: { ...process.env, EP0CH_SWEEP_TMP: tmp }, stdout: "pipe", stderr: "pipe" });
    expect({ code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() }).toEqual({ code: 0, out: `scratch-clean: removed 7 test folders more than a day old from ${tmp}`, err: "" });
    expect(gone.filter(existsSync)).toEqual([]);
    expect(kept.filter(p => !existsSync(p))).toEqual([]);
    const again = Bun.spawnSync([script, "--old"], { env: { ...process.env, EP0CH_SWEEP_TMP: tmp }, stdout: "pipe" });
    expect(again.stdout.toString().trim()).toBe(`scratch-clean: removed 0 test folders more than a day old from ${tmp}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
