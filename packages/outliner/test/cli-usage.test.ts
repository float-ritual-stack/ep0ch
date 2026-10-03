// `outliner --help` (and -h, help) and a bare `outliner` print the usage and exit 0: never a stack trace, and never
// a command run on whatever outline the folder names. An unknown command says so and points at --help.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[]) {
  // An empty outlines folder and no outline named: a command that reached the service would fail, not list.
  const home = mkdtempSync(join(tmpdir(), "outliner-usage-"));
  try {
    const env = { ...process.env, HOME: home, EP0CH_OUTLINES: join(home, "outlines"), EP0CH_WS: "", EP0CH_SOCKET: "" };
    const p = Bun.spawn(["bun", "src/cli.ts", ...args], { cwd: join(import.meta.dir, ".."), env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { stdout, stderr, exitCode };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

for (const args of [["--help"], ["-h"], ["help"], []]) {
  test(`outliner ${args.join(" ") || "(no command)"} prints the usage and exits 0`, async () => {
    const r = await runCli(args);
    expect(r.stderr).not.toContain("    at ");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("usage: outliner");
    for (const command of ["list", "read", "create", "update", "goto", "work", "outline create", "publish serve"]) expect(r.stdout).toContain(command);
  });
}

test("an unknown command says so and names --help, without a stack trace", async () => {
  const r = await runCli(["frobnicate"]);
  expect(r.exitCode).toBe(2);
  expect(r.stderr).toContain("unknown command: frobnicate");
  expect(r.stderr).toContain("outliner --help");
  expect(r.stderr).not.toContain("    at ");
});
