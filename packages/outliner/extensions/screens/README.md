# Screens

The screens and tile kinds every door ships, as data. Both doors read them the way they read any extension's:
`extensions.list` serves the tile kinds, `screens.list` the screens.

- **A tile kind** says which drawer draws it (`drawer`: `list` or `page`) and what a tile of it starts with
  (`fields`: for a list, the source it lists `from`). A door finds its drawer by the row, so a new kind over an existing
  source is a row here, never code.
- **A screen** is a spec as a screen note holds one. `start: true` marks the one a window with no arrangement of its
  own opens on; `target` says which tile's field an argument fills (`screen.open name=navigator target="type=bed"`).

It is on wherever the service runs. Uninstalled, a door keeps its drawers and has no kinds or screens to open with
them until a screen note or another extension gives it some; `extensions.install id=screens` brings them back. To
change what a door opens on, fork it (`ep0ch ext add screens`, then edit the copy) or save a screen of your own
(`screen.save name=…`).
