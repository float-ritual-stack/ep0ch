#!/usr/bin/env bun
// ep0ch-door: a read-only BBS door into a pi-herdr-outliner outline, over its socket.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { dirname, join } from "node:path";
import { App } from "./app";
import { Desk } from "./desk/desk";
import { River } from "./river/river";
import { DeliveryBoard } from "./desk/delivery";
import { Logon, MainMenu } from "./screens";
import { DEFAULT_SOCKET, SocketBoard } from "./socket";
import { Term } from "./term";

const STATE = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door", "lastcall.json");

function readLastCall(): number {
  try { return Number(JSON.parse(readFileSync(STATE, "utf8")).at) || 0; } catch { return 0; }
}
function writeLastCall(at: number) {
  try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ at })); } catch { /* not fatal */ }
}

const args = process.argv.slice(2);
const deskFirst = args.includes("--desk");
const riverFirst = args.includes("--river");
const boardAt = args.indexOf("--board");
// --ws <workspace root>: the outliner keeps each workspace's socket at state/<sha256(root)[0:12]>/outliner.sock.
const wsAt = args.indexOf("--ws");
const wsSocket = wsAt >= 0 && args[wsAt + 1]
  ? join(process.env.OUTLINER_STATE_DIR ?? join(homedir(), ".local/state/pi-herdr-outliner"),
      createHash("sha256").update(resolve(args[wsAt + 1]!.replace(/^~/, homedir()))).digest("hex").slice(0, 12), "outliner.sock")
  : null;
const board = new SocketBoard(wsSocket ?? args.find((a, i) => a.includes("/") && !["--board", "--ws"].includes(args[i - 1] ?? "")) ?? DEFAULT_SOCKET);
let info;
try { info = await board.info(); }
catch (e) {
  console.error(`ep0ch: no carrier on ${board.path}\n  ${(e as Error).message}`);
  board.close();
  process.exit(1);
}

const term = new Term();
await term.start();
const lastCall = readLastCall();
const loggedOnAt = Date.now();
const app = new App(term, board, lastCall, () => {
  term.stop();
  board.close();
  writeLastCall(loggedOnAt);
  process.exit(0);
});
app.host = info.host;
app.workspace = info.workspace;
board.subscribe(e => app.event(e));
process.on("SIGTERM", () => app.quit());
if (boardAt >= 0) { app.push(new MainMenu()); app.push(new DeliveryBoard(args[boardAt + 1]?.startsWith("--") ? undefined : args[boardAt + 1])); }
else if (riverFirst) { app.push(new MainMenu()); app.push(new River()); }
else if (deskFirst) { app.push(new MainMenu()); app.push(new Desk()); }
else app.push(new Logon(app));
