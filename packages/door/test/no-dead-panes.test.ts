// No dead panes (Evan, Oct 3): an agent in a terminal tile, or the drawer's own tab, starts inside the person's login
// shell. When it exits (or crashes) the tile is that shell, in the same folder with the same environment: the same
// process, a prompt that answers, the door's nesting guard (EP0CH_IN_DOOR) still set. It says the agent exited and
// nothing starts it again. A stand-in `claude` (a script that prints and exits 3); no real agent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { PtyPane } from "../src/desk/pty";
import { until } from "./scratch";

const dir = mkdtempSync(join(tmpdir(), "ep0ch-nodead-"));
const bin = join(dir, "bin"), work = join(dir, "allotment");
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  mkdirSync(bin, { recursive: true }); mkdirSync(work, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\necho 'stand-in claude here'\nexit 3\n");
  chmodSync(join(bin, "claude"), 0o755);
  // One that waits for a line, then exits 3: the drawer's agent still running while another is chosen.
  writeFileSync(join(bin, "slowclaude"), "#!/bin/sh\necho 'slow stand-in here'\nread line\nexit 3\n");
  chmodSync(join(bin, "slowclaude"), 0o755);
  for (const k of ["SHELL", "PATH", "HOME", "EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
  // A plain login shell with no profile of the person's (HOME is the scratch folder).
  process.env.SHELL = "/bin/sh"; process.env.HOME = dir; process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.EP0CH_STATE = join(dir, "state");
});
afterAll(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(dir, { recursive: true, force: true }); });

/** The tile's screen as text, and a line typed into it. */
const text = (p: PtyPane) => p.text().join("\n");

/** Quit the agent, then the shell left is live: same process, same folder, the guard set, a prompt that answers. */
async function quitsToAShell(p: PtyPane) {
  await until(() => p.running && !!p.pid, "the tile's program running");
  const pid = p.pid;
  await until(() => text(p).includes("claude exited (3) · this is your shell"), "the agent exited, said in the tile", 8000);
  expect(p.running).toBe(true);                                    // not a dead tile
  expect(p.pid).toBe(pid);                                         // the same process: the shell the agent ran in
  expect(p.title()).toContain("claude exited · shell");
  await until(() => p.agentExit === 3, "the door read how it ended (the title and the line together)", 3000);
  p.input("echo alive:$$:$PWD:in-door=$EP0CH_IN_DOOR\r");
  await until(() => text(p).includes(`alive:`) && text(p).includes(`in-door=1`), "the shell answers", 8000);
  const line = p.text().find(l => l.includes("alive:") && l.includes("in-door=1") && !l.includes("echo"))!;
  expect(line).toContain(work);                                    // the same folder
  await Bun.sleep(300);                                           // nothing starts it again by itself
  expect((text(p).match(/stand-in claude here/g) ?? []).length).toBe(1);
  // A prompt that titles the terminal (many shells' PROMPT_COMMAND) isn't the agent starting again: it stays exited.
  p.input("printf '\\033]2;evan@allotment: ~\\007'; echo titled\r");
  await until(() => text(p).includes("\ntitled") || p.text().some(l => l.trim() === "titled"), "the title set", 5000);
  expect(p.agentExit).toBe(3);
}

describe("no dead panes", () => {
  test("an agent's tile reads its exit line whether it spawned the program or adopted it after a handover", () => {
    // Known from what the tile runs, not from having spawned it here: an adopted program's tile reads it too.
    expect((new PtyPane({ cmd: ["claude"], label: "claude" }) as any).wrapped).toBe(true);
    expect((new PtyPane({ cmd: ["nvim", "a.md"], label: "nvim" }) as any).wrapped).toBe(false);
    expect((new PtyPane({ cmd: ["nvim"], label: "x", inShell: true }) as any).wrapped).toBe(true);
  });

  test("a terminal tile running an agent: quitting it leaves the person's shell, live, in the same folder", async () => {
    const p = new PtyPane({ cmd: ["claude"], cwd: work, label: "claude" });
    p.tileId = "t3"; p.place = "desk";
    p.init({ redraw() {}, ctx: { flash() {} } } as any);
    p.render(100, 24, false, null as any);
    try { await quitsToAShell(p); } finally { p.kill(); }
  }, 20_000);

  test("the drawer's own tab: its agent exits into the person's shell too", async () => {
    process.env.EP0CH_DAILY_AGENT = "claude";
    process.env.EP0CH_DAILY_CWD = work;
    let painted: string[] = [];
    const term: any = { info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, { protocol: null } as any, Date.now(), () => {});
    app.push({ title: "main menu", key() {}, render: (c: any) => ({ lines: Array.from({ length: c.t.rows - 1 }, () => "") }) } as any);
    try {
      app.drawer.set(true, { kind: "user" });
      (app as any).paint();
      await until(() => !!app.drawer.tile, "the drawer's own tile");
      await quitsToAShell(app.drawer.tile!);
      expect(painted.length).toBeGreaterThan(0);
    } finally { app.quit(); app.drawer.tile?.kill(); delete process.env.EP0CH_DAILY_AGENT; delete process.env.EP0CH_DAILY_CWD; }
  }, 20_000);

  test("another agent chosen while the drawer's runs: the running one's exit is still read; the choice runs from the next start", async () => {
    process.env.EP0CH_DAILY_AGENT = "slowclaude";
    process.env.EP0CH_DAILY_CWD = work;
    const term: any = { info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, { protocol: null } as any, Date.now(), () => {});
    app.push({ title: "main menu", key() {}, render: (c: any) => ({ lines: Array.from({ length: c.t.rows - 1 }, () => "") }) } as any);
    try {
      app.drawer.set(true, { kind: "user" });
      (app as any).paint();
      await until(() => !!app.drawer.tile?.running && text(app.drawer.tile!).includes("slow stand-in here"), "the drawer's agent runs", 8000);
      const p = app.drawer.tile! as any;
      p.retarget({ cmd: ["/bin/sh"], cwd: work, name: "shell", herdr: false });
      expect(p.run.cmd).toEqual(["slowclaude"]);                      // what runs now is what it was started as
      p.input("\r");
      await until(() => p.agentExit === 3, "the old agent's exit read", 8000);
      p.restart();
      expect(p.run.cmd).toEqual(["/bin/sh"]);                          // the choice from its next start
      expect(p.agentExit).toBeNull();
    } finally { app.quit(); app.drawer.tile?.kill(); delete process.env.EP0CH_DAILY_AGENT; delete process.env.EP0CH_DAILY_CWD; }
  }, 20_000);
});
