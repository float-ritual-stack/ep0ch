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
// - Two doors starting at once make one pane: the look-and-make is done holding a lock beside the link.
// - Herdr not installed, no server answering (or one not answering in 10s), or the pane couldn't be made: the
//   agent runs in the tile directly, as before.
//
// The agent's pane gets EP0CH_NEST (the tile's, then `herdr:<pane label>`: src/nest.ts), EP0CH_TILE (so tools
// know they're in a door tile) and EP0CH_CONTROL: a link in the
// door's state that this wrapper points at the attached door's control socket each time it attaches, so
// `ep0ch act` (and the outliner's `show`) from the agent reach the door it is shown in, whichever that is.
// When the attach ends (detached, or the door quit or crashed) the link is dropped if it's still this door's,
// so the agent's `show` falls back to Herdr instead of reaching a door that doesn't show it.
import { spawn as spawnDetached } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { appendNest } from "../nest";
import { alive, stateDir } from "../state";

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
  /** The env a new pane gets (EP0CH_TILE, EP0CH_CONTROL, and EP0CH_NEST ending in `herdr:<pane label>`). */
  env: Record<string, string>;
  /** The link EP0CH_CONTROL names in the pane, re-pointed at each attach. */
  link: string;
  /** Held while the pane is looked for and made, so two doors starting at once make one pane. */
  lock: string;
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
    // The pane's nest: the tile's that made it, then the pane itself. Another door may show it later
    // (`ep0ch where` follows EP0CH_CONTROL to the door that shows it now).
    env: { EP0CH_TILE: env.EP0CH_TILE || "claude", EP0CH_CONTROL: link, EP0CH_NEST: appendNest(env.EP0CH_NEST, `herdr:${pane}`) },
    link,
    lock: `${link}.lock`,
  };
}

const json = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
const envArgs = (env: Record<string, string>) => Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);

export type Found = { kind: "unreachable"; why: string } | { kind: "pane"; pane: string; terminal: string; created: boolean };

/**
 * Runs `f` holding a lock file (O_EXCL, with the holder's pid): two doors starting at once would otherwise
 * both find no pane and both make one. A lock whose holder is gone, or older than `stale` ms, is taken over;
 * after `wait` ms it goes ahead without (a wedged holder must not wedge the tile).
 */
export async function withLock<T>(path: string, f: () => Promise<T>, wait = 20_000, stale = 30_000): Promise<T> {
  const until = Date.now() + wait;
  let held = false;
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* the open says why */ }
  while (!held) {
    try {
      const fd = openSync(path, "wx");
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
      held = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") break;
      let gone = false;
      try {
        const pid = Number(readFileSync(path, "utf8"));
        gone = Date.now() - statSync(path).mtimeMs > stale || !(pid > 0 && alive(pid));
      } catch { gone = false; /* being written or just removed: try again */ }
      if (gone) { rmSync(path, { force: true }); continue; }
      if (Date.now() > until) break;
      await Bun.sleep(50);
    }
  }
  try { return await f(); } finally { if (held) rmSync(path, { force: true }); }
}

/**
 * The agent's pane on the server: the one labelled `cfg.pane`, else a new one with the agent started in it.
 * `unreachable` when Herdr can't list panes (no server): the caller runs the agent directly.
 */
export async function findOrCreate(herdr: HerdrRun, cfg: AgentConfig): Promise<Found> {
  const listed = await herdr(["pane", "list"]);
  const panes = json(listed.out)?.result?.panes;
  if (listed.code !== 0 || !Array.isArray(panes)) return { kind: "unreachable", why: listed.err.trim() || String(json(listed.out)?.error?.message ?? "") || "herdr pane list failed" };
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
export function pointLink(link: string, control: string | undefined | null): string | null {
  let was: string | null = null;
  try { was = readlinkSync(link); } catch { /* none yet */ }
  if (control === null) {
    // Nothing to point at: the link goes, so the agent's `show` finds no door and falls back to Herdr.
    try { rmSync(link, { force: true }); } catch { /* gone */ }
    return was;
  }
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

/**
 * When the attach ends: the link is dropped if it still points at this door, so an agent left running after
 * this door quit (or crashed) never reaches a door that doesn't show it, such as a later door on door.sock.
 */
export function releaseLink(link: string, control: string | undefined) {
  if (!control) return;
  try { if (readlinkSync(link) === control) rmSync(link, { force: true }); } catch { /* none */ }
}

/** The Herdr the wrapper talks to: EP0CH_HERDR_BIN, else `herdr` on PATH; null when there's none. */
export const herdrBin = (env = process.env) => env.EP0CH_HERDR_BIN || Bun.which("herdr");

/** Runs `herdr` commands; one that takes longer than `timeoutMs` (a wedged server) is killed and fails. */
export function herdrRunner(bin: string, timeoutMs = 10_000): HerdrRun {
  return async args => {
    const p = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timer: Timer | undefined;
    const late = new Promise<Ran>(res => {
      timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch { /* gone */ }
        res({ code: 124, out: "", err: `herdr ${args.slice(0, 2).join(" ")} didn't answer in ${timeoutMs / 1000}s` });
      }, timeoutMs);
    });
    const ran = Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ code, out, err }));
    try { return await Promise.race([ran, late]); } finally { clearTimeout(timer); }
  };
}

