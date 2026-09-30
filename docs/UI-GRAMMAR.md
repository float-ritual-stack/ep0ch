# UI grammar and glossary

One vocabulary for the door's screens, checked against the code on `feature/door-writes`
(PIE-433). Use it to name things in code, READMEs and roadmap items, and to judge whether a
new screen reuses the grammar or invents its own.

## Before adding a feature

Check here for the part that already does it. Skipping this step is how the door got two readers,
three pane models and four searches (§4).

| The feature needs to… | Use | Where |
|---|---|---|
| render or read a note | `NoteSurface`, hosted through `SurfaceHost` (a view with its own header gives its rows through `SurfaceHost.header`, as the BBS message reader does, PIE-426); the body drawn by `renderDoc` after `presentLinks`; literal regions (PIE-422) found by `src/literal.ts`, inline Markdown (PIE-444: bold, italic, strikethrough) by `src/inline.ts` (checked against marked, Detail's parser) and `component:` fences by the reader host's renderers in `src/components.ts` (checked against the service's `documentComponent`), each the outliner's rules mirrored and parity-tested; Markdown links open through `src/open.ts`; transclusions (`!((id))`, `!((id^fragment))`) by `src/embeds.ts` from the service's projection (`transclusions.read`, PIE-424: fragment slices, nesting depth, cycles and their wording are the service's), each embedded body drawn by the surface's own renderer; a followed `((id^fragment))` revealed from `fragments.read` (PIE-425) | `src/surface/note.ts`, `src/doc.ts`, `src/refs.ts`, `src/literal.ts`, `src/inline.ts`, `src/components.ts`, `src/open.ts`, `src/embeds.ts` |
| let a person or agent do anything; let an agent see what the person sees | the action registry: an `ActionDef` in an `ActionSet`; the key, the mouse and `act` all call it (a change that isn't an action is a bug). The shell's `SHELL_ACTIONS` (`screen.open`, `screen.back`, `screen.list`, and `screen.shell`, drop to shell: the person's only, through `App.suspend` as ctrl+e's `$EDITOR`, `src/drop.ts`) work on every screen and the BBS lists' `LIST_ACTIONS` (`list.select`, `list.open`, `list.read`) on each list (PIE-489); an agent's move of the person's screen goes through `agentMayMove`. Reads: `layout.get`, `view.get`; the live feed: `subscribe` on the control socket, diffed from the screen's `viewState()` after each paint (`App.subscribe`). See [the agent interface](AGENT-INTERFACE.md) | `src/surface/actions.ts`, `NOTE_ACTIONS` in `src/surface/note.ts`, `src/control.ts`, `src/app.ts`, `docs/AGENT-INTERFACE.md` |
| edit text, complete `[[` `((` `[file::` | the editing component: `Draft`, edit control, completer. The draft's list keys, the mouse and the preview are `DRAFT_ACTIONS` (PIE-496: `draft.newline` `draft.indent` `draft.outdent` `draft.place` `draft.scroll` `draft.preview`, forwarded as note actions); its soft wrap hangs a list item's rows under its text (`Draft.layout`); `renderEditor` records where it drew (`Draft.frame`) and `editorClick` maps a click to an action; the preview is the readers' renderer (`draftPreview`). Unsaved text is **put aside** where it was written (`shelve`, `unsent`, keyed `edit:<id>` `comment:<id>` `reply:<thread>` `card:<lane>` `child:<id>`) and brought back by `Draft.restore`, with who wrote it (a save names them); a draft only agents wrote is only copied, never put aside over the person's. A paste typed out as keys (`pasteKeys`, tagged `pasted`) goes in as it came. An agent's `draft.*` works only in a draft it opened (`Draft.openedBy`) and alone wrote in | `src/edit.ts`, `src/surface/editor.ts`, `src/surface/completer.ts`, `src/completion.ts` |
| open, split, zoom, close panes; tabs, drag and drop, drawers, named layouts | the pane model: the layout tree (PIE-412), n-ary splits by weight with spines (`fixed`), minimums, **tab sets** (PIE-413), drawers that slide over or pin (`over`, any tile on the desk), floats, borders that follow the pointer; tile moves (`move`, `tabInto`, `edge`, `normalise`, floatty's model ported) and the drop zones in cells (`dropAt`: header or centre tabs, triangles split, outer edges columns); the desk and the board are on it. The desk is **tiles**: each a view (`TILE_KINDS`, built by `makeTile`), named (`tileNameProblem`: never a number or an id), with a link for its opens (PIE-473); every split, tab set and tile has a stable id and the layout a revision (PIE-491: `s` `g` `t`, `rev`, `expected=`), so agents name them by id, not place; the arrangement is a **layout** saved by name (`src/desk/tiles.ts`, PIE-474), where an open with no link lands on the current note. Every operation is an action: `pane.*` (split, close, resize, zoom, float, pin) and `layout.*` `tile.*` `tab.select` (TILE_ACTIONS); keys and drags only call them. A view built on the desk is a `DeskPreset` (the brief, Waiting, the welcome): its panes with their tile names, links and first focus, the glyphs its frames are drawn with (`DOTTED_BOX`), whether the digits are the desk's (`digits: false`: the view's own, the tiles unnumbered), and rows above the tiles for its own art (`bandRows`, `drawBand`) and its own hint (`screenHint`) | `src/desk/layout.ts`, `src/desk/drop.ts`, `src/desk/tiles.ts`, `src/desk/tile-actions.ts`, `src/desk/pane-actions.ts`, `src/desk/panes.ts`, `src/desk/desk.ts` |
| run a program beside the notes (nvim, claude, a shell) | the terminal tile (PIE-417): a pty from `Bun.Terminal`, the screen through `@xterm/headless`, drawn in cells; keys go to it while the person is in it, `ctrl+]` leaves; the mouse goes to it when it asked. `ctrl+e` edits a draft in one (`Ctx.editInTile`). The program is told its door (`EP0CH_CONTROL`, the door's own control socket) and its tile (`EP0CH_TILE`, `EP0CH_TILE_ID`); its environment is `tileEnv` (one list of what a tile's program doesn't get; `HERDR_VARS` is the one Herdr list for tests and scripts). Where a program runs, the layers outside it, is `EP0CH_NEST` (`src/nest.ts`: each layer appends itself), checked by `ep0ch where` (`src/where.ts`, over `peek` and read-only `herdr pane list`). An agent that should outlive the door runs in a Herdr pane the tile attaches to (`scripts/door-agent-herdr.ts`: Herdr's attach in the tile, no second terminal; it says so with `tile.herdr`) | `src/desk/pty.ts`, `src/surface/editor.ts`, `src/desk/herdr-agent.ts`, `src/nest.ts`, `src/where.ts` |
| follow a tile's selection or a file in a reader | the preview tile (PIE-473): a `ReaderPane` (the note surface, no second renderer) with a source, `tile:<name>` or `file:<path>` (re-read on save, read-only) | `src/desk/preview.ts` |
| put a whole screen in a tile (the board, the river, the brief) | `ScreenTile` over the showcase's `FramedScreen`: the screen itself in a rectangle, its selection the tile's | `src/desk/screen-tile.ts`, `src/showcase/frame.ts` |
| squeeze a pane to a title strip | the spine part: `drawSpine`, `SPINE` (rotated title under Kitty, stacked letters in cells, marks) | `src/spine.ts`; river columns, board lanes and readers |
| show children, outlinks, backlinks, resources, or go back and forward | entity navigation (PIE-432); today `u` and link selection in the surface, `references.backlinks`; history (PIE-453): each reader's back and forward in the surface (`track` records a follow, `u` or an open into it; `travel` restores the note, scroll and `[ ]` position; `back`/`forward` actions; alt+← alt+→, backspace, the mouse's side buttons, the `← back` row), or the view's own through `SurfaceHost.history` where a follow opens elsewhere; backlinks presented as Detail presents them (PIE-442): `backlinkView` and the panel's text in `src/backlinks.ts`, Detail's `backlink-view.ts` over the service's facets, mirrored and parity-tested (`backlinkRows`, `backlinkStatusParts`, `describeBacklinkView` for agents), drawn by `backlinkRowLine` and `layoutBacklinkStatus` (the board's drawer and the backlinks tile, one drawing); the **backlinks tile** (`BacklinksPane`, kind `backlinks`, `^W o l`): the backlinks of what another tile shows (`source: tile:<name>`, through `DeskApi.tileShowing`), its selection shown where the tile's selection goes (`DeskApi.showFrom`: the previews following it and its link, never the current note, so the reader it lists stays put) as it moves and when the tile is given the keys (`Pane.focused`), `backlinks.pick` and `backlinks.view` (BACKLINKS_ACTIONS) | `src/surface/note.ts`, `src/socket.ts`, `src/backlinks.ts`, `src/desk/backlinks-pane.ts` |
| show who's here or recent activity | presence (PIE-430); today `WhoPane` and `ActivityPane` over `clients.list`, `activity.recent` | `src/desk/panes.ts` |
| put live data in a note | live figures, which read views with `views.read` | `src/live.ts`, `src/views.ts` |
| show a Resource's stored details in a note (a ticket under `jira::`, a ticket page) | resource projections (PIE-445): `projectionsOf` asks the service (`resources.projection.read`, capability `resources.projection`; nothing extra without it), `projectionLayout` is Detail's `resourceProjectionLayout` as drawn (parity-tested), the surface draws each region after its line through `DocEnv.after`, and `resource-catalog` events repaint the ones shown. The door never registers, refreshes or contacts a provider | `src/projection.ts`, `src/surface/note.ts`, `src/doc.ts` |
| move through what a reader draws, or point someone at a block | elements and the reading ruler (PIE-441): `[ ]` over the surface's element list (links, folds, figure rows, embeds, resource projections, comment marks, an expanded thread's controls, checklist steps in the note and inside embeds), ⏎/alt+⏎/click through `enterElement`, `RULER_BG`; a comment mark expands its thread under the passage (PIE-420: `expanded`, the person's reading state like `folded`; drawn as body rows; its Select, Reply, Resolve controls act through `CommentSession`, the thread list's code); an agent's focus mark (`focus.set`) is the same tint. Hosts decide where a link opens from `SurfaceHost.navigate`'s `OpenHow`. A checklist step is an element too (PIE-472): its box is tagged (`task` in `DocEnv`) where the service's `checklist.query`, or an embed's projection, says a step is; ⏎ or a click opens its status choice (Detail's choices, `STEP_CHOICES`), drawn as body rows under it like an expanded thread; every change is `NoteSurface.changeStep` through `checklist.update` with the actor's provenance, Undo is `StepHistory`, and agents use `tasks`, `task.status`, `task.undo`, `task.link` (the board's steps overlay, `s`, is a card-level list over the same service calls). A tile-level attention mark is `block.mark` (a `MarkStore`, door-local until PIE-423's service store): framed and labelled in every tile showing the block, an extmark in an nvim tile | `src/surface/note.ts`, `src/surface/selection.ts`, `src/steps.ts`, `src/desk/marks.ts` |
| select or copy text a reader draws | the selection model (PIE-419): `Selection` over drawn rows, `Gesture` (press, drag, release, double/triple click), `modeKey` (`v`), `paintRange`, `osc52`; the surface hosts it (`press`/`drag`/`release`, `y` `Y`, `select*` actions), and so does the river over its own rows | `src/surface/selection.ts`, `src/surface/note.ts` |
| know anything the service can answer | ask the service: `views.read`, `blocks.read`, `properties.preview`, `changes.since`, `references.*`, `views.planWrite` (what a move into a lane patches, what a new card there is born with), `query.matches` (which results a query holds for), gated by `Capability`. Where a call per paint is too slow (finding `[key::value]` tokens in titles, digests, metadata lines, colour), the outliner's own property grammar, copied byte for byte and checked (`test/grammar.test.ts`; `ping` reports its version): `withoutPropertyTokens`, `isPropertyTokenLine`, `propertyTokenPattern`, `PROPERTY_KEY_SOURCE`, never a local regex | `src/socket.ts`, `src/move.ts`, `src/vendor/property-grammar.ts` |

- **Don't copy the parallel versions:** the `colourBody` bodies left in the desk's search preview and
  the river's cards (F1), the river's pane code (F2), the extra searches (F6), `WhoOnline` and
  `LastCallers` (F7).
- **Don't re-derive meaning the service owns** (view membership, property parsing, query evaluation,
  what a write into a view must change, backlinks, what changed). Against an older service, say which
  capability is missing instead of computing it here. Where a call per paint is too slow, use one module
  the outliner owns (`src/vendor/property-grammar.ts`), never a copy of its rule.
- **If the part doesn't exist yet or doesn't fit:** extend it, or write down why not in the PR.
  A new shared part gets a row here in the same PR.
- **Every row has a showcase section** (`scripts/try-it.sh --showcase`, PIE-439), in this table's
  order: `SECTIONS` in `src/showcase/showcase.ts`, drawn by the part itself. A new row gets its section
  and the seed content it needs (`src/showcase/seed.ts`) in the same PR, and a parallel version shown
  beside it until consolidation removes it.
- Name things with the glossary's canonical words (§1).

## TL;DR

- **One reader.** Board, desk, river and the BBS message reader (`MessageReader` `scr:273`, PIE-426)
  host `NoteSurface`; the BBS one keeps its header through `SurfaceHost.header`. `colourBody` still draws
  the desk's search preview and the river's cards (lists, not readers).
- **Pane operations exist twice.** The desk and the board share one layout tree (PIE-412): the
  board's lanes, readers, drawers and floats are panes in it. The river still has its strip of columns.
  Keys differ between them (`x`, `o`, `s`, `p`), and zoom exists only on the desk.
- **Agents can arrange the desk and the board.** Note actions are shared everywhere, and the `pane.*`
  actions (split, close, resize, zoom, float, pin) are shared by the desk and the board. The river has
  its own column actions. The BBS message reader has the note actions and its own `message.*`; the
  menu and every screen have the shell's `screen.*`, and the BBS lists `list.*` (PIE-489).
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
| layout tree | Splits over pane ids, each kid by weight, and tab sets; drawers slide over it, floats above it | `LNode` `lay` (desk and board; the river as a layout with its open rule) | none |
| tile | A pane on the desk: a view (outline, reader, detail, preview, terminal, board, river, brief, …) with a name, dragged by its header | `Pane` in the desk's tree, `makeTile` `src/desk/tiles.ts` | Herdr pane |
| tab set | Tiles stacked in one place, one shown; the header shows the tabs | `Tabs` `lay` | none |
| header | A tile's top border: its number and name (or its tabs), what it shows, `→ link`, `⇤ drawer`; drag it to move the tile | `header` `dsk` | pane title |
| drop | Where a dragged tile lands: tabs (a header or a centre), a split (a triangle), an outer edge; outlined while dragging (the ghost) | `dropAt` `src/desk/drop.ts` | none |
| link (a tile's) | The tile a tile's opens land in (PIE-473): a followed link, the outline's `⏎`; set by `alt+l` then a click | `links` `dsk`, `tile.link` | linked pane (Herdr alt-l) |
| layout (named) | The tile tree with each tile's spec, links, drawers and open rule, saved by name | `LayoutSpec` `src/desk/tiles.ts` | none |
| open rule | Where an open with no link lands: the current note (`current`), or the next column (`river`) | `rule` `dsk` | none |
| terminal tile | A program in a pty the door owns; the person is *in* it (like entered) until `ctrl+]` | `PtyPane` `src/desk/pty.ts` | Herdr pane |
| focus | Which pane gets the keys | `focus` in each screen | pane focus |
| entered | You are *inside* a reader's edit, comment or panel | `Entered` `pan:287` | draft focus |
| zoom | One pane fills the view | `dsk:326` (desk only) | Herdr zoom |
| float | A reader popped out over the board | `floatOrDock` `del`, `ScreenLayout.floats` `lay` | none |
| drawer | Slide-over pane: the board's outline or backlinks, or any desk tile unpinned (`^W p`); in the tree, sliding over unless pinned; a shut one is a handle at the end of the hint row | `drawer` `del`, `ScreenLayout.over` `lay`, `over`/`shut` `dsk` | none |
| spine | A pane squeezed to a title strip | `drawSpine` (`src/spine.ts`); river `Cover` `riv:48`, board lanes and readers `c` | none |
| lane | A saved view shown as a board column | `Lane` `del:30` | virtual branch |
| card | One block in a lane | lane items | branch root row |

### Reading and editing (the note surface)

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| reader | Any pane or screen hosting a note surface | `ReaderPane` `pan:184`, `MessageReader` `scr:273` | Detail |
| note surface | Draws, folds, edits, comments on a note | `NoteSurface` `note:107` | Detail body |
| surface host | What a view gives it: ctx, redraw, navigate, and maybe its own header rows | `SurfaceHost` `note:43` | none |
| preview | The reader that follows the selection; on the desk, a preview tile follows a source (a tile, a file) | board `preview`, `PreviewPane` | **Preview** |
| detail | A reader opened on purpose (`⏎`), keeps its note | `openDetail` `del:521` | **Current** |
| header | Title, crumbs, summary line, notices | `render` `note:268` | menu row + title |
| summary line | Chosen properties under the title | `summary` `note:366` | summary keys |
| property panel | Every property token, editable | `PropertyPanel` `pp:85` | property inspector |
| edit control | Frame + status + keys for any draft | `renderEditor` `ed:25` | Detail edit mode |
| draft | Unsaved text with its base revision | `Draft` (`src/edit.ts`) | draft |
| unsent (put aside) | A draft closed with its text (esc twice, a screen closed, the door quitting): kept where it was written, copied to `drafts/`, brought back by opening the same draft | `shelve`, `unsent`, `Draft.restore` (`src/edit.ts`) | none |
| composer | Board draft for a new card or note | `del:843` | Quick Capture (close) |
| comment session | Passage picker, comment, threads | `CommentSession` | passage comments |
| completion | `[[`, `((`, `[file::` popup | `cmp`; wired at `note:592` | completion |
| fold | Folded heading or list item (reader state) | `note:835` | Folding |
| selection | Text selected in a reader (reading state; only `y`, `Y` or the copy control copy it) | `Selection` `sel:52` | text selection |
| element | What `[ ]` stops on in a reader: a link, a fold, a figure row, an embed, a resource projection, a comment mark, a checklist step; one is current | `elements` `note` | none |
| reading ruler | The tint under the block the current element is in | `RULER_BG` `sel` | none |
| tint | A block (maybe a passage) tinted in the ruler's colour inside one reader, with who set it named; PIE-423's "focus mark". `block.tint` (`focus.set` is its older name) | `block.tint` `note` | focus mark (PIE-423) |
| attention mark | A mark on a block (or an nvim line) with a reason and who set it, framed and labelled in every tile showing it, until dismissed | `block.mark` `src/desk/marks.ts` | focus mark (PIE-423's shared part) |
| embed | `!((id))` transclusion region; `!((id^fragment))` shows the fragment's slice; nested to the service's depth | `src/embeds.ts` | generated embed |
| step | A checklist item (`- [ ]`, `[x]`, `[~]`, `[!]`) whose box is a control, in the note or an embed | `task` elements, `src/steps.ts` | checklist control (PIE-367) |
| status choice | The menu a step's box opens: done, to do, waiting, problem, Copy step link, Make addressable | `picker` `note`, `STEP_CHOICES` | status picker |
| resource projection | A Resource's stored details (a ticket: key, summary, allowed fields, status, fetched time and its age) drawn read-only under the `jira::` line that names it, or at the top of a ticket page; ⏎ or a click opens the ticket's page, `y` copies it as drawn | `projectionsOf`, `projectionRegion` (`src/projection.ts`) | resource projection (a Detail region) |

### Entity navigation

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| children | Blocks under a note | `ThreadPane` `pan:299`, river `space`, BBS `T` (`message.thread`) | Tree children |
| up | The parent | `u` `note:766` (the BBS `U` too) | ancestors menu |
| outlinks | Links in the note (`[ ]` steps to them with the note's other elements, `⏎` follows) | `link.select`, `elements` `note` | **Outlinks** |
| backlinks | Notes that link here, grouped by kind with Detail's defaults (PIE-442) | board drawer `drawLinks`, `src/backlinks.ts` | **Backlinks** |
| resources | `[file::]`, `img::`, media | completion, `src/media.ts` | **Resources** |
| search | Find a block by text | 4 versions, see §4 | Goto search |
| history | Back/forward through what a reader showed: its note, scroll and `[ ]` position (PIE-453) | `track`, `travel`, `back` `forward` `note`; `SurfaceHost.history` | Detail history |

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
| Reader | BBS screen `Reader` (now `MessageReader` `scr:273`, a surface host: resolved by PIE-426) | `ReaderPane` `pan:184` | "reader" = any surface host |
| pin | Desk reader stops following `pan:234` | River column resists squeeze `riv:879` | **pin** = a drawer joins the layout (`T`, `B`, or its `[ ] pin`); the desk reader **holds** (`p hold`); a river column **docks** |
| preview | Board reader following the card | Desk `/` search's right half `dsk:404` | A only |
| detail | Door: a reader you opened (*Current*) | Outliner: the Detail pane | owner decides |
| region | Board pane `del:31` | Outliner PreviewRegion (focusable item) | "pane" |
| spine | River compression tier | Board collapsed lane or reader | fine: same idea, one part (`src/spine.ts`) |
| `alt+⏎` | Board: second detail | Outliner: keep Preview as Current | a link's `alt+⏎` (or a ctrl- or alt-click) opens beside, never in a tile's link (PIE-473) |
| focus | The person's keys: which tile has them (`tile.focus`, `focus`) | PIE-423's "focus mark" (`focus.set`) | **focus** is only the keys; an in-reader highlight is a **tint** (`block.tint`); a mark with a reason is an **attention mark** (`block.mark`) |

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
    ├── [x] header                        note surface; BBS rows via SurfaceHost.header
    ├── [~] primary content               lanes | layout tree | strip | list
    ├── [x] detail = reader(s)            NoteSurface in every view
    └── [~] hint row
pane operations
    ├── [~] focus (Tab, number, click)    every view, 3 implementations
    ├── [~] zoom                          desk only (PIE-428); pane.zoom
    ├── [~] open beside / split           desk ^W o, board alt+⏎, river ⏎/s; pane.split
    ├── [~] close                         desk ^W x, board x, river x; pane.close (desk, board)
    ├── [~] resize                        desk drag/^W<>, board drag/{}<>: one tree; pane.resize
    ├── [~] dock / move                   desk ^W HJKL, board float HJKL; pane.float, pane.pin
    ├── [~] squeeze (width tiers)         river full/peek/spine around the wide column (w widens); board lanes, readers c · one spine part
    └── [~] persist layout                the tree to desk.json, delivery.json (same fields); river.json
entity navigation
    ├── [~] children                      thread pane, river replies, BBS T
    ├── [x] up                            note surface u
    ├── [x] outlinks (in-note links)      note surface [ ] ⏎ click
    ├── [~] backlinks                     board drawer only (Detail's view, PIE-442)
    ├── [ ] resources list                none (PIE-432)
    ├── [~] search / jump                 4 versions
    └── [~] history (back/forward)        note surface (board, desk); river (between columns, SurfaceHost.history); BBS next (PIE-453)
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
BBS = News, Conference and the BBS message reader (`MessageReader`) together.

### Shell

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| enter from menu | S `K` k·· | S `N J R` k·· | S `D` k·· | S `Q` k·· |
| back | R `del:1591` k·· | R `scr:28` k·· | R `dsk:300` k·· | R `riv:887` k·· |
| status bar, flash | S | S | S | S |
| hint row | R `del:1450` | R `scr:242` | R `dsk:210` | R `riv:397` |
| peek state | S `del:479` | S message reader `scr:430` | S `dsk:163` | S `riv:615` |
| `open <id>` | S `del:330` ··a | S message reader: the next reader ··a | S `dsk:100` ··a | S `riv:613` ··a |
| `act` | S `del:336` | S message reader `scr:442` (note + `message.*`) | S `dsk:106` | S `riv:662` |

### View

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| content | lanes `del:1225` kma | list `scr:203` k·· | tiles `dsk:173` km· | strip `riv:270` kma |
| reader | S `ReaderPane` | S `MessageReader` hosts the surface kma | S `ReaderPane` | S surface (edit only) |
| header | S `note:268` | S surface, BBS rows via `SurfaceHost.header` `scr:301` | S | R cards `riv:362` |
| body render | S `renderDoc` | S `renderDoc` (the surface's) | S | R `colourBody` `riv:363` |

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
| children | — (`N` writes one) | R `T` `scr:400`, `message.thread` k·a | R `pan:299` km· | R `space` kma |
| up | S `u` k·a | S `u` (`U` too) k·a | S `u` k·a | S `u` k·a |
| outlinks | S `[ ]` ⏎ click kma | S kma | S kma | S kma |
| backlinks | S drawer, Detail's view (`src/backlinks.ts`) kma | — | S backlinks tile (`^W o l`, the welcome's strip) kma | — |
| resources | S images, `[file::` | S (projections, images) | S | — |
| search | R `g` boards only | R `scr:338` dead | R `/` `dsk:371` k·· | R `/` `riv:66` k·· |
| history | S alt+← alt+→ ⌫, `← back` row, `back` `forward` kma | — (next: the screen stack) | S kma | — (next: the columns) |

### Extensions

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| properties | S `i I` kma | S `i I` kma (count on `Stat:`) | S kma | S `i` k·a |
| edit | S `e` kma | S kma | S kma | S kma |
| comments | S `C m` kma | S kma | S kma | S kma |
| completion | S (not in composer) | S | S | S |
| folds | S kma | S kma | S kma | — (cards) |
| presence | — | R `scr:355` k·· | R `pan:411` k·· | — |
| activity | — | R `scr:392` k·· | R `pan:375` km· | — |
| stats | — | R `scr:535` k·· | — | — |
| view actions | R cards `del:1799` kma | — | — | R `riv:976` kma |

---

## 4. Findings

### F1. Two readers, two body renderers

- `NoteSurface` renders with `renderDoc` (`note:320`). The desk search preview (`dsk:404`) and river
  cards (`riv:362`) use `wrap` + `colourBody`.
- **Resolved for the BBS by PIE-426.** The BBS message reader (`MessageReader` `scr:273`) hosts
  `NoteSurface` through `SurfaceHost`, like the board, desk and river: links you step to and open, the
  property panel, folds, comments, edit, selection and copy, the ruler, resource projections, and `act`.
  Its header stays the BBS one (`Date`, `To` from `to::`, `From`, `Reply`, `Subj`, `Conf`, `Stat`),
  given to the surface through `SurfaceHost.header`, which takes the place of the surface's title, byline
  and crumbs (the summary line follows it). Its old body code is gone. Its own keys are actions
  (`message.next`, `message.previous`, `message.thread`); where they meet the surface's, the surface
  goes first (key audit below, under F4). A followed link opens as the next message reader on the screen
  stack; an agent's never opens over an edit, comment or panel the person is in.
- River cards stay a list. A full river column's note body is drawn by the surface (`NoteSurface.digest`,
  PIE-472: the same renderer, transclusions and step controls, inside the river's own column and scroll);
  its header and replies are still the river's, and PIE-431 decides the rest (folds, comment marks).

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
- The BBS message reader has `act`, `openBlock` and `describe` since PIE-426 (the note actions and
  `message.*`); the other BBS screens have none (`app:163`, `app:183`).
- **Resolves:** PIE-434 should make "every pane operation is an action" part of core.

### F4. The same key means different things

| Key | Board | Desk | River | BBS |
|---|---|---|---|---|
| `c` | collapse a lane or a reader | — (says `C` comments) | — (says so) | — (says so) |
| `C` | comment (was: reopen all lanes; now `alt+c`) | comment | comment | comment |
| `s` | steps | `^W s` swap | split | — |
| `m` | move card / threads in a reader | threads | threads | threads |
| `x` | close detail or float | `^W x` close | close pane | — |
| `o` | pop out float | `^W o` add pane | — | — |
| `t` | outline drawer | `^W o t` add outline | — | thread (`t` `T`) |
| `p` | — | hold reader | dock column | previous (`p` `P`) |
| `w` | — (the backlinks drawer's `w` is stage) | — (`^W w` saves a layout) | widen: the focused column takes the wide place | — |
| `f` | fold | fold | filter | fold |
| `alt+⏎` | second detail | — | duplicate column | the next reader, as ⏎ |
| `q` | — | menu | "quote isn't here" | back |
| `space` | lanes: — · a reader: page (a current step: done / to do) | page (a current step: done / to do) | toggle replies (a column's current step: done / to do) | page (a current step: done / to do) |
| `ctrl+z` | undo a step change | undo a step change | undo a step change | undo a step change |

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
- **Steps (PIE-472)** take no new key while reading. `⏎` or a click (or right-click) on a step's box opens
  its status choice, as on any element. Inside the choice `x o w !` mark done, to do, waiting and problem
  (the board's steps overlay already uses `x w !`), `y` copies the step link (`y` copies everywhere) and
  `a` makes it addressable; the choice takes every key first on the board, the desk, the river and the
  BBS reader until a choice or `esc`, so their `x` (close), `o` (pop out, add pane) and `w` (the
  backlinks drawer's stage) can't fire. Outside it, `space` toggles a step only while the step is the
  current element in view (as Detail's space on a focused checkbox); it pages the reader otherwise, and
  in the river it only reaches the step through the column's `[ ]`. `ctrl+z` undoes the last step change
  you made in this reader (Detail's binding); nothing else in the door binds it.
- **The BBS message reader (PIE-426)** meets the surface's keys this way. An edit, a comment or the
  property panel takes every key (`q`, `n`, `esc` included) until it closes. Otherwise the surface goes
  first and the BBS keys take what it leaves:
  - no clash: `n` `N` `→` next, `p` `P` `←` previous, `t` `T` thread, `q` `Q` back (the surface binds none
    of them while reading); `j k ↑↓ PgUp PgDn space` scroll as they always did, now the surface's;
  - `⏎` acts on the current element when there is one in view (a link opens as the next reader, a fold
    toggles, a comment mark expands its thread); with none it is next, as before. `esc` lets go of the
    element, the selection or a focus mark first; then it is back;
  - `U` is the surface's `u` (up), one code path; at the top it still says so;
  - new to the BBS reader, no old meaning: `[ ] ( ) f F z i I C c m e ctrl+e v y Y`, clicks, drags and the
    wheel; `V` (video) stays the menu's.

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
| PIE-426 | F1, F3: BBS reader on the note surface, with actions (done) |
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

---

## 7. Tiles: drag, tab, link, preview, layouts (PIE-413, PIE-417, PIE-473, PIE-474)

The desk is tiles on the layout tree. Everything below is an action first (`TILE_ACTIONS` in
`src/desk/tile-actions.ts`, `PANE_ACTIONS`); the key, the drag and `act` call the same code, and an agent's
never takes the person's focus, keys or shown tab.

### Hit areas (Replit's splits, floatty's outer edges)

| Where the header is dropped | What happens | Action |
|---|---|---|
| another tile's header, or its centre (the middle ~28% each way) | it joins that tile's tabs, before the tab under the pointer | `layout.move where=tabs index=<n>` |
| one of the four triangles between a tile's diagonals | a split on that side (joins a split already along that axis) | `layout.move where=left/right/up/down` |
| the window's outer left or right two columns, or its bottom row | a full-height column or full-width row beside everything | `layout.move where=edge-left/edge-right/edge-down` |
| its own tab set's side | it leaves the tabs and lands beside them | `layout.move to=<itself> where=…` |

The outer strips are checked first. The top edge is the headers' row, so a full-width row on top is by key
(`^W K`) or `act`. Zones come from the rectangles just placed, on every pointer event (floatty's ghost divider
came from geometry kept from the start of a drag).

### Key map and clash audit

Checked against every screen's keys (§4 F4, the board's, the river's, the BBS reader's, the surface's).

| Key | Tiles (the desk and screens on it) | Clash found | Decision |
|---|---|---|---|
| drag a header | move the tile (tab under the pointer) | none: headers took no drag before | new |
| `alt+l` | link this tile's opens: then a click, `h j k l` or a number | none (alt keys in use: `alt+b alt+f` history, `alt+c` the board's lanes) | new |
| `alt+d` | load `daily` | none | new |
| `alt+n` `alt+p` | next, previous tab | none | new |
| `^W m` + `hjkl` | move beside that tile (none that way: to the edge) | `m` is threads in a reader, but `^W` is a prefix | new, under `^W` |
| `^W t` + `hjkl` | into that tile's tabs | `t` is the board's outline drawer; the board doesn't take `^W` | new, under `^W` |
| `^W T` | take this tab out | none | new |
| `^W [ ]` | previous, next tab | `[ ]` are elements in a reader, but only after `^W` here | new, under `^W` |
| `^W H J K L` | to that outer edge | was "dock to edge": the same thing, now `layout.move` | kept |
| `^W o` / `^W O` + kind | open a tile beside / as a tab | `^W o` was "add pane": the same, more kinds | kept, extended |
| `^W v` | a preview of this tile | none | new |
| `^W p` / `^W d` | pin or unpin / slide drawers | `p` holds a reader, `d d` trashes a card: both outside `^W` | new, under `^W` |
| `^W r` / `^W w` | load / save a layout by name | none | new |
| `q` | back, on every screen but the menu (PIE-489): the board's lanes (it did nothing), the river (it flashed "quote isn't here"). On the menu, the top, it stays the Quay | the river's quote flash moves to `"` (free everywhere); the menu's `q` (Quay) is unchanged: there's nothing under the menu to go back to | changed, except on the menu |
| `"` | the river: says quoting (a new note quoting this one) isn't here yet (PIE-489) | none: no screen, surface, draft or overlay binds it; typed text (a filter, the palette, an edit) takes it first | new |
| `Esc` on the main menu | stays, says `G` logs off | it logged off (review C F1) | changed; Goodbye is `G`, a click, or the logon's `Q` |
| `ctrl+]` | leave a terminal tile | nothing binds it; telnet's escape | new |
| `tab` / `shift+tab` in a draft | indent / outdent the line or selection (`draft.indent`, `draft.outdent`, PIE-496) | `tab` moves focus on the desk, board and river, but an open draft the person is in takes every key: `tab` there inserted two spaces before, `shift+tab` did nothing. In a completion popup `tab` still inserts the candidate | changed, inside drafts only; `esc` or `ctrl+s` leaves a draft |
| `⏎` / `alt+⏎` in a draft | the next list item (`draft.newline`) / a plain line break | none: both were a line break | changed, inside drafts only |
| `ctrl+p` in a draft | the live preview (`draft.preview`) | nothing binds `ctrl+p` anywhere | new |
| the wheel, a click, a drag in a draft | scroll the draft (the cursor stays), place the cursor, select (`draft.scroll`, `draft.place`) | the wheel moved the cursor three lines; a click did nothing but choose a completion; a drag was ignored | changed, inside drafts only |
| `ctrl+c` | the program's while in a terminal tile, else quit (asked twice) | the shell's quit | the terminal gets it |
| ctrl-click, alt-click a link | open beside | none | new, as `alt+⏎` |
| `!` on the main menu, `^W !` on the desk | drop to shell (`screen.shell`): the person's login shell in their terminal, the door back where it was when it exits | the board's steps overlay takes `!` (mark problem), but only while it's open, on the board; the menu and `^W` bound nothing on `!`; typed text (a filter, an edit, a terminal tile) takes it first | new; the menu art has twelve slots, so it's on the key line (`! Shell`), as Showcase and Today are |
| `^W o l` | a backlinks tile of this tile | `l` is right in `^W h j k l`, but only after `^W o` here, where `l` was free | new, under `^W o` |

Inside a terminal tile every key is the program's (`^W` included: vim's window keys work), so the only door
key there is `ctrl+]`. Inside a board, river or brief tile its own keys work; `1`–`9`, `V` and `^W` stay the
desk's.

### Tiles and their actions

| Action | Args | Keys, mouse |
|---|---|---|
| `layout.get` | | `peek` shows the same `tree` |
| `layout.list`, `layout.save`, `layout.load` (`layout.restore`) | `name` | `^W r`, `^W w`, `alt+d` |
| `layout.move` | `reader=<tile>`, `to`, `where`, `index` | drag a header, `^W m t T H J K L` |
| `tile.open` | `kind`, `name`, `cmd`, `file`, `source`, `note`, `cwd`, `to`, `where` | `^W o`, `^W O` |
| `tile.close`, `tile.focus`, `tile.info` | `reader=<tile>` | `^W x`, click, Tab, 1-9 |
| `tile.link` | `reader=<tile>`, `to` (none unlinks) | `alt+l` then a click |
| `tile.pin`, `tile.drawer` | `on`, `open` | `^W p`, `^W d`, a handle's click |
| `tile.preview` | `where` | `^W v` |
| `tile.type`, `tile.restart` | `text` | typing in the tile, `⏎` on an exited one |
| `tab.select` | `by` (1, -1) | a click on a tab, `alt+n alt+p`, `^W [ ]` |

### The river: focus is not the layout

Evan's notes (Sep 29): a click just to focus a column shifted the whole strip, and the column he'd been reading
collapsed to its headings. So the river keeps two things apart:

- **Focus** is which column has the keys (glossary: focus). A click in a column, `h` `l`, `tab`, and `back`
  move it and its highlight only; every column's place, width, cover and scroll stay cell for cell. A column
  off the strip altogether is the one exception: `h` `l` bring it on, one step.
- **The wide column** is what the layout is built around (`describe()`'s `wide`). Only an explicit shift
  moves it: `w`, a click on a column's **header** (its top border; anywhere on a spine, which is all title strip, as a click on a board spine opens it), the `widen` action,
  and an open that couldn't otherwise show the new column full. The column the person was reading (the one
  they were in before) stays full beside it when there's room; a dock (`p`) outranks it.
- **Why these inputs:** the first click must be harmless, so the shift needs a different target, not a second
  click on the same place (a second click on a card already opens it, and a double click selects a word). A
  header is the tile grammar's place for acting on the whole pane (§7's drag). `w` is free on every screen's
  reading keys (the backlinks drawer's `w` and the step choice's `w` only live while those are open; the desk's
  is under `^W`); `z` was the obvious zoom key but it's the surface's unfold.
- **Covered, not collapsed:** a peek column draws the same view a full column does, at the same reading width,
  and shows its first cells; its right-hand neighbour lies over the rest like a drawer, with the board's
  drawer shadow (`▒`) on the edge, and the visible part is dimmed (`Canvas.dim`). Nothing rewraps when it
  widens. Only the far columns become spines, as before. It isn't the desk's drawer model
  (`placeScreen`'s `over`): the river is still its own strip (below), so it uses the same drawing idea, not
  the tree.
- **Opens shift as little as they can:** ⏎ on a card or a followed link adds the column after its source as
  before. If that column already shows full next to the source, nothing moves; otherwise the new column
  becomes wide and the source stays full beside it. A close hands a full column's place to the column
  sliding into the gap. A click opens a card only in the column that already has the keys.
- **Back and forward** in the river go between columns (`SurfaceHost.history`): back gives the keys to the
  column this one was opened (or last reached) from, forward returns; each widens its target only when it's
  covered. Keys and mouse as in every reader (alt+← alt+→, backspace, the side buttons, the `← back` row
  under the column's title). An agent's `back` is refused: it would move the person's keys.

### The welcome screen (a preset on the desk)

The menu's `C` opens it (it pinned `[[claude-now]]` before; that page is now the welcome's fallback). Its keys,
checked against the desk's, the surface's and the other screens':

| Key | Welcome | Clash found | Decision |
|---|---|---|---|
| `1`–`9`, `0` | pick the welcome note on that tab (`0` the tenth) | the desk's `1`–`9` focus a tile | the tabs take them here (`DeskPreset.digits: false`): the headers don't number the tiles, and focus is `Tab`, a click or `^W h j k l`; `act reader=` names them (welcome, detail, backlinks, preview). After `alt+l` a digit is still the desk's (the tile to link) |
| `Tab` | list → detail → backlinks → preview | none: the desk's reading order | the backlinks sit under the detail they belong to and the preview runs the full height, so reading order is the useful order; giving a tile the keys never moves a tile |
| `L` | the next logo (`welcome.logo`) | the board's `L` moves a card right, not on this screen; the surface binds no `L` | new, this screen only |
| `⏎` on a link | opens it in the preview (the detail's link) | none: the desk's link rule | kept; with nothing picked yet, `⏎` takes the first element (`]` then `⏎`) |
| `alt+⏎`, ctrl-click, alt-click | read it in the detail | everywhere else it opens beside (a new reader) | the same chord, "open fresh": on a one-note screen, fresh is the detail itself; back returns. In the preview with no link picked, `alt+⏎` (or a click on its `⇱ read here`) reads the preview's own note in the detail |
| `p` in the detail | refused, said | the desk's readers hold or follow with `p` | the detail never follows here |
| `j k ⏎ s K w h n .` in the backlinks | the board drawer's keys | none (the tile has the keys only when focused) | kept, one drawing; landing on the tile (Tab, a click) shows its selected row in the preview, as the board's drawer shows its first on opening |
| `q`, `Esc` | the menu | none | kept |

### What's not done here

- **Screen notes in the outline** (PIE-412 slice 3): layouts are in the door's `layouts.json`; the saved form is
  the one a screen note would hold.
- **One river:** the River screen, with its columns, open rule, squeeze tiers and `/` jump. The `river` layout
  hosts that screen in a tile, beside a preview that follows its card; the desk doesn't copy its rule. Moving
  the River's columns themselves onto tiles, so the River is a preset of the tree (Evan's direction), is next.
- **The board screen** keeps its own tree inside its tile (lanes, readers, drawers); the `board` layout puts a
  preview tile after its card and collapses its own strip.
- **Terminal keys:** while the person is in a terminal tile the bytes go through raw (F-keys, modified arrows,
  Insert, bracketed pastes); only mouse reports and `ctrl+]` are the door's.
