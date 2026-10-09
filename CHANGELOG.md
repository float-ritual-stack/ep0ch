# Changelog

Notable changes to ep0ch, for the people who use it: what you can now do, what changed, and what you must run.
One file for the whole repository (outline-core, the outliner, the door and the Claude mod). The project is
active dogfood: the protocol and the schema still change, one version at a time.

Before the two repositories became one (October 3, 2026), the door kept no changelog; its merged pull requests
are its record. The outliner's entries from then are kept below, under
[Outliner, before the one repository](#outliner-before-the-one-repository).

## [Unreleased]

### Every component has a schema, so the library shows them all (PIE-701)

- **New:** the component library, `ep0ch library --brief` and `outline_components` now cover every component a note can
  draw: all the `::graph-*` figures (stat, kpi, rank, funnel, waterfall, plot, gantt, tree, check, timeline, table, tabs,
  decision, chat, keys, uptime, activity, calendar, annotate, quadrant, matrix, compare, flow), `::links`, `::outlinks`,
  `::resources`, `::backlinks`, `::box`, pictures, header images, embeds and references, code fences and tables. Each page
  has a live minimal example, each property's values drawn, and the source to copy. *Why it matters:* an agent (or you)
  finds a component's properties and values without reading code, and an extension's component joins the same list with
  no code of ours.
- **New:** the library draws at all three widths (40, 80, 160) one under another: `w` cycles to `all`, or click it.
- **Fixed:** a `::graph-waterfall` whose running total rose past its first bar drew as "couldn't draw".
- **Changed:** a test fails when a component the readers draw has no schema, so a new component cannot ship without a
  library page. A figure's live form (`query:`) is not drawn in the library, which has no outline to ask; its page says so.
- **Run:** PROTOCOL 125 (the components the service lists grew). After `ep0ch install --apply` on each machine, restart the host so clients and service agree. No schema change.

### Every MCP write says which call made it, and your own writes stop coming back as news (PIE-685)

- **New:** a caller's visit to the board is a call. Every MCP write (stdio and the gateway) records its call id beside who made
  it, a readable handle for it (`leaping_otter_convergence`, minted once and stored) shows in `list_outlines`, in a write's
  answer and in the gateway log, and `call:<id or handle>` finds what one call wrote. The id comes from the `call` argument,
  the gateway's `Mcp-Session-Id`, or one per stdio connection; a write with none is a call of its own and says how to keep
  one. Display stays `daddy (claude.ai)`. *Why it matters:* you can review or undo one chat's batch of notes without touching
  another's.
- **New:** a recent-activity `outline_query` (an `updated` range or sort, or `fold`) leaves out the rows only your own call
  changed, counting them (`ownOmitted`), unless `includeOwn: true`. Other calls' writes still show. *Why it matters:* an agent
  orienting after its own writing burst doesn't re-read what it just wrote.
- **Run:** PROTOCOL 122 (a new query atom). After `ep0ch install --apply` on each machine, restart the host and reconnect MCP
  clients to see the `call` argument. No schema change; the handles live in `<outlines>/.clients/mcp-calls/calls.sqlite`.

### Agents make outlines of their own over MCP, and every write says who made it (PIE-679)

- **New:** `outline_new` over MCP (stdio and the gateway): an agent makes a scratch outline on this machine for link sprees,
  the day's discourse and other fleeting things, with `full` for itself and `read` for the other principals. Its root note
  says who made it and why (`[created-by::…] [purpose::…] [kind::scratch]`), and the door's home base, `ep0ch outline list`
  and `list_outlines` show the same. A taken name is refused with the nearest names; `EP0CH_MCP_SCRATCH_CAP` (default 5 a
  week per principal) is a soft cap. `outline_archive` and `ep0ch outline archive|unarchive <name>` put one away and bring it
  back, keeping the database; nothing deletes over MCP.
- **Changed:** a write's actor id carries the principal auth proved and the persona it declared: `mcp:loki/claude-code@float-2`,
  `mcp:claude.ai`, the mod's `cowboy/claude-code@laptop`. The door, receipts, proposals and threads show
  `loki (claude-code@float-2)`. `EP0CH_MCP_PERSONAS` keys are principals now (`claude-code@float-2=loki`; a bare client name
  still works for the gateway's); a persona can't be claimed across principals. Older writes keep their ids.
- **Run:** PROTOCOL 117. After `ep0ch install --apply` on each machine, restart the Claude mod's sessions and reconnect MCP
  clients to see `outline_new`. No schema change.

### Your look, tuned live: spacing and list density from notes, with a tune inspector (PIE-673)

- **New:** a tile's padding, a note's measure (the widest its text runs, centred in a wider tile; a reader's is 88 by
  default) and margin, a list's gap, dividers and zebra, and a heading's spacing come from notes in the outline, so you
  change them without an agent or a build. A note says what it styles and how: `[style-for::global]`,
  `[style-for::tile:detail]`, `[style-for::screen:desk]`, or a name a page uses (`[style::airy]`), with fields such as
  `[style.measure::72] [style.pad::1] [style.list.gap::1] [style.list.divider::dots]`; a page can set its own, and a box
  in a note too (`::box{margin.x=4 list.gap=0}` … `::`). Any field takes a width (`[style.narrow.margin.x::0]`, under 60
  columns). The nearest level wins: built-in, a heading style, global, the tile's kind, the screen, the page, a box. An
  edit to a style note restyles every door on the outline at once.
- **New:** the tune inspector (`alt+y`, `^W o y`, or "tune its look" in a tile's ⋯ menu) beside a tile lists each value
  and where it comes from. `+` `−`, a click on `[−] [+]` or the wheel over a value nudge it, and the tile moves in the
  next frame. A nudge goes where the value is set (or to the level you pick with v), for every width or (w) this width
  only. `s` saves to the outline, `u` undoes, `x` resets. Quitting with nudges unsaved says so.
- **Unchanged text:** spacing is drawn, never text. A drag, `y`, `Y`, `select.copy`, `peek` and `ep0ch export` give the
  note's words, a wrapped line joined, with no margin, gap or divider in them; a click lands on the character under it.
  A terminal's own selection (a shift-drag, tmux or Herdr copy-mode) copies the screen as it is, spaces included: use the
  door's own drag, which copies the text over OSC 52.
- **Heading styles:** a heading style's `heading-margin` and `heading-padding` are the same tokens as a style note's
  `heading.margin` and `heading.padding`, so an outline can set a default margin for every heading. A style's margin rows are no longer copied as blank
  lines.
- **Protocol 115:** the host lists the style notes (`styles.list`), and outline-core's component rule reads `::name{…}`.
  Run `ep0ch install --apply` on each machine (float-2 for pie, the MacBook for float-hub): it restarts the host on the
  new code; until then a door on this code refuses the old host and says to run it.

### Orient from an outline: `outline_query` sorts, projects, folds, and no read re-sends what the caller has (PIE-674)

- **New:** an agent arriving cold can orient from the outlines' recent changes in a few KB instead of a separate context
  store. `outline_query` takes `sort` (`updated desc`; the service orders, not the client), `fields` (`id,title,updated,actor,path`
  or any property key; a projected row never carries the body, and `outline_read` fetches it), `under` (a note's subtree;
  `subtreeRootId` works too) and `fold: true` (proposals, comments and deliveries collapse into their note with a count:
  `4 changes (1 proposal, 2 comments, 1 delivery)`). `updated >= -1d` on a busy outline was 25 rows and 74k to 230k
  characters, unsorted; the orient form is titles only.
- **New:** no body is sent twice. Within one response (a batch is one response) a later hit is `{id, revision, see}`.
  A proposal reads as its diff and the target's `id@revision`, not the note again; a comment as its own words and the
  span it is about (`raw: true` gives either as stored). `seen: ["id@rev", …]` on `outline_read`, `outline_query` and
  `outline_find` returns `{id, revision, unchanged: true}` for any block the caller holds at that revision, like
  If-None-Match; a block that changed since comes back whole. No wire change, no `PROTOCOL` bump.
### The query grammar can ask about relations: `#tag`, `links:`, `under:`, `title~` and `text~` (PIE-554)

- **New:** every client that queries (saved views, live figures, board lanes, `ep0ch find --query`, MCP `outline_query`)
  now takes five more atoms, combined with `AND`, `OR`, `NOT` and parentheses like `key=value`: `#tag` (also nested
  tags), `links:[[page]]` / `links:((id))` / `links:PIE-123` (the backlink index), `under:[[page]]` / `under:((id))`
  (a subtree), `title~text` and `text~text` (caseless substrings). "What points at X" and "everything under Y except
  Z" are views now, with no type-exclusion lists. A malformed atom, or a target that names no block, says which atom
  and shows a working one.
- **Protocol:** `PROTOCOL` is 118 (the grammar's shared part moved into outline-core `query-atoms.ts`). Update the
  host and every client together with `ep0ch install --apply`; there is no schema change.

### The MCP gateway reads and writes the laptop's live outline when the laptop answers; stdio writes by the same grant (PIE-661)

- **Changed:** the local stdio server (`ep0ch mcp`) is no longer always read-only. It honours the same access levels as
  the gateway, through the one shared tool path: `read` reads, `propose` offers the write tools and writes become
  proposals, `full` applies against the revision read. The actor is `mcp:<client>` from the MCP `initialize`'s client
  name (Claude Desktop's, for example), mapped by `EP0CH_MCP_PERSONAS` as the gateway's callers are. Writes go straight
  to the outline's host (through the ssh forward with `--machine`). `list_outlines` over stdio now also says whether
  the write tools are offered. A connected client keeps its tool list until it reconnects.

- **New:** for a mirrored outline (`float-hub@laptop`), the gateway first tries that machine's own host through the
  shared ssh forward, with a 2 second budget and a 45 second backoff after a failure. When it answers, reads, finds,
  queries and threads are live (`source: "live"` and the machine) and writes are applied or proposed there at once, with
  the usual revision check and `mcp:<persona>` attribution, instead of queuing as netmail. Claude.ai no longer shows a
  copy that is 40 minutes old while the laptop is awake.
- **Unchanged fallback:** when it doesn't answer, the mirror serves and writes queue exactly as before, and the answer
  says why and when it tried. A host on another `PROTOCOL` counts as away, naming `ep0ch install --apply` to run on it.
- **One identity:** the mirror's private copy kept a fresh instance id of its own, so the same outline answered with two
  (the mirror's, the laptop's). It now keeps the one the copy carries. Answers name the outline by its machine's own
  name once its host has answered live (the ssh name stays accepted, `list_outlines` gives both), and a URI under
  either reaches it; a queued write applies the same under both.
- **Live writes show up:** a write made live is remembered, so a read that falls back to the mirror shows it over the
  note as `pending` and says `staleSince` until the copy catches up.
- **Safe:** a write queued while the laptop was away applies once when it pulls (a note changed live meanwhile becomes a
  proposal); a live write says how many of the caller's queued writes to that note still wait; a live read still shows
  them as `pending`. `list_outlines` gives each mirrored outline's `route`. `EP0CH_MCP_LIVE=0` turns it off. No
  `PROTOCOL` change: restart the gateway (`ep0ch install --apply` on float-2) to get it.
### A property value holding links parses whole (PIE-663)

- **Fixed:** `[related::[[PC-967]], ((id|daytime plan step 6))]` was read as `[[PC-967`. A value now runs to the
  property's own closing `]`, with `[[page]]`, `[[page|label]]`, `((id))`, `((id|label))` and embeds balanced inside it
  (a `]` in a `((id|label))` label is fine). Brackets that don't balance on their line end the value at the first `]`,
  as before, and never reach the next line.
- **New:** a query `related=[[PC-967]]` (or `related=((id))`) finds a note whose value is a list holding that link; a
  property can be written with a link value (`properties.patch`, the door's property editor).
- **Changed:** `PROTOCOL` is 114 and the property parser is version 8: the host re-indexes every outline's properties
  the first time it opens one. **Run:** restart the host (`ep0ch install --apply`), nothing else.

### Agent tools take one `ref` argument, and wrong arguments get the right call back

- **New:** `ref` names "which block or note" on every agent surface: the Claude mod's tools (`outline_*`, `work_*`,
  `note_section`, `view_order`, `show`, `door_open`), the MCP gateway, the door's `act` (for its `id`) and `open`, the
  Pi extension's block tools and `outliner agent`. `id`, `reference`, `block`, `blockId`, `uri` and `note` are accepted
  wherever `ref` is; the old names (`item`, `view`, `reference`, `id`, `blockId`, `viewId`, `address`) still work.
- **Safer:** a call that gives two of them for different notes is refused as ambiguous, naming both values, and nothing
  runs or opens. The same note spelt two ways (`((id))` and the id) is fine.
- **Better errors:** an unknown argument is named with the closest valid one ("did you mean `ref`?"), a missing or
  mistyped one says what it needs, and every such error restates the tool's arguments and gives a call that works (the
  corrected one when the fix is exact). No `PROTOCOL` change.

### Comment on a Resource (PIE-650)

- **Fixed:** a reader showing a Resource (a file opened from a `[file::…]` link, a fetched page) refused C with "shown here
  to read". It now takes C and m: select text, press C, write. The thread is stored in the outline, anchored to the
  Resource (it is registered first when the link is followed), and quotes the file's own source, mapped back from what the
  reader drew (a heading, a link, emphasis, a list item). The file is never written. The note whose link opened the
  Resource is the thread's reference context, so the thread also lists among that note's comments.
- **New (service):** the `resource-comment` batch operation (`annotations.batch`) and `annotations.reconcile` with only a
  Resource subject: the service reads the Resource's text itself, anchors the quote, and re-anchors a rewritten file's
  threads through the resolution events (a thread whose passage went stays, as it read). `PROTOCOL` 112.
- **New (agents):** `outline_read` on a Resource (`resource:<id>` or `[file::path]`) returns its text and open threads;
  `outline_comment` takes the same ref (the Claude mod's tools, `outliner agent`, and the MCP gateway on a live outline).
  The mod holds the first Edit or Write of a file with open threads once, with them in the answer.

### A note's title stands out (PIE-657)

- **The reader's header leads with the title.** The breadcrumb is a dim eyebrow above it, the title is the one bright,
  bold line, and one dim line under it holds the author, the day, the work id, `i N properties`, the summary values (still
  links) and the comment count. One blank row, then the body. In a narrow tile the summary takes a line of its own, so no
  chip is cut off. Detail, preview, note tiles, the board's preview and a river column share it (`NoteSurface.headerBlock`).
- **The tile's frame bar no longer repeats the title** (it reads `3 note detail`); a tile too short for the header keeps it
  there. `peek`, `layout.get` and every agent read keep the title as data.
- **Double height in Kitty.** Where the terminal has text sizing (OSC 66, answered at start-up; `EP0CH_SIZED=1|0` says it
  outright) and the title fits twice over, it is drawn at scale 2. Elsewhere it is bold on one row. Herdr panes don't pass it on.
- **The focused tile's title is the theme's brightest;** the other tiles' are a clear step down, never above the theme's cap.
- **Run:** nothing. The kitchen sink has a `title` section.

### The power bar: one palette for tiles, notes, actions, what changed and extensions (PIE-656)

- **`ctrl+k` on any screen** (or `cmd+k` where your terminal sends it, or a click on `^K` at the status bar's left) opens
  one palette over the screen and your drawer: a list on the left, the lit row read on the right (a note as a reader
  draws it, a terminal's screen, an action's summary and keys), its scopes along the top.
- **Nothing typed:** the tiles open on every screen and in your drawer, indented as each screen's layout tree, with the
  note each shows; then what others changed since you looked.
- **Typed:** tiles, notes (the service's one search, as Goto ranks it), the actions you can do here with their keys,
  what changed and the screens, each under its heading. `%` `/` `>` `+` `@` (or tab) narrow it to one.
- **⏎ goes there:** a tile gets your keys (a spine opens, a screen under this one comes up), a note opens where opens
  land, an action runs. `alt+⏎` zooms a tile, or opens a note in a new detail. Mouse: a click lights a row, a double
  click goes, an alt-click is the alternate, a click on a scope picks it.
- **The desk's `/` and a river column's `g` open it in its notes scope.** The desk's own search overlay is gone; the
  search and its keys are the same.
- **Extensions add sources:** a `bar[]` in an extension's `extension.json` answers what's typed with rows that open a
  block, run one of its actions or copy text (`extensions.bar`). The outliner ships `glyphs` as the example: `~shade`.
- **Agents:** `bar.open` answers the rows and opens nothing; `bar.pick` picks as the agent, through the same paths and
  their rules. `peek` shows the bar while it's open.
- **Run:** a protocol change (113): `ep0ch install --apply` on each machine, which restarts the outline host; doors
  and the host must both be on it. The kitchen sink has a `bar` section.

### The status bar's +N new opens what changed (PIE-647)

- **`+N new` counts notes, not events.** It is the distinct notes an agent, another client or (when asked for, with a click
  on `+N ext`) an extension changed since you last looked; your own edits are never news. It used to count every change event
  since the door started and never went down.
- **Click it, or press `alt+o`, to see them.** The **what-changed list** opens as a tab in your drawer: one row per note,
  newest first, with its title, who changed it (an agent's id, `ext:…`), what (edited, created, moved, commented, property
  set) and when. `⏎` or a double click opens the note where opens land, `alt+⏎` or an alt-click in a new detail, `d` shows the
  change under the row (the note's earlier text against the new, from the revisions the service keeps), `x` marks it seen.
- **Looking clears it, and it stays cleared.** Opening the list marks what it holds seen and the count goes to 0; where you
  last looked is kept per outline, so a restart counts only what changed after it. An agent's open or read never clears it.
- **Agents:** `changes.open` (behind your tab, marking nothing), `changes.list` (the rows), `changes.go`, `changes.diff`;
  `changes.seen` is yours. Rows come from the service's change feed (`changes.since`): no second log.
- **Run:** nothing beyond the usual `ep0ch install --apply`. The kitchen sink has a `changes` section.

### MCP: write receipts, read-your-writes and outline_query (PIE-648)

- **New:** `outline_write_status(queueId)` follows a write queued for another machine's outline: queued (with that machine's
  last pull), applied (with the revision), proposed (with the proposal's URI), superseded or rejected (with why).
- **New:** `outline_read` on a mirror's block shows the caller's own still-queued edits as `pending`, laid over the mirror's
  text and marked per span. Nobody else's waiting writes are shown.
- **New:** `outline_query` runs the views' grammar (or a saved view by id) read-only over MCP, on live outlines and mirrors,
  with `limit`, `more` and `total`. A read-only copy now answers `blocks.query`, `views.read` and `query.matches`.
- **You must run:** on the gateway's machine, with the gateway stopped:
  `bun packages/door/scripts/migrations/netmail-v1-to-v2.ts ~/outline-mirrors/.netmail.sqlite --write` (the queue store
  is version 2). Then update the home machines (the laptop) so their pull reports revisions and proposals back.

### The links tile filters and sorts all three groups, and its header stays put

- **Fixed:** in the links tile (`b`), Kind, Stage and Sort now apply to Outlinks and Resources as well as Backlinks,
  by the target's kind, stage and dates (the service sends them with each link). A link with no target block
  (unregistered, missing) stays until Kind or Stage narrows, then drops out, and sorts last. The counter reads
  `N of M match · →a/b ♦c/d ←e/f` across the groups. Outlinks and Resources keep the note's order in the tree and the
  inline components; the tile sorts them.
- **Fixed:** the header's controls no longer jump: counters on line 1, Kind, Stage and Sort each in a fixed-width slot
  on line 2 (a long value is cut with …), the filter and notes below. Clicks follow.
- **Run:** protocol 111. Restart the outline host and the doors on this code (`ep0ch install --apply`). No schema change.

### A handover keeps where each reader has been (PIE-643)

- **Fixed:** `ep0ch install --apply` (and `ep0ch session upgrade`, a restart, a quit and come back) no longer empties a
  reader's back and forward. Each reader tile (reader, detail, and one in the drawer) saves its note, its back and forward
  stacks, how far down it is, the `[ ]` position, folds, expanded threads and figure choices with the layout; a zoomed tile
  comes back zoomed, and the focus was already kept. A reader that follows the current note shows the note it had.
- **Kept as before:** the river's trails (saved with its layout), the drawer's open state and its tiles, floats, programs and
  open edits.
- **Still lost:** a river column's own scroll, selection and folds; the outline tree's open rows and selection; the main
  menu's selection. Their saved history is `nav` in the tile's entry in `desk.json`, versioned: a file of another version is
  read as having none.
- **Run:** nothing beyond `ep0ch install --apply`. No protocol or schema change.

### Component discovery for agents

- **New:** agents discover components without the library screen: `ep0ch library --brief [<component>…]`, the Claude mod's and the MCP gateway's `outline_components` tool, and each component as an MCP resource (`resources/list`, `ep0ch://<outline>@<machine>/components/<id>`) for claude.ai to `@`-mention. Per component: purpose, where it goes, each property as `key: values (default) — meaning`, one example.

### Copy the whole note

- **New:** `Y` in a reader or river column with nothing selected, the tile menu's "copy note" and `act note.copy` copy the note's whole source text ("copied the note, N lines"; an agent's is returned, never your clipboard). With a selection, `Y` still copies that selection's source.

### What an agent may do to each tile (PIE-639)

- **New:** each tile has a level for agents. `free` (the default) is as before; `edit` lets an agent edit the note the tile
  shows (patch, comment, set properties) but not navigate, close, move or retarget the tile; `off` lets it read the tile
  through `peek` and do nothing else. A screen has a default and each tile its own exception ("the screen is free, except
  this one"). Set it with `^W g` (cycles), a click on the chip on the tile's frame (`✎ agents: edit only`, `⊘ agents: hands
  off`), the tile's `⋯` menu, `tile.agent policy=free|edit|off|inherit tile=…`, or `layout.policy node=screen agents=edit`
  (a row in `^W P`). Saved with the layout.
- **Reported:** `peek` (`agentLimits`, each limited tile's `agents`), `layout.get`, and `ep0ch where` (`agents may: …`), so
  an agent reads its limits before acting. A refusal names the policy and the command that frees the tile.
- **Enforced for agents only:** your own keys and clicks are never limited. An agent's `open` naming no tile skips limited
  tiles (a limited reader keeps its note); an agent can tighten a tile but never loosen one. The lock (`alt+k`) still fixes
  the shape for everyone; this limits only agents.
- **Run:** nothing; `ep0ch install --apply` and restart the door to get it. No protocol or schema change.

### Copy a block's text cleanly: a ⧉ on code blocks, quotes and callouts (PIE-638)

- **New:** every fenced code block, quote and callout in a reader (detail, preview, desk, the BBS reader) and a river column
  has a small dim `⧉` at its top right edge. A click, `y` with `[ ]` on the block (or on anything in it), ⏎ on a block, or
  `act block.copy n=…` copies its content as written: a fence's lines without the fence, a quote's lines without the `>`
  markers, a callout's body without its marker line, links and styles as typed. It goes to your clipboard (OSC 52) and the
  status line says "copied N lines". An agent's copy is returned to it and never touches your clipboard. `[ ]` now stops on
  code blocks and quotes (a callout already was one); `act blocks` lists them.
- **New:** an inline `code span` is copyable too: a click copies its contents without the backticks ("copied N chars"), it is a
  `[ ]` element so `y` copies it, and `act block.copy element=n` works. Links stay as they were; a code span isn't one.
- **Fixed:** a mouse selection in a reader or a river column copies the words, not the drawing: the bars of a quote, the frame of
  a callout or a code block, a fence's info line and fold arrows are left out. A list item keeps its marker as the note has it
  (`- `, `* `, `1. `) and its indent, not the `∙` drawn for it. Selecting part of a quote copies just those words.

### Mirrors follow a schema bump, and the gateway never sends you to `install` for one

- **Fixed:** the backup job treated a migration as no change (it moves `user_version`, not the change feed), so
  mirrors kept the old schema for good. A different schema than the newest snapshot's is a change now; snapshots carry
  a `schema=N` tag, `backup status` state keeps it, and a mirror takes a snapshot at a newer schema even at the same
  change (never an older one over a newer copy).
- **Fixed:** the remote MCP gateway migrates a copy one or more schemas behind on its own private `.serve` copy, with
  the migration scripts install runs (never the mirror), and says so in the outline's note. Where no script reaches
  the version it lists the outline `unreachable` with `on <machine>: ep0ch backup run --force`, and still shows the
  outline's access and `writes` (read from the copy's metadata), with the reason.
- **Changed:** between a Litestream follower's copy and the backup job's, the one nearer this build's schema wins, then
  the later change; a stale follower loses a tie. `ep0ch doctor` gives an erroring follower
  (`error applying updates`) its fresh-restore command.
- **Run:** on the machine behind (the laptop): `ep0ch backup run --force` once, so the mirror gets a current snapshot.
### A kept edit says what it changes, and asks for nothing (PIE-637)

- **Changed:** the notice under a note for an edit you started and didn't save no longer compares the draft with the note
  as it is now (twelve later revisions buried the draft's own changes). It compares the draft's own changes with the
  note through the text the draft started from (the draft's own copy, else the note's history, `block.revisions`), and answers in one calm sentence, in grey, never amber:
  - every change already in the note: it settles when you open the note, a copy is kept, one dim line says so;
  - lines the note lacks: `2 lines from your edit on Oct 1 aren't in the note` with `[show them]`, `[add them]` (one
    undoable patch, nothing saved until ctrl+s), `[keep as a note]` and `[let it go]`;
  - lines changed differently since: `[compare]` shows both versions;
  - no starting text: a two-way comparison, labelled, that never settles by itself.
  Edits on an older revision more than three days old fold to a `1 old edit` chip. `[take it back]` is now `[add them]`
  (`unsent.take` → `unsent.add`), `[diff]` is `[show them]` or `[compare]`, `[dismiss]` is `[let it go]`; `[keep as a
  note]` (`unsent.keep`) is new. The exit message and the lane title say it the same way (`is kept here`, `■ card kept`).
  A letting go always keeps a copy. Demo: the showcase's `kept` section. No protocol or schema change.

### A rule's text pattern can no longer hang the host (PIE-630)

- **Changed:** a rule's text pattern is read structurally and refused when it can backtrack without bound: a repeated
  group that holds a repetition, an optional atom or alternatives at any depth (`((a+))+`, `(?:a+)+`, `(a*)*`, `(a|a)*`),
  a backreference, or three repeating or optional atoms side by side that match the same characters (`a*a*a*b`,
  `a*aa*aa*b`; `a+b+c+` and `\s*(\S+)` are fine). A pattern sees the first 400 characters of a line (was 1000). A rule
  that used such a pattern is reported with its reason; nothing else changes.
- **Run:** PROTOCOL 108: `ep0ch install --apply`, then restart the doors.

### Litestream stays stopped no longer, and mirrors take newer snapshots (review fixes)

- **Fixed:** when starting Litestream again after a change to an outline's file fails, the host no longer counts as holding
  the pause for as long as it lives (replication used to stay stopped until the host restarted). The failure is kept on
  the record, retried 5 s, 15 s, a minute, five, then every fifteen minutes, said in the host's log each time, a failed
  line in `ep0ch doctor` and a backup alert with `systemctl --user start …`, until it runs.
- **Fixed:** a mirror whose snapshot has no change feed now takes a newer snapshot (the job compared the wrong time field).

### Scratch runs stay off real config and machines (PIE-634)

- **Fixed:** `scripts/agent-env` gives a run private `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` (so
  the backup commands no longer read your `~/.config/ep0ch/backup.env`), and clears `RESTIC_*`, `LITESTREAM_*` and `AWS_*`.
  `try-it.sh --copy` (and the showcase) clear `EP0CH_MACHINE` and pass `--here`, so a copy never routes to a remote outline.
  `scripts/box-test --on` or `--ref` with no value exits 2 instead of looping forever.

### Back to an earlier revision of a note (PIE-621, #277)

- **The outline keeps a note's earlier texts:** the newest 100 each note had, from the first save after this update,
  each with when it was saved and by whom. For a paste that was already saved.
- **`ep0ch revisions <note>`** lists them, `ep0ch revisions <note> <n>` prints one, `--restore` saves it as the note (a
  new revision, recorded as you, so it can be gone back on too). In the door the tile menu's `an earlier revision`
  puts it into the edit as one undo step, written on `ctrl+s`; again goes one further back.
- **Run:** PROTOCOL 107 and schema version 4: `ep0ch install --apply` on both machines. It stops the outline host,
  runs `packages/outliner/scripts/migrations/0004-block-revisions.ts` on every outline at schema 3 and starts it
  again; then restart the doors.
### Completion wherever you write (PIE-626, #278)

- **New:** `[`, `[[`, `((`, `[file::` and a callout's `> [!` complete in every place the door takes outline text, not
  just a note's edit: a comment or reply, the board's composer, a new note's float, the property panel's value (`i`,
  `⏎` on a row: the outline's own values for that key, then the schemas'), and a river column's `/` filter
  (`ty` offers the keys the outline carries, most used first; `stage:` their values). One completer, one attachment
  point: a draft session and every `LineInput` complete by default; a line that holds a name, a path or plain words
  (the search overlay, the links filter, a layout's name, the home base) opts out.
- **Agents:** `complete text=… key=heading` lists what a property's value offers; `column.complete text=…` what a
  filter's word offers. No protocol or schema change.
### The outline host keeps answering after a change and a restart (PIE-625, #276)

- **Fixed:** requests to the outline host timed out at 3 s in bursts, and for about a minute after each restart. Each
  change made every Tree re-read the tree and all its saved views, and each read parsed the whole outline again on
  the host's one loop. A working outline's write cost about 4.5 s of it. Now the outline is read once per change and
  shared, titles and tree labels are remembered by text, and each request takes its turn: the whole-outline reads go
  after note reads and writes, and the tree index is made in slices. On the bench, the slowest note read went from
  3.8 s to under 80 ms at start-up, under load, during a backup and after a restart.
- **New:** the host's log says what held its loop: `loop_stalled` and `slow_request` lines
  (`journalctl --user -u outliner-host | grep -E 'loop_stalled|slow_request'`).
- **For contributors:** `bun scripts/bench-host-stalls.ts` (in packages/outliner) is the guard: it exits 1 when a
  note read takes over 200 ms.
- **What to run:** nothing beyond the usual update (`ep0ch install --apply`). No protocol or schema change.

### Editing basics in a draft: copy, undo and redo, a paste in one step (PIE-621, #272)

- **Copy out of an edit.** A drag in a draft copies when the button comes up, as in a reader (`EP0CH_COPY_ON_SELECT=0`
  turns it off), and so does a double click's word, a triple click's line and a shift+click. `shift+arrows` select by
  keys; `cmd+c`, `alt+c` (any terminal, tmux too) or the frame's `[copy]` copy. Through OSC 52, said `copied N chars`.
- **Undo and redo everything.** `ctrl+z` takes back the newest change, typing a word at a time, a paste in one step
  however big (a paste over 20 lines or 2 KB says `pasted N lines · ctrl+z undoes`), an insert, `$EDITOR`'s text, a
  reload, an agent's patch; `ctrl+y` (or `ctrl+shift+z` under the Kitty keyboard protocol) puts it back. Undo goes back
  past a save: open the note again unchanged and `ctrl+z` carries on.
- **Run:** nothing beyond `ep0ch install --apply` and a door restart; no protocol or schema change.

### Components describe their own properties once: a library page each, and completion (PIE-618, #275)

- **New:** the component library, `ep0ch --screen library`: a design-system page for each component (heading
  styles, callouts, rules, `::graph-meter`, `::graph-spark`, and any an extension ships). An overview with the
  properties table, each value of each property drawn live with the exact source under it, the grids (pattern ×
  align, rows × row), and every combination (heading styles have 2430) behind a filter you pick per axis. Each
  variation at 40, 80 or 160 columns; `y` or a click copies its source. Every key and click is an action
  (`library.*`), so an agent drives it through `act`; the showcase's `library` section opens it.
- **New:** property completion in a draft: `[head` offers the keys with where they go and what they mean,
  `[heading-pattern::` the values, each with a one-row preview of what it draws, `[heading::` the built-in styles and
  the outline's own; the same inside a `::graph-meter` block's YAML.
- **New:** `ep0ch library` lists the components, `--json` prints their schemas (what an editor's completion or an
  agent reads), `--out <dir>` writes a Markdown page each, the variations drawn above their source; attached to a
  published note, the publisher serves one as HTML.
- **For extensions:** `extension.json` takes `components[]`, component schemas: the extension's properties get a
  library page and completion with no code. A schema it can't use fails the load and names the field.
- **What to run:** protocol is now 106 (two new reads, `components.schemas` and `rules.preview`): update the host and
  every client together (`ep0ch install --apply` on each machine). No schema change.

### What waits on you: program status in terminal tiles (OSC 7501, PIE-614, #270)

- **Programs say what they're doing.** A program in a door's terminal tile can report its status with OSC 7501 (Mitchell
  Hashimoto's Program Status Protocol): working (with progress), blocked on you (a permission, a question, a login),
  done, failed. The tile's header and tab show a calm glyph, the drawer's chip says it (`▲ claude · needs you`), and the
  status bar counts what waits (`◆1 ✓2 on you`).
- **The waiting-on-you list.** `alt+w`, or a click on that count, opens it in your drawer on any screen: every
  terminal's blocked, failed and unseen done work; `⏎` or a click goes there, `x` marks it seen. Being back in a tile
  clears its done.
- **Who reports.** Claude Code through the mod (working, a permission dialog, a question, done with its answer's first
  line, errors); `ep0ch install --apply`; `ep0ch backup run`; `scripts/box-test`; `scripts/agent-env --test`; Tree and
  Detail while they wait for the outline host. Each reports only to a terminal that speaks the protocol (`Pst` in
  terminfo, which the door gives its tiles, or the `?` query).
- **The door reports its own.** In Ghostty or Rex (any terminal answering the query) the door says what waits inside
  it: the most urgent across its tiles, each tile a child record. `EP0CH_PROGRAM_STATUS=0` turns that off.
- **`ep0ch backup run` shows what it's doing.** At a terminal, each step spins with its time and ends ✓ the way `ep0ch
  install` does (checking the outlines, which changed, "garden: snapshotting (VACUUM INTO)", "uploading to restic",
  mirrors, the drill); under the timer, the same plain lines as before.
- **Agents:** `peek` gives each terminal's `status` records; `status.list` reads the list; `host.waiting`. Marking
  something seen is the person's: an agent never clears a done they haven't seen.
- **Run:** nothing beyond the usual `ep0ch install --apply`; a Claude started before the mod changed reports once
  restarted (`alt+R` in the drawer).
### Scroll past the end (PIE-622, #269)

- **A note's last line no longer hugs the bottom edge.** In every reader (detail, preview, the desk's, a river column,
  the BBS reader) the wheel, `j`, space and PgDn go on past the last line until it sits at the middle, blank under it.
- **End (or `G`) goes to the last line, then past it.** The first press puts it on the bottom edge; the second brings it
  to the middle. `scroll to=end` does the same for an agent, and `view.get` says `atEnd` and `past`.
- **Drafts keep room round the cursor.** Typing on the last line keeps about three blank rows under it, and the wheel
  scrolls a draft past its end as a reader does.
- **`ep0ch act reader.overscroll rows=none`** stops at the last line as before; `rows=half` is the default, a number of
  rows scrolls that far. Kept for the next start, as the theme is. Shown in the kitchen sink's `scroll` section.

### A schema change is one `ep0ch install --apply` (PIE-617, #265)

- **Install migrates the outlines itself.** When the code it updates to opens a newer schema, the plan says so
  before anything moves ("schema 2 → 3: will migrate 2 outlines (pie, pie-hole) with 0003-drop-agent-tables.ts"),
  and `--apply` backs up, fast-forwards, stops the host, runs the step's script on each outline behind, starts the
  host and hands the door sessions over. No more stopping the host and running a script per outline by hand.
- **It refuses before updating** when an outline can't take the step (older than it, or its script already
  deleted) or the host can't be stopped (outside its unit): the checkout stays where it was, and the plan says the
  commands (for an old outline, moving it aside and `ep0ch outline import`).
- **When a migration fails** it stops there: the message names the outline, its exact copy from just before and
  the way back, and the host is left stopped rather than serving only some outlines. Fix it and run `ep0ch install --apply`
  again; it migrates what's left and starts the host.
- **`ep0ch doctor`** flags an outline whose schema is behind the checkout's code, with install as the fix.
- **The refusal says what to paste.** An outline at an older schema is refused with one sentence and then the
  exact commands for this machine, each on its own line: `ep0ch install --apply`, or by hand the host's stop
  command, the migration for every outline here at that version (real paths) and the start command; with no
  script for the step, the import route. The door, `ep0ch` commands and the MCP gateway pass it on as it is.
- **What to run:** nothing new. The next schema change is one `ep0ch install --apply` on each machine.

### Heading styles as you write them: one heading's own fields, and a style declared on any line (PIE-599, #266)

- **One heading, its own look.** `## Odd jobs [heading::dots] [heading-tone::amber]` takes amber for itself; any
  `heading-*` field on a heading or `---` restyles it alone (over its level's default, else the base style), and
  leaves the drawn heading. Any other property on a banded heading draws as a chip after it, whole.
- **Declare a style on any line.** `# Plot style [heading-style::plot] [heading-pattern::dots] [heading-rows::2]`,
  anywhere in any note, declares `plot` with that line's fields (a note's own properties still do). The door draws
  the line as what it declares, a chip summary and a small band; raw and the editor show the tokens.
- **Run:** PROTOCOL 105: restart the outline host and every door after `ep0ch install --apply`, on both machines.

### MCP gateway fixes from the first claude.ai run (PIE-620, #268)

- **`list_outlines` lists pie.** It reads this machine's outlines from the outlines folder instead of asking the host,
  which once left every live outline out; one the host can't open is listed as `unreachable`.
- **Links and backlinks agree.** A property naming a block's id (`[source-block::<id>]`) is now a `property` link in a
  record (`ep0ch find --json`, `ep0ch export --format json`, MCP), as backlinks already counted it, so a note's
  backlinks are never missing from its source's links. A Markdown export keeps such a property as written.
- **Refs as the Claude mod takes them.** `outline_read`, `outline_links` and the write tools take a Work ID,
  `[[page]]`, `((id))` or an id, on a live outline or a mirror.
- **Rough edges.** A `limit` of 0 (or past the maximum) is refused, naming both; `outline_links` cuts and counts
  each group; a `uri` with a conflicting `outline` is refused; searches say lexical or semantic and why
  (`semantic: true` asks); a top-level path is `(root)`; a mirror says which copy it serves (`copy`) and serves the
  newer of the follower's and the backup job's; `list_outlines` and `ep0ch mcp access` say to reconnect claude.ai's
  connector after an access change; a laptop that hasn't pulled its queued writes is said in `list_outlines` and doctor.
- **Run:** PROTOCOL 104: `ep0ch install --apply` on float-2 and the laptop, then restart the outline host, the MCP
  gateway (`ep0ch-mcp.service`) and every door.

### Write from claude.ai: remote MCP writes, and a queue for the laptop's outlines (PIE-615, #264)

- **Write tools on mcp.ep0ch.sh.** `outline_create`, `outline_patch`, `outline_comment` and `outline_set_property`,
  for an outline whose access is `propose` (a patch or property is a proposal under the note, a new block a comment on
  its parent) or `full` (applied against the revision read; a note changed since, or open in your draft, gets a
  proposal instead). `ep0ch mcp access full --ws pie` is yours to run; `read` stays read-only.
- **Said and attributed.** Each write is an agent's, `mcp:claude.ai`, with your Clerk subject; the door says it on
  the status line as it lands, and the gateway's log has a line for each.
- **Netmail for float-hub.** A write to an outline read from a mirror (float-hub@laptop) waits on float-2 in
  `~/outline-mirrors/.netmail.sqlite`, and the laptop's backup job pulls it over ssh and applies it (or
  `ep0ch mcp pull`). A note that changed meanwhile gets a proposal, never an overwrite. `ep0ch mcp queue status`,
  `ep0ch backup status`, doctor and `list_outlines` show what waits; a queue a day old while the laptop was online is
  an alert.
- **Claude mod:** `outline_set_property` (one header chip, as a patch), beside `outline_patch`.
- **Run:** PROTOCOL 103: restart the outline host, the MCP gateway (`ep0ch-mcp.service`) and every door after
  `ep0ch install --apply`, on both machines. On the laptop, install adds `EP0CH_MCP_HUB=float-2` to
  `~/.config/ep0ch/backup.env` (an empty `EP0CH_MCP_HUB=` line there turns the pull off).

### The Inbox agent and note assistance are gone (PIE-613, #259)

- **Removed:** the Inbox agent (Tree's `Shift+I` panel, its results, Pause, Undo, Reconsider and Inbox history
  search), note assistance (automatic types, tags and answers, and **Assist this note**), and edit recovery's
  **Ask agent** merge. Edit recovery itself stays: the mechanical merge, the versions, Edit draft, Save separate,
  Discard and Restore. The Inbox note, Quick Capture and where new notes go are unchanged; file what lands in
  the Inbox yourself or ask an agent to.
- **Your original writing stays.** What the agent rewrote is still kept, read only: a cleaned note's **Original
  capture** and **Before this rewrite** links still open the exact text it started from, and comments on those
  originals still work. Note assistance's originals are kept too, not yet shown anywhere (PIE-345).
- **Gone with them:** `OUTLINER_INBOX_AGENT`, `OUTLINER_NOTE_ASSISTANCE` and `OUTLINER_INBOX_TIMEOUT_MS`, the
  `inbox.*`, `edit-recovery.assist` and `edit-recovery.cancel` actions, the `inbox` event, the prompt files
  `inbox-editor.md`, `inbox-relationships.json`, `inbox-routing.json`, `note-assistance.json`, `note-answer.md`
  and `edit-merge.md` (`goto-ranking.json` stays; old copies in an outline's `prompts/` are left alone and unused),
  and the outline folder's `assistant-sessions/`, no longer written.
- **What to run:** protocol is now 102 and the schema version 3, so the host and every client move together, and
  the new host refuses an outline still at version 2 until it is migrated. On each machine, from its checkout:

  ```sh
  # float-2: pie and pie-hole
  cd ~/projects/ep0ch && ep0ch install --apply        # backs up the outlines and moves the code
  systemctl --user stop outliner-host.service
  for o in pie pie-hole; do bun packages/outliner/scripts/migrations/0003-drop-agent-tables.ts ~/outlines/$o.sqlite; done
  systemctl --user start outliner-host.service

  # the MacBook: float-hub, sysops-log, bbs, boops, float-bbs-test, techno-breakout
  cd ~/projects/ep0ch && ep0ch install --apply
  launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host
  for o in float-hub sysops-log bbs boops float-bbs-test techno-breakout; do
    bun packages/outliner/scripts/migrations/0003-drop-agent-tables.ts ~/outlines/$o.sqlite
  done
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.ep0ch.outliner-host.plist
  ```

  In one transaction it drops the four agent state tables (`inbox_agent_settings`, `inbox_agent_instructions`,
  `inbox_retry_triggers`, `note_assistance_state`), keeps `inbox_agent_results` and `note_assistance_results` as
  they are, and stamps version 3, or changes nothing and says why. It refuses a file a host is serving. The
  `OUTLINER_INBOX_AGENT=0` and `OUTLINER_NOTE_ASSISTANCE=0` lines in the host's unit are now unused and harmless.

### Rules: when a block matches, draw this or run this (PIE-600, #251)

- **A rule note, no code.** Write a note like `Committee headings [rule-name::committee-bands] [rule-kind::heading:2]
  [rule-decorate::band] [rule-pattern::stack]` and every `##` heading (under `rule-under::((id))`, if you scope it)
  is drawn as a band of glyph tracks in its place, still a heading you fold and `( )` to. Match by a query
  (`[rule-match::type=meeting]`), a text pattern (`[rule-text::…]`, never in code) or a kind (heading, callout,
  list, rule, image); draw a band, a divider, a card of the block's properties, a badge, words, or a box around it.
- **Rules in extensions.** `rules[]` in `extension.json`: `match`, then `decorate` (the extension draws the view)
  and `on` (run an action when a block starts or stops matching, or changes while it matches; a quiet wait, no
  loops on an extension's own writes). Three examples to fork: `outliner ext add meeting-card` (a card over every
  meeting), `done-stamp` (`[done-at::]` when status becomes done) and `shout` (a line ending `!!!` as a band).
- **Your text never changes.** `R` in a reader shows the note as written, and back. Detail shows each decoration as
  text under what it matched; the publisher puts it in the page (a band is its heading).
- **Agents:** `peek` lists a reader's `decorations`; `extensions.list` lists every rule, what it matches, how many
  blocks match a trigger and its last run.
- **Run:** PROTOCOL 101: restart the outline host and update every door (`ep0ch install --apply`).

### Litestream and an outline's file (PIE-607, #254)

- **Deleting, re-creating or importing an outline pauses Litestream for it.** Litestream doesn't track a database
  being removed or replaced, so the outline host now stops this machine's replicator for that folder while the
  file changes, keeps Litestream's own state, and starts it again; if it can't stop it, the change is refused with the
  commands to do it by hand. Nothing resets Litestream behind your back.
- **Doctor reads the mirror followers by their instances** (`litestream-mirror@float-hub`), says when a follower
  doesn't restore fresh on start (Litestream 0.5.17's crash loop, upstream #1385) or when the replicator keeps only a
  day of snapshots, and treats a follower that healed itself by restarting as healed.
- **A machine with no backups yet** (the laptop, before its install) is said in doctor, not raised as an alert.
- **Install asks for the machine's name** (`EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply`) instead of taking the
  host name: other machines mirror it by that name. A laptop already set up under its host name: set
  `EP0CH_BACKUP_MACHINE=laptop` in its `~/.config/ep0ch/backup.env`, then `ep0ch backup run`.
- **A dead-man's ping:** with a secrets group `heartbeat` (HEARTBEAT_URL, e.g. a healthchecks.io check), every
  clean backup run pings it, so a job that stops is noticed off the machine too.

### Heading styles and rules that fade (PIE-599, #248)

- **Headings that divide the page.** `## Your calls [heading::band]` draws the heading inside a band made of the
  figures' glyphs. Built-ins: `band` (centred, spaced capitals), `tab` (left, on the top row), `waffle`, `uptime`,
  `dots` and `rule`.
- **Rules that fade.** `--- [rule::fade]` draws a full-width track that fades in from both edges.
- **Still Markdown.** The line is a plain heading or rule to everything else: folds, `( )` stops, sections and
  `^anchors`, Detail, the publisher and export. Under 48 columns (the figures' width rule) the door draws it as written.
- **Your outline's own styles,** declared the way callout types are: a note with `[heading-style::plot]` and
  `[heading-pattern::dots]`, `-rows`, `-align`, `-row`, `-padding`, `-margin`, `-tone`, `-letters`.
  `[heading-default::1]` (or `rule`) styles every `#` (or every `---`) with no property. A change to the note
  restyles every heading that uses it, with no door change.
- **Calm by design.** The band is dim and never a full block. The heading carries the colour, in every theme.
- **The kitchen sink's `headings` section** shows every built-in on one note, banded in a wide reader and as
  written in a narrow one beside it.
- **Run:** PROTOCOL is now 100 (a new read, `headings.styles`). Every client and the outline host must be on this
  code together, so run `ep0ch install --apply` on each machine (it restarts the host).
### Backups you can stop thinking about (PIE-607, #252)

- **Every 15 minutes, each outline that changed goes to restic.** `ep0ch install --apply` sets up the job on Linux
  (a systemd timer) and macOS (a launchd agent): a consistent, integrity-checked copy of each outline whose change
  feed moved, into this machine's restic repository in the `ep0ch` bucket (`restic/<machine>`). An unchanged outline
  isn't snapshotted, and every run stands alone, so a VPN that drops Hetzner for hours or an offline night leaves
  nothing to repair. Kept: every snapshot of the last 48 hours, and the newest of each of the last 72 hours, 30 days and 12 weeks that have one.
- **Mirrors from the newest snapshot.** float-2's read-only copies of the laptop's outlines (what the MCP gateway
  serves) are refreshed from the laptop's newest snapshot by an atomic rename, and straight from the laptop with
  `sqlite3_rsync` when it answers; the newer copy wins.
- **A stale backup is on your status bar.** Changes waiting more than 2 hours for a backup show `✗ backup` on the
  door's status bar until they clear; a click says which outline, since when and the exact command that fixes it.
  It's announced once in Herdr (and on your phone, with a secrets group `ntfy`), and `ep0ch doctor` lists every
  outline's newest snapshot.
- **`ep0ch backup restore <outline> [--machine laptop] [--at 3h] --to <path>`** writes an integrity-checked copy of
  any snapshot; `ep0ch backup list` and `status` show what there is. A restore drill runs every month by itself.
- **What to run:** on the laptop, `EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply` (its plan names restic and the
  `restic` secrets group if they're missing). Litestream stays for float-2's own outlines; the laptop's Litestream
  and float-2's followers retire after three clean days (scripts/backup/README.md has the commands).

### New notes float, as many as you like (PIE-591, #240)

- **`ctrl+n` never takes over the note you're in.** On the desk (and every screen built on it) a new note floats
  over the screen with your keys, a draft of its own. Press it again for another, and again: each is cascaded a
  little lower and to the right, nothing waits on the last, and none is ever refused for "a reader didn't take it".
- **From an edit too.** `ctrl+n` while you write saves what you typed (as a click away does) and floats the next.
- **Move it, dock it, close it.** Drag a float by its title; onto a tile's header it joins that tile's tabs, onto
  the screen's edge it becomes a column, onto a dock's handle it goes into the dock. Its `×` closes it: written,
  it's saved; still empty, it goes to the trash (as `Esc` on it does).
- **Never lost.** A float you leave with nothing typed stays open and empty where it is; one you typed in is saved
  as you leave it. Quitting keeps an open draft as unsent, as any draft.
- **Your way.** `ep0ch act note.opens opens=tab` (a tab on the tile you're in), `drawer` (your drawer) or `lands`
  (where the screen's opens land, as before); `float` is the default. `EP0CH_NEW_NOTE` overrides it for one door.
- **The board's lanes make cards.** `ctrl+n` on a lane opens the new-card composer in that lane (`card.new`, as `n`
  does), so the card is born with the lane's properties and lands in it. A screen spec says this with `newNote`.
- **Agents:** `note.new opens=float` (or `tab`) shows an agent's new note to you there, unfocused and attributed.

### Also merged, by theme (#239 to #280)

**Door**

- **Hero header (PIE-598, PIE-609, #242, #244, #253).** A note's hero image that scrolls under a reader's sticky header
  becomes the header's backdrop: muted, held dark, fading in over three steps (Kitty graphics, or one colour per cell).
  `reader.hero [on=…] [mode=first|follow]`: `follow` takes the last picture of the note that has gone under, the old one
  staying until the new is drawn so the header is never plain. `[hero-focus::x,y]` sets the crop. A picture on the line
  right under a title is drawn now, not read as metadata. River columns keep the sticky header. PROTOCOL 99.
- **`ctrl+e` in a draft is the end of the line (#241).** `ctrl+a` the start (a Mac's `cmd+←/→` send these). `$EDITOR`
  moved to `ctrl+x ctrl+e` (`edit.external`, `composer.external`, and the tile menu's "edit in $EDITOR"); a person's,
  never an agent's. In a reader `ctrl+e` still arms an edit.
- **Resizing tiles is smooth, and a program hears its size once (PIE-623, #271, #273, #274).** Nothing is scaled or
  uploaded during a drag, and a terminal tile's program is told its new size when the resize ends, not on every frame:
  Claude Code no longer wraps its output mid-word after a resize. `bun run bench:resize` (packages/door) is the guard
  (`--check`).
- **`ep0ch --screen <name>` always lands (#279).** Attaching to a running session says `opened <name> · attached to the
  running session` (or `already on <name>`); `ep0ch --showcase --screen <name>` opens that screen on the showcase outline;
  an unknown name is refused before anything starts, with the names and a command that works. The component library is on
  the main menu (`I`).
- **A change reaching a desk never entered no longer crashes the door (#262),** seen as `desk.ctx.board` undefined with
  the showcase open.

**Claude mod**

- **Mentions are only what resolves (PIE-603, #243).** A `((id))`, `[[page]]` or Work ID the outline can't resolve (chat
  identifiers like `S-87`) isn't kept; `gone` only for a block deleted since. `/mentions preview` and `scope` no longer
  open or move the panel; only `m`, `/mentions band|pane|off` do.
- **Files a session touches become `[file::]` blocks (PIE-602, #250).** After a successful `Edit` or `Write`, a block under
  `[[recent-files]]` › day › project › session (one per file per session, with touches and lines added and removed);
  a view per project under *By project*. The Edit and Write rows open the file, or its diff, in the door.
- **A Claude in a door follows its door through a handover or restart (PIE-604, #249).** Tiles get `EP0CH_PLACE`, the
  outline's session folder; `ep0ch act|peek|open|snap|where` and the mod's door tools find the door from it. `ep0ch where`
  says when the environment is stale and which door answers now.

**Install and ops**

- **`ep0ch install --apply` restarts the MCP gateway on new code (PIE-612, #255),** and `ep0ch doctor` flags one that
  runs older code than the checkout. It never restarts a gateway that runs another checkout.
- **A host that is up but slow to answer is restarted, not "started" and waited on (#256).** The probe asks three times
  before calling the host down.

**Tooling for agents and tests**

- **`scripts/agent-env <name> [--test] -- cmd` and `scripts/box-test` (PIE-597, #246, #247, #260, #280).** A scratch
  environment of your own (state, control socket, outlines, temp folder outside `$HOME`), and with `--test` a systemd
  scope with a CPU and memory cap. Every run has `oom_score_adj` 1000, so the kernel kills a test before the outline host.
  `scripts/box-test [--on float-box|boxd]` runs the suites off this machine (float-box when it answers, else a boxd box).
- **Tests run on a fresh machine (PIE-596, #245).** The door keeps the nine art pieces its menus draw in
  `test/fixtures/packs`; no packs is fine. `ep0ch doctor` shows an `art packs` line.
- **Tests named from the repository's root run the packages' preloads (#258).** A root `bunfig.toml` preloads
  `scripts/test-preload.ts`; before, a door test run from the root kept your `EP0CH_*` settings and real state folder.
- **Scratch dirs go where a session's sockets fit and no `.ep0ch` is above them (#267),** and an App a test file leaves
  running is retired when the next file runs (#261, PIE-595).
- **Follow-ups from review (#257, #263):** a click between `ctrl+x` and `ctrl+e` cancels the chord; `where` marks a door
  handed over only when it was reached through the outline's session; the agent-interface test passes under `agent-env`.

### Figures that compare, and figures that fit (PIE-575 to PIE-581)

- **Four kinds for comparisons.** `::graph-quadrant` places notes by two properties (`x:`, `y:`; `xs:`, `ys:` order
  the axes, `quadrants:` names the corners); `::graph-matrix` counts over two (`down:`, `across:`), toned by share
  with totals; `::graph-compare` aligns two or three columns by row label (`- cost: £60 | £12`); `::graph-flow` shows
  where things came from and went (`- a → b: 7`, or `from:` and `to:`). Each takes Markdown rows or a live
  `query:`/`view:`. The kitchen sink's figures note has one of each.
- **A meter with a limit.** `limit:` and `unit:` on `::graph-meter` draw each value against a budget, the limit as a
  mark, the headroom or overrun said beneath (`- with the barrel: 181` against `limit: 150` reads "31 ms over").
- **Every figure fits its width.** One rule (narrow under 48 columns, cozy under 90, wide): a narrow table keeps its
  title column and one more and says `+n columns`; stat tiles wrap into rows; a timeline's or decision's side note
  goes under its row; `compare` stacks; `matrix` cuts its heads; `quadrant` draws dots with a legend. Nothing a
  figure draws is wider than its frame at any width.
- **A figure can be linked to.** An anchor alone on the line after a figure's closing `::` names it:
  `((id^quadrant|the quadrant))` lands on the figure, and `!((id^quadrant))` embeds just that block.

Since October 2, 2026: pull requests #136 to #197, the outliner's #280 to #282 (in pi-herdr-outliner), and the
move into one repository (PIE-530).

### Update: what to run

- **One checkout.** ep0ch-door and pi-herdr-outliner are now one repository, `ep0ch`
  (`git@github.com:float-ritual-stack/ep0ch.git`). Clone it, run `bun install` at its root, and link `ep0ch` to
  `packages/door/src/main.ts`. Point Herdr's plugin at the same checkout: `herdr plugin link packages/outliner
  --enabled`.
- **Then `ep0ch doctor`, then `ep0ch install --apply`.** Doctor says what is behind and the command for each. The
  install backs up every `~/outlines/*.sqlite` to `~/backups/ep0ch/<time>/`, fast-forwards the checkout, links
  `ep0ch` and restarts the outline host. A host unit from before PIE-530 (another checkout's `host-main.ts`,
  `OUTLINER_STATE_DIR`, `OUTLINER_DEFAULT_OUTLINE`) is shown the exact change to make; the install never edits it.
- **Outlines live in `~/outlines`.** Each is `<name>.sqlite` (`EP0CH_OUTLINES` moves the folder). To bring an older
  database over, make a new outline from it: `ep0ch outline import <old.sqlite> <name>` (or `outliner import`). The
  old file is only read.
- **A database made before schema versions** is refused at open, with the command that stamps it. Back it up, stop
  the host, then run `bun packages/outliner/scripts/migrations/0001-stamp.ts ~/outlines/<name>.sqlite` once. It
  stamps only a database whose shape matches a fresh one.
- **Restart the host, then the doors.** The host and every client speak the protocol this checkout speaks
  (PIE-538 added `callouts.types`, PIE-544 `notes.create` and the page-title rule; `delete` takes
  `expectedRevision` and `ifEmpty`; a sort may name a property; a view's hand-set order takes `first` and records
  who placed it; a component block is one token in a note's sections, and its code fence closes only on its own
  fence; addressable-resource MCP reads use the persisted per-outline local MCP access setting). `ep0ch doctor`
  prints that protocol and the one the running host speaks. A client refuses a host on any other number, saying
  which side to update. `ep0ch install --apply` restarts the host. Restart doors and Claude sessions that should
  run the new code.
- **Delete `~/.config/pi-herdr-outliner/document-renderers.json`** if you have one. Nothing reads it now.
- **Your shell's dock settings (float-2's `~/.bashrc`).** Delete `EP0CH_HERDR_AGENT_CMD` (nothing reads it) and
  `EP0CH_DAILY_AGENT` (it overrides the dock's choice in every door), and choose in the dock instead (`alt+g`, "claude
  · in Herdr"). Drop `EP0CH_DAILY_CWD` to let each outline's dock start in its project or outline folder.
  `~/.local/bin/door-claude` isn't used any more. An old `door-claude` Herdr pane stays until you close it.
- **The dock's program and folder.** With `EP0CH_DAILY_AGENT` unset the dock now runs a shell. If you set
  `EP0CH_DAILY_CWD` to pin its Claude to a folder, drop it to let the dock follow the outline (the project's `.ep0ch`
  folder, else the outline's own); `ep0ch doctor` shows the result. An existing Herdr `door-claude` pane keeps the
  folder it was made in until it's made again (`/exit` in it, then `alt+a`).
- **Agent skills.** `ep0ch doctor` checks the links in `~/.claude/skills/` (and `~/.agents/skills/` when it exists)
  for the stack's skills, and `ep0ch install --apply` makes them, or replaces a link into an old `ep0ch-door`
  checkout or a deleted worktree. It never touches a real folder or another skill's link. If you ran an earlier
  install that linked television's channels, rename `ext-links.json` to `install-links.json` in the door's state
  folder (`$XDG_STATE_HOME/ep0ch-door`, or `EP0CH_STATE`).
- **Television (optional).** With `tv` on your PATH, `ep0ch install --apply` links the outline's channels into
  television's cable folder.
- **Welcome numbers become an order** (once per outline with numbered welcome notes; pie and float-hub):
  `bun packages/door/scripts/welcome-order.ts --ws <outline>` prints the order it would set; `--apply` makes the
  Welcome view if there's none, sets its order from the numbers and rewrites the values to `true`.
- **Layouts you saved by name** (`^W w`, kept in the door's `layouts.json`) are screen notes in the outline now, and
  the door no longer reads `layouts.json`. Bring them across once per outline that should have them:
  `bun packages/door/scripts/import-layouts.ts --ws <outline>` says what it would write, `--apply` writes it; then
  delete `layouts.json` (its path is printed).
- **The dock is now your drawer, and a screen's drawer is now a dock** (once per machine, doors stopped first: end
  sessions with `ep0ch session end --all --yes`). `bun packages/door/scripts/migrations/drawer-words.ts --ws <outline>`
  says what it would change; `--write` changes it: `dock.json`, `dock-tiles.json` and `dock-agent.json` in the state
  dir become `drawer.json`, `drawer-tiles.json` and `drawer-agent.json`, saved layouts (and, with `--ws`, that
  outline's screen notes, through its host) say `dock` where they said `drawer`, and the drawer's own tile is
  `drawer.agent`. The door keeps no reader for the old words; the
  script is deleted once it has run on the machines that matter (pie on float-2, float-hub on the MacBook).

### `e` asks before it edits; the tile with your keys stands out (#239)

- **`e` arms an edit instead of opening it.** In a reader (the desk's, the board's preview, a river column, the BBS
  reader) the status bar asks `edit <title>? ⏎ · any other key cancels` and the tile turns yellow (`✎ edit?`) for
  2 seconds. `⏎` or `e` again opens it; any other key lets it go and does what it does. `Ctrl+E` arms the same way.
  The tile menu's edit row, a click on the hint's `e` and an agent's `edit` open at once.
- **Turn it off:** `ep0ch act edit.arm.set on=false` (kept for the next start; `on=true ms=<n>` sets the wait).
  `EP0CH_EDIT_ARM` (`off`, or milliseconds) overrides it.
- **Focus and edges.** The tile with your keys has a double frame (`╔═╗`) and title in a warm amber. Every other
  frame is a mid-tone that shows where one tile ends and the next begins in calm, classic and night, never dimmed
  toward black. A terminal tile you're typing in stays yellow.

### Your drawer, and docks: the words swapped

What travels with you across screens (the status bar's `▲ claude` chip, `alt+a`, the agent in its first tab) is
**your drawer**; a screen's sliding edge container (the board's outline and backlinks) is a **dock**, and putting a tile
in one is docking it to an edge. The actions follow the words, with no old names kept:

- `host.dock` is `tile.drawer`: `on=true` puts a tile in your drawer, `on=false` takes it out. `^W a` still does it
  ("put in your drawer", "take out").
- `tile.pin` is `tile.dock`, the right way round now: `on=true` docks the tile to an edge, `on=false` undocks it
  back into the layout. Its answer says `docked`. `^W p`, the board's `T` and `B` are unchanged; a header's
  `⇤ docked` label undocks on a click.
- `tile.drawer` (slide a screen's drawer open or shut) is `tile.slide`. `^W d` is unchanged.
- `ep0ch where --json` says `tile.drawer`, and the drawer's own tile is `drawer.agent` (`EP0CH_TILE_ID`, the
  `EP0CH_NEST` layer `drawer/drawer.agent`).

And what changed with them:

- **Leaving a screen with a terminal running** puts the terminal in your drawer instead of refusing: `shell went into
  your drawer · alt+a shows it`. An unsaved edit still asks.
- **The drawer's own first tab can leave.** `^W a` on it, or a drag out, puts it on the screen as an ordinary terminal
  tile, still running; the drawer starts a fresh own program the next time you pull it up.
- **Drags say where a tile goes:** over the chip or the open drawer, `into your drawer: travels with you`; over a
  dock's handle, `docked here: stays on this screen`.
- **`^W P`** (the policy panel) works in your drawer.
- **A preview keeps following** the tile it follows (`source=tile:tree`) when that tile goes into your drawer and back.
- **Refusals say what and why in plain words,** with what to do instead, and no internal names.

### Welcome: `[welcome::true]` marks a note, the order is set by hand

Any `[welcome::…]` value now only marks a welcome note; a number is no longer its place. The order is the Welcome
view's hand-set order (a saved view `[query::welcome]`, the same order a board lane keeps): `alt+↑` `alt+↓` or a drag in
Welcome's list, `ep0ch view order`, or a lane on that view. The first move makes the view. Two notes can no longer share
a place, so nothing shifts silently.

### Make your own screens: start blank, save it to the outline (PIE-565)

`M` on the main menu (or `ep0ch --screen blank`) opens a blank screen: one tile whose rows start it with the outline, a
reader, a detail, a terminal or a query lane (you pick the view), or open a screen. Build the rest with the desk's keys,
then `^W w` saves it as a **screen note** in the outline (`[type::screen]`, its layout as data). Every door on the
outline opens it by name (`ep0ch --screen <name>`, the blank tile's `o`, `^W r`), saving again writes over the same note
with a revision check, and `screen.delete` or trashing the note takes it away. Leaving a screen you built without saving
asks first. Agents do the same with `blank.fill`, `screen.save`, `screen.open` and `screen.delete`.

Found by building a screen from blank: an empty tile now says what it's for ("links you follow in detail land here",
or how to send opens there); `^W v` on a tile whose opens already land somewhere says so and how to unlink it, instead of
seeming to do nothing; the outline's `⏎` with no reader to show the note says so; `^W o q` with no view open picks one;
a detail whose note isn't in the outline, and a preview whose tile is gone, say so; the `⋯` menu saves and loads screens.

### Read an outline from claude.ai: the remote MCP gateway

`ep0ch mcp serve --http` serves `ep0ch mcp`'s read-only tools (`outline_read`, `outline_find`, `outline_links`) and
`ep0ch://` resources over streamable HTTP, for claude.ai and other remote MCP clients. Clerk signs you in (GitHub);
the gateway accepts only a Clerk JWT access token for its own URL whose subject you've listed in
`EP0CH_MCP_ALLOWED_SUBJECTS` (unset, it refuses everyone and logs who asked). It reads the outlines on its own
machine, each only when `ep0ch mcp access read --ws <name>` has granted it, and refuses another machine's. The tools
take an `outline` name now, for a ref or a search; a URI names its own. The door README's "Remote MCP gateway" has
the unit, the Caddy block and the Clerk settings. `ep0ch mcp access` now says the grant covers both servers, and
`initialize` answers a client's own MCP protocol version when it is one the server speaks (else the newest).

### Unsent drafts: fewer, and easier to decide about

An edit opened by mistake no longer leaves an `■ unsent` line. `e`, then a `j` or `q` meant for the reader, became
text; now an edit open under ten seconds with at most three characters typed into it (nothing taken out) closes on
the first `Esc`, says `dropped 2 stray characters · ctrl+z brings them back`, and `ctrl+z` within a minute opens it
again with them. Its copy still goes to `drafts/`. A real edit keeps the `Esc` twice.

Each `■ unsent` line has controls (a click, `[ ]` then `⏎`, the tile's `⋯` menu, `act unsent.*`): `[diff]` shows the
note as it is now against the unsent edit in a reader beside it, coloured, with the revision it was written on;
`[open copy]` shows it as written; `[dismiss]` lets it go (the copy stays on disk); `[take it back]` opens the edit
with the unsent changes in it, replayed change by change against the note now, so a passage that changed since is
left as it is and said. An old one on an older revision (over three days) folds into `■ 1 old unsent edit · [show]`.
An edit put aside before this change can be diffed, copied and dismissed; taking one back that was written on an
older revision needs the text it started from, which only newer ones keep.

### Esc closes what popped up, and never leaves the screen

`Esc` closes the innermost temporary thing, one per press: a picker or the tile menu, the keys box
(`? more`), a `^W` chord, link mode (`alt+l`), a filter, a drawer or the dock, a zoom, a float's keys (back to the tile
under it), an edit with nothing typed (unsaved text still asks for a second `Esc`), a selection. With nothing left it
does nothing and says `nothing to close · q leaves`. It never goes back to the menu, and never quits a door whose only
screen it was (the home base, `--screen`). Leaving a screen is `q` on every one; quitting is `G` or `ctrl+c`, as
before. `Esc` on the board's picker with no board shown yet leaves an empty board (`g` picks one, `q` leaves). The
showcase's `esc` section opens three nested things to close.

### A menu on every tile (PIE-492)

Every tile has a `⋯` in its top right corner, left of its `×`: a click opens the tile's menu, and so does a
right-click anywhere in the tile, or `^W .`. It lists what you can do there, grouped: the tile itself (close, zoom,
float, put in a drawer, fold to a spine, dock, preview beside or below), then what its kind adds (a note's edit,
comment, links, properties, back and forward; a terminal's type in it or run it again; a board lane's steps,
collapse, reload). Each row shows its key as a keycap; one click, `⏎` or that key runs it. A row that can't run
now is dimmed and says why. A terminal whose program asked for the mouse keeps its right-clicks: use its `⋯`.
Agents get the same rows from `act tile.menu tile=<tile>`, without anything drawn on your screen.

### Close a tile with a click

Every tile that can close has a `×` in its top right corner: a click closes it (`tile.close`, as `^W x`) without
moving your keys there first. A tile with a running program asks twice, as `^W x` does.

### Fixed: ctrl+n replaced the note you were reading

A new note made with `ctrl+n` in a detail opens in a detail beside it (as `O` opens one), on the board in a new
detail in its reading row, and in a river in a new column: the note you were reading stays. An empty detail
(`^W o d`) offers `+ New note · ctrl+n`, and a new note made there is written in it.

### `--screen <name> [<target>]` opens any screen; the old landing flags are gone

- **One landing flag.** `ep0ch --screen <name> [<target>]` opens the door on any screen by name: a menu item (board,
  desk, river, brief, welcome, waiting, who…), or any registered screen (`ep0ch act screen.list` names them), on its
  target where it takes one: `--screen board <hub-id>`, `--screen detail <id | ((ref)) | ep0ch://…>`. It goes through
  `screen.open`, the action a menu letter and an agent's `act` run, and a session you attach to with it opens it too.
  A screen registered later is a valid name with no code change.
- **Removed:** `--board [<hub>]`, `--desk`, `--river`, `--brief` and `--welcome`. Each is refused with its
  replacement (`ep0ch --board hub-1` says `ep0ch --screen board hub-1`). Update any alias or script that used them.
- **`EP0CH_LANDING`** takes any screen name now (`brief` and `welcome` as before), opened after the logon through
  the same action.
- An unknown name is refused before the door starts, with the names there are.

### Fixed: addressable resources, after review (#201–#206, #211, #212)

- **An outline's instance id changes exactly when its database is replaced.** It is the `outline_instance_id` in
  the database, so a reboot or a new inode no longer change it. A backup restored over the file (a `cp`, sqlite's
  `.restore`, a Litestream restore), a copy opened at another path, or an open after a crash gets a new one: each
  open leaves `<name>.sqlite.instance.json` beside the outline, and a database the last clean close didn't describe
  gets a fresh id. Each outline gets a new id once, at its first open on this version; caches keyed on the old one
  are dropped.
- **`ep0ch --screen detail <uri>`** keeps a host named by `EP0CH_SOCKET` and never makes an outline: one nobody has
  is refused with the commands.
- **`ep0ch mcp`** refuses another outline's URI given as `ref` (it read the block of the same id in its own outline).
- **An imported outline starts with MCP access `none`**: the old outline's grant isn't carried.
- **`ep0ch open`** takes `((id|label))` and `((id^anchor))`, and a URI's `#anchor`: the reader scrolls to it.
- **`ep0ch find --tree --lines`**: the URI is the last column again (`id title path depth glyphs about uri`).
- A version 2 database missing its instance id is refused with the exact command that repairs it
  (`bun packages/outliner/scripts/migrations/0002-outline-instance-id.ts <database>`).

### Fixed: addressable-resource MCP reads require an outline MCP grant

`ep0ch mcp` now refuses `outline_read`, `outline_find`, `outline_links` and
`resources/read` unless the bound outline has an explicit persisted local MCP
grant. Configure it with `ep0ch mcp access read --ws <outline>`; `none` revokes
it. The setting is service-owned, per outline and independent of `[publish::…]`:
published blocks do not bypass `none`, and a granted local reader can read
private outline content. The server remains read-only even if the stored level
is `propose` or `full`. `resources/read` returns the required envelope:
canonical URI, outline instance id, revision, reachability and block record,
beside the Markdown content. `ep0ch open <ep0ch://…> --json` reports the
receiving door session and any attached generic client host pane.

### Fixed: published pages read as HTML linked to raw Markdown

On a page read as HTML (`?view=html`), a link to another published note now opens that note's HTML too, as the
index does. Published text leaves out line anchors (`^see`) outside code. The pages are dark only, and a ticked
step shows ticked on a phone (a disabled checkbox in iOS's dark mode hid its tick).

### Fixed: a door session with no terminal attached used CPU drawing frames nobody saw

A terminal tile whose program keeps writing (a Claude session, a log tail) made the session draw a whole frame for each
write, up to 60 a second, with nobody attached: about 30% of a core on float-2. A session nobody watches now draws
nothing until a terminal attaches or `peek`, `snap` or an `act` reads the screen. Run `ep0ch session upgrade` to hand
a running session to the new code.

### Fixed: two outlines whose names read alike shared one Herdr agent pane

A session's Herdr pane label was its outline's name lowered and dashed, so `Kitchen Remodel` and `kitchen-remodel`
(or `Front_End` and `Front.End`) got the same pane: one session could attach to, type into or close the other's
agent. The label now ends in a short hash of the exact `outline@machine` (`door-kitchen-remodel-1a2b3c4d`), and
the launcher writes down the pane's Herdr id when it finds or makes it, then attaches, types and closes by that id.
An agent pane from before keeps its old label: the next start makes a new one, and the old pane can be closed in
Herdr by hand.

### Fixed: images held more memory than their budget after a resize

While a resized image's new scale was being made, the one drawn meanwhile wasn't counted as just drawn, and the
in-memory image cache stopped evicting at it: it could stay over its 96 MB. Every draw now counts, and an image on
screen is passed over rather than ending the eviction.

### Fixed: refusals arrived in escape codes when another program read them

Claude Code's shells set `FORCE_COLOR`, and Bun then paints every `console.error` red, even into a pipe. So
the Claude mod's cards and tools, and `door-open`, got `ep0ch` and `outliner` refusals (and crashes) wrapped in
colour codes, and their `ep0ch: ` or `error: ` went unrecognised. `ep0ch`, `outliner` and the Herdr opener now
write plain text to a stderr that isn't a terminal, a long refusal arrives whole, and a terminal keeps its colour. The root `bun run test` also runs the Claude mod's
own tests (`claude plugin test`, so `claude` must be on PATH), and a door test runs the real `ep0ch help`,
`where --json`, `show --cells`, `export`, `peek` and `act` through the mod's readers, so a CLI change that breaks
the mod fails at the root.

### No outline made silently on another machine; a typo'd command says so (PIE-545, PIE-547)

- **A name nobody has yet is made only on this machine.** `ep0ch --machine float-2 --ws fern` used to make an empty
  `fern` there. Now, on another machine (`--machine`, `EP0CH_MACHINE`, a `.ep0ch`'s `machine`, `--remote`), the home
  base offers the choices: open the one on this machine (when there is one), `+ create fern on float-2`, or cancel.
  The cursor starts on cancel or the local one, so ⏎ alone never makes anything. Without a terminal it's a refusal
  with the commands: `ep0ch --here --ws fern`, `ep0ch --machine float-2 --ws fern --create`,
  `ep0ch outline list --all`. Tree and Detail's opener and `outliner init` follow the same rule.
- **`--create`** (on the door, `outline attach` and `init`) makes it there on purpose, as do `ep0ch outline create`
  and the home base's "new outline on <machine>". **`--here`** means this machine over `EP0CH_MACHINE` and a
  `.ep0ch`'s machine. A local `--ws <new name>` still makes the outline, as before.
- **A typo'd command says so**, and no longer opens the door: `ep0ch sessionss` exits 2 with
  `ep0ch: no command "sessionss" · did you mean: ep0ch session`. An unknown door flag suggests the closest one.
  `--help`, `-h` and `help` work in any position and show that command's usage.
- **`ep0ch outline delete`** also removes the outline's owner lock file, and refuses while another process holds
  it.
- A `work_create` title that starts with `--` is no longer refused as an ambiguous option.

### The Claude mod says which outline it's bound to (PIE-546)

- **A card** above the prompt, at the start and after `/clear`: the outline and its machine, why (the `.ep0ch` that
  names it, or "nothing names one" with the `ep0ch init …` to run), where Claude runs, and the door and Herdr pane it
  sits in. It says **careful** in yellow when the folder names one outline and the door is on another. `h` hides it;
  `/outline` shows it again.
- **A status line** that stays: `outline: garden @ float-2 · folder`, with `⚠ door is harbor @ far` on a mismatch,
  or `none (tools off)` and the command. It reads the binding again at most every 30 seconds.
- **The first prompt's context** carries the same lines, so the model knows too.
- `ep0ch where --json` gains `here` (machine and folder) and `herdr` (the pane, its label, whether it's an agent
  pane), and `door.machine`.

### Fixed: a new note's cleanup could trash a note someone had written meanwhile

`Esc` on a new note with nothing typed puts it in the trash. If another client, an agent or the person in Detail
wrote to it, or added a child under it, between the door's read and its trash, that work went to the trash with it.
The trash is now conditional in the service: `delete` takes `expectedRevision` and `ifEmpty`, checked in the trash's
own transaction, and the door's cleanup passes both, so a note written or given a child meanwhile stays, and the
door says so with its id and `ep0ch show <id>`. A cleanup that fails says it failed, never "it went to the trash".
`Esc` while a new note's edit is still opening cancels it. From a shell: `outliner delete --id <id> [--expected
<revision>] [--if-empty]`. Protocol bump: restart the host and the doors (see "Update: what to run").

### Fixed: a fenced example inside a figure cut it short in the door

A `::graph-*` figure whose Markdown body held a fenced code example with a bare `::` line ended at that line in the
door's reader, its export and its links, and the rest of the figure read as text. The Claude mod's preview did the
same. They all ask outline-core now (`componentBlocks`), the rule Detail and `replaceSection` use: a code fence closes
only on its own fence (a `~~~` inside a ``` fence no longer ends it), an unclosed figure is plain text (it used to
run to the end of the note in the door), and an opener indented four spaces or more is code.

### Figures written in Markdown, and seven new kinds (ideas from mdxcn.dev)

- **A figure's rows can be Markdown.** After a `::graph-*` block's `---` YAML (or instead of it), write rows:
  `**bold**` is now, chosen or the accent; `*italic*` next, rejected or receding; `- label: value` is a row;
  `x — note` adds a muted side note; `a → b → c` is a path; `ok*40` is a run of forty in any list of values.
  timeline, check, rank, funnel, stat/kpi and spark/plot read them. Where the YAML gives the same field, the YAML
  wins. One reading for every client (outline-core's `figure-markdown.ts`).
- **A figure block's child bullets are its rows.** A note whose body is a figure takes its child notes as rows
  (`rows: children` asks anywhere): each row opens its note by `[ ]` and `⏎`, a click, or `element.open`.
- **New kinds:** `decision` (● chosen, × rejected, ○ open, each with its reason; live over notes with a
  `decision-state`), `chat` (speakers, the first one prompted, asides dim), `keys` (keycaps like `[ctrl][k]`;
  `actions: note` reads the door's own keys from the action registry), `uptime` (a glyph a day and the % ok),
  `activity` (a contribution grid), `calendar` (one month, marks and today) and `annotate` (code with numbered
  callouts). The README's "mdxcn figures" lists each one's Markdown and live forms.
- **Backups as an uptime strip.** `::graph-uptime` with `source: backups` draws the `[type::backup-run]` notes
  that `bun packages/door/scripts/backup-runs.ts --ws pie --source restic -- ~/.local/bin/ep0ch-snapshot` adds,
  one per run, with its status from the backup's exit code. Nothing is hooked up for you: add that line to the
  timer's unit when you want it.
- **A quote's byline.** In a `> [!quote]`, a last line starting `— ` is drawn as the attribution, to the right, the
  source after a comma muted, in the door and in Detail.
- **`ep0ch export` writes figures as ASCII.** Each `::graph-*` becomes its drawing in mdxcn's fenced frame
  (`+---[ TITLE ]---+`, 60 wide, no colour, live ones answered first), so an exported file reads as the door shows
  it. `--source` keeps the blocks as written.
- **The showcase** has a `figures` section: every new kind in its Markdown form, live ones, the figure block and
  the reader's keys read from the registry.

### Fixed: the outline tile showed a note as it was when the desk opened

The desk's outline tile (and the board's outline drawer) read its rows once. A note saved in the reader, in Detail or by
an agent kept its old text in the tree, and picking its row showed that old copy in the reader: a body just written read
as blank until `e` (which reads the note) or a restart. A note made elsewhere didn't appear. The tree now reads its top
level and its open notes again when the outline changes them, and a row picked while that read is due is read itself.
The river's replies under a note are read again the same way. Restart the door (`ep0ch session upgrade --all`) to get it.

### Images: sized, placed, and a note's header (PIE-532, PIE-494)

- **Images render on Linux too.** JPEG, WebP and GIF (its first frame) used to need macOS's `sips`; now decoding and
  scaling are sharp's prebuilt libvips, on Linux and macOS, with no system tool. `bun install` (or `ep0ch install
  --apply`) brings it. An image is scaled down to about the box it's drawn in, never up, so a big screenshot no longer
  crosses ssh at full size. A video's poster frame still needs `ffmpeg` (or Quick Look on a Mac); without one the line
  says what to install.
- **Layout as properties on the image's line:** `[size::40%]` (or cells, or `full`), `[height::12]` (rows),
  `[align::center]`, `[alt::…]`, and `[layout::hero]`: the note's **header**, drawn above the title, the full width,
  whole when it fits in a third of the pane (or its `height`), else cropped to fill (`[fit::contain]` shows it whole);
  it scrolls away with the top of the note.
- **Dark first:** a bright image (a page, a slide, a screenshot) is dimmed as it's scaled, never shown bright first,
  so the part drawn has a mean luminance of at most 0.3. Its rows are kept while it loads: the note doesn't move. `[dim::0]` shows it as it is, `[dim::0.6]` at 40%. For example `- [img::~/shots/plot.png] [layout::hero]`.
- **Change it from the reader:** `[ ]` to an image (or click it), then `+` `-` size it, `←` `→` move it, `H` makes it the
  header; or click its caption's `[−][+] [◂][▸] [▀]`. Each is one save of that line, recorded as you; `ctrl+z` undoes
  it. Agents: `act images`, `image.size n=1 to=50%`, `image.align`, `image.hero`, `image.undo`.
- The showcase has an `images` section.
### New notes from anywhere (PIE-544)

- **`ctrl+n` on every screen** makes a new note and opens it to be written where the screen's opens land, in the
  same editor as `e` (`+` on the main menu does it too). From a reader it goes under the note the reader shows, as
  its last child; from anywhere else, at the top of the Inbox. `Esc` on it with nothing typed puts it in the trash.
  Never taken while you type, and the outliner binds nothing on it.
- **One placement rule, kept by the service:** `notes.create` (and `outliner new`) asks it; the client only says
  which note you were in. Today: under that note, else the top of the Inbox, where quick capture puts its notes.
  It's the seam for rules your outline will define later ("pages go under Pages").
- **A missing `[[page]]` is offered, never made silently:** the first `⏎` or click on `[[Evans Thotts]]` says it has
  no page yet; the next makes `Evans Thotts [page::Evans Thotts]` in the Inbox and opens it (`page.create`). The
  outliner's Tree, which makes a stub when it follows one, now puts it in the Inbox too instead of at the top level.
- **`[page::x]` names itself:** a note whose first line is only `[page::2026-09-30]` becomes
  `2026-09-30 [page::2026-09-30]` on save from any client (the door, Detail, the CLI, agents) and on `⏎` in the
  door's editor. A title already there is never touched. A new note saves on the first `Ctrl+S`.
- **Agents:** `act note.new text=… [near=<id>]`, `act page.create address=…`: attributed, said on the status bar,
  opening nothing. A `near` that's gone is refused, nothing made, with the command to run instead (so is
  `outliner new --near`); only the person's own reader falls back to the Inbox.
- **`ep0ch new "<text>"`** makes a note from a shell or an agent with no door open (`--near`, `--as`, `--json`,
  `--ws`), through the same service call as `ctrl+n`.
- **An empty outline offers a note:** the welcome's list, an empty board, the brief and waiting screens show
  `+ New note · ctrl+n` (a click is `ctrl+n`); `ctrl+n` in a BBS message reader opens the note in a reader over it. A note still empty isn't the Inbox agent's to file.
- **Protocol 86:** restart the outline host on this code (`ep0ch install --apply`), then the doors.
### Sort by a property

- **A saved view, a live figure or a `blocks.query` sorts by any property**, not only `created` and `updated`:
  `[sort::due]` with `[direction::asc]` in a view, `sort: due` and `direction: asc` in a `::graph-*` figure,
  `sort: { field: "due", direction: "asc" }` on the wire. Numbers compare as numbers (`2` before `10`; decimal
  only, so `0x10` is text) and before any text in either direction; text compares without case; blocks without the property come last in either direction, in outline
  order. The query's property scope counts (`propertyScope: "all"` reads a property mid-sentence too).
  `property:created` names a property called created or updated; plain `created` and `updated` are the timestamps.
  A direction may be written in any case.
- **`ep0ch find --sort <key> [--direction asc|desc]`** orders `--query`, `--under` or words the same way
  (`ep0ch find --query type=chore --sort due`); with `--view` it refuses, since a view has its own order.
- **A bad sort says so.** A sort that isn't `created`, `updated` or a key is refused with the key it seems to mean
  ("Sort by rank, not [rank::]"); a live figure says which of its lines it was. Figures used to fall back to
  `updated` without a word.

### Order a view by hand, from the door and from agents

- **A view with no `[sort::]` is ordered by hand**, and its lane, its `view:` figures and Tree all show that order.
  Tree could always change it (alt+↑ alt+↓); now the door, the shell and agents can too.
- **On the board:** `alt+↑` `alt+↓` move the selected card up or down its lane, and a card dragged up or down its
  own lane goes where it's dropped (the hint says above or below which card). Both run `card.reorder` (`by=`,
  `to=`, `before=`, `after=`), which agents call through `act`; theirs never moves your cursor.
- **From a shell:** `ep0ch view order <view> [<id>…]` prints the order, or puts those members first in the order
  given (block ids, `((id))` or Work IDs such as PIE-552), the rest after them as they were. `--json`, `--as <agent>`,
  `--ws`. **Claude:** the `view_order` tool does the same.
- **One service step:** `virtual.occurrences.move` resolves the refs, reads, plans and writes the order in one
  transaction; the door, the shell and the tool call it, so two quick alt+↓ never race. A step (`by`) stays within
  what a `[limit::]` view shows, so a card never slips out of sight.
- **Who reordered is recorded:** `virtual.occurrences.move`, `.place` and `.reorder` take `mutation`, written on the
  change and as a `move` on each block whose place changed (Tree's are recorded as `tree`).
- **A sorted view says how to order it by hand:** "This view sorts by updated desc, so it has no hand-set order:
  remove [sort::updated] from ((id)) to order it by hand" (and its `[direction::]`, as the view writes them). Tree
  says the same, where it said "manual reorder is disabled".
- **Refs as people write them:** a view and its members can be an id, `((id))`, an id's first 8+ characters, a Work
  ID or a `[[page]]`; a trashed block is refused as in Trash, and the same block named twice is refused.

### A figure no longer cuts a section short

- **`outline_edit` `replaceSection` and `note_section` replace the whole section** when it holds a component
  block (`::graph-stat`, `---` YAML `---`, `::`). Its first `---` was read as a setext underline, so `::graph-stat`
  became a level-2 heading that ended the section: the edit reported `previous: ""` and left the old figure under
  the new body. A component block is now one token wherever the outliner finds headings, sections and folds
  (outline-core `component-block.ts`), so Detail's folds agree, with or without a blank line above the figure.
  A section runs to the next heading of its level or higher, sub-sections and figures included.
- **A figure never swallows Markdown around it.** A heading, fence, list or table between a paragraph and a figure
  keeps its meaning (a table's rows stop before the figure); a `::name` with no closing `::` before the next heading
  is plain text, so it can't eat the sections after it; a `#` comment in its YAML or code fence isn't a heading. The
  reading stays linear in the note's length.

### Tabs in a live figure, and titles that wrap

- **`::graph-tabs`** groups a query's (or a view's) results by a property, a tab per value, each labelled with its
  count (`doing 3 · review 4 · validate 1`). The chosen tab's rows are a live table; a row opens its note.
  `order: [doing, review, validate]` puts those tabs first, shown even when empty; the rest follow alphabetically, so
  a count changing never moves a tab. `limit:` is rows per tab.
- **Switch tabs** with `←` `→` or `Tab` `Shift+Tab` while one of its tabs or rows is the `[ ]` position, `⏎` on a
  tab, a click on one, or `act figure.tab n=<number or value>` (an agent: in a reader you aren't typing in). The
  tab is the reader's, like a fold: kept across repaints and live answers, never written into the note.
- **`density: compact | cozy | comfortable`** on a table or tabs figure: a title takes one line (cut with `…`, as
  before), up to two, or up to three with a blank line between rows. A wrapped title hangs under its own text, past
  a work id (`PIE-541 — `). `=` or a click on the `≡ compact` footer steps through them (`figure.density`); the YAML
  is only where it starts. `act figures` lists a reader's figures, tabs and counts.
- **`ep0ch show`** (and `--cells`) prints every tab in turn under a heading. The showcase has a `tabs` section.

### Copy from a program in a terminal tile (PIE-537)

- **A program's copy reaches your clipboard.** Its OSC 52 (Claude Code's "sent N chars via OSC 52") goes on to your
  terminal through the door's own copy, in a session to the terminal with the keys (never a watcher), and a toast says
  "✓ copied from claude · N chars". Before, the terminal tile swallowed it.
- **Only from a tile you're using:** one you typed, pasted or clicked in within the last two minutes, so an agent
  typing into a shell you haven't touched can't fill your clipboard. Otherwise nothing is copied and the toast says "✗ not copied from
  claude · you haven't typed or clicked in it for 2 min · click in it, then copy again".
- Only writes pass: a program can't read your clipboard. Over 512 KB nothing is copied, and the door's own copies have
  the same limit. The kitchen sink's terminal section shows it (`ep0ch --showcase`, section 9).

### A mention opens right in Claude, with no door or Herdr around (PIE-542)

- **In the Claude desktop app (Code tab), VS Code or a terminal outside Herdr**, a press on a mention or a reference
  now opens the note in the mod's mentions pane, in place of the list, instead of copying a command. The heading
  says "opens here". The desktop and VS Code draw it as Markdown (a heading, the text, its children as a nested
  list, references as links); the terminal draws the door's cells, with the references as buttons under them.
- **Links in it open there too**, with history: `b` back (to the list from the first note), `f` forward, `l` the
  list. `c` copies `ep0ch show <id> --ws <outline>`, which a press used to copy.
- `show` lands there as well when neither a door nor Herdr is around.

### The docs site's design system (PIE-523)

- **`site/`**: the system for the docs site, with Showcase (what the door does, in casts) and Build (guides for
  adding to it) under one shell. `site/DESIGN.md` is the spec: the sections and page types, the colour roles, the
  type and the components, and the content rules. `site/kitchen-sink.html` draws every component. Two sample pages
  show the system in use: the callouts feature page, with a cast you can scrub by chapter, and a guide to adding
  a callout type.
- **The door's own colours:** `bun site/tokens.ts` writes the site's colours from the door's calm and night
  themes. Dark only, with no light flash.
- **`bun site/check.ts`:** each page is screenshotted before and after its stylesheets load, at desktop and phone
  widths, and every example marked to run is run on a scratch outline, as a reader would (`ep0ch new`, `ep0ch
  show`). Its callouts are checked against the door's own types, and a page that loads anything from another host
  fails. `site/` is a workspace package, so `bun run check` typechecks it and runs its examples.
- **Fonts served by the site:** JetBrains Mono and Atkinson Hyperlegible Next are in `site/assets/fonts`; a page
  asks no other host.
- The callouts cast is a stand-in, recorded by a one-off script; the showcase tours (PIE-523) re-record it.

### Find by query, export to Markdown or JSON (PIE-534)

- **`ep0ch find --query "<expression>"`** lists the notes a query holds for, as the outline evaluates it: the saved
  views' grammar (properties, `OR`, `NOT`, parentheses, `created`/`updated` ranges such as `updated >= -7d`), in
  outline order. `--view <id>` lists a saved view's members, `--under <id>` a subtree; they combine with each other
  and with words. `--updated-after`, `--updated-before`, `--created-after` and `--created-before` only write the
  query (`--updated-after 2026-03-01` is `updated > 2026-03-01`, a whole UTC day).
- **`--ids` prints `((id))` a line**, and `show` and `export` take `((id))` or a bare id: `ep0ch show $(ep0ch find
  --ids --query type=errand)`. **`find --json` now prints block records** (below) instead of `{id, title, path}`
  rows; `--tree --json` keeps its rows.
- **`ep0ch export`** writes notes out as files: the ids given and anything find's flags select, `--children` for
  what's under them, `--format md|json`, `--out <dir>` (stdout without), `--split`, `--resolve-links`, `--manifest`.
  In Markdown the note's header line (the `[k::v]` chips ending its first line) moves into YAML front matter, values
  verbatim strings and a repeated key a list, with the note's id, parent, created, updated and author; the prose
  that shared line 1 stays the body's first line, the rest is verbatim, children are nested lists (files of their
  own with `--split`). Output is deterministic: sorted JSON keys, outline order, one timestamp format, no export
  time except in `manifest.json`.
- **A block as a record:** one shape in outline-core (`block-record.ts`: title, header, properties as lists, fields,
  children, tasks with status, links, backlinks, resources, created, updated, author), built by the outline host
  (`blocks.records`). PIE-533 reads the same shape.
- **` - ` between header chips:** `Seed order [type::errand] - [area::garden]` gives both chips to the block, and the
  title is "Seed order" (before, every chip but the last was an inline aside, and a chips-only line's title was
  "-"). The header line is one definition in outline-core (`header-line.ts`): the parser, every title, the door and
  Detail's property table (which now says `header` for those chips) use it. The host re-reads every note's
  properties once on its next start (property parser version 5); text and timestamps are untouched.
- **tv:** `ep0ch-tv query "<expression>"` is a source for the `ep0ch` channel (`tv ep0ch --source-command 'ep0ch-tv
  query "type=chore updated >= -7d"'`).
- **Protocol 84:** restart the outline host on this code (`ep0ch install --apply`), then the doors.

### Callouts in full (PIE-538)

- **Obsidian's callouts, all of them.** `> [!type]± title` nests to any depth (`> > [!warning]` is a box in the box),
  with Obsidian's thirteen types and their aliases; a callout's body is drawn like a note (paragraphs, lists).
  Obsidian's own examples are in the showcase's new `callouts` section.
- **Folding.** A callout is a fold point like a heading: `[!x]-` starts folded and `[!x]+` open, then `( )` `f`, `⏎` or a
  click on its title opens or folds it, and `z` opens them all and puts them back. Folding never writes the note.
- **Change a type while reading.** `⏎` or a click on a callout's icon opens the type choice (the step status choice's
  picker); `-` and `+` there make it start folded or open. One line rewritten through the note's save, recorded as
  you; `ctrl+z` puts it back. Agents: `callout.list`, `callout.type`, `callout.start`, `callout.undo`.
- **Type one.** In an edit, `> [!` offers the types with their icons in the completion popup.
- **Your own types.** A note with `[callout-type::recipe] [callout-icon::♨] [callout-tone::green]
  [callout-aliases::dish]` adds a type to the outline: the door's reader, popup and type choice and the outliner's
  Detail all draw and offer it. The list and the grammar are one module in outline-core; the host answers
  `callouts.types` (protocol 85). Detail's built-in icons are now the door's (one list).

### One repository, outlines by name (PIE-530)

- The packages: `packages/outline-core` (the shared pure code: the protocol, the property grammar, the search
  matcher, which outline a client opens), `packages/outliner` (the outline host, Tree, Detail and Preview in Herdr,
  the CLI, the publisher; the Herdr plugin root), `packages/door` (ep0ch) and `packages/claude-mod`. Both histories
  are kept.
- One outline host per machine serves every outline in `~/outlines` by name. Its socket and lock are in
  `~/outlines/.host/`.
- Which outline a client opens, first match wins: `--ws <name>`, then `EP0CH_WS`, then the nearest `.ep0ch` from
  the folder up. `.ep0ch` holds names only: `ws = "<name>"`, and optionally `machine = "<ssh-name>"`. `ep0ch init
  [<name>]` writes it. An outline's own folder (`~/outlines/<name>/`) names it too.
- A folder that names no outline is never given a guess. The door opens the home base; Herdr shows the Choose
  outline popup; `outliner init` and `ep0ch init` name one.
- `ep0ch outline list | attach | create | import | stop | delete` and `ep0ch status` manage the host's outlines.
  The outliner's CLI takes `--ws <name>` before a command.
- `ep0ch doctor` says which outline this folder opens. It no longer lists the host's owner lock
  (`<name>.sqlite.owner`) as an outline: one rule in outline-core says which files are outlines.

### Starting ep0ch

- **The home base.** `ep0ch` in a folder that names no outline opens a door screen instead of a text prompt. It
  lists this machine's outlines and the machines you opened from here, with each one's outlines. Open one, make a
  new one (`n`), import one (`i`), add a machine from `~/.ssh/config` (`a`), forget one (`x`), reload (`r`).
  Choosing an outline offers to write the folder's `.ep0ch`, or to open it this time only. It works by keys, by
  mouse (one click on a row chooses it) and by `act` (`home.*`).
- **Another machine.** `ep0ch --machine <ssh-name>` runs the door here on an outline served by that machine's
  host. `EP0CH_MACHINE` and a `.ep0ch`'s `machine` line do the same. Every client on this machine shares one ssh
  forward per machine (`~/outlines/.remote/<ssh-name>.sock`). A door starts it again when it drops, and says so on
  the status bar. `ep0ch doctor` shows each forward's state. Herdr panes and the Claude mod follow the same rule.
- **`ep0ch --remote <ssh-name>`** puts this terminal on the door session running on that machine (`ssh -t
  <ssh-name> ep0ch …`), so the drop shell and `$EDITOR` run where the door is.
- **The positional socket argument is gone.** `ep0ch <socket>` is refused and says what to use. `EP0CH_SOCKET`
  still names a host's socket outright.
- **`ep0ch --showcase [--reset]`** opens the showcase on its own seeded outline of made-up notes (the same as
  `ep0ch try --showcase`). `--reset` seeds it again. Before, it opened the showcase screen on this folder's outline
  and asked for a seeded database.

### One door session per outline

- **A session per outline,** like `herdr --session <name>`. `ep0ch`, `ep0ch --ws <name>` and `--machine <m> --ws
  <name>` attach to that outline's session, starting it when none runs. Before, one session held the whole state
  dir and naming another outline was refused. Bare `ep0ch` in a folder that names no outline still opens the home
  base, even with one session running: which outline is never guessed. The home base marks outlines whose session
  runs (`● running · 1 attached`), and choosing one attaches.
- **`ep0ch session list`** shows every session (outline, machine, pid, code, terminals, programs). `attach`, `end`,
  `upgrade` and `restart` act on this folder's (or `--ws`'s) outline, else the only one running; `upgrade --all`,
  `restart --all` and `end --all` act on every one. `install --apply` hands every session behind the checkout to the
  new code.
- **One outline's own state lives in its folder** of the state dir (`sessions/local/<name>/`, or
  `sessions/<ssh-name>/<name>/`): its session, its desk, river and board layouts, its last call, marks and drafts put
  aside. The theme, named layouts, machines and the dock stay shared.
- **An error that tells you to run something shows the exact command,** filled in for this machine (with
  `EP0CH_STATE=` when it isn't the default).
- The one-off move of a session from before this ran on both machines and is gone (#162): a state dir's old
  top-level session files are ignored.

### Search

- **Forgiving search.** Goto, Detail's and the door's `((` (`tree.search`) and `[[` (`pages.complete`)
  completion, the door's `/` search and `ep0ch find` (`tree.search`), Inbox history search, the Backlinks filter,
  the links tile's Outlinks and Resources filter and a river column's `/` words share one matcher (outline-core's
  `search-match.ts`). Punctuation folds ("Claude - now" finds "claude now"). Words match in any order. A longer
  word may be off by a typo or two ("party hast" finds "party hats"). When all but one word match, the result
  still shows, below every exact match.
- **Search from the note you are writing**, in Detail and in the door. `((` and `[[` rank from the draft's note (the
  note being edited, the one a comment is on, a new note's parent, a new card's view): nearer notes come first. An
  empty `((` lists what the note's parent and siblings link to, then nearby notes, then your recent edits. `[[`
  also finds a work id by its note's title. The door's `/` searches from the note you are on.
- **Jev after a pause.** Where the host has a Jev key, a 300 ms pause in the door's `((`, `[[` or `/` asks Jev to
  re-order the same hits, told the note. What you picked stays picked; if you moved or typed meanwhile, the answer
  is dropped. The footer says `jev…` while it asks and `jev ranked` after. A host without a key is asked once.
- In a river column's `/`, `-word` now hides exactly the notes `word` would show (a typo included).
- `blocks.query`'s `text` (agent tools, `list --text`) matches every word in any order, not one phrase.

### Links and resources on every screen

- **One links model**: a block's Outlinks, Resources and Backlinks, in the Tree's order and words, drawn the same
  way in four places:
  - the tree's `L` panel;
  - the links tile (the backlinks tile, extended): its filter covers the three groups (the backlinks with the forgiving matcher, outlinks and resources by plain
    words for now), `.` folds a group, and its
    preview shows the selected row;
  - a river column, under its replies: `j` and `k` walk into the rows, ⏎ opens one in the next column, and `b` or a
    click on `── ▾ links` folds them;
  - inline in a note: `::links`, `::outlinks`, `::resources` and `::backlinks`, drawn in a figure's frame. Words
    after the name filter the rows (`::resources jira`).
- **`b` in any reader** shows the note's links. It aims the screen's links tile, or opens one below the reader with
  its preview beside it.
- **Resources.** Previewing a Resource only reads (its stored content, or the Jira extension's ticket block). One
  that isn't registered says that ⏎ registers it. ⏎ registers and fetches it once, as the Tree's ⏎ does.

### The mouse does what the keys do

- In lists (the tree, the links tile, list pickers, the query tile, the board's lanes, the river's cards and link
  rows): a click selects and previews, like `j`/`k`; two presses on the same row within 400 ms are ⏎; alt-click,
  ctrl-click or a middle click is alt+⏎. The click that gives a tile the keys only selects.
- **Sideways wheel** (a trackpad swipe) moves one step: the next river column, or the next lane on the board.
  Terminal tiles get the real wheel bytes.
- **Every desk screen leaves by mouse.** The keys drawn in a hint row (and in its `? more` box, and a `^W` chord's
  keys box) are clickable: `q menu`, `/ search`, `alt+k lock` and the rest.
- The board's mover and steps, the layout picker and the search take the mouse: a click on a lane moves the card,
  a click on a step checks it off, a click on a layout loads it.
- The mouse's back button runs a screen's `alt+←`, as in the river.

### River and tiles

- **A preview split in one key (PIE-536).** `O` in a reader, `^W v` (beside) or `^W V` (below) on any tile opens a
  reader beside it where its opens land, linked in the same step: links you follow there, the tree's `⏎` or a
  list's pick show in the split and the tile keeps its note. A reader gets a detail; a terminal a preview of its
  file; the board one of its card. Again, it shows that split instead of making another. Agents: `act tile.preview
  tile=<tile> where=…`. `^W v` was a follower preview, not linked; `^W o p` still opens one. On a tile already linked (the daily desk's outline → `middle`) `^W v` now jumps to that tile. A river column refuses it: its opens already open the next column.
- **River columns draw a note's images** in a terminal with Kitty graphics, scrolling and cropping with the column.
  Where images can't be drawn, the label says why (`no Kitty graphics in this terminal`, or `alt+v draws
  images`).
- **A tile paints its whole box.** Text from a column behind a short one no longer shows through.
- **A river column owns its keys** on any desk: `h l ← → w p x g` and back/forward work there as in the river.
- **The river's property filter asks the service.** `type:hub`, `-status:done` and `key:*` match as the service
  matches (any of a note's values for the key). `type:` lists notes without a `type`, `-type:` notes with one. A
  key the service refuses is said as the column's error.
- **Fixed:** typing `e`, `i` or `C` in a river column's `/` filter started an edit, the property panel or a comment
  instead of typing the letter.

### Television, and ctrl+t inserts from a picker

- **The outline in [television](https://github.com/alexpasmantier/television)**, as a door extension
  (`packages/door/ext/television/`, deletable):
  - `tv ep0ch`: the outline's notes, with three sources (`ctrl-s` cycles them): Tree (depth first, drawn with
    `├─ │ └─`; `EP0CH_TV_ROOT=<id>` roots it), Recent and All. The preview is the note as the door draws it. Enter
    prints `((id))` per note (Tab picks several), `ctrl-g` opens it in the running door (attributed to
    `television`), and `ctrl-d` shows it in the Outliner's Tree and Detail.
  - `tv ep0ch-files`: files, printed as `[file::<path>]` Resource tokens.
  - `tv ep0ch-outlines`: this machine's outlines and the remembered machines'. Enter opens the door on one.
- **ctrl+t in a draft** (an edit, a comment, a reply or a new card), or a click on `[insert]` in the edit frame's
  title row, opens the picker in a terminal tile beside the note and inserts what you choose at the cursor. `^W x`
  closes it without inserting. On a screen with no room for a tile (the board), the picker gets the whole terminal.
  `EP0CH_PICKER` (default `tv`) and `EP0CH_PICK_CHANNEL` (default `ep0ch`) change what runs. It is the person's
  action: an agent's `draft.pick` is refused.
- **New commands** for pickers and scripts:
  - `ep0ch find [words… | --recent | --tree [<root id>]] [--lines | --json]`: the service's ranked search, the
    newest notes, the outline as a tree, or every note;
  - `ep0ch show <id>… [--source | --ansi | --cells] [--width <n>]`: each note drawn as a reader draws it, its live
    figures, `::links` and a view note's results answered by the outline, folded callouts open (no key hints); `--source` prints each note's text exactly as written, `---`
    between notes, for a Markdown file (`ep0ch show --source $(tv ep0ch) >> notes.md`);
  - `ep0ch outline list --all`: every outline, here and on the machines you opened;
  - `ep0ch open ((id))` takes the bracketed form.

### No dead panes; choose the dock's agent; one agent per outline session (PIE-498)

- **Quitting an agent leaves you a shell.** Every agent, in the dock or a terminal tile (`claude`, `codex`, `pi`, the
  Herdr pane's too), starts inside your login shell. When it exits or crashes, the tile says `claude exited · shell`
  and is your shell, in the same folder with the same environment: `claude --resume`, another agent, anything.
  Nothing restarts it behind your back.
- **Choose the dock's agent.** `alt+g` opens a picker of the agents installed here (Herdr's agent kinds found on
  your PATH, each also "in Herdr" when Herdr is installed) and a shell; the choice is saved per outline session
  (`host.agent name=<agent> [herdr=true] [default=true]`). `alt+s` opens a new shell in the dock. `ep0ch doctor`
  lists each session's dock agent, where the choice came from, and the command to change it.
  Both work while you type in a dock terminal too (as `alt+a` does), and the picker has your keys over it. Pulling
  the dock up the first time with no agent chosen (`alt+a`, a click on the chip) offers the picker once a door.
- **One Herdr agent per outline session.** The Herdr pane is the session's own (`door-<outline>[--<machine>]`),
  started with that session's `EP0CH_CONTROL`; a door on another outline never attaches it. Ending a session closes
  its pane.
- **Plain `claude`.** The dock no longer starts `door-claude` or adds `--continue` by itself (only `agent.restart`
  does, when you ask). `EP0CH_HERDR_AGENT_CMD` is gone: the agent is the dock's choice.

### The dock: any tile travels with you (PIE-498)

- **Dock any tile.** `^W a` on a tile (a terminal with a Claude in it, a reader, the tree, a query tile) moves it into
  the dock, the drawer the status bar's chip pulls up over every screen. So does dragging its title onto the chip or
  the open dock, or pressing `a` while you drag it. It's the same tile, moved: a terminal's program keeps running
  (the same pid), a reader keeps its note, history and draft. Switch to the desk, the board or the river and it's
  still in the dock. `^W a` in the dock, or dragging its tab out over a screen, puts it back by the usual drop
  zones. The dock shows tabs when it holds more than one; the chip says how many (`▲ claude +2`).
- **It's kept.** What's docked is saved (`dock-tiles.json` in the outline's folder of the state dir) and comes back
  in the next door. In a session, a docked terminal's program survives `ep0ch session upgrade` and is adopted again.
- **The dock's own program is yours.** Its first tab runs `EP0CH_DAILY_AGENT` when you set one, else a shell (it was
  `claude`). It starts in `EP0CH_DAILY_CWD` when you set it, else the folder of the `.ep0ch` naming the outline above
  where the door started, else the outline's own folder, else where the door started. `ep0ch doctor` says which,
  and why. The Herdr launcher makes a new `door-claude` pane in that folder, not the door's.
- **Agents:** `host.dock tile=<t>` (and `on=false to=<tile> where=<side>`), attributed, never with your keys; an
  agent can dock its own tile (`tile=$EP0CH_TILE_ID`) unless you're typing in it. `tile=` naming a docked tile
  reaches it in the dock; a name both the screen shown and the dock have is refused, naming each tile's id.
  `peek`'s `dock` lists `tiles` and what it `runs`.
- **Nothing in the dock is out of reach.** A docked reader re-reads a note changed elsewhere, as a shown one does; its
  unsaved edit asks before a quit and is copied out on a forced end or a session handover; `ep0ch where` from a
  docked terminal names its dock tile, never a screen tile its old `EP0CH_TILE_ID` happens to match.
- **Floats and drawers, one step each way.** `^W p` (or `tile.pin`) on a float puts it straight into a drawer, and
  `^W f` on a tile in a drawer floats it. A click on the `⧉` in the focused tile's top right corner floats it; the
  `⧉` before a float's title puts it back, the cell either side of it counting too. A float's other header controls
  (a mark's label, a tile's own controls) work again: a press on its header no longer always started a drag.
- **While dragging a tile,** `f` floats it, `p` puts it in a drawer and `a` docks it: what `^W f`, `^W p`, `^W a` run.
- **One word, one meaning.** "Dock" is the dock above. The river's `p` (a column that keeps its full width) is
  `tile.hold` now, "held" on its header (`⊙`); a tile in the layout rather than a drawer is "pinned" (`tile.pin`); a
  float goes "back" into the layout. The status bar and the drawer say "the dock" for what was the agent drawer.

### Smaller changes you may notice

- Who's Online (`W`) and Last Callers (`L`) are desk screens: tiles with the desk's keys, mouse and `act`. In Last
  Callers, ⏎ shows the note in a reader beside the list.
- A board or river tile opens as its screen was last saved, and what changes in the tile isn't saved over the
  screen's own layout. The board screen (`K`) no longer comes back with its preview folded.
- Every line input has ← → Home End and delete. A layout's name can be longer than 40 characters while you type;
  ⏎ then says it is too long.
- Lists keep their view where the wheel left it. The board's steps list no longer jumps when you move up from the
  bottom. Titles are cut by terminal cells, so CJK and emoji titles fit their room.
- `ep0ch session list` shows ages as the rest of the door does (`up 2d`). `ep0ch act` and `peek` with no door say
  `no door answered at <path>`.
- The showcase index scrolls, so no section is cut off.
- Inline code that wraps onto the next row is code on both rows; no stray backtick is left showing.
- A line that several comment threads quote gets one mark in the margin (yellow while any is open). Each extra mark
  used to print a colour code as text, such as `[38;2;230;206;120m`, at the start of the line (PIE-541).
- `outliner --help` (and `-h`, `help`, or no command) prints the CLI's usage; it used to throw, or list the folder's
  outline. An unknown command says so and exits 2.
- `ep0ch --help` lists `ep0ch outline list --all` and `--lines`.
- A link, property value or embed whose target doesn't exist yet ends in a quiet `◌` (embeds drawn dim), not
  "· Missing target". Selecting or clicking it still says in words what's missing and how to make it.
- `ep0ch install` and `ep0ch doctor` read at a glance: a step says what it did once, each backed-up outline is one
  line (`✓ pie  2.1 MB  integrity ok`), sessions are a table, and skill links are one line per folder. A fetch that
  raced another git process is no longer reported as an error. `--json` keeps its shape.
- `ep0ch install` checks each workspace package's dependencies, not only the root's, so a new door dependency
  (sharp, image-size) is installed before the sessions are handed over. A failed handover says its cause once.
- `ep0ch find --recent` and `find --tree` refuse an option they don't take (`--sort` included) by naming it, and
  print the same find without it.
- A showcase door left open across `ep0ch --showcase --reset` reads the new seed; its notebook's embeds no longer
  read missing.

### Recent mentions in Claude Code, and BlockView

- **The Claude mod shows Recent Mentions** in a band above the prompt or a pane beside the transcript (`m` moves it,
  `x` hides it, `p` previews, `s` all conversations; `/mentions band|pane|off|preview|scope`). A click or a
  mention's number opens it through the mod's one open: in a door tile, in that door; in Herdr, Claude's own
  Detail; elsewhere a toast with the exact `ep0ch show <id> --ws <outline>` command, copied.
- **Previews are the door's own drawing** (BlockView): `ep0ch show <id> --cells [--width N] [--rows N]` prints the
  note surface as cells, and the mod paints them. Without a usable `ep0ch` it shows the note's text.
- `outliner mentions list` takes `--agent`, `--session` and `--limit`.

### For agents

- `ep0ch act` names a tile with `tile=` only. `reader=` and `--reader` as names for it, the `reader` tile alias and
  the old `{cmd:"open"}` request are gone, and so are the action aliases (`pane.close`, `pane.resize`, `pane.zoom`,
  `pane.float`, `pane.pin`, `agent.enter`, `agent.leave`, `agent.toggle`, `agent.height`, `focus`, `focus.set`,
  `focus.clear`, `layout.restore`, `reader.collapse`, `reader.expand`, and the river's old short names). Use the
  canonical names `ep0ch actions` lists.
- New actions: `links` (an agent's opens a links tile where the screen has none, and never moves the person's
  keys; refused in a river column, where `column.links` is the way),
  `column.links` and `column.link` in the river, and `home.pick`, `home.open`, `home.new`, `home.import`,
  `home.connect`, `home.add`, `home.forget` and `home.reload` on the home base. An agent's `home.open` writes
  `.ep0ch` only with `write=true`, and the door says which agent opened the outline.
- `draft.pick` and `composer.pick` are the person's: an agent is refused.
- The Claude mod: `door_act` takes `tile`. `show`, `door_open` and a click on a reference name the tile they come
  from; when the door doesn't know it, the note goes where the door's opens land, never into the reader the person
  is on. A folder whose `.ep0ch` names a machine gives Claude's tools that machine too (`EP0CH_MACHINE`).
- Action argument types come from each action's schema, so a wrong argument is caught when the door is built.

### Removed

- **`tile.dock` and `flow.dock`** are `tile.hold` and `flow.hold` (PIE-498: "dock" is the dock). A river layout saved
  with a held column (`docked` in its flow) comes back without the hold: press `p` on the column again.

- **Component fences.** A ` ```component:<name> ` fence is an ordinary code block now. The document-renderer
  registry (`document-renderers.json`, `OUTLINER_DOCUMENT_RENDERERS`) and its one example (`status-summary`) are
  gone. Live `::graph-*` figures and rich component extensions cover the need.
- **Capability negotiation.** One number, `PROTOCOL` in outline-core (now 83), replaces the capability lists and
  the minimum protocol. `ping` no longer reports `propertyGrammar`, `draftPatchCompare` or `searchMatch`, and the
  door's grammar-mismatch warning is gone.
- **Copies of shared code.** The door imports outline-core; its vendored copies of the property grammar, the
  draft.patch compare and the search matcher are gone. The door reaches the outliner only through the outliner's
  declared exports, and a test holds it.
- **Per-folder outlines.** `client.json`, path-hash state folders, `outline.json` descriptors, `by-name/` links,
  `outline adopt|rename|set-root`, the single-outline service, and `OUTLINER_STATE_DIR`, `OUTLINER_OUTLINE`,
  `OUTLINER_REMOTE`, `OUTLINER_SOCKET_PATH`, `OUTLINER_CONFIG_PATH` and `OUTLINER_DEFAULT_OUTLINE`. (`EP0CH_DEFAULT_WS`
  is the host's default outline, for tests and scripts.)
- **Runtime migrations.** The schema has one version (`PRAGMA user_version`, now 1). The store's
  detect-old-shape steps, the roadmap migration and the legacy annotation conversion are gone.
- **Older doors and services.** The door's code for services without today's actions, and its saved-layout
  migrators. A saved `desk.json` or `layouts.json` from before the board became a screen spec is reset.

## Outliner, before the one repository

These entries were pi-herdr-outliner's changelog, from its first dogfood tag (August 22, 2026) to October 2, 2026.
Pull request numbers in them (`#270`) are pi-herdr-outliner's. Some describe things since replaced, such as
`client.json` and capability lists; the [Unreleased](#unreleased) section above says what replaced them.

### Pane bars you choose, glyph dock buttons, and a chrome budget (PIE-525)

- Preview's bar is back to one click for docking: `[▐]` right, `[▄]` below,
  `[◙]`/`[○]` Auto docking on/off and `[×]` close, each the same action as its
  key and menu item.
- In any `[⋯]` menu, right-click an item or press `Alt+Enter` to pin it to that
  pane's bar (Tree, Preview or Detail), or unpin it. Pins are saved in
  `ui.json` beside `keybindings.json`, can be edited by hand, and reload with
  `Ctrl+R`. Defaults ship in code; the shape (`bar` and `chrome` per pane kind)
  is the one ep0ch-door will share.
- Compact chrome is one bar row and one hint row per pane. The hint row is
  generated from the bound actions, every hint is clickable, and statuses flash
  there instead of taking a row. Docked below, Preview's bar is the divider.
  Workspace path, counts, Inbox and "Opens in" moved to the menu's top row.
- `chrome: compact | full` per pane kind replaces `view.json`'s `density`
  (no longer read). **View → Tree/Preview/Detail chrome** switches it.
- Tree and Preview at a 65×20 pane: 10 content rows with the former full chrome,
  18 now; chrome rows around Tree with Preview below went from 11 to 3.

### The Claude mod follows the folder you run Claude in (PIE-526)

- A Claude session's Recent Mentions, links and outline tools use the outline
  its folder is bound to: the nearest folder with a `client.json`, or an
  outline root the host serves. No allowlist to configure, and a folder bound
  to no outline feeds nothing (never the host's default outline).
- `outliner bound-folder [folder]` prints that binding as JSON (never a guess).
- `PI_OUTLINER_MENTIONS_WORKSPACES` (and the mod's `workspaces` option) opts
  folders out. `PI_OUTLINER_MENTIONS_MODE=allowlist` keeps the old behaviour.
  An old allowlist with no mode feeds nothing anywhere (one toast) until the
  mode is set or the list dropped with `install-claude-mod.ts --folder`.
- `install-claude-mod.ts` needs no folder. `--exclude` opts a folder out,
  `--folder` drops an old allowlist (naming listed folders bound to no
  outline), and folders given bare (or `--allowlist`) are strict mode. `install.sh` gains `--claude-exclude`; `--claude-workspace` is
  strict mode, and `--claude-mod` no longer asks for a folder.

### Anyone with the link: `[publish::public]` (PIE-518)

- Tag a note `[publish::public]` or `[publish::public:<slug>]` and anyone with
  its link can open it, including claude.ai and ChatGPT. `publish serve
  --public-port N` adds a public listener from the same publisher: it serves
  only public notes, has no index, and shows "not shared" for an embed of a
  note that isn't public. `[publish::never]` still wins. Expose it with
  Tailscale Funnel on its own port (Funnel opens a whole port, so never beside
  the tailnet mounts on 443).
- `publish list` and the tailnet index gain a PUBLIC column with each public
  note's link (`--public-url`).
- `[publish::public]` used to publish at the slug `public`; it now means the
  above.

### Proposals apply once, never past their passage, and dismiss in the service (PIE-510)

- "Apply anyway" places only the passage the proposal shows. If the person
  changed that passage since, the apply is refused and their text stays. It
  used to replace whatever stood between the context kept around the passage,
  which at a note's end was everything after it. A forced apply also stays
  above the mark. A proposal whose passage was already gone when it was made, or
  is at or below the mark, carries `[proposal-applies::no]`, so clients offer only dismiss.
- A proposal is applied or dismissed once: a second call made at the same time
  is refused. If the applied status can't be written, the answer has a
  `warning`.
- `draft.proposal.dismiss` (capability of the same name) dismisses a proposal
  in one step. Its embed line comes out of the note or of the door's live
  draft, the proposal gets `[proposal-status::dismissed]` and goes to the
  Trash, attributed. An agent can dismiss only its own proposals. A patch the
  service sends a door's live draft to apply or dismiss a proposal carries
  `proposal: { id, op }`.
- An `@name` request whose proposal was applied or dismissed now shows
  `applied` or `dismissed` under its line. A proposal's text no longer names a
  door key.

### Agents addressed while you write (PIE-501)

- An extension can declare `agents[]`. A person's `@name …` line (quiet for a
  moment, outside code) runs that agent's `respond` with the note as the person
  sees it. Its patches apply as an attributed edit through `draft.patch` with the
  `edit` policy, landing in a door's live draft when one holds the note; only a
  failed compare becomes a proposal under the line. A reply shows under the
  line. Each request runs once; `r` asks again; a line an agent wrote waits for
  `r`. Example: `extensions/tidy` (`@tidy`, `@tidy all`).
- PIE-510: every agent's `draft.patch` passes one guard that refuses writing or
  rewording an `@name` line (not only an `@name` agent's own answer). Notes from
  before agent requests keep their old `@name` lines old (a one-time baseline at
  start). A request a restart cut off says so; one still waiting for quiet when
  the service stops waits for `r`. Undoing the removal of an answered line brings
  its answer back instead of asking again. `r` records who pressed it
  (`requestedBy`: `user` or `agent:<id>`), an agent's `r` doesn't release a line
  an agent wrote, and `r` on the note (Detail's) asks the requests not answered
  yet. `drafts.touch { holdId }` lets a door say the person typed in a held
  draft, so a request runs while they write, before any save. Note assistance
  leaves lines addressed to an extension's agent alone.

### Extensions wave B: watched folders and the four kinds (PIE-507)

- Extension folders are watched: `<outline root>/extensions/<id>/` and
  `~/.config/pi-herdr-outliner/extensions/<id>/` load, reload and unload with no
  restart. A broken folder keeps serving its last good version and says what is
  wrong, naming the file and the field. `extensions.list` reports every folder,
  its state, its handlers, actions and tile kinds; an `extensions` event says when
  it changed.
- The four kinds, each with an example in `extensions/`: data put into a block
  (`moon::`, beside `jira::`), inline output under a line (`horoscope::`), a rich
  component composed from shared primitives with its own actions
  (`fancy-horror::`), and a whole tile for the door's tile-kind registry
  (`tarot.reading`). Handler lines share one grammar (argument, typed `--options`,
  display options), run by `effects` (`read`, `spend`, `write`), and show in
  `resources.projection.read` beside Jira's tickets; `r` runs them.
  `extensions.render` gives a result as markdown, blockdown, html, json, csv or
  terminal text; `extensions.act` runs an action (or the built-in `keep`), its
  writes kept inside the block and attributed `ext:<id>`.
- `outliner ext add <name|path>`, `ext remove <name>`, `ext ls` (from the running
  service) and `ext act`. Detail draws handler outputs and its `r` refreshes a
  note's tickets and extension lines. See
  [docs/extensions/README.md](packages/outliner/docs/extensions/README.md).

### Merged without an entry, Sep 30 – Oct 1 (added in the PIE-510 cleanup)

Newest first.

- An applied proposal says what was done: "Applied as an ordinary edit." rather
  than "A applies it anyway". The tarot tile fits a door tile 8 to 60 columns
  wide, cutting long lines with `…` (#270).
- Claude mod: a click on a reference, `show` and `door_open` share one open. In
  a door (`EP0CH_CONTROL` set) it asks that door through `door-open --from
  <tile>`, using the `t<n>` id when the tile has no name, and the door's refusal
  is the answer; else Herdr's Detail split; else a toast or denial that says
  why and gives the `((id))` to copy. `door_open` no longer runs its own
  `ep0ch` command (#264).
- **Behaviour change:** `draft.patch` defaults to the `edit` policy, the same
  guard as `outline_edit`: only a dropped `[page::]` or a dropped `^anchor`
  another note links to is refused, as an error with nothing written, unless
  `allowStructural`. Before, every patch got the strict prose check, and a
  dropped `[[link]]` turned the whole patch into a proposal. The prose check is
  opt-in (`policy: "prose"`); its refusals still become proposals. A patch
  stays atomic, and a proposal reads as one edit of N changes. The mod's
  `outline_patch` takes `policy` and `allowStructural` (#263).
- A store opened at `:memory:` takes no ownership lock, so tests no longer leave
  a `:memory:.owner.sqlite` file in the working directory (PIE-510).

### Merged without an entry, Sep 22–30 (added in the PIE-502 catch-up)

These shipped with README or PR notes but no changelog line. Newest first.

- macOS parity: a leftover file at a socket path (`ENOTSOCK` on macOS) reads as
  a stopped outline rather than a busy one, and the artifact cache is resolved
  to its real path before a build, so pinned packages load under `/tmp` and
  `/var` links (#257).
- Claude mod: the `whereAmI` context names the ep0ch skill and its `peek`,
  `actions` and `act` commands, so a door agent knows how to drive the door
  (#256). The first door-tile `show` routing is #249; #251's entry below
  describes the current behavior.
- Detail links survive an embedded note whose title has parentheses: resolved
  text is no longer re-parsed, and `((uuid|Label (with parens)))` keeps its
  whole label (#247).
- Recent Mentions from a folder bound to a hosted outline is accepted, and the
  mod expands `~` in `PI_OUTLINER_MENTIONS_WORKSPACES` entries (#246).
- Opening from Herdr never creates an outline by itself: in a folder with no
  outline, **Choose outline** lists the known outlines (running or stopped) and
  offers **New outline here**; Esc creates nothing. `service-only` refuses in
  such a folder (PIE-458, #241).
- The client and service survive Bun 1.4's repeated socket errors (`EPIPE`);
  the suite passes on Bun 1.3.14 and 1.4.2 (PIE-454, #240).
- CLI `create` and `update` take `--author user|agent|system`, `--actor` and
  `--session`, and the new `activity` command reads `activity.recent`
  (`--limit`, `--since`, `--after`, `--author`) (#238).
- A Preview that already shows a note narrows to one checklist step when that
  note reloads with a step anchor (PIE-446, #235).
- A `jira::` line shows the ticket's stored details beneath it in Detail
  (accepted forms include floatty's `- jira:: --comments`), and a ticket page
  shows its ticket at the top. Reads never contact Jira. Capability
  `resources.projection` (PIE-445 slice 1, #234).
- Backlinks carry service facets (kind, stage, placement, comment
  resolution; capability `references.backlinks.facets`). Detail and Backlink
  Peek group them by kind with stage counts, hide the note itself, its
  descendants and resolved comments by default, and filter with `k`, `t`, `h`,
  `n` and `/` (PIE-442, #233).
- Checklist requests report missing `query`, `target.start` and
  `expectedRevision` as caller errors, and generated step anchors are short
  (`^t-daca0f`); existing `^task-<uuid>` anchors still work (PIE-443, #232).
- `properties.preview { text }` returns the block properties and every token a
  save would parse, from the save-time parser; CLI `properties-preview`
  (PIE-401, #222).
- `blocks.read { ids, fields? }` reads up to 1000 blocks in one request with
  field projection, and `blocks.query` accepts `fields`; CLI `read <id>…
  --fields` and `list … --fields` (PIE-400, #221).
- Virtual branches take `[expand-when::…]` to reveal collapsed paths to
  matching blocks, such as open high-priority comments, inside the view's budget
  (PIE-379, #197), and `[child-depth::0..8]` and `[expanded::false]` to bound
  descendants and start roots collapsed; **Reset view expansion** restores the
  view's policy (PIE-378, #196).
- Claude mod: Work IDs, `[[page]]` and `((uuid))` in Claude replies are links.
  A click opens the target in a Detail that Claude owns, split below its pane
  and reused, never taking focus; the `show` tool opens a reference there on
  purpose. The CLI gains read-only `resolve <pi-outliner-uri>` and `link …
  --detail-client <id> [--no-focus]` (PIE-359, #192, #193, #195).
- `install.sh --capture-key` binds a global Quick Capture shortcut (default
  `prefix+shift+c`; the comment-on-selection default moves to
  `prefix+shift+a`) (PIE-206, #146).

### Recorded with their PRs

- `draft.patch` has two policies. `edit`, the default, is the guard every agent
  edit has (`droppedLinkedStructure`, shared with `outline_edit`): only a
  dropped `[page::…]` or a dropped `^anchor` another note links to is refused,
  as an error with nothing written, unless `allowStructural`. A dropped
  `[[link]]` or `((ref))` applies, as an ordinary attributed edit when no door
  holds a draft of the note, or into the draft when one does. `prose` (opt-in,
  for tidying the person's words; `outliner patch-demo` uses it) keeps every
  structural token, and what it refuses becomes a proposal as before. Only a
  compare that fails or a prose refusal parks a proposal, and a proposal reads
  as one: `1 proposed edit (6 changes) from @agent: not applied, because change
  1 would … · A applies all`. `outline_patch` takes `policy` (default `edit`) and
  `allowStructural`.
- Outline tools for agents in the Claude mod (PIE-504): `outline_read` (full
  text, properties, revision, bounded children, completeness), `outline_find`,
  `outline_resolve`, `outline_edit` (revision-checked; refuses an empty write
  and dropping a `[page::…]` or a linked anchor), `outline_create`,
  `outline_comment`, `outline_reply`, `outline_resolve_thread`,
  `outline_changes` and `outline_patch` (`draft.patch`), each attributed to the
  agent; and in a door tile `door_where`, `door_peek`, `door_act` and
  `door_open`. They run the new CLI `agent` command. CLI `comment` takes
  `--author agent --actor`, and `activity` takes `--actor` (service capability
  `activity.actor`, which also gives `activity.recent` a `beforeCursor` so
  `outline_changes` pages back through a cut answer instead of skipping it). An
  agent's `note_section` and `work_body` refuse dropping a `[page::…]` or a
  linked anchor too.

- Fresh workspaces get seed 6 of the Documentation hub (PIE-502). The agent
  guide describes the boolean saved-view grammar, `[child-depth::…]`,
  `[expanded::…]`, `[expand-when::…]` and `views.planWrite`, page rename by
  editing `[page::…]`, literal regions, nested transclusion through the service,
  write attribution and `activity`, and that `outliner_publish` is not web
  publishing. The tour adds working selections, Preview comments, folding,
  grouped Backlinks, **New Tree**, and a section on outline names, publishing,
  the Claude Code mod and ep0ch-door; its example view uses an `OR` query.
  Existing workspaces are never reseeded.

- Published blocks run claude.ai artifacts: attach a downloaded `.html`,
  `.jsx`/`.tsx` (React, compiled on the server with `Bun.build`, never run
  there; claude.ai's packages fetched pinned into `<state root>/publish/artifacts`;
  shadcn/ui and Tailwind included), `.svg`, `.mermaid`/`.mmd`, `.md` or code file
  and it works at its URL, sandboxed with an opaque origin. Embeds on published
  pages (and in rendered markdown attachments) now show the embedded note's text,
  published or not, within the service's transclusion limits; `[[page]]` and
  `((block))` links in rendered markdown attachments link published targets; and
  `[publish::never]` locks a note and everything under it from every page, embed
  and link. See README "Artifacts".
- Claude mod: a session started in an ep0ch-door tile (or the door's Herdr agent
  pane) is told where it runs. At session start the mod runs `ep0ch where --json`
  (read-only) and gives its one-line summary to Claude as the `whereAmI` context
  block of the first prompt: the stack of layers from `EP0CH_NEST`
  (`ssh:pts/5 › door:<pid>/desk/t1:claude`), what is live, and where the person's
  keys are. Without an `ep0ch` that knows `where`, it gives the variables alone,
  marked unchecked. Outside a door it does nothing.

- Outline as server: `outliner publish serve` gives every block carrying
  `[publish::…]` a URL on 127.0.0.1 (`/p/<page address|block id|slug>`), serving
  an attached `.html`/`.md` file or the block and its subtree as markdown (with
  `?view=html`), and `/index` lists them all. Read-only; attachments are served
  only from allowed roots, never through `..`, escaping symlinks, hidden paths
  or non-regular files, never from `/` or the home folder, and not at all when the
  service runs on another machine. Attached HTML runs sandboxed, with an opaque
  origin. Embeds, titles and links never show an unpublished block's text or id.
  Any `[publish::false]` on a block wins, and a request naming a foreign Host is
  refused.
  Expose it with `tailscale serve --set-path /pub`. See README "Publishing blocks".

- In an ep0ch-door tile, `show` and a click on a reference open the note from
  Claude's own tile (`door-open --from $EP0CH_TILE`): the door puts it where
  that tile's opens land and says which reader, instead of the mod assuming a
  tile called `middle` (ep0ch-door PIE-491). A door without that tile, or older
  than `open from=`, is asked for its `middle` reader as before, then for none.

- The service plans writes into saved views (PIE-490). `views.planWrite` says
  what moving a block into each view would patch (with token ordinals, at the
  block's revision), or what a new block there is born with, and why not when a
  patch can't satisfy the view's query; `query.matches` says which of given
  blocks a query holds for. The property token grammar moved into
  `src/property-grammar.ts`, one definition the parser, the query language and
  context resolution share, and `ping` reports its version for clients that
  copy it. ep0ch-door uses all three instead of its own copies. Additive
  capabilities `views.planWrite`, `query.matches`, `ping.propertyGrammar`.

- Rename or remove a page by editing its text. Changing `[page::x]` to
  `[page::y]` in Detail, Tree, `outliner update` or any client renames the page
  (`[[x]]` stays an alias, so links keep resolving; renaming back promotes it);
  deleting the token frees the address. Saves were refused before with "requires
  pages.rename" / "requires pages.remove". An address another note owns is
  refused as `[[y]] is already the page of block <id>; pick another name`, and
  nothing is saved; an owner in Trash is named as such. Work IDs stay immutable.
  Quick Capture's idle draft saves are provisional: a page name corrected
  before Save to Inbox leaves no alias behind.

- Fragment completion searches every note (PIE-424; fixes PIE-295's
  "Searched only 500 blocks"). `fragments.candidates` finds `((note#heading` /
  `((note^anchor` targets across all active notes by the service's fragment
  rules, the draft's note first; an unanchored heading comes with the anchor it
  would get, and `fragments.ensure` writes it with a revision check. Detail,
  Tree and Quick Capture use them (with the old bounded search against an older
  service). `transclusions.read` now sends each note and its steps once, parses
  a note once per revision, stops scanning a document past its 17th embed, and
  caps a read at 512 KB (`EMBED TOO LARGE`). Additive capabilities
  `fragments.candidates`, `fragments.ensure`.

- Workspace and connection: Copy on **Client protocol** copies the number
  alone; "needs service ≥ N" is the field's note, shown as before (PIE-355).
  After leaving an edit with retained writing, the status names Alt+R and the
  actions menu; compact chrome has no header cue for Writing history.

- The service owns fragment slices and nested transclusion (PIE-424).
  `fragments.read { blockId, fragmentId }` returns what `((id^fragment))`
  covers: its kind, label, note lines, offsets and the text a reader shows (a
  step with its nested content, a heading's section, a paragraph), or
  `missing` / `duplicate`. `transclusions.read { targets, hostBlockId?,
  maxDepth? }` projects `!((id))` and `!((id^fragment))` nested to a bounded
  depth (default 3, ceiling 6), stops at a cycle (`CYCLE · this embed is
  already open above it`) and past the depth (`DEPTH LIMIT · embeds nest N
  deep`), keeps Detail's 16-per-document limit, and caps a read at 64 embeds;
  each ready projection carries the checklist steps inside what it shows.
  Both are additive capabilities; no protocol bump. A heading's section no
  longer ends at a `#` line inside a code fence, and fragment completion no
  longer offers headings inside code. Detail's embeds take their limit and
  wording from the same module (`src/transclusions.ts`), and neither Detail
  nor `transclusions.read` expands `!((…))` written inside fenced or indented
  code.

- Clients name their outline on the outline host (PIE-457 step 3).
  `OutlinerClient` sends `outline` on every request and subscription, and
  refuses a single-outline service when a name is asked for. The endpoint is
  `OUTLINER_OUTLINE` (global CLI flag `outliner --outline <name> <command>`),
  else one folder rule (`resolveFolderOutline`): the nearest bound folder
  walking up (`client.json`), else the git repository root's name, else the
  folder's name, never `$HOME`, `/` or `/tmp`-like folders (those need a name;
  Ctrl-b u shows the chooser). A guess applies once a host is set up
  (`outlines/` exists), also while it restarts: such a client waits for the host
  and never falls back to a hash database. `outlines.attach { name, create,
  root? }` and `outlines.create { name, root? }` record the outline's folder in
  `outlines/<name>.json`; its resources, file links and Inbox use it, and a
  guess from another same-named folder does not take it. Only the opens that
  open panes create (not `focus-existing`, not Pi's check). Panes register
  their outline; Herdr actions invoked from a pane (ensure-detail,
  focus-existing, link clicks, comment on selection) use it through the host's
  new `outlines.pane`. Herdr panes all get `OUTLINER_OUTLINE`; no service pane
  in host mode. New host requests `outlines.close` and `outlines.delete`; new
  action **choose-outline** (the switcher). `outliner outlines` lists an
  adopted database once, with `running`/`stopped`/`broken` from the host.
  `doctor` shows the host and how the outline was chosen. The host exits after
  5 contained faults within a minute, for systemd to restart it.

- One outline host per user and machine (PIE-457, steps 1 and 2). `bun run host`
  (`src/host-main.ts`) listens on `<state root>/outliner.sock` and serves every
  outline in `<state root>/outlines/`: it reads the first line of each
  connection and hands the whole connection to the outline its `outline` field
  names, or to `OUTLINER_DEFAULT_OUTLINE` when it names none, so existing
  clients reach the default unchanged. Outlines open on their first request and
  stay open; one that cannot open (corrupt, or held by another process) fails
  only its own requests. The host answers `outlines.list`, `outlines.create
  { name }` (the only way a new outline is born) and `outlines.adopt { path,
  name }` (serve an existing database where it lies, through a symlink; refused
  while another process holds it). `ping` adds `host` (capabilities
  `outlines.list`, `outlines.create`, `outlines.adopt`, `ping.host`,
  `request.outline`). `outliner outlines` lists through a running host, and
  `outliner outline create <name>` / `outline adopt <path> <name>` ask it.
  The single-outline service is unchanged and refuses `outlines.*`.

- Outlines have names (PIE-457, service side). Each database describes itself
  in `outline.json` (`name`, `root`, optional `label`, `host`, `created`,
  `updated`), written by the service on start. A new outline is named by
  `OUTLINER_OUTLINE_NAME` or its folder's basename, with a numeric suffix on
  collision; a name is unique in the state root, and a service refuses to start
  when another outline, running or stopped, has its name. While running, the
  service publishes `<state root>/by-name/<name>.sock` and `ping` reports
  `outline` (capability `ping.outline`). `outliner outlines [--json]` lists
  outlines by scanning; `outline rename` and `outline set-root` change a
  stopped outline explicitly (by name or storage key; an ambiguous name is
  refused), and `OUTLINER_OUTLINE=<name>` starts the service
  on a moved outline's existing database. Starting by folder at a root another
  outline already claims is refused instead of creating a second database.
  Writing the descriptor or the link never stops a service: failures are
  logged and it keeps serving on its hash socket, and an unreadable descriptor
  is left in place. Clients still address local outlines by hash until they
  resolve names.

- Who moved, trashed or restored a block: `move`, `delete` and `trash.restore`
  accept an optional `mutation` (capability `mutations.provenance`), recorded
  like an update's in the change feed's `actor` and in activity, as `move`,
  `delete` or `restore` entries. `activity.recent` returns them when asked with
  `kinds`; by default it still returns edits only. Without `mutation` nothing
  changes. The CLI's `move` and `delete`, the new `restore`, and Pi's
  `outliner_move` say who made the change, as do the Tree's and Detail's
  moves, trashing and restores (the person, through `tree` or `detail`) and the
  Inbox worker's (`inbox-agent`, as its edits already were). A trash entry is
  hidden once its block is out of Trash. The CLI's `--author agent` now needs
  `--actor` on every write, including `create` and `update`. The activity table
  is rebuilt once on startup to allow the new kinds, keeping every row whose
  block still exists, its ids and cursors; the rebuild checks its copy before
  replacing the table. **Downgrading:** an older build reads the new `move`,
  `delete` and `restore` rows as if they were edits (Pi's recent-edit context,
  note assistance and edit recovery would count them), and its own table
  definition keeps the widened check. PIE-451.

- Items with several deliveries: `work deliver --key <name>` records a PR as
  its own delivery (`PIE-123/<name>`); without a key, a PR in another
  repository than primary's is named after its repository instead of failing
  with "conflicting repository". `work complete` takes several `--delivery`
  values or `--all-merged`, and is refused while any other delivery is
  incomplete, naming it and how to finish it, so none is left in Validate under
  a Done item. `work set <delivery> delivery-stage complete|validate` finishes
  or reopens one merged delivery, revision-checked. `work help` prints the
  synopsis. Pi's task completion and the Claude `work_*` tools share the same
  rules. No service change. PIE-447.

- Agent workboard commands: `work create`, `work stage`, `work set`,
  `work deliver`, `work complete`, `work body` and `note section` in the CLI,
  and matching `work_*` / `note_section` tools in the Claude mod. Items are
  named by Work ID or block UUID; writes are checked against the revision read
  and read back; results name the Work ID, block reference and new revision.
  `work deliver` reads the PR through `gh` and refuses one whose branches differ
  from the delivery's; `work complete` needs the named delivery merged and
  records the proof. Pi's task completion uses the same code, and a
  multi-paragraph `outliner_publish` artifact is now typed as block metadata
  rather than as an inline property. PIE-438.

- Literal regions: text between `<!-- literal -->` and `<!-- /literal -->`
  lines shows outline syntax as plain text. Bracket, bare `key::` and hashtag
  properties inside are not stored, queried, indexed or previewed; links still
  resolve. Detail hides the marker lines and warns about an opening marker with
  no closer, which protects nothing. Titles skip marker lines. A property
  appended to a note that starts with a region goes on a line before it, where
  it is block metadata. Property parser version 4: the service
  re-indexes existing notes on startup without changing their text, and
  `properties.preview` reports `parserVersion` 4. PIE-422.

- Detail comment threads render comment and reply text like note text:
  `[[pages]]`, `((blocks))` (with resolved titles) and Work IDs are links you
  can click or reach with Tab and open with Enter, and bold, italics and code
  render. Headings, fences, tables, rules and HTML blocks in a comment show as
  plain lines so the thread box stays intact. A link that wraps is one Tab
  stop, `<https://…>` links its address and `[1]: https://…` lines stay
  visible. Block titles for every comment come from one request; if the
  service is slow, comments show linked block IDs instead of waiting. Backlink
  titles and snippets containing `[` no longer show stray backslashes, and a
  backlink title such as `Meeting [draft] notes` links as a whole. No service
  change. PIE-421.

- Tree's **Advanced property filter** accepts the query grammar: `OR`, `NOT`,
  parentheses and `created`/`updated` ranges, for example
  `status=open OR status=review` or `NOT status=done updated >= -7d`. Clause
  lists are sent exactly as before and keep their meaning, including
  `deleted=true`. Invalid queries show the character position and keep the
  previous filter. Uses the existing `query.expression` capability. PIE-192.

- Content events now say what changed: block, parent (and previous parent for
  moves), revision, change kind and declared actor. A client that reconnects
  can ask `changes.since` for exactly what it missed, in order, or get an
  explicit reset when history is gone. Tree skips index reloads the feed shows
  are already reflected and keeps its index across a reconnect with no changes.
  The service advertises the `changes.since` capability; restart the service
  to use it. PIE-399.

- Clients negotiate with the service instead of requiring the same protocol
  number. `ping` reports `capabilities` (`blocks.read`, `properties.preview`)
  and the oldest client protocol it serves; a newer service is accepted, and a
  client fails with a restart instruction only when the service is too old or
  lacks a capability it uses. `doctor` lists the service's capabilities.
  Additive features now add a capability rather than bumping the protocol.
  Protocol 82 introduces negotiation, so restart the service and clients once
  when upgrading. PIE-402.

- Saved views and block queries can use `OR`, `NOT`, parentheses and
  `created`/`updated` ranges: `work-stage=review OR work-stage=validate`,
  `NOT status=done`, `NOT priority`, `updated > 2026-09-20`, `updated >= -7d`.
  Existing clause lists keep their meaning. Invalid queries fail with the
  character position (`views.read` problems, `blocks.query` error `problem`)
  instead of returning nothing. Available in `[query::…]`, `blocks.query`
  `expression`/`where`, CLI `list --query` and `outliner_query`. Service
  capability `query.expression`; restart the service to use it. PIE-398.

- The service evaluates saved virtual-branch views. `views.read` returns a
  view's members in branch order with its authored limit, paging (`offset`,
  `nextOffset`), an exact `total`, truncation and structured errors, from one
  read transaction. Tree, the branch navigator, Detail view embeds, CLI `view`
  and `outliner_view` now read membership through it instead of evaluating the
  query themselves. Service capability `views.read`; restart the service to
  use it. PIE-397.

- Keep ticket-key autolinks outside complete Markdown URL spans. Plain and
  angle-bracket URLs, including Jira smart links, stay one destination through
  narrow wrapping; adjacent bare ticket keys still open local pages. PIE-392.

- Install the declarative status-summary renderer independently of the app.
  Detail, Tree Preview and Inbox Preview share responsive labelled counts,
  links, copying and comments. Disabled or missing installations preserve
  readable, editable source; reopen the note after configuration changes.
  Resizing and folding retain the open document’s renderer settings.
  Installation lifecycle and narrow-reader behavior now have a repeatable
  native application journey. PIE-382.

- Detail and Preview share cell-level source evidence for rendered copying and
  comments, including formatted text, tables, Unicode and repeated embeds.
  Comments retain immutable quotes and separate source fragments; ambiguous
  edits stay unpositioned. Saved Inbox versions retain their processing attempt
  and cannot assign IDs into live checklists. A developer provenance inspector
  explains source ranges and generated cells. An optional declarative status
  component uses the same responsive layout and evidence contract. Protocol 81
  adds passage observations and fragment resolutions; restart service and
  readers together when upgrading. PIE-350.

- Create a quoted block comment through `outliner_comment` or CLI `comment`
  without constructing annotation internals. Exact quotes require unique context,
  stale revisions fail atomically, and retrying a saved request does not duplicate
  comments even after checklist identity assignment. Source-aware readers share
  quote resolution. Protocol80 adds the convenience operation to the existing
  annotation batch ledger. PIE-377.

- Agents and CLI users can read saved virtual-branch matches in branch order
  without opening a pane or translating the query. Reads honor authored limits,
  report incomplete/invalid/unsupported results and reject mixed reads after a
  concurrent workspace change. Tree and agent reads share membership evaluation.
  PIE-376.

- Checklist steps keep stable fragment addresses through rewording and reordering.
  Pi/ANSI Detail and Preview offer monochrome status pickers, keyboard toggling,
  Copy step link and Undo, including embedded steps. Targeted agent updates
  preserve neighboring text; whole-note rewrites require explicit intent to
  remove task addresses. Comments follow item identity while retaining their
  original quoted evidence. Live checklist views correlate status and properties
  on the same step across canonical plans and update their originals. Protocol
  79 adds checklist operations and item-attached annotation targets. PIE-367.

- Tree groups root comment threads under one collapsed Comments row per displayed
  note. Open it by mouse, Space or Enter; replies remain under their own thread,
  ordinary children remain visible, and physical/virtual occurrences expand
  independently. Direct reveal opens the comment path without copying or moving
  discussion. Counts name projected root threads, excluding replies. PIE-383.

- Detail Comment supports a whole-note target without selecting text. General
  comments appear under Note comments, separate from lost passage anchors.
  Detail's local Preview composes and replies in place, preserving Current and
  protecting unsaved Preview drafts. Local Tree and Inbox readers share comment
  display and composition; Inbox Before comments retain their saved receipt and
  source identity. Comment typing takes precedence over Inbox shortcuts.
  Drag-selected local Preview passages retain their quoted text without guessing
  source offsets. Inbox navigation and receipt updates preserve active drafts;
  completed Escape input no longer consumes the next Tree shortcut as Alt.
  Keyboard passage selection uses v, arrows and Shift+arrows in the visible
  Preview viewport. Preview comment actions appear in the shared action menu
  and have their own configurable shortcuts, separate from Tree browsing.
  Short composers keep writing and save/cancel controls visible. Saved-version
  readers preserve proven historical ranges; unchanged plain text can retain
  exact coordinates while transformed layouts keep honest quoted evidence.
  Protocol 78 adds the whole-subject anchor and captured Preview/Inbox evidence.
  PIE-290.

- PIE-396: Tree `/` temporarily fuzzy-filters the selected occurrence's descendants,
  preserves rank and ancestry, searches collapsed content within projection limits,
  and restores the browsing context on Clear/Escape. The selected-items menu adds
  full-order before/after placement; filtered nudges explicitly include hidden items.
  Structured property queries remain under Advanced property filter.

- Collect Tree items with `x` or row checkboxes, inspect the finite set with
  `Shift+X`, copy canonical references or verified page links, and rank selected
  roots together in an unsorted virtual branch. Focus stays independent;
  selections survive restarts with explicit recovery and Clear. Protocol 77.
  PIE-240.

- Compact Tree, Detail and Preview chrome gives rows back to content. Shared
  searchable menus retain actions and shortcuts, Expanded layout remains
  available, and document titles use the Herdr frame with a standalone fallback
  and respect for custom pane labels. Density is a client preference; note text
  stays unchanged. PIE-385.

- Fold headings and nested list content locally in Pi Detail and Preview. Mouse and keyboard disclosures preserve nested choices, hidden links leave navigation, and fragments or comments reveal their enclosing sections. Copying omits generated arrows without deleting authored glyphs. Fold state never changes canonical text. PIE-386.

- Properties supports direct value copying and link following. Ordinary values copy on click; linked values expose a separate Copy control. Full canonical values survive wrapping, repeated keys stay distinct, and multiple embedded links have individual mouse/keyboard targets. Editing remains explicit. PIE-387.

- Quick Capture can dock left, right or below the Outliner and return to a popup while preserving its draft, cursor and selection. Editor launches use the existing recovery journal; History / Ctrl+R reviews conflicting writing before a revision-guarded save, and short panes keep the editor cursor visible. Prepared notes stay protected from assistance until Save to Inbox. A global `capture-editor` action opens that same note directly in a right sidebar editor; repeated entry returns to the live owner instead of opening a competing draft. Protocol 76. PIE-335.

- Workspace and connection groups diagnostic fields and supports drag-copy, per-value Copy buttons and keyboard field navigation. Long values copy in full without labels or wrap breaks; remote client paths stay distinct from service storage. PIE-355.

- Ordinary mouse selection and copying no longer protect Detail navigation. Retained quotes are retired when the document changes, including delayed capture replies; actual edit and comment drafts remain protected (PIE-384).

- Add a canonical first child directly from a virtual-branch result in Tree, retaining the exact occurrence context. Collapsed results open locally; depth and row-budget limits refuse before creation. PIE-148.

- Reordering a virtual branch works when that same branch also appears in another projection. Moves stay within the selected appearance and update the shared branch order, including hub embeds. PIE-395.

- ANSI Detail keeps the writing-recovery dialog visible when its pane is resized; redraw no longer waits for the open dialog to finish.

- Remove redundant test-only Store/Pi surfaces while retaining coverage through production APIs. PIE-369.

- Tree Enter opens the selected note without leaving Tree; repeat within one second to focus the same Detail, or use Alt+Enter to open and focus immediately. Draft protection and missing-destination recovery still apply. Protocol 75 requires updating the service and clients together. PIE-364.

- Jira is an installed read-only Resource extension with explicit Basic/Bearer authentication; built-in Jira HTTP, ADF and comment code is removed. Source credentials now belong to extension configuration. Protocol 74 fences the changed Source contract; service and clients must be updated together. PIE-380/381.

- Detail labels retained drafts as Writing history; actual recovery errors keep their needs-attention message.

- External-editor return automatically combines independent canonical edits into the current draft, including a newly added final newline. Clean merges no longer require the multi-version recovery dialog; Ctrl+S saves with the revision guard and exact original writing remains recoverable. Actual overlaps still require review. PIE-365.
- Human note edits can remove a `[page::…]` declaration when saving. The note and existing aliases remain; stale saves and Work ID changes still fail atomically.

- Claude Code Recent Mentions follows sessions into subdirectories of configured workspaces. The nearest configured ancestor supplies the destination database; similarly named siblings remain excluded.

- Bare external ticket keys such as PC-7 link to registered local page addresses alongside the workspace's own Work IDs. Tree, Detail, Preview, Backlinks and Recent Mentions share recognition; external keys never allocate tickets or fetch Jira during rendering. PIE-357.

- Quick Capture shares contextual reference completion with Tree and Detail, including pointer insertion, multiline drafts and Escape-to-dismiss (PIE-232).

- Tree’s Workspace and connection action and CLI `doctor` expose resolved config, endpoint and service storage identity without creating or moving data. Startup failure logs include connection paths. Actual laptop relocation recovery remains a separate verification step (PIE-337).

- Detail and Tree reference completion filter while typing, show target kind and selected context, and accept mouse or keyboard choices through one provider. Escape retains the draft; stale replies and deleted/reassigned targets cannot silently insert old choices. Work-ID labels omit nested reference syntax. PIE-295.

- Authored local file references open in Preview beside the daily note through keyboard or mouse, retaining Current and its draft. Rendered Markdown file links navigate to outline pages; missing files show an error without replacing the note. PIE-323.

- Cleaned and split notes link directly to Original capture; later rewrites also expose Before this rewrite. Merges preserve each source, snapshots reuse Inbox recovery evidence, and Preview follows them in place. New cleanups establish the links atomically. Protocol 73. PIE-345.

- Detail retains returned external-editor writing and ordinary save conflicts in a visible Recover writing flow. Compare original/local/latest versions, combine independent edits, request a reviewable Pi proposal, or keep a separate quoted draft. Recovery survives reopen; saved history offers Restore draft and Undo save as new reviews. Canonical saves remain revision guarded. Protocol 72. PIE-333.

- Pi Detail includes document body links in Tab/Shift+Tab traversal, with visible focus and canonical Enter activation. Property focus follows scrolling and keeps wrapped entries visible after resize in Current and Preview. PIE-346.

- PIE-331: Jev routes Inbox captures to keep, metadata, reversible archive or Pi editorial work; activity records the decision. Editable prompt and paired live comparison document costs, recovery and limitations.

- Inbox proposals can repair validation errors before finishing, within the same Pi session and budget. Attempt history explains retries and failures; prompt evidence shows active/package differences. PIE-330.

- Inbox activity reports effective metadata changes and no-ops, labels aggregate model-work time, and retains visible structured omissions for bounded retrieval, incomplete reads and skipped/failed relationship checks. Historical coverage stays explicitly unknown. PIE-328.

- Recent agent mentions in Tree/Detail menus, with canonical previews, conversation scope, message context, clear/save/bookmark controls, and a workspace-scoped Codex completion adapter. Protocol 71 requires a coordinated service/client restart for the new mention RPCs. PIE-325.

- Tree connection groups include Backlinks and support explicit nested disclosure on resolved block targets. Siblings retain independent state; cycles expand only by user action. PIE-324.

- A missing or closed linked reader offers Enter/click to Open here once, a destination choice, or Cancel. Tree and Inbox keep their list while Detail retains draft protections. PIE-332.

- Outlinks omit repeated titles and Work-ID prefixes while retaining custom labels, fragment names and occurrence counts. PIE-329.
- Tree and Inbox Preview follow links in place, with local Back/Forward history, keyboard link selection and explicit Open in Detail. Dragging links still copies text. The destination picker retains the browsed target. PIE-326.

- Inbox review shows Activity above independently scrollable Source/Output readers when space permits, with draggable dividers and a compact fallback. Inspect saved **Before this attempt** text without Undo; current source remains separate. Technical details collapse and errors remain visible. PIE-320.

- Inbox history can be searched across all retained attempts using original capture titles, summaries and current Source/Output text. Text matches remain usable offline; optional Jev reranks a bounded shortlist using the editable Goto prompt. Cancellation restores the browsing context. The new `inbox.search` RPC requires protocol **70** and a coordinated service/client restart; capability negotiation remains a separate architecture follow-up. PIE-319.
- Inbox now opens typed Source/Output content instead of incidental session logs, exposes reader linking, and shares Tree's rich Preview reader with separate Activity controls. PIE-317 / PIE-318.
- Tree Preview has mouse controls for visibility, right/bottom/automatic placement, size buttons and divider dragging. Prefix+Shift+U and **? → New Tree** open an independent Tree without a companion Detail. PIE-315 / PIE-316.

- Clicking Tree returns keyboard focus from local Preview in beside/below layouts. Delayed selection-publication echoes cannot replace a newer Preview.

- Creating a Detail from Link destination now links the original view to it, including sidebar placements. Ordinary split commands keep their existing links.

- Tree now keeps an interactive projection-aware breadcrumb and reclaims offscreen ancestor indentation (PIE-304).

### Capture and AI instructions

- Tree can focus an occurrence as its root or open independent rooted Tree splits. Shift+Left/Right fold/reveal one hierarchy layer. Nested query results survive collapse of their physical source folder. PIE-303 / PIE-292.
- Inbox deadlines fail only the current note and let other pending work continue. The total editing budget defaults to five minutes and can be configured with `OUTLINER_INBOX_TIMEOUT_MS`. PIE-310.
- Inbox editing and bounded note answers retain native Pi sessions per attempt. Select an activity result and press `t` to inspect its transcript through the service; early interruptions are explicitly labelled snapshots. Canceled attempts remain inspectable without suppressing retry or consuming new instructions. Protocol 65; restart service and clients together. PIE-311.
- New and meaningfully edited ordinary notes receive automatic type/tag assistance. Hashtags share the property index, semantic calendar tags follow authored dates, and human corrections survive restart. Direct supported requests can be answered in the original note; complete property inventories bypass autocomplete limits. Existing notes require explicit opt-in, and tickets/other managed records retain their contracts. PIE-302.
- The hashtag/property change requires protocol 64. Restart the service and all clients together, including remote clients; older editors use incompatible property positions.
- Inbox opens directly on outstanding questions or errors, including failures older than the recent-results page. The highlighted attention count and destination-labelled shortcut keep unresolved work easy to find; history remains available without automatic view switching.
- Quick Capture retains text and cursor across closing/reopening, inserts new captures at the top of Inbox, and supports generated titles for `/send-to-outline`. Payload-bound receipts and retained uncertain submissions prevent a retry from discarding newer text. [#84](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/84), [#85](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/85), [#86](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/86), [#120](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/120)
- A service-owned automatic Inbox editor uses the configured Pi model, with optional Jev relationship judgments. Tree `Shift+I` opens results, questions, Pause/Resume, guarded Undo, and directed reconsideration. Ordinary notes stay notes; concrete tasks enter Backlog without joining a committed batch. This is a single-user editorial experiment. [#141](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/141)
- Inbox and Goto instructions are editable Markdown/JSON file Resources. Saved changes apply to the next job/search; running jobs keep their captured instructions. Workspace prompt files survive upgrades, and results retain their exact text, path, and hash. Invalid files produce visible errors instead of stale fallbacks. [#142](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/142)

### Navigation and reading

- **? → Inspect received keys** in Tree/Pi Detail shows raw bytes, Unicode and decoded modifiers inside the existing pane. It distinguishes Option-produced characters from actual Alt shortcuts without executing them. Ctrl+Q closes only the inspector; no keystroke log is persisted.

- Standalone Tree keeps rich Preview beside its own rows regardless of detached Details. Tree and Detail expose persistent **Opens in / Change**, with Shift+L as an Alt+L fallback. Link settings remain available in Properties; active edits/filters receive an explanation without losing their text. New readers can be placed beside another Detail, or as left/right sidebars around the Outliner area or whole Herdr tab. Existing terminal sessions and saved links survive placement. Protocol **69** requires a coordinated service/client restart. PIE-305 / PIE-306.

- Tree/Detail destination pickers show document titles, Herdr workspace/tab locations and a rich selected-document preview; unlocated/other-host readers are opt-in. Preview uses available beside/below space, supports `Alt+P` and contextual Escape, and Tree-local Preview wraps Markdown and bounds pointer selection/copy. Each Tree can compare viewport versus selection indentation with `Alt+I` or its Indent badge. PIE-304 / PIE-305 / PIE-306.

- `Alt+L` in Tree or Detail chooses its linked destination. Explicit Open follows that source-to-Detail link or a one-off destination. Pane movement does not change links; missing destinations report recovery choices without automatic splits. Current stays in place while passive selection updates a separate local Preview (`F7` switches, `Shift+F7` closes, `Alt+Enter` keeps). Drafts and active source selections protect replacement. Runtime reader locks and spatial reader pools are removed; transient watchers register as observers. Herdr reader reuse follows the Tree’s link. PIE-223 / PIE-305 / PIE-306.
- Protocol **68** removes reader-lock wire fields and adds the observer role. Restart service and all clients together. Workspace ownership locks and retained Resource revision protection remain independent. PIE-306.

- Tree `g` opens searchable results with location context and a document preview, in a Herdr popup or inside Outliner. Optional Jev ranking scores up to 80 text-selected candidates; 30 results are shown with limits disclosed. Exact identities and ordinary search work without Jev. [#139](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/139)
- The opt-in `open-composed` action places Tree and Detail in one pane, with local navigation, independent view state, `F6` region switching, and explicitly detached readers. The separate-pane layout remains the default. [#133](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/133)
- Reorder appears in the action menu and keybinding registry. Defaults are now Option/Alt+Up/Down for Tree reorder and Option/Alt+Shift+Right/Down for independent Details. At that release, locked Detail used `🔐` and unlocked used `🔓`; PIE-306 removes both indicators. [#138](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/138), [#136](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/136)
- Nested Tree inline previews stay occurrence-local. Bookmark mouse reports no longer trigger the keyboard removal shortcut. [#134](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/134), [#135](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/135)
- Canonical bookmarks, virtual-branch navigation, explicit Detail destinations, attention marks, typed walkthroughs, and external editor handoff support longer reading sessions. Editor recovery preserves drafts and discovers the interactive-shell editor configuration. [#78](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/78), [#79](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/79), [#103](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/103), [#105](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/105)

### Resources and comments

- Durable Resource UUIDs and provider-qualified Sources cover filesystem, web, PDF, Jira, Linear, application, and computed providers. Immutable snapshots and representations retain provenance and provider revisions; host negotiation and dependency-aware retention preserve the same identity across presentations. [#90](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/90), [#97](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/97), [#98](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/98), [#99](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/99), [#100](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/100), [#101](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/101)
- Tree **Show authored links** projects Outlinks and Resources without creating targets. Detail activates authored `[file::…]`, `[web::…]`, `[jira::…]`, and `[app::…]` occurrences by exact block revision and source span; repeated references stay distinct in Properties while sharing one Resource. [#111](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/111), [#130](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/130)
- Durable block and Resource annotations retain original evidence and append-only reconciliation history. Direct selections support filesystem text, cached web Markdown, and extracted PDF text; unresolved changes can receive bounded agent-assisted proposals. [#94](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/94), [#95](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/95), [#96](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/96), [#108](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/108), [#110](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/110)
- Comments distinguish a Resource-wide thread from a particular authored reference and its passage. `[`/`]`, `Shift+C`, and `Shift+D` navigate, reply, and resolve/reopen in place. Stale or ambiguous anchors remain reachable under **Unpositioned comments** instead of marking unrelated text. [#129](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/129), [#131](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/131), [#132](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/132)
- Multiline comment composition uses the actual body geometry to keep the cursor visible. [#112](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/112)

### Persistence and recovery

- A service acquires exclusive workspace ownership before writable startup, migrations, or recovery, so a competing launch cannot interrupt the active owner's work. [#119](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/119)
- Normal text writes require the integer `Block.revision` from the original read. Stale writes fail atomically; sibling moves no longer invalidate unchanged text drafts. Filesystem revisions also include a hash of the original bytes. [#121](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/121), [#122](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/122)
- Filesystem saves retain the submitted draft and displaced original, preserve competing replacements, and recover interrupted saves. Recovery directories remain available for manual inspection and cleanup. This is recoverable replacement with a brief absent-path interval, not atomic compare-and-swap. [#128](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/128)

### Remote work and performance

- Tree, Detail, popups, CLI, and Pi clients connect through an SSH-forwarded Unix socket. Endpoint configuration is project-scoped, pane identities are host-scoped, and remote Tree/Detail startup opens both panes before awaiting registration. [#115](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/115), [#116](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/116), [#117](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/117)
- File previews and completion read from the canonical service host, including remote clients; passive reads create no Source or Resource. [#123](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/123)
- Tree loads a complete compact structural index and fetches exact bodies on demand. Detail paints primary content before optional enrichment, while its 32-target revisit cache revalidates revisions and passive preview scheduling keeps the newest target. Reused virtual projections and indexed ranked queries remove repeated work without adding a persistent search index or cursor system. [#124](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/124), [#125](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/125), [#127](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/127)

### Workflow and onboarding

- Roadmap items use `work-stage` alone, with Queued replacing Next and Superseded separate from accepted Done. Item-side `work-batch` references preserve committed scope through progress, pause, and completion. Resume and unchanged PR synchronization preserve explicit review/rework state. [#137](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/137)
- Fresh databases use workspace seed version 5. **Explore the Outliner** adds addressable feature guides and working reading/projection examples beside the existing agent documentation guide and authored-links example. Existing databases retain their customized content; package upgrades do not reinstall the seed.
- The guided installer and portable runtime discovery support source-checkout installation. Actual Herdr keyboard journeys use isolated workspaces and retain failure evidence. [#82](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/82), [#83](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/83), [#114](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/114)
- The current JSON-lines RPC protocol is **78**. Restart the service and all clients together when upgrading across incompatible versions; `src/types.ts` owned the version then (today it is `PROTOCOL` in outline-core).

### Known limits

- Tree-generated Resource opens require a valid linked Detail; missing or protected destinations fail before registration. Resource references inside Detail use its shared chooser.
- SSH authored references are application deep links, not source-backed remote files. Tracked as PIE-261.
- Metadata-only Resource fields cannot yet receive direct Detail comments. Tracked as PIE-262.
- Computed and remote-entity cached Markdown cannot yet create direct Detail text annotations. Tracked as PIE-264.

### [0.1.0-dogfood.1] - 2026-08-22

- First tagged dogfood build of the workspace-scoped Outliner service, Tree, Detail, block graph, properties, references, virtual branches, and Pi/OMP integration.

[0.1.0-dogfood.1]: https://github.com/float-ritual-stack/pi-herdr-outliner/releases/tag/v0.1.0-dogfood.1
