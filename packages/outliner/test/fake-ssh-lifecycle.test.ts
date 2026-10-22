import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const alive = (pid: number) => {
  try {
    // A reparented child can remain a zombie until init reaps it.
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]![0] !== "Z";
  } catch { return false; }
};
async function until(ok: () => boolean) {
  while (!ok()) await Bun.sleep(20);
}

test("a forward whose owner ended before it listened exits too", async () => {
  const root = mkdtempSync("/tmp/ssh-start-");
  const run = Bun.spawn([process.execPath, join(import.meta.dir, "fake-ssh.ts"), "--serve",
    join(root, "local"), join(root, "remote"), join(root, "ctl")], {
    env: { ...process.env, FAKE_SSH_OWNER_FILE: join(root, "removed-owner") }, stdout: "ignore", stderr: "inherit",
  });
  try { expect(await run.exited).toBe(0); }
  finally {
    if (run.exitCode === null) run.kill();
    await run.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

for (const ending of ["pass", "failure", "timeout", "killed", "clean"] as const) {
  test(`a fake-ssh forward ends with its owner: ${ending}`, async () => {
    const root = mkdtempSync("/tmp/ssh-life-");
    const temp = join(root, `ep0ch-agent-${process.getuid!()}`, "forward");
    mkdirSync(temp, { recursive: true });
    const ctl = join(temp, "ctl"), ready = join(temp, "ready");
    const owner = join(root, "owner.ts");
    writeFileSync(owner, `
      import ${JSON.stringify(join(import.meta.dir, "preload.ts"))};
      ${ending === "clean" ? 'delete process.env.FAKE_SSH_OWNER_FILE;' : ""}
      const child = Bun.spawn([process.execPath, ${JSON.stringify(join(import.meta.dir, "fake-ssh.ts"))},
        ...${JSON.stringify(ending === "clean" ? ["--serve", `${temp}/local`, `${temp}/remote`, ctl] : ["-S", ctl, "-L", `${temp}/local:${temp}/remote`, "--", "garden"])}],
        { detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, FAKE_SSH_HOME: ${JSON.stringify(join(temp, "home"))}, FAKE_SSH_OUTLINES: ${JSON.stringify(join(temp, "outlines"))} } });
      ${ending === "clean" ? `child.unref(); while (!await Bun.file(${JSON.stringify(ctl)}).exists()) await Bun.sleep(20);` : "if (await child.exited) process.exit(2);"}
      await Bun.write(${JSON.stringify(ready)}, "ready");
      await Bun.stdin.text();
      process.exit(${ending === "failure" ? 1 : 0});
    `);
    const run = Bun.spawn([...(ending === "timeout" ? ["timeout", "5"] : []), process.execPath, owner], { env: { ...process.env, TMPDIR: temp }, stdin: "pipe", stdout: "ignore", stderr: "inherit" });
    let pid = 0;
    try {
      await until(() => existsSync(ready));
      pid = Number(readFileSync(ctl, "utf8"));
      expect(alive(pid)).toBe(true);
      if (ending === "clean") {
        const clean = Bun.spawn([join(import.meta.dir, "../../../scripts/agent-env"), "forward", "--clean"], {
          env: { ...process.env, EP0CH_AGENT_ROOT: join(root, "state"), EP0CH_AGENT_TMP: root }, stdout: "pipe", stderr: "pipe",
        });
        expect(await clean.exited).toBe(0);
      } else if (ending === "timeout") {
        expect(await run.exited).toBe(124);
      } else if (ending === "killed") {
        run.kill("SIGKILL");
        await run.exited;
      } else {
        run.stdin.end();
        expect(await run.exited).toBe(ending === "failure" ? 1 : 0);
      }
      await until(() => !alive(pid));
    } finally {
      if (run.exitCode === null) run.kill();
      await run.exited;
      if (pid) {
        try { process.kill(pid, "SIGTERM"); }
        catch (error) {
          // The forward can exit between a liveness check and the signal.
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
}


test.skipIf(!existsSync("/proc"))("a forward exits when its owner is an unreaped zombie", async () => {
  const root = mkdtempSync("/tmp/ssh-zombie-");
  const ownerFile = join(root, "owner");
  // Keep the parent alive without reaping so kill(pid, 0) still succeeds for the dead owner.
  const parent = Bun.spawn(["python3", "-c", `
import os, sys
pid = os.fork()
if pid == 0:
    os._exit(0)
with open(sys.argv[1], "w") as f:
    f.write(str(pid))
sys.stdin.read()
os.waitpid(pid, 0)
`, ownerFile], { stdin: "pipe", stdout: "ignore", stderr: "inherit" });
  let forward: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const deadline = Date.now() + 3000;
    while ((!existsSync(ownerFile) || alive(Number(readFileSync(ownerFile, "utf8")))) && Date.now() < deadline) await Bun.sleep(20);
    expect(existsSync(ownerFile)).toBe(true);
    const pid = Number(readFileSync(ownerFile, "utf8"));
    expect(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]![0]).toBe("Z");
    process.kill(pid, 0);
    forward = Bun.spawn([process.execPath, join(import.meta.dir, "fake-ssh.ts"), "--serve",
      join(root, "local"), join(root, "remote"), join(root, "ctl")], {
      env: { ...process.env, FAKE_SSH_OWNER_FILE: ownerFile }, stdout: "ignore", stderr: "inherit",
    });
    expect(await Promise.race([forward.exited, Bun.sleep(2000).then(() => "forward outlived zombie owner")])).toBe(0);
  } finally {
    if (forward) { if (forward.exitCode === null) forward.kill(); await forward.exited; }
    parent.stdin.end();
    await parent.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
