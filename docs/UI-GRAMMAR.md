# UI grammar and glossary

One vocabulary for the door's screens, checked against the code on `feature/door-writes`
(PIE-433). Use it to name things in code, READMEs and roadmap items, and to judge whether a
new screen reuses the grammar or invents its own.

## Before adding a feature

Check here for the part that already does it. Skipping this step is how the door got two readers,
three pane models and four searches (§4).

| The feature needs to… | Use | Where |
|---|---|---|
| render or read a note | `NoteSurface`, hosted through `SurfaceHost`; the body drawn by `renderDoc` after `presentLinks`; literal regions (PIE-422) found by `src/literal.ts`, inline Markdown (PIE-444: bold, italic, strikethrough) by `src/inline.ts` (checked against marked, Detail's parser) and `component:` fences by the reader host's renderers in `src/components.ts` (checked against the service's `documentComponent`), each the outliner's rules mirrored and parity-tested; Markdown links open through `src/open.ts` | `src/surface/note.ts`, `src/doc.ts`, `src/refs.ts`, `src/literal.ts`, `src/inline.ts`, `src/components.ts`, `src/open.ts` |
| let a person or agent do anything | the action registry: an `ActionDef` in an `ActionSet`; the key and `act` both call it | `src/surface/actions.ts`, `NOTE_ACTIONS` in `src/surface/note.ts`, `src/control.ts` |
| edit text, complete `[[` `((` `[file::` | the editing component: `Draft`, edit control, completer | `src/edit.ts`, `src/surface/editor.ts`, `src/surface/completer.ts`, `src/completion.ts` |
| open, split, zoom, close panes | the pane model: the layout tree (PIE-412), n-ary splits by weight with spines (`fixed`), minimums, drawers that slide over or pin (`over`), floats, borders that follow the pointer; the desk and the board are on it, the river's strip next (PIE-412 slice 2). Every operation is a `pane.*` action (split, close, resize, zoom, float, pin) | `src/desk/layout.ts`, `src/desk/pane-actions.ts`, `src/desk/panes.ts` |
| squeeze a pane to a title strip | the spine part: `drawSpine`, `SPINE` (rotated title under Kitty, stacked letters in cells, marks) | `src/spine.ts`; river columns, board lanes and readers |
| show children, outlinks, backlinks, resources | entity navigation (PIE-432); today `u` and link selection in the surface, `references.backlinks`; backlinks presented as Detail presents them (PIE-442): `backlinkView` and the panel's text in `src/backlinks.ts`, Detail's `backlink-view.ts` over the service's facets, mirrored and parity-tested (`backlinkRows`, `backlinkStatusParts`, `describeBacklinkView` for agents) | `src/surface/note.ts`, `src/socket.ts`, `src/backlinks.ts` |
| show who's here or recent activity | presence (PIE-430); today `WhoPane` and `ActivityPane` over `clients.list`, `activity.recent` | `src/desk/panes.ts` |
| put live data in a note | live figures, which read views with `views.read` | `src/live.ts`, `src/views.ts` |
| show a Resource's stored details in a note (a ticket under `jira::`, a ticket page) | resource projections (PIE-445): `projectionsOf` asks the service (`resources.projection.read`, capability `resources.projection`; nothing extra without it), `projectionLayout` is Detail's `resourceProjectionLayout` as drawn (parity-tested), the surface draws each region after its line through `DocEnv.after`, and `resource-catalog` events repaint the ones shown. The door never registers, refreshes or contacts a provider | `src/projection.ts`, `src/surface/note.ts`, `src/doc.ts` |
| move through what a reader draws, or point someone at a block | elements and the reading ruler (PIE-441): `[ ]` over the surface's element list (links, folds, figure rows, embeds, resource projections, comment marks, an expanded thread's controls), ⏎/alt+⏎/click through `enterElement`, `RULER_BG`; a comment mark expands its thread under the passage (PIE-420: `expanded`, the person's reading state like `folded`; drawn as body rows; its Select, Reply, Resolve controls act through `CommentSession`, the thread list's code); an agent's focus mark (`focus.set`) is the same tint. Hosts decide where a link opens from `SurfaceHost.navigate`'s `OpenHow` | `src/surface/note.ts`, `src/surface/selection.ts` |
| select or copy text a reader draws | the selection model (PIE-419): `Selection` over drawn rows, `Gesture` (press, drag, release, double/triple click), `modeKey` (`v`), `paintRange`, `osc52`; the surface hosts it (`press`/`drag`/`release`, `y` `Y`, `select*` actions), and so does the river over its own rows | `src/surface/selection.ts`, `src/surface/note.ts` |
| know anything the service can answer | ask the service: `views.read`, `blocks.read`, `properties.preview`, `changes.since`, `references.*`, gated by `Capability` | `src/socket.ts` |

- **Don't copy the parallel versions:** the BBS `Reader` and `colourBody` bodies (F1), the river's
  pane code (F2), the extra searches (F6), `WhoOnline` and `LastCallers` (F7).
- **Don't re-derive meaning the service owns** (view membership, property parsing, backlinks, what
  changed). A local fallback for an older service is parity-tested, like `src/views.ts`.
