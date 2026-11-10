### Settings are one screen: read, change, try (PIE-1709, PIE-1710)

- **The settings screen:** every extension's settings in one place, after Obsidian's: a list with a search over every setting on the left, the chosen extension's settings card on the right. Each setting says what it does, its value or its default, and which machine's config.json holds it.
- **Typed in place:** ⏎ edits a setting where it is; a command reads as one shell line and is saved as the words config.json wants. A value the schema refuses is said under the card, and the line keeps what you typed. `x` or `[↺]` puts one back to its default, `X` or `[↺ all]` every one.
- **Try it:** `t` or `[try]` runs the extension's own try. yo's runs its answer or act model once and says the answer, or why not in the model's own words ("Model not found: big-one") instead of "exited 1"; with no login, the command that stores one.
- **Found where you are:** the `⚙ settings` button on each extension's page, the power bar's `& settings <name>` row, and yo's failed answer open the screen at that extension (`ext.<id>.settings` with no fields).
- **Agents' deadlines are settings:** `agent.<name>.deadline` (tidy's, yo's 90 s), kept in config.json's `agents` over the manifest's; an answer stopped by its deadline says how to give it longer.
- **yo knows itself:** asked how to use it, how to set it up, or just "whats good", yo answers from its own page and settings with no model, and offers its settings button. "sue yo" reads as "use yo".
- **`act` takes `--ws` anywhere:** `ep0ch act ext.yo.settings --ws float-hub answer=…` reaches float-hub's door; before, the flag was read as an argument.
- **Run:** `ep0ch install --apply`, then `ep0ch ext update yo` (and tidy) so an installed copy gets yo's try and its new words.
