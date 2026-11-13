# Screens

The screens and tile kinds every door ships, as data. Both doors read them the way they read any extension's:
`extensions.list` serves the tile kinds, `screens.list` the screens.

- **A tile kind** says which drawer draws it (`drawer`: `list` or `page`) and what a tile of it starts with
  (`fields`: for a list, the source it lists `from`). A door finds its drawer by the row, so a new kind over an existing
  source is a row here, never code.
- **A list about a note** (its comments, its proposals, its revisions) is such a kind too: `from` names the producer,
  `subject: follows` and a `source` on the tile make it follow a reader. The keys (`keymap`) and the components
  (`components`) are lists as well, so the keys and library screens are one tile each.
- **A screen** is a spec as a screen note holds one. `start: true` marks the one a window with no arrangement of its
  own opens on; `target` says which tile's field an argument fills (`screen.open name=navigator target="type=bed"`).

**The kitchen** (`screen.open name=kitchen`) is the native window's kitchen sink: a screen whose tiles and toolbar
show the parts each wave of it added, so a part can't quietly break where nobody looks. A part a door gains that a
person can see is added to it. Today: the outline, the extensions and the outlines as tiles on its left (any list
source is one: `from: extensions`, `from: outlines`), a reader with its properties and the last callers in tabs
behind it, the lists about the reader's note on its right (its comments, proposals and revisions, each following
the reader), and on the toolbar the bar opened on the extensions and the outlines, Edit, Comment and a tile torn
into a window of its own. The terminal: the programs a door runs as a tile under the outlines (`from: programs`),
and on the toolbar a shell opened beside the reader, an agent, and the bar on the programs (the tile kinds a
terminal draws are the [terminal extension](../terminal)'s).

It is on wherever the service runs. Uninstalled, a door keeps its drawers and has no kinds or screens to open with
them until a screen note or another extension gives it some; `extensions.install id=screens` brings them back. To
change what a door opens on, fork it (`ep0ch ext add screens`, then edit the copy) or save a screen of your own
(`screen.save name=…`).