- **If the part doesn't exist yet or doesn't fit:** extend it, or write down why not in the PR.
  A new shared part gets a row here in the same PR.
- **Every row has a showcase section** (`scripts/try-it.sh --showcase`, PIE-439), in this table's
  order: `SECTIONS` in `src/showcase/showcase.ts`, drawn by the part itself. A new row gets its section
  and the seed content it needs (`src/showcase/seed.ts`) in the same PR, and a parallel version shown
  beside it until consolidation removes it.
- Name things with the glossary's canonical words (§1).

## TL;DR

- **One reader, two renderers.** Board, desk and river host `NoteSurface`. The BBS `Reader`
  (`scr:256`) is a separate, older reader: its body is `renderDoc`'s (PIE-444), but it has no link
  navigation, props, folds, comments, edit or agent actions.
- **Pane operations exist twice.** The desk and the board share one layout tree (PIE-412): the
  board's lanes, readers, drawers and floats are panes in it. The river still has its strip of columns.
  Keys differ between them (`x`, `o`, `s`, `p`), and zoom exists only on the desk.
- **Agents can arrange the desk and the board.** Note actions are shared everywhere, and the `pane.*`
  actions (split, close, resize, zoom, float, pin) are shared by the desk and the board. The river has
  its own column actions, and BBS screens have none at all.
- **Words collide.** "Reader", "pin", "preview", "detail", "region" and "spine" each mean two
  things, and the door's "detail" is the outliner's *Current*, not its *Detail*.
- **Entity navigation is scattered.** Backlinks exist only on the board. Children appear in
  three shapes. There are no Outlinks/Resources lists and no history on any screen.
- **Duplicates.** Four searches, two Who's Online views, two activity views. The BBS `Search`
  screen (`scr:338`) is unreachable.

## How to read the citations

| Alias | File |
|---|---|
| `app` | `src/app.ts` |
| `scr` | `src/screens.ts` |
| `dsk` | `src/desk/desk.ts` |
| `pan` | `src/desk/panes.ts` |
| `lay` | `src/desk/layout.ts` |
| `del` | `src/desk/delivery.ts` (the board) |
| `riv` | `src/river/river.ts` |
| `note` | `src/surface/note.ts` |
| `ed` | `src/surface/editor.ts` |
| `act` | `src/surface/actions.ts` |
| `pp` | `src/surface/props-panel.ts` |
| `cmp` | `src/surface/completer.ts` |
| `sel` | `src/surface/selection.ts` |

`del:1799` means line 1799 of `src/desk/delivery.ts` at the time of writing.

---

## 1. Glossary

**Canonical** is the word to use from now on. **Aliases** are what the code or README also
calls it. **Tree/Detail** is the pi-herdr-outliner equivalent (or "none").

