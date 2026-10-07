# Meeting card (a rule that decorates)

The forkable example for **rules** (PIE-600) with **`decorate`**: "when a block matches this, draw this on it".

```text
Allotment committee [type::meeting] [when::Sat 10:00] [where::the shed] [attendees::Ann, Bo, Cy]

  ▌ Allotment committee  [meeting]            ← drawn above the block, not written into it
  ▌ Sat 10:00 · the shed
    Who  Ann, Bo, Cy     Notes  2 · 1 open
```

- `match: { "property": "type=meeting" }`: the service's own query matcher decides (any saved-view query works:
  `"query": "type=meeting AND where=\"the shed\""`).
- `decorate: { "place": "above" }` with no `use`: the service runs `meeting-card.ts` (`operation: "decorate"`) with
  the block and its children, and keeps the view it returns until the block's revision changes.
- Change `[type::meeting]` to anything else and the card goes; the text was never touched. `R` in the door shows the
  note as written.

Install: `outliner ext add meeting-card`. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).
