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

## The board

`K` on the menu, or `bun src/main.ts [--ws <workspace root>] --board [hub-block-id]`. Any block with two or more
virtual-branch children is a board; `g` picks one (Delivery Flow on the pi-outliner outline, Outbox on float-hub).
The last board per workspace is remembered.

`--ws ~/float-hub` finds that workspace's socket the way the outliner does
(`~/.local/state/pi-herdr-outliner/<sha256(root)[0:12]>/outliner.sock`).

- **Lanes** are read the way Tree and `pie view` read saved views (`src/views.ts`, ported from the outliner's
  `saved-view-read.ts`): the query is parsed into property filters, views without a sort use the service's
  branch-local rank order (`rankViewId`), roots are kept once, the authored limit (default 200) applies, and
  a lane says `of N+` when truncated or `invalid` / `failed` with the reason instead of looking empty.
  Checked identical against the outliner's own evaluator: all 8 branches on float-hub and all 34 on the pi-outliner outline.
- **One preview** follows the selected card. **⏎** opens into the detail; **alt+⏎** opens a second detail.
- **`c`** collapses a lane to a spine (click or ⏎ it to reopen; `C` reopens all).
- **Resize** by dragging any border: between lanes, between preview and details, lanes/readers, drawer edges.
  Keys: `{ }` lane height, `< >` width of the focused lane or reader.
- **`o`** pops the focused reader out as a floating pane: drag its title to move, drag `◢` to resize, `H J K L`
  to nudge, `o` again to dock it back as a detail, `x` to close.
- **`t`** outline drawer with its own mini preview underneath; slides over unless pinned (`T`); `S` moves it
  to the other side so it doesn't cover the preview.
- **`b`** backlinks drawer spanning all readers, with its own preview of the selected source and the quoted
  snippet; `B` pins it; ⏎ / alt+⏎ opens a source in a detail.
- Layout, pins, collapsed lanes and drawer side are saved to `delivery.json`.

## Reading notes

Every reader (board, desk) renders bodies with `src/doc.ts`:

- **Images and video.** A line that is only `img:: path`, `[img::path]` or `[video::path]` becomes an inline image
  through Kitty. Big images are shrunk with `sips`, video gets a poster frame from `ffmpeg` (or Quick Look), cached in
  `~/.cache/ep0ch-door/media`. `\ ` escapes and macOS screenshot names (narrow no-break space before AM/PM) resolve.
  `[ ]` selects an image like a link and ⏎ opens it in the system viewer. Images a drawer or float covers are hidden.
  If macOS blocks the read (Desktop, Documents), the line says so: grant the terminal Files & Folders access.
- **Callouts.** `> [!note] Title` (tip, warning, danger, summary, example, question, quote, …) render as colored boxes;
  `[!x]-` starts folded, `z` unfolds.
- **Tables.** Markdown tables render as real tables: columns sized to fit, long cells wrap onto more lines.
- **mdxcn figures** ([mdxcn.dev](https://mdxcn.dev)): `::graph-*` Comark blocks with YAML props draw natively in
  a dotted `+ ··· [ TITLE ] ··· +` frame: check, timeline, stat, kpi, rank, funnel, waterfall, spark, plot, meter,
  gantt, tree, table (`src/graphs.ts`). The official fenced ASCII an agent pastes (`+--- [ TITLE ] ---+`) is re-framed
  the same way. Unknown kinds say so inside the frame.
- Long callout titles keep a short head on the border and flow the rest into the box.
- Code fences, headings, lists, blockquotes, `**bold**`, `[[links]]`, `((refs))` and `[key::value]` are styled.

## The river

`Q` on the menu, or `bun src/main.ts --river`. Quay's model (built with Grok from an outline export, in
`~/projects/tundra-heart-crane-lotus`) on the live outline instead of a seed file:

- **Placement (niri):** `⏎` inserts a column right after its source, or jumps to it if that note is already a column. `alt+⏎` forces a duplicate.
- **Compression (Andy's notes):** columns get full, peek or spine width by distance from focus; docked (`p`) columns resist. Spine titles are rotated VGA text (Kitty) or stacked letters (cells).
- **Threads (Twitter):** `space` expands replies in place under a rail; `s` splits a note into a stacked pane in the same column; `tab` moves between stacked panes.
- **Per-pane filters:** `f`, then `type:hub -status:done author:codex word`.
- **Virtual branches:** `#` lists the note's properties; pick one for a column of every note sharing it.
- **Jump:** `/` searches the whole outline index locally, with no round trip per keystroke.
- **Quote** needs write access, so it's not here.

Reply counts, titles and the jump palette come from one `tree.index` call (about 1.4 MB for 1.5k blocks,
cached in `river-index.json` and refreshed in the background on its own connection). Card bodies come
from `children`. The layout is saved to `river.json`.

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

## Letting an agent see what you see

A running door listens on `~/.local/state/ep0ch-door/door.sock` (a second door uses `door-<pid>.sock`):

    bun src/main.ts peek              # screen as text + structured state: board, lanes, selection, which block each reader shows
    bun src/main.ts snap [out.png]    # PNG of exactly what the terminal was sent, images included
    bun src/main.ts open <block-id>   # put a block in front of the user (board: the detail; desk: the reader; river: a column)

`snap` comes from a mirror that receives every byte written to the terminal (`src/mirror.ts`, the same
compositor the snapshot harness uses), so it shows what is actually on screen, not a re-render.
`open` flashes "an agent opened: …" so it's never silent.

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
    bun scripts/snap.ts river     # the river at 200×60: open beside, replies, compression, jump
    bun scripts/render.ts SHY-EMNU.ANS   # one piece to out/*.png

`scripts/snap.ts` runs a small emulator over the exact bytes the door writes (cursor moves, colour,
Kitty upload, place, crop and delete) and composites them into a PNG.

## Known limits

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- Input is decoded as Latin-1, so non-ASCII typing in Search is unreliable.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
