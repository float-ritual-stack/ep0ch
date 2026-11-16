// The CLI's vocabulary and descriptions live here: help, completion and typo suggestions read these records.
import { extFlagRows, extFlagUsage } from "@ep0ch/outliner/extension-flags";

export type CliFlag = readonly [flag: string, description: string, argument?: "value" | "none" | "rest" | "screen"];
export const HELP_FLAGS: readonly CliFlag[] = [["--help, -h", "Show this help"], ["--more", "With help, include detailed rules"]];
export interface CliCommand {
  name: string;
  group: string;
  summary: string;
  synopsis: string;
  flags: readonly CliFlag[];
  examples: readonly [string, string];
  /** Less frequent commands stay reachable through help --more and completion. */
  moreOnly?: boolean;
  /** A short form when the overview needs to show a useful flag. */
  overview?: string;
  children?: readonly CliCommand[];
  /** A shared section in docs/cli.md for commands using the same rules. */
  reference?: string;
  note?: string;
  guide?: string;
}

const ws: CliFlag = ["--ws <name>", "Use this outline"];
const machine: CliFlag = ["--machine <ssh-name>", "Reach the outline on that machine (an ssh config name)"];
const json: CliFlag = ["--json", "Print JSON"];
const actor: CliFlag = ["--as <id>", "Record the action as this agent"];
const whichDoor: CliFlag = ["--door <terminal|native>", "Which door on the outline answers: the terminal one, or the native window"];
const target = [ws, machine];
const sessionWs: CliFlag = ["--ws <name>", "Choose this outline's session on this machine"];
const allSessions: CliFlag = ["--all", "Act on every session on this machine"];
const clients: CliFlag = ["--clients", "Restart only the attached terminals"];

export const SESSION_COMMANDS: readonly CliCommand[] = [
  { name: "list", group: "Sessions", summary: "List sessions here or on another machine",
    synopsis: "session list [--machine <ssh-name>] [--json]",
    flags: [["--machine <ssh-name>", "List sessions running there, over SSH"], json],
    examples: ["ep0ch session list", "ep0ch session list --machine box-a"] },
  { name: "attach", group: "Sessions", summary: "Attach this terminal to a local session",
    synopsis: "session attach [--ws <name>] [--watch]",
    flags: [sessionWs, ["--watch", "Watch without taking the keys"], ["--wait <seconds>", "Wait for a session handing over"], ["--or-start", "Start a session if the wait ends without one"]],
    examples: ["ep0ch session attach --ws garden", "ep0ch session attach --ws garden --watch"] },
  { name: "end", group: "Sessions", summary: "End a local session and its programs",
    synopsis: "session end [--ws <name> | --all] [--yes]",
    flags: [sessionWs, allSessions, ["--yes, -y", "End without asking about programs or drafts"]],
    examples: ["ep0ch session end --ws garden", "ep0ch session end --all --yes"] },
  { name: "upgrade", group: "Sessions", summary: "Hand local sessions to the installed code",
    synopsis: "session upgrade [--ws <name> | --all] [--clients]",
    flags: [sessionWs, allSessions, clients],
    examples: ["ep0ch session upgrade --ws garden", "ep0ch session upgrade --all --clients"] },
  { name: "restart", group: "Sessions", summary: "Hand over a local session even on the same code",
    synopsis: "session restart [--ws <name> | --all] [--clients]",
    flags: [sessionWs, allSessions, clients],
    examples: ["ep0ch session restart --ws garden", "ep0ch session restart --all"] },
];

/** Flags accepted when no command is named. Their argument shape also drives cli-words. */
export const DOOR_OPTIONS: readonly CliFlag[] = [
  ...target, ["--screen <name> [<target>]", "Open a screen, optionally on a note or hub", "screen"],
  ["--layout <name>", "Open a saved desk layout"], ["--create", "Create a missing outline on another machine"],
  ["--here", "Open the outline here even when .ep0ch names a machine"], ["--remote <ssh-name>", "Run the door there and carry its terminal here", "rest"],
  ["--showcase", "Explore shared parts on made-up notes"], ["--reset", "Reseed the showcase"], ["--prepare", "Seed the showcase and exit: the headless path"],
  ["--no-daemon", "Run in this terminal instead of a lasting session"], ["--daemon", "Attach to a lasting session"],
  ["--no-create", "Refuse a missing outline"], json, ["--skill [<name>]", "List skills or print one (--path: its file)", "rest"],
];


const sub = (parent: string, group: string) => (name: string, summary: string, synopsis: string, flags: readonly CliFlag[], examples: readonly [string, string]): CliCommand =>
  ({ name, group, summary, synopsis: `${parent} ${synopsis}`, flags, examples: [`ep0ch ${parent} ${examples[0]}`, `ep0ch ${parent} ${examples[1]}`] });

