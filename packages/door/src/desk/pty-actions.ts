// A terminal tile's own actions (PIE-510, A2): the terminal kind's ActionSet, as the tree's tree.* are the tree
// kind's. `act` routes them to tile=<tile> when it's a terminal (a program an extension names is one too), else
// the focused terminal, else the first; the desk's keys (⏎, e, a click, ctrl+]) run the same actions through the
// kind's `press` hook. What they change on the desk (whose keys go where) the desk does.
import { shellQuote } from "./drawer-program";
import { NAMED_AGENT_KEYS } from "./named-agent-pane";
import { modeActionKeys } from "../surface/modes";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { Desk } from "./desk";
import type { DeskApi } from "./panes";
import { RESTART_IDLE_MS, type PtyPane } from "./pty";
import { runsUnder } from "./agent-sessions";
import type { Actor } from "../socket";

interface On { pane: PtyPane; desk: DeskApi; tile: string }

/** The desk a terminal tile is on (a screen without terminals has none to route here). */
const host = (desk: DeskApi): Desk => {
  if (!("typeTerminal" in desk)) throw new ActionRefused("this screen has no terminal tiles");
  return desk as Desk;
};

/**
 * `tile.restart` (PIE-1280): run the program in terminal tile `name` again. One that exited starts at once. One that
 * runs is ended gently and started again in the same tile (`PtyPane.restartRunning`: /exit for a Claude between turns),
 * its conversation kept. An agent's is refused while the person typed in it lately, and while its Claude is mid-turn
 * or on a dialog unless `now` (then said: what it dropped); `pid`: refused unless that process runs in this tile
 * (`ep0ch agent restart` names the Claude it found). The person's press is theirs: it never waits.
 */
function restartTerminal(d: Desk, name: string, p: PtyPane, actor: Actor, o: { now?: boolean; pid?: number }) {
  return d.restartAnswer(name, async () => {
    if (o.pid !== undefined && !(p.running && runsUnder(p.pid, o.pid))) throw new ActionRefused(`pid ${o.pid} doesn't run in ${name} (its program is ${p.pid ?? "not running"}) · host.tileOf pid=${o.pid} finds its tile`);
    if (!p.running) { p.restart(); return { restarted: true, ended: "exited" }; }
    if (!d.dispatch.standing(actor)) {
      const idle = Date.now() - p.personKeyAt;
      if (idle < RESTART_IDLE_MS) throw new ActionRefused(`the person typed into ${name} ${(idle / 1000).toFixed(1)}s ago; try again once they've left it ${RESTART_IDLE_MS / 1000}s`);
      const c = p.claude(), what = c?.status === "busy" ? ["mid-turn", "the turn"] : c?.status === "waiting" ? ["on a dialog", "the dialog"] : ["saying nothing of what it does", "whatever it was doing"];
      if (c && c.status !== "idle" && !o.now) throw new ActionRefused(`${name}'s Claude is ${what[0]} · try again between turns, or now=true ends it anyway (it drops ${what[1]})`);
    }
    d.ctx.flash(`restarting ${p.statusName()}${p.claude() ? " · the conversation is kept" : ""}`, 6000);
    const r = await p.restartRunning();
    // Never said as done when it isn't: the tile shows what it printed instead.
    if (r.back === false) throw new ActionRefused(`claude didn't come back in ${name}: ${p.text().map(l => l.trim()).filter(Boolean).slice(-2).join(" · ") || "its tile is empty"} · its tile is a shell now; claude --continue there starts it by hand`);
    return { restarted: true, ...r };
  });
}

/** The tile menu's group for a terminal's own actions. */
const TERMINAL = "Terminal";

