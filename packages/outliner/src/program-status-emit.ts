// A program's side of the Program Status Protocol (OSC 7501, PIE-614): the one emitter our long commands use (`ep0ch
// install --apply`, `ep0ch backup run`, scripts/box-test and scripts/agent-env --test through
// scripts/program-status.ts, the Tree and Detail panes while they wait for the host). The report itself is outline-core's
// (`encodeProgramStatus`); this module decides whether to send it at all and where.
//
// It reports only to a terminal: stderr's, else stdout's. It reports only to one that speaks the protocol, found out the
// spec's ways: `Pst` in its terminfo (the door puts it in a tile's xterm-256color), else the feature query answered
// (`OSC 7501 ; ?`, followed by primary device attributes so a terminal without it answers at once). EP0CH_PROGRAM_STATUS
// says it outright: 1 reports to the terminal without asking, 0 never reports. Every report carries the program's `app`
// (a report replaces its record whole); one the same as the last isn't sent again.
import { spawnSync } from "node:child_process";
import { encodeProgramStatus, isStatusQueryReply, PROGRAM_STATUS_QUERY, TILE_QUERY, tileOfReply, type StatusInput } from "@ep0ch/outline-core/program-status";

type Env = Record<string, string | undefined>;
/** Where reports go: a terminal's stream (process.stderr, process.stdout), or a test's. */
export interface StatusOut { isTTY?: boolean; write(s: string): unknown }

export interface StatusEmitter {
  /** Whether reports go anywhere. */
  readonly on: boolean;
  /** Say what the program is doing: `app` is added; the same report twice in a row is sent once. */
  report(r: StatusInput): void;
}

const OFF: StatusEmitter = { on: false, report() {} };

/** EP0CH_PROGRAM_STATUS: true (1, on, yes), false (0, off, no), or null (left to detection). */
export function statusSetting(env: Env = process.env): boolean | null {
  const v = env.EP0CH_PROGRAM_STATUS?.trim().toLowerCase();
  if (!v) return null;
  if (/^(1|on|yes|true)$/.test(v)) return true;
  if (/^(0|off|no|false)$/.test(v)) return false;
  return null;
}

/** The terminal's own terminfo says it speaks the protocol (`tput Pst`). Absent is no answer: the query decides. */
export function hasPst(env: Env = process.env): boolean {
  if (!env.TERM || env.TERM === "dumb") return false;
  try { return spawnSync("tput", ["Pst"], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "ignore"], timeout: 2000 }).status === 0; }
  catch { return false; }
}

/**
 * Ask the terminal on stdin (the feature query, then CSI c): true when it answers the query before the device
 * attributes, false when only those come, or nothing within `ms`.
 */
export async function askTerminal(write: (s: string) => unknown, ms = 300, stdin: NodeJS.ReadStream = process.stdin): Promise<boolean> {
  return (await askTerminalFor(PROGRAM_STATUS_QUERY, body => (isStatusQueryReply(body) ? true : null), write, ms, stdin)) ?? false;
}

/**
 * Which tile this program is drawn in, asked of the terminal on stdin (PIE-1306: `OSC 7501 ; ?tile`, which a door answers
 * with the tile's `t-<uuid>`, through any ssh, tmux or Herdr between); null from a terminal that isn't a door's tile, or
 * when stdin isn't a terminal this program may read.
 */
export function tileFromTerminal(write: (s: string) => unknown, ms = 500, stdin: NodeJS.ReadStream = process.stdin): Promise<string | null> {
  return askTerminalFor(TILE_QUERY, tileOfReply, write, ms, stdin);
}

/**
 * Send `query` then CSI c to the terminal and read its OSC 7501 answers on stdin: the first body `read` takes, or null
 * when only the device attributes come (a terminal that doesn't know the query), or nothing within `ms`. Stdin is raw
 * only while asking, and left as it was (raw or not, flowing or paused); whatever else was typed meanwhile is put back
 * for its reader. Never asked while another reader has stdin (a full-screen program's own).
 */
async function askTerminalFor<T>(query: string, read: (body: string) => T | null, write: (s: string) => unknown, ms: number, stdin: NodeJS.ReadStream): Promise<T | null> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function" || stdin.listenerCount("data") > 0) return null;
  const wasRaw = stdin.isRaw, wasPaused = stdin.isPaused();
  let seen = "";
  let onData: ((d: Buffer) => void) | null = null;
  try {
    stdin.setRawMode(true);
    return await new Promise<T | null>(done => {
      const timer = setTimeout(() => done(null), ms);
      onData = (d: Buffer) => {
        seen += d.toString("latin1");
        for (const q of seen.matchAll(/\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
          const got = read(q[1]!);
          if (got !== null) { clearTimeout(timer); done(got); return; }
        }
        if (/\x1b\[\?[\d;]*c/.test(seen)) { clearTimeout(timer); done(null); }
      };
      stdin.on("data", onData);
      stdin.resume();
      write(`${query}\x1b[c`);
    });
  } catch { return null; }
  finally {
    if (onData) stdin.off("data", onData);
    if (wasPaused) stdin.pause();
    try { stdin.setRawMode(wasRaw); } catch { /* the terminal went away */ }
    // What the person typed during the probe isn't the terminal's answer: it goes back to whoever reads stdin next.
    const rest = seen.replace(/\x1b\]7501;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[\?[\d;]*c/g, "");
    if (rest) stdin.unshift(Buffer.from(rest, "latin1"));
  }
}

/**
 * The emitter for program `app`, on this process's terminal. `ask: false`: decide without the query (a full-screen
 * program that reads stdin itself: Pst, or the setting, alone).
 */
export async function programStatusEmitter(app: string, o: { env?: Env; out?: StatusOut; ask?: boolean } = {}): Promise<StatusEmitter> {
  const env = o.env ?? process.env;
  const out = o.out ?? (process.stderr.isTTY ? process.stderr : process.stdout.isTTY ? process.stdout : null);
  const setting = statusSetting(env);
  if (setting === false || !out?.isTTY) return OFF;
  if (setting === null && !hasPst(env) && !(o.ask !== false && (await askTerminal(s => out.write(s))))) return OFF;
  return emitterTo(app, out);
}

/** Reports for `app` to `out`, without asking: a caller that already knows the terminal speaks it. */
export function emitterTo(app: string, out: StatusOut): StatusEmitter {
  let last = "";
  return {
    on: true,
    report(r) {
      const seq = encodeProgramStatus(r.state === "clear" ? r : { ...r, app: r.app ?? app });
      if (seq === last) return;
      last = seq;
      try { out.write(seq); } catch { /* the terminal went away */ }
    },
  };
}

/**
 * `work` said as `working` (`msg`) while it runs: cleared when it's done, `error` with why when it throws. For a pane
 * waiting on the outline host (Tree, Detail, the Herdr opener): a terminal that speaks the protocol shows the wait. A
 * full-screen pane never asks (it reads stdin itself): Pst, or the setting, says.
 */
export async function reportWhile<T>(app: string, msg: string, work: () => Promise<T>, o: { env?: Env; out?: StatusOut; ask?: boolean } = {}): Promise<T> {
  const status = await programStatusEmitter(app, { ask: false, ...o });
  status.report({ state: "working", msg });
  try {
    const out = await work();
    status.report({ state: "clear" });
    return out;
  } catch (e) {
    status.report({ state: "error", msg: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
