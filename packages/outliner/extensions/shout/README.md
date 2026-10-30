# Shout

A line ending in `!!!` is drawn as a band, in capitals. The text itself is never changed.

```text
Close the cold frame tonight!!!

  · • · · · • · · · · · • · · · · • · ·
  ·   CLOSE THE COLD FRAME TONIGHT   · ·      ← drawn in the line's place
  · · · • · · · · · • · · · · · · • · ·
```

## What you do

- **Shout:** end a line with `!!!`.
- **See it raw:** press `R`.
- **Quiet it:** take the `!!!` off.

## Good to know

- **Code is left alone.** It never matches in a code fence, a code span, a literal region or a `[key::value]` token.
- **Narrow readers** draw the band as a plain `##` heading.

## Setup

- **Install:** `outliner ext add shout`.

## For builders

This is the forkable example for **rules** matching a **text pattern**. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).

- **The match** is `{ "text": "…(\\S.*?)\\s*!!!\\s*$" }`, tested line by line.
  - `(?i)` at the start ignores case. The first group is `captures[1]`.
- **The draw** is `decorate: { "place": "replace" }`: the band replaces the line.
- **The same rule with no code** is a rule note:
  `Shouting [rule-name::shouting] [rule-text::(\S.*?)!!!$] [rule-decorate::band] [rule-label::{{match[1]}}] [rule-pattern::dots]`.
