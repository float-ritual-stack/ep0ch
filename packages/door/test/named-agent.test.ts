// A named agent is one hc terminal. Pure checks never touch a core. The scratch check uses its own
// HC_SESSION and stops only that core. It aborts before `hc run` when that core is the person's.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawerProgram } from "../src/desk/drawer-program";
import { NamedAgentCard } from "../src/desk/named-agent-card";
import {
  hcAttachArgv, hcRunArgv, lookNamed, namedFromFolder, parseAgentsToml, startNamedAgent,
  type NamedAgent,
} from "../src/desk/named-agent";

const remote: NamedAgent = {
  persona: "loki", machine: "float-box", folder: "/home/evan/projects/ep0ch", program: "claude", outline: "pie",
};
const local: NamedAgent = {
  persona: "cowboy", machine: "", folder: "/Users/evan/float-hub", program: "claude", outline: "float-hub",
};

describe("the one hc line", () => {
  test("remote names the machine; local omits --on", () => {
    expect(hcRunArgv(remote)).toEqual([
      "hc", "run", "--bg", "--no-parent", "--keep",
      "--name", "loki", "--cwd", "/home/evan/projects/ep0ch",
      "--label", "ep0ch.outline=pie", "--label", "ep0ch.persona=loki",
      "--on", "float-box", "--", "claude",
    ]);
    expect(hcRunArgv(local)).toEqual([
      "hc", "run", "--bg", "--no-parent", "--keep",
      "--name", "cowboy", "--cwd", "/Users/evan/float-hub",
      "--label", "ep0ch.outline=float-hub", "--label", "ep0ch.persona=cowboy",
      "--", "claude",
    ]);
    expect(hcAttachArgv(remote)).toEqual(["hc", "attach", "float-box/loki"]);
    expect(hcAttachArgv(local)).toEqual(["hc", "attach", "cowboy"]);
    expect(hcAttachArgv(remote, true)).toEqual(["hc", "attach", "--observe", "float-box/loki"]);
  });

  test("a row that is not an hc name, a bad machine, a missing folder, or a duplicate is refused", () => {
    const file = "/tmp/agents.toml";
    expect(() => parseAgentsToml('[[agent]]\npersona = "Loki"\nfolder = "/a"\n', file, "pie")).toThrow(/not an hc name/);
    expect(() => parseAgentsToml('[[agent]]\npersona = "loki"\nmachine = "bad name"\nfolder = "/a"\n', file, "pie")).toThrow(/not an ssh name/);
    expect(() => parseAgentsToml('[[agent]]\npersona = "loki"\n', file, "pie")).toThrow(/needs folder/);
    expect(() => parseAgentsToml('[[agent]]\npersona = "loki"\nfolder = "/a"\n[[agent]]\npersona = "loki"\nfolder = "/b"\n', file, "pie")).toThrow(/listed twice/);
    expect(parseAgentsToml('[[agent]]\npersona = "loki"\nfolder = "~/projects/ep0ch"\n', file, "pie", "/home/evan")).toEqual([
      { persona: "loki", machine: "", folder: "/home/evan/projects/ep0ch", program: "claude", outline: "pie" },
    ]);
  });
});

