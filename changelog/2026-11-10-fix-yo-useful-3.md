### yo's answers stay with their asks, and a press while typing has one rule for the keys (PIE-1711, PIE-1728)

- **One rule for a button pressed while you type:** a step that shows something (open in facets, the links, a tile it opens) opens beside your edit, and the keys stay where you write. A step whose purpose is typing (▸ edit the query) takes the keys to the line it opens.
- **An answer belongs to its ask line:** type on, then back, and the line's answer is for what it says now. The answer to the undone words goes, and its buttons with it. The same words on a new line are always answered.
- **A no-answer isn't remembered:** an answer marked `retry` (yo's "Jev is not configured", a model that couldn't run) is asked again when its line is written again, never served from what was kept. Agents can say so (`retry: true` beside `reply`).
- **Two asks in the same words each show their own outcome:** an ask's progress names which line (`AskProgress.nth`), so the second's "not applied" no longer covers the first's answer.
- **After ^S the answer tile shows the answer in the note,** and the links' preview is titled by the note it shows.
- **Run:** `ep0ch install --apply` (host and door together).