const outline = sub("outline", "Outlines");
export const OUTLINE_COMMANDS: readonly CliCommand[] = [
  outline("list", "List the outlines here, or on every known machine", "list [--all] [--archived] [--lines] [--json]",
    [["--all", "Include every machine opened before (one not connected is said)"], ["--archived", "Include archived outlines"], ["--lines", "Print tab-separated name, machine and problem"], json], ["list", "list --all"]),
  outline("attach", "Open the door on an outline (the same as --ws)", "attach <name> [--machine <ssh-name>] [--create]",
    [machine, ["--create", "Make it on that machine when it lacks one"]], ["attach garden", "attach garden --machine box-a --create"]),
  outline("create", "Make a new, empty outline", "create <name> [--machine <ssh-name>]", [machine], ["create garden", "create garden --machine box-a"]),
  outline("snapshot", "Write an integrity-checked SQLite copy, or print a one-time download link", "snapshot <name> [--out <file> | --link] [--ttl <duration>] [--json]",
    [["--out <file>", "Write the copy here, on the outline's machine"], ["--link", "Print a curl command for a one-time download"], ["--ttl <duration>", "How long the link lasts (default: 15m)"], json], ["snapshot garden --out ./garden.sqlite", "snapshot garden --link --ttl 1h"]),
  outline("import", "Make a new outline from an older database (the file is only read)", "import <database.sqlite> <name>", [], ["import ./old-garden.sqlite garden", "import ~/backups/garden.sqlite garden-2025"]),
  outline("stop", "Take an outline offline: release its database", "stop <name>", [], ["stop garden", "stop orchard"]),
  outline("archive", "Hide an outline, keeping its database", "archive <name>", [], ["archive orchard", "archive garden-2025"]),
  outline("unarchive", "Bring an archived outline back", "unarchive <name>", [], ["unarchive orchard", "unarchive garden-2025"]),
  outline("delete", "Move an outline to .deleted/, after asking", "delete <name> [--yes]", [["--yes", "Delete without asking"]], ["delete orchard", "delete orchard --yes"]),
];

const share = sub("share", "Notes");
export const SHARE_COMMANDS: readonly CliCommand[] = [
  share("start", "Make a temporary public link, opening on a note", "start [<ref>] [--only <ref>] [--ttl <duration>] [--no-comments]",
    [...target, ["--only <ref>", "Share only this note and what's under it"], ["--artifact <name>", "Share one artifact on its own"], ["--ttl <duration>", "End the link by itself after this long (30m, 4h, 7d)"], ["--no-comments", "Turn off reader comments"], ["--via edge|cloudflare", "The public host (default) or a tunnel of its own"], ["--allow-mail <email>", "Require sign-in with this email or @domain; repeat for more"], actor, json],
    ["start '[[seed-plan]]' --ws garden", "start '[[seed-plan]]' --only '[[seed-plan]]' --ttl 4h --ws garden"]),
  share("list", "List the open links: link, what, ends in", "list [--all] [--json]", [...target, ["--all", "Include links that ended"], json], ["list --ws garden", "list --all --ws garden"]),
  share("revoke", "End a link now", "revoke <id> | revoke --all", [...target, ["--all", "End every open link"], json], ["revoke 7f3a --ws garden", "revoke --all --ws garden"]),
];

const agent = sub("agent", "Agents");
export const AGENT_COMMANDS: readonly CliCommand[] = [
  agent("exec", "Run a program with this machine's EP0CH_SOURCE", "exec -- <program> [args…]", [], ["exec -- printenv EP0CH_SOURCE", "exec -- codex"]),
  agent("ls", "List the Claude sessions here or on another machine", "ls [--machine <ssh-name>] [--json]", [["--machine <ssh-name>", "List the sessions running there, over SSH"], json], ["ls", "ls --machine box-a"]),
  agent("start", "Start a persona's terminal, or say it is already live", "start <persona> [--on <machine>] [--cwd <folder>] [--program <cmd>] [--outline <name>]",
    [["--on <machine>", "Start it there"], ["--cwd <folder>", "Its folder"], ["--program <cmd>", "The program it runs"], ["--outline <name>", "Bind it to this outline"]], ["start gardener", "start gardener --on box-a --outline garden"]),
  agent("use", "Choose and restart the drawer agent", "use <name> [--everywhere]", [["--everywhere", "For every outline, not only this one"]], ["use codex", "use claude --everywhere"]),
  agent("restart", "Restart a background session at a safe moment", "restart <name | short id | --all> [--if-update] [--now] [--dry-run] [--machine <ssh-name>]",
    [["--all", "Every background session, one at a time"], ["--if-update", "Only one behind the installed version"], ["--fresh-daemon", "Start with the current shell environment"], ["--check-env <VAR>", "Check the new process carries this variable"], ["--now", "Don't wait between turns"], ["--dry-run", "Say the plan, change nothing"], ["--machine <ssh-name>", "Run it there over SSH"]],
    ["restart gardener", "restart --all --if-update --dry-run"]),
  agent("splits", "List sessions running twice, with the command that stops one", "splits [--session <id>] [--machine <ssh-name>] [--json]", [["--session <id>", "Only this session"], ["--machine <ssh-name>", "Read that machine, over SSH"], json], ["splits", "splits --machine box-a"]),
  agent("stop", "Stop one process of a session that runs twice", "stop <pid> --session <session id> [--machine <ssh-name>]", [["--session <id>", "The session the pid belongs to"], ["--machine <ssh-name>", "Stop it there, over SSH"]], ["stop 4242 --session 1a2d3c", "stop 4242 --session 1a2d3c --machine box-a"]),
];

