// The door agent's environment, one set whichever way it's started (`^W o s` then claude, D's daily agent tile,
// the ▲ claude chip, the Herdr launcher's pane), and what the chip and `ep0ch doctor` say a running agent knows.
// The agent is a stand-in: a script linked as `claude` by absolute path that writes its argv and EP0CH_
// variables to a file, then waits. No real Claude, no real Herdr (a fake `herdr` records what it was asked).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { startControl } from "../src/control";
import { AGENT_VARS, CARRIED_VARS, DOOR_START_VARS, doorAgents, judgeAgent, knowsLabel, lineWithContinue, modDirs, modStamp, procEnv, procStart, withContinue } from "../src/desk/agent-env";
import { agentConfig, findOrCreate, herdrRunner, runLine } from "../src/desk/herdr-agent";
import { PtyPane, tileEnv } from "../src/desk/pty";
import { DRAWER_TILE_ID } from "../src/drawer";
import { doorAgentChecks } from "../src/setup/doctor";
import type { Facts } from "../src/setup/model";
import type { Key } from "../src/term";
import { until } from "./scratch";

/** The agent variables in `env`, the same keys whichever way it was started (only these tests compare them). */
const agentVarsOf = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries([...AGENT_VARS, ...CARRIED_VARS].flatMap(k => (env[k] ? [[k, env[k]!]] : [])));

const ALT = (ch: string): Key => ({ kind: "alt", ch });
let dir = "";
let standin = "";
let out = "";
/** This test's own control socket: tiles get it as EP0CH_CONTROL (never the person's door.sock). */
let control: { path: string; close(): void } | null = null;
const saved: Record<string, string | undefined> = {};
const ENV = ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_HERDR_BIN", "EP0CH_DAILY_CWD", "EP0CH_NEST", "EP0CH_SOCKET", "CLAUDE_CONFIG_DIR", "EP0CH_LANDING", "EP0CH_WS", "EP0CH_MACHINE"];

/** Each start of the stand-in, as it wrote it: its arguments and its EP0CH_ variables. */
function starts(): { argv: string; env: Record<string, string> }[] {
  if (!existsSync(out)) return [];
  // Only whole starts: a stand-in still writing its variables isn't counted yet.
  return readFileSync(out, "utf8").split("--\n").slice(0, -1).map(chunk => {
    const [first, ...rest] = chunk.trim().split("\n");
    return { argv: first!.replace(/^argv:\s?/, ""), env: Object.fromEntries(rest.filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) };
  });
}

