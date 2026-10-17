import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("the guard sweeps old directories but preserves a kept run and a locked run", async () => {
  const root = mkdtempSync("/tmp/box-dirs-");
  const prefix = join(root, "ep0ch-box-fixture-");
  const old = prefix + "AAAAAAAA", kept = prefix + "BBBBBBBB", active = prefix + "CCCCCCCC", run = prefix + "DDDDDDDD";
  for (const dir of [old, kept, active, run]) mkdirSync(dir);
  writeFileSync(join(kept, "kept"), "");
  writeFileSync(join(run, "run.sh"), "exit 0\n");
  const hold = join(root, "hold.sh"), ready = join(root, "ready");
  writeFileSync(hold, `touch '${ready}'\ncat >/dev/null\n`);
  const holder = Bun.spawn(["flock", join(active, "guard.lock"), "bash", hold], { stdin: "pipe" });
  try {
    while (!existsSync(ready)) await Bun.sleep(10);
    const guard = Bun.spawn(["bash", join(import.meta.dir, "../../../scripts/box-test-guard")], {
      env: { ...process.env, BOX_DIR: run, BOX_WT: "fixture", BOX_SLOTS: "1", BOX_KEEP: "1", BOX_LOCKS: join(root, "locks") },
      stdout: "pipe", stderr: "pipe",
    });
    const err = new Response(guard.stderr).text();
    expect(await guard.exited, await err).toBe(0);
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
