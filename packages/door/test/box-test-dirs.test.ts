import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const scenario of ["old", "fresh", "fresh lock", "fresh marker", "abandoned", "recent content", "locked"] as const) {
test(`the guard sweeps only abandoned directories: ${scenario}`, async () => {
  const root = mkdtempSync("/tmp/box-dirs-");
  const prefix = join(root, "ep0ch-box-fixture-");
  const old = prefix + "AAAAAAAA", kept = prefix + "BBBBBBBB", active = prefix + "CCCCCCCC", run = prefix + "DDDDDDDD";
  for (const dir of [old, kept, active, run]) mkdirSync(dir);
  writeFileSync(join(kept, "kept"), "");
  writeFileSync(join(run, "run.sh"), "exit 0\n");
  const candidate = prefix + "EEEEEEEE";
  mkdirSync(candidate);
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
  if (["fresh marker", "abandoned", "recent content", "locked"].includes(scenario)) {
    writeFileSync(join(candidate, "kept"), "");
    utimesSync(join(candidate, "kept"), stale, stale);
  }
  writeFileSync(join(candidate, "guard.lock"), "");
  utimesSync(join(candidate, "guard.lock"), stale, stale);
  if (scenario === "recent content") {
    mkdirSync(join(candidate, "upload"));
    writeFileSync(join(candidate, "upload", "bundle"), "in progress");
    utimesSync(join(candidate, "upload"), stale, stale);
  }
  utimesSync(candidate, stale, stale);
  utimesSync(old, stale, stale);
  const fresh = new Date();
  if (scenario === "fresh") utimesSync(candidate, fresh, fresh);
  if (scenario === "fresh lock") utimesSync(join(candidate, "guard.lock"), fresh, fresh);
  if (scenario === "fresh marker") utimesSync(join(candidate, "kept"), fresh, fresh);
  const hold = join(root, "hold.sh"), ready = join(root, "ready");
  writeFileSync(hold, `touch '${ready}'\ncat >/dev/null\n`);
  const holder = Bun.spawn(["flock", join(scenario === "locked" ? candidate : active, "guard.lock"), "bash", hold], { stdin: "pipe" });
  try {
    while (!existsSync(ready)) await Bun.sleep(10);
    if (scenario === "locked") { utimesSync(join(candidate, "guard.lock"), stale, stale); utimesSync(candidate, stale, stale); }
    const guard = Bun.spawn(["bash", join(import.meta.dir, "../../../scripts/box-test-guard")], {
      env: { ...process.env, BOX_DIR: run, BOX_WT: "fixture", BOX_SLOTS: "1", BOX_KEEP: "1", BOX_LOCKS: join(root, "locks") },
      stdout: "pipe", stderr: "pipe",
    });
    const err = new Response(guard.stderr).text();
    expect(await guard.exited, await err).toBe(0);
    expect(existsSync(candidate), scenario).toBe(!["old", "abandoned"].includes(scenario));
    expect(existsSync(old)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(join(run, "kept"))).toBe(true);
  } finally {
    holder.stdin.end();
    await holder.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

}
