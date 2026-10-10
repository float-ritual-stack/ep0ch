#!/usr/bin/env bun
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { join } from "node:path";
import { SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients } from "./control";
import { skillCommand } from "./skills";
import { resolveTarget } from "./discover";
import { nameTheOutline, parseOutlineArgs, runOutlineCommand } from "./outlines";
import { Mirror } from "./mirror";
import { whereCommand } from "./where";
import { connectTarget, guardDoor, homeBase, openDoor, writeLastCall, type Door } from "./door";
import { attachDoor, doorMode, sessionCommand } from "./session/client";
import { placeOf } from "./session/place";
import { forwardTo, remoteDoor, remoteOf } from "./machine";
import { canonicalLocalMachineName, findCommand, NOTES_USAGE, revisionsCommand, showCommand } from "./notes-cli";
import { EXPORT_USAGE } from "./export";
import { LIBRARY_USAGE } from "./library/cli";
import { NEW_USAGE, newCommand } from "./new-cli";
import { VIEW_USAGE, viewCommand } from "./view-cli";
import { MCP_USAGE, mcpCommand } from "./mcp";
import { BACKUP_USAGE } from "./backup/usage";
import { showcaseTry } from "./showcase/route";
import { checkWords, screenArg, screenUriArgs, usageFor } from "./cli-words";
import { parseEp0chBlockUri, sameMachine } from "@ep0ch/outline-core/addressable-resource";
import { colourOnlyToATerminal } from "@ep0ch/outliner/plain-stderr";
// Piped stderr stays plain: the Claude mod, door-open and tests parse these refusals.
colourOnlyToATerminal();

