### A word after the title's chips doesn't stop your own stage change, and a fresh outline says all it needs at once (PIE-1760)

- **A word typed after the title's last chip:** your own `ep0ch work stage <id> doing` from another shell lands in the edit you have open. Before, it was refused with "isn't where it's saved in the draft". A saved chip is followed through the draft's edits to the one place it is now, and must still be that chip there, outside links and code: a line added above it only moves it; one deleted, or made into a link's label, is refused and nothing is written.
- **One answer for a fresh outline:** `ep0ch work create` names every missing piece in one refusal: the flags, the project's work queue (with the note that makes one) and the Work-ID prefix (with the command that sets it). Before, it refused four times in a row, one piece a run.
- **`ep0ch work prefix [<PREFIX>]`:** shows the Work-ID prefix new tickets take, or sets it (GATE makes GATE-001).
- **`--json` on the work commands:** accepted, as the help says; they already answer in JSON.
- **Run:** `ep0ch install --apply` (no protocol, grammar or schema change).
