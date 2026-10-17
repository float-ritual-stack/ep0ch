# Scripts: the short form

The surface itself (globals, functions, `tools.*`, `view.*`, modes, lifecycle, traps, worked examples) lives in one
place: the repository's `packages/outliner/docs/scripts.md`. This file keeps only what an agent working in an outline
needs beyond it.

### A button in a view, and in a note

A press is an **action line**, as the power bar takes one (`ttt-move at=5`, `layout.load name=review`). In a view, a `button`
primitive or an `act:` on a `badge`, `text`, `card` (and `acts:` per table row) carries it; in a note, `::button{label="Review"
act="layout.load name=review"}`, `::button{label="Play" of=ttt-move at=5}` (`of=` a script, the other words its slots) or the
prose link `[review layout](act: layout.load name=review)`. In the door a click or ⏎ runs it as the person, on the note it is
written in (`this`), at once (the click is the consent; `ext.undo` takes it back). The move script is `[effects::write]`; the render script only
draws, and is drawn again when the move writes the note it read.

```js
// board:: draws the squares of a game kept in this note's [board::.........] property
const b = (await resolve("this.board")).values[0];
const square = i => b[i] === "." ? view.badge({ label: String(i + 1), act: `ttt-move at=${i + 1}` }) : view.badge({ label: b[i] });
return view.stack({ children: [0, 3, 6].map(r => view.row({ minWidth: 4, children: [square(r), square(r + 1), square(r + 2)] })) });
```

A script started by a press may move the person's tiles (their press invited the run); its `act("tile.close", …)` calls are one layout
transaction (undone with `ext.undo`, or put back if the run is stopped). An agent passes `txn=<id>` to any action to join one
and closes it with `layout.txn.end txn=<id>`; `layout.undo` takes the newest change back (its own, for an agent).

### Fantasia, the whole chain in one button

`::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 motion=fantasia}` runs a script that floats the screen's tiles, dances them
with `motion=fantasia` and settles them back, as one layout transaction a press invited. The script, step by step and for an agent, a
stop and an undo, is `packages/outliner/docs/scripts.md` ("Fantasia", the worked example), and `ep0ch --showcase` has it live
(`act section name=fantasia`).

## Trying a button or a dance on a scratch outline

Everything here runs from your worktree and under `scripts/agent-env <name> --`, never against the person's outline or the live
`ep0ch` (a worktree whose `PROTOCOL` differs from the installed one answers "update the door (ep0ch install --apply)": run
`bun packages/door/src/main.ts …` from the worktree for every command instead of `ep0ch`).

0. Every `new`, `show` and `find` needs `--ws <ws>`. A background host prints one line when it is ready, `{"status":"ready",…}`: wait for it (the Monitor tool, an until-loop on its output) before the next command.
1. A scratch host: `scripts/agent-env <name> -- bun packages/outliner/src/host-main.ts` in the background (the Bash tool's
   `run_in_background`; stop it by its pid), then `scripts/agent-env <name> -- bun packages/door/src/main.ts outline create <ws>`.
2. Notes: a multi-line note goes in as one argument (`new "$(cat note.md)"`, or `$'line one\nline two'`) and lands in the Inbox;
   a script is a note with `[script::name] [effects::write]` and a closed `js` fence.
3. A test door: in a tmux pane started through agent-env (it inherits `EP0CH_STATE` and `EP0CH_CONTROL`), `bun packages/door/src/main.ts
   --ws <ws> --no-daemon --screen detail <full id>`. The first screen is a reader the person holds; an agent's presses and moves
   go through `act` (`--as <id>`).
4. Press: `act button.press label="Bump" --as <id>` presses a button of the note in the focused reader (`n=` from `act elements`; a
   miss lists the buttons the note has). `tile=<reader>` names another reader, and `note=<id> label="Bump"` presses a button of a note that
   is open nowhere: the door reads the note's text and runs the line. Neither moves the person's focus. It runs through the same
   dispatcher as a click, attributed to you, and answers the line it ran.
5. A dance moves tiles that are not held: a screen of one or two tiles shows little. Use a layout with several readers (`act tile.open kind=detail note=<id>` (or `id=<id>`) adds one; the board; the
   showcase's `fantasia` section; an agent's run leaves the reader the person holds docked, so one tile fewer than the screen shows dances), and add `stay=1` to the button to leave the tiles where they danced, so `act layout.undo` has
   something to take back. `act ext.undo run=<the run's undo id>` takes back the script's writes and layout together (the answer's
   `undo` names the script's run note, which is what `ext.undo` wants, not the note the button is in).

Clean up: stop the host by its pid and the test door by killing your own tmux session (`tmux -L <socket> kill-server` on your own socket;
`session end --all` finds nothing for a `--no-daemon` door), then `scripts/agent-env <name> --clean`.

## Looking at a script's output

`ep0ch show` draws the note and its values but not what a script or other extension line returns: that is drawn by a door's
Detail screen. To see it as a reader does, run a door of your own on your outline (the `ep0ch` skill, "run your own": a
tmux pane with `EP0CH_STATE` and `EP0CH_CONTROL` set, `ep0ch --ws <name> --no-daemon --screen detail <full id>`), then `ep0ch peek`: it prints the door's state as JSON and, below the closing brace, the screen as text. To draw the
lines now after a change, `ep0ch act projection.refresh block=<full id>` (add `line=<index>` for one line: with several lines that run and no `line=`, nothing runs and the refusal names them). In a door a generated line draws flush with the note's text, with one dim `≡` mark in the gutter that shows its name, when it ran and its controls. An argument is `key=value` after the `::`
(`weekly:: week=42`, read as `props.week[0]`); a line with none is `weekly::` and runs with empty `props`.
