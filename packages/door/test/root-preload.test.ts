// A test file run from the repository's root gets this package's preload too (scripts/test-preload.ts): scripts/agent-env
// and box runs name files from there, and without it a test reaches the person's own settings and state. The probe here
// runs second, after another package's: a run of several packages' files keeps each one's preload.
import { expect, test } from "bun:test";
import { join } from "node:path";

test("bun test from the repository's root runs this package's preload, its file not the run's first", () => {
  const root = join(import.meta.dir, "../../..");
  const env: Record<string, string> = { ...(process.env as Record<string, string>), EP0CH_LANDING: "someone's landing" };
  delete env.OUTLINER_EXTENSIONS_DIR;
  const r = Bun.spawnSync(["bun", "test", "./packages/outliner/test/fixtures/preload-probe.ts", "./packages/door/test/fixtures/preload-probe.ts"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  expect({ code: r.exitCode, out: r.exitCode === 0 ? "" : r.stderr.toString() }).toEqual({ code: 0, out: "" });
}, 30_000);
