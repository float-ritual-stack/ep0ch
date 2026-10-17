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

In Claude with the Claude mod (packages/claude-mod): `outline_read`, `outline_find`, `outline_resolve`, `outline_site` (what a note's `{{this.key}}`, `parent.key`, a bare `key` up the outline, `((id)).key`, `this.tasks | status=todo` or `now.date-1d` resolve to, with the route and a did-you-mean for a typo), `outline_edit`,
`outline_patch`, `outline_proposal_apply`/`outline_proposal_dismiss`, `outline_create`, `outline_assign_id`,
`outline_move`, `outline_trash`/`outline_restore`, `outline_comment`/`outline_reply`/`outline_resolve_thread`,
`outline_changes`, the `work_*` tools and `note_section`; in a door tile also `door_where`, `door_peek`,
`door_act`, `door_open`. Every tool that names a note takes it as `ref` (`id`, `reference`, `block`, `blockId`, `uri`, `note` are accepted; two that disagree are refused, so pass one), and a wrong call comes back with the tool's arguments and a call that works. The table is in `packages/claude-mod/README.md`, "Outline tools". Other agents run
the same operations as `outliner agent <operation> --json '{…}' --actor <id>`; `ep0ch find <words>` and
`ep0ch show <id>` read (ranked search, a note drawn as text) with no door and no mod. `ep0ch find --query
"type=task updated >= -7d" --ids` (or `--view <id>`, `--under <id>`) lists what the outline says a query holds for, as
`((id))` lines for `ep0ch show $(…)`; `--json` gives each as a block record (header, properties as lists, children,
tasks, links, backlinks). `ep0ch export … --out <dir>` writes notes as Markdown, the header line's chips in front
matter. Write header chips with blanks or ` - ` between them (`Seed order [type::errand] - [area::garden]`): both
belong to the block; text after a chip makes it an inline aside.

- **With only a shell** (no mod): `outliner create --text '<text>' --parent <full id> --author agent --actor <you>` makes a
  note (`--parent` takes the whole id, not the first 8 characters), `outliner list --subtree <id> --limit 1` reads the text and
  its `revision`, `outliner update --id <id> --text '<text>' --expected <revision> --author agent --actor <you>` rewrites it,
  and `outliner agent <operation> --json '{…}' --actor <you>` is every tool above (`set-property` among them). Read what a note
  draws with `ep0ch show <id>`; it draws values, `::fields`, `::if` and `::use`, but not a script's or an extension's output
  (see [references/scripts.md](references/scripts.md), "Looking at a script's output").

- **The tools follow the folder Claude runs in.** They (and Recent Mentions and the links in replies) use the
  outline its nearest `.ep0ch/config.toml` names (old `.ep0ch` files are still read) (`ws = "<name>"`, written by `ep0ch init` or the Choose outline popup);
  `outliner bound-folder` says which. Installing the mod (`packages/outliner/scripts/install-claude-mod.ts`) needs no folder. In a
  folder that names no outline they refuse and nothing is sent: name it (ask the person), don't work around it.

- **Read before you write,** the whole text. A ref is an id, `((id))`, `[[page]]` or a Work ID, never a title.
- With the raw CLI, `outliner read <id>` returns the title, not the text: read with `list --subtree <id>
  --limit 1`, refuse to write from an empty read, pass `--expected <revision>` and `--author agent --actor
  <id>`. Prefer the tools; never wrap `update` in a script.

### Orienting at the start of a session (MCP)

Arriving cold, read the outline's recent changes, not a context store. Per outline:

1. `outline_query` with `query: "updated >= -1d"`, `sort: "updated desc"`, `fields: "id,title,updated,actor,path"`,
   `fold: true` (or the outline's saved orient view, by `view`: its own `[sort::]` orders it). The service sorts; a
   projected row is a title, never a body. With `fold`, a note's proposals, comments and deliveries are one row with
   `changes` ("4 changes (1 proposal, 2 comments, 1 delivery)"). `under` limits it to a note's subtree.
2. `outline_read` (by `ref`) only the rows that are new to you. A proposal or a comment reads as a pointer
   (`target: id@revision`, the diff or the anchored span), not a copy of its note; `raw: true` gives it as stored.
3. On every later read, query or find, pass `seen: ["<id>@<revision>", …]` for what you already hold. A block still at
   that revision comes back `{id, revision, unchanged: true}`; a changed one comes back whole. A repeat in the same
   response is `{id, revision, see}`: look where it points.

4. Your own writing isn't news to you. Your first write (or `list_outlines`) returns your call, `{id, handle}`: pass `call: "<id>"`
   on your later requests, and the orient query in step 1 leaves out the rows only your call changed since, with a line
   (`ownOmitted`: "12 of yours this call, omitted"); `includeOwn: true` brings them back. Another chat's writes, and any other
   agent's, still show. `call:<id or handle>` finds what one call wrote, and quote your handle in notes you write so a
   reader can find the batch. A name of your own works as `call` too (`daddy-2026-10-09-0103-k7f`). *Why it matters:* you
   don't spend context re-reading what you just wrote, and a person can tell which chat made which notes.

A wrong argument is answered with the tool's arguments and a call that works; use `ref` for a block, as everywhere.

### Refining a draft with another agent: comment threads

When a draft (an email, a post) is refined between agents, say claude.ai over the MCP gateway and Claude Code with the
mod, the draft lives in one note and the talk lives in its comment threads, not in pasted copies. Draft in the note;
comment on the passage to change (`outline_comment` with the `quote`); the other agent reads the threads
(`outline_threads` on the gateway, `outline_read` shows the open count and each latest comment) and replies
(`outline_reply`) or patches the note (`outline_patch`); when it is settled, `outline_resolve_thread`. Resolving
changes only the thread, so a `propose` outline allows it. Check the thread's last comment before answering: nothing
records whether a comment wants an answer. `outline_threads` with no note is the inbox (open threads anywhere,
`lastFrom`, `mentions`, `since`): a scheduled check calls that. Each agent writes under its own name (the gateway's
persona, `OUTLINER_ACTOR` or `EP0CH_AGENT`, else the folder's `.ep0ch` `agent = "<name>"`), so a thread shows who said
what: the persona first, its principal (`claude-code@<machine>`) one step away. A comment or reply already
posted (yours, or one the person asks you to fix) is edited in place, not answered with a correction: `outline_reply`
with `edit` (its id) and `observed` (its words as you read them). A comment that changed since is refused; read it
again. It stays its author's and says "edited by" you.

On a page two agents work on, put the items that change (steps, outbox items) in child blocks, each with its own
revision, so concurrent edits rarely collide.

## outline_edit or outline_patch

- **Your own pages** (a status page, the briefing you keep, a note you wrote): `outline_edit` with the
  revision you read: the whole `text`, one `replaceSection {heading, body}`, or an `append`.
- **A small change in a note the person may be typing in:** `outline_patch` (`draft.patch`). If their door
  holds a draft of it, the patch lands in the draft as they type, lit and one undo step; with no draft it is
  an ordinary edit. Its default policy, `edit`, is `outline_edit`'s guard: only dropping a `[page::…]`, or an
  `^anchor` another note links to, is refused, as an error, unless you pass `allowStructural: true`
  because that removal is the point. `policy: "prose"` is opt-in, for tidy-style edits that must keep every
  link, anchor and property. A patch read at an older revision still applies when every `observed` span is present once at the
  newer one and nobody rewrote its line (a rebase; the answer says `rebasedFrom: <revision you read>`). It becomes one
  proposal they can apply or dismiss when a span is gone, changed or ambiguous, when the note is open in a draft,
  or when `prose` refuses.
- **Settle a proposal by id:** `outline_proposal_apply {ref: "<proposal id>"}` or
  `outline_proposal_dismiss {ref: "<proposal id>"}` needs no reader. Apply keeps the normal patch comparison;
  an agent can dismiss only its own proposal. MCP settlement requires full access.
- A refusal is an answer: read again and retry, or leave it. Never route around it.
- A write's `warnings` are answers too: a `((` that leads nowhere (with a did-you-mean), and each construct you
  left open (an unclosed fence, `[[`, `[key::`, `::component` or `<!-- literal -->`, on its line, with how to close
  it). The text was saved as you wrote it, and an open construct costs only itself (a fence its paragraph); fix it
  in the next write.

## How they write

- **Properties by placement.** `[key::value]` on the title line, or in the first property-only run under it,
  belongs to the whole block (that is what queries and views match). `[key::value]` mid-sentence is an
  inline aside on that spot. `key:: value` at the start of a line annotates that line; a `name::` line in
  someone's notes is usually a voice or persona, not an instruction to you. A `::` mid-sentence (`std::vec`) is prose;
  a `#fff` or `#00e5ff` (3, 4, 6 or 8 hex digits with a digit, or 6 or more, or one repeated; `#cafe` and `#bed` stay tags) is a colour, not a tag; a `---` is a divider, a figure's
  settings fence or a table row, and a first-line `---` followed by a blank line is a divider, not front matter.
- **Indentation scopes context.** Nested lines are a flow of thought, not always strict parent and child.
  Keep their hierarchy when you tidy.
- **A leading mention is an ask** (PIE-906, #592): a line you write starting with `@name` (after an optional
  bullet) wakes that agent by default. Put a mention you don't mean as an ask in prose or a code span.
- **Tidying moves things.** Put a note where it belongs with `outline_move` (`parent`, `before` or `after`; a
  note keeps its id and links) and put a duplicate or stray in Trash with `outline_trash` (the `revision` you
  read); `outline_restore` undoes it. Move freely, trash only what is plainly a copy or an empty stray, and say
  what you moved where. A system note (Inbox, Trash, Bookmarks, the Deploys record, a snapshot record) moves like any note, but nothing goes under Trash, Bookmarks or a guide; at propose access both arrive as comments.
- **Soft links resolve by context.** A ticket key, a date or `PR#12` under `[project::garden-club]` means that
  project's. Don't wrap every key in `[[…]]`; when a token is ambiguous, ask instead of guessing.
- **Reuse their keys and values.** A new key is a decision; an existing one is a convention.
- **A step's box is their answer.** Checklist items have six states (outline-core `checklist-marks.ts`): `[ ]` to
  do, `[x]` done, `[~]` waiting, `[!]` problem, `[✓]` approved and `[✗]` rejected (`[+]` and `[-]` read the same).
  **`[✓]` approved is the person's yes**: a "Needs you" item, a draft or a proposal they approved is a go, act on it.
  **`[✗]` rejected is their no**: don't do it, and don't ask again unless something changed. `[x]` on a question is
  "done" (seen, handled), not a yes; when the answer matters, ask for Approve or Reject. Read them with
  `checklist.query` (`statuses: ["approved"]`), never by matching `[x]` yourself. Approved counts as done in a tally;
  rejected is closed, not done. A `::graph-check` figure's boxed rows are steps too (`figure: true`, PIE-864): a test
  plan or a build report's "You test" can be a figure and still be worked through in place. Its rows take inline
  Blockdown (code spans, links, emphasis) as a line of the note does. A live check with `done: "key=value"` is
  marked by writing that property on each row's note.
- **Readable.** Short sections, bold leads, one fact per bullet, a summary callout on long notes, history
  labelled as history. Fictional example of the shape:

  ```text
  Shed repairs [project::garden-club] [type::plan]
  > [!summary] Roof first, before the rain on Friday.
  ## Next
  - **Felt:** order two rolls ((a1b2c3d4-…|quote from the merchant))
  ```

## Values in prose: `{{ }}`

A note can say what it knows about itself: `Play it at {{this.target}}. Owner: {{this.owner}}.` Every reader draws the
value, not the braces; the editor, `ep0ch show --source` and the stored text keep what the author typed.

- **Heads:** `this.key` (the note's own header only: it does not inherit), `parent.key`, a bare `key` (the nearest value up the outline: this note's header,
  then each ancestor's), `((id)).key` or `[[page]].key` (another note), `person.firstName` (through a property whose
  value is a link), `now.date`, `props.key`. Every key is a list: several values read joined with commas. `{{ path ||
  fallback }}` fills in when there is nothing.
- **A typo is never refused.** `{{this.ownr}}` saves as typed; the door and Detail draw it dimmed with the nearest key
  (`did you mean owner?`) and a write says so as a warning. Fix it and the value redraws.
- **Read what the person sees:** `outline_read` returns `site` beside `text` (each placeholder's `values`, or its
  `problem` with `didYouMean`, its `route` and the notes it came `deps` from); `outline_site` answers any path before you
  write it. Write the placeholder, then check `site.problems` is 0.
- **On a published page** a value is in the HTML, unless it read a note the page may not show: that one says `hidden
  here` and names nothing.
- A selection of a drawn value, a comment on it and a link to it anchor on the whole `{{ }}` token.

## Templates: `::use` and `template.stamp`

A template is a note whose `[form-field::name type …]` chips declare its props and whose `[template-for::meeting]` says
what it makes. Use it live, `::use{of=[[meeting-template]] date=2026-10-14 with=Jay}` (its body drawn where the line is,
`this` the page the line is on, so a figure over `{{this.project}}` lists each page's own), or write it out as a new note,
`ep0ch act template.stamp of='[[daily-template]]' as=new parent='[[Daily notes]]' title='{{now.date}}'` (`props`, `self`
and `now` become text now; `this`, `parent` and bare keys stay `{{ }}`; `freeze=all` writes those too; `for=<query>` once
per match). A prop the template doesn't declare is a warning with the nearest name, a required one left out is asked for
(`use.fill`, an agent names it with `with='{"name":"value"}'`), and a prop's value may be a path
(`status={{parent.status}}`). `of=type:meeting` finds the template by what it makes. Read
[references/templates-and-values.md](references/templates-and-values.md).

## Link, don't direct

Point at a block with its link: `((id|short label))`, or `((id^anchor|label))` for a passage. Never write
directions ("the draft is in the outbox below"). Look the id up and link it. `[[page]]` for a named page,
`!((id))` to show a block's text in place (it stays canonical). The same holds in chat: give the link.
A link in a property's value is an edge too (PIE-874): `[via::[[HUB-23]]]`, `[ticket::PC-582]` (a value that is
exactly a ticket key) or `[related::((id)), notes]` show in the target's backlinks labelled by the property (`via`,
`ticket`), so write the fact once, in the property, not again in the body.

## Working a session with the person

When they ask you to orient them and plan a stretch of work (a morning brain boot, an evening catch-up):

- **Make a plan block, open it in a tile and keep it current.** Treat it like a dashboard, not prose: what you're
  working on, open questions, and the steps to confirm one at a time before calling something done. Treat it as a
  mini plan mode: propose, then confirm with the person before committing to anything.
- **Use live views over copies.** Anything with a status (todos, tickets, outbox items) is a query, a view or an
  embed, so it can't drift. Use properties so it filters.
- **Answer the question before asking someone else.** Check meeting notes, existing blocks, the ticket and its
  comments, and the code first. Open a loop with another person only when it really can't be found.
- **Read a ticket in full:** the description, every comment, and its parent for context.
- **Draft messages in the outline.** A message to someone else is an outbox item the person reviews and approves.
  Never send one yourself unless they say so. Create the note, then give it a work id from the outline's own
  allocator with `outline_assign_id` (CLI: `outliner agent assign-id`, or `outliner work-id-allocate`; it uses
  whatever prefix that outline was set up with). The id is its page address, so `[[GDN-12]]` reaches it: add no
  `[page::…]` name (the outliner refuses the duplicate). `work_create` is only for roadmap items on the workboard,
  never for an outbox draft. A team's ticket ids (Jira's `PC-…`) stay references, never allocated.
- **Introduce a work item** in a line the first time it comes up, and again after a break, so the person doesn't
  have to recall what `XYZ-123` was.
- **Code:** work in a worktree, and review it before anything is pushed.
- **Respect the tiles.** Use the tiles you're given as they say (see `ep0ch where` and `peek`: a tile can be
  free, edit-only or off-limits to agents). Never move a tile they told you to leave.

