// The daily tile's agent, run inside Herdr (scripts/door-agent-herdr.ts is its command): the agent lives in a
// Herdr pane, so Herdr lists it, other agents message it (`herdr agent prompt door …`) and it outlives the
// door; the tile is a client attached to that pane (`herdr terminal attach`), not the agent's owner.
//
// - The pane is found by its label (`door-claude`) on the default Herdr server (HERDR_SOCKET_PATH, else
//   Herdr's own default). Missing, it is made: a tab labelled `door-claude` in a workspace labelled `door`
//   (made too if missing), in EP0CH_DAILY_CWD or the tile's folder, without taking Herdr's focus. The agent
//   is started there with `exec`, so /exit ends the pane, and named `door` once Herdr sees it.
// - The tile attaches without --takeover. If another door's tile already has it (or later takes it), this
//   tile watches read-only (`terminal session observe`) and ⏎ takes it over; `q` stops watching.
// - Herdr not installed, or no server answering: the agent runs in the tile directly, as before.
//
// The agent's pane gets EP0CH_TILE (so tools know they're in a door tile) and EP0CH_CONTROL: a link in the
// door's state that this wrapper points at the attached door's control socket each time it attaches, so
// `ep0ch act` (and the outliner's `show`) from the agent reach the door it is shown in, whichever that is.
import { spawn as spawnDetached } from "node:child_process";
import { mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../state";

export interface Ran { code: number; out: string; err: string }
/** Runs one `herdr` command to completion (a fake one in tests). */
export type HerdrRun = (args: string[]) => Promise<Ran>;

export interface AgentConfig {
  /** The Herdr pane's label: how the tile finds it again. */
  pane: string;
  /** The agent's name in Herdr (`herdr agent prompt <name>`). */
  name: string;
  /** The workspace a new pane goes in. */
  workspace: string;
  /** Where a new pane starts. */
  cwd: string;
  /** The agent's command line, as the pane's shell runs it (after `exec`). */
  cmd: string;
  /** The env a new pane gets (EP0CH_TILE, EP0CH_CONTROL). */
  env: Record<string, string>;
  /** The link EP0CH_CONTROL names in the pane, re-pointed at each attach. */
  link: string;
}

/** The defaults, from the environment the door gave the tile. */
export function agentConfig(env: Record<string, string | undefined> = process.env, which = (c: string) => Bun.which(c)): AgentConfig {
  const pane = env.EP0CH_HERDR_PANE || "door-claude";
  const link = join(stateDir(), `agent-${pane.replace(/[^\w.-]/g, "_")}.sock`);
  return {
    pane,
    name: env.EP0CH_HERDR_NAME || "door",
    workspace: env.EP0CH_HERDR_WORKSPACE || "door",
    cwd: env.EP0CH_DAILY_CWD?.trim().replace(/^~(?=$|\/)/, env.HOME ?? "~") || env.PWD || process.cwd(),
    cmd: env.EP0CH_HERDR_AGENT_CMD?.trim() || (which("door-claude") ? "door-claude" : "claude"),
    env: { EP0CH_TILE: env.EP0CH_TILE || "claude", EP0CH_CONTROL: link },
    link,
  };
}

const json = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
const envArgs = (env: Record<string, string>) => Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);

export type Found = { kind: "unreachable"; why: string } | { kind: "pane"; pane: string; terminal: string; created: boolean };

/**
 * The agent's pane on the server: the one labelled `cfg.pane`, else a new one with the agent started in it.
 * `unreachable` when Herdr can't list panes (no server): the caller runs the agent directly.
 */