const mcp = sub("mcp", "Agents");
export const MCP_COMMANDS: readonly CliCommand[] = [
  mcp("serve", "Serve the outline tools over HTTP for remote clients", "serve --http [--port <n>] [--bind <address>] [--ws <default outline>]", [["--http", "Serve over HTTP"], ["--port <n>", "Listen on this port"], ["--bind <address>", "Listen on this address"], ws], ["serve --http --port 8787", "serve --http --bind 127.0.0.1 --ws garden"]),
  mcp("access", "Show or set who can read or write through MCP", "access [none|read|propose|full] [--matrix] [--cap <persona>[@<outline>[@<machine>]]=<level>]",
    [...target, ["--matrix", "Every caller against every outline"], ["--cap <persona>[@<outline>[@<machine>]]=<level>", "Cap a named agent's access"], json], ["access --ws garden", "access propose --ws garden"]),
  mcp("usage", "Measured MCP calls, or the outline's block census", "usage [--since <duration>] [--by tool|actor|outline] [--census]", [["--since <duration>", "The window (default: 24h)"], ["--by tool|actor|outline", "Group the calls"], ["--census", "Note totals by property instead"], ...target, json], ["usage --since 7d --by actor", "usage --census --ws garden"]),
  mcp("queue", "The gateway's queued writes for other machines", "queue [status | drop <id>… [--why <words>]]", [["--why <words>", "Record why a dropped write was withdrawn"], json], ["queue", "queue drop 7f3a --why 'done by hand'"]),
  mcp("pull", "Apply the writes queued for this machine's outlines", "pull [--from <ssh-name>]", [["--from <ssh-name>", "The gateway to pull from"]], ["pull", "pull --from hub"]),
];

const work = sub("work", "Agents");
export const WORK_COMMANDS: readonly CliCommand[] = [
  work("create", "File a ticket", "create <title>|--title <words> --project <p> --arc <a> --track <t>… --priority high|medium|low [--stage <s>] [--body-file <f>]", [["--title <words>", "The ask, as written (or typed first, quoted)"], ["--arc <a>", "Its arc"], ["--track <t>", "Its track (one or more)"], ["--project <p>", "Its project"], ["--priority <level>", "high, medium or low"], ["--stage <s>", "Its first stage"], ["--body-file <f>", "Its body from a file (or --stdin)"], ["--attach PIE-n", "Add it to an open item instead"], ...target], ["create 'Gate sticks' --project garden --arc floor --track garden --priority high --ws garden", "create --title 'Gate sticks' --attach GARDEN-12 --ws garden"]),
  work("prefix", "Show or set the Work-ID prefix new tickets take", "prefix [<PREFIX>]", [...target, json], ["prefix --ws garden", "prefix GATE --ws garden"]),
  work("stage", "Move a ticket to a stage", "stage <item> <stage> [--expected <n>] [--as <id>]", [["--expected <n>", "Refuse if the item's revision moved"], ...target, actor], ["stage GARDEN-12 doing --ws garden", "stage GARDEN-12 review --ws garden"]),
  work("set", "Set a ticket's property", "set <item> <key> <value> [--expected <n>] [--as <id>]", [["--expected <n>", "Refuse if the item's revision moved"], ...target, actor], ["set GARDEN-12 priority high --ws garden", "set GARDEN-12/door delivery-stage validate --ws garden"]),
  work("deliver", "Record a pull request as a ticket's delivery and sync its state", "deliver [<item>] --repo <owner/name> --pr <n> [--key <name>]", [["--repo <owner/name>", "The repository"], ["--pr <n>", "The pull request"], ["--key <name>", "A second delivery's name"], ...target], ["deliver GARDEN-12 --repo acme/garden --pr 7 --ws garden", "deliver --repo acme/garden --pr 7 --ws garden"]),
  work("complete", "Close a ticket with proof", "complete <item> --proof-file <f> | --stdin [--all-merged]", [["--proof-file <f>", "The proof, from a file"], ["--all-merged", "Every merged delivery counts"], ...target], ["complete GARDEN-12 --proof-file ./proof.md --ws garden", "complete GARDEN-12 --stdin --ws garden"]),
  work("body", "Replace a ticket's body", "body <item> --file <f> | --stdin", [["--file <f>", "The new body"], ...target], ["body GARDEN-12 --file ./body.md --ws garden", "body GARDEN-12 --stdin --ws garden"]),
  work("link", "Name a note's ticket", "link <note> <item>", target, ["link '[[gate-request]]' GARDEN-12 --ws garden", "link ((7f3a1c)) GARDEN-12 --ws garden"]),
  work("groom", "Jev's pass over queued tickets: solved, superseded, duplicate or open", "groom [--repo <dir>] [--since <duration>] [--where <query>] [--park | --later] [--apply]",
    [...target, ["--repo <dir>", "Read this repository's history"], ["--since <duration>", "The history window"], ["--where <query>", "Only these tickets"], ["--limit <n>", "Read at most n tickets"], ["--into <name>", "Keep the verdicts in this outline"], ["--park", "Move old queued tickets to later"], ["--older-than <duration>", "The parking age (default: 30d)"], ["--later", "Look for parked work wanted again"], ["--apply", "Write the changes"], ["--no-jev", "Code's measures alone"], actor, json],
    ["groom --ws garden --no-jev", "groom --park --older-than 60d --apply --ws garden"]),
  work("try", "What a validator would try for merged tickets, as journeys", "try <PIE-n>… [--into <name>] [--no-jev]", [...target, ["--into <name>", "Keep the plan as a note here"], ["--no-jev", "Code's measures alone"], json], ["try GARDEN-12 --ws garden", "try GARDEN-12 GARDEN-14 --into garden --ws garden"]),
];

