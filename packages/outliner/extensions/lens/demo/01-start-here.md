Start here: a lens is one line that draws a table
A lens line draws a live table of what a query holds, where the line is. The query reads the note it's in, so one line serves every daily note; the shape is yours: columns, computed columns, sums, groups, and cells you press to change a property.

- **Write one:** `lens:: query="type=meeting when={{this.page}}" columns=title,when,who,status edit=status sort=when`
- **Computed columns** are any other slot: `cost="qty * price"` is JavaScript over the row's properties (hyphens read as underscores, numbers as numbers), then `sum=cost`.
- **Press a cell** in an `edit=` column to step its property to the next value (the `choices-status="todo|doing|done"` you give, else every value that key has). One attributed write; ctrl+z takes it back.
- **Agents** run the same line a press runs: `lens-set note=<id> key=status value=done`.
- **A saved view** works too: `lens:: view=[[Open jobs]]`.
- The lab below has three: ((day-one|a day note)), ((seed-order|a seed order with a computed column)), ((jobs|jobs grouped by priority)).
