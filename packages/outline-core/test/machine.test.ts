import { describe, expect, test } from "bun:test";
import { ensureForward, forwardBehindLink, forwardPaths, forwardState, type MachineIO, parseRemoteStatus, REMOTE_STATUS, retireForward, sshArgv } from "../src/machine";

/**
 * A fictional machine reached over a fictional ssh, on a fictional clock: what each ssh call does to the world (the
 * connection, the forward, its log), the files, and every call made, in order.
 */
function world(o: { status?: { code: number; out: string; err?: string }; forwardFails?: string; hostDown?: boolean; slowAnswers?: number; linkAnswers?: boolean } = {}) {
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const routes = new Map<string, string>();
  const alive = new Set<number>([4242]);
  let connected = false, clock = 0, master = 700;
  const io: MachineIO = {
    async run(argv, _ms, how) {
      calls.push(argv);
      const op = argv.includes("-O") ? argv[argv.indexOf("-O") + 1] : argv.includes("-L") ? "forward" : "status";
      if (op === "check") return { code: connected ? 0 : 255, out: "", err: connected ? `Master running (pid=${master})` : "Control socket connect: No such file" };
      if (op === "exit") { const was = connected; connected = false; files.delete(argv[argv.indexOf("-S") + 1]!); return { code: was ? 0 : 255, out: "", err: "" }; }
      if (op === "forward") {
        expect(how?.detached).toBe(true);
        if (o.forwardFails) { files.set(argv[argv.indexOf("-E") + 1]!, `debug1: hello\n${o.forwardFails}\n`); return { code: 255, out: "", err: "" }; }
        connected = true; master++;
        files.set(argv[argv.indexOf("-S") + 1]!, "control");
        // ssh makes the forward's socket file (and, as OpenSSH does, leaves it there when it ends).
        files.set(argv[argv.indexOf("-L") + 1]!.split(":")[0]!, "socket");
        return { code: 0, out: "", err: "" };
      }
      return { err: "", ...(o.status ?? { code: 0, out: JSON.stringify({ socket: "/home/sam/outlines/.host/host.sock", outlines: [{ name: "jam-shelf" }] }) }) };
    },
    answers: async socket => {
      clock += o.slowAnswers ?? 0;
      if (routes.has(socket) || socket.endsWith(".link.sock")) return !!o.linkAnswers;
      return connected && !o.hostDown && files.has(socket);
    },
    privateDir: () => {},
    read: path => files.get(path) ?? null,
    exists: path => files.has(path),
    remove: path => { files.delete(path); routes.delete(path); },
    routeLink: (socket, target) => { files.set(socket, "route"); routes.set(socket, target); },
    route: socket => routes.get(socket) ?? null,
    createExclusive: (path, text) => (files.has(path) ? false : (files.set(path, text), true)),
    pid: 4242,
    alive: pid => alive.has(pid),
    now: () => clock,
    sleep: async ms => { clock += ms; },
  };
  return { io, calls, files, routes, alive, drop: () => { connected = false; }, get connected() { return connected; }, get master() { return master; } };
}
const OPTS = (io: MachineIO) => ({ ssh: "ssh", outlines: "/home/sam/outlines", io, waitMs: 300 });
const ops = (calls: string[][]) => calls.map(c => (c.includes("-O") ? c[c.indexOf("-O") + 1] : c.includes("-L") ? "forward" : "status"));

