// A test file run from the repository's root gets this package's preload too (scripts/test-preload.ts): scripts/agent-env
// and box runs name files from there, and without it a test reaches the person's own settings and state. The probe here
// runs second, after another package's: a run of several packages' files keeps each one's preload.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bun test from the repository's root runs this package's preload, its file not the run's first", () => {
  const root = join(import.meta.dir, "../../..");
  const env: Record<string, string> = { ...(process.env as Record<string, string>), EP0CH_LANDING: "someone's landing" };
  delete env.OUTLINER_EXTENSIONS_DIR;
  const r = Bun.spawnSync(["bun", "test", "./packages/outliner/test/fixtures/preload-probe.ts", "./packages/door/test/fixtures/preload-probe.ts"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  expect({ code: r.exitCode, out: r.exitCode === 0 ? "" : r.stderr.toString() }).toEqual({ code: 0, out: "" });
}, 30_000);

// `bun test` (1.4) never fires `exit`, so the preloads' temp folders (the door's state dir, the fake ssh's owner file)
// were left in the temp dir by every test process: 445,000 in float-box's /tmp by Nov 11, and bun reads every folder above
// a program as it starts it, so an extension's process under /tmp took 200 ms instead of 10 and a parity scenario typing
// in the power bar ran past its budget (PIE-1742). Nor can a preload's afterAll take them: under --rerun-each it runs
// before the last repetition's tests. So each run takes away what the runs before it left (their process gone), and
// keeps its own while it runs: in a run of two files, and in each repetition (the probe checks both are there).
test("a test run takes away the preload folders earlier runs left, and keeps its own while it runs", () => {
  const root = join(import.meta.dir, "../../..");
  const temp = mkdtempSync(join(tmpdir(), "preload-temp-"));
  try {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: temp };
    delete env.OUTLINER_EXTENSIONS_DIR;
    const probes = ["./packages/outliner/test/fixtures/preload-probe.ts", "./packages/door/test/fixtures/preload-probe.ts"];
    const runs = [["bun", "test", ...probes], ["bun", "test", "--rerun-each=2", ...probes], ["bun", "test", ...probes]];
    const out = runs.map(cmd => { const r = Bun.spawnSync(cmd, { cwd: root, env, stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode, out: r.exitCode === 0 ? "" : r.stderr.toString() }; });
    expect(out).toEqual(runs.map(() => ({ code: 0, out: "" })));
    const left = readdirSync(temp).map(n => n.replace(/[^-]+$/, ""));
    expect(left.sort()).toEqual(["ep0ch-test-state-", "fake-ssh-owner-"]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 60_000);
