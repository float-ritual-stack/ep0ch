### Agents get the right answer the first time: find, show, skills and the write review (PIE-1714, PIE-1715)

- **`ep0ch find --limit n`** prints the first n of any listing and says on stderr when it cut one.
- **Words written as a query are the query:** `ep0ch find type=errand` lists the errands, says on stderr that it read them as `--query`, and never falls back to a word search's guesses; `--lexical` searches them as words.
- **An empty query says so:** `no notes match type=nothing`, with the service's nearest keys when the key is one nobody wrote.
- **A refusal names the call:** a flag find doesn't take is one line with the nearest one and `ep0ch help find`, never a screen of usage; `needs~sysop` says `~` reads only `title~` and `text~` (outline-core's hint, so the mod and MCP say it too), and find's second line is `ep0ch find --query "needs=sysop" (that value), or ep0ch find --query needs (any value)`.
- **`ep0ch --skill <name>` prints the skill;** `--path` prints its file.
- **`ep0ch --showcase --prepare`** seeds the showcase and exits: the headless path, in `ep0ch --help` and the ep0ch-core skill.
- **The daily-brief skill reads through `ep0ch find … --json`,** from any folder and any machine.
- **A write's review speaks about what the write changed:** one owner (`writeScope`) decides Jev's sections and lines, `judged`, and which of code's findings are the write's; an old finding in a section a patch didn't touch is carried, never the patch's to fix.
- **The count rule reads prose as prose:** "2,000 notes" is no "000 notes", a dotted key (`style.border=line`) is never a count, "notes" counts every note rather than `kind=note`, and "4 in review" reads only a state key (`work-stage`, `status`), never `kind=review`.
- **A bold-led line that explains a feature isn't an ask:** `- **A choice is boxes:** … you answer with approve …` is filed in code, never marked `[maybe-needs::sysop]`.
- **`ep0ch review asks` says a failing model command once, whole, and stops:** the asks extension refuses in its own words (no stack), the host keeps an extension's last 1,200 characters of stderr, and a failure every note shares stops the run instead of failing each one.
- **Run:** `ep0ch install --apply` (door, outliner, outline-core; its built-ins step refreshes each outline's unchanged copy of asks, and names a changed one for `ep0ch ext update asks`). PROTOCOL, GRAMMAR and the schema don't move.
