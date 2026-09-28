# ep0ch-door

A BBS door into a pi-herdr-outliner outline: it reads everything, edits notes in place, moves cards between
board lanes, and comments on them. It talks straight to the outliner service's Unix socket (protocol 80 or
newer, using newer features when the service advertises them) and is not part of the outliner.

The screens are ep0ch's own 1997 art by shypht, read in place from the WOE art packs:
the logon (`SHY-LOGI.ANS`), the main menu (`SHY-EMNU.ANS`, whose twelve "Menu Cmd"
slots now hold live commands), and the bulletin (`SHY-EPO!.ANS`).

The words used here for screens, panes, readers and actions are defined in the
[UI grammar and glossary](docs/UI-GRAMMAR.md), with an audit of every screen against them.
Before adding a feature, check its [reuse map](docs/UI-GRAMMAR.md#before-adding-a-feature).
[AGENTS.md](AGENTS.md) has the workflow for agents, and [CONTRIBUTING.md](CONTRIBUTING.md) has
verification and the review checklist.

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
4. `C` (from the lanes, or in the preview), pick a passage (`j k h l`), `Enter`, write, `Ctrl+S`; `m` lists the threads.
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
| reader | the current block; follows the selection unless held (`p hold`, `p` again follows); `[ ]` pick a link, `⏎` follow (or click it), `u` parent, `( ) f F` fold |
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
- **`c`** collapses what has focus to a spine: a lane, or the preview or a detail. A reader's spine shows its
  note's title (rotated under Kitty graphics, stacked letters in cells) and marks what it holds: `✎` an
  edit, `¶` a comment, `≡` the property panel, `■` comments that arrived while it was collapsed. The freed
  width goes to its neighbours. `c`, `⏎` or a click on a spine opens it; `alt+c` opens everything collapsed.
  A collapsed reader keeps its edit, comment or property panel exactly: nothing is saved, sent or dropped,
  `Ctrl+C` still asks twice, and opening it returns to it (`e` enters it again). Its own keys don't reach
  it while collapsed. A note opened into a collapsed reader (`⏎`, `open`) opens it. Floats don't collapse.
- **Agents** collapse and open readers with `reader.collapse reader=detail1` and `reader.expand`
  (`reader=all` is `alt+c`). Both are flashed with the agent's id and shown by `peek` (`collapsedBy`). An
  agent never collapses the reader you have focused, and its expand never moves your focus. Note actions in
  a collapsed reader are refused until it's opened.
- **Resize** by dragging any border: between lanes, between preview and details, lanes/readers, drawer edges.
  Keys: `{ }` lane height, `< >` width of the focused lane or reader.
- **`o`** pops the focused reader out as a floating pane: drag its title to move, drag `◢` to resize, `H J K L`
  to nudge, `o` again to dock it back as a detail, `x` to close.
- **`t`** outline drawer with its own mini preview underneath; slides over unless pinned (`T`, or click `[ ] pin` in its top border: pinned, it becomes part of the layout); `S` moves it
  to the other side so it doesn't cover the preview.
- **`b`** backlinks drawer spanning all readers, with its own preview of the selected source and the quoted
  snippet; `B` or a click on its `[ ] pin` pins it into the layout; ⏎ / alt+⏎ or a click opens a source in a detail. A link clicked in either drawer's
  preview opens in a detail too.
- Layout, pins, collapsed lanes, a collapsed preview and drawer side are saved to `delivery.json`. Details
  aren't saved, so neither is their collapse.

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
| `[[`, `((`, `[file::` while typing; `Tab` or `Ctrl+Space` | reference completion: keep typing to filter, `↑↓` or the wheel choose, `Enter`/`Tab` or a click inserts, `Esc` dismisses |

- **Reference completion** works in every draft, comments and replies included, the way Tree, Detail and
  Quick Capture do it, from the same service lookups, so the door keeps no index: `[[` offers pages,
  aliases and Work IDs (`pages.complete`), `((` blocks by text (`blocks.query`), `((note#heading` or
  `((note^id` their fragments, and `[file::` workspace paths (`files.complete`). The selected candidate
  shows where it sits and how it starts (`blocks.context`). A Work ID inserts `[[WORK-ID|title]]` (or
  `[[WORK-ID]]` when the title holds link delimiters), a page or alias `[[address]]`, a block
  `((id))`, a fragment `((id^fragment))`, a folder `[file::dir/` (its entries come next) and a file
  `[file::path]`. Choosing checks the target still answers first. A heading in the note being edited
  gets its `^anchor` in the draft when chosen; headings without one in other notes aren't offered (that
  would write to them). The popup never keeps a key it doesn't use: with nothing to choose, `Enter`,
  arrows and `Esc` do what they do in a draft, the first `Esc` only closes the popup, and `Tab` outside a
  token indents. A service without a lookup says so in the popup, and typing carries on.
