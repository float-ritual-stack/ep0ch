### Asking a slow agent again never takes the door offline, and tidy cleans the whole transcript (PIE-1737)

- **R answers at once:** asking an `@name` line again (the door's `R`, Detail's `r`, `act projection.refresh`) answers as soon as the agent is running, and the line says `running · working…` until the answer lands. The door keeps opening notes, going up and reading while a 60 s agent works; before, its host connection waited out the whole run (up to the deadline) and opens said "offline".
- **"The transcript" is the whole note:** `@tidy clean up the transcript` (or `the note`) takes everything above the ask, blank lines between turns included, and the line says what it took (`· the whole note above the ask`, `· the 3 lines above the ask`).
- **A passage said twice is cleaned where it was read:** tidy sends the passage's range, and a patch with a range rebases onto a note saved meanwhile even when the passage now appears twice.
- **A refusal says its cause:** a patch the note won't take says why ("is in the note more than once; give its range") with the revision it was read at, and its kind is `ambiguous` rather than "changed since you read it".
- **A script that answers `@name` and writes nothing says it on the line only:** `@beside` with nothing beside reads `beside @beside · nothing · No note is beside this card.`, with no copy under the line.
- **Removing an extension keeps its settings:** its `config.json` waits in `extensions-settings/<id>.json` beside the extensions folder, and installing it again takes it back; the status line says "its settings kept for a reinstall" and "your settings from before are back".
- **Tidy has a demo:** a made-up meeting transcript under its page whose ask waits for your `R`; an extension's demo never asks its own agent on install.
- **Run:** `ep0ch install --apply` (host and door together; PROTOCOL bumps at merge).