const backup = sub("backup", "Install and health");
export const BACKUP_COMMANDS: readonly CliCommand[] = [
  backup("status", "The verdict first, then each outline and the history", "status [--json | --verbose]", [["--verbose", "Include raw reasons"], json], ["status", "status --verbose"]),
  backup("run", "The backup job as its timer runs it: archive each log, upload, announce", "run [--drill] [--verbose]", [["--drill", "Include a restore drill"], ["--verbose", "Include raw reasons"]], ["run", "run --drill"]),
  backup("snapshot", "Archive and upload the outlines whose log moved", "snapshot [--force] [--verbose] [--wait <seconds>]", [["--force", "Unchanged outlines too"], ["--verbose", "Include raw reasons"], ["--wait <seconds>", "Wait that long for a backup already running, instead of stopping (install waits 600)"]], ["snapshot", "snapshot --wait 600"]),
  backup("follow", "Follow other machines' outlines here, applying each log as it changes", "follow [--once]", [["--once", "Catch up once and exit"]], ["follow", "follow --once"]),
  backup("drill", "Replay the newest archives somewhere harmless and check them", "drill [--serve] [--machine <name>]", [["--serve", "Also open each with a scratch host and read it, timed (install's proof)"], ["--machine <name>", "That machine's repository, from here"]], ["drill --serve", "drill --machine box-a"]),
  backup("list", "An outline's archive snapshots", "list <outline> [--machine <name>]", [["--machine <name>", "Read that machine's repository"]], ["list garden", "list garden --machine box-a"]),
  backup("copy", "A consistent copy of a live outline, made by its host", "copy <outline> <file>", [], ["copy garden ./garden-copy.sqlite", "copy garden /tmp/garden-before-the-move.sqlite"]),
  backup("restore", "Replay an outline's archive to a new file, never over an outline in use", "restore <outline> [--at <time> | --log <id> --entry <n>] --to <path>", [["--machine <name>", "Read that machine's repository"], ["--at <time>", "Replay up to this time (ISO, 3h, 2d)"], ["--log <id>", "With --entry: that log (install's rollback point)"], ["--entry <n>", "Replay exactly to that entry, checked"], ["--to <path>", "The new file"]], ["restore garden --to ./garden-restored.sqlite", "restore garden --at 2d --to ./garden-2d.sqlite"]),
];

