# Scripts in their Site

The full surface, with a source pointer for every entry and four worked examples, is the repository's
`packages/outliner/docs/scripts.md`; this is the short form for working in an outline.

A script is a note with `[script::name]` and a closed `js`, `ts` or `actions` fence. It runs as `script:<name>`, in the
same Site a `{{ }}` is read in: it knows which note asked, takes slots, and reads a note's properties and inline fields.
(`this` is a keyword inside the script's own `function`; arrow functions inside it keep it.)

| Global | What it is |
|---|---|
| `this` | The note the run is about, as a record: `this.title`, `this.id`, `this.properties` (`[{key, values}]`), `this.fields` (inline `[k::v]` with their lines), `this.tasks` (`this.children`, `links` and `backlinks` are empty on `this`: use `read(this.id)` or `q("parent:this")`). A rule-fired script gets the matched block; a key or power-bar run the note in front; an agent's `act ext.<id>.run block=<id>` names it. With none, any `this.*` says so. |
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