### Shell

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| shell | Screen stack, status bar, key routing, agent entry | `App` `app:72` | Herdr |
| screen | One full-canvas mode on the stack | `Screen` `app:42` | a Pi pane |
| menu | The screen that opens other screens | `MainMenu` `scr:132` | `?` action list |
| status bar | Last row: screen, host:workspace, offline, video | `app:242` | Herdr frame title |
| flash | A 4-second message in the status bar | `flash` `app:116` | expiring receipt |
| hint row | Key help above the status bar | `dsk:210` `del:1450` `riv:397` | menu row |
| workspace | The outline connected to (one per run) | `ctx.workspace`, `--ws` | workspace |
| video mode | Kitty+CRT, Kitty, cells (`V`) | `cycleVideo` `app:118` | none |

### View and pane

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| view | What a screen arranges: board, desk, river, BBS list | each `Screen` | Tree / Detail |
| pane | A framed rectangle that takes focus | desk `Pane` `pan:28` | Herdr pane |
| — alias: region | The board's name for a pane's place (`preview`, `detail0`, `float0`); the pane itself is a leaf of the layout tree | `Region` `del:31` | *collides:* PreviewRegion |
| — alias: column | A river strip; stacked panes inside | `Col` `riv:47` `PaneS` `riv:28` | none |
| layout tree | Splits over pane ids, each kid by weight; drawers slide over it, floats above it | `LNode` `lay` (desk and board; river next) | none |
| focus | Which pane gets the keys | `focus` in each screen | pane focus |
| entered | You are *inside* a reader's edit, comment or panel | `Entered` `pan:287` | draft focus |
| zoom | One pane fills the view | `dsk:326` (desk only) | Herdr zoom |
| float | A reader popped out over the board | `floatOrDock` `del`, `ScreenLayout.floats` `lay` | none |
| drawer | Slide-over pane: outline or backlinks; in the tree, sliding over unless pinned | `drawer` `del`, `ScreenLayout.over` `lay` | none |
| spine | A pane squeezed to a title strip | `drawSpine` (`src/spine.ts`); river `Cover` `riv:48`, board lanes and readers `c` | none |
| lane | A saved view shown as a board column | `Lane` `del:30` | virtual branch |
| card | One block in a lane | lane items | branch root row |

### Reading and editing (the note surface)

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| reader | Any pane hosting a note surface | `ReaderPane` `pan:184` | Detail |
| note surface | Draws, folds, edits, comments on a note | `NoteSurface` `note:107` | Detail body |
| surface host | What a view gives it: ctx, redraw, navigate | `SurfaceHost` `note:30` | none |
| preview | The reader that follows the selection | board `preview` | **Preview** |
| detail | A reader opened on purpose (`⏎`), keeps its note | `openDetail` `del:521` | **Current** |
| header | Title, crumbs, summary line, notices | `render` `note:268` | menu row + title |
| summary line | Chosen properties under the title | `summary` `note:366` | summary keys |
| property panel | Every property token, editable | `PropertyPanel` `pp:85` | property inspector |
| edit control | Frame + status + keys for any draft | `renderEditor` `ed:25` | Detail edit mode |
| draft | Unsaved text with its base revision | `Draft` (`src/edit.ts`) | draft |
| composer | Board draft for a new card or note | `del:843` | Quick Capture (close) |
| comment session | Passage picker, comment, threads | `CommentSession` | passage comments |
| completion | `[[`, `((`, `[file::` popup | `cmp`; wired at `note:592` | completion |
| fold | Folded heading or list item (reader state) | `note:835` | Folding |
| selection | Text selected in a reader (reading state; only `y`, `Y` or the copy control copy it) | `Selection` `sel:52` | text selection |
| element | What `[ ]` stops on in a reader: a link, a fold, a figure row, an embed, a resource projection, a comment mark; one is current | `elements` `note` | none |
| reading ruler | The tint under the block the current element is in | `RULER_BG` `sel` | none |
| focus mark | A block (maybe a passage) someone marked for the person, in the ruler's tint, named in the header; door-local until PIE-423's service part | `focus.set` `note` | focus mark (PIE-423) |
| embed | `!((id))` transclusion region | `src/embeds.ts` | generated embed |
| resource projection | A Resource's stored details (a ticket: key, summary, allowed fields, status, fetched time and its age) drawn read-only under the `jira::` line that names it, or at the top of a ticket page; ⏎ or a click opens the ticket's page, `y` copies it as drawn | `projectionsOf`, `projectionRegion` (`src/projection.ts`) | resource projection (a Detail region) |

