### A missed deadline names one that fits, and R's refusals name their keys (PIE-1740)

- **The longer deadline fits the run:** an agent stopped at its deadline names one more than double what the run went, in whole minutes, at most 2h (a 30 s stop says `agent.tidy.deadline=2m`, a 60 s one `3m`); before, it said double the old deadline, so a 60 s tidy against 30 s missed again at `1m`. At 2h it names no longer one.
- **A failed ask says the key that asks again:** under the service's words of why, the line reads `R asks again` (your keymap's key when you rebound it).
- **Your save while it ran:** a refusal after an edit you saved in the passage says `the note changed while @tidy worked on it (revision 5, now 6): nothing was changed, and asking again runs it on the new text`; an agent that asked still hears what to send.
- **R with several lines that run:** the refusal names the key that steps onto one, as your keymap has it: `press ] to step onto one, then R`.
- **Tidy's README** says what an edit you saved gets, and what to do after a missed deadline.
- **Run:** `ep0ch install --apply` (host and door; no PROTOCOL, GRAMMAR or schema change).
