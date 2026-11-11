### A long message never covers the power bar or the log, and its more names the key that works (PIE-1732)

- **With ^K open, a message the status bar cuts reads outside the bar:** at 44×13 and 44×20 the lit row and the bar's foot stay as they were; the message takes the rows the bar leaves free (above a question's compact bar, which sits on the status bar), and in the bar's own row when none are (44×10). One owner, `wholePlace` (`src/status-whole.ts`), decides it.
- **⇧⌥M or a click on that message, with ^K open,** puts the bar away and opens the message log; before, the bar swallowed both.
- **The message log is never covered:** a message it lists reads in it; one logged after its rows were read reads on its own row above the hint row ("1 new · …  · r"), and `r` lists it.
- **"… more" names the key that works:** ⇧⌥M (it said alt+M, one shift from alt+m, which marks a note), read from the keymap, so a rebind of `status.log` shows there; the ⇧⌥Q macro chip reads its key the same way.
- **A BBS screen's hint row too wide for the screen ends in …** (the log's `PgUp/PgDnk` at 44); a key past the cut is no click.
- **The log names a tile as the door does** (`1`, `notes`), never by its raw id (`t-4cd672ed-…`).
- **Run:** nothing; the door picks it up at the next `ep0ch install --apply`.