export async function findOrCreate(herdr: HerdrRun, cfg: AgentConfig): Promise<Found> {
  const listed = await herdr(["pane", "list"]);
  const panes = json(listed.out)?.result?.panes;
  if (listed.code !== 0 || !Array.isArray(panes)) return { kind: "unreachable", why: listed.err.trim() || "herdr pane list failed" };
  const had = panes.find((p: any) => p?.label === cfg.pane && typeof p.terminal_id === "string");
  if (had) return { kind: "pane", pane: String(had.pane_id), terminal: had.terminal_id, created: false };

  // A tab in the `door` workspace if there is one, else the workspace itself (its first tab and pane).
  const spaces = json((await herdr(["workspace", "list"])).out)?.result?.workspaces;
  const space = Array.isArray(spaces) ? spaces.find((w: any) => w?.label === cfg.workspace) : null;
  const made = space
    ? await herdr(["tab", "create", "--workspace", String(space.workspace_id), "--cwd", cfg.cwd, "--label", cfg.pane, ...envArgs(cfg.env), "--no-focus"])
    : await herdr(["workspace", "create", "--cwd", cfg.cwd, "--label", cfg.workspace, ...envArgs(cfg.env), "--no-focus"]);
  const root = json(made.out)?.result?.root_pane;
  if (made.code !== 0 || !root?.pane_id || !root?.terminal_id) throw new Error(`herdr couldn't make the agent's pane: ${made.err.trim() || made.out.trim()}`);
  const pane = String(root.pane_id);
  await herdr(["pane", "rename", pane, cfg.pane]);
  // `exec`: the agent is the pane's program, so /exit ends the pane and the next ⏎ in the tile starts afresh.
  const ran = await herdr(["pane", "run", pane, `exec ${cfg.cmd}`]);
  if (ran.code !== 0) throw new Error(`herdr couldn't start ${cfg.cmd}: ${ran.err.trim()}`);
  return { kind: "pane", pane, terminal: String(root.terminal_id), created: true };
}

/**
 * Names the agent once Herdr has seen it start (a name needs a detected agent): retried every half second.
 * True once named, or when it already has the name.
 */
export async function nameWhenReady(herdr: HerdrRun, pane: string, name: string, tries = 120, wait = 500): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const got = json((await herdr(["agent", "get", name])).out)?.result?.agent;
    if (got?.pane_id === pane) return true;
    if ((await herdr(["agent", "rename", pane, name])).code === 0) return true;
    await Bun.sleep(wait);
  }
  return false;
}

/**
 * Points the pane's EP0CH_CONTROL link at this door's control socket (replaced whole, never half-made).
 * Returns where it pointed before, so a refused attach can put it back.
 */
export function pointLink(link: string, control: string | undefined): string | null {
  let was: string | null = null;
  try { was = readlinkSync(link); } catch { /* none yet */ }
  if (!control || control === was) return was;
  try {
    mkdirSync(join(link, ".."), { recursive: true });
    const tmp = `${link}.${process.pid}.tmp`;
    rmSync(tmp, { force: true });
    symlinkSync(control, tmp);
    renameSync(tmp, link);
  } catch { /* the agent's `show` falls back to Herdr */ }
  return was;
}

/** What an attach ended with: `busy` (another door has it), `taken` (another door took it), or done. */
export type Attached = { kind: "busy" | "taken" } | { kind: "done"; code: number };
export function attachOutcome(code: number, err: string): Attached {
  if (code !== 0 && /already has an attached client/.test(err)) return { kind: "busy" };
  if (code !== 0 && /taken over/.test(err)) return { kind: "taken" };
  return { kind: "done", code };
}

/** The Herdr the wrapper talks to: EP0CH_HERDR_BIN, else `herdr` on PATH; null when there's none. */
export const herdrBin = (env = process.env) => env.EP0CH_HERDR_BIN || Bun.which("herdr");

export function herdrRunner(bin: string): HerdrRun {
  return async args => {
    const p = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
  };
}

/** Runs a program on the tile's terminal and resolves to its exit code (its stderr kept too, for attach). */
async function onTerminal(argv: string[], keepErr = false): Promise<Ran> {
  const p = Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: keepErr ? "pipe" : "inherit" });
  const stop = (sig: NodeJS.Signals) => () => { try { p.kill(sig); } catch { /* gone */ } };
  const onTerm = stop("SIGTERM"), onHup = stop("SIGHUP");
  process.on("SIGTERM", onTerm); process.on("SIGHUP", onHup);
  let err = "";
  if (keepErr && p.stderr) for await (const chunk of p.stderr as ReadableStream<Uint8Array>) { const s = new TextDecoder().decode(chunk); err += s; process.stderr.write(s); }
  const code = await p.exited;
  process.off("SIGTERM", onTerm); process.off("SIGHUP", onHup);
  return { code, out: "", err };
}

/**
 * Watches the pane read-only while another door has it: Herdr's observer stream drawn on the tile at its size.
 * Resolves `takeover` on ⏎, `quit` on q, `closed` when the pane is gone.
 */