- **Saving** sends `update` with the revision the draft started from. The service refuses it if anyone
  else saved since, and the door never retries it over their text: the draft stays open, is copied to
  `~/.local/state/ep0ch-door/drafts/`, and `Ctrl+R` starts over from the current revision.
- **While a draft is open** the reader stays on its note, takes every key (board and window shortcuts
  included), and marks "changed elsewhere" when an outline event says the note moved on, instead of
  replacing what you typed. `Ctrl+C` asks twice when an edit is unsaved.
- **Keys follow the editor** (board and desk): only the focused reader's edit, comment or property panel
  takes keys, and only one you are in. One you open by key (`e`, `C`, `m`, `i`, from the lanes too) is
  yours as it opens, and focus moves to it; if you press `Esc` or move away before the note has been
  read, it doesn't open. One an agent opened, or yours after you moved to another area, doesn't take
  your keys: `Tab`, `Esc`, the lanes and window keys keep working, `j k PgDn Space` scroll the reader,
  `x` refuses to close one holding an edit or a comment, and `e` or `⏎` enters it. The frame title
  and the hint row say which it is (`editing (e enters)`). The mouse wheel always scrolls whatever is
  under the pointer.
- **Scroll indicators:** a reader whose note is longer than its frame shows a thumb on the frame's right
  border and how far down it is in the title (`· 42%`): board readers, floats and the desk's reader.
- **Properties:** the service decides which `[key::value]` tokens are properties (one followed by more
  text on its line is plain text). When the service offers `properties.preview` (pi-herdr-outliner
  PIE-401), the first `Ctrl+S` on a draft that would change them says which and writes nothing; `Ctrl+S`
  again saves. Older services save at once, and the reader then says which properties changed.
- **Attribution:** door edits are recorded as `author: user`, `actorId: ep0ch-door:<hostname>`, like the
  outliner's own Detail.
- `peek` reports open drafts under `editing` (dirty, changed elsewhere, refused, where the copy went).

## Commenting

The same readers comment on the note they show, with `C` (`c` collapses on the board). On the board, `C`
in the lanes comments in the preview.

| Keys | Action |
|---|---|
| `C` | pick a passage to quote; the reader switches to the note's source text with the passage highlighted |
| `j k` | move to the next / previous line with text (the whole line, without its indent) |
| `J K` | extend / shrink the passage by a line |
| `h l`, `H L` | move where the quote starts (`h l`) or ends (`H L`) by a word |
| `Enter` | write the comment under the quote; `Ctrl+S` sends, `Ctrl+E` hands it to `$EDITOR` |
| `m` | the note's comment threads: `j k` pick, `r` reply, `x` resolve or reopen, `C` a new comment |
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

Every reader (board, desk) shows a note the way the outliner's Detail does: the title, a one-line
**summary** of chosen properties, then the body. The block's `[key::value]` metadata lines aren't
printed; they are in the **property panel**, one key away.

- **Summary line.** Keys come from, in order: the saved view the note is shown from (a board lane's
  `[summary-properties::priority,track]`), your own choice (`s` in the panel, or `act props.summary`,
  kept in `properties.json` in the door's state), `OUTLINER_PROPERTY_SUMMARY_KEYS` (Detail's variable;
  empty hides the line), then `status,work-stage,priority,track`. As in Detail, `work-stage` reads
  `stage`, repeated values are joined (`track soil, tools`), and a roadmap item's `status` is left out.