/** A Claude mod folder as the Outliner installs it, loaded through Claude's settings. */
function installMod(): string {
  const mod = join(dir, "outliner", "claude-mod");
  mkdirSync(join(mod, "hooks"), { recursive: true });
  mkdirSync(join(mod, ".claude-plugin"), { recursive: true });
  writeFileSync(join(mod, "hooks", "register.ts"), "// the mod\n");
  writeFileSync(join(mod, ".claude-plugin", "plugin.json"), "{}\n");
  const old = new Date(Date.now() - 3600_000);
  utimesSync(join(mod, "hooks", "register.ts"), old, old);
  utimesSync(join(mod, ".claude-plugin", "plugin.json"), old, old);
  mkdirSync(join(dir, "claude-config"), { recursive: true });
  writeFileSync(join(dir, "claude-config", "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: mod } }));
  process.env.CLAUDE_CONFIG_DIR = join(dir, "claude-config");
  return mod;
}
/** The mod changed now (a `git pull` in the Outliner checkout). */
const updateMod = (mod: string) => { const now = new Date(Date.now() + 2000); utimesSync(join(mod, "hooks", "register.ts"), now, now); };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ep0ch-agentenv-"));
  for (const k of ENV) saved[k] = process.env[k];
  process.env.EP0CH_STATE = join(dir, "state");
  delete process.env.EP0CH_NEST; delete process.env.EP0CH_SOCKET; delete process.env.EP0CH_DAILY_CWD; delete process.env.EP0CH_WS; delete process.env.EP0CH_MACHINE;
  out = join(dir, "starts");
  mkdirSync(join(dir, "bin"));
  standin = join(dir, "bin", "claude");
  // TERM is trapped (a Claude asked to exit exits); it waits in a loop, so its own name stays `claude`.
  writeFileSync(standin, `#!/bin/sh\n{ echo "argv: $*"; env | grep '^EP0CH_' | sort; echo "--"; } >> ${JSON.stringify(out)}\ntrap 'exit 0' TERM\nwhile :; do sleep 0.2; done\n`);
  chmodSync(standin, 0o755);
  process.env.EP0CH_DAILY_AGENT = standin;
  const fake = join(dir, "herdr");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${JSON.stringify(join(dir, "calls"))}\nexit 0\n`);
  chmodSync(fake, 0o755);
  process.env.EP0CH_HERDR_BIN = fake;
  mkdirSync(join(dir, "state"), { mode: 0o700 });
  control = await startControl({} as any, join(dir, "state", "door.sock"));
});
afterEach(() => {
  control?.close(); control = null;
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(dir, { recursive: true, force: true });
});

function door(rows = 30, cols = 140) {
  let key: (k: Key) => void = () => {};
  let painted: string[] = [];
  const term: any = {
    info: { cols, rows, cellW: 9, cellH: 16, kitty: false },
    write() {}, paint(lines: string[]) { painted = lines; }, paintRow(r: number, l: string) { painted[r] = l; },
    invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
  };
  const app = new App(term, { protocol: null } as any, Date.now(), () => {});
  const screen = (title: string) => ({ title, key() {}, render(ctx: any) { return { lines: Array.from({ length: ctx.t.rows - 1 }, (_, i) => `${title} row ${i}`) }; } });
  const paint = () => { (app as any).paint(); return painted.map(l => l.replace(/\x1b\[[\d;]*m/g, "")); };
  return { app, term, screen, paint, key: (k: Key) => key(k) };
}

/** A terminal tile running the stand-in, started as the desk starts one. */
async function tile(cmd: string[], label: string, tileId: string, place = "desk") {
  const p = new PtyPane({ cmd, label });
  p.tileId = tileId; p.place = place;
  p.init({ redraw() {}, ctx: { flash() {} } } as any);
  p.render(80, 24, false, null as any);
  await until(() => starts().length > 0, "the stand-in to start");
  return p;
}

describe("one set of agent variables, whichever way the agent is started", () => {
  test("a terminal tile (^W o s, then claude), the drawer's agent (▲ claude, D's daily tile) and the Herdr launcher's pane get the same set", async () => {
    // 1. ^W o s, then claude: a terminal tile's program.
    const t = await tile([standin], "claude", "t5");
    const fromTile = starts()[0]!.env;
    t.kill();
    rmSync(out);

    // 2 and 3. The chip (alt+a) and the daily layout's agent tile are the one drawer tile.
    const d = door();
    let fromDrawer: Record<string, string>;
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await until(() => starts().length > 0, "the drawer's agent");
      fromDrawer = starts()[0]!.env;
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); }

    // 4. The Herdr launcher, in the drawer's tile: what it hands Herdr for the agent's pane (`--env`) and runs there.
    const launcherEnv = tileEnv({ ...process.env, EP0CH_DAILY_AGENT: "/x/door-agent-herdr.ts", EP0CH_LANDING: "welcome" }, "claude", join(dir, "door.sock"), DRAWER_TILE_ID, "drawer");
    const cfg = agentConfig(launcherEnv, () => null);
    writeFileSync(join(dir, "herdr"), `#!/bin/sh\necho "$*" >> ${JSON.stringify(join(dir, "calls"))}\ncase "$1 $2" in\n "pane list") echo '{"result":{"panes":[]}}' ;;\n "workspace list") echo '{"result":{"workspaces":[]}}' ;;\n "workspace create") echo '{"result":{"root_pane":{"pane_id":"w9:p1","terminal_id":"term_new"}}}' ;;\n *) echo '{"result":{}}' ;;\nesac\n`);
    await findOrCreate(herdrRunner(join(dir, "herdr")), cfg);
    const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
    const create = calls.find(c => c.startsWith("workspace create"))!;
    const fromHerdr = Object.fromEntries([...create.matchAll(/--env (EP0CH_\w+)=(.*?)(?= --|$)/g)].map(m => [m[1]!, m[2]!]));

    const keys = (e: Record<string, string>) => Object.keys(agentVarsOf(e)).sort();
    expect(keys(fromTile)).toEqual(["EP0CH_CONTROL", "EP0CH_IN_DOOR", "EP0CH_NEST", "EP0CH_STATE", "EP0CH_TILE", "EP0CH_TILE_ID"]);
    expect(keys(fromDrawer!)).toEqual(keys(fromTile));
    expect(keys(fromHerdr)).toEqual(keys(fromTile));
    for (const k of AGENT_VARS) expect(fromHerdr[k]).toBeTruthy();

    expect(fromTile).toMatchObject({ EP0CH_TILE: "claude", EP0CH_TILE_ID: "t5", EP0CH_IN_DOOR: "1" });
    expect(fromDrawer!).toMatchObject({ EP0CH_TILE: "claude", EP0CH_TILE_ID: DRAWER_TILE_ID, EP0CH_IN_DOOR: "1" });
    expect(fromDrawer!.EP0CH_NEST).toMatch(/door:\d+\/drawer\/drawer\.agent:claude$/);
    // In Herdr: the link the launcher points at the attached door, the tile's nest then the pane's layer.
    expect(fromHerdr).toMatchObject({ EP0CH_TILE: "claude", EP0CH_TILE_ID: DRAWER_TILE_ID, EP0CH_IN_DOOR: "1", EP0CH_CONTROL: cfg.link });
    // A test door (its own EP0CH_STATE): its own pane, `door-claude-<hash>`, never the person's.
    expect(cfg.pane).toMatch(/^door-claude-[0-9a-f]{8}$/);
    expect(fromHerdr.EP0CH_NEST).toMatch(new RegExp(`door:\\d+/drawer/drawer\\.agent:claude › herdr:${cfg.pane}$`));
    // The pane mustn't inherit how a door was started from the Herdr server's own environment.
    const run = calls.find(c => c.startsWith("pane run"))!;
    for (const k of DOOR_START_VARS) expect(run).toContain(`-u ${k}`);
    expect(run).toMatch(/exec env (-u \w+ )+\S+ -l -c 'exec \/bin\/sh -c '\\''claude; c=\$\?; /);
  });

  test("the door names its outline (EP0CH_WS, and EP0CH_MACHINE only on another machine) to a tile program, the drawer's agent and the Herdr launcher's pane (PIE-756)", async () => {
    process.env.EP0CH_WS = "garden"; process.env.EP0CH_MACHINE = "far-box";
    const t = await tile([standin], "claude", "t6");
    expect(starts()[0]!.env).toMatchObject({ EP0CH_WS: "garden", EP0CH_MACHINE: "far-box" });
    t.kill();
    rmSync(out);
    delete process.env.EP0CH_MACHINE;
    const local = await tile([standin], "claude", "t7");
    expect(starts()[0]!.env.EP0CH_WS).toBe("garden");
    expect(starts()[0]!.env.EP0CH_MACHINE).toBeUndefined();
    local.kill();
    // The launcher's env is the tile's; its pane gets the same two.
    const launcherEnv = tileEnv(process.env, "claude", join(dir, "door.sock"), DRAWER_TILE_ID, "drawer");
    expect(launcherEnv.EP0CH_WS).toBe("garden");
    expect(agentConfig(launcherEnv, () => null).env).toMatchObject({ EP0CH_WS: "garden" });
  });

  test("a terminal tile opened without a name (^W o s) tells its program the name the desk gave it", async () => {
    const p = new PtyPane({ cmd: [standin] });
    p.tileId = "t12"; p.tileName = "pty2";
    p.init({ redraw() {}, ctx: { flash() {} } } as any);
    p.render(80, 24, false, null as any);
    try {
      await until(() => starts().length > 0, "the stand-in to start");
      expect(starts()[0]!.env).toMatchObject({ EP0CH_TILE: "pty2", EP0CH_TILE_ID: "t12" });
      expect(starts()[0]!.env.EP0CH_NEST).toMatch(/\/t12:pty2$/);
    } finally { p.kill(); }
  });

  test("a launcher run by hand (no tile id) unsets any EP0CH_TILE_ID the Herdr server has", () => {
    const cfg = agentConfig({ HOME: "/h", PWD: "/w", EP0CH_TILE: "claude" }, () => null);
    expect(cfg.unset).toContain("EP0CH_TILE_ID");
    expect(runLine(cfg, "sh")).toMatch(new RegExp(`^exec env ${cfg.unset.map(k => `-u ${k}`).join(" ")} sh -l -c 'exec /bin/sh -c '\\\\''claude; `));
    expect(runLine({ agent: ["pi"], unset: [] }, "zsh")).toMatch(/^exec zsh -l -c 'exec \/bin\/sh -c '\\''pi; c=\$\?; .*exec zsh -l'\\'''$/);
  });

  test("a restart keeps the conversation: a bare claude gets --continue, door-claude and a claude told what to resume are left as they are", () => {
    expect(withContinue(["/opt/bin/claude"])).toEqual(["/opt/bin/claude", "--continue"]);
    expect(withContinue(["claude", "--model", "x"])).toEqual(["claude", "--model", "x", "--continue"]);
    expect(withContinue(["claude", "-c"])).toEqual(["claude", "-c"]);
    expect(withContinue(["claude", "--resume=abc"])).toEqual(["claude", "--resume=abc"]);
    expect(withContinue(["door-claude"])).toEqual(["door-claude"]);
    expect(withContinue(["/x/door-agent-herdr.ts"])).toEqual(["/x/door-agent-herdr.ts"]);
    expect(lineWithContinue("claude --model x")).toBe("claude --model x --continue");
    expect(lineWithContinue("door-claude")).toBe("door-claude");
    expect(agentConfig({ HOME: "/h", PWD: "/w", EP0CH_AGENT_CONTINUE: "1" }, () => null).cmd).toBe("claude --continue");
    expect(agentConfig({ HOME: "/h", PWD: "/w", EP0CH_AGENT_CONTINUE: "1" }, () => "/bin/door-claude").cmd).toBe("claude --continue");
  });
});

