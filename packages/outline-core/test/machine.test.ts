import { describe, expect, test } from "bun:test";
import { ensureForward, forwardPaths, forwardState, type MachineIO, parseRemoteStatus, REMOTE_STATUS, sshArgv } from "../src/machine";

/**
 * A fictional machine reached over a fictional ssh: what each ssh call does to the world (the connection, the forward),
 * and every call made, in order.
 */
function world(o: { status?: { code: number; out: string; err?: string }; forwardFails?: string; hostDown?: boolean } = {}) {
  const calls: string[][] = [];
  const files = new Set<string>();
  let connected = false;
  const io: MachineIO = {
    async run(argv) {
      calls.push(argv);
      const op = argv.includes("-O") ? argv[argv.indexOf("-O") + 1] : argv.includes("-L") ? "forward" : "status";
      if (op === "check") return { code: connected ? 0 : 255, out: "", err: connected ? "" : "Control socket connect: No such file" };
      if (op === "exit") { const was = connected; connected = false; return { code: was ? 0 : 255, out: "", err: "" }; }
      if (op === "forward") {
        if (o.forwardFails) return { code: 255, out: "", err: o.forwardFails };
        connected = true;
        return { code: 0, out: "", err: "" };
      }
      return { err: "", ...(o.status ?? { code: 0, out: JSON.stringify({ socket: "/home/sam/outlines/.host/host.sock", outlines: [{ name: "pie" }] }) }) };
    },
    answers: async () => connected && !o.hostDown,
    privateDir: () => {},
    remove: path => { files.delete(path); },
    createExclusive: path => (files.has(path) ? false : (files.add(path), true)),
    ageMs: path => (files.has(path) ? 0 : null),
    sleep: async () => {},
  };
  return { io, calls, files, drop: () => { connected = false; }, get connected() { return connected; } };
}
const OPTS = (io: MachineIO) => ({ ssh: "ssh", outlines: "/home/sam/outlines", io, waitMs: 300 });

describe("a machine's forward", () => {
  test("started once: the machine is asked for its socket, then one connection forwards it; a second client finds it up", async () => {
    const w = world();
    const first = await ensureForward("box-a", OPTS(w.io));
    expect(first).toMatchObject({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "started", remote: { socket: "/home/sam/outlines/.host/host.sock", outlines: ["pie"] } });
    const asked = w.calls.find(c => c.includes(REMOTE_STATUS))!;
    expect(asked).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "box-a", REMOTE_STATUS]);
    const forward = w.calls.find(c => c.includes("-L"))!;
    expect(forward).toContain("/home/sam/outlines/.remote/box-a.sock:/home/sam/outlines/.host/host.sock");
    for (const opt of ["ExitOnForwardFailure=yes", "StreamLocalBindUnlink=yes", "ControlPersist=yes", "ServerAliveInterval=15"]) expect(forward).toContain(opt);
    expect(forward.slice(forward.indexOf("-S"), forward.indexOf("-S") + 2)).toEqual(["-S", "/home/sam/outlines/.remote/box-a.ctl"]);
    expect(forward.at(-2)).toBe("--");
    const before = w.calls.length;
    expect(await ensureForward("box-a", OPTS(w.io))).toEqual({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "up" });
    expect(w.calls.length).toBe(before);
    expect(w.files.size).toBe(0);   // the lock is let go
  });

  test("a connection that dropped is started again; one up whose forward doesn't answer is replaced", async () => {
    const w = world();
    await ensureForward("box-a", OPTS(w.io));
    w.drop();
    expect((await ensureForward("box-a", OPTS(w.io))).how).toBe("started");
    // Connected, but nothing answers through it (the host behind it went away for good): replaced, then said.
    const down = world({ hostDown: true });
    await ensureForward("box-a", OPTS(down.io)).catch(() => {});
    down.calls.length = 0;
    await expect(ensureForward("box-a", OPTS(down.io))).rejects.toThrow("no outline host answers through it");
    expect(down.calls.map(c => (c.includes("-O") ? c[c.indexOf("-O") + 1] : c.includes("-L") ? "forward" : "status"))).toEqual(["check", "exit", "status", "forward"]);
  });

  test("refusals say what to do: no ssh login, no ep0ch there, a forward that failed, a bad answer, a bad name", async () => {
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 255, out: "", err: "ssh: Could not resolve hostname box-a" } }).io)))
      .rejects.toThrow("can't reach box-a over ssh (ssh: Could not resolve hostname box-a) · `ssh box-a true`");
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 127, out: "", err: "sh: ep0ch: command not found" } }).io)))
      .rejects.toThrow("box-a has no ep0ch on a login shell's PATH");
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 1, out: "", err: "ep0ch: no outline host answers at /x/host.sock; start it" } }).io)))
      .rejects.toThrow("box-a says: ep0ch: no outline host answers at /x/host.sock; start it");
    await expect(ensureForward("box-a", OPTS(world({ forwardFails: "Warning: remote port forwarding failed" }).io)))
      .rejects.toThrow("couldn't forward its host socket /home/sam/outlines/.host/host.sock: Warning: remote port forwarding failed");
    expect(() => parseRemoteStatus("motd\nnot json", "box-a")).toThrow("didn't say where its outline host is");
    expect(parseRemoteStatus('Welcome!\n{"socket":"/s/host.sock","outlines":[{"name":"pie"},{"name":"jam"}]}', "box-a")).toEqual({ socket: "/s/host.sock", outlines: ["pie", "jam"] });
    expect(() => forwardPaths("/o", "-oProxyCommand=x")).toThrow("isn't an ssh config name");
  });

  test("its state, read without starting anything", async () => {
    const w = world();
    expect(await forwardState("box-a", OPTS(w.io))).toEqual({ machine: "box-a", socket: "/home/sam/outlines/.remote/box-a.sock", answers: false, connected: false });
    expect(w.calls.every(c => c.includes("check"))).toBe(true);
    await ensureForward("box-a", OPTS(w.io));
    expect(await forwardState("box-a", OPTS(w.io))).toMatchObject({ answers: true, connected: true });
    expect(sshArgv.exit("ssh", forwardPaths("/o", "box-a"))).toEqual(["ssh", "-S", "/o/.remote/box-a.ctl", "-O", "exit", "--", "box-a"]);
  });
});
