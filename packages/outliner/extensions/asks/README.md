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

| The review's Jev says | A top `- [ ]`? | Written |
|---|---|---|
| 0.7 or over | no | `[needs::sysop: the line]` |
| 0.7 or over | yes | nothing, it's filed |
| 0.3 up to 0.7 | either | `[maybe-needs::sysop]` |
| under 0.3 | either | nothing |

## Good to know

- **Only after an agent's save.** A note you alone wrote is never marked, and a chip goes on a line once, however often it's saved.
- **A chip you wrote is yours.** Only the chip an `[asks.derived::…]` on its line names is taken off; if you edit that chip's words it's yours too.
- **A comment answers what it's on:** the line its words are on, a checklist item's line, or, on the whole note, every mark.
- **Left out:**
  - comments, proposals, snapshots, views, tool bookkeeping and EchoNet copies (`[from::…]`);
  - records: a permission ask, a proof, a day's log, what landed, a decision. The settle rule's query in `extension.json` lists them, and it's yours to edit;
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
- **Jev can't be asked?** Nothing is written; the rule's last run says why and the next save tries again.
- **While you're typing there,** it comes as a proposal beside the note instead; dismiss it and that line isn't asked about again.
- **What it remembers:** a `[machine::asks]` record under this page for each line it marked.

## Over past notes

```sh
ep0ch review asks --since 30d --ws pie            # dry run: prints what it would write
ep0ch review asks --since 30d --ws pie --write    # writes it
```

It reads the whole window, however many notes, and marks the sure lines only: the Maybe lane is for what was just written.

## Setup

- **Install:** `ep0ch ext add asks --outline-folder ~/outlines/<name>`, for each outline you want it in.
- **Remove:** `ep0ch ext remove asks --demo remove`. Chips already written stay until you take them off.

## How it's made

| Need | The part that's there |
|---|---|
| Does this line ask? | `blocks.asks`: the write review's candidates, prompt and thresholds per line, with the line's place in the note and the questions that rule it out |
| What you've answered | the revisions and your comments, compared line by line in `settle` |
| After it settles | a rule's `on` with `quiet: 1m` and `from: ["agent"]` |
| Clearing | a rule over `asks.derived` with `propertyScope: all`: `stop` hears a tick, `change` the rest |
| A comment | a rule over annotations, from you alone |
