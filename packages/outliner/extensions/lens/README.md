# Lens

Write one line in any note and it draws a live table of what a query holds, relative to that note.

- **The query:** the outline's one grammar, so it reads `this`.
- **The shape:** the line's own: columns, computed columns, sort, group, sums.
- **Press a cell:** it changes a property.
- **Why it exists:** the spike for PIE-1461, what Datacore reaches for, on the parts ep0ch already had.

```text
lens:: query="type=meeting when={{this.page}}" columns=title,who,status edit=status sort=when
lens:: query="type=seed-line under:this" columns=title,qty,price,cost cost="qty * price" sum=cost,qty
lens:: view="[[open-jobs]]" group=priority edit=stage choices-stage="todo|doing|done"
```

## Where to look

- **The lab:** installed with the extension, under its page.
  - Two day notes share one line and show different meetings.
  - A seed order has a computed `cost` and its sum.
  - Jobs are grouped by priority with a pressable stage.
- **Your own notes:** write a `lens::` line anywhere.
  - The power bar (`lens`) offers its slots.
  - `columns=`, `edit=`, `sort=` and `group=` pick from the properties the outline has.

## The line

| Slot | Means |
|---|---|
| `query="…"` | the views' grammar; `{{this.page}}`, `under:this`, `parent:this`, relative dates all work |
| `view="[[page]]"` or `view=((id))` | a saved view's `[query::]` (and its `[sort::]`) instead of `query=`; a `[[page]]` needs the view to carry `[page::…]`, and quotes when it has a space |
| `under=<ref>` | only under that note |
| `columns=a,b,c` | `title`, `created`, `updated`, `id`, any property, any computed column (default: title, the computed ones, updated) |
| `<name>="<expression>"` | a computed column: JavaScript over the row's properties (hyphens read as underscores, numbers as numbers) and `row` (`title`, `created`, `updated`, `props`, `n(key)`, `list(key)`, `get(key)`) |
| `edit=a,b` | those columns' cells press to step the property to its next value |
| `choices-<key>="a\|b\|c"` | the values a press steps through for that key (else every value the key has in the outline), then unset |
| `sort=col dir=asc\|desc` | by any column, computed ones included; dates and numbers compare as such |
| `group=col` | a box per value, each with its count |
| `sum=a,b` · `avg=a,b` | a footer row |
| `limit=n` | the most rows (200); a cut table says so |
| `title="…"` · `empty="…"` · `link=col\|none` | a band with the count; what to say when nothing holds; which column opens the row's note (title) |

- **A press** runs `lens-set note=<id> key=<col> next=1 [choices=…]`.
  - It is one attributed, undoable write of that note's first line, and the table redraws from the change.
- **An agent** runs the same line, or `lens-set note=<id> key=stage value=done`.

## How it's made

| Need | The part that's there |
|---|---|
| The rows | the one query grammar, read by the service with `this` bound to the note the line is in |
| Rows with their properties | `q(query, { properties: true })`: `outline_find`'s `properties` flag (added with this; before, a table over 200 rows cost 200 reads) |
| The drawing | `view.table`, `view.box`, `view.band` in a file render script (`// ep0ch-script mode=render`); every client draws them |
| A cell that presses or opens | `view.table` cells as `{ text, act?, link?, tone? }` (added with this: a row could only link or press whole) |
| The write | `tools.outline_set_property` with a `properties` map, as `lens-set`, attributed `script:lens-set` with the presser as `requestedBy`, one undo |
| The redraw | the render script's recorded reads and queries: a script's write reaches the lines that read the note |
| The slots | `[form-field::…]` declarations in the script's leading comments (PIE-1298): the power bar's form and an agent's `args` |
| Install and remove | an extension with `scripts:` and a `demo/`, as `neat` and the wyrm |

## What it found

Filed on PIE-1461:

- **Slots:** an action declares at most 8 slots; the lens has 13, and five work undeclared.
- **Completion:** it offers only `key=value` pairs, so `{{this.page}}`, `under:this` and `NOT` have to be known.
- **Redraw:** a `q` row's revision is tracked, but a table over a changing outline redraws whole, with no cell-level diff.
- **Computed columns:** they are this script's JavaScript, so the service can't offer them to a `::graph-table` without a second evaluator.

## Tests

- **The extension:** `packages/outliner/test/lens-extension.test.ts` covers install, each lens, a press and the redraw, the line's refusals and uninstall.
- **The demo:** the showcase's **lens** section, `packages/door/test/showcase/lens.test.ts`, is pressed in a real door.