Their own team's rules (a comms skill for messages, a team's review steps) come from that team's skill, not this
one.

## Views, boards and hubs

- A **view** (virtual branch) is a block with `[type::virtual-branch]` and one `[query::…]`, plus optional
  `[sort::]`, `[limit::]`, `[machinery::show|only]`, `[summary-properties::]`, `[create::key=value]` and `[create-parent::<id>]`.
  A view, a find and an agent's feed leave out the notes tools stamped `[machine::<producer>]` (file touches, EchoNet's
  logs, deliveries, backup runs) unless `machinery` says `show` or `only`; `by:user` or `by:agent` and `revision >= 2`
  ask who wrote a note last and how often it was saved. Stamp your own tool's bookkeeping notes `[machine::<tool>]`.
  The service evaluates it: `AND`, `OR`, `NOT`, parentheses, `updated >= -7d`, comparisons on any property (`due <= +3d`, `wait-until <= today`, `rating > 3`, `release-window = today` for a span `2026-10-20..2026-10-24`: dates as people write them, `Oct 20`, `10/20`, `20 Oct`; a value with a space is quoted, `due <= "Oct 20"`) and the atoms `#tag`, `links:[[page]]` (or `((id))`, `PIE-123`), `linkedfrom:[[page]]` (what it links to), `under:[[page]]` (the subtree), `parent:[[page]]` (its children), `this` as any of their targets in a figure or a `::links` query (the note it sits in: `links:this NOT linkedfrom:this` is what mentions the note that it doesn't link back), `call:<id or handle>` (what one MCP call last wrote), `title~text` / `text~text` (caseless substrings; quote spaces), `thread:me` and `unread:me` (the threads you started or wrote in, and what you haven't read: Recent replies is `type=annotation-reply AND thread:me AND NOT annotation-source=user`), and `child:key=value` with a count, `child>=2:type=virtual-branch` (every hub, tagged or not). `under:[[orient]] NOT links:[[archive]]` replaces a list of types to exclude. Live figures and board lanes take them unchanged; a `::graph-tabs` or `::graph-rank` `group:` takes any property, or a date bucket of any property (`group: due:week`, day, week, month or year), grouped and counted by the service. A note that waits for a day is a saved view, not a reminder: `wait-until <= today` on Welcome or a board lane fills itself that morning. Its rows are the canonical
  blocks, not copies: to change what's in a view, change the blocks' properties.
