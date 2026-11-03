#!/usr/bin/env bun
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { join } from "node:path";
import { renderHelp, completionCommand } from "./cli-help";
import { SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients } from "./control";
import { docsCommand } from "./docs";
import { skillCommand } from "./skills";
import { resolveTarget } from "./discover";
import { nameTheOutline, parseOutlineArgs, runOutlineCommand } from "./outlines";
import { Mirror } from "./mirror";
import { whereCommand } from "./where";
import { connectTarget, guardDoor, homeBase, openDoor, writeLastCall, type Door } from "./door";
import { attachDoor, doorMode, sessionCommand } from "./session/client";
import { placeOf } from "./session/place";
import { carryDoor, forwardTo, remoteDoor, remoteOf, sshDoorArgv, sshDoorOf } from "./machine";
import { findCommand, revisionsCommand, showCommand } from "./notes-cli";
import { waitCommand } from "./wait-cli";
import { newCommand } from "./new-cli";
import { viewCommand } from "./view-cli";
import { mcpCommand } from "./mcp";
import { agentCommand } from "./agent-cli";
import { showcaseTry } from "./showcase/route";
import { COMMANDS, checkWords, scriptCall, screenArg, screenUriArgs } from "./cli-words";
import { parseEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { isLocalMachine } from "@ep0ch/outliner/machine-name";
import { colourOnlyToATerminal } from "@ep0ch/outliner/plain-stderr";
// Piped stderr stays plain: the Claude mod, door-open and tests parse these refusals.
colourOnlyToATerminal();

let args = process.argv.slice(2);
// hc runs this on the agent's machine; its program's arguments belong to that program.
if (args[0] === "agent" && args[1] === "exec") {
  const program = args.slice(args[2] === "--" ? 3 : 2);
  if (!program.length) { console.error("ep0ch agent exec -- <program> [args…]"); process.exit(2); }
  (await import("@ep0ch/outliner/program-env")).execProgram(program);
}
// A script's name with global flags around it (PIE-1230): the flags are taken out here, as they are around a command below.
{
  const call = scriptCall(args);
  if (call) {
    if (call.ws) process.env.EP0CH_WS = call.ws;
    if (call.machine) process.env.EP0CH_MACHINE = call.machine;
    args = call.args;
  }
}
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
// A word ep0ch doesn't know is said, with the closest it does, and opens no door; --help, -h and help print usage (the
// command's own when one is named) from anywhere (PIE-547, src/cli-words.ts).
const words = checkWords(args);
if (words && "help" in words) { console.log(renderHelp(words.help, args.includes("--more"))); process.exit(0); }
// A plain word that is no command is a script's name (PIE-1230): `ep0ch neat page=[[a]]` is `ep0ch act script.run of=neat page=[[a]]`,
// an agent's run in the door of this folder's outline (the shell's agent id, or --as), refused in words if no script has that name.
let notACommand: string | undefined;
// (A script's name is resolved before a command suggestion: `ep0ch neat` is neat, though `new` is close. With no door to ask, or no script of
// that name, it is the unknown command it always was, exit 2. --help is always about ep0ch.)
if (words && "error" in words && /^[A-Za-z][\w.-]*$/.test(args[0] ?? "") && !words.error.startsWith("no flag") && !args.some(a => a === "--help" || a === "-h")) {
  notACommand = words.error;
  args = ["act", "script.run", `of=${args[0]}`, ...args.slice(1)];
} else if (words) { console.error(`ep0ch: ${words.error}`); process.exit(2); }
if (args[0] === "completions") process.exit(completionCommand(args.slice(1)));
// ep0ch door [<ssh-name>] [<outline>]: the ssh door's login (ssh ep0ch), carried here, and this terminal given back clean
// however ssh ends, a dropped link included (PIE-1429, src/machine.ts).
if (args[0] === "door") {
  const d = sshDoorOf(args.slice(1));
  if ("error" in d) { console.error(`ep0ch: ${d.error}`); process.exit(2); }
  process.exit(await carryDoor(d.machine, sshDoorArgv(d.machine, d.outline), d.again));
}
// An agent's command at the door running on another machine (`ep0ch peek --remote laptop [--ws pie]`, PIE-1242): through
// the link that carries that machine's doors (src/remote-doors.ts), its control socket answers here, so peek, act and
// the rest run as they do for a door on this machine, attributed, never with the person's keys. A machine no link
// carries goes on below, as before: ssh runs the command there.
if (["peek", "snap", "open", "actions", "act", "subscribe", "trace"].includes(args[0] ?? "") && args.includes("--remote")) {
  const r = remoteOf(args);
  if (r && "error" in r) { console.error(`ep0ch: ${r.error}`); process.exit(2); }
  const { doorMachines, reachMachineDoor } = await import("./remote-doors");
  if (r && doorMachines().includes(r.machine)) {
    const value = (flag: string) => { const i = r.rest.indexOf(flag); return i >= 0 ? r.rest[i + 1] : undefined; };
    const reached = await reachMachineDoor(r.machine, { outline: value("--ws"), machine: value("--machine") });
    if ("error" in reached) {
      if (args[0] === "open" && args.includes("--json")) { console.log(JSON.stringify({ opened: false, reason: reached.error })); process.exit(0); }
      console.error(`ep0ch: ${reached.error}`); process.exit(1);
    }
    if (process.env.EP0CH_VERBOSE === "1") console.error(`ep0ch: ${r.machine}'s door on ${reached.door.key}${reached.via ? ` (through ${reached.via}'s link)` : " (through its link)"}`);
    process.env.EP0CH_CONTROL = reached.control;
    delete process.env.EP0CH_PLACE;
    const rest = r.rest.filter((a, i, all) => !["--ws", "--machine"].includes(a) && !["--ws", "--machine"].includes(all[i - 1] ?? ""));
    process.exit(await controlClient(rest, {}));
  }
}
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
  const no = (await import("./screens")).earlyScreenRefusal(asked.name);
  if (no) { console.error(`ep0ch: ${no}`); process.exit(2); }
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
if (args[0] === "work") process.exit(await (await import("./work-cli")).workCommand(args));
if (args[0] === "search") process.exit(await (await import("./search-cli")).searchCommand(args));
if (args[0] === "find") process.exit(await findCommand(args));
if (args[0] === "wait") process.exit(await waitCommand(args));
if (args[0] === "show") process.exit(await showCommand(args));
if (args[0] === "revisions") process.exit(await revisionsCommand(args));
if (args[0] === "mcp") process.exit(await mcpCommand(args));
if (args[0] === "new") process.exit(await newCommand(args));
if (args[0] === "view") process.exit(await viewCommand(args));
if (args[0] === "artifact") { const { artifactCommand } = await import("./artifact-cli"); process.exit(await artifactCommand(args)); }
if (args[0] === "share" || args[0] === "reader") { const { shareCommand } = await import("./share-cli"); process.exit(await shareCommand(args)); }
if (args[0] === "mirror") { const { mirrorCommand } = await import("./outline-mirror"); process.exit(await mirrorCommand(args)); }
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
if (["peek", "snap", "open", "actions", "act", "subscribe", "trace"].includes(args[0] ?? "")) {
  // Which door, when EP0CH_CONTROL names none: resolveDoor's rule, the one `ep0ch where` says (PIE-1242: the door on the
  // machine this ssh session came from, else the one on the outline this folder names, else the only one running).
  if (!process.env.EP0CH_CONTROL) {
    const { resolveDoor } = await import("./door-resolve");
    const reached = await resolveDoor(process.env, process.cwd(), args[0] === "peek" ? args : []);
    if (!reached.path) {
      if (args[0] === "open" && args.includes("--json")) console.log(JSON.stringify({ opened: false, reason: reached.text }));
      else console.error(`ep0ch: ${notACommand ?? reached.text}`);
      process.exit(notACommand ? 2 : args[0] === "open" && args.includes("--json") ? 0 : 1);
    }
    process.env.EP0CH_CONTROL = reached.path;
  } else {
    // A program in a door's tile: its door as it is now, by its outline's session, never the socket it started with
    // alone (a handover or restart moves the door to a new process; PIE-604). `ep0ch where` says when that happened.
    // An EP0CH_CONTROL with no door (a stale one, PIE-715) falls through to the folder's outline's door, then the only one;
    // one outside its EP0CH_PLACE reaches none (PIE-1363), for every command.
    const { resolveDoor } = await import("./door-resolve");
    const reached = await resolveDoor(process.env, process.cwd(), args[0] === "peek" ? args : []);
    if (reached.path) process.env.EP0CH_CONTROL = reached.path;
    else if (args[0] === "open" && args.includes("--json") && reached.refused) { console.log(JSON.stringify({ opened: false, reason: reached.text })); process.exit(0); }
    else if (args[0] === "peek" || reached.refused || notACommand) {
      console.error(`ep0ch: ${notACommand ?? reached.text}`);
      process.exit(notACommand ? 2 : 1);
    }
  }
  const answered: { ran?: true } = {};
  const code = await controlClient(args, answered);
  if (code && notACommand && !answered.ran) console.error(`ep0ch: ${notACommand}`);
  process.exit(code);
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
