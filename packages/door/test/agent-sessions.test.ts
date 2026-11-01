// PIE-737: one kind of agent session. A program (an agent config in the outline, or one installed), a folder and a
// persona, owned by the door session and shown in the drawer or a tile: moving it moves the same process and keeps the
// conversation. Started by agent.start (`ep0ch agent`, the panel's new), or found running in a terminal tile; listed by
// the agent panel (alt+g, agents.list); resumed by folder. Scratch outline host, fictional notes, fake agent programs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { localPtys, usePtyBackend, type PtyBackend } from "../src/desk/pty-backend";
import { cttyPrefix, PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { agentIn, agentOf, agentOfApp, asSession, claudeProjectDir, configsOf, hasConversation, piSessionDir, pickSession, resumeArgs, sessionCommand, tildeOf, withIds } from "../src/desk/agent-sessions";
import { agentArgs } from "../src/agent-cli";
import { ensurePtyHost, ptyHostSocket } from "../src/session/pty-host";
import { outlineState } from "../src/state";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const AS = "sessions-agent-737";
/** An OSC 7501 report as `printf` writes it. */
const report = (body: string) => `\\033]7501;${body}\\033\\\\`;
/** A fake agent: says where it runs and as whom, then answers each line with its turn: the conversation is its count. */
const FAKE = `#!/bin/sh
echo "fake agent in $PWD as \${EP0CH_AGENT:-nobody} args $*"
n=0
while IFS= read -r line; do n=$((n+1)); echo "turn $n: $line"; done
`;

describe("the model, without a door", () => {
  let home = "";
  beforeAll(() => { home = mkdtempSync(join(tmpdir(), "ep0ch-sessions-home-")); });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("an agent is known by its program's name, or a script's run by an interpreter", () => {
    expect(agentOf(["/usr/local/bin/claude", "--continue"])).toBe("claude");
    expect(agentOf(["node", "/opt/lib/claude"])).toBe("claude");
    expect(agentOf(["codex"])).toBe("codex");
    expect(agentOf(["bash", "-l"])).toBeNull();
    expect(agentOf(["vim", "claude"])).toBeNull();     // a file named claude, edited: not an agent
  });

  test("an agent's own word for itself (an OSC 7501 report's app) names its program: claude-code is claude", () => {
    expect(agentOfApp("claude-code")).toBe("claude");
    expect(agentOfApp("claude")).toBe("claude");
    expect(agentOfApp("codex")).toBe("codex");
    expect(agentOfApp("ep0ch")).toBeNull();          // the door's own report, build jobs: not agents
    expect(agentOfApp("build")).toBeNull();
    expect(agentOfApp(null)).toBeNull();
  });

  describe.skipIf(!cttyPrefix())("a terminal whose program reports who it is, with no /proc to look in (macOS)", () => {
    const NO_PROC = "/no-such-proc";
    const panes: PtyPane[] = [];
    afterEach(() => { for (const p of panes.splice(0)) p.dispose(); });
    function tile(script: string, cwd: string): PtyPane {
      const p = new PtyPane({ cmd: ["sh", "-c", script], cwd, label: "bench" });
      panes.push(p);
      p.render(60, 8, false, { redraw() {} } as any);
      return p;
    }
    const text = (p: PtyPane) => p.text().join("\n");

    test("its latest report names the agent: a session until the program says it's gone, with no wrapper line in the output", async () => {
      const p = tile(`printf '${report("state=idle:app=claude-code")}'; read x; printf '${report("state=clear")}'; echo after-clear; sleep 30`, home);
      expect(asSession(p, { proc: NO_PROC })).toBeNull();                       // before it has said anything
      await until(() => p.status.records.size === 1, "the report");
      expect(asSession(p, { proc: NO_PROC })).toMatchObject({ program: "claude", folder: home, how: "found", pane: p });
      p.input("\r");
      await until(() => text(p).includes("after-clear"), "the program cleared its report");
      expect(asSession(p, { proc: NO_PROC })).toBeNull();
      expect(p.agentExit).toBeNull();                                          // read from the records: no "exited" line was needed
      expect(text(p)).not.toContain("exited");
    }, 15_000);

    test("a new prompt (OSC 133 A) or the program exiting ends it, though its done record stays for the person", async () => {
      const p = tile(`printf '${report("state=done:app=claude-code")}'; read x; printf '\\033]133;A\\033\\\\'; echo prompt; sleep 30`, home);
      await until(() => p.status.records.size === 1, "the report");
      expect(asSession(p, { proc: NO_PROC })).toMatchObject({ program: "claude" });
      p.input("\r");
      await until(() => text(p).includes("prompt"), "the prompt mark");
      expect(p.status.urgent()?.state).toBe("done");                           // the person still has it to see
      expect(asSession(p, { proc: NO_PROC })).toBeNull();
      const q = tile(`printf '${report("state=idle:app=claude-code")}'; read x`, home);
      await until(() => q.status.records.size === 1, "the report");
      expect(asSession(q, { proc: NO_PROC })).toMatchObject({ program: "claude" });
      q.input("\r");
      await until(() => !q.running && q.status.app === null, "the program exits");
      expect(asSession(q, { proc: NO_PROC })).toBeNull();
    }, 15_000);

    describe("an agent in the person's login shell that reported and then left (the wrapper's exit line)", () => {
      // What inLoginShell's wrapper prints when the agent exits 3, as bytes a tile reads.
      const left = Buffer.from("\x1b]2;claude exited · shell\x07\r\nclaude exited (3) · this is your shell, in /x\r\n");
      const said = Buffer.from(`\x1b]7501;state=idle:app=claude-code\x1b\\`);
      const proc = { pid: 4242, exited: new Promise<number>(() => {}), write() {}, resize() {}, kill() {}, close() {} };
      const pane = () => { const p = new PtyPane({ cmd: ["claude"], cwd: home, label: "claude" }); p.home = "desk.json"; p.tileId = "t5"; p.init({ redraw() {}, ctx: { flash() {} } } as any); panes.push(p); return p; };
      afterEach(() => usePtyBackend(localPtys));

      test("its report and its exit line in one read: the report doesn't outlive the line", async () => {
        let feed: (d: Uint8Array) => void = () => {};
        usePtyBackend({ kind: "host", spawn: (_s, onData) => { feed = onData; return proc; }, adopt: () => null, meta() {}, holds: () => false } as PtyBackend);
        const p = pane();
        p.render(60, 8, false, {} as any);
        feed(Buffer.concat([said, left]));
        await until(() => p.agentExit === 3 && p.status.records.size === 1, "the exit line and the report read");
        await Bun.sleep(100);
        expect(p.status.app).toBeNull();
        expect(asSession(p, { proc: NO_PROC })).toBeNull();
      });

      test("adopted after a handover, its old report doesn't outlive the exit line it kept", async () => {
        usePtyBackend({ kind: "host", spawn: () => { throw new Error("adopted, not started"); }, adopt: () => ({ proc, replay: Buffer.concat([said, left]), cols: 60, rows: 8, argv: ["claude"], meta: { cmd: ["claude"], socket: null }, exited: null }), meta() {}, holds: () => true } as PtyBackend);
        const p = pane();
        p.render(60, 8, false, {} as any);
        await until(() => p.agentExit === 3 && p.status.records.size === 1, "the exit line and the report replayed");
        await Bun.sleep(100);
        expect(p.status.app).toBeNull();
        expect(asSession(p, { proc: NO_PROC })).toBeNull();
      });
    });

    test("the door's own report and a job's are no agent", async () => {
      const p = tile(`printf '${report("state=working:app=ep0ch")}'; echo told; sleep 30`, home);
      await until(() => text(p).includes("told") && p.status.records.size === 1, "the report");
      expect(asSession(p, { proc: NO_PROC })).toBeNull();
    }, 15_000);
  });

  test("resuming is by folder: claude and pi --continue, codex resume --last, only when a conversation is there", () => {
    const env = { HOME: home };
    const garden = "/home/someone/garden-shed";
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);
    mkdirSync(claudeProjectDir(garden, env, home), { recursive: true });
    expect(claudeProjectDir(garden, env, home)).toEndWith("-home-someone-garden-shed");
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);           // a folder with no conversation in it
    // Claude's transcript of a start closed before any prompt holds settings lines only; `--continue` refuses it.
    const sid = "00000000-1111-4222-8333-444444444444";
    const settings = [`{"type":"last-prompt","leafUuid":"${sid}","sessionId":"${sid}"}`, `{"type":"agent-setting","agentSetting":"claude","sessionId":"${sid}"}`, `{"type":"mode","mode":"normal","sessionId":"${sid}"}`];
    writeFileSync(join(claudeProjectDir(garden, env, home), "a1.jsonl"), settings.join("\n") + "\n");
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);           // settings lines are not a conversation
    expect(sessionCommand("claude", [], garden, env)).toEqual(["claude"]);
    // A `claude -p` run has a user turn too, but an interactive `claude --continue` refuses a folder holding only those.
    writeFileSync(join(claudeProjectDir(garden, env, home), "a1b.jsonl"), `{"parentUuid":null,"type":"user","message":{"role":"user","content":"count the peas"},"entrypoint":"sdk-cli","sessionId":"${sid}"}\n`);
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);
    writeFileSync(join(claudeProjectDir(garden, env, home), "a2.jsonl"), [settings[0], `{"parentUuid":null,"type":"user","message":{"role":"user","content":"water the beans"},"entrypoint":"cli","sessionId":"${sid}"}`].join("\n") + "\n");
    expect(resumeArgs("claude", garden, env, home)).toEqual(["--continue"]);
    expect(hasConversation("claude", garden, env, home)).toBe(true);
    expect(resumeArgs("claude", "/home/someone/potting-bench", env, home)).toEqual([]);
    mkdirSync(piSessionDir(garden, home), { recursive: true });
    writeFileSync(join(piSessionDir(garden, home), "s.jsonl"), "{}\n");
    expect(piSessionDir(garden, home)).toEndWith("--home-someone-garden-shed--");
    expect(resumeArgs("pi", garden, env, home)).toEqual(["--continue"]);
    const day = join(home, ".codex", "sessions", "2026", "10", "09");
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, "rollout-1.jsonl"), `{"type":"session_meta","payload":{"id":"x","cwd":${JSON.stringify(garden)}}}\n`);
    expect(resumeArgs("codex", garden, env, home)).toEqual(["resume", "--last"]);
    expect(resumeArgs("codex", "/elsewhere", env, home)).toEqual([]);
    expect(resumeArgs("fern-agent", garden, env, home)).toEqual([]);
    // A command told what to resume already gets nothing more.
    expect(sessionCommand("claude", ["--resume=abc"], garden, env)).toEqual(["claude", "--resume=abc"]);
    // codex's -c is a config override, not a continue: its resume still comes, first, as its subcommand.
    expect(sessionCommand("codex", ["-c", "model=x"], garden, env)).toEqual(["codex", "resume", "--last", "-c", "model=x"]);
    expect(sessionCommand("codex", ["resume", "abc"], garden, env)).toEqual(["codex", "resume", "abc"]);
  });

  test("agent configs are notes with agent-config::, their program, args, persona and folder as written", () => {
    const got = configsOf([
      { id: "n1", properties: [{ key: "agent-config", value: "fern" }, { key: "program", value: "claude" }, { key: "args", value: "--model fable" }, { key: "persona", value: "fern" }, { key: "folder", value: "~/garden-shed" }] },
      { id: "n2", properties: [{ key: "agent-config", value: "moss" }] },
      { id: "n3", properties: [{ key: "agent-config", value: "fern" }, { key: "program", value: "codex" }] },          // a second of one name: the first wins
    ]);
    expect(got).toEqual([
      { name: "fern", program: "claude", args: ["--model", "fable"], persona: "fern", folder: "~/garden-shed", id: "n1" },
      { name: "moss", program: "moss", args: [], id: "n2" },
    ]);
  });

  test("a session's id is program:folder, a second of the same #<its own number>; session= finds it by id, by program:folder, by tile, by n", () => {
    const home = process.env.HOME ?? "/home/someone";
    const a = { tileId: "k2" }, b = { tileId: "t4" }, other = { tileId: "k9" };
    const row = (pane: object, tile: string) => ({ program: "claude", folder: `${home}/garden-shed`, shown: { in: "drawer", tile, name: tile, own: false }, pane });
    const rows = withIds([row(a, "claude"), row(b, "claude2"), { ...row(other, "pi"), program: "pi" }] as any[]);
    const [ida, idb] = rows.map(r => r.id);
    expect(ida).toMatch(/^claude:~\/garden-shed#\d+$/);
    expect(idb).toMatch(/^claude:~\/garden-shed#\d+$/);
    expect(rows[2]!.id).toBe("pi:~/garden-shed");
    // The ids stay each terminal's own whatever the order, and #n still names its terminal once it's the only one.
    expect(withIds([row(b, "claude2"), row(a, "claude")] as any[]).map(r => r.id)).toEqual([idb, ida]);
    const alone = withIds([row(b, "claude2")] as any[]);
    expect(alone[0]!.id).toBe("claude:~/garden-shed");
    expect(pickSession(alone as any, idb!)!.pane as object).toBe(b);
    expect(pickSession(alone as any, ida!)).toBeNull();
    expect(pickSession(rows as any, `claude:${home}/garden-shed`)).toBeNull();     // ambiguous: needs its #n
    expect(pickSession(alone as any, `claude:${home}/garden-shed`)!.pane as object).toBe(b);
    expect(pickSession(rows as any, "claude2")!.id).toBe(idb);
    expect(pickSession(rows as any, "t4")!.id).toBe(idb);
    expect(pickSession(rows as any, 2)!.id).toBe(idb);
    expect(pickSession(rows as any, "codex:~/x")).toBeNull();
    expect(tildeOf("/somewhere/else")).toBe("/somewhere/else");
  });

  test("ep0ch agent's flags are agent.start's: the folder resolved from here, ~ as home", () => {
    expect(agentArgs([], "/work/plot")).toEqual({ args: { in: "/work/plot" }, json: false });
    expect(agentArgs(["--program", "codex", "--in", "beds", "--persona", "moss", "--new", "--json"], "/work/plot")).toEqual({ args: { in: "/work/plot/beds", program: "codex", persona: "moss", fresh: true }, json: true });
    expect(agentArgs(["--in"], "/w")).toMatchObject({ error: expect.stringContaining("--in needs a value") });
    expect(agentArgs(["--bogus"], "/w")).toMatchObject({ error: expect.stringContaining("no flag --bogus") });
  });

  test.skipIf(process.platform !== "linux")("an agent is found running under a terminal's process, with its folder and persona, as Herdr finds one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-found-"));
    const claude = join(dir, "claude");
    writeFileSync(claude, "#!/bin/sh\nwhile :; do sleep 1; done\n");
    chmodSync(claude, 0o755);
    const shell = Bun.spawn(["sh", "-c", `${claude}; true`], { cwd: dir, env: { ...process.env, EP0CH_AGENT: "fern", OUTLINER_ACTOR: "" }, stdout: "ignore", stderr: "ignore" });
    try {
      let got: ReturnType<typeof agentIn> = null;
      await until(() => !!(got = agentIn(shell.pid, "/proc/", Date.now())), "the fake claude under the shell");
      expect(got).toMatchObject({ program: "claude", cwd: dir, persona: "fern" });
      expect(agentIn(process.pid, "/proc/", Date.now())?.program ?? null).not.toBe("codex");
    } finally {
      // Its own processes only: the fake claude it found (its loop's sleep ends within a second), then the shell.
      const fake = agentIn(shell.pid, "/proc/", Date.now());
      if (fake) { try { process.kill(fake.pid, "SIGTERM"); } catch { /* gone */ } }
      shell.kill();
      await shell.exited;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A restart that keeps the conversation (tile.restart) asks the same
  // question as a start: a fresh claude, with no turn in its folder, runs bare instead of dying on --continue.
  test.skipIf(process.platform !== "linux")("restarting a claude continues it only where the folder holds a conversation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-restart-"));
    const cfg = join(dir, "config"), fresh = join(dir, "fresh-bed"), used = join(dir, "used-bed");
    mkdirSync(fresh); mkdirSync(used);
    const claude = join(dir, "claude");
    writeFileSync(claude, '#!/bin/sh\necho "claude in $PWD args:$*:"\nsleep 30\n');
    chmodSync(claude, 0o755);
    const env = { CLAUDE_CONFIG_DIR: cfg, HOME: dir };
    const sid = "00000000-1111-4222-8333-444444444444";
    for (const [folder, lines] of [[fresh, [`{"type":"mode","mode":"normal","sessionId":"${sid}"}`]], [used, [`{"type":"user","message":{"role":"user","content":"hi"},"sessionId":"${sid}"}`]]] as const) {
      mkdirSync(claudeProjectDir(folder, env, dir), { recursive: true });
      writeFileSync(join(claudeProjectDir(folder, env, dir), `${sid}.jsonl`), lines.join("\n") + "\n");
    }
    const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.HOME = dir; process.env.CLAUDE_CONFIG_DIR = cfg;
    const text = (p: PtyPane) => p.render(100, 10, false, { redraw() {} } as any).lines.map(l => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")).join("\n");
    const panes: PtyPane[] = [];
    try {
      for (const [folder, args] of [[fresh, "args::"], [used, "args:--continue:"]] as const) {
        const p = new PtyPane({ cmd: [claude], cwd: folder });
        panes.push(p);
        text(p);
        await until(() => text(p).includes(`claude in ${folder}`), "the first start");
        p.restart(true);
        await until(() => text(p).includes(args), `the restart: ${args}`, 8000);
        expect(text(p)).not.toContain(args === "args::" ? "--continue" : "args::");
      }
    } finally {
      for (const p of panes) p.dispose();
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe.skipIf(!outliner)("agent sessions in a door", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "", work = "";
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    work = mkdtempSync(join(tmpdir(), "ep0ch-sessions-"));
    for (const f of ["garden-shed", "potting-bench"]) mkdirSync(join(work, f));
    const fake = join(work, "fern-agent");
    writeFileSync(fake, FAKE);
    chmodSync(fake, 0o755);
    const claude = join(work, "claude");
    writeFileSync(claude, FAKE);
    chmodSync(claude, 0o755);
    // Two agent configs in the outline: the fake agent as fern, in the garden shed; and as moss, with an argument.
    await board.request<any>("create", { parentId: null, text: `Fern, the shed's agent [agent-config::fern] [program::${fake}] [persona::fern] [folder::${join(work, "garden-shed")}]`, author: "agent" });
    await board.request<any>("create", { parentId: null, text: `Claude, as installed here [agent-config::claude] [program::${claude}]`, author: "agent" });
    await board.request<any>("create", { parentId: null, text: `Moss [agent-config::moss] [program::${fake}] [args::--quiet] [persona::moss]`, author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); rmSync(work, { recursive: true, force: true }); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_AGENT", "OUTLINER_ACTOR"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-sessions-state-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_AGENT; delete process.env.OUTLINER_ACTOR;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 150, rows: 44, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    const paint = () => { (app as any).paint(); return painted.map(l => l.replace(/\x1b\[[^m]*m/g, "")); };
    paint();
    const list = async () => ((await app.act({ action: "agents.list", args: {}, as: AS })) as any).sessions as any[];
    const text = (p: PtyPane) => p.text().join("\n");
    return { app, desk, key: (k: Key) => key(k), paint, list, text, A: app as any };
  }
  const end = (app: App) => { for (const s of app.drawer.sessions()) s.pane?.kill(); app.drawer.tile?.kill(); app.quit(); };

  test("agent.start starts a config's agent in its folder, as its persona, behind the tab shown; again attaches it; moving it keeps the process and the conversation", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      const out = await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS }) as any;
      expect(out).toMatchObject({ started: true, attached: false, program: "fern-agent", folder: join(work, "garden-shed"), persona: "fern", config: "fern" });
      // An agent's start moves nothing of the person's: the drawer stays put away.
      expect(d.app.drawer.open).toBe(false);
      const pane = () => d.app.drawer.sessions()[0]!.pane!;
      await until(() => d.text(pane()).includes("fake agent in"), "the fake agent says where it runs");
      expect(d.text(pane())).toContain(`fake agent in ${join(work, "garden-shed")} as fern`);
      const pid = pane().pid;
      // The panel's rows (agents.list): its program, folder, persona, how, and where it's shown.
      const rows = await d.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ n: 1, program: "fern-agent", folder: join(work, "garden-shed"), persona: "fern", config: "fern", how: "started", shown: { in: "drawer", tile: out.tile }, where: `in your drawer (${out.name})` });
      // The same program in the same folder: attached, not started twice.
      const again = await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS }) as any;
      expect(again).toMatchObject({ attached: true, started: false, id: rows[0].id });
      expect(await d.list()).toHaveLength(1);
      // A turn of the conversation.
      await d.app.act({ action: "tile.type", tile: out.tile, args: { text: "the beans need water\\n" }, as: AS });
      await until(() => d.text(pane()).includes("turn 1: the beans need water"), "turn 1");
      // Docked on the screen: the same process, the conversation goes on (turn 2, not turn 1 again).
      const docked = await d.app.act({ action: "agents.dock", args: { session: rows[0].id }, as: AS }) as any;
      expect(docked).toMatchObject({ session: rows[0].id, pid, inDrawer: false });
      expect((await d.list())[0]).toMatchObject({ shown: { in: "screen", here: true } });
      expect(d.desk.pane(docked.tile)).toBe(pane());
      await d.app.act({ action: "tile.type", tile: docked.tile, args: { text: "and the peas\\n" }, as: AS });
      await until(() => d.text(pane()).includes("turn 2: and the peas"), "turn 2, on the screen");
      // Pulled back into the drawer: the same again.
      const pulled = await d.app.act({ action: "agents.drawer", args: { session: "1" }, as: AS }) as any;
      expect(pulled).toMatchObject({ pid, inDrawer: true });
      expect((await d.list())[0]).toMatchObject({ shown: { in: "drawer" } });
      expect(pane().pid).toBe(pid);
      await expect(d.app.act({ action: "agents.drawer", args: { session: "1" }, as: AS })).rejects.toThrow(/in your drawer already/);
      // Jumping to it takes the person's keys: an agent's is refused.
      await expect(d.app.act({ action: "agents.go", args: { session: "1" }, as: AS })).rejects.toThrow();
      // Unknown names say what runs.
      await expect(d.app.act({ action: "agents.dock", args: { session: "codex:~/nowhere" }, as: AS })).rejects.toThrow(/running: fern-agent:/);
      await expect(d.app.act({ action: "agent.start", args: { program: "nothing-like-it" }, as: AS })).rejects.toThrow(/no agent nothing-like-it here · choose one of: .*fern/);
      await expect(d.app.act({ action: "agent.start", args: { program: "fern", in: join(work, "no-such-folder") }, as: AS })).rejects.toThrow(/no folder/);
    } finally { end(d.app); }
  }, 30_000);

  test("a second session in another folder is its own; the person's start goes to it; fresh=true starts another beside one", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS });
      // The person's: the drawer comes up on it, their keys in it.
      const mine = await d.app.dispatch.act({ action: "agent.start", args: { program: "moss", in: join(work, "potting-bench") } }, USER) as any;
      expect(mine).toMatchObject({ started: true, program: "fern-agent", persona: "moss", folder: join(work, "potting-bench") });
      expect(d.app.drawer.open).toBe(true);
      expect(d.app.drawer.entered).toBe(true);
      const rows = await d.list();
      expect(rows.map(r => [r.folder, r.persona])).toEqual([[join(work, "garden-shed"), "fern"], [join(work, "potting-bench"), "moss"]]);
      await until(() => d.text(d.app.drawer.sessions()[1]!.pane!).includes("args --quiet"), "moss started with its config's args");
      const fresh = await d.app.act({ action: "agent.start", args: { program: "fern", fresh: true }, as: AS }) as any;
      expect(fresh.started).toBe(true);
      const shed = (await d.list()).map(r => r.id).filter(id => id.includes("garden-shed"));
      expect(shed).toHaveLength(2);
      for (const id of shed) expect(id).toMatch(new RegExp(`^fern-agent:${tildeOf(join(work, "garden-shed")).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}#\\d+$`));
    } finally { end(d.app); }
  }, 30_000);

  test.skipIf(process.platform !== "linux")("a claude typed into a ^W o s shell is a session by itself, and stops being one when it exits: the tile is the shell again", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "sh", name: "bench", cwd: join(work, "potting-bench") }, tile: "reader" }, USER);
      d.paint();
      const bench = d.desk.pane("bench") as PtyPane;
      await until(() => bench.running, "the shell runs");
      // The person is elsewhere: an agent doesn't move a tile they're in.
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      expect(await d.list()).toEqual([]);
      await d.app.act({ action: "tile.type", tile: "bench", args: { text: `${join(work, "claude")}\\n` }, as: AS });
      await until(() => d.app.drawer.sessions().length === 1, "found running", 8000);
      expect((await d.list())[0]).toMatchObject({ program: "claude", folder: join(work, "potting-bench"), how: "found", shown: { in: "screen", name: "bench", here: true } });
      // Pulled into the drawer and back, as any session.
      const pid = bench.pid;
      await d.app.act({ action: "agents.drawer", args: { session: "bench" }, as: AS });
      expect(d.app.drawer.sessions()[0]!.shown).toMatchObject({ in: "drawer" });
      expect(bench.pid).toBe(pid);
      // It exits (ctrl+d ends its read): the shell is left, and it isn't a session any more.
      bench.input("\x04");
      await until(() => d.app.drawer.sessions().length === 0, "gone once it exits", 8000);
      expect(bench.running).toBe(true);
    } finally { end(d.app); }
  }, 30_000);

  test.skipIf(!cttyPrefix())("a claude that reports itself is a session wherever it runs: agent.start for it attaches, never a second; its clear takes it away", async () => {
    const d = await door();
    // A program that says who it is (the Claude mod's session start, then its end on a line) and does nothing else:
    // no agent process by name anywhere in the tile, as on a Mac where there's no /proc to look in.
    const says = join(work, "says-claude-code");
    writeFileSync(says, `#!/bin/sh\nprintf '${report("state=idle:app=claude-code")}'\nread x\nprintf '${report("state=clear")}'\nsleep 30\n`);
    chmodSync(says, 0o755);
    try {
      d.A.lastInput = 0;
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: says, name: "welcome", cwd: join(work, "potting-bench") }, tile: "reader" }, USER);
      d.paint();
      const welcome = d.desk.pane("welcome") as PtyPane;
      await until(() => d.app.drawer.sessions().length === 1, "known by its report", 8000);
      expect((await d.list())[0]).toMatchObject({ program: "claude", folder: join(work, "potting-bench"), how: "found", shown: { in: "screen", name: "welcome" } });
      const out = await d.app.act({ action: "agent.start", args: { program: "claude", in: join(work, "potting-bench") }, as: AS }) as any;
      expect(out).toMatchObject({ attached: true, started: false, program: "claude", tile: welcome.tileId });
      expect(await d.list()).toHaveLength(1);
      // It ends its session: the tile is no agent's, and nothing printed a wrapper line to say so.
      welcome.input("\r");
      await until(() => d.app.drawer.sessions().length === 0, "gone once it clears its report", 8000);
      expect(welcome.running).toBe(true);
      expect(welcome.agentExit).toBeNull();
      // Asking again now starts one.
      const again = await d.app.act({ action: "agent.start", args: { program: "claude", in: join(work, "potting-bench") }, as: AS }) as any;
      expect(again).toMatchObject({ started: true, attached: false });
    } finally { end(d.app); }
  }, 30_000);

  // PIE-1432 (Evan's pie door, Oct 29, 2:28 PM): a restart left his Claude running in the terminal host with no tile, and
  // the agent panel didn't list it. Every program the host keeps is a row; one with no tile says so, and a, d and ⏎ put
  // it back in a tile: the same process, its conversation going on.
  test("a program the terminal host keeps with no tile is a row saying \"no tile\"; agents.drawer, agents.dock and agents.go put it back, the same process (PIE-1432)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-kept-"));
    const was = process.env.EP0CH_STATE;
    let hostPid = 0;
    process.env.EP0CH_STATE = dir;
    const claude = join(work, "claude");
    try {
      const { host: first } = await ensurePtyHost(dir);
      hostPid = first.hostPid;
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: work };
      // Two programs an earlier daemon left with no layout naming their keys: a claude (the old drawer's key) and a fern.
      const outs = { a: "", b: "", c: "" };
      const a = first.spawn({ key: "drawer.json#2:drawer.agent", argv: [claude], cwd: join(work, "garden-shed"), env, cols: 60, rows: 10, meta: { cmd: [claude] } }, d => { outs.a += Buffer.from(d).toString(); });
      const b = first.spawn({ key: "desk.json:t77", argv: [join(work, "fern-agent")], cwd: join(work, "potting-bench"), env, cols: 60, rows: 10, meta: { cmd: [join(work, "fern-agent")] } }, d => { outs.b += Buffer.from(d).toString(); });
      // A fourth waits for its screen (board.json still names its tile t8): not "no tile", its screen adopts it.
      const w = first.spawn({ key: "board.json:t8", argv: [claude], cwd: join(work, "potting-bench"), env, cols: 60, rows: 10, meta: { cmd: [claude] } }, () => {});
      const c = first.spawn({ key: "river.json:t3", argv: [claude], cwd: join(work, "potting-bench"), env, cols: 60, rows: 10, meta: { cmd: [claude] } }, d => { outs.c += Buffer.from(d).toString(); });
      a.write("the beans need water\n");
      await until(() => outs.a.includes("turn 1: the beans") && outs.b.includes("fake agent in") && outs.c.includes("fake agent in") && !!a.pid && !!b.pid && !!c.pid, "the kept programs running");
      first.release();
      const { host: next } = await ensurePtyHost(dir);
      usePtyBackend(next);
      process.env.EP0CH_STATE = state;
      writeFileSync(join(outlineState(), "board.json"), JSON.stringify({ root: { t: "leaf", kind: "pty", name: "bench", id: "t8", cmd: [claude] } }));
      const d = await door();
      try {
        const rows = await d.list();
        expect(rows.map(r => [r.program, r.shown.in, r.pid])).toEqual([["claude", "no tile", a.pid], ["fern-agent", "no tile", b.pid], ["claude", "no tile", c.pid]]);
        expect(rows.some(r => r.pid === w.pid)).toBe(false);
        expect(rows[0]).toMatchObject({ shown: { in: "no tile", key: "drawer.json#2:drawer.agent" }, where: expect.stringMatching(/^no tile/) });
        // The panel says it too.
        await d.app.act({ action: "agents.open", args: {}, as: AS });
        d.key({ kind: "alt", ch: "g" });
        await until(() => d.app.drawer.open, "the panel shown");
        expect(d.paint().join("\n")).toContain("no tile");
        // a: into the drawer, the same process; the conversation goes on (turn 2, not a new turn 1).
        const pulled = await d.app.act({ action: "agents.drawer", args: { session: rows[0].id }, as: AS }) as any;
        expect(pulled).toMatchObject({ pid: a.pid, inDrawer: true });
        const back = d.app.drawer.sessions().find(s => s.pid === a.pid)!;
        expect(back.shown.in).toBe("drawer");
        await d.app.act({ action: "tile.type", tile: (back.shown as any).tile, args: { text: "and the peas\n" }, as: AS });
        await until(() => d.text(back.pane!).includes("turn 2: and the peas"), "turn 2, in the drawer");
        // d: docked on the screen shown, the same process (its row was a kept program's: every one is listed).
        const docked = await d.app.act({ action: "agents.dock", args: { session: "fern-agent:" + tildeOf(join(work, "potting-bench")) }, as: AS }) as any;
        expect(docked).toMatchObject({ pid: b.pid, inDrawer: false });
        expect((d.desk.pane(docked.tile) as PtyPane).pid).toBe(b.pid!);
        // Once in a tile, a program is a row by what it runs: the claude still is; the fern program (no agent) is a terminal.
        expect((await d.list()).map(r => [r.program, r.shown.in])).toEqual([["claude", "drawer"], ["claude", "no tile"]]);
        // ⏎ on its row in the panel (the person's agents.go): back in a drawer tab, the person's keys in it, the same process.
        const panel = d.app.drawer.desk!.pane("agents") as any;
        await d.app.act({ action: "agents.open", args: {}, as: AS });
        d.key({ kind: "alt", ch: "g" });
        await until(() => d.app.drawer.open && d.app.drawer.desk!.focusedName() === "agents", "the panel has the keys");
        d.key({ kind: "char", ch: "j" });
        await until(() => panel.at === 1, "the no-tile row picked");
        expect(panel.picked().shown.in).toBe("no tile");
        d.key({ kind: "enter" });
        await until(() => d.app.drawer.sessions().find(s => s.pid === c.pid)?.shown.in === "drawer", "put back by ⏎");
        expect(d.app.drawer.desk!.pane(d.app.drawer.desk!.focusedName()!)).toBe(d.app.drawer.sessions().find(s => s.pid === c.pid)!.pane!);
        expect(next.unadopted().map(u => u.key)).toEqual(["board.json:t8"]);
      } finally { end(d.app); }
    } finally {
      usePtyBackend(localPtys);
      if (hostPid) { try { process.kill(hostPid, "SIGTERM"); } catch { /* gone */ } }
      await until(() => !existsSync(ptyHostSocket(dir)), "the host to end", 5000).catch(() => {});
      process.env.EP0CH_STATE = was;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  test("the agent panel: alt+g opens it in the drawer for the person, an agent's behind the tab shown; its rows, its keys, its click", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS });
      await d.app.act({ action: "agent.start", args: { program: "moss", in: join(work, "potting-bench") }, as: AS });
      const opened = await d.app.act({ action: "agents.open", args: {}, as: AS }) as any;
      expect(opened).toMatchObject({ name: "agents", sessions: 2 });
      expect(d.app.drawer.open).toBe(false);
      // The person's alt+g: the drawer up on the panel.
      d.key({ kind: "alt", ch: "g" });
      await until(() => d.app.drawer.open && d.app.drawer.tabs().find(t => t.kind === "agents")?.shown === true, "the panel shown");
      const screen = d.paint().join("\n");
      expect(screen).toContain("fern-agent");
      expect(screen).toContain("fern-agent · fern");
      expect(screen).toContain("in your drawer");
      // j picks the second; d docks it here (the drawer's tab goes, a tile on the desk comes).
      const panel = () => d.app.drawer.desk!.pane("agents") as any;
      d.key({ kind: "char", ch: "j" });
      await until(() => panel().at === 1, "picked the second");
      const moss = d.app.drawer.sessions()[1]!.pane!, pid = moss.pid;
      d.key({ kind: "char", ch: "d" });
      await until(() => d.app.drawer.sessions().find(s => s.pane === moss)?.shown.in === "screen", "docked here");
      expect(moss.pid).toBe(pid);
      // peek says the sessions, with where each is shown.
      expect(JSON.stringify(d.app.describe())).toContain(`"sessions":[{"id":"fern-agent:`);
      expect(panel().describe()).toHaveLength(2);
    } finally { end(d.app); }
  }, 30_000);
});
