#!/usr/bin/env bun
import { RECORD_USAGE } from "./record-cli";
import { REVIEW_USAGE } from "./review-cli";
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { join } from "node:path";
import { SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients } from "./control";
import { DOCS_USAGE, docsCommand } from "./docs";
import { skillCommand } from "./skills";
import { resolveTarget } from "./discover";
import { nameTheOutline, parseOutlineArgs, runOutlineCommand } from "./outlines";
import { Mirror } from "./mirror";
import { whereCommand } from "./where";
import { connectTarget, guardDoor, homeBase, openDoor, writeLastCall, type Door } from "./door";
import { attachDoor, doorMode, sessionCommand } from "./session/client";
import { placeOf } from "./session/place";
import { forwardTo, remoteDoor, remoteOf } from "./machine";
import { findCommand, NOTES_USAGE, revisionsCommand, showCommand } from "./notes-cli";
import { EXPORT_USAGE } from "./export";
import { LIBRARY_USAGE } from "./library/cli";
import { NEW_USAGE, newCommand } from "./new-cli";
import { VIEW_USAGE, viewCommand } from "./view-cli";
import { SHARE_USAGE } from "./share-cli";
import { MCP_USAGE, mcpCommand } from "./mcp";
import { AGENT_USAGE, agentCommand } from "./agent-cli";
import { BACKUP_USAGE } from "./backup/usage";
import { showcaseTry } from "./showcase/route";
import { COMMANDS, checkWords, screenArg, screenUriArgs, usageFor } from "./cli-words";
import { parseEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { isLocalMachine } from "@ep0ch/outliner/machine-name";
import { colourOnlyToATerminal } from "@ep0ch/outliner/plain-stderr";
// Piped stderr stays plain: the Claude mod, door-open and tests parse these refusals.
colourOnlyToATerminal();

let args = process.argv.slice(2);
// Bind a leading outline flag before dispatch, including commands whose arguments do not take --ws.
let commandAt = 0;
while (args[commandAt] === "--ws" || args[commandAt] === "--machine") commandAt += 2;
if (commandAt && (COMMANDS as readonly string[]).includes(args[commandAt] ?? "")) {
  const flags: string[] = [];
  for (let i = 0; i < commandAt; i += 2) {
    if (args[i] === "--ws") process.env.EP0CH_WS = args[i + 1]!;
    else flags.push(args[i]!, args[i + 1]!);
  }
  args = [args[commandAt]!, ...args.slice(commandAt + 1), ...flags];
}
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
  ep0ch log [--ws <name>] [--machine <ssh-name>] [--follow]
                                   print the session message log as JSON lines; --follow tails it
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
  ep0ch link setup|serve|connect|status   outbound HTTPS link for a machine
  ep0ch status [--json]            the outline host: its socket, its outlines folder, open outlines
  ep0ch doctor [--backups] [--json]
                                   every piece of the stack (bun, the ep0ch checkout, ep0ch on PATH, the plugin
                                   in Herdr, the outlines folder and its host and unit, which outline this folder
                                   opens, the backups (each Litestream unit, its log's errors, how far each replica
                                   or mirror trails), Herdr's keys, the Claude mod): ✓ current, ! behind, ✗ missing,
                                   with the command that fixes each. Read-only; --backups also restores each newest
                                   snapshot into a temp folder and runs integrity_check
${BACKUP_USAGE}
  ep0ch install [--apply] [--json] [--machine-name <name>] [--dials-in | --no-dials-in]
                [--add-client <ssh-name> | --remove-client <ssh-name>] [--as-client]
                                   bring the stack up to date: a dry run by default (the plan). --apply backs
                                   up every ~/outlines/*.sqlite to ~/backups/ep0ch/<time>/ first, then updates the
                                   ep0ch checkout (fast-forward only, bun install when needed), links ep0ch on
                                   PATH and restarts the outline host through its unit; each step is skipped when
                                   current. Units, Herdr's config and its plugin link are said, never edited.
                                   It names this machine once (~/outlines/.host/machine-name: what ep0ch://
                                   links and EchoNet call it; give it the ssh name other machines use for it):
                                   asked at a terminal, the short host name otherwise; --machine-name renames.
                                   --dials-in: this machine calls the others for EchoNet and is never called
                                   (its inbound ssh off or gated; ~/outlines/.host/dials-in); --no-dials-in undoes
                                   .host/clients lists the ssh clients updated after the host, one per line.
                                   --add-client and --remove-client manage it (--apply saves); --as-client
                                   runs one client leg without updating further clients. Busy doors stay running.
  ep0ch try --ws <name> [--copy] [--hub <id>]
  ep0ch try --showcase [--reset]
                                   the door on a private copy, or on the showcase outline (scripts/try-it.sh)
${NOTES_USAGE}
${RECORD_USAGE}
${REVIEW_USAGE}
${NEW_USAGE}
${VIEW_USAGE}
  ep0ch artifact put <file-or-folder> [--name <name>] [--machine <ssh-name>]
  ep0ch artifact ls | show|versions|snapshot|rm <name> [--machine <ssh-name>]
  ep0ch artifact import --ws <name> [--machine <ssh-name>]
                                   live artifact folders and frozen snapshots, outside the outline
  ep0ch artifact lease [<name>] [--ws <name>] [--json]
                                   a one-time link to send a file (a page, a zip, a tar) into the inbox: prints the curl
  ep0ch device add <name> [--ws <name>] | ls | revoke <name|id>
                                   a phone's Shortcut token for the same inbox, made, listed and ended
${SHARE_USAGE}
  ep0ch loki lease [--ttl 1h] | lease --revoke
                                   a read-only Loki URL, or end all leases; run on the publisher host over ssh
  ep0ch web sessions [--json] | web revoke <id> | --all
                                   the browsers signed in to the web client (https://my.ep0ch.sh): each one's
                                   id, browser, who and last use; revoke signs one out now, --all every one.
                                   The web client's /sessions page does the same
${EXPORT_USAGE}
${LIBRARY_USAGE}
${DOCS_USAGE}
  ep0ch echo toss | nodelist | subscribe | areas …   (ep0ch echo help says each one's flags)
                                   EchoNet (PIE-779): run the echonet extension's tosser (copies in, netmail
                                   both ways, nodelist and toss log), write and print the nodelist, subscribe
                                   to an area by node mask, or list the areas an outline offers and reads
  ep0ch ext [--ws <name>] ls | add <name|path> | remove <name> | act <name> <action> [--block <id>]
        | run <name> <action:id|handler:key>
                                   the outline's extensions: ls lists each folder, what it serves and each
                                   schedule (every or cron, next run, last run and what it did); act runs an
                                   action as the extension; run runs a schedule now (the outliner's ext command)
  ep0ch keys list | check <KEY> | who <KEY> | set <group> <KEY> | grant|revoke <group>[/<KEY>] <scope>
                                   which secrets (with-secrets groups) exist here, where, and who may have each:
                                   names, places and modes, never a value; check exits 1 when a key isn't there;
                                   set, grant and revoke are the person's (PIE-887; ep0ch keys with no word says more)
  ep0ch machinery backfill [--ws <name>] [--apply] [--json]
                                   stamp [machine::<producer>] on what tools wrote before they stamped (file
                                   touches, EchoNet's logs and receipts, deliveries, prior art, backup runs): a dry
                                   run says how many; --apply stamps them (PIE-867)
  ep0ch route <note> | --all [--dry-run] [--ws <name>] [--json]
                                   route a note (an id, ((id)), [[page]] or Work ID), or every note, by the
                                   outline's routing rules: notes with [type::route] [query::…] [route-to::((id))],
                                   listed in the Routing view; the first whose query holds for a note moves it
                                   there, as ext:route. --dry-run says what would move where and why (PIE-1010)
  ep0ch resource rebind <folder> [--ws <name>] [--json]
                                   read a file link's folder where it leads now, after a link in its path
                                   changed or another folder took its place: the command a refused file link
                                   names. A folder deleted and made again in the same place needs nothing
  ep0ch clients [--ws <name>] [--machine <ssh-name>]
                                   who is connected to the service, every role (observers too)
  ep0ch peek [<section>] [--json] [--xray]
                                   what the door shows now: by default the compact text (where, the person, speed,
                                   and the screen as text, a few KB); --json one JSON object and nothing else (the
                                   whole state, and the screen as "text"); a <section> (speed, person, layout, …) just that part
  ep0ch actions | snap <png> | open <id|ep0ch://outline@machine/b/id|file:/path> [--json] | act <action> [key=value ...]
                                   drive a running door; EP0CH_CONTROL names which one, else the one on
                                   this folder's outline, else the only one running. open <id> is
                                   act open id=<id>; a URI names its outline and machine first; open file:<path>
                                   [diff=true] shows a file (or its git diff) where opens land; --as <id> (or EP0CH_AGENT) names the agent
${AGENT_USAGE}
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
  // This machine's name, asked once at a terminal (install --apply, when none is set): Enter takes the suggestion.
  const ask = process.stdin.isTTY && process.stdout.isTTY ? async (suggested: string) => {
    const { createInterface } = await import("node:readline/promises");
    const { isMachineName } = await import("@ep0ch/outline-core/outline-location");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (await rl.question(`This machine's name (what other machines' ep0ch and EchoNet call it: the ssh name they reach it by) [${suggested}]: `)).trim() || suggested;
        if (isMachineName(answer)) return answer;
        console.error("  a machine name is letters, digits, . _ and -, up to 32");
      }
    } finally { rl.close(); }
  } : undefined;
  const code = await setupCommand(args, { out: console.log, err: console.error, terminal: process.stdout, ...(ask ? { ask } : {}) });
  // The checkout moved under this run: its later steps used the old code. A person's install runs itself again on the
  // new code at once, said loudly, rather than leave a ✓ line asking them to (Evan, Oct 25: "a line with a checkbox
  // next to it that looks like all good"). --json and --as-client callers rerun it themselves (src/link.ts); the
  // second run never reruns a third time.
  const { checkoutMoved, rerunAfterMove } = await import("./setup/apply");
  if (rerunAfterMove(code, checkoutMoved, args, process.env)) {
    const loud = process.stdout.isTTY ? "\x1b[1;30;43m" : "", off = process.stdout.isTTY ? "\x1b[0m" : "";
    console.log(`\n${loud} ▲ THE CHECKOUT MOVED: running install again on the new code, so its steps run too ${off}\n`);
    const again = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts"), ...args], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, EP0CH_INSTALL_RERUN: "1" } });
    process.exit(await again.exited);
  }
  process.exit(code);
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
if (args[0] === "record") process.exit(await (await import("./record-cli")).recordCommand(args));
if (args[0] === "review") process.exit(await (await import("./review-cli")).reviewCommand(args));
if (args[0] === "find") process.exit(await findCommand(args));
if (args[0] === "show") process.exit(await showCommand(args));
if (args[0] === "revisions") process.exit(await revisionsCommand(args));
if (args[0] === "mcp") process.exit(await mcpCommand(args));
if (args[0] === "new") process.exit(await newCommand(args));
if (args[0] === "view") process.exit(await viewCommand(args));
if (args[0] === "artifact") { const { artifactCommand } = await import("./artifact-cli"); process.exit(await artifactCommand(args)); }
if (args[0] === "share" || args[0] === "reader") { const { shareCommand } = await import("./share-cli"); process.exit(await shareCommand(args)); }
if (args[0] === "export") { const { exportCommand } = await import("./export"); process.exit(await exportCommand(args)); }
if (args[0] === "docs") process.exit(docsCommand(args.slice(1)));
if (args[0] === "library") { const { libraryCommand } = await import("./library/cli"); process.exit(await libraryCommand(args)); }
// The outline's extensions (PIE-754): ls (with each schedule's next and last run), add, remove, act and run, through
// the outliner's own command (one implementation); --ws names the outline as for every command.
// The signed-in web client's sessions: the outliner's own command (one implementation), asked of this machine's host.
if (args[0] === "web" || args[0] === "loki") {
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, args[0], ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
if (args[0] === "link") process.exit(await (await import("./link")).runLink(args.slice(1)));
if (args[0] === "keys") {
  const at = args.indexOf("--ws");
  if (at > 0 && args[at + 1]) { process.env.EP0CH_WS = args[at + 1]; args = [...args.slice(0, at), ...args.slice(at + 2)]; }
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "keys", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
if (args[0] === "device") {
  const at = args.indexOf("--ws");
  if (at > 0 && args[at + 1]) { process.env.EP0CH_WS = args[at + 1]; args = [...args.slice(0, at), ...args.slice(at + 2)]; }
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "device", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
if (args[0] === "ext") {
  const at = args.indexOf("--ws");
  if (at > 0 && args[at + 1]) { process.env.EP0CH_WS = args[at + 1]; args = [...args.slice(0, at), ...args.slice(at + 2)]; }
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "ext", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
// A file Source's folder that leads elsewhere now (PIE-853): `ep0ch resource rebind <folder>`, the outliner's own command.
if (args[0] === "resource") {
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "resource", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
// EchoNet (PIE-779): `ep0ch echo …`, through the outliner's own command.
if (args[0] === "echo") {
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "echo", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
// Machinery (PIE-867): `ep0ch machinery backfill`, the outliner's own command.
if (args[0] === "machinery") {
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "machinery", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
// Routing (PIE-1010): `ep0ch route [<note>|--all] [--dry-run]`, the outliner's own command (one implementation).
if (args[0] === "route") {
  const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
  const run = Bun.spawn([process.execPath, cli, "route", ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
  process.exit(await run.exited);
}
if (args[0] === "where") process.exit(await whereCommand(args.slice(1)));
if (args[0] === "agent") process.exit(await agentCommand(args.slice(1)));
if (args[0] === "log") process.exit(await (await import("./status-log")).logCommand(args.slice(1)));
if (args[0] === "session") process.exit(await sessionCommand(args.slice(1)));
if (args[0] === "open" && args[1]?.startsWith("ep0ch://")) {
  try {
    const uri = parseEp0chBlockUri(args[1]);
    const local = isLocalMachine(uri.machine);
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
    const local = isLocalMachine(uri.machine);
    args = screenUriArgs(args, uri, { local, socket: !!process.env.EP0CH_SOCKET?.trim() });
  } catch (e) {
    console.error(`ep0ch: ${(e as Error).message}`);
    process.exit(2);
  }
}
// `actions --doc <name>`: an action's page (PIE-1032), from the running door when there is one, else the registry.
// (Its flags are its own, read in actions-doc.ts, as `act`'s are: the door's flags are main.ts's.)
if (args[0] === "actions") {
  const { actionsDoc, wantsDoc } = await import("./actions-doc");
  if (wantsDoc(args)) process.exit(await actionsDoc(args.slice(1)));
}
if (["peek", "snap", "open", "actions", "act", "subscribe"].includes(args[0] ?? "")) {
  // Which door, when EP0CH_CONTROL names none: the one on the outline this folder names, else the only one running.
  if (!process.env.EP0CH_CONTROL) {
    const { controlFor } = await import("./session/place");
    const at = await controlFor(process.env, process.cwd(), args[0] === "peek" ? args : []);
    if (typeof at === "object") {
      if (args[0] === "open" && args.includes("--json")) console.log(JSON.stringify({ opened: false, reason: at.error }));
      else console.error(`ep0ch: ${at.error}`);
      process.exit(args[0] === "open" && args.includes("--json") ? 0 : 1);
    }
    process.env.EP0CH_CONTROL = at;
  } else {
    // A program in a door's tile: its door as it is now, by its outline's session, never the socket it started with
    // alone (a handover or restart moves the door to a new process; PIE-604). `ep0ch where` says when that happened.
    // An EP0CH_CONTROL with no door (a stale one, PIE-715) falls through to the folder's outline's door, then the only one;
    // one outside its EP0CH_PLACE reaches none (PIE-1363), for every command.
    const { resolveDoor } = await import("./door-resolve");
    const reached = await resolveDoor(process.env, process.cwd(), args[0] === "peek" ? args : []);
    if (reached.path) process.env.EP0CH_CONTROL = reached.path;
    else if (args[0] === "open" && args.includes("--json") && reached.refused) { console.log(JSON.stringify({ opened: false, reason: reached.text })); process.exit(0); }
    else if (args[0] === "peek" || reached.refused) {
      console.error(`ep0ch: ${reached.text}`);
      process.exit(1);
    }
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
// The door's outline is named for everything it starts (tile programs, the drawer agent, the Herdr launcher):
// `agentVars` carries these, so none of them guesses an outline from its shell's folder (PIE-756).
process.env.EP0CH_WS = opened.place.outline;
if (opened.place.machine) process.env.EP0CH_MACHINE = opened.place.machine; else delete process.env.EP0CH_MACHINE;

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
