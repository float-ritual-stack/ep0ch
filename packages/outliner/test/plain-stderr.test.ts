// Colour only to a terminal (src/plain-stderr.ts): under FORCE_COLOR, which Claude Code's shells set, a refusal piped
// to the program that reads it is plain, and the Claude mod's reader finds its reason.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RULE = resolve(import.meta.dir, "../src/plain-stderr.ts");
const CLI = resolve(import.meta.dir, "../src/cli.ts");
// The Claude mod's own reader of a CLI's stderr; by path, so this package's type check stays out of the mod's.
const { failureReasonOf } = await import(resolve(import.meta.dir, "../../claude-mod/hooks/mention-message.ts")) as { failureReasonOf: (stderr: string) => string };

async function stderrOf(argv: string[], env: Record<string, string> = {}): Promise<{ stderr: string; code: number }> {
  const child = Bun.spawn(argv, { env: { ...process.env, FORCE_COLOR: "3", ...env }, stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { stderr, code };
}
const withRule = (body: string) => ["bun", "-e", `const { colourOnlyToATerminal } = await import(${JSON.stringify(RULE)}); colourOnlyToATerminal();\n${body}`];

test("FORCE_COLOR paints console.error into a pipe (why the rule exists)", async () => {
  expect((await stderrOf(["bun", "-e", `console.error("error: refused")`])).stderr).toContain("\x1b[");
});

test("console.error and console.warn are plain, formatted as before", async () => {
  const { stderr } = await stderrOf(withRule(`console.error("error: refused %s", "PIE-001"); console.warn("note:", { kept: 1 });`));
  expect(stderr).toBe("error: refused PIE-001\nnote: { kept: 1 }\n");
});

test("an uncaught error is reported plainly, its reason on an error: line, exit 1", async () => {
  const thrown = await stderrOf(withRule(`throw new Error("the plot is flooded")`));
  expect(thrown.code).toBe(1);
  expect(thrown.stderr).not.toContain("\x1b[");
  expect(failureReasonOf(thrown.stderr)).toBe("the plot is flooded");
  const rejected = await stderrOf(withRule(`await Promise.reject(new Error("no seeds left"))`));
  expect([rejected.code, failureReasonOf(rejected.stderr)]).toEqual([1, "no seeds left"]);
});

test("a program's own handler keeps the error", async () => {
  const { stderr, code } = await stderrOf(withRule(`process.on("uncaughtException", e => { console.error("restored the terminal:", e.message); process.exit(4); }); throw new Error("x")`));
  expect([code, stderr]).toEqual([4, "restored the terminal: x\n"]);
});

test("a long refusal arrives whole before the exit", async () => {
  const { stderr } = await stderrOf(withRule(`console.error("y".repeat(300_000)); process.exit(1)`));
  expect(stderr.length).toBe(300_001);
});

test("the outliner CLI's refusal reaches the Claude mod's reader plain", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-stderr-"));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(EP0CH_|OUTLINER_|PI_OUTLINER_)/.test(k))) as Record<string, string>;
    const child = Bun.spawn(["bun", CLI, "--ws", "nowhere", "read", "00000000-0000-4000-8000-000000000000"], {
      env: { ...env, FORCE_COLOR: "3", EP0CH_OUTLINES: dir, XDG_CONFIG_HOME: join(dir, "config") }, stdout: "ignore", stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1);
    expect(stderr).not.toContain("\x1b[");
    expect(failureReasonOf(stderr)).toStartWith("connect ENOENT");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
