# Lens

One line in any note draws a live table of what a query holds, relative to that note. The query is the outline's one
grammar, so it reads `this`; the shape is the line's: columns, computed columns, sort, group, sums, and cells you press
to change a property. The spike for PIE-1461: what Datacore reaches for, on the parts ep0ch already had.

```text
lens:: query="type=meeting when={{this.page}}" columns=title,who,status edit=status sort=when
lens:: query="type=seed-line under:this" columns=title,qty,price,cost cost="qty * price" sum=cost,qty
lens:: view="[[open-jobs]]" group=priority edit=stage choices-stage="todo|doing|done"
```

## Where to look

- **The lab:** installed with the extension, under its page. Two day notes share one line and show different meetings; a
  seed order has a computed `cost` and its sum; jobs are grouped by priority with a pressable stage.
- **Your own notes:** write a `lens::` line anywhere. The power bar (`lens`) offers its slots; `columns=`, `edit=`,
  `sort=` and `group=` pick from the properties the outline has.

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

A press runs `lens-set note=<id> key=<col> next=1 [choices=…]`: one attributed, undoable write of that note's first line,
and the table redraws from the change. An agent runs the same line, or `lens-set note=<id> key=stage value=done`.

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

What it found, filed on PIE-1461: an action declares at most 8 slots (the lens has 13; five work undeclared); query
completion offers only `key=value` pairs, so `{{this.page}}`, `under:this` and `NOT` have to be known; a `q` row's
revision is tracked but a table over a changing outline redraws whole, there is no cell-level diff; a computed column is
this script's JavaScript, so the service can't offer it to a `::graph-table` without a second evaluator.

Tests: `packages/outliner/test/lens-extension.test.ts` (install, each lens, a press and the redraw, the line's refusals,
uninstall) and the showcase's **lens** section, `packages/door/test/showcase/lens.test.ts` (pressed in a real door).
