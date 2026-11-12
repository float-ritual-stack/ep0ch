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

// PIE-1767: `comment` refused in rounds (--request-id, then --quote or --whole), each with a stack line.
test("comment names everything it needs in one answer, without a stack trace", async () => {
  const r = await runCli(["comment", "--id", "00000000-0000-4000-8000-000000000000", "--text", "Still want this"]);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).not.toContain("    at ");
  for (const needed of ["--expected", "--request-id", "--quote", "--whole"]) expect(r.stderr).toContain(needed);
  expect(r.stderr).not.toContain("--stdin");
  const bare = await runCli(["comment"]);
  for (const needed of ["--id", "--expected", "--request-id", "--quote", "--whole", "--text", "--stdin"]) expect(bare.stderr).toContain(needed);
});

test("a command's argument refusal is one error line, never a stack trace", async () => {
  for (const args of [["read"], ["update", "--id", "x"], ["move", "--bogus"]]) {
    const r = await runCli(args);
    expect(r.exitCode, args.join(" ")).toBe(1);
    expect(r.stderr).toStartWith("error: ");
    expect(r.stderr).not.toContain("    at ");
  }
});

test("an unknown command says so and names --help, without a stack trace", async () => {
  const r = await runCli(["frobnicate"]);
  expect(r.exitCode).toBe(2);
  expect(r.stderr).toContain("unknown command: frobnicate");
  expect(r.stderr).toContain("outliner --help");
  expect(r.stderr).not.toContain("    at ");
});
