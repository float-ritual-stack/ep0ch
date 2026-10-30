// One owner for each decision about the person and the agents (PIE-1294, CONTRIBUTING §5 "A hydra"): who may act
// (`actorRule`, through the dispatcher and `Dispatcher.rule`), whether a reader takes another note (`holdsEdit`,
// ReaderPane.keepsOff, placement()), who a write is recorded as (`recorded` in socket.ts), whether yolo is on
// (App.person's whereabouts), who stands as the person (`standsAsPerson`) and who takes the person's next key (App.person's
// `over`, `keys` and `program`, PIE-1438). This test reads the door's source and
// fails when a file decides one of these itself: a new copy is folded into its owner, or, when it truly is another
// question, it gets a row here with its stance. A count that went down is lowered here too, so the table stays true.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : name.endsWith(".ts") ? [p] : [];
  });
}

/** The code lines of a file: a line that is only a comment is left out (the owners' docs name what they own). */
const codeOf = (text: string) => text.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));

interface Family {
  /** The question, in a few words. */
  question: string;
  /** What deciding it looks like in code. */
  pattern: RegExp;
  /** Each file allowed to, and how often, with why (its stance). Any other file is a new decider. */
  allowed: Record<string, { n: number; why: string }>;
}

const FAMILIES: Family[] = [
  {
    question: "may an agent act here (the actor rule)",
    pattern: /\bactorRule\(/g,
    allowed: {
      "surface/dispatch.ts": { n: 5, why: "the owner: its definition, stepRule() (Dispatcher.rule's), layoutStanding(), checked()'s person-only step and refusal()" },
    },
  },
  {
    question: "a reader keeps its note while it holds an edit or a comment (its words)",
    // (A tile that may not close or be replaced while it holds an edit, screen-layout's, is another question: whether it closes.)
    pattern: /holds an edit|holding an edit|holds \$\{(?:what|sessionName)/g,
    allowed: {
      "whereabouts.ts": { n: 1, why: "the owner: holdsEdit, the one wording" },
      "desk/tile-actions.ts": { n: 1, why: "tile.close's summary says it refuses then; no refusal is worded there" },
    },
  },
  {
    question: "why an agent is held back by the person's typing (its words)",
    // Seen in use Oct 29: four forms ("the person is typing in r1; …", "r1 is where the person is typing; …", "this
    // draft is the person's; …", "…; not moved"). ActionDef summaries saying when one is refused aren't refusals.
    pattern: /is where the person is typing|draft is the person's|; not moved|`the person is typing in \$\{[^`]*`;|an agent doesn't \$\{what\}/g,
    allowed: {
      "whereabouts.ts": { n: 1, why: "the owner: heldBack and typingIn, the one shape" },
    },
  },
  {
    question: "is yolo on (agents hold the door)",
    pattern: /\bagentsYolo\b/g,
    allowed: {
      "app.ts": { n: 5, why: "the owner: the setting, and App.person's whereabouts (yolo) every rule reads" },
      "screens.ts": { n: 2, why: "agents.yolo, the action that turns it on and off" },
    },
  },
  {
    question: "does an invitation cover this (a press's run)",
    pattern: /\bINVITES\.covers\(/g,
    allowed: {
      "surface/dispatch.ts": { n: 2, why: "the owner: actorRule and standsAsPerson" },
      "surface/note.ts": { n: 1, why: "a state rule, not a guard: the property panel would take the keys meant for an agent's session, so only the person's press's run starts one under it (yolo doesn't lift it)" },
      "extensions.ts": { n: 1, why: "carries a live invitation onto the run's actor, deciding nothing" },
    },
  },
  {
    question: "who a new block or comment is recorded as (agent provenance)",
    pattern: /author: "agent"(?: as const)?, provenance/g,
    allowed: {
      "socket.ts": { n: 1, why: "the owner: recorded()" },
      "record-cli.ts": { n: 1, why: "a CLI's named writer (its --actor), not a door actor" },
      "setup/deploy-record.ts": { n: 1, why: "the installer's own fixed writer, ep0ch-install" },
      "showcase/seed.ts": { n: 2, why: "the showcase's made-up agents, seeded as such" },
    },
  },
  {
    question: "run it as a press or as an act (the person's or an agent's way)",
    pattern: /\.act\(.*\) : [\w.()]*\.press\(|\.press\(.*\) : [\w.()]*\.act\(/g,
    allowed: {
      "surface/dispatch.ts": { n: 1, why: "the owner: Dispatcher.as" },
    },
  },
  {
    question: "who stands as the person (their press's run, yolo)",
    pattern: /\bstandsAsPerson\(/g,
    allowed: {
      "surface/dispatch.ts": { n: 4, why: "the owner: its definition, actorRule, layoutStanding and Dispatcher.standing" },
      "surface/note.ts": { n: 4, why: "a reader host's standing for actions it runs outside a dispatcher (links, query, tag): asks the owner" },
      "river/column.ts": { n: 2, why: "asks the owner for the column's own opens" },
      "desk/tree.ts": { n: 2, why: "asks the owner for the tree's opens" },
      "desk/query.ts": { n: 1, why: "asks the owner" },
      "desk/backlinks-pane.ts": { n: 1, why: "asks the owner" },
      "hub/welcome.ts": { n: 1, why: "asks the owner: whether the person's pick empties the preview" },
      "drawer.ts": { n: 1, why: "agent.restart asks the owner who its own typing window holds back" },
    },
  },
  {
    question: "who takes the person's key now: the door's own layer, the drawer, the screen, a program under them (PIE-1438)",
    // Asking a screen, a desk or the drawer whether it has the keys or a program does (`?.rawKeys?.()`, `?.holdsKeys?.()`,
    // `programKeys()`, `rawInput()`), or whether the bar's menu is over the drawer. Before, the raw sink, the router and
    // Esc's hold each asked their own (#1062, #1071 fixed one overlay at a time); now App.person answers and they read it.
    // A new overlay or screen is over a program by being a layer person() reads (a screen pushed, an overlay on a desk),
    // never by a check of its own in the router.
    pattern: /\.(?:rawKeys|holdsKeys)\?\.\(|\.programKeys\(|\.rawInput(?:\?\.)?\(|\boverDrawer\(/g,
    allowed: {
      "app.ts": { n: 11, why: "the owner: keyLayers (person() carries it) and its feeders (overDrawer, programUnder); the raw sink hands bytes to the layer it named (the drawer's or the screen's rawInput); the router's door keys (alt+v, ctrl+n, ^K…) read the top screen's own answer once, after the layer is decided; a gesture's next press (heldAfter)" },
      "whereabouts.ts": { n: 2, why: "screenKeys: a screen without tiles says whether it holds the keys, the answer person() starts from" },
      "desk/desk.ts": { n: 1, why: "programKeys' own walk into the group the person went into" },
      "drawer.ts": { n: 5, why: "the drawer's own key handling inside its layer (its tab's terminal, Esc putting it away when the screen under it isn't using the key, ctrl+]'s second press): person() already gave it the key" },
      "desk/screen-tile.ts": { n: 2, why: "a tile framing a screen asks that screen, inside the desk's own key handling" },
      "desk/lanes.ts": { n: 2, why: "whether to move focus for the person (lanes), not where a key goes" },
      "hub/welcome.ts": { n: 1, why: "whether to move focus for the person (the welcome preview), not where a key goes" },
      "brief/brief.ts": { n: 1, why: "the brief's , and . inside its own key handling, once the desk has the key" },
      "echonet/screen.ts": { n: 1, why: "EchoNet's message keys inside its own key handling, once the desk has the key" },
      "showcase/showcase.ts": { n: 2, why: "the showcase's stage says whether its framed screen holds the keys (its own answer, read by person())" },
    },
  },
  {
    question: "is one of the door's own layers open over everything (the key probe, a status-bar menu over the drawer) (PIE-1438)",
    // The checks #1062 and #1071 added in the router one overlay at a time. They are read in App.keyLayers alone (with
    // the power bar, which too many places open and close to count here); the router branches on its `over`.
    pattern: /\bthis\.probing\b|\boverDrawer\(|\bprogramUnder\(/g,
    allowed: {
      "app.ts": { n: 7, why: "the owner, keyLayers (probing, overDrawer, programUnder) and their definitions; probeKeys sets and toggles it" },
      "term.ts": { n: 9, why: "the terminal's own capability probe at start (Kitty, size, colours), another thing named probing" },
    },
  },
];

describe("one owner for each decision about the person (PIE-1294)", () => {
  const files = sources().map(p => ({ file: relative(SRC, p), code: codeOf(readFileSync(p, "utf8")) }));
  for (const f of FAMILIES) {
    test(`${f.question}: decided only where the table says`, () => {
      const found: Record<string, number> = {};
      for (const { file, code } of files) {
        const n = code.reduce((sum, line) => sum + (line.match(f.pattern)?.length ?? 0), 0);
        if (n) found[file] = n;
      }
      const want = Object.fromEntries(Object.entries(f.allowed).map(([file, a]) => [file, a.n]));
      // A new file here is a second decider: fold it into the owner, or give it a row with its stance.
      expect(found).toEqual(want);
    });
  }

  test("the person's-own refusals are declared, not thrown inline: a ratchet on `actor.kind === \"agent\"` beside a throw", () => {
    // What's left compares state the declaration can't see: the bar's form is a source's row (no ActionDef of its own),
    // the person's lift is another desk's, motion's current mode, the children editor a method outside any def. A new
    // one that says "the person's" is a `person`/`personAlways`/`personWith` on its ActionDef instead (the rest of the
    // agent-only throws ask an agent for an argument a person is asked for interactively: name=, confirm=, where to).
    const inline = /kind === "agent"[^\n]*throw new ActionRefused|throw new ActionRefused\([^\n]*kind === "agent"/;
    const theirs = files.flatMap(({ file, code }) => code.filter(l => inline.test(l) && /person's/.test(l)).map(l => `${file}: ${l.trim().slice(0, 60)}`)).sort();
    expect(theirs).toEqual([
      "bar/ask.ts: if (how.actor.kind === \"agent\") throw new ActionRefused(`the",
      "desk/desk.ts: if (actor.kind === \"agent\" && others.some(d => d.layout.lift",
      "screens.ts: if (actor.kind === \"agent\" && rank[want] > rank[motionMode()",
      "surface/note.ts: if (actor.kind === \"agent\") throw new ActionRefused(\"give te",
    ]);
  });
});
