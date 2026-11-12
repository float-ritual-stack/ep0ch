### A property stamp on a note you're typing in is saved and lands in your draft (PIE-1756)

- **Saved at once, and in your draft:** an extension's or agent's `properties.patch` (`set`/`add`) on a note a door holds a draft of is written to the saved note and into the draft in one step, lit `@who · just now` on the chip line. The draft stands on the new revision, so it never reads "changed elsewhere" and one ctrl+s saves your words on top. Before, the stamp was a whole-text write: ctrl+s was refused and the typed line went to a drafts file.
- **Nothing waits in the draft:** esc, a discard, a crash or the door going away all leave the stamp saved, and the answer, the board and `work_stage` say what's saved. An edit that holds only a stamp closes on one esc.
- **Under the title is fine:** a chip-only change may land on another line of the paragraph being typed in. On the cursor's own line, or while a save is under way, it is refused and nothing is written.
- **Undoing a stamp is your change:** ctrl+z on a stamp, then ctrl+s, asks "this save changes properties" first, since the save would take a saved value back.
- **A door that holds the note and stops answering refuses the stamp,** and nothing is written. The person's own property writes (a card moved, the props panel, Detail) are store writes, as before.
- **Extensions may send `properties.patch`** over their connection, as `ext:<id>` (the call reference lists it). A note nobody holds is written by the store as before.
- **Run:** `ep0ch install --apply` (host and door together: PROTOCOL bumps, since the door's hold is asked with a new `standsOn`; no grammar or schema change).
