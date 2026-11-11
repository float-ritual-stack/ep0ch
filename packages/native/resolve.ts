#!/usr/bin/env bun
// Which outline, on which host: the one rule every client opens by (the door's resolveTarget: `--ws`, then EP0CH_WS,
// then the nearest `.ep0ch`; `--machine`, EP0CH_MACHINE or that `.ep0ch` for another machine's host, through its
// forward). The native app runs this once at launch and then speaks the socket itself; it decides nothing here.
//
//   bun resolve.ts [--ws <name>] [--machine <ssh-name>]   →  {"socket": "…", "outline": "…"} or {"error": "…"}
import { resolveTarget } from "@ep0ch/door/src/discover";
import { forwardTo } from "@ep0ch/door/src/machine";

const args = process.argv.slice(2);
const named = ["--ws", "--machine"].flatMap(flag => { const at = args.indexOf(flag); return at >= 0 ? [flag, args[at + 1]!] : []; });
const target = resolveTarget(named);
const say = (o: unknown) => console.log(JSON.stringify(o));
if ("error" in target) say({ error: target.error });
else if ("unnamed" in target) say({ error: `no outline is named here (${target.unnamed}); pass --ws <name>` });
else {
  try {
    if (target.machine) await forwardTo(target.machine);
    say({ socket: target.path, outline: target.outline });
  } catch (e) { say({ error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }); }
}
