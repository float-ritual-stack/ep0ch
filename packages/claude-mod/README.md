# Claude Code mod: Recent Mentions, outline, workboard and door tools

A [Claude Mod](https://github.com/anthropics/claude-code/issues/91870) (a plugin
with a function-hooks module) that forwards each completed Claude Code answer to
the Outliner's `mentions.ingest` contract. It works the same way as the Codex Stop hook
(the outliner's `src/mentions-codex.ts`). `[[page]]`, `((block-id))`, Work IDs and existing
UUIDs in the answer then show up in Tree/Detail `?` → **Recent mentions**.

- Only main-loop answers are sent. Subagent runs, interruptions, refusals and errors are skipped.
- They also show in Claude Code itself: [Recent mentions in Claude Code](#recent-mentions-in-claude-code).

## Which outline: the session's folder

There is nothing to configure. A session uses the outline its folder names,
found the way every client finds it (PIE-530): the nearest `.ep0ch`, from the
session's cwd up (it holds `ws = "<name>"`; `ep0ch init` or Herdr's Choose
outline popup writes it). The installed CLI answers (`outliner bound-folder
<cwd>`), so the mod never keeps a resolver of its own.

- A nested `.ep0ch` is nearer than its parent's, so a project naming its own
  outline keeps it. Similar path prefixes do not match.
- **A folder that names no outline feeds nothing**: no mentions, no links, and
  the outline tools refuse. No folder-name guess and no default outline is ever
  used, so an unrelated session never reaches your outline.
- Mentions, links, `show`, the workboard and outline tools all use that folder
  and the outline its `.ep0ch` names: the mod passes that name as `EP0CH_WS`,
  over an inherited one (and its `machine`, as `EP0CH_MACHINE`, empty for this
  one), so Claude's environment never moves a write elsewhere.
  With `EP0CH_SOCKET` (a host on another machine) in Claude's environment
  nothing is fed (one toast); use strict mode for that setup.
- The folder is found when the session starts (links and tools) and again after
  each answer (mentions), so binding a folder mid-session starts its mentions.
- Herdr discovers the Outliner (`herdr plugin list --plugin float.pi-outliner`),
  and the mod calls the installed CLI's `mentions ingest`. It never starts a service.
  Failures show as one toast and leave the answer untouched. An Outliner older
  than `bound-folder` feeds nothing and says so once per session.

### Opting out, and strict mode

`PI_OUTLINER_MENTIONS_WORKSPACES` (or the `workspaces` option) lists absolute
folders, separated by `:` or `,`. What the list means is
`PI_OUTLINER_MENTIONS_MODE` (or the `mode` option):

| Mode | The list |
|---|---|
| `folder` (unset with no list) | Folders opted out: a session in one, or below it, feeds nothing even when bound. |
| `allowlist` | Strict mode, as before folder mode: only listed folders (and their subfolders) feed, bound or not; the nearest listed folder is the workspace, and the CLI resolves its outline as it always did. |
| unset, with a list | Nothing feeds anywhere, with one toast a session. The list may be an allowlist from before folder mode, and reading it either way would start feeding folders nobody chose. Set the mode, or drop the list (`install-claude-mod.ts --folder`: every bound folder then feeds its outline). |

The option wins over the environment variable when it is set. Claude Code
passes an unset option as an empty string, so an empty option always falls back
to the variable. An entry that isn't an absolute folder (a relative path, or
`folder=name`), or an unknown mode, is an error shown as a toast, never skipped.

## Clickable references and the Outliner Detail beside Claude

