import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import { ensureForward, forwardPaths, forwardState, type ForwardError, MachineIO, parseRemoteStatus } from "../src/machine";
import { REMOTE_STATUS as LEGACY_REMOTE_STATUS } from "@ep0ch/outline-core/machine";

/**
 * A fictional machine reached over a fictional ssh: what each ssh call does to the world (the connection, the
 * forward, its log), the files, and every call made, in order. The same world as outline-core's test, as a Layer.
 * Time is Effect's TestClock: nothing here sleeps for real.
 */
function world(o: { status?: { code: number; out: string; err?: string }; forwardFails?: string; hostDown?: boolean } = {}) {
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const alive = new Set<number>([4242]);
  let connected = false;
  const layer = MachineIO.fromLegacy({
    async run(argv, _ms, how) {
      calls.push(argv);
      const op = argv.includes("-O") ? argv[argv.indexOf("-O") + 1] : argv.includes("-L") ? "forward" : "status";
      if (op === "check") return { code: connected ? 0 : 255, out: "", err: connected ? "" : "Control socket connect: No such file" };
      if (op === "exit") { const was = connected; connected = false; return { code: was ? 0 : 255, out: "", err: "" }; }
      if (op === "forward") {
        expect(how?.detached).toBe(true);
        if (o.forwardFails) { files.set(argv[argv.indexOf("-E") + 1]!, `debug1: hello\n${o.forwardFails}\n`); return { code: 255, out: "", err: "" }; }
        connected = true;
        return { code: 0, out: "", err: "" };
      }
      return { err: "", ...(o.status ?? { code: 0, out: JSON.stringify({ socket: "/home/sam/outlines/.host/host.sock", outlines: [{ name: "jam-shelf" }] }) }) };
    },
    answers: async () => connected && !o.hostDown,
    privateDir: () => {},
    read: path => files.get(path) ?? null,
    remove: path => { files.delete(path); },
    createExclusive: (path, text) => (files.has(path) ? false : (files.set(path, text), true)),
    pid: 4242,
    alive: pid => alive.has(pid),
    now: () => 0,
    sleep: async () => {},
  });
  return { layer, calls, files, alive, drop: () => { connected = false; }, get connected() { return connected; } };
}
const OPTS = { ssh: "ssh", outlines: "/home/sam/outlines", waitMs: 300 };
const ops = (calls: string[][]) => calls.map(c => (c.includes("-O") ? c[c.indexOf("-O") + 1] : c.includes("-L") ? "forward" : "status"));

/** Run under the world's Layer and the TestClock, advancing the clock by `advance` once the effect is waiting. */
function run<A, E>(w: ReturnType<typeof world>, eff: Effect.Effect<A, E, MachineIO>, advance: Duration.Input = "0 seconds"): Promise<A> {
  return Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(eff);
    yield* TestClock.adjust(advance);
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(Layer.mergeAll(w.layer, TestClock.layer()))));
}
const fails = <A>(w: ReturnType<typeof world>, eff: Effect.Effect<A, ForwardError, MachineIO>, advance?: Duration.Input) => run(w, Effect.flip(eff), advance);

