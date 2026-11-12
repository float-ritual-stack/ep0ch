# Native ep0ch: what the W0 probes found

**Every question [DESIGN.md](DESIGN.md) left "not verified" now has an answer: seven from running code, four from
reading it.** Six are a plain yes. The live window is yes while it draws and no while it is hidden; the door's pty host
is no. Each no names what it changes. The probes are a crate of their own, [`../probes/`](../probes), on the app's Rune
rev; nothing in it is a dependency of the app. The generated contract tables, what the door's layout answers written
down for native to be tested against, are [below](#the-contract-tables).

| # | Question | Answer | Evidence | What it changes in DESIGN.md |
|---|---|---|---|---|
| 1 | Can focus be set from code, so Rune's focus follows `Layout.focus`? | **Yes.** `Tx::focus(key, ring)` from any handler, `update` or `poll`. One reconciler in `poll` does both directions. | `tests/focus.rs`, 12 tests | §4 "Which tile has focus" gains the reconciler and three rules ([1](#1-focus)). |
| 2 | Can a kit `TextInput` or `TextArea` be wrapped so the key table sees chords first, the field gets text second, the rest goes up? | **Yes,** by one closure given to every field's `on_key`. "Up" is the window's `on_key` only. | `tests/field.rs`, 13 tests | §4 "How a field passes keys" stands. Two additions: Return in a note's source, and where Up and Down go ([2](#2-the-field-adapter)). |
| 3 | Can a drag handler read other tiles' rects for a drop side, and can dividers be dragged with `on_drag`? | **Yes** to both. The view reads `Cx::layout` and the handler captures the rects. | `tests/drag.rs`, 9 tests | §7 Mouse stands as written ([3](#3-drags)). |
| 4 | Can a live window return its element tree and a PNG, and run an act line from another thread? | **Yes while it draws. No while it is hidden:** then acts and state answer, the tree and the picture do not. Covered and minimised were not run. | `tests/live_window.rs`, `src/bin/probe-live.rs` | §5 Control: `peek`'s facts come from state; its tree and `snap` need a drawn frame ([4](#4-the-live-window)). |
| 5 | Can N dynamic tiles be drawn from a `HashMap<TileId, TileUi>` without the kit's `fn(&mut S)` accessors, keys namespaced `tile/<name>/…`? | **Yes.** Fields, buttons and a `TabStrip`'s handlers take a tile id. `SplitView` panes, kit `Tree`, `Table` and a strip's drag state do not. | `tests/tiles.rs`, 5 tests; `src/accessors.rs`, 7 doctests | §7 "Typed handlers" stands. One addition: one `TabDragState` for the window ([5](#5-tiles-from-a-map)). |
| 6 | Does a per-tile `memo(tile.id, version)` skip an unchanged tile's view? | **Yes: zero draws.** It takes about a millisecond off a 4 to 5 ms frame; the rest is Rune's own work per mounted element. | `tests/memo.rs`, 8 tests | §5 Frame cost stands. The version is everything the drawer reads ([6](#6-the-per-tile-memo)). |
| 7 | Terminal: what does a grid cost per frame, and do wide cells stay on the column grid? | **0.4 to 3.8 ms a frame** as text rows. **One text per row drifts; rows cut at wide cells do not.** | `tests/terminal.rs`, 9 tests | W8: the `pty` drawer draws rows cut at wide cells. No `Pixels` image ([7](#7-the-terminal)). |
| 8 | What does the door's pty host protocol give a second client? | **Nothing: there is no second client.** A second hello takes the host and the first daemon is let go. | read: `door/src/session/pty-host.ts` | §7 "Pty hosts" and W8 gain a host protocol change, or native keeps a host of its own ([8](#8-the-doors-pty-host)). |
| 9 | Does libghostty-vt have a usable Rust binding? | **Yes, on crates.io:** `libghostty-vt` 0.2.2. It builds Ghostty's source with Zig. Not built here. | `cargo search`, `cargo info`; the crate's source read | W8's feature names it; a machine that builds the feature needs Zig, or a library built elsewhere ([9](#9-libghostty-vt)). |
| 10 | What shape does `drafts.answer` have today? | **`{requestId, clientId, answer}` or `error`.** A read answers the holder's text. A patch is placed by the holder, which answers `applied`, never ranges. | read: `outliner/src/draft-patch.ts`, `server.ts`, `door/src/socket.ts` | §3 `draft.patch` for a native holder is a new ask kind beside today's three ([10](#10-draftsanswer)). |
| 11 | Does `replaces` give an extension kind a bare name? | **Yes, for a name no live kind has.** The old name opens the kind that replaces it, and the tile saves under the full name. | read: `door/src/desk/tile-kinds.ts`, `outliner/src/extension-manifest.ts` | §2 Kinds stands if the door's literal goes first. Saved screens name `<extension>.<kind>` ([11](#11-replaces)). |

Three more things turned up, two of them bugs in the spike. They are reported and not fixed
([Found on the way](#found-on-the-way)).

## How to run

```sh
cd packages/native/probes
export CARGO_TARGET_DIR=<the app's target folder>     # shared with ../, already warm
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json   # no GPU: lavapipe
cargo test                                              # every probe but the live window
cargo test --test live_window -- --ignored --nocapture  # needs Xvfb and libxkbcommon-x11
cargo test --release --test terminal measure -- --nocapture --test-threads 1
cargo test --release --test memo measure -- --nocapture --test-threads 1
```

- **Fonts:** the terminal probe asks fontconfig (`fc-match`) for a monospace, a CJK and a colour emoji face.
- **Pictures:** `EP0CH_PROBE_SNAPS=<folder>` makes the terminal tests write what each way drew.
- **Numbers below** are release builds on four cores with no GPU. The renderer's times are lavapipe's, so they bound
  nothing on a laptop; the CPU's times are the ones to read.
- **A second run** of the memo and terminal measurements, with other builds busy on the same four cores, took up to
  1.5 times as long (the largest split grid 5.6 ms a frame, not 3.8). Element counts, tiles drawn and the order of
  the three ways were the same. Read the tables as ratios.

## 1. Focus

**Rune's focus follows the layout's, both ways, through one function in `poll`.**

- **Layout to Rune:** `Tx::focus("tile/<name>", ring)`. It lands in the same frame, with or without a ring.
- **Rune to layout:** `Tx::focused()` in `poll` names the focused element by its own key. When it moved without being
  asked, that is the person, and it becomes `Op::Focus`.
- **A field has the keys** when its `TextEdit::focused` is true; the runtime keeps that flag.

Three rules the reconciler needs, each a test:

- **Ask once per change, never every frame.** A reconciler that compares `Tx::focused` with the tile's key takes the
  keys back from a field: a kit field's focused element is keyed `input`, with no tile in it.
  (`a_reconciler_that_only_knows_tiles_takes_the_keys_back_from_a_field`)
- **Ignore your own echo.** Rune's focus is read one frame after it moves, so the move the reconciler asked for comes
  back looking like the person's.
- **Ask again when what is shown changes.** `Tx::focus` on a key nothing shows does nothing and says nothing.

Two facts about presses and Tab:

- **A press inside a tile does not reach the tile's `on_press`** when a row or a field took it. The layout hears
  through Rune's focus instead: an element with `El::on_key` takes focus from any press inside it.
- **Tab is Rune's unless the tile takes it.** With no `El::on_key` on the tile, Tab moves Rune's focus and no handler
  runs. So each tile's root carries `on_key`, which is where the key table sits for a focused tile.

**DESIGN.md §4:** "Which tile has focus" keeps its owner. Add: `keys.rs` holds the reconciler, the only caller of
`Tx::focus`; each tile's root has `focusable` and `on_key`; `one_owner.rs` also forbids `Tx::focus` outside it.

## 2. The field adapter

**One closure, given to `TextInput::on_key` and `TextArea::on_key` alike, puts the table first.**

Rune's order for a key while a field has focus, as the tests saw it:

1. The field's `on_key` (Rune's `on_input_key`): the adapter. True takes the key.
2. The editor: text, arrows, select all, undo, paste.
3. The window's `on_key`, with `Tx::focused()` naming the field.

- **The tile's `El::on_key` is skipped** for a field's keys. "Unhandled up" means the window's `on_key`, nothing else.
- **The table beats the editor** for a chord both know (`mod+z` bound in the field layer runs the row, not undo).
- **Return, Escape and Tab reach the adapter before** submit, modal dismiss and focus navigation.
- **Up and Down stop at a single-line field's editor.** A list under the bar's field gets them only as rows of the
  table's field layer.
- **A chord sequence (`ctrl+w q`) is the table's to hold.** Rune's `Chord` is one chord; the second key is taken
  before it types.
- **Plain Return in a kit `TextArea` is "submit", not a new line.** With no `on_submit` it goes to the default button
  and types nothing; Shift+Return types the line. The adapter types it for a note's source (`TextEdit::insert`).

**DESIGN.md §4:** "table first, text second, unhandled up" stands. Add to the adapter: a `lines` field types Return
itself. W1's bar lists Up, Down and Return as field-layer rows.

## 3. Drags

**A handler never gets a `Cx`, so the view reads the rects and hands them over.**

- **Rects:** `Cx::layout("tile/<name>")` in the view, captured by the title's `on_drag`. The view re-runs when a rect
  it read moves, so the handler always holds the current ones.
- **The pointer:** `Drag::window_point()`, in window points. The press keeps the drag when the pointer leaves the
  title, the tile or the row.
- **The drop:** the tile under the point and its nearest side (a centre third is `center`) become
  `tile.move <tile> to=<tile> side=<side>`. A drop on its own tile, or outside every tile, is nothing.
- **Dividers:** `on_drag` with `Drag::dx` measured from the press, so each move is the whole change. Weights are
  clamped by the handler.
- **Cancel:** Escape arrives as `Phase::Up` with `Drag::cancelled()`; the handler puts the weights back.
- **`El::on_layout` into state** gives the same rects and the same number of view runs. **`Tx::element_at`** answers
  after the handler and without a rect: it can name a tile, not choose a side.

**Cost:** six pointer moves on a divider ran the view 14 times, because the view reads the rects it just changed. With
the per-tile memo those runs draw no tile ([6](#6-the-per-tile-memo)).

**DESIGN.md §7 Mouse:** stands. The rects come from `Cx::layout` in `shell.rs`.

## 4. The live window

**A real window on a real X server answered `act`, `peek` and `snap` over a Unix socket.**

![The live window's own snap](probes-live-snap.png)

| Verb | How | Median, from the client's side |
|---|---|---|
| `act <line>` | `AppHandle::update(move \|s, tx\| …)` from the socket's thread; the answer comes back on a channel | 0.11 ms |
| `peek` | `App::on_frame_drawn(\|rt: &Runtime<S>\| rt.elements())` after the next drawn frame | 3.6 ms |
| `snap <png>` | a `Compositor` draws the frame once more into an `Offscreen` and reads it back | 10.8 ms (720 by 420) |

What `AppHandle::update` offers:

- **It is `Send` and `Clone`,** and takes `FnOnce(&mut S, &mut Tx) + Send`. It runs on the UI thread, in call order.
- **It runs while no window shows.** A hidden window still acted and answered its state.
- **It returns nothing.** The closure sends its outcome over a channel.
- **It takes no focus and no pointer.** The probe's dispatcher refused the one line that asked for focus as an agent.
- **`update_if`** is the same for a read: return false and nothing redraws.

**The no:** a hidden window draws no frame, so `on_frame_drawn` and the compositor never run. `peek`'s tree and `snap`
then wait for nothing; the probe refuses after three seconds and says why. Only `hide` was run: whether a covered or
minimised window draws is the platform's, and the same refusal covers it without knowing which.

**DESIGN.md §5 Control:**

- `peek`'s `{screen, focus, whereabouts, watches, tiles}` come from state through `update_if`, always.
- The element tree and `snap` come from a drawn frame. For a window that is not showing, they refuse with the reason;
  `--headless` stays the way to draw without one.
- `control.rs` owns a `Compositor` (it draws Rune's default frame) and the `on_frame_drawn` hook.

## 5. Tiles from a map

**Opened, used and closed while the window ran, each tile's state found by id.**

- **Take a tile id (closures):** `TextInput`, `TextArea`, `TextField`, `Button`, and a `TabStrip`'s `on_select`,
  `on_close` and `on_reorder`.
- **Take only a field named at compile time (function pointers):** `SplitView::sidebar` and `inspector`
  (`PaneState`), kit `Tree` (`TreeModel`), `Table` (`TableState`), `TabStrip::drag_state`. `src/accessors.rs` has a
  doctest that compiles and one that does not for the panes, the tree and the drag state; `Table::new` has the
  tree's signature.
- **Tab drags still work:** every strip shares one `TabDragState` in the window's state. A drag in one strip reordered
  only that strip.
- **Lists are the app's own:** `El::virtual_rows`, the cursor in `TileUi`. Rows outside the list's window are not
  built.

Keys:

- **`tile/<name>/…` keys are unique and `Runtime::find` resolves them,** slashes and all.
- **The kit's own part keys repeat** in every tile (`input`, `value`): never look one up alone.
- **A tab's element is keyed `t-<id>`,** so a tab's id must be unique in the window. A tile name is.
- **A memo's id becomes its root element's key:** name it `tile/<name>/body`.

**DESIGN.md §7 "Typed handlers, windows":** stands. Add: one `TabDragState` per window.

## 6. The per-tile memo

**An unchanged tile is not drawn. The frame still costs what its mounted elements cost.**

Eight tiles of 150 rows, release build:

| Rows built | Memo | Elements | One tile changed | Only the status line changed | Tiles drawn |
|---|---|---|---|---|---|
| all | no | 2,475 | 4.79 ms | 4.34 ms | 8 and 8 |
| all | yes | 2,475 | 3.71 ms | 3.13 ms | 1 and 0 |
| shown | no | 1,563 | 3.80 ms | 3.54 ms | 8 and 8 |
| shown | yes | 1,563 | 3.70 ms | 3.37 ms | 1 and 0 |

- **The saving is the view build:** about 1 ms here. The 3 ms floor is layout and painting of every mounted element,
  which a memo does not skip. Fewer mounted elements is the other lever, and lists already virtualize.
- **The version is everything the drawer reads.** With the cursor left out, the state changed and the row kept its old
  mark.
- **A `TextEdit` in the version is enough for a field:** typing drew one tile per key and the field kept the keys.
- **Handlers in a reused tile still run.** They hold what they captured at build, so they capture ids.
- **A divider drag draws no tile:** layout reflows a reused subtree.
- **A tile with a kit field draws twice at first.** The kit reads its own size while it builds; Rune tracks that read.

**DESIGN.md §5 Frame cost:** stands as written.

## 7. The terminal

**Draw each row as mono text, cut only where a wide character sits.**

![An 80 by 24 grid drawn as rows cut at wide cells](probes-terminal-split.png)

Three ways to draw the same grid, fed a canned log that scrolls (every row changes) or a prompt (one row changes):

- **rich:** one mono text per row, a span per run of colour.
- **split:** each stretch of one-column cells is one mono text of a fixed width; each wide character sits in a box two
  cells wide; each run of background is a rect behind them.
- **image:** the grid rasterised on the CPU (swash) into one `Pixels` image.

CPU milliseconds per frame, median of forty, release build. "paint" is the image's cell blit and copy; "frame" is
`Runtime::frame`.

| Grid | Scale | Way | Scroll: paint + frame | Prompt: paint + frame | Elements |
|---|---|---|---|---|---|
| 80 by 24 | 1 | rich | 0.38 | 0.38 | 26 |
| 80 by 24 | 1 | split | 1.20 | 0.51 | 306 |
| 80 by 24 | 1 | image | 0.39 + 0.15 | 0.09 + 0.14 | 2 |
| 80 by 24 | 2 | rich | 0.56 | 0.39 | 26 |
| 80 by 24 | 2 | split | 1.15 | 0.56 | 306 |
| 80 by 24 | 2 | image | 1.45 + 0.43 | 0.47 + 0.41 | 2 |
| 200 by 60 | 1 | rich | 1.27 | 1.10 | 62 |
| 200 by 60 | 1 | split | 3.09 | 1.34 | 769 |
| 200 by 60 | 1 | image | 1.92 + 0.63 | 0.64 + 0.63 | 2 |
| 200 by 60 | 2 | rich | 1.49 | 1.21 | 62 |
| 200 by 60 | 2 | split | 3.76 | 1.47 | 769 |
| 200 by 60 | 2 | image | 15.29 + 3.41 | 4.33 + 3.50 | 2 |

Lavapipe then took 3 to 8 ms to draw an 80 by 24 frame and 12 to 39 ms for 200 by 60 as text (22 to 108 ms as an
image). That is a software rasteriser on four cores, not a GPU.

Do wide cells stay on the column grid? A mark was put at column 20 after twenty columns of each kind:

| Way | Bold | Box drawing | Ten CJK | Ten emoji | Mixed line |
|---|---|---|---|---|---|
| rich | on it | on it | **3.45 cells early** | **0.64 cells late** | **0.51 cells early** |
| split | on it | on it | on it | on it | on it |
| image | on it | on it | on it | on it | on it |

![One text per row: the mark drifts after CJK and emoji](probes-wide-cells-rich.png)

- **Rich drifts** because a fallback face sets each wide character at its own advance (13 pt for a 7.83 pt cell), and
  nothing in a text run pulls it back.
- **Rich also rounds backgrounds:** a span's `bg` is an inline-code chip, and a status row's ground stops at its text.
- **Split costs 2 to 3 times rich and stays under 4 ms** for a full 200 by 60 screen at scale 2.
- **The image is cheapest small and dearest large:** `Pixels::set` takes a whole new frame each time, 26 MB at
  200 by 60 and scale 2.
- **Commit a frame with `tx.instant()`.** Without it Rune eases what the commit replaced: one frame after a scroll,
  445 elements of an 80 by 24 grid were still leaving, moving or fading, and the picture showed old and new rows
  together.
- **A row's memo version is the row's cells:** typing at a prompt drew one row of twenty-four.

**DESIGN.md W8:** `tiles/pty.rs` draws rows cut at wide cells, each in `memo(row, cells)`, backgrounds as rects,
commits instant. No `Pixels` path. "Redraw cost recorded" is this table; W8 records it again on the laptop's GPU.

## 8. The door's pty host

**The protocol has one client by design: the daemon. A second hello takes the host from the first.**

Read, not run: `packages/door/src/session/pty-host.ts`, `src/desk/pty-backend.ts`, `src/session/protocol.ts`.

- **Where:** `pty.sock` in the session's outline folder, mode 0600. `HOST_PROTOCOL = 1`.
- **A frame:** one byte of type, four of id (the program's, big-endian), four of length, then the payload: raw bytes
  for `w`, `r` and `o`, JSON for the rest.
- **Client to host:** `h` hello, `s` spawn (`{key, argv, cwd, env, cols, rows, meta}`), `w` write, `z` resize,
  `k` kill, `f` forget, `m` meta, `q` end everything.
- **Host to client after `h`:** `l` the list (`{proto, pid, ptys}`), one `r` per program (its replay: the last 1 MiB
  it wrote, from a whole line), `y` ready. Then live: `o` output, `p` spawned (pid), `e` error, `x` exit.
- **The byte stream is the program's own output,** escape sequences and all. The client parses it; the door feeds
  `@xterm/headless`. A later `r` means the client fell behind: its emulator starts over from it.
- **One size per program:** `z` resizes the pty for everyone.

What a second client gets:

- **With a hello:** it becomes the daemon. The host drops the first connection (`daemon.destroy()`), and the door's
  daemon marks every program gone (exit 129).
- **Without one:** nothing. It is taken for a probe.
- **The door's session socket is no way round it.** That protocol does take several clients, a read-only `watch`
  among them, but its `output` is the door's whole painted screen for that client's size, not a tile's program.

opencode's process daemon (`packages/process-daemon/SPEC.md`, protocol 8) is the shape the door's host lacks:

- **`subscribe {id, offset, attachment_id, role, takeover}`** answers `Attached` with a replay from an absolute byte
  offset, then tagged binary output frames (`start`, `end`, bytes).
- **One controller, any number of observers.** Promotion, resize and input are one ordered command; every resize
  publishes a VT checkpoint before the next output.
- **The daemon parses with libghostty** and serves `snapshot` and `read_rows`, so a late client needs no replay.

**DESIGN.md §7 "Pty hosts: one, the door's pty host protocol":** true for native alone, false for sharing.

- **Native by itself:** it starts a host for its own state folder and is that host's one daemon. The protocol works
  as it is, and "detaches, returns" holds.
- **Door and native on one session's programs:** the host needs viewers. W8 gains door work: `HOST_PROTOCOL` 2 with a
  role on `h`, output fanned out to every viewer, one controller for `w` and `z`. Until then a program belongs to
  whichever door started it.

## 9. libghostty-vt

**There is a maintained binding on crates.io. It needs Zig to build.**

| Crate | Version | From | Notes |
|---|---|---|---|
| `libghostty-vt`, `libghostty-vt-sys` | 0.2.2 | `uzaaft/libghostty-rs`, MIT or Apache-2.0, Rust 1.90 | about 203,000 downloads; updated Sep 28 |
| `ghostty-vt`, `ghostty-vt-sys` | 0.8.0+ghostty.1.4.0 | `prabirshrestha/gpui-cn`, Apache-2.0, Rust 1.96 | adapted from the first; its README says macOS is the only supported runtime |

- **What the safe crate has:** `Terminal::vt_write`, `resize`, `on_pty_write` (the answers a program asked for), and a
  `RenderState` with per-row dirty flags, cells with style, colours and `CellWide` (narrow, wide, tail). That is the
  grid `src/grid.rs` stands in for, with the dirty rows a per-row memo wants.
- **How it builds:** the `-sys` crate fetches a pinned Ghostty commit and builds `libghostty-vt.a` with Zig in
  `build.rs`. Bindings are checked in, so no bindgen. First build needs the network, or `GHOSTTY_SOURCE_DIR` and
  `GHOSTTY_ZIG_SYSTEM_DIR`.
- **Not built here:** this machine has no Zig, and the crate is not a dependency of anything in the repository.
- **opencode does not use it:** it checks in its own FFI declarations and builds Ghostty at its own pinned revision
  with Zig 0.16.

- **Without Zig, two ways, neither tried:** `libghostty-vt-sys` has `link-dynamic` and `pkg-config` features for a
  library already on the machine. `ghostty-vt-rs-sys` 0.3.0 (`nklmilojevic/ghostty-vt-rs`, MIT) says it ships prebuilt
  static libraries; it is raw FFI, and which platforms it covers was not read.

**DESIGN.md W8:** the `pty` cargo feature depends on `libghostty-vt`. A machine that builds the feature needs Zig, or
one of the two ways above once W8 has tried it; without the feature nothing changes.

## 10. `drafts.answer`

**The holder answers an ask of the service's; it never sends a buffer by itself. Read, not run.**

- **The ask:** an event `{domain: "draft", action: "draft.<kind>", blockId, draft}`. `draft` holds the ask, a
  `requestId`, the `holdId` and `targetClientId`, the holder's client id. Three kinds: `read`, `patch`, `revert`.
- **The answer:** the request `drafts.answer {requestId, clientId, answer}`, or `error` in place of `answer`. The
  service says `{accepted: true}`. It is taken at once, never queued behind the request that waits for it.
- **`answer` by kind:**
  - `read`: `{text, revision}`, the draft as the holder has it now.
  - `patch`: `{applied: true, inverse?: {before, text, revision}}` or `{applied: false, reason}`.
  - `revert`: `{reverted}`.
- **Who places a patch:** the holder. A `patch` ask carries `patches` (each `{observed, replacement, range?}`, the
  range a hint) and `revision`; the door finds the spans in its own buffer.
- **Time:** 2.5 seconds (`DRAFT_HOLDER_TIMEOUT_MS`). A holder that is late keeps its hold and is asked only reverts
  after that; patches fail into proposals.
- **A wrong `clientId`, or a `requestId` nothing waits for, is refused.**

**DESIGN.md §3:** "the holder sends its buffer in `drafts.answer`, the host places the patch and returns resolved
ranges" is half there. `read` already gives the host the buffer. Nothing hands ranges back today: that ask is W5's
wire change, and the door's `patch` can stay as it is.

## 11. `replaces`

**An extension's kind is named `<extension id>.<kind>`. `replaces` lets a retired name open it. Read, not run.**

- **In the manifest:** `tiles[].replaces`, up to eight names, "full names, as a layout saved them". It rides on the
  tile's row in `extensions.list`.
- **In the door:** `registerTileKind` keeps one map from an old name to the kind that serves it, and `resolveKind`
  reads it for every lookup by name. So `tile reader` in a screen note opens `screens.reader` when that kind says
  `replaces: ["reader"]`.
- **Only a name no live kind has.** Registering a kind that replaces a name the door still has is refused ("the door
  has a kind by that name"). A manifest that replaces one of its own kinds is refused when it loads.
- **It saves under the full name.** A tile opened as `reader` is written back as `screens.reader`.
- **When the extension goes,** the old name goes with it: the map drops every name that pointed at the kind.

**DESIGN.md §2:** "Kinds" stands, with an order: the door's literal for a kind is deleted before the screens extension
registers the kind that replaces it, in one wave.

**Hydra risk for W2:** the map from an old name to its kind lives in the door (`resolveKind`). Native must not write
a second one. The resolution moves to where both doors read it: `screens.list` as it validates, or outline-core over
the served rows.

**As built (sweep 1):** `screens.list` serves each tile's kind resolved (`canonKind`, then `replaces`), so a window
finds its drawer by the kind the row says. The door's `resolveKind` still answers for layouts the door keeps itself.

## The contract tables

**What the door's layout answers is written down as data, for native's Rust `apply` and `place` to be tested against**
(DESIGN.md §5, §6.1). Six tables in [`../../outline-core/fixtures/`](../../outline-core/fixtures), made by the door's
own functions on made-up garden layouts and never edited by hand.

| Table | Asks | Holds the answer of |
|---|---|---|
| `layout-contract.json` | a saved layout, an operation, who asks and where the person is | `apply`: the layout after, or the refusal in words |
| `place-contract.json` | a saved layout and an open | `placement`: the tile the note lands in and why, and the layout the open leaves |
| `act-lines.json` | an act line; a `tile=` | the line's words, its request, its arguments typed by the action; the address it is |
| `address-contract.json` | the tiles a window has, an address and the tile asked from | the one tile it names, why none has it, or the refusal when several do |
| `action-rows.json` | every built-in action | its `ActionRow` under its set's scope |
| `screens.json` | every built-in screen | its `ScreenSpec`, read back through `readSpec` |

```sh
scripts/agent-env <name> -- bun packages/door/scripts/layout-contract.ts           # write them; prints each table's rows
scripts/agent-env <name> -- bun packages/door/scripts/layout-contract.ts --check   # exit 1 naming the first stale row
```

- **Kept true:** the door's `test/layout-contract.test.ts` makes them again and fails on a stale row. It also counts
  what they ask against the door's source: every operation, node kind, place, policy field, open rule, alt rule and
  wire verb, and every agent-gated operation asked by an agent.
- **Read without the door:** outline-core's `test/screen-spec.test.ts` reads every table through `screen-spec.ts`,
  `action-row.ts` and `action-line.ts`. Cargo runs every row of the layout, place and address tables (`native/src/tests/contract.rs`) and reads the act lines and action rows (`tests/actline.rs`).
- **Where the door decides today:** `LAYOUT_FAMILIES` in the door's `test/one-owner.test.ts`.

Three things the tables record as the door does them, for W2 to match or to raise:

- **An agent's lock is any agent's to undo.** The layout keeps that an agent locked it, not which agent.
- **A least width can fold the tile with the person's keys.** Opening a spine in a row too narrow for its open pages
  folds the one touched longest ago, and the keys stay on its spine when that is the tile they were on.
- **EchoNet's hint is drawn text.** Its spec holds a strip in the theme's colours with click marks, not `|NN` words;
  `screens.json` holds the words and marks the field `drawn`.

What the tables do not hold:

- **A saved layout as state.** The generator's `build()` mirrors `Desk.build` (a leaf's wires, its source, its fold),
  and `saved()` mirrors the desk's save. A pure pair in `screen-layout.ts`, used by both, is the fold.
- **Geometry.** No rectangles from `place`, and no flow squeeze, beyond what the typing guard and spine room exercise.
- **What the desk does with a landing:** making the reader, a kind's own hand-off, a carry between two layouts.
- **Inputs that are functions:** a mount taking an open inward, and the shell's idle rule. In the tables, busy is the rule.
- **The built-in named layouts** (`daily`, `river`, `board`, `desk`): layouts, not screens.

## Found on the way

- **The spike's editor types no line on Return.** It is a kit `TextArea` with no `on_submit`
  ([2](#2-the-field-adapter)). `return_in_a_kit_text_area_alone_submits_and_types_no_line`.
- **The spike's mono text is set in the sans face.** `AppSpec::new` leaves the families at `("Inter", "Inter")`, so
  `Family::Mono` and mono spans are not monospace until the app names one (`"ui-monospace"` is the system's).
  `the_mono_slot_is_the_sans_face_until_the_app_names_a_monospace_one`.
- **A second renderer on one runtime draws no glyphs.** The glyph atlas uploads to the renderer attached when the
  glyphs were made. `control.rs` draws its second pass with the frame's own renderer, as the probe does.

## What was not answered

- **IME:** Return and Escape during composition never reach the adapter (Rune's README, step 1). Read, not run.
- **GPU cost:** every render time here is lavapipe's.
- **Covered and minimised windows:** Xvfb has no window manager, so only `hide` was run.
- **A real pty:** the stream is canned. No program, no parser, no input latency.
- **Several windows:** one window, one `AppHandle`. A torn-out tab's second window was not opened.
- **macOS:** everything ran on Linux under X11.
