### The console and a claude.ai session read and write without dead ends (PIE-1702, PIE-1703, PIE-1704)

- **A web link to a PDF reads as a PDF:** `[web::…/paper.pdf]` opens in Detail with the PDF's text, as a `[file::…pdf]` does; an oversize one says the size limit a file says. The web provider's one media-type router sends an `application/pdf` answer down the PDF path, and the next read asks for a PDF from the start.
- **PgUp and PgDn page Detail's editor:** in edit and comment modes the cursor moves a page (the editor's drawn height) at its column, and the view moves with it.
- **A saved reply stays in view:** after a reply (or an edit of a comment) is saved, its thread stays selected and open, and its end, the words just written, is scrolled into view. No `]` to find it again.
- **Links draw as their labels outside Herdr:** a comment's controls (Reply, Edit, ‹ ›) and links in comments no longer print their addresses after them when Detail runs in a plain terminal.
- **Over MCP a note can start at the top and be refined in two calls:** `outline_create` takes `ref: "root"` over `ep0ch mcp` and the claude.ai connector, as the mod's `parent: root` does, and an applied create or patch answers with a top-level `revision`, the one the next `outline_patch` passes.
- **Run:** `ep0ch install --apply` (outliner and door; the host and every MCP server pick it up). PROTOCOL, GRAMMAR and the schema don't move.
