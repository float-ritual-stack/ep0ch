---
name: ep0ch-extend
description: Use when someone wants an ep0ch outline or door to do something new by itself - a button that arranges tiles, a script that computes a line, a rule that draws or files matching notes, a component, a palette (power bar) or completion source, a schedule that syncs an outside API, an agent that answers @name, or a kit others install - and before proposing a change to ep0ch's own code for a behaviour a script or extension could provide. Covers picking the smallest tier (rule note, script note, extension folder, built-in), mapping the ask to the mechanism and its doc section, writing it plainly as a probe whose failures become tickets, testing on a scratch outline, and what done means (found where the person is, describes itself, installs and uninstalls cleanly).
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
| a button that asks for a value the first time (click a tile, pick a note) | a `{key}` in `act=` filled from `key=` on the same line, left empty: `::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}`. A press asks in the kind the action's argument takes (a tile: click it), writes `target=t-…` on the line and runs; later presses use it; alt+click asks again; an agent writes it with `button.slot` | scripts: *Buttons that ask* |
| notes that file themselves | a route rule note | extensions: *Routing* |
| a look or a badge on matching notes | a rule (`match` + `decorate`), no code if it can | extensions: *Rules* |
| something that reacts when a note changes | a rule's `on` trigger | extensions: *`on`: change triggers* |
| `key:: value` lines that fetch or draw | a handler (data, output, component) | extensions: *Handler lines*, *Kind 1–3* |
| a new figure or widget in notes | a render script note called as `::name{k=v}` (below); a folder component (kind 3) only for disk or network | scripts: *A render script is a component*; extensions: *Kind 3* |
| rows in the power bar | a bar source (`sources[]` with a `prefix`) | extensions: *Bar sources* |
| rows where a person types (`[[`, `[issue::`, `@`…): a tracker's issues, a glossary | a completion source (`sources[]` with `triggers`; no new sigils) | extensions: *Completion sources*; example `extensions/issues` |
| `@name` in a note gets an answer | an agent | extensions: *Agents in the note* |
| a whole tile | kind 4, the door's tile registry | extensions: *Kind 4* |
| every hour, sync an outside API | a program with a schedule, a connection, writes, a secret | extensions: *Extensions as programs*, *Worked example: sync…* |

Not in the table: read the extensions reference's *Not yet* section. If it's listed there, say so and stop: that's a ticket.

## A component from a note (agent recipe)

1. **Find:** the session guide lists the outline's own components under "from notes", `- board: … (note:((id)))`.
2. **Read its props:** `outline_components {components:["board"]}` gives each prop (type, required, default) and an example line.
3. **Use:** write the example line in a note, `::board{where="type=errand" group=status}`. The write's warnings name an
   attr it doesn't take (with a did-you-mean) and a required prop left out: fix them in the same turn.
4. **Check:** `outline_read {view:true, width:100}` shows what it draws; a failure reads `unavailable` and why under its line.
5. **Author:** a note `Name [script::x] [mode::render] [form-field::where query required]`, a line of gist, a demo
   line `::x{where="…"}`, then a `tsx` fence that returns tags (`<row>`, `<card title=…/>`). Use `query({where, group,
   facets})` for rows with their properties; `import { Lane } from "ui-kit"` reads a `[mode::module]` note.
6. **Fix load problems:** the write's receipt names a tsx syntax error by line, an unknown import or a taken name.
   Once it loads, `outline_components` lists it within seconds.
7. **Graduate a `::=` line:** `script_run {ref: "[[ext-keep]]", this: <the note>, slots: {name: "x"}}`: the line becomes
   `::x{}` and the expression a component note, one undo.
8. **Probe data first:** `script_run` a scratch `[script::probe]` note whose fence is
   `return await query({ where: "type=errand", facets: true })`: it answers the keys and values a prop can take.

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
