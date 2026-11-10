// PIE-1708: a program the host starts gets Claude's login from the with-secrets `claude` group when the host has none
// of its own (a launchd host can't read the Keychain login `claude` keeps), and a `claude` that still has none says the
// command that stores one. yo's end-to-end walk is in yo-extension.test.ts; every token here is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLogin } from "../src/claude-login";
import { writeScopes } from "../src/secret-keys";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function secrets(login?: string): NodeJS.ProcessEnv {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "outliner-claude-login-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  if (login) writeFileSync(join(dir, "claude.env"), `CLAUDE_CODE_OAUTH_TOKEN=${login}\n`, { mode: 0o600 });
  return { HOME: dir, WITH_SECRETS_DIR: dir };
}

test("the host's own login first, else the claude group's, else none; a key scoped to someone else goes to no one else", async () => {
  const env = secrets("tok-made-up-group");
  expect(await claudeLogin({ extension: "yo" }, env)).toBe("tok-made-up-group");
  expect(await claudeLogin({ extension: "yo" }, { ...env, CLAUDE_CODE_OAUTH_TOKEN: "tok-made-up-host" })).toBe("tok-made-up-host");
  expect(await claudeLogin({ extension: "yo" }, secrets())).toBeUndefined();
  writeScopes("claude", "CLAUDE_CODE_OAUTH_TOKEN", ["ext:tidy"], env);
  expect(await claudeLogin({ extension: "yo" }, env)).toBeUndefined();
  expect(await claudeLogin({ extension: "tidy" }, env)).toBe("tok-made-up-group");
});

test("tidy with no Claude login says the command that stores one, not its settings", async () => {
  const note = "Shed list\n\n- rake\n- hoe\n@tidy make it a table";
  const request = {
    operation: "respond", config: { answer: [process.execPath, "-e", 'console.log("Not logged in · Please run /login"); process.exit(1)'] },
    input: { agent: "tidy", request: "make it a table", mark: "@tidy make it a table", note: { id: "made-up-note", revision: 1, text: note } },
  };
  const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "extensions", "tidy", "tidy.ts")], { stdin: new Blob([JSON.stringify(request)]), stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(run.stderr).text(), run.exited]);
  expect(code).toBe(1);
  expect(err).toBe("couldn't rewrite: claude isn't logged in where the outline host runs; store its login: with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN");
});
