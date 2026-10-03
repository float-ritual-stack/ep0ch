---
name: ep0ch-outline
description: Use when an agent works inside a person's outline on their behalf, shaping it to their needs while they work - writing or tidying notes, adding properties, making views, boards and pages, welcome notes and briefings, publishing a page, writing live figures and components into a note (::graph-* with query or view, callouts), adding an extension for a need, or showing them something in their ep0ch door. Covers how they write (properties by placement, soft links, links not directions), outline_edit vs outline_patch, views and hubs, pages and [welcome::n], publishing and [publish::never], the components a note can hold, the four extension kinds, and where the live guides are.
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
- Before placing a block into a view, ask the service what patch would make it match; don't guess the query.

## Pages, welcome and the briefing

- `[page::address]` names a block so `[[address]]` reaches it. Rename by editing the token; the old address
  stays an alias. An address another note owns is refused.
- `[welcome::n]` puts a note on the door's Welcome screen (`C`, or the landing after logon with
  `EP0CH_LANDING=welcome`), in place `n`; unnumbered ones come after, by title. The first is read on
  arrival. Tag, untag or reorder by editing the property; the screen updates live.
- **A briefing** while they're away: one note, updated in place at every milestone, not a diary. Needs-you
  first, then what's live, done, in progress and decisions made; superseded briefings move to an archived
  child. Give it a `[page::…]` and a low `[welcome::n]` so it is the first thing they read.
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
| `timeline` | one event per block, dated by `date: <property>` or updated; `now: "<filter>"` | `items` |
| `meter` | the share of results matching `done: "<filter>"` | `value` |
| `funnel`, `waterfall`, `spark`, `plot`, `gantt`, `tree` | static only | `steps`, `data`, `labels`, `nodes` … |

Live blocks also take `limit:`, `sort: updated|created` and `direction:`. An agent can paste the fenced ASCII
figure form (` ```+--- [ TITLE ] ---+ `) and it is re-framed to fit the pane.

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

**Callouts and tables.** `> [!note] Title` (also `summary`, `warning`…) draws a box. A Markdown table draws as
a real table with wrapped cells.

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
<id>` copies a built-in example (moon, horoscope, fancy-horror, tarot, tidy, jira) into the user folder, or with
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
