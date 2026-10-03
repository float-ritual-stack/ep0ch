// Starting a door session (PIE-418) and where its files are: shared by the client that starts one, the daemon that
// hands over to its successor, and the terminal host the daemon starts.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JsonLines, listening } from "../jsonl";
import { sessionLog } from "./place";
import { connect } from "node:net";
import { privateDir, stateDir } from "../state";
import { encode, Frames, type DaemonMsg } from "./protocol";

/** The session's socket, file (who it is), lock and log: in its outline's folder (src/session/place.ts). */
export { sessionFile, sessionLock, sessionLog, sessionSocket } from "./place";

/** Until a session answers on `path`, at most `ms`: whether one does. */
export async function waitFor(path: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await listening(path, 500)) return true; await Bun.sleep(100); }
  return false;
}

/** The variables a session doesn't keep from the terminal that started it: it outlives that terminal, its pane and its ssh login. */
export const TERMINAL_VARS = ["HERDR_PANE_ID", "HERDR_TAB_ID", "EP0CH_NEST", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "SSH_AUTH_SOCK", "TMUX", "TMUX_PANE", "WINDOWID", "STY", "TERM", "COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "DISPLAY", "WAYLAND_DISPLAY", "KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR"] as const;
/**
 * Started from inside a door (a tile, a drop shell: EP0CH_IN_DOOR), these name that door and its tile, never the
 * session's own: the session serves its control socket in its own state dir and its tiles are its own.
 */
export const INSIDE_DOOR_VARS = ["EP0CH_CONTROL", "EP0CH_TILE", "EP0CH_TILE_ID", "EP0CH_IN_DOOR"] as const;

/** What a session starts with: this environment, without the terminal's (and an outer door's) variables. */
export function sessionEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const drop = new Set<string>([...TERMINAL_VARS, ...(env.EP0CH_IN_DOOR ? INSIDE_DOOR_VARS : [])]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !drop.has(k)) out[k] = v;
  return out;
}

/**
 * Start the session in the outline folder `dir` (placeFor(args) names it: the daemon finds the same one from the same
 * arguments), detached (its own process group and session, no terminal), and wait until it serves: it says so on fd 3,
 * or why it couldn't. Its output goes to session.log there.
 */
export async function startSession(dir: string, args: readonly string[], more: Record<string, string> = {}, timeoutMs = 30_000): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!privateDir(stateDir(), true) || !privateDir(dir, true)) return { ok: false, error: `${stateDir()} or ${dir} isn't yours alone (each needs mode 700): no session · \`chmod 700 ${stateDir()} ${dir}\` fixes it` };
  return spawnReady(["session", "serve", ...args], { ...sessionEnv(), ...more }, sessionLog(dir), "the session", timeoutMs);
}

/**
 * Run `ep0ch <args>` detached (its own process group and session, no terminal), with its output to `log`, and wait for
 * the one line it says on fd 3 once it serves (`{"ok":true}`), or why it couldn't.
 */
export async function spawnReady(args: string[], env: Record<string, string>, log: string, what: string, timeoutMs = 30_000): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = openSync(log, "a", 0o600);
  const main = join(import.meta.dir, "../main.ts");
  const child = spawn(process.execPath, [main, ...args], { detached: true, stdio: ["ignore", fd, fd, "pipe"], env: { ...env, EP0CH_SESSION_READY: "3" }, cwd: process.cwd() });
  closeSync(fd);
  const said = await new Promise<{ ok: boolean; error?: string } | null>(res => {
    const pipe = child.stdio[3] as NodeJS.ReadableStream | null;
    const done = (v: { ok: boolean; error?: string } | null) => { clearTimeout(t); res(v); };
    const t = setTimeout(() => res(null), timeoutMs);
    const lines = new JsonLines(done, () => done(null));
    pipe?.on("data", (d: Buffer) => lines.feed(d));
    pipe?.on("end", () => done(null));
    child.once("exit", () => setTimeout(() => done(null), 50));
  });
  child.unref();
  (child.stdio[3] as unknown as { destroy?(): void } | null)?.destroy?.();
  if (!said) return { ok: false, error: `${what} didn't start; its log: ${log}${tail(log)}` };
  return said.ok ? { ok: true } : { ok: false, error: said.error ?? `${what} didn't start` };
}

const tail = (path: string) => { try { const l = readFileSync(path, "utf8").trim().split("\n").slice(-6); return l.length ? `\n  ${l.join("\n  ")}` : ""; } catch { return ""; } };


/** One request to the session, its first answer, in the session's frames (not attached: `session list`, `session end`). */
export function askSession(path: string, m: Parameters<typeof encode>[0], ms = 5000): Promise<DaemonMsg | null> {
  return new Promise(res => {
    const sock = connect(path);
    const frames = new Frames<DaemonMsg>();
    const t = setTimeout(() => { sock.destroy(); res(null); }, ms);
    sock.on("connect", () => sock.write(encode(m)));
    sock.on("data", (d: Buffer) => { const got = frames.push(d)[0]; if (got) { clearTimeout(t); sock.end(); res(got); } });
    sock.on("error", () => { clearTimeout(t); res(null); });
    sock.on("close", () => { clearTimeout(t); res(null); });
  });
}

