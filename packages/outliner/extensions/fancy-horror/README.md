# Fancy Horror

A sign's weekly dread, drawn as a card with omens you can ward off. All omens are made up.

```text
fancy-horror:: virgo
  ▌ Virgo: week of 2026-09-28   [uneasy]
  ▌ 2 omens still at large
    Dread  5 / 10    This week  ▃▅▂▇▄▁▆
    Dread  █████░░░░░  5/10
    [x] a door that closes by itself
    [ ] three crows on the phone line
    [ ] a cat that watches the hallway
```

## What you do

- **Ask for a sign:** write `fancy-horror:: virgo` on a line, any zodiac sign in lowercase.
- **Ward off an omen:** press `w` on the line. The next omen is ticked.
- **Keep the card:** the service's `keep` writes the current rendering as a block.

## How it works

- **Warding is a block.** `ward` writes `Warded off …` as a child block, attributed to `ext:fancy-horror`.
  - The next run reads the children and ticks that omen, so the state lives in the outline.
- **From an agent or a shell:** `ext.fancy-horror.ward`, or `outliner ext act fancy-horror ward --block <id>`.

## Setup

- **Install:** `outliner ext add fancy-horror`.

## For builders

This is the example for **kind 3, a rich component**. See [the four kinds](../../docs/extensions/README.md).

- **Data and a view.** The extension returns its data and a view composed from the shared primitives.
  - Those are card, badge, stat, bar, checklist, sparkline and row.
- **No client code.** Every client draws the primitives, so this folder has none.
- **Targets.** `extensions.render` gives `markdown`, `blockdown`, `html`, `json` (the data), `csv` (rows) or `terminal`.
  - A reader that draws primitives takes `view` instead.
