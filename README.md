# ep0ch-door

A BBS door into a pi-herdr-outliner outline: it reads everything, edits notes in place, moves cards between
board lanes, and comments on them. It talks straight to the outliner service's Unix socket (protocol 80 or
newer, using newer features when the service advertises them) and is not part of the outliner.

The screens are ep0ch's own 1997 art by shypht, read in place from the WOE art packs:
the logon (`SHY-LOGI.ANS`), the main menu (`SHY-EMNU.ANS`, whose twelve "Menu Cmd"
slots now hold live commands), and the bulletin (`SHY-EPO!.ANS`).

## Try it

    scripts/try-it.sh --ws /home/evan/test

opens the board of that workspace's running service. Edits, moves and comments there are real.

    scripts/try-it.sh --ws /home/evan/test --copy --outliner <pi-herdr-outliner checkout>

makes a private copy of the workspace's database (`sqlite3 .backup`, read-only on the original), serves it
from its own service built from that checkout, and opens the board on it. Use it to try the door on a
service with features the running one doesn't have yet (`views.read`, the change feed). Writes stay in
the copy, and the copy is deleted when the door exits. `--hub <block-id>` picks the board.

A journey to try, whichever service it is:

1. The board opens on the workspace's board; `h l` lanes, `j k` cards; the preview follows the card.
2. `e` edits the card in the preview. Type after a `[key::value]` on the subject line, `Ctrl+S`: the door
   says which properties the save would change and writes nothing; `Ctrl+S` again saves. `Esc` closes.
