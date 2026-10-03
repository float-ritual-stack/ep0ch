// Opening the door on a terminal: the App over a service connection, its control socket, its first screens. The
// door's own terminal (`ep0ch --no-daemon`, src/main.ts) and a door session (src/session/daemon.ts, every client
// attached to it) open it the same way; only the terminal differs.
import { App, type AppTerm } from "./app";
import { startControl } from "./control";
import type { Mirror } from "./mirror";
import { Logon } from "./screens";
import { startScreens } from "./start";
import type { BoardInfo } from "./board";
import { Offline, SocketBoard } from "./socket";
import { resolveTarget } from "./discover";
import { attachTarget, unnamedHelp } from "./outlines";
import { forwardSaying, forwardTo, rememberMachine } from "./machine";
import { alive, claimState, readLastCall, readState, writeLastCall } from "./state";
import { recoverEdits } from "./surface/editor";
import type { TermInfo } from "./term";
import { setTheme, startTheme } from "./theme";

export { readLastCall, writeLastCall };

export interface DoorOpen {
  term: AppTerm;
  /** What the terminal was sent, for `peek` and `snap`. */
  mirror: Mirror;
  info: () => TermInfo;
  board: SocketBoard;
  service: BoardInfo;
  args: readonly string[];
  /** Said once it's up, when nothing more pressing is (`created outline pie`, the folder's binding). */
  notice?: string;
  /** The door is ending (App.quit): put the terminal back, close up, exit. */
  done(app: App): void;
  /**
   * Open the first screens another way than the flags say (a session's next daemon restores what was open,
   * src/session/restore.ts); else the logon, or the screen a flag names.
   */
  start?(app: App): Promise<void>;
}

export interface Door { app: App; control: { path: string; close(): void } | null }

export async function openDoor(o: DoorOpen): Promise<Door> {
  const lastCall = readLastCall();
  // The theme: EP0CH_THEME, else the one chosen last time (theme.set keeps it in the state dir), else calm.
  setTheme(startTheme(process.env.EP0CH_THEME, readState<{ name?: string }>("theme.json")?.name));
  const app: App = new App(o.term, o.board, lastCall, () => o.done(app));
  app.host = o.service.host;
  app.workspace = o.service.workspace;
  app.outline = o.service.outline;
  o.board.subscribe(e => app.event(e));
  // The service's extensions (PIE-512): their lines, actions and tile kinds, bound as soon as the list is read.
  void app.loadExtensions();
  // Served before any screen starts: terminal tiles are given its path (EP0CH_CONTROL) when they start.
  let refused = "";
  const control = await startControl({ app, mirror: o.mirror, info: o.info }).catch(e => { refused = `no control socket: ${(e as Error).message}`; return null; });
  // Another door on the same state: marks are shared (marks.json is merged), the desk layout is whoever saves last.
  const others = claimState();
  // ctrl+e files a door killed with kill -9 left behind: copied to drafts/ and said.
  const recovered = recoverEdits(alive);
  if (o.start) await o.start(app);
  if (!app.screens().length) for (const s of startScreens(o.args, process.env, then => new Logon(app, then))) app.push(s);
  if (refused) app.flash(refused, 20_000);
  else if (others.length) app.flash(`another door (pid ${others.join(", ")}) uses this state dir · marks are shared, the desk layout is whichever saves last`, 20_000);
  else if (recovered.length) app.flash(`an editor's text left by a door that ended was kept in ${recovered[0]}${recovered.length > 1 ? ` (+${recovered.length - 1})` : ""}`, 20_000);
  else if (o.notice) app.flash(o.notice, 12_000);
  return { app, control };
}

/**
 * The outline the door opens on (`--ws <name>`, EP0CH_WS, the folder's `.ep0ch`, on this machine's host, a machine's
 * through its forward, or EP0CH_SOCKET's: resolveTarget), connected and answering; or what's wrong, to print. The door
 * opens a session, so it attaches to its outline and creates it when nobody has yet (like herdr --session <name>). A
 * folder that names none got the home base before this (src/main.ts); here it is an error that says what to run.
 *
 * On a machine, the forward is started when it isn't up, and again whenever the outline connection drops: the status
 * bar says so (SocketBoard.prepare).
 */
export async function connectTarget(args: readonly string[]): Promise<{ board: SocketBoard; service: BoardInfo; notice?: string } | { error: string }> {
  const target = resolveTarget(args);
  if ("error" in target) return { error: target.error };
  if ("unnamed" in target) return { error: unnamedHelp(target) };
  const machine = target.machine;
  let forwarded: string | null = null;
  if (machine) {
    try { forwarded = forwardSaying(machine, await forwardTo(machine)); }
    catch (e) { return { error: `can't reach the outline host on ${machine}\n  ${(e as Error).message}` }; }
    rememberMachine(machine);
  }
  const board = new SocketBoard(target.path, undefined, target.outline);
  if (machine) board.prepare = async () => forwardSaying(machine, await forwardTo(machine));
  let created = false;
  try { created = (await attachTarget(target)).created; }
  catch (e) { board.close(); return { error: `can't open the outline "${target.outline}" on ${target.path}\n  ${(e as Error).message}` }; }
  try {
    const service = await board.info();
    const notice = [created ? `created outline ${target.outline}${machine ? ` on ${machine}` : ""}` : "", forwarded ?? ""].filter(Boolean).join(" · ") || undefined;
    return { board, service, ...(notice ? { notice } : {}) };
  } catch (e) {
    board.close();
    return { error: `no carrier on ${board.path}\n  ${(e as Error).message}` };
  }
}

/** How the door is ending, once it is: the exit code, and the crash that ended it. */
export interface Ending { code: number; crash?: unknown }

/**
 * One teardown for every way the door ends, in its own terminal or as a session: a signal or a crash (an uncaught
 * exception or rejection) ends it through App.terminate (drafts and comments copied to disk), once; a second one, or
 * one before the door is up, goes at once (`now`). `signal` says what a signal means here: an exit code, or null to
 * leave it alone. "Couldn't ask the outline" (an Offline nobody caught) is said, never a crash; a `hangup` (a terminal
 * that has gone) ends it as a signal would.
 */
export function guardDoor(o: { door(): Door | null; signal(sig: NodeJS.Signals): number | null; hangup?(e: unknown): boolean; now(code: number, crash?: unknown): void }): { ending(): Ending | null } {
  let ending: Ending | null = null;
  const end = (code: number, crash?: unknown) => {
    const d = o.door();
    if (ending || !d) { o.now(ending?.code ?? code, crash); return; }
    ending = { code, ...(crash !== undefined ? { crash } : {}) };
    d.app.terminate();
  };
  for (const sig of ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const) process.on(sig, () => { const c = o.signal(sig); if (c !== null) end(c); });
  const fault = (e: unknown) => {
    const d = o.door();
    if (e instanceof Offline && d && !ending) { d.app.flash(e.message); return; }
    if (o.hangup?.(e)) return end(0);
    end(1, e);
  };
  process.on("uncaughtException", fault);
  process.on("unhandledRejection", fault);
  return { ending: () => ending };
}