### Entity navigation

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| children | Blocks under a note | `ThreadPane` `pan:299`, river `space`, BBS `T` | Tree children |
| up | The parent | `u` `note:766`, BBS `U` | ancestors menu |
| outlinks | Links in the note (`[ ]` steps to them with the note's other elements, `⏎` follows) | `link.select`, `elements` `note` | **Outlinks** |
| backlinks | Notes that link here, grouped by kind with Detail's defaults (PIE-442) | board drawer `drawLinks`, `src/backlinks.ts` | **Backlinks** |
| resources | `[file::]`, `img::`, media | completion, `src/media.ts` | **Resources** |
| search | Find a block by text | 4 versions, see §4 | Goto search |
| history | Back/forward through opened notes | none | Detail history |

### Agents and presence

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| action | A named, typed thing a key or agent does | `ActionDef` `act:12` | action list |
| action set | Actions for one host kind: note, board, desk, river | `ActionSet` `act:37` | none |
| actor | You or an agent with an id | `agentActor` `app:66` | author, actorId |
| provenance | "an agent (id) · …" on screen and in writes | `asActor` `act:88` | provenance |
| control socket | `peek`, `snap`, `open`, `actions`, `act` | `src/control.ts` | UI commands |
| presence | Who is attached and what they read | `scr:355`, `pan:411` | client registry |
| activity | Recent edits by user, agent, system | `scr:392`, `pan:375` | none |

### Words that mean two things

| Word | Meaning A | Meaning B | Use instead |
|---|---|---|---|
| Reader | BBS screen `Reader` `scr:256` | `ReaderPane` `pan:184` | "reader" = B only |
| pin | Desk reader stops following `pan:234` | River column resists squeeze `riv:879` | **pin** = a drawer joins the layout (`T`, `B`, or its `[ ] pin`); the desk reader **holds** (`p hold`); a river column **docks** |
| preview | Board reader following the card | Desk `/` search's right half `dsk:404` | A only |
| detail | Door: a reader you opened (*Current*) | Outliner: the Detail pane | owner decides |
| region | Board pane `del:31` | Outliner PreviewRegion (focusable item) | "pane" |
| spine | River compression tier | Board collapsed lane or reader | fine: same idea, one part (`src/spine.ts`) |
| `alt+⏎` | Board: second detail | Outliner: keep Preview as Current | align in PIE-413 |

---

## 2. The grammar tree

The proposed tree, refined against what the code does. `[x]` = exists in shared code today,
`[~]` = exists but per screen, `[ ]` = missing.

```
shell                                     App (app:72)
├── [~] screen switcher                   MainMenu + stack; only via the menu
├── [ ] workspace / outline switcher      one SocketBoard per run (PIE-427)
├── [x] status bar, flash                 app:242, app:116
├── [~] hint row                          every screen draws its own
├── [x] unsaved guard                     app:108 (asks twice, copies drafts)
├── [x] agent entry: peek snap open act   control.ts, app:151-194
└── view                                  a Screen
    ├── [~] header                        note:268 for readers; BBS own
    ├── [~] primary content               lanes | layout tree | strip | list
    ├── [~] detail = reader(s)            NoteSurface in 3 of 4 views
    └── [~] hint row
pane operations
    ├── [~] focus (Tab, number, click)    every view, 3 implementations
    ├── [~] zoom                          desk only (PIE-428); pane.zoom
    ├── [~] open beside / split           desk ^W o, board alt+⏎, river ⏎/s; pane.split
    ├── [~] close                         desk ^W x, board x, river x; pane.close (desk, board)
    ├── [~] resize                        desk drag/^W<>, board drag/{}<>: one tree; pane.resize
    ├── [~] dock / move                   desk ^W HJKL, board float HJKL; pane.float, pane.pin
    ├── [~] squeeze (width tiers)         river full/peek/spine; board lanes, readers c · one spine part
    └── [~] persist layout                the tree to desk.json, delivery.json (same fields); river.json
entity navigation
    ├── [~] children                      thread pane, river replies, BBS T
    ├── [x] up                            note surface u
    ├── [x] outlinks (in-note links)      note surface [ ] ⏎ click
    ├── [~] backlinks                     board drawer only (Detail's view, PIE-442)
    ├── [ ] resources list                none (PIE-432)
    ├── [~] search / jump                 4 versions
    └── [ ] history (back/forward)        none
extensions
    ├── [x] properties (summary, panel)   note surface
    ├── [x] edit, comments, completion    note surface + ed
    ├── [x] folds                         note surface (not river cards)
    ├── [~] presence, activity, stats     BBS screens + desk panes (PIE-430)
    └── [~] view actions                  board cards, river columns
```

Refinements to the proposed tree:

- **"Entered" belongs in pane operations.** Focus picks the pane; *entered* says whether keys go
  into the reader's edit/comment/panel. It's shared (`Entered` `pan:287`) and it's how agents
  never steal keys.
- **The hint row is part of the view.** Every view has one; only the edit control's is shared
  (`editHint` `ed:48`).
- **Squeeze is a pane operation,** not a river feature. The board already has a manual version.
- **History is missing** from the proposed tree and from the code; the outliner's Detail has it.

---

## 3. Audit matrix

Codes: **S** = shared code. **R** `file:line` = re-implemented differently. **—** = missing.
Then `kma` = keys, mouse, agent action; `·` marks one that is absent.
BBS = News, Conference and the BBS `Reader` together.

### Shell

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| enter from menu | S `K` k·· | S `N J R` k·· | S `D` k·· | S `Q` k·· |
| back | R `del:1591` k·· | R `scr:28` k·· | R `dsk:300` k·· | R `riv:887` k·· |
| status bar, flash | S | S | S | S |
| hint row | R `del:1450` | R `scr:242` | R `dsk:210` | R `riv:397` |
| peek state | S `del:479` | — (text only) | S `dsk:163` | S `riv:615` |
| `open <id>` | S `del:330` ··a | — `app:163` | S `dsk:100` ··a | S `riv:613` ··a |
| `act` | S `del:336` | — `app:183` | S `dsk:106` | S `riv:662` |

### View

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| content | lanes `del:1225` kma | list `scr:203` k·· | tiles `dsk:173` km· | strip `riv:270` kma |
| reader | S `ReaderPane` | R `scr:256` k·· | S `ReaderPane` | S surface (edit only) |
| header | S `note:268` | R `scr:273` | S | R cards `riv:362` |
| body render | S `renderDoc` | R `colourBody` `scr:282` | S | R `colourBody` `riv:363` |

### Pane operations

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| focus | R Tab `del:1540` kma | — | R Tab/1-9 `dsk:286` kma | R h l `riv:867` kma |
| entered | S `Entered` | — | S `Entered` | R `isEntered` |
| zoom | — (PIE-428) | — | S tree, `^W z`, `pane.zoom` k·a | — |
| open beside | S tree, alt+⏎ detail kma | — | S tree, `^W o` add, `pane.split` k·a | R ⏎ column kma |
| split | — (a detail opens with a note) | — | S tree, `^W o`, `pane.split` k·a | R `s` `riv:496` k·a |
| close | S tree, `x`, `pane.close` k·a | — | S tree, `^W x`, `pane.close` k·a | R `x` k·a |
| resize | S tree, drag, `{ } < >`, `pane.resize` kma | — | S tree, drag, `^W <>`, `pane.resize` kma | — (automatic) |
| dock / move | R float HJKL, drag km· | — | R `^W HJKL` k·· | R `p` pin k·a |
| float | S tree floats, `o`, `pane.float` kma | — | — | — |
| drawer | S tree, `t b`, pin `T B` or `[ ] pin`, `pane.pin` kma | — | — | — |
| squeeze | S spine: lane `c` km·, reader `c` kma, `alt+c` | — | — | S spine, `riv:243` auto, `p` |
| persist | S tree → `delivery.json` (its old fields) | — | S tree → `desk.json` | R `river.json` |

### Entity navigation

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| children | — (`N` writes one) | R `T` `scr:250` k·· | R `pan:299` km· | R `space` kma |
| up | S `u` k·a | R `U` `scr:297` k·· | S `u` k·a | S `u` k·a |
| outlinks | S `[ ]` ⏎ click kma | — | S kma | S kma |
| backlinks | S drawer, Detail's view (`src/backlinks.ts`) kma | — | — | — |
| resources | S images, `[file::` | — | S | — |
| search | R `g` boards only | R `scr:338` dead | R `/` `dsk:371` k·· | R `/` `riv:66` k·· |
| history | — | — | — | — |

### Extensions

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| properties | S `i I` kma | R `Stat:` line only | S kma | S `i` k·a |
| edit | S `e` kma | — | S kma | S kma |
| comments | S `C m` kma | — | S kma | S kma |
| completion | S (not in composer) | — | S | S |
| folds | S kma | — | S kma | — (cards) |
| presence | — | R `scr:355` k·· | R `pan:411` k·· | — |
| activity | — | R `scr:392` k·· | R `pan:375` km· | — |
| stats | — | R `scr:535` k·· | — | — |
| view actions | R cards `del:1799` kma | — | — | R `riv:976` kma |

---

## 4. Findings

### F1. Two readers, two body renderers

- `NoteSurface` renders with `renderDoc` (`note:320`). The desk search preview (`dsk:404`) and river
  cards (`riv:362`) use `wrap` + `colourBody`. The BBS `Reader`'s body is drawn by `renderDoc` since
  PIE-444 (links, Markdown and components as every reader draws them), but its links are text there.
- The BBS reader has its own header (`scr:273`) and its own `N P T U` keys, and it can't edit,
  comment, fold, open props or be driven by an agent.
- **Resolves:** PIE-426 (BBS on the note surface). River cards stay a list, but PIE-431 decides
  whether a full river column reads through the surface too (it already edits through it).

### F2. Pane operations are re-implemented per view

- Desk: layout tree (`lay:5`), zoom, `^W` prefix. Board: fractions (`del:37`), floats, drawers,
  `x` and `o` without a prefix. River: strip, automatic squeeze, `x`, `p`, `s`.
- Zoom exists only on the desk, and there it swaps the rectangle map (`dsk:177`), not a tree op.
- **Resolves:** PIE-412 (one layout tree), then PIE-428 (zoom everywhere) on top of it, PIE-413
  (tabs, drag-and-drop).
- **PIE-412 slice 1 (done):** the board is on the desk's tree. Its lanes pane (columns are drawn inside
  it), preview and details (the `readers` row), backlinks drawer (under the readers) and outline drawer
  (beside everything) are leaves, the drawers sliding over (`over`) until pinned, floats above. The keys,
  hints and `delivery.json` fields are unchanged. Slice 2 moves the river's strip onto it; slice 3 stores
  the tree in the outline as screen notes.