- A **board** is any block with two or more view children: the **hub** (`child>=2:type=virtual-branch` lists them
  all; a `[type::hub]` tag is optional). Each view is a column (a lane), in
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
- **Status families** (PIE-819): the links tile and Detail's backlinks count each `status::`, `stage::`, `outbox::` or
  `work-stage::` value as the notes write it (`2 answered`) and colour it by family (waiting, draft, active, done). The
  built-in list places the usual words; for any other, write a rule note: `answered, fixed, shipped
  [status-family::done]` (families: waiting, draft, active or `open`, done or `decided`/`never`). Nothing needs a code
  change, and a later note moves a value again. The defaults place next, doing, waiting, parked (waiting) and done. A list
  shows only the values its own rows carry; `stages: [next, doing, waiting]` on a `::backlinks` (or `stages=` on a links
  tile) names which, in that order, and rows with any other value stay listed, said as `other: parked 1`.

## Pages, welcome and the briefing

- `[page::address]` names a block so `[[address]]` reaches it. Rename by editing the token; the old address
  stays an alias. An address another note owns is refused. A first line of only `[page::x]` gets `x` as its title
  on save (`2026-09-30 [page::2026-09-30]`); a title already there is kept.
- A page's address may hold another page link: `[[[[2026-10-06]] - editor thoughts]]` reaches the page
  `[[2026-10-06]] - editor thoughts [page::[[2026-10-06]] - editor thoughts]` and links 2026-10-06 as well.
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

