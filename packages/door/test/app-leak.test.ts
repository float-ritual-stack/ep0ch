// An App a test file leaves running is retired once the next file runs (test/preload.ts, src/app.ts TEST_APPS). Before,
// one kept ticking against its file's stub board and threw "between tests" in an unrelated later file
// (`b.authoredLinks is not a function`): the whole suite exited 1 with no test failed. Two fixture files in one run:
// the first leaves its App running, with a screen that throws if it's painted once the second file runs.
import { expect, test } from "bun:test";
import { join } from "node:path";

test("an App left running by one test file never paints while the next file runs", () => {
  const fixtures = join(import.meta.dir, "fixtures/app-leak");
  const r = Bun.spawnSync([process.execPath, "test", join(fixtures, "leaves-app.ts"), join(fixtures, "next-file.ts")],
    { cwd: join(import.meta.dir, ".."), env: process.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const out = `${r.stdout.toString()}${r.stderr.toString()}`.replace(/\x1b\[[0-9;]*m/g, "");
  expect(out).not.toContain("an App from an earlier file painted");
  expect(out).toMatch(/ 2 pass/);
  expect(r.exitCode).toBe(0);
}, 60_000);
