#!/usr/bin/env bun
// Which outline, on which host: the one rule every client opens by (the door's resolveTarget: `--ws`, then EP0CH_WS,
// then the nearest `.ep0ch`; `--machine`, EP0CH_MACHINE or that `.ep0ch` for another machine's host, through its
// forward). The native app runs this once at launch and then speaks the socket itself; it decides nothing here.
//
// `control` is where the window serves its control socket: the native door's own (the door's `DOORS`, cli-words.ts) in
// the outline's session folder, beside the terminal door's (the door's `placeFor`), so `--door native` finds it.
//
//   bun resolve.ts [--ws <name>] [--machine <ssh-name>]   →  {"socket": "…", "outline": "…", "machine": "…", "control": "…"} or {"error": "…"}
//                                                             (`machine`: the ssh name of the machine it is on, "" for this one)
//   bun resolve.ts --to <name> [<ssh-name>]                →  the same, for an outline a window switches to: named
//                                                             outright (the service listed it), so the folder's
//                                                             `.ep0ch` and EP0CH_WS say nothing here
import { join } from "node:path";
import { DOORS } from "@ep0ch/door/src/cli-words";
import { resolveTarget } from "@ep0ch/door/src/discover";
import { forwardTo } from "@ep0ch/door/src/machine";
import { placeFor } from "@ep0ch/door/src/session/place";

const args = process.argv.slice(2);
const to = args.indexOf("--to");
const named = to >= 0 ? ["--ws", args[to + 1]!, ...(args[to + 2] ? ["--machine", args[to + 2]!] : [])]
  : ["--ws", "--machine"].flatMap(flag => { const at = args.indexOf(flag); return at >= 0 ? [flag, args[at + 1]!] : []; });
const target = resolveTarget(named);
const say = (o: unknown) => console.log(JSON.stringify(o));
if ("error" in target) say({ error: target.error });
else if ("unnamed" in target) say({ error: `no outline is named here (${target.unnamed}); pass --ws <name>` });
else {
  try {
    if (target.machine) await forwardTo(target.machine);
    const place = placeFor(named);
    say({ socket: target.path, outline: target.outline, machine: target.machine ?? "", ...(place && !("error" in place) ? { control: join(place.dir, DOORS.native!) } : {}) });
  } catch (e) { say({ error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }); }
}
