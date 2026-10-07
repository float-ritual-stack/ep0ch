# Shout (a rule on a text pattern)

The forkable example for **rules** (PIE-600) matching a **text pattern**.

```text
Close the cold frame tonight!!!

  · • · · · • · · · · · • · · · · • · ·
  ·   CLOSE THE COLD FRAME TONIGHT   · ·      ← drawn in the line's place
  · · · • · · · · · • · · · · · · • · ·
```

- `match: { "text": "…(\\S.*?)\\s*!!!\\s*$" }`: tested line by line, never in a code fence, a code span, a literal
  region or a `[key::value]` token; `(?i)` at the start ignores case. The first group is `captures[1]`.
- `decorate: { "place": "replace" }`: the band is drawn instead of the line. The text is never changed, and `R` shows
  it raw. A narrow reader draws the band as a plain `##` heading.
- The same rule with no code is a rule note:
  `Shouting [rule-name::shouting] [rule-text::(\S.*?)!!!$] [rule-decorate::band] [rule-label::{$1}] [rule-pattern::dots]`.

Install: `outliner ext add shout`. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).
