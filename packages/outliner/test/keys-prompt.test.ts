import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const scratch = mkdtempSync(join(tmpdir(), "keys-prompt-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const main = resolve(import.meta.dir, "../../door/src/main.ts");
const prompt = `import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0: os.execv(sys.argv[1], sys.argv[1:])
data = b''
sent = False
end = time.time() + 15
while time.time() < end:
 if select.select([fd], [], [], 0.1)[0]:
  try: chunk = os.read(fd, 65536)
  except OSError: break
  if not chunk: break
  data += chunk
  if b'SAMPLE_KEY for sample: ' in data and not sent:
   os.write(fd, b'fictional-secret-42\\n'); sent = True
else:
 os.kill(pid, 9)
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(data)
sys.exit(os.waitstatus_to_exitcode(status))
`;
for (const state of ["missing", "old", "wrong-usage"]) test(`keys set handles ${state} helper through a terminal prompt`, async () => {
  const home = join(scratch, state), bin = join(home, ".local/bin");
  mkdirSync(bin, { recursive: true });
  if (state !== "missing") writeFileSync(join(bin, "with-secrets"), `#!/bin/bash\n${state === "wrong-usage" ? "# with-secrets v999\n" : ""}echo 'usage: with-secrets group -- command' >&2\nexit 2\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, WITH_SECRETS_DIR: join(home, "secrets"), PATH: `${bin}:/usr/bin:/bin`, EP0CH_OUTLINES: join(home, "outlines"), EP0CH_STATE: join(home, "state") };
  const child = Bun.spawn(["python3", "-c", prompt, process.execPath, main, "keys", "set", "sample", "SAMPLE_KEY"], { env, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  const code = await child.exited;
  if (state === "wrong-usage") {
    expect(code).toBe(1);
    expect(output).toContain("ep0ch keys set sample SAMPLE_KEY");
    expect(output).toContain("ep0ch install --apply");
    return;
  }
  expect(code).toBe(0);
  expect(output).toContain(`Writes the env file ${join(home, "secrets/sample.env")}`);
  expect(output).toContain("not the Keychain");
  expect(output).not.toContain("fictional-secret-42");
  const file = join(home, "secrets/sample.env");
  expect(readFileSync(file, "utf8")).toBe("SAMPLE_KEY=fictional-secret-42\n");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  for (const args of [["check", "SAMPLE_KEY"], ["list", "--json"]]) {
    const read = Bun.spawn([process.execPath, main, "keys", ...args], { env, stdout: "pipe", stderr: "pipe" });
    const text = await new Response(read.stdout).text();
    expect(await read.exited).toBe(0);
    expect(text).toContain("SAMPLE_KEY");
    expect(text).not.toContain("fictional-secret-42");
  }
}, 20_000);
