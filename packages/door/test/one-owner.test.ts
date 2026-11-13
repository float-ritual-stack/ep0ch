// One owner for each decision about the person and the agents (PIE-1294, CONTRIBUTING §5 "A hydra"): who may act
// (`actorRule`, through the dispatcher and `Dispatcher.rule`), whether a reader takes another note (`holdsEdit`,
// ReaderPane.keepsOff, placement()), who a write is recorded as (`recorded` in socket.ts), whether yolo is on
// (App.person's whereabouts), who stands as the person (`standsAsPerson`) and who takes the person's next key (App.person's
// `over`, `keys` and `program`, PIE-1438). This test reads the door's source and
// fails when a file decides one of these itself: a new copy is folded into its owner, or, when it truly is another
// question, it gets a row here with its stance. A count that went down is lowered here too, so the table stays true.
// The layout's own decisions (whether it changes, where an open lands, which tile an address means, what a screen's
// spec is) have their table below, LAYOUT_FAMILIES: where they are decided today, pinned as native starts answering them too.
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
    question: "what the notes under a note are (a comment on it and an edit proposed beside it are none)",
    // outline-core's isNoteUnder is the one answer, the service's lists and pages ask it too (its tree, a page's own
    // list, CHILDREN_QUERY). A list of a note's children filtered by another reading lists a block the others leave out.
    pattern: /\bisNoteUnder\(|\.filter\(\w+ => !is(?:AnnotationBlock|MarkType)\(/g,
    allowed: {
      "links.ts": { n: 1, why: "readChildren: the links tile's Children, by the one answer" },
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
    question: "what an answer says a write was recorded as (PIE-1406: recordedAs, one shape)",
    // Every writing action answers `recordedAs: recordedAnswer(actor, made)`, typed RecordedAs. A `recordedAs:` built any
    // other way (the mutation object, the words alone) is a second shape an agent would have to branch on.
    pattern: /\brecordedAs\??: (?!recordedAnswer\(|RecordedAs\b)/g,
    allowed: {
      "socket.ts": { n: 1, why: "the owner: RECORDED_AS, the field as every writing action's answer describes it" },
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
    pattern: /\.(?:rawKeys|holdsKeys)\?\.\(|\.programKeys\(|\.rawInput(?:\?\.)?\(|\boverDrawer\(|\.rawKeys\(\)|\bkeysScreen\(/g,
    allowed: {
      "app.ts": { n: 17, why: "the owner: keyLayers (person() carries it) and its feeders (overDrawer, programUnder); the raw sink hands bytes to the layer it named (the drawer's or the screen's rawInput); the router's door keys (alt+v, ctrl+n, ^K…) read the top screen's own answer once, after the layer is decided; a gesture's next press (heldAfter); keysScreen, the screen whose strips and menus the keys are on" },
      "whereabouts.ts": { n: 2, why: "screenKeys: a screen without tiles says whether it holds the keys, the answer person() starts from" },
      "desk/desk.ts": { n: 13, why: "programKeys' own walk into the group the person went into, and rawKeys, the desk's own answer the rest read (its keys, hint row, overlays, chordWay)" },
      "drawer.ts": { n: 5, why: "the drawer's own key handling inside its layer (its tab's terminal; alt+Q and the bar key pass a terminal tile's program its key, PIE-1718): person() already gave it the key" },
      "esc-door.ts": { n: 2, why: "the two asks that were the drawer's Esc (whether the screen under it is using the key), moved with it: the App's own Esc steps, for a screen that isn't a desk and the person's binding for Esc; which layer has the key is still keyLayers'" },
      "desk/desk-esc.ts": { n: 1, why: "the desk's own answer (rawKeys, as desk/desk.ts's row): its Esc step for a program says only that the program has the key" },
      "desk/screen-tile.ts": { n: 2, why: "a tile framing a screen asks that screen, inside the desk's own key handling" },
      "bar/sources.ts": { n: 3, why: "keysScreen: the desk whose menu and ^W keys the power bar lists, asked of the App; not where a key goes" },
      "desk/lanes.ts": { n: 2, why: "whether to move focus for the person (lanes), not where a key goes" },
      "hub/welcome.ts": { n: 1, why: "whether to move focus for the person (the welcome preview), not where a key goes" },
      "brief/brief.ts": { n: 1, why: "the brief's , and . inside its own key handling, once the desk has the key" },
      "echonet/screen.ts": { n: 1, why: "EchoNet's message keys inside its own key handling, once the desk has the key" },
      "showcase/showcase.ts": { n: 2, why: "the showcase's stage says whether its framed screen holds the keys (its own answer, read by person())" },
    },
  },
  {
    question: "who has the person's keys now: what moves them (PIE-1592, the keys fact)",
    // Every write of the keys fact (desk/keys-fact.ts), and the two things that aren't in it because the layout answers them:
    // the host layer's focus commits and a desk's own focus. A new place that moves the keys is named here, with why.
    pattern: /\b(?:keysFact|doorKeys)\.(?:hostAt|intoLift|intoGlass|outOfGlass|wantIn|typeIn|stopTyping|leftProgram|leftDrawer|passedOn|chordSpent)\(|this\.do\(\{ op: "focus"|\bthis\.focus = /g,
    allowed: {
      "desk/desk.ts": { n: 21, why: "where a tile opens, closes, is carried, entered or left: typeIn, stopTyping, leftProgram; focus from the layout's answer (commit, build), an emptied desk and a program started for the person" },
      "showcase/showcase.ts": { n: 7, why: "another focus: which section the showcase's stage shows" },
      "surface/note-form.ts": { n: 2, why: "another focus: which field a form has" },
      "drawer.ts": { n: 38, why: "the host layer's own moves: into the drawer, a lift or the glass, out of them, its focus commits (keysInto and the quiet ones the lift and glass need)" },
    },
  },
  {
    question: "what ctrl+] does now: steps out one mode at a time (PIE-1592)",
    // The one rule is deskWay and wayOut in desk/keys-fact.ts. term.ts only turns the byte into a key (the Kitty protocol is
    // one module, kbd.ts); nothing else decides. Asking `chordWay` or `isEscapeChord` elsewhere is a second decider.
    pattern: /\bisEscapeChord\(|\.chordWay\(|\bdeskWay\(|\bwayOut\(/g,
    allowed: {
      "desk/keys-fact.ts": { n: 2, why: "the owner: the rule" },
      "desk/desk.ts": { n: 4, why: "a desk's own answer (chordWay), and applying it in keyIn" },
      "desk/screen-tile.ts": { n: 2, why: "applying it: out of the group when nothing inside takes the chord" },
      "drawer.ts": { n: 8, why: "the door's answer over the layers (wayOut), and applying it" },
      "app.ts": { n: 1, why: "person() reads it" },
    },
  },
  {
    question: "is this a step, and what takes it back (PIE-1592, the step record)",
    // desk/step-record.ts answers these; Desk.commit asks `decide` once. A second place that keeps a pulled-up drawer's carry,
    // a replay flag, or its own scope for "whose step" is a hydra.
    pattern: /\.decide\(|\.takeBack\(|\.undoDesk\(|\.newestDesk\(|\.pulledDrawer\(|\.pullBack\(|\bsteps\.putBack\(/g,
    allowed: {
      "desk/desk.ts": { n: 8, why: "commit asks decide; undo asks takeBack, undoDesk, newestDesk and wraps a put-back; and layoutNewestSeq reads newestDesk for a press's undo (PIE-1678)" },
      "drawer.ts": { n: 2, why: "the carry that pulled it up, and its undo" },
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
  {
    question: "where an open lands (PIE-1522: placement() answers one request; the desk applies its destination)",
    // Asking placement, or deciding ahead of it: the drawer's hand-off to the screen shown (`openOnScreen`, a kind that
    // opens out), what an open naming no tile asks for. Before, openNote, openFromTile, openFrom, openOnLink, openFresh,
    // openLanding and the drawer's openOnScreen each routed first (#1215: an open landed on a screen behind).
    pattern: /(?:[=(:]|return|\.\.\.)\s*placement\(|\.openOnScreen\(|\.opensOnScreen\b|\bopensInto!/g,
    allowed: {
      "desk/screen-layout.ts": { n: 9, why: "the owner: placement() and its own recursion (a container's, a pinned reader's, a busy one's), and apply()'s open" },
      "desk/desk.ts": { n: 7, why: "applies it (placeOpen); asks it to inspect (placeFrom, openLandingReader, a hover's route, a mount's inside()); the request builders (landingRequest, openBy) name the screen's container; facts() says a kind opens out" },
      // drawer.ts has none: its openOnScreen is the screen shown's openBy, and its lists' opens are placement's hand-off.
      "app.ts": { n: 1, why: "the status bar's open: the screen shown's open naming no tile (Desk.openBy), deciding nothing" },
    },
  },
];

/**
 * The layout's decisions, as they stand today (native W0): whether a layout changes, where an open lands, which tile an
 * address means and what a screen's spec is. Native's Rust `apply` and `place` answer the same questions beside these, by
 * language; both are held to the contract tables (packages/outline-core/fixtures, test/layout-contract.test.ts), and this
 * table says where the door asks each one, so a new place that decides is seen here first.
 */
const LAYOUT_FAMILIES: Family[] = [
  {
    question: "whether a layout changes: one operation applied for one actor, the new state or a refusal (screen-layout's apply)",
    // Every change to a screen's layout is asked of apply(): the desk's (Desk.ask, taken by commit), the host layer's
    // (Drawer.do) and a carry's two halves. Nothing else holds a tree it changes.
    pattern: /(?<![.\w])apply(?:Op|Layout)?\(/g,
    allowed: {
      "desk/desk.ts": { n: 2, why: "the desk's one ask of the layout module (Desk.ask), and Desk.apply, which is ask then commit" },
      "drawer.ts": { n: 1, why: "the host layer's one ask (Drawer.do): the drawer's own layout, the same operations" },
      "desk/carry.ts": { n: 2, why: "one carry between two layouts: a take asked of the one a tile leaves, an open of the one it lands in; the desks only apply the answers" },
    },
  },
  {
    question: "whether an operation would be refused, asked without applying it (screen-layout's refusal)",
    pattern: /(?<![.\w])refusal\((?:this\.layout|s),/g,
    allowed: {
      "desk/desk.ts": { n: 15, why: "what a tile's frame, a menu row or a drag's ghost says before the press: the operation itself is asked, never a copy of its rule" },
    },
  },
  {
    question: "how a layout's state is made (screen-layout's init): from a tree as given, never built by hand",
    pattern: /(?<![.\w])init\(\{|\bhostLayer\(\{/g,
    allowed: {
      "desk/desk.ts": { n: 3, why: "a desk's first state, its state as a session comes back, and Desk.build: a spec, a saved layout or an undo laid out" },
      "desk/screen-layout.ts": { n: 1, why: "hostLayer: the drawer's layout, made by the module itself" },
      "drawer.ts": { n: 1, why: "the host layer asks for its layout (hostLayer)" },
    },
  },
  {
    question: "which route an open takes before it is placed: its wire, its container's opens-into, its home, the open rule; and which side a tile beside another goes",
    // landing() and besideAttempt()/besideOrder() (desk/landing.ts) are asked by the layout module alone: placement() for a
    // note, apply()'s open for a tile beside another. The desk asks placement(), never these.
    pattern: /(?<![.\w])landing\(s,|\bbesideAttempt\(s,|\bbesideOrder\(b,/g,
    allowed: {
      "desk/landing.ts": { n: 3, why: "the owner: an alt-open reads the open's own route; besideAttempt weighs besideOrder's places; closeHeir asks where the closed reader's opens land" },
      "desk/screen-layout.ts": { n: 3, why: "placement() asks the route (and whether a fresh open has one); apply()'s open beside a tile asks besideAttempt" },
    },
  },
  {
    question: "which tile an address means (`tile=`: an id, a role, a slot, ^): outline-core's one grammar and resolver",
    pattern: /\b(?:parseTileAddress|resolveAddress|resolveRelative)\(/g,
    allowed: {
      "desk/desk.ts": { n: 5, why: "the desk lists the tiles it has and asks which one an address means (tileBy, a slot it keeps, the acting tile's opener)" },
      "drawer.ts": { n: 4, why: "the same question over every desk on show: the drawer's, the screen's, a mount's" },
      "surface/dispatch.ts": { n: 1, why: "the dispatcher reads a request's tile= once, to know whether it names a tile elsewhere" },
      "surface/note.ts": { n: 1, why: "a reader's press names its own tile by id: it asks whether a tile= is one" },
    },
  },
  {
    question: "what a screen's spec is: read back through the one validator (outline-core's readSpec)",
    pattern: /\breadSpec(?:Data)?\(/g,
    allowed: {
      "desk/screen-spec.ts": { n: 2, why: "the door's readSpec: outline-core's, told which tile kinds this door has" },
      "desk/screen-notes.ts": { n: 1, why: "a registered spec as each open copies it (a screen note's text is the service's to read: screens.list)" },
      "extensions.ts": { n: 2, why: "an extension's screens[], checked as a note's is" },
      "desk/shipped-screens.ts": { n: 2, why: "the screens extension's screens[], held from its manifest until a host serves them: checked as any extension's" },
    },
  },
  {
    question: "the shapes a screen is made of are outline-core's (screen-spec.ts, action-row.ts): the door declares none again",
    pattern: /^export (?:interface|type) (?:ScreenSpec|TileSpec|LayoutSpec|SavedFloat|SavedTree|Policy|KeyBinding|NewNoteRule|ArgSpec|Touches|KeyRow|Keys|TileAddress|AddressCandidate|AgentLevel|WireVerb|OpenRule|AltRule|BinaryForm|NaryForm|ActionRow|ActionDescription)\b/g,
    allowed: {},
  },
];

/** The functions of desk/layout.ts that return or change a tree (and the names screen-layout re-exports them by). */
const TREE_CHANGERS = new Set(["activate", "beside", "besideSlot", "chooseDock", "clone", "copyTree", "cycle", "dockToEdge", "edge", "even", "forgetIds", "grow", "insert", "keptInDock", "move", "normalise", "remove", "removeLeaf", "reorder", "replaceNode", "resize", "revive", "reviveTree", "split", "swapLeaf", "tabInto", "unwrapDock", "wrapDock", "wrapNodeDock"]);
/** What a file imports by name from the layout modules (the name as exported, whatever it is called there). */
function layoutImports(text: string): string[] {
  return [...text.matchAll(/(?:import|export)\s*\{([^}]*)\}\s*from\s*"[^"]*\/(?:layout|screen-layout)"/g)]
    .flatMap(m => m[1]!.split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ")).map(x => x.split(/\s+as\s+/)[0]!));
}

describe("one owner for each decision about a layout (native W0: the contract both doors are held to)", () => {
  const texts = sources().map(p => ({ file: relative(SRC, p), text: readFileSync(p, "utf8") }));
  const files = texts.map(({ file, text }) => ({ file, code: codeOf(text) }));
  for (const f of LAYOUT_FAMILIES) {
    test(`${f.question}: decided only where the table says`, () => {
      const found: Record<string, number> = {};
      for (const { file, code } of files) {
        const n = code.reduce((sum, line) => sum + (line.match(f.pattern)?.length ?? 0), 0);
        if (n) found[file] = n;
      }
      expect(found).toEqual(Object.fromEntries(Object.entries(f.allowed).map(([file, a]) => [file, a.n])));
    });
  }

  test("a tree is changed inside the layout module: who else holds one of its changers, and the three ways in", () => {
    const holds = (names: ReadonlySet<string> | readonly string[]) => Object.fromEntries(texts.map(({ file, text }) => [file, layoutImports(text).filter(n => (names instanceof Set ? names.has(n) : (names as readonly string[]).includes(n))).sort()] as const).filter(([file, ns]) => ns.length && file !== "desk/screen-layout.ts" && file !== "desk/layout.ts"));
    // A changer outside the module works on a tree before it is a layout (Desk.build, then init) or inside a step the
    // module runs (return-place's shells, which apply() asks for); a new holder here changes a layout behind apply().
    expect(holds(TREE_CHANGERS)).toEqual({
      "desk/desk.ts": ["keptInDock", "removeLeaf", "reviveTree"],   // Desk.build: a saved tree revived, a retired kind's tile left out, work kept in one dock; then init
      "desk/return-place.ts": ["replaceNode"],                     // the shells a closed tile's place comes back in, called from the module's own open
    });
    expect(holds(["apply", "refusal", "init", "placement", "hostLayer"])).toEqual({
      "desk/desk.ts": ["apply", "init", "placement", "refusal"],
      "desk/carry.ts": ["apply"],
      "drawer.ts": ["apply", "hostLayer"],
    });
  });
});

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
