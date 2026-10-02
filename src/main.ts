#!/usr/bin/env bun
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { join } from "node:path";
import { SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients } from "./control";
import { skillCommand } from "./skills";
import { resolveTarget } from "./discover";
import { parseOutlineArgs, runOutlineCommand } from "./outlines";
import { Mirror } from "./mirror";
import { setupCommand } from "./setup/apply";
import { whereCommand } from "./where";
import { connectTarget, guardDoor, openDoor, writeLastCall, type Door } from "./door";
import { attachDoor, doorMode, sessionCommand } from "./session/client";

let args = process.argv.slice(2);
const USAGE = `ep0ch: a BBS door into a pi-herdr-outliner outline

  ep0ch [--ws <name> | --ws <root> | <socket>] [--board [<hub-id>] | --desk | --layout <name> | --river | --brief | --welcome | --showcase]
                                   open the door (the logon, then the main menu, by default);
                                   --layout daily opens the desk laid out as a named layout (daily,
                                   river, board, desk, or one saved with ^W w);
                                   --brief opens the newest daily brief (type::daily-brief), and
                                   EP0CH_LANDING=brief lands on it after the logon;
                                   --welcome opens the welcome notes ([welcome::1] first), and
                                   EP0CH_LANDING=welcome lands there after the logon.
                                   With an outline host running, --ws <name> opens that outline,
                                   creating it if there is none (like herdr --session <name>); with
                                   nothing named, the folder's bound outline, else the outline named
                                   after the folder. A --ws with a / is a folder root, as before
  ep0ch session list [--json] | attach [--watch] | end [--yes]
                                   the door session in this state dir: who's attached and what runs in its
                                   tiles; attach to it (--watch: read-only); end it (asks while programs run).
                                   EP0CH_DAEMON=1 ep0ch runs the door as a session (quitting detaches; ep0ch
                                   attaches again); with one running, ep0ch attaches; --no-daemon opens the
                                   door in this terminal instead
  ep0ch outline list | attach <name> | create <name> | adopt <path> <name> [--root <dir>]
                | stop <name> | delete <name> [--yes]      [--json]
                                   the host's outlines: attach opens the door on one (the same as
                                   --ws <name>); stop releases its database; delete unlinks an adopted
                                   outline or moves a created one to deleted/, after asking
  ep0ch status [--json]            the outline host: its socket, default outline, open outlines
  ep0ch doctor [--json]            every piece of the stack (bun, the Outliner plugin, this checkout, ep0ch on
                                   PATH, outline services, Herdr and its keys, the Claude mod): ✓ current,
                                   ! behind, ✗ missing, with the command that fixes each. Read-only
  ep0ch install [--apply] [--restart-services] [--json]
                                   bring the stack up to date: a dry run by default (the plan). --apply backs
                                   up every outline database to ~/backups/ep0ch first, then updates the plugin
                                   and this checkout (fast-forward only, bun install when needed) and links
                                   ep0ch on PATH; each step is skipped when current. --restart-services also
                                   restarts per-folder services running old code (they are working panes)
  ep0ch try --ws <root> [--copy --outliner <checkout>] [--hub <id>]
  ep0ch try --showcase [--reset] --outliner <checkout>
                                   the door on a private copy, or on the showcase outline (scripts/try-it.sh)
  ep0ch clients [--ws <root> | <socket>]
                                   who is connected to the service, every role (observers too)
  ep0ch peek | actions | snap <png> | open <id> | act <action> [key=value ...]
                                   drive a running door; EP0CH_CONTROL names which one. open <id> is
                                   act open id=<id>; --as <id> (or EP0CH_AGENT) names the agent
  ep0ch where [--json]             where this runs: the stack of layers (EP0CH_NEST: ssh, Herdr, door, tile), each
                                   checked (the door's pid and control socket, the Herdr pane, the tile), and where
                                   the person's keys are. Read-only; "not in a door" outside one
  ep0ch subscribe [type,...]       the door's live feed: focus.changed, viewport, cursor, layout.changed,
                                   marks.changed, one JSON event per line (docs/AGENT-INTERFACE.md)
  ep0ch --skill [--all] [<name>]
                                   the stack's skills (this door's and the installed Outliner's), or the
                                   path of one skill's SKILL.md; --all adds contributor skills
  ep0ch help`;
