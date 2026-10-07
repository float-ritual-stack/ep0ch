---
name: ep0ch-outline
description: Use when an agent works inside a person's outline on their behalf, shaping it to their needs while they work - writing or tidying notes, adding properties, making views, boards and pages, welcome notes and briefings, publishing a page, writing live figures and components into a note (::graph-* with query or view, callouts, images and a header image), adding an extension for a need, or showing them something in their ep0ch door. Covers how they write (properties by placement, soft links, links not directions), outline_edit vs outline_patch, views and hubs, pages and [welcome::n], publishing and [publish::never], the components a note can hold, the four extension kinds, and where the live guides are.
---

# ep0ch-outline: working in someone's outline

The outline is theirs. You are a welcome local who writes beside them: everything you do is attributed, checked
against what you read, and undoable from the record. This skill is a map; the outline holds the live guides,
and they win over this page.

For changing the code instead, use `ep0ch-core`. For driving their door (peek, act, open, marks), `ep0ch`.

## Start here

1. **Know which outline.** Outlines go by name (`~/outlines/<name>.sqlite`, one host per machine serving them
   all). Which one, first match wins: `--ws <name>`, `EP0CH_WS`, the nearest `.ep0ch` (`ws = "<name>"`, and
   `machine = "<ssh-name>"` for one on another machine). In a door tile, `ep0ch where` says; else `ep0ch outline
   list` (or `outliner outlines --json`) and name it with `--ws`. Never write to an outline you guessed: a
   folder that names none names none.
2. **Load the outline's own guide** with the `outliner-documentation` skill's steps: find
   `system-doc=agent-documentation-guide`, then read it whole. It owns how documentation is structured there:
   hierarchy owns, references connect, transclusions compose, properties classify, virtual branches project.
3. **Roadmap work** (items, stages, batches, proofs) follows the live **How this workboard works** block
   and the `outliner-workflow` skill's roadmap reference (`references/roadmap-items.md` beside the path
   `ep0ch --skill outliner-workflow` prints; the `work_*` tools run it). Items are made only by the
   allocator, never by hand.
4. **Look before you make.** Find the existing owner and the vocabulary in use (`outline_find` by text,
   `property`, `hasKey` or `query`) before creating a note, a key or a view.

## Tools

In Claude with the Claude mod (packages/claude-mod): `outline_read`, `outline_find`, `outline_resolve`, `outline_edit`,
`outline_patch`, `outline_create`, `outline_comment`/`outline_reply`/`outline_resolve_thread`,
`outline_changes`, the `work_*` tools and `note_section`; in a door tile also `door_where`, `door_peek`,
`door_act`, `door_open`. The table is in `packages/claude-mod/README.md`, "Outline tools". Other agents run
the same operations as `outliner agent <operation> --json '{…}' --actor <id>`; `ep0ch find <words>` and
`ep0ch show <id>` read (ranked search, a note drawn as text) with no door and no mod. `ep0ch find --query
"type=task updated >= -7d" --ids` (or `--view <id>`, `--under <id>`) lists what the outline says a query holds for, as
`((id))` lines for `ep0ch show $(…)`; `--json` gives each as a block record (header, properties as lists, children,
tasks, links, backlinks). `ep0ch export … --out <dir>` writes notes as Markdown, the header line's chips in front
matter. Write header chips with blanks or ` - ` between them (`Seed order [type::errand] - [area::garden]`): both
belong to the block; text after a chip makes it an inline aside.

- **The tools follow the folder Claude runs in.** They (and Recent Mentions and the links in replies) use the
  outline its nearest `.ep0ch` names (`ws = "<name>"`, written by `ep0ch init` or the Choose outline popup);
  `outliner bound-folder` says which. Installing the mod (`packages/outliner/scripts/install-claude-mod.ts`) needs no folder. In a
  folder that names no outline they refuse and nothing is sent: name it (ask the person), don't work around it.

