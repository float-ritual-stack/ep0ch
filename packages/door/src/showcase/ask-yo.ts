// The "ask yo" section (PIE-1585): the yo extension, installed in the showcase's own config with no model (it quotes its
// closest action by its words, and says so), so asking, pressing and undoing run with nothing to pay for.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReaderPane } from "../desk/panes";
import type { Msg } from "../board";
import { SEED } from "./seed/names";
import { installExamples } from "./tickets/install";
import type { deskOf, Section } from "./showcase";

const NOTE = `${SEED.askYo}

Press e, go to the end, write @yo how do I lift the agent again on its own line, and keep typing. Two lines quoted from the action's own doc come back, with a button.

Write @yo do it: yo presses it as yo, the button collapses to a done row, and its undo takes it back whole. Write @yo lift: it answers from the note it just wrote, with no model.

`;

/** The note to ask from, and yo with no model and its memory in this outline. */
export async function seedAskYo(make: (parent: string, text: string) => Promise<Msg>, parent: string, opts: { ticketsConfig?: string; outliner?: string; rulesFrom?: string }): Promise<Msg> {
  const from = opts.outliner ?? opts.rulesFrom;
  if (opts.ticketsConfig && from && installExamples(opts.ticketsConfig, from, ["yo"]).length) {
    writeFileSync(join(opts.ticketsConfig, "pi-herdr-outliner", "extensions", "yo", "config.json"), JSON.stringify({ config: { answer: [], act: [], memory: {} } }));
  }
  return make(parent, NOTE);
}

export function askYoSection(parts: { deskOf: typeof deskOf }): Section {
  return {
    key: "ask-yo", need: "ask how to do an ep0ch thing where you are, get the action's own words and a button, have it pressed as yo and undo it (PIE-1585)",
    part: "the yo extension (extensions/yo): an @name agent in tidy's shape whose reply comes from each ActionDef (`ep0ch actions --all`), with the steps folded; `door.act` (ScriptRuns.doorAct), an agent's process asking the door for one action line, attributed to the agent, its run the undo; the ask from a tile (agent.ask about=, tile.ask in the tile menu, a [keys::hyper+y] script note)",
    files: "outliner/extensions/yo, outliner/src/script-runs.ts (doorAct), src/bar/ask-agent.ts (about), src/desk/tile-actions.ts (tile.ask), src/surface/note.ts (ext.undo run=)",
    aside: "e, then @yo how do I lift the agent again on a line of its own · @yo do it · the done row's undo · @yo lift · ^W . on the tile: ask yo about this · act: agent.ask to=yo about=tile · this copy has no model, so it says it quotes its closest match",
    stage(n, show) {
      const reader = new ReaderPane();
      return parts.deskOf({ title: "showcase · ask yo", panes: [reader], names: ["ask"] }, show, [[reader, n.askYo]]);
    },
  };
}
