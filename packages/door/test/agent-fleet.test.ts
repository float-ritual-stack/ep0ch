// `ep0ch agent ls` and `ep0ch agent restart` (PIE-1273): the person-facing front door for scripts/agent-restart. A person
// fires it from a laptop at the machine the sessions run on, so what matters is the words and the hop: a session that is
// behind the installed Claude Code is marked, a name that matches nothing (or several) is said to the caller before the
// restart detaches (not into a log), the ssh hop carries a name with spaces and quotes, and a machine that can't be
// reached or lacks ep0ch says the command to run. Nothing here stops a real session: the "other machine" is a scratch
// HOME with a made-up `claude` that only lists made-up sessions and logs a `stop`; `--dry-run` and refusals never get there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentLs, agentRestart, type FleetIO, formatSessions, restartArgs, type SessionRow } from "../src/agent-fleet";
import { outliner, scratchDir } from "./scratch";

const MAIN = resolve(import.meta.dir, "../src/main.ts");

describe("the arguments of agent restart", () => {
  test("a session, its flags and --bg", () => {
    expect(restartArgs(["loki", "--fresh-daemon", "--check-env", "OTEL_TRACES_EXPORTER"])).toEqual({ args: ["loki", "--fresh-daemon", "--check-env", "OTEL_TRACES_EXPORTER"], dry: false });
    expect(restartArgs(["--all", "--if-update", "--machine", "far-box"])).toEqual({ machine: "far-box", args: ["--all", "--if-update"], dry: false });
  });
  test("a dry run says its plan to the caller", () => {
    expect(restartArgs(["loki", "--dry-run"])).toEqual({ args: ["loki", "--dry-run"], dry: true });
  });
  test.each([
    [[], "which session?"],
    [["--machine", "far-box"], "ep0ch agent ls --machine far-box"],
    [["a", "b"], "one session at a time"],
    [["a", "--nope"], "no flag --nope"],
    [["a", "--check-env"], "--check-env needs an environment variable's name"],
    [["a", "--check-env", "A;rm"], "--check-env needs an environment variable's name"],
    [["a", "--machine"], "--machine needs an ssh config name"],
    [["a", "--machine", "bad name"], "isn't an ssh config name"],
  ])("%j is refused with the way out", (argv, said) => {
    const r = restartArgs(argv);
    expect("error" in r && r.error).toContain(said);
  });
});

const row = (o: Partial<SessionRow>): SessionRow => ({ name: "loki", id: "d9ed7782", sessionId: "d9ed7782-0000", kind: "background", status: "busy", cwd: "/x", place: null, running: "2.1.310", installed: "2.1.310", behind: false, ...o });

describe("agent ls words", () => {
  test("a session behind the installed version is marked, with the command that restarts what is behind", () => {
    const text = formatSessions([row({}), row({ name: "gpty", id: "0f3a9c21", status: "waiting", running: "2.1.308", installed: "2.1.310", behind: true })], "far-box");
    expect(text).toMatch(/gpty\s+0f3a9c21\s+background\s+waiting\s+2\.1\.308\s+behind 2\.1\.310/);
    expect(text).toMatch(/loki\s+d9ed7782\s+background\s+busy\s+2\.1\.310\s+current/);
    expect(text).toContain("1 background behind the installed 2.1.310: ep0ch agent restart --all --if-update --machine far-box");
  });
  test("an interactive session is listed with where it runs, and not offered to the restart", () => {
    const text = formatSessions([row({ name: "kitty-sr", id: "5f2a9c10", kind: "interactive", status: "waiting", running: "2.1.308", behind: true, place: "door terminal tile (outline gurgle)" })]);
    expect(text).toMatch(/kitty-sr\s+5f2a9c10\s+interactive\s+waiting\s+2\.1\.308\s+behind 2\.1\.310 · door terminal tile \(outline gurgle\)/);
    expect(text).toContain("1 interactive behind (kitty-sr): a terminal owns each, so restart the program there: /exit, then claude --continue");
    expect(text).not.toContain("--all --if-update");
  });
  test("none, and a process that can't be read", () => {
    expect(formatSessions([], "far-box")).toContain("no Claude sessions on far-box");
    expect(formatSessions([row({ running: null })])).toContain("can't be read");
  });
});

