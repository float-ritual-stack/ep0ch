### A Markdown web page and a file resource read, and the console's file journeys run green (PIE-1694, PIE-1695)

- **A `[web::…/notes.md]` page served as Markdown reads as its text** in Detail and the door, untouched by the HTML extractor; `text/plain` reads as text too, and a later refresh or a newer extractor leaves it as it was.
- **A page with no media type is read by its first bytes:** an HTML signature (`<html`, `<p`, `<!--`…) means HTML, other text (a Markdown autolink first too) is text, control bytes say "no media type, and the page isn't text". `, text/plain` (an empty type a server's default was added to) reads as `text/plain`.
- **Any other media type says what it was and what's read:** "unsupported media type: application/octet-stream (it reads text/html, text/markdown and text/plain)".
- **A relative `[file::notes.md]` is the outline's own folder's,** `<outlines>/<name>/`, written down in the README and the seeded "Follow files" note; a file above it (`../outside.txt`) is read, and its Source names the folder it is really in, "(outside this outline's folder)".
- **⏎ in Detail peeks the backlink drawn ▶ ACTIVE:** with nothing else focused, Enter opened nothing before.
- **The Herdr harness writes a scenario's files where the host reads them** (`session.outlineRoot`), so `file-commit`, `file-revisions` and `resource-authoring` pass; `resource-authoring` also reads a Markdown web page in Detail, and `herdr-console` opens the peek by ⏎ through Detail's own launch.
- **Run:** `ep0ch install --apply`. PROTOCOL, GRAMMAR and the schema don't move.

