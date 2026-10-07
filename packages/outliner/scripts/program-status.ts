#!/usr/bin/env bun
// Program status (OSC 7501) from a shell script: scripts/box-test and scripts/agent-env --test say what they're doing
// through this, so a terminal that speaks the protocol (the door, Ghostty, Rex) shows it. The report is outline-core's;
// whether to send it, the emitter's (src/program-status-emit.ts).
//
//   program-status.ts --probe                       exit 0 when this terminal speaks it (then export EP0CH_PROGRAM_STATUS=1
//                                                   so each report after skips asking), 1 when not
//   program-status.ts <state> [--app <name>] [--id <id>] [--kind permission|question|auth] [--progress <0-100>]
//                     [--title <text>] [<msg>…]     one report; nothing at all where the terminal doesn't speak it
//
// <state> is idle, working, done, blocked, error or clear. The exit code is 0 whether or not a report went: a status
// line never fails the script around it (a wrong argument exits 2).
import { BLOCKED_KINDS, PROGRAM_STATES, type BlockedKind, type StatusInput } from "@ep0ch/outline-core/program-status";
import { programStatusEmitter } from "../src/program-status-emit";

const args = process.argv.slice(2);
const usage = () => { console.error("program-status.ts --probe | <idle|working|done|blocked|error|clear> [--app name] [--id id] [--kind k] [--progress n] [--title text] [msg…]"); process.exit(2); };

if (args[0] === "--probe") {
  const e = await programStatusEmitter("probe");
  process.exit(e.on ? 0 : 1);
}
const state = args.shift();
if (!state || (state !== "clear" && !(PROGRAM_STATES as readonly string[]).includes(state))) usage();
const r: StatusInput = { state: state as StatusInput["state"] };
let app = "script";
const msg: string[] = [];
while (args.length) {
  const a = args.shift()!;
  const v = () => args.shift() ?? usage()!;
  if (a === "--app") app = v();
  else if (a === "--id") r.id = v();
  else if (a === "--title") r.title = v();
  else if (a === "--kind") { const k = v(); if (!(BLOCKED_KINDS as readonly string[]).includes(k)) usage(); r.kind = k as BlockedKind; }
  else if (a === "--progress") { const n = Number(v()); if (!Number.isInteger(n) || n < 0 || n > 100) usage(); r.progress = n; }
  else msg.push(a);
}
if (msg.length) r.msg = msg.join(" ");
try { (await programStatusEmitter(app)).report(r); } catch (e) { if (/program status id/.test(String(e))) usage(); }
