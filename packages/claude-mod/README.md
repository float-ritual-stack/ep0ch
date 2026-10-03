# Claude Code mod: Recent Mentions, outline, workboard and door tools

A [Claude Mod](https://github.com/anthropics/claude-code/issues/91870) (a plugin
with a function-hooks module) that forwards each completed Claude Code answer to
the Outliner's `mentions.ingest` contract. It works the same way as the Codex Stop hook
(`src/mentions-codex.ts`). `[[page]]`, `((block-id))`, Work IDs and existing
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

## Clickable references and Claude's Outliner pane

In a bound folder, Work IDs (its outline's prefixes), `[[pages]]` and
`((block references))` in Claude's replies are drawn as links. In an ep0ch-door
tile a click opens the note in that door ([Where a note opens](#where-a-note-opens)).
In Herdr a plain click shows the target in **Claude's own Outliner Detail**: a pane split below the
Claude pane the first time, then reused for every later click in the session.
It never navigates your Trees or Details and never takes focus; move or resize
it as you like. References in code and existing links are left alone.

Claude can put a note there too, with the `mcp__pi-outliner__show` tool (a Work
ID, `[[page]]`, `((uuid))` or `pi-outliner://` URI).

### Where a note opens

A click, `show` and `door_open` share one open (`openNote` in
`hooks/register.ts`), tried in this order:

1. **In an ep0ch-door tile** (`EP0CH_CONTROL` set: the daily agent, the dock's
   agent, or a `claude` started in a `^W o s` terminal tile, in the tile or in
   its Herdr pane): the CLI's `door-open --from <tile>` sends the door an
   agent's `open` from Claude's own tile over `EP0CH_CONTROL`. The tile is
   `EP0CH_TILE`, or its id (`EP0CH_TILE_ID`, `t<n>`) when the name is empty. The
   door puts it where that tile's opens land (its link: the daily layout links
   the claude tile to its middle detail) and says which reader that was. A door
   older than `open from=`, or without that tile, is asked again naming no
   tile, and puts it where its own `open` puts notes, which never takes the
   person's keys. The mod never names a reader (it used to ask for `middle`; a
   door refuses an agent that names the reader the person is on).
   - The door says who opened it (`claude-code`, or `OUTLINER_ACTOR` /
     `EP0CH_AGENT`), and an agent's open never moves the person's focus.
   - If the door refuses (say it is on its menu, or the reader the tile links
     to holds an edit), its reason is the answer: the tool's denial or a toast.
     It is never shown somewhere else instead.
   - If the door takes the request but doesn't answer within 5s, it says so;
     it isn't shown in Herdr too.
   - Only if no door answers there (the door quit) does it go on.
2. **In Herdr** (`HERDR_PANE_ID` set): Claude's own Detail, as above. A door
   tile drops Herdr's pane variables, so this is a plain Herdr pane, or the
   daily agent's Herdr pane after its door quit.
3. **Anywhere else**: a toast (or the tool's denial) saying it can't open the
   note here and why, with the exact command that reads it in any terminal
   (`ep0ch show <id> --ws <outline>`, the door's renderer, needing only the
   outline host) and its `((id))` to copy. A click also copies that command.
   A click never fails silently.

- The pane is recognized by its browsing context, which is the Claude session
  id, so it survives plugin reloads and resumed sessions. Close it and the next
  click splits a new one.
- If you are editing in Claude's pane, a click or `show` is refused with a toast
  (the Outliner protects active edits) rather than opening a second pane.
- Clicks reach the mod in the fullscreen terminal (`"tui": "fullscreen"`).
- Links carry `https://pi-outliner.invalid/...` stand-ins, because Claude Code only
  draws https, http and file links as links. Where it does not detect terminal
  hyperlink support (a Herdr pane), it prints each URL beside its text; set
  `FORCE_HYPERLINK=1` in the settings `env` block to draw the text alone.
- A target the Outliner cannot resolve is a toast, never a new page.

### Where this session runs

In a door tile (`EP0CH_NEST` or `EP0CH_CONTROL` set), the mod runs `ep0ch where
--json` when the session starts. The first prompt then carries its one-line
summary as a context block (`whereAmI`), not a pane: the layers the session runs
in, outermost first (`ssh:pts/5 › herdr:w1:p1 › door:<pid>/desk/t1:claude`, ep0ch-door's
`EP0CH_NEST`), which of them are live, and where the person's keys are. Claude
then doesn't have to guess from the repo name or a window title.

- `where` only reads. The mod asks `ep0ch help` first. An ep0ch older than `where`
  would take the word for a socket and open a door, so it is never run. The help
  call carries a socket path that never exists, so an ep0ch older than `help` (which
  would take `help` the same way) stops at "no carrier" instead of opening a door.
- Without a usable `ep0ch` (not on PATH, too old, an error, or no answer within
  1.5s of the first prompt), the block has the variables alone and says they are unchecked.
- It never blocks or fails the session: the work runs after the start, and any
  failure leaves the context as it was. Outside a door, nothing is added.

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
- **Preview:** `p` turns on a small preview of each block (the newest two in the
  band, every one in the pane), drawn by the door ([BlockView](#blockview)).
- **Scope:** `s` switches between this conversation's mentions and every
  conversation's in the outline, as the Tree's `s` does.
- **Open:** a click, or the mention's number, opens it through the one open
  every click, `show` and `door_open` share ([Where a note opens](#where-a-note-opens)):
  in the door this session runs in, as the agent, never taking focus; else
  Claude's own Detail in Herdr; else the command that reads it anywhere
  (`ep0ch show <id> --ws <outline>`) is copied, said in a toast and kept in the
  band or pane. The pane's heading says which it will be.
- Every action is a Button with a hotkey: by mouse, or by keys once the band or
  pane holds them (ctrl+x tab, or a click). The pane never opens with focus, so
  the prompt keeps the keys; opened at session start (the pane was the choice),
  Claude Code seats it only where it is a sidebar (from 144 columns).

## BlockView

`hooks/block-view.ts` draws an outline block as the door draws it, in any pane
or band of the mod (`drawBlock` in `hooks/register.ts` is `<BlockView id
width/>` for a render hook: it keeps each drawing for the session by block,
revision and width, and loads it off the draw). It is glue, not a renderer: it
runs the door's CLI, `ep0ch show <id> --cells --width <n>`, whose JSON is a
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
  surface without `Raster` (desktop), the block's text is drawn by `Markdown`.
- Widths are 10 to 200 columns; a preview keeps at most 24 rows.

## Workboard tools

In a bound folder Claude also gets `work_create`, `work_stage`, `work_set`,
`work_deliver`, `work_complete`, `work_body` and `note_section`. Each one runs the
installed CLI's `work` / `note` command (see the
[roadmap operations reference](../pi-extension/skills/outliner-workflow/references/roadmap-items.md#agent-commands))
in the session's workspace, as an agent write attributed to `claude-code` and
this session. Items are named by Work ID or block UUID, never by title. The tool
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
(`src/agent-tools.ts`) with the tool's input as JSON on stdin, in the session's
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
| `outline_changes` | `since` (an ISO time or a returned `cursor`), `author?`, `actor?`, `limit?`, `before?` | each changed block once, newest first, with who changed it; `complete`, with `before` for the older page when it is false; the next `cursor` |
| `outline_patch` | `ref`, `revision`, `patches: [{observed, replacement}]`, `mark?`, `policy?` (`edit`, the default, or `prose`), `allowStructural?` | `draft.patch`'s outcome: `applied`, or `proposed` with the reason |

A `ref` is a block id, `((id))`, `[[page]]` or a Work ID. A title is refused:
find it with `outline_find` first.

- **The safe path is read, then edit with the revision.** `outline_edit` refuses
  an empty or whitespace-only result, a revision that isn't the block's (read it
  again), and an edit that drops a `[page::…]` or an `^anchor` another note
  links to, unless `allowStructural: true` (the check is `refuseDroppedStructure`
  in `src/work-tools.ts`, over `droppedLinkedStructure` and `droppedStructure`). An
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

## Door tools

When Claude runs in an ep0ch-door tile (`EP0CH_CONTROL` set), it also gets
`door_where`, `door_peek`, `door_act { action, args?, tile? }` and
`door_open { id }`. They run `ep0ch where --json`, `ep0ch peek` and
`ep0ch act …` on that socket; `door_open` is the same open as a click or `show`
([Where a note opens](#where-a-note-opens)). Without
`EP0CH_CONTROL` they are not offered, and a call is refused.

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
checkout, `bun scripts/install-claude-mod.ts`. It needs no folder.

```sh
claude --plugin-dir /path/to/checkout/claude-mod
```

To load it in every session, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and
`CLAUDE_CODE_PLUGIN_DIRS=/path/to/checkout/claude-mod` in the `env` block of
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

```sh
claude plugin validate claude-mod
claude plugin test claude-mod
# types: run /plugin-types claude-mod/.claude/types in a session, then
tsc -p claude-mod/tsconfig.json
```