In a bound folder, Work IDs (its outline's prefixes), `[[pages]]` and
`((block references))` in Claude's replies are drawn as links. In a door
tile a click opens the note in that door ([Where a note opens](#where-a-note-opens)).
In Herdr a plain click shows the target in **the Outliner Detail beside Claude**: the admin
Detail linked to the Tree in Claude's Herdr workspace, else a Detail opened below that Tree,
else a new Tree and Detail beside Claude. The Outliner finds or opens it (its own
`ensure-detail`, run with `--no-focus`), so there is one Detail finder. It never takes
focus. References in code and existing links are left alone.

Claude can put a note there too, with the `mcp__pi-outliner__show` tool (a Work
ID, `[[page]]`, `((uuid))` or `pi-outliner://` URI).

### Where a note opens

A click, `show` and `door_open` share one open (`openNote` in
`hooks/register.ts`), tried in this order:

1. **In a door tile** (`EP0CH_CONTROL` set: the daily agent, the drawer's
   agent, or a `claude` started in a `^W o s` terminal tile, in the tile or in
   its Herdr pane): the CLI's `door-open --from <tile>` sends the door an
   agent's `open` from Claude's own tile over `EP0CH_CONTROL`. The tile is
   `EP0CH_TILE`, or its id (`EP0CH_TILE_ID`, `t<n>`) when the name is empty. The
   door puts it where that tile's opens land (its link: the daily layout links
   the claude tile to its middle detail) and says which reader that was. A door
   without that tile is asked again naming no tile, and puts it where its own
   `open` puts notes, which never takes the person's keys. The mod never names a
   reader (a door refuses an agent that names the reader the person is on).
   - The door says who opened it (`claude-code`, or `OUTLINER_ACTOR` /
     `EP0CH_AGENT`), and an agent's open never moves the person's focus.
   - If the door refuses (say it is on its menu, or the reader the tile links
     to holds an edit), its reason is the answer: the tool's denial or a toast.
     It is never shown somewhere else instead.
   - If the door takes the request but doesn't answer within 5s, it says so;
     it isn't shown in Herdr too.
   - Only if no door answers there (the door quit) does it go on.
2. **In Herdr** (`HERDR_PANE_ID` set): the Outliner Detail beside Claude, as above:
   the installed Outliner's `src/herdr-open.ts --mode ensure-detail --no-focus` names it
   (`detailClientId`), then `outliner link <uri> --detail-client <id> --no-focus`
   shows the note there. A door
   tile drops Herdr's pane variables, so this is a plain Herdr pane, or the
   daily agent's Herdr pane after its door quit.
3. **Here** (neither: the desktop app's Code tab, VS Code, a terminal outside
   Herdr): the mentions pane shows the note in place of its list
   ([The note here](#the-note-here)). A press seats the pane itself, so it is
   placed at any width; `show` opens it as the agent's own, which waits below
   144 columns and says so.
4. **Without the session's outline** (an unbound folder, a block id given to
   `show`): a toast (or the tool's denial) saying it can't open the note here
   and why, with the exact command that reads it in any terminal (`ep0ch show
   <id>`, the door's renderer, needing only the outline host) and its `((id))`
   to copy. A click never fails silently.

- Only the invoking Herdr workspace's Trees count: a Detail in another workspace
  is never "beside you". Two Trees in one tab is the Outliner's refusal, said in a
  toast (and in the pane's heading, "can't open beside you: …"); the Outliner
  raises no Herdr notification for the mod's opens, which say it themselves.
- If you are editing in that Detail, a click or `show` is refused with a toast
  (the Outliner protects active edits) rather than opening a second pane.
- Clicks reach the mod in the fullscreen terminal (`"tui": "fullscreen"`).
- Links carry `https://pi-outliner.invalid/...` stand-ins, because Claude Code only
  draws https, http and file links as links. Where it does not detect terminal
  hyperlink support (a Herdr pane), it prints each URL beside its text; set
  `FORCE_HYPERLINK=1` in the settings `env` block to draw the text alone.
- A target the Outliner cannot resolve is a toast, never a new page.

### Where this Claude is bound

So nobody has to ask which outline Claude's tools reach (PIE-546), the mod says it three ways, from one set of facts:

- **A card** in the band above the prompt, at the start and again after `/clear`, until `h` (or its
  hide button) puts it away; `/outline` shows it again and prints it, and `/outline <name> [machine]` binds the
  session to that outline (PIE-756). Which outline the tools use, first match wins: that call (or `outline_bind`),
  then `EP0CH_WS` (with `EP0CH_MACHINE`; the door passes both to every tile program, the drawer agent and the Herdr
  launcher's pane), then, in a door tile, the door's outline, then the `.ep0ch` of the folder the session started in.
  A shell `cd` moves none of them. It says, in plain words:
  - **outline:** the one the outline, workboard and mention tools use, and its machine (`harbor, on far
    (another machine)`, or `garden, on this machine (near-box)`); or "none: the … tools are off";
  - **why:** the `.ep0ch` that names it, or that nothing names one here, with the exact command that binds the
    folder (`ep0ch init harbor --machine far` in a door: the door's outline; else `ep0ch init <name>`);
  - **careful** (yellow): the folder names one outline and the door Claude sits in is on another. The outline
    tools write to the folder's; the door tools act in the door's;
  - **Claude:** the machine and folder Claude runs in;
  - **door:** the drawer or a tile of which door, or not in a door, and the Herdr pane;
  - **tools:** one set, from this mod.

  Beside Recent mentions the card keeps to the binding (outline, why, the yellow line), so the mentions'
  keys stay on screen.
- **A status line** that stays: `outline: harbor @ far · folder, door` (or `· folder · ⚠ door is …`,
  `none (tools off) · … · ep0ch init …`). The folder's outline and `where` are read again on a turn at most
  every 30s (the Work-ID prefixes kept), so a door that reconnected or changed, or a new `.ep0ch`, shows, and the
  tools follow the same read.
- **The model's context**: the same lines as a block (`outlineBinding`) of the first prompt (and after `/clear`),
  made again when a later read changes them, or when the first prompt came before the first read landed.

The facts come from two places, never guessed: the folder's outline as the tools found it (`bound-folder`,
above), and `ep0ch where --json` (this machine and folder, the door, its outline and machine, the Herdr pane).
`where` runs at the start in or out of a door; without a usable `ep0ch` the card says the door wasn't checked.

### Where this session runs

In a door tile (`EP0CH_NEST` or `EP0CH_CONTROL` set), the mod uses `ep0ch where
--json` (run when the session starts). The first prompt then carries its one-line
summary as a context block (`whereAmI`), not a pane: the layers the session runs
in, outermost first (`ssh:pts/5 › herdr:w1:p1 › door:<pid>/desk/t1:claude`, the door's
`EP0CH_NEST`), which of them are live, and where the person's keys are. Claude
then doesn't have to guess from the repo name or a window title.

- `where` only reads. The mod asks `ep0ch help` first. An ep0ch older than `where`
  would take the word for a socket and open a door, so it is never run. The help
  call carries a socket path that never exists, so an ep0ch older than `help` (which
  would take `help` the same way) stops at "no carrier" instead of opening a door.
- Without a usable `ep0ch` (not on PATH, too old, an error, or no answer within
  1.5s of the first prompt), the block has the variables alone and says they are unchecked.
- It never blocks or fails the session: the work runs after the start, and any
  failure leaves the context as it was. Outside a door, this block isn't added (the binding card's is).

### What this Claude is doing, to its terminal (PIE-614)

The mod reports Claude's own state to the terminal it runs in with OSC 7501 (the Program Status Protocol), so a door's
terminal tile (or Ghostty, Rex) knows it without reading Claude's screen: `idle` at the start, `working` when a turn
starts and after a tool runs, `blocked` with `kind=permission` when a permission dialog shows (and the Notification
`permission_prompt`) or `kind=question` for AskUserQuestion and an MCP elicitation, `done` with the answer's first line
when the main loop's turn ends, `idle` when it's interrupted, `error` for a refusal or an API error, cleared when the
session ends. Every report carries `app=claude-code`. `hooks/claude-status.ts` holds the mapping (pure);
`hooks/program-status.ts` is outline-core's encoder, copied (a hooks module can't import outside the plugin) and kept
identical by outline-core's test. It writes only where the terminal speaks the protocol: `EP0CH_PROGRAM_STATUS` says
outright (1, 0), else `tput Pst` (a door's tiles have it); it never sends the feature query, as Claude owns the input. This build of Claude Code reports nothing itself (its plugin API has no such call); once it does, `EP0CH_PROGRAM_STATUS=native` makes the mod step aside, so a record never has two writers (the mod can't read Claude's own output to notice by itself).

## Recent mentions in Claude Code

The blocks this conversation's answers mentioned show beside it, read from the
same retained history Tree and Detail show (`outliner mentions list --agent
claude --session <id>`, the service's `mentions.list`), never a list of the
mod's own. It is read again after each answer is ingested.

- **Where:** a compact **band** above the prompt (one row: `1: Bike shed  2:
  Chain oil  …  p: previews  s: all conversations  m: to pane  x: hide`), or a
  fuller **pane** beside the transcript (each mention with what was written,
  when, and the words around it). `m` moves it between them, `x` hides it, and
  the choice is kept across sessions (`$.store`, `mentions-view`). Closing the
  pane with its mark keeps it hidden. `/mentions [band | pane | off | preview |
  scope]` makes the same choices by keys; `/mentions` alone shows a hidden band.
  Only `band`, `pane`, `off` and `/mentions` alone move anything: `preview` and
  `scope` leave the band or pane where it is (a band standing in for a waiting
  pane stays the band, and says so).
  The band draws only once there is something to show, so an empty one leaves
  the slot above the prompt to others.
- **What counts:** only a `((id))`, `[[page]]` or Work ID that resolves in the
  session's outline (the service resolves it at ingest). A source number from a
  document (`S-87`), another outline's Work ID or a page nobody made is dropped,
  never listed. "(gone)" is kept for a block named by id that was deleted since;
  a page that no longer resolves drops off the list.
- **Preview:** `p` turns on a small preview of each block (the newest two in the
  band, every one in the pane), drawn by the door ([BlockView](#blockview)).
- **Scope:** `s` switches between this conversation's mentions and every
  conversation's in the outline, as the Tree's `s` does.
- **Open:** a click, or the mention's number, opens it through the one open
  every click, `show` and `door_open` share ([Where a note opens](#where-a-note-opens)):
  in the door this session runs in, as the agent, never taking focus; else
  the Outliner Detail beside Claude in Herdr; else here, in the pane, in place
  of the list ([The note here](#the-note-here)). The pane's heading says which
  it will be: "opens in this door"; in Herdr, "opens in the Outliner Detail
  beside you" when the Outliner's `find-detail` (which opens nothing) finds one,
  else "opens in a new Outliner Detail beside you"; with neither, "opens here, in
  a detail pane". It asks again each time the list is read.
- Every action is a Button with a hotkey: by mouse, or by keys once the band or
  pane holds them. The keys are Claude Code's, and each site's last line says them:
  - **ctrl+x tab** moves the keys to the band (or the pane) and back to the prompt;
    Esc hands them back too. A click on it does the same.
  - There, **Tab** and the **arrows** move between the mentions (the pane lists
    them before its controls), **Enter** or the mention's **digit** opens it, and
    `p`, `s`, `m`, `x` are the controls.
  - **ctrl+x ctrl+a** folds the band (its `[-]`); **ctrl+x x** closes the pane,
    which keeps it hidden until `/mentions pane` (or `/mentions`).
- The pane never opens with focus, so the prompt keeps the keys. `m` (and
  `/mentions pane`, every time, even when the pane is already the choice) opens
  it as the person's own ask, placed at any width. Opened at session start (the
  pane was the choice), Claude Code seats it only from 144 columns (110 once you
  opened it): below that it waits undrawn, and so does a pane the engine drops.
  While the pane is chosen but not on screen, the band stands in for it, its `m`
  reading `show pane`, so the mentions never vanish. The `m` press opens the pane
  from its own `ui.press` hook: an open from the drawing's closure counts as the
  plugin's, not the person's, and used to leave a narrow terminal with neither.

## The note here

With no door or Herdr around, a note opens in the mod's own pane: the mentions
pane shows it in place of the list (a second pane would be a tab behind the
first, out of sight). It is the third case of the one open (`openNote`), not a
router of its own; `hooks/detail-view.ts` is its pure half.

- **What it shows:** the note's title, "opens here: no door or Herdr around",
  then the note drawn by [BlockView](#blockview), one renderer per surface:
  - **terminal:** the door's cells (`ep0ch show <id> --cells --rows 400`), its
    references as buttons under it (hotkeys 1 to 9), since cells hold no links;
  - **desktop and VS Code:** `Markdown`: the note's first line as a heading, its
    text as written (lists, headings, callouts as quotes, `::` figures fenced
    under their name, a one-line `::links` as code), its children as a nested
    list, and every `[[page]]`,
    `((block))` and Work ID as a link.
- **What it reads:** the door's export of the note and its children (`ep0ch
  export <id> --children --out -`, PIE-534: the body as written, children as
  nested lists; its front matter dropped), from an `ep0ch` whose help lists it;
  else the outliner's read (`outliner list --subtree <id> --limit 200`) laid out
  the same way. Escapes and control characters are taken out; it is cut on a
  whole line to Markdown's 10,000 characters, saying the rest is in the outline
  (as when the outliner's read was cut short). The read runs off the open queue,
  so a slow one never holds the next open.
- **Links:** a link pressed (desktop's `onLinkPress` on the keyed Markdown, or a
  link button) goes through `openNote` again, which lands here: the pane walks
  to it, with history. **b** goes back (from the first note, to the mentions
  list), **f** forward, **l** straight to the list, **c** copies the command that
  reads it in any terminal (`ep0ch show <id> --ws <outline>`), now a secondary
  button rather than what a press does.
- Opened for a note while the band is the choice, closing the pane keeps the
  band; it opens on the list next time.
- Not yet: folding children in the pane.

## BlockView

`hooks/block-view.ts` draws an outline block as the door draws it, in any pane
or band of the mod (`drawBlock` in `hooks/register.ts` is `<BlockView id
width/>` for a render hook: it keeps each drawing for the session by block,
revision and width, and loads it off the draw). It is glue, not a renderer: it
runs the door's CLI, `ep0ch show <id> --cells --width <n> --rows 24`, whose JSON is a
`Raster`'s cells as the API documents them (row-major, base64 of u32 LE
`[codePoint, fg, bg]`, `0x01000000` the terminal's own colour), and hands the
rows on. Only the outline host has to run: no door, no Herdr.

- Cells rather than styled spans: a `Raster` is one leaf the terminal paints
  exactly as the door laid it out (rules, tables, colours), with nothing to wrap
  again, and `$.ui.blit` can repaint it in place.
- A `Raster` cell is one width-1 BMP character: the door sends U+FFFD and a blank
  for a wide glyph (CJK, most emoji), so the columns after it stay put, and
  counts them in `replaced`. Bold, italic and underline have no place in a cell.
- Where the CLI can't draw (no `ep0ch` on PATH, one older than `--cells`, which
  `ep0ch help` is asked first as `where` is, or no host answering), and on a
  surface without `Raster` (desktop), the block's text is drawn by `Markdown`:
  dim for a preview; with `links`, the note here, its references pressed.
- Widths are 10 to 200 columns; a preview asks the door for at most 24 rows
  (`--rows`), the note here for 400.
- One drawing is kept per block, the latest: a new width is drawn after a short
  pause (a resize being dragged draws once), a new revision when the caller
  passes `revision` (without it, an edit isn't seen until the session restarts).
  `source` defaults to the session's outline (its folder and `EP0CH_WS`).

## Workboard tools

In a bound folder Claude also gets `work_create`, `work_stage`, `work_set`,
`work_deliver`, `work_complete`, `work_body` and `note_section`. Each one runs the
installed CLI's `work` / `note` command (see the
[roadmap operations reference](../outliner/pi-extension/skills/outliner-workflow/references/roadmap-items.md#agent-commands))
in the session's workspace, as an agent write attributed to `claude-code` and
this session. Items are named by `ref` (a Work ID or block UUID; `item` still works), never by title. The tool
result is the command's JSON; a refusal (stale revision, unknown stage, unmerged
delivery…) comes back as the CLI's reason.

An item can have several deliveries, one per PR. `work_deliver` takes a `key`
(`door` → `PIE-123/door`); `work_complete` takes `deliveries` or `allMerged` and
is refused, naming what is left, while any other delivery is incomplete; and
`work_set` sets `delivery-stage` on a delivery named by UUID or key, such as
one left in validate on an item that is already done.

## Outline tools

In a bound folder Claude gets typed tools for everything an agent does to
the outline, so it never writes a script around `list --subtree`, `update` or a
comment socket. Each runs the installed CLI's `agent <operation>` command
(the outliner's `src/agent-tools.ts`) with the tool's input as JSON on stdin, in the session's
workspace, and returns compact JSON. The service keeps the rules; a refusal
comes back as the tool's error with the reason.

| Tool | Input | Returns |
|---|---|---|
| `outline_read` | `ref`, `depth?` (1, at most 6), `limit?` (50, at most 500) | full `text` (never the title alone), `properties`, `revision`, `author`, `actorId`, `updated`, children to `depth` with full text (60k characters of children's text at most), `complete` |
| `outline_find` | `text?`, `property?` (`key=value` or `key`), `hasKey?`, `query?`, `under?`, or `view?`; `limit?` | rows: `id`, `title`, `revision`; `complete` |
| `outline_resolve` | `ref` | `id`, `title`, `revision`, `workId`, `fragmentId` |
| `outline_edit` | `ref`, `expectedRevision`, one of `text`, `replaceSection {heading, body}`, `append`; `allowStructural?` | the new `revision`, a short `diff`, and with `allowStructural` what it `dropped` |
| `outline_create` | `parent` (a ref or `root`), `text`, `position?` | `id`, `ref`, `revision` |
| `outline_comment` | `ref`, `body`, `quote` (with `start`/`prefix`/`suffix` when it repeats) or `whole: true`, `requestId?` | the `thread` id |
| `outline_reply` | `thread`, `body` | the `reply` id |
| `outline_resolve_thread` | `thread`, `resolved` | the thread's `lifecycle` |
| `outline_components` | `components?` (ids; all when left out) | `ep0ch library --brief` for this session's outline: per component its purpose, where it goes, each property as `key: values (default) — meaning`, a minimal example. Run from the bound folder, so the outline's own styles and types and its extensions' components appear |
| `outline_bind` | `name`, `machine?` | Binds this session's outline, workboard and mention tools to the outline `name` for the rest of the session (`/outline <name> [machine]` is the same call). It beats `EP0CH_WS` and every folder; an outline that does not exist is refused with the ones that do. Every "not bound" refusal names this call with a real name |
| `outline_changes` | `since` (an ISO time or a returned `cursor`), `author?`, `actor?`, `limit?`, `before?` | each changed block once, newest first, with who changed it; `complete`, with `before` for the older page when it is false; the next `cursor` |
| `view_order` | `ref` (the view: id, `((id))` or `[[page]]`), `ids?` (block ids, `((id))`s or Work IDs) | the view's hand-set order (`{view, ref, order: [{id, title, workId?}]}`); with `ids`, those members first in that order, the rest after them as they were, recorded as the agent. A sorted view refuses, naming the `[sort::]` to remove |
| `outline_patch` | `ref`, `revision`, `patches: [{observed, replacement}]`, `mark?`, `policy?` (`edit`, the default, or `prose`), `allowStructural?` | `draft.patch`'s outcome: `applied`, or `proposed` with the reason |
| `outline_set_property` | `ref`, `key`, `value`, `revision` | one header chip set as a `draft.patch` span: `applied`, `proposed` with the reason, or `unchanged` |
| `outline_assign_id` | `ref`, `revision` | the outline's next work id stamped on the note (`outliner work-id-allocate`), recorded as the agent: `{outcome, workId, page: "[[HUB-002]]"}`, `unchanged` when it had one. The id is the page address (no `[page::…]`); for notes that aren't roadmap items, where `work_create` makes a roadmap item |

A `ref` is a block id, `((id))`, `[[page]]` or a Work ID. A title is refused:
find it with `outline_find` first.

**`ref` is the one argument for "which note"** on every tool that takes one: the `outline_*` tools, `work_*`,
`note_section`, `view_order`, `show` and `door_open`. The names a model reaches for are accepted too (`id`,
`reference`, `block`, `blockId`, `uri`, `note`, and `item` on the workboard tools; `view` on `view_order`), through
`hooks/tool-args.ts`, which every tool call passes before it runs. Two of them naming different notes (`{ref: "PIE-520",
id: "PIE-588"}`) is refused as ambiguous, and nothing runs; the same note spelt two ways (`((id))` and the id) is
accepted. A wrong call is answered with what was wrong and the right call: the unknown argument and the closest valid
one, what is missing or the wrong type, the tool's arguments in one line, and a call that works. That file is the same
code as `packages/outline-core/src/tool-args.ts` (hooks can't import it); the door's
`test/tool-args.test.ts` fails when the two differ.

- **The safe path is read, then edit with the revision.** `outline_edit` refuses
  an empty or whitespace-only result, a revision that isn't the block's (read it
  again), and an edit that drops a `[page::…]` or an `^anchor` another note
  links to, unless `allowStructural: true` (the check is `refuseDroppedStructure`
  in the outliner's `src/work-tools.ts`, over `droppedLinkedStructure` and `droppedStructure`). An
  agent's `note_section` and `work_body` get the same check, with no way past it:
  removing them is an `outline_edit` with `allowStructural`.
- Rewriting your own pages, such as a status page, is `outline_edit`. For small
  edits to a note the person may be typing in, `outline_patch` sends
  `draft.patch`: the door holding the live draft applies it in place, and with
  none it is an ordinary edit of the saved note. Its default policy, `edit`, is
  `outline_edit`'s guard (`allowStructural` likewise), refused as an error;
  `policy: "prose"` keeps every link, anchor and property. A patch whose text
  changed under it, or that `prose` refuses, becomes one proposal the person
  can apply.
- Every write is `author: agent`, with the session id as provenance, and an
  actor id: the call's `actor`, else `OUTLINER_ACTOR`, else `EP0CH_AGENT` (the
  name the door shows for the agent), else `claude-code`. The workboard tools
  use the same actor, from the environment.

### Tool rows in the transcript

The mod draws its own tool calls in the transcript as one compact row each, in place of Claude Code's
`pi-outliner - outline_edit (MCP)(ref: "PIE-569", … append: "\n## …")` and its JSON answer, so a write reads as
what it did and can be checked where it happened (`hooks/tool-rows.ts` is the pure half: what an input and an
answer say, and the tree).

```
▸ ✎ PIE-569 · appended "Inside or outside the frame" · rev 1→2
  + "A tab can hold a split" · created · under PIE-569
  💬 comment on PIE-492 · on "runner beans" · "Which variety?"
  ⇄ PIE-561 · stage later → queued
  ⌕ find "dropdown menu" · 6 hits
```

- **Writes** (`outline_edit`, `outline_patch`, `outline_set_property`, `outline_assign_id`, `outline_create`, `outline_comment`, `outline_reply`,
  `outline_resolve_thread`, `note_section`, `work_*`, `view_order` with `ids`): a verb glyph, the note (its Work ID,
  page or title; a block id's title is looked up once a session, off the draw) and the change. **Reads**
  (`outline_read`, `outline_find`, `outline_changes`, `outline_resolve`, `show`) are one dim line.
- **The note is a button:** pressed, it opens where a reference in a reply opens ([Where a note opens](#where-a-note-opens)).
- **`▸` unfolds** what the write wrote, as Markdown: an append's text, a replace's or patch's diff, a new block's or
  item's body, a comment with its quote, a view's new order (a find's hits, a changes listing). `▾` folds it. At most
  40 lines, then "… n more lines". Rows start folded; each row's fold is kept for the session by its tool call.
  Transcript rows never hold the keys, so the fold is a click.
- **States:** a running call ends in `…`; an errored one's glyph is red with the first line of the reason under it
  (Claude Code's result row under it still says it in full); an interrupted one is dim and says so; a patch that
  became a proposal, or an edit that dropped linked structure, says so in yellow.
- **The result row** under a write is one line (`⎿ ✓ rev 2`, `✓ applied`, `✓ thread open`) and under a read nothing,
  since the row says it.
- **Off and on:** `/tool-rows off` puts Claude Code's own rows back (kept across sessions in `$.store`, `tool-rows`);
  `/tool-rows on` brings these back. They are on unless turned off.
- Anything the formatter doesn't recognise (an input of another shape, a tool it doesn't know) and a drawing that
  throws are Claude Code's own row, so the transcript never breaks.

### Files this session touches (PIE-602)

Claude Code's own **Edit** and **Write** rows are drawn the same way, and each file they change is filed in the
session's outline.

```
▸ ✎ beds/plan.md · +2 −1 · diff
▸ + /notes/seed-list.txt · created · +4 −0
```

- **The row:** the file (relative to the session's folder), the lines added and removed (git's count, else the
  patch's), and `diff`. `▸` folds open on the patch. Pressed in a door tile, the file opens where an agent's open
  lands (`ep0ch open file:<path>`): Markdown drawn as the preview draws a file, any other file through the file
  Resource reader; `diff` opens its changes (git's diff against its last commit, else against the copy kept before
  the first touch). Outside a door the path is copied and a toast says it opens in a door. `/tool-rows off` puts
  Claude Code's rows back, these too.
- **The record:** after each Edit or Write that ran (never a denied or failed one), off the call and one at a time,
  the installed CLI's `agent touch-file` files it as this session (the outliner's `src/file-touches.ts` owns the
  shape): under `[[recent-files]]` › the day › the project (its git repository, else the session's folder) › this
  session, **one `[file::]` block per file per session**, its `touches`, `last-touch`, `added` and `removed` brought up
  to date on each touch. `By project` there holds one view per project, newest first. A file outside git sends the
  file as it was with its first touch, kept once in the outline's folder (`file-touches/<session>/`) for its diff.
  Only in a folder bound to an outline; a failure is one toast a session.

### Comments on a file (PIE-650)

A file is a Resource in the outline, and anyone can comment on a passage of it (the door's `C` in a reader showing it, an
agent's `outline_comment`). The thread is stored in the outline, beside the file; the file is never written.

- **`outline_read`** on `resource:<id>` or a `[file::path]` token returns the file's stored text and its **open
  threads** (who, the quote as it read when written, whether the passage is still where it was, the replies). A file an
  agent rewrote keeps its threads: the service finds a quote that is still there again, and a thread whose passage went
  stays listed with `anchored: false`.
- **`outline_comment`** takes the same ref: `quote` is exact text of the file as `outline_read` returned it (the source,
  not a rendered view), `from` the note whose link opened it (kept as the thread's reference context, so the thread also
  shows among that note's comments).
- **Before an edit:** the first Edit or Write of a file in a session asks the installed CLI whether the file has open
  threads. If it does, the call is **held once** with them in its answer, so Claude reads what was said before it
  rewrites the file; the same call again goes through. A file with none, a folder bound to no outline, or any failure
  holds nothing. A Read is never held: `outline_read` is how Claude sees a file's threads while reading.

## Door tools

When Claude runs in a door tile (`EP0CH_CONTROL` set), it also gets
`door_where`, `door_peek`, `door_act { action, args?, tile? }` and
`door_open { ref }`. They run `ep0ch where --json`, `ep0ch peek` and
`ep0ch act …` on that socket; `door_open` is the same open as a click or `show`
([Where a note opens](#where-a-note-opens)). Without
`EP0CH_CONTROL` they are not offered, and a call is refused.

- **They follow the door** (PIE-604). The door is found at each call, never from
  what Claude started with: `ep0ch` and the outliner's `door-open` take
  `EP0CH_CONTROL` while it answers from the tile's outline session folder
  (`EP0CH_PLACE`), else that outline's door there. A session handed over by
  `ep0ch install --apply`, or restarted, keeps its Claudes' door tools working,
  and the binding card's door line says "its door changed since Claude started:
  the door tools follow the one that answers" (or, with none answering, that they
  reach none until one does). A Claude started before `EP0CH_PLACE` existed needs one restart.

- `door_act` and `door_open` are attributed with `--as` (the same actor as
  above), and the door says so on the person's screen.
- The door never lets an agent take the person's focus, keys or selection.
  Its refusal comes back as the tool's error; `block.mark` is how to ask for
  their attention.
- `ep0ch` reads an argument starting with `@` as a file, so the tool sends one
  such value through stdin (`key=@-`) and refuses a second.
- `door_open` resolves a `[[page]]` or Work ID in the session's outline first;
  a block id opens in a folder bound to no outline too. `show` (above) is the way to
  put a note beside Claude wherever it runs.

## Use

Function hooks are early access and need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

The installer sets up everything below: `install.sh --claude-mod`, or, from a
checkout, `bun packages/outliner/scripts/install-claude-mod.ts`. It needs no folder.
`ep0ch doctor` says whether Claude Code loads this checkout's mod.

```sh
claude --plugin-dir ~/projects/ep0ch/packages/claude-mod
```

To load it in every session, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and
`CLAUDE_CODE_PLUGIN_DIRS=<checkout>/packages/claude-mod` in the `env` block of
`~/.claude/settings.json`; that is what the installer writes, replacing any
other copy of this mod and backing the file up first.

| Installer | Does |
|---|---|
| `install-claude-mod.ts` | Loads the mod. The folder list and mode are kept; a list with no mode is named (it feeds nothing until the mode is set). |
| `install-claude-mod.ts --exclude /folder` | Opts the folder out (repeatable; `PI_OUTLINER_MENTIONS_MODE=folder`). |
| `install-claude-mod.ts /folder` (or `--allowlist /folder`) | Strict mode: only these folders feed (`PI_OUTLINER_MENTIONS_MODE=allowlist`). |
| `install-claude-mod.ts --folder` | Folder mode, dropping an allowlist (strict mode's, or a list with no mode from before folder mode) and naming its folders bound to no outline. |

`install.sh` passes `--claude-exclude` as `--exclude` and `--claude-workspace`
as strict-mode folders. To stop the mod, remove its folder from
`CLAUDE_CODE_PLUGIN_DIRS`.

## Develop

From the repository root:

```sh
claude plugin validate packages/claude-mod
claude plugin test packages/claude-mod
# types: run /plugin-types packages/claude-mod/.claude/types in a session, then
tsc -p packages/claude-mod/tsconfig.json
```

The hooks module can't import application code: it runs the outliner's installed CLI (found through Herdr).