let args = process.argv.slice(2);
const USAGE = `ep0ch: a BBS door into an outline

  ep0ch [--ws <name>] [--machine <ssh-name> [--create] | --here]
        [--screen <name> [<target>] | --layout <name>]
                                   open the door (the logon, then the main menu, by default);
                                   --screen <name> opens that screen instead: a menu item (board,
                                   desk, river, brief, welcome, waiting, who…) or any registered screen
                                   (ep0ch act screen.list names them), with its target where it takes
                                   one: --screen board <hub-id>, --screen detail <id | ((ref)) | ep0ch://…>
                                   (a URI also names the outline and machine; it never creates one).
                                   EP0CH_LANDING=<name> opens that screen after the logon instead
                                   (EP0CH_LANDING=brief, =welcome).
                                   --layout daily opens the desk laid out as a named layout (daily,
                                   river, board, desk, or one saved with ^W w).
                                   Which outline: --ws <name> from anywhere, else EP0CH_WS, else the
                                   nearest .ep0ch from this folder up (it holds ws = "<name>"). A name
                                   nobody has yet is created on this machine (like herdr --session <name>);
                                   on another machine never: the home base says so and offers the one here,
                                   creating it there, or cancel (without a terminal, the commands), and
                                   --create makes it there on purpose. Where none is
                                   named, the home base: this machine's outlines (open, new, import) and the
                                   machines opened from here (add one from ~/.ssh/config); choosing one opens
                                   it and offers to write the folder's .ep0ch.
                                   Outlines are <name>.sqlite in EP0CH_OUTLINES (~/outlines).
                                   Which machine: --machine <ssh-name> (a Host in ~/.ssh/config), else
                                   EP0CH_MACHINE, else the machine = "<ssh-name>" of the .ep0ch that named
                                   the outline; none is this machine (--here says so outright, over
                                   EP0CH_MACHINE and the .ep0ch's machine). The door keeps an ssh forward to that
                                   machine's outline host (~/outlines/.remote/<ssh-name>.sock), shared by
                                   every client here and started again when it drops. EP0CH_SOCKET names
                                   a host's socket outright
  ep0ch --showcase [--reset]       every shared door part, live, on its own seeded outline of made-up notes
                                   (the same as ep0ch try --showcase); --reset reseeds it
  ep0ch --remote <ssh-name> [door flags]
                                   this terminal on the door session running on that machine (ssh -t
                                   <ssh-name> ep0ch [door flags]), like herdr --remote; an outline that
                                   machine doesn't have is asked about first, as for --machine (--create
                                   makes it there)
  ep0ch session list [--json] | attach [--watch] | end [--yes] [--all] | upgrade [--clients] [--all] | restart
                                   the door sessions, one per outline (like herdr --session <name>): list shows
                                   every one (outline, machine, pid, code, terminals attached, programs); attach,
                                   end, upgrade and restart act on this folder's outline's, or --ws <name>
                                   [--machine <ssh-name>]'s (with none named, the only one running). attach
                                   --watch is read-only; end asks while programs run (--all ends every one,
                                   asking first); upgrade hands it to a new daemon on this checkout's code (its
                                   programs keep running; --clients only restarts the terminals; --all does
                                   every session); restart does so anyway. The door is a session: quitting
                                   detaches, ep0ch attaches again; --no-daemon (or EP0CH_DAEMON=0) opens the door
                                   in this terminal instead
${MCP_USAGE}
  ep0ch init [<name>] [--create] [--json]
                                   name this folder's outline: attach to it (creating it when nobody has; on
                                   another machine only with --create), and write .ep0ch; without a name, the
                                   folder's (or its repository's)
  ep0ch outline list [--all] [--archived] [--lines] | attach <name> [--create] | create <name> | import <database.sqlite> <name>
                | stop <name> | archive <name> | unarchive <name> | delete <name> [--yes]      [--json]
                                   the host's outlines (one an agent made over MCP shows who made it and why;
                                   archive hides one and keeps its database, unarchive restores it, --archived
                                   lists them): --all lists every machine's (this one's, then each
                                   machine opened before, one not connected said, nothing started), --lines
                                   as name<TAB>machine<TAB>problem; attach opens the door on one (the same as
                                   --ws <name>; on another machine --create makes one it lacks); import makes a new outline from an older database (its
                                   notes, properties, pages and work ids; the file is only read); stop
                                   releases its database; delete moves it to .deleted/, after asking
  ep0ch status [--json]            the outline host: its socket, its outlines folder, open outlines
  ep0ch doctor [--backups] [--json]
                                   every piece of the stack (bun, the ep0ch checkout, ep0ch on PATH, the plugin
                                   in Herdr, the outlines folder and its host and unit, which outline this folder
                                   opens, the backups (each Litestream unit, its log's errors, how far each replica
                                   or mirror trails), Herdr's keys, the Claude mod): ✓ current, ! behind, ✗ missing,
                                   with the command that fixes each. Read-only; --backups also restores each newest
                                   snapshot into a temp folder and runs integrity_check
${BACKUP_USAGE}
  ep0ch install [--apply] [--json]
                                   bring the stack up to date: a dry run by default (the plan). --apply backs
                                   up every ~/outlines/*.sqlite to ~/backups/ep0ch/<time>/ first, then updates the
                                   ep0ch checkout (fast-forward only, bun install when needed), links ep0ch on
                                   PATH and restarts the outline host through its unit; each step is skipped when
                                   current. Units, Herdr's config and its plugin link are said, never edited
  ep0ch try --ws <name> [--copy] [--hub <id>]
  ep0ch try --showcase [--reset]
                                   the door on a private copy, or on the showcase outline (scripts/try-it.sh)
${NOTES_USAGE}
${NEW_USAGE}
${VIEW_USAGE}
${EXPORT_USAGE}
${LIBRARY_USAGE}
  ep0ch ext [--ws <name>] ls | add <name|path> | remove <name> | act <name> <action> [--block <id>]
        | run <name> <action:id|handler:key>
                                   the outline's extensions: ls lists each folder, what it serves and each
                                   schedule (every or cron, next run, last run and what it did); act runs an
                                   action as the extension; run runs a schedule now (the outliner's ext command)
  ep0ch clients [--ws <name>] [--machine <ssh-name>]
                                   who is connected to the service, every role (observers too)
  ep0ch peek | actions | snap <png> | open <id|ep0ch://outline@machine/b/id|file:/path> [--json] | act <action> [key=value ...]
                                   drive a running door; EP0CH_CONTROL names which one, else the one on
                                   this folder's outline, else the only one running. open <id> is
                                   act open id=<id>; a URI names its outline and machine first; open file:<path>
                                   [diff=true] shows a file (or its git diff) where opens land; --as <id> (or EP0CH_AGENT) names the agent
  ep0ch where [--json]             where this runs: the stack of layers (EP0CH_NEST: ssh, Herdr, door, tile), each
                                   checked (the door's pid and control socket, the Herdr pane, the tile), and where
                                   the person's keys are. Read-only; "not in a door" outside one
  ep0ch subscribe [type,...]       the door's live feed: focus.changed, viewport, cursor, layout.changed,
                                   marks.changed, one JSON event per line (docs/AGENT-INTERFACE.md)
  ep0ch --skill [--all] [<name>]
                                   the stack's skills (this door's and the installed Outliner's), or the
                                   path of one skill's SKILL.md; --all adds contributor skills
  ep0ch help [<command>]           this, or one command's part of it; --help and -h do the same anywhere
                                   (ep0ch session --help). A word ep0ch doesn't know, command or door flag,
                                   is said with the closest one it does (exit 2), and opens no door`;