/** A made-up io: records what ran, answers what it is given. */
function fakeIO(o: { script?: string; local?: (argv: string[]) => Promise<{ code: number; out: string; err: string }>; remote?: (m: string, c: string) => Promise<{ code: number; out: string; err: string }> }) {
  const calls: string[][] = [];
  const io: FleetIO = {
    script: () => o.script ?? import.meta.path,   // any file that exists
    local: async argv => { calls.push(["local", ...argv.slice(1)]); return o.local ? o.local(argv) : { code: 0, out: "", err: "" }; },
    remote: async (m, c) => { calls.push(["remote", m, c]); return o.remote ? o.remote(m, c) : { code: 0, out: "", err: "" }; },
  };
  return { io, calls };
}
const collect = () => { const out: string[] = [], err: string[] = []; return { out, err, o: (s: string) => out.push(s), e: (s: string) => err.push(s) }; };
const bg = "agent-restart: running in the background (pid 42); it waits for a safe moment. Log: ~/.local/state/ep0ch/agent-restart.log";

describe("agent restart: where it runs and what it says", () => {
  test("here: the installed checkout's script, detached, and where to follow it", async () => {
    const { io, calls } = fakeIO({ local: async () => ({ code: 0, out: bg + "\n", err: "" }) });
    const c = collect();
    expect(await agentRestart(["loki", "--now"], {}, io, c.o, c.e)).toBe(0);
    expect(calls).toEqual([["local", "loki", "--now", "--bg"]]);
    expect(c.out.join("\n")).toContain("running in the background");
    expect(c.out.join("\n")).toContain("follow it: tail -f ~/.local/state/ep0ch/agent-restart.log");
  });
  test("on a machine: ep0ch there, the name quoted for the hop, the machine named in what comes back", async () => {
    const { io, calls } = fakeIO({ remote: async () => ({ code: 0, out: bg + "\n", err: "" }) });
    const c = collect();
    expect(await agentRestart(["--machine", "far-box", "it's (2)", "--fresh-daemon"], {}, io, c.o, c.e)).toBe(0);
    expect(calls).toEqual([["remote", "far-box", `ep0ch agent restart 'it'\\''s (2)' '--fresh-daemon'`]]);
    expect(c.out.join("\n")).toContain("far-box: agent-restart: running in the background");
    expect(c.out.join("\n")).toContain("follow it: ssh far-box 'tail -f ~/.local/state/ep0ch/agent-restart.log'");
  });
  test("this machine's own name is here, not an ssh to itself", async () => {
    const { io, calls } = fakeIO({});
    expect(await agentRestart(["loki", "--machine", "boxy", "--dry-run"], { EP0CH_MACHINE_NAME: "boxy" }, io, () => {}, () => {})).toBe(0);
    expect(calls[0]![0]).toBe("local");
  });
  test("the script's refusal reaches the caller with its code", async () => {
    const { io } = fakeIO({ local: async () => ({ code: 2, out: "", err: 'agent-restart: no running session matches "x" (ep0ch agent ls lists them)\n' }) });
    const c = collect();
    expect(await agentRestart(["x"], {}, io, c.o, c.e)).toBe(2);
    expect(c.err.join("\n")).toContain("no running session matches");
  });
  test("a checkout without the script says what to run", async () => {
    const { io } = fakeIO({ script: "/nonexistent/scripts/agent-restart" });
    const c = collect();
    expect(await agentRestart(["x"], {}, io, c.o, c.e)).toBe(1);
    expect(c.err.join("\n")).toContain("ep0ch install --apply");
  });
  test("a machine that can't be reached, has no ep0ch, or runs an older one", async () => {
    for (const [r, said] of [
      [{ code: 255, out: "", err: "ssh: connect to host far port 22: Connection refused\n" }, "ssh far true"],
      [{ code: 127, out: "", err: "sh: 1: ep0ch: not found\n" }, "no ep0ch on far's login PATH"],
      [{ code: 2, out: "", err: 'ep0ch agent: no flag restart · ep0ch agent [--program <name>]\n' }, "ssh far ep0ch install --apply"],
    ] as const) {
      const { io } = fakeIO({ remote: async () => r });
      const c = collect();
      expect(await agentRestart(["x", "--machine", "far"], {}, io, c.o, c.e)).toBe(1);
      expect(c.err.join("\n")).toContain(said);
    }
  });
});

