// A terminal tile's own actions (PIE-510, A2): the terminal kind's ActionSet, as the tree's tree.* are the tree
// kind's. `act` routes them to tile=<tile> when it's a terminal (a program an extension names is one too), else
// the focused terminal, else the first; the desk's keys (⏎, e, a click, ctrl+]) run the same actions through the
// kind's `press` hook. What they change on the desk (whose keys go where) the desk does.
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { Desk } from "./desk";
import type { DeskApi } from "./panes";
import type { PtyPane } from "./pty";

interface On { pane: PtyPane; desk: DeskApi; tile: string }

/** The desk a terminal tile is on (a screen without terminals has none to route here). */
const host = (desk: DeskApi): Desk => {
  if (!("typeTerminal" in desk)) throw new ActionRefused("this screen has no terminal tiles");
  return desk as Desk;
};

/** The tile menu's group for a terminal's own actions. */
const TERMINAL = "Terminal";

export const PTY_ACTIONS = actionSet<On>()("terminal", {
  "tile.type": def({
    summary: "send text=<text> to the program in terminal tile=<tile>, as typed keys (\\n is ⏎). Refused to an agent for the terminal the person is in",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't type there (an nvim tile's socket edits other lines without their cursor)", says: r => `typed into ${r.tile}`,
    args: { text: { type: "string", about: "what to type; \\n for enter, \\e for escape" } },
    run({ text }, { pane, desk, tile }, actor) {
      return host(desk).typeTerminal(tile, pane, text, actor);
    },
  }),
  "tile.restart": def({
    summary: "run the program in terminal tile=<tile> again (after it exited). Refused to an agent for the terminal the person is in",
    keys: "⏎ on an exited terminal",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't restart it under them (block.mark gets their attention)", says: r => `restarted ${r.tile}`,
    menu: { label: "run it again", group: TERMINAL, key: "enter", now: ({ pane }) => (pane.exited === null ? { hide: true } : null) },
    args: {},
    run(_, { pane, desk, tile }, actor) {
      return host(desk).restartTerminal(tile, pane, actor);
    },
  }),
  "tile.enter": def({
    summary: "type in terminal tile=<tile> (the focused one): every key but ctrl+] goes to its program; one that exited runs again. The person's only: an agent's would take their keys (tile.type sends a program text)",
    keys: "e, ⏎, click in a terminal tile; ctrl+] then ctrl+] sends ctrl+] to it",
    touches: "screen", replay: "safe", person: "typing in a terminal tile takes the person's keys; an agent sends it text with tile.type",
    menu: { label: "type in it", group: TERMINAL, key: "e", now: ({ pane }) => (pane.running ? null : { hide: true }) },
    args: { send: { type: "string", optional: true, about: "bytes to give the program first (a literal ctrl+])" } },
    run({ send }, { pane, desk, tile }) { return host(desk).enterTerminal(tile, pane, send); },
  }),
  "tile.leave": def({
    summary: "back to the door from the terminal tile the person types in (ctrl+] again soon sends one to the program). The person's only",
    keys: "ctrl+]",
    touches: "screen", replay: "safe", person: "the person's keys are theirs: an agent doesn't take them out of a terminal tile",
    args: {},
    run(_, { desk }) { return host(desk).leaveTerminal(); },
  }),
  "terminal.copy": def({
    summary: "copy the text selected in terminal tile=<tile> to the person's clipboard (OSC 52). A drag where the program hasn't asked for the mouse, or shift+drag (alt+drag) where it has, selects, and the release of it copies (copy on select; EP0CH_COPY_ON_SELECT=0 turns that off). The person's only: an agent's copy would be a selection of theirs",
    keys: "the release of a drag in a terminal tile (shift+drag or alt+drag when its program has the mouse)",
    touches: "nothing", replay: "safe", person: "the selection in a terminal tile is the person's, and so is their clipboard",
    args: {},
    run(_, { pane, tile }, actor) {
      if (actor.kind === "agent") throw new ActionRefused(`${tile}'s selection is the person's: read the tile with peek instead`);
      if (!pane.hasSelection) throw new ActionRefused(`nothing is selected in ${tile} · drag across its text`);
      const text = pane.copySelection();
      if (!text) throw new ActionRefused("only blanks are selected");
      return { copied: [...text].length, text, clipboard: true };
    },
  }),
  "tile.herdr": def({
    summary: "terminal tile=<tile> shows an agent that lives in Herdr pane pane=<label> (on=false: it no longer does). Said by scripts/door-agent-herdr.ts, the program in the tile, while it attaches: quitting the door then ends only the attach, not the agent. Cleared when the program exits",
    // Flagged, quitting the door doesn't warn that it ends the program: never set by an agent on the terminal the
    // person types in. Cleared (on=false), the warning comes back: anyone, any time.
    touches: "tile", touchesWith: a => (a.on === false ? "nothing" : "tile"), while: "typing", way: "an agent doesn't flag the terminal they're typing in (quitting would no longer warn that it ends its program)",
    replay: "ask", says: (r, a) => (a.on === false ? `${r.tile} no longer shows an agent in Herdr` : `${r.tile} shows ${a.pane} in Herdr (quitting the door leaves it running)`),
    args: { pane: { type: "string", optional: true, about: "the Herdr pane's label (door-<outline>)" }, name: { type: "string", optional: true, about: "the agent's name in Herdr (door; a test door's door-<hash>)" }, on: { type: "boolean", optional: true, about: "false: the tile no longer shows a Herdr agent" } },
    run({ pane: label, name, on }, { pane, desk, tile }, actor) {
      return host(desk).herdrTerminal(tile, pane, label, on, actor, name);
    },
  }),
});
