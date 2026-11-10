### The outliner keeps what it's told, in order, under one clock and one id (PIE-1689, PIE-1690, PIE-1691)

- **Tickets and captures made at once list in the order they were made:** a roadmap item, a capture and an extension's new record take the store's creation clock, so three made in one millisecond keep their order.
- **A text filter folds case the same on every path:** `Ünïcode` matches `ünïcode` in a ranked view as in any other query (outline-core's `textHoldsTerms`), and a note's selection leaves its trashed children out however it's read.
- **A comment on a file keeps one id:** Detail and the service name a file's snapshot alike, so a comment made in Detail is found where it was made.
- **A refresh failure reads the same from every source:** an oversize PDF is `PDF exceeds N bytes` (invalid input) from a file or the web; a remote ticket's refresh overtaken by a move says so, as the web's does; a web page is read in the charset it names.
- **Detail keeps what came meanwhile:** saving a reply or a comment's edit loads the change that arrived while you typed, the completion list closes on save, and page up and down move by the rows Detail draws (one more with a subtitle) in the note, a file, the editor and the comments.
- **Run:** `ep0ch install --apply`. PROTOCOL, GRAMMAR and the schema don't move.
