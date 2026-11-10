# Asks

Once a note an agent wrote goes quiet, the lines in it that still ask you for a decision are marked, so they turn up on your waiting list, each linked to its line. A tick, a reply or the note reaching done takes the mark off.

```text
- Should the shed face south or east?                         ← an agent wrote this, a minute ago
- Should the shed face south or east? [needs::sysop: Should the shed face south or east?] [asks.derived::1x2y3z]
                                                              ← written by ext:asks, once
```

## What you do

- **See them:** any view with `needs` and `[property-scope::all]`, such as Waiting on Evan. Each row opens at its line.
- **The unsure ones:** `[maybe-needs::sysop]`, in the **Maybe asks** view under this page, and never on the waiting list.
- **Answer one:** tick its `- [ ]`, write a line under it, comment on it, or finish the note. The mark comes off.
- **Remove one:** delete the chip. That line is never marked again.
- **Keep a note out:** `[asks::off]` on its first line.

## What gets marked

Three passes, cheapest first. Each only hands the next what it can't rule out.

- **Code:** what can't be asking never reaches a model: a callout's header, a quote, a heading, a table row, code, and a bare `Decision:`, `Check:` or `Note to self:` line.
- **Jev, generous:** separate questions per line, combined in code: is it addressed to you, does it ask you to decide or do something, is it answered in what follows, is it a record. It's only the first pass.
- **A bigger model confirms:** the lines Jev passes, in one call for the note, each a yes or no. It reads the title, the section and what follows.

| Jev: addressed and asking | Answered, or a record? | Top `- [ ]`? | The model | Written |
|---|---|---|---|---|
| both 0.5 or over | no | no | yes | `[needs::sysop: the line]` |
| both 0.5 or over | no | no | no | nothing, and it isn't asked about again unless its words or its heading change |
| both 0.5 or over | no | yes | not asked | nothing, it's filed |
| the lower 0.3 up to 0.5 | no | either | not asked | `[maybe-needs::sysop]`, unconfirmed |
| the lower under 0.3 | either | either | not asked | nothing |
| either | yes | either | not asked | nothing |

## Good to know

- **Only after an agent's save.** A note you alone wrote is never marked, and a chip goes on a line once, however often it's saved.
- **A chip you wrote is yours.** Only the chip an `[asks.derived::…]` on its line names is taken off; if you edit that chip's words it's yours too.
- **A comment answers what it's on:** the line its words are on, a checklist item's line, or, on the whole note, every mark.
- **Left out:**
  - comments, proposals, snapshots, views, tool bookkeeping and EchoNet copies (`[from::…]`);
  - records: a permission ask, a proof, a day's log, what landed, a decision. The settle rule's query in `extension.json` lists them, and it's yours to edit;
  - the workboard's own notes: a roadmap item, a delivery, a validation plan (`type`). Their lines describe the work ("Evan opens…", "Done when:"), so code leaves them out before Jev reads a line, and a mark already on one comes off at its next save. A question about a ticket is a `[needs::sysop: …]` its writer puts there;
  - notes closed or parked, by any of these:
    - `status`: done, closed, answered, decided, resolved, shipped, complete or verified
    - `work-stage`: done, superseded or later
    - `outbox=done`, or an `answered` property
- **Reaching one of those keys** takes the note's marks off too.
- **A line you've seen is yours:**
  - not marked: a line still as it was at your last save, tick or comment on the whole note, and a line a comment of yours is on;
  - marked: what an agent writes after that, the same words under another heading too.
- **Jev reads it in place:** the line's heading, the item it's under and the lines either side.
  - Not marked, whatever its words: a line that reports what happened, says it's already answered, or speaks to someone else, such as an agent's own checklist.
- **Jev or the model can't be asked?** Nothing is written, not even the maybes: a failed call is never a yes or a no.
  - The rule's last run says why, and the next save tries again.
  - `ep0ch review asks` names the note and exits 1.
- **What it costs:** about half a cent a note Jev passes anything on, on Sonnet. A note Jev passes nothing on makes no call.
- **While you're typing there,** it comes as a proposal beside the note instead; dismiss it and that line isn't asked about again.
- **What it remembers:** a `[machine::asks]` record under this page for each line it marked.

## Over past notes

```sh
ep0ch review asks --since 30d --ws pie            # dry run: prints what it would write
ep0ch review asks --since 30d --ws pie --write    # writes it
```

It reads the whole window, however many notes, and marks the confirmed lines only: the Maybe lane is for what was just written. A dry run calls the model too, so it lists what `--write` would write, and under it what the model turned down.

## Setup

- **Install:** `ep0ch ext add asks --outline-folder ~/outlines/<name>`, for each outline you want it in.
- **Remove:** `ep0ch ext remove asks --demo remove`. Chips already written stay until you take them off.
- **The model:** `config.answer` is the command that confirms: the prompt on stdin, a JSON yes or no per line on stdout.
  - **Its default:** Sonnet through `claude` in safe mode.
    - **What loads:** no CLAUDE.md, skills, plugins, tools, MCP or settings.
    - **What that saves:** about 900 tokens on top of the prompt; a bare `claude -p --tools ""` carries about 245,000.
    - **What it needs:** a `claude` whose `--help` lists `--safe-mode`; an older one fails the call, and nothing is written.
  - **To change it:** `ep0ch act ext.asks.settings answer='…'`.
  - **Where `claude` can't read its login,** such as a host under launchd: start the command with `with-secrets claude --`.

## How it's made

| Need | The part that's there |
|---|---|
| Can this line ask at all? | `structuralLines` in outline-core's write shape, over its callout, quote and code parsers |
| Does Jev pass it? | `blocks.asks`: per line, the questions in `write-review.json` with the line's place in the note; `askLine` is the truth table |
| Is it really waiting on you? | `config.answer`, tidy's command contract, one call a note; the wording is `asks-confirm.ts` |
| What you've answered | the revisions and your comments, compared line by line in `settle` |
| After it settles | a rule's `on` with `quiet: 1m` and `from: ["agent"]` |
| Clearing | a rule over `asks.derived` with `propertyScope: all`: `stop` hears a tick, `change` the rest |
| A comment | a rule over annotations, from you alone |