### F3. Agents can read and edit, but not arrange

- Every reader shares `NOTE_ACTIONS` (`note:1329`). Good.
- Desk agent actions: `open`, `focus`, and since PIE-412 the shared `pane.*` actions (split, close,
  resize, zoom). No dock or swap yet.
- Board: `pane.*` since PIE-412 (close, resize, float, pin; split and zoom refuse with the reason). No lane
  collapse action. Readers collapse and expand by action since PIE-440 (`reader.collapse`,
  `reader.expand`). River: no filter, `#` or jump actions (`riv:976`).
- BBS screens have no `act`, `openBlock` or `describe` (`app:163`, `app:183`).
- **Resolves:** PIE-434 should make "every pane operation is an action" part of core. PIE-426
  brings BBS readers in.

### F4. The same key means different things

| Key | Board | Desk | River | BBS |
|---|---|---|---|---|
| `c` | collapse a lane or a reader | — (says `C` comments) | — (says so) | — |
| `C` | comment (was: reopen all lanes; now `alt+c`) | comment | comment | — |
| `s` | steps | `^W s` swap | split | — |
| `m` | move card / threads in a reader | threads | threads | — |
| `x` | close detail or float | `^W x` close | close pane | — |
| `o` | pop out float | `^W o` add pane | — | — |
| `t` | outline drawer | `^W o t` add outline | — | `T` thread |
| `p` | — | hold reader | dock column | `P` previous |
| `f` | fold | fold | filter | — |
| `alt+⏎` | second detail | — | duplicate column | — |
| `q` | — | menu | "quote isn't here" | back |

