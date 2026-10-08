# Glyphs (a bar source)

The example for a **bar source** (PIE-656): rows for a client's command palette, the door's power bar (`ctrl+k`).
Typing `~` then a word (`~shade`, `~double`, `~177`) asks this extension's `bar` operation, and its rows join the
bar's list. The glyphs are code page 437's shades, blocks and box lines, named as an ANSI artist names them.

```text
~ shade
  ░  light shade        CP437 176 · U+2591
  ▒  medium shade       CP437 177 · U+2592
  rule “Bike shed” with ▒   writes a line of it under the note
```

- **The rows** come from `glyphs.ts`'s `bar` operation: `{ rows: [{ id, label, detail?, preview?, block?, action?,
  args?, copy? }] }`. The service checks them (at most 50; text cleaned; a `block` must exist; an `action` must be one
  of the extension's own, acting on `bar` or on the row's `block`) and answers them through `extensions.bar`.
- **Picking a row** is the client's: `copy` goes to the clipboard, `block` opens where opens land, `action` runs
  through `extensions.act` like any of its actions (here `rule`, which writes a line of the glyph under the note the
  person is on, attributed to `ext:glyphs`).
- **The preview** on the bar's right is the row's `preview`, Markdown the client draws with its own renderer.
- **Context:** the call sees the note in front of the person as `context` (bounded and read-only, as an action's).

Install: `outliner ext add glyphs`. See [the four kinds](../../docs/extensions/README.md#bar-sources-a-command-palettes-rows).
