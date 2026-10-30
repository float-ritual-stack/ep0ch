# Meeting card

A card of when, where and who above every meeting note. The note's text is never touched.

```text
Allotment committee [type::meeting] [when::Sat 10:00] [where::the shed] [attendees::Ann, Bo, Cy]

  ▌ Allotment committee  [meeting]            ← drawn above the block, not written into it
  ▌ Sat 10:00 · the shed
    Who  Ann, Bo, Cy     Notes  2 · 1 open
```

## What you do

- **Get a card:** write `[type::meeting]` with `[when::]`, `[where::]` and `[attendees::]`.
- **Lose it:** change `[type::meeting]` to anything else.
- **See the note as written:** press `R` in the door.

## Setup

- **Install:** `outliner ext add meeting-card`.

## For builders

This is the forkable example for **rules** with **`decorate`**: when a block matches this, draw this on it. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).

- **The match** is `{ "property": "type=meeting" }`, decided by the service's own query matcher.
  - Any saved-view query works: `"query": "type=meeting AND where=\"the shed\""`.
- **The draw** is `decorate: { "place": "prepend" }` with no `use`.
  - The service runs `meeting-card.ts` (`operation: "decorate"`) with the block and its children.
  - It keeps the view it returns until the block's revision changes.