describe("a machine's forward", () => {
  test("started once: the machine is asked for its socket, then one connection forwards it; a second client finds it up", async () => {
    const w = world();
    const first = await ensureForward("box-a", OPTS(w.io));
    expect(first).toMatchObject({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "started", remote: { socket: "/home/sam/outlines/.host/host.sock", outlines: ["jam-shelf"] } });
    expect(w.calls.find(c => c.includes(REMOTE_STATUS))).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "box-a", REMOTE_STATUS]);
    const forward = w.calls.find(c => c.includes("-L"))!;
    expect(forward).toContain("/home/sam/outlines/.remote/box-a.sock:/home/sam/outlines/.host/host.sock");
    for (const opt of ["ExitOnForwardFailure=yes", "StreamLocalBindUnlink=yes", "ControlPersist=yes", "ServerAliveInterval=15"]) expect(forward).toContain(opt);
    expect(forward.slice(forward.indexOf("-S"), forward.indexOf("-S") + 4)).toEqual(["-S", "/home/sam/outlines/.remote/box-a.ctl", "-E", "/home/sam/outlines/.remote/box-a.log"]);
    expect(forward.at(-2)).toBe("--");
    const before = w.calls.length;
    expect(await ensureForward("box-a", OPTS(w.io))).toEqual({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "up", transport: "ssh" });
    expect(w.calls.length).toBe(before);
    expect([...w.files.keys()].filter(f => f.endsWith(".lock"))).toEqual([]);   // the lock is let go
  });

  test("a machine whose file names its outlines folder is forwarded there without asking its ep0ch; a bad file is said", async () => {
    const w = world();
    w.files.set("/home/sam/outlines/.remote/box-a.json", JSON.stringify({ outlines: "/home/sam/echo-outlines" }));
    expect(await ensureForward("box-a", OPTS(w.io))).toMatchObject({ how: "started", remote: { socket: "/home/sam/echo-outlines/.host/host.sock" } });
    expect(ops(w.calls)).toEqual(["check", "forward"]);
    expect(w.calls.find(c => c.includes("-L"))).toContain("/home/sam/outlines/.remote/box-a.sock:/home/sam/echo-outlines/.host/host.sock");
    const bad = world();
    bad.files.set("/home/sam/outlines/.remote/box-a.json", JSON.stringify({ outlines: "~/echo-outlines" }));
    await expect(ensureForward("box-a", OPTS(bad.io))).rejects.toThrow('should be { "outlines": "/absolute/folder/on/box-a" }');
  });

  test("a connection that dropped is started again; one up whose host doesn't answer is left up and said", async () => {
    const w = world();
    await ensureForward("box-a", OPTS(w.io));
    w.drop();
    expect((await ensureForward("box-a", OPTS(w.io))).how).toBe("started");
    // Connected, but nothing answers through it (its host restarting): never ended here, other clients share it.
    const down = world({ hostDown: true });
    await ensureForward("box-a", OPTS(down.io)).catch(() => {});
    down.calls.length = 0;
    await expect(ensureForward("box-a", OPTS(down.io))).rejects.toThrow("connected to box-a, but no outline host answers through the forward (it may be restarting");
    expect(ops(down.calls)).toEqual(["check"]);
    expect(down.connected).toBe(true);
  });

  test("the lock: a live holder is waited for by the clock, a dead one's lock is taken over", async () => {
    const w = world();
    const lock = "/home/sam/outlines/.remote/box-a.ctl.lock";
    // A holder that died mid-start: its lock is taken over at once.
    w.files.set(lock, "777");
    expect((await ensureForward("box-a", OPTS(w.io))).how).toBe("started");
    expect(w.files.has(lock)).toBe(false);
    // A live holder that never lets go: waited for two minutes of the clock, then said.
    const v = world({ slowAnswers: 3000 });
    v.alive.add(555);
    v.files.set(lock, "555");
    await expect(ensureForward("box-a", OPTS(v.io))).rejects.toThrow("another client (pid 555) has been starting this forward for two minutes");
    expect(v.files.get(lock)).toBe("555");
  });

  test("refusals say what to do: no ssh login, no ep0ch there, a forward that failed (from its log), a bad answer, a bad name", async () => {
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 255, out: "", err: "ssh: Could not resolve hostname box-a" } }).io)))
      .rejects.toThrow("can't reach box-a over ssh (ssh: Could not resolve hostname box-a) · `ssh box-a true`");
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 127, out: "", err: "sh: ep0ch: command not found" } }).io)))
      .rejects.toThrow("box-a has no ep0ch on a login shell's PATH");
    await expect(ensureForward("box-a", OPTS(world({ status: { code: 1, out: "", err: "ep0ch: no outline host answers at /x/host.sock; start it" } }).io)))
      .rejects.toThrow("box-a says: ep0ch: no outline host answers at /x/host.sock; start it");
    await expect(ensureForward("box-a", OPTS(world({ forwardFails: "Warning: remote port forwarding failed" }).io)))
      .rejects.toThrow("couldn't forward its host socket /home/sam/outlines/.host/host.sock: Warning: remote port forwarding failed");
    expect(() => parseRemoteStatus("motd\nnot json", "box-a")).toThrow("didn't say where its outline host is");
    // A motd before the answer and words after it are passed over; braces in them too.
    expect(parseRemoteStatus('Welcome {friend}!\n{\n "socket": "/s/host.sock",\n "outlines": [{"name":"jam-shelf"},{"name":"garden"}]\n}\nbye\n', "box-a")).toEqual({ socket: "/s/host.sock", outlines: ["jam-shelf", "garden"] });
    expect(() => forwardPaths("/o", "-oProxyCommand=x")).toThrow("isn't an ssh config name");
    expect(() => forwardPaths(`/${"o".repeat(70)}`, "box-a")).toThrow("too long for a socket's path");
  });

  test("a link that comes up while SSH serves takes the socket by one rename, and SSH is ended only once nothing rides it", async () => {
    // PIE-1779: the link once ended SSH under every read in flight, then waited for a socket file OpenSSH never removes.
    const w = world({ linkAnswers: true });
    const sock = "/home/sam/outlines/.remote/box-a.sock", link = "/home/sam/outlines/.remote/box-a.link.sock";
    expect((await ensureForward("box-a", OPTS(w.io))).transport).toBe("ssh");
    w.files.set("/home/sam/outlines/.remote/box-a.link.json", JSON.stringify({ machine: "box-a", pid: 4242, up: true, streams: true }));
    w.calls.length = 0;
    expect(await ensureForward("box-a", OPTS(w.io))).toEqual({ socket: sock, how: "up", transport: "link" });
    expect(w.routes.get(sock)).toBe(link);
    expect(ops(w.calls)).toEqual([]);
    expect(w.connected).toBe(true);
    // Up and routed: the next client finds it without the lock or an ssh call.
    expect((await ensureForward("box-a", OPTS(w.io))).transport).toBe("link");
    expect(ops(w.calls)).toEqual([]);
    // The link's server ends the connection later, by its pid; never another that started since, nor one that serves.
    const behind = await forwardBehindLink("box-a", OPTS(w.io));
    expect(behind).toBe(w.master);
    expect(await retireForward("box-a", behind! + 1, OPTS(w.io))).toBe(false);
    expect(w.connected).toBe(true);
    expect(await retireForward("box-a", behind!, OPTS(w.io))).toBe(true);
    expect(w.connected).toBe(false);
    expect(await forwardBehindLink("box-a", OPTS(w.io))).toBeNull();
    const ssh = world();
    await ensureForward("box-a", OPTS(ssh.io));
    expect(await forwardBehindLink("box-a", OPTS(ssh.io))).toBeNull();
    expect(await retireForward("box-a", ssh.master, OPTS(ssh.io))).toBe(false);
    expect(ssh.connected).toBe(true);
  });

  test("once the link has gone, an SSH connection it took the socket from is ended and started again; a link on another protocol leaves SSH be", async () => {
    const w = world({ linkAnswers: true });
    const sock = "/home/sam/outlines/.remote/box-a.sock", state = "/home/sam/outlines/.remote/box-a.link.json";
    await ensureForward("box-a", OPTS(w.io));
    w.files.set(state, JSON.stringify({ machine: "box-a", pid: 4242, up: true }));
    await ensureForward("box-a", OPTS(w.io));
    // The link drops: its server removes its route; the connection is still up, with no socket of its own.
    w.files.set(state, JSON.stringify({ machine: "box-a", pid: 4242, up: false }));
    w.io.remove(sock);
    w.calls.length = 0;
    expect(await ensureForward("box-a", OPTS(w.io))).toMatchObject({ how: "started", transport: "ssh" });
    expect(ops(w.calls)).toEqual(["check", "exit", "status", "forward"]);
    // A route left behind by a link that went without saying so (a crash) is no forward either.
    w.io.routeLink(sock, "/home/sam/outlines/.remote/box-a.link.sock");
    w.drop();
    expect(await ensureForward("box-a", OPTS(w.io))).toMatchObject({ how: "started", transport: "ssh" });
    expect(w.routes.has(sock)).toBe(false);
    // A link on another protocol carries no reads: SSH keeps the machine.
    w.files.set(state, JSON.stringify({ machine: "box-a", pid: 4242, up: true, streams: false }));
    w.calls.length = 0;
    expect(await ensureForward("box-a", OPTS(w.io))).toMatchObject({ how: "up", transport: "ssh" });
    expect(ops(w.calls)).toEqual([]);
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
