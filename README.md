# ep0ch-door

A read-only BBS door into a pi-herdr-outliner outline. It talks straight to the
outliner service's Unix socket (protocol 80) and is not part of the outliner.

The screens are ep0ch's own 1997 art by shypht, read in place from the WOE art packs:
the logon (`SHY-LOGI.ANS`), the main menu (`SHY-EMNU.ANS`, whose twelve "Menu Cmd"
slots now hold live commands), and the bulletin (`SHY-EPO!.ANS`).

## Run

    bun install
    bun src/main.ts                 # default socket: ~/.local/state/pi-herdr-outliner/float-box.sock
    bun src/main.ts /path/to/outliner.sock

| Env | Meaning |
|---|---|
| `EP0CH_SOCKET` | socket path (same as the argument) |
| `EP0CH_PACKS` | folder holding the `woe*.zip` packs (default `/opt/float/bbs/inbox/evan`) |
| `EP0CH_KITTY` | `1` / `0` forces graphics on or off |
| `EP0CH_OBSERVE` | `0` skips registering as an observer (then the door is not in Who's Online and gets no live events) |

## The desk

`D` on the menu, or `bun src/main.ts --desk` to skip the logon. The door owns the whole canvas:
a tiling tree of panes it draws itself, so no multiplexer is needed for layout.

| Pane | What it shows |
|---|---|
| outline | the tree; `←/→` fold, `⏎` read; reveals where a jumped-to block lives |
| reader | the current block; follows the selection unless pinned (`p`); `[ ]` pick a link, `⏎` follow, `u` parent |
| thread | the current block's children as replies, and its comment threads with quoted passages |
| last callers · live | `activity.recent`, refreshed on outline events |
| who's online | `clients.list`, with what each client is reading |
| bulletin | ep0ch art scaled into the pane (Kitty), `, .` for the next piece |

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab`, `1`–`9`, click | focus |
| `Ctrl+W` then `h j k l` | focus by direction |
| `Ctrl+W` then `H J K L` | dock the pane along that whole edge |
| `Ctrl+W` then `< > + -`, `=` | resize, even out |
| `Ctrl+W` then `z` / `x` / `s` | zoom, close, swap with next |
| `Ctrl+W` then `o` + `t r h a w b` | add outline / reader / thread / activity / who / bulletin |
| drag a border | resize |
| `/` | floating search with preview |
| `q` / `Esc` | back to the menu |

The layout is saved to `~/.local/state/ep0ch-door/desk.json`. Mouse reporting is on, so use your
terminal's selection modifier (Shift in Ghostty) to select text.

## What maps to what

| BBS | Outline |
|---|---|
| New scan | blocks updated since your last logoff (`~/.local/state/ep0ch-door/lastcall.json`) |
| Join conference | top-level blocks |
| Message reader | a block: author, date, breadcrumb, properties, body; `T` its children, `U` its parent |
| Who's online | `clients.list`: every Tree, Detail, agent, and this door |
| Last callers | `activity.recent` across user, agent and system edits |
| File areas | the WOE zips, with each pack's `FILE_ID.DIZ` as its description |
| Stats | 7×24 heatmap of when messages were written, and top posters |

## Graphics

Kitty graphics are used only where cells can't do it, and every word stays real terminal text:

- **Art** is rasterized with the 9×16 VGA font from `../ep0ch/ep0ch.html` and placed under the text layer.
  Menu and logon art are placed one art cell per terminal cell, so live text lands exactly in the art's slots.
  The viewer keeps true VGA proportions.
- **CRT**: scanlines and a phosphor bloom at the lowest Kitty layer, so they show through default-background cells only.
- **Heatmap** in Stats is pixels.
- Each distinct image is uploaded once (raw RGBA, zlib-compressed). Reveal and scroll only change the placement's
  source rectangle. Placements are diffed per frame; exit frees all image data.

`V` cycles Kitty+CRT → Kitty → cells. Under Herdr, graphics follow `[terminal] kitty_graphics` in
`~/.config/herdr/config.toml` (older builds: `[experimental]`), because Herdr panes report `xterm-256color`.

## Read-only

Only actions from the service's safe-read list are sent: `ping`, `children`, `blocks.context`,
`blocks.query`, `clients.list`, `activity.recent`, plus `events.subscribe` as an `observer`. That
registration is the one visible side effect: the door appears in `clients.list` until it exits.

## Checking it

    bun test
    bun run check
    bun scripts/snap.ts           # drives the real door against the live outline and writes out/snap-kitty-*.png
    bun scripts/snap.ts cells     # same, cells mode
    bun scripts/snap.ts desk      # the desk at 200×60: expand, focus, add a pane, dock, search
    bun scripts/render.ts SHY-EMNU.ANS   # one piece to out/*.png

`scripts/snap.ts` runs a small emulator over the exact bytes the door writes (cursor moves, colour,
Kitty upload, place, crop and delete) and composites them into a PNG.

## Known limits

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- Input is decoded as Latin-1, so non-ASCII typing in Search is unreliable.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
