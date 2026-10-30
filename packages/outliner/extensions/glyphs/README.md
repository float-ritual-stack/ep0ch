# Glyphs

Shades, blocks and box lines by name, in the power bar. Type `~` and a word to find one, then copy it or rule a note with it.

## What you do

- **Find one:** `ctrl+k`, then `~shade`, `~double` or `~177`.
- **Copy it:** pick the row and press enter.
- **Rule a note:** pick a row's action to write a line of that glyph under the note you're on.

```text
~ shade
  ░  light shade        CP437 176 · U+2591
  ▒  medium shade       CP437 177 · U+2592
  rule “Bike shed” with ▒   writes a line of it under the note
```

## Setup

- **Install:** `outliner ext add glyphs`.
- **The glyphs** are code page 437's, named as an ANSI artist names them.

## How it works

- **A bar source:** the `source` operation in `glyphs.ts` answers each `~` search with rows.
  - The `~` is the `prefix` in its `sources[]` entry.
- **Row shape:** `{ rows: [{ id, label, detail?, preview?, block?, action?, args?, copy? }] }`.
- **The service checks them:** at most 50, text cleaned, a `block` must exist, an `action` must be the extension's own.
- **Picking a row is the client's:** `copy` goes to the clipboard, `block` opens, `action` runs like any action.
- **The `rule` action** writes the line, attributed to `ext:glyphs`.
- **The preview** is the row's `preview`, Markdown the client draws.
- **Context:** the call sees the note in front of the person, bounded and read-only.
- See [the four kinds](../../docs/extensions/README.md#bar-sources-a-command-palettes-rows).
