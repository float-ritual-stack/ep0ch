### A write that changes two places far apart draws both, each under its heading (PIE-588)

- **Each changed part is drawn:** a create, edit or patch answers with `view` holding every part it changed, not one first-to-last span cut at 40 rows, so a patch on line 3 and line 60 of a 60-line note shows both. Parts within six lines of each other are one.
- **Each part under its heading:** a heading near its change starts the part; a far one is drawn as a line of its own above it.
- **The parts share the 40 rows:** a short part keeps all of its rows and a long one is cut to its share with `⋮ n more rows` under it, so no part is left out for one before it. Past four parts, `viewOf` names the lines not drawn and the `ep0ch show … --lines` command that draws them.
- **`ep0ch show --lines` takes several parts:** `--lines 2-3,60` draws those source lines under the note's header, sharing `--rows`, a `⋮` between.
- **Run:** nothing. PROTOCOL, GRAMMAR and the schema don't move.
