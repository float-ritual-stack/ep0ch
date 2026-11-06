# Asks

Once a note an agent wrote goes quiet, the lines in it that ask you for a decision are marked, so they turn up on your waiting list, each linked to its line. A tick, a reply or the note reaching done takes the mark off.

```text
- Should the shed face south or east?                         ← an agent wrote this, a minute ago
- Should the shed face south or east? [needs::sysop: Should the shed face south or east?] [asks.derived::review]
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
- **A chip you wrote is yours.** Only one with `[asks.derived::review]` beside it is ever taken off.
- **Left out:** comments, proposals, snapshots, views, tool bookkeeping, EchoNet copies (`[from::…]`) and notes already done.
- **Jev can't be asked?** Nothing is written; the rule's last run says why and the next save tries again.
- **While you're typing there,** it comes as a proposal beside the note instead.
- **What it remembers:** a `[machine::asks]` record under this page for each line it marked.

## Over past notes

```sh
ep0ch review asks --since 30d --ws pie            # dry run: prints what it would write
ep0ch review asks --since 30d --ws pie --write    # writes it
```

## Setup

- **Install:** `ep0ch ext add asks --outline-folder ~/outlines/<name>`, for each outline you want it in.
- **Remove:** `ep0ch ext remove asks --demo remove`. Chips already written stay until you take them off.

## How it's made

| Need | The part that's there |
|---|---|
| Does this line ask? | `blocks.asks`: the write review's candidates, prompt and thresholds, per line |
| After it settles | a rule's `on` with `quiet: 1m` and `from: ["agent"]` |
| Clearing | a rule over `asks.derived` with `propertyScope: all`: `stop` hears a tick, `change` the rest |
| A comment | a rule over annotations, from you alone |
