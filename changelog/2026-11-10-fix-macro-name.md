### A saved macro says how to run it, and ^K runs it by its name (PIE-1727)

- **A recording is named for what it does:** `comment-on-planting-checklist`, titled "Recorded: comment on Planting checklist"; a second of the same is `-2`. No more `recorded-comment-note-nov10-183…` names that only differ at the end.
- **The save flash reads whole and stays:** "Saved comment-on-planting-checklist · run it from ^K · acts on “Planting checklist” · 1 action", for 12 s; the extension reload that loads the recording goes to the message log instead of replacing it (a background message never displaces one still up).
- **^K runs a script by any start of its name:** three letters or more, dashes or spaces (`comment-on-pl`, `comment on pl`, `seed`), ranks its run first, ahead of its own note; of several, the name before the title, then the newest number.
- **A refusal names the note by its title:** "no reader shows “Planting checklist”; open it first (open id=…)", not a UUID cut short.
- **yo's `[]` answer is lit when you edit it,** so a command typed replaces it instead of landing after `[]`.
- **The settings card's foot forgets a stale save:** after another writer changes the value, "saved · days: 14" goes and the card's keys show again.
- **A browser on the public link gets the page:** `Accept: text/html` without `?view=html` is HTML there too, as on the tailnet; curl and `?view=md` still get Markdown.
- **Run:** `ep0ch install --apply` (the door and the publisher take the new code; no PROTOCOL, GRAMMAR or schema change).
