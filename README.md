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

## Outlines on the outline host

With pi-herdr-outliner's outline host running (one socket per machine, `<state>/outliner.sock`, holding any
number of outlines by name), the door opens outlines like Herdr sessions:

    ep0ch --ws jam-shelf              that outline; created if there is none ("created outline jam-shelf")
    ep0ch --ws /work/fred             the folder's outline: the nearest bound folder (client.json), else
                                      the git repository root's name, else the folder's own name
    ep0ch                             the same for the current directory
    ep0ch outline list | attach <name> | create <name> | adopt <path> <name> [--root <dir>]
                | stop <name> | delete <name> [--yes]     (each with --json)
    ep0ch status                      the host's socket, default outline and open outlines

This is the outliner's folder rule (`resolveFolderOutline`), mirrored in `outlineForFolder`: a folder
with its own hash database, or a `local`/`remote` choice, keeps its connection; `$HOME`, `/` and folders
directly under `/` name no outline, nor does a guess whose outline records another folder. For those the
door opens the host's default outline and says so ("no outline for ~, opened the default: pie"), where
the outliner refuses: the door is interactive and shows the name. A created outline records its folder.
`EP0CH_SOCKET` or a socket path still overrides the choice. Every request and the subscription name the
outline, and a single-outline service is refused when an outline is named. The status bar and `peek` show
`host · outline`. Only opening the door creates an outline; the listings and `clients` never do. Without a
host, `--ws <root>` and discovery work as before (`src/discover.ts`, `resolveTarget`, `outlineForFolder`).

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

## The showcase

    scripts/try-it.sh --showcase --outliner <pi-herdr-outliner checkout>
    scripts/try-it.sh --showcase --reset --outliner <pi-herdr-outliner checkout>

