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
- **Format:** bare `@tidy` or `@tidy all` runs the formatter once you leave the line (or save) and it has been quiet for a moment.
  - It sets bullets as `-`, one space after list markers and `#`, no runs of spaces, no trailing spaces, and two spaces per nesting level.
  - Links, references, properties and code are never touched; `all` never includes the title.
- **Rewrite:** `@tidy <instruction>` rewrites the paragraph or list above, such as `@tidy remove the cruft and wrap each item in a callout`.
  - It returns one patch, not a chat answer.
- **The whole note:** an instruction that names `the transcript` or `the note` (`@tidy clean up the transcript`) takes everything above the ask, blank lines between turns included (PIE-1737).
  - Earlier `@name` lines and their answers in it stay as written.
- **See what it did:** the line shows a result such as `formatted 2 lines`, or `nothing to tidy above`.
  - With an instruction it also says what it took: `· the whole note above the ask`, or `· the 3 lines above the ask`.
- **Ask again:** press `R` on the line (Detail's `r`).
  - It answers at once and the line says `running · working…`; the door keeps reading and opening notes while it runs.
- **Typing in that passage?** While your draft is open, tidy's edit becomes a proposal beside the note, drawn under the line; apply or dismiss it.
  - **An edit you saved there while it ran** isn't overwritten: nothing is changed, the line says the note changed while @tidy worked on it, and `R` runs it again on the new text (PIE-1740).
- **Missed its deadline?** The line names the command that gives it longer, more than double what this run went (`ep0ch act ext.tidy.settings agent.tidy.deadline=2m` after a 30 s stop); run it and press `R` (PIE-1740).

## Good to know

- **Agents can't set each other off.** A `@tidy` line an agent wrote lands held (`held: <agent> may not wake @tidy · ask again to send`) until a person asks again (the door's `R`, Detail's `r`).
- **A passage said twice is fine.** Tidy sends where it read the passage (its range), so a turn the transcript repeats is cleaned where it was asked, even when the note was saved meanwhile.
- **Its demo** (written under its page when it's installed) is a made-up transcript whose ask waits for your `R`.
- **Counts are real.** The formatter's message names actual changes, such as `fixed nesting in 3 items, trimmed 1 line`.
- **Repeated asks share one run,** and each spelling of the line gets the result.
- **Edits are attributed:** `author: agent`, `ext:tidy`, `ext.tidy.agent.tidy` in the change feed.
  - They go through `draft.patch` with the `edit` policy.
- **Failures show on the ask line:** a failed command, invalid JSON or a missed deadline, and in the answer tile even with no answer fold.

## Setup

- **Install:** `ep0ch ext add tidy`, or the power bar's install row (`ctrl+k` then `&tidy`).
- **Remove keeps its settings:** `config.json` waits in `extensions-settings/tidy.json` beside the extensions folder, and installing it again takes it back (the status line says so).
- **The model:** `config.answer` in `config.json` names a command that reads the prompt on stdin and prints the answer.
  - **Its default:** Haiku through `claude` in safe mode, with a 5-minute deadline: a long transcript through a slower model fits (PIE-1713).
    - **What loads:** only the prompt, with no CLAUDE.md, skills, plugins, tools, MCP or settings.
    - **The whole command:** the door's settings row shows it.
    - **What it needs:** a `claude` whose `--help` lists `--safe-mode`; an older one fails the ask and says so.
    - **Where `claude` can't read its login** (a host under launchd): `with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN` once; with none, the ask says that command.
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
