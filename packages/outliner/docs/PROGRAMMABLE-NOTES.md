# Programmable notes

**One Site:** values, figures, templates, scripts and extension handlers read the same execution context.
**One answer:** the service resolves it; the door, Detail, publisher and agents draw that answer.
**Source:** a note is Blockdown; `ep0ch show --source <id>` shows what was written, and `ep0ch show <id>` draws values and handler output, including script tables.
**Decision:** [ADR 0006](../../../docs/adr/0006-one-site.md); the complete script API is [scripts.md](scripts.md).

## Site, grammar and scope

**`at`:** the address where the producer sits: a block, optional anchor and mark; a line number is a drawing hint, not a durable write address.
**`this`:** the containing note as a block record; inside `::use` it is the host page, and inside an embed it is the embedded note.
**`self`:** the definition note (the template or script); a file script has no definition note.
**`caller`:** the address of the invocation when there is one; an action run may have `this` without a caller line.
**`props`:** invocation arguments, separate from the note's properties; every value is a list of strings.
**`actor` and `door`:** who runs it, who asked, and which door can receive its actions.
**Nesting:** the service derives the Site from the invocation chain; clients never invent their own `this`.

**Form:** `{{ path || fallback }}` draws a value; `\{{` keeps a literal opening brace pair.
**Heads:** `this`, `parent`, `self`, `caller`, `props`, `match` (a rule), `now`, `((id))`, `[[page]]`, a Work ID, or a bare property key.
**Own values:** `this.key` reads block values first, then line and inline occurrences in document order; `this.block.key` reads block scope alone and `this.fields.key` reads occurrences with their positions.
**Nearest value:** a bare `owner` walks from the invocation's line through the note and its ancestors; `this.owner` stays on this note, and `parent.owner` starts at its parent.
**Lists:** `{{this.owner}}` joins values with commas; `[0]` selects the first and `.count` counts.
**Links:** `[person::[[Garden keeper]]]` lets `{{person.firstName}}` continue into that note; a link-valued property is the binding, with no separate `let` syntax.
**Filters:** `{{this.tasks | status=todo}}` uses the views' query grammar; keys remain open.
**Dates:** `{{now.date}}`, `{{now.week}}` and `{{now.date-1d}}` read the clock.
**Queries:** `project={{this.project}}` is bound as an operand, never pasted as query text.
**Mistakes:** source saves first; an unresolved value draws a warning with the nearest key, rather than refusing the note.

## Props, drawing and writing