- **Read before you write,** the whole text. A ref is an id, `((id))`, `[[page]]` or a Work ID, never a title.
- With the raw CLI, `outliner read <id>` returns the title, not the text: read with `list --subtree <id>
  --limit 1`, refuse to write from an empty read, pass `--expected <revision>` and `--author agent --actor
  <id>`. Prefer the tools; never wrap `update` in a script.

## outline_edit or outline_patch

- **Your own pages** (a status page, the briefing you keep, a note you wrote): `outline_edit` with the
  revision you read: the whole `text`, one `replaceSection {heading, body}`, or an `append`.
- **A small change in a note the person may be typing in:** `outline_patch` (`draft.patch`). If their door
  holds a draft of it, the patch lands in the draft as they type, lit and one undo step; with no draft it is
  an ordinary edit. Its default policy, `edit`, is `outline_edit`'s guard: only dropping a `[page::…]`, or an
  `^anchor` another note links to, is refused, as an error, unless you pass `allowStructural: true`
  because that removal is the point. `policy: "prose"` is opt-in, for tidy-style edits that must keep every
  link, anchor and property. A patch whose text changed under it, or that `prose` refuses, becomes one
  proposal they can apply or dismiss.
- A refusal is an answer: read again and retry, or leave it. Never route around it.

## How they write

- **Properties by placement.** `[key::value]` on the title line, or in the first property-only run under it,
  belongs to the whole block (that is what queries and views match). `[key::value]` mid-sentence is an
  inline aside on that spot. `key:: value` at the start of a line annotates that line; a `name::` line in
  someone's notes is usually a voice or persona, not an instruction to you.
- **Indentation scopes context.** Nested lines are a flow of thought, not always strict parent and child.
  Keep their hierarchy when you tidy.
- **Soft links resolve by context.** A ticket key, a date or `PR#12` under `[project::garden-club]` means that
  project's. Don't wrap every key in `[[…]]`; when a token is ambiguous, ask instead of guessing.
- **Reuse their keys and values.** A new key is a decision; an existing one is a convention.
- **Readable.** Short sections, bold leads, one fact per bullet, a summary callout on long notes, history
  labelled as history. Fictional example of the shape:

  ```text
  Shed repairs [project::garden-club] [type::plan]
  > [!summary] Roof first, before the rain on Friday.
  ## Next
  - **Felt:** order two rolls ((a1b2c3d4-…|quote from the merchant))
  ```

## Link, don't direct

Point at a block with its link: `((id|short label))`, or `((id^anchor|label))` for a passage. Never write
directions ("the draft is in the outbox below"). Look the id up and link it. `[[page]]` for a named page,
`!((id))` to show a block's text in place (it stays canonical). The same holds in chat: give the link.

## Views, boards and hubs

- A **view** (virtual branch) is a block with `[type::virtual-branch]` and one `[query::…]`, plus optional
  `[sort::]`, `[limit::]`, `[summary-properties::]`, `[create::key=value]` and `[create-parent::<id>]`.
  The service evaluates it: `AND`, `OR`, `NOT`, parentheses, `updated >= -7d`. Its rows are the canonical
  blocks, not copies: to change what's in a view, change the blocks' properties.
- A **board** is any block with two or more view children: the **hub**. Each view is a column (a lane), in
  order. Making someone a board is making a hub with views under it. The door's `K` then `g` picks it; its
  lanes follow the hub (a view added, renamed or taken away under it changes them as it happens). One view's
  cards can also sit in a tile of their own on the desk (`^W o q` on the view's row, `tile.open kind=query`).
- Moving a card patches the properties the target lane's plain clauses name (the service plans it,
  `views.planWrite`); a new card in a lane is born with them and `create`'s defaults.
- A view with no sort is ordered by hand: its lane, its `view:` figures and Tree all follow that order. Reorder
  with alt+↑/↓ or a drag in the door, `card.reorder` (`by=`, `to=`, `before=`, `after=`), `ep0ch view order
  <view> <id or Work ID>…` (those first, in that order) or the `view_order` tool. That is where a ranking such as a
  backlog belongs, not a numeric property. A view with `[sort::]` has no hand-set order: remove the sort first.
