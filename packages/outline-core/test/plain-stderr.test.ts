import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { colourOnlyToATerminal } from "../src/plain-stderr";

const module = resolve(import.meta.dir, "../src/plain-stderr.ts");

async function stderrOf(script: string): Promise<string> {
  const child = Bun.spawn(["bun", "-e", script], { env: { ...process.env, FORCE_COLOR: "3" }, stdout: "pipe", stderr: "pipe" });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return stderr;
}

test("FORCE_COLOR paints console.error red into a pipe (why the rule exists)", async () => {
  expect(await stderrOf(`console.error("error: refused")`)).toContain("\x1b[31m");
});

test("piped stderr is plain: a refusal reads the same to the program that parses it", async () => {
  const stderr = await stderrOf(`const { colourOnlyToATerminal } = await import(${JSON.stringify(module)});
colourOnlyToATerminal(process.stderr, console);
console.error("error: refused %s", "PIE-001"); console.warn("note:", { kept: 1 });`);
  expect(stderr).toBe("error: refused PIE-001\nnote: { kept: 1 }\n");
});

test("a terminal keeps its colour", () => {
  const before = console.error;
  const target = { error: before, warn: console.warn } as unknown as Console;
  colourOnlyToATerminal({ isTTY: true, write: () => true }, target);
  expect(target.error).toBe(before);
});
