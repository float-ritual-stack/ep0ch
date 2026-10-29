// PIE-1412: a test file leaves nothing behind for the next. Run together (one process, as `bun test` and each worker of
// box-test's --parallel run them), power-bar's App left extension actions bound and dispatch's "declarations" test and
// five in wkeys failed after it. Each case runs fixture files in one process: a leaky one, then one that expects the
// run's starting state. The shared teardown (test/preload.ts, between files) puts back what it can; what a file left is
// named, and the run fails.
import { expect, test } from "bun:test";
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures/leaks");
const run = (...files: string[]) => {
  const r = Bun.spawnSync([process.execPath, "test", ...files.map(f => join(fixtures, f))],
    { cwd: join(import.meta.dir, ".."), env: process.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  return { out: `${r.stdout.toString()}${r.stderr.toString()}`.replace(/\x1b\[[0-9;]*m/g, ""), code: r.exitCode };
};

test("an App a file left running gives back the extension actions it bound before the next file runs", () => {
  const r = run("app-binds.ts", "reads-actions.ts");
  expect(r.out).toMatch(/ 2 pass/);
  expect(r.out).not.toContain("left behind");
  expect(r.code).toBe(0);
}, 60_000);

test("a file that binds extensions itself and never unbinds them is named, and the run fails", () => {
  const r = run("binds.ts", "reads-actions.ts");
  expect(r.out).toContain("test/fixtures/leaks/binds.ts left behind: extensions bound (tarot)");
  expect(r.out).toMatch(/ 2 pass/);
  expect(r.code).not.toBe(0);
}, 60_000);

test("an env var a file set and left is named and put back before the next file runs", () => {
  const r = run("sets-env.ts", "reads-actions.ts");
  expect(r.out).toContain("test/fixtures/leaks/sets-env.ts left behind: env EP0CH_LEAK_PROBE");
  expect(r.out).toMatch(/ 2 pass/);
  expect(r.code).not.toBe(0);
}, 60_000);

test("the last file of a run is checked too", () => {
  const r = run("binds.ts");
  expect(r.out).toContain("test/fixtures/leaks/binds.ts left behind: extensions bound (tarot)");
  expect(r.code).not.toBe(0);
}, 60_000);