describe("what the card says", () => {
  test("missing, ended, taken, and a local name that is not the remote row", () => {
    const none = lookNamed(remote, [], null);
    expect(none.kind).toBe("missing");
    if (none.kind !== "missing") return;
    expect(none.title).toBe("no agent named loki on float-box");
    expect(none.lines.join("\n")).toContain("hc ls there: nothing");
    expect(none.buttons).toEqual([["start loki", "named.start"], ["a shell here", "host.shell"]]);

    const wrongMachine = lookNamed(remote, [{ address: "loki", name: "loki", state: "live" }], null);
    expect(wrongMachine.kind).toBe("missing");

    const live = lookNamed(remote, [{ address: "float-box/loki", name: "loki", state: "live" }], { labels: { "ep0ch.outline": "pie", "ep0ch.persona": "loki" } });
    expect(live).toEqual({ kind: "live", address: "float-box/loki", argv: ["hc", "attach", "float-box/loki"] });

    const taken = lookNamed(remote, [{ address: "float-box/loki", name: "loki", state: "live" }], { labels: { "ep0ch.persona": "loki", "ep0ch.outline": "other" } });
    expect(taken.kind).toBe("taken");
    if (taken.kind !== "taken") return;
    expect(taken.lines.join(" ")).toContain("Nothing was started.");
    expect(taken.buttons).toEqual([["a shell here", "host.shell"]]);

    const ended = lookNamed(remote, [], { state: "finished", exit_code: 3, reason: "exited" }, ["last line"]);
    expect(ended.kind).toBe("ended");
    if (ended.kind !== "ended") return;
    expect(ended.title).toBe("loki on float-box ended (exit 3)");
    expect(ended.exit).toBe(3);
    expect(ended.lines[0]).toBe("last line");
    expect(ended.buttons[0]?.[0]).toBe("start loki");

    const down = lookNamed(remote, [], null, [], "hc isn't on PATH. Install herder-core, then: hc server status");
    expect(down.kind).toBe("unreachable");
    if (down.kind !== "unreachable") return;
    expect(down.lines.join("\n")).toContain("Run: hc server status");
    expect(down.buttons).toEqual([["start loki", "named.start"], ["a shell here", "host.shell"]]);
  });

  test("the card draws the two pressable rows", () => {
    const look = lookNamed(remote, [], null);
    if (look.kind === "live") throw new Error("a missing agent rendered as live");
    const lines = new NamedAgentCard(look).render(80, 24).lines.join("\n");
    expect(lines).toContain("[start loki]");
    expect(lines).toContain("[a shell here]");
    expect(lines).toContain("no agent named loki on float-box");
  });
});

describe("which row this outline uses", () => {
  const root = mkdtempSync(join(tmpdir(), "ep0ch-named-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("the outline's machine and the process machine are different fields", () => {
    const folder = join(root, "pie");
    mkdirSync(join(folder, ".ep0ch"), { recursive: true });
    writeFileSync(join(folder, ".ep0ch", "config.toml"), 'ws = "pie"\nagent = "loki"\n');
    writeFileSync(join(folder, ".ep0ch", "agents.toml"), '[[agent]]\npersona = "loki"\nmachine = "float-box"\nfolder = "~/projects/ep0ch"\nprogram = "claude"\n');
    const home = join(root, "home");
    expect(namedFromFolder({ start: folder, outline: "pie", machine: null, home })).toMatchObject({
      persona: "loki", machine: "float-box", folder: join(home, "projects", "ep0ch"), outline: "pie",
    });
    // The door is on float-2 and this .ep0ch names no machine: named mode stays off.
    expect(namedFromFolder({ start: folder, outline: "pie", machine: "float-2", home })).toBeNull();
    writeFileSync(join(folder, ".ep0ch", "config.toml"), 'ws = "pie"\nmachine = "float-2"\nagent = "loki"\n');
    expect(namedFromFolder({ start: folder, outline: "pie", machine: "float-2", home })?.machine).toBe("float-box");
  });

  test("a bad agents.toml is a shell, with the error, and does not throw", () => {
    const folder = join(root, "bad");
    mkdirSync(join(folder, ".ep0ch"), { recursive: true });
    writeFileSync(join(folder, ".ep0ch", "config.toml"), 'ws = "pie"\nagent = "Loki"\n');
    writeFileSync(join(folder, ".ep0ch", "agents.toml"), '[[agent]]\npersona = "Loki"\nfolder = "/a"\n');
    const p = drawerProgram({ env: { SHELL: "/bin/zsh" }, outline: "pie", start: folder, home: root });
    expect(p.cmd).toEqual(["/bin/zsh"]);
    expect(p.from).toBe("none");
    expect(p.programWhy).toContain("not an hc name");
  });
});

