// PIE-737: one kind of agent session. A program (an agent config in the outline, or one installed), a folder and a
// persona, owned by the door session and shown in the drawer or a tile: moving it moves the same process and keeps the
// conversation. Started by agent.start (`ep0ch agent`, the panel's new), or found running in a terminal tile; listed by
// the agent panel (alt+g, agents.list); resumed by folder. Scratch outline host, fictional notes, fake agent programs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { agentIn, agentOf, claudeProjectDir, configsOf, piSessionDir, pickSession, resumeArgs, sessionCommand, tildeOf, withIds } from "../src/desk/agent-sessions";
import { agentArgs } from "../src/agent-cli";
import { outliner, Scratch, until } from "./scratch";

const USER = { kind: "user" } as const;
const AS = "sessions-agent-737";
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

  test("resuming is by folder: claude and pi --continue, codex resume --last, only when a conversation is there", () => {
    const env = { HOME: home };
    const garden = "/home/someone/garden-shed";
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);
    mkdirSync(claudeProjectDir(garden, env, home), { recursive: true });
    expect(claudeProjectDir(garden, env, home)).toEndWith("-home-someone-garden-shed");
    expect(resumeArgs("claude", garden, env, home)).toEqual([]);           // a folder with no conversation in it
    writeFileSync(join(claudeProjectDir(garden, env, home), "a1.jsonl"), "{}\n");
    expect(resumeArgs("claude", garden, env, home)).toEqual(["--continue"]);
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
      { id: "n1", props: { "agent-config": "fern", program: "claude", args: "--model fable", persona: "fern", folder: "~/garden-shed" } },
      { id: "n2", props: { "agent-config": "moss" } },
      { id: "n3", props: { "agent-config": "fern", program: "codex" } },          // a second of one name: the first wins
    ]);
    expect(got).toEqual([
      { name: "fern", program: "claude", args: ["--model", "fable"], persona: "fern", folder: "~/garden-shed", id: "n1" },
      { name: "moss", program: "moss", args: [], id: "n2" },
    ]);
  });

  test("a session's id is program:folder, a second of the same #<its own number>; session= finds it by id, by program:folder, by tile, by n", () => {
    const home = process.env.HOME ?? "/home/someone";
    const a = { tileId: "k2" }, b = { tileId: "t4" }, other = { tileId: "k9" };
    const row = (pane: object, tile: string) => ({ program: "claude", folder: `${home}/garden-shed`, shown: { in: "drawer", tile, own: false }, pane });
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
  const end = (app: App) => { for (const s of app.drawer.sessions()) s.pane.kill(); app.drawer.tile?.kill(); app.quit(); };

  test("agent.start starts a config's agent in its folder, as its persona, behind the tab shown; again attaches it; moving it keeps the process and the conversation", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      const out = await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS }) as any;
      expect(out).toMatchObject({ started: true, attached: false, program: "fern-agent", folder: join(work, "garden-shed"), persona: "fern", config: "fern" });
      // An agent's start moves nothing of the person's: the drawer stays put away.
      expect(d.app.drawer.open).toBe(false);
      const pane = () => d.app.drawer.sessions()[0]!.pane;
      await until(() => d.text(pane()).includes("fake agent in"), "the fake agent says where it runs");
      expect(d.text(pane())).toContain(`fake agent in ${join(work, "garden-shed")} as fern`);
      const pid = pane().pid;
      // The panel's rows (agents.list): its program, folder, persona, how, and where it's shown.
      const rows = await d.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ n: 1, program: "fern-agent", folder: join(work, "garden-shed"), persona: "fern", config: "fern", how: "started", shown: { in: "drawer", tile: out.tile }, where: `in your drawer (${out.tile})` });
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
      await until(() => d.text(d.app.drawer.sessions()[1]!.pane).includes("args --quiet"), "moss started with its config's args");
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
      expect((await d.list())[0]).toMatchObject({ program: "claude", folder: join(work, "potting-bench"), how: "found", shown: { in: "screen", tile: "bench", here: true } });
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

  test("the agent panel: alt+g opens it in the drawer for the person, an agent's behind the tab shown; its rows, its keys, its click", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      await d.app.act({ action: "agent.start", args: { program: "fern" }, as: AS });
      await d.app.act({ action: "agent.start", args: { program: "moss", in: join(work, "potting-bench") }, as: AS });
      const opened = await d.app.act({ action: "agents.open", args: {}, as: AS }) as any;
      expect(opened).toMatchObject({ tile: "agents", sessions: 2 });
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
      const moss = d.app.drawer.sessions()[1]!.pane, pid = moss.pid;
      d.key({ kind: "char", ch: "d" });
      await until(() => d.app.drawer.sessions().find(s => s.pane === moss)?.shown.in === "screen", "docked here");
      expect(moss.pid).toBe(pid);
      // peek says the sessions, with where each is shown.
      expect(JSON.stringify(d.app.describe())).toContain(`"sessions":[{"id":"fern-agent:`);
      expect(panel().describe()).toHaveLength(2);
    } finally { end(d.app); }
  }, 30_000);
});