// A word ep0ch doesn't know is said, with the closest it does, and opens no door; --help, -h and help print usage (the
// command's own when one is named) from anywhere (PIE-547, src/cli-words.ts).
const words = checkWords(args);
if (words && "help" in words) { console.log(usageFor(USAGE, words.help)); process.exit(0); }
if (words) { console.error(`ep0ch: ${words.error}`); process.exit(2); }
// --remote <machine>: the door runs there; this terminal only carries it (src/machine.ts).
// An outline the machine doesn't have is never made there without --create (PIE-545): nameRemoteOutline asks it first,
// and the home base here offers the choices; the one on this machine opens a door here instead.
const remote = remoteOf(args);
if (remote && "error" in remote) { console.error(`ep0ch: ${remote.error}`); process.exit(2); }
/** What the home base chose, said once the door is up (in this terminal; a session started from it shows the screen). */
let homeNotice: string | undefined;
if (remote) {
  const { nameRemoteOutline } = await import("./outlines");
  const r = await nameRemoteOutline(remote.machine, remote.rest, !!process.stdin.isTTY, homeBase);
  if (!r) process.exit(1);
  if ("error" in r) { console.error(`ep0ch: ${r.error}`); process.exit(1); }
  if ("remote" in r) process.exit(await remoteDoor(remote.machine, r.remote));
  args = r.args;
  homeNotice = r.notice;
}
if (args[0] === "doctor" || args[0] === "install") {
  const { setupCommand } = await import("./setup/apply");
  process.exit(await setupCommand(args, { out: console.log, err: console.error, terminal: process.stdout }));
}
if (args[0] === "backup") { const { backupCommand } = await import("./backup/cli"); process.exit(await backupCommand(args)); }
if (args.includes("--skill")) { const r = skillCommand(args); (r.code ? console.error : console.log)(r.out); process.exit(r.code); }
// A screen nobody knows is refused before the door takes the terminal, with the names there are. A name that may be a
// screen a person made (a screen note, PIE-565) is the door's to find once it has read the outline's screen notes.
const asked = screenArg(args);
if (asked && !args.includes("--remote")) {
  const { knownScreen, unknownScreen } = await import("./screens");
  const { screenNameProblem, screenSlug } = await import("./desk/screen-spec");
  // A title as typed ("daily test") may be a screen a person made: the door finds it once it has read the outline.
  // (The showcase's outline is seeded and has none of a person's.)
  if (!knownScreen(asked.name) && (args.includes("--showcase") || screenNameProblem(screenSlug(asked.name)))) { console.error(`ep0ch: ${unknownScreen(asked.name)}`); process.exit(2); }
}
// The showcase lives on its own seeded outline, never the one this folder names: `ep0ch --showcase [--reset]` is
// `ep0ch try --showcase [--reset]`. With --ws (as try-it.sh itself runs it) it opens the screen on that outline.
const tryArgs = args[0] === "try" ? args.slice(1) : showcaseTry(args);
if (tryArgs) {
  const run = Bun.spawn(["sh", join(import.meta.dir, "../scripts/try-it.sh"), ...tryArgs], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await run.exited);
}
if (args[0] === "find") process.exit(await findCommand(args));
if (args[0] === "show") process.exit(await showCommand(args));
if (args[0] === "revisions") process.exit(await revisionsCommand(args));
if (args[0] === "mcp") process.exit(await mcpCommand(args));
if (args[0] === "new") process.exit(await newCommand(args));
if (args[0] === "view") process.exit(await viewCommand(args));
if (args[0] === "export") { const { exportCommand } = await import("./export"); process.exit(await exportCommand(args)); }
if (args[0] === "library") { const { libraryCommand } = await import("./library/cli"); process.exit(await libraryCommand(args)); }
// The outline's extensions (PIE-754): ls (with each schedule's next and last run), add, remove, act and run, through
// the outliner's own command (one implementation); --ws names the outline as for every command.
if (args[0] === "ext") {
  const at = args.indexOf("--ws");
  if (at > 0 && args[at + 1]) { process.env.EP0CH_WS = args[at + 1]; args = [...args.slice(0, at), ...args.slice(at + 2)]; }
  const { runExtCommand } = await import("@ep0ch/outliner/extension-install");
  process.exit(await runExtCommand(args.slice(1)));
}
if (args[0] === "where") process.exit(await whereCommand(args.slice(1)));
if (args[0] === "session") process.exit(await sessionCommand(args.slice(1)));
if (args[0] === "open" && args[1]?.startsWith("ep0ch://")) {
  try {
    const uri = parseEp0chBlockUri(args[1]);
    const local = sameMachine(uri.machine, canonicalLocalMachineName());
    if (!process.env.EP0CH_CONTROL) process.env.EP0CH_CONTROL = join(placeOf({ outline: uri.outline, ...(local ? {} : { machine: uri.machine }) }).dir, "door.sock");
  } catch (e) {
    console.error(`ep0ch: ${(e as Error).message}`);
    process.exit(2);
  }
}
// `--screen <name> <ep0ch://…>`: the URI names the outline (and machine) the door opens on, and its block the target.
const screenAt = args.indexOf("--screen");
if (screenAt >= 0 && args[screenAt + 2]?.startsWith("ep0ch://")) {
  try {
    const uri = parseEp0chBlockUri(args[screenAt + 2]!);
    const local = sameMachine(uri.machine, canonicalLocalMachineName());
    args = screenUriArgs(args, uri, { local, socket: !!process.env.EP0CH_SOCKET?.trim() });
  } catch (e) {
    console.error(`ep0ch: ${(e as Error).message}`);
    process.exit(2);
  }
}
if (["peek", "snap", "open", "actions", "act", "subscribe"].includes(args[0] ?? "")) {
  // Which door, when EP0CH_CONTROL names none: the one on the outline this folder names, else the only one running.
  if (!process.env.EP0CH_CONTROL) {
    const { controlFor } = await import("./session/place");
    const at = await controlFor();
    if (typeof at === "object") {
      if (args[0] === "open" && args.includes("--json")) console.log(JSON.stringify({ opened: false, reason: at.error }));
      else console.error(`ep0ch: ${at.error}`);
      process.exit(args[0] === "open" && args.includes("--json") ? 0 : 1);
    }
    process.env.EP0CH_CONTROL = at;
  } else {
    // A program in a door's tile: its door as it is now, by its outline's session, never the socket it started with
    // alone (a handover or restart moves the door to a new process; PIE-604). `ep0ch where` says when that happened.
    // An EP0CH_CONTROL with no door (a stale one, PIE-715) falls through to the folder's outline's door, then the only one.
    const { resolveDoor } = await import("./door-resolve");
    const reached = await resolveDoor();
    if (reached.path) process.env.EP0CH_CONTROL = reached.path;
  }
  process.exit(await controlClient(args));
}
if (args[0] === "outline" || args[0] === "status" || args[0] === "init") {
  const cmd = parseOutlineArgs(args[0] === "outline" ? args.slice(1) : args);
  if ("error" in cmd) { console.error(`ep0ch: ${cmd.error}`); process.exit(2); }
  // `outline attach <name>` opens the door on it, as --ws <name> does; with --json it only attaches.
  if (cmd.op === "attach" && !cmd.json) {
    const rest = args.slice(1).filter((a, i, all) => a !== "attach" && a !== cmd.name && a !== "--machine" && all[i - 1] !== "--machine");
    args = ["--ws", cmd.name, ...(cmd.machine ? ["--machine", cmd.machine] : []), ...rest];
  }
  else process.exit(await runOutlineCommand(cmd));
}
if (args[0] === "clients") {
  // Which host, and which outline on it: --ws <name>, EP0CH_WS, the folder's .ep0ch; --machine, EP0CH_MACHINE or the
  // .ep0ch's machine for another machine's host, EP0CH_SOCKET for any host's socket (src/discover.ts, resolveTarget).
  const target = resolveTarget(args);
  if ("error" in target) { console.error(`ep0ch: ${target.error}`); process.exit(1); }
  if (target.machine) await forwardTo(target.machine).catch(e => { console.error(`ep0ch: can't reach the outline host on ${target.machine}: ${(e as Error).message}`); process.exit(1); });
  // A folder that names none asks the host as it is (its default outline, when it has one, else its refusal).
  const board = new SocketBoard(target.path, undefined, "outline" in target ? target.outline : undefined);
  try { console.log(formatClients(clientRows(await board.request<any[]>("clients.list")))); }
  catch (e) { console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message.replaceAll("\n", "\n  ")}`); board.close(); process.exit(1); }
  board.close();
  process.exit(0);
}
// The door: attached to its outline's session (started when sessions are on and none runs), or in this terminal.
const how = doorMode(args);
// Which outline, first: the session is that outline's (src/session/place.ts). A folder that names none opens the home
// base in this terminal (src/home.ts: it shows which sessions run) and goes on with --ws <their choice> (PIE-530). A
// machine's forward is started here too, in the person's terminal, where ssh has their agent; the session's daemon
// finds it up. Without a terminal, a session isn't started at all (attachDoor says so); nothing to ask.
if (!(how.mode === "attach" && !process.stdin.isTTY)) {
  const named = await nameTheOutline(args, !!process.stdin.isTTY, homeBase);
  if (!named) process.exit(1);
  if ("error" in named) { console.error(`ep0ch: ${named.error}`); process.exit(1); }
  args = named.args;
  homeNotice = [homeNotice, named.notice].filter(Boolean).join(" · ") || undefined;
}
if (how.mode === "attach") process.exit(await attachDoor(args));
// A door in its own terminal: an `ep0ch` in one of its tiles opens a door of its own there too, never a session on
// this state dir.
process.env.EP0CH_DAEMON = "0";
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
  // SIGTERM and SIGHUP end the door (exit 0: nothing went wrong); SIGINT and SIGQUIT say which.
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
  term, mirror, info: () => term.info, board: opened.board, service: opened.service, place: opened.place, args,
  ...(opened.notice || homeNotice ? { notice: [homeNotice, opened.notice].filter(Boolean).join(" · ") } : {}),
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
