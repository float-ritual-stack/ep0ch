#!/usr/bin/env bun
// ep0ch-door: a read-only BBS door into a pi-herdr-outliner outline, over its socket.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { App } from "./app";
import { Logon } from "./screens";
import { DEFAULT_SOCKET, SocketBoard } from "./socket";
import { Term } from "./term";

const STATE = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door", "lastcall.json");

function readLastCall(): number {
  try { return Number(JSON.parse(readFileSync(STATE, "utf8")).at) || 0; } catch { return 0; }
}
function writeLastCall(at: number) {
  try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ at })); } catch { /* not fatal */ }
}

const board = new SocketBoard(process.argv[2] ?? DEFAULT_SOCKET);
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
app.push(new Logon(app));
