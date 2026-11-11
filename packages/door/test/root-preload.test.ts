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

// `bun test` (1.4) never fires `exit`, so the preloads' temp folders (the door's state dir, the fake ssh's owner file, the
// outliner's empty extensions folder) were left in the temp dir by every test process: 445,000 in float-box's /tmp by
// Nov 11, and bun reads every folder above a program as it starts it, so an extension's process under /tmp took 200 ms
// instead of 10 and a parity scenario typing in the power bar ran past its budget (PIE-1742). A run ends with none.
test("a test run leaves nothing of its preloads in its temp dir", () => {
  const root = join(import.meta.dir, "../../..");
  const temp = mkdtempSync(join(tmpdir(), "preload-temp-"));
  try {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: temp };
    delete env.OUTLINER_EXTENSIONS_DIR;
    const r = Bun.spawnSync(["bun", "test", "./packages/outliner/test/fixtures/preload-probe.ts", "./packages/door/test/fixtures/preload-probe.ts"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    expect({ code: r.exitCode, out: r.exitCode === 0 ? "" : r.stderr.toString(), left: readdirSync(temp) }).toEqual({ code: 0, out: "", left: [] });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}, 30_000);
