### A property stamp on a note you're typing in lands in your draft (PIE-1756)

- **Your typing and the stamp both land:** a `properties.patch` (an extension's or an agent's `set`/`add`) on a note a door holds a draft of goes into that draft as one patch, lit `@who · just now` on the chip line; the draft never reads "changed elsewhere", and one ctrl+s saves both. Before, it was a whole-text write: ctrl+s was refused and the typed line went to a drafts file.
- **Stamps count from the draft:** a second stamp before the save reads the draft's value (`touches::2` → `3`), not the saved note's.
- **Under the title is fine:** a chip-only change may land on another line of the paragraph being typed in; on the cursor's own line it is refused, and nothing is written.
- **No "this save changes properties" for the agent's stamp:** the save's property check starts from it, so it still asks only about chips the person changed.
- **Extensions may send `properties.patch`** over their connection, as `ext:<id>` (the call reference lists it). A note nobody holds is written by the store as before.
- **Run:** `ep0ch install --apply` (host and door; no grammar or schema change; `properties.patch`'s answer gains an optional `draft` field).