describe("a scratch hc core", () => {
  // macOS sockets stop at 103 bytes. os.tmpdir() is /var/folders/…, and hc refuses that path.
  const dir = mkdtempSync("/tmp/hcna-");
  const cfg = `${dir}-cfg`;
  mkdirSync(cfg);
  const name = "ep0chhcagt";
  const bin = process.env.HC_BIN || "hc";
  let userPid = 0;
  let scratchPid: number | null = null;

  // The door preload points XDG_STATE_HOME at a temp dir. `hc server status` there exits 2
  // with the error on stderr, so it is not the person's core. Drop that one variable.
  const userHcEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    delete env.XDG_STATE_HOME;
    return env;
  };
  const scratch: Record<string, string> = {
    ...userHcEnv(),
    HOME: dir,
    HC_SESSION: "scratch-named-agent-test",
    XDG_STATE_HOME: dir,
    XDG_CONFIG_HOME: cfg,
  };
  const pidOf = (env: Record<string, string | undefined>): number | null => {
    const r = Bun.spawnSync([bin, "server", "status"], { env, stdout: "pipe", stderr: "pipe", timeout: 8_000 });
    for (const buf of [r.stdout, r.stderr]) {
      try {
        const j = JSON.parse(buf.toString()) as { pid?: unknown };
        if (typeof j.pid === "number") return j.pid;
      } catch { /* the other stream, or an error object with no pid */ }
    }
    return null;
  };
  const userHasName = (): boolean => Bun.spawnSync([bin, "get", "--json", name], {
    env: userHcEnv(), stdout: "pipe", stderr: "pipe", timeout: 8_000,
  }).exitCode === 0;

  afterAll(() => {
    try {
      if (scratchPid !== null && scratchPid !== userPid) {
        Bun.spawnSync([bin, "kill", name], { env: scratch, stdout: "pipe", stderr: "pipe", timeout: 8_000 });
        const stop = Bun.spawnSync([bin, "server", "stop"], { env: scratch, stdout: "pipe", stderr: "pipe", timeout: 8_000 });
        let stopped = false;
        try { stopped = JSON.parse(stop.stdout.toString()).stopped === true; } catch { stopped = false; }
        if (!stopped) {
          const left = pidOf(scratch);
          if (left !== null && left !== userPid) {
            const ps = Bun.spawnSync(["ps", "eww", "-p", String(left)], { stdout: "pipe", stderr: "pipe" });
            const mine = ps.stdout.toString().includes(dir);
            if (!mine) throw new Error("scratch core was still up and its process did not show the scratch state dir; left it alone");
            Bun.spawnSync(["kill", String(left)], { stdout: "pipe", stderr: "pipe" });
          }
        }
      }
      if (userPid) expect(pidOf(userHcEnv())).toBe(userPid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    }
  });

  test("start leaves a live terminal alone, and a killed name can start again", () => {
    userPid = pidOf(userHcEnv()) ?? 0;
    expect(userPid).toBeGreaterThan(0);
    if (userHasName()) throw new Error(`${name} already exists on the user core; not starting or killing it`);
    scratchPid = pidOf(scratch);
    if (scratchPid === null) throw new Error("scratch hc server status gave no pid; not starting a terminal");
    if (scratchPid === userPid) throw new Error("scratch hc server status is the user core; not starting a terminal");
    const agent: NamedAgent = { persona: name, machine: "", folder: dir, program: "sleep 30", outline: "scratch" };
    const first = startNamedAgent(agent, scratch);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.started).toBe(true);
    // hc's address is the terminal id (`t1`). The persona is the name: the second start finds that name still live.
    expect(first.address).toMatch(/^t\d+$/);
    expect(first.argv).toEqual(hcRunArgv(agent));
    expect(userHasName()).toBe(false);
    const again = startNamedAgent(agent, scratch);
    expect(again).toMatchObject({ ok: true, started: false, address: first.address });
    const killed = Bun.spawnSync([bin, "kill", name], { env: scratch, stdout: "pipe", stderr: "pipe", timeout: 8_000 });
    expect(killed.exitCode).toBe(0);
    const reused = startNamedAgent(agent, scratch);
    expect(reused).toMatchObject({ ok: true, started: true });
    expect(Bun.spawnSync([bin, "kill", name], { env: scratch, stdout: "pipe", stderr: "pipe", timeout: 8_000 }).exitCode).toBe(0);
    expect(pidOf(userHcEnv())).toBe(userPid);
    expect(userHasName()).toBe(false);
  }, 60_000);
});