function watch(bin: string, terminal: string): Promise<"takeover" | "quit" | "closed"> {
  const out = process.stdout;
  const size = () => [String(out.columns || 80), String(out.rows || 24)];
  // The tile's title says what this is; the terminal is cleared between streams.
  out.write("\x1b]2;watching · another door has it · ⏎ takes it over, q stops\x07\x1b[2J\x1b[H");
  return new Promise(res => {
    let done = false, obs: ReturnType<typeof Bun.spawn> | null = null;
    const finish = (r: "takeover" | "quit" | "closed") => {
      if (done) return; done = true;
      out.off("resize", restart);
      process.stdin.off("data", onKey);
      try { process.stdin.setRawMode?.(false); } catch { /* not a tty */ }
      process.stdin.pause();
      try { obs?.kill(); } catch { /* gone */ }
      out.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m\x1b[2J\x1b[H");
      res(r);
    };
    const start = () => {
      const [cols, rows] = size();
      const p = Bun.spawn([bin, "terminal", "session", "observe", terminal, "--cols", cols!, "--rows", rows!], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      obs = p;
      void (async () => {
        let buf = "";
        for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
          buf += new TextDecoder().decode(chunk);
          for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
            const rec = json(buf.slice(0, i)); buf = buf.slice(i + 1);
            if (rec?.type === "terminal.frame" && typeof rec.bytes === "string") out.write(Buffer.from(rec.bytes, "base64"));
            else if (rec?.type === "terminal.closed") return finish("closed");
          }
        }
        // The stream ended without a close (restarted at a new size, or the server went): only the live one counts.
        if (obs === p) finish("closed");
      })();
    };
    const restart = () => { const old = obs; obs = null; try { old?.kill(); } catch { /* gone */ } start(); };
    const onKey = (d: Buffer) => {
      const s = d.toString("latin1");
      if (s.includes("\r")) finish("takeover");
      else if (s === "q") finish("quit");
    };
    try { process.stdin.setRawMode?.(true); } catch { /* not a tty */ }
    process.stdin.resume();
    process.stdin.on("data", onKey);
    out.on("resize", restart);
    start();
  });
}

/** The whole walk; resolves to the exit code the tile shows. `script` is the wrapper's own path (for the namer). */
export async function main(script: string, env = process.env): Promise<number> {
  // A ctrl+c meant for the agent must never end the wrapper (the tile's pty sends it to the whole group).
  process.on("SIGINT", () => {});
  const cfg = agentConfig(env);
  const direct = () => onTerminal(["sh", "-c", `exec ${cfg.cmd}`]).then(r => r.code);
  const bin = herdrBin(env);
  if (!bin) return direct();
  const herdr = herdrRunner(bin);
  let found: Found;
  try { found = await findOrCreate(herdr, cfg); } catch (e) { process.stderr.write(`${(e as Error).message}\r\n`); return 1; }
  if (found.kind === "unreachable") return direct();
  const { pane, terminal } = found;
  // Named in the background, so the tile shows the agent starting meanwhile.
  if (found.created || (await herdr(["agent", "get", cfg.name])).code !== 0) {
    spawnDetached(process.execPath, [script, "--name", pane, cfg.name], { detached: true, stdio: "ignore", env: { ...env, EP0CH_HERDR_BIN: bin } }).unref();
  }
  let takeover = false;
  for (;;) {
    // The tile's title while attached (the agent may set its own over it).
    process.stdout.write(`\x1b]2;${cfg.pane} in Herdr · ctrl+b q detaches\x07`);
    const was = pointLink(cfg.link, env.EP0CH_CONTROL);
    const ran = await onTerminal([bin, "terminal", "attach", terminal, ...(takeover ? ["--takeover"] : [])], true);
    const r = attachOutcome(ran.code, ran.err);
    if (r.kind === "done") return r.code;
    // Refused: the door that has it keeps the link.
    if (r.kind === "busy" && was) pointLink(cfg.link, was);
    const w = await watch(bin, terminal);
    if (w !== "takeover") return 0;
    takeover = true;
  }
}

/** The wrapper's command line: the walk, or `--name <pane> <name>` (the background namer). */
export async function cli(script: string, argv: string[]): Promise<number> {
  const [flag, pane, name] = argv;
  if (flag === "--name" && pane && name) {
    const bin = herdrBin();
    return bin && (await nameWhenReady(herdrRunner(bin), pane, name)) ? 0 : 1;
  }
  return main(script);
}