- Before placing a block into a view, ask the service what patch would make it match; don't guess the query.

## Pages, welcome and the briefing

- `[page::address]` names a block so `[[address]]` reaches it. Rename by editing the token; the old address
  stays an alias. An address another note owns is refused. A first line of only `[page::x]` gets `x` as its title
  on save (`2026-09-30 [page::2026-09-30]`); a title already there is kept.
- **A new note where it belongs:** `outliner new --text … [--near <id>] --author agent --actor <id>` (or the door's
  `note.new`) asks the service's placement rule: under `--near`, else the top of the Inbox. Use it instead of
  working out where the Inbox is. A missing `[[page]]` is made by the door's `page.create` (the Inbox too).
- `[welcome::true]` puts a note on the door's Welcome screen (`C`, or the landing after logon with
  `EP0CH_LANDING=welcome`); the value only marks it (a number is no longer a place). The order is the Welcome view's
  hand-set order (the saved view `[query::welcome]`): set it with `view_order` / `ep0ch view order <view> <id>…`,
  or the door's `welcome.move`; the first is read on arrival. Tag or untag by editing the property; the screen
  updates live.
- **A briefing** while they're away: one note, updated in place at every milestone, not a diary. Needs-you
  first, then what's live, done, in progress and decisions made; superseded briefings move to an archived
  child. Give it a `[page::…]` and `[welcome::true]`, and put it first in the Welcome view's order so it is the first thing
  they read.
- The morning brief has its own skill: `daily-brief`.

## Publishing

Publish only when they asked for that page. `[publish::true]` (or `[publish::<slug>]`) serves the note and
its subtree at `/p/<address>` on their network. **An embed shows the embedded note's text whether or not
that note is published:** lock private material first with `[publish::never]` (it and everything under it
stay off every page, embed and link). `[publish::false]` just leaves one note out. Check with
`outliner --ws <name> publish list`. The outline's guide has a Publishing section.

**Anyone with the link.** `[publish::public]` (or `[publish::public:<slug>]`) also opens the note to anyone
who has its link, on the internet (claude.ai, ChatGPT and phones can fetch it). Use it only when they ask to
share that note outside their network, and only for a note with nothing private in it or under it: its whole
subtree is shown. The public listener has no index, and an embed there of a note that isn't public shows
"not shared", but the note's own text and children are public. `publish list` shows the public URL in its
PUBLIC column. Removing `public` takes the note off at once.

## Components you can write in a note

A note can hold more than text. Reach for these before writing a table or a status by hand. Each is part of the
note's text, so it travels, publishes, and shows as readable source wherever it isn't drawn.

**Live figures** (`packages/door/src/graphs.ts`, `live.ts`). A `::graph-<kind>` block whose YAML between `---`
lines is the figure, closed by `::`. With `query:` (the virtual-branch syntax, parsed by the service) or
`view: ((id))` (a saved view), it is answered from the outline on every render, so status lives in one place
and every figure agrees. Prefer live over pasting counts that go stale.

```
::graph-stat
---
title: My tickets
items:
  - { label: doing, query: "type=ticket stage=doing" }
  - { label: waiting, query: "type=ticket stage=waiting" }
---
::
```

