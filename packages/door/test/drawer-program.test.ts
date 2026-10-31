// PIE-498: what the drawer's own tab runs, and where (src/desk/drawer-program.ts). One rule, read by the drawer and by
// `ep0ch doctor`: the person's program or a shell, in the person's folder, the project's, the outline's or the door's
// start, and the why said in words. Pure: a scratch folder, fictional outlines.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents, drawerProgram, inLoginShell, isAgentCmd, programName } from "../src/desk/drawer-program";

const root = mkdtempSync(join(tmpdir(), "ep0ch-drawerprog-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home"), outlines = join(root, "outlines"), project = join(root, "code", "allotment");
mkdirSync(join(outlines, "allotment"), { recursive: true });
mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, ".ep0ch"), 'ws = "allotment"\n');

describe("the drawer's own program", () => {
  test("no agent configured: a shell, said so; one configured runs as set", () => {
    const none = drawerProgram({ env: { SHELL: "/bin/zsh", EP0CH_OUTLINES: outlines }, outline: "allotment", start: root, home });
    expect(none.cmd).toEqual(["/bin/zsh"]);
    expect(none.name).toBe("shell");
    expect(none.programWhy).toMatch(/a shell: no agent chosen yet \(the drawer.s picker, alt\+g/);
    const set = drawerProgram({ env: { EP0CH_DAILY_AGENT: "claude --model x", EP0CH_OUTLINES: outlines }, outline: "allotment", start: root, home });
    expect(set.cmd).toEqual(["claude", "--model", "x"]);
    expect(set.name).toBe("claude");
    expect(set.programWhy).toContain("remove: export EP0CH_DAILY_AGENT='claude --model x'");
    // The Herdr launcher is a Claude too; another program is its own name.
    expect(programName(["/x/scripts/door-agent-herdr.ts", "--agent", "codex"])).toBe("codex");
    expect(programName(["/x/scripts/door-agent-herdr.ts"])).toBe("claude");
    expect(programName(["bun", "/x/scripts/door-agent-herdr.ts"])).toBe("claude");
    expect(programName(["htop"])).toBe("htop");
  });

  test("the folder: the one chosen with the agent, else the project's .ep0ch folder, else the outline's, else where the door started", () => {
    const env = { EP0CH_OUTLINES: outlines };
    // Chosen with the agent (host.agent in=, ~ is home), as the person's default; EP0CH_DAILY_CWD is read no more (PIE-737).
    const chose = join(root, "chose");
    mkdirSync(chose, { recursive: true });
    writeFileSync(join(chose, "drawer-agent.json"), JSON.stringify({ agent: "claude", folder: "~/patch" }));
    expect(drawerProgram({ env, outline: "allotment", start: project, home, state: chose })).toMatchObject({ cwd: join(home, "patch"), folderWhy: "chosen with the agent (~/patch)" });
    expect(drawerProgram({ env: { ...env, EP0CH_DAILY_CWD: "~/patch" } as any, outline: "allotment", start: join(project, "src"), home })).toMatchObject({ cwd: project });
    // Started inside the project whose .ep0ch names this outline: the project.
    expect(drawerProgram({ env, outline: "allotment", start: join(project, "src"), home })).toMatchObject({ cwd: project, folderWhy: "the folder whose .ep0ch names allotment" });
    // A .ep0ch that names another outline isn't this one's project (orchard has no folder here either): where it started.
    expect(drawerProgram({ env, outline: "orchard", start: project, home })).toMatchObject({ cwd: project, folderWhy: "the folder the door was started from" });
    expect(drawerProgram({ env, outline: "allotment", start: root, home })).toMatchObject({ cwd: join(outlines, "allotment"), folderWhy: "the outline's own folder (allotment)" });
    // An outline on another machine has no folder here; no outline at all (the home base): where the door started.
    expect(drawerProgram({ env, outline: "allotment", machine: "far", start: root, home })).toMatchObject({ cwd: root, folderWhy: "the folder the door was started from" });
    expect(drawerProgram({ env, outline: null, start: root, home })).toMatchObject({ cwd: root, folderWhy: "the folder the door was started from" });
  });
});

describe("the drawer's agent: chosen per session, detected, started inside the person's shell", () => {
  const state = join(root, "state"), session = join(state, "sessions", "local", "allotment");
  mkdirSync(session, { recursive: true });
  const env = { SHELL: "/bin/zsh", EP0CH_OUTLINES: outlines };
  const program = (more: Record<string, string> = {}) => drawerProgram({ env: { ...env, ...more }, outline: "allotment", start: root, home, dir: session, state });

  test("where the choice comes from: EP0CH_DAILY_AGENT overrides; else this session's; else the default; else a shell, none chosen", () => {
    expect(program()).toMatchObject({ cmd: ["/bin/zsh"], name: "shell", from: "none" });
    writeFileSync(join(state, "drawer-agent.json"), JSON.stringify({ agent: "pi" }));
    expect(program()).toMatchObject({ cmd: ["pi"], name: "pi", from: "default", programWhy: "your default (pi)" });
    writeFileSync(join(session, "drawer-agent.json"), JSON.stringify({ agent: "codex", herdr: true }));
    const p = program();
    expect(p.herdr).toBe(false);
    expect(p.cmd).toEqual(["/bin/zsh"]);
    expect(p.name).toBe("shell");
    expect(p.from).toBe("session");
    expect(p.programWhy).toContain("ep0ch agent start");
    expect(p.programWhy).toContain("codex");
    expect(program({ EP0CH_DAILY_AGENT: "claude" })).toMatchObject({ cmd: ["claude"], from: "env" });
    // The deleted launcher is not executed.
    const launched = program({ EP0CH_DAILY_AGENT: "/x/scripts/door-agent-herdr.ts" });
    expect(launched.cmd).toEqual(["/bin/zsh"]);
    expect(launched.programWhy).toContain("gone");
  });

  test("the agents offered: a shell first, then those on PATH. The Herdr launcher is not a choice", () => {
    const on = new Set(["claude", "pi", "herdr"]);
    const a = detectAgents({ env, which: c => (on.has(c) ? `/usr/bin/${c}` : null), session: "allotment@far" });
    expect(a.map(x => x.name)).toEqual(["shell", "claude", "pi"]);
    expect(a.some(x => x.herdr)).toBe(false);
    expect(detectAgents({ env, which: () => null }).map(x => x.name)).toEqual(["shell"]);
  });

  test("no dead panes: an agent starts inside the login shell, which says it exited and stays the person's shell", () => {
    expect(isAgentCmd(["claude", "--model", "x"])).toBe(true);
    expect(isAgentCmd(["/opt/bin/codex"])).toBe(true);
    expect(isAgentCmd(["nvim", "a.md"])).toBe(false);
    // The Herdr launcher only attaches; its pane wraps the agent: never a shell around it here.
    expect(isAgentCmd(["bun", "/x/scripts/door-agent-herdr.ts", "--agent", "claude"])).toBe(false);
    const argv = inLoginShell(["claude", "--model", "it's"], "/bin/zsh");
    expect(argv.slice(0, 3)).toEqual(["/bin/zsh", "-l", "-c"]);
    expect(argv[3]).toStartWith("exec /bin/sh -c ");          // any login shell (fish too) only runs the exec; sh runs the rest
    // Run for real: the program's own output, then the line the door reads, then the person's shell (stdin closed: it ends).
    const ran = Bun.spawnSync(inLoginShell(["sh", "-c", "echo 'quote '\\''d'; exit 3"], "/bin/sh", "kettle"), { stdin: "ignore", env: { PATH: process.env.PATH ?? "", HOME: root } });
    const out = ran.stdout.toString();
    expect(out).toContain("quote 'd");
    expect(out).toContain("\x1b]2;kettle exited · shell\x07\nkettle exited (3) · this is your shell, in ");
  });
});

describe("a named agent, and the deleted launcher", () => {
  test("EP0CH_DAILY_AGENT naming the launcher is a shell, and sh still wins over agents.toml", () => {
    const p = drawerProgram({ env: { EP0CH_DAILY_AGENT: "bun /x/scripts/door-agent-herdr.ts --agent codex", SHELL: "/bin/zsh", EP0CH_OUTLINES: outlines }, outline: "allotment", start: root, home });
    expect(p.cmd).toEqual(["/bin/zsh"]);
    expect(p.herdr).toBe(false);
    expect(p.programWhy).toContain("gone");
    const named = join(root, "named");
    mkdirSync(join(named, ".ep0ch"), { recursive: true });
    writeFileSync(join(named, ".ep0ch", "config.toml"), 'ws = "allotment"\nagent = "loki"\n');
    writeFileSync(join(named, ".ep0ch", "agents.toml"), '[[agent]]\npersona = "loki"\nmachine = "float-box"\nfolder = "~/projects/ep0ch"\nprogram = "claude"\n');
    const row = drawerProgram({ env: { SHELL: "/bin/zsh", EP0CH_OUTLINES: outlines }, outline: "allotment", start: named, home });
    expect(row.from).toBe("named");
    expect(row.name).toBe("loki");
    expect(row.cmd).toEqual(["hc", "attach", "float-box/loki"]);
    expect(row.cwd).toBe(join(home, "projects", "ep0ch"));
    expect(row.named?.persona).toBe("loki");
    // A test door's shell still wins, so it never attaches a real agent.
    expect(drawerProgram({ env: { EP0CH_DAILY_AGENT: "sh", EP0CH_OUTLINES: outlines }, outline: "allotment", start: named, home }).cmd).toEqual(["sh"]);
  });
});

describe("the drawer reads the door's own outline and machine", () => {
  test("an outline on another machine never starts the drawer in a same-named local outline's folder", async () => {
    const { AgentDrawer } = await import("../src/drawer");
    const saved = process.env.EP0CH_OUTLINES;
    process.env.EP0CH_OUTLINES = outlines;
    try {
      const host = (machine?: string) => ({ redraw() {}, statusChanged() {}, flash() {}, ctx: () => ({ outline: "allotment", ...(machine ? { machine } : {}) }) as any });
      expect(new AgentDrawer(host(), false, null).runs.cwd).toBe(join(outlines, "allotment"));
      const far = new AgentDrawer(host("far"), false, null).runs;
      expect(far.cwd).not.toBe(join(outlines, "allotment"));
      expect(far.folderWhy).not.toMatch(/the outline's own folder/);
    } finally { if (saved === undefined) delete process.env.EP0CH_OUTLINES; else process.env.EP0CH_OUTLINES = saved; }
  });
});
