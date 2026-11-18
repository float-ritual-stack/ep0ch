# Waiting

Waiting on others: every outbox item still waiting for an answer, grouped by who it waits on, the longest wait first (the door's built-in screen until PIE-1525; an extension since).

- **Open it:** O on the main menu, `ep0ch --screen waiting`, or `act screen.open name=waiting`.
  - The list sits beside a reader; j k pick a row and the reader shows it (the list's select wire).
  - ⏎ opens the item where opens land; / filters the rows.
  - `act tile.open kind=waiting.list` opens the list as a tile anywhere (it takes no `^W o` key: O is never one, and W is What changed's).
- **What waits:** a note with `[type::outbox-item]` and `[outbox::waiting]`.
  - `[waiting-on::Ada: which shelf do the jars go on?]`: the name before the colon is the group, the rest the question; without it, `[to::…]` and the title.
  - `[sent::2026-01-05 4:23 PM]` (a date as people write it) is when the wait began; without it, when the note was written.
  - A wait past three days is drawn as a warning; `warn-days` in its settings says another number (the bar's Extensions, "Settings of Waiting", or `act extensions.configure id=waiting warn-days=7`).
- **In a note:** a `waiting::` line draws the same list there.
- **On by default:** a default-on built-in (`defaultOn` in its manifest): the host installs it at start wherever it runs, unless you uninstalled it there.
- **Remove:** the extensions screen's row (ctrl+k, then `&`), or `ep0ch act extensions.uninstall id=waiting demo=keep`.
  - The main menu's O row and the waiting screen go with it; `ep0ch --screen waiting` then says how to bring it back.
  - It stays off until `ep0ch act extensions.install id=waiting`, which brings both back with no restart.

## How it's made

| Need | The part that's there |
|---|---|
| The rows | `query()` over `type=outbox-item outbox=waiting` from a `// ep0ch-script mode=render` file; `date()` reads `sent` as the views read a date |
| The tile | `extension.json` `tiles[]` with `render: "waiting"`; `replaces: ["waiting"]`, so a layout saved with the old built-in kind opens this one |
| Its title | the list's `title` ("outbox · 3 waiting on 2 people"), the tile's frame |
| The screen and its menu row | `screens[]`: the list beside a reader, wired to show what it picks, with `menu: { key: "O", label: "Waiting" }` |
| Its setting | `configSchema` in `extension.json` (`warn-days`): the service hands a script its extension ships that extension's settings as props (`props["warn-days"]`), each its default when unset |
| The demo | `demo/`: made-up asks carrying only `[demo::waiting]` (no outbox type, so no real view lists them), drawn by `waiting:: demo=only` |