const ext = sub("ext", "Extensions");
export const EXT_COMMANDS: readonly CliCommand[] = [
  ext("ls", "List the outline's extensions, what each serves and its schedules", "ls [--long] [--json]", [ws, ["--long", "Folders, arguments and schedules"], json], ["ls --ws garden", "ls --long --ws garden"]),
  ext("add", "Install an extension by name or from a folder", `add <name|path> ${extFlagUsage("add")}`, [ws, ...extFlagRows("add")], ["add horoscope --ws garden", "add ./my-extension --ws garden"]),
  ext("remove", "Uninstall an extension: the outline's own copy, else the machine's", `remove <name> ${extFlagUsage("remove")}`, [ws, ...extFlagRows("remove")], ["remove horoscope --ws garden", "remove horoscope --user-folder"]),
  ext("update", "Refresh a copy of a built-in, by name: the outline's own, else the machine's (or --all: every folder)", `update [<name>] ${extFlagUsage("update")}`, [ws, ...extFlagRows("update")], ["update horoscope --ws garden", "update --all --keep-forked"]),
  ext("act", "Run one of an extension's actions, as the extension", "act <name> <action> [--block <id>]", [ws, ["--block <id>", "Run it on this note"], json], ["act horoscope today --ws garden", "act horoscope today --block '[[seed-plan]]' --ws garden"]),
  ext("run", "Run one of an extension's schedules now", "run <name> <action:id|handler:key>", [ws, json], ["run weather handler:refresh --ws garden", "run weather action:fetch --ws garden"]),
];

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "", group: "Open", summary: "Open an outline here or on another machine", overview: "[--ws <name>]",
    synopsis: "[--ws <name>] [--machine <ssh-name> | --here] [--screen <name>]",
    flags: DOOR_OPTIONS, examples: ["ep0ch --ws garden --machine box-a", "ep0ch --ws garden --screen board"], reference: "launch" },
  { name: "door", group: "Open", summary: "Call an SSH door",
    synopsis: "door [<ssh-name>] [<outline>]", flags: [],
    examples: ["ep0ch door", "ep0ch door garden-door garden"] },
  { name: "try", group: "Open", summary: "Explore a copy or the kitchen sink",
    synopsis: "try --ws <name> [--copy] | try --showcase [--reset] [--prepare]",
    flags: [ws, ["--copy", "Use a private copy of the outline"], ["--hub <id>", "Open this hub"], ["--showcase", "Open the seeded kitchen sink"], ["--reset", "Reseed the showcase"], ["--prepare", "Seed the showcase and exit, with no terminal: the headless path"]],
    examples: ["ep0ch try --showcase --prepare", "ep0ch try --ws garden --copy"] },
  { name: "init", group: "Outlines", summary: "Bind this folder to an outline",
    synopsis: "init [<name>] [--create] [--json]", flags: [...target, ["--create", "Create a missing outline on another machine"], json],
    examples: ["ep0ch init garden", "ep0ch init garden --machine box-a"] },
  { name: "outline", group: "Outlines", summary: "List, create, import or put away outlines",
    synopsis: "outline list | snapshot|attach|create|stop|archive|unarchive|delete <name> | import <database.sqlite> <name>",
    flags: [machine, json], children: OUTLINE_COMMANDS,
    examples: ["ep0ch outline list --all", "ep0ch outline create garden"] },
  { name: "show", group: "Notes", summary: "Read notes as the door draws them",
    synopsis: "show <id>… [--source | --markdown | --ansi | --cells | --site]",
    flags: [...target, ["--source", "Print the Blockdown as written"], ["--markdown", "Include live figures as Markdown"], ["--ansi", "Keep terminal colours"], ["--cells", "Print the rendered cell grid as JSON"], ["--site", "Print source and resolved placeholders as JSON"], ["--width <n>", "Draw at this width (default: terminal or 80)"], ["--rows <n>", "Keep the first n drawn rows"]],
    examples: ["ep0ch show '[[seed-plan]]' --ws garden", "ep0ch show '[[seed-plan]]' --ws garden --source"] },
  { name: "find", group: "Notes", summary: "Find notes by words, properties or a view",
    synopsis: "find [<words>…] [--query <expression> | --recent | --tree [<root>]]",
    flags: [...target, ["--query <expression>", "Use the views' query grammar"], ["--view <id>", "Read a saved view in its order"], ["--under <id>", "Search this note and its descendants"], ["--recent", "Show the newest 30 notes"], ["--tree [<root>]", "Walk the outline or a branch"], ["--lexical", "Search without Jev's ranking"], ["--timeout <seconds>", "Wait this long for each answer (15 by default)"], ["--property-scope <scope>", "Read block, line, inline or all properties"], ["--machinery hide|only|show", "Choose whether generated notes appear"], ["--sort <key>", "Sort on any property, created or updated"], ["--direction asc|desc", "Choose the sort direction"], ["--updated-after <date>", "Keep notes updated after this date"], ["--updated-before <date>", "Keep notes updated before this date"], ["--created-after <date>", "Keep notes created after this date"], ["--created-before <date>", "Keep notes created before this date"], ["--limit <n>", "Print the first n notes (stderr says when it cut)"], ["--ids", "Print references, one per line"], ["--lines", "Print tab-separated rows"], json],
    examples: ["ep0ch find seeds --ws garden", "ep0ch find --query 'due <= +3d' --ws garden"] },
  { name: "new", group: "Notes", summary: "Capture a note in the Inbox or under another",
    synopsis: "new <text>… [--near <id>]", flags: [...target, ["--near <id>", "Add as this note's last child"], actor, json],
    examples: ["ep0ch new 'Buy seeds' --ws garden", "ep0ch new '[page::seed-plan]' --ws garden"] },
  { name: "revisions", group: "Notes", summary: "Read or restore an earlier note",
    synopsis: "revisions <id> [<n> [--restore]]", flags: [...target, ["--restore", "Save this revision as a new current revision"], json],
    examples: ["ep0ch revisions '[[seed-plan]]' --ws garden", "ep0ch revisions '[[seed-plan]]' 2 --ws garden"] },
  { name: "mark", group: "Notes", summary: "Mark a note, or take your mark off",
    synopsis: "mark <id> [--reason <words>] [--remove]", flags: [...target, ["--reason <words>", "Make it a look-here mark, framed in every door"], ["--words <text>", "Keep a note with the mark"], ["--remove", "Take your marks on the note off"], actor, json],
    examples: ["ep0ch mark '[[seed-plan]]' --ws garden", "ep0ch mark '[[seed-plan]]' --reason 'needs your call' --as loki --ws garden"] },
  { name: "marks", group: "Notes", summary: "List the outline's marks", moreOnly: true,
    synopsis: "marks [--today]", flags: [...target, ["--today", "Only the marks made today"], json],
    examples: ["ep0ch marks --ws garden", "ep0ch marks --today --json --ws garden"] },
  { name: "export", group: "Notes", summary: "Write notes as Markdown or JSON files",
    synopsis: "export [<id>… | --all] [--out <dir>|-]", flags: [...target, ["--all", "Read every live note"], ["--query <expression>", "Select by a view query"], ["--view <id>", "Export a saved view"], ["--under <id>", "Export a branch"], ["--children", "Include each note's descendants"], ["--format md|json", "Choose Markdown (default) or block records"], ["--out <dir>|-", "Write files here, or print to stdout"], ["--split", "Give descendants their own files"], ["--resolve-links", "Link exported notes with relative file paths"], ["--manifest", "Write manifest.json"], ["--source", "Keep figures as Blockdown source"], ["--timeout <seconds>", "Wait this long for each answer (15 by default)"]],
    examples: ["ep0ch export --all --out ./notes --ws garden", "ep0ch export '[[seed-plan]]' --children --ws garden"] },
  { name: "share", group: "Notes", summary: "Make or end a temporary public link",
    synopsis: "share start [<ref>] | list | revoke <id>", flags: [...target, actor, json], children: SHARE_COMMANDS,
    examples: ["ep0ch share start '[[seed-plan]]' --ws garden", "ep0ch share list --ws garden"] },
  { name: "wait", group: "Notes", summary: "Wait until new notes match a query", moreOnly: true,
    synopsis: "wait <query> [--timeout <seconds>]", flags: [...target, ["--timeout <seconds>", "Exit 2 when no new match arrives in time"], ["--ids", "Print references only"], ["--lines", "Print tab-separated rows"], json],
    examples: ["ep0ch wait 'type=chore' --ws garden", "ep0ch wait 'due <= today' --timeout 60 --json --ws garden"] },
  { name: "view", group: "Notes", summary: "Read or change a view's hand-set order", moreOnly: true,
    synopsis: "view order <view> [<id>…]", flags: [...target, actor, json],
    examples: ["ep0ch view order '[[seed-list]]' --ws garden", "ep0ch view order '[[seed-list]]' '[[beans]]' '[[peas]]' --ws garden"] },
  { name: "mirror", group: "Notes", summary: "Keep a folder of exported notes up to date", moreOnly: true,
    synopsis: "mirror <dir> [--once]", flags: [...target, ["--once", "Export once and exit"], ["--timeout <seconds>", "Wait this long for each answer (15 by default)"]],
    examples: ["ep0ch mirror ./notes --once --ws garden", "ep0ch mirror ./notes --ws garden"] },
  { name: "route", group: "Notes", summary: "File notes using the outline's note mover rules", moreOnly: true,
    synopsis: "route <note> | --all [--dry-run]", flags: [ws, ["--all", "Route every note"], ["--dry-run", "Show moves without making them"], json],
    examples: ["ep0ch route '[[seed-plan]]' --ws garden", "ep0ch route --all --dry-run --ws garden"] },
  { name: "reader", group: "Notes", summary: "Read the web reader's page and selection", moreOnly: true,
    synopsis: "reader [--ws <name>] [--json]", flags: [ws, json],
    examples: ["ep0ch reader --ws garden", "ep0ch reader --ws garden --json"] },
  { name: "resource", group: "Notes", summary: "Rebind a file-link folder after it moves", moreOnly: true,
    synopsis: "resource rebind <folder>", flags: [ws, json],
    examples: ["ep0ch resource rebind ./notes --ws garden", "ep0ch resource rebind ./images --ws garden --json"] },
  { name: "agent", group: "Agents", summary: "Start, find or manage an agent session",
    synopsis: "agent [--program <name>] [--in <folder>] [--new] | ls | start <persona> | use <name> | restart <name> | splits | stop <pid>",
    flags: [["--program <name>", "An agent configuration or program (claude, codex, pi)"], ["--in <folder>", "Start or attach in this folder"], ["--persona <name>", "Name the agent's persona"], ["--new", "Start another session in the same folder"], json], children: AGENT_COMMANDS,
    note: "With no subcommand, agent starts (or attaches) an agent session in this folder, as a tab in the door's drawer.",
    examples: ["ep0ch agent --program codex --in ./garden", "ep0ch agent ls --machine box-a"] },
  { name: "mcp", group: "Agents", summary: "Serve outline tools and manage their access",
    synopsis: "mcp [serve | access | usage | queue | pull]", flags: [...target, json], children: MCP_COMMANDS,
    note: "With no subcommand, mcp is the local stdio MCP server for this outline, gated by its access grant.",
    examples: ["ep0ch mcp --ws garden", "ep0ch mcp access --ws garden --json"] },
  { name: "peek", group: "Agents", summary: "Read what the running door shows",
    synopsis: "peek [<section>] [--json] [--remote <machine> [--ws <name>]]", flags: [json, ["--xray", "Include the screen's structure"], ["--full", "Include each tile's whole description"], ["--remote <machine>", "The door running on that machine, through its link (act, open, snap and actions take it too)"], actor, whichDoor],
    examples: ["ep0ch peek layout --json", "ep0ch peek --remote box-a --ws garden"] },
  { name: "act", group: "Agents", summary: "Run an action in the door",
    synopsis: "act <action> [key=value …]", flags: [actor, json, whichDoor],
    examples: ["ep0ch act screen.list", "ep0ch act layout.get --as gardener"], reference: "scripts" },
  { name: "actions", group: "Agents", summary: "List the door's actions and arguments",
    synopsis: "actions", flags: [whichDoor], examples: ["ep0ch actions", "ep0ch --ws garden actions"] },
  { name: "open", group: "Agents", summary: "Show a note or file in the running door",
    synopsis: "open <id|ep0ch://outline@machine/b/id|file:/path> [diff=true]", flags: [actor, json],
    examples: ["ep0ch open file:./README.md", "ep0ch open file:./README.md diff=true"], reference: "actions" },
  { name: "snap", group: "Agents", summary: "Save a picture of the door", moreOnly: true,
    synopsis: "snap <png>", flags: [], examples: ["ep0ch snap garden.png", "ep0ch --ws garden snap garden.png"], reference: "actions" },
  { name: "trace", group: "Agents", summary: "See which code ran an action", moreOnly: true,
    synopsis: "trace on|off|show [action]", flags: [["--last <n>", "Read the last n traces"], json],
    examples: ["ep0ch trace on", "ep0ch trace show --last 5"] },
  { name: "subscribe", group: "Agents", summary: "Follow the door's live events", moreOnly: true,
    synopsis: "subscribe [type,...]", flags: [], examples: ["ep0ch subscribe", "ep0ch subscribe focus.changed,layout.changed"] },
  { name: "record", group: "Agents", summary: "Append a run, deploy or finding record", moreOnly: true,
    synopsis: "record <kind> [--field <value> …]", flags: [...target, ["--report-file <path>", "Attach a run-end report to the start's ticket"], ["--observed", "Read this machine's versions for a deploy record"]],
    examples: ["ep0ch record finding --ticket GARDEN-12 --source person --failure 'Gate sticks' --ws garden", "ep0ch record run-start --ticket GARDEN-12 --harness codex --summary 'Repair gate' --ws garden"] },
  { name: "review", group: "Agents", summary: "Review earlier agent-written notes", moreOnly: true,
    synopsis: "review backfill|asks [--since <duration>]", flags: [...target, ["--since <duration>", "Read notes from this window (default: 7d; asks: 30d)"], ["--limit <n>", "Read at most n notes"], ["--write", "asks: write what the dry run prints"], ["--into <name>", "Save findings in this outline"], ["--into-machine <ssh-name>", "Use this machine for the findings"], ["--no-jev", "Use code's measures alone"], json],
    examples: ["ep0ch review backfill --ws garden --no-jev", "ep0ch review asks --since 30d --ws garden"] },
  { name: "work", group: "Agents", summary: "Manage tickets and their delivery",
    synopsis: "work create|prefix|stage|set|deliver|complete|body|link|groom|try …", flags: [...target, actor, json], children: WORK_COMMANDS,
    examples: ["ep0ch work groom --ws garden --no-jev", "ep0ch work try GARDEN-12 --ws garden"] },
  { name: "search", group: "Agents", summary: "Collect and evaluate search examples", moreOnly: true,
    synopsis: "search harvest | eval", flags: [machine, ["--into <name>", "Keep cases or evaluations in this outline"], ["--logs <dir>", "Read agent logs here"], ["--dry-run", "Show harvest without saving"], ["--models <names>", "Compare these ranking models"], ["--variants <names>", "Compare state, deep or state+deep"], ["--snapshots <dir>", "Read copied databases here"], ["--cases <file>", "Read evaluation cases from this file"], ["--only <source>", "Evaluate this case source"], json],
    examples: ["ep0ch search harvest --dry-run --into garden", "ep0ch search eval --cases ./cases.json --json"] },
  { name: "where", group: "Machines", summary: "Show the source checkout, terminal and keys",
    synopsis: "where [--json|--source]", flags: [json, ["--source", "Print only the source checkout path"]],
    note: "Names the checkout, AGENTS.md, docs, skills and SHA, plus this terminal's layers and where the person's keys are. Read-only.",
    examples: ["ep0ch where --json", "ep0ch where --source"] },
  { name: "clients", group: "Machines", summary: "List clients connected to an outline",
    synopsis: "clients [--ws <name>] [--machine <ssh-name>]", flags: target,
    examples: ["ep0ch clients --ws garden", "ep0ch clients --ws garden --machine box-a"] },
  { name: "link", group: "Machines", summary: "Connect a machine over an outbound HTTPS link", moreOnly: true,
    synopsis: "link setup|serve|connect|status | doors <machine> | via <machine> <ssh-name>", flags: [json],
    examples: ["ep0ch link status", "ep0ch link via box-a hub"] },
  { name: "web", group: "Machines", summary: "List or sign out web browsers", moreOnly: true,
    synopsis: "web sessions | revoke <id> | revoke --all", flags: [["--all", "Sign out every browser"], json],
    examples: ["ep0ch web sessions", "ep0ch web sessions --json"] },
  { name: "device", group: "Machines", summary: "Manage a phone's upload token", moreOnly: true,
    synopsis: "device add <name> | ls | revoke <name|id>", flags: [ws],
    examples: ["ep0ch device add garden-phone --ws garden", "ep0ch device ls"] },
  { name: "loki", group: "Machines", summary: "Make or end a read-only Loki link", moreOnly: true,
    synopsis: "loki lease [--ttl 1h] | lease --revoke", flags: [["--ttl <duration>", "Set link lifetime"], ["--revoke", "End all leases"]],
    examples: ["ep0ch loki lease --ttl 1h", "ep0ch loki lease --revoke"] },
  { name: "session", group: "Sessions", summary: "List sessions here or over SSH; attach or end here",
    synopsis: "session [list|attach|end|upgrade|restart]", flags: [], children: SESSION_COMMANDS,
    note: "list --machine lists that machine's sessions: through its link when one carries them (ep0ch link via), else over ssh; for the other commands --machine names where the session's outline lives, as it does for ep0ch itself",
    examples: ["ep0ch session list --machine box-a", "ep0ch session attach --ws garden"] },
  { name: "log", group: "Sessions", summary: "Read or follow session messages",
    synopsis: "log [--follow]", flags: [...target, ["--follow", "Follow new messages as JSON lines"]],
    examples: ["ep0ch log --ws garden", "ep0ch log --ws garden --follow"] },
  { name: "ext", group: "Extensions", summary: "List, add, remove, update or run an extension",
    synopsis: "ext ls | add <name|path> | remove <name> | update <name> | act <name> <action> | run <name> <action:id|handler:key>",
    flags: [ws, json], children: EXT_COMMANDS, guide: "ep0ch docs extensions",
    examples: ["ep0ch ext ls --ws garden", "ep0ch ext add horoscope --ws garden"] },
  { name: "library", group: "Extensions", summary: "Browse components and their examples",
    synopsis: "library [<component>…]", flags: [...target, ["--brief", "Read properties and a minimal example"], ["--guide", "Read what notes can hold"], ["--out <dir>", "Write illustrated Markdown reference pages"], ["--width 40|80|160", "Set the illustrated examples' width"], json],
    examples: ["ep0ch library --brief --ws garden", "ep0ch library --guide --ws garden"] },
  { name: "docs", group: "Extensions", summary: "Read the scripting and extension guides",
    synopsis: "docs [scripts|extensions]", flags: [], guide: "ep0ch docs extensions", examples: ["ep0ch docs scripts", "ep0ch docs extensions"] },
  { name: "echo", group: "Extensions", summary: "Carry notes between outlines with EchoNet", moreOnly: true,
    synopsis: "echo toss|status|nodelist|areas | subscribe <node mask> <area>",
    flags: [ws, ["--under <id>", "Put the subscription under this note"], ["--since all|<date>", "Read earlier copies (default: from now on)"], ["--cap <n>", "Take at most n new copies per node per toss (default: 25)"], ["--title <words>", "Name the subscription note"], json],
    examples: ["ep0ch echo areas --ws garden", "ep0ch echo toss --ws garden"] },
  { name: "artifact", group: "Extensions", summary: "Put files in the artifact library or inbox", moreOnly: true,
    synopsis: "artifact put <path> | ls | show|versions|snapshot|rm <name> | import | lease [<name>]",
    flags: [...target, ["--name <name>", "Name an uploaded artifact"], json],
    examples: ["ep0ch artifact put ./garden.html --name garden", "ep0ch artifact lease --ws garden"] },
  { name: "keys", group: "Extensions", summary: "Manage secret names and who can use them", moreOnly: true,
    synopsis: "keys list | check|who <KEY> | set <group> <KEY> | grant|revoke <group>[/<KEY>] <scope>",
    flags: [], examples: ["ep0ch keys list", "ep0ch keys check WEATHER_TOKEN"] },
  { name: "install", group: "Install and health", summary: "Preview or apply a stack update",
    synopsis: "install [--apply]", flags: [["--apply", "Back up outlines and apply the update"], ["--machine-name <name>", "Name this machine for links and EchoNet"], ["--dials-in", "Mark this machine as calling out only"], ["--no-dials-in", "Clear the calling-out-only setting"], ["--add-client <ssh-name>", "Add a client to update after this host"], ["--remove-client <ssh-name>", "Remove an update client"], ["--as-client", "Update this client without updating others"], json],
    examples: ["ep0ch install", "ep0ch install --apply"] },
  { name: "doctor", group: "Install and health", summary: "Check the stack and show repairs",
    synopsis: "doctor [--backups] [--json]", flags: [["--backups", "Check the machine itself too (failed units, the load)"], json],
    examples: ["ep0ch doctor", "ep0ch doctor --backups"] },
  { name: "status", group: "Install and health", summary: "Show the outline host and its outlines",
    synopsis: "status [--json]", flags: [json], examples: ["ep0ch status", "ep0ch status --json"] },
  { name: "backup", group: "Install and health", summary: "Check, make or restore backups",
    synopsis: "backup status|run|snapshot|follow|drill | list|restore|copy <outline>", flags: [json], children: BACKUP_COMMANDS,
    examples: ["ep0ch backup status", "ep0ch backup restore garden --to ./garden-restored.sqlite"] },
  { name: "disk", group: "Install and health", summary: "What the disk keeper saw: each disk, what's big and who reclaims it",
    synopsis: "disk [status] [--json] | disk keep [--json]", flags: [json],
    examples: ["ep0ch disk", "ep0ch disk keep"] },
  { name: "help", group: "Install and health", summary: "Read a command's synopsis, flags and examples", moreOnly: true,
    synopsis: "help [<command> [<subcommand>]] [--more]", flags: [],
    examples: ["ep0ch help session", "ep0ch help find --more"] },
  { name: "completions", group: "Install and health", summary: "Enable shell completion from these command definitions", moreOnly: true,
    synopsis: "completions bash|zsh|fish | completions -- [<word> …]", flags: [["--", "Print candidates for the words through the cursor"]],
    examples: ["ep0ch completions bash > ./ep0ch-completion.bash", "ep0ch completions -- session l"] },
];

export const COMMANDS = CLI_COMMANDS.map(c => c.name).filter(Boolean);
export const commandNamed = (name: string) => CLI_COMMANDS.find(c => c.name === name);