- **Which lines are metadata** is the service's call: `properties.preview` (PIE-401) says which tokens
  are block-scope metadata lines. Bare `key:: value` lines (line scope) and inline tokens stay in the body.
  An older service gets the documented rule (the first run of property-only lines after the subject).
- **Links** read as Detail shows them: `((id))` as the target's title, `((id|label))` as its label,
  `[[page]]` as written, without delimiters. Titles, trash state and fragments come from
  `references.resolve`, pages and Work IDs from `pages.resolve` (read-only; nothing is created). A missing
  target reads `label · Missing target`; a trashed one `title · Trash`; a missing fragment says so.
  Code keeps its text, and edit mode, comments and storage keep the raw syntax.
- **Clicking a link opens it**, where `[ ]` then ⏎ on it would (in place in a board reader or float,
  the desk's reader, a column beside in the river), and it becomes the selected link: `((…))`, `[[page]]`,
  `[[Work ID]]`, an embed's title and an embedded view's results, and in the summary line and the
  property panel a value that names a block, a page or a Work ID (a click on a panel row selects it).
  Clicks find links where they are drawn, so scrolling and wrapping move them with the text. A missing
  target says so and nothing opens.
- **Transclusions.** `!((id))` shows the target note, read-only, in a shaded region. A virtual-branch
  target shows its results (`views.read`), with the view's `[summary-properties::]`, its count and
  `TRUNCATED at N`, or `EMPTY`, `CONFIG ERROR`, `QUERY FAILED`. `!((id^fragment))` checks the fragment
  with the service and shows the whole note with "fragment slices need PIE-404": the service doesn't
  serve slices yet and the door doesn't re-derive the fragment rules. Missing and trashed targets,
  missing or duplicate fragments, failed reads and the 17th embed (`EMBED LIMIT · maximum 16`) each say
  what they are. Embeds refresh when their target changes (an embedded view: when anything does) and
  are never recursive: an embed's own `!((…))` reads `!title · embed not expanded here`. `!((…))` in
  inline code or a code fence stays code. A note's embed targets are read together (`blocks.read`), and
  its links and block-valued properties resolve in one `references.resolve`, asked again only when a
  change record names one of those blocks.

### Folding

Readers fold headings and nested lists the way Detail does (PIE-386). A heading folds everything through
the next heading of the same or a higher level; a list item folds its nested items and continuation
lines, keeping its own line. Each one shows its disclosure, `▾` open and `▸` folded
(`▸ ## Beds · 7 lines folded`), and a click on it folds or unfolds. Folding is this reader's
reading state: the note's text never changes, another reader can show the same note unfolded, and
folds stay through live refreshes and edits elsewhere in the note. A fold whose heading or item is
reworded or removed is dropped, so it never hides a different section; a heading with an anchor
(`## Beds ^beds`) keeps its fold by the anchor, and a step keeps its fold when it's ticked. Repeated
headings (two `## Notes`) are told apart by their order. Showing another note in the reader starts it
unfolded.
`#` lines in a code fence or a figure are text, not headings.

| Keys | Action |
|---|---|
| `(` / `)` | select the previous / next heading or list item that folds (`▾`, yellow); the hint names it |
| `f`, `⏎` | fold or unfold the selected one; `f` with none selected folds the section at the top of the view. `⏎` folds only while a selected one is in view |
| `esc`, scrolling, `[ ]`, `u` | let go of the selected one, so `⏎` means what it did before (the preview opens a detail) |
| `F` | fold every outermost section and list item; with anything folded, unfold everything |
| click | a heading (anywhere on its line but a link, which opens), or a list item's `▾`/`▸`, folds or unfolds it; the frame and its scroll thumb don't |
| `z` | unfold callouts that start folded (`[!x]-`); unchanged |

Agents do the same through `folds`, `fold`, `unfold` and `fold.toggle` (by `text`, `line` or `n`, or
`all=true`), and leave the person's selection and scroll where they were. River columns show only a note's first lines, so they don't fold.

### The property panel

`i` in any reader (Detail's Props inspector), and on the board from the lanes too (the preview takes
focus with it open); `I` fills the reader with it instead. It lists every
property token of the note: repeated keys stay separate rows, and line and inline scope are marked.
`■` marks the keys the summary line shows. While it is open it takes the reader's keys, the board's and
desk's own shortcuts (`Tab`, `o`, …) included, except scrolling: `PgDn`, `PgUp` and `Space` still page
the note (or the list, when it fills the reader). An agent's `props` actions never open it: the rows
come back in the reply and the reader stays as the person left it.

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab`, `j k` | next / previous value |
| `y` | copy the value, as authored, to the terminal's clipboard (OSC 52); only your `y` does, an agent's `props.copy` just returns it |
| `o` | follow a block (`related-to::<id>`, `((id))`), `[[page]]` or Work-ID value (the workspace's own prefix) |
| `Enter` / `e` | edit the value in place; `Enter` saves, `Esc` cancels |
| `s` | show or hide this key in the summary line (your choice) |
| `I`, `Esc` / `i` | full / inline; close |

- **An edit is one `properties.patch`** of that token (its `ordinal` from `properties.preview`), with the
  revision the panel read. If anyone saved the note since, the service refuses it and the field says
  "changed elsewhere · not saved"; nothing is retried over their change. Values are one line without
  `]`, like the service's own rule; a `#hashtag` stays one word (edit the note to change its form).
  While a value is being typed the reader stays on its note, like an edit.