/** The tile's title while it shows the Herdr pane: for the person. The door learns it from `tile.herdr` instead. */
export const attachTitle = (pane: string) => `${pane} in Herdr · ctrl+b q detaches`;
export const WATCH_TITLE = "watching · another door has it · ⏎ takes it over, q stops";

/**
 * Tells the door this tile shows an agent that lives in Herdr (`tile.herdr`, PIE-491), over the door's control
 * socket (EP0CH_CONTROL), as the tile it runs in (EP0CH_TILE_ID, else EP0CH_TILE): quitting the door then
 * leaves the agent running. No door answering (the wrapper run by hand) is fine: nothing needs saying.
 */
export function tellDoor(env: Record<string, string | undefined>, pane: string, as: string, timeoutMs = 2000): Promise<boolean> {
  const control = env.EP0CH_CONTROL, tile = env.EP0CH_TILE_ID || env.EP0CH_TILE;
  if (!control || !tile) return Promise.resolve(false);
  return new Promise(res => {
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* gone */ } res(ok); };
    const sock = connect(control, () => sock.write(JSON.stringify({ cmd: "act", action: "tile.herdr", args: { pane }, reader: tile, as }) + "\n"));
    const timer = setTimeout(() => finish(false), timeoutMs);
    let buf = "";
    sock.on("data", d => { buf += d.toString(); const i = buf.indexOf("\n"); if (i >= 0) finish(!!json(buf.slice(0, i))?.ok); });
    sock.on("error", () => finish(false));
    sock.on("close", () => finish(false));
  });
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
  out.write(`\x1b]2;${WATCH_TITLE}\x07\x1b[2J\x1b[H`);
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
  try { found = await withLock(cfg.lock, () => findOrCreate(herdr, cfg)); } catch (e) { found = { kind: "unreachable", why: (e as Error).message }; }
  if (found.kind === "unreachable") {
    // No server, a wedged one, or it couldn't make the pane: the tile still gets its agent, run here.
    if (found.why && !/server_not_running|no herdr server/.test(found.why)) process.stderr.write(`herdr: ${found.why.split("\n")[0]} · running the agent here\r\n`);
    return direct();
  }
  const { pane, terminal } = found;
  // Named in the background, so the tile shows the agent starting meanwhile.
  if (found.created || (await herdr(["agent", "get", cfg.name])).code !== 0) {
    spawnDetached(process.execPath, [script, "--name", pane, cfg.name], { detached: true, stdio: "ignore", env: { ...env, EP0CH_HERDR_BIN: bin } }).unref();
  }
  // The door learns it from the tile's own program, typed, not from a title anything could print.
  await tellDoor(env, cfg.pane, cfg.name);
  let takeover = false;
  for (;;) {
    // The tile's title while attached (the agent may set its own over it).
    process.stdout.write(`\x1b]2;${attachTitle(cfg.pane)}\x07`);
    const was = pointLink(cfg.link, env.EP0CH_CONTROL);
    const ran = await onTerminal([bin, "terminal", "attach", terminal, ...(takeover ? ["--takeover"] : [])], true);
    const r = attachOutcome(ran.code, ran.err);
    // Detached, the agent gone, or this door going (a signal): the link no longer names a door showing it.
    if (r.kind === "done") { releaseLink(cfg.link, env.EP0CH_CONTROL); return r.code; }
    // Refused: the door that has it keeps the link (none before: none now).
    if (r.kind === "busy") pointLink(cfg.link, was);
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
