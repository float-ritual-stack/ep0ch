import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("opening errors survive a failed Herdr notification without exposing forwarded secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-open-error-"));
  directories.push(directory);
  const secret = "not-a-real-credential-12345";
  // The host's private folder exists (a host has run here); the open's log goes there.
  mkdirSync(join(directory, ".host"), { recursive: true });
  const env = {
    ...process.env, EP0CH_OUTLINES: directory, OUTLINER_WORKSPACE_ROOT: directory,
    HERDR_ENV: "1", HERDR_BIN_PATH: join(directory, "missing-herdr"), TYPESAFE_API_KEY: secret,
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: join(directory, "invoking-project") }),
  };
  const child = Bun.spawn([process.execPath, "run", resolve("src/herdr-open.ts"), "--mode", secret], {
    env, stdout: "pipe", stderr: "pipe", timeout: 5_000,
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code).toBe(1);
  expect(stderr).toContain("Invalid outliner open mode: <REDACTED>");
  expect(stderr).not.toContain(secret);
  // Opening never names the invoking folder's outline by itself.
  expect(existsSync(join(directory, "invoking-project", ".ep0ch"))).toBe(false);
  const log = readFileSync(join(directory, ".host", "open-startup-error.log"), "utf8");
  expect(log).toContain("Invalid outliner open mode: <REDACTED>");
  expect(log).not.toContain(secret);
});