describe("a machine's forward, on Effect", () => {
  test("started once: the machine is asked for its socket, then one connection forwards it; a second client finds it up", async () => {
    const w = world();
    const first = await run(w, ensureForward("box-a", OPTS));
    expect(first).toMatchObject({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "started", remote: { socket: "/home/sam/outlines/.host/host.sock", outlines: ["jam-shelf"] } });
    expect(w.calls.find(c => c.includes(LEGACY_REMOTE_STATUS))).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "box-a", LEGACY_REMOTE_STATUS]);
    const forward = w.calls.find(c => c.includes("-L"))!;
    expect(forward).toContain("/home/sam/outlines/.remote/box-a.sock:/home/sam/outlines/.host/host.sock");
    const before = w.calls.length;
    expect(await run(w, ensureForward("box-a", OPTS))).toEqual({ socket: "/home/sam/outlines/.remote/box-a.sock", how: "up" });
    expect(w.calls.length).toBe(before);
    expect([...w.files.keys()].filter(f => f.endsWith(".lock"))).toEqual([]);   // the lock is let go
  });

  test("a connection that dropped is started again; one up whose host doesn't answer is left up and said, with its tag and command", async () => {
    const w = world();
    await run(w, ensureForward("box-a", OPTS));
    w.drop();
    expect((await run(w, ensureForward("box-a", OPTS))).how).toBe("started");
    const down = world({ hostDown: true });
    await fails(down, ensureForward("box-a", OPTS), "1 second");
    down.calls.length = 0;
    const e = await fails(down, ensureForward("box-a", OPTS), "3 seconds");
    expect(e._tag).toBe("HostSilent");
    expect(e.message).toContain("connected to box-a, but no outline host answers through the forward (it may be restarting");
    expect((e as any).command).toBe("ssh box-a ep0ch status");
    expect(ops(down.calls)).toEqual(["check"]);
    expect(down.connected).toBe(true);
    expect([...down.files.keys()].filter(f => f.endsWith(".lock"))).toEqual([]);   // let go on the failure path too
  });

  test("the lock: a dead holder's lock is taken over at once; a live one is waited for two minutes of the clock, then said, and the lock is theirs still", async () => {
    const w = world();
    const lock = "/home/sam/outlines/.remote/box-a.ctl.lock";
    w.files.set(lock, "777");
    expect((await run(w, ensureForward("box-a", OPTS))).how).toBe("started");
    expect(w.files.has(lock)).toBe(false);
    const v = world();
    v.alive.add(555);
    v.files.set(lock, "555");
    const e = await fails(v, ensureForward("box-a", OPTS), "3 minutes");
    expect(e._tag).toBe("LockHeld");
    expect(e.message).toBe("another client (pid 555) has been starting this forward for two minutes (/home/sam/outlines/.remote/box-a.ctl.lock)");
    expect(v.files.get(lock)).toBe("555");
  });

  test("the lock is let go when the waiter is interrupted (a client that quits mid-start)", async () => {
    const w = world({ hostDown: true });
    const lock = "/home/sam/outlines/.remote/box-a.ctl.lock";
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(ensureForward("box-a", OPTS));
      yield* TestClock.adjust("150 millis");   // inside answersWithin's wait, holding the lock
      expect(w.files.get(lock)).toBe("4242");
      yield* Fiber.interrupt(fiber);
      expect(w.files.has(lock)).toBe(false);
    }).pipe(Effect.provide(Layer.mergeAll(w.layer, TestClock.layer()))));
  });

  test("refusals are typed, say what to do, and encode as JSON for the wire", async () => {
    const unreachable = await fails(world({ status: { code: 255, out: "", err: "ssh: Could not resolve hostname box-a" } }), ensureForward("box-a", OPTS));
    expect(unreachable).toMatchObject({ _tag: "MachineRefused", reason: "unreachable", command: "ssh box-a true" });
    expect(unreachable.message).toBe("can't reach box-a over ssh (ssh: Could not resolve hostname box-a) · `ssh box-a true` should work without asking anything (a key, or an agent)");
    expect(JSON.parse(JSON.stringify(unreachable))).toEqual({ _tag: "MachineRefused", machine: "box-a", reason: "unreachable", said: "ssh: Could not resolve hostname box-a" });
    expect((await fails(world({ status: { code: 127, out: "", err: "sh: ep0ch: command not found" } }), ensureForward("box-a", OPTS))).message).toContain("box-a has no ep0ch on a login shell's PATH");
    expect((await fails(world({ status: { code: 1, out: "", err: "ep0ch: no outline host answers at /x/host.sock; start it" } }), ensureForward("box-a", OPTS))).message).toBe("box-a says: ep0ch: no outline host answers at /x/host.sock; start it");
    expect((await fails(world({ forwardFails: "Warning: remote port forwarding failed" }), ensureForward("box-a", OPTS))).message)
      .toContain("couldn't forward its host socket /home/sam/outlines/.host/host.sock: Warning: remote port forwarding failed");
    expect(Effect.runSync(Effect.flip(parseRemoteStatus("motd\nnot json", "box-a"))).message).toContain("didn't say where its outline host is");
    expect(Effect.runSync(parseRemoteStatus('Welcome {friend}!\n{\n "socket": "/s/host.sock",\n "outlines": [{"name":"jam-shelf"},{"name":"garden"}]\n}\nbye\n', "box-a"))).toEqual({ socket: "/s/host.sock", outlines: ["jam-shelf", "garden"] });
    expect(Effect.runSync(Effect.flip(forwardPaths("/o", "-oProxyCommand=x")))._tag).toBe("NotAMachineName");
    expect(Effect.runSync(Effect.flip(forwardPaths(`/${"o".repeat(70)}`, "box-a")))._tag).toBe("SocketPathTooLong");
  });

  test("its state, read without starting anything", async () => {
    const w = world();
    expect(await run(w, forwardState("box-a", OPTS))).toEqual({ machine: "box-a", socket: "/home/sam/outlines/.remote/box-a.sock", answers: false, connected: false });
    expect(w.calls.every(c => c.includes("check"))).toBe(true);
    await run(w, ensureForward("box-a", OPTS));
    expect(await run(w, forwardState("box-a", OPTS))).toMatchObject({ answers: true, connected: true });
  });
});
