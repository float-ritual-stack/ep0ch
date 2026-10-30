# Horoscope

A made-up horoscope for a sign, shown under the line that asks for it.

```text
horoscope:: virgo
  └─ Horoscope virgo · ran 09:12              ← drawn under the line, not written into the note
     Virgo, 2026-10-01. The kettle knows something you don't.
     - Advice: Say yes to soup.
```

## What you do

- **Ask:** write `horoscope:: virgo` on a line, any zodiac sign in lowercase.
- **Tomorrow's:** add `--day=tomorrow`.
- **Shorter:** add `--short`. Readers may show less.
- **Run it now:** press `r` on the line.
- **Keep it:** the `keep` action writes the result under the line as a real block, attributed to `ext:horoscope`.
  - Door: `ext.horoscope.keep`. Shell: `outliner ext act horoscope keep --block <id>`.

## How it works

- **It runs on its own** when you save the line and when you open the note. It runs only if one of these holds:
  - It has no result yet.
  - Its result is more than an hour old (`staleAfter`).
  - The extension's version changed.

## Setup

- **Install:** `outliner ext add horoscope`.
- **Remove:** `outliner ext remove horoscope`.

## For builders

This is the tutorial for **kind 2, inline output**. See [the four kinds](../../docs/extensions/README.md).

- **The service runs a handler** and keeps its markdown under the line that asks. `effects: read`.
- **`--day` is a fetch option:** a different value is a different call.
- **`--short` is a display option:** it never reaches the extension, so it shares the result.
