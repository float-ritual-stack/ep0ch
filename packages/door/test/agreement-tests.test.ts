// scripts/agreement-tests.ts (PIE-1504): the host-free agreement tests every `bun run check` runs, listed once in
// scripts/agreement-tests.txt. A listed file that starts a host or a process fails the run (scripts/host-free-guard.ts),
// so the set stays fast. The files here are made up and removed.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseList, runsOf } from "../../../scripts/agreement-tests";

const repo = join(import.meta.dir, "../../..");
const script = join(repo, "scripts/agreement-tests.ts");
const dir = mkdtempSync(join(tmpdir(), "agreement-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const runner = (list: string) => {
  const r = Bun.spawnSync(["bun", script, "--list", list], { cwd: repo, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("the list: a file a line, an optional -t regex; unfiltered files run together, each filtered line alone", () => {
  const entries = parseList("# a comment\n\npackages/door/test/a.test.ts\npackages/door/test/b.test.ts -t key rows|pages\npackages/outliner/test/c.test.ts\n");
  expect(entries).toEqual([{ file: "packages/door/test/a.test.ts" }, { file: "packages/door/test/b.test.ts", filter: "key rows|pages" }, { file: "packages/outliner/test/c.test.ts" }]);
  expect(runsOf(entries)).toEqual([{ files: ["packages/door/test/a.test.ts", "packages/outliner/test/c.test.ts"] }, { files: ["packages/door/test/b.test.ts"], filter: "key rows|pages" }]);
  expect(() => parseList("packages/door/test/a.test.ts --only")).toThrow("a file, then an optional -t <regex>");
});

test("every listed file exists, and none imports a scratch host or a harness that starts one", () => {
  const entries = parseList(readFileSync(join(repo, "scripts/agreement-tests.txt"), "utf8"));
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    expect(existsSync(join(repo, e.file))).toBe(true);
    const src = readFileSync(join(repo, e.file), "utf8");
    // A file whose tests all run (no -t) starts nothing: it imports no Scratch, scratch outline, service process or harness setup.
    if (!e.filter) expect({ file: e.file, hosts: /\b(Scratch|ScratchHost|scratchOutline|setup|OutlinerServer|useShowcaseScreen)\b/.test(src) }).toEqual({ file: e.file, hosts: false });
  }
});

test("a listed file that starts a host, or a process, fails the run and says which; a quiet one passes", () => {
  const sock = join(dir, "h.sock");
  writeFileSync(join(dir, "listens.test.ts"), `import { test } from "bun:test"; import { createServer } from "node:net";\ntest("starts a host", () => { createServer().listen(${JSON.stringify(sock)}); });\n`);
  writeFileSync(join(dir, "spawns.test.ts"), `import { test } from "bun:test";\ntest("starts a process", () => { Bun.spawnSync(["true"]); });\n`);
  writeFileSync(join(dir, "quiet.test.ts"), `import { expect, test } from "bun:test";\ntest("agrees", () => { expect(1 + 1).toBe(2); });\n`);
  writeFileSync(join(dir, "hosts.txt"), `${join(dir, "listens.test.ts")}\n${join(dir, "spawns.test.ts")} -t starts\n`);
  writeFileSync(join(dir, "quiet.txt"), `${join(dir, "quiet.test.ts")}\n`);
  writeFileSync(join(dir, "missing.txt"), `${join(dir, "gone.test.ts")}\n`);
  const hosts = runner(join(dir, "hosts.txt"));
  expect(hosts.code).not.toBe(0);
  expect(hosts.out).toContain("a socket listen in an agreement test");
  expect(hosts.out).toContain("a process (Bun.spawnSync) in an agreement test");
  expect(hosts.out).toContain("agreement tests red");
  expect(existsSync(sock)).toBe(false);
  const quiet = runner(join(dir, "quiet.txt"));
  expect({ code: quiet.code, green: quiet.out.includes("agreement tests green") }).toEqual({ code: 0, green: true });
  const missing = runner(join(dir, "missing.txt"));
  expect({ code: missing.code, said: missing.out.includes("not found") }).toEqual({ code: 2, said: true });
}, 60_000);
