# ep0ch-door

A BBS door into a pi-herdr-outliner outline: it reads everything, edits notes in place, moves cards between
board lanes, and comments on them. It talks straight to the outliner service's Unix socket, on the one protocol both share
(`PROTOCOL` in outline-core), and is not part of the outliner.

The screens are ep0ch's own 1997 art by shypht, read in place from the WOE art packs:
the logon (`SHY-LOGI.ANS`), the main menu (`SHY-EMNU.ANS`, whose twelve "Menu Cmd"
slots now hold live commands), and the bulletin (`SHY-EPO!.ANS`).

**Getting around.** The menu's letters (or a click on an item) open its screens over it. `q` is back on every
screen, and so is `Esc` once nothing on the screen is selected or open (a drawer, a link, a detail). The menu
is the top, with nothing under it: there `q` is the Quay, as it always was, and `Esc` stays put and says so.
Only `G` (or a click on Goodbye) logs off, and at the logon `Q` hangs up. An agent gets around the same way, with
`screen.open`, `screen.back` and, on a list, `list.select`, `list.open`, `list.read` (see
[Letting an agent see what you see](#letting-an-agent-see-what-you-see-and-do-what-you-do)).

**Drop to shell.** `!` on the menu (or a click on `! Shell` on its key line; `^W !` on the desk) is the BBS's
drop to DOS: the door steps aside and your login shell (`$SHELL -l`, else `sh`) runs in your own terminal, in
the door's folder, under the line `ep0ch · shell · exit returns to the door`. `exit` (whatever its code) brings
the door back where it was: the same screen, layout and tiles, whose programs keep running meanwhile. Start or
attach agents there however you like (`claude --resume`, …). The shell gets the door's environment plus
`EP0CH_IN_DOOR=1` (a login shell's landing guard, such as float-2's `~/.bashrc`, doesn't start a second door),
`EP0CH_CONTROL` (this door) and `EP0CH_NEST` ending in `shell:<door pid>`, so what you start there knows where it
is (`ep0ch where`). It is the person's only: an agent's `screen.shell` is refused, since it would take your
terminal. For a shell that stays alongside the door instead, `^W o s` on the desk opens one in a tile (a
terminal tile's program gets `EP0CH_IN_DOOR=1` too, so that shell doesn't open a door inside the door either).

The words used here for screens, tiles, readers and actions are defined in the
[UI grammar and glossary](docs/UI-GRAMMAR.md), with an audit of every screen against them.
Before adding a feature, check its [reuse map](docs/UI-GRAMMAR.md#before-adding-a-feature).
[AGENTS.md](../../AGENTS.md) has the workflow for agents, and [CONTRIBUTING.md](../../CONTRIBUTING.md) has
verification and the review checklist. Agents load the stack's skills (`ep0ch --skill` lists them):
`ep0ch` to drive a door, `ep0ch-outline` to work in an outline for someone, `ep0ch-core` to change this
code or the outliner's, `daily-brief` for the morning brief. The [architecture map](docs/architecture/map.json) records every
structure in the door and the outliner, its ladder position and its open questions; `bun
scripts/architecture-map.ts` checks its file:line citations against both checkouts and draws it as one page.

## Getting started

One walk through the door, in the order you meet things. Each step has its own section below.

1. **Land in it.** On a machine set up like float-2, an interactive ssh login (outside Herdr and tmux) runs
   `ep0ch` from `~/.bashrc` with `EP0CH_IN_DOOR=1`, and `EP0CH_LANDING=welcome` puts you on
   [Welcome](#welcome) after the logon's `⏎`: the notes tagged `[welcome::n]`, the first one read. Quitting
   the door leaves you at that shell; `ssh -t <host> EP0CH_NO_DOOR=1 bash -l` skips the door once.
   Anywhere else, `ep0ch` opens the current folder's outline on the outline host, and `ep0ch --ws <name>`
   opens another ([Outlines on the outline host](#outlines-on-the-outline-host)).
2. **Get around.** The menu's letters or a click open its screens: `D` the desk, `K` the kanban, `Q` the Quay
   (the river), `T` today's brief, `C` Welcome, `X` the showcase. `q` goes back on every screen below the
   menu; only `G` logs off.
3. **The desk.** `D`, then `alt+d` loads the `daily` layout: the agent's terminal, the outline, the "now" page,
   an editor and details. Drag a tile's header to move it (onto another header it becomes a tab), `^W o` and a
   kind opens a tile, `^W p` puts one in a drawer (anything dropped on its handle joins it), `alt+k` locks the
   shape for a task, `^W w` and `^W r` save and load layouts by name ([The desk](#the-desk)).
4. **The agent drawer.** `alt+a` or a click on the status bar's `▲ claude` chip pulls the daily agent up over
   any screen, with your keys in it. `ctrl+]` gives the keys back; `alt+a` again, or `Esc` once you're out,
   puts it away ([The agent drawer](#the-agent-drawer-pie-498)).
5. **Easy on the eyes.** The door opens in the **calm** theme: dark, soft accents, every word at 4.5:1 or
   more. `alt+t` (or a click on its name on the status bar) steps to **night**, dimmer, and **classic**, the
   bright VGA palette; `alt+v` steps the video mode (the CRT glow is Kitty+CRT). Both work on every screen
   ([Themes and accessibility](#themes-and-accessibility)).
6. **Drop to shell.** `!` on the menu, or `^W !` on the desk: your login shell in this terminal, and `exit`
   brings the door back where it was ([Getting around](#ep0ch-door), above).
7. **Links in the tree.** In an outline tile, `L` shows the selected row's outlinks, resources and backlinks
   under it, as the outliner's Tree does; `⏎` or a click opens one, and a resource shows what the service
   stores for it ([The desk](#the-desk)).
8. **Write.** `e` in any reader edits the note. `Enter` continues a list, `Tab` and `Shift+Tab` nest and
   outdent, `Ctrl+P` previews, `Ctrl+S` saves (the first press says which properties would change). `Esc`
   twice puts unsaved text aside as **unsent**; `e` on the same note brings it back
   ([Editing notes](#editing-notes)).
9. **On a Mac,** set the terminal to send Option as Alt (Ghostty `macos-option-as-alt = true`, kitty
   `macos_option_as_alt left`). Without it, where you aren't typing text, the door reads `å` as `alt+a`, `¬`
   as `alt+l` and so on, and says once which setting to change ([The agent drawer](#the-agent-drawer-pie-498)).
10. **Keep the stack current.** `ep0ch doctor` checks every piece; `ep0ch install` shows the plan and
   `--apply` runs it ([Install and update](#install-and-update)). `ep0ch outline list` names the host's
   outlines, and from a program in a tile `ep0ch where` says which door, tile and keys it's in
   ([where am I](docs/AGENT-INTERFACE.md#where-am-i-ep0ch_nest-and-ep0ch-where)).

## Outlines on the outline host

The outliner's outline host serves every outline on the machine by name: `<name>.sqlite` in `~/outlines`
(`EP0CH_OUTLINES`), each with its own folder `<name>/` beside it, on one socket (`~/outlines/.host/host.sock`).
The door opens outlines like Herdr sessions (PIE-530):

    ep0ch --ws jam-shelf              that outline, from anywhere; created if nobody has it yet ("created outline jam-shelf")
    ep0ch --machine float-2 --ws pie  that outline on another machine (an ssh config name), through a forward
    ep0ch --remote float-2            this terminal on the door session running on that machine
    ep0ch                             the outline this folder names: EP0CH_WS, else the nearest .ep0ch from here up
    ep0ch init [<name>]               name this folder's outline: write .ep0ch (ws = "<name>"), creating the outline;
                                      without a name, the folder's (or its git repository's)
    ep0ch outline list | attach <name> | create <name> | import <database.sqlite> <name>
                | stop <name> | delete <name> [--yes]     (each with --json)
    ep0ch status                      the host's socket, its outlines folder and the open outlines

The rule is outline-core's `whichOutline`, the one every client applies (the outliner's Herdr panes, its CLI,
the Claude mod): `--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`. Nothing else names an outline. In a folder
that names none, `ep0ch` asks before it opens: start a new outline (the folder's or repository's name offered),
pick one of the host's, or import an older database (a new outline holding its notes, properties, pages and work
ids; the file is only read); each writes `.ep0ch`, so the next `ep0ch` there opens directly, and moving or
renaming the folder changes nothing. Without a terminal it says what to run instead. Every request and the subscription
name the outline. The status bar and `peek` show `host · outline`. Only opening the door (or `init`) creates an
outline; the listings and `clients` never do (`src/discover.ts`, `resolveTarget`; `src/outlines.ts`).

### Outlines on other machines

A machine is an ssh config name: a `Host` in `~/.ssh/config` (`float-2`, `laptop`). ssh owns its keys, hops and
address; the door keeps no list of machines of its own.

- **`--machine <ssh-name>`**: the door here, the outline there. Which machine, first match wins: `--machine`,
  `EP0CH_MACHINE`, then the `machine` of the `.ep0ch` that named the outline (an outline named by `--ws` or
  `EP0CH_WS` takes no machine from a file). A `.ep0ch` for a folder whose outline lives on another machine:

      ws = "pie"
      machine = "float-2"

  The door asks the machine where its outline host listens (`ep0ch status --json` there, in a login shell), then
  forwards that socket to `~/outlines/.remote/<ssh-name>.sock` (folder mode 0700) with one ssh connection
  (`-M`, ControlPersist, ExitOnForwardFailure, StreamLocalBindUnlink, ServerAlive). That connection outlives the
  door, so a second door, Tree and Detail, and the CLI share it. When it drops (the network went), the door starts
  it again as its connection comes back, and the status bar says so ("reconnected · started the forward to
  float-2 · caught up 3 changes"). ssh must log in without asking (a key or an agent: `ssh float-2 true`).
  `ep0ch outline list|create|… --machine <ssh-name>` and `ep0ch init --machine <ssh-name>` (which writes the
  `machine` line) work on that machine's host. `ep0ch doctor` shows each machine's forward.
- **`--remote <ssh-name> [door flags]`**: this terminal attached to the door session running on that machine,
  as `herdr --remote` does: `ssh -t <ssh-name> ep0ch [door flags]` in a login shell there, with `TERM`,
  `COLORTERM`, `EP0CH_KITTY`, `TERM_PROGRAM` and `LANG` carried over. The door runs there, so the drop shell and
  `$EDITOR` on a `ctrl+e` file run there too, on its files.
- **`EP0CH_SOCKET`** names any host's socket outright, the low-level way; with it no machine is used.
- **`EP0CH_SSH`** names the ssh to run (tests give a fake one).

## Try it

    scripts/try-it.sh --ws pie

opens the board of that outline on this machine's host. Edits, moves and comments there are real.

    scripts/try-it.sh --ws pie --copy

makes a private copy of the outline's database (`sqlite3 .backup`, read-only on the original), serves it
from a host of its own built from this repository's outliner (or `--outliner <dir>`), and opens the board on
it. Use it to try the door on code the running host doesn't have yet. Writes stay in the copy, and the copy is
deleted when the door exits. `--hub <block-id>` picks the board.

A journey to try, whichever service it is:

1. The board opens on the workspace's board; `h l` lanes, `j k` cards; the preview follows the card.
2. `e` edits the card in the preview. Type after a `[key::value]` on the subject line, `Ctrl+S`: the door
   says which properties the save would change and writes nothing; `Ctrl+S` again saves. `Esc` closes.
3. `m` picks a lane to move the card to, showing the property patch (or why a lane can't take it); `Enter`.
4. `C` (from the lanes, or in the preview), pick a passage (`j k h l`), `Enter`, write, `Ctrl+S`; `m` lists the threads.
5. With another client (Detail, the CLI), edit the note while it's open with `e`: the draft says
   "changed elsewhere" and a save is refused, never overwriting. Change a card's stage elsewhere: its lanes
   update by themselves.
6. Restart the host: the status bar says `offline`, then `reconnected · caught up N changes`.

## The showcase

    scripts/try-it.sh --showcase
    scripts/try-it.sh --showcase --reset

opens the showcase (PIE-439): the shared door parts, live, in nineteen sections, one per row of the reuse map
([Before adding a feature](docs/UI-GRAMMAR.md#before-adding-a-feature)) in the map's order. The map's
scrolling row, its key-names row, its list-picker and line-input rows (in the panes section's ^W P and ^W r,
the board's g m s), its elements and reading-ruler row (PIE-441) and its terminal-output row (PIE-510: cells, escapes,
CP437; the key names and the terminal output are under every section) have no section yet. The newest parts are in their rows' sections:
the agent drawer in `terminal` (`alt+a` pulls it up over the showcase itself), the terminals attached to the door session in `session`, a row's links in the tree
(`L`) in `entity`, a drawer and the lock (`alt+k`) in `panes`, the draft session (an edit and a comment open side by side) in `drafts`, a screen spec (the brief, its spec read back by `screen.spec`) in `screens`, the tile-kind registry listed by a service-drawn tile in `kinds`, quiet embeds (a dim `»` source line) in `note`, and the outliner's example extensions (a record, an output, a component with its `[w ward]`, an `@tidy` request) beside what the service's list bound, in `extensions`. It runs on an
outline of its own: a private service (own state, workspace and config dirs, background agents off, Herdr
unset) on a persistent workspace under `<the door's state>/showcase/` (`$EP0CH_STATE`, else `${XDG_STATE_HOME:-~/.local/state}/ep0ch-door`), with the
door's own `EP0CH_STATE` and `EP0CH_CONTROL` there too, so nothing reaches a real outline or your door.

- **The outline** is seeded on the first run from `src/showcase/seed.ts`, a made-up household (an allotment,
  a kitchen, bikes), written through the service API (`create`, `work-ids.configure`,
  `roadmap.items.create`, `properties.patch`, `annotations.*`), not into SQLite. It has a board hub with a
  lane per work stage and cards in each, callouts, links and soft links (`HOME-001`), folds, a literal
  region, a transclusion, properties in block, line and inline scopes, open and resolved comment threads,
  a saved view, one of every `::graph-*` kind, live ones included, and a call naming made-up tickets under
  `jira::` lines with a ticket page under it (PIE-445: a made-up ticket extension, `src/showcase/tickets`, a
  contract 2 folder like the outliner's Jira one, is installed in the showcase's own config dir; opening the
  notes fetches the tickets, which the service keeps as blocks; nothing real is contacted), and a week of
  omens with one line of each extension kind (`moon::`, `horoscope::`, `fancy-horror::`, `@tidy`, PIE-512:
  the outliner's example extensions, copied from the checkout `--outliner` names into the showcase's own
  config dir; the `extensions` section shows it).
- **It's writable.** Edit, move and comment freely; it stays until `--reset`, which stops its service,
  deletes that state and reseeds. Its service is the process `service.pid` names only when that process
  is the outliner's server on the showcase's state; a pidfile left by a crash or a reboot is dropped, and
  whatever process has that pid now is left alone. `--prepare` sets it up (or resets it) and exits without opening the door.
- **The screen** lists the sections on the left: `↑↓` `j k` `1-9 0` (the first ten) or a click picks one; `⏎`, `→`, `Tab`
  or a click in it hands the part your keys and mouse; `Esc` backs out through the part to the list. Each
  section names the part and its files and is drawn by the part itself, on a desk of its own spec (the layout
  tree, nothing saved to your `desk.json`) or the real board. A parallel version still in the code that
  can't be framed alone is named on the section's third line.
- **Reaching it:** `X` on the main menu (its key line; the menu art has twelve slots), or `--showcase` on
  the command line, beside `--desk`, `--river` and `--board`. On an outline without the seed it says so and
  writes nothing.
- **Agents:** `ep0ch-door act section name=<1-19|key>` shows a section (your keys go back to the list);
  every other action is the section's own (a reader's note actions, the desk's, the board's).
  `EP0CH_CONTROL=<showcase>/door/door.sock` reaches this door, and only it.

Adding a shared part means adding its section (`SECTIONS` in `src/showcase/showcase.ts`) and the seed
content it needs; the review checklist's "The map" item covers both.

## The daily brief

The morning note (PIE-435): what happened yesterday, what today needs. It is one outline note per day with
`[type::daily-brief]` and `[brief-date::YYYY-MM-DD]`. An agent drafts its prose each morning
([skills/daily-brief/SKILL.md](skills/daily-brief/SKILL.md), or `ep0ch --skill daily-brief`); its figures and
embeds are live.

- **Reaching it:** `T` (today) on the main menu, on its key line like the showcase, or `ep0ch --brief`.
  `EP0CH_LANDING=brief` opens it over the main menu right after the logon; the default is still the menu.
- **The screen** is a desk with one reader at full width (a screen spec, PIE-515: one tile of the brief kind,
  which knows the briefs; `^W o f` puts a brief tile on the desk too): the shared note surface, so links, live figures,
  folds, comments, selection, `[ ]` and the ruler work as in any reader. Its header (the surface's `header`
  hook, as the message reader's) leads with the day and "n of m briefs". `,` and `.` step to the previous and next day's brief (by `brief-date`, then by update).
  A link, a figure row or `u` opens in a reader beside it, so the brief stays; your keys stay on the brief.
  `^W` and the other desk keys work too; nothing is saved to your `desk.json`.
- **No briefs:** it says so and names the skill.
- **Agents:** `brief.step by=-1|1`, `brief.newest`, `brief.date date=YYYY-MM-DD`, `brief.show id=<brief>` (refused
  while you're typing in the brief), plus the desk's and the reader's actions. `open <id>` on a brief steps to it;
  any other note opens beside it.
- The showcase outline has two made-up briefs, so `scripts/try-it.sh --showcase` then `T` shows one.

## Welcome

The notes you want to land on, one at a time: every note with a block-scoped `welcome` property. Any value
counts; a number is its place (`[welcome::1]` first, then `[welcome::2]`…), and the rest come after the numbered
ones, by title. The service finds them (`blocks.query`, filter `welcome`, block scope); the door only orders them.

- **Reaching it:** `C` on the main menu, `ep0ch --welcome`, or `EP0CH_LANDING=welcome` to land there right
  after the logon (one ⏎ at the logon, and you're reading the first welcome note). `q` goes back to the menu.
- **The screen** is one composition: an ep0ch logo from the WoE packs across the top (Shypht's own, drawn from
  the `.ANS` files in place; `L` or a click on it shows the next; a signature line with a phone number is never
  drawn), a tab per welcome note under it, the list of them down the side, **the detail** (the note read) in the
  middle with its **backlinks** under it, and **the preview** the full height beside them. Frames are the logos' dotted
  `::....::`. At 30 rows the logo gives way to the reading panes; the tabs stay.
- **Picking a note:** `1`–`9` and `0` (the tenth) pick by tab; a click on a tab too. Past ten, a `… n more` tab
  gives the list the keys; `j` `k` there, `⏎` reads it. Tiles are focused with `Tab` (list → detail → backlinks
  → preview), a click or `^W h j k l` here (the digits are the tabs', so the tiles aren't numbered). The detail
  has the keys when the screen opens.
- **Links:** `⏎` on a link in the detail (or a click) opens it in the preview; `⏎` with nothing picked yet takes
  the first link. `alt+⏎`, a ctrl-click or an alt-click reads it in the detail instead (the door's "open fresh",
  here: make it the thing read); `alt+←` or backspace goes back. Links in the preview open in the preview;
  `alt+⏎` there with no link picked, or a click on its `⇱ read here`, reads the preview's own note in the detail.
  Reading another note yourself empties the preview (an agent's leaves it).
- **Backlinks** of the detail's note, grouped as Detail groups them, every group open: landing on them (`Tab`,
  a click) shows the selected one in the same preview, and so do `j` `k` as they move, `⏎` or a click too, `alt+⏎` or a ctrl-click reads it in the detail. `s K w h n .` and
  the status line's controls change the view as on the board's drawer.
- **No welcome notes:** the list says how to tag one, and the detail shows the `[[claude-now]]` page meanwhile
  (the page `C` used to pin).
- **Live:** tagging, untagging or editing a note anywhere updates the tabs and the list; the detail and the
  backlinks refresh as the outline changes.
- **Agents:** `welcome.select n=<place>|id=<id>`, `welcome.read id=<id>` (put any note in the detail),
  `welcome.logo`, `welcome.reload`, `backlinks.pick n=|id= [open=true] [fresh=true]`, `backlinks.view`, and the
  desk's and the reader's actions. None of them moves your keys; the picks are refused while you're typing here,
  and the status bar says which agent did what. `open <id>` shows the note in the preview.

## Install and update

The stack is Bun, Herdr, one checkout of the ep0ch repo (packages/outliner is the Herdr plugin and the outline
host, packages/door is `ep0ch`, the Claude mod is in it too), the outline host serving every
`~/outlines/<name>.sqlite` by name (PIE-530; `EP0CH_OUTLINES` names another folder), and the `ep0ch` command. Two
commands look after it, on macOS and Linux alike:

    ep0ch doctor [--json]            every piece and its state, with the command that fixes it (read-only)
    ep0ch install                    the plan: what would change, step by step (a dry run; nothing changes)
    ep0ch install --apply            run it

`doctor` marks each piece ✓ current, ! behind, ✗ missing, ? couldn't be checked (a `git fetch` that failed
or timed out after 90s, or a source `git ls-remote` couldn't reach: never ✓ on an old fetch, and doctor
exits 1), and · for information:

- **bun**: its path and version.
- **ep0ch**: the checkout against `origin/main`, whether `bun install` is needed at its root (one workspace: a
  package missing, or installed at a version other than `bun.lock`'s), the protocol its code speaks
  (outline-core's), whether `ep0ch` on PATH runs this checkout, and the door session (its daemon, terminals and
  programs, and whether it runs this checkout's code).
- **the plugin**: whether Herdr runs it from this checkout's `packages/outliner` (a link: updated with the
  checkout), or as a managed install of `float-ritual-stack/ep0ch/packages/outliner` (the commit Herdr installed
  against `main` on GitHub, by `git ls-remote`). A link to another checkout (the old pi-herdr-outliner) or a
  managed install of the old repo says how to point it here.
- **outlines**: the outlines folder and the outlines in it; the outline host (its socket, the outlines it serves,
  its protocol, and its systemd unit or launchd agent with what systemd or launchd says about it); a unit from
  before outlines by name (one that runs another checkout's `host-main.ts`, or still sets `OUTLINER_STATE_DIR` or
  `OUTLINER_DEFAULT_OUTLINE`) with the exact change; and which outline this folder opens (its `.ep0ch`), or the
  outline `ep0ch init` would start.
- **Herdr**: the server, and the keys for the plugin's actions in `config.toml`.
- **Claude**: whether Claude Code's `CLAUDE_CODE_PLUGIN_DIRS` loads this checkout's Claude mod (its
  `install-claude-mod.ts` points it, with no folder to name: each Claude session follows the outline its folder's
  `.ep0ch` names), a folder list with no mode (the mod then feeds nothing until the mode is set), and
  `FORCE_HYPERLINK`, a known issue (PIE-486).

`install` runs these steps in order, each skipped when it's already current, each saying what it did:

1. **Back up** every outline (`<outlines>/*.sqlite`) with SQLite's `VACUUM INTO`, a consistent copy even while
   the host writes, into `~/backups/ep0ch/<UTC timestamp>/<name>.sqlite`, integrity-checked. It runs before any
   other step changes anything, and not at all when nothing else changes.
2. **Update the ep0ch checkout**: `git pull --ff-only`, then `bun install --frozen-lockfile` at its root when
   needed. The door, the outliner and outline-core move together.
3. **The plugin in Herdr**: nothing to do when Herdr links this checkout's `packages/outliner`. A managed install
   is refreshed with `herdr plugin install float-ritual-stack/ep0ch/packages/outliner --ref main --yes` (Herdr has
   no update command). A link to another checkout is yours to change (`herdr plugin unlink float.pi-outliner`,
   `herdr plugin link <checkout>/packages/outliner --enabled`): install never edits Herdr's registry.
4. **Link `ep0ch`** in the first directory that is on PATH and writable, of `~/.local/bin`,
   `/opt/homebrew/bin` and `/usr/local/bin`, saying which. Never sudo. A link there to another checkout's door
   (the old ep0ch-door) is pointed here; one elsewhere is left to you, with the command.
5. **Restart the outline host** after the checkout updated in the same run, or when it speaks another protocol:
   through its unit, `launchctl kickstart -k gui/<uid>/<label>` on macOS (`io.ep0ch.outliner-host`) or
   `systemctl --user restart <unit>` on Linux, then waits for a new process to answer and checks it speaks the
   checkout's protocol. The doors and panes on it reconnect by themselves. A host that's set up but not answering
   is started the same way (`launchctl bootstrap` when launchd hasn't loaded it). A host outside any unit, a unit
   the unit doesn't run (another process answers its socket), or a unit that needs changing (another checkout's
   `host-main.ts`, settings from before outlines by name) is left to you, with the change. Only a unit whose
   `EP0CH_OUTLINES` (default `~/outlines`) is this outlines folder counts as its unit.
6. **Hand the door session to the new code** (see [Sessions](#sessions-quit-is-detach)), when one runs from this
   checkout on an older commit: `ep0ch session upgrade`. The programs in its tiles keep running, its screens and
   open edits come back, and every attached terminal (a pane, an ssh login) starts again on the new code and
   attaches by itself.

A checkout that isn't on `main`, has diverged, is behind with local changes, or couldn't be fetched is left
for you, with what to do. Install never writes a database (it only copies them), never creates or opens an outline,
never edits Herdr's config or registry or Claude's settings, and never writes a systemd or launchd unit (it only
asks one to restart or start the host): a missing unit, a unit to change, the keys and the Claude mod are reported.
It stops at the first failure, with the recovery. `--json` gives agents the same report or plan.

At a terminal, both show progress while they work: checking the stack (the fetches among it) spins with
what it's waiting on, and a running step's line spins with its elapsed time, the latest line of what it
runs (a clone, a build, `bun install`) dimmed under it, and its items counted (`[████░░░░] 1/3 · notes 41 MB`
for the backups); the line ends as a timed ✓ or ✗. Ctrl+C says which step it interrupted. Piped, in CI,
with `TERM=dumb` or `--json`, the output is plain lines as before; `NO_COLOR` drops the colour. The spinner
is braille dots, or `| / - \` where the door would draw in cells.

A checkout from before `install` gets it by hand, once:

    cd ~/projects/ep0ch && git pull --ff-only && bun install
    bun packages/door/src/main.ts doctor
    bun packages/door/src/main.ts install              # read the plan
    bun packages/door/src/main.ts install --apply      # then ep0ch is on PATH: ep0ch doctor

## Run

    bun install
    ln -s "$PWD/src/main.ts" ~/.local/bin/ep0ch    # once: the ep0ch command (or: ep0ch install --apply)

    ep0ch                           # the outline this folder names (EP0CH_WS, else its .ep0ch; else it asks)
    ep0ch --ws pie                  # an outline by name, from anywhere
    ep0ch --machine float-2         # this folder's outline on another machine (an ssh config name)
    ep0ch --remote float-2          # the door session running on another machine, in this terminal
    ep0ch --showcase | --desk | --layout <name> | --river | --brief | --welcome | --board [<hub-id>]

`ep0ch help` lists everything. Besides opening the door:

| Command | What it does |
|---|---|
| `ep0ch doctor`, `ep0ch install [--apply]` | the stack's state, and bringing it up to date (see [Install and update](#install-and-update)) |
| `ep0ch try …` | `scripts/try-it.sh`: the door on a private copy (`--copy`), or on the showcase outline (`--showcase`, `--reset`) |
| `ep0ch init [<name>]`, `ep0ch outline …`, `ep0ch status` | name this folder's outline, and the host's outlines (see [Outlines on the outline host](#outlines-on-the-outline-host)) |
| `ep0ch --skill [--all] [<name>]` | the stack's skills (this door's `skills/` and the outliner's `pi-extension/skills/`: the installed plugin's, found through Herdr, else packages/outliner beside the door), or the path of one skill's `SKILL.md`; `--all` adds contributor skills |
| `ep0ch clients [--ws <name>] [--machine <ssh-name>]` | who's connected to the outline: every role, observers and roles this door doesn't know yet |
| `ep0ch session list`, `attach [--watch]`, `end [--yes]`, `upgrade [--clients]`, `restart` | the door session in this state dir (see [Sessions](#sessions-quit-is-detach)): who's attached and what runs, attach to it (`--watch`: read-only), end it, hand it to a new daemon on this checkout's code (its programs keep running) |
| `ep0ch peek`, `actions`, `snap <png>`, `open <id>`, `act <action> key=value …` | drive a running door (see [Letting an agent see what you see](#letting-an-agent-see-what-you-see-and-do-what-you-do)); `EP0CH_CONTROL` names which door |

`bun src/main.ts …` still works the same way, and `ep0ch-door` is the same command.

| Env | Meaning |
|---|---|
| `EP0CH_WS` | the outline's name, as `--ws` (over a folder's `.ep0ch`) |
| `EP0CH_OUTLINES` | the outlines folder (default `~/outlines`): `<name>.sqlite`, and the host's socket in `.host/` |
| `EP0CH_MACHINE` | the machine the outline is on, as `--machine` (over a `.ep0ch`'s `machine`): an ssh config name |
| `EP0CH_SOCKET` | a host's socket path named outright (the low-level way; no machine is used), asked for the same outline name |
| `EP0CH_SSH` | the ssh `--machine` and `--remote` run (default `ssh`) |
| `EP0CH_DAEMON` | `0` (or `--no-daemon`) opens the door in this terminal, as before sessions: quitting it ends it. Otherwise the door is a session (see [Sessions](#sessions-quit-is-detach)): the one in the state dir attached to, started first when none runs. Tests and `scripts/test-door-env.sh` set `0`; pass `EP0CH_DAEMON=1` to try a session there |
| `EP0CH_PACKS` | folder holding the `woe*.zip` packs (default `/opt/float/bbs/inbox/evan`) |
| `EP0CH_KITTY` | `1` / `0` forces graphics on or off |
| `EP0CH_THEME` | `calm` (the default), `night` or `classic`: the colours at start, over the one last chosen with `alt+t` (see [Themes and accessibility](#themes-and-accessibility)) |
| `EP0CH_LANDING` | `brief` opens the newest daily brief after the logon, `welcome` the welcome notes (default: the main menu) |
| `EP0CH_KEYBOARD` | `legacy` doesn't ask the terminal for the Kitty keyboard protocol (then Shift+Enter reads as Enter); unset, the door asks when the terminal answers its query |
| `EP0CH_COPY_ON_SELECT` | `0` (or `off`) doesn't copy a mouse selection when the button comes up; `y`, `cmd+c` or the copy control copies it then (Herdr's `ui.copy_on_select`). Unset, a drag copies |
| `EP0CH_OPTION_KEYS` | `us` reads macOS Option characters (`å`, `¬`) as alt keys outside text, `off` never; unset, by the locale |
| `EP0CH_SCROLL_ROWS` | rows one wheel report scrolls a reader, a draft, a column or a scrollback (1 to 20, default 1). A trackpad then moves the text with your fingers, and a mouse wheel in Ghostty (three reports a notch) moves 3 rows a notch; in a terminal that sends one report a notch (xterm, most Linux terminals) set 3. In lists (the tree, a lane, the BBS lists) a report moves the selection one row |
| `EP0CH_OBSERVE` | `0` skips registering as an observer (then the door is not in Who's Online and gets no live events) |
| `EP0CH_NOW_PAGE` | the page the welcome screen (C) shows while no note is tagged `welcome`, and the `daily` layout's "now" tile shows (default `claude-now`); `EP0CH_NOW_LABEL` names it |
| `EP0CH_DAILY_AGENT` | the command the agent drawer's agent runs (default `claude`; the host layer's, with no tile on any screen); `scripts/door-agent-herdr.ts` runs it inside Herdr (see [The daily agent in Herdr](#the-daily-agent-in-herdr)) |
| `EP0CH_HERDR_AGENT_CMD` | the agent that wrapper starts in its Herdr pane (default `door-claude` when it's on PATH, else `claude`) |
| `EP0CH_DAILY_DRAFT` | the file the `daily` layout's editor tile opens (default `scratch.md` in the door's state) |

## Sessions: quit is detach

    ep0ch                      # the session in this state dir: started when none runs, then attached
    ep0ch --no-daemon          # the door in this terminal only (quitting ends it)
    ep0ch session list         # who's attached, what runs in its tiles
    ep0ch session attach --watch
    ep0ch session end          # asks while programs run in its tiles or a draft is unsaved; --yes doesn't
    ep0ch session upgrade      # hand it to a new daemon on this checkout's code: programs keep running

A **session** (PIE-418) is the door kept running without a terminal, as Herdr and tmux keep theirs; `ep0ch` runs the
door as one. One runs per user and state dir (`EP0CH_STATE`), started on demand in the background, and holds
everything the door holds:
the screens and their layouts, the dispatcher, drafts, the terminal tiles with their programs and scrollback, the
agent drawer, the service connection and its change feed. Your terminal is a **client**: it shows what the session
sends and sends what you type. A terminal inside the session (one of its tiles, its drop shell) can't attach to it.

- **Quitting detaches.** `G` (Goodbye), `ctrl+c`, closing the terminal or a dropped ssh connection lets go of that
  terminal; everything goes on running. `ep0ch` attaches again and you're where you were: the layout, nvim with its
  unsaved buffer, a shell's scrollback, a half-written draft. Flags that open a screen (`--board`, `--layout daily`)
  apply when a session starts; attaching says it didn't apply them. Naming another outline than the session's
  (`--ws`, a socket, `EP0CH_SOCKET`) is refused, with which one it's on: one session per state dir.
- **Ending is its own act:** `E` on the main menu (End), or `ep0ch session end` at your shell: the same action
  (`session.end`), the person's only. With programs running in its tiles or a draft unsaved it asks first (`E` again
  within 3s; the command asks y/N, or `--yes`). Unsaved drafts are copied to disk and put aside, as when the door quits.
  In a door running in its own terminal there's no session: `E` says so, and `G` logs off.
- **Several terminals at once** (the laptop and the phone, two screens): one session, one person, one focus. The keys
  are wherever you last typed (tmux's `window-size latest`): the session is drawn at that terminal's size and in its
  video mode, and the drop shell or `$EDITOR` runs there. Another terminal of another size sees the same frame cut to
  its size, its bottom row saying whose size it's drawn at; its first key takes the session over, and its first click
  only does that (it was aimed at the other size's frame). Each terminal has its own video mode and its own Kitty
  images. `ep0ch session attach --watch` shows the session read-only (`q` stops watching).
- **Agents** reach the session through its control socket as before (`peek`, `act`, `subscribe`); `peek` says which
  terminals are attached (`session.clients`). An agent's act never takes the person's keys, whichever terminal they're on.
- **Upgrades keep your programs.** `ep0ch session upgrade` hands the session to a new daemon on the code in the
  checkout. The programs in its terminal tiles and the agent drawer keep running: they never belonged to the daemon,
  but to the session's **terminal host**, and the new daemon adopts each by its tile, its output and scrollback
  replayed. The screens come back (one kept in the background too), and so do the edits open on the screen on top
  (`e` or `⏎` in one carries on). Every attached
  terminal attaches again by itself, in the same terminal and the same ssh login. On a session already on this code,
  or with `--clients`, only the terminals start again; `ep0ch session restart` hands over whatever code it runs.
- **A daemon that dies** (a crash, `kill -9`) comes back the same way at the next `ep0ch`: the programs are still in
  the terminal host. Text typed into a draft since it was last put aside was only in the daemon's memory, and is lost
  then; drafts put aside come back. `ep0ch session list` says when a terminal host runs without a daemon.
- **`ssh` lands in it.** The ForceCommand door (`ssh -p 2323`) runs `ep0ch`, so every ssh login, the laptop's and
  the phone's, attaches to the one session instead of starting a door of its own; a dropped connection only
  detaches. With no terminal (a script, an agent's shell, ssh without `-t`) `ep0ch` starts no session: it says so,
  and `--no-daemon` opens the door there.
- **The daily agent stays Herdr's.** `▲ claude` in the agent drawer attaches to the `door-claude` pane in Herdr
  ([The daily agent in Herdr](#the-daily-agent-in-herdr)), and that stays so: the session now keeps the attach alive
  between terminals and across upgrades (the drawer's program is in the terminal host), and Herdr keeps the agent
  itself alive through anything the session can't survive (the session ended, the terminal host's own upgrade, a
  broken door), lists it, and lets other agents prompt it. Herdr is the escape hatch when the door is broken.
- **In this terminal instead:** `--no-daemon` or `EP0CH_DAEMON=0` opens the door here, as before: quitting it ends it.

How it's built: the session sends frames, not state. It renders once, as the door always has, and paints each
client the bytes its terminal takes (rows diffed per client, Kitty images uploaded per client), so a client is a
few hundred lines that work over ssh as is. A terminal tile's pty can't be handed from one Bun process to another
(`Bun.Terminal` doesn't expose its file descriptor, and Bun's sockets can't pass one), so the ptys live in a small
process of their own from the start, the terminal host (`pty.sock`, `src/session/pty-host.ts`), which keeps the last
megabyte each program wrote; a daemon of another host protocol ends its programs and starts them again. Each screen
already saves its layout as it changes, so what else a new daemon needs is a checkpoint (`src/session/restore.ts`,
`session-state.json`): the screens open, as the actions that open them, written as they change; and at a handoff the
edits open on the screen on top (their text put aside first). A restore runs those actions through the dispatcher,
only the ones whose `ActionDef` says `replay: "safe"`; anything else is never run again by itself, and the restore
says which. The one exception is the person's own edit, opened again on its note with the text the handoff put
aside: opening an edit writes nothing. The session's files are in the state dir: `session.sock` (mode 0600, the dir
0700), `session.json` (who it is), `session.lock` (held while it runs), `session.log`, `pty.sock` and `pty-host.log`
(the terminal host), `session-state.json` (the checkpoint; gone once the session ends). A test door on its own
`EP0CH_STATE` has its own session and never reaches yours. See `src/session/`.

## The desk

`D` on the menu, `bun src/main.ts --desk` to skip the logon, or `--layout daily` to open it laid out by name.
The door owns the whole canvas, and the canvas is **tiles** (PIE-413): views in one layout tree that you
split, tab, drag, link and save, drawn by the door itself, so no multiplexer is needed for layout.

| Tile | What it shows |
|---|---|
| outline (`tree`) | the tree; `←/→` fold, `⏎` opens (into its link, if it has one). `L` shows the selected row's links under it, as the outliner's Tree does: `→ outlinks`, `♦ resources` (`[file::]`, `jira::`), `← backlinks` (grouped as Detail groups them); each group folds (`space`, `h l`, a click); `l` or a click on a link's `▸` shows that note's links a level down; `⏎` or a click opens a link's note, or shows a resource's stored content in the reader (registering it first, and fetching it once, if it must) (`tree.links`, `tree.pick`) |
| reader | the current note; follows the selection unless held (`p hold`, `p` again follows); `[ ]` elements, `⏎` act on one, `alt+⏎` or a ctrl-click opens a link beside, `u` parent, `( ) f F` fold; `r` fetches the note's tickets now (a click on a ticket's age does too), `⏎` on a ticket's title opens the ticket block |
| detail | a reader that keeps its note: it changes only by an open into it (its link, `open`, a click) |
| preview | a reader that follows a source: a tile's selection (`tile:tree`, `tile:board`) or a file (`file:~/draft.md`), re-read when it's saved. Read-only for a file |
| terminal (`pty`) | a program in a pty the door owns: nvim, claude, a shell. Click it or `⏎` to type in it; `ctrl+]` back to the door |
| backlinks | the backlinks of what another tile shows (`tile:detail`), grouped as Detail groups them: `j` `k` show one where the tile's selection goes (a preview following it), `⏎` or a click opens it, `alt+⏎` or a ctrl-click opens it fresh; `s K w h n .` and the status line change the view (`backlinks.pick`, `backlinks.view`) |
| board, river, brief | the whole screen in a tile, its own keys inside; the board's card can be followed by a preview tile |
| query | a saved view's cards with its own cursor (`view=<its block id>`; `^W o q` on a tile showing a view): a board lane, on the desk; `j k` pick, `⏎` opens where its opens go, `r` reads it again |
| thread, activity, who, bulletin | as before: replies and comments, last callers, who's online, the ep0ch art |

| Keys (mouse) | Action |
|---|---|
| drag a tile's header | move it: onto a header or a tile's centre makes **tabs**; onto one of a tile's four triangles **splits** it that way; onto the window's outer left, right or bottom edge makes a **full-height column** or **full-width row**. The drop is outlined while you drag; `esc` lets go |
| click a tab; drag a tab | show it; move it out, or to another place among its tabs |
| drag a border | resize |
| `alt+l`, then click a tile | this tile's opens land there (a link followed, the tree's `⏎`); click the tile itself to unlink; `h j k l` or a number work too |
| ctrl-click or alt-click a link | open it beside, not in the link target |
| click a drawer's handle (`⇤ tree`, hint row) | slide it open |
| click the `⧉` before a float's title | dock it back (`tile.float`, as `^W f` and the board's `o`) |
| drag a tile's header onto a drawer's handle | the tile goes into that drawer (`layout.move where=tabs`); dropped beside a tile inside an open drawer, it lives in the drawer too |
| click `□ lock` / `▣ locked` (hint row) | lock or unlock the screen (`layout.lock`) |
| a refused drop or border (locked, a container that takes no drops or other kinds, a fixed size) | the ghost turns red and says why; the release does nothing and the status bar says the same words |

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab`, `1`–`9`, click | focus |
| `alt+n` / `alt+p` | next / previous tab |
| `alt+d` | load the `daily` layout |
| `alt+l` | link this tile's opens (then a click, `h j k l` or a number) |
| `?`, a click on `? more` | when the hint row is too long for the screen (it ends `? more`), show all of it in a box above it (`keys.more`, the person's); a `^W` chord's row shows it at once |
| `alt+k` | lock or unlock the screen: its shape is fixed (no moves, drops, new tiles, closes, resizes, drawers in or out, links, layout loads), its contents stay live (reading, editing, terminals, drawers sliding, tabs, zoom) |
| `Ctrl+W` then `h j k l` | focus by direction |
| `Ctrl+W` then `m` + `h j k l` | move beside the tile that way (none that way: to that edge) |
| `Ctrl+W` then `t` + `h j k l` | move into the tabs of the tile that way |
| `Ctrl+W` then `T` | take this tab out of its tab set |
| `Ctrl+W` then `H J K L` | move to that outer edge (a full-height column or full-width row) |
| `Ctrl+W` then `[ ]` | previous / next tab |
| `Ctrl+W` then `< > + -`, `=` | resize, even out |
| `Ctrl+W` then `z` / `x` / `s` | zoom, close, swap with next |
| `Ctrl+W` then `o` + a kind | open a tile beside: `t` outline, `r` reader, `d` detail, `p` preview of this tile, `e` editor (on the daily draft), `s` shell, `k` board, `v` river, `f` brief, `h` thread, `a` activity, `w` who, `b` bulletin, `l` backlinks of this tile, `q` the cards of the view this tile shows (a query tile) |
| `Ctrl+W` then `O` + a kind | the same, as a tab of this tile |
| `Ctrl+W` then `v` | a preview of this tile: a terminal's file, the board's card, a tile's selection |
| `Ctrl+W` then `p` / `d` | put this tile (its tab set, as one) in a drawer where it is, or take its drawer away / slide the drawer open or shut. A drawer slides over the others without moving them, shuts when the keys leave it, and holds anything moved into it |
| `Ctrl+W` then `c` / `f` | fold this tile to a spine where it is (a tile side by side with others), or open it / pop it out as a float over everything (its title drags it, `◢` sizes it, `H J K L` step it), or dock a float back |
| `Ctrl+W` then `W`, a click on a flow column's spine | give this tile's flow column the wide place (`tile.widen`): the flow is laid out around it, the column you were reading stays full beside it; moving the keys between columns never moves a column |
| a click on a header's `⇤ drawer` | dock that drawer where it is |
| `Ctrl+W` then `P` | the policy panel: the containers over this tile (the screen first) and what each allows: locked, draggable, droppable, resizable, accepts, opens into, fixed/min/max size, and a drawer's collapsible, overlay, stays and edge (`⏎` or a click changes a row, `h l` picks the container, `+ -` change a size) |
| `Ctrl+W` then `r` / `w` | load a layout by name / save this one by name |
| `Ctrl+W` then `!` | drop to shell: your login shell in this terminal, the desk back as it was when it exits (the menu's `!`); for a shell in a tile beside the notes, `^W o s` |
| in a terminal tile: `ctrl+]` | back to the door's keys (every other key, `ctrl+c`, `^W`, F-keys, shift- and ctrl-arrows and pastes included, is the program's); `ctrl+]` twice sends a `ctrl+]` to the program |
| in a terminal tile: `shift+⏎` | a newline in Claude Code and most line editors: `CSI 13;2u` to a program that asked for the Kitty keyboard protocol (Claude Code does), `ESC CR` (as `alt+⏎`) to one that didn't; plain `⏎` is always `CR`. The door reads Shift only from a terminal with that protocol: it asks for it at start (Ghostty, kitty, WezTerm, foot have it; so does Herdr 0.9 for its panes, over ssh too) and gives it back on exit, `$EDITOR` and drop to shell. `EP0CH_KEYBOARD=legacy` doesn't ask. Elsewhere `shift+⏎` is `⏎`; in a draft it's a plain line break, as `alt+⏎` |
| `ctrl+e` in a reader | edit the note in `$EDITOR` in a terminal tile beside it; the draft comes back when it exits |
| `/` | floating search with preview |
| `q` / `Esc` | back to the menu; programs running in tiles keep running, and `D` brings the same desk back |

**Layouts** are saved by name in `~/.local/state/ep0ch-door/layouts.json` (`^W w`, `act layout.save name=…`)
and loaded with `^W r`, `alt+d` for `daily`, or `act layout.load name=…`. Built in: `daily` (an agent
terminal over the "now" detail; the outline over its preview, above the middle detail; the editor on the
daily draft over a third detail; the outline, "now" and the right detail open into the middle), `river`
(the river's flow of columns, a preview following the column with the keys), `board` (the kanban with a preview tile
following its card) and `desk`. Loading keeps tiles with the same name (a running program, a reader's note);
running programs or unsaved edits the new layout has no place for go in one shut drawer on the right, never ended.

**Containers and policy (PIE-505).** A layout is a tree of tiles in containers: splits, tab sets and drawers. A
drawer slides out from an edge (`act tile.pin tile=tree edge=left`, or the policy panel's edge row) and takes
anything dropped into it: the tree, claude and a detail can share one. Every container, and the screen itself,
carries a policy saved with the layout (`layout.policy`, `^W P`): `locked`, `draggable`, `droppable`,
`accepts` (tile kinds), `resizable`, `min`/`max`/`fixed` cells, a drawer's `collapsible`, `overlay` and edge, and
`opensInto` (where its tiles' opens land when they have no link: a tile, or a container's key, where an open
lands in a tile opened there), `keep` (how many such tiles it keeps), `shuts` (a close in it shuts its drawer),
`opens` (the open rule: `current`, or `next`).
A locked screen comes back locked after a restart. A **flow** (PIE-513) is the river's columns as a container: an
open from one of its tiles (a link followed) lands in a new column right after its own, the columns squeeze full,
peek or spine around the wide one, and only `^W W` (or a click on a spine) moves the wide place. A layout saved
with one (`{"t": "flow", "kids": [...]}` in `layouts.json`) works on the desk; the River is one (PIE-515).
Every layout change, by key, click or `act`, is one operation of one module (`src/desk/screen-layout.ts`): it is
done whole or refused with the reason, and its rules (floats, policy, the lock, the tile you type in) are checked there.
Tile kinds come from one registry (`src/desk/tile-kinds.ts`): the built-ins register at startup, and an
extension's kind registers the same way. The outline service lists its extensions' tile kinds
(`extensions.list`, `tileKinds`; the example is `tarot.reading`): each registers through `serviceKind` as a
program in a terminal tile, under `^W o` with the capital of its name's first letter (`^W o T` for Tarot;
none when another kind holds that letter, which is said) and through
`act tile.open kind=tarot.reading note=<id>`. Opened from a reader, its block is the note shown there. Its
actions are its kind's own (`ext.tarot.draw`, `ext.tarot.keep`), run by the service and written as `ext:tarot`;
in the tile, the program's own keys run the same actions. A layout saves its kind and its args, nothing else,
and it comes back after a restart. When its extension goes away while the door runs, the tile ends its
program and says why in its place; when the extension comes back, so does the tile. A kind whose program is
on another host than this door says so instead of running.
`EP0CH_DAILY_AGENT` (default `claude`), `EP0CH_DAILY_CWD` (the folder it starts in; default the door's own) and
`EP0CH_DAILY_DRAFT` (default `scratch.md` in the door's state) set the agent and the daily draft; the editor is `$VISUAL`, `$EDITOR`, else nvim or vi.
The agent has one home, the host layer (the agent drawer, below): the daily layout has no tile for it, and lets
the drawer sit beside the desk (its policy's `host: beside`). A layout saved with the old agent tile (marked
`agent`, or in a `daily` desk a `claude` tile whose command is the plain `claude`) comes back without it, beside
the drawer; a terminal you made yourself stays yours.

**What happens to programs in tiles:**

| When | Programs in terminal tiles |
|---|---|
| `q`, `Esc`, going to the menu | keep running: the desk stays alive in the background, and `D` on the menu brings it back as it was |
| `!` / `^W !`, drop to shell | keep running while your shell has the terminal (the door keeps reading them and answering its control socket; it paints nothing) |
| `^W x` on a running program's tile | asks first; again within 3s closes the tile and ends the program |
| the program exits while you're in its tile | the tile keeps your keys: `⏎` runs it again, `ctrl+]` goes back to the door, other keys wait |
| loading a layout | a tile with the same name keeps its program; ones the layout has no place for go in a shut drawer on the right |
| detaching from a session (`ctrl+c`, logging off with `G`, closing the terminal, a dropped ssh; see [Sessions](#sessions-quit-is-detach)) | keep running, scrollback and all: the next `ep0ch` attaches to them. `E` on the main menu or `ep0ch session end` ends them with the session (asking first) |
| quitting a door in its own terminal (`--no-daemon`: `ctrl+c`, logging off from the menu) | asks twice (it names what's running), then ends them. nvim with unsaved changes keeps them in its swap file and offers to recover them next time; without, it leaves nothing behind |
| SIGINT, SIGQUIT, SIGTERM or SIGHUP, or a crash | they end with the door. First, unsaved edits and comments, and the text of a `ctrl+e` editor still open, are copied to `drafts/` in the door's state, the terminal is put back (alt screen, mouse, paste mode, cursor), the control socket is removed, and the door says where the text went. A crash prints its error on the normal screen and exits 1 |
| `kill -9` | nothing in the door runs: a small watcher it started puts the terminal back, and the next door sweeps the stale control socket and copies a `ctrl+e` editor's file to `drafts/` (saying so). Unsaved drafts in the door's memory are lost |
| a restart | a layout's terminal tiles start their programs again (claude, nvim on the same file); a `ctrl+e` edit tile isn't restored (its file was copied to `drafts/` when the door ended) |

### The daily agent in Herdr

With `EP0CH_DAILY_AGENT=<checkout>/scripts/door-agent-herdr.ts`, the daily layout's agent runs in a Herdr
pane and the tile shows it. Herdr lists it (`herdr agent list`), other agents message it
(`herdr agent prompt door "…"`), and it keeps running when the door quits.

- **Where it runs.** The wrapper looks on the default Herdr server (`HERDR_SOCKET_PATH`, else Herdr's own
  default) for the pane labelled `door-claude`.
  - If the pane isn't there, the wrapper makes it: a tab in the workspace labelled `door` (made too if
    missing), in `EP0CH_DAILY_CWD` or the tile's folder, without taking Herdr's focus.
  - It starts `EP0CH_HERDR_AGENT_CMD` there with `exec` (default `door-claude` if it's on PATH, else
    `claude`), so `/exit` ends the pane. Once Herdr detects the agent, the wrapper names it `door`.
  - `EP0CH_HERDR_PANE`, `EP0CH_HERDR_NAME` and `EP0CH_HERDR_WORKSPACE` change those three names.
  - Only your own door uses them: the default state dir with its control socket in it. A door on its own
    `EP0CH_STATE` or `EP0CH_CONTROL` (a test door, the showcase) starts no Herdr agent and says why; with
    `EP0CH_HERDR_SCOPED=1` it adds a hash of that state to all three (`door-claude-1a2b3c4d`). Either way it
    never attaches to, or types into, your `door-claude`.
  - Two doors starting at once make one pane: the wrapper looks for it and makes it holding a lock beside the
    link below (`agent-door-claude.sock.lock`).
- **The tile is attached, not the owner.** The tile runs `herdr terminal attach` on the pane.
  - `ctrl+b q` detaches: the tile says the program exited, and `⏎` attaches again. `ctrl+b ctrl+b` sends a
    `ctrl+b` to the agent (Herdr's attach keeps `ctrl+b` for itself).
  - The mouse is passed through as the agent asked for it.
  - While attached, the tile's size is the pane's size: Herdr locks the pane to the attached client, so a
    Herdr client viewing the same pane sees it at the tile's size.
- **Quitting the door** ends only the attach. The agent keeps running in its pane, so quitting doesn't ask
  twice for it (it still does for other programs running in tiles).
  - The next door's daily tile attaches to it again.
  - In Herdr (on float-2, or from the laptop, where float-2's panes show under the `ep0ch` machine) it is
    the `door-claude` pane in the `door` workspace, named `door` in the agent list. Open it there to carry on.
- **A second door** attaches without `--takeover`, so it doesn't take the agent from the door showing it.
  If another door has the agent, the tile watches it read-only instead: Herdr's observer stream, drawn at
  the tile's size.
  - The tile's title says `watching`. `⏎` takes the agent over, and the other door's tile starts watching.
    `q` stops watching.
  - Only the attached door gets the agent's `ep0ch act` and `show` (below).
- **Which door the agent's actions reach.** Every terminal tile gets the door's own control socket as
  `EP0CH_CONTROL`, the tile's name in the layout as `EP0CH_TILE` (the name the desk gave it, `pty2`, when you
  opened it without one), the tile's id as `EP0CH_TILE_ID` and `EP0CH_IN_DOOR=1`.
  Otherwise it gets your environment (a shell in a tile is your shell), less the door's Herdr pane and tab and
  how the door was started (`EP0CH_DAILY_AGENT`, `EP0CH_LANDING`): one list, `tileEnv` in `src/desk/pty.ts`.
  - It also gets `EP0CH_NEST`, the layers it runs in (`ssh:pts/5 › herdr:w1:p1 › door:<pid>/desk/t1:claude`),
    and `ep0ch where` checks each one and says where your keys are ([where am I](docs/AGENT-INTERFACE.md#where-am-i-ep0ch_nest-and-ep0ch-where)).
  - The wrapper tells the door it attached (`tile.herdr`, as its tile), so quitting the door says it ends only
    the attach. The door no longer reads this from the tile's title, which any program can set.
  - The agent's pane gets the same variables as an agent in a tile (one function, `agentVars` in
    `src/desk/agent-env.ts`): `EP0CH_NEST` (the tile's, then `herdr:door-claude`), `EP0CH_TILE`,
    `EP0CH_TILE_ID`, `EP0CH_IN_DOOR`, the door's `EP0CH_STATE` and `EP0CH_SOCKET` when it has them, and an
    `EP0CH_CONTROL` that is a link in the door's state
    (`agent-door-claude.sock`). The wrapper points the link at its door's socket each time it attaches.
    The agent is started with `env -u` for what the pane mustn't inherit from the Herdr server's own
    environment (how a door was started, an agent variable this door doesn't set).
  - So `ep0ch act …` and the Outliner's `show` from the agent reach the door that shows it now.
  - When the attach ends (`ctrl+b q`, or the door quits or crashes), the wrapper removes the link if it still
    points at its door. With no door attached, `show` finds no door and splits Claude's pane in Herdr.
  - The Outliner's `show` opens the note where an agent's open lands (`open from=$EP0CH_TILE`: the agent is the
    host layer's, so it lands where the focused tile's opens go, or a reader that follows), as an agent's `open`,
    which never moves your focus.
- **No Herdr.** If Herdr isn't installed, no server answers (or one doesn't answer within 10s), or Herdr can't
  make the pane, the tile runs the agent directly, as before, and says why when it isn't simply "no server".
- **Messages are unattributed.** `herdr agent prompt` types the text into the agent's prompt, and nothing
  says who sent it. An agent that messages `door` should say who it is and why ("from loki, on
  PIE-123: …"). The agent should treat an unsigned message as it would text typed by an unknown person.

The current layout is saved to `~/.local/state/ep0ch-door/desk.json`. Mouse reporting is on, so use your
terminal's selection modifier (Shift in Ghostty) to select text.

### The agent drawer (PIE-498)

The daily agent stays with you on every screen: the menu, the BBS screens, the desk, the kanban, the Quay and
the welcome. The chip at the start of the status bar's right part, `▲ claude`, pulls it up.

- **Pulling it up.** Click the chip or press `alt+a`. The agent slides up over the lower half of the screen
  as a drawer, and your keys go to it. The screen under it isn't redrawn smaller: the drawer lies over its
  bottom rows, as the desk's drawers lie over its tiles.
  On macOS, Option+a is `alt+a` only when the terminal sends Option as Alt (Ghostty
  `macos-option-as-alt = true`, kitty `macos_option_as_alt left`, iTerm2's "Left Option key: Esc+",
  Terminal's "Use Option as Meta key"). Otherwise it types `å`: where nobody is typing text, the door reads
  that as `alt+a` (and `¬` as `alt+l`, `∂` as `alt+d`, and so on) and says once which setting sends Alt; in
  an edit, a filter or the drawer's agent it stays the letter. Option+n is a dead key, so `alt+n` needs the
  setting. Only on a US-like keyboard, judged by the locale (an English one outside Britain and Ireland, or
  none): a Nordic, German or British keyboard types some of these characters with keys of their own, so
  there they stay letters. `EP0CH_OPTION_KEYS=us` or `off` decides it instead. The chip's click works in every terminal.
- **Leaving it.** `ctrl+]` gives the keys back to the screen (the drawer stays up); a click on the screen
  above does too. Going back in: a click in the drawer, or `ctrl+]` again (right away, it also sends the agent
  a `ctrl+]`, as in a terminal tile; in a desk's terminal tile you're typing in, `ctrl+]` is that tile's).
  Inside it, every key is the agent's except `ctrl+]`, `alt+a` and `alt+A`. Put away, your keys are back on the
  tile you left.
- **Where it appears** is the screen's to say (its policy's `host`, `layout.policy node=screen host=…`, the `^W P`
  panel's host row): over its lower rows (the default; the screen keeps its size under it), beside it (the
  daily desk: the screen is drawn shorter while it's up), or not at all (a screen that keeps the whole screen).
- **Putting it away.** `alt+a` again, a click on the chip, or `Esc` once you've left it with `ctrl+]`.
- **Its height.** Drag its top edge, or press `alt+A` to step through 40%, 50%, 60% and 75%.
- **One agent, one home.** It runs `EP0CH_DAILY_AGENT` (with the Herdr launcher, the agent in the `door-claude`
  pane), and it starts the first time you pull it up. It's the host layer's (PIE-513): a layout on the same
  engine as the screens, its drawer a tab set whose first tab is the agent, above every screen. No screen has a
  copy of it, so one door never attaches twice; leaving a screen never ends it.
- **What it's doing.** The chip says `working` while the agent writes to its screen and `idle` after. With the
  agent in Herdr, it's Herdr's own state (`herdr agent get`, every few seconds): `working`, `idle`, or
  `needs you` when Herdr says it's blocked. `exited` once the program has ended (`⏎` in the drawer runs it again).
  `watching` when another door (a second ssh session, say) is attached to the agent's Herdr pane: this door only
  watches it, and the drawer says that `⏎` in it would take the pane from the other door.
- **It persists.** Whether it's up and how tall are saved in `dock.json` in the door's state. The next door
  shows it where you left it (not entered). With Herdr it's the same session on every screen and after a restart.
- **What it knows.** After its state the chip says what the agent knows: `▲ claude · idle · door tools` when
  it started in a door (with `EP0CH_CONTROL` and the rest) after the Outliner's Claude mod last changed. A
  running Claude never picks up a new mod or new variables, so when the mod changed after it started (a
  `git pull` in the Outliner), or it was started without the door's variables (by an older door, say, in a
  Herdr pane made before), the chip says `started before update ⟳` (or `no door tools ⟳`). The door reads
  this from the agent's own process: its environment (`/proc/<pid>/environ` on Linux, `ps eww` on macOS; in
  Herdr, the process in the `door-claude` pane, `herdr pane process-info`) and its start time, against the
  newest file of the mod Claude Code loads (`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`), every 15s.
  `agent.knows` says the same, with why.
- **Restarting it.** A click on `⟳` (the chip's last cell), `alt+R`, or `agent.restart`. Only that agent's
  process is asked to exit (SIGTERM; SIGKILL after 8s), then the same command runs again, keeping the
  conversation: `door-claude` continues by itself, and a bare `claude` is given `--continue`. With the agent in
  Herdr, its pane closes with it and the launcher makes a new `door-claude` pane, with today's variables, and
  starts it there, continuing. An agent's `agent.restart` is refused while you're typing in the agent, or
  within 10s of your last key in it.
- **Agents.** `host.toggle [open=true|false]` and `host.size share=0.2…0.9`, `agent.type text=…`, `agent.knows` and `agent.restart` work on every screen through
  `ep0ch act`. An agent's pull waits until you've been idle 2s and you aren't typing, is said on the status bar
  and in the drawer's title (`pulled up by an agent (<id>)`), and never gives the agent your keys. An agent can't
  put it away or resize it while you're typing in it.

## The board

`K` on the menu, or `bun src/main.ts [--ws <workspace root>] --board [hub-block-id]`. Any block with two or more
virtual-branch children is a board; `g` picks one (Delivery Flow on the pi-outliner outline, Outbox on float-hub).
The last board per workspace is remembered.

`--ws ~/float-hub` finds that workspace's socket the way the outliner does
(`~/.local/state/pi-herdr-outliner/<sha256(root)[0:12]>/outliner.sock`).

- **Lanes** are saved views, read by the service with `views.read` (see "On the service platform"). A lane
  says `of N+` when truncated or `invalid` / `failed` with the reason instead of looking empty. The door
  doesn't evaluate views itself.
- **One preview** follows the selected card. **⏎** opens into the detail; **alt+⏎** opens a second detail.
- **`c`** collapses what has focus to a spine: a lane, or the preview or a detail. A reader's spine shows its
  note's title (rotated under Kitty graphics, stacked letters in cells) and marks what it holds: `✎` an
  edit, `¶` a comment, `≡` the property panel, `■` comments that arrived while it was collapsed. The freed
  width goes to its neighbours. `c`, `⏎` or a click on a spine opens it; `alt+c` opens everything collapsed.
  A collapsed reader keeps its edit, comment or property panel exactly: nothing is saved, sent or dropped,
  `Ctrl+C` still asks twice, and opening it returns to it (`e` enters it again). Its own keys don't reach
  it while collapsed. A note opened into a collapsed reader (`⏎`, `open`) opens it. Floats don't collapse.
- **Agents** collapse and open readers with `tile.collapse tile=detail1` (`on=true` folds, `on=false` opens), and `tile=all on=false` is `alt+c`. It's flashed with the agent's id and shown by `peek` (`collapsedBy`). An
  agent never collapses the reader you have focused, and its expand never moves your focus. Note actions in
  a collapsed reader are refused until it's opened.
- **Resize** by dragging any border: between lanes, between preview and details, lanes/readers, drawer edges.
  The edge you grab stays under the pointer; on a header row the title is the grip that moves a tile, the bare
  line after it the border. Keys: `{ }` lane height, `< >` width of the focused lane, reader or outline drawer.
- **A preset on the desk** (PIE-511): the board is a screen on the desk's one layout engine
  (`src/desk/layout.ts`). Its lanes are query tiles in a columns container whose tiles come from the hub
  (`hub:<id>`: one per view, kept by view as views come and go); the readers row is the preview, then the
  details; the outline (the tree over its preview) is a drawer on the left, the backlinks (the list beside
  its preview) a drawer at the bottom; floats sit over it all. The lanes' policy keeps their tiles (draggable
  off), takes only query tiles and opens into the preview: `^W P` changes it, and a lane let go can be dragged
  anywhere, still a lane. Every desk key works here too (`^W` splits, tabs, zoom, lock, `/` search), and a desk
  tile can sit beside the lanes (`^W o`). `peek` and `layout.get` show the tree; agents change it with the
  `tile.*` and `layout.*` actions, which never close or float the tile that has your keys.
- **`o`** pops the focused reader out as a float (the preview floats a copy): drag its title to move, drag
  `◢` to resize, `H J K L` to nudge, `o` again or a click on the `⧉` before its title to dock it back as a
  detail, `x` to close. `x` on the preview says why it stays (the readers row's policy: it collapses with `c`).
- **`t`** outline drawer with its own preview underneath; slides over unless pinned (`T`, or a click on
  `⇤ drawer` in its header: pinned, it becomes part of the layout); `S` moves it to the other side so it
  doesn't cover the preview. Shut, it's a handle at the end of the hint row (`⇤ outline`): a click opens it.
- **`b`** backlinks drawer under the readers, the list beside its own preview of the selected source (the
  quoted snippet in its title); it stays open while you read a source in a detail. `B` pins it into the
  layout; ⏎ / alt+⏎ or a click opens a source in a detail. A link clicked in either drawer's
  preview opens in a detail too. It shows what Detail's Backlinks panel shows (PIE-442, the service's
  `references.backlinks.facets`): this note and its descendants hidden, resolved comments hidden, sources
  grouped by kind with stage counts (`+ Outbox item 10 (2 waiting · 1 draft · 7 done)`), open items first
  and then by date, one line each with a dim breadcrumb and `Work ID ×N`. A group starts folded to its open
  items. The status line keeps the counts adding up (`18 of 23 match · 3 this note hidden · 2 resolved
  hidden · Kind: all · Stage: all · Sort: Updated ↓`); click any of its controls, or use Detail's keys:
  `/` filter as you type (⏎ keeps it, esc undoes it), `s` sort (updated, created, title), `h` resolved,
  `n` this note, `.` or space folds a group (⏎ or a click on its header too). Detail's `k` and `t` are the
  board's up and outline drawer, so kind is **`K`** and stage is **`w`**.
- The board's layout (sizes, drawers pinned or shut and their sides, collapsed lanes and preview) is saved to
  `delivery.json` as a layout, with the hub per workspace and the lane the cursor was in. Details and floats
  aren't saved.

## Moving cards

A lane's query is usually a list of property clauses that must all hold, so a card moves by patching the
properties the target lane names. Nothing else on the card changes. When the query also has an OR or NOT
group, parentheses or a `created`/`updated` range (services with PIE-398), its plain top-level clauses are
still what a move patches, and everything else must already hold for the card: on a lane
`type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=doing` a card in either project
moves by patching `work-stage` alone, and any other card is refused with the term it doesn't meet. The
service plans it (`views.planWrite`, PIE-490): it judges the whole query on the card as the patch would leave
it, so a patch can't break a group it mentions, and names the token ordinals to patch. The door shows the
plan (the picker, a drag's lane and hint line) and applies it with `properties.patch` at the revision the
card was shown at. What a new card in a lane is born with, and the text or roadmap item it's saved as, is
the same capability's answer.

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
  - invalid lanes: lanes with no `query::` (sort-only, limit-only) are invalid
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
  note: `Ctrl+S` creates, `Ctrl+E` hands it to `$EDITOR`, `Esc` twice puts it aside and `n` in the lane
  brings it back). The first line is the
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
  as it is (`Expected exactly one active work queue for project …`). A lost answer is looked for among the project's newest items, never retried.

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
On a board lane, `e` edits the selected card in the preview; in a river column, the column's note.

Every reader is the same **note surface** (`src/surface/note.ts`): it draws the note, follows links, holds
the edit, the passage picker and the comment threads, the property warning and "changed elsewhere", and
keeps unsaved text safe. A view only gives it a rectangle, of any width, and says where a followed link
opens. Writing a note and writing a comment use one edit control (`src/surface/editor.ts`): the same
frame, the same status line, the same keys (`Ctrl+S`, `Ctrl+E` to `$EDITOR`, `Esc`, twice when unsaved).
The board's new-card composer is the same control too.

| Keys | Action |
|---|---|
| `e` | edit in place; the draft is the note's whole text: subject line, body and `[key::value]` properties |
| `Ctrl+E` | hand the draft to `$VISUAL` / `$EDITOR` (then `vi`); what comes back replaces the draft |
| `Ctrl+S` | save |
| `Ctrl+R` | after the note changed elsewhere: load the current text (your draft is copied to disk first) |
| `Esc` | close; with unsaved changes it asks for a second `Esc`, which **puts the draft aside** (below); with a selection, the first `Esc` only lets go of it |
| `Enter` | a new line; on a list item (`-`, `*`, `+`, `1.`, `1)`, `- [ ]`, at any indent) the next item at the same level: numbers count up, a checklist step starts unchecked. On an empty item it goes up to its parent's level (continuing the parent's numbers), and at the top level the list ends. An indented line keeps its indent. A marker you type yourself on the new item replaces it (`- ` then `- ` is one bullet) |
| `Alt+Enter` | a plain new line, no list continuation |
| `Tab`, `Shift+Tab` | indent or outdent the line (or every line a selection touches, nesting kept): an item goes under the item above it, lined up with its text, and back out to its parent's level. Inside a draft `Tab` never moves focus; `Esc` (or `Ctrl+S`) is how you leave |
| `↑ ↓`, `PgUp PgDn` | move by the rows drawn: a wrapped line is several rows, the column kept |
| `Ctrl+P`, or a click on `[preview]` | a live preview of the Markdown under the draft, drawn by the readers' own renderer |
| the wheel | scroll the draft to reread; the cursor stays where it was, and the next key brings it back into view |
| a click, a drag | put the cursor there; a drag selects (for `Tab`, `Shift+Tab`, typing over it or deleting it) |
| `[[`, `((`, `[file::` while typing; `Tab` or `Ctrl+Space` | reference completion: keep typing to filter, `↑↓` or the wheel choose, `Enter`/`Tab` or a click inserts, `Esc` dismisses |
| `Ctrl+Z` | take back the last edit an agent patched into the draft (below), as one unit |
| `A`, while reading | apply anyway: the edit an agent proposed when its patch couldn't apply, on the proposal shown or its embed as the current element; a click on `[apply]` on its embed's source line or in its header does the same. A proposal whose passage was already gone has no `[apply]`, and `A` says why. Anywhere else (not a proposal, nor its embed or control) `A` isn't taken |
| `X`, while reading | dismiss it: the proposal goes to Trash and its embed line comes out of the note, as an edit by you; or a click on `[dismiss]`. Like `A`, taken only on a proposal |

- **Nested lists** (PIE-496): long lines wrap at spaces, never mid-word, and a list item's continuation
  rows hang under its text, not back at the left edge. The wrap is only drawn: the saved text is what you
  typed. Pasted text goes in as it came: a pasted line break or tab never continues a list or indents.
- **Nothing you type is lost.** `Esc` twice on unsaved text doesn't drop it: it's **put aside as unsent**
  where you wrote it (an edit on its note, a comment on its note, a reply on its thread, a new card in its
  lane) and copied to `~/.local/state/ep0ch-door/drafts/`. The status bar says where. The reader shows
  `■ unsent edit from 10:42 · e brings it back` (or the comment's; a lane's header says `■ unsent card`), and
  opening the same draft again (`e`;
  `C` and a passage; `r` on the thread; `n` in the lane) brings the text back. `Esc` twice on text that
  came back unchanged drops it, and says where its copy stays. Closing a screen, quitting and a dropped
  connection (`SIGHUP`) put drafts aside the same way. An edit put aside on an older revision isn't laid
  over a newer note: the reader's line says it was put aside on an older revision and where its copy is,
  until a newer edit of the note is saved. A new card is put aside in its
  lane on its own board: another board's lane of the same name doesn't bring it back. An agent's edit or
  comment never picks up your put-aside text.
- **Click away, as in any editor.** A click inside the draft places the cursor; a click anywhere else
  leaves the edit and does what that click does (focuses a tile, opens a row or a link, opens a drawer).
  An unchanged edit just closes; a changed one is saved against the revision it started from; a save that's
  refused (it changed elsewhere, offline, refused) keeps the text as **unsent**, and the status bar says
  `not saved: … · the edit to “…” was kept as unsent · e brings it back`. An edit brought back unsent and not
  typed in since isn't saved by a click away: it's put aside again, and said. A comment, a reply or a new card
  is kept as unsent, never sent or created: sending is `Ctrl+S`. On the desk `^W` does the same by keys:
  the window key after it leaves the edit and runs (`Esc` after it stays in; `Tab` indents). An agent never
  saves or closes your draft this way (`session.leave`, `composer.leave` are yours).
- **One draft session behind every draft** (PIE-516). The edit, the comment and reply, and the board's
  new card or note go through the same lifecycle (`src/draft-session.ts`), so put aside, restore, click
  away and a stale revision behave the same everywhere. While you have a note open in a draft, an agent
  doesn't write it underneath you (an edit in another reader, a property, a step, a card move): it's
  refused, and the agent patches your draft instead (`draft.patch`), or waits for your save.

- **Reference completion** works in every draft, comments and replies included, the way Tree, Detail and
  Quick Capture do it, from the same service lookups, so the door keeps no index: `[[` offers pages,
  aliases and Work IDs (`pages.complete`), `((` blocks by text (`blocks.query`), `((note#heading` or
  `((note^id` fragments across every note (`fragments.candidates`, by the service's fragment rules; the
  door has none of its own), and `[file::` workspace paths (`files.complete`). The selected candidate
  shows where it sits and how it starts (`blocks.context`). A Work ID inserts `[[WORK-ID|title]]` (or
  `[[WORK-ID]]` when the title holds link delimiters), a page or alias `[[address]]`, a block
  `((id))`, a fragment `((id^fragment))`, a folder `[file::dir/` (its entries come next) and a file
  `[file::path]`. Choosing checks the target still answers first (a fragment with `fragments.read`). A
  heading without an anchor is offered with the anchor it would get: in the note being edited it's added
  in the draft; in another note the service adds it when chosen (`fragments.ensure`, recorded as yours or
  the agent's, and refused if that note changed since it was offered). The popup never keeps a key it doesn't use: with nothing to choose, `Enter`,
  arrows and `Esc` do what they do in a draft, the first `Esc` only closes the popup, and `Tab` outside a
  token indents.
- **Agents edit above while you type** (pi-herdr-outliner PIE-501, `draft.patch`). An open draft is held on
  the service, on a lease the door renews every 5 s, so an agent's compare-and-swap on a span of the note
  lands in your draft instead of the saved note. It applies only while the text it read is still there (at
  or near where it saw it), above the `@request` line it names (or, without one, above the block your cursor
  is in), and not around your cursor. Your cursor, selection and view move with it, so nothing on screen
  jumps; the new text is lit for a moment with `@<agent> · just now`, and `Ctrl+Z` takes it back as one
  unit. Your save records it as yours, naming the agent. If the compare fails (you changed that passage),
  nothing is changed: the proposal lands as a reply block, embedded under the `@request` line (`!((id))`),
  and `A` on it applies it anyway, as an ordinary edit by you. A door that quits, or closes the reader or
  screen the draft was in, lets go of its holds, and patches go to the saved note under a revision check; a
  door that is only slow to answer keeps its hold, and the patch becomes a proposal. When two doors hold
  drafts of the same note, a patch goes to neither.
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
  text on its line is plain text). The service's `properties.preview` (pi-herdr-outliner PIE-401) reads
  them first: the first `Ctrl+S` on a draft that would change them says which and writes nothing; `Ctrl+S`
  again saves.
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
| `⏎` or a click on a `▐` | the thread inline, under its passage (below); again collapses it |
| `Esc` | back a step; with unsent text it asks for a second `Esc`, which puts the comment aside (`C` and a passage bring it back) |

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
- The reader's header counts open comments; the desk's thread tile lists them and refreshes on outline events.

### Threads inline (PIE-420)

A comment mark in a reader's margin (`▐`, yellow while open, dim once resolved) expands its thread under
the passage it quotes, by `⏎` on it (it's one of the `[ ]` elements) or a click. The thread shows who
and when, open or resolved, the comment and its replies, and three controls: **Select**, **Reply**, and
**Resolve** (**Reopen** once resolved). The quoted lines are highlighted while it's open. `⏎` or a click
on the mark again collapses it. Open threads stay open as the note refreshes; another note starts with
none open.

- **The controls** are elements too: `[ ]` steps to them and `⏎` uses one, or click it. No new keys.
- **Select** selects the quoted words as the reader's text selection (their whole lines when the words
  read differently in the reader), so `y` or `Y` copies them.
- **Reply** opens the thread list as your session with the reply started, the same composer as `m`, `r`:
  `Ctrl+S` sends it and you're back reading, the thread still open with your reply in it; `Esc` comes back
  without sending.
- **Resolve** / **Reopen** sets the thread's lifecycle, as `x` in the list does.
- **Agents** use `threads`, `reply` and `resolve` on an expanded thread as on any other. Which threads are
  expanded is your reading state: `thread.toggle` is yours only, an agent's `element.open` on a mark opens
  its own thread list without expanding anything, and on a control it's refused with the action to use.

## Reading notes

Every reader (board, desk, river, the BBS message reader) shows a note the way the outliner's Detail does:
the title, a one-line **summary** of chosen properties, then the body. The block's `[key::value]` metadata
lines aren't printed; they are in the **property panel**, one key away.

The **BBS message reader** (`N`, `R` and `J` on the main menu, `⏎` in a message list) is
the same note surface under the BBS header (`Date`, `To` from `to::` or `ALL`, `From`, `Reply` its
replies, `Subj`, `Conf` its crumbs, `Stat` with the property count and open comments). Everything in this
section and the next ones works there, by keys, mouse and `act`. It keeps its own keys where the surface
has none: `n` `→` next, `p` `←` previous, `t` the replies as a list, `q` back; `⏎` is next unless an
element is current, and `esc` lets go of the element or selection first, then goes back. A followed link
(or `u`/`U` up) opens as the next message reader on the screen stack, so `q` comes back.

- **Summary line.** Keys come from, in order: the saved view the note is shown from (a board lane's
  `[summary-properties::priority,track]`), your own choice (`s` in the panel, or `act props.summary`,
  kept in `properties.json` in the door's state), `OUTLINER_PROPERTY_SUMMARY_KEYS` (Detail's variable;
  empty hides the line), then `status,work-stage,priority,track`. As in Detail, `work-stage` reads
  `stage`, repeated values are joined (`track soil, tools`), and a roadmap item's `status` is left out.
  A board lane's cards show the same keys after their Work ID and priority (a reading list's `author`);
  a lane whose view names none shows what its cards carry (track, or an outbox's to, channel, waiting on).
- **Which lines are metadata** is the service's call: `properties.preview` (PIE-401) says which tokens
  are block-scope metadata lines. Bare `key:: value` lines (line scope) and inline tokens stay in the body.
  Until it answers, the documented rule (the first run of property-only lines after the subject).
- **Links** read as Detail shows them: `((id))` as the target's title, `((id|label))` as its label,
  `[[page]]` as written, without delimiters. Titles, trash state and fragments come from
  `references.resolve`, pages and Work IDs from `pages.resolve` (read-only; nothing is created). A missing
  target reads `label · Missing target`; a trashed one `title · Trash`; a missing fragment says so.
  Code keeps its text, and edit mode, comments and storage keep the raw syntax.
- **Clicking a link opens it**, where `[ ]` then ⏎ on it would (in place in a board detail or float, in a
  detail from the board's preview, the desk's reader, a column beside in the river), and it becomes the
  current element: `((…))`, `[[page]]`,
  `[[Work ID]]`, an embed's title and an embedded view's results, and in the summary line and the
  property panel a value that names a block, a page or a Work ID (a click on a panel row selects it).
  Clicks find links where they are drawn, so scrolling and wrapping move them with the text. A missing
  target says so and nothing opens.
- **Transclusions** (PIE-424, PIE-425). `!((id))` shows the target note rendered, as the reader draws a
  note (headings, lists, steps, links), in a shaded region. `!((id^fragment))` shows just the fragment's
  slice, as Detail does: a step with its continuation and nested steps, a heading's section, a paragraph.
  Embeds nest: an embed inside an embedded note is drawn in place, one gutter further in, to the
  service's depth (3 levels by default), and one that would open a note already open above it says
  `CYCLE · this embed is already open above it`; past the depth it says `DEPTH LIMIT · embeds nest 3
  deep`. The service owns these rules (`transclusions.read`: what a fragment covers, where a cycle is,
  the limits and their wording, shared with Detail); the door asks and draws. A virtual-branch target
  shows its results (`views.read`), with the view's `[summary-properties::]`, its count and
  `TRUNCATED at N`, or `EMPTY`, `CONFIG ERROR`, `QUERY FAILED`. Missing and trashed targets, missing or
  duplicate fragments, failed reads and the 17th embed of a document (`EMBED LIMIT · maximum 16`) each
  say what they are. Links and steps inside an embed are elements like the note's own: `[ ]` stops on
  them, a click acts on them. Embeds refresh when any note they show changes, nested ones included (an
  embedded view: when anything does). `!((…))` in inline code or a code fence stays code. A note's embeds
  are read together (one `transclusions.read`), and its links and block-valued properties resolve in one
  `references.resolve`, asked again only when a change record names one of those blocks.
- **Following a fragment link** (PIE-425). A click on `((id^fragment))`, or `[ ]` then `⏎`, opens the
  note where links open, scrolled so the fragment is at the top, whatever folds hid it unfolded, and
  marked in the reading ruler's tint (`◆ ^beds · the fragment the link names`; `esc` lets go). Where the
  fragment is comes from the service (`fragments.read`). A missing or duplicate fragment opens the note
  and says so. Back and forward work as for any link. The reveal belongs to that one follow; if you
  scroll while it's looked up, your scroll stays. An agent's follow never scrolls or marks the reader you
  have focused; elsewhere its mark names the agent (`· an agent (<id>) followed it`).
- **Literal regions** (PIE-422). Between a `<!-- literal -->` line and a `<!-- /literal -->` line the
  service doesn't read properties, so the reader draws `[key::value]` there as text; links and Markdown
  work as anywhere else. The marker lines aren't drawn (edit mode shows them), and a title skips them, as
  in Detail. An opener without a closer protects nothing, and the reader says so under its header. Where
  a region is follows the service's rules exactly (markers only outside code fences, no nesting, up to
  three leading spaces): `src/literal.ts` mirrors them, and `test/literal.test.ts` checks it against the
  service's own parser. The river's cards and the desk's search preview draw regions the same way.

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
| `esc`, scrolling, `u` | let go of the selected one, so `⏎` means what it did before (the preview opens a detail); `[ ]` steps on to the next element |
| `F` | fold every outermost section and list item; with anything folded, unfold everything |
| click | a heading (anywhere on its line but a link, which opens), or a list item's `▾`/`▸`, folds or unfolds it; the frame and its scroll thumb don't |
| `z` | unfold callouts that start folded (`[!x]-`); unchanged |

Agents do the same through `folds`, `fold`, `unfold` and `fold.toggle` (by `text`, `line` or `n`, or
`all=true`), and leave the person's selection and scroll where they were. A river column is a reader too: its note folds the same way (`▾`/`▸` on its headings, `( )` `f` `F`, a click on a heading).

### Moving through a reader

`[` and `]` step through everything a reader draws, in reading order (PIE-441): links (in the text, the
summary line, an image or a video), headings and list items that fold, the rows of a live figure or an
embedded view that stand for a note, embeds (their title), comment marks (`▐` in the margin beside the
lines a comment quotes; yellow while it's open, dim once resolved), and the controls of a thread expanded
under its passage. `( )` still jumps between folds only. The reader's footer
names the current one (`[ ] 2/9 · link Stake the beans · ⏎ follow · alt⏎ new`), and the block it's in gets
the reading ruler: a calm amber tint across the reader.

| Keys | Action |
|---|---|
| `[` / `]` | the previous / next element (from the view when none is current, or it's scrolled away) |
| `⏎` | a link follows it (in place in a detail; from the board's preview into a detail, as `⏎` on a card); a fold folds or unfolds; a row or an embed opens its note; a comment mark expands its thread inline, or collapses it; a thread's control does what it says (below) |
| `alt+⏎` | a link, row or embed opens in a new reader: a new detail on the board, a new reader beside on the desk, a new column in the river |
| click | the same as `⏎` on what's clicked, and it becomes the current element; a drag still selects text |
| `esc`, scrolling, `u` | let go of the current element, so `⏎` means what it did before (the preview opens a detail); then `esc` takes away a focus mark |
| `tab` | unchanged: it switches areas |

An agent sees the same list with `elements` and acts on one with `element.open n=…` (a link, row or embed
opens where the person's would; a fold toggles; a comment mark opens the thread list as its session, and
leaves the person's expanded threads alone). The
`[ ]` position is the person's: `element.select` is theirs only, and an agent's `element.open` leaves it
where it was. Instead an agent sets a **focus mark** with `block.tint` (`block=`, `line=`/`to=`, or
`quote=`/`near=`, the same passage shape as a comment): the marked lines get the ruler's tint, the header
says `◆ focus · an agent (<id>) marked …`, and the reader scrolls to it if it isn't in view. The person's
position, selection and keys don't move. `block.untint` takes it away. The mark lives in this door's reader;
sharing it through the service, so other clients see it too, is PIE-423's service part. A river column
draws the note's body through the surface's renderer inside its own column (its header and replies are
the river's; folds and elements are the reader's), so `[ ]` steps its links, embeds and steps, `⏎` or `alt+⏎`
opens a link or an embed beside or in a new column, and a step's box opens its status choice.

### Extensions in a note

An extension the outline service runs (pi-herdr-outliner `docs/extensions/README.md`, PIE-507) answers a
line by its key (`moon:: 2026-10-26`, `horoscope:: virgo`, `fancy-horror:: virgo`) or an `@name` request
(`@tidy`). The reader draws what the service kept for each line in a shaded region after it, the way it
draws a ticket (PIE-512):

- **A record** (`moon::`, data) is a real block the extension owns: its title, the fields its handler lists,
  how old it is (`r refresh`, or a click on it), its body. ⏎ on its title opens the block.
- **An inline output** (`horoscope::`) is its Markdown, drawn as the reader draws a note's body, inert.
- **A rich component** (`fancy-horror::`) is drawn from the service's shared primitives (card, box, row,
  stack, text, badge, stat, bar, table, checklist, sparkline) with their tone as colour
  (`src/components.ts`). A primitive this door doesn't know falls back to the line's Markdown, then its data.
- **An `@name` request** shows its state (`queued`, `running`, `applied`, `proposed`, `replied`, `failed`…),
  what the agent said, its reply, and who asked. Its edit lands in the note attributed to the extension
  (`ext:tidy`); one that would overwrite what you're typing becomes a proposal under the line.

Under each line a row of controls: one per action the extension declares on that line (`[w ward]`), the
built-in `[keep]` (the result written under the note as blocks), and `[r run again]` (`[r ask again]` for an
agent). `[ ]` stops on the line's title and on each control; ⏎ or a click runs it (the title runs the line's
first action, else runs it again). While the line is the current element its actions' keys work (`w`): one
printable character each, never one the reader keeps for itself (`[ ] ( ) f u r y v i c m e j k h l q g` and
the like) or its host does (the BBS reader's `n p t`, a following reader's `p`); such an action is still a
click or `act` away. The footer names the keys that work there (`w ward · r again`). `r`
runs the line again; `r` with no element current runs every line of the note (an `@name` request only by its
line). Whatever an action writes is the extension's (`ext:<id>`), whoever asked; the status bar says who ran
it. Agents run the same actions with `act ext.<id>.<action> block=<id>`.

The door asks the service which extensions it runs (`extensions.list`) when it starts and again whenever the
service says they changed: an extension added or removed while the door runs shows up or goes away without a
restart (`extensions: horoscope added` on the status bar).

### Checklist steps

Steps are Markdown checklist items (`- [ ]`, `1. [x]`, `[~]` waiting, `[!]` problem), in the note or
inside an embed of another note, anchored ones (`!((id^t-8a6d7f))`) too (PIE-472). The service says
which items are steps and reads their status (`checklist.query`, and each embed's projection carries
its own); each step's box is a control, and `[ ]` stops on it with the note's other elements. Every
change is one `checklist.update` of that step in the note it's in, checked against the step as it was
read (a step changed since is refused, never overwritten), and recorded as whoever made it: you, or an
agent by its id. Every reader showing the note, or an embed of it, redraws from the change. A step
without an id is known by its text, never by where it sits: if the note is reordered while its status
choice is open, the choice stays on that step, or closes ("that step changed…") if its text changed,
and never acts on another. Your `[ ]` position stays on a step while the note is read again after a
change (yours or an agent's).

| Keys | Action |
|---|---|
| `⏎`, a click (or right-click) on a step's box | the status choice opens under it: Detail's choices, in its order |
| `x` `o` `w` `!` in the choice | mark done, to do, waiting, problem |
| `y`, `a` in the choice | Copy step link (`((note^t-…))` to your clipboard), Make addressable; either gives the step a stable id |
| `j k` `↑↓` `⏎`, a click on a row; `esc` | move, choose; cancel. The choice holds your keys until then |
| `space` on the current step | done, or back to to do (as Detail's space) |
| `ctrl+z` | undo the last step change you made while reading this note |

The keys were picked after checking every screen's: `space` pages a reader everywhere else and keeps doing
so unless a step is the current element in view; `ctrl+z` is undo wherever it's bound (here, and in a draft
for an agent's patch); `x o w !`
and `y a` only mean this while the choice is open (it takes the keys first on the board, the desk, the
river and the BBS reader), and match the board's steps overlay (`x w !`) and the door's `y` for copy.

Agents use `tasks` (the steps the reader draws, in the note and in its embeds), `task.status` (`n=` or
`id=`, `to=done|todo|waiting|problem`), `task.undo` (its own last change) and `task.link`. An agent's
change is said in the status bar and the reader's header (`an agent (<id>) set "Sow the beans" to do →
waiting · in !((…))`) and never moves your `[ ]` position, scroll or selection; the status choice is
yours only.

### Selecting and copying text

The door keeps the terminal's mouse reporting on, so the terminal can't select; every reader does it
itself (PIE-419): the board's preview, details, floats and drawer previews, the desk's readers, river
columns, the BBS reader, the brief and the welcome.

**Copy on select.** A selection you make with the mouse (a drag, a double click's word, a triple click's
row) is copied when the button comes up, as Herdr's `ui.copy_on_select` (on by default) and Claude Code in a
terminal tile do, so a drag then cmd+v works the same in every tile. A "copied to clipboard" toast shows
for a moment at the bottom centre (Herdr's `ui.toast.clipboard`), and the status bar says `copied N chars`.
A plain click selects and copies nothing. `cmd+c` (super+c, which Ghostty passes on when it has no selection
of its own, through the Kitty keyboard protocol) copies the selection too, as `y` does; with nothing
selected it says so. `EP0CH_COPY_ON_SELECT=0` turns copy on select off, as Herdr's setting does: the
selection stays, and `y`, `cmd+c` or the `[y copy]` control on the header's rule copies it. The clipboard
is written with OSC 52, so it works over SSH and through a multiplexer that passes OSC 52 on.

In a draft (an edit, a comment, a new card) a drag selects the draft's text and isn't copied by itself,
because typing or a paste replaces it there; `cmd+c` copies it. In a terminal tile `cmd+c` is the
program's, as it came.

| Keys | Action |
|---|---|
| drag | select from where the button went down; past the top or bottom edge the note scrolls a row at a time. A drag that starts on a link, a heading or a figure selects; it doesn't follow or fold |
| click | what it always did (follow a link, fold, pick a panel row), decided when the button comes up on the same cell; anywhere else it lets go of the selection |
| double / triple click | a word / the drawn row, without its indent (a click on a link or a fold marker acts instead) |
| `v` | the keyboard mode, from the first row in view (or taking over a mouse selection); `h j k l`, arrows, `PgUp PgDn`, `Home End` move its end; `v` or `esc` leaves |
| release of a drag, double or triple click | copy what it selected (copy on select; `EP0CH_COPY_ON_SELECT=0` turns it off) |
| `y`, `cmd+c` | copy what's drawn: links as their titles, rows as they're drawn |
| `Y` | copy the source: exactly the selected words when they read the same in the note's text, else the whole source lines the selection covers (a link's `((…))`, `**bold**`) |
| `esc` | let go of the selection |

With text selected, `C` starts the comment's passage on it. An agent selects with `select` (`text=`, as
drawn, or `line=`/`to=`, 1 is the subject) and gets the text from `select.copy` (`source=true` for the
markup): its selection is its own, drawn in its own tint, is never copied on select, and never replaces
the person's or touches their clipboard. A river column draws a digest of the note, so there `Y` says it can't map the source;
`y` copies what's drawn.

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
  `~/.cache/ep0ch-door/media` (under `$EP0CH_STATE/cache/` when that is set). `\ ` escapes and macOS screenshot names (narrow no-break space before AM/PM) resolve.
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
    in the saved-view grammar (`OR`, `NOT`, parentheses, `created`/`updated` ranges), sent to the service as
    `blocks.query` `expression` (capability `query.expression`, PIE-398). `done:` and `now:` are queries in the
    same grammar: the service says which results they hold for (`query.matches`, PIE-490). They match
    properties only; there is no `author=` pseudo-key.
- Long callout titles keep a short head on the border and flow the rest into the box.
- Code fences, headings, lists, blockquotes, `**bold**`, `[[links]]`, `((refs))` and `[key::value]` are styled.

## The river

`Q` on the menu, or `bun src/main.ts --river`. Quay's model (built with Grok from an outline export, in
`~/projects/tundra-heart-crane-lotus`) on the live outline instead of a seed file. Since PIE-515 the River is a
screen spec on the desk: its columns are tiles of one kind (`river.column`) in a **flow** container, so the layout
is the engine's (`src/desk/screen-layout.ts`) and every column is a reader of the shared note surface.

- **Placement (niri):** `⏎` inserts a column right after its source, or goes to the column that already has that note. `alt+⏎` forces a duplicate.
- **Focus is not the layout:** a click in a column, `h` `l` (`tile.focus dir=`) and `tab` give it the keys and nothing else moves. `w` (`tile.widen`, or a click on a column's header, or anywhere on a spine) widens it: the layout is built around that column, and the one you were reading stays full beside it when there's room. ⏎ and a followed link add the column after its source and shift only if the new one wouldn't show full. A click opens a card only in the column that already has the keys.
- **Compression (Andy's notes):** columns get full, peek or spine width by distance from the wide column; docked (`p`, `tile.dock`; `⊙` on the header) columns resist, and the Library starts docked. A peek draws its whole note at reading width, covered by its right-hand neighbour like a drawer (`▒` on the edge) and dimmed; only the far columns become spines.
- **Threads (Twitter):** `space` expands replies in place under a rail; `s` stacks the selected note as its own column tile under this one (`column.split`).
- **Filter this column:** `/`, then `type:hub -status:done author:codex word`; the hint row is the prompt.
- **Same property:** `#` lists the selected note's properties (or says it has none to follow); a digit opens a column of every note sharing that one (`column.tag`).
- **Go to:** `g` is the desk's search; ⏎ on a hit opens it in the next column.
- **The note surface:** every full-width column is a reader of the same note surface as every screen's. `e` edits the column's note (`ctrl+e` in `$EDITOR`), `C` picks a passage to comment on, `m` lists its comment threads, `i` its properties, `[ ]` step through its elements and `f` `( )` fold (or a click on a heading), as in every reader; `⏎` on a link follows it into the next column (a click on a link does too), `u` opens the parent there. Back and forward (alt+← alt+→, backspace, the mouse's side buttons, or the `← back` row under the title: `tile.travel`) go between the columns: to the one this was opened from, and back again. The column's note is the one it was opened on; in the Library and a `#tag` column it's the selected one. A column holding an edit resists compression. Peek and spine columns are read-only to note actions. Leaving the river (or a SIGTERM) with unsaved text copies it to disk first.
- **Agents:** columns are tiles, named as any tile (`library`, then `column`, `column2`…), so `tile=` takes their names and every desk action works there. The column's own actions: `column.select` (by `id=`, `n=` or `by=`; refused in the column you have the keys in, `id=` too), `column.replies` (alias `replies`), `column.scroll`, `column.filter` (alias `filter`), `column.tag` (alias `tag`), `column.split` (alias `split`), `column.copy` (alias `copy`); the layout's: `tile.widen` (alias `widen`), `tile.dock` (`on=`; `p`), `tile.close` (not the Library: its spec holds it closable off, so a restarted river always comes back with its columns, and its hint row leaves out `x`), `tile.travel dir=back|forward` (`alt+←`/`backspace`/`alt+b`, `alt+→`/`alt+f`; the person's: an agent opens beside). `open id= from=<column>` opens a note in the column after that one (`fresh=true` for a duplicate); an `open` naming no tile lands after the column with the person's keys. `search query=` lists notes. An agent never moves the person's focus, and the column they have the keys in is theirs (its cursor, scroll and filter).
- **The person's keys and an agent's session:** a column holding an agent's edit or comment (or one of yours you moved away from) doesn't take your keys: `h l`, `tab` and `x` keep working, and `e` or `⏎` enters it.
- **Notices:** "properties changed" and an agent's line under a note clear on your next key or click in that column, or, in one you aren't in, after 30 seconds on screen.
- **Back:** `q`, or `Esc` once no link is selected, goes back to the menu.

Reply counts come from one `tree.index` call (cached in `river-index.json` and refreshed in the background).
Card bodies come from `children`. The layout is saved to `river.json` (the desk's layout shape).

## What maps to what

| BBS | Outline |
|---|---|
| New scan | blocks updated since your last logoff (`~/.local/state/ep0ch-door/lastcall.json`) |
| Join conference | top-level blocks |
| Message reader | a block on the note surface (links, properties, folds, comments, edit, selection), under a BBS header: author, date, `to::`, breadcrumb; `T` its children, `U` its parent |
| Who's online | `clients.list`: every Tree, Detail, agent, and this door (the who tile, as a screen) |
| Last callers | `activity.recent` across user, agent and system edits (the activity tile beside a reader, as a screen) |
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

`alt+v` on every screen (`V` on the menu and most screens, or a click on the status bar's video mode) cycles
Kitty+CRT → Kitty → cells. Under Herdr, graphics follow `[terminal] kitty_graphics` in
`~/.config/herdr/config.toml` (older builds: `[experimental]`), because Herdr panes report `xterm-256color`.

## Themes and accessibility

The door has three colour themes, all dark. **calm** is the default; **night** is calm, dimmer; **classic** is the
exact VGA palette the door was drawn in (bright cyan, magenta and phosphor green on `#0000AA` bars).

| Theme | For |
|---|---|
| `calm` | every day: a near-black ground with a little blue in it, ink-slate bars instead of saturated blue, off-white text (never `#fff`), accents desaturated but each still its hue: cyan for links and focus, yellow for headings, red for errors, magenta for agents |
| `night` | late hours and sensitive eyes: calm with the brightest text held near 10:1 and dim text still at 4.5:1 or more |
| `classic` | the VGA palette, unchanged |

- **Switch** with `alt+t` on every screen (calm → night → classic), a click on the theme's name on the status bar
  (beside the video mode), or `ep0ch act theme.set name=night` (an agent's waits until you're idle and is said on
  the status bar). It applies at once on every screen and is kept in the door's state for next time.
  `EP0CH_THEME=calm|night|classic` picks one at start and wins over the saved choice.
- **Ground.** calm and night set the terminal's default text and background (OSC 10, OSC 11) while the door runs,
  so cells with no colour of their own sit on the theme's ground; the door gives the terminal its own back when
  it exits, drops to a shell or runs an editor. A terminal that ignores these keeps its own background.
- **ANSI art keeps true VGA** in every theme: art packs, the menu and logon art, `.ans` files, the art viewer and
  the CRT art path are drawn from `VGA_RGB`, never the theme. The menu art is the same image, byte for byte, in
  all three (`test/theme-contrast.test.ts`).
- **Nothing flashes bright.** No theme has a light ground, a light selection or a light banner; chips (a lit menu
  slot, a drawer handle, a mark) take text that reads on them (`chip` in `src/style.ts`).
- **Checked, not eyeballed.** `test/theme-contrast.test.ts` paints the main menu and every screen the menu opens
  (the welcome notes, the desk, the board, the Quay, the brief, Waiting, the lists, Stats, the showcase) and a reader
  with links, comments, a proposal, the reading ruler and a selection, reads every cell back from the terminal
  mirror and checks WCAG 2 contrast: in calm and night every text cell reads at 4.5:1 or more on whatever it is
  drawn on, and no text is brighter than 15:1 (calm) or 10:1 (night). Lines are allowed lower (box drawing,
  block elements, and the logos' dotted frame and the welcome tabs' rail drawn in the frame colour). Classic's
  numbers are reported, never failed: about a third of its text cells read under 4.5:1 (`#555` on black is 2.8:1).

Each palette entry against the ground and the bar (WCAG 2 contrast; `C.*` and the `|NN` pipe codes name them):

| Entry | calm | on ground | on bar | night | on ground | on bar | classic on black | on bar |
|---|---|---|---|---|---|---|---|---|
| 0 black | `#0d1016` | 1.00 | 1.59 | `#0a0b0e` | 1.00 | 1.23 | 1.00 | 1.58 |
| 1 blue | `#2e3748` | 1.59 | 1.00 | `#1e222a` | 1.23 | 1.00 | 1.58 | 1.00 |
| 2 green | `#64a064` | 6.12 | 3.85 | `#588c5a` | 4.98 | 4.03 | 6.75 | 4.27 |
| 3 cyan | `#4896a0` | 5.57 | 3.50 | `#40848c` | 4.59 | 3.72 | 7.33 | 4.64 |
| 4 red | `#c8625c` | 4.86 | 3.05 | `#c0605a` | 4.74 | 3.84 | 2.71 | 1.71 |
| 5 magenta | `#a86ab2` | 4.87 | 3.06 | `#a068aa` | 4.74 | 3.84 | 3.29 | 2.08 |
| 6 brown | `#b08048` | 5.47 | 3.43 | `#a07442` | 4.75 | 3.85 | 4.01 | 2.54 |
| 7 grey | `#c8cace` | 11.60 | 7.29 | `#a6a6aa` | 8.11 | 6.57 | 9.04 | 5.72 |
| 8 dark | `#9ca0a8` | 7.26 | 4.56 | `#8a8c92` | 5.85 | 4.74 | 2.82 | 1.78 |
| 9 lblue | `#86a4dc` | 7.58 | 4.76 | `#7690c0` | 6.11 | 4.95 | 4.13 | 2.61 |
| 10 lgreen | `#8ac484` | 9.35 | 5.87 | `#78aa74` | 7.31 | 5.92 | 15.82 | 10.01 |
| 11 lcyan | `#80ced6` | 10.62 | 6.67 | `#6eb0b8` | 8.03 | 6.50 | 17.13 | 10.84 |
| 12 lred | `#e8847e` | 7.28 | 4.57 | `#ce7670` | 6.04 | 4.90 | 6.68 | 4.23 |
| 13 lmagenta | `#cc92d6` | 7.84 | 4.93 | `#b080ba` | 6.22 | 5.04 | 8.00 | 5.06 |
| 14 yellow | `#e6ce78` | 12.21 | 7.67 | `#c8b46c` | 9.56 | 7.74 | 19.69 | 12.46 |
| 15 white | `#e4e2dc` | 14.70 | 9.23 | `#bab8b2` | 9.92 | 8.04 | 21.00 | 13.29 |

The tints under text (a selection, an agent's selection, the reading ruler, an open thread, an embed's band, an idle
selected row) are theme entries too (`tint` in `src/style.ts`); in calm and night grey, dark and every light accent
read at 4.5:1 or more on each of them.

## Letting an agent see what you see, and do what you do

The whole interface (every command, the socket protocol, the live feed, nvim tiles, attention marks) is in
[docs/AGENT-INTERFACE.md](docs/AGENT-INTERFACE.md).

A running door listens on `door.sock` in its state dir (`EP0CH_CONTROL` moves it; a second door uses
`door-<pid>.sock`, and sockets left by doors that died are swept when a door starts). **The socket is the
door's shell:** whoever can connect can do what you can, including start a program in a terminal tile. So it
is 0600 in a folder that is yours alone (0700, owner checked); a folder anyone else can reach is refused, and
the door runs without a socket and says why.

    bun src/main.ts peek              # screen as text + structured state: board, lanes, selection, each reader's note, draft, comment, threads
    bun src/main.ts snap [out.png]    # PNG of exactly what the terminal was sent, images included (the door writes
                                      # only under its state; out.png is written by this command, in a folder that exists)
    bun src/main.ts open <block-id>   # act open id=<block-id>: put a block in front of the user (board: the detail; desk: where
                                      # the focused tile's opens land; river: a column; elsewhere a message reader). --as names you
    bun src/main.ts subscribe [types] # the live feed: focus.changed, viewport, cursor, layout.changed, marks.changed, one JSON event per line
    bun src/main.ts actions           # what the current screen can do, with arguments and the keys that do the same
    bun src/main.ts act <action> [tile=<tile>] [key=value…] [--as <actor-id>]

`snap` comes from a mirror that receives every byte written to the terminal (`src/mirror.ts`, the same
compositor the snapshot harness uses), so it shows what is actually on screen, not a re-render.
`open` flashes "an agent opened: …" so it's never silent.

**Acting.** Almost everything you do in a reader, and on the board, is a named action with typed
arguments (`src/surface/actions.ts`). Keys run them, and `act` runs the same code for an agent, so an
agent's edit meets the same revision check, property warning and duplicate-safe comment sends as yours:

| Action | Arguments | Keys it stands for |
|---|---|---|
| `screen.shell` | none. The person's only: an agent's is refused (it would take their terminal); open a terminal tile instead (`tile.open kind=pty`) | `!` on the menu, a click on `! Shell`, `^W !` on the desk |
| `screen.open`, `screen.back`, `screen.list` | `name=` the menu key (`S`), its label (`Stats`) or the screen's title (`board stats`, `river`). On every screen. An agent's waits until you've been away from the keys for 2s and aren't in an edit, a comment, the property panel or a terminal tile, and it's said on the status bar; it never logs you off, and `back` never leaves the menu | the menu's letters, `⏎`, a click on an item; `q`, `Esc` (on the menu `Esc` only: its `q` is the Quay) |
| `list.select`, `list.open`, `list.read` | `n=` the row from 1 (`open`: default the lit one); `from=`, `limit=` for `read`, which moves nothing. On the BBS lists (a message list, Join, File areas); `select` and `open` wait as `screen.open` does | `j k ↑↓ PgUp PgDn Home End`, the wheel, a click; `⏎`, a click on the lit row |
| `list.thread` | `n=` the row (default the lit one): its replies as a message list over this one. On message lists; waits as `screen.open` does | `t`, `T`, a click on `T thread` |
| `menu.select` | `name=` an item's key or label, or `by=` steps (1 down, 4 a column right). The main menu's lit item; waits as `screen.open` does | `↑ ↓ ← →`, `Tab`, the wheel, pressing an item |
| `screen.help` | none: the help screen over this one (any key goes back); waits as `screen.open` does | `?` on the menu |
| `video.cycle` | none: the next video mode (Kitty+CRT, Kitty, cells); the person's display, said on the status bar | `alt+v` on every screen; `V` on the menu, board, desk, river, showcase and views; `v` in the art viewer; a click on the status bar's video mode |
| `theme.set`, `theme.cycle` | `name=calm\|night\|classic` for `set`: the door's colours on every screen, kept for next time (see [Themes and accessibility](#themes-and-accessibility)); waits as `screen.open` does | `alt+t` on every screen (cycle); a click on the status bar's theme |
| `who.refresh` | none: ask again who's attached; answers the callers (Who's online) | `r`, a click on `r refresh` |
| `art.step`, `art.scroll`, `art.ice`, `art.reveal` | `by=` pieces or rows; `on=true\|false` (default toggles). The art viewer's own view | `, . < > ← →`; `↑↓ j k PgUp PgDn`, the wheel; `i`; `⏎`, `space` |
| `open` | `id`, `tile=detail\|new-detail\|float` (board: where the screen's opens land), `tile=preview` or any reader, `tile=<tile>` (desk); on the menu or a BBS list, the note opens in a message reader over it | `Enter`, `Alt+Enter`, `o` |
| `brief.step`, `brief.newest`, `brief.date`, `brief.show` | `by=-1\|1`; `date=YYYY-MM-DD`; `id=<brief>` (the daily brief) | `,` `.`; a link to another day's brief |
| `screen.spec` | none: the screen shown as its spec, the data a screen note holds (PIE-515) | |
| `search` | `query=` (2 characters or more), `limit=`: the desk's search. An agent's answers numbered hits and opens nothing; yours opens the overlay, and its `⏎` runs `open` | `/` |
| `tile.enter`, `tile.leave` | `send=` (enter: a key to pass on, the second `ctrl+]`): type in a terminal tile, or leave it. The person's only: an agent uses `tile.type` | `e`, `⏎` or a click on a terminal tile; `ctrl+]` |
| `thread.pick`, `thread.up`, `activity.pick`, `activity.reload`, `reader.hold` | `n=`, `open=true`; `on=` (hold). The thread, activity and reader tiles' own keys, registered on their tile kinds. An agent's pick answers the row and moves nothing of yours | `j k ↑↓`, a click, `⏎`, `u`; `r`; `p` |
| `tree.fold` | `n=` or `id=`, `open=true\|false`: a tree row's children. An agent can't fold away the rows your selection is in | `l → space h ←`, a click on a row's mark |
| `backlinks.fold` | `kind=`: a group in a backlinks tile (`backlinks.view` takes `step=` for its status-line controls) | `.`, `space`; `s K w h n` |
| `section.try` | `name=`: the showcase's part, given the keys. The person's only (`section` is the agent's) | `⏎ → l Tab`, a click into the stage |
| `host.enter`, `host.leave` | `send=`, `restart=true` (an exited agent runs again: `⏎` only); `quiet=true`: type in the agent drawer, or leave it. The person's only | a click in it, `ctrl+]`, `⏎` on an exited agent |
| `welcome.select`, `welcome.read`, `welcome.logo`, `welcome.reload` | `n=<place>` (1-10 are the tabs' `1`-`9` `0`) or `id=`; `read=true` gives the detail your keys (never an agent's); `id=` any note for `read`; `by=-1\|1` (the welcome screen) | `1`-`9` `0`, tabs, the list; `alt+⏎`, ctrl-click; `L` |
| `tree.links`, `tree.pick` | `tile=<outline tile>` (the board: its outline drawer); `n=` (as peek's `tree.rows`) or `id=`; `show=true\|false` (links); `open=true` (pick: as `⏎`; a ticket the Jira extension keeps as a block opens that block). An agent's never moves your selection or keys | `L`, `l h space` on a link; `j k`, `⏎`, clicks |
| `projection.refresh` | `tile=`; `block=` (a page or a ticket block; default the one the `[ ]` position is on, else the reader's note), `line=` (one line: an extension's output or component runs again, an `@name` request is asked again, a record fetched). Without `line=`, every line, and every `@name` request not answered yet. Fetches its tickets and runs its extension lines now; the service writes as the extension (`ext:jira`, `ext:moon`), and whoever ran it is who asked (`asked by you`, `asked by an agent (<id>)`) | `r`, a click on a ticket's age or a line's `[r run again]` |
| `ext.<extension>.<action>` | `block=` (the note with the handler line, or the block it acts on), `line=` (when the note has several of that handler's lines). An extension's action as the service lists it (`ext.fancy-horror.ward`, the built-in `ext.<id>.keep`); the service runs it and what it writes is `ext:<id>`. A tile's actions (`ext.tarot.draw`, `ext.tarot.keep`) are its tile kind's: `tile=<the tile>`, `block=` defaults to the tile's own | the action's key on its line (`w`), a click on its control (`[w ward]`); in a tile, the program's own keys |
| `changes.extensions` | `include=true\|false` (default: toggle). Whether "what changed" (the status bar's `+N new`, the new scan) includes what extensions wrote, such as a refreshed ticket. Off by default; the person's only | a click on the status bar's `+N ext` |
| `backlinks.pick`, `backlinks.view` | `tile=<backlinks tile>`; `n=` (as peek's rows) or `id=`, `open=true`, `fresh=true`; `kind stage resolved related sort` as `backlinks` takes them (a backlinks tile: the welcome's, or `^W o l`) | `j k`, `⏎`, `alt+⏎`, clicks; `s K w h n` |
| `focus` | `tile=<tile>` or `tile=lanes`. An agent's is refused while you're typing, and within 2s of your last key. On the desk it is `tile.focus` | `Tab`, `Shift+Tab`, a click, `esc`/`q` back to the lanes |
| `card.select`, `card.move` | `id`, or `lane` and `by` (steps; `lanes=` steps lanes; `focus=false` leaves the current lane, as the wheel over another lane does); `lane`, `card` (default the selected card; an agent's own `card.select` first, which never moves your cursor) | `h l j k ↑↓ ← → PgUp PgDn`, a click, the wheel; `H L`, `m` then `⏎`, drag |
| `board.hub` | `id` (a board's block id): show that board; none: the boards there are (yours opens the picker, an agent's only lists them); `close=true` puts the picker away (yours) | `g`, then `j k ⏎` or a click; `esc` `q` |
| `lane.collapse` | `lane` (default the lit one), `on=true\|false` (default toggles) | `c` on the lanes, `⏎`/`space` on a collapsed lane, a click on its spine |
| `tile.drawer`, `tile.pin` on `tile=tree` | the board's outline drawer: `tile.drawer` opens or shuts it (`open=true\|false`, default toggles), `tile.pin` docks it or slides it again, `edge=other` moves it to the other side. An agent's open leaves your keys where they are, and it can't shut the drawer you're in. An open drawer's `[×]` shuts it as `esc` does | `t`, `T`, `S`, `esc` `q` in it, a click on `[×]` |
| `float.place` | `dx dy` (steps) or `col row cols rows`: move or size a float, kept on screen | `H J K L` on a float, dragging its title or `◢` |
| `backlinks.pick`, `backlinks.fold` | `n`, `id` or `by`; `open=true`, `fresh=true`; `kind` (fold: a group). One grammar on the board's backlinks drawer and the desk's backlinks tile. An agent's pick leaves your selection and preview; folding is your view, an agent's is refused | `j k Home End`, `⏎`, `alt+⏎`, clicks, the wheel; `.` `space` |
| `board.reload` | none: read the lanes again | `r` |
| `card.create` | `lane`, `text`, `parent` (default the lane's) | `n`, typing, `Ctrl+S` |
| `note.create` | `text`, `parent` (default the selected card) | `N`, typing, `Ctrl+S` |
| `steps`, `step.set` | `card` (default the selected card); `step` (number from 1, or `^id`), `status=todo\|done\|waiting\|problem` (default toggles done) | `s`, `j k`, `space x w !` |
| `card.trash`, `card.restore` | `confirm=<the card's id>` (the second `d`; without it the person's first `d` arms, an agent's is refused), `card`; `id` (default the card trashed last) | `d d`, `u` |
| `tile.widen` | `tile=<tile>` in a flow | desk `^W W`, a click on a flow column's spine |
| `tile.collapse` | `tile=preview\|detail1\|detail2` or a lane's tile (the focused one by default), `on=true\|false` (default toggles); `tile=all` opens everything (board) | `c`, `⏎` or a click on a spine, `alt+c`; desk `^W c` |
| `tile.resize` | `tile=<tile>` (`lanes`, a reader, `tree`, `backlinks`, a float; default the focused one), `by` (steps, `-20`…`20`), `axis=row\|col` (width, default; or height) | board `{ } < >`, desk `^W < > + -`, dragging a border |
| `tile.close`, `tile.float`, `tile.pin` | `tile=<tile>`; `on=true\|false` for `pin` (default toggles). `close` takes a detail, a float or a drawer's tile (it shuts the drawer); the lanes and the preview stay and say why. `float` pops a reader out or docks a float, `pin` on the board's `tree` and `backlinks` docks or slides the whole drawer. An agent can't close or float the tile that has your keys | board `x`, `esc`, `o`, a click on a float's `⧉`, `T`, `B`; desk `^W x`, `^W f`, `^W p` |
| `tile.zoom` | `tile=<tile>`, `on=true\|false` (default toggles). The desk and every screen on it, the board too. An agent zooms only the tile that has your keys | `^W z` |
| `pane.split` | `kind=` any tile kind (`actions` lists them: reader, tree, detail, preview, thread, activity, who, art, an extension's, …), `dir=row\|col` (default along the longer side): `tile.open` with its own arguments. On the board a detail opens with a note (`open tile=new-detail`) | desk `^W o` |
| `backlinks` (the backlinks tile's) | `id` (default the tile's note; yours, none: the reader you read through), `filter`, `kind` (key or label, or `all`), `stage` (`all open waiting draft active done`), `resolved`, `related`, `sort` (`updated`, `created`, `title`, optionally `-asc`/`-desc`). Answers the view: status line, groups, rows. An agent's reads the person's view with its own options on top and changes nothing of theirs; yours (`as=you`) sets the drawer | `b`, `/ s K w h n .`, clicks |
| `edit`, `edit.text`, `edit.save`, `edit.reload`, `edit.close` | `text`; `discard=true`; `external=true` (edit: hand the draft to `$EDITOR`, the person's only) | `e`, typing or `Ctrl+E` (`$EDITOR`), `Ctrl+S`, `Ctrl+R`, `Esc` |
| `session.leave` | none: leave the edit or comment as a click elsewhere does (an unchanged edit closes, a changed one saves, a refused save or a comment is kept as unsent). An agent: only a session it opened | a click outside the draft; desk `^W` then a window key |
| `composer.leave` | none: the board's new card or note is kept as unsent, never created. The person's only | a click outside the composer |
| `composer.close` | `discard=true` with typed text: the board's new card or note closes, typed text put aside as unsent. The person's only | `Esc` (twice with typed text) |
| `draft.newline`, `draft.indent`, `draft.outdent`, `draft.place`, `draft.scroll`, `draft.preview` | `plain=true`; `from`, `to` (lines from 1; default the cursor's or the selection's); `line`, `col`, `extend=true`; `by` (rows); `on`. On the reader's edit or the comment being written, and only a draft the agent opened and alone has typed in: the person's draft, typed in or not, is theirs (an agent's change lands there as a `draft.patch`) | `Enter` (`Alt+Enter` plain), `Tab`, `Shift+Tab`, a click or a drag, the wheel, `Ctrl+P` |
| `draft.undo` | none: the last agent patch in the reader's draft (an agent: only its own) | `Ctrl+Z` in a draft |
| `proposal.apply` | `id` (default: the proposal whose embed or control is the current element, else the note shown): apply anyway, as an edit by whoever runs it; refused on one marked `[proposal-applies::no]` | `A`, a click on `[apply]` |
| `proposal.dismiss` | `id` (default: the proposal whose embed or control is the current element, else the note shown): the service (`draft.proposal.dismiss`) takes its embed line out of the note or the draft of it, marks it dismissed and puts it in Trash, all recorded as whoever runs it; an agent dismisses only its own | `X`, a click on `[dismiss]` |
| `complete` | `text` ending in the token (`[[HOME-4`, `((beds`, `((plan#`, `[file::notes/`), or none for the draft's cursor; `insert=n` puts the nth into the draft (an agent's: only a draft it opened, or with `invitation=`) | `[[ (( [file::`, `Tab`, `Ctrl+Space`, `↑↓`, `Enter` |
| `passage.select`, `comment.write`, `comment.send`, `comment.close`, `comment.reload` | `quote` (exact words), `near`; `body` (an agent's: only a comment it opened, never yours; `invitation`, `base`: an invited agent's reply); reload finds the quote again, or goes back to picking | `C`, `j k J K h l H L`, `Enter`, `Ctrl+S`, `Esc`, `Ctrl+R` |
| `comment` | `quote`, `body` (select, write and send in one) | |
| `threads`, `reply`, `resolve` | `thread` (id or 6+ chars), `body`; `open=true` reopens | `m`, `r`, `x`; the Reply and Resolve controls |
| `thread.toggle` | `thread`, `expand=true\|false` (default toggles). The person's only | `Enter` or a click on a comment mark |
| `link.select`, `link.follow`, `up` | `n` (from 1); `fresh=true` (follow) opens it in a new reader. An agent's is refused in the reader that has your keys (and its `link.follow n=` never moves your `[ ]` position); a web link or a figure an agent follows is never opened in your browser or viewer: it gets the address back | `[ ]`, `Enter`, `alt+Enter` or a click, `u` (`U` in the message reader) |
| `elements`, `element.select`, `element.open` | `n` (from `elements`), or `by=1\|-1` (select: the next or previous), `n=0` lets go; `fresh=true` opens a link, row or embed in a new reader. `element.select` is the person's only | `[ ]`, `esc` lets go, `Enter`, `alt+Enter`, a click |
| `scroll` | `by=` rows, or `to=top\|end`: the reader's own scroll. An agent's is refused on the reader that has your keys: it uses `view.scrollTo` | `j k ↑↓ PgUp PgDn space Home End`, the wheel |
| `callouts` | `show=true\|false` (default toggles): the reader's callouts drawn open. The person's only | `z` |
| `select.mode` | none: keyboard selection starts (`h j k l` extend, `y` copies). The person's only: an agent selects with `select text=` | `v` |
| `fold.select` | `by=1\|-1`: the next or previous heading or list item to fold. The person's only | `( )` |
| `block.tint`, `block.untint` | one of `block` (this note, or one it embeds or links), `line` and `to` (1 is the subject), `quote` and `near` | `esc` clears it |
| `tasks` | none: the checklist steps the reader draws, in the note and inside its embeds (`n`, `id`, the note each is in, status) | `[ ]` |
| `task.status` | `n` (from `tasks`) or `id` (`t-8a6d7f`, `^t-8a6d7f`, `<note>^t-8a6d7f`; `block=` narrows it), `to=done\|todo\|waiting\|problem` | `⏎` or a click on a box, then `x o w !`; `space` |
| `task.undo` | none: the asker's own last step change in this reader, while reading this note | `ctrl+z` |
| `task.link`, `task.menu` | `n` or `id` (the person's: default the step at their keys). `task.link` gives the step an id if it has none and answers `((note^id))` (yours goes to your clipboard; `copy=false` only makes it addressable); `task.menu` opens the status choice and is the person's only | the choice's `y` and Make addressable; `⏎` on a box |
| `props` | `full=true` | `i`, `I` |
| `props.copy`, `props.follow` | `n` (from `props`) or `key` | `Tab`, `y`, `o` |
| `props.edit` | `n` or `key`, `value`, `revision` (refused if the note is past it) | `Enter`/`e`, typing, `Enter` |
| `props.close`, `props.summary` | `keys=a,b` (yours), `toggle=key`, `reset=true` | `Esc`, `s` |
| `folds`, `fold`, `unfold`, `fold.toggle` | `text` (a heading's or item's words, `##` optional, a unique start is enough), `line` (of the note, 1 is the subject), `n` (from `folds`); `all=true`. With nothing named, the person's `fold.toggle` acts on the fold at their keys (an agent names one) | `f`, `⏎`, `F`, click |
| `select`, `select.copy`, `select.clear` | `text` (as drawn; `n` for the nth), or `line` and `to` (1 is the subject); `source=true` | drag, double/triple click (and their release copies), `v`, `y`, `Y`, `cmd+c`, `esc` |

Readers are named `preview`, `detail1`, `detail2`, `float1`…, `tree`, `backlinks` on the board (a detail
keeps its name while it lives: close `detail1` and the other is still `detail2`), by tile name, id (`t4`) or
number (`#2`) on the desk, and `message` in the BBS message reader (which adds `message.next`, `message.previous`
and `message.thread`); `tile=focused`, or a block id (the reader showing it) work too, and no reader means
the focused one. `peek` lists them with what each shows. A value `@file` is read from a file, `@-` from
stdin. For example:

    export EP0CH_AGENT=claude-7                       # or --as claude-7 on each call
    bun src/main.ts act open id=<card> tile=detail    # tile=preview is refused while you read the lanes through it
    bun src/main.ts act edit.text text=@draft.md      # replaces the agent's own draft; opens the edit if needed (never yours)
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
makes that you. An agent's `edit.text` or `comment.write` never replaces an edit or comment you opened, and never one you're typing in, and its `complete insert=` never types at your cursor, unless an `@name` line of yours invites it (one step); when
it replaces text someone else changed last in its own edit or comment (your typing there, or another agent's),
that text is copied to `drafts/` first, the draft says where, and the action answers `keptYourDraftAt`. While a save is checking properties or landing, or a comment is
sending, the draft holds still: keys wait and an agent's `edit.text`, `edit.close`, `edit.reload` and
`comment.write` are refused with the reason. An agent's `card.select` is its own: the card its
`card.move`, `steps`, `step.set`, `note.create` and `card.trash` default to without `card=`, said in the
status bar; your lane cursor, preview and keys stay put, and so do they for its `card.move`. Only `open`
and `focus` move them, and they say so in the status bar. Readers in a
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

The service owns what things mean; the door asks it, and never computes the answer itself.

- **One protocol.** The door and the service speak `PROTOCOL` (outline-core's protocol.ts); `ping` reports the
  service's. A service on another number is refused at start, naming the side to update: an older host, "restart
  the outline host on current code"; a newer one, "update the door (ep0ch install --apply)". `ep0ch doctor`
  flags such a service before that. `peek` shows the service's protocol (`service.protocol`).
- **Saved views** (lanes, and `view:` in live figures) come from `views.read` (PIE-397). Moves and new
  cards are planned by `views.planWrite`, and a live figure's `done:` and `now:` by `query.matches`
  (PIE-490). The door has no evaluator of its own.
- **Property grammar.** The door finds `[key::value]` tokens while it paints (titles, digests, metadata
  lines) with outline-core's `property-grammar.ts`, the file the service parses with; `test/grammar.test.ts`
  checks that titles hide exactly the tokens the service's parser reads.
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
- `checklist.update` when you set a step (on the board's steps overlay, or a step's box in any reader, in
  the note or inside an embed), or copy its link, with the step's evidence (and its read revision when
  it has no id), attributed like an edit. A step without an id whose note moved on since it was read is
  looked up again only when exactly one step has the same text; otherwise the refusal stands.
- `delete` (to Trash) and `trash.restore`; the service records no author for either.

Reads for those: `checklist.query`, `transclusions.read` (an embed's steps), and `properties.preview`
before a create.

The service has no auth or read-only mode, so these limits are the door's own discipline.

## Checking it

    bun test
    bun run check
    bun scripts/snap.ts           # drives the real door against the live outline and writes out/snap-kitty-*.png
    bun scripts/snap.ts cells     # same, cells mode
    bun scripts/snap.ts desk      # the desk at 200×60: expand, focus, add a tile, dock, search
    bun scripts/snap.ts river     # the river at 200×60: open beside, replies, compression
    bun scripts/render.ts SHY-EMNU.ANS   # one piece to out/*.png
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts edit   # seeds a board, edits, races a second writer
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts move   # seeds a board, moves by key, picker and drag, a refusal, a stale card
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts comment   # quotes, comments, replies, resolves, races a second writer
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts agent     # an agent drives the board through the control socket: open, edit, save, comment, move
    EP0CH_SOCKET=<scratch sock> EP0CH_SNAP_WRITES=1 bun scripts/snap.ts props     # a roadmap-like card: summary line, panel (inline, full, edit, a refused edit, follow), every embed state
    bun scripts/snap.ts journey   # its own scratch host: the whole journey above, restart included
    bun scripts/snap.ts kanban    # its own scratch host: OR lanes, a move and a refusal, n, steps, trash and undo
    bun scripts/snap.ts showcase  # its own scratch host, seeded like the showcase: every section, a board spine, an edit with completion, a click, an agent
    bun scripts/snap.ts fold      # its own scratch host: fold by keys, a click and F, an edit elsewhere keeps folds, an agent unfolds, the desk
    bun scripts/snap.ts tree-links   # its own scratch host: the tree's L, a link's links, a file and a ticket shown
    bun scripts/snap.ts backlinks    # its own scratch host: the board's backlinks drawer as Detail shows it, a kind and a filter
    bun scripts/snap.ts steps     # its own scratch host: nested and anchored embeds, a cycle, a step's status choice, an agent's change

`test/kanban.test.ts` creates cards and notes, sets steps, trashes and restores, and moves into OR lanes
by keys and through the control socket, with the service's plans (`views.planWrite`; its planning is
tested in the outliner's `test/view-writes.test.ts`). `test/edit.test.ts`, `test/move.test.ts` and `test/comment.test.ts` save, move, comment and race real
writes against a throwaway outline host they start themselves (`test/scratch.ts`: its own outlines folder,
one outline, Inbox agents off). `test/platform.test.ts` covers which lanes a change asks again, a dropped
connection's catch-up, a host restart (graceful, with the door connected), a feed reset, and a host on another
`PROTOCOL` refused with the side to update. `test/move.test.ts` also checks every lane after the
moves against the outliner's own `saved-view-read.ts`, and `test/grammar.test.ts` the door's titles
against the service's property parser. The tests find the outliner beside the door (`../outliner`;
`EP0CH_OUTLINER` overrides it). The `edit`, `move`, `comment`, `agent` and `props` snapshots write too, so they refuse to run
unless `EP0CH_SNAP_WRITES=1` and `EP0CH_SOCKET` is set explicitly to a socket under the temp dir whose
service serves a workspace there too (a scratch service): they never fall back to the default socket.

`scripts/snap.ts` runs a small emulator over the exact bytes the door writes (cursor moves, colour,
Kitty upload, place, crop and delete) and composites them into a PNG.

## Known limits

- Live figures need `query.expression` for `query:` and `query.matches` for `done:` and `now:`; moves and new
  cards need `views.planWrite`, and lanes `views.read`. The door has no evaluator of its own.
- Nested embeds each keep their quiet `»` source line and bar; PIE-185's flat composition (no chrome per level)
  and a configurable depth aren't here. Detail itself doesn't nest embeds yet (PIE-185); the door takes
  the service's depth.
- Relation-view and checklist-view targets embed as ordinary notes, not as Detail's projections; an
  embedded view's result rows aren't followable (follow the `!((…))` link itself); `!((…))` inside a
  callout or a table stays a link.
- A reconnect that missed more than 500 changes reloads everything rather than paging the feed.

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- The editor wraps a line by cells, but a click and up/down count one cell per character, so on a line with wide (CJK, some emoji) characters they land a little off.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
- Sessions (PIE-418): one per state dir, so a second outline at once needs its own `EP0CH_STATE` (or `--no-daemon`).
  Two terminals share one size, the latest typer's (as tmux's `window-size latest`); the other sees the frame cut or
  padded. Text typed into a draft since it was last put aside lives only in the daemon's memory: a daemon killed
  with `-9` loses it (a handoff puts it aside first). The terminal host's own code can't be upgraded under its
  programs: a change to its protocol ends them, and their tiles start them again.
