// Opening the door on a terminal: the App over a service connection, its control socket, its first screens. The
// door's own terminal (`ep0ch --no-daemon`, src/main.ts) and a door session (src/session/daemon.ts, every client
// attached to it) open it the same way; only the terminal differs.
import { App, type AppTerm } from "./app";
import { startControl } from "./control";
import { Logon } from "./screens";
import { startScreens } from "./start";
import type { BoardInfo } from "./board";
import { Offline, SocketBoard, USER } from "./socket";
import { resolveTarget } from "./discover";
import { attachTarget, unnamedHelp } from "./outlines";
import { forwardSaying, forwardTo, rememberMachine } from "./machine";
import { alive, claimState, homeState, readLastCall, readState, useOutlineState, writeLastCall } from "./state";
import { placeOf, type Place } from "./session/place";
import { recoverEdits } from "./surface/editor";
import { sweepPicks } from "./pick";
import type { TermInfo } from "./term";
import { setTheme, startTheme } from "./theme";
import { useEditArm } from "./arm";
import { useHeroHeader } from "./surface/hero-header";
import { useOverscroll } from "./scroll";
import { hostname } from "node:os";
import { Term } from "./term";
import { Mirror } from "./mirror";
import { openScreen } from "./desk/screen-specs";
import { hostSocketOf } from "./discover";
import type { HomeArgs, HomeChoice } from "./home";

export { readLastCall, writeLastCall };

export interface DoorOpen {
  term: AppTerm;
  /** What the terminal was sent, for `peek` and `snap`. */
  mirror: Mirror;
  info: () => TermInfo;
  board: SocketBoard;
  /** The outline the door is on; absent for the home base's door, which is on none yet (it reads no outline's events). */
  service?: BoardInfo;
  /** That outline's folder in the state dir (src/session/place.ts): what's the outline's is kept there. */
  place?: Place;
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
  // What's this outline's goes in its folder; the home base, on none yet, keeps its own in `home/`.
  useOutlineState(o.place ? o.place.dir : homeState());
  const lastCall = readLastCall();
  // The theme: EP0CH_THEME, else the one chosen last time (theme.set keeps it in the state dir), else calm.
  setTheme(startTheme(process.env.EP0CH_THEME, readState<{ name?: string }>("theme.json")?.name));
  // Whether e arms an edit first, and for how long (edit.arm.set keeps it; EP0CH_EDIT_ARM overrides it).
  useEditArm(readState<{ ms?: number }>("edit-arm.json")?.ms);
  useHeroHeader(readState<{ on?: boolean; mode?: string }>("reader-hero.json"));
  useOverscroll(readState<{ rows?: unknown }>("reader-overscroll.json")?.rows);
  const app: App = new App(o.term, o.board, lastCall, () => o.done(app));
  if (o.service) {
    app.host = o.service.host;
    app.workspace = o.service.workspace;
    app.outline = o.service.outline;
    app.machine = o.place?.machine;
    o.board.subscribe(e => app.event(e));
    // The service's extensions (PIE-512): their lines, actions and tile kinds, bound as soon as the list is read.
    void app.loadExtensions();
    // The screens people made (screen notes), read before a screen opens: `--screen <name>` may name one.
    await app.loadScreens();
  } else { app.host = hostname(); app.workspace = "home base"; }
  // Served before any screen starts: terminal tiles are given its path (EP0CH_CONTROL) when they start.
  let refused = "";
  const control = await startControl({ app, mirror: o.mirror, info: o.info }).catch(e => { refused = `no control socket: ${(e as Error).message}`; return null; });
  // Another door on the same outline: marks are shared (marks.json is merged), the desk layout is whoever saves last.
  const others = o.place ? claimState() : [];
  // ctrl+e files a door killed with kill -9 left behind: copied to drafts/ and said.
  const recovered = recoverEdits(alive);
  sweepPicks(alive);
  if (o.start) await o.start(app);
  if (!app.screens().length) {
    const start = startScreens(o.args, process.env, then => new Logon(app, then));
    for (const s of start.screens) app.push(s);
    // `--screen <name> [<target>]`: the same action a menu letter, an agent's act and a session's attach run.
    if (start.open) await app.dispatch.act({ action: "screen.open", args: { ...start.open } }, USER).catch(e => app.flash((e as Error).message, 20_000));
  }
  if (refused) app.flash(refused, 20_000);
  else if (others.length) app.flash(`another door (pid ${others.join(", ")}) is on this outline · marks are shared, the desk layout is whichever saves last`, 20_000);
  else if (recovered.length) app.flash(`an editor's text left by a door that ended was kept in ${recovered[0]}${recovered.length > 1 ? ` (+${recovered.length - 1})` : ""}`, 20_000);
  else if (o.notice) app.flash(o.notice, 12_000);
  return { app, control };
}

