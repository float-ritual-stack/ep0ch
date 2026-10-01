// A terminal tile's own actions (PIE-510, A2): the terminal kind's ActionSet, as the tree's tree.* are the tree
// kind's. `act` routes them to tile=<tile> when it's a terminal (a program an extension names is one too), else
// the focused terminal, else the first; the desk's keys (⏎, e, a click, ctrl+]) run the same actions through the
// kind's `press` hook. What they change on the desk (whose keys go where) the desk does, through TerminalHost.
import type { Actor } from "../socket";
import { ActionRefused, ActionSet, agentLabel } from "../surface/actions";
import type { DeskApi } from "./panes";
import type { PtyPane } from "./pty";
import type { TileDone } from "./tile-actions";

/** What a terminal's actions need from the desk: the person's keys go into a terminal and back out. */
export interface TerminalHost {
  typeTerminal(tile: string, p: PtyPane, text: string, actor: Actor): TileDone;
  restartTerminal(tile: string, p: PtyPane, actor: Actor): TileDone;
  enterTerminal(tile: string, p: PtyPane, send: string | undefined, actor: Actor): TileDone;
  leaveTerminal(actor: Actor): TileDone;
  herdrTerminal(tile: string, p: PtyPane, pane: string | undefined, on: boolean | undefined, actor: Actor): TileDone;
}
interface On { pane: PtyPane; desk: DeskApi; tile: string }

/** The desk a terminal tile is on, as a TerminalHost (every desk is one; a screen without terminals has none to route here). */
const host = (desk: DeskApi): TerminalHost & DeskApi => {
  if (!("typeTerminal" in desk)) throw new ActionRefused("this screen has no terminal tiles");
  return desk as TerminalHost & DeskApi;
};
/** An agent's change, said on screen with who made it (the person's own they see happen), as TILE_ACTIONS says theirs. */
const say = (desk: DeskApi, actor: Actor, what: string) => { if (actor.kind === "agent") desk.ctx.flash(`${agentLabel(actor)} ${what}`); };

export const PTY_ACTIONS = new ActionSet<{
  "tile.type": { text: string };
  "tile.restart": Record<string, never>;
  "tile.enter": { send?: string };
  "tile.leave": Record<string, never>;
  "tile.herdr": { pane?: string; on?: boolean };
}, On>("terminal", {
  "tile.type": {
    summary: "send text=<text> to the program in terminal tile=<tile>, as typed keys (\\n is ⏎). Refused to an agent for the terminal the person is in",
    args: { text: { type: "string", about: "what to type; \\n for enter, \\e for escape" } },
    run({ text }, { pane, desk, tile }, actor) {
      const r = host(desk).typeTerminal(tile, pane, text, actor);
      say(desk, actor, `typed into ${r.tile}`);
      return r;
    },
  },
  "tile.restart": {
    summary: "run the program in terminal tile=<tile> again (after it exited)",
    keys: "⏎ on an exited terminal",
    args: {},
    run(_, { pane, desk, tile }, actor) {
      const r = host(desk).restartTerminal(tile, pane, actor);
      say(desk, actor, `restarted ${r.tile}`);
      return r;
    },
  },
  "tile.enter": {
    summary: "type in terminal tile=<tile> (the focused one): every key but ctrl+] goes to its program; one that exited runs again. The person's only: an agent's would take their keys (tile.type sends a program text)",
    keys: "e, ⏎, click in a terminal tile; ctrl+] then ctrl+] sends ctrl+] to it",
    args: { send: { type: "string", optional: true, about: "bytes to give the program first (a literal ctrl+])" } },
    run({ send }, { pane, desk, tile }, actor) { return host(desk).enterTerminal(tile, pane, send, actor); },
  },
  "tile.leave": {
    summary: "back to the door from the terminal tile the person types in (ctrl+] again soon sends one to the program). The person's only",
    keys: "ctrl+]",
    args: {},
    run(_, { desk }, actor) { return host(desk).leaveTerminal(actor); },
  },
  "tile.herdr": {
    summary: "terminal tile=<tile> shows an agent that lives in Herdr pane pane=<label> (on=false: it no longer does). Said by scripts/door-agent-herdr.ts, the program in the tile, while it attaches: quitting the door then ends only the attach, not the agent. Cleared when the program exits",
    args: { pane: { type: "string", optional: true, about: "the Herdr pane's label (door-claude)" }, on: { type: "boolean", optional: true, about: "false: the tile no longer shows a Herdr agent" } },
    run({ pane: label, on }, { pane, desk, tile }, actor) {
      const r = host(desk).herdrTerminal(tile, pane, label, on, actor);
      say(desk, actor, on === false ? `${r.tile} no longer shows an agent in Herdr` : `${r.tile} shows ${label} in Herdr (quitting the door leaves it running)`);
      return r;
    },
  },
});
