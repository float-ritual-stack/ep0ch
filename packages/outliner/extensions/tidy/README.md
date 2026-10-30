# Tidy

Write `@tidy` on a line and the paragraph or list above it is tidied in place, or rewritten as you say.

```text
Morning plan
*  call the  printer people
-   **  order  ** paper
@tidy                              ← tidies the two lines above, as ext:tidy
```

## What you do

- **Pick it:** in the door, type `@` at the start of a line to see the agents, `@tidy` among them (PIE-592).
  - Choosing it writes `@tidy ` and you go on typing.
- **Format:** bare `@tidy` or `@tidy all` runs the formatter once the line has been quiet for a moment.
  - It sets bullets as `-`, one space after list markers and `#`, no runs of spaces, no trailing spaces, and two spaces per nesting level.
  - Links, references, properties and code are never touched; `all` never includes the title.
- **Rewrite:** `@tidy <instruction>` rewrites the paragraph or list above, such as `@tidy remove the cruft and wrap each item in a callout`.
  - It returns one patch, not a chat answer.
- **See what it did:** the line shows a result such as `formatted 2 lines`, or `nothing to tidy above`.
- **Ask again:** press `r` on the line.
- **Typing in that passage?** The edit becomes a proposal beside the note, drawn under the line; apply or dismiss it.

## Good to know

- **Agents can't set each other off.** A `@tidy` line an agent wrote lands held (`held: <agent> may not wake @tidy · r to send`) until a person presses `r`.
- **Counts are real.** The formatter's message names actual changes, such as `fixed nesting in 3 items, trimmed 1 line`.
- **Repeated asks share one run,** and each spelling of the line gets the result.
- **Edits are attributed:** `author: agent`, `ext:tidy`, `ext.tidy.agent.tidy` in the change feed.
  - They go through `draft.patch` with the `edit` policy.
- **Failures show on the ask line:** a failed command, invalid JSON or a missed deadline, and in the answer tile even with no answer fold.

## Setup

- **Install:** `ep0ch ext add tidy`.
- **The model:** `config.answer` in `config.json` names a command that reads the prompt on stdin and prints the answer.
  - The default is `claude -p --model haiku --tools ""`, with a 20-second deadline.
  - An empty command list turns the model off and says so.
- **Its answer:** JSON `{ "replacement": "the full rewritten passage", "message": "rewrote 4 items as callouts" }`.

## Resolving a stale proposal

- **What it does:** `outline_proposal_resolve` (service: `draft.proposal.resolve`) merges the proposal into the changed note.
  - It compares the proposal's original revision, the current note, and the original with the proposal applied.
  - The shared outline-core diff compares lines, then words within overlapping line changes.
- **Independent changes merge** without a model call.
- **Only conflicts go to the responder,** as `{ region_base, region_ours, region_theirs, proposal_note }`, with the proposer's note.
  - The same `config.answer` command answers `{ "replacement": "merged region" }` or `{ "ambiguous": "both readings in one line" }`.
  - A replacement fills only that region; an ambiguous answer leaves the whole proposal open with its reason.
- **Turn it on** by adding this rule note to the outline:

```text
Resolve stale proposals [rule-name::resolve-stale-proposals] [rule-on::tidy/resolve] [rule-match::type=proposal stale=true]
```

- **Off until then.** Pie and float-hub get it once their hosts and clients are updated together; nothing here changes either live outline.

## How it works

- **The write:** the router applies the merge through `draft.patch` with policy `prose`.
  - It keeps links, anchors, properties and the proposal's request-line boundary, and writes as `ext:tidy`.
- **The proposal** is marked resolved with a link and `[from::]` the proposer; resolved ones carry `[via-trigger::]`.
- **Undo:** `extensions.undo` takes the receipt back in one step; the door records it for Ctrl+Z in the reader.
  - Receipts last for this host process.
- **Staleness:** proposal creation and target edits maintain the proposal's `stale` property.
  - The rule engine supplies its ordinary quiet wait and loop guard.
- **A failed resolution** leaves the existing proposal open, never another proposal.
- **Structural operations** in an extension write group land in the same transaction and undo receipt.
  - A proposal with no text passage stays open for apply or dismiss.
- **A wire change** requires a protocol bump at final rebase.

See [the four kinds](../../docs/extensions/README.md#agents-in-the-note) of extension.
