import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function crashingClient(withHostFolder: boolean, body: string) {
  const directory = mkdtempSync(join(tmpdir(), "outliner-crash-"));
  directories.push(directory);
  if (withHostFolder) mkdirSync(join(directory, ".host"), { recursive: true });
  const script = join(directory, "client.ts");
  writeFileSync(script, `import { installCrashLog } from ${JSON.stringify(resolve("src/crash-log.ts"))};
installCrashLog("detail", () => console.log("terminal restored"));
${body}`);
  const child = Bun.spawn([process.execPath, "run", script], {
    env: { ...process.env, EP0CH_OUTLINES: directory, EP0CH_WS: "garden", TYPESAFE_API_KEY: "not-a-real-credential-12345" },
    stdout: "pipe", stderr: "pipe", timeout: 5_000,
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { directory, code, stdout, stderr };
}

test("a Detail crash restores the terminal, keeps its stack in the host folder and says where (PIE-477)", async () => {
  const { directory, code, stdout, stderr } = await crashingClient(true, `setTimeout(() => { throw new Error("rendering exploded at not-a-real-credential-12345"); }, 10);`);
  expect(code).toBe(1);
  expect(stdout).toContain("terminal restored");
  const log = readFileSync(join(directory, ".host", "detail-crash.log"), "utf8");
  expect(log).toContain("detail crashed");
  expect(log).toContain("outline garden");
  expect(log).toContain("rendering exploded");
  expect(log).toContain("client.ts");
  expect(log).not.toContain("not-a-real-credential-12345");
  expect(stderr).not.toContain("not-a-real-credential-12345");
  expect(stderr).toContain(`Details: ${join(directory, ".host", "detail-crash.log")}`);
});

test("a crash from a rejected promise is kept the same way; with no host folder the stack is on stderr", async () => {
  const kept = await crashingClient(true, `void Promise.reject(new Error("a promise nobody awaited"));\nawait Bun.sleep(200);`);
  expect(kept.code).toBe(1);
  expect(readFileSync(join(kept.directory, ".host", "detail-crash.log"), "utf8")).toContain("a promise nobody awaited");
  const bare = await crashingClient(false, `setTimeout(() => { throw new Error("nowhere to write"); }, 10);`);
  expect(bare.code).toBe(1);
  expect(bare.stderr).toContain("No host folder");
  expect(bare.stderr).toContain("nowhere to write");
});