| kind | live from a query or view | static props |
|---|---|---|
| `check` | one row per block; `done: "<filter>"` ticks them | `items` |
| `stat` / `kpi` | `items: [{ label, query \| view }]`, each a live count | `items` |
| `rank` | `group: <property>`, a bar per value | `items` |
| `table` | `columns: [title, <property>, updated, author, …]`; a row opens its note | `headers`, `rows` |
| `tabs` | `group: <property>`, a tab per value with its count, each a `table` (`columns:`); `order: [a, b]` first (shown even when empty), the rest alphabetically; `limit:` rows per tab | (hand-authored tabs are planned, PIE-533) |
| `timeline` | one event per block, dated by `date: <property>` or updated; `now: "<filter>"` | `items` |
| `meter` | the share of results matching `done: "<filter>"`; with `limit:` (and `unit:`) the count of results against the limit, the limit a mark on the bar, the headroom said (an overrun in red) | `value`; rows `- label: 48` one bar each against the `limit:` |
| `quadrant` | `x: <property>`, `y: <property>`: a point per block in its (x, y) cell; `xs:` and `ys:` order the axes (first y at the top); `quadrants: [tl, tr, bl, br]` names the corners | rows `- label: x, y` |
| `matrix` | `down: <property>`, `across: <property>`: a count per pair, toned by share, totals beneath; `value: <property>` sums it instead; `order-down:`, `order-across:` | rows `- row: col=3 col2=1` |
| `compare` | static only | `columns: [A, B]` (two or three), rows `- label: a \| b`; stacks under 60 columns |
| `flow` | `from: <property>`, `to: <property>`: a flow per pair, counted | rows `- a → b: 7`; a source's total and its flows weighted by share, then the targets' totals |
| `funnel`, `waterfall`, `spark`, `plot`, `gantt`, `tree` | static only | `steps`, `data`, `labels`, `nodes` … |
| `decision` | one option per note; its `decision-state` (chosen, rejected, open) picks ● × ○; `reason: <property>` | `options`, `text`, `status`, `date` |
| `chat` | static only | `messages: [{ from, text, aside }]`, `you` |
| `keys` | `actions: note` (a scope): the door's own keys, from the action registry; `learn: [edit]` | `keys: [{ keys, action, learn }]` |
| `uptime` | a glyph a day from `date:` and `state:` properties (date, status); `last: 30`; `source: backups` | `days`, `from`, `to`, `wrap` |
| `activity` | blocks per day, `count: created\|updated` (or a date property); `weeks: 26` | `counts: { 2026-03-02: 4 }` |
| `calendar` | `date: <property>` marks the month's notes | `year`, `month`, `today`, `weekStartsOn`, `marks` |
| `annotate` | static only | `code`, `notes` (or a fence with `# (1)` markers and a `1.` list) |

**Width.** Every kind follows one rule (`tier`: narrow under 48 columns, cozy under 90, wide): a table in a narrow
column keeps its title column and one more and says `+n columns`; stat tiles wrap into rows; a timeline's or
decision's side note goes under its row; `compare` stacks; `matrix` cuts its heads; `quadrant` shows dots and a
legend. Write for the content, not the pane: the figure fits itself.

**Addressing a figure.** An anchor alone on the line after a figure's closing `::` names the figure
(`::graph-quadrant … ::` then `^quadrant`): `((id^quadrant|the quadrant))` lands on it, lit, and the service's
fragment slice is the whole block, so an embed `!((id^quadrant))` shows just the figure. Headings and paragraphs
take `^anchor` at their line's end as before.

Live blocks also take `limit:`, `sort:` and `direction: desc|asc` (default `updated`, `desc`). `sort:` is
`updated`, `created` or any property key (`sort: due`; `property:created` for a property so named): numbers compare
as numbers, blocks without it come last; a saved view sorts the same way with `[sort::due]`, and so does
`ep0ch find --query … --sort due --direction asc`. A bad sort shows its
refusal in the figure. For a ranking someone sets by hand, use a view's hand-set order instead (below). A `table` or `tabs` takes
`density: compact | cozy | comfortable` (titles on one line, up to two, up to three with a blank line between rows;
a wrapped title hangs past its work id); it is only the default: the person switches tabs and density in their
reader (`figure.tab`, `figure.density`), which never writes the note. Group a long status list into one `tabs`
figure rather than one table per status:

```
::graph-tabs
---
title: Workboard
query: "type=roadmap-item"
group: work-stage
order: [doing, review, validate, queued]
columns: [title, priority, updated]
density: cozy
---
::
```

