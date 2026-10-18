// The `ep0ch` command: help, the clients list (every role the service reports), and a service that isn't there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { clientRows, formatClients } from "../src/control";
import { outliner, Scratch, ScratchHost } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe("ep0ch clients", () => {
  test("lists every role, including observers and roles this door doesn't know yet", () => {
    const text = formatClients(clientRows([
      { role: "tree", clientId: "tree-1", runtime: { paneId: "wX:p1", hostname: "shed" }, currentTarget: { kind: "block", blockId: "11111111-2222-4333-8444-555555555555" } },
      { role: "observer", clientId: "ep0ch-door-7" },
      { role: "a-role-from-the-future", clientId: "x-9", runtime: { paneId: "wX:p2" } },
    ]));
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^role\s+pane\s+host\s+reading\s+clientId$/);
    expect(lines[1]).toMatch(/^tree\s+wX:p1\s+shed\s+block 11111111\s+tree-1$/);
    expect(lines[2]).toMatch(/^observer\s+—\s+—\s+—\s+ep0ch-door-7$/);
    expect(lines[3]).toMatch(/^a-role-from-the-future\s+wX:p2/);
  });

  test("an empty service says so", () => {
    expect(formatClients([])).toBe("no clients connected");
  });
});

describe("ep0ch command", () => {
  test("artifact commands use a machine with no outline, while import names its source outline", async () => {
    const host = new ScratchHost();
    try {
      await host.start();
      const cwd = host.folder("unbound"), file = join(cwd, "lantern.html");
      writeFileSync(file, "<h1>Lantern</h1>");
      const env = { ...host.env, EP0CH_WS: "", EP0CH_MACHINE: "", EP0CH_SOCKET: "" };
      const artifact = async (...args: string[]) => {
        const r = await run(["artifact", ...args], env, cwd);
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
        return JSON.parse(r.out);
      };
      expect((await artifact("put", file)).name).toBe("lantern");
      expect((await artifact("ls")).artifacts.map((a: { name: string }) => a.name)).toContain("lantern");
      expect((await artifact("show", "lantern")).files).toContain("lantern.html");
      expect((await artifact("snapshot", "lantern")).version).toBe(1);
      expect((await artifact("versions", "lantern")).versions[0].version).toBe(1);
      expect((await artifact("rm", "lantern")).removed).toBe("lantern");
      const local = host.folder("local"), ssh = join(local, "ssh"), remote = join(local, ".remote");
      mkdirSync(remote, { mode: 0o700 });
      writeFileSync(join(remote, "box-a.json"), JSON.stringify({ outlines: host.outlines }));
      writeFileSync(ssh, `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
      chmodSync(ssh, 0o755);
      const remoteEnv = { ...env, EP0CH_OUTLINES: local, EP0CH_SSH: ssh, FAKE_SSH_HOME: host.env.HOME!, FAKE_SSH_OUTLINES: host.outlines };
      try {
        const explicit = await run(["artifact", "show", "lantern@1", "--machine", "box-a"], remoteEnv, cwd);
        expect(explicit.code).toBe(0);
        expect(JSON.parse(explicit.out).files).toContain("lantern.html");
        writeFileSync(join(cwd, ".ep0ch"), 'ws = "uncreated"\nmachine = "box-a"\n');
        const nearest = await run(["artifact", "show", "lantern@1"], { ...remoteEnv, EP0CH_WS: "irrelevant", EP0CH_MACHINE: "irrelevant" }, cwd);
        expect(nearest.code).toBe(0);
        expect(JSON.parse(nearest.out).version).toBe(1);
        writeFileSync(join(cwd, ".ep0ch"), 'ws = "uncreated"\nmachine = "other-box"\n');
        const override = await run(["artifact", "show", "lantern@1", "--machine", "box-a"], remoteEnv, cwd);
        expect(override.code).toBe(0);
      } finally {
        const stop = Bun.spawn([ssh, "-S", join(remote, "box-a.ctl"), "-O", "exit", "--", "box-a"], { env: { ...process.env, ...remoteEnv }, stdout: "ignore", stderr: "ignore" });
        await stop.exited;
        writeFileSync(join(cwd, ".ep0ch"), 'ws = "garden"\n');
      }
      const missing = await run(["artifact", "import"], env, host.folder("unnamed"));
      expect(missing.code).toBe(1);
      expect(missing.err).toContain("--ws");
      await host.create("garden");
      expect((await artifact("import", "--ws", "garden")).counts.imported).toBe(0);
    } finally { await host.dispose(); }
  }, 30_000);

  test("help prints the usage and exits 0", async () => {
    const r = await run(["help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ep0ch clients");
    expect(r.out).toContain("ep0ch try");
    expect(r.out).toContain("ep0ch outline list [--all] [--archived] [--lines] | attach <name>");
    expect(r.out).toContain("--all lists every machine's");
    expect(r.out).toContain("ep0ch show <id>… [--source");
    expect(r.out).toContain("ep0ch status");
  });

  test("clients against a socket with no service says no carrier and exits 1", async () => {
    const r = await run(["clients"], { EP0CH_SOCKET: "/nonexistent/ep0ch-test/outliner.sock" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no carrier");
  });
});

describe.skipIf(!outliner)("ep0ch clients against a scratch service", () => {
  const scratch = new Scratch();
  let sock = "";
  beforeAll(async () => { sock = await scratch.start(); });
  afterAll(async () => { await scratch.dispose(); });

  test("lists the service's clients and exits 0", async () => {
    const r = await run(["clients"], { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name });
    expect(r.code).toBe(0);
    expect(r.out.trim().length).toBeGreaterThan(0);
    expect(r.out).toMatch(/^(role\s+pane|no clients connected)/);
  });
});