Recent files (`[[recent-files]]`) records the files a Claude session edits only where the page asks: one
`[file-touches::<glob>]` property on it per area, e.g. `[file-touches::~/rangle/**/*.md]` or `[file-touches::**/plans/**]`.
No property, nothing recorded; the property is the person's switch, visible where the records land. Add or remove
one when they say which areas they want to see; a session reads them again within a minute.

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

**A short-lived public link.** When they want their outline's web pages as an ordinary public site, or to show it to
someone, start a share: `share_start` over MCP (your tool call is the approval; don't ask again), `ep0ch share start
[<ref>] [--ttl 1h]` from a shell. It's the whole outline, navigated as on the tailnet; `ref` is only the page it opens
on, and `only` narrows it to one note and below when they ask for that. It's on the outline's own public host (one
stable origin). To
share with someone else, `via: "cloudflare"` with `allowMail` (their email): a tunnel only they can sign in to. Give
them the `url`; it ends by itself (1h default, 24h at most), and
`share_revoke` / `ep0ch share revoke <id>|--all` ends it now. `[publish::never]` notes stay hidden. To see what they
have open or selected on any web page of the outline, read `reader_view` (`ep0ch reader`) instead of fetching it.

**Linking a note for them to read on their phone.** On the tailnet every note is already a page, no `[publish::]`
needed: the publisher's tailnet URL plus `/p/<id>` (on pie, `https://my.ep0ch.sh/p/<id>`). It opens as a folder:
the note's text, its children as links, breadcrumbs back up. They can highlight, comment and ask `@margin` there;
it lands as their own threads in the outline, so "go check the notes I left" means reading the note's threads.
In the door a reader draws its comments as cards in the margin; to keep just the marks, `M` (or a click on the
comment count after the note's date) cycles cards a row each, whole, and **marks only**, kept with the tile.

## Shaping a note: a floor, not a ceiling

Every note clears this floor:

- State lives in properties, not prose (status, owner, channel, related), so views can filter it.
- Anything with a status is live: a query, view or embed, never a copied list that drifts.
- Text meant to leave the outline is one copyable block (a quote or fence), so its ⧉ copies exactly that.
- What the reader needs first comes first: one line saying what this is and what's left.
- Context that matters less is folded (`[!note]-`), not deleted.
- Link, don't direct: `((id|label))`.

Above the floor, use whatever makes this note clearer. The examples are one way each, not the way: an outbox draft
(a purpose callout, a before-it-posts checklist, the message in one quote, folded sources), a session plan (now, open
questions, steps as live queries), a decision record (the question, options as a compare figure, the call, what would
change it). Reach past them: ask `outline_components` (or `ep0ch library --brief`) for what exists and pick what
fits. If nothing fits, use the nearest and add a one-line `[wish::…]` saying what would be better. Vary the shape to
the content.

A worked outbox draft (fictional). The note is made first, then `outline_assign_id` stamps `[work-id::…]` on its first line (no `[page::…]`: the id is the page address). The properties are on the first line; the message is the one quote, so its ⧉
copies the message and nothing else; the sources are folded:

````markdown
GDN-12 — Ticket: staff the seed swap table [type::outbox] [outbox::next] [status::draft] [work-id::GDN-12]
> [!abstract] A ticket for the allotment committee asking for two volunteers on the 14th. Left: pick the channel.

Before it posts
- [ ] the date matches ((7c1d0a52-3b64-4f0e-9a21-5e8d6b4c2f10|Seed swap plan))
- [ ] one volunteer named for the cash box
- [ ] channel chosen

> **To:** Allotment committee
> **Subject:** Two volunteers for the seed swap, Saturday the 14th
> **Ask:** Can two of you run the table from 10 to 12? One keeps the cash box.
> **Needed by:** Friday

> [!note]- Sources
> - ((7c1d0a52-3b64-4f0e-9a21-5e8d6b4c2f10|Seed swap plan)): date and hours
> - ((a41b9e07-62d3-48c5-b0f7-13c9d5e8a264|Committee rota)): who is free
````

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
as numbers and dates as dates however they're written, blocks without it come last; a saved view sorts the same way with `[sort::due]`, and so does
`ep0ch find --query … --sort due --direction asc`. A bad sort shows its
refusal in the figure. For a ranking someone sets by hand, use a view's hand-set order instead (below). A `table` or `tabs` takes
`density: compact | cozy | comfortable` (titles on one line, up to two cut with `…`, or whole with a blank line between rows;
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

**Fields and conditions** (a note that reads itself). `::fields{key=connectTo}` lists every place the note wrote that
key wherever it is written (the header's chips, front-matter lines `- connectTo:: v` before the first blank line, a
`[connectTo::…]` chip in the body, a `connectTo:: …` line, a list value one row each), one row per occurrence
with its line number. A `#hashtag` is the key `tag` (`::fields{key=tag}`), and `tags::` is an ordinary key of its own. A front-matter row isn't drawn in the note: opening it says its line is in the property panel (`i`), and its `¶` is refused (an anchor would become part of the value). Otherwise a row opens its own line, lit, found again by the text it was written as, and a row appears as soon
as a line is saved. `of=((id))` lists another note's (the whole id or its first 8 characters; a title in the brackets is not an id, `ep0ch find <words> --ids` prints them), `title=` titles it. Its `¶` anchors that line on request
(`fields.anchor key=connectTo n=2`), giving a `((note^anchor))` that links to it for good; drawing it never writes. `::if{where="status=active"}`
… `::` draws its lines only while the note matches the query (the saved views' grammar, `{{this.owner}}` operands bound,
never pasted in); its body holds Blockdown (its `{{ }}` values are drawn like the rest of the note's) but no other component. A figure copied onto two pages lists each page's own
(`query: type=ticket project={{this.project}}`), and takes call-site args: `::graph-table{project=lego}` reads
`{{props.project}}`. The service answers all of these through `site.answer`; `outline_site` is the same read for an agent.

**Links** (`packages/door/src/links.ts`). `::links` lists a note's Outlinks, Resources (`[file::…]`, `jira::`
tickets; `!` marks one that's unavailable) and Backlinks, answered by the service on every render, the same
rows as the door's links tile. `::outlinks`, `::resources` and `::backlinks` list one group. One line, the words
after the name filter the rows (`::resources jira`), or a `((ref))` names whose links. Or a block closed by `::`
before a blank line, each line `of:`, `filter:`, `title:` or `groups:` (Comark's `---` lines are allowed). Each
row is a link the reader opens: a note, a ticket's block, a resource's stored content. Detail shows the source.
A file whose folder now leads to another directory isn't read: its reader says where, and `ep0ch resource rebind
<folder> --ws <outline>` reads it there. Run it only when the person moved the folder on purpose; a folder deleted and
made again in the same place needs nothing.

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
- **Folding is the reader's**, never the text's: `fold`/`unfold text=<title>` open one in a door for someone (a reader the person isn't typing in; their selection and scroll stay). A links list's folded groups are the person's view alone: an agent's `backlinks.fold` and `column.link` on a group are refused, and it reads every row with `backlinks.view` or `peek`. Change
  what's written only to change where it starts: `callout.start n= folded=true|false` writes the `-`/`+`, and
  `callout.type n= to=<type>` rewrites the type. Both are an attributed edit of one line, revision-checked, refused
  under a draft the person has open; `callout.undo` takes yours back.

**Images and video** (PIE-532; the reference, grammar to where it draws, is the door's `docs/IMAGE-LINES.md`). A line that is only the image, after an
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

**Every component's properties, in one answer** (PIE-618). Discover components with `ep0ch library --brief
[<component>…]` or the `outline_components` tool (the Claude mod's, and the MCP gateway's, which also serves each
component as a resource: `ep0ch://<outline>@<machine>/components/<id>`). Per component: its purpose, where it goes,
each property as `key: values (default) — meaning`, and one minimal example. They cover every component a note can hold: the heading styles, callouts, rules, each `::graph-*` figure
(`graph-stat`, `graph-table`, `graph-tabs`, `graph-rank`, `graph-meter`, `graph-timeline`, `graph-check`, `graph-decision`,
`graph-chat`, `graph-keys`, `graph-matrix`, `graph-quadrant`, `graph-compare`, `graph-flow`, `graph-uptime`,
`graph-activity`, `graph-calendar`, …), `links`, `outlinks`, `resources`, `backlinks`, `box`, `image`, `hero-image`,
`embed`, `code-fence` and `table`, the outline's own styles and types among the values, and any an extension ships.
A component the readers draw can't lack an entry: a test fails when one does. Read them before writing a component's properties instead of guessing a value.
`ep0ch library --json` prints the full schemas (each value's meaning too). The library screen
(`ep0ch --screen library`) is for people: don't open it; it draws each value with its source.

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

One heading can change a field for itself alone: `## Odd jobs [heading::dots] [heading-tone::amber]`. A field on a
heading that names no style restyles its level's default, else the base style (`## Odd jobs [heading-pattern::dots]`).
The fields leave the drawn heading; any other property on it draws as a chip after it.

The outline declares its own styles the way it declares callout types: `[heading-style::name]` with its fields on
the same line, on any line of any note (or as a note's own properties):
`Plot style [heading-style::plot] [heading-pattern::dots] [heading-align::left] [heading-row::top] [heading-tone::green]`.
The door draws that line as what it declares (a chip summary and a small band); raw and the editor show the tokens.

| Property | Values |
|---|---|
| `heading-pattern` | stack, waffle, uptime, dots, rule |
| `heading-rows` | 1–3 |
| `heading-align` | left, center, right |
| `heading-row` | top, middle, bottom |
| `heading-padding` | columns, or `"rows columns"` |
| `heading-margin` | columns, `"rows columns"` or `"top columns bottom"` (blank rows above and below the band) |
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

## Keys and secrets (for an extension that needs one)

An extension that needs a token names it; the service hands it that one key, and only to a call that has the right.
**Run `ep0ch keys list` before calling a key missing** (#558):

```sh
ep0ch keys list              # every with-secrets group's keys: where, mode, scope, which extensions name it
ep0ch keys check TYPESAFE_API_KEY   # present and readable or not; exit 1 when not (for scripts)
ep0ch keys who TYPESAFE_API_KEY     # its scopes, and the extensions that name it
```

These print names, places and modes, **never a value**; never read one into a note, a log, a test or a prompt. A key lives
in a `with-secrets` group (`~/.config/secrets/<group>.env`, mode 600; `WITH_SECRETS_DIR` moves the folder). Your agent
doesn't have the environment variable: the service reads the group when a call starts.

- **A fixed key:** name it in the manifest's `secrets` (`"jev": { "group": "typesafe", "key": "JEV_API_KEY" }`). It reaches the
  call as `credentials.jev` and as `JEV_API_KEY`.
- **A group chosen at run time** (a runbook's `--secrets=deploy-demo`): `secretGroups: ["deploy-demo"]` (or `"*"`), then
  `secrets.group` over the connection.
- **Setting one is the person's:** `ep0ch keys set <group> <KEY>` prompts for the value (it wraps `with-secrets --add`).
  Ask them to run it; you never see what they type.
- **Scopes:** a key is `machine`'s (any extension that names it) until the person narrows it:
  `ep0ch keys grant typesafe/TYPESAFE_API_KEY ext:requests --outline gurgle` (scopes: `machine`, `outline:<name>`,
  `ext:<id>`, `ext:<id>@<outline>`; `keys revoke` takes one away). The service checks the scope before it hands a key over; a
  refusal says the command that grants it. They live in `scopes.json` beside the groups, which holds no value. A scopes file that is there but
  broken hands a key to no extension until it is fixed. Scopes keep extensions to their keys; they cover `with-secrets` keys
  (a `config.json` credential pointing at an env variable or a file is the person's own wiring), and they don't sandbox the
  person's agents, who run as the same user.
- **Where you see it:** `ep0ch ext ls --long` and the extension's page (a "Keys" section) say each key it names as present,
  missing or not allowed, by name.

## Scripts

**When to reach for one:** a small thing that belongs to one note or one outline and needs no disk, network or secret: a
computed column over a note's children, a sentence built from its properties, a checklist stamped on every match, a move
you keep repeating. Needing a file, the web, a key or another language makes it an extension (below).

A script is a note with `[script::name]` and a closed `js` fence; `[mode::render]` makes it draw under a `name::` line,
`[effects::write]` lets it write. **The whole surface** (globals, `q`/`read`/`resolve`/`act`/`wait`, every `tools.*` and
`view.*`, modes, effects, lifecycle, traps, five worked examples you can paste) is one page with a `path:line` pointer per
entry: `packages/outliner/docs/scripts.md` in the repository. Read it before writing a script; its example 2 is the
usual start (a table of a note's children with a computed column). Two traps to know first: `this.children` is always
empty (use `q("parent:this")` or `read(this.id)`), and a `q` row has no properties (read the row).

The short form for working in an outline is [references/scripts.md](references/scripts.md).

## Extensions: adding one for a need

**Scripts:** `[script::]` blocks run through the host API (#583), macros save action lines (#585), bindings reach
keys, named commands, rules and `@name` (#588), and `@asks` answer in place while the person keeps typing (#590, #591).
Read ((d6ac2691-0585-4d09-9f89-435ee3be0ca3|the scripting design)) in pie for the shared parts.
Script files opt in under `<outline folder>/.ep0ch/scripts/` with `// ep0ch-script` on the first line.
They run read-only by default; `// ep0ch-script effects=write` declares writes. Files in the old `scripts/`
folder stay inactive; review them before `ep0ch doctor --fix --move-scripts`.

Extensions are trusted user code, like editor plugins, run by the service. Their data behaves as if the
person had copied it in: real blocks, namespaced properties (`jira.status`), queryable, linkable,
commentable, publishable when they choose. Four kinds, one extension may be several:

1. **Data** (`moon:: 2026-10-26`, `jira:: PC-1234`): the service fetches a record into a real block the
   extension owns, with namespaced properties (`[moon.phase::Full Moon]`), and refreshes it. The door and
   Detail show it under the line; `r` fetches it again.
2. **Inline output** (`horoscope:: virgo`): Markdown the service runs and keeps per line, shown under it and
   never written into the note unless someone **keeps** it (`[keep]`, `ext.<id>.keep`). `r` runs it again.
3. **Rich component** (`fancy-horror:: virgo`): data plus a view built from the shared primitives (card, box,
   row, stack, text, badge, stat, bar, table, checklist, sparkline, image) that every client draws, with actions
   (`[w ward]` in the door: its key, a click, or `act ext.fancy-horror.ward block=<id>`). Its state lives in
   the outline as blocks its actions write. A picture in a view is an `image` (`{ type: "image", src, alt?, size?,
   fit?, height?, caption? }`, PIE-827; `caption: false` draws a card's cover alone): drawn as a note's `[img::]` line is (the door's graphics, a page's served image inside
   the publish roots, elsewhere its alt text and file), so a gallery or a card's cover writes nothing to the outline.
   The `gallery` example: `gallery::` draws the notes under it as cards with their `[cover::path]`, `pic:: path` one.
4. **Tile** (`tarot.reading`): a program in a door terminal tile of its own kind (`^W o T`, or
   `act tile.open kind=tarot.reading note=<id>`). It reaches the outline only through the service's
   actions, so what it writes is the extension's.

**A form in the note** (PIE-828): when the person wants data entry where they work (a reading log, a bug report, a
sprint check), don't write an extension per form. With the Form extension installed (`outliner ext add form`), write the
fields on the note itself, one chip each: `[form-field::book text required] [form-field::pages number]
[form-field::mood choice gripping|slow|abandoned default=slow]` (types `text`, `number`, `choice` with its options split
by `|`, `property`, `note`, `tag`). Fill in the form (the power bar, or `act ext.form.fill block=<id> with='{"book":"…"}'`) writes an
entry under the note with the answers as properties. Any action can ask a note's fields: `"fieldsFrom": "block"` in its
`extension.json`. A chip it can't read is saved and warned on with a did-you-mean.

An action's writes are one group, one undo (`create`, `update`, `move`, `order`). Moving anchored text (a split, a
merge) uses `{ op: "move-anchor", from: "<block>^s5", to: "<block or as-name>" }`: the anchor goes with the text and
every link to it is repointed in the same step, so no forwarding line (`- → ((child)) ^s5`) is needed; an EchoNet copy
that links to it is told by netmail, never written (packages/outliner `docs/extensions/README.md#actions`).

**Rules** (PIE-600) say "when a block matches this, draw this on it, or run this", without touching its text:
`match` by a property (`type=meeting`), a saved-view query, a text pattern (line by line, never in code) or a
construct kind (`heading:1`, `callout`, `list`, `rule`, `image`); then `decorate` (view primitives before (`prepend`), after (`append`), in
place of or around what matched; `band` and `track` for heading styles and dividers) and `on` (an action when a
block starts or stops matching, or changes while it matches; an extension's own writes never set one off). The
no-code tier is a **rule note** you can write for a person in their outline:

```text
Committee headings [rule-name::committee-bands] [rule-under::((<id>))] [rule-kind::heading:2] [rule-decorate::band] [rule-pattern::stack] [rule-align::center]
Meetings [rule-name::meetings] [rule-match::type=meeting] [rule-decorate::card] [rule-fields::when, attendees]
```

A rule note can also run an installed extension's action (`[rule-on::<extension>/<action>]`), with guards for one that
starts an agent: `[rule-from::user, ext:echonet]` (whose saves set it off), `[rule-batch::1m]`, `[rule-cap::20/day]`,
`[rule-skip::triage=done]`. Nothing a trigger writes sets a rule off again. `rule-match` takes the views' whole grammar, a
tag included (`[rule-match::#pie-request]`), and rules see comments and replies as they see notes: a `#tag` typed in a
comment sets a tag rule off, and a lane's query on the tag lists the comment (a comment carries `annotation-status`,
not a note's `status`, so a lane that asks `status=new` also wants `OR (type=annotation annotation-status=open)`).

Scope it with `rule-under` unless they want it everywhere. The examples to copy for code: `meeting-card`
(decorate), `done-stamp` (on), `shout` (a text pattern). `R` in the door shows a note as written; `peek` lists a
reader's `decorations`. The contract: packages/outliner `docs/extensions/README.md#rules-when-a-block-matches`.

An extension can also declare **agents** a person addresses while they write: a line `@tidy` (after an
optional bullet) runs once that ask is quiet, even while the person types elsewhere. Its answer lands attributed
in a fold under the ask and in a tile beside it; plain answers stream as they are written. The door shows the
request's state under the line; `r` on it asks again.

All four kinds work end to end in the door and the service (PIE-507, PIE-512): the door binds whatever
`extensions.list` says, and an extension added or removed shows up or goes away without a restart.
Everything an extension writes is attributed `author: agent`, `actorId: ext:<id>`, whoever asked.

An extension is a folder: in the outline's own `extensions/<id>/` (under `~/outlines/<name>/`; it travels with that outline), or the
service host's user folder (`~/.config/pi-herdr-outliner/extensions/<id>/`, every outline): `extension.json`,
the code, `config.json` (secrets as references, never literals). `outliner ext ls` lists them, `outliner ext add
<id>` copies a built-in example (moon, horoscope, fancy-horror, tarot, tidy, jira, meeting-card, done-stamp, shout) into the user folder, or with
`--outline-folder <outline root>` into the outline's, `outliner ext remove <id>` takes it away (both apply
without a restart), `ep0ch install --apply` refreshes a copy nobody changed when the built-in moves on (`outliner ext
update <id>` shows a changed copy's diff and asks), and `outliner ext act <id> <action> --block <id>` runs an action. The contract and worked examples are packages/outliner
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
