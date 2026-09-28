#!/usr/bin/env bun
// ep0ch-door: a BBS door into a pi-herdr-outliner outline, over its socket.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { dirname, join } from "node:path";
import { App } from "./app";
import { Logon } from "./screens";
import { startScreens } from "./start";
import { DEFAULT_SOCKET, SocketBoard } from "./socket";
import { Term } from "./term";
import { clientRows, controlClient, formatClients, startControl } from "./control";
import { skillCommand } from "./skills";
import { Mirror } from "./mirror";

const STATE = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door", "lastcall.json");

function readLastCall(): number {
  try { return Number(JSON.parse(readFileSync(STATE, "utf8")).at) || 0; } catch { return 0; }
}
function writeLastCall(at: number) {
  try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ at })); } catch { /* not fatal */ }
}

const args = process.argv.slice(2);
const USAGE = `ep0ch: a BBS door into a pi-herdr-outliner outline

  ep0ch [--ws <root> | <socket>] [--board [<hub-id>] | --desk | --river | --brief | --showcase]
                                   open the door (the logon, then the main menu, by default);
                                   --brief opens the newest daily brief (type::daily-brief), and
                                   EP0CH_LANDING=brief lands on it after the logon
  ep0ch try --ws <root> [--copy --outliner <checkout>] [--hub <id>]
  ep0ch try --showcase [--reset] --outliner <checkout>
                                   the door on a private copy, or on the showcase outline (scripts/try-it.sh)
  ep0ch clients [--ws <root> | <socket>]
                                   who is connected to the service, every role (observers too)
  ep0ch peek | actions | snap <png> | open <id> | act <action> [key=value ...]
                                   drive a running door; EP0CH_CONTROL names which one
  ep0ch --skill [--all] [<name>]
                                   the stack's skills (this door's and the installed Outliner's), or the
                                   path of one skill's SKILL.md; --all adds contributor skills
  ep0ch help`;
if (["help", "--help", "-h"].includes(args[0] ?? "")) { console.log(USAGE); process.exit(0); }
if (args.includes("--skill")) { const r = skillCommand(args); (r.code ? console.error : console.log)(r.out); process.exit(r.code); }
if (args[0] === "try") {
  const run = Bun.spawn(["sh", join(import.meta.dir, "../scripts/try-it.sh"), ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await run.exited);
}
if (["peek", "snap", "open", "actions", "act"].includes(args[0] ?? "")) process.exit(await controlClient(args));
// --ws <workspace root>: the outliner keeps each workspace's socket at state/<sha256(root)[0:12]>/outliner.sock.
const wsAt = args.indexOf("--ws");
const wsSocket = wsAt >= 0 && args[wsAt + 1]
  ? join(process.env.OUTLINER_STATE_DIR ?? join(homedir(), ".local/state/pi-herdr-outliner"),
      createHash("sha256").update(resolve(args[wsAt + 1]!.replace(/^~/, homedir()))).digest("hex").slice(0, 12), "outliner.sock")
  : null;
const board = new SocketBoard(wsSocket ?? args.find((a, i) => a.includes("/") && !["--board", "--ws"].includes(args[i - 1] ?? "")) ?? DEFAULT_SOCKET);
if (args[0] === "clients") {
  try { console.log(formatClients(clientRows(await board.request<any[]>("clients.list")))); }
  catch (e) { console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message}`); board.close(); process.exit(1); }
  board.close();
  process.exit(0);
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
process.stdout.on("resize", () => mirror.resize(term.info.cols, term.info.rows));
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
board.subscribe(e => app.event(e));
// No one to ask on a signal: unsaved drafts and comments are copied to disk, then the door quits.
for (const sig of ["SIGTERM", "SIGHUP"] as const) process.on(sig, () => app.terminate());
let control: { close(): void } | null = null;
startControl({ app, mirror, info: () => term.info }).then(c => { control = c; }, () => {});
for (const s of startScreens(args, process.env, then => new Logon(app, then))) app.push(s);
