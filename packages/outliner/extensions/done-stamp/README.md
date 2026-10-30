# Done stamp

When a note's status becomes done, it gets the date stamped on it. If it reopens, the stamp comes off.

```text
Mend the water butt [status::todo]
  → set status to done, and two seconds later:
Mend the water butt [status::done] [done-at::2026-03-11]      ← written by ext:done-stamp, asked by you
```

## What you do

- **Finish a note:** set `[status::done]`. Two seconds after you stop typing, `[done-at::<date>]` appears.
- **Reopen it:** change the status. The stamp comes off.
- **Stamp by hand:** `outliner ext act done-stamp stamp --block <id>`.

## Good to know

- **Its writes are the extension's:** `ext:done-stamp`, with `requestedBy` the one whose save set them off.
- **No loops.** A save any extension makes never sets a rule off.
  - Stamping writes the block again, and nothing runs.
- **Existing notes are left alone.** Installed over notes already done, it runs nothing for them and starts from what matches now.

## Setup

- **Install:** `outliner ext add done-stamp`.

## For builders

This is the forkable example for **rules** with **`on`**: when a block starts or stops matching, run this. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).

- **The rule:** `match: { "property": "status=done" }`, `on: { "start": "stamp", "stop": "unstamp", "quiet": "2s" }`.
- **How it fires.** The service watches the change feed.
  - Once the block has been quiet for 2 seconds it compares what it matched before with what it matches now.
  - `change` runs an action on every save while it matches.
- **The actions are ordinary ones,** `stamp` and `unstamp`.