/**
 * The outline the door opens on (`--ws <name>`, EP0CH_WS, the folder's `.ep0ch`, on this machine's host, a machine's
 * through its forward, or EP0CH_SOCKET's: resolveTarget), connected and answering; or what's wrong, to print. The door
 * opens a session, so it attaches to its outline and creates it when nobody has yet (like herdr --session <name>): on
 * this machine only, unless `--create` (mayCreate, PIE-545). A
 * folder that names none was asked about before this (src/main.ts); here it is an error that says what to run.
 *
 * On a machine, the forward is started when it isn't up, and again whenever the outline connection drops: the status
 * bar says so (SocketBoard.prepare).
 */
export async function connectTarget(args: readonly string[]): Promise<{ board: SocketBoard; service: BoardInfo; place: Place; notice?: string } | { error: string }> {
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
  // Started again as the connection comes back; a start that fails says how the person starts it (a session's daemon
  // has no ssh agent of its own: their terminal does).
  if (machine) board.prepare = async () => {
    try { return forwardSaying(machine, await forwardTo(machine)); }
    catch (e) { throw new Error(`${(e as Error).message} · \`ep0ch --machine ${machine}\` in a terminal starts the forward again`); }
  };
  let created = false;
  try { created = (await attachTarget(target, args)).created; }
  catch (e) { board.close(); return { error: `can't open the outline "${target.outline}"${machine ? ` on ${machine}` : ""} (${target.path})\n  ${(e as Error).message.replaceAll("\n", "\n  ")}` }; }
  try {
    const service = await board.info();
    const notice = [created ? `created outline ${target.outline}${machine ? ` on ${machine}` : ""}` : "", forwarded ?? ""].filter(Boolean).join(" · ") || undefined;
    const place = placeOf({ outline: target.outline, ...(machine ? { machine } : { socket: target.path }) });
    return { board, service, place, ...(notice ? { notice } : {}) };
  } catch (e) {
    board.close();
    return { error: `no carrier on ${board.path}\n  ${(e as Error).message.replaceAll("\n", "\n  ")}` };
  }
}

/**
 * The home base (src/home.ts) in this terminal, before a door is on an outline: a door on the host the rule names
 * (`args.socket`: EP0CH_SOCKET's, else this machine's) with no outline, its one screen the home base, its control socket
 * served (so `act home.open …` works too). Resolves to the outline chosen, or null when the person quits. The terminal
 * is let go of either way (a crash too), for the door that follows. Not main's door runner: that one ends the process;
 * this one hands the terminal on.
 */
export async function homeBase(args: HomeArgs): Promise<HomeChoice | null> {
  const term = new Term();
  const board = new SocketBoard(args.socket ?? hostSocketOf());
  let finish: (c: HomeChoice | null) => void = () => {};
  const chosen = new Promise<HomeChoice | null>(r => { finish = r; });
  let choice: HomeChoice | null = null, door: Door | null = null;
  const resized = () => mirror?.resize(process.stdout.columns || term.info.cols, process.stdout.rows || term.info.rows);
  let mirror: Mirror | null = null, over = false;
  const end = () => {
    if (over) return;
    over = true;
    door?.control?.close(); board.close(); term.close();
    for (const [s, f] of handlers) process.off(s, f);
    process.stdout.off("resize", resized);
    finish(choice);
  };
  // A signal here ends the home base (nothing to keep yet), and the terminal is put back.
  const handlers = (["SIGHUP", "SIGTERM", "SIGINT", "SIGQUIT"] as const).map(s => [s, () => { end(); process.exit(s === "SIGHUP" || s === "SIGTERM" ? 0 : 130); }] as const);
  for (const [s, f] of handlers) process.on(s, f);
  try {
    await term.start();
    const m = (mirror = new Mirror(term.info.cols, term.info.rows));
    const raw = term.write;
    term.write = (s: string) => { raw(s); m.write(s); };
    process.stdout.prependListener("resize", resized);
    door = await openDoor({
      term, mirror: m, info: () => term.info, board, args: [],
      start: async app => {
        // The door ends just after the action that ended it has answered (an agent's `act` hears what it did); the first
        // choice wins, and a quit in the meantime ends it once.
        let leaving: ReturnType<typeof setTimeout> | null = null;
        const leave = (c: HomeChoice | null) => { if (leaving || over) return; choice = c; leaving = setTimeout(() => { if (!over) app.quit(); }, 50); };
        app.home = { choose(c) { leave(c); }, cancel() { leave(null); } };
        app.push(openScreen("home", { folder: args.folder, ...(args.guess ? { guess: args.guess } : {}), ...(args.machine ? { machine: args.machine } : {}), ...(args.missing ? { missing: args.missing } : {}) }));
      },
      done: () => end(),
    });
  } catch (e) { end(); throw e; }
  return chosen;
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
