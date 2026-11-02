// The `ep0ch` command: help, the clients list (every role the service reports), and a service that isn't there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { clientRows, formatClients } from "../src/control";
import { outliner, Scratch, ScratchHost } from "./scratch";
import { startSession } from "../src/session/start";
import { placeOf } from "../src/session/place";

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
  test("session --machine lists the remote sessions and never acts on a local session", async () => {
    const host = new ScratchHost();
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("EP0CH_")));
    let local: Record<string, string> | undefined, remote: Record<string, string> | undefined;
    const cwd = host.folder("caller");
    try {
      await host.start();
      await host.create("garden");
      await host.create("orchard");
      local = { ...clean, ...host.env, EP0CH_WS: "", EP0CH_MACHINE: "", EP0CH_SOCKET: "", EP0CH_CONTROL: "", EP0CH_STATE: host.folder("local-state"), EP0CH_DAILY_AGENT: "sh" };
      remote = { ...local, HOME: host.folder("remote-home"), EP0CH_STATE: host.folder("remote-state") };
      for (const [name, env] of [["garden", local], ["orchard", remote]] as const) {
        const place = placeOf({ outline: name }, env.EP0CH_STATE, env);
        expect(await startSession(place.dir, ["--ws", name, "--screen", "desk"], env)).toEqual({ ok: true });
      }
      const bin = host.folder("bin"), ssh = join(bin, "ssh");
      writeFileSync(ssh, `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
      writeFileSync(join(bin, "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${MAIN} "$@"\n`);
      chmodSync(ssh, 0o755); chmodSync(join(bin, "ep0ch"), 0o755);
      const env = { ...local, EP0CH_SSH: ssh, FAKE_SSH_HOME: remote.HOME!, FAKE_SSH_OUTLINES: host.outlines, FAKE_SSH_STATE: remote.EP0CH_STATE!, FAKE_SSH_BIN: bin };
      const listed = await run(["session", "list", "--machine", "box-a"], env, cwd);
      expect(listed.code).toBe(0);
      expect(listed.out).toContain("box-a");
      expect(listed.out).toContain("orchard");
      expect(listed.out).not.toContain("garden");
      const json = await run(["--machine", "box-a", "session", "list", "--json"], env, cwd);
      expect(json.code).toBe(0);
      expect(JSON.parse(json.out).map((s: { place: { outline: string } }) => s.place.outline)).toEqual(["orchard"]);
      const down = await run(["session", "list", "--machine", "box-a"], { ...env, FAKE_SSH_DOWN: "1" }, cwd);
      expect(down.code).not.toBe(0);
      expect(down.err).toContain("Connection refused");
      expect(down.err).toContain("ssh box-a");
      expect(down.out).not.toContain("garden");
      // Every other session command keeps --machine as the outline's machine: the daemon itself starts as
      // `session serve --ws <name> --machine <ssh-name>` (Nov 2: refusing it stopped every remote outline's session).
      const status = await run(["session", "status", "--ws", "orchard", "--machine", "box-a"], env, cwd);
      expect(status.err).not.toContain("does not accept --machine");
      expect(status.out).not.toContain("Sessions on box-a");
      for (const [env, name] of [[local, "garden"], [remote, "orchard"]] as const) {
        const r = await run(["session", "list", "--json"], env, cwd);
        expect(JSON.parse(r.out).map((s: { place: { outline: string } }) => s.place.outline)).toContain(name);
      }
    } finally {
      for (const env of [local, remote]) if (env) await run(["session", "end", "--all", "--yes"], env, cwd);
      await host.dispose();
    }
  }, 60_000);

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

  test("docs lists the references and prints them without an outline or door", async () => {
    const listed = await run(["docs"]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("scripts");
    expect(listed.out).toContain("extensions");
    for (const name of ["scripts", "extensions"]) {
      const read = await run(["docs", name]);
      expect(read.code).toBe(0);
      expect(read.out).toContain(name === "scripts" ? "## Globals" : "## Testing an extension");
      expect(read.out).toContain(`ep0ch://docs/${name === "scripts" ? "extensions" : "scripts"}`);
      expect(read.out).not.toMatch(/\]\((?:\.\.?\/|(?:extensions\/README|PROGRAMMABLE-NOTES)\.md)/);
    }
    const missing = await run(["docs", "missing"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("ep0ch docs");
  });

  test("help fits a 50-row terminal and leads to each command's help", async () => {
    const r = await run(["help"]);
    expect(r.code).toBe(0);
    expect(r.out.trimEnd().split("\n").length).toBeLessThanOrEqual(50);
    expect(r.out).toContain("ep0ch clients");
    expect(r.out).toContain("ep0ch try");
    expect(r.out).toContain("ep0ch status");
    expect(r.out).toContain("ep0ch help <command>");
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