describe("what a running agent knows", () => {
  test("its own environment and start are read from its process; the mod's newest code file is the one Claude loads", async () => {
    const mod = installMod();
    expect(modDirs()).toEqual([mod]);
    const before = modStamp([mod])!;
    expect(before.dir).toBe(mod);
    const t = await tile([standin], "claude", "t2");
    try {
      const env = (await procEnv(t.pid!))!;
      expect(env.EP0CH_TILE_ID).toBe("t2");
      const started = (await procStart(t.pid!))!;
      expect(Math.abs(started - Date.now())).toBeLessThan(10_000);
      expect(judgeAgent({ pid: t.pid!, env, startedAt: started }, modStamp([mod]))).toMatchObject({ state: "current" });
      updateMod(mod);
      const after = modStamp([mod])!;
      expect(after.file).toBe(join(mod, "hooks", "register.ts"));
      // A mod changed after the agent started reloads into it live (Claude Code 2.1.287+): still current.
      expect(judgeAgent({ pid: t.pid!, env, startedAt: started }, after)).toMatchObject({ state: "current" });
    } finally { t.kill(); }
  });

  test("judged: current (even with a newer mod, which reloads live), stale (an older door's missing variables), no door tools, unknown", () => {
    const mod = { dir: "/o/claude-mod", at: 1_000_000, file: "/o/claude-mod/hooks/register.ts" };
    const full = { EP0CH_CONTROL: "/s/door.sock", EP0CH_TILE: "claude", EP0CH_TILE_ID: "t3", EP0CH_NEST: "door:1/daily/t3:claude", EP0CH_IN_DOOR: "1" };
    expect(judgeAgent({ pid: 1, env: full, startedAt: 2_000_000 }, mod).state).toBe("current");
    expect(judgeAgent({ pid: 1, env: full, startedAt: 500_000 }, mod).state).toBe("current");
    // An older door's Herdr pane: EP0CH_CONTROL, EP0CH_TILE and EP0CH_NEST only.
    const old = judgeAgent({ pid: 1, env: { EP0CH_CONTROL: "/s/l", EP0CH_TILE: "claude", EP0CH_NEST: "x" }, startedAt: 2_000_000 }, mod);
    expect(old).toMatchObject({ state: "stale" });
    expect(old.why).toContain("EP0CH_TILE_ID, EP0CH_IN_DOOR");
    expect(judgeAgent({ pid: 1, env: { EP0CH_TILE: "claude" }, startedAt: 2_000_000 }, mod).state).toBe("no-door");
    expect(judgeAgent({ pid: 1, env: null, startedAt: null }, mod).state).toBe("unknown");
    expect(judgeAgent({ pid: 1, env: full, startedAt: 2_000_000 }, null).state).toBe("unknown");
    expect(knowsLabel({ state: "current", why: "" })).toBe("door tools");
    expect(knowsLabel({ state: "stale", why: "" })).toBe("started before update ⟳");
    expect(knowsLabel({ state: "no-door", why: "" })).toBe("no door tools ⟳");
    expect(knowsLabel({ state: "unknown", why: "" })).toBe("");
  });

  test("the chip says `door tools`, still after the mod changes (it reloads live); when stale, a click on ⟳ restarts the agent alone, continuing", async () => {
    const mod = installMod();
    process.env.EP0CH_DAILY_AGENT = standin;
    const bystander = Bun.spawn(["sleep", "30"]);                     // never signalled
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await until(() => d.app.drawer.tile?.running === true && starts().length === 1, "the drawer's agent");
      const first = d.app.drawer.tile!.pid!;
      await d.app.drawer.readKnows();
      expect(d.app.drawer.chipText()).toMatch(/^▼ claude · (idle|working) · door tools$/);
      updateMod(mod);
      await d.app.drawer.readKnows();
      expect(d.app.drawer.chipText()).toMatch(/^▼ claude · (idle|working) · door tools$/);
      // Stale is an older door's missing variables now; stand that in, then restart by ⟳.
      (d.app.drawer as any).knows = { state: "stale", why: "started by an older door, without EP0CH_TILE_ID" };
      expect(d.app.drawer.chipText()).toMatch(/^▼ claude · (idle|working) · started before update ⟳$/);

      // ⟳ is the chip's last cell: a click there restarts; anywhere else on the chip still toggles the drawer.
      const shown = d.paint();
      const chip = d.app.drawer.chipAt!;
      expect(shown.at(-1)!.slice(chip.to - 1, chip.to)).toBe("⟳");
      d.key({ kind: "mouse", action: "down", button: 0, x: chip.to - 1, y: chip.row });
      expect(d.app.drawer.open).toBe(true);                               // not toggled
      await until(() => starts().length === 2 && d.app.drawer.tile?.running === true, "the restart");
      expect(d.app.drawer.tile!.pid).not.toBe(first);
      expect(starts()[1]!.argv).toBe("--continue");                     // a bare claude continues its conversation
      expect(starts()[1]!.env.EP0CH_CONTROL).toBe(starts()[0]!.env.EP0CH_CONTROL);
      expect(bystander.exitCode).toBeNull();
      // Restarted by this door: current again.
      await d.app.drawer.readKnows();
      expect(d.app.drawer.chipText()).toMatch(/door tools$/);
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); bystander.kill(); }
  });

  test("agent.restart by act: refused while the person types in the agent, else done and said; alt+R is the key", async () => {
    installMod();
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await until(() => d.app.drawer.tile?.running === true && starts().length === 1, "the drawer's agent");
      const sink = d.term.rawSink();
      sink("hello");                                                    // the person types in it
      await expect(d.app.act({ action: "agent.restart", args: {}, as: "helper" })).rejects.toThrow(/typing in claude in the drawer/);
      d.key({ kind: "char", ch: "]", ctrl: true });                     // they leave the drawer, just now
      await expect(d.app.act({ action: "agent.restart", args: {}, as: "helper" })).rejects.toThrow(/typed into the agent/);
      d.app.drawer.tile!.personKeyAt = Date.now() - 60_000;
      const r: any = await d.app.act({ action: "agent.restart", args: {}, as: "helper" });
      expect(r).toMatchObject({ restarted: true });
      await until(() => starts().length === 2, "the agent's restart");
      // The person's alt+R, outside the drawer.
      d.key(ALT("R"));
      await until(() => starts().length === 3 && d.app.drawer.tile?.running === true, "alt+R's restart");
      expect(d.app.actions().actions.map((a: any) => a.name)).toContain("agent.restart");
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); }
  });

  test("in Herdr, a restart without the agent's pid is refused: restarting only the attach would leave the old agent", async () => {
    installMod();
    const d = door();
    try {
      d.app.push(d.screen("main menu") as any);
      d.key(ALT("a")); d.paint();
      await until(() => d.app.drawer.tile?.running === true && starts().length === 1, "the drawer's agent");
      await d.app.act({ action: "tile.herdr", tile: DRAWER_TILE_ID, args: { pane: "door-claude" }, as: "door" });
      d.key({ kind: "char", ch: "]", ctrl: true });
      d.app.drawer.tile!.personKeyAt = 0;
      // The fake Herdr lists no pane labelled door-claude.
      await expect(d.app.act({ action: "agent.restart", args: {}, as: "helper" })).rejects.toThrow(/couldn't find the agent's process in Herdr pane door-claude/);
      expect(d.app.drawer.tile!.running).toBe(true);                      // nothing was signalled
      expect(starts().length).toBe(1);
    } finally { d.app.quit(); d.app.drawer.tile?.kill(); }
  });

  test("ep0ch doctor: a newer mod leaves a door agent current; a stale one (older door) is listed with the fix", async () => {
    const mod = installMod();
    const t = await tile([standin], "claude", "t7", "daily");
    try {
      // The agent runs inside the tile's login shell (no dead tiles): it's found by its tile, not the shell's pid.
      const ours = (a: { env: Record<string, string> | null }) => a.env?.EP0CH_TILE_ID === "t7";
      for (let i = 0; i < 50 && !(await doorAgents(process.env, process.platform, [mod])).some(ours); i++) await Bun.sleep(100);
      let found = await doorAgents(process.env, process.platform, [mod]);
      const mine = found.find(ours);
      expect(mine?.knows.state).toBe("current");
      updateMod(mod);
      found = await doorAgents(process.env, process.platform, [mod]);
      expect(found.find(ours)?.knows.state).toBe("current");
      const stale = found.filter(ours).map(a => ({ ...a, knows: { state: "stale", why: "started by an older door" } }));
      const facts = { claude: { agents: stale } } as unknown as Facts;
      const [check] = doorAgentChecks(facts);
      expect(check).toMatchObject({ group: "claude", name: `agent ${stale[0]!.pid}`, status: "behind" });
      expect(check!.detail).toContain("door:");
      expect(check!.fix).toContain("/exit");                              // a tile's own claude: restarted by hand
      // The door's agent (its tile id, or its Herdr pane made by an older door) is restarted by the chip.
      const drawer = (env: Record<string, string>) => doorAgentChecks({ claude: { agents: [{ pid: 9, cmd: "claude", env, startedAt: 0, knows: { state: "stale", why: "x" } }] } } as unknown as Facts)[0]!.fix;
      expect(drawer({ EP0CH_TILE_ID: DRAWER_TILE_ID })).toContain("⟳");
      expect(drawer({ EP0CH_NEST: "door:1/daily/t3:claude › herdr:door-claude" })).toContain("⟳");
      expect(doorAgentChecks({ claude: { agents: [] } } as unknown as Facts)).toEqual([{ group: "claude", name: "door agents", status: "info", detail: "no Claude running in a door tile or the door's Herdr pane" }]);
      expect(doorAgentChecks({ claude: {} } as unknown as Facts)).toEqual([]);
    } finally { t.kill(); }
  });
});
