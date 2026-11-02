# What changed

The notes others changed since you last looked, as a tile the service draws (PIE-647; an extension since PIE-1506).

- **Open it:** alt+o on any screen, or a click on the status bar's `+N new`: the list comes up in your drawer, and looking marks what it holds seen.
  - The door keeps the count and your seen position; this extension draws the rows.
  - `^W o W` opens one on the desk, `act tile.open kind=what-changed.list` too (`with='{"since":"2026-11-01T00:00:00Z"}'` lists from a time).
- **In it:** j k pick a row (the preview follows), ⏎ opens the note where opens land, alt+⏎ in a new detail, / filters the rows.
  - Rows you haven't looked at wear ●. Your own edits are never listed; tools' bookkeeping and extensions' writes are held back until the menu's `changes.machinery` shows them.
- **In a note:** `what-changed:: since=2026-11-01T00:00:00Z` draws the same list there.
- **Install:** the power bar's `&what-changed` row, or `ep0ch act extensions.install id=what-changed`. Without it, alt+o says so and the count still shows.
- **Remove:** `ep0ch act extensions.uninstall id=what-changed demo=keep`.

## How it's made

| Need | The part that's there |
|---|---|
| The rows | `tools.outline_changes` (one row per note at its latest change, newest first) from a `// ep0ch-script mode=render` file |
| The tile | `extension.json` `tiles[]` with `render: "what-changed"` (PIE-1506): the door's ServiceTile draws the view, its `list` is the door's one ListView |
| The count, the seen position | the door's own (`src/desk/what-changed.ts`, the status bar's `+N new`): `changes.open` hands `since` and `unseen` to the tile as its args |
| Opening a row | the row's `do: { open }`: where this tile's opens land, as every list's |