opens the showcase (PIE-439): the shared door parts, live, in fourteen sections, one per row of the reuse map
([Before adding a feature](docs/UI-GRAMMAR.md#before-adding-a-feature)) in the map's order. The map's
elements and reading-ruler row (PIE-441) has no section yet. It runs on an
outline of its own: a private service (own state, workspace and config dirs, background agents off, Herdr
unset) on a persistent workspace under `<the door's state>/showcase/` (`$EP0CH_STATE`, else `${XDG_STATE_HOME:-~/.local/state}/ep0ch-door`), with the
door's own `EP0CH_STATE` and `EP0CH_CONTROL` there too, so nothing reaches a real outline or your door.

- **The outline** is seeded on the first run from `src/showcase/seed.ts`, a made-up household (an allotment,
  a kitchen, bikes), written through the service API (`create`, `work-ids.configure`,
  `roadmap.items.create`, `properties.patch`, `annotations.*`), not into SQLite. It has a board hub with a
  lane per work stage and cards in each, callouts, links and soft links (`HOME-001`), folds, a literal
  region, a transclusion, properties in block, line and inline scopes, open and resolved comment threads,
  a saved view, one of every `::graph-*` kind, live ones included, and a call naming made-up tickets under
  `jira::` lines with a ticket page under it (PIE-445: a made-up ticket extension, `src/showcase/tickets`,
  is installed in the showcase's own config dir, and one ticket fetched through it; nothing real is contacted).
- **It's writable.** Edit, move and comment freely; it stays until `--reset`, which stops its service,
  deletes that state and reseeds. Its service is the process `service.pid` names only when that process
  is the outliner's server on the showcase's state; a pidfile left by a crash or a reboot is dropped, and
  whatever process has that pid now is left alone. `--prepare` sets it up (or resets it) and exits without opening the door.
- **The screen** lists the sections on the left: `↑↓` `j k` `1-9 0` (the first ten) or a click picks one; `⏎`, `→`, `Tab`
  or a click in it hands the part your keys and mouse; `Esc` backs out through the part to the list. Each
  section names the part and its files and is drawn by the part itself, on a preset desk (the layout tree,
  nothing saved to your `desk.json`) or the real board. A parallel version still in the code
  (`WhoOnline`, `LastCallers`) is framed beside the shared one and labelled "parallel version, to
  consolidate"; ones that can't be framed alone are named on the section's third line.
- **Reaching it:** `X` on the main menu (its key line; the menu art has twelve slots), or `--showcase` on
  the command line, beside `--desk`, `--river` and `--board`. On an outline without the seed it says so and
  writes nothing.
- **Agents:** `ep0ch-door act section name=<1-14|key>` shows a section (your keys go back to the list);
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
- **The screen** is a desk with one reader at full width: the shared note surface, so links, live figures,
  folds, comments, selection, `[ ]` and the ruler work as in any reader. Its header (the surface's `header`
  hook, as the message reader's) leads with the day and "n of m briefs". `,` and `.` step to the previous and next day's brief (by `brief-date`, then by update).
  A link, a figure row or `u` opens in a reader beside it, so the brief stays; your keys stay on the brief.
  `^W` and the other desk keys work too; nothing is saved to your `desk.json`.
- **No briefs:** it says so and names the skill.
- **Agents:** `brief.step by=-1|1`, `brief.newest`, `brief.date date=YYYY-MM-DD` (refused while you're
  typing in the brief), plus the desk's and the reader's actions. `open <id>` on a brief steps to it;
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

The stack is Bun, Herdr, the Outliner plugin (pi-herdr-outliner, linked as a checkout or installed by
Herdr), its outline services, this checkout and the `ep0ch` command. Two commands look after it, on
macOS and Linux alike:

    ep0ch doctor [--json]            every piece and its state, with the command that fixes it (read-only)
    ep0ch install                    the plan: what would change, step by step (a dry run; nothing changes)
    ep0ch install --apply            run it
    ep0ch install --apply --restart-services
                                     also restart per-folder services running old code

`doctor` marks each piece ✓ current, ! behind, ✗ missing (· is information):

- **bun**: its path and version.
- **the plugin**: linked (a checkout: its commit against `origin/main`, after a `git fetch`) or managed
  by Herdr (the commit Herdr installed against the source's branch on GitHub, by `git ls-remote`;
  "managed, cannot compare" when that can't be reached), and its protocol and service capabilities.
- **the door**: this checkout against `origin/main`, whether `bun install` is needed (a package missing,
  or installed at a version other than `bun.lock`'s), and whether `ep0ch` on PATH runs this checkout.
- **outline services**: the outline host (its socket, default outline and outlines, and its systemd
  unit or launchd agent when there is one) and each per-folder service: running or not, and whether it
  runs old code (a protocol or capability the installed plugin offers that the running service
  doesn't, such as `fragments.candidates`: "restart to pick up new features").
- **Herdr**: the server, and the keys for the plugin's actions in `config.toml`.
- **Claude**: whether Claude Code's `CLAUDE_CODE_PLUGIN_DIRS` loads the installed plugin's `claude-mod`
  (a managed reinstall can move the plugin's root; the Outliner's `scripts/install-claude-mod.ts` points
  it again), and `FORCE_HYPERLINK`, a known issue (PIE-486).

`install` runs these steps in order, each skipped when it's already current, each saying what it did:

1. **Back up** every local outline database (the host's outlines and every folder service's) with
   SQLite's `VACUUM INTO`, a consistent copy even while a service writes, into
   `~/backups/ep0ch/<name>-<UTC timestamp>.sqlite`, integrity-checked. It runs before any other step
   changes anything, and not at all when nothing else changes.
2. **Update the plugin**: `git pull --ff-only` in a linked checkout (then `bun install` when needed), or
   for a managed one `herdr plugin install <owner/repo> --ref main --yes` again (Herdr has no update
   command; reinstalling refreshes it, from `main` whatever ref it was installed from).
3. **Update this checkout**: `git pull --ff-only`, then `bun install --frozen-lockfile` when needed.
4. **Link `ep0ch`** in the first directory that is on PATH and writable, of `~/.local/bin`,
   `/opt/homebrew/bin` and `/usr/local/bin`, saying which. Never sudo. An `ep0ch` that already runs
   another door checkout is left alone.
5. **Restart per-folder services running old code**, only with `--restart-services` (they are working
   panes): each service's Herdr pane, once the Outliner's `resolveServicePaneId` confirms it is still
   that service's (never a pane id alone), is closed and the Outliner's own launcher starts it again
   (`herdr-open.ts --mode service-only`, from inside Herdr); reopen its Tree and Detail afterwards.
   After a plugin update the services are asked again.

A checkout that isn't on `main`, has diverged, or is behind with local changes is left for you, with
what to do. Install never writes a database (it only copies them), never creates or starts an outline,
never edits Herdr's config or Claude's settings, and never touches systemd or launchd units: the outline
host, its unit, the keys and the Claude mod are reported as notes. It stops at the first failure, with
the recovery. `--json` gives agents the same report or plan.

A door checkout from before `install` gets it by hand, once:

    cd ~/projects/ep0ch-door && git pull --ff-only && bun install
    bun src/main.ts doctor
    bun src/main.ts install              # read the plan
    bun src/main.ts install --apply      # then ep0ch is on PATH: ep0ch doctor

## Run

    bun install
    ln -s "$PWD/src/main.ts" ~/.local/bin/ep0ch    # once: the ep0ch command (or: ep0ch install --apply)

    ep0ch                           # default socket: ~/.local/state/pi-herdr-outliner/float-box.sock
    ep0ch /path/to/outliner.sock
    ep0ch --ws /path/to/workspace   # the socket of that workspace's service
    ep0ch --showcase | --desk | --layout <name> | --river | --brief | --welcome | --board [<hub-id>]

`ep0ch help` lists everything. Besides opening the door:

| Command | What it does |
|---|---|
| `ep0ch doctor`, `ep0ch install [--apply]` | the stack's state, and bringing it up to date (see [Install and update](#install-and-update)) |
| `ep0ch try …` | `scripts/try-it.sh`: the door on a private copy (`--copy`), or on the showcase outline (`--showcase`, `--reset`) |
| `ep0ch --skill [--all] [<name>]` | the stack's skills (this door's `skills/` and the installed Outliner plugin's, found through Herdr), or the path of one skill's `SKILL.md`; `--all` adds contributor skills |
| `ep0ch clients [--ws <root> \| <socket>]` | who's connected to the service: every role, observers and roles this door doesn't know yet |
| `ep0ch peek`, `actions`, `snap <png>`, `open <id>`, `act <action> key=value …` | drive a running door (see [Letting an agent see what you see](#letting-an-agent-see-what-you-see-and-do-what-you-do)); `EP0CH_CONTROL` names which door |

`bun src/main.ts …` still works the same way, and `ep0ch-door` is the same command.

| Env | Meaning |
|---|---|
| `EP0CH_SOCKET` | socket path (same as the argument) |
| `EP0CH_PACKS` | folder holding the `woe*.zip` packs (default `/opt/float/bbs/inbox/evan`) |
| `EP0CH_KITTY` | `1` / `0` forces graphics on or off |
| `EP0CH_LANDING` | `brief` opens the newest daily brief after the logon, `welcome` the welcome notes (default: the main menu) |
| `EP0CH_OBSERVE` | `0` skips registering as an observer (then the door is not in Who's Online and gets no live events) |
| `EP0CH_NOW_PAGE` | the page the welcome screen (C) shows while no note is tagged `welcome`, and the `daily` layout's "now" tile shows (default `claude-now`); `EP0CH_NOW_LABEL` names it |
| `EP0CH_DAILY_AGENT` | the command the `daily` layout's agent tile runs (default `claude`); `scripts/door-agent-herdr.ts` runs it inside Herdr (see [The daily agent in Herdr](#the-daily-agent-in-herdr)) |
| `EP0CH_HERDR_AGENT_CMD` | the agent that wrapper starts in its Herdr pane (default `door-claude` when it's on PATH, else `claude`) |
| `EP0CH_DAILY_DRAFT` | the file the `daily` layout's editor tile opens (default `scratch.md` in the door's state) |

## The desk

`D` on the menu, `bun src/main.ts --desk` to skip the logon, or `--layout daily` to open it laid out by name.
The door owns the whole canvas, and the canvas is **tiles** (PIE-413): views in one layout tree that you
split, tab, drag, link and save, drawn by the door itself, so no multiplexer is needed for layout.

| Tile | What it shows |
|---|---|
| outline (`tree`) | the tree; `←/→` fold, `⏎` opens (into its link, if it has one) |
| reader | the current note; follows the selection unless held (`p hold`, `p` again follows); `[ ]` elements, `⏎` act on one, `alt+⏎` or a ctrl-click opens a link beside, `u` parent, `( ) f F` fold |
| detail | a reader that keeps its note: it changes only by an open into it (its link, `open`, a click) |
| preview | a reader that follows a source: a tile's selection (`tile:tree`, `tile:board`) or a file (`file:~/draft.md`), re-read when it's saved. Read-only for a file |
| terminal (`pty`) | a program in a pty the door owns: nvim, claude, a shell. Click it or `⏎` to type in it; `ctrl+]` back to the door |
| backlinks | the backlinks of what another tile shows (`tile:detail`), grouped as Detail groups them: `j` `k` show one where the tile's selection goes (a preview following it), `⏎` or a click opens it, `alt+⏎` or a ctrl-click opens it fresh; `s K w h n .` and the status line change the view (`backlinks.pick`, `backlinks.view`) |
| board, river, brief | the whole screen in a tile, its own keys inside; the board's card can be followed by a preview tile |
| thread, activity, who, bulletin | as before: replies and comments, last callers, who's online, the ep0ch art |

| Keys (mouse) | Action |
|---|---|
| drag a tile's header | move it: onto a header or a tile's centre makes **tabs**; onto one of a tile's four triangles **splits** it that way; onto the window's outer left, right or bottom edge makes a **full-height column** or **full-width row**. The drop is outlined while you drag; `esc` lets go |
| click a tab; drag a tab | show it; move it out, or to another place among its tabs |
| drag a border | resize |
| `alt+l`, then click a tile | this tile's opens land there (a link followed, the tree's `⏎`); click the tile itself to unlink; `h j k l` or a number work too |
| ctrl-click or alt-click a link | open it beside, not in the link target |
| click a drawer's `▸ name` (hint row) | slide it open |

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab`, `1`–`9`, click | focus |
| `alt+n` / `alt+p` | next / previous tab |
| `alt+d` | load the `daily` layout |
| `alt+l` | link this tile's opens (then a click, `h j k l` or a number) |
| `Ctrl+W` then `h j k l` | focus by direction |
| `Ctrl+W` then `m` + `h j k l` | move beside the tile that way (none that way: to that edge) |
| `Ctrl+W` then `t` + `h j k l` | move into the tabs of the tile that way |
| `Ctrl+W` then `T` | take this tab out of its tab set |
| `Ctrl+W` then `H J K L` | move to that outer edge (a full-height column or full-width row) |
| `Ctrl+W` then `[ ]` | previous / next tab |
| `Ctrl+W` then `< > + -`, `=` | resize, even out |
| `Ctrl+W` then `z` / `x` / `s` | zoom, close, swap with next |
| `Ctrl+W` then `o` + a kind | open a tile beside: `t` outline, `r` reader, `d` detail, `p` preview of this tile, `e` editor (on the daily draft), `s` shell, `k` board, `v` river, `f` brief, `h` thread, `a` activity, `w` who, `b` bulletin, `l` backlinks of this tile |
| `Ctrl+W` then `O` + a kind | the same, as a tab of this tile |
| `Ctrl+W` then `v` | a preview of this tile: a terminal's file, the board's card, a tile's selection |
| `Ctrl+W` then `p` / `d` | pin or unpin (a drawer slides over the others without moving them) / slide drawers open or shut |
| `Ctrl+W` then `r` / `w` | load a layout by name / save this one by name |
| in a terminal tile: `ctrl+]` | back to the door's keys (every other key, `ctrl+c`, `^W`, F-keys, shift- and ctrl-arrows and pastes included, is the program's); `ctrl+]` twice sends a `ctrl+]` to the program |
| `ctrl+e` in a reader | edit the note in `$EDITOR` in a terminal tile beside it; the draft comes back when it exits |
| `/` | floating search with preview |
| `q` / `Esc` | back to the menu; programs running in tiles keep running, and `D` brings the same desk back |

**Layouts** are saved by name in `~/.local/state/ep0ch-door/layouts.json` (`^W w`, `act layout.save name=…`)
and loaded with `^W r`, `alt+d` for `daily`, or `act layout.load name=…`. Built in: `daily` (an agent
terminal over the "now" detail; the outline over its preview, above the middle detail; the editor on the
daily draft over a third detail; the outline, "now" and the right detail open into the middle), `river`
(the River screen in a tile, a preview following its card), `board` (the kanban with a preview tile
following its card) and `desk`. Loading keeps tiles with the same name (a running program, a reader's note);
a running program or an unsaved edit the new layout has no place for becomes a shut drawer, never ended.
`EP0CH_DAILY_AGENT` (default `claude`), `EP0CH_DAILY_CWD` (the folder it starts in; default the door's own) and
`EP0CH_DAILY_DRAFT` (default `scratch.md` in the door's state) set the daily layout's agent and draft; the editor is `$VISUAL`, `$EDITOR`, else nvim or vi.

**What happens to programs in tiles:**

| When | Programs in terminal tiles |
|---|---|
| `q`, `Esc`, going to the menu | keep running: the desk stays alive in the background, and `D` on the menu brings it back as it was |
| `^W x` on a running program's tile | asks first; again within 3s closes the tile and ends the program |
| the program exits while you're in its tile | the tile keeps your keys: `⏎` runs it again, `ctrl+]` goes back to the door, other keys wait |
| loading a layout | a tile with the same name keeps its program; one the layout has no place for becomes a shut drawer |
| quitting the door (`ctrl+c`, logging off from the menu) | asks twice (it names what's running), then ends them. nvim with unsaved changes keeps them in its swap file and offers to recover them next time; without, it leaves nothing behind |
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
  `EP0CH_CONTROL`, and the program's name in the layout as `EP0CH_TILE`. Otherwise it gets your environment
  (a shell in a tile is your shell), less the door's Herdr pane and tab and how the door was started
  (`EP0CH_DAILY_AGENT`, `EP0CH_LANDING`): one list, `tileEnv` in `src/desk/pty.ts`.
  - The agent's pane gets `EP0CH_TILE` and an `EP0CH_CONTROL` that is a link in the door's state
    (`agent-door-claude.sock`). The wrapper points the link at its door's socket each time it attaches.
  - So `ep0ch act …` and the Outliner's `show` from the agent reach the door that shows it now.
  - When the attach ends (`ctrl+b q`, or the door quits or crashes), the wrapper removes the link if it still
    points at its door. With no door attached, `show` finds no door and splits Claude's pane in Herdr.
  - The Outliner's `show` opens the note in the daily layout's middle detail, as an agent's `open`, which
    never moves your focus.
- **No Herdr.** If Herdr isn't installed, no server answers (or one doesn't answer within 10s), or Herdr can't
  make the pane, the tile runs the agent directly, as before, and says why when it isn't simply "no server".
- **Messages are unattributed.** `herdr agent prompt` types the text into the agent's prompt, and nothing
  says who sent it. An agent that messages `door` should say who it is and why ("from loki, on
  PIE-123: …"). The agent should treat an unsigned message as it would text typed by an unknown person.

The current layout is saved to `~/.local/state/ep0ch-door/desk.json`. Mouse reporting is on, so use your
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
  The edge you grab stays under the pointer. Keys: `{ }` lane height, `< >` width of the focused lane,
  reader or outline drawer.
- **One layout tree** (PIE-412): the board is laid out by the desk's tree (`src/desk/layout.ts`): the lanes
  pane over the readers row, the backlinks drawer under the readers, the outline drawer beside everything, floats
  over it all. `peek` shows it (`layout`), and agents change it with the `pane.*` actions (`pane.resize`,
  `pane.close`, `pane.float`, `pane.pin`), which never close or float the pane that has your keys.
- **`o`** pops the focused reader out as a floating pane: drag its title to move, drag `◢` to resize, `H J K L`
  to nudge, `o` again to dock it back as a detail, `x` to close.
- **`t`** outline drawer with its own mini preview underneath; slides over unless pinned (`T`, or click `[ ] pin` in its top border: pinned, it becomes part of the layout); `S` moves it
  to the other side so it doesn't cover the preview.
- **`b`** backlinks drawer spanning all readers, with its own preview of the selected source and the quoted
  snippet; `B` or a click on its `[ ] pin` pins it into the layout; ⏎ / alt+⏎ or a click opens a source in a detail. A link clicked in either drawer's
  preview opens in a detail too. It shows what Detail's Backlinks panel shows (PIE-442, the service's
  `references.backlinks.facets`): this note and its descendants hidden, resolved comments hidden, sources
  grouped by kind with stage counts (`+ Outbox item 10 (2 waiting · 1 draft · 7 done)`), open items first
  and then by date, one line each with a dim breadcrumb and `Work ID ×N`. A group starts folded to its open
  items. The status line keeps the counts adding up (`18 of 23 match · 3 this note hidden · 2 resolved
  hidden · Kind: all · Stage: all · Sort: Updated ↓`); click any of its controls, or use Detail's keys:
  `/` filter as you type (⏎ keeps it, esc undoes it), `s` sort (updated, created, title), `h` resolved,
  `n` this note, `.` or space folds a group (⏎ or a click on its header too). Detail's `k` and `t` are the
  board's up and outline drawer, so kind is **`K`** and stage is **`w`**. Against a service without facets
  it's one flat list, and the status line says nothing is grouped.
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
| `⏎` or a click on a `▐` | the thread inline, under its passage (below); again collapses it |
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

The **BBS message reader** (`N`, `R` and `J` on the main menu, `⏎` in a message list or Last callers) is
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
- **Which lines are metadata** is the service's call: `properties.preview` (PIE-401) says which tokens
  are block-scope metadata lines. Bare `key:: value` lines (line scope) and inline tokens stay in the body.
  An older service gets the documented rule (the first run of property-only lines after the subject).
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
  `references.resolve`, asked again only when a change record names one of those blocks. Against a
  service without `transclusions.read`, an embed shows its whole note once, not nested, and a fragment
  says the service can't slice it.
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
`all=true`), and leave the person's selection and scroll where they were. River columns show only a note's first lines, so they don't fold.

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
where it was. Instead an agent sets a **focus mark** with `focus.set` (`block=`, `line=`/`to=`, or
`quote=`/`near=`, the same passage shape as a comment): the marked lines get the ruler's tint, the header
says `◆ focus · an agent (<id>) marked …`, and the reader scrolls to it if it isn't in view. The person's
position, selection and keys don't move. `focus.clear` takes it away. The mark lives in this door's reader;
sharing it through the service, so other clients see it too, is PIE-423's service part. A river column
draws the note's body through the surface's renderer inside its own column (its header and replies are
the river's; no folds or comment marks there), so `[ ]` steps its links, embeds and steps, `⏎` or `alt+⏎`
opens a link or an embed beside or in a new column, and a step's box opens its status choice.

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
so unless a step is the current element in view; `ctrl+z` is bound nowhere else in the door; `x o w !`
and `y a` only mean this while the choice is open (it takes the keys first on the board, the desk, the
river and the BBS reader), and match the board's steps overlay (`x w !`) and the door's `y` for copy.

Agents use `tasks` (the steps the reader draws, in the note and in its embeds), `task.status` (`n=` or
`id=`, `to=done|todo|waiting|problem`), `task.undo` (its own last change) and `task.link`. An agent's
change is said in the status bar and the reader's header (`an agent (<id>) set "Sow the beans" to do →
waiting · in !((…))`) and never moves your `[ ]` position, scroll or selection; the status choice is
yours only.

### Selecting and copying text

The door keeps the terminal's mouse reporting on, so the terminal can't select; every reader does it
itself (PIE-419): the board's preview, details, floats and drawer previews, the desk's readers, and river
columns. Selecting never copies: only `y`, `Y` or the `[y copy]` control on the header's rule do, and the
status bar says `copied N chars`. The clipboard is written with OSC 52, so it works over SSH and
through a multiplexer that passes OSC 52 on.

| Keys | Action |
|---|---|
| drag | select from where the button went down; past the top or bottom edge the note scrolls a row at a time. A drag that starts on a link, a heading or a figure selects; it doesn't follow or fold |
| click | what it always did (follow a link, fold, pick a panel row), decided when the button comes up on the same cell; anywhere else it lets go of the selection |
| double / triple click | a word / the drawn row, without its indent (a click on a link or a fold marker acts instead) |
| `v` | the keyboard mode, from the first row in view (or taking over a mouse selection); `h j k l`, arrows, `PgUp PgDn`, `Home End` move its end; `v` or `esc` leaves |
| `y` | copy what's drawn: links as their titles, rows as they're drawn |
| `Y` | copy the source: exactly the selected words when they read the same in the note's text, else the whole source lines the selection covers (a link's `((…))`, `**bold**`) |
| `esc` | let go of the selection |

With text selected, `C` starts the comment's passage on it. An agent selects with `select` (`text=`, as
drawn, or `line=`/`to=`, 1 is the subject) and gets the text from `select.copy` (`source=true` for the
markup): its selection is its own, drawn in its own tint, and never replaces the person's or touches
their clipboard. A river column draws a digest of the note, so there `Y` says it can't map the source;
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
- **Focus is not the layout:** a click in a column, `h` `l` and `tab` give it the keys and nothing else moves. `w` (or a click on a column's header, its top border, or anywhere on a spine) widens it: the layout is built around that column, and the one you were reading stays full beside it when there's room. ⏎ and a followed link add the column after its source and shift only if the new one wouldn't show full; the source stays full. A click opens a card only in the column that already has the keys.
- **Compression (Andy's notes):** columns get full, peek or spine width by distance from the wide column; docked (`p`) columns resist. A peek draws its whole note at reading width, covered by its right-hand neighbour like a drawer (`▒` on the edge) and dimmed; only the far columns become spines. Spine titles are rotated VGA text (Kitty) or stacked letters (cells), drawn by the same spine part as the board's lanes and readers (`src/spine.ts`).
- **Threads (Twitter):** `space` expands replies in place under a rail; `s` splits a note into a stacked pane in the same column; `tab` moves between stacked panes.
- **Per-pane filters:** `f`, then `type:hub -status:done author:codex word`.
- **Virtual branches:** `#` lists the note's properties; pick one for a column of every note sharing it.
- **Jump:** `/` searches the whole outline index locally, with no round trip per keystroke.
- **The note surface:** every full-width column hosts the same note surface as the board's readers. `e` edits the column's note (`ctrl+e` in `$EDITOR`), `C` picks a passage to comment on, `m` lists its comment threads (reply, resolve), `[ ]` select a link and `⏎` follows it beside (a click on a link in the column's note does too, and its links read as titles), `u` opens the parent beside. Back and forward (alt+← alt+→, backspace, the mouse's side buttons, or the `← back` row under the title) go between the columns: to the one this was opened from, and back again. The column's note is the one it was opened on; in the Library and a `#tag` column it's the selected one. Reading looks as it did; the edit, the passage picker and the threads draw in the column. A column holding an edit resists compression, and a spine shows `✎` for it. Peek and spine columns are read-only views. Leaving the river (or a SIGTERM) with unsaved text copies it to disk first.
- **Agents:** `actions` lists the river's own (`open`, `focus`, `select`, `replies`, `split`, `pin`, `widen`, `close`) and every note action. `focus` moves only the person's keys; `widen` moves only the layout (and says so on screen).
  - `reader=` is a pane id (`r7`: stable while the pane is open, returned by `open` and `split`, listed by `peek` and `actions`), a column number (`2`, or `2.1` for a stacked pane), `focused`, or a block id. Replies carry both: `reader: "r7"`, `at: "3"`.
  - Column numbers shift as columns open and close. An agent's edit or comment carries on only in the pane holding it: addressed by a number that now names another pane, it's refused with the pane's id.
  - A block id prefers the pane holding the agent's own edit or comment on the note, then a full-width column opened on it, then any pane editing it, then a list selecting it.
  - An agent never moves the person's focus: `open`, `split`, `up` and `link.follow` open beside and leave the keys where they are (`focus` is the explicit handover).
  - Starting a note action in a compressed column is refused; `widen` or `pin` (dock) widens it without taking the keys. An edit or comment already open in a squeezed column still takes its actions.
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
| Message reader | a block on the note surface (links, properties, folds, comments, edit, selection), under a BBS header: author, date, `to::`, breadcrumb; `T` its children, `U` its parent |
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
    bun src/main.ts open <block-id>   # put a block in front of the user (board: the detail; desk: the reader; river: a column)
    bun src/main.ts subscribe [types] # the live feed: focus.changed, viewport, cursor, layout.changed, marks.changed, one JSON event per line
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
| `brief.step`, `brief.newest`, `brief.date` | `by=-1\|1`; `date=YYYY-MM-DD` (the daily brief) | `,` `.` |
| `welcome.select`, `welcome.read`, `welcome.logo`, `welcome.reload` | `n=<place>` (1-10 are the tabs' `1`-`9` `0`) or `id=`; `read=true` gives the detail your keys (never an agent's); `id=` any note for `read`; `by=-1\|1` (the welcome screen) | `1`-`9` `0`, tabs, the list; `alt+⏎`, ctrl-click; `L` |
| `backlinks.pick`, `backlinks.view` | `reader=<backlinks tile>`; `n=` (as peek's rows) or `id=`, `open=true`, `fresh=true`; `kind stage resolved related sort` as `backlinks` takes them (a backlinks tile: the welcome's, or `^W o l`) | `j k`, `⏎`, `alt+⏎`, clicks; `s K w h n` |
| `focus` | `reader=<reader>` or `reader=lanes` | `Tab`, click |
| `card.select`, `card.move` | `id`; `lane`, `card` (default the selected card; an agent's own `card.select` first) | `j k`, `H L`, `m`, drag |
| `card.create` | `lane`, `text`, `parent` (default the lane's) | `n`, typing, `Ctrl+S` |
| `note.create` | `text`, `parent` (default the selected card) | `N`, typing, `Ctrl+S` |
| `steps`, `step.set` | `card` (default the selected card); `step` (number from 1, or `^id`), `status=todo\|done\|waiting\|problem` (default toggles done) | `s`, `j k`, `space x w !` |
| `card.trash`, `card.restore` | `confirm=<the card's id>` (the second `d`), `card`; `id` (default the card trashed last) | `d d`, `u` |
| `reader.collapse`, `reader.expand` | `reader=preview\|detail1\|detail2` (the focused one by default); `reader=all` expands everything (board) | `c`, `⏎` or a click on a spine, `alt+c` |
| `pane.resize` | `reader=<pane>` (`lanes`, a reader, `tree`, `backlinks`, a float; default the focused one), `by` (steps, `-20`…`20`), `axis=row\|col` (width, default; or height) | board `{ } < >`, desk `^W < > + -`, dragging a border |
| `pane.close`, `pane.float`, `pane.pin` | `reader=<pane>`; `on=true\|false` for `pin` (default toggles). `close` takes a detail, a float or a drawer, `float` pops a reader out or docks a float, `pin` is for `tree` and `backlinks`. An agent can't close or float the pane that has your keys | board `x`, `esc`, `o`, `T`, `B`; desk `^W x` |
| `pane.split`, `pane.zoom` | `kind=reader\|tree\|thread\|activity\|who\|art`, `dir=row\|col`; `on=true\|false`. Desk only for now: the board's details open with a note (`open reader=new-detail`) and it has no zoom yet (PIE-428). An agent zooms only the pane that has your keys | desk `^W o`, `^W z` |
| `backlinks` | `id` (default the drawer's note), `filter`, `kind` (key or label, or `all`), `stage` (`all open waiting draft active done`), `resolved`, `related`, `sort` (`updated`, `created`, `title`, optionally `-asc`/`-desc`). Answers the view: status line, groups, rows. An agent's reads the person's view with its own options on top and changes nothing of theirs; yours (`as=you`) sets the drawer | `b`, `/ s K w h n .`, clicks |
| `edit`, `edit.text`, `edit.save`, `edit.reload`, `edit.close` | `text`; `discard=true` | `e`, typing or `$EDITOR`, `Ctrl+S`, `Ctrl+R`, `Esc` |
| `complete` | `text` ending in the token (`[[HOME-4`, `((beds`, `((plan#`, `[file::notes/`), or none for the draft's cursor; `insert=n` puts the nth into the draft | `[[ (( [file::`, `Tab`, `Ctrl+Space`, `↑↓`, `Enter` |
| `passage.select`, `comment.write`, `comment.send`, `comment.close` | `quote` (exact words), `near`; `body` | `C`, `j k J K h l H L`, `Enter`, `Ctrl+S`, `Esc` |
| `comment` | `quote`, `body` (select, write and send in one) | |
| `threads`, `reply`, `resolve` | `thread` (id or 6+ chars), `body`; `open=true` reopens | `m`, `r`, `x`; the Reply and Resolve controls |
| `thread.toggle` | `thread`, `expand=true\|false` (default toggles). The person's only | `Enter` or a click on a comment mark |
| `link.select`, `link.follow`, `up` | `n` (from 1) | `[ ]`, `Enter` or a click, `u` |
| `elements`, `element.select`, `element.open` | `n` (from `elements`); `fresh=true` opens a link, row or embed in a new reader. `element.select` is the person's only | `[ ]`, `Enter`, `alt+Enter`, a click |
| `focus.set`, `focus.clear` | one of `block` (this note, or one it embeds or links), `line` and `to` (1 is the subject), `quote` and `near` | `esc` clears it |
| `tasks` | none: the checklist steps the reader draws, in the note and inside its embeds (`n`, `id`, the note each is in, status) | `[ ]` |
| `task.status` | `n` (from `tasks`) or `id` (`t-8a6d7f`, `^t-8a6d7f`, `<note>^t-8a6d7f`; `block=` narrows it), `to=done\|todo\|waiting\|problem` | `⏎` or a click on a box, then `x o w !`; `space` |
| `task.undo` | none: the asker's own last step change in this reader, while reading this note | `ctrl+z` |
| `task.link`, `task.menu` | `n` or `id`. `task.link` gives the step an id if it has none and answers `((note^id))` (yours goes to your clipboard); `task.menu` opens the status choice and is the person's only | the choice's `y`; `⏎` on a box |
| `props` | `full=true` | `i`, `I` |
| `props.copy`, `props.follow` | `n` (from `props`) or `key` | `Tab`, `y`, `o` |
| `props.edit` | `n` or `key`, `value`, `revision` (refused if the note is past it) | `Enter`/`e`, typing, `Enter` |
| `props.close`, `props.summary` | `keys=a,b` (yours), `toggle=key`, `reset=true` | `Esc`, `s` |
| `folds`, `fold`, `unfold`, `fold.toggle` | `text` (a heading's or item's words, `##` optional, a unique start is enough), `line` (of the note, 1 is the subject), `n` (from `folds`); `all=true` | `( )`, `f`, `⏎`, `F`, click |
| `select`, `select.copy`, `select.clear` | `text` (as drawn; `n` for the nth), or `line` and `to` (1 is the subject); `source=true` | drag, double/triple click, `v`, `y`, `Y`, `esc` |

Readers are named `preview`, `detail1`, `detail2`, `float1`…, `tree`, `backlinks` on the board, by pane
number on the desk, and `message` in the BBS message reader (which adds `message.next`, `message.previous`
and `message.thread`); `reader=focused`, or a block id (the reader showing it) work too, and no reader means
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
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts showcase  # its own scratch service, seeded like the showcase: every section, a board spine, an edit with completion, a click, an agent
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts fold      # its own scratch service: fold by keys, a click and F, an edit elsewhere keeps folds, an agent unfolds, the desk
    EP0CH_OUTLINER=<checkout> bun scripts/snap.ts steps     # its own scratch service: nested and anchored embeds, a cycle, a step's status choice, an agent's change
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
- Nested embeds each keep their title row and gutter; PIE-185's flat composition (no chrome per level)
  and a configurable depth aren't here. Detail itself doesn't nest embeds yet (PIE-185); the door takes
  the service's depth.
- Relation-view and checklist-view targets embed as ordinary notes, not as Detail's projections; an
  embedded view's result rows aren't followable (follow the `!((…))` link itself); `!((…))` inside a
  callout or a table stays a link.
- A reconnect that missed more than 500 changes reloads everything rather than paging the feed.

- The forwarded socket moves about 150 KB/s; 400 full blocks take roughly 8 s. Lists show 40 first and stream the rest.
- The editor counts one cell per character, so wide (CJK, some emoji) characters misplace the cursor.
- The Herdr capability check reads a config file; a lasting version should ask Herdr.