if (["help", "--help", "-h"].includes(args[0] ?? "")) { console.log(USAGE); process.exit(0); }
if (args[0] === "doctor" || args[0] === "install") process.exit(await setupCommand(args, { out: console.log, err: console.error, terminal: process.stdout }));
if (args.includes("--skill")) { const r = skillCommand(args); (r.code ? console.error : console.log)(r.out); process.exit(r.code); }
if (args[0] === "try") {
  const run = Bun.spawn(["sh", join(import.meta.dir, "../scripts/try-it.sh"), ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await run.exited);
}
if (args[0] === "where") process.exit(await whereCommand(args.slice(1)));
if (args[0] === "session") process.exit(await sessionCommand(args.slice(1)));
if (["peek", "snap", "open", "actions", "act", "subscribe"].includes(args[0] ?? "")) process.exit(await controlClient(args));
if (args[0] === "outline" || args[0] === "status") {
  const cmd = parseOutlineArgs(args[0] === "status" ? args : args.slice(1));
  if ("error" in cmd) { console.error(`ep0ch: ${cmd.error}`); process.exit(2); }
  // `outline attach <name>` opens the door on it, as --ws <name> does; with --json it only attaches.
  if (cmd.op === "attach" && !cmd.json) args = ["--ws", cmd.name, ...args.slice(3).filter(a => a !== "--json")];
  else process.exit(await runOutlineCommand(cmd));
}
if (args[0] === "clients") {
  // Which service, and which outline on a host: --ws <name|root>, a socket, EP0CH_SOCKET, the folder's binding
  // or name on a running host, else the workspace this directory is in (src/discover.ts, resolveTarget).
  const target = await resolveTarget(args);
  if ("error" in target) { console.error(`ep0ch: ${target.error}`); process.exit(1); }
  const board = new SocketBoard(target.path, undefined, target.outline);
  try { console.log(formatClients(clientRows(await board.request<any[]>("clients.list")))); }
  catch (e) { console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message}`); board.close(); process.exit(1); }
  board.close();
  process.exit(0);
}
// The door: attached to this state dir's session (started when sessions are on and none runs), or in this terminal.
const how = await doorMode(args);
if (how.mode === "attach") process.exit(await attachDoor(args, how));
const opened = await connectTarget(args);
if ("error" in opened) { console.error(`ep0ch: ${opened.error}`); process.exit(1); }

const term = new Term();
// Every way the door ends goes through one teardown (guardDoor): a signal (SIGINT, SIGQUIT, SIGTERM, SIGHUP) or a
// crash. Unsaved drafts and comments are copied to disk (App.terminate), the terminal is put back, the control
// socket removed, and where the drafts went is said. kill -9 can't be caught: Term's guard puts the terminal back,
// and the next door sweeps the socket and ctrl+e files.
let door: Door | null = null;
const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
const guard = guardDoor({
  door: () => door,
  // SIGTERM and SIGHUP end the door as it always has (exit 0: nothing went wrong); SIGINT and SIGQUIT say which.
  // While the drop shell has the terminal, ctrl+c and ctrl+\ are its (a shell without job control shares the
  // door's process group): the door doesn't end under it.
  signal: sig => (sig === "SIGINT" || sig === "SIGQUIT" ? (door?.app.suspended() === "shell" ? null : 128 + SIGNALS[sig]!) : 0),
  // A write to a terminal that has gone (EIO, EPIPE: the ssh connection dropped before its SIGHUP was handled)
  // is a hangup, not a crash: the door ends as it does on SIGHUP.
  hangup: e => ["EIO", "EPIPE"].includes((e as NodeJS.ErrnoException | null)?.code ?? ""),
  // A second signal or a fault during teardown (or before the door was up): put the terminal back, go.
  now: (code, crash) => {
    term.stop();
    if (crash !== undefined) console.error(`ep0ch: ${crash instanceof Error ? crash.stack ?? crash.message : String(crash)}`);
    door?.control?.close();
    process.exit(code);
  },
});
await term.start();
// Everything the terminal is sent also goes to a mirror, so `snap` can show exactly this screen.
const mirror = new Mirror(term.info.cols, term.info.rows);
const rawWrite = term.write;
term.write = (s: string) => { rawWrite(s); mirror.write(s); };
// Before the door repaints for the new size: a mirror resized after the repaint would be blank until each
// row changed again, and `snap` would show half a screen.
process.stdout.prependListener("resize", () => mirror.resize(process.stdout.columns || term.info.cols, process.stdout.rows || term.info.rows));
const loggedOnAt = Date.now();
door = await openDoor({
  term, mirror, info: () => term.info, board: opened.board, service: opened.service, args, ...(opened.notice ? { notice: opened.notice } : {}),
  done(app) {
    term.stop();                                          // never throws: a terminal that's gone is skipped
    const ending = guard.ending();
    if (app.keptOnExit.length) console.error(`ep0ch: unsaved text was copied to:\n  ${app.keptOnExit.join("\n  ")}`);
    if (ending?.crash !== undefined) console.error(`ep0ch: the door crashed:\n${ending.crash instanceof Error ? ending.crash.stack ?? ending.crash.message : String(ending.crash)}`);
    door?.control?.close();
    opened.board.close();
    writeLastCall(loggedOnAt);
    process.exit(ending?.code ?? 0);
  },
});