describe.skipIf(!outliner)("the real script behind the fake ssh", () => {
  let dir = "", home = "";
  let behindPid = 0, quotePid = 0, ptyHostPid = 0, kittyPid = 0;
  const stopLog = () => { try { return readFileSync(join(home, "claude-stop.log"), "utf8"); } catch { return ""; } };

  beforeAll(() => {
    dir = scratchDir("ep0ch-agent-fleet-");
    home = join(dir, "far-home");
    for (const d of ["bin", "versions", "far-home/.claude/jobs", "outlines"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
    // The installed Claude Code is versions/2.2.0 (a script that lists made-up sessions and logs a `stop`, never doing one);
    // two sessions run older ones: a copy of `sleep` that is named for the version, as the real binaries are.
    writeFileSync(join(dir, "versions/2.2.0"), `#!/bin/sh\ncase "$1" in\n  agents) cat "$HOME/agents.json" ;;\n  stop) echo "stop $2" >> "$HOME/claude-stop.log" ;;\n  *) echo "made-up claude: $*" >&2; exit 1 ;;\nesac\n`, { mode: 0o755 });
    symlinkSync(join(dir, "versions/2.2.0"), join(dir, "bin/claude"));
    const sleep = Bun.which("sleep")!;
    copyFileSync(sleep, join(dir, "versions/2.0.0")); chmodSync(join(dir, "versions/2.0.0"), 0o755);
    behindPid = Bun.spawn([join(dir, "versions/2.0.0"), "600"], { stdio: ["ignore", "ignore", "ignore"] }).pid;
    quotePid = Bun.spawn([join(dir, "versions/2.0.0"), "600"], { stdio: ["ignore", "ignore", "ignore"] }).pid;
    // An interactive session in a door terminal tile: its parent is the door's terminal host (`ep0ch session pty-host <folder>`).
    writeFileSync(join(dir, "pty-host-fake.sh"), `#!/bin/sh\n${join(dir, "versions/2.0.0")} 600 &\necho $! > ${join(dir, "kitty.pid")}\nwait\n`, { mode: 0o755 });
    ptyHostPid = Bun.spawn(["sh", join(dir, "pty-host-fake.sh"), "session", "pty-host", join(dir, "state/sessions/local/gurgle")], { stdio: ["ignore", "ignore", "ignore"] }).pid;
    for (let i = 0; i < 100 && !kittyPid; i++) { try { kittyPid = Number(readFileSync(join(dir, "kitty.pid"), "utf8")); } catch { Bun.sleepSync(50); } }
    const sessions = [
      { pid: kittyPid, cwd: "/x", kind: "interactive", sessionId: "eeee5555-0000-4000-8000-000000000005", name: "kitty-sr", status: "waiting" },
      { pid: behindPid, id: "aaaa1111", cwd: "/x", kind: "background", sessionId: "aaaa1111-0000-4000-8000-000000000001", name: "gpty-box", status: "waiting" },
      { pid: quotePid, id: "bbbb2222", cwd: "/x", kind: "background", sessionId: "bbbb2222-0000-4000-8000-000000000002", name: "it's (2) \"q\"", status: "busy" },
      { pid: 2_000_000_000, id: "cccc3333", cwd: "/x", kind: "background", sessionId: "cccc3333-0000-4000-8000-000000000003", name: "twin a", status: "waiting" },
      { pid: 2_000_000_001, id: "dddd4444", cwd: "/x", kind: "background", sessionId: "dddd4444-0000-4000-8000-000000000004", name: "twin b", status: "waiting" },
    ];
    writeFileSync(join(home, "agents.json"), JSON.stringify(sessions));
    for (const s of sessions) if (s.id) {
      mkdirSync(join(home, ".claude/jobs", s.id), { recursive: true });
      writeFileSync(join(home, ".claude/jobs", s.id, "state.json"), JSON.stringify({ fan: [], cwd: home, respawnFlags: [] }));
    }
    writeFileSync(join(dir, "bin/ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`, { mode: 0o755 });
    // The other machine's `ep0ch` is its own install: its HOME and its tools. (The ssh's login shell is not trusted to keep
    // either: CI's image resets HOME to the runner's home, which hid the made-up sessions from the script.)
    writeFileSync(join(dir, "bin/ep0ch"), `#!/bin/sh\nHOME=${home}\nPATH=${join(dir, "bin")}:$PATH\nexport HOME PATH\nexec ${process.execPath} ${MAIN} "$@"\n`, { mode: 0o755 });
  });
  afterAll(() => {
    for (const pid of [behindPid, quotePid, kittyPid, ptyHostPid]) try { process.kill(pid); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  });

  /** `ep0ch` from this machine; `HOME` and the made-up `claude` are the sessions' machine's, which the fake ssh also is. */
  async function ep0ch(args: string[], extra: Record<string, string> = {}) {
    const env = {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: home, EP0CH_STATE: join(dir, "state"), EP0CH_OUTLINES: join(dir, "outlines"),
      EP0CH_SSH: join(dir, "bin/ssh"), FAKE_SSH_HOME: home, FAKE_SSH_OUTLINES: join(dir, "outlines"), FAKE_SSH_BIN: join(dir, "bin"),
      FAKE_SSH_LOG: join(dir, "ssh.log"), ...extra,
    };
    const p = Bun.spawn(["bun", MAIN, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }

  test("ls here: every session, the one behind marked, an interactive one with the tile it runs in", async () => {
    const r = await ep0ch(["agent", "ls"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/gpty-box\s+aaaa1111\s+background\s+waiting\s+2\.0\.0\s+behind 2\.2\.0/);
    expect(r.out).toMatch(/twin a\s+cccc3333\s+background\s+waiting\s+\?/);
    expect(r.out).toMatch(/kitty-sr\s+eeee5555\s+interactive\s+waiting\s+2\.0\.0\s+behind 2\.2\.0 · door terminal tile \(outline gurgle\)/);
    expect(r.out).toContain("ep0ch agent restart --all --if-update");
    expect(r.out).toContain("1 interactive behind (kitty-sr)");
  });

  test("ls --json is the rows", async () => {
    const rows = JSON.parse((await ep0ch(["agent", "ls", "--json"])).out) as SessionRow[];
    expect(rows.map(r => `${r.id} ${r.kind}`)).toEqual(["aaaa1111 background", "bbbb2222 background", "cccc3333 background", "dddd4444 background", "eeee5555 interactive"]);
    expect(rows.find(r => r.id === "eeee5555")?.place).toBe("door terminal tile (outline gurgle)");
    expect(rows.find(r => r.id === "aaaa1111")).toMatchObject({ running: "2.0.0", installed: "2.2.0", behind: true });
  });

  test("ls --machine goes over ssh to that machine's ep0ch and says which machine to restart on", async () => {
    const r = await ep0ch(["--machine", "far-box", "agent", "ls"]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/gpty-box\s+aaaa1111\s+background\s+waiting\s+2\.0\.0\s+behind 2\.2\.0/);
    expect(r.out).toContain("ep0ch agent restart --all --if-update --machine far-box");
    expect(readFileSync(join(dir, "ssh.log"), "utf8")).toContain("ep0ch agent ls --json");
  });

  test("a dry run on a machine: a name with spaces, a quote and a double quote crosses the hop, and nothing is stopped", async () => {
    const r = await ep0ch(["agent", "restart", `it's (2) "q"`, "--dry-run", "--machine", "far-box"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("far-box:");
    expect(r.out).toContain("dry run: would wait for: mid-turn; then would stop bbbb2222");
    expect(stopLog()).toBe("");
  });

  test("a name that matches nothing, or several, is said to the caller before anything detaches", async () => {
    for (const where of [[], ["--machine", "far-box"]]) {
      const none = await ep0ch(["agent", "restart", "nobody", ...where]);
      expect(none.code).toBe(2);
      expect(none.err).toContain('no running session matches "nobody"');
      expect(none.err).toContain("ep0ch agent ls");
      const twins = await ep0ch(["agent", "restart", "twin", ...where]);
      expect(twins.code).toBe(2);
      expect(twins.err).toContain("names 2 sessions: cccc3333, dddd4444");
    }
    expect(stopLog()).toBe("");
  });

  test("restart detaches with the log line, resolving the name first; the busy session is left alone (it waits)", async () => {
    const r = await ep0ch(["agent", "restart", "gpty", "--machine", "far-box"], { });
    expect(r.code).toBe(0);
    expect(r.out).toContain("far-box: agent-restart: running in the background");
    expect(r.out).toContain("follow it: ssh far-box 'tail -f");
    const pid = Number(/\(pid (\d+)\)/.exec(r.out)?.[1]);
    try {
      // gpty-box is waiting, with no builders and nothing unpushed: it is stopped (by the made-up claude: a line in a file).
      for (let i = 0; i < 100 && !stopLog().includes("stop aaaa1111"); i++) await Bun.sleep(100);
      expect(stopLog()).toContain("stop aaaa1111");
    } finally { try { process.kill(pid); } catch { /* done already */ } }
  }, 30_000);

  test("an interactive session is refused with why and what to do; --all leaves it out and says so", async () => {
    const stopped = stopLog();
    for (const where of [[], ["--machine", "far-box"]]) {
      const r = await ep0ch(["agent", "restart", "kitty", ...where]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("kitty-sr' is an interactive session");
      expect(r.err).toContain("/exit, then claude --continue");
      const all = await ep0ch(["agent", "restart", "--all", "--dry-run", ...where]);
      expect(all.code).toBe(0);
      expect(all.out).toContain("left out 1 interactive session");
      expect(all.out).toContain("kitty-sr (behind: 2.0.0, installed 2.2.0, door terminal tile (outline gurgle))");
      expect(all.out).not.toMatch(/dry run: .*stop eeee5555/);
    }
    expect(stopLog()).toBe(stopped);
  });

  test("a name with a newline survives the list, and a list claude can't give is an error, not an empty one", async () => {
    const file = join(home, "agents.json"), kept = readFileSync(file, "utf8");
    try {
      writeFileSync(file, JSON.stringify([{ pid: behindPid, id: "aaaa1111", kind: "background", sessionId: "aaaa1111-0000-4000-8000-000000000001", name: "first\nsecond", status: "" }]));
      const rows = JSON.parse((await ep0ch(["agent", "ls", "--json"])).out) as SessionRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "first\nsecond", id: "aaaa1111", status: "", running: "2.0.0" });
      writeFileSync(file, "not json");
      const bad = await ep0ch(["agent", "ls"]);
      expect(bad.code).not.toBe(0);
      expect(bad.err).toContain("didn't answer a list of sessions");
    } finally { writeFileSync(file, kept); }
  });

  test("a job state that can't be read stops nothing", async () => {
    const stopped = stopLog(), state = join(home, ".claude/jobs/cccc3333/state.json"), kept = readFileSync(state, "utf8");
    try {
      writeFileSync(state, "not json");
      const r = await ep0ch(["agent", "restart", "cccc3333", "--now", "--dry-run"]);
      expect(r.code).not.toBe(0);
      expect(r.out + r.err).toContain("can't read");
    } finally { writeFileSync(state, kept); }
    expect(stopLog()).toBe(stopped);
  });

  test("an unreachable machine names the command that shows why", async () => {
    const r = await ep0ch(["agent", "ls", "--machine", "far-box"], { FAKE_SSH_DOWN: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("can't reach far-box over ssh");
    expect(r.err).toContain("ssh far-box true");
  });

  test("no claude on the machine says so", async () => {
    const bare = join(dir, "bare-bin");
    mkdirSync(bare);
    symlinkSync(process.execPath, join(bare, "bun"));
    for (const t of ["env", "bash", "sh", "python3", "readlink", "basename", "hostname", "id", "dirname", "cat", "date", "tee", "mkdir"]) { const w = Bun.which(t); if (w) try { symlinkSync(w, join(bare, t)); } catch { /* duplicate */ } }
    const r = await ep0ch(["agent", "ls"], { PATH: bare });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no claude on");
    expect(r.err).toContain("--machine <ssh-name>");
  });
});
