# Done stamp

When a note becomes done (`status=done`, `work-stage=done` or `outbox=done`), it gets the date stamped on it, so one `done-at` finds today's to-dos, tickets and drafts together. If it reopens, the stamp comes off.

```text
Mend the water butt [status::todo]
  → set status to done, and two seconds later:
Mend the water butt [status::done] [done-at::2026-03-11]      ← written by ext:done-stamp, asked by you
```

## What you do

- **Finish a note:** set `[status::done]`, `[work-stage::done]` or `[outbox::done]`. Two seconds after you stop typing, `[done-at::<date>]` appears, the day on this machine's clock.
- **Reopen it:** change it so none of the three holds. The stamp comes off.
- **Stamp by hand:** `outliner ext act done-stamp stamp --block <id>`.

## Good to know

- **Its writes are the extension's:** `ext:done-stamp`, with `requestedBy` the one whose save set them off.
- **No loops.** A save any extension makes never sets a rule off.
  - Stamping writes the block again, and nothing runs.
- **Tickets are stamped twice over, harmlessly.** The store stamps a roadmap item itself as its stage moves (`work-stage-follows.ts`); this rule then finds the stamp there and writes nothing.
- **Existing notes are left alone.** Installed over notes already done, it runs nothing for them and starts from what matches now.

## Setup

- **Install:** `outliner ext add done-stamp`.

## For builders

This is the forkable example for **rules** with **`on`**: when a block starts or stops matching, run this. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).

- **The rule:** `match: { "query": "status=done OR work-stage=done OR outbox=done" }` (one rule over every done key, so the stamp stays while any of them holds; add yours to the query), `on: { "start": "stamp", "stop": "unstamp", "quiet": "2s" }`.
- **How it fires.** The service watches the change feed.
  - Once the block has been quiet for 2 seconds it compares what it matched before with what it matches now.
  - `change` runs an action on every save while it matches.
- **The actions are ordinary ones,** `stamp` and `unstamp`.