- Pane operations should get one key layer (the desk's `^W` is the most complete). Reader keys
  are already consistent because they come from the surface.
- The backlinks drawer (PIE-442) takes Detail's backlinks keys where they're free with the drawer
  focused: `/` filter (the desk's and river's `/` also search), `s` sort (the lanes' `s` is steps),
  `h` resolved (the lanes' and river's `h` is left; the drawer has no left), `n` this note (the lanes'
  `n` is a new card), `.` or space a group. Two clash and are moved: Detail's `k` kind is up in every
  door list, so kind is `K` (a float's `K` nudges it up, only with the float focused); Detail's `t`
  stage is the board's outline drawer from any focus, so stage is `w` (the steps overlay's `w`
  "waiting" can't be open at the same time). A filter being typed holds every key, `t b g` included.
- `c` collapses wherever something collapses, and `C` comments in every reader (PIE-440).

### F5. Entity navigation is scattered

- Backlinks: board drawer only. Children: three shapes (thread pane, river replies, BBS `T`). Since
  PIE-442 the drawer groups, filters and sorts as Detail does through `src/backlinks.ts`; the PIE-432
  connections screen should list backlinks through it too, not a new list.
- Outlinks are in-note only (`[ ]`); no list of them. No resources list. No history anywhere.
- **Resolves:** PIE-432 (connections screen: children, outlinks, backlinks, resources) as one
  shared entity-nav component; PIE-413 puts backlinks under details.

### F6. Four searches

| Where | Code | Backend |
|---|---|---|
| BBS `Search` screen | `scr:338` | `board.search`; **not reachable** from any menu |
| Desk `/` overlay | `dsk:371` | `board.search`, debounced, with preview |
| River `/` jump | `riv:66`, `riv:883` | local `tree.index` |
| Board `g` | `del` picker | board (hub) discovery, not text |

- One jump palette, as a shell overlay, would serve every view. PIE-427's outline switcher can
  reuse its picker.

### F7. Presence and stats are duplicated and BBS-flavoured

- Who's Online: `WhoOnline` (`scr:355`) and `WhoPane` (`pan:411`), both from `clients.list`.
- Activity: `LastCallers` (`scr:392`, 80 rows) and `ActivityPane` (`pan:375`, 60 rows).
- Stats: one screen (`scr:535`), a heatmap of `updatedAt`, not a pane.
- **Resolves:** PIE-430 (active people and agents, one component used as screen or pane).

### F8. The shell is one workspace for the whole run

- `ctx.board` is fixed at startup (`src/main.ts:38`). Live figures (`src/live.ts:26`) and
  reference caches (`src/refs.ts:25`) are module-level, not per workspace.
- **Resolves:** PIE-427 needs those caches keyed by connection before a switcher is safe.

### F9. The "one edit control" is split in two

- `ed` owns the frame, status line, hint and `$EDITOR` handoff.
- Completion is wired only inside `NoteSurface` (`note:592`) and `CommentSession`
  (`src/comment.ts:243`). The board's composer uses `renderEditor` (`del:1335`) but gets no
  completion.
- **Resolves:** PIE-434 (see §5: the editing component should own completion).

### F10. Stale words in the code

- Help says "Read-only. Nothing you do here writes to the outline." (`scr:568`). It writes now.
- `note:2` says the surface is hosted "(next) a river column". The river hosts it already.
- Not fixed here: this PR changes no behaviour or strings.

### Backlog map

| Item | What it resolves here |
|---|---|
| PIE-412 | F2: one layout tree for board, desk, river (slice 1: the board and `pane.*`; slice 2: the river; slice 3: screens in the outline) |
| PIE-413 | F2, F5: tabs, drag-and-drop, backlinks under details, two previews |
| PIE-414 | bundles of readers: needs readers addressed the same way on every view |
| PIE-417 | terminal panes: a new pane kind, not a `suspend` (`app:125`) |
| PIE-418 | daemon: shell state (layout, drafts, presence) outlives a terminal |
| PIE-426 | F1, F3: BBS reader on the note surface, with actions |
| PIE-427 | F6, F8: switcher in the status bar; per-connection caches |
| PIE-428 | F2: zoom as a pane operation everywhere |
| PIE-429 | scratch note: a reader pinned to the shell, not a view |
| PIE-430 | F7: one presence/activity component |
| PIE-431 | F2, F4: river squeeze and columns as the shared pane model |
| PIE-432 | F5: shared entity navigation |
| PIE-434 | F3, F9: core vs extensions, editing component |

---

## 5. Core versus extensions (PIE-434)

### Proposed split

| Layer | Core (the door owns it) | Extension (a view or plugin adds it) |
|---|---|---|
| shell | stack, status bar, flash + log, theme, unsaved guard, control socket | menu entries |
| panes | layout tree, focus, entered, zoom, open beside, close, resize, squeeze | pane kinds |
| reader | note surface, header, summary, links, folds, embeds | summary keys per view |
| editing | edit control with completion, draft safety, provenance | completion sources |
| entity nav | up, children, outlinks, backlinks, resources, history, jump | extra projections |
| agents | action registry, arg checking, provenance, `peek` | each extension's actions |
| views | none | board, desk, river, BBS, stats, presence |

Rules that follow from the audit:

- **A view never draws its own pane chrome.** Frames, thumbs, "(e enters)" and zoom come from
  core. Today each view draws them (`dsk:191`, `del:1218`, `riv:270`).
- **Every key a view binds is an action first.** The key is only a binding in the action list.
- **Pane operations use one key layer** across views.
- **Extensions register actions into `ActionSet`s.** They don't intercept keys before the
  shell does.

### The reusable editing component

Boundary for a TUI editing component that other TUIs can use:

| Inside | Outside (the host gives it) |
|---|---|
| `Draft`: text, cursor, base revision, dirty, writers | where it is drawn (a `Rect`) |
| edit control: frame, status, hint, keys, `$EDITOR` | the save call and its refusal |
| completion popup and its keys | completion lookups (`CompletionBoard`) |
| "changed elsewhere" state, keep-draft-to-disk | outline events that mark it |
| provenance: who typed, what the save records | the actor |
| actions: `edit.*`, `complete` | the action registry it registers into |

- Today the frame is in `ed`, the text model in `src/edit.ts`, and completion in `note` and
  `src/comment.ts`. Moving completion into the component closes F9 and gives the board's
  composer completion for free.
- Grapheme width stays a known limit (README: one cell per character).

---

## 6. Ideas from other TUIs (recon, Sep 28)

From a look at shiki, strata and mirador (all MIT). Where each fits:

- **Width tiers** (shiki): side by side, stacked when narrow, focused only when tiny. Hidden
  panes get zero size, so navigation is the same at every width.
  - Place: pane operations (core). Today: the river has tiers (`riv:243`); lift them into the
    layout tree (PIE-412).
- **Dim unfocused panes** (mirador).
  - Place: shell theme (core). Today: only the border colour changes (`dsk:191`).
- **Miller columns** (strata): position is depth, preview far right, hidden by width;
  `Alt+←/→` history, `Ctrl+L` jump box.
  - Place: a river view (PIE-431) plus entity navigation. Today: no history anywhere (F5).
- **Dashboard** as weighted rows of panels.
  - Place: a view built on the layout tree (PIE-412). Stats and presence become panels (PIE-430).
- **Theme palette**: ~20 named slots, "reset" inherits the terminal, selection derived from the
  terminal's colours (OSC 10/11).
  - Place: shell (core). Today: 16 VGA colour indices, hard-coded (`src/style.ts:10`).
- **Messages log** keeping every flash, and a **`doctor`** command.
  - Place: shell (core) and the control socket. Today: one 4-second flash (`app:116`); `peek`
    already reports `service.uses` (`app:155`), half of a doctor.
