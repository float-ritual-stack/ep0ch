# Moon

The moon's phase on a date, written into the note as a real block. It is worked out from the date, with no network or account.

```text
moon:: 2026-10-01
  └─ Moon on 2026-10-01: Waxing Gibbous        ← a real block, owned by ext:moon
     [moon.key::2026-10-01] [moon.phase::Waxing Gibbous] [moon.illumination::73%] …
     73% lit, 9.4 days since the new moon.
```

## What you do

- **Ask:** write `moon:: 2026-10-01` on a line.
- **Find dates:** `moon.phase=Full Moon` in a saved view finds every full-moon date you wrote.
- **Refresh:** press `r` on the line.

## Good to know

- **It acts as if you copied it in.** The record shows in backlinks and embeds like any block.
- **Only the extension writes it.** An edit to the record is refused with a reason.
  - Your own notes and `[phase::]` go on the block that asks.
- **One record per date.** Two lines for one date share it.
  - Delete the last line and it goes to Trash, restorable.

## Setup

- **Install:** `outliner ext add moon`.

## For builders

This is the small example for **kind 1, data put into a block**. See [the four kinds](../../docs/extensions/README.md).

- **`read` returns a record,** and the service keeps it as one block the extension owns, with namespaced properties.
- **Fetching.** `effects: read` fetches when the line is saved and the record is missing.
  - A handler can set `staleAfter` to refetch older copies on open.
- **The full one** is Jira (`extensions/jira`): a remote record with comments, a poll and a Resource snapshot.