3. `m` picks a lane to move the card to, showing the property patch (or why a lane can't take it); `Enter`.
4. `Tab` to the preview, `c`, pick a passage (`j k h l`), `Enter`, write, `Ctrl+S`; `m` lists the threads.
5. With another client (Detail, the CLI), edit the note while it's open with `e`: the draft says
   "changed elsewhere" and a save is refused, never overwriting. Change a card's stage elsewhere: its lanes
   update by themselves.
6. Restart the service: the status bar says `offline`, then `reconnected · caught up N changes`.

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

- **Lanes** are saved views, read by the service with `views.read` when it has it (see "On the service
  platform"). Against an older service the door reads them the way Tree and `pie view` did (`src/views.ts`,
  ported from the outliner's `saved-view-read.ts`): the query is parsed into property filters, views without
  a sort use the service's branch-local rank order (`rankViewId`), roots are kept once, the authored limit
  (default 200) applies. Either way a lane says `of N+` when truncated or `invalid` / `failed` with the
  reason instead of looking empty. The two agree on all 34 saved views of the pi-outliner outline
  (`scripts/parity.ts` on a copy), and on all 8 of float-hub's before `views.read` existed.
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

## Moving cards

A lane's query is usually a list of property clauses that must all hold, so a card moves by patching the
properties the target lane names. Nothing else on the card changes. When the query also has an OR or NOT
group, parentheses or a `created`/`updated` range (services with PIE-398), its plain top-level clauses are
still what a move patches, and everything else must already hold for the card: on a lane
`type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=doing` a card in either project
moves by patching `work-stage` alone, and any other card is refused with the term it doesn't meet. The door
reads that grammar with a port of the outliner's parser and evaluator (`src/query.ts`, parity-tested) and
judges the whole query on the card as the patch would leave it, so a patch can't break a group it mentions.

| Keys | Action |
|---|---|
| `H` / `L` | move the selected card into the lane to the left / right |
| `m` | move picker: every lane with what moving there would patch, or why it can't |
| drag a card onto a lane | the same; while dragging, the lane and the hint line say what the drop would do |

- **Only what differs is patched.** Clauses the card already satisfies are left alone. A value the
  card has is replaced in place; a missing one is appended to its metadata. Values compare
  case-insensitively, like the outliner.
- **Refused, with the reason and no write:**
  - a group, NOT or range the card doesn't meet (a move never picks a side of an OR, removes a property for
    a NOT or changes when a card was created): the reason names the term and what the card has, e.g.
    `Doing needs (project=pi-outliner OR project=ep0ch-door) and the card has project=garden-club; a move
    sets only the plain clauses beside it`. A card the service already lists in a lane is "already there".
  - invalid lanes: on older services `not`, `or` and `and` aren't in the query grammar, nor are `-key` or
    `key:value`; lanes with no `query::` (sort-only, limit-only) are invalid too
  - a bare word or `key` clause the card lacks: it asks for any value, and a move can't pick one
  - two values for one key (`stage=a stage=b`)
  - a card with two values for the key being changed: the door won't guess which one moves
  - a lane that's still loading or failed to read
- **Revision checks.** The move names the revision the board showed the card at. The door asks the
  service for the card's property tokens (their `ordinal`s, at that revision) instead of re-parsing
  the text, then sends one `properties.patch`. If anyone changed the card since the board loaded, it
  isn't moved: the lanes reload and the card stays where it was.
- **Open edits.** A card open as a draft isn't moved; save or close the edit first. Moving never
  replaces text under an edit, and a draft whose card another client moved is refused on save.
- After a move the source and target lanes reload (every lane, without a change feed), the card is
  selected in its new lane, and the flash names the patch
  (`moved to Review · stage queued -> review · track + door`), plus any other lane it still matches.
  A collapsed target lane reopens.

## Writing on the board

| Keys | Action |
|---|---|
| `n` | a new card in the focused lane |
| `N` | a note under the selected card |
| `s` | the selected card's checklist steps: `j k` pick, `space` done / to do, `x` done, `w` waiting, `!` problem |
| `d` `d` | trash the selected card (and the notes under it); `u` restores it |

- **A new card is born in its lane.** `n` opens a composer over the board (the same edit control as a
  note: `Ctrl+S` creates, `Ctrl+E` hands it to `$EDITOR`, `Esc` twice discards). The first line is the
  title. The lane's plain clauses are appended to the first line as `[key::value]` tokens, unless the text
  already says so; a typed value that contradicts one is refused. The lane's `[create::key=value]` is a
  default, not a requirement: it's added only when the text doesn't set that key, so typing
  `[area::garden]` in a lane that reads `(area=kitchen OR area=garden)` with `[create::area=kitchen]` makes a
  garden card. An OR group the defaults don't settle has to be met by the text; the composer says so, and
  before anything is written the door asks the service how it will read the text
  (`properties.preview`) and checks the lane's whole query against that. A lane that can't define a card
  (loading or invalid, two values for one key, a `created < …` range) refuses `n` with the reason.
- **Where it goes:** the lane's `[create-parent::<block id>]`; else the parent most of the lane's cards
  share, else most of the board's; a board spread across parents is refused with how to name one. The
  composer shows the parent and why.
- **Created once.** `create` carries no revision or request id, so a create whose answer was lost is never
  retried: the door looks under the parent for exactly that text and says whether it landed. A refused or
  unknown create keeps the composer's text (and copies it to `drafts/`). The new card reaches its lane
  through the change feed, which asks only the lanes that could hold it. Your own new card is selected; an
  agent's (`card.create`, `card.restore`) never moves your selection, focus or collapsed lanes.

### Creating on roadmap boards

A lane whose query has a plain `type=roadmap-item` (the workboard's stage views, the All-work board) lists
roadmap items, and those are made only by the workboard's allocator (`roadmap.items.create`), never by a
plain create. The allocator issues the item's work-id and files it under its project's one active work
queue, so the lane's `create-parent` doesn't apply (and `card.create parent=` is refused).

- **Fields.** Each comes from the typed text's `[key::value]` token, else the lane's plain clause, else its
  `[create::]` default: `project`, `work-stage` and `work-batch` usually from the lane (or the OR group the
  text picks), `priority` (`high|medium|low`), `arc` and one or more `track` from the text. A missing
  field is refused with all of them named: `Queued makes roadmap items through the workboard's allocator,
  which needs priority, arc and a track: add [priority::high|medium|low] [arc::…] [track::…] to the text`.
  `depends-on`, `related-to` and `source-block` tokens become the item's relationships. The tokens come out
  of the title and body (the allocator writes them itself); other tokens stay.
- **Stages.** Items are created in Queued or Doing (or the allocator's default, `unprioritized`, in a
  lane with no stage), then moved. `n` in a Review, Validate, Done or Superseded lane is refused (`Review is
  a review lane: roadmap items are created in Queued or Doing, then moved`), and so is a typed late stage.
- **Checked first.** The item as the allocator will write it is checked against the lane's whole query
  before the call, so a project outside the lane's OR group is refused with what it has.
- **After.** The flash names the work-id: `created HOME-012 in Queued · Oil the hinges · priority=medium
  arc=home track=doors project=ep0ch-door`; `card.create` returns `workId`. The allocator needs a Work-ID
  prefix and exactly one active `type=work-queue` block for the project; otherwise its refusal is shown
  as it is (`Expected exactly one active work queue for project …`). A service without the allocator
  (older than protocol 82, or one that answers "Unsupported action") refuses roadmap lanes' `n` rather
  than falling back. A lost answer is looked for among the project's newest items, never retried.

- **Steps** are the note's Markdown checklist items (`- [ ]`, `[x]`, `[~]`, `[!]`), read with
  `checklist.query` and changed one at a time with `checklist.update`, checked against the step's evidence
  as it was read: a step reworded since is refused and the list read again. A step without an id is named
  by where it starts at the read revision, and the service gives it one (`^task-…` appears in the note).
  The open steps list reads the note again when it changes. A key acts on the step the list showed;
  `step.set step=N` (or `^id`) always reads the steps fresh, so it means the note's step N as it is now.
- **Trash** asks twice: the first `d` says what goes (`d again trashes "Fix the dripping tap" and the 3
  notes under it`), any other key keeps it. The card must still be at the revision the board showed, and
  not open for editing or commenting. A red `TRASHED … · u restores` banner stays on the hint line until you
  restore it or trash another. The service's `delete` takes no revision and records no author, so the
  door checks the revision just before and says on screen who did it. If the delete's answer is lost, the
  door asks whether the card is in Trash: if it is, it's reported as trashed (banner and `u` included);
  if not, or if the outline can't say, it says so.
- The same guard as moving: a card held by an open edit or comment isn't moved, stepped or trashed.

## Editing notes

Any reader edits the note it shows: the board's preview, details and floats, and the desk's reader.
On a board lane, `e` edits the selected card in the preview. The river stays read-only for now.

Every reader is the same **note surface** (`src/surface/note.ts`): it draws the note, follows links, holds
the edit, the passage picker and the comment threads, the property warning and "changed elsewhere", and
keeps unsaved text safe. A view only gives it a rectangle, of any width, and says where a followed link
opens. Writing a note and writing a comment use one edit control (`src/surface/editor.ts`): the same
frame, the same status line, the same keys (`Ctrl+S`, `Ctrl+E` to `$EDITOR`, `Esc`, twice when unsaved).

| Keys | Action |
|---|---|
| `e` | edit in place; the draft is the note's whole text: subject line, body and `[key::value]` properties |
| `Ctrl+E` | hand the draft to `$VISUAL` / `$EDITOR` (then `vi`); what comes back replaces the draft |
| `Ctrl+S` | save |
| `Ctrl+R` | after the note changed elsewhere: load the current text (your draft is copied to disk first) |
| `Esc` | close; with unsaved changes it asks for a second `Esc` |

- **Saving** sends `update` with the revision the draft started from. The service refuses it if anyone
  else saved since, and the door never retries it over their text: the draft stays open, is copied to
  `~/.local/state/ep0ch-door/drafts/`, and `Ctrl+R` starts over from the current revision.
- **While a draft is open** the reader stays on its note, takes every key (board and window shortcuts
  included), and marks "changed elsewhere" when an outline event says the note moved on, instead of
  replacing what you typed. `Ctrl+C` asks twice when an edit is unsaved.
- **Properties:** the service decides which `[key::value]` tokens are properties (one followed by more
  text on its line is plain text). When the service offers `properties.preview` (pi-herdr-outliner
  PIE-401), the first `Ctrl+S` on a draft that would change them says which and writes nothing; `Ctrl+S`
  again saves. Older services save at once, and the reader then says which properties changed.
- **Attribution:** door edits are recorded as `author: user`, `actorId: ep0ch-door:<hostname>`, like the
  outliner's own Detail.
- `peek` reports open drafts under `editing` (dirty, changed elsewhere, refused, where the copy went).

## Commenting

The same readers comment on the note they show. On the board, Tab to the preview (or a detail) first:
`c` on a lane still collapses it.

| Keys | Action |
|---|---|
| `c` | pick a passage to quote; the reader switches to the note's source text with the passage highlighted |
| `j k` | move to the next / previous line with text (the whole line, without its indent) |
| `J K` | extend / shrink the passage by a line |
| `h l`, `H L` | move where the quote starts (`h l`) or ends (`H L`) by a word |
| `Enter` | write the comment under the quote; `Ctrl+S` sends, `Ctrl+E` hands it to `$EDITOR` |
| `m` | the note's comment threads: `j k` pick, `r` reply, `x` resolve or reopen, `c` a new comment |
| `Esc` | back a step; with unsent text it asks for a second `Esc` |

- **Why the source text:** the service anchors a comment on an exact quote of the stored text. The
  rendered view restyles and drops text (properties, markup, checklist ids), so a quote picked there
  could fail to match. Lines that already carry comments have a `▐` in the gutter.
- **Sending** is `annotations.batch` with a `block-comment` operation: the note's revision, the exact
  quote and its offset. The service refuses it if the note changed since you picked the passage, or the
  quote isn't where the offset says. Nothing is written then; the comment stays open, and `Ctrl+R` finds
  the same words in the current text (nearest the old place) or, if they are gone, goes back to picking
  with your text kept.
- **Retries can't duplicate.** Every comment and reply carries a `requestId`, made once per comment and
  reused when you send the same text again. If the answer is lost (timeout, dropped socket), `Ctrl+S`
  again gets back the comment the service already saved. If you change the text after a lost answer,
  the door says it could become a second comment and waits for another `Ctrl+S`.
- **Resolve / reopen** is `annotations.lifecycle`. It sets a state, so repeating it is harmless.
- **While commenting** the reader stays on its note and takes every key. `Ctrl+C` and closing the
  screen ask twice when a comment is unsent, and copy it to `drafts/` if you go ahead.
- **Attribution:** comments and replies are `author: user`, like the outliner's own Detail (the service
  takes an actor id only on agent comments). Resolve and reopen record `actorId: ep0ch-door:<hostname>`.
  An agent's comments and replies (below) are `author: agent` with the agent's actor id, and so is one
  you and an agent both wrote (see "Who a write is recorded as").
- The reader's header counts open comments; the desk's thread pane lists them and refreshes on outline events.

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
- **Live figures** (`src/live.ts`): give a figure `query: "type=outbox-item ticket=PC-762"` or `view: ((block-ref))`
  instead of values, and the door answers it from the outline on every render, re-asking when the outline changes.
  The note stores the question, so status lives in one place. Footer reads `live · N results`.
  - `check`: `done: "outbox=done"` ticks rows, `note: waiting-on` adds a property line
  - `stat`/`kpi`: each item takes its own `query`/`view`; the value is a live count
  - `rank`: `group: ticket` counts per value · `table`: `columns: [ticket, title, waiting-on, updated]`
  - `timeline`: dated by `updated`/`created` or `date: <property>`, `now: "<filter>"` · `meter`: share matching `done`
  - `view:` reads a saved virtual branch the faithful way (ranks, limit, errors); `query:` is an explicit filter.
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

## Letting an agent see what you see, and do what you do

A running door listens on `~/.local/state/ep0ch-door/door.sock` (a second door uses `door-<pid>.sock`):

    bun src/main.ts peek              # screen as text + structured state: board, lanes, selection, each reader's note, draft, comment, threads
    bun src/main.ts snap [out.png]    # PNG of exactly what the terminal was sent, images included
    bun src/main.ts open <block-id>   # put a block in front of the user (board: the detail; desk: the reader; river: a column)
    bun src/main.ts actions           # what the current screen can do, with arguments and the keys that do the same
    bun src/main.ts act <action> [reader=<reader>] [key=value…] [--as <actor-id>]

`snap` comes from a mirror that receives every byte written to the terminal (`src/mirror.ts`, the same
compositor the snapshot harness uses), so it shows what is actually on screen, not a re-render.
`open` flashes "an agent opened: …" so it's never silent.

**Acting.** Almost everything you do in a reader, and on the board, is a named action with typed
arguments (`src/surface/actions.ts`). Keys run them, and `act` runs the same code for an agent, so an
agent's edit meets the same revision check, property warning and duplicate-safe comment sends as yours:

| Action | Arguments | Keys it stands for |
|---|---|---|
| `open` | `id`, `reader=detail\|new-detail\|preview\|float` (board), `reader=<pane>` (desk) | `Enter`, `Alt+Enter`, `o` |
| `focus` | `reader=<reader>` or `reader=lanes` | `Tab`, click |
| `card.select`, `card.move` | `id`; `lane`, `card` (default the selected card) | `j k`, `H L`, `m`, drag |
| `card.create` | `lane`, `text`, `parent` (default the lane's) | `n`, typing, `Ctrl+S` |
| `note.create` | `text`, `parent` (default the selected card) | `N`, typing, `Ctrl+S` |
| `steps`, `step.set` | `card` (default the selected card); `step` (number from 1, or `^id`), `status=todo\|done\|waiting\|problem` (default toggles done) | `s`, `j k`, `space x w !` |
| `card.trash`, `card.restore` | `confirm=<the card's id>` (the second `d`), `card`; `id` (default the card trashed last) | `d d`, `u` |
| `edit`, `edit.text`, `edit.save`, `edit.reload`, `edit.close` | `text`; `discard=true` | `e`, typing or `$EDITOR`, `Ctrl+S`, `Ctrl+R`, `Esc` |
| `passage.select`, `comment.write`, `comment.send`, `comment.close` | `quote` (exact words), `near`; `body` | `c`, `j k J K h l H L`, `Enter`, `Ctrl+S`, `Esc` |
| `comment` | `quote`, `body` (select, write and send in one) | |
| `threads`, `reply`, `resolve` | `thread` (id or 6+ chars), `body`; `open=true` reopens | `m`, `r`, `x` |
| `link.select`, `link.follow`, `up` | `n` (from 1) | `[ ]`, `Enter`, `u` |

Readers are named `preview`, `detail1`, `detail2`, `float1`…, `tree`, `backlinks` on the board and by pane
number on the desk; `reader=focused`, or a block id (the reader showing it) work too, and no reader means
the focused one. `peek` lists them with what each shows. A value `@file` is read from a file, `@-` from
stdin. For example:

    export EP0CH_AGENT=claude-7                       # or --as claude-7 on each call
    bun src/main.ts act open id=<card> reader=preview
    bun src/main.ts act edit.text text=@draft.md      # replaces the draft; opens the edit if needed
    bun src/main.ts act edit.save                     # a property change is reported first; act edit.save again saves
    bun src/main.ts act comment quote="the wind is strong there" body="Soft twine?"
    bun src/main.ts act card.move lane=Doing
    bun src/main.ts act card.create lane=Doing text="Replace the doormat [project::ep0ch-door]"
    bun src/main.ts act step.set step=2                # toggles done
    bun src/main.ts act card.trash card=<id> confirm=<id>
    bun src/main.ts act card.restore

An action answers with JSON when it has landed (`{"saved":true,"revision":5}`), or fails with the reason
the door would show you (a stale revision, a quote that isn't in the note, a lane whose query a move can't
satisfy); nothing is half-done.

**Provenance, not permission.** An agent needs no approval, but nothing it does is silent or passed off
as yours: the status bar says `an agent (claude-7) · …` for every action and everything it makes the door
say, the reader it touched says what it did (`an agent (claude-7) saved this note`) until it shows
another note, a draft or comment it typed says so in its frame, and its writes are recorded as
`author: agent`, `actorId: <its id>` (default `ep0ch-door:<hostname>:agent`). The `$EDITOR` handoff stays
yours: it would take over your terminal. `peek` shows the last agent action per reader.

**Nobody's text is lost.** Each draft and comment remembers who changed it last; every keystroke of yours
makes that you. When an agent replaces text someone else changed last (your typing, however often it has
typed there before, or another agent's), that text is copied to `drafts/` first, the draft says where, and
the action answers `keptYourDraftAt`. While a save is checking properties or landing, or a comment is
sending, the draft holds still: keys wait and an agent's `edit.text`, `edit.close`, `edit.reload` and
`comment.write` are refused with the reason. An agent's `card.select` and `card.move` move the lanes'
cursor, never your keys; only `open` and `focus` move them, and they say so in the status bar. Readers in a
shut drawer (`tree`, `backlinks`) are refused until the drawer is open, so nothing changes out of sight.

**Who a write is recorded as.** A save or send is recorded as whoever wrote the text, not whoever
pressed `Ctrl+S` or called `edit.save`:

- One party changed it since the edit opened: theirs. You saving a draft only the agent typed records the
  agent; the agent saving what only you typed records you (`author: user`, `actorId: ep0ch-door:<hostname>`).
- Both did: the saver's, and the actor id names everyone, saver first, joined by `+`, e.g. `author: user`,
  `actorId: ep0ch-door:<hostname>+claude-7`. A comment is the exception in form, not substance: the service
  takes an actor id only on agent comments, so one you both wrote is `author: agent` with that same joined
  actor id, rather than yours with the agent left out.

The edit frame says which before you save (`an agent (claude-7) typed this · it saves as the agent's`,
`an agent (claude-7) and you typed this · saved as whoever saves it, naming both`), the status bar says
`recorded as …` whenever that isn't simply the saver, and `edit.save` answers with `recordedAs`.

## On the service platform

The service owns what things mean; the door asks it. Each newer service feature is used when the service
has it and has a fallback when it doesn't, so one door works against old and new services alike.

- **Capabilities.** `ping.capabilities` (PIE-402) is trusted when the service sends it. Without it the door
  tries each newer action once and remembers an "Unsupported action" answer for the session. `peek` shows
  what the door uses (`service.uses`).
- **Saved views** (lanes, and `view:` in live figures) come from `views.read` (PIE-397); `src/views.ts` is
  the fallback. `scripts/parity.ts` compares the two over every saved view, printing counts only.
- **Lists without full text.** Lanes, board discovery and Who's Online read titles, properties and revision
  only (`views.read`'s compact rows, `blocks.query` `fields`, `blocks.read`; PIE-400). A reader fetches the
  whole note before showing, editing or commenting on it. The river still reads full notes: its cards show
  their bodies.
- **Change feed** (PIE-399). Each change refreshes only what it touches: readers showing that note (not the
  door's own save), the threads it belongs to, and the lanes the note was in or could now be in. The door
  uses a lane's plain clauses only to rule lanes out; membership always comes from the service, and a lane
  whose query uses OR is always asked. Drafts are only ever marked "changed elsewhere". Without a feed the
  board reloads every lane shortly after any change, as before.
- **Reconnecting.** When the service restarts the status bar says `offline`; the door reconnects with
  backoff and replays what it missed from `changes.since`. No feed, a feed reset, or more than a page missed
  reloads everything instead. The door also lets go of its idle request connection when the event connection
  drops, so it doesn't hold up the service's shutdown.

## What the door sends

Reads: `ping`, `children`, `blocks.context`, `blocks.query`, `tree.index`, `references.backlinks`,
`annotations.list`, `clients.list`, `activity.recent`, plus `events.subscribe` as an `observer`, which
puts the door in `clients.list` until it exits. When the service has them: `views.read`, `blocks.read`,
`properties.preview` and `changes.since`.

Writes, only on an explicit key or an agent's `act` (then attributed `author: agent` and its actor id):

- `update` when you save an edit, with `expectedRevision`, attributed `author: user`, `actorId: ep0ch-door:<hostname>`.
- `properties.patch` when you move a card between lanes, with `expectedRevision`, attributed the same way.
- `annotations.batch` (one `block-comment` operation) when you send a comment: `expectedRevision`, the
  exact quote and its offset, and a `requestId`.
- `annotations.reply` when you send a reply, with a `requestId`.
- `annotations.lifecycle` when you resolve or reopen a thread.
- `create` for a new card or a note under one: `author: user` for yours (the service takes an actor id
  only on agent blocks), `author: agent` with `provenance.actorId` for an agent's. Never retried.
- `checklist.update` when you set a step, with the step's evidence (and its read revision when it has no
  id), attributed like an edit.
- `delete` (to Trash) and `trash.restore`; the service records no author for either.

Reads for those: `checklist.query`, and `properties.preview` before a create.

The service has no auth or read-only mode, so these limits are the door's own discipline.

## Checking it

    bun test
    bun run check
    bun scripts/snap.ts           # drives the real door against the live outline and writes out/snap-kitty-*.png
    bun scripts/snap.ts cells     # same, cells mode
    bun scripts/snap.ts desk      # the desk at 200×60: expand, focus, add a pane, dock, search
    bun scripts/snap.ts river     # the river at 200×60: open beside, replies, compression, jump
    bun scripts/render.ts SHY-EMNU.ANS   # one piece to out/*.png
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts edit   # seeds a board, edits, races a second writer
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts move   # seeds a board, moves by key, picker and drag, a refusal, a stale card
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts comment   # quotes, comments, replies, resolves, races a second writer
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts agent     # an agent drives the board through the control socket: open, edit, save, comment, move
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts journey   # its own scratch service: the whole journey above, restart included
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts kanban    # its own scratch service: OR lanes, a move and a refusal, n, steps, trash and undo
    EP0CH_SOCKET=<sock> bun scripts/parity.ts               # read-only: views.read vs src/views.ts over every saved view

`test/kanban.test.ts` creates cards and notes, sets steps, trashes and restores, and moves into OR lanes
by keys and through the control socket, and checks `src/query.ts` against the outliner's parser and
evaluator. `test/edit.test.ts`, `test/move.test.ts` and `test/comment.test.ts` save, move, comment and race real
writes against a throwaway outliner service they start themselves (own state dir and workspace, Inbox
agents off). `test/platform.test.ts` adapts to what that service advertises: `views.read` against the
door's evaluator, which lanes a change asks again, a dropped connection's catch-up, a service restart
(graceful, with the door connected) and a feed reset. Run it with `EP0CH_OUTLINER` pointing at an older
and a newer checkout to cover both the fallbacks and the new paths. `test/move.test.ts` also checks the door's query parser against the outliner's
`block-query.ts`, and every lane after the moves against the outliner's own `saved-view-read.ts`. Point
`EP0CH_OUTLINER` at a pi-herdr-outliner checkout (default `../pi-herdr-outliner`); without one those tests
skip. The `edit`, `move` and `comment` snapshots write too, so they refuse to run unless
`EP0CH_SNAP_WRITES=1`: never point them at a real outline.

`scripts/snap.ts` runs a small emulator over the exact bytes the door writes (cursor moves, colour,
Kitty upload, place, crop and delete) and composites them into a PNG.

## Known limits

- Live figures' ad-hoc `query:` still uses the clause grammar (no OR/NOT/dates); `view:` gets the full
  grammar through `views.read`.
- A reconnect that missed more than 500 changes reloads everything rather than paging the feed.

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- The editor counts one cell per character, so wide (CJK, some emoji) characters misplace the cursor.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