An agent can paste the fenced ASCII figure form (` ```+--- [ TITLE ] ---+ `) and it is re-framed to fit the pane;
`ep0ch export` writes figures that way.

**Rows in Markdown.** Write a figure's rows after its `---` YAML (or with no YAML at all) instead of YAML lists:
`**bold**` is now, chosen or the accent; `*italic*` next, rejected or receding; `- label: value` a row; `x — note` a
muted side note; `a → b` a path; `ok*40` a run in any list of values; `- [x]` done. Where both give a field, the
YAML wins. A note whose body is a figure (nothing above it but its title) takes its **child bullets** as rows, each
opening its note: write the figure once and add rows as children (`rows: children` asks for them anywhere).

```
::graph-decision
---
title: Squash beds
status: decided
---
- **Raised beds** — the clay stays wet
- *Straight into the clay* — they rotted last year

Two beds of scaffold boards.
::
```

A `> [!quote]` callout's last line `— name, source` is drawn as its byline.

**Links** (`packages/door/src/links.ts`). `::links` lists a note's Outlinks, Resources (`[file::…]`, `jira::`
tickets; `!` marks one that's unavailable) and Backlinks, answered by the service on every render, the same
rows as the door's links tile. `::outlinks`, `::resources` and `::backlinks` list one group. One line, the words
after the name filter the rows (`::resources jira`), or a `((ref))` names whose links. Or a block closed by `::`
before a blank line, each line `of:`, `filter:`, `title:` or `groups:` (Comark's `---` lines are allowed). Each
row is a link the reader opens: a note, a ticket's block, a resource's stored content. Detail shows the source.

```
::resources jira

::backlinks
of: ((0b0c4d58-1a2b-4c3d-8e9f-001122334455|the plan))
filter: outbox
title: Who's waiting on the plan
::
```

Use it on a hub or a ticket page instead of pasting a list of related notes that goes stale. `b` in any reader
shows the same rows in a links tile beside it.

**Callouts** (Obsidian's syntax, PIE-538; the list and grammar are outline-core's `src/callouts.ts`, so the door and
Detail agree). `> [!type]± title`, then the body's lines, each quoted. Types: `note`, `abstract` (`summary`, `tldr`),
`info`, `todo`, `tip` (`hint`, `important`), `success` (`check`, `done`), `question` (`help`, `faq`), `warning`
(`caution`, `attention`), `failure` (`fail`, `missing`), `danger` (`error`), `bug`, `example`, `quote` (`cite`), and
any the outline declares. `-` after the type starts it folded, `+` open; no title uses the type's. Nest one by quoting
deeper, to any depth:

```
> [!question] Can callouts be nested?
> > [!todo] Yes, they can.
> > > [!example] Three deep.

> [!faq]- Folded until someone opens it
> The body, hidden at first.
```

- **A type of the outline's own:** write a note declaring it, `Recipe callouts [callout-type::recipe]
  [callout-icon::♨] [callout-tone::green] [callout-aliases::dish]` (icon one glyph one column wide; tone blue, green,
  violet, amber, coral or neutral; `callout-title::` too). The door and Detail draw it, and the door offers it after
  `> [!` and in its type choice. `callout.list` (an `act` on a reader) lists the types and says what's wrong with a
  declaration.
- **Folding is the reader's**, never the text's: `fold`/`unfold text=<title>` open one in a door for someone. Change
  what's written only to change where it starts: `callout.start n= folded=true|false` writes the `-`/`+`, and
  `callout.type n= to=<type>` rewrites the type. Both are an attributed edit of one line, revision-checked, refused
  under a draft the person has open; `callout.undo` takes yours back.

**Images and video** (PIE-532; the grammar is the door's `src/media.ts`). A line that is only the image, after an
optional list mark, with its layout as properties beside it: `[img::path]` (or `[video::path]`), then any of
`[size::40%]` (its width: cells, a share of the reader, or `full`), `[height::12]` (rows; the aspect is kept),
`[align::left|center|right]`, `[alt::what it shows]` and `[layout::hero]`, the note's **header**: drawn above the
title, the full width, whole when it fits in a third of the pane (or its `height`), else cropped to fill
(`[fit::contain]`: whole, centred), scrolling away with the note's top. Only the first hero counts. A bright image is
dimmed: the door is dark-first, so write `[dim::0]` only when the person asks for it; `[dim::0.6]` dims it more.

```
- [img::~/shots/plot-at-dusk.png] [layout::hero] [height::14] [alt::the plot at dusk]

[img::~/shots/packet.webp] [size::33%] [align::center]
```

- Put an image that comes right under the title in a list item (`- [img::…]`): a line of only properties there is
  the note's own metadata, not body.
- PNG, JPEG, WebP and GIF draw on Linux and macOS; video needs ffmpeg (Quick Look on a Mac). The path is on the
  machine the door runs on (`~` works). Under no Kitty graphics, the line says what it is.
- To change one in a person's door: `images` lists them (`n`, line, layout, problems), then `image.size n= to=50%`
  (or `height=`, or `by=1|-1`), `image.align n= to=center`, `image.hero n= on=true` (moves the header off any other
  image). Each is an attributed edit of that line, revision-checked, refused under a draft the person has open;
  `image.undo` takes yours back. Writing the line with `outline_patch` works too.

**Heading styles and rules** (PIE-599; outline-core's `src/heading-styles.ts`, drawn by the door's
`src/figures/banner.ts`). To divide a page more strongly than a plain heading, give the heading a style. Don't use
an empty `##` or an empty figure as a divider:

```
# Your calls [heading::band]
## The plot [heading::tab]
--- [rule::fade]
```

The line stays Markdown: folds, `( )`, sections, `^anchors`, Detail, the publisher and export all see the heading
or rule as written. The door draws it inside a band of the figures' glyphs (dim, the heading in colour). Under 48
columns, or when the heading doesn't fit, it draws the heading or rule as written. Built-in styles: `band` (centred,
spaced capitals), `tab` (left, top row), `waffle`, `uptime`, `dots`, `rule`, and `fade` (one row, for `---`). Put a
blank line before a styled `---`.

The outline declares its own styles the way it declares callout types: a note
`Plot style [heading-style::plot] [heading-pattern::dots] [heading-align::left] [heading-row::top] [heading-tone::green]`.

| Property | Values |
|---|---|
| `heading-pattern` | stack, waffle, uptime, dots, rule |
| `heading-rows` | 1–3 |
| `heading-align` | left, center, right |
| `heading-row` | top, middle, bottom |
| `heading-padding`, `heading-margin` | columns, or `"rows columns"` |
| `heading-tone` | a callout tone |
| `heading-letters` | plain, upper, spaced |
| `heading-default` | `1, 2` or `rule` |

`heading-default` draws every heading of those levels (or every `---`) in that style with no property. A
declaration named like a built-in restyles it.

**Tables.** A Markdown table draws as a real table with wrapped cells.

**Extension lines** (next section): `moon:: 2026-10-26`, `jira:: PC-1234`, `horoscope:: virgo`,
`fancy-horror:: virgo`, `@tidy`. `outliner ext ls` lists what this outline has.

If you add a new component kind, add it here and to the showcase. A component agents don't know about doesn't
exist for them.

## Extensions: adding one for a need

Extensions are trusted user code, like editor plugins, run by the service. Their data behaves as if the
person had copied it in: real blocks, namespaced properties (`jira.status`), queryable, linkable,
commentable, publishable when they choose. Four kinds, one extension may be several:

1. **Data** (`moon:: 2026-10-26`, `jira:: PC-1234`): the service fetches a record into a real block the
   extension owns, with namespaced properties (`[moon.phase::Full Moon]`), and refreshes it. The door and
   Detail show it under the line; `r` fetches it again.
2. **Inline output** (`horoscope:: virgo`): Markdown the service runs and keeps per line, shown under it and
   never written into the note unless someone **keeps** it (`[keep]`, `ext.<id>.keep`). `r` runs it again.
3. **Rich component** (`fancy-horror:: virgo`): data plus a view built from the shared primitives (card, box,
   row, stack, text, badge, stat, bar, table, checklist, sparkline) that every client draws, with actions
   (`[w ward]` in the door: its key, a click, or `act ext.fancy-horror.ward block=<id>`). Its state lives in
   the outline as blocks its actions write.
4. **Tile** (`tarot.reading`): a program in a door terminal tile of its own kind (`^W o T`, or
   `act tile.open kind=tarot.reading note=<id>`). It reaches the outline only through the service's
   actions, so what it writes is the extension's.

**Rules** (PIE-600) say "when a block matches this, draw this on it, or run this", without touching its text:
`match` by a property (`type=meeting`), a saved-view query, a text pattern (line by line, never in code) or a
construct kind (`heading:1`, `callout`, `list`, `rule`, `image`); then `decorate` (view primitives above, below, in
place of or around what matched; `band` and `track` for heading styles and dividers) and `on` (an action when a
block starts or stops matching, or changes while it matches; an extension's own writes never set one off). The
no-code tier is a **rule note** you can write for a person in their outline:

```text
Committee headings [rule-name::committee-bands] [rule-under::((<id>))] [rule-kind::heading:2] [rule-decorate::band] [rule-pattern::stack] [rule-align::center]
Meetings [rule-name::meetings] [rule-match::type=meeting] [rule-decorate::card] [rule-fields::when, attendees]
```

Scope it with `rule-under` unless they want it everywhere. The examples to copy for code: `meeting-card`
(decorate), `done-stamp` (on), `shout` (a text pattern). `R` in the door shows a note as written; `peek` lists a
reader's `decorations`. The contract: packages/outliner `docs/extensions/README.md#rules-when-a-block-matches`.

An extension can also declare **agents** a person addresses while they write: a line `@tidy` (after an
optional bullet) runs once the note is quiet, and its edit lands attributed to the extension (`ext:tidy`),
or as a proposal if the person was typing there. The door shows the request's state under the line;
`r` on it asks again.

All four kinds work end to end in the door and the service (PIE-507, PIE-512): the door binds whatever
`extensions.list` says, and an extension added or removed shows up or goes away without a restart.
Everything an extension writes is attributed `author: agent`, `actorId: ext:<id>`, whoever asked.

An extension is a folder: in the outline's own `extensions/<id>/` (under `~/outlines/<name>/`; it travels with that outline), or the
service host's user folder (`~/.config/pi-herdr-outliner/extensions/<id>/`, every outline): `extension.json`,
the code, `config.json` (secrets as references, never literals). `outliner ext ls` lists them, `outliner ext add
<id>` copies a built-in example (moon, horoscope, fancy-horror, tarot, tidy, jira, meeting-card, done-stamp, shout) into the user folder, or with
`--outline-folder <outline root>` into the outline's, `outliner ext remove <id>` takes it away (both apply
without a restart), and `outliner ext act <id> <action> --block <id>` runs an action. The contract and worked examples are packages/outliner
`docs/extensions/README.md`. Test one against a scratch host, never their live folder. For a need, pick the
smallest kind that serves it, copy the nearest built-in, and say what it runs and what it costs (`effects: read | spend | write`).

## Rules

- Every write is `author: agent` with your actor id, checked against the revision you read. Nothing is
  overwritten; nothing is copied out of their outline into tests, commits, PRs or logs.
- Act in their door only for what they asked; never take their focus, keys or selection. To get their
  attention, `block.mark` a block with a reason (see `ep0ch`).
- Back up before a bulk change: the service keeps no earlier text (`ep0ch-core`, "Deploy and back up").
- Make easily reversible choices yourself and record them in the briefing; ask only for the
  hard-to-reverse ones (deleting data, spending money, publishing).