- Rich-document editing in place is PIE-404; the panel only edits property values.

Bodies render with `src/doc.ts`:

- **Images and video.** A line that is only `img:: path`, `[img::path]` or `[video::path]` becomes an inline image
  through Kitty. Big images are shrunk with `sips`, video gets a poster frame from `ffmpeg` (or Quick Look), cached in
  `~/.cache/ep0ch-door/media`. `\ ` escapes and macOS screenshot names (narrow no-break space before AM/PM) resolve.
  `[ ]` selects an image like a link and ⏎ opens it in the system viewer. Images a drawer or float covers are hidden.
  If macOS blocks the read (Desktop, Documents), the line says so: grant the terminal Files & Folders access.
- **Callouts.** `> [!note] Title` (tip, warning, danger, summary, example, question, quote, …) render as colored boxes;
  `[!x]-` starts folded, `z` unfolds. Headings and list items fold too (see Folding).
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
  - `view:` reads a saved virtual branch the faithful way (ranks, limit, errors); `query:` is an explicit filter
    in the saved-view grammar: `OR`, `NOT`, parentheses and `created`/`updated` ranges go to the service as
    `blocks.query` `expression` when it advertises `query.expression` (PIE-398). Older services take plain
    clauses, and a query that needs more says so instead of being misread. `done:` and `now:` are matched
    against each result in the door, so they stay plain clauses.
- Long callout titles keep a short head on the border and flow the rest into the box.
- Code fences, headings, lists, blockquotes, `**bold**`, `[[links]]`, `((refs))` and `[key::value]` are styled.

## The river

`Q` on the menu, or `bun src/main.ts --river`. Quay's model (built with Grok from an outline export, in
`~/projects/tundra-heart-crane-lotus`) on the live outline instead of a seed file:

- **Placement (niri):** `⏎` inserts a column right after its source, or jumps to it if that note is already a column. `alt+⏎` forces a duplicate.
- **Compression (Andy's notes):** columns get full, peek or spine width by distance from focus; docked (`p`) columns resist. Spine titles are rotated VGA text (Kitty) or stacked letters (cells), drawn by the same spine part as the board's lanes and readers (`src/spine.ts`).
- **Threads (Twitter):** `space` expands replies in place under a rail; `s` splits a note into a stacked pane in the same column; `tab` moves between stacked panes.
- **Per-pane filters:** `f`, then `type:hub -status:done author:codex word`.
- **Virtual branches:** `#` lists the note's properties; pick one for a column of every note sharing it.
- **Jump:** `/` searches the whole outline index locally, with no round trip per keystroke.
- **The note surface:** every full-width column hosts the same note surface as the board's readers. `e` edits the column's note (`ctrl+e` in `$EDITOR`), `C` picks a passage to comment on, `m` lists its comment threads (reply, resolve), `[ ]` select a link and `⏎` follows it beside (a click on a link in the column's note does too, and its links read as titles), `u` opens the parent beside. The column's note is the one it was opened on; in the Library and a `#tag` column it's the selected one. Reading looks as it did; the edit, the passage picker and the threads draw in the column. A column holding an edit resists compression, and a spine shows `✎` for it. Peek and spine columns are read-only views. Leaving the river (or a SIGTERM) with unsaved text copies it to disk first.
- **Agents:** `actions` lists the river's own (`open`, `focus`, `select`, `replies`, `split`, `pin`, `close`) and every note action.
  - `reader=` is a pane id (`r7`: stable while the pane is open, returned by `open` and `split`, listed by `peek` and `actions`), a column number (`2`, or `2.1` for a stacked pane), `focused`, or a block id. Replies carry both: `reader: "r7"`, `at: "3"`.
  - Column numbers shift as columns open and close. An agent's edit or comment carries on only in the pane holding it: addressed by a number that now names another pane, it's refused with the pane's id.
  - A block id prefers the pane holding the agent's own edit or comment on the note, then a full-width column opened on it, then any pane editing it, then a list selecting it.
  - An agent never moves the person's focus: `open`, `split`, `up` and `link.follow` open beside and leave the keys where they are (`focus` is the explicit handover).
  - Starting a note action in a compressed column is refused; `pin` docks the column so it widens without taking the keys. An edit or comment already open in a squeezed column still takes its actions.
- **The person's keys and an agent's session:** a column holding an agent's edit or comment (or one of yours you moved away from) doesn't take your keys: `h l`, `tab` and `x` keep working on the river, and `e` or `⏎` enters it. `esc esc` on unsaved text an agent wrote copies it to disk before closing.
- **Notices:** "properties changed" and an agent's line under a note clear on your next key or click in that pane, or, in a pane you aren't in, on your first action after 30 seconds on screen.
- **Quote** (a new note quoting this one) isn't here yet; `C` comments on a passage instead.

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
| `reader.collapse`, `reader.expand` | `reader=preview\|detail1\|detail2` (the focused one by default); `reader=all` expands everything (board) | `c`, `⏎` or a click on a spine, `alt+c` |
| `edit`, `edit.text`, `edit.save`, `edit.reload`, `edit.close` | `text`; `discard=true` | `e`, typing or `$EDITOR`, `Ctrl+S`, `Ctrl+R`, `Esc` |
| `complete` | `text` ending in the token (`[[HOME-4`, `((beds`, `((plan#`, `[file::notes/`), or none for the draft's cursor; `insert=n` puts the nth into the draft | `[[ (( [file::`, `Tab`, `Ctrl+Space`, `↑↓`, `Enter` |
| `passage.select`, `comment.write`, `comment.send`, `comment.close` | `quote` (exact words), `near`; `body` | `C`, `j k J K h l H L`, `Enter`, `Ctrl+S`, `Esc` |
| `comment` | `quote`, `body` (select, write and send in one) | |
| `threads`, `reply`, `resolve` | `thread` (id or 6+ chars), `body`; `open=true` reopens | `m`, `r`, `x` |
| `link.select`, `link.follow`, `up` | `n` (from 1) | `[ ]`, `Enter` or a click, `u` |
| `props` | `full=true` | `i`, `I` |
| `props.copy`, `props.follow` | `n` (from `props`) or `key` | `Tab`, `y`, `o` |
| `props.edit` | `n` or `key`, `value`, `revision` (refused if the note is past it) | `Enter`/`e`, typing, `Enter` |
| `props.close`, `props.summary` | `keys=a,b` (yours), `toggle=key`, `reset=true` | `Esc`, `s` |
| `folds`, `fold`, `unfold`, `fold.toggle` | `text` (a heading's or item's words, `##` optional, a unique start is enough), `line` (of the note, 1 is the subject), `n` (from `folds`); `all=true` | `( )`, `f`, `⏎`, `F`, click |

Readers are named `preview`, `detail1`, `detail2`, `float1`…, `tree`, `backlinks` on the board and by pane
number on the desk; `reader=focused`, or a block id (the reader showing it) work too, and no reader means
the focused one. `peek` lists them with what each shows. A value `@file` is read from a file, `@-` from
stdin. For example:

    export EP0CH_AGENT=claude-7                       # or --as claude-7 on each call
    bun src/main.ts act open id=<card> reader=preview
    bun src/main.ts act edit.text text=@draft.md      # replaces the draft; opens the edit if needed
    bun src/main.ts act edit.save                     # a property change is reported first; act edit.save again saves
    bun src/main.ts act complete text="see [[HOME-0"  # the candidates the popup would offer
    bun src/main.ts act complete insert=1             # the first, at the open draft's cursor
    bun src/main.ts act comment quote="the wind is strong there" body="Soft twine?"
    bun src/main.ts act card.move lane=Doing
    bun src/main.ts act card.create lane=Doing text="Replace the doormat [project::ep0ch-door]"
    bun src/main.ts act step.set step=2                # toggles done
    bun src/main.ts act card.trash card=<id> confirm=<id>
    bun src/main.ts act card.restore
    bun src/main.ts act props                         # every property token, with scope and ordinal
    bun src/main.ts act props.edit key=priority value=low revision=7

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
`annotations.list`, `clients.list`, `activity.recent`, `references.resolve`, `pages.resolve`, plus
`events.subscribe` as an `observer`, which puts the door in `clients.list` until it exits. When the service
has them: `views.read`, `blocks.read`, `properties.preview` and `changes.since`, and `blocks.query`
`expression` with `query.expression`. While a draft completes a reference: `pages.complete`, `files.complete`,
`blocks.query` `text` and `blocks.context` (an "Unsupported action" is remembered for the session).

Writes, only on an explicit key or an agent's `act` (then attributed `author: agent` and its actor id):

- `update` when you save an edit, with `expectedRevision`, attributed `author: user`, `actorId: ep0ch-door:<hostname>`.
- `properties.patch` when you move a card between lanes, or save a value in the property panel, with
  `expectedRevision`, attributed the same way.
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
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts props     # a roadmap-like card: summary line, panel (inline, full, edit, a refused edit, follow), every embed state
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts journey   # its own scratch service: the whole journey above, restart included
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts kanban    # its own scratch service: OR lanes, a move and a refusal, n, steps, trash and undo
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts fold      # its own scratch service: fold by keys, a click and F, an edit elsewhere keeps folds, an agent unfolds, the desk
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
skip. The `edit`, `move`, `comment`, `agent` and `props` snapshots write too, so they refuse to run
unless `EP0CH_SNAP_WRITES=1` and `EP0CH_SOCKET` is set explicitly to a socket under the temp dir whose
service serves a workspace there too (a scratch service): they never fall back to the default socket.

`scripts/snap.ts` runs a small emulator over the exact bytes the door writes (cursor moves, colour,
Kitty upload, place, crop and delete) and composites them into a PNG.

## Known limits

- Live figures' `done:` and `now:` take plain clauses; `query:` needs `query.expression` for OR/NOT/dates.
- Fragment transclusions show the whole target until the service serves fragment slices (PIE-404).
- Relation-view and checklist-view targets embed as ordinary notes, not as Detail's projections; an
  embedded view's result rows aren't followable (follow the `!((…))` link itself); `!((…))` inside a
  callout or a table stays a link.
- A reconnect that missed more than 500 changes reloads everything rather than paging the feed.

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- The editor counts one cell per character, so wide (CJK, some emoji) characters misplace the cursor.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