export const PTY_ACTIONS = actionSet<On>()("terminal", {
  "named.start": def({
    words: "start the named agent", summary: "Start the named hc terminal through ep0ch agent start, then attach this tile. A live terminal is reused.",
    keys: modeActionKeys([NAMED_AGENT_KEYS], "named.start"), touches: "tile", while: "typing", replay: "ask", says: r => `started ${r.persona}`,
    args: {},
    async run(_, { pane }) { if (!pane.named) throw new ActionRefused("this tile has no named agent"); return pane.named.launch(); },
  }),
  "named.attach": def({
    words: "look for the named agent again", summary: "Read hc ls and attach the named terminal if it runs; never start it.",
    keys: modeActionKeys([NAMED_AGENT_KEYS], "named.attach"), touches: "tile", while: "typing", replay: "safe", args: {},
    async run(_, { pane }) { if (!pane.named) throw new ActionRefused("this tile has no named agent"); await pane.named.refresh(); return pane.named.describe(); },
  }),
  "named.shell": def({
    words: "a shell here", summary: "Open your login shell beside the named agent's card.",
    keys: modeActionKeys([NAMED_AGENT_KEYS], "named.shell"), touches: "shape", replay: "ask", args: {},
    async run(_, { desk, tile }, actor) {
      const done = await host(desk).openTile({ kind: "pty", cmd: `${shellQuote(process.env.SHELL || "/bin/sh")} -l`, cwd: process.cwd() }, tile, "tabs", actor);
      if (actor.kind !== "agent") await desk.perform?.("tile.enter", {}, actor, done.tile);
      return done;
    },
  }),
  "tile.type": def({
    words: "send text to the terminal's program, as typed keys",
    summary: "send text=<text> to the program in terminal tile=<tile>, as typed keys (\\n is ⏎). Refused to an agent for the terminal the person is in",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't type there · an nvim tile's socket edits other lines without their cursor", says: r => `typed into ${r.tile}`,
    args: { text: { type: "string", about: "what to type; \\n for enter, \\e for escape" } },
    examples: [
      { act: "tile.type tile=draft text=\"ls -la\\n\"", does: "types ls -la and enter into the program in the draft terminal" },
      { act: "tile.type tile=draft text=\"\\e:w\\n\"", does: "sends escape, :w and enter: an editor there saves its file" },
    ],
    run({ text }, { pane, desk, tile }, actor) {
      return host(desk).typeTerminal(tile, pane, text, actor);
    },
  }),
  "tile.restart": def({
    words: "restart the terminal's program",
    summary: "run the program in terminal tile=<tile> again: one that exited starts at once; one that runs is ended gently (a Claude between turns is sent /exit, anything else SIGTERM, SIGKILL after 8s) and the same command starts in the same tile, an agent inside an interactive login shell (a changed ~/.bashrc counts) with its conversation kept (a bare claude gets --continue). An agent's is refused for the terminal the person is in or typed in lately, and while its Claude is mid-turn or on a dialog unless now=true (the answer says what it dropped). ep0ch agent restart <name> finds a Claude's tile and runs this",
    keys: [{ keys: "enter", does: "on an exited terminal: run it again" }, { keys: "ctrl+w R", does: "restart the focused terminal's program while it runs" }, { via: "the tile menu's restart its program" }],
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't restart it under them · block.mark gets their attention",
    says: (r: { tile?: string; name?: string; dropped?: string; ended?: string }) => `restarted ${r.name ?? r.tile}${r.ended === "exit" ? " (it was sent /exit)" : ""}${r.dropped ? ` · dropped ${r.dropped}` : ""}`,
    menu: [
      { label: "run it again", group: TERMINAL, key: "enter", now: ({ pane }) => (pane.exited === null ? { hide: true } : null) },
      { label: "restart its program", group: TERMINAL, key: "R", now: ({ pane }) => (pane.running ? null : { hide: true }) },
    ],
    args: {
      now: { type: "boolean", optional: true, about: "an agent's restart of a Claude mid-turn or on a dialog goes anyway, dropping the turn (SIGTERM)" },
      pid: { type: "number", optional: true, about: "refused unless this process runs in the tile (the Claude ep0ch agent restart found)" },
    },
    examples: [
      { act: "tile.restart tile=kitty", does: "sends the Claude in the kitty tile /exit between turns, then starts claude --continue there from a fresh login shell" },
      { act: "tile.restart tile=kitty now=true", does: "the same mid-turn: SIGTERM, dropping the turn, and says so" },
    ],
    run({ now, pid }, { pane, desk, tile }, actor) {
      return restartTerminal(host(desk), tile, pane, actor, { ...(now !== undefined ? { now } : {}), ...(pid !== undefined ? { pid } : {}) });
    },
  }),
  "tile.enter": def({
    words: "type in the terminal tile",
    summary: "type in terminal tile=<tile> (the focused one): every key but ctrl+] goes to its program; one that exited runs again. The person's only: an agent's would take their keys (tile.type sends a program text)",
    keys: "e, ⏎, click in a terminal tile; ctrl+] then ctrl+] sends ctrl+] to it",
    touches: "screen", replay: "safe", person: "typing in a terminal tile takes the person's keys; an agent sends it text with tile.type",
    menu: { label: "type in it", group: TERMINAL, key: "e", now: ({ pane }) => (pane.running ? null : { hide: true }) },
    args: { send: { type: "string", optional: true, about: "bytes to give the program first (a literal ctrl+])" } },
    examples: [
      { act: "tile.enter tile=draft", does: "the person's keys go to the draft terminal's program until ctrl+]" },
    ],
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
    words: "copy the text selected in the terminal",
    summary: "copy the text selected in terminal tile=<tile> to the person's clipboard (OSC 52). A drag where the program hasn't asked for the mouse, or shift+drag (alt+drag) where it has, selects, and the release of it copies (copy on select; EP0CH_COPY_ON_SELECT=0 turns that off). The person's only: an agent's copy would be a selection of theirs",
    keys: [{ keys: "drag", does: "the release of a drag in a terminal tile" }, { keys: "shift-drag alt-drag", does: "the same when its program has the mouse" }],
    touches: "nothing", replay: "safe", person: "the selection in a terminal tile is the person's, and so is their clipboard",
    args: {},
    run(_, { pane, tile }, _actor) {
      if (!pane.hasSelection) throw new ActionRefused(`nothing is selected in ${tile} · drag across its text`);
      const text = pane.copySelection();
      if (!text) throw new ActionRefused("only blanks are selected");
      return { copied: [...text].length, text, clipboard: true };
    },
  }),
  "terminal.clip": def({
    words: "copy what the terminal's program copied",
    summary: "the program in terminal tile=<tile> copied text=<text> (PIE-797): passed on to the person's clipboard as its own OSC 52 would be, if they typed or clicked in the tile in the last 2 min, with the \"copied from <tile>\" toast. It comes over the control socket like any program's request, so the rule is the tile's: nothing reaches the clipboard unless the person used that tile lately",
    touches: "nothing", replay: "safe",
    args: { text: { type: "string", about: "what the program copied" } },
    examples: [
      { act: "terminal.clip tile=draft text=\"seed order: 12 packets\"", does: "passes the program's copy on to the person's clipboard, with a toast" },
    ],
    run({ text }, { pane, tile }) {
      if (!text) throw new ActionRefused("nothing to copy");
      pane.programCopied(text);
      return { tile, copied: [...text].length };
    },
  }),
});
