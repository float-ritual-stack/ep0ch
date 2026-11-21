// The each-file phase names the test that failed (PIE-1816): scripts/test-each.sh keeps each failing test's assertion and
// its `(fail)` line under the file's `✗`, and the nightly's ticket carries them (scripts/nightly-red, which
// scripts/nightly-main reads its log with). Nov 18 and Nov 21: the log said only `✗ test/backup-restic.test.ts` and
// `error: expect(received).toBe(expected)`, of a file with 47 tests. A made-up failing file in a scratch folder.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "./scratch";

const root = scratchDir("ep0ch-each-test-");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const DOOR = join(import.meta.dir, ".."), REPO = join(DOOR, "../..");
const run = async (argv: string[]) => {
  const p = Bun.spawn(argv, { cwd: DOOR, stdout: "pipe", stderr: "pipe", env: { ...process.env, TEST_EACH_JOBS: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

test("a red file says which test failed and its assertion, and the nightly's ticket names it under its file", async () => {
  const dir = join(root, "kitchen");
  mkdirSync(dir, { recursive: true });
  const red = join(dir, "kettle.test.ts"), green = join(dir, "teapot.test.ts");
  writeFileSync(red, 'import { expect, test } from "bun:test";\ntest("the kettle is filled", () => { expect(1).toBe(1); });\ntest("the kettle boils two cups", () => {\n  expect(1 + 0).toBe(2);\n});\ntest("the kettle whistles", () => { expect("quiet").toBe("whistling"); });\n');
  writeFileSync(green, 'import { expect, test } from "bun:test";\ntest("the teapot is warmed", () => { expect(true).toBe(true); });\n');
  const each = await run(["sh", "scripts/test-each.sh", red, green]);
  expect(each.code).toBe(1);
  const lines = each.out.split("\n");
  // The file on its own line, as before; under it, indented, the assertion, what it got, where, and the test's name.
  expect(lines[0]).toBe(`✗ ${red}`);
  expect(lines).toContain("  error: expect(received).toBe(expected)");
  expect(lines).toContain("  Expected: 2");
  expect(lines).toContain("  Received: 1");
  expect(lines.some(l => l.startsWith("  at ") && l.includes("kettle.test.ts:4:"))).toBe(true);
  expect(lines.some(l => l.startsWith("  (fail) the kettle boils two cups"))).toBe(true);
  // Only the red file and the failing test: nothing of the green file, nothing of the test that passed.
  expect(each.out).not.toContain("teapot");
  expect(each.out).not.toContain("is filled");

  // The nightly's log: a whole suite that passed (its last file's header still open), then the each-file phase.
  const log = join(dir, "nightly.log");
  writeFileSync(log, `━━ door: bun run test\n\ntest/pantry.test.ts:\n(pass) the shelves are stocked [1.00ms]\n\n 1 pass\n 0 fail\n\n━━ door: each file alone (test:each, 8 at once)\n${each.out}error: script "test:each" exited with code 1\n`);
  const files = await run([join(REPO, "scripts/nightly-red"), log]);
  // The red file alone: its (fail) line isn't pinned on the file the suite ran last.
  expect([files.code, files.out]).toEqual([0, `${red}\n`]);
  const tests = await run([join(REPO, "scripts/nightly-red"), "--tests", log]);
  expect(tests.code).toBe(0);
  const told = tests.out.split("\n");
  expect(told[0]).toBe(red);
  expect(told).toContain("  error: expect(received).toBe(expected)");
  expect(told.some(l => l.startsWith("  (fail) the kettle boils two cups"))).toBe(true);
  // Each test keeps its own assertion, the same words or not.
  expect(told.filter(l => l === "  error: expect(received).toBe(expected)")).toHaveLength(2);
  expect(told.indexOf('  Received: "quiet"')).toBeGreaterThan(told.findIndex(l => l.startsWith("  (fail) the kettle boils two cups")));
}, 60_000);

test("a red file in the whole suite is named with its failing tests too; the suite's closing list repeats none of them", async () => {
  const dir = join(root, "larder");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "nightly.log");
  writeFileSync(log, ["test/jam.test.ts:", "(pass) the jars are scalded [1.00ms]", "(fail) the jam sets [2.00ms]", "", "test/bread.test.ts:", "(pass) the dough rises [1.00ms]", "",
    "1 tests failed:", "(fail) the jam sets [2.00ms]", "", " 2 pass", " 1 fail", ""].join("\n"));
  expect((await run([join(REPO, "scripts/nightly-red"), log])).out).toBe("test/jam.test.ts\n");
  expect((await run([join(REPO, "scripts/nightly-red"), "--tests", log])).out).toBe("test/jam.test.ts\n  (fail) the jam sets [2.00ms]\n");
});
