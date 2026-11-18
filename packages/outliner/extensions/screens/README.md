# Screens

The screens and tile kinds every door ships, as data. Both doors read them the way they read any extension's:
`extensions.list` serves the tile kinds, `screens.list` the screens.

## What it holds

- **A tile kind** names the drawer that draws it and what a tile of it starts with.
  - `drawer` is `list` or `page`.
  - `fields` are its start: for a list, the source it lists `from`.
  - A new kind over a source that exists is a row here, never code.
- **A kind's description is for the person at the tile:** an empty tile says it, with what to do next. How a
  screen writes a tile of the kind is here, never there.
- **A reader** keeps the note opened into it.
  - `note: <id>` starts it on one.
  - `mode: pinned` keeps it there: an open aimed at it lands beside it.
- **A list about a note** is such a kind too: its links, its properties, its comments, its proposals, its revisions.
  - `from` names the producer.
  - `source: tile:<name>` on the tile names its reader, and `subject: follows` makes it follow that reader's note.
- **The keys and the components** are lists as well (`keymap`, `components`).
- **A screen** is a spec as a screen note holds one.
  - `start: true` marks the one a window with no arrangement of its own opens on.
  - `target` says which tile's field an argument fills.

```text
screen.open name=navigator target="type=bed"
```

## The kitchen

`screen.open name=kitchen` is the native window's kitchen sink: a screen whose tiles and toolbar show each part it
has, so a part can't quietly break where nobody looks. A part a door gains that a person can see is added to it.

- **Left:** the outline, the extensions, the outlines and the programs a door runs, each a list tile.
- **Middle:** a reader, with its properties and the last callers in tabs behind it.
- **Right:** the lists about the reader's note, each following the reader.
- **Toolbar:** the bar on the extensions, the outlines and the programs.
- **Toolbar, acts:** Edit, Comment, a shell, an agent, and a tile torn into a window.

The tile kinds a terminal draws are the [terminal extension](../terminal)'s.

## On, off and yours

- **On** wherever the service runs.
- **Uninstalled,** a door keeps its drawers and has no kinds or screens to open with them.
- **Back:** `extensions.install id=screens`.
- **Yours:** fork it (`ep0ch ext add screens`, then edit the copy), or save a screen of your own.