**Declare props:** `[form-field::status choice active|paused|done default=active]` and `[form-field::owner text default=Sam]` compile to the shared PropsSpec, as action arguments and component schemas do.
**Pass props:** `::use{of=[[status-card]] owner=Robin status=paused}`; `status={{parent.status}}` reads the caller's Site before invoking the template.
**Reserved words:** `of`, `act`, `at`, `mode`, `as`, `label`, `txn`, `motion`, `create`, `freeze`, `for` describe the invocation rather than a template's own prop names.
**Definition preview:** on the template's own page, `{{props.x}}` prints “no prop x was passed”: props belong to an invocation, including when a render script resolves that value. Check the `::use` caller to see supplied props and form defaults.
**Live template:** `::use` draws the template body with the host as `this`; edits to the definition redraw its uses.
**Stamp:** `template.stamp of='[[status-card]]' as=new` writes a note to edit; props, self and clock values are filled, while host-relative values stay live unless `freeze=all` is given.
**Render:** `[mode::render]` and a `name::` body line draw the returned view; dependencies cause redraws, with no note edit or undo step.
**Materialize:** an action script with `[effects::write]` calls `place(content, {at: "^log", mode: "append"})` to write output.
**Output region:** a folded `> [!output]` callout carries `[output-of::((producer))]`, a body hash and a unique anchor; it stays out of the note's property record.
**Placement:** `append` and `prepend` create regions beside the addressed slice; at a heading they use the space directly below it, after existing output for append, before the person's prose.
**Replacement:** `replace` targets the producer's own output region; `upsert` creates or replaces it, and a person's edit to its hashed body makes replacement a proposal.
**Anchored edit:** `outline_edit {ref, expectedRevision, append, at: "^log"}` exposes the same placement and held-draft route; the returned receipt says `outcome`, `anchor` and `message`.
**Draft rule:** [scripts.md: Anchored append and held drafts](scripts.md#anchored-append-and-held-drafts) states where a patch lands and why a cursor overlap becomes a proposal.

## Bindings and state

**Read binding:** a property whose value is one link lets a path continue into another record; a figure's query reads through the same Site.
**Write binding:** a board grouped by a property writes that property on a drop; grouping by `parent` moves the block through the service's structural write path.
**Open keys:** choose `group=` and `sort=` from the rows' facets, never from a client-owned list of allowed keys.
**Authored state:** durable game cells, counters and workflow values belong in note properties or child blocks, edited through tools and revision checks; [the game example](scripts.md#example-3-tic-tac-toe-with-the-board-in-a-property) demonstrates it.
**Viewer state:** selection, scroll and an entered filter belong to the viewer; drawing does not turn them into authored properties.
**Derived state:** render output is a watched answer, not a second authoritative copy of the note.
**Extension state:** see [where an extension keeps its state](extensions/README.md#where-an-extension-keeps-its-state).

## Scratch setup for all five tasks

**Worktree:** run from the repository root; every command below uses this checkout, not the installed `ep0ch`.
**Fresh shells:** each agent command runs in a fresh shell. Define `e()` again in every shell that uses it, or replace `e` with `scripts/agent-env notes-guide -- bun packages/door/src/main.ts --ws garden`. Keep the printed scratch path; set `work=<that-path>` in later shells. The host PID is saved in `$work/host.pid`.
**Isolation:** use one agent-env name for the host, door and commands; its outlines and control socket are private.
**Ready:** the host prints `{"status":"ready","pid":…, …}` only after listening; wait for that line before creating the outline, and use the saved PID file for cleanup.

```sh
work=$(mktemp -d /tmp/ep0ch-agent-$(id -u)/notes-XXXXXX)
scripts/agent-env notes-guide -- env XDG_CONFIG_HOME="$work/config" bun packages/outliner/src/host-main.ts >"$work/host.log" 2>"$work/host.err" &
host_pid=$!
printf '%s\n' "$host_pid" >"$work/host.pid"
printf 'work=%s host_pid=%s\n' "$work" "$host_pid"
until rg -q '"status":"ready"' "$work/host.log"; do
  kill -0 "$host_pid" || { cat "$work/host.err"; break; }
  sleep 0.1
done
cat "$work/host.log"
e() { scripts/agent-env notes-guide -- bun packages/door/src/main.ts --ws garden "$@"; }
e outline create garden
```

**Saving examples:** write the inside of each `blockdown` wrapper below into its own file under `$work`, then `e new "$(cat "$work/file")" --json`. Omit the outer opening and closing backtick lines (including the four-backtick wrappers); keep the title and any inner `js` fence.
**Finding notes:** `e find --query 'page=beds' --ids` returns the ID; use the full ID wherever a command below says `<id>`.
**Readback:** `e show <id>` checks the drawing; `e show --source <id>` checks the stored source.

## 1. A status card on two pages

**Template:** save this note first.

```blockdown
Status card [page::status-card] [type::template]
[form-field::status choice active|paused|done default=active]
[form-field::owner text default=Sam]
{{this.title}}: {{props.status}}, owned by {{props.owner}}.
```

**First page:** save as its own note.

```blockdown
Beds [page::beds]
::use{of=[[status-card]]}
```

**Second page:** save as another note.

```blockdown
Tools [page::tools]
::use{of=[[status-card]] status=paused owner=Robin}
```

**Done:** `e show <beds-id>` draws `Beds: active, owned by Sam.`; the Tools page draws `Tools: paused, owned by Robin.`
**Live check:** edit the template's body and show both pages again; both change while their own titles remain distinct.

## 2. Fields here and on the parent

**Parent:** save this note and keep its ID.

```blockdown
Garden [page::garden-parent]

connectTo:: water butt
- path [connectTo::shed]
```

**Child:** save the next note with `e new "$(cat "$work/child")" --near <parent-id> --json`.

```blockdown
Bed roll-up [page::bed-rollup]

connectTo:: trellis
- path [connectTo::gate]
::fields{key=connectTo title="This bed"}
::fields{key=connectTo of=parent title="The garden"}
```

**Done:** the first figure lists trellis and gate; the second lists water butt and shed.
**Explicit target:** replace `of=parent` with `of=<parent-id>` or `of=((<first-eight-characters>))` and the second figure is unchanged.
**Line numbers:** the figure counts from 1; `fields[].line` in API records counts from 0.
**Bare fields:** `connectTo:: value` begins a line; in the middle of prose write `[connectTo::value]`.

## 3. A table that redraws

**Script:** save this definition note.

````blockdown
Bed table [script::bed-table] [mode::render]
```js
const owner = (await resolve("this.owner")).values.join(", ");
return view.table({ columns: ["Note", "Owner", "Week"], rows: [[this.title, owner, props.week[0]]] });
```
````

**Caller:** save this note.

```blockdown
Early beans [page::early-beans] [owner::Sam]
bed-table:: week=12
```

**Done:** `e show <caller-id>` draws a table with Early beans, Sam and 12.
**Redraw:** open it in the scratch door below, edit `[owner::Sam]` to `[owner::Robin]`, press Ctrl+S once to confirm the property change, then Ctrl+S again to save; the table redraws to Robin without changing the handler line.
**Outside a door:** read the caller's current revision with `scripts/agent-env notes-guide -- bun packages/outliner/src/cli.ts --ws garden read <caller-id> --fields id,text,revision`, then edit the full source with `scripts/agent-env notes-guide -- bun packages/outliner/src/cli.ts --ws garden update --id <caller-id> --text "$(cat <edited-source-file>)" --expected <rev>`. Show it again to check Robin in the table.
**No write:** showing the table does not add children or change the caller's revision.

## 4. Append while a person holds a draft

**Target:** save this note and keep its ID.

```blockdown
Garden log [page::garden-log]

The log starts here. ^log

My paragraph to keep typing in.
```

**Script:** save this definition; the `target` prop lets the second run target the output region returned by the first.

````blockdown
Append log [script::append-log] [effects::write]
```js
return await tools.outline_edit({
  ref: this.id, expectedRevision: this.revision,
  append: "Sowed beans.\nWatered the bed.", at: props.target?.[0] || "^log"
});
```
````

**Find its action:** `e ext ls` shows `script-<hash>` rows with `@name` in the SERVES column; there is no name column. Find `@append-log` in SERVES and use that row's `script-<hash>` ID below, not `ext.append-log.run`.
**Open a door:** substitute the target ID, then start your own pane.

```sh
tmux new-session -d -s notes-guide -c "$(pwd)" -x 160 -y 48 "scripts/agent-env notes-guide -- bun packages/door/src/main.ts --ws garden --no-daemon --screen detail <target-id>"
e peek
e act edit
```

**Working directory:** `-c` must name this worktree's root; if you start tmux elsewhere, replace `$(pwd)` with its absolute path.
**Hold:** wait for `e peek` to report `editing.held`; by keys, `e e` also opens the editor, while `e` then Enter dismisses the arm.
**Enter:** an agent-opened editor remains held; if its frame says `held (e enters)`, run `tmux send-keys -t notes-guide e` to give the scripted person its keys. Movement and typing keys sent before that `e` are ignored until the draft is entered.
**Type below the target:** move to the final paragraph by source line, checking `e peek`'s `cursor.line` (zero-based: line 4 in this example). Wrapped headers make a fixed count of Down presses unreliable; check after moving, then use End and `tmux send-keys -t notes-guide -l ' Still typing.'`. Leave the draft open.
**Run:** `e ext act script-<hash> run --block <target-id> --actor gardener`; wait for its run note to finish and read it with `e show --source <run-note-id>`. This service CLI route also works outside a door; the held draft requires the scratch door above.
**First result:** the receipt says `outcome: applied`, the draft contains the output and the person's words, and `e show --source <target-id>` still shows the saved version.
**Conflict:** copy the receipt's `anchor`. Inspect `e peek`'s text to locate the output region's body lines containing `Sowed beans.` and `Watered the bed.`, below its `> [!output]` header. For saved output, `e show --source <target-id>` also shows those lines; it does not include the unsaved held draft. Use the pane's arrow keys to put the person's cursor on one of those body lines, then check `e peek`'s zero-based `cursor.line` against the source before running `e ext act script-<hash> run --block <target-id> --arg target=^<anchor> --actor gardener`.
**Second result:** the receipt says `outcome: proposed`; the draft keeps the person's text, and the proposal can be applied or dismissed later.
**Finish the edit:** Ctrl+S in your own pane saves the combined draft before task 5.

## 5. Fantasia settles into a saved screen

**Script:** save this whole note, including the title and the inner `js` fence.

````blockdown
Fantasia [script::fantasia] [effects::write]
```js
const beats = Math.max(1, Math.min(12, Number(props.beats && props.beats[0]) || 4));
const tempo = Math.max(150, Math.min(3000, Number(props.tempo && props.tempo[0]) || 500));
const style = (props.motion && props.motion[0]) || 'fantasia';
const home = (props.layout && props.layout[0]) || '';
const stay = !!(props.stay && props.stay[0]);
const before = await act('layout.get');
if (before.locked) return 'fantasia: the screen is locked; alt+k unlocks it, then run again';
const dancers = (before.tiles || []).filter(t => t.shown && t.kind !== 'drawer.own').map(t => ({ id: t.id, name: t.name }));
const notes = [], floated = [];
for (const d of dancers) {
  try { const r = await act('tile.float', { tile: d.id, on: true, motion: style }); floated.push({ id: r && r.now && r.now !== d.name ? r.now : d.id, name: d.name }); }
  catch (e) { notes.push(d.name + ' stayed put: ' + (e && e.message || e)); }
}
if (!floated.length) return 'fantasia: no tile would float. ' + notes.join('; ');
const drift = [[7, -2], [-5, 3], [6, 2], [-8, -3], [4, 4], [-4, -4], [9, 1], [-6, 2]];
for (let beat = 0; beat < beats; beat++) {
  for (let i = 0; i < floated.length; i++) {
    const [dx, dy] = drift[(beat + i * 3) % drift.length];
    try { await act('float.place', { tile: floated[i].id, dx: i % 2 ? -dx : dx, dy, motion: style }); }
    catch (e) { notes.push('beat ' + (beat + 1) + ', ' + floated[i].name + ': ' + (e && e.message || e)); }
  }
  await wait(tempo);
}
let settled = '';
if (stay) settled = 'and left where they danced (layout.undo puts them back)';
if (!settled && home) {
  try { await act('layout.load', { name: home, motion: 'settle' }); settled = 'into the screen ' + home; }
  catch (e) { notes.push('layout.load ' + home + ': ' + (e && e.message || e)); }
}
if (!settled) {
  // No layout asked: the run's own changes are taken back, so the screen is as it began.
  try { await act('layout.undo'); settled = 'the layout as it began'; } catch (e) { notes.push('layout.undo: ' + (e && e.message || e)); }
}
if (!settled) settled = 'left where they danced (layout.undo, or ctrl+z, puts them back)';
return 'fantasia: ' + floated.length + ' tile' + (floated.length === 1 ? '' : 's') + ' danced ' + beats + ' beat' + (beats === 1 ? '' : 's') + ' at ' + tempo + ' ms, ' + settled + (notes.length ? '\nnotes: ' + notes.join('; ') : '');
```
````
**Button:** save this note; the button is on a body line, since the first line is the title.

```blockdown
Dance controls [page::dance-controls]
::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 layout=focus motion=fantasia}
```

**Desk:** `e act screen.open name=desk` leaves Detail, whose layout is fixed. If Desk is already open, it answers “the desk is already open”; to reset the layout, use `e act layout.load name=desk`.
**Arrange:** `e act tile.open kind=detail note=<button-note-id>` and open two more readers for the Beds and Tools pages.
**Undo reader:** before saving, also open the Fantasia definition with `e act tile.open kind=detail note=<script-note-id>` and keep the returned tile name for `ext.undo`.
**Save:** `e act screen.save name=focus` creates the settle target, including that undo reader; `layout=focus` can now load it.
**Person's press:** this needs a person: click the Fantasia chip, or select it and press Enter, then use Ctrl+Z to undo. The invitation lets the run move the held tile as well. An agent tests only the agent path below (`button.press --as` and `ext.undo`) and stops there; it does not perform this person-only check.
**Variant:** `stay=1` instead of `layout=focus` leaves the tiles where they danced for an undo demonstration; do not combine them, since stay takes precedence. With neither, Fantasia undoes its own layout before finishing.
**Done:** tiles float, wait between beats, settle into focus, and one Ctrl+Z (`layout.undo`) puts the original layout back.
**Agent's press:** `e act button.press note=<button-note-id> label=Fantasia --as gardener` runs the same script without an invitation; the person's held tile stays put, said in the run note.
**Undo arguments:** `e act ext.undo tile=<undo-reader> --as gardener` uses the reader prepared above (the receipt's `undoOn` is the script definition); it takes no `run=` and undoes that actor's last run there, writes and layout together.
**Restore receipt:** a successful `ext.undo` lists the restored write IDs in `written` and reports `layout: { undone: true, steps: …, screen: "<previous-screen>" }`. Run `e act layout.get` to check `layout`, the tile tree and the floats against the state before the dance. `layout.refused` or `layout.left` explains a refused or partial restore. A second `layout.undo txn=<undo-id>` says “no layout change in transaction” because the successful restore already consumed it.
**Stop arguments:** `e act script.stop run=<undo-id>` stops a running script; `e act layout.undo txn=<undo-id>` takes back only its layout.

## Cleanup

**Only your processes:** stop the pane and host you started, using the PID saved at startup, then remove your scratch files. Never pick a host from `pgrep`: other people's hosts run on the same machine.

```sh
tmux kill-session -t notes-guide
host_pid=$(cat "$work/host.pid")
pstree -p "$host_pid"
kill "$host_pid"
# In the shell that launched the host, also: wait "$host_pid"
scripts/scratch-clean "$work"
scripts/agent-env notes-guide --clean
```

## Links built from values

```text
Follow-up [ticket::PC-1245]
Read [[{{this.ticket}}]].
```

The reader opens PC-1245, and that page lists Follow-up in its backlinks.
Edit the property to `PC-1246` and the link and backlink follow it. A block-id
property can likewise supply `(({{this.destination}}))` or an embed
`!(({{this.destination}}))`. Each placeholder in an address must yield one value.
An unresolved value saves as typed and shows a warning with a nearest-key suggestion
when available. In the door, the `¶` beside the link opens the line its value reads; click it
or step to it with `]` and press Enter. The link itself opens its destination.
The showcase's **Notes that read themselves** section has a working guide link.
