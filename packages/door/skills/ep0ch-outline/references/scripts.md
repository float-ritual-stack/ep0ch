# Scripts in their Site

A script is a note with `[script::name]` and a closed `js`, `ts` or `actions` fence. It runs as `script:<name>`, in the
same Site a `{{ }}` is read in: it knows which note asked, takes slots, and reads a note's properties and inline fields.
(`this` is a keyword inside the script's own `function`; arrow functions inside it keep it.)

| Global | What it is |
|---|---|
| `this` | The note the run is about, as a record: `this.title`, `this.id`, `this.properties` (`[{key, values}]`), `this.fields` (inline `[k::v]` with their lines), `this.tasks`, `this.children` (ids). A rule-fired script gets the matched block; a key or power-bar run the note in front; an agent's `act ext.<id>.run block=<id>` names it. With none, any `this.*` says so. |
| `self` | The script's own note, as a record. |
| `caller` | `{ block, line? }`: where it was invoked (null when nothing named a place). |
| `props` | Slots, every key a list: `week=42` is `props.week[0]`. Name them by using them: the power bar offers every `props.x` the code reads. |
| `read(ref, {depth, limit})` | A note as a record plus its `children`. |
| `resolve(path)` | What `{{ path }}` shows: `{ values, links?, route }` or `{ problem: { message, didYouMean, example } }`. `resolve("this.owner")`, `resolve("parent.project")`, `resolve("((id)).status")`, `resolve("this.tasks | status=todo .count")`. |
| `q(query)` | The views' query grammar; `this` is bound: `q("parent:this")`, `q("links:this")`. Twenty rows unless `{limit}`. |
| `tools.*`, `act(name, args)` | As before: the agent tools, and the connected door's actions. |
| `wait(ms)` | Sleeps. Ends with the run: the deadline (`[deadline::2m]`, five minutes at most) or a stop. |

```js
// Count the open steps of the note in front, by owner
const open = (await resolve("this.tasks | status=todo .count")).values[0];
const owner = (await resolve("this.owner || nobody")).values[0];
return `${owner} has ${open} open steps`;   // a returned string shows as plain text
```

## Return values

A string is shown as it is. `{ view: view.table({ columns, rows }) }`, or `view.table(…)` alone, is a table or card. Anything
else is JSON.

## Render mode: draw in place, live

`[mode::render]` on the script note makes it a handler. A line `weekly:: week=42` in any note draws what the script returns
under the line, again when a note it read changes (and not on every keystroke). It writes no run note and nothing else; a
script that also declares `[effects::write]` isn't served (`ext ls` says why). A `::= expression` line is the same for one
line: `::= (await resolve('this.owner')).values[0]`.

### A button in a view, and in a note

A press is an **action line**, as the power bar takes one (`ttt-move at=5`, `layout.load name=review`). In a view, a `button`
primitive or an `act:` on a `badge`, `text`, `card` (and `acts:` per table row) carries it; in a note, `::button{label="Review"
act="layout.load name=review"}`, `::button{label="Play" of=ttt-move at=5}` (`of=` a script, the other words its slots) or the
prose link `[review layout](act: layout.load name=review)`. In the door a click or ⏎ runs it as the person, on the note it is
written in (`this`), and an action that writes asks once first. The move script is `[effects::write]`; the render script only
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

## Looking at a script's output

`ep0ch show` draws the note and its values but not what a script or other extension line returns: that is drawn by a door's
Detail screen. To see it as a reader does, run a door of your own on your outline (the `ep0ch` skill, "run your own": a
tmux pane with `EP0CH_STATE` and `EP0CH_CONTROL` set, `ep0ch --ws <name> --no-daemon --screen detail <full id>`), then `ep0ch peek`: it prints the door's state as JSON and, below the closing brace, the screen as text. To draw the
lines now after a change, `ep0ch act projection.refresh block=<full id>`. An argument is `key=value` after the `::`
(`weekly:: week=42`, read as `props.week[0]`); a line with none is `weekly::` and runs with empty `props`.

## Running, stopping, undoing

- The run answers at once with its note (`[machine::script]`: bookkeeping, no backlinks) and an `undo` id.
- A script may write into its own note and goes on; editing its code ends the run.
- `script.stop run=<undo id>` ends one run; its note says who stopped it. Writes it already made stay: `ext.undo` takes
  them back whole.
- A run past its deadline stops with "ran past its deadline".
