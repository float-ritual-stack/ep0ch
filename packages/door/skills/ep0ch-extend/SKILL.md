---
name: ep0ch-extend
description: Use when someone wants an ep0ch outline or door to do something new by itself - a button that arranges tiles, a script that computes a line, a rule that draws or files matching notes, a component, a palette (power bar) source, a schedule that syncs an outside API, an agent that answers @name, or a kit others install - and before proposing a change to ep0ch's own code for a behaviour a script or extension could provide. Covers picking the smallest tier (rule note, script note, extension folder, built-in), mapping the ask to the mechanism and its doc section, writing it plainly as a probe whose failures become tickets, testing on a scratch outline, and what done means (found where the person is, describes itself, installs and uninstalls cleanly).
---

# ep0ch-extend: make the outline do a new thing

People ask for behaviours ("a button that puts these two side by side", "every morning, list yesterday's open
threads"). Most of them are a script, a rule or an extension on parts ep0ch already has, not a change to its code.
This skill is a map from the ask to the part, and the rules for building it so it works the way the person will
actually use it. It works from any outline and any harness, not only inside ep0ch's repository. The two references
are long and exact; this page tells you which section to read. Reach them however you reach ep0ch:

| Reference | Over MCP | From a shell |
|---|---|---|
| Scripts (globals, `act`, `read`, `view.*`, slots, modes, lifecycle, traps, worked examples, `neat`) | resource `ep0ch://docs/scripts` | `ep0ch docs scripts` |
| Extensions (the folder, `extension.json`, the four kinds, rules, actions, bar sources, agents, tiles, schedules, writes, secrets, testing) | resource `ep0ch://docs/extensions` | `ep0ch docs extensions` |
| Actions on the connected door's current screen, with arguments | — | `ep0ch actions` |
| Every component a note can hold, with an example | tool `outline_components` | `ep0ch library --brief` |

For working in someone's notes, use `ep0ch-outline`; for driving their door, `ep0ch`; for changing ep0ch's own
code, `ep0ch-core`.

## First: is it the next neat?

`neat` is the worked example. Evan asked for a layout ("these two side by side, the rest folded, the links wired");
it was written as a 40-line script on the door's own actions, plainly, and every step that failed was a missing
part of the door, fixed there, with the script unchanged. It became a built-in only after weeks of daily use.

So: write the behaviour on what exists. If a step fails, that failure is the finding: stop, say exactly which step
and what it answered, and file it (a ticket, or tell whoever asked). Never bend the script around a bug (a retry, a
sleep, a guess at a tile name): a probe bent to pass hides what it found.

## Pick the smallest tier that fits

| Tier | When | Lives in |
|---|---|---|
| **Rule note** (no code) | "when a note matches X, draw/file/stamp Y": a look, a route, a property | a note in the outline (`[rule-name::name]`, `[type::route]`): extensions, *Rule notes: the no-code tier*, *Routing* |
| **Script note** | a small thing for one note or one outline: a button, a computed line, a stamp, a layout | a ```` ```js script=name ```` fence or a `[script::name]` note: scripts, *A script in one minute* |
| **Extension folder** | disk, network, a secret, another language, a schedule, a component, a tile, a palette source, an agent | `<outline root>/extensions/<id>/` (that outline) or the user folder (every outline): extensions, *Where extensions live*, *The folder* |
| **Built-in / kit** | proven in daily use, wanted in every outline | ep0ch's own `packages/outliner/extensions/<id>/`, installed from the power bar; a change to ep0ch itself, so `ep0ch-core` applies |

Start local and blunt. Promote on the second real use, as a rewrite if needed. A built-in first is the wrong order.

## From the ask to the shape

| The person asks for | It is | Read |
|---|---|---|
| a button that does several things, arranges tiles, opens notes | an action script (`::button{of=name k=v}`), steps through `act` | scripts: *Functions*, *Worked examples*, *Bundled layout script: neat* |
| a value computed from the note or a query, kept up to date | a render script (`mode=render`) under a `name::` line | scripts: *Modes*, *view.\** |
| arguments to a button | slots: every word on `::button` other than its own is `props.<word>`, repeats are a list (`page=a page=b`) | scripts: *Globals* |
| a button that asks for a value the first time (click a tile, pick a note) | a `{key}` in `act=` filled from `key=` on the same line, left empty: `::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}`. A press asks in the kind the action's argument takes (a tile: click it), writes `target=t-…` on the line, and the next press runs it; alt+click asks again; an agent writes it with `button.slot` | scripts: *Buttons that ask* |
| notes that file themselves | a route rule note | extensions: *Routing* |
| a look or a badge on matching notes | a rule (`match` + `decorate`), no code if it can | extensions: *Rules* |
| something that reacts when a note changes | a rule's `on` trigger | extensions: *`on`: change triggers* |
| `key:: value` lines that fetch or draw | a handler (data, output, component) | extensions: *Handler lines*, *Kind 1–3* |
| a new figure or widget in notes | a component (kind 3) with a schema | extensions: *Kind 3*, *Component schemas* |
| rows in the power bar | a bar source | extensions: *Bar sources* |
| `@name` in a note gets an answer | an agent | extensions: *Agents in the note* |
| a whole tile | kind 4, the door's tile registry | extensions: *Kind 4* |
| every hour, sync an outside API | a program with a schedule, a connection, writes, a secret | extensions: *Extensions as programs*, *Worked example: sync…* |

Not in the table: read the extensions reference's *Not yet* section. If it's listed there, say so and stop: that's a ticket.

## Writing it

- **Use the real surface, never a guessed one.** The connected door lists its current screen's
  actions with `ep0ch actions`; `ep0ch actions --doc <name>` reads a known action's page (built-ins also work
  without a door). `act` refuses an unknown argument with the right call; every component's properties are listed
  by `outline_components`. A name you made up fails loudly, as it should.
- **Tiles by id, notes by id or `read(ref)`.** `read()` resolves an id, `((id))`, `[[page]]` or a Work ID.
- **Attributed and undoable.** Whatever a script or extension writes is recorded as it; a press is one undo group.
  Don't work around that.
- **Errors teach.** A refusal you write says why and the exact command or line that fixes it.
- **Properties are open.** Never hard-code which keys can be filtered or grouped; take a property name.

## Testing it

Never against a real outline, a real door or a real outside service.

- A scratch outline: `outline_new { name, purpose }` over MCP (a scratch outline of its own;
  `outline_archive { name }` puts it away). These are MCP server tools; in the Claude mod or a shell, use
  `ep0ch outline create <scratch-name>` and `ep0ch outline archive <scratch-name>` instead. Or use
  `ep0ch try --ws <name> --copy` for a private copy of a real outline's shapes with no real writes. Inside ep0ch's own
  repository, `scripts/agent-env <your name> -- …` as its AGENTS.md says.
- An extension: the extensions reference's *Testing an extension* (a scratch service, `OUTLINER_EXTENSIONS_DIR` at a temp folder, a
  fake API with `Bun.serve`, made-up data and tokens).
- Drive it the way the person will: press the button by click and through `act`, see what changed (`layout.get`,
  `ep0ch show`). A green unit test of a helper isn't evidence it works from the screen.

## Done means

- **Found where the person is**: a button in the note they use, a power bar row, a hint, a completion. Say where.
- **Describes itself**: an extension's `extension.json` lists what it provides (handlers, actions, rules, tiles,
  components, bar sources, agents, scripts) with a line each; inspectors read that, so nothing else needs writing.
- **Installs and uninstalls cleanly** if it goes through the extensions screen, built-ins included: on a fresh scratch
  outline, install it from the power bar (by click and `act`), use it once, uninstall, and check that what's left
  says so. A bundled-part test skips exactly the path a person uses (neat shipped and wouldn't install).
- **Demo notes are made up**: no real names, notes or ids from anyone's outline.
- **The report** says what it is, where to find it, how to undo it, and every step that failed with its ticket.
