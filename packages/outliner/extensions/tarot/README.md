# Tarot

A card of the day in a tile of its own, drawn again whenever you like and kept in the outline. The cards are made up.

```text
┌──────────────────────────────────┐
│ The Star                         │
│                                  │
│ repair, slowly                   │
└──────────────────────────────────┘
d draws again · k keeps it · q closes
```

## What you do

- **Draw again:** press `d` in the tile. The same seed gives the same card.
- **Keep the reading:** press `k`. It is written as a block under the tile's block.
- **Close:** press `q`.

## How it works

- **A kept reading** is a block attributed to `ext:tarot`.
  - The tile's calls say the person at its keys asked (`mutation: { author: "user" }`, `requestedBy` in the change feed).
- **Agents** call the same actions with no tile open: `outliner ext act tarot keep --block <id> --actor <its id>`.
- **Where it runs.** The command is a path on the service's host (`host` in the listing).
  - A door on another machine shows the tile kind as unavailable rather than running something else.

## Setup

- **Install:** `outliner ext add tarot`.

## For builders

This is the example for **kind 4, a whole tile**. See [the four kinds](../../docs/extensions/README.md).

- **A tile kind of its own,** `tarot.reading`, registered in the door's open tile-kind registry from `extensions.list` (`tileKinds`).
- **The tile** is `tile.ts`. The door runs it with the `command`, `cwd` and `env` the service lists.
  - It adds its own `EP0CH_CONTROL` and passes the tile's saved args as `--block=<id>`.
- **Its actions are the extension's,** `draw` and `keep` in `extension.json`, run by the service (`tarot.ts`).
  - The tile calls them over the outline socket (`extensions.act`).
  - The door binds them as `ext.tarot.draw` and `ext.tarot.keep` (keys `d`, `k`).
