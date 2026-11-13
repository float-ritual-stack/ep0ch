### The nightly's red that wasn't a bug in what Evan uses is gone (PIE-1791, PIE-1789, PIE-1785, PIE-1784)

- **A narrow ask row names its answer's tile again:** at 44 columns a row said `· answer in the note` with its answer tile below it and no `below ▾`. The side word no longer gives way to the warning; a row with no room beside its ask says all of it on a row of its own (the block count still gives way first while the row fits beside).
- **No test leaves a broken reader behind:** hint-clicks wrote `Any<Number>` into the reader's step key through Bun's `toMatchObject`, so elements' inline-view test went red after it in one run. CONTRIBUTING's recurring gotchas has the entry.
- **No test reads the status bar's trimmed words:** drawer-tiles reads the drawer from `layout.get` at 140 and 112 columns; status.test clicks the slow chip as the person (an agent's `status.speed` is a quiet read since PIE-1772); draft-patch's real pane is wide enough for the row's whole progress.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.
