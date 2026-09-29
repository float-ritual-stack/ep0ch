#!/usr/bin/env bun
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { App } from "./app";
import { Logon } from "./screens";
import { startScreens } from "./start";
import { SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients, startControl } from "./control";
import { skillCommand } from "./skills";
import { resolveTarget } from "./discover";
import { attachTarget, parseOutlineArgs, runOutlineCommand } from "./outlines";
import { Mirror } from "./mirror";
import { setupCommand } from "./setup/apply";

const STATE = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door", "lastcall.json");

function readLastCall(): number {
  try { return Number(JSON.parse(readFileSync(STATE, "utf8")).at) || 0; } catch { return 0; }
}
function writeLastCall(at: number) {
  try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ at })); } catch { /* not fatal */ }
}

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
                                   drive a running door; EP0CH_CONTROL names which one
  ep0ch subscribe [type,...]       the door's live feed: focus.changed, viewport, cursor, layout.changed,
                                   marks.changed, one JSON event per line (docs/AGENT-INTERFACE.md)
  ep0ch --skill [--all] [<name>]
                                   the stack's skills (this door's and the installed Outliner's), or the
                                   path of one skill's SKILL.md; --all adds contributor skills
  ep0ch help`;
if (["help", "--help", "-h"].includes(args[0] ?? "")) { console.log(USAGE); process.exit(0); }
if (args[0] === "doctor" || args[0] === "install") process.exit(await setupCommand(args));
if (args.includes("--skill")) { const r = skillCommand(args); (r.code ? console.error : console.log)(r.out); process.exit(r.code); }
if (args[0] === "try") {
  const run = Bun.spawn(["sh", join(import.meta.dir, "../scripts/try-it.sh"), ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await run.exited);
}
if (["peek", "snap", "open", "actions", "act", "subscribe"].includes(args[0] ?? "")) process.exit(await controlClient(args));
if (args[0] === "outline" || args[0] === "status") {
  const cmd = parseOutlineArgs(args[0] === "status" ? args : args.slice(1));
  if ("error" in cmd) { console.error(`ep0ch: ${cmd.error}`); process.exit(2); }
  // `outline attach <name>` opens the door on it, as --ws <name> does; with --json it only attaches.
  if (cmd.op === "attach" && !cmd.json) args = ["--ws", cmd.name, ...args.slice(3).filter(a => a !== "--json")];
  else process.exit(await runOutlineCommand(cmd));
}
// Which service, and which outline on a host: --ws <name|root>, a socket, EP0CH_SOCKET, the folder's binding
// or name on a running host, else the workspace this directory is in (src/discover.ts, resolveTarget).
const target = await resolveTarget(args);
if ("error" in target) { console.error(`ep0ch: ${target.error}`); process.exit(1); }
const board = new SocketBoard(target.path, undefined, target.outline);
if (args[0] === "clients") {
  try { console.log(formatClients(clientRows(await board.request<any[]>("clients.list")))); }
  catch (e) { console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message}`); board.close(); process.exit(1); }
  board.close();
  process.exit(0);
}
// The door opens a session, so it attaches to its outline and creates it when there is none (like
// herdr --session <name>); `clients` only reads, so it never creates.
let created = false;
if (target.attach && target.outline) {
  try { created = (await attachTarget(target)).created; }
  catch (e) { console.error(`ep0ch: can't open the outline "${target.outline}" on ${target.path}\n  ${(e as Error).message}`); board.close(); process.exit(1); }
}
let info;
try { info = await board.info(); }
catch (e) {
  console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message}`);
  board.close();
  process.exit(1);
}

const term = new Term();
await term.start();
// Everything the terminal is sent also goes to a mirror, so `snap` can show exactly this screen.
const mirror = new Mirror(term.info.cols, term.info.rows);
const rawWrite = term.write;
term.write = (s: string) => { rawWrite(s); mirror.write(s); };
// Before the door repaints for the new size: a mirror resized after the repaint would be blank until each
// row changed again, and `snap` would show half a screen.
process.stdout.prependListener("resize", () => mirror.resize(process.stdout.columns || term.info.cols, process.stdout.rows || term.info.rows));
const lastCall = readLastCall();
const loggedOnAt = Date.now();
const app = new App(term, board, lastCall, () => {
  term.stop();
  if (app.keptOnExit.length) console.error(`ep0ch: unsaved text was copied to:\n  ${app.keptOnExit.join("\n  ")}`);
  control?.close();
  board.close();
  writeLastCall(loggedOnAt);
  process.exit(0);
});
app.host = info.host;
app.workspace = info.workspace;
app.outline = info.outline;
board.subscribe(e => app.event(e));
// No one to ask on a signal: unsaved drafts and comments are copied to disk, then the door quits.
for (const sig of ["SIGTERM", "SIGHUP"] as const) process.on(sig, () => app.terminate());
let control: { close(): void } | null = null;
startControl({ app, mirror, info: () => term.info }).then(c => { control = c; }, () => {});
for (const s of startScreens(args, process.env, then => new Logon(app, then))) app.push(s);
if (created) app.flash(`created outline ${target.outline}`, 12_000);
else if (target.notice) app.flash(target.notice, 12_000);
