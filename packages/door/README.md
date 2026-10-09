# ep0ch: the door

`packages/door`: a BBS door into an outline the outline host (`packages/outliner`) serves. It reads everything,
edits notes in place, moves cards between board lanes, and comments on them. It talks straight to the host's Unix
socket, on the one protocol both share (`PROTOCOL` in outline-core), and imports the outliner only through its
declared exports (`test/package-boundary.test.ts`).

The screens are ep0ch's own 1997 art by shypht, read in place from the WOE art packs:
the logon (`SHY-LOGI.ANS`), the main menu (`SHY-EMNU.ANS`, whose twelve "Menu Cmd"
slots now hold live commands), and the bulletin (`SHY-EPO!.ANS`).

**Getting around.** The menu's letters (or a click on an item) open its screens over it. `q` is back on every
screen. `Esc` closes what popped up, the innermost first (a picker or the tile menu, the keys box, a `^W` chord, link
mode, a filter, an empty edit, the drawer, a selection, a zoom, a dock, a float's keys), and never leaves a
screen: with nothing left it stays and says `nothing to close · q leaves`. The menu is the top, with nothing under
it: there `q` is the Quay, as it always was, and `Esc` says `G` logs off.
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
structure in the door and the outliner, its ladder position and its open questions. Each citation is a file, a
marker (a snippet of the cited code) and a line: in packages/door, `bun scripts/architecture-map.ts --sync` moves
every line to where its marker is now and stamps the commit (it lists the markers the code no longer has, for a
person to rewrite), then `bun scripts/architecture-map.ts` checks the citations against both checkouts and draws
the isometric map as one page, `out/architecture-map.html` (open it in a browser; `#ch13` shows every part).
`test/architecture-map.test.ts` fails only when a cited file or marker is gone; the line-exact `--check` is the push-review round's, so one PR's line shifts don't fail another.

## Getting started

One walk through the door, in the order you meet things. Each step has its own section below.

1. **Land in it.** On a machine set up like float-2, an interactive ssh login (outside Herdr and tmux) runs
   `ep0ch` from `~/.bashrc` with `EP0CH_IN_DOOR=1`, and `EP0CH_LANDING=welcome` puts you on
   [Welcome](#welcome) after the logon's `⏎`: the notes tagged `[welcome::true]`, the first one read. Quitting
   the door leaves you at that shell; `ssh -t <host> EP0CH_NO_DOOR=1 bash -l` skips the door once.
   Anywhere else, `ep0ch` opens the outline the folder's `.ep0ch` names, and `ep0ch --ws <name>` opens one by
   name; where nothing names one, the [home base](#the-home-base) lists this machine's outlines and the
   machines you've used (open, new, import). `--machine <ssh-name>` opens an outline on another machine, and
   `--remote <ssh-name>` attaches this terminal to the door running there
   ([Outlines on the outline host](#outlines-on-the-outline-host)). `ep0ch --showcase` opens every shared part
   on a seeded outline of made-up notes, to look around without touching yours ([The showcase](#the-showcase)).
2. **Get around.** The menu's letters or a click open its screens: `D` the desk, `K` the kanban, `Q` the Quay
   (the river), `T` today's brief, `C` Welcome, `X` the showcase, `M` a blank screen to make your own. `q` goes back on every screen below the
   menu; only `G` logs off.
3. **The desk.** `D`, then `alt+d` loads the `daily` layout: the agent's terminal, the outline, the "now" page,
   an editor and details. Drag a tile's header to move it (onto another header it becomes a tab), `^W o` and a
   kind opens a tile, `^W p` docks one to an edge (anything dropped on its handle joins it), `alt+k` locks the
   shape for a task, `^W w` saves the screen by name as a screen note in the outline, `^W r` lays it out as one
   ([The desk](#the-desk)). `M` on the menu starts a blank screen to build from ([Screens you make](#screens-you-make)).
4. **Your drawer.** `alt+a` or a click on the status bar's `▲ claude` chip pulls your drawer up over any screen, with
   your keys in it: its own program (your `EP0CH_DAILY_AGENT`, else a shell) and any tile you put in. `^W a` puts
   the tile you're on in it (a terminal with a Claude in it, a reader, the tree) and it travels with you across screens,
   still running; `^W a` in the drawer takes it out. A screen you leave with a terminal running puts it there too. `ctrl+]` gives the keys back; `alt+a` again, or `Esc` once
   you're out, puts it away ([The drawer](#the-drawer-pie-498)).
5. **Easy on the eyes.** The door opens in the **calm** theme: dark, soft accents, every word at 4.5:1 or
   more. `alt+t` (or a click on its name on the status bar) steps to **night**, dimmer, and **classic**, the
   bright VGA palette; `alt+v` steps the video mode (the CRT glow is Kitty+CRT). Both work on every screen
   ([Themes and accessibility](#themes-and-accessibility)).
7. **Drop to shell.** `!` on the menu, or `^W !` on the desk: your login shell in this terminal, and `exit`
   brings the door back where it was ([Getting around](#ep0ch-the-door), above).
8. **Links anywhere.** `b` in any reader shows its note's outlinks, resources and backlinks in the screen's
   links tile (one opens below the reader, with a preview beside it, where the screen has none); moving onto a
   resource previews what the service stores for it, and `⏎` opens it. In an outline tile `L` shows them under a
   row, in a river column they sit under its replies, and a note can list them inline: `::links`, `::resources`,
   `::backlinks` ([The desk](#the-desk)). The mouse matches the keys: a click selects and previews, a double click
   is `⏎`, an alt-, ctrl- or middle-click is `alt+⏎`, and a click that gives a tile the keys only selects.
9. **Write.** `e` in any reader edits the note. `Enter` continues a list, `Tab` and `Shift+Tab` nest and
   outdent, `Ctrl+P` previews, `Ctrl+S` saves (the first press says which properties would change). `Esc`
   twice puts unsaved text aside as **unsent**; `e` on the same note brings it back. `[[` completes
   pages and `((` notes with the service's forgiving search (a typo or two, any order), nearer the note you're writing
   first, Jev re-ordering after a pause where the host has a key, and `Ctrl+T`
   (or a click on `[insert]`) opens television's `ep0ch` channel in a tile beside the draft (the whole terminal on the board): pick notes (Tab for
   several) and their `((id))`s go in at the cursor ([Editing notes](#editing-notes)).
9. **On a Mac,** set the terminal to send Option as Alt (Ghostty `macos-option-as-alt = true`, kitty
   `macos_option_as_alt left`). Without it, where you aren't typing text, the door reads `å` as `alt+a`, `¬`
   as `alt+l` and so on, and says once which setting to change ([The drawer](#the-drawer-pie-498)).
10. **Keep the stack current.** `ep0ch doctor` checks every piece; `ep0ch install` shows the plan and
   `--apply` runs it ([Install and update](#install-and-update)). `ep0ch outline list` names the host's
   outlines, `ep0ch find <words>` (or `--query "type=chore updated >= -7d"`) and `ep0ch show <id>` search and draw
   notes at your shell, `ep0ch export` writes them out as Markdown or JSON (`tv ep0ch`, once
   install has linked its channel, does both in television), and from a program in a tile `ep0ch where` says
   which door, tile and keys it's in ([where am I](docs/AGENT-INTERFACE.md#where-am-i-ep0ch_nest-and-ep0ch-where)).

## Outlines on the outline host

The outliner's outline host serves every outline on the machine by name: `<name>.sqlite` in `~/outlines`
(`EP0CH_OUTLINES`), each with its own folder `<name>/` beside it, on one socket (`~/outlines/.host/host.sock`).
The door opens outlines like Herdr sessions (PIE-530):

    ep0ch --ws jam-shelf              that outline, from anywhere; created if nobody has it yet ("created outline jam-shelf")
    ep0ch --machine float-2 --ws pie  that outline on another machine (an ssh config name), through a forward; one
                                      that machine doesn't have is never made there: the home base offers the choices
                                      (--create makes it there on purpose)
    ep0ch --remote float-2            this terminal on the door session running on that machine
    ep0ch                             the outline this folder names: EP0CH_WS, else the nearest .ep0ch from here up
    ep0ch init [<name>]               name this folder's outline: write .ep0ch (ws = "<name>"), creating the outline;
                                      without a name, the folder's (or its git repository's)
    ep0ch outline list | attach <name> [--create] | create <name> | import <database.sqlite> <name>
                | stop <name> | delete <name> [--yes]     (each with --json)
    ep0ch status                      the host's socket, its outlines folder and the open outlines

The rule is outline-core's `whichOutline`, the one every client applies (the outliner's Herdr panes, its CLI,
the Claude mod): `--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`. Nothing else names an outline. In a folder
that names none, `ep0ch` opens the [home base](#the-home-base) first. Without a terminal it says what to run
instead (`ep0ch init`, `--ws`, `ep0ch outline import`: the same choices for scripts and agents). Every request and the subscription
name the outline. The status bar and `peek` show `host · outline`. Only opening the door (or `init`) creates an
outline; the listings and `clients` never do (`src/discover.ts`, `resolveTarget`; `src/outlines.ts`).

### The home base

Bare `ep0ch` where nothing names an outline opens the home base: a screen like any other (a spec on the desk,
`src/home.ts`), the ep0ch logo over one list.

- **This machine**: its host's outlines, then `+ new outline…` (the folder's or repository's name offered) and
  `↧ import a database…` (a new outline holding an older database's notes, properties, pages and work ids; the
  file is only read).
- **Other machines**: the ones opened from here (`machines.json` in the state dir), each with its outlines once its
  forward is up (⏎ on a machine connects; nothing is started by just looking), and `+ add a machine…`, which lists
  the `Host` names in `~/.ssh/config` (and the files it includes) not added yet; a name typed that isn't there is
  offered too. `x` takes a machine off the list.
- **Choosing an outline** opens the door on it. Started in a folder that can be named (not `$HOME`, `/` or one
  right under `/`), the home base offers to write its `.ep0ch` (`ws`, and `machine` for one on another machine), so
  the next `ep0ch` there opens it directly, or to open it this time only.
- **An outline the machine doesn't have** (PIE-545): `--machine box-a --ws fern` (or `--remote box-a --ws fern`, or a
  `.ep0ch` naming box-a) where box-a has no fern makes nothing there. The home base opens saying so ("box-a has no
  outline fern · nothing was created there"), with the ways on first: open the one on this machine (when it has one;
  the cursor starts there, else on cancel), create it on box-a, or cancel. Without a terminal it is an error with
  the same choices as commands (`ep0ch --here --ws fern`, `ep0ch --machine box-a --ws fern --create`). `--here`
  says this machine outright, over `EP0CH_MACHINE` and a `.ep0ch` that puts fern on box-a; it is how the home
  base's "open the one on this machine" opens it. The rule and the refusal are outline-core's (`mayCreate`,
  `missingOutline` in `outline-location.ts`), the same for Tree and Detail and the outliner's `init`. On this machine a
  name nobody has yet is still created, as `herdr --session` does.

| Key | Mouse | `act` |
|---|---|---|
| `j` `k` `↑` `↓`, the wheel | | `home.pick n=` |
| `⏎` on an outline | a click on it | `home.open outline= [machine=] [write=true]` (an agent's writes `.ep0ch` only with `write=true`) |
| `⏎` on a machine | a click on it | `home.connect machine=` |
| `n` (on a machine's rows: on that machine) | a click on `+ new outline…` | `home.new name= [machine=]` |
| `i` | a click on `↧ import a database…` | `home.import path= name=` |
| `a` | a click on `+ add a machine…` | `home.add machine=` |
| `x` on a machine | | `home.forget machine=` |
| `r` | | `home.reload` |
| `⏎` on an offer (an outline the machine lacks) | a click on it | `home.open outline=` (the one here), `home.new name= machine=` (create it there), `home.cancel` |
| `q` | the hint row's `q` | quits: nothing is opened |
| `esc` | | closes a picker over it; with none, stays (`nothing to close · q leaves`) |

What a choice needs typed or picked (a name, a file, a machine, whether to write `.ep0ch`) is a list picker over
the screen; ⏎ or a click on its row does it, `esc` closes it. The home base runs before any door session, and
bare `ep0ch` in a folder that names no outline opens it even when exactly one session runs: which outline is never a
silent guess (the root `AGENTS.md`, "Outlines by name"). The outlines with a running session are marked there, and
choosing one attaches to it; `ep0ch session attach` names the only running session outright. Opened by name on a door that is on an outline, it shows what it
shows but makes, connects and opens nothing.

### Outlines on other machines

A machine is an ssh config name: a `Host` in `~/.ssh/config` (`float-2`, `laptop`). ssh owns its keys, hops and
address; the door keeps no list of machines of its own.

- **`--machine <ssh-name>`**: the door here, the outline there. Which machine, first match wins: `--machine`,
  `EP0CH_MACHINE`, then the `machine` of the nearest `.ep0ch` when it names the same outline (`--ws jam-shelf` in a
  folder whose `.ep0ch` puts jam-shelf on box-a is box-a's; another name there is this machine's). A `.ep0ch` for a
  folder whose outline lives on another machine:

      ws = "pie"
      machine = "float-2"

  The door asks the machine where its outline host listens (`ep0ch status --json` there, in a login shell), then
  forwards that socket to `~/outlines/.remote/<ssh-name>.sock` (folder mode 0700) with one ssh connection
  (`-M`, ControlPersist, ExitOnForwardFailure, StreamLocalBindUnlink, ServerAlive). That connection outlives the
  door, so a second door, Tree and Detail, and the CLI share it. When it drops (the network went), the door starts
  it again as its connection comes back, and the status bar says so ("reconnected · started the forward to
  float-2 · caught up 3 changes"). ssh must log in without asking (a key or an agent: `ssh float-2 true`).
  `ep0ch outline list|create|…` and `ep0ch init` go to the machine by the same rule (`--machine`, `EP0CH_MACHINE`,
  the folder's `.ep0ch`; init writes the `machine` line); `ep0ch status` is this machine's host unless `--machine`
  names another. Nothing makes an outline on another machine without being told to: the door, `outline attach` and
  `init` refuse one the machine doesn't have, with the commands, unless `--create` is given (`outline create` and
  the home base's `+ new outline on <machine>…` are the other ways); Tree and Detail on a `.ep0ch` naming another
  machine refuse it too. A session's daemon has no ssh agent of its own: `ep0ch` starts the forward from the terminal before
  it starts or attaches to one, and a forward that drops while nobody's terminal can start it says so on the status
  bar. `ep0ch doctor` shows each machine's forward.
- **`--remote <ssh-name> [door flags]`**: this terminal attached to the door session running on that machine,
  as `herdr --remote` does: `ssh -t <ssh-name> ep0ch [door flags]` in a login shell there, with `TERM`,
  `COLORTERM`, `EP0CH_KITTY`, `TERM_PROGRAM` and `LANG` carried over. The door runs there, so the drop shell and
  `$EDITOR` on a `ctrl+e` file run there too, on its files. The outline this folder names on that machine (its
  `.ep0ch` says that machine) goes as `--ws` when no `--ws` is given.
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

    ep0ch --showcase
    ep0ch --showcase --reset

opens the showcase (PIE-439): the shared door parts, live, one section per row of the reuse map
([Before adding a feature](docs/UI-GRAMMAR.md#before-adding-a-feature)) in the map's order. The map's
key-names row, its list-picker and line-input rows (in the panes section's ^W P and ^W r,
the board's g m s), its elements and reading-ruler row (PIE-441) and its terminal-output row (PIE-510: cells, escapes,
CP437; the key names and the terminal output are under every section) have no section yet, and its ids-not-names row
(ADR 0001) is a rule for code, with nothing to show. The newest parts are in their rows' sections:
a refused key said on the focused tile's frame, loud when pressed again (PIE-727), in `refusals`, the service's forgiving search (the `/` overlay, opened on a query with typos) in `search`, the drawer in `drawer` (`^W a` puts its kettle in your drawer, another section keeps it, the same program; `alt+a` pulls the drawer up over the showcase itself), the terminals attached to the door session in `session`, a row's links in the tree
(`L`) in `entity`, a comment on a file's text (a Resource, PIE-650: C on a selection, the file never written) in `resource-comments`, a dock and the lock (`alt+k`) in `panes`, the draft session (an edit and a comment open side by side) in `drafts`, a screen spec (the brief, its spec read back by `screen.spec`) in `screens`, the tile-kind registry listed by a service-drawn tile in `kinds`, quiet embeds (a dim `»` source line) in `note`, one addressed note as the whole screen (the detail screen spec, `--screen detail <uri>`) in `detail`, the outliner's example extensions (a record, an output, a component with its `[w ward]`, an `@tidy` request) beside what the service's list bound, in `extensions`, Obsidian's callout examples (nested three deep, folded and open, title-only, a type the outline declares) in `callouts`, a note's opening picture becoming its header's background as it scrolls away in `hero`, a note's title leading its header (breadcrumb above, bold title, one dim line, double height through text sizing, the focused tile's brighter) in `title`, the Markdown figures (a decision, a chat, a keymap read from the action registry, uptime, activity, a month, annotated code, a figure block whose rows are its child bullets, a quote's byline) in `figures`, new notes from anywhere (`ctrl+n`, a missing `[[page]]` offered then made, a lone `[page::x]` titling itself) in `newnotes`, scrolling past the end of a long note (End twice, `reader.overscroll`) in `scroll`, heading styles (every pattern on a plain `##`, a rule that fades, one heading's own fields, a style declared on a line of the note, banded in a wide reader and as written in a narrow one) in `headings`, the component library (a page per component schema, the outline's own style among its values) in `library`, the power bar (`ctrl+k`: the stage's tiles as their tree, one folded to a spine, then what changed; a scope a prefix away) in `bar`, and the `^W` keys (a grouped keys box, `^W ?` opening the whole list on the bar to filter and press) in `wkeys`. It runs on an
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
  or a click in it hands the part your keys and mouse; `Esc` closes what's open in the part, one thing at a time, and
  with nothing left there hands your keys back to the list (`section.leave`; the `esc` section shows the rule). Each
  section names the part and its files and is drawn by the part itself, on a desk of its own spec (the layout
  tree, nothing saved to your `desk.json`) or the real board. A parallel version still in the code that
  can't be framed alone is named on the section's third line.
- **Reaching it:** `ep0ch --showcase` (or `ep0ch try --showcase`, `scripts/try-it.sh --showcase`) opens it on its
  own seeded outline, whatever this folder names. `X` on the main menu (its key line; the menu art has twelve
  slots) opens the screen on the outline you're on: on one without the seed it says so and writes nothing.
- **Agents:** `ep0ch act section name=<n|key>` shows a section (by its key, or its number in the list) (your keys go back to the list);
  every other action is the section's own (a reader's note actions, the desk's, the board's).
  `EP0CH_CONTROL=<showcase>/door/door.sock` reaches this door, and only it.

Adding a shared part means adding its section (`SECTIONS` in `src/showcase/showcase.ts`) and the seed
content it needs; the review checklist's "The map" item covers both.

## The daily brief

The morning note (PIE-435): what happened yesterday, what today needs. It is one outline note per day with
`[type::daily-brief]` and `[brief-date::YYYY-MM-DD]`. An agent drafts its prose each morning
([skills/daily-brief/SKILL.md](skills/daily-brief/SKILL.md), or `ep0ch --skill daily-brief`); its figures and
embeds are live.

- **Reaching it:** `T` (today) on the main menu, on its key line like the showcase, or `ep0ch --screen brief`.
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
- The showcase outline has two made-up briefs, so `ep0ch --showcase` then `T` shows one.

## Welcome

The notes you want to land on, one at a time: every note with a block-scoped `welcome` property (`[welcome::true]`;
any value only marks it). Their order is the hand-set order of the **Welcome view**, a saved view `[query::welcome]`
(the same order a board lane keeps, #190): `alt+↑` `alt+↓` in the list, or a drag of a note up or down it
(`welcome.move`), `ep0ch view order <view> <id>…`, or a board lane on that view. The first is read when the screen
opens. The first move makes the Welcome view if the outline has none (said on the status bar); until then, and for
notes the order hasn't placed yet, they come by title. The service finds them (`blocks.query`, filter `welcome`)
and keeps the order (`virtual.occurrences.order`); the door only reads both.

- **Reaching it:** `C` on the main menu, `ep0ch --screen welcome`, or `EP0CH_LANDING=welcome` to land there right
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
  the status line's controls change the view as on the board's dock.
- **Numbers are gone:** a number in `[welcome::…]` is no longer a place. Outlines that used them run the one-off
  `bun packages/door/scripts/welcome-order.ts --ws <name>` (a dry run; `--apply` writes): it sets the Welcome view's
  order from the numbers and rewrites the values to `true`.
- **No welcome notes:** the list says how to tag one, and the detail shows the `[[claude-now]]` page meanwhile
  (the page `C` used to pin).
- **Live:** tagging, untagging or editing a note anywhere updates the tabs and the list; the detail and the
  backlinks refresh as the outline changes.
- **Agents:** `welcome.select n=<place>|id=<id>`, `welcome.read id=<id>` (put any note in the detail),
  `welcome.move [id=<id>] by=<±n>|to=<place>` (the hand-set order, recorded as the agent),
  `welcome.logo`, `welcome.reload`, `backlinks.pick n=|id= [open=true] [fresh=true]`, `backlinks.open n=|id= [where=origin|new]`, `backlinks.view`, `backlinks.groups show=|toggle=`, and the
  desk's and the reader's actions. None of them moves your keys; the picks are refused while you're typing here,
  and the status bar says which agent did what. `open <id>` shows the note in the preview.

## Install and update

The stack is Bun, Herdr, one checkout of the ep0ch repo (packages/outliner is the Herdr plugin and the outline
host, packages/door is `ep0ch`, the Claude mod is in it too), the outline host serving every
`~/outlines/<name>.sqlite` by name (PIE-530; `EP0CH_OUTLINES` names another folder), and the `ep0ch` command. Two
commands look after it, on macOS and Linux alike:

    ep0ch doctor [--json]            every piece and its state, with the command that fixes it (read-only)
    ep0ch doctor --backups           also restores each replica's newest snapshot into a temp folder and checks it
    ep0ch install                    the plan: what would change, step by step (a dry run; nothing changes)
    ep0ch install --apply            run it

Its `backups` group reads each Litestream unit (`litestream replicate`, and float-2's mirror followers,
`litestream restore -f`): ✓ while it runs (pid, up since), ✗ for ERROR lines its log has had in the last hour since
it started (a lost file of its local state gets the fresh-start commands: its state moved aside and the replica's old
history deleted, since Litestream 0.5 keeps no generations), and per outline how far the replica trails the
database: ✗ "stale since" once a write has waited more than 10 minutes, and ✗ when the replica holds a later txid than
the database (its state was reset under it, so a restore would bring back the old copy). A mirror is compared with
the replica it follows the same way, and the remote MCP gateway's `list_outlines` and reads say `stale` (since when)
for it. The replica is listed with `litestream ltx`, run the way the unit runs Litestream (its `with-secrets` or
EnvironmentFile), so the keys reach only that process and are never printed.

**The restic backups (PIE-607)** replace Litestream where a machine isn't always online, and back up the rest twice.
`ep0ch install --apply` writes the job's units from `scripts/backup/` (`ep0ch-backup.timer` on Linux, the launchd
agent `io.ep0ch.backup` on macOS) and `~/.config/ep0ch/backup.env` naming the machine, and loads them; every 15
minutes `ep0ch backup run` snapshots each outline whose change feed moved (VACUUM INTO, integrity-checked, `restic
backup --stdin` into `s3:…/ep0ch/restic/<machine>`; an unchanged outline isn't snapshotted, and each run stands alone,
so an offline night leaves nothing to repair), refreshes the mirrors of other machines' outlines from their newest
snapshots (`EP0CH_BACKUP_MIRRORS`), restores every outline's newest snapshot into a temp folder once a month (the
drill), and checks freshness: changes waiting more than 2 hours are an incident, marked `✗ backup` on the door's status
bar until they clear (a click, or `backups.alert`, says what and the command that fixes it), announced once through
`herdr notification` and ntfy (a secrets group `ntfy` with `NTFY_URL`), and listed by doctor with each outline's newest
snapshot. `ep0ch backup status`, `list <outline>` and `restore <outline> [--machine <m>] [--at <time>] --to <path>`
read them back. [scripts/backup/README.md](../../scripts/backup/README.md) has the settings, the setup on each
machine and the retirement of the Litestream units.

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
  `OUTLINER_DEFAULT_OUTLINE`) with the exact change; an outline whose schema is behind (or ahead of) what the
  checkout's code opens, with install as the fix or why it can't; and which outline this folder opens (its `.ep0ch`), or the
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
5. **Migrate the outlines** when the code the checkout ends on opens a newer schema than an outline is at (PIE-617).
   Before the update, install reads that commit's `SCHEMA_VERSION` and migration scripts (`git show`) and each
   outline's `user_version`, and the plan says it: "schema 3 → 4: will migrate 2 outlines (pie, pie-hole) with
   0004-block-revisions.ts". Applying, it stops the host through its unit (`systemctl --user stop`, `launchctl
   bootout`), copies each outline behind it again (exact, with nothing serving it, beside the backup as
   `<name>.schema-<N-1>.sqlite`) and runs the step's script on it (one transaction; the script refuses a served
   file), and the next step starts the host. One step only (N-1 → N, the script for N): an outline older than that, or
   a step whose script was deleted, is imported instead, and install doesn't update the checkout until it's moved
   aside, saying the commands. So does a host it can't stop (outside a unit, or another process at its socket). When a
   migration fails it stops there, naming the outline, its copy and the way back (each command only after the one before it worked), and leaves the
   host stopped: started on the new code it would serve only the outlines already migrated, and on the code before
   it would need the checkout moved back and those outlines restored, which install never does by itself. Fix it and
   run `ep0ch install --apply` again: it migrates what's left and starts the host (an outline that still can't take
   the step keeps the host stopped). An outline behind the checkout's
   own schema (a run that failed) is migrated the same way without an update; doctor flags it.
6. **Restart the outline host** after the checkout updated in the same run, or when it speaks another protocol:
   through its unit, `launchctl kickstart -k gui/<uid>/<label>` on macOS (`io.ep0ch.outliner-host`) or
   `systemctl --user restart <unit>` on Linux, then waits for a new process to answer and checks it speaks the
   checkout's protocol. The doors and panes on it reconnect by themselves. A host that's set up but not answering
   is started the same way (`launchctl bootstrap` when launchd hasn't loaded it). A host outside any unit, a unit
   the unit doesn't run (another process answers its socket), or a unit that needs changing (another checkout's
   `host-main.ts`, settings from before outlines by name) is left to you, with the change. Only a unit whose
   `EP0CH_OUTLINES` (default `~/outlines`) is this outlines folder counts as its unit.
6. **Hand the door sessions to the new code** (see [Sessions](#sessions-quit-is-detach)), each one that runs from
   this checkout on an older commit: `ep0ch session upgrade --all`. The programs in its tiles keep running, its screens and
   open edits come back, and every attached terminal (a pane, an ssh login) starts again on the new code and
   attaches by itself.
7. **Link the door's extensions** (`packages/door/ext/<name>/`): an extension's `ext.json` names files to link where
   another program finds them (television's cable files in `$TELEVISION_CONFIG/cable` or
   `~/.config/television/cable`, a helper beside `ep0ch`), when the program it needs is on PATH. Each link made is
   said; a file or link there that isn't install's is never replaced (it's said, and left); install's own links
   whose file is gone (an extension deleted, even the last) are taken away: it keeps a record of what it linked
   (`install-links.json` in the door's state). It runs last, so a link that fails never holds up the rest. A file of yours
   where a link would go is said each run, not left as a step. See `ext/television/README.md`.
8. **Link the agent skills** where Claude Code finds them, `~/.claude/skills/<name>` (`$CLAUDE_CONFIG_DIR/skills`), and
   `~/.agents/skills/<name>` when that folder exists: every skill in `packages/door/skills/`, and of the outliner's
   Pi skills (`pi-extension/skills/`) the one that also says how with Claude Code's tools, `outliner-documentation`
   (the others need Pi-only tools). The same rules as the extensions' links (`src/setup/links.ts`, one record), and
   one more: a symlink that is another checkout's copy of the same skill (same folder name, same `name:` in its
   SKILL.md, the old ep0ch-door's say) is replaced, so `/ep0ch-core` never reads a stale copy. A real folder there,
   or a link to some other skill, is yours: said and left. `ep0ch doctor`'s `skills` group shows each link: ✓ into
   this checkout, ! a link elsewhere (with `ln -sfn …`), ✗ missing (with `ln -s …`).

A checkout that isn't on `main`, has diverged, is behind with local changes, or couldn't be fetched is left
for you, with what to do. Install never writes a database except through a migration script (it copies them first), never creates or opens an outline,
never edits Herdr's config or registry or Claude's settings, and never writes a systemd or launchd unit (it only
asks one to restart, start or stop the host): a missing unit, a unit to change, the keys and the Claude mod are reported.
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

    ep0ch                           # the outline this folder names (EP0CH_WS, else its .ep0ch; else the home base)
    ep0ch --ws pie                  # an outline by name, from anywhere
    ep0ch --machine float-2         # this folder's outline on another machine (an ssh config name)
    ep0ch --remote float-2          # the door session running on another machine, in this terminal
    ep0ch --screen <name> [<target>] # any screen by name: board [<hub-id>], desk, river, brief, welcome,
                                    # detail <id|((ref))|ep0ch://…>, or one someone registered
    ep0ch --layout <name>           # the desk laid out by name
    ep0ch --showcase [--reset]      # the showcase on its own seeded outline (as ep0ch try --showcase)

`ep0ch help` lists everything. Besides opening the door:

| Command | What it does |
|---|---|
| `ep0ch doctor`, `ep0ch install [--apply]` | the stack's state, and bringing it up to date (see [Install and update](#install-and-update)) |
| `ep0ch try …` | `scripts/try-it.sh`: the door on a private copy (`--copy`), or on the showcase outline (`--showcase`, `--reset`) |
| `ep0ch init [<name>]`, `ep0ch outline …`, `ep0ch status` | name this folder's outline, and the host's outlines (see [Outlines on the outline host](#outlines-on-the-outline-host)) |
| `ep0ch --skill [--all] [<name>]` | the stack's skills (this door's `skills/` and the outliner's `pi-extension/skills/`: the installed plugin's, found through Herdr, else packages/outliner beside the door), or the path of one skill's `SKILL.md`; `--all` adds contributor skills |
| `ep0ch find [<words>… \| --recent \| --tree [<root id>]] [--lines \| --json]` | the outline's notes for a picker or a script: with words, the service's ranked search (`tree.search`, the ranker Goto, `/` and `((` use, asked from no note and without Jev; at most 30); `--recent`, its newest 30; `--tree`, the outline (or the notes under the root) depth first in the service's order, drawn with `├─ │ └─` (past ten levels the outer rails become `…<depth>`); without, every note, newest first. `--lines` prints `id<TAB>title<TAB>path<TAB>uri`, and with `--tree` `id<TAB>title<TAB>path<TAB>depth<TAB>glyphs<TAB>about<TAB>uri` (about: work id, stage, type; the canonical `ep0ch://` URI always last, so a column added never shifts the others); television's `ep0ch` channel reads them |
| `ep0ch find [<words>…] [--query "<expression>"] [--view <id>] [--under <id>] [--sort <key> [--direction asc\|desc]] [--updated-after\|--updated-before\|--created-after\|--created-before <date>] [--ids \| --lines \| --json]` | the notes the outline says a query holds for (PIE-534): `--query` in the saved views' grammar (`"type=chore (area=garden OR area=kitchen) updated >= -7d"`, and the atoms `#tag`, `links:[[page]]`, `under:[[page]]`, `title~text`), `--view` a saved view's members in its order, `--under` a subtree (the note included); they combine with each other and with words (every word, any order), in outline order (or `--sort`'s: `created`, `updated` or any property key, numbers as numbers, notes without it last; not with `--view`, which has its own order), at most 1000. The date flags only write the query (`--updated-after 2026-03-01` is `updated > 2026-03-01`). `--ids` prints `((id))` a line (`ep0ch show $(ep0ch find --ids --query type=errand)`); `--json` prints block records (outline-core's `block-record.ts`, built by the host's `blocks.records`), keys sorted, for any find but `--tree` |
| `ep0ch export [<id>…] [find's flags] [--children] [--format md\|json] [--out <dir>\|-] [--split] [--resolve-links] [--manifest]` | notes out as files (PIE-534). Markdown: a file a note, `<title>-<id8>.md`; the header line's `[k::v]` chips (outline-core's `header-line.ts`) move into YAML front matter, values verbatim strings (a repeated key a list), after the note's id, parent, created, updated and author; the body is the rest verbatim, its first line the prose line 1 held; `--children` adds what's under it as nested lists, or files of their own with `--split`; `--resolve-links` makes `((id))` and `[[page]]` links to exported notes relative file links. JSON: block records, keys sorted. Deterministic, so a folder of them can live in git; `--manifest` writes `manifest.json` (the export time, the outline, the selection). Without `--out`, stdout |
| `ep0ch show <id>… [--source \| --ansi \| --cells] [--width <n>] [--rows <n>]` | each note drawn as a reader draws it (the note surface), at that width, its live figures and `::links` answered by the outline and a view note's results under it (`views.read`, drawn as an embedded view), folded callouts open (no key hints), a blank line between notes; `--source` prints each note's text exactly as written (properties, links, `::` blocks; no header, no wrapping), `---` between notes, for a Markdown file (`ep0ch show --source $(tv ep0ch) >> notes.md`); `--ansi` keeps the colours (a picker's preview); `--cells` prints each as a line of JSON cells for a program that paints a grid (the Claude mod's BlockView draws them as a `Raster`; `src/cells.ts` has the format); `--rows` keeps the first rows, for a preview |
| `ep0ch revisions <id> [<n> [--restore]] [--json]` | a note's revisions (PIE-621): the current one, then the earlier texts the outline keeps (the newest 100 a note had, from its first save on schema version 4), newest first, with when each was saved, by whom, its size and first line; with `<n>` that revision's whole text; `--restore` saves it as the note, a new revision recorded as you (so it can be gone back on too). For a paste that was already saved. In the door it's the tile menu's `an earlier revision` (`revision.restore`): the edit opens with that text in as one undo step, nothing written until `ctrl+s` |
| `ep0ch mcp access [none\|read\|propose\|full] [--json] [--ws <name>] [--machine <ssh-name>]` | show or set the outline's persisted MCP grant. The default is `none`. `read`, `propose` and `full` all let MCP clients read the outline, through the local stdio server and the [remote gateway](#remote-mcp-gateway-claudeai) alike. `propose` and `full` also let MCP clients write ([Writes](#writes-pie-615)), over stdio and the gateway alike (one security model, one tool path): `propose` as proposals for you to apply, `full` applied against the revision the caller read. This setting is per outline and independent of web publishing; `none` revokes at once, for both. |
| `ep0ch mcp [--ws <name>] [--machine <ssh-name>]` | a local stdio MCP server for canonical `ep0ch://<outline>@<machine>/b/<uuid>` block URIs. It refuses every outline read unless `ep0ch mcp access read` (or `propose`/`full`) has explicitly granted this outline. At `propose` and `full` it offers the same write tools as the gateway, attributed `mcp:<client>` from the client name in the MCP `initialize` (mapped by `EP0CH_MCP_PERSONAS` like the gateway's), written straight to the outline's host (through the ssh forward with `--machine`; the stdio server has no mirror, so an away machine is an error, not a queue). A granted local reader can read private outline content; `[publish::…]` is not required and published blocks do not bypass `none`. `outline_read`, `outline_find`, `outline_links` and `resources/read` keep the same envelope (`outline_components` returns the component library's brief, and `resources/list` lists each component as `ep0ch://<outline>@<machine>/components/<id>`): canonical URI, outline instance id, revision, reachability and block record; `resources/read` also includes Markdown content. |
| `ep0ch mcp serve --http [--port <n>] [--bind <address>] [--ws <default>]` | the same MCP server over streamable HTTP, for remote clients such as claude.ai: an OAuth resource server (Clerk issues the tokens) for the outlines on this machine's host and read-only mirrors of other machines' outlines (`EP0CH_MCP_MIRRORS`), each still gated by `ep0ch mcp access`, plus the write tools where that allows them (a mirror's outline queues them). Port 8792 on 127.0.0.1 by default. See [Remote MCP gateway](#remote-mcp-gateway-claudeai) |
| `ep0ch mcp queue [status\|take\|settle] [--machine <name>] [--json]` | the gateway machine's queue of writes for other machines' outlines ([netmail](#netmail-writes-to-another-machines-outline)): how many wait for each machine, the oldest, its last pull, and what the latest became. `take` and `settle` are what a home machine's pull runs here over ssh |
| `ep0ch mcp pull [--from <ssh-name>]` | on an outline's home machine: take the writes queued for it on the gateway's machine (`EP0CH_MCP_HUB` in `~/.config/ep0ch/backup.env`), apply each, and say what each became. The backup job runs it every 15 minutes |
| `ep0ch new "<text>" [--near <id>] [--as <id>] [--json]` | a new note from a shell or an agent with no door open, placed by the service as `ctrl+n` places one (see [New notes and pages](#new-notes-and-pages-pie-544)) |
| `ep0ch view order <view> [<id>…] [--json] [--as <id>]` | a view's hand-set order: printed, or those members put first in the order given (ids, `((id))` or Work IDs), the same service step as the board's `alt+↑` `alt+↓` |
| `ep0ch outline list --all [--lines]` | every outline you can open from here: this machine's, then each machine you've opened before (a machine not connected now says so; nothing is started) |
| `ep0ch clients [--ws <name>] [--machine <ssh-name>]` | who's connected to the outline: every role, observers and roles this door doesn't know yet |
| `ep0ch session list`, `attach [--watch]`, `end [--yes] [--all]`, `upgrade [--clients] [--all]`, `restart` | the door sessions, one per outline (see [Sessions](#sessions-quit-is-detach)): every one listed with who's attached and what runs; attach to this folder's (or `--ws`'s), end it, hand it to a new daemon on this checkout's code (its programs keep running); `--all` for every session |
| `ep0ch peek`, `actions`, `snap <png>`, `open <id>`, `act <action> key=value …` | drive a running door (see [Letting an agent see what you see](#letting-an-agent-see-what-you-see-and-do-what-you-do)); `EP0CH_CONTROL` names which door |

`bun src/main.ts …` still works the same way, and `ep0ch-door` is the same command.

| Env | Meaning |
|---|---|
| `EP0CH_WS` | the outline's name, as `--ws` (over a folder's `.ep0ch`) |
| `EP0CH_OUTLINES` | the outlines folder (default `~/outlines`): `<name>.sqlite`, and the host's socket in `.host/` |
| `EP0CH_MACHINE` | the machine the outline is on, as `--machine` (over a `.ep0ch`'s `machine`): an ssh config name |
| `EP0CH_SOCKET` | a host's socket path named outright (the low-level way; no machine is used), asked for the same outline name |
| `EP0CH_EDIT_ARM` | how long an `e` (or `Ctrl+E`) in a reader waits for `⏎` before it lets the edit go, in milliseconds (default `2000`); `off` opens the edit on the first `e`. Overrides the setting `edit.arm.set` keeps (see [Editing notes](#editing-notes)) |
| `EP0CH_HYPER` | `1` turns on the hyper layer: ⌃⌥⇧⌘ and a key (`✦p` the power bar, `✦h j k l` focus, `✦1`-`✦9` a tile, `✦-` `✦=` fold and open, `✦z` zoom, `✦n` a new note, `✦g` screens) reach the door from anywhere, even while typing in a draft or a terminal tile; `0` turns it off over the setting. Off by default; `hyper.set on=true` keeps it. `keys.probe` shows what a chord arrives as (UI-GRAMMAR, "The hyper layer") |
| `EP0CH_PICKER`, `EP0CH_PICK_CHANNEL` | the picker `Ctrl+T` hands a draft's terminal to (default `tv`), and its argument (default `ep0ch`; empty for none) |
| `EP0CH_SSH` | the ssh `--machine` and `--remote` run (default `ssh`) |
| `EP0CH_DAEMON` | `0` (or `--no-daemon`) opens the door in this terminal, as before sessions: quitting it ends it. Otherwise the door is a session (see [Sessions](#sessions-quit-is-detach)): its outline's, attached to, started first when none runs. Tests and `scripts/test-door-env.sh` set `0`; pass `EP0CH_DAEMON=1` to try a session there |
| `EP0CH_PACKS` | folder holding the `woe*.zip` packs (default `/opt/float/bbs/inbox/evan`). Optional: without packs every screen draws with no art, and `ep0ch doctor` says so. `packages/door/test/fixtures/packs` holds the few pieces the menus use, which the tests always draw |
| `EP0CH_KITTY` | `1` / `0` forces graphics on or off |
| `EP0CH_THEME` | `calm` (the default), `night` or `classic`: the colours at start, over the one last chosen with `alt+t` (see [Themes and accessibility](#themes-and-accessibility)) |
| `EP0CH_LANDING` | the screen opened after the logon, by any `--screen` name: `brief` (the newest daily brief), `welcome` (the welcome notes), or any registered screen (default: the main menu) |
| `EP0CH_PROGRAM_STATUS` | `0` (or `off`): the door doesn't ask its terminal for the Program Status Protocol (OSC 7501) or report its own status to it, and our commands and the Claude mod emit none; `1`: they report without asking (a terminal known to speak it). Unset: asked (the `?` query, or `Pst` in terminfo). Terminal tiles always read what their programs report |
| `EP0CH_KEYBOARD` | `legacy` doesn't ask the terminal for the Kitty keyboard protocol (then Shift+Enter reads as Enter); unset, the door asks when the terminal answers its query |
| `EP0CH_COPY_ON_SELECT` | `0` (or `off`) doesn't copy a mouse selection when the button comes up; `y`, `cmd+c` or the copy control copies it then (Herdr's `ui.copy_on_select`). Unset, a drag copies |
| `EP0CH_OPTION_KEYS` | `us` reads macOS Option characters (`å`, `¬`) as alt keys outside text, `off` never; unset, by the locale |
| `EP0CH_SCROLL_ROWS` | rows one wheel report scrolls a reader, a draft, a column or a scrollback (1 to 20, default 1). A trackpad then moves the text with your fingers, and a mouse wheel in Ghostty (three reports a notch) moves 3 rows a notch; in a terminal that sends one report a notch (xterm, most Linux terminals) set 3. In lists (the tree, a lane, the BBS lists) a report moves the selection one row |
| `EP0CH_OBSERVE` | `0` skips registering as an observer (then the door is not in Who's Online and gets no live events) |
| `EP0CH_NOW_PAGE` | the page the welcome screen (C) shows while no note is tagged `welcome`, and the `daily` layout's "now" tile shows (default `claude-now`); `EP0CH_NOW_LABEL` names it |
| `EP0CH_DAILY_AGENT` | overrides the drawer's own agent for this door (a test door's `sh`, a one-off): unset, the drawer runs the agent chosen for the outline's session (`alt+g`, `host.agent`), else a shell. The drawer's choice is the way to set it; see [The drawer](#the-drawer-pie-498) |
| `EP0CH_DAILY_DRAFT` | the file the `daily` layout's editor tile opens (default `scratch.md` in the door's state) |

## Remote MCP gateway (claude.ai)

`ep0ch mcp serve --http` serves `ep0ch mcp`'s tools and `ep0ch://` resources over streamable HTTP, so claude.ai (or
a phone) can read an outline (ADR 0002, decision 4), and write to it as far as its access setting allows
([Writes](#writes-pie-615)). It is one implementation with the stdio server (`answerMcp` in `src/mcp.ts`); the gateway
adds the transport, the token check (`src/mcp-gateway.ts`) and, for the caller the token names, the write tools.

- **Who.** The gateway is an OAuth resource server; Clerk is the authorization server (client registration, the
  GitHub sign-in, tokens). Each request's Bearer token must be a Clerk JWT access token (`typ: at+jwt`, RS256) signed
  by a key in the issuer's JWKS, from that issuer, with `aud` naming this endpoint (`EP0CH_MCP_RESOURCE`), unexpired,
  and with a subject on `EP0CH_MCP_ALLOWED_SUBJECTS`. No token, or a bad one, is 401 with `WWW-Authenticate` naming
  `/.well-known/oauth-protected-resource/mcp`, which names Clerk. A valid token for anyone else is 403, and its
  subject is logged. With no subjects listed the gateway is in capture mode: it refuses everyone and logs the
  subject to pin. There is no anonymous access and no setting that turns the check off.
- **Which outlines.** The outlines on this machine's host, by name, and the mirrors it is given (below), each still
  gated by its own `ep0ch mcp access`: `none` (the default) refuses, `read` reads. Any other machine's outline is
  refused, and a name that doesn't exist is never made. A tool's `outline` names the outline a ref or a search reads
  (`--ws` gives a default); a URI names its own, and an `outline` naming another outline beside it is refused. A `ref`
  is what the Claude mod's tools take: an id, `((id))`, `[[page]]` or a Work ID, resolved by the same resolver
  (agent-tools' `resolveRef`, reads only: a page that doesn't resolve is never made), after the outline's access
  allows the read. `list_outlines` lists every `<name>.sqlite` in this machine's outlines folder (one the host can't
  open is `unreachable`, saying so) and every mirror, each with its access and freshness, and `tools` says whether the
  write tools are offered.
  An MCP answer's `record` is the block record without what it repeats (`text` and `header`; `body` and
  `properties` carry them), and a note's own address isn't among its links or backlinks. `record.links` and
  `record.backlinks` are each other's inverse: a property naming a block's id (`[source-block::<id>]`) is a
  `property` link, as the backlink relation counts it. `outline_find`'s `completeness` is `{kind, limit, more}` for
  the limit asked, its `search` says whether the ranking was lexical or semantic (`semantic: true` asks) and why, and a
  top-level note's `path` is `(root)`. `outline_links` cuts its links, resources and backlinks at `limit` each, and
  its `completeness` gives each group `{complete, shown, total, more}`. A `limit` outside 1 to the tool's maximum is
  refused, naming the default and the maximum.
  Granting `read` sends that outline's notes to the client's model provider: it is a disclosure decision.
- **Mirrors (PIE-562).** An outline whose home is another machine (float-hub on the laptop, often asleep or behind
  the work VPN) is read from a read-only copy on this machine whenever that machine doesn't answer (it is tried first, [below](#remote-mcp-gateway-claudeai)), so a closed lid never stalls
  or refuses a read. The copy comes from the outline's own backups: the backup job (`ep0ch backup run`, PIE-607)
  replaces `<EP0CH_MCP_MIRROR_DIR>/<machine>/<name>.sqlite` with the laptop's newest restic snapshot when there's a
  newer one (an atomic rename), and its staleness alert is what a read says. Until the Litestream follower below is
  retired, it writes there instead and the job's copy waits in `<mirrors>/.restic/<machine>/`. The gateway snapshots that file when it changes (checked at most every 15 seconds) and serves the
  snapshot from an outline host of its own opened read-only (`OutlineHost` with `readOnly`: only the reads MCP makes
  are answered; the followed file is never opened to write). Every answer says where it came from:
  `reachability.source` (and `outline_find`'s `source`) is `live` or `mirror`, `asOf` is when it was read or the
  newest change the copy holds (the home machine's clock: a quiet outline's copy can be fresh and its `asOf` old), a
  mirror's `copy` names the file served and when it last changed here, and its `note` names its home. While both
  copies exist, the one holding the newer change is served (the follower's on a tie). The access setting is the one the copy
  carries: `ep0ch mcp access read --ws float-hub` run on the laptop reaches the mirror with its next change. A
  mirror whose copy hasn't arrived yet is listed as `unreachable` and its reads are refused, saying so. A mirror is
  never written: its outline's writes queue ([netmail](#netmail-writes-to-another-machines-outline)).
- **Live when the machine answers (PIE-661).** A mirror is the fallback, not the first choice. For an outline mirrored
  from a machine, the gateway first asks that machine's own host through the shared ssh forward every client keeps
  (`<outlines>/.remote/<ssh-name>.sock`, outline-core's `ensureForward`; the ssh config name is the mirror's machine,
  `laptop` in `float-hub@laptop`), so it works over the tailnet whatever the machine's VPN does to the backups. A try has
  a 2 second budget (`EP0CH_MCP_LIVE_BUDGET_MS`). A machine that answered is tried at once next time; one that didn't
  is left alone for 45 seconds (`EP0CH_MCP_LIVE_BACKOFF_MS`), so a sleeping laptop never slows every call; a try past
  its budget finishes in the background and the next call finds it up. When it answers, reads, finds, queries and threads
  are the live outline's (`source: "live"`, `machine`), and a write goes to that host at once with its revision check
  and the caller's `mcp:<persona>` attribution: `applied`, or `proposed` with its revision, never queued. When it
  doesn't, the mirror answers exactly as before and `reachability.reason`, `liveTried` and `list_outlines`' `route` say
  why ("laptop didn't answer over ssh (tried 2s ago): …; this is float-2's read-only copy …"), and writes queue. A host
  on another `PROTOCOL` counts as away, with the command to run on that machine (`ep0ch install --apply`). Nothing
  writes twice: a write queued while the machine was away applies once when it pulls, checked against the note's
  revision then (a note changed live since becomes a proposal), a live write after it is an ordinary revision-checked
  write that says how many of the caller's queued writes to that note still wait, and a live read still lays those over
  the note as `pending`. `list_outlines` gives each mirrored outline's `route` (`via`: `live` or `mirror`, when it was
  last `checkedAt`, `why`). `EP0CH_MCP_LIVE=0` turns the live route off.
  **One identity per outline.** A mirrored copy is its source's instance: the private host that serves it keeps the
  instance id the copy carries (`adoptOutlineInstance`, outliner `src/outline-instance.ts`), where it used to mint a fresh
  one, so `outlineInstanceId` is the same whether the answer is live, from the mirror or from the laptop's own stdio
  server. The outline's name in answers is the machine's own name for itself, as its host reports it (`laptop`'s is
  `Evans-MacBook-Pro.local`), learned the first time it answers live and kept in `<EP0CH_MCP_MIRROR_DIR>/.home/`; until
  then, and as an accepted alias always, the ssh name. A URI with either name reaches the same outline (`list_outlines`
  gives `machine` and `sshName`), and a write queued under one name applies under the other: the queue is keyed by the
  ssh name and the block, and the instance id it carries stops a replaced database from taking it.
  **Live writes show in the next mirror read.** A write made live is kept in the netmail store, settled, with the
  revision it made. A read that falls back to the mirror lays the caller's own such writes over the note (`pending`)
  until the copy reaches that revision, says `staleSince` (the revision, when, and what it means) when the copy is older
  than a write made through this server, and `list_outlines` carries `staleSince` for the outline.
- **Revoking.** `ep0ch mcp access none --ws <name>` (or `read`) stops reads (or writes) at once; a write already queued
  for another machine is dropped when it arrives, if its outline no longer takes writes there. Removing a subject from
  `EP0CH_MCP_ALLOWED_SUBJECTS` (or a client from `EP0CH_MCP_ALLOWED_CLIENTS`) and restarting stops that person (or
  client). Clerk's JWT access tokens live a day and can't be recalled early; revoke the client's grant in Clerk to
  stop its refresh.

| Env | Meaning |
|---|---|
| `EP0CH_MCP_RESOURCE` | this endpoint's public URL, as clients name it and tokens carry it in `aud` (`https://mcp.ep0ch.sh/mcp`); required, https |
| `CLERK_PUBLISHABLE_KEY` | names the issuer (Clerk's Frontend API); from `~/.config/secrets/clerk.env` through `with-secrets clerk -- …`. `EP0CH_MCP_ISSUER` names it outright instead |
| `EP0CH_MCP_ALLOWED_SUBJECTS` | comma-separated Clerk user ids (`user_…`) allowed in. Unset: capture mode |
| `EP0CH_MCP_ALLOWED_CLIENTS` | optional comma-separated OAuth `client_id`s; when set, only these clients |
| `EP0CH_MCP_MIRRORS` | comma-separated `<outline>@<machine>` read from their mirrors (`float-hub@laptop`) |
| `EP0CH_MCP_MIRROR_DIR` | where the followed copies are, `<machine>/<outline>.sqlite` (default `~/outline-mirrors`; never the outlines folder), and the netmail queue, `.netmail.sqlite` |
| `EP0CH_MCP_LIVE`, `EP0CH_MCP_LIVE_BUDGET_MS`, `EP0CH_MCP_LIVE_BACKOFF_MS` | the live route to a mirror's machine: `0` turns it off; the connect budget (default 2000) and the wait after a failed try (default 45000) |
| `EP0CH_MCP_HUB` | on a home machine, in `~/.config/ep0ch/backup.env`: the gateway machine's ssh name, whose queued writes for this machine its backup job pulls. `ep0ch install` writes `float-2` on a Mac whose file names none; an empty `EP0CH_MCP_HUB=` line means none, and stays |

### Writes (PIE-615)

Seven tools (with `outline_assign_id`), offered to a remote caller when some outline it reaches takes writes: `outline_create` (a block under a
parent), `outline_patch` (spans of a note, `draft.patch`), `outline_comment`, `outline_reply` and
`outline_resolve_thread` (a note's comment threads) and `outline_set_property` (one header chip, as one patch span).
`outline_threads` reads the threads (each one's id, open or resolved, its quote and every comment with author and time;
`outline_read` carries a compact summary, so a client notices a reply). A reply or a resolve is addressed by the note and
a `thread` id. They take the Claude mod's shapes, addressed as the reads are (a `uri`, or a `ref` in an
`outline`), and each runs the outliner's own agent operation (`@ep0ch/outliner/agent-tools`, behind the mod's tools)
over the outline's socket (`src/mcp-writes.ts`): the service checks revisions, anchors comments and keeps pages and
linked anchors. What a write becomes is the outline's access:

| Access | A patch or a property | A new block | A comment |
|---|---|---|---|
| `none`, `read` | refused, with the command that allows it | refused | refused |
| `propose` | a proposal under the note (apply anyway, or dismiss) | a comment on its parent carrying the text | a comment, a reply, a resolve (each changes only its thread) |
| `full` | applied against the revision the caller read; changed since, or open in someone's draft: a proposal (into that draft) | created | a comment, a reply, a resolve |

Every write is an agent's: its actor `mcp:<client>` (a URL client id by its host: claude.ai's is `mcp:claude.ai`), its
session the token's subject. The outline's activity records both, the gateway's log has a line for each write, and a door
on the outline says it on its status line as it lands (`mcp:claude.ai commented on “Seed list” · a remote MCP write`).
Each answer says `applied`, `proposed` (why, and the proposal's URI) or `queued`, with the block's URI. tools/list is
read when claude.ai connects: after changing an outline's access, reconnect the connector to see the write tools come
or go (a call is checked against the access now, whatever the list said). `list_outlines`' `tools.said` and
`ep0ch mcp access` (when a change adds or removes the write tools) say so.

### Receipts, read-your-writes and queries (PIE-648)

A write to an outline whose home is another machine answers `queued` with a `queueId`. Three things follow it:

- **`outline_write_status(queueId)`** says where it stands: `queued` (with that machine's last pull), `applied` (with the
  block's revision), `proposed` (with the proposal's URI: the note had changed), `superseded` (proposed, then replaced by
  the same caller's later write of the same kind to the same note) or `rejected` (with why: refused there, or its owner
  dismissed the proposal). Only the caller's own writes. The home machine's pull tells the gateway what each entry became
  (`ep0ch mcp queue settle`, over the ssh the pull already uses), with the revision it made or the proposal it became; a
  proposal's later life (applied or dismissed by its owner, which sends it to the Trash) is read from the mirror, so it
  shows once the next copy arrives. The queue's store is version 2; an older one is refused with the move-aside advice.
- **Read your writes.** `outline_read` of a mirror's block adds `pending` for the caller's own still-queued writes about
  it: `pending.body` is the body with each queued patch laid over it, every replacement between `{{pending <id>}}` and
  `{{/pending}}` (a removal says `removes “…”`), `pending.spans` says which spans were found, and queued properties, new
  blocks and comments are listed. `record.body` stays the mirror's own text. Another caller's waiting writes are never
  shown. Once the home machine has applied them and the mirror follows, `pending` goes.
- **`outline_query`** runs the views' grammar (`type=outbox-item outbox=next`, `type=ticket NOT work-stage=done`; the
  grammar of `[query::…]` and `ep0ch find --query`) or a saved view by its block id (`view`), read-only, gated by the
  outline's access like the other reads, on a live outline or a mirror. The outline evaluates it (`blocks.query`,
  `views.read`, through `ep0ch find`'s own selection) and the answer is block records with `uri` and `revision`, `limit`
  (1 to 50, default 20), `offset`, `more`, `nextOffset` and `total`. A read-only copy now answers those three actions.
- **Calls (PIE-685).** A caller's visit to the board is a *call*, and every write records which one made it, beside who
  made it. The call id comes, in this order, from the `call` argument of a request (an id the agent keeps: the one
  `list_outlines` or an earlier write returned, `c-7f3a1c`, or a name of its own such as `daddy-2026-10-09-0103-k7f`; it
  wins), the HTTP transport's `Mcp-Session-Id` (the gateway issues one at `initialize`, and a client that sends it back
  is one call; whether claude.ai keeps one per chat or opens a new one is read from the journal, below), and for stdio one
  per connection. The gateway is stateless and keeps nothing between requests, so a write with none of these is a call of
  its own and its answer returns the id with a line telling the agent to pass `call` next time. The call rides the write's
  `sessionId` as `<oauth subject>#<call>` (the principal and persona stay in the actor id, display stays
  `daddy (claude.ai)`); `outline-core/src/attribution.ts` composes and parses it. A call has a readable handle,
  `leaping_otter_convergence`, minted once from the curated word lists in `outline-core/src/call-handles.ts` (the id seeds
  the pick; no word comes from a chat's content) and stored id to handle under a unique index in
  `<outlines>/.clients/mcp-calls/calls.sqlite` (`src/mcp-calls.ts`): a clash takes `_2` inside the same write, and the id
  stays the key. `list_outlines`, a write's answer, a queued write's status and the gateway log show `call: {id, handle}`.
  **Why it matters:** you can tell which chat a run of notes came from, and review or undo one chat's batch without
  touching another's.
  `call:<id or handle>` is a query atom (`outline_query`, views, `ep0ch find --query`): the blocks whose latest change, else
  their creation, came from that call; the MCP server swaps a handle for its id before the service evaluates it.
  **A recent-activity read leaves a call's own writes out:** an `outline_query` with an `updated` range or sort, or
  `fold`, from a call that has an id drops the rows whose latest change is that call's own, saying so in `ownOmitted:
  {call, handle, count, said}` ("12 of yours this call, omitted"); `includeOwn: true` keeps them. Another call's writes
  (the same connector's other chats, loki, cowboy) always show, and so does a row someone else changed after. **Why it
  matters:** an agent orienting after its own writing burst doesn't spend context re-reading what it just wrote.
  Reading the journal: the gateway logs `mcp gateway: <subject> client=<oauth client> mcp-session-id=<what the client sent,
  - on its first request> call=<id> [(new)] <methods>` per request and `mcp write: <actor> (<subject>) client=… call=<id>
  (<handle>) <tool> …` per write. If every request of one chat shows the same `mcp-session-id` and a new chat shows a new
  one, claude.ai opens a session per chat and the id alone is enough; if the same id spans chats, tell the chats apart with
  `call`. The echo rule judges a block by its latest change only, not by everything since a time: a block you wrote
  and someone else changed earlier in the window is omitted too.
- **Orient (PIE-674).** An agent arriving cold reads the outline's recent changes, not a separate context store. The
  recipe, per outline: (1) run the orient query,
  `outline_query {query: "updated >= -1d", sort: "updated desc", fields: "id,title,updated,actor,path", fold: true}` (or a
  saved view's id: its own `[sort::]` orders it); a busy outline answers a few KB of titles. (2) `outline_read` the rows that
  are new to you, by `ref`. (3) Pass `seen: ["<id>@<revision>", …]` (the id and revision of what you hold) on every later
  read, query and find: a block you hold comes back `{id, revision, unchanged: true}` and only the changed ones are
  sent whole. The arguments: `sort` is `<created|updated|property key> [asc|desc]` and the service applies it (not with
  `view`); `fields` are `id, uri, title, revision, updated, created, author, actor, parent, path` or a property key
  (`id` and `revision` always, never a body: asking for `body` is refused, pointing at `outline_read`); `under` is a note
  as `ref` names one; `fold` folds a note's proposals, comments and deliveries into it as `changes: {count, proposals,
  comments, deliveries, summary, ids}`, `total` counting folded rows and `foldedFrom` the blocks matched. A folded or
  seen row still carries `changes`: the revision doesn't vouch for the blocks folded into it (a delivery added under a note leaves its revision alone).
  Dedupe, cheapest first: a body goes once per response (a repeat is `{id, revision, see: "<rpc id>:<where>"}`); a proposal
  reads as its diff and the target's `id@revision`, a comment as its words and `anchor: {start, end}` (`raw: true`
  sends them as stored); `seen` stubs. Layer four, a content hash across outlines and mirrors (the same text in many
  homes), is designed but not built: hash a body (`textHash`, as the netmail queue does), keep `hash → first
  outline@id@revision` for the response, and answer a repeat in another outline as `{id, revision, same: "<outline>@<id>"}`;
  it needs a mirror-wide index to pay off, so it waits for a real duplicate to measure.

Without a note, `outline_threads` is the outline's inbox: the open threads anywhere in it, newest activity first, narrowed
by `lastFrom` (who spoke last: `evan`, `daddy`; a gateway's `mcp:` prefix is optional), `mentions` (an `@name` in any
comment) and `since` (ISO time or epoch ms). It is what a scheduled check calls. Every ref-taking tool accepts `id` as
`ref`'s alias. A write's answer carries `base` (`live`, or the mirror's `asOf` and its age in minutes), so an agent knows
how stale the revision it wrote against is.

A reply or a resolve for a thread that is not on the note is refused. Queued for another machine's outline and the thread
gone when it lands, it becomes a comment on the whole note saying so. Whether a comment asks for an answer (PIE-551) is
not recorded by the service yet, so no thread field says it: read the thread's last comment.

### Who a connection writes as

Every write says two things (PIE-679). The **principal** is what auth proved and can't be spoofed: the gateway's OAuth
client (`claude.ai`), or, for stdio and the Claude mod, the client on this machine (`claude-code@float-2`,
`claude-code@laptop`). The **persona** is a label declared on top, shown as `loki (claude-code@float-2)`; it is recorded
in the write's actor id as `mcp:loki/claude-code@float-2` (the mod's as `loki/claude-code@float-2`), so the door, receipts,
proposals and threads show both. A persona never crosses principals.

Name a connection with `EP0CH_MCP_PERSONAS` on the gateway's machine, in its environment or in `~/.config/ep0ch/mcp.env`:
a comma list of `<who>=<name>`, `<who>` being the principal (`claude-code@float-2`, `claude.ai`) or the token's subject, so
`claude.ai=daddy` makes its writes `mcp:daddy/claude.ai` (a subject wins over a principal; a name is letters, digits,
`.`, `_`, `-`). A bare client name such as `claude-code` names no stdio principal, since it would reach every machine's.
It is read at each write, so a change needs no restart. A stdio process or the mod may also declare its own persona,
`OUTLINER_ACTOR`, else `EP0CH_AGENT`; it holds only where the list doesn't give that persona to another principal (the
laptop's `claude-code` can't claim `loki` while the list says `claude-code@float-2=loki`). Older writes keep the actor id
they were made with.

### Agents make outlines of their own

`outline_new` (stdio and the gateway, one tool path) makes a scratch outline for the fleeting things that don't belong in
the outlines that drive work: `name` (a slug; a taken name, an archived one too, is refused with the nearest names),
`purpose` (one line) and optional `seed` blocks. The tool says to call `list_outlines` and `outline_find` first. It is made
on this machine only, through the host's create. The caller's principal gets `full` on it and every other principal `read`
(the outline's access setting is `read`; the maker's `full` comes from the outline's recorded owner, so a person's `none`
still denies everyone). The root note carries `[created-by::loki/claude-code@float-2] [created::<date>] [purpose::…]
[kind::scratch]`; `list_outlines`, `ep0ch outline list` and the door's home base show who made it and why. At most
`EP0CH_MCP_SCRATCH_CAP` (default 5) a week per principal, the refusal naming the ones already made. `outline_archive`
(and `ep0ch outline archive <name>`) hides one and keeps its database in `<outlines>/.archive/<name>/`; `restore: true`
(`ep0ch outline unarchive <name>`) brings it back. Nothing deletes over MCP.

### Netmail: writes to another machine's outline

A mirror's outline (float-hub@laptop) is never written on the gateway's machine. Its writes wait there in a store of
their own, `<EP0CH_MCP_MIRROR_DIR>/.netmail.sqlite` (`src/mcp-netmail.ts`), each with the block's URI and what the
mirror showed of it: its revision, its text's hash and the home database's instance id (read from the copy). The
answer says `queued for float-hub@laptop (laptop last pulled …)`, and `list_outlines` gives each mirror's `queue`.

The home machine dials in: with `EP0CH_MCP_HUB=float-2` in its `~/.config/ep0ch/backup.env` (install writes it on a
Mac), its backup job (every 15
minutes, while it's awake) runs `ep0ch mcp queue take --machine <its EP0CH_BACKUP_MACHINE> --json` on the hub over ssh,
applies each write to its own outline with the gateway's own `applyWrite`, and tells the hub what each became
(`ep0ch mcp queue settle`). `ep0ch mcp pull` does the same at once. Until it has, `list_outlines` gives the mirror's
`queue.said` with both commands, and doctor on the home machine says no pull is recorded yet. ssh is the trust the machines already share (the
mirrors and forwards use it), so the gateway has no second credential and no way in to the laptop.

- A write is applied as the outline's access allows on its home machine now: narrowed to `propose` since, a `full`
  write becomes a proposal; narrowed to `read` or `none`, it is dropped and the hub records why.
- A note that changed since the mirror showed it becomes a proposal under it: a conflict note, never an overwrite.
  Same database: the revision decides. A database replaced since (a restore gets a new instance id): the text does.
  A new block and a comment don't conflict; a comment whose passage changed lands on the whole note, quoting it.
- A pull cut off after applying and before the hub heard keeps a ledger (`<door state>/backup/netmail-applied.json`),
  so the next pull tells the hub again and applies nothing twice.
- The mirror shows a write once it has been applied and the next snapshot (or sqlite3_rsync) has refreshed the copy.
- `ep0ch mcp queue status` on the hub, `ep0ch backup status` and `ep0ch doctor` on either side show the queue
  depth, the oldest write and the last pull per machine. A queue that has waited a day while its machine was seen
  online (a newer snapshot, an ssh answer) is an alert on the door's status bar, announced once, with the fix.

The unit, `~/.config/systemd/user/ep0ch-mcp.service` (the gateway needs only the publishable key; the secret key
in `clerk.env` is never read):

```ini
[Unit]
Description=ep0ch remote MCP gateway: MCP over HTTP on 127.0.0.1:8792 (https://mcp.ep0ch.sh/mcp via Caddy)
After=outliner-host.service
Wants=outliner-host.service

[Service]
Type=simple
WorkingDirectory=%h/projects/ep0ch/packages/door
Environment=EP0CH_OUTLINES=%h/outlines
Environment=PATH=%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=EP0CH_MCP_RESOURCE=https://mcp.ep0ch.sh/mcp
# Empty: capture mode. Connect once from claude.ai, read the subject from the journal, put it here, restart.
Environment=EP0CH_MCP_ALLOWED_SUBJECTS=
Environment=EP0CH_MCP_MIRRORS=float-hub@laptop
UnsetEnvironment=EP0CH_SOCKET EP0CH_WS EP0CH_MACHINE
ExecStart=%h/.local/bin/with-secrets clerk -- %h/.bun/bin/bun src/main.ts mcp serve --http --port 8792
Restart=always
RestartSec=3
NoNewPrivileges=yes
UMask=0077

[Install]
WantedBy=default.target
```

The mirror's Litestream follower (being retired, PIE-607) is a template unit,
`~/.config/systemd/user/litestream-mirror@.service`, one instance per outline (`litestream-mirror@float-hub`); the
bucket keys come from `hetzner-s3.env`, and the copies stay outside `~/outlines`, so this machine's own Litestream
doesn't replicate them back and its host never serves them. It restores fresh on every start: Litestream 0.5.17
refuses to resume a follow whose saved txid is past the newest snapshot (upstream #1385, a crash loop), and doctor
says when a follower lacks the `ExecStartPre` that removes the old copy:

```ini
[Unit]
Description=Litestream follow: read-only mirror of laptop outline %i in ~/outline-mirrors/laptop, for the MCP gateway
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/secrets/hetzner-s3.env
ExecStartPre=/bin/mkdir -p %h/outline-mirrors/laptop
ExecStartPre=/bin/rm -f %h/outline-mirrors/laptop/%i.sqlite %h/outline-mirrors/laptop/%i.sqlite-txid %h/outline-mirrors/laptop/%i.sqlite-wal %h/outline-mirrors/laptop/%i.sqlite-shm
ExecStart=%h/.local/bin/litestream restore -f -follow-interval 10s -config %h/.config/litestream/mirrors.yml %h/outline-mirrors/laptop/%i.sqlite
Restart=always
RestartSec=10
UMask=0077

[Install]
WantedBy=default.target
```

with `~/.config/litestream/mirrors.yml` naming the laptop's replica:

```yaml
dbs:
  - path: /home/evan/outline-mirrors/laptop/float-hub.sqlite
    replica:
      type: s3
      bucket: ep0ch
      path: laptop/outlines/float-hub.sqlite
      endpoint: https://hel1.your-objectstorage.com
      region: hel1
```

Caddy, beside `pie.ep0ch.sh` (the `*.ep0ch.sh` record already points at the machine):

```caddyfile
mcp.ep0ch.sh {
	reverse_proxy 127.0.0.1:8792
}
```

Clerk (the `ep0ch-mcp` application) admits claude.ai as a pre-registered CIMD client only: claude.ai identifies
itself by a Client ID Metadata Document, `https://claude.ai/oauth/mcp-oauth-client-metadata`. In the dashboard under
**OAuth applications**:

- **Settings** tab, **Client onboarding**: **Publish CIMD support** on, **Client admission** **Pre-registered clients**
  (only pre-registered and previously connected clients), **Publish DCR support** off. Under **Authorization
  security**: **Require PKCE**. **Access token format**: **JWT access tokens** (the gateway verifies JWTs itself; an
  opaque token is refused).
- **Applications** tab: **Add application** → **Pre-register CIMD client**, Client ID URL
  `https://claude.ai/oauth/mcp-oauth-client-metadata`, then **Allow client**.
- The `aud` claim from the RFC 8707 resource parameter (`aud_claim_enabled`) must be on, or every token is refused
  (the journal says so). It has no dashboard switch; the CLI sets it with the rest (`/instance` calls need `--app`):
  `clerk api /instance/oauth_application_settings --app <app_id> -X PATCH -d '{"aud_claim_enabled": true,
  "oauth_jwt_access_tokens": true, "pkce_required": true, "client_id_metadata_documents_advertised": true,
  "client_id_metadata_documents_only_allow_pre_registered_clients": true, "dynamic_oauth_client_registration":
  false}'`, and `clerk api /instance/oauth_application_settings --app <app_id>` reads them back.
- **User & authentication** → **SSO connections**: GitHub.

A client that can only register dynamically needs **Publish DCR support** on (`"dynamic_oauth_client_registration":
true`); the gateway takes its tokens the same way.

Either way a client registers, its token carries its `client_id` (a CIMD client's is its metadata URL), and
`EP0CH_MCP_ALLOWED_CLIENTS=https://claude.ai/oauth/mcp-oauth-client-metadata` pins the gateway to claude.ai.
Then in claude.ai: Settings → Connectors → Add custom connector, URL `https://mcp.ep0ch.sh/mcp`, and sign in with
GitHub on Clerk's page. The first try is refused while `EP0CH_MCP_ALLOWED_SUBJECTS` is empty: the journal
(`journalctl --user -u ep0ch-mcp -n 20`) names the `sub` to put there.

## Sessions: quit is detach

    ep0ch                      # this folder's outline's session: started when none runs, then attached
    ep0ch --ws garden          # garden's session (another outline's runs beside it); --machine for another machine's
    ep0ch --no-daemon          # the door in this terminal only (quitting ends it)
    ep0ch session list         # every session: outline, machine, pid, code, who's attached, what runs in its tiles
    ep0ch session attach --watch
    ep0ch session end          # asks while programs run in its tiles or a draft is unsaved; --yes doesn't
    ep0ch session end --all    # every session, after asking
    ep0ch session upgrade      # hand it to a new daemon on this checkout's code: programs keep running
    ep0ch session upgrade --all

A **session** (PIE-418) is the door kept running without a terminal, as Herdr and tmux keep theirs; `ep0ch` runs the
door as one. One runs per outline, like `herdr --session <name>`: naming an outline (`--ws`, `EP0CH_WS`, the folder's
`.ep0ch`, with its `--machine`) names its session, started on demand in the background. `attach`, `end`, `upgrade` and
`restart` act on the session of the outline the folder (or `--ws`) names; where none is named, on the only one running
(with several, they print the `--ws` to add for each). The home base marks an outline whose session runs (`● running ·
1 attached`), and choosing it attaches. A session holds everything the door holds:
the screens and their layouts, the dispatcher, drafts, the terminal tiles with their programs and scrollback, the
drawer, the service connection and its change feed. Your terminal is a **client**: it shows what the session
sends and sends what you type. A terminal inside the session (one of its tiles, its drop shell) can't attach to it. With no
terminal attached, the session draws no frames: its programs keep running and its state keeps up, and the screen is
drawn when a terminal attaches or `peek`, `snap` or an `act` reads it.

- **Quitting detaches.** `G` (Goodbye), `ctrl+c`, closing the terminal or a dropped ssh connection lets go of that
  terminal; everything goes on running. `ep0ch` attaches again and you're where you were: the layout, nvim with its
  unsaved buffer, a shell's scrollback, a half-written draft. `--layout daily` applies when a session starts; attaching says it didn't apply it.
  `--screen <name> [<target>]` opens that screen in the session you attach to as well.
- **Where it lives.** Each outline's session and what's that outline's live in its own folder of the state dir:
  `sessions/local/<name>/` for this machine's outlines, `sessions/<ssh-name>/<name>/` for a machine's,
  `sessions/socket-<hash>/<name>/` for a host named by `EP0CH_SOCKET` (and `sessions/~/<hash>/` where that path would be
  too long for a socket). There: `place.json` (which outline the folder is, kept for good), `session.sock`, `session.json`
  (the running session), `session.lock`, `session.log`, the
  terminal host's `pty.sock` and `pty-host.log`, the checkpoint `session-state.json`, the control socket `door.sock`,
  the saved layouts of the desk, the river and the board (`desk.json`, `river.json`, `delivery.json`), the river's
  index, the last call, the marks and the drafts put aside (`drafts/unsent/`). Shared by every outline, in the state dir
  itself: the theme, `ctrl+e` copies (`drafts/`), the drawer, the machines opened, summary
  keys and the daily scratch. The home base, on no outline yet, keeps its own in `home/`.
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
  checkout. The programs in its terminal tiles and the drawer keep running: they never belonged to the daemon,
  but to the session's **terminal host**, and the new daemon adopts each by its tile, its output and scrollback
  replayed. The screens come back (one kept in the background too), and so do the edits open on the screen on top
  (`e` or `⏎` in one carries on). Every attached
  terminal attaches again by itself, in the same terminal and the same ssh login. On a session already on this code,
  or with `--clients`, only the terminals start again; `ep0ch session restart` hands over whatever code it runs.
- **A daemon that dies** (a crash, `kill -9`) comes back the same way at the next `ep0ch`: the programs are still in
  the terminal host. Text typed into a draft since it was last put aside was only in the daemon's memory, and is lost
  then; drafts put aside come back. `ep0ch session list` says when a terminal host runs without a daemon.
- **`ssh` lands in it.** The ForceCommand door (`ssh -p 2323`) runs `ep0ch`, so every ssh login, the laptop's and
  the phone's, attaches to that outline's session instead of starting a door of its own; a dropped connection only
  detaches. With no terminal (a script, an agent's shell, ssh without `-t`) `ep0ch` starts no session: it says so,
  and `--no-daemon` opens the door there.
- **The daily agent stays Herdr's.** With an agent chosen "in Herdr", the drawer attaches to its session's own pane in Herdr
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
aside: opening an edit writes nothing. The session's files are in its outline's folder of the state dir (above):
`session.sock` (mode 0600, the folder 0700), `session.json` (who it is), `session.lock` (held while it runs), `session.log`, `pty.sock` and `pty-host.log`
(the terminal host), `session-state.json` (the checkpoint; gone once the session ends). A test door on its own
`EP0CH_STATE` has its own session and never reaches yours. See `src/session/`.

## The desk

`D` on the menu, `ep0ch --screen desk` to skip the logon, or `--layout daily` to open it laid out by name.
The door owns the whole canvas, and the canvas is **tiles** (PIE-413): views in one layout tree that you
split, tab, drag, link and save, drawn by the door itself, so no multiplexer is needed for layout.

| Tile | What it shows |
|---|---|
| outline (`tree`) | the tree; `←/→` fold, `⏎` opens (into its link, if it has one). `L` shows the selected row's links under it, as the outliner's Tree does: `→ outlinks`, `♦ resources` (`[file::]`, `jira::`), `← backlinks` (grouped as Detail groups them); each group folds (`space`, `h l`, a click); `l` or a click on a link's `▸` shows that note's links a level down; `⏎` or a click opens a link's note, or shows a resource's stored content in the reader (registering it first, and fetching it once, if it must) (`tree.links`, `tree.pick`) |
| reader | the current note; a reader has one of three modes (PIE-705), shown as a chip on its frame: it *follows* the selection, is *held* on its note (`p hold`, `p` again follows; a detail is a reader started held, `^W o d`), or is *pinned* to a page (`reader.mode mode=pinned`; a click on the chip cycles all three); `[ ]` elements, `⏎` act on one, `alt+⏎` or a ctrl-click opens a link beside, `u` parent, `( ) f F` fold, `b` its links (the links tile), `O` a reader beside it where its links open (`tile.preview`); `r` fetches the note's tickets now (a click on a ticket's age does too), `⏎` on a ticket's title opens the ticket block |
| detail | a reader that keeps its note: it changes only by an open into it (its link, `open`, a click) |
| preview | a reader that follows a source: a tile's selection (`tile:tree`, `tile:board`) or a file (`file:~/draft.md`), re-read when it's saved. Read-only for a file |
| terminal (`pty`) | a program in a pty the door owns: nvim, claude, a shell. Click it or `⏎` to type in it; `ctrl+]` back to the door |
| backlinks (links) | the links of what another tile shows (`tile:detail`): `→ outlinks`, `♦ resources`, `← backlinks` (grouped as Detail groups them), `↓ children` (the notes under it, a thread's replies; PIE-693): `j` `k` or a click show one where the tile's selection goes (a preview following it: a note, a ticket's block, a resource's stored content, never registering it), `⏎` or a double click opens it in the tile it came from (a tile linked to it as a target, else the detail it lists the links of), `alt+⏎` or an alt-, ctrl- or middle-click opens it in a new detail beside that one (`backlinks.open`; PIE-646); `.` folds a group; `/ s K w h n` and the header change the view (Kind, Stage and Sort apply to outlinks and resources by their target's kind, stage and dates as to backlinks; the counters say `N of M match` and `→a/b ♦c/d ←e/f ↓g/h`; each control keeps its slot); `v` or a click on the counters chooses which groups the tile lists, saved with the layout (`^W o h` opens one with Children alone: the replies, where the thread tile was) (`backlinks.pick`, `backlinks.open`, `backlinks.fold`, `backlinks.view`, `backlinks.groups`) |
| board, river, brief | the whole screen in a tile, its own keys inside; the board's card can be followed by a preview tile |
| query | a saved view's cards with its own cursor (`view=<its block id>`; `^W o q` on a tile showing a view): a board lane, on the desk; `j k` pick, `⏎` opens where its opens go, `r` reads it again |
| tune | the tune inspector on another tile (`source=tile:<name>`; `alt+y` or `^W o y` on the tile, or "tune its look" in its ⋯ menu): each look value (measure, padding, margin, list gap, zebra and dividers, surfaces, frames, edges and tone, the header's surface and picture, heading spacing, breakpoints) and where it comes from; `j k` pick, `+ −` (a click on `[−] [+]`, the wheel over a value) nudge it live, `v` the level, `w` this width only, `s` save, `u` `U` undo and redo every step of the session, `x` resets a value to what it inherits, `X` resets the picked level, `R` reverts the session's style notes (asked in place); a level or a width picked shows its own column and marks ⊘ a row something nearer wins, where a nudge offers `a` `o` `c` (PIE-673, PIE-675) |
| thread, activity, who, bulletin | as before: replies and comments, last callers, who's online, the ep0ch art |

| Keys (mouse) | Action |
|---|---|
| drag a tile's header | move it: onto a header or a tile's centre makes **tabs**; onto one of a tile's four triangles **splits** it that way; onto the window's outer left, right or bottom edge makes a **full-height column** or **full-width row**. The drop is outlined while you drag; `esc` lets go |
| click a tab; drag a tab | show it; move it out, or to another place among its tabs |
| drag a border | resize |
| `alt+l`, then click a tile | this tile's opens land there (a link followed, the tree's `⏎`); click the tile itself to unlink; `h j k l` or a number work too |
| ctrl-click or alt-click a link | open it beside, not in the link target |
| click a dock's handle (`⇤ tree`, hint row) | slide it open |
| click the `⧉` before a float's title | put it back in the layout (`tile.float`, as `^W f` and the board's `o`); the cell either side of it counts |
| click the `⧉` in the focused tile's top right corner | float it (`tile.float`, as `^W f`) |
| click the `⋯` in a tile's top right corner (left of its `×`), or right-click anywhere in the tile | its menu (`tile.menu`, as `^W .`): the tile's actions, grouped (Tile: close, zoom, float, dock, spine, drawer, preview; then its kind's: a reader's Note and Reader rows, a terminal's, a board lane's), each with its key as a keycap. One click, `⏎` or the row's own key runs it as you; a dimmed row says in the menu's foot why it can't run now; `esc` or a click outside puts it away. A terminal whose program asked for the mouse (vim's `mouse=a`, claude) keeps its right-clicks, and its `⋯` still opens the menu; so does a step's box, whose right-click opens its status choice |
| click the `×` in a tile's top right corner | close it (`tile.close`, as `^W x`), your keys staying where they are; a tile with a running program asks twice. A tile its container keeps (the board's lanes, the river's library) has none, and a dock's tile closes by the dock's `[×]` |
| drag a tile's header onto the status bar's drawer chip (`▲ claude`) or the open drawer | put it in your drawer: it joins the drawer as a tab and travels with you across screens (`tile.drawer`); the chip lights up `into your drawer: travels with you` while you're over it |
| drag a drawer tab's title out over the screen | take it out there, by the same drop zones as any tile (`tile.drawer on=false to= where=`) |
| while dragging a tile: `a`, `f`, `p` | put it in your drawer, float it, dock it to an edge (`tile.drawer`, `tile.float`, `tile.dock`: what `^W a`, `^W f`, `^W p` run) |
| drag a tile's header onto a dock's handle | the tile is docked there (`layout.move where=tabs`; the drag says `docked here: stays on this screen`); dropped beside a tile inside an open dock, it lives in the dock too |
| click the chip on a tile's frame (`✎ agents: edit only`, `⊘ agents: hands off`) | cycle what an agent may do to that tile: free, edit only, hands off (`tile.agent`, as `^W g`; PIE-639) |
| click `□ lock` / `▣ locked` (hint row) | lock or unlock the screen (`layout.lock`) |
| a refused drop or border (locked, a container that takes no drops or other kinds, a fixed size) | the ghost turns red and says why; the release does nothing and the status bar says the same words |

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab`, `1`–`9`, click | focus |
| `alt+n` / `alt+p` | next / previous tab |
| `alt+d` | load the `daily` layout |
| `ctrl+k`, `cmd+k`, a click on `^K` (the status bar's left) | the power bar over any screen ([The power bar](#the-power-bar-pie-656)): the tiles open everywhere, then what changed; type to look through tiles, notes, actions, what changed and screens at once, or start with `%` `/` `>` `+` `@` (tab cycles) for one; ⏎ goes, alt+⏎ zooms a tile or opens a note in a new detail, esc puts it away. Never in a draft (there `ctrl+k` cuts to the line's end), a filter, a picker or a terminal tile |
| `ctrl+n` | a new note floating over the screen, opened to be written (again for another; from an edit too, what you typed saved first): under the note in the reader you're in, else at the top of the Inbox ([New notes and pages](#new-notes-and-pages-pie-544)); on every screen, never in a filter, a picker or a terminal tile. On the board's lanes: a new card in that lane |
| `alt+l` | link this tile's opens (then a click, `h j k l` or a number) |
| `?`, a click on `? more` | when the hint row is too long for the screen (it ends `? more`), show all of it in a box above it (`keys.more`, the person's); a `^W` chord's row shows it at once |
| `alt+k` | lock or unlock the screen: its shape is fixed (no moves, drops, new tiles, closes, resizes, docks in or out, links, layout loads), its contents stay live (reading, editing, terminals, docks sliding, tabs, zoom) |
| `Ctrl+W` then `g` | what an agent may do to this tile: free, edit only (its note, not navigating, closing or retargeting it), hands off (peek only); cycles (`tile.agent`) |
| `Ctrl+W` then `h j k l` | focus by direction |
| `Ctrl+W` then `m` + `h j k l` | move beside the tile that way (none that way: to that edge) |
| `Ctrl+W` then `t` + `h j k l` | move into the tabs of the tile that way |
| `Ctrl+W` then `T` | take this tab out of its tab set |
| `Ctrl+W` then `H J K L` | move to that outer edge (a full-height column or full-width row) |
| `Ctrl+W` then `[ ]` | previous / next tab |
| `Ctrl+W` then `< > + -`, `=` | resize, even out |
| `Ctrl+W` then `z` / `x` / `s` | zoom, close, swap with next |
| `Ctrl+W` then `o` + a kind | open a tile beside: `t` outline, `r` reader, `d` detail, `p` preview of this tile, `e` editor (on the daily draft), `s` shell, `k` board, `v` river, `f` brief, `h` children (the replies: a links tile with Children alone), `a` activity, `w` who, `b` bulletin, `l` backlinks of this tile, `q` the cards of the view this tile shows (a query tile) |
| `Ctrl+W` then `O` + a kind | the same, as a tab of this tile |
| `Ctrl+W` then `v` / `V`, `O` in a reader | a reader beside / below this tile where its opens land (`tile.preview`): a link followed in a reader, the tree's `⏎`, a list's pick show there and the tile keeps its note. A reader's is a detail; a terminal's follows its file, the board's its card, anything else's its selection. `O` puts it beside a wide reader, else below. Again, it shows that preview (unfolded, its dock open) and gives it the keys: on a tile whose opens already land in one (the daily desk's outline → `middle`) it's a jump there, and `^W o p` still adds a follower preview. Refused on a river column (its opens already open the next column); `alt+l` on the tile itself unlinks |
| `Ctrl+W` then `p` / `d` | dock this tile (its tab set, as one) to an edge where it is, or undock it back into the layout (`tile.dock`) / slide the dock open or shut (`tile.slide`). A dock stays on this screen, slides over the others without moving them, shuts when the keys leave it, and holds anything moved into it |
| `Ctrl+W` then `c` / `f` | fold this tile to a spine where it is (a tile side by side with others), or open it / pop it out as a float over everything (its title drags it, `◢` sizes it, `H J K L` step it), or put a float back in the layout. `^W p` on a float puts it straight into a dock |
| `Ctrl+W` then `a` | put this tile in your drawer: it leaves the screen whole (a terminal's program keeps running) and joins the drawer, which comes up on it; in the drawer, `^W a` takes the tab out into the screen shown, beside your tile, its own first tab too (`tile.drawer`) |
| `Ctrl+W` then `A` | bring the drawer's tab shown (a terminal in the drawer you were typing in, say) into this screen beside this tile (`tile.drawer on=false`) |
| `Ctrl+W` then `W`, a click on a flow column's spine | give this tile's flow column the wide place (`tile.widen`): the flow is laid out around it, the column you were reading stays full beside it; moving the keys between columns never moves a column |
| a click on a header's `⇤ docked` | undock it where it is (the dock goes, its tiles back in the layout) |
| `Ctrl+W` then `P` | the policy panel: the containers over this tile (the screen first) and what each allows: locked, draggable, droppable, resizable, accepts, opens into, fixed/min/max size, and a dock's collapsible, overlay, stays and edge (`⏎` or a click changes a row, `h l` picks the container, `+ -` change a size) |
| `Ctrl+W` then `r` / `w` | load a layout by name / save this one by name |
| `Ctrl+W` then `.` | this tile's menu (`tile.menu`), as its `⋯` and a right-click in it open it |
| `Ctrl+W` then `!` | drop to shell: your login shell in this terminal, the desk back as it was when it exits (the menu's `!`); for a shell in a tile beside the notes, `^W o s` |
| in a terminal tile: `ctrl+]` | back to the door's keys (every other key, `ctrl+c`, `^W`, F-keys, shift- and ctrl-arrows and pastes included, is the program's); `ctrl+]` twice sends a `ctrl+]` to the program |
| in a terminal tile: `shift+⏎` | a newline in Claude Code and most line editors: `CSI 13;2u` to a program that asked for the Kitty keyboard protocol (Claude Code does), `ESC CR` (as `alt+⏎`) to one that didn't; plain `⏎` is always `CR`. The door reads Shift only from a terminal with that protocol: it asks for it at start (Ghostty, kitty, WezTerm, foot have it; so does Herdr 0.9 for its panes, over ssh too) and gives it back on exit, `$EDITOR` and drop to shell. `EP0CH_KEYBOARD=legacy` doesn't ask. Elsewhere `shift+⏎` is `⏎`; in a draft it's a plain line break, as `alt+⏎` |
| `ctrl+e` in a reader | edit the note in `$EDITOR` in a terminal tile beside it; the draft comes back when it exits |
| `/` | the power bar in its notes scope: the service's one search, the hit read on the right |
| `q` | back to the menu; programs running in tiles keep running, and `D` brings the same desk back |
| `Esc` | closes the innermost thing (a picker, the tile menu, a chord, link mode, a dock, a zoom, a float's keys); never leaves the desk: with nothing left it says `nothing to close · q leaves` |

**Layouts** are screens saved by name: `^W w` (`act screen.save name=…`) writes the screen as a screen note in the
outline (name it the way you'd say it: `daily test` is kept as typed and opened as `daily-test` or "daily test") ([Screens you make](#screens-you-make)), and `^W r`, `alt+d` for `daily`, or `act layout.load name=…` lays the
desk out as one. Built in: `daily` (an agent
terminal over the "now" detail; the outline over its preview, above the middle detail; the editor on the
daily draft over a third detail; the outline, "now" and the right detail open into the middle), `river`
(the river's flow of columns, a preview following the column with the keys), `board` (the kanban with a preview tile
following its card) and `desk`. Loading keeps tiles with the same name (a running program, a reader's note);
running programs or unsaved edits the new layout has no place for go in one shut dock on the right, never ended.

### Screens you make

`M` on the main menu (or `ep0ch --screen blank`, `act screen.open name=blank`) opens a **blank screen**: one tile that
offers the first step as rows, each a key, a click and an action (`blank.fill`): `t` the outline, `r` a reader, `d` a
detail, `s` a terminal, `Q` a query lane (you pick the saved view) in its place, or `o` a screen to open. Build the rest
with the desk's keys (`^W o`, `^W v`, `alt+l`, drag a header), then `^W w` (or the `⋯` menu's *save this screen as…*,
or `act screen.save name=<name>`) saves it as a **screen note** (the prompt shows the name it saves as, or why it can't): a note `<title> [type::screen] [screen::<slug>]` in the
outline whose `json` code fence holds the screen's spec (what `screen.spec` answers). It travels with the outline: every
door on it lists it (`screen.list`, the blank tile's `o`, `^W r`) and opens it (`ep0ch --screen <name>`,
`act screen.open name=<name>`), and an agent can read it. `^W w` on it again saves over the same note, checked against
the revision the door read; a built-in screen's name, or one two notes share, is refused with the notes' ids. Leaving a
screen of your own with changes not saved asks first. `act screen.delete name=<name>` (or trashing the note) takes it
away. Layouts saved before this in `layouts.json` come across once with `bun scripts/import-layouts.ts --ws <name>`.

**Containers and policy (PIE-505).** A layout is a tree of tiles in containers: splits, tab sets and docks. A
dock slides out from an edge (`act tile.dock tile=tree edge=left`, or the policy panel's edge row) and takes
anything dropped into it: the tree, claude and a detail can share one. Every container, and the screen itself,
carries a policy saved with the layout (`layout.policy`, `^W P`): `locked`, `draggable`, `droppable`,
`accepts` (tile kinds), `resizable`, `min`/`max`/`fixed` cells, a dock's `collapsible`, `overlay` and edge, and
`opensInto` (where its tiles' opens land when they have no link: a tile, or a container's key, where an open
lands in a tile opened there), `keep` (how many such tiles it keeps), `shuts` (a close in it shuts its dock),
`opens` (the open rule: `current`, or `next`).
A locked screen comes back locked after a restart. A **flow** (PIE-513) is the river's columns as a container: an
open from one of its tiles (a link followed) lands in a new column right after its own, the columns squeeze full,
peek or spine around the wide one, and only `^W W` (or a click on a spine) moves the wide place. A layout saved
with one (`{"t": "flow", "kids": [...]}` in a screen note's layout) works on the desk; the River is one (PIE-515).
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
`EP0CH_DAILY_AGENT` (the drawer's own program; unset, a shell), `EP0CH_DAILY_CWD` (the folder it starts in; unset, the
rule in [The drawer](#the-drawer-pie-498)) and
`EP0CH_DAILY_DRAFT` (default `scratch.md` in the door's state) set the drawer's program and the daily draft; the editor is `$VISUAL`, `$EDITOR`, else nvim or vi.
The agent has one home, the host layer (the drawer, below): the daily layout has no tile for it, and lets
the drawer sit beside the desk (its policy's `host: beside`). A layout saved with the old agent tile (marked
`agent`, or in a `daily` desk a `claude` tile whose command is the plain `claude`) comes back without it, beside
the drawer; a terminal you made yourself stays yours.

**What happens to programs in tiles:**

| When | Programs in terminal tiles |
|---|---|
| `q`, going to the menu | keep running: the desk stays alive in the background, and `D` on the menu brings it back as it was |
| `!` / `^W !`, drop to shell | keep running while your shell has the terminal (the door keeps reading them and answering its control socket; it paints nothing) |
| `^W x` on a running program's tile | asks first; again within 3s closes the tile and ends the program |
| the program exits while you're in its tile | the tile keeps your keys: `⏎` runs it again, `^W x` closes it (at once: nothing runs), `ctrl+]` goes back to the door (in the drawer, `Esc` too), other keys wait. A tab in the drawer closes by its `×` too |
| loading a layout | a tile with the same name keeps its program; ones the layout has no place for go in a shut dock on the right |
| detaching from a session (`ctrl+c`, logging off with `G`, closing the terminal, a dropped ssh; see [Sessions](#sessions-quit-is-detach)) | keep running, scrollback and all: the next `ep0ch` attaches to them. `E` on the main menu or `ep0ch session end` ends them with the session (asking first) |
| quitting a door in its own terminal (`--no-daemon`: `ctrl+c`, logging off from the menu) | asks twice (it names what's running), then ends them. nvim with unsaved changes keeps them in its swap file and offers to recover them next time; without, it leaves nothing behind |
| SIGINT, SIGQUIT, SIGTERM or SIGHUP, or a crash | they end with the door. First, unsaved edits and comments, and the text of a `ctrl+e` editor still open, are copied to `drafts/` in the door's state, the terminal is put back (alt screen, mouse, paste mode, cursor), the control socket is removed, and the door says where the text went. A crash prints its error on the normal screen and exits 1 |
| `kill -9` | nothing in the door runs: a small watcher it started puts the terminal back, and the next door sweeps the stale control socket and copies a `ctrl+e` editor's file to `drafts/` (saying so). Unsaved drafts in the door's memory are lost |
| a restart | a layout's terminal tiles start their programs again (claude, nvim on the same file); a `ctrl+e` edit tile isn't restored (its file was copied to `drafts/` when the door ended) |

### The daily agent in Herdr

Choose an agent "in Herdr" in the drawer's picker (`alt+g`; `host.agent name=claude herdr=true`) and the drawer's
own tab runs it in a Herdr pane of this outline's session and shows it. Herdr lists it (`herdr agent list`), other
agents message it (`herdr agent prompt door-<outline>-<hash> "…"`), and it keeps running when the door quits.

- **Where it runs.** The launcher (`scripts/door-agent-herdr.ts --session <outline>[@machine] --agent <agent>`)
  looks on the default Herdr server (`HERDR_SOCKET_PATH`, else Herdr's own default) for this session's own pane,
  labelled `door-<outline>-<hash>` (`door-pie-hole--float-2-<hash>` for one on a machine; a long name is cut). The
  hash is of the exact `outline@machine`, so two outlines that read alike never share a pane; the pane's Herdr id is
  written down beside its link (`agent-door-<outline>-<hash>.sock.pane`) and attach, typing and a session's end go to
  that pane.
  Sessions are one per outline, so each has its own agent, started with that session's `EP0CH_CONTROL`: a door on
  another outline never attaches it.
  - If the pane isn't there, the launcher makes it: a tab in the workspace labelled `door` (made too if
    missing), in the drawer's folder, without taking Herdr's focus.
  - It starts the agent there inside your login shell (`$SHELL -l -c '<agent>; exec $SHELL -l'`): `/exit`, or a
    crash, leaves a working shell in the pane, never a dead one. Once Herdr detects the agent, the launcher names
    it like the pane.
  - Ending the session (`E`, `ep0ch session end`) closes its pane; never another session's, never an old `door-claude`.
  - `EP0CH_HERDR_PANE`, `EP0CH_HERDR_NAME` and `EP0CH_HERDR_WORKSPACE` change those three names.
  - Only your own door uses them: the default state dir with its control socket in it. A door on its own
    `EP0CH_STATE` or `EP0CH_CONTROL` (a test door, the showcase) starts no Herdr agent and says why; with
    `EP0CH_HERDR_SCOPED=1` it adds a second hash, of that state, to all three
    (`door-garden-1a2b3c4d-5e6f7a8b`, workspace `door-5e6f7a8b`). Either way it
    never attaches to, or types into, your own panes.
  - Two doors starting at once make one pane: the wrapper looks for it and makes it holding a lock beside the
    link below (`agent-door-<outline>-<hash>.sock.lock`).
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
    the session's `door-<outline>-<hash>` pane in the `door` workspace, named the same in the agent list. Open it there to carry on.
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
    `src/desk/agent-env.ts`): `EP0CH_NEST` (the tile's, then `herdr:door-<outline>-<hash>`), `EP0CH_TILE`,
    `EP0CH_TILE_ID`, `EP0CH_IN_DOOR`, the door's `EP0CH_STATE` and `EP0CH_SOCKET` when it has them, and an
    `EP0CH_CONTROL` that is a link in the door's state
    (`agent-door-<outline>-<hash>.sock`). The launcher points the link at its door's socket each time it attaches.
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

The current layout is saved to `desk.json` in the outline's folder of the state dir
(`~/.local/state/ep0ch-door/sessions/local/<name>/`; see [Sessions](#sessions-quit-is-detach)). A drag in a reader
selects and copies its text through the door ([Selecting and copying text](#selecting-and-copying-text)); in a
terminal tile your terminal's selection modifier (Shift in Ghostty) selects what that program drew. Under tmux,
`set -g set-clipboard on` lets the door's OSC 52 copy reach your clipboard.

### The drawer (PIE-498)

Your drawer stays with you on every screen: the menu, the BBS screens, the desk, the kanban, the Quay and the
welcome. It's your tabs above every screen (the host layer's). Its first tab is its own program, and any
tile can join it and leave it again: a terminal with a Claude in it, a reader, the tree, a query tile. The chip at
the start of the status bar's right part, `▲ claude` (`▲ shell +2` with two tiles in it), pulls it up.

- **What its own tab runs: your choice, per outline.** `alt+g` (or `host.agent`) opens a picker of the agents
  installed here (`claude`, `codex`, `pi`, `gemini`, `opencode`, `aider` and the rest of Herdr's agent kinds found
  on your PATH), each also "in Herdr" when Herdr is installed, and a shell. The choice is saved for this outline's
  session (`drawer-agent.json` in its folder of the state dir; `host.agent default=true` makes it the default for
  every outline). Pulling the drawer up with nothing chosen yet offers the picker; until then it's a shell.
  `EP0CH_DAILY_AGENT` overrides it for one door. A new choice starts at the tab's next start: what runs now keeps
  running (`alt+R` starts the new one in its place). `ep0ch doctor` lists each session's drawer agent, where the
  choice came from, and the command to change it.
- **No dead panes.** Every agent, in the drawer or in a terminal tile, starts inside your login shell. When it exits
  or crashes, the tile says so (`claude exited · shell`) and is your shell, in the same folder with the same
  environment: `claude --resume`, `claude --continue`, another agent, anything. Nothing restarts it behind your back.
- **Your look.** Spacing and list density come from notes in the outline (PIE-673): `[style-for::global]`,
  `[style-for::tile:detail]`, `[style-for::screen:desk]` or a name a page uses (`[style::airy]`), with fields such as
  `[style.measure::72] [style.pad::1] [style.list.gap::1] [style.list.divider::dots]`; a page's own fields, and a box in a
  note (`::box{margin.x=4 list.gap=0}` … `::`). The nearest wins: built-in, a heading style, global, the tile's kind, the
  screen, the page, a box. `measure` holds a note's text to that many columns, centred (a reader's is 88 unless the
  outline says otherwise); `pad` is inside a tile's frame, one row and two columns per step (cells are about twice as
  tall as wide); `[style.narrow.…]` and `[style.wide.…]` apply under 60 columns and from 140. `alt+y` opens the tune
  inspector beside a tile: each value and where it comes from, nudged with `+ −` (a click, the wheel over a value) and
  drawn in the next frame, saved with `s` where it's set or to the level you pick (`v`), `w` for this width only, `u`
  undo and `U` redo every step, `x` resets a value to what it inherits, `X` resets the picked level and `R` reverts every style note the session wrote (both asked in place); quitting with nudges unsaved says so. Spacing is drawn, never text: a drag, `y` and `Y`, `select.copy`,
  `peek` and `ep0ch export` give the note's words. **Known limit:** a terminal's own selection (a shift-drag in kitty,
  tmux or Herdr copy-mode) copies the screen's cells, so the margin and the measure's centring come as leading spaces and
  the gaps as blank lines; the door can't see that copy. Use the door's own drag, which copies the text over OSC 52; the
  default insets are kept small for this.
- **Surfaces and frames.** A tile or a `::box` can sit on a surface, `[style.bg::raised]` (`sunken`, or a tone: blue,
  green, violet, amber, coral, neutral) at `bg.strength` 1 to 6, with a frame (`border`: line, round, heavy, double, none)
  and an accent in its `tone` (`edge`: a bar down its left side, or the frame). Surfaces are theme roles, drawn dark in
  every theme with every word at 4.5:1 or better on them (test/theme-contrast.test.ts), never a colour of a note's own; a
  tile's yields under a header's picture. A list's divider is `line`, `dots`, `dashed`, `double`, `fade` or `glyph`
  (`list.divider.glyph`), at the top, centre or bottom of the gap (`list.divider.align`); the zebra stripe takes
  `list.zebra.bg` and `list.zebra.strength`. A reader's header takes `header.bg` at `header.bg.opacity`, and
  `header.image` (one of the note's pictures, or a path) with `header.image.x` and `.y` moving its crop. A list's own look goes on its section's heading or its lead-in line
  (`## Seed trays [style.list.gap::1]`), and one tile's own is kept in its tile spec, so a single list or a single
  links tile can be airy while the rest stay tight ("this list" and "this tile" in the inspector). Any field can
  give three widths at once: `[style.pad::0 1 | 1 3 | 1 6]` (narrow, normal, wide). (PIE-675)
- **What changed.** The status bar's `+N new` is the notes an agent, another client or an extension changed since you last
  looked (your own edits aren't news), from the service's change feed. A click on it, or `alt+o`, opens the **what-changed
  list** as a tab in your drawer (`changes.open`): who changed each note, what and when; `⏎` or a double click opens the note
  where opens land, `alt+⏎` or an alt-click in a new detail, `d` shows the change under the row, `x` marks it seen. Looking
  marks what it holds seen (kept per outline, so a restart starts from there); an agent's open never does.
- **What waits on you.** A program in a terminal tile can say what it's doing (OSC 7501, the Program Status
  Protocol): working (with its progress), blocked on you (a permission, a question, a login), done, or failed. The
  tile's header and tab show it as a glyph (`◴ 40%`, `◆`, `?`, `✓`, `✗`), the chip says it (`▲ claude · needs you`), and
  the status bar counts what waits on you (`◆1 ✓2 on you`). A click on that count, or `alt+w`, opens the
  **waiting-on-you list** as a tab in your drawer (`host.waiting`): every terminal's blocked, failed and finished work,
  most urgent first; `⏎` or a click goes to that terminal, `x` marks it seen. Being back in a tile (a key, a click)
  is seeing it: its done goes. Claude Code reports through the ep0ch mod (a permission dialog, a question, done at its
  answer), and so do `ep0ch install --apply`, `ep0ch backup run`, `scripts/box-test` and `scripts/agent-env --test`;
  without reports, the chip still guesses from the program's output, as before. The door reports its own to the
  terminal it runs in when that terminal speaks the protocol (Ghostty, Rex): the most urgent across its tiles, and each
  tile as a child by a key it keeps wherever it moves (`claude.3`; at most 63, most urgent first; progress in tens). A
  detached terminal is cleared, an attached one told everything. `EP0CH_PROGRAM_STATUS=0` turns its reports and its query off.
  Done is the person's: an agent reading or acting on a tile never clears it. A shell without prompt marks (OSC 133)
  still loses a finished job's working: on Linux the door sees the shell take the terminal back.
- **A new shell, here.** `alt+s` opens a new shell as a tab in the drawer, in its folder (`host.shell`). It starts in `EP0CH_DAILY_CWD` when
  you set it; else the folder of the `.ep0ch` naming this outline above where the door started (the project); else
  the outline's own folder (`~/outlines/<name>/`); else where the door started. `ep0ch doctor` says which and why
  (`drawer  runs … in …`). Claude Code's `/resume` lists one folder's conversations, so the folder is yours or the
  outline's, never one made up.
- **Putting a tile in.** `^W a` on it, or drag its title onto the chip (or onto the open drawer: it says `into your
  drawer: travels with you`), or press `a` while dragging it. It leaves the screen whole: its program keeps running (the same pid), a reader keeps its note,
  history and draft. The drawer comes up on it; your keys come along when you were typing in it. `act tile.drawer
  tile=<t>` does it for an agent, attributed, never with your keys: an agent's tab goes in behind the one shown,
  the drawer stays as it was, and an agent never moves the tile you're typing in or have.
- **Leaving a screen with programs running.** A screen you leave with a terminal still running in it puts that
  terminal in your drawer instead of refusing (`shell went into your drawer · alt+a shows it`); an unsaved edit
  still asks.
- **Taking it out again.** `^W a` in the drawer, `^W A` on the screen (the drawer's tab shown comes beside your tile:
  the way back for a terminal in the drawer, whose keys are its program's while you're in it), or drag its tab's title out over the screen: it lands by the screen's
  own drop zones (a side splits, a header or the centre makes tabs, the outer edge a column). `act tile.drawer
  on=false tile=<t> to=<tile> where=<side>`. The drawer's own tab can leave too: it becomes an ordinary terminal tile
  on the screen, its program still running, and the drawer starts a fresh own program the next time it's pulled
  up. `^W x` doesn't close the drawer's own tab: it says so, and what to do instead.
- **Followers follow.** A preview following a tile (`source=tile:tree`) keeps following it into the drawer and back.
- **In the drawer.** Its tiles are tiles: a reader in the drawer reads and edits, a tree in the drawer opens, a terminal in the drawer
  types, and `^W P` opens the policy panel. Click a tab to show it (`^W ] [` between them). `Esc` or `ctrl+]` gives your keys back to the screen.
- **It persists.** What's in it is saved in `drawer-tiles.json` in the outline's folder of the state dir, and comes
  back in the next door. In a session, a terminal in the drawer's program survives `ep0ch session upgrade`: the terminal
  host keeps it under the key it started with, and the drawer adopts it.

- **Pulling it up.** Click the chip or press `alt+a`. The agent slides up over the lower half of the screen,
  and your keys go to it. The screen under it isn't redrawn smaller: the drawer lies over its
  bottom rows, as the desk's docks lie over its tiles.
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
- **One agent, one home.** Its own tab runs the agent chosen for this session (in Herdr: the session's own pane), and it starts the first time you pull it up. It's the host layer's (PIE-513): a layout on the same
  engine as the screens, a dock holding a tab set whose first tab is the agent, above every screen. No screen has a
  copy of it, so one door never attaches twice; leaving a screen never ends it.
- **What it's doing.** The chip says `working` while the agent writes to its screen and `idle` after. With the
  agent in Herdr, it's Herdr's own state (`herdr agent get`, every few seconds): `working`, `idle`, or
  `needs you` when Herdr says it's blocked. `exited` once the program has ended (`⏎` in the drawer runs it again).
  `watching` when another door (a second ssh session, say) is attached to the agent's Herdr pane: this door only
  watches it, and the drawer says that `⏎` in it would take the pane from the other door.
- **It persists.** Whether it's up and how tall are saved in `drawer.json` in the door's state. The next door
  shows it where you left it (not entered). With Herdr it's the same session on every screen and after a restart.
- **What it knows.** After its state the chip says what the agent knows: `▲ claude · idle · door tools` when
  it started in a door (with `EP0CH_CONTROL` and the rest) after the Outliner's Claude mod last changed. A
  running Claude never picks up a new mod or new variables, so when the mod changed after it started (a
  `git pull` in the Outliner), or it was started without the door's variables (by an older door, say, in a
  Herdr pane made before), the chip says `started before update ⟳` (or `no door tools ⟳`). The door reads
  this from the agent's own process: its environment (`/proc/<pid>/environ` on Linux, `ps eww` on macOS; in
  Herdr, the process in the session's pane, `herdr pane process-info`) and its start time, against the
  newest file of the mod Claude Code loads (`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`), every 15s.
  `agent.knows` says the same, with why.
- **Restarting it.** A click on `⟳` (the chip's last cell), `alt+R`, or `agent.restart`. Only that agent's
  process is asked to exit (SIGTERM; SIGKILL after 8s), then the same command runs again, keeping the
  conversation: a bare `claude` is given `--continue` (only by this explicit restart; a fresh start is plain
  `claude`). With the agent in Herdr, its pane closes with it and the launcher makes the session's pane again,
  with today's variables, and starts it there, continuing. An agent's `agent.restart` is refused while you're typing in the agent, or
  within 10s of your last key in it.
- **Agents.** `host.toggle [open=true|false]` and `host.size share=0.2…0.9`, `agent.type text=…`, `agent.knows` and `agent.restart` work on every screen through
  `ep0ch act`. An agent's pull waits until you've been idle 2s and you aren't typing, is said on the status bar
  and in the drawer's title (`pulled up by an agent (<id>)`), and never gives the agent your keys. An agent can't
  put it away or resize it while you're typing in it.

## The board

`K` on the menu, or `ep0ch [--ws <name>] --screen board [<hub-block-id>]`. Any block with two or more virtual-branch
children is a board; `g` picks one. The last board per outline is remembered.

- **Lanes** are saved views, read by the service with `views.read` (see "On the service platform"). A lane
  says `of N+` when truncated or `invalid` / `failed` with the reason instead of looking empty. The door
  doesn't evaluate views itself.
- **One preview** follows the selected card. **⏎** opens into the detail; **alt+⏎** opens a second detail.
- **Order a lane by hand.** A view with no `[sort::]` keeps a hand-set order (the order its lane, its figures
  and Tree show). **`alt+↑` `alt+↓`** move the selected card up or down it, and a card dragged up or down its
  own lane goes where it's dropped (the hint says above or below which card). Both are `card.reorder`, recorded
  as yours; an agent's never moves your cursor. A sorted lane refuses and says which `[sort::]` to remove.
  From a shell: `ep0ch view order <view> [<id or Work ID>…]`.
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
- **Resize** by dragging any border: between lanes, between preview and details, lanes/readers, dock edges.
  The edge you grab stays under the pointer; on a header row the title is the grip that moves a tile, the bare
  line after it the border. Keys: `{ }` lane height, `< >` width of the focused lane, reader or outline dock.
- **A preset on the desk** (PIE-511): the board is a screen on the desk's one layout engine
  (`src/desk/layout.ts`). Its lanes are query tiles in a columns container whose tiles come from the hub
  (`hub:<id>`: one per view, kept by view as views come and go); the readers row is the preview, then the
  details; the outline (the tree over its preview) is a dock on the left, the backlinks (the list beside
  its preview) a dock at the bottom; floats sit over it all. The lanes' policy keeps their tiles (draggable
  off), takes only query tiles and opens into the preview: `^W P` changes it, and a lane let go can be dragged
  anywhere, still a lane. Every desk key works here too (`^W` splits, tabs, zoom, lock, `/` search), and a desk
  tile can sit beside the lanes (`^W o`). `peek` and `layout.get` show the tree; agents change it with the
  `tile.*` and `layout.*` actions, which never close or float the tile that has your keys.
- **`o`** pops the focused reader out as a float (the preview floats a copy): drag its title to move, drag
  `◢` to resize, `H J K L` to nudge, `o` again or a click on the `⧉` before its title to put it back as a
  detail, `x` to close. `x` on the preview says why it stays (the readers row's policy: it collapses with `c`).
- **`t`** outline dock with its own preview underneath; slides over unless undocked (`T`, or a click on
  `⇤ docked` in its header: undocked, it becomes part of the layout); `S` moves it to the other side so it
  doesn't cover the preview. Shut, it's a handle at the end of the hint row (`⇤ outline`): a click opens it.
- **`b`** links dock under the readers: the note's outlinks, resources and backlinks, the list beside its own
  preview of the selected row (a backlink's quoted snippet in its title; a resource's stored content); it stays
  open while you read a source in a detail. `B` undocks it into the layout (and docks it again); ⏎ / alt+⏎ or a double click / alt-click
  opens one in a detail, a click only selects it. A link clicked in either dock's
  preview opens in a detail too. It shows what Detail's Backlinks panel shows (PIE-442, the service's
  `references.backlinks.facets`): this note and its descendants hidden, resolved comments hidden, sources
  grouped by kind with stage counts (`+ Outbox item 10 (2 waiting · 1 draft · 7 done)`), open items first
  and then by date, one line each with a dim breadcrumb and `Work ID ×N`. A group starts folded to its open
  items. The status line keeps the counts adding up (`18 of 23 match · 3 this note hidden · 2 resolved
  hidden · Kind: all · Stage: all · Sort: Updated ↓`); click any of its controls, or use Detail's keys:
  `/` filter as you type (⏎ keeps it, esc undoes it), `s` sort (updated, created, title), `h` resolved,
  `n` this note, `.` or space folds a group (⏎ or a click on its header too). Detail's `k` and `t` are the
  board's up and outline dock, so kind is **`K`** and stage is **`w`**.
- The board's layout (sizes, docks undocked or shut and their sides, collapsed lanes and preview) is saved to
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
the same plan's answer.

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
  note: `Ctrl+S` creates, `Ctrl+X Ctrl+E` hands it to `$EDITOR`, `Esc` twice puts it aside and `n` in the lane
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
frame, the same status line, the same keys (`Ctrl+S`, `Ctrl+X Ctrl+E` to `$EDITOR`, `Ctrl+A` `Ctrl+E` to the line's start and end, `Ctrl+T` to a picker, `Esc`, twice when unsaved).
The board's new-card composer is the same control too.

| Keys | Action |
|---|---|
| `e`, then `⏎` (or `e` again) | edit in place; the draft is the note's whole text: subject line, body and `[key::value]` properties. The first `e` only asks (`edit.arm`): the status bar says `edit <title>? ⏎ · any other key cancels` and the reader's frame and title turn the edit's yellow (`✎ edit?`; in the BBS reader its `Subj:` line). `⏎` or `e` within 2 s opens it; any other key lets it go and does what it does (`e` then `j` scrolls), and the 2 s running out lets it go quietly. A stray `e`, or one typed into the wrong tile, never opens an edit. The tile menu's `edit` row, a click on the hint row's `e` and an agent's `edit` open at once. `ep0ch act edit.arm.set on=false` turns the asking off (`on=true ms=<n>` sets the wait), kept for the next start; `EP0CH_EDIT_ARM` (`off`, or the wait in milliseconds) overrides it |
| `Ctrl+E` (then `⏎` or `Ctrl+E`), while reading | edit the note in `$VISUAL` / `$EDITOR` (then `vi`); what comes back replaces the draft. It asks first, as `e` does |
| `Ctrl+X Ctrl+E`, or the tile menu's `edit in $EDITOR`, in a draft | hand the open draft (an edit, a comment or reply, the board's new card) to `$EDITOR` at once (`edit.external`, bash's own chord); what comes back replaces it |
| `Ctrl+A`, `Ctrl+E` (`Home`, `End`) | the start and the end of the line: a Mac terminal sends them for `Cmd+←` and `Cmd+→`. `Ctrl+K` cuts to the end |
| `Ctrl+T`, or a click on `[insert]` | **insert from a picker** (`draft.pick`, src/pick.ts): `tv ep0ch` (television's outline channel, from `ext/television`) opens in a terminal tile beside the note, with your keys (on a screen without tiles, or a locked one like the board, it takes the terminal), and what you choose there (Tab picks several) goes in at the cursor, space-separated: `((id))` for a note, `[file::path]` from `ep0ch-files` (`ctrl-t` in tv switches channel, `ctrl-s` between its Tree, Recent and All); the tile closes when tv does. `EP0CH_PICKER` names another picker (`fzf -m`), `EP0CH_PICK_CHANNEL` its argument (empty for none). In a comment or reply and the board's new card too. The person's only: an agent writes with `draft.patch` |
| `Ctrl+S` | save |
| `Ctrl+R` | after the note changed elsewhere: load the current text (your draft is copied to disk first) |
| `Esc` | close; with unsaved changes it asks for a second `Esc`, which **puts the draft aside** (below); with a selection, the first `Esc` only lets go of it; an edit opened by mistake (a few stray characters, below) closes on the first |
| `Enter` | on a first line of only `[page::x]` (and other properties), the title `x` goes in front first (PIE-544; the save does the same, below). Then a new line; on a list item (`-`, `*`, `+`, `1.`, `1)`, `- [ ]`, at any indent) the next item at the same level: numbers count up, a checklist step starts unchecked. On an empty item it goes up to its parent's level (continuing the parent's numbers), and at the top level the list ends. An indented line keeps its indent. A marker you type yourself on the new item replaces it (`- ` then `- ` is one bullet) |
| `Alt+Enter` | a plain new line, no list continuation |
| `Tab`, `Shift+Tab` | indent or outdent the line (or every line a selection touches, nesting kept): an item goes under the item above it, lined up with its text, and back out to its parent's level. Inside a draft `Tab` never moves focus; `Esc` (or `Ctrl+S`) is how you leave |
| `↑ ↓`, `PgUp PgDn` | move by the rows drawn: a wrapped line is several rows, the column kept |
| `Ctrl+P`, or a click on `[preview]` | a live preview of the Markdown under the draft, drawn by the readers' own renderer |
| the wheel | scroll the draft to reread; the cursor stays where it was, and the next key brings it back into view |
| a click, a drag | put the cursor there; a drag selects (for `Tab`, `Shift+Tab`, typing over it or deleting it) and copies it when the button comes up (copy on select, as in a reader); a double click selects the word, a triple click the line, a shift+click from the cursor |
| `Shift+←→↑↓`, `Shift+Home`, `Shift+End` | select from the cursor as it moves |
| `Cmd+C`, `Alt+C`, or a click on `[copy]` | copy the selection to your clipboard (OSC 52), said `copied N chars`. `Cmd+C` reaches the door only through the Kitty keyboard protocol; `Alt+C` works in any terminal, tmux too |
| `[[`, `((`, `[file::` while typing; `Tab` or `Ctrl+Space` | reference completion: keep typing to filter, `↑↓` or the wheel choose, `Enter`/`Tab` or a click inserts, `Esc` dismisses |
| `[` and a key's first letters (`[head`), `[key::`, or a line of a `::graph-*` block's YAML | property completion (PIE-618), from the component schemas (below): the keys with where they go and what they mean, `Enter` writes `[heading-pattern::` and its values open at once, each with its meaning and a one-row preview of what it draws (a style's glyph track); `[heading::` lists the built-in styles and the outline's own. A `[` that starts no key a schema knows (a Markdown link's text) opens nothing |
| `Ctrl+Z` | undo the newest change (PIE-621): typing a word at a time (a word and the space after it, or up to a pause), a paste in one step however big, an insert, `$EDITOR`'s text, a reload, an edit an agent patched in (below). Back to where the draft started, and past a save: open the note again unchanged and `Ctrl+Z` goes on back. A paste over 20 lines or 2 KB says `pasted N lines · ctrl+z undoes` |
| `Ctrl+Y`, `Ctrl+Shift+Z` | redo what `Ctrl+Z` took back; any new change drops it. `Ctrl+Shift+Z` needs the Kitty keyboard protocol, `Ctrl+Y` works everywhere |
| `A`, while reading | apply anyway: the edit an agent proposed when its patch couldn't apply, on the proposal shown or its embed as the current element; a click on `[apply]` on its embed's source line or in its header does the same. A proposal whose passage was already gone has no `[apply]`, and `A` says why. Anywhere else (not a proposal, nor its embed or control) `A` isn't taken |
| `X`, while reading | dismiss it: the proposal goes to Trash and its embed line comes out of the note, as an edit by you; or a click on `[dismiss]`. Like `A`, taken only on a proposal |

- **Nested lists** (PIE-496): long lines wrap at spaces, never mid-word, and a list item's continuation
  rows hang under its text, not back at the left edge. The wrap is only drawn: the saved text is what you
  typed. Pasted text goes in as it came: a pasted line break or tab never continues a list or indents.
- **Nothing you type is lost.** `Esc` twice on unsaved text doesn't drop it: it's **kept where you wrote it**
  (an edit on its note, a comment on its note, a reply on its thread, a new card in its lane) and copied to
  `~/.local/state/ep0ch-door/drafts/`. The status bar says where. Opening the same draft again (`e`; `C` and a
  passage; `r` on the thread; `n` in the lane) brings the text back. `Esc` twice on text that came back unchanged
  lets it go, and says where its copy stays. Closing a screen, quitting and a dropped connection (`SIGHUP`) keep
  drafts the same way. A new card is kept in its lane on its own board: another board's lane of the same name doesn't
  bring it back (a lane's header says `■ card kept`). An agent's edit or comment never picks up your text.
- **A kept edit says what it changes, and asks for nothing (PIE-637).** Under the reader's header, a calm grey line
  answers from a three-way comparison: the edit's own changes (the text it started from → the draft) against the note
  now (src/unsent-compare.ts). The text it started from is the draft's own, else the note at the revision it was written
  on, else that revision from the note's history, so twelve later revisions of other changes bury nothing. Each change
  is **already in the note**, **still new** or **changed differently since**:
  - nothing new: it settles by itself when you open the note. A copy is kept (`drafts/`) and one dim line says
    `your edit on Oct 1 was already in the note; kept a copy`. Nothing to answer.
  - something new: `2 lines from your edit on Oct 1 aren't in the note` with `[show them]` (a reader beside with only
    the edit's own changes, each marked, the answer first), `[add them]` (the new lines into an edit as one patch:
    ctrl+z takes it back, ctrl+s saves; newer text is never overwritten), `[keep as a note]` (a note under this one
    with the whole text) and `[let it go]` (the copy stays on disk).
  - changed differently since: `1 line … was changed differently since` with `[compare]`, which shows both versions.
  - no starting text anywhere: the comparison is two-way and says so (`differs from the note in 3 lines · its starting
    text isn't kept`), and nothing settles quietly. An edit on an older revision more than three days old folds to
    one dim `■ 1 old edit · [show]` chip. All by a click, `[ ]` then `⏎`, the tile's `⋯` menu or `act unsent.*`; the
    exit message says it the same way (`the edit to “…” is kept here, not saved`).
- **An edit opened by mistake isn't put aside.** `e`, then a `j` or `q` meant for the reader, becomes text; so an
  edit open under ten seconds with at most three characters typed into it and nothing taken out closes on the
  first `Esc`, says `dropped 2 stray characters · ctrl+z brings them back` and leaves no kept line (its copy
  still goes to `drafts/`). `ctrl+z` within a minute opens the edit again with them. Anything more is a real edit
  and keeps the `Esc` twice (src/stray.ts).
- **Click away, as in any editor.** A click inside the draft places the cursor; a click anywhere else
  leaves the edit and does what that click does (focuses a tile, opens a row or a link, opens a dock).
  An unchanged edit just closes; a changed one is saved against the revision it started from; a save that's
  refused (it changed elsewhere, offline, refused) keeps the text, and the status bar says
  `not saved: … · the edit to “…” is kept here · e brings it back`. An edit brought back and not
  typed in since isn't saved by a click away: it's kept again, and said. A comment, a reply or a new card
  is kept, never sent or created: sending is `Ctrl+S`. On the desk `^W` does the same by keys:
  the window key after it leaves the edit and runs (`Esc` after it stays in; `Tab` indents). An agent never
  saves or closes your draft this way (`session.leave`, `composer.leave` are yours).
- **One draft session behind every draft** (PIE-516). The edit, the comment and reply, and the board's
  new card or note go through the same lifecycle (`src/draft-session.ts`), so put aside, restore, click
  away and a stale revision behave the same everywhere. While you have a note open in a draft, an agent
  doesn't write it underneath you (an edit in another reader, a property, a step, a card move): it's
  refused, and the agent patches your draft instead (`draft.patch`), or waits for your save.

- **Reference completion** works in every draft, comments and replies included, the way Tree, Detail and
  Quick Capture do it, from the same service lookups, so the door keeps no index: `[[` offers pages,
  aliases and Work IDs (`pages.complete`), `((` blocks by the one search (`tree.search`, Goto's forgiving ranker),
  both asked from the draft's note and, after a 300 ms pause, re-ordered by Jev where the host has a key (the footer
  says `jev ranked`; the picked candidate stays picked), `((note#heading` or
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
- **Agents edit above while you type** (the outliner's PIE-501, `draft.patch`). An open draft is held on
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
  text on its line is plain text). The service's `properties.preview` (the outliner's PIE-401) reads
  them first: the first `Ctrl+S` on a draft that would change them says which and writes nothing; `Ctrl+S`
  again saves.
- **Attribution:** door edits are recorded as `author: user`, `actorId: ep0ch-door:<hostname>`, like the
  outliner's own Detail.
- `peek` reports open drafts under `editing` (dirty, changed elsewhere, refused, where the copy went).

### The power bar (PIE-656)

`ctrl+k` (or `cmd+k` where the terminal sends it, or a click on `^K` at the status bar's left) opens one palette over
whatever screen is shown and your drawer: a list on the left, what the lit row is on the right (a note drawn as a reader
draws it, a terminal's screen, an action's summary and keys), its scopes along the top.

- **Nothing typed:** the tiles open on every screen and in your drawer, indented as each screen's layout tree (a mounted
  screen's tiles under its mount, named `mount/tile`; picking one opens the mount and goes in) (`●` has
  the keys, `▸` a spine, `⧉` a float, `⇤` docked, `⋯` a tab behind), then what others changed since you looked.
- **Typed:** tiles, the outline's notes (the service's one search, nearer notes first, Jev re-ordering after a pause
  where it's set up), the actions you can do here (the focused tile's menu first, each with its key), what changed and
  the screens, each under its heading.
- **One scope:** start with `%` tiles, `/` notes, `>` actions, `+` recent, `@` screens, or an extension's own prefix
  (`~` for the glyphs example); tab and shift+tab cycle, backspace on an empty line goes back to all. The desk's `/`
  and a river column's `g` open it in its notes scope.
- **Going:** ⏎ or a double click. A tile gets your keys: a spine opens, a screen under this one comes up first. A note
  opens where opens land. An action runs as its key would. alt+⏎ (or an alt- or ctrl-click) zooms a tile, or opens a note
  in a new detail. Esc or a click outside puts it away.
- **Extensions** add sources: an extension's `bar[]` in its `extension.json` answers what's typed with rows that open a
  block, run one of its actions or copy text (the outliner's `docs/extensions/README.md`, "Bar sources").
- **Agents:** `act bar.open query=… scope=…` answers the rows and opens nothing; `act bar.pick n=… query=…` picks as the
  agent, through the same paths and their rules; your open bar is yours (an agent can't close it, and while it's open
  you're busy, so an agent's move of your screen waits). `peek` shows the bar when it's open.

### New notes and pages (PIE-544)

`ctrl+n` makes a new note from any screen and opens it to be written, in the same editor as `e`. Where it goes is
the outline's **placement rule**, kept by the service (`notes.create`, the outliner's `src/note-placement.ts`):
from a reader, under the note it shows, as its last child (from a new note, beside it); from anywhere else (a
list, a lane, a terminal, the main menu's `+`), at the top of the Inbox, where quick capture puts its notes. The
door only says which note you were in; it never works out where the Inbox is.

**Where it opens (PIE-591).** On the desk and every screen built on it, a new note **floats** over the screen, a
draft of its own, a little lower and to the right of the last, with your keys. Press `ctrl+n` as often as you like:
each is another float, and the one you were in stays open where it was. It works from an edit too: what you typed
there is saved first, as a click away saves it. A float's title drags it; dropped on a tile's header it docks into
that tile's tabs, on the screen's outer edge as a column, on a dock's handle into the dock (the hint row says which
before you let go). Its `×` (or `^W x`) closes it: written, it's saved first; still empty, it goes to the trash.
`Esc` on it with nothing typed does the same. A draft that loses your keys is never lost: a float you left with
nothing typed stays open, empty, until you come back to it (`e` or a click enters it); one you typed in is saved as
you leave it.

- **Elsewhere, or your way.** `note.opens opens=tab` makes them a new tab on the tile you're in, `drawer` a tab in
  your drawer (pulled up, your keys in it), `lands` where the screen's opens land (a reader beside it, the board's
  details row, the next river column), `float` again by default; it's remembered (`EP0CH_NEW_NOTE` overrides it
  for one door). `ep0ch act note.new opens=…` picks for one note.
- **A screen says its own.** A screen spec's `newNote` rules name what `ctrl+n` does by the focused tile's kind:
  the board's lanes write a **new card in that lane** (`card.new`, the same composer as `n`), born with the
  properties the lane's query sets, so it lands in that lane; a float anywhere else on the board.
- On the BBS screens (the menu, the message reader) it still opens in a reader over the one you're on.
- `ctrl+n` is never taken in a filter, a picker or a terminal tile (there it's the program's), and the
  outliner's Tree and Detail bind nothing on it.

- **A missing `[[page]]`** isn't made silently: the first `⏎` or click on `[[Evans Thotts]]` says it has no page
  yet and offers it (under the note's header); the next `⏎` or click on that link, while the offer is still shown
  (a minute at most), makes
  `Evans Thotts [page::Evans Thotts]` where new notes go (the top of the Inbox) and opens it (`page.create`). The
  link resolves from then on, however it's cased. The outliner's Tree, which makes a stub when it follows one,
  puts it there too: one rule.
- **A page names its own title.** A note whose first line is only `[page::2026-09-30]` (other properties may sit
  beside it) becomes `2026-09-30 [page::2026-09-30]`: on `⏎` at the end of that line in the editor, and on every save
  from any client (the door, Detail, the CLI, an agent, a quick capture), since the service applies outline-core's
  `page-title.ts` to the texts it's given. A title already there is never touched. A new note saves at once: it had no properties to lose,
  so there's no second `Ctrl+S`.
- **Agents:** `ep0ch act note.new text=… [near=<id>|inbox=true] [opens=float|tab] --as <id>` makes one,
  attributed, and says it on your status bar; it opens nothing (with `opens=`, it's shown there for you, unfocused)
  and never takes your focus. `ep0ch act page.create address=… --as <id>`
  makes a page. Outside the door: `ep0ch new "<text>" [--near <id>] [--as <id>] [--ws <name>]` (the same service
  call; `--json` for a script), or the outliner's `outliner new --text …`.
- **An empty outline offers it.** Where a fresh outline has nothing to show (the welcome's list, an empty board,
  the brief and waiting screens), a `+ New note · ctrl+n` line says so; a click on it is `ctrl+n`. The welcome's
  and the desk's hint rows name `^N new` too.

## Commenting

The same readers comment on the note they show, with `C` (`c` collapses on the board). On the board, `C`
in the lanes comments in the preview.

| Keys | Action |
|---|---|
| `C` | pick a passage to quote; the reader switches to the note's source text with the passage highlighted |
| `j k` | move to the next / previous line with text (the whole line, without its indent) |
| `J K` | extend / shrink the passage by a line |
| `h l`, `H L` | move where the quote starts (`h l`) or ends (`H L`) by a word |
| `Enter` | write the comment under the quote; `Ctrl+S` sends, `Ctrl+X Ctrl+E` hands it to `$EDITOR` |
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
- The reader's header counts open comments; a links tile lists them under Backlinks (kind Comment, `h` shows the resolved ones) and refreshes on outline events.

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
element is current, and `esc` lets go of the element or selection; it never leaves the reader (`q` does). A followed link
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
  target reads `label ◌` (one quiet mark; selecting or clicking it says it doesn't exist yet and offers to make it); a trashed one `title · Trash`; a missing fragment says so.
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
  three leading spaces): both find regions with outline-core's `code-ranges.ts`, and code fences (``` and
  ~~~, closed by the same character, at least as many) with its `code-fence.ts`. The river's cards and the
  desk's search preview draw regions the same way.

### Folding

Readers fold headings and nested lists the way Detail does (PIE-386). A heading folds everything through
the next heading of the same or a higher level; a list item folds its nested items and continuation
lines, keeping its own line; a callout folds its body to its title (PIE-538: one written `[!x]-` starts folded). Each one shows its disclosure, `▾` open and `▸` folded
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
| `(` / `)` | select the previous / next heading, list item or callout that folds (`▾`, yellow); the hint names it |
| `f`, `⏎` | fold or unfold the selected one; `f` with none selected folds the section at the top of the view. `⏎` folds only while a selected one is in view |
| `esc`, scrolling, `u` | let go of the selected one, so `⏎` means what it did before (the preview opens a detail); `[ ]` steps on to the next element |
| `F` | fold every outermost section and list item; with anything folded, unfold everything |
| `←` `→`, `Tab` `Shift+Tab` | while a live tabs figure's tab or row is the `[ ]` position: its previous / next tab (`figure.tab`); otherwise they do what they did (`Tab` focuses the next tile, `←` `→` step a river's columns or a message reader's messages) |
| `=` | while a live table's or tabs figure's tab or row is the `[ ]` position: its next density, compact → cozy → comfortable (`figure.density`) |
| click | a heading (anywhere on its line but a link, which opens), a list item's `▾`/`▸`, or a callout's title, folds or unfolds it; the frame and its scroll thumb don't |
| `z` | open every callout; again, put them back as written (`[!x]-` folded, the rest open). The text is unchanged |

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

An extension the outline service runs ([the outliner's extensions guide](../outliner/docs/extensions/README.md), PIE-507) answers a
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
| `ctrl+z` | undo the last step change you made while reading this note (or callout or image change, whichever was last) |

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
itself (PIE-419): the board's preview, details, floats and dock previews, the desk's readers, river
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

In a draft (an edit, a comment, a new card) a drag selects the draft's text and is copied when the button
comes up too (PIE-621), and so is a double click's word, a triple click's line and a shift+click's span;
`shift+arrows` select by keys, and `cmd+c`, `alt+c` or the frame's `[copy]` copy. Typing or a paste still
replaces what's selected there. In a terminal tile `cmd+c` is the program's, as it came.

| Keys | Action |
|---|---|
| drag | select from where the button went down; past the top or bottom edge the note scrolls a row at a time. A drag that starts on a link, a heading or a figure selects; it doesn't follow or fold |
| click | what it always did (follow a link, fold, pick a panel row), decided when the button comes up on the same cell; anywhere else it lets go of the selection |
| double / triple click | a word / the drawn row, without its indent (a click on a link or a fold marker acts instead) |
| `v` | the keyboard mode, from the first row in view (or taking over a mouse selection); `h j k l`, arrows, `PgUp PgDn`, `Home End` move its end; `v` or `esc` leaves |
| release of a drag, double or triple click | copy what it selected (copy on select; `EP0CH_COPY_ON_SELECT=0` turns it off) |
| `y`, `cmd+c` | copy what's drawn: links as their titles, rows as they're drawn |
| `Y` | copy the source: exactly the selected words when they read the same in the note's text, else the whole source lines the selection covers (a link's `((…))`, `**bold**`). With nothing selected, `Y` copies the whole note's source (`note.copy`; the tile menu's "copy note"; "copied the note, N lines"; an agent's `act note.copy` returns the text) |
| `esc` | let go of the selection |

With text selected, `C` starts the comment's passage on it. An agent selects with `select` (`text=`, as
drawn, or `line=`/`to=`, 1 is the subject) and gets the text from `select.copy` (`source=true` for the
markup): its selection is its own, drawn in its own tint, is never copied on select, and never replaces
the person's or touches their clipboard. A river column draws a digest of the note, so there a selection's `Y` says it can't map the source (with nothing selected `Y` copies the whole note there too, `column.note`);
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

- **Images and video** (PIE-532). A line that is only `img:: path`, `[img::path]` or `[video::path]` (after an optional
  list mark) becomes an image through Kitty. Its layout is written as properties beside it on the same line:

  ```
  - [img::~/Pictures/plot.jpg] [layout::hero] [height::14]
  [img::~/Pictures/packet.webp] [size::40%] [align::center] [alt::a seed packet]
  ```

  `[size::…]` is its width: cells (`40`), a share of the reader (`40%`) or `full`; `[height::N]` is rows; the aspect is
  kept (inside both when both are written), at most about four fifths of the reader. `[align::left|center|right]`
  places it. `[layout::hero]` makes it the note's **header**: the reader draws it above the title, the full width, a
  whole when it fits in a third of the pane (or `[height::N]`, at most half); taller, cropped to fill that
  (`[fit::contain]` shows it whole, centred, instead); it scrolls away with the note's top. The note's first such image is its header
  (an image right under the title needs its list mark, `- [img::…]`: a line of only properties there is the note's
  own). A river column draws the header where it's written. `[alt::…]` is said on its caption. A value that isn't one
  of these is said on the line in yellow.

  **Dark first.** A bright image is dimmed as it's scaled, so it's cached dimmed and never shown bright, not even for
  a frame: its brightness is scaled so the mean luminance of the part drawn (a header's crop), as it shows on the
  door's dark ground (a transparent pixel is the ground), is at most 0.3. Dark art is untouched; the caption says
  `dimmed`. An image's rows are kept, dark, while it loads (its size is read from its header first), so the note
  doesn't move when it arrives. `[dim::N]` on its line sets how much instead: `0` as it is, `0.6` at 40%, `1` black.

  Decoding and scaling need no system tool: PNG, JPEG, WebP and GIF (its first frame) go through sharp's prebuilt
  libvips (Linux and macOS), turned upright and scaled down to about the box they're drawn in, never up (Kitty scales
  the rest), in a few steps cached in `~/.cache/ep0ch-door/media` (under `$EP0CH_STATE/cache/` when that is set) by
  file and step. Video gets a poster frame from `ffmpeg` (or Quick Look on a Mac); without one the line says what to
  install. `\ ` escapes and macOS screenshot names (narrow no-break space before AM/PM) resolve.

  Each image's caption is its `[ ]` element: `⏎` (or a click on its name) opens it in the system viewer, a click on
  the image makes it the `[ ]` position, and then `+` `-` step its width (a quarter, a third, a half, two thirds,
  three quarters, full; a header's height by two rows), `←` `→` move it, `H` makes it the header (or not). The
  caption's `[−][+] [◂][▸] [▀]` do the same by mouse. Each change rewrites its line through the note's save, checked
  and recorded as you; `ctrl+z` puts it back. Agents use `images`, `image.size`, `image.align`, `image.hero`, `image.fit`, `image.dim`. On the header, `=` (or its caption's `[whole]` `[fill]`) shows it whole or cropped.
  Images a dock or float covers are hidden. River columns draw them as readers do (cropped as they scroll). Where
  an image isn't drawn its line says why: no Kitty graphics in this terminal, or `alt+v` set the video mode to cells.
  If macOS blocks the read (Desktop, Documents), the line says so: grant the terminal Files & Folders access.
- **The header takes the hero image** (PIE-598). When a note's hero image (its `[layout::hero]` header image, or an
  image that is the note's first block) scrolls up under a reader's sticky header, the title, summary, byline and
  crumbs take a crop of it as their background: muted, softened and dark, so they stay readable, coming in by three
  steps as the image goes under, fading in over the background; nothing is drawn until the dimmed variant is ready, so no frame is
  bright. Under Kitty graphics it's the picture under the text; in cells each cell is coloured from it; text output
  is unchanged. `[hero-focus::x,y]` on the image's line (fractions or percents, across then down) says what the crop
  keeps; its middle otherwise. `ep0ch act reader.hero on=false` turns it off in every reader, kept for the next start;
  `mode=follow` makes the header follow the note's pictures: each one that scrolls under takes over, fading in over the
  one before (`mode=first`, the default, keeps the hero).
  A river column keeps the same header (the reader's title, summary, byline and crumbs) above its scroll, so it
  takes the picture too. A note may open with its picture right under the subject (`[img::…]` on line 2): a media line
  is content, never the note's block properties.
- **The title leads the header** (PIE-657). A reader's header is the breadcrumb (a dim eyebrow), the title (the one bright,
  bold line: the theme's brightest in the tile with the keys, a clear step down in the others), one dim line (author, day,
  work id, `i N properties`, the summary values as links, the comment count; in a narrow tile the summary takes its own
  line) and one blank row. The tile's frame bar says only `detail` while the header is on screen, and the title again when
  the tile is too short for it. With Kitty's text sizing (OSC 66; asked at start-up with two probes, a space at scale 2 then at scale 3, and only a cursor that moved by the scale both times counts; `EP0CH_SIZED=1|0` overrides) and a
  title that fits twice over, the title is drawn at double height: the canvas still holds it as one bold row with a blank
  row under it, so layout, selection, copy, clicks and `peek` are unchanged, and the sized text is painted over those two
  rows (`src/text-sizing.ts`) only while they are as drawn. Inside Herdr, tmux or screen the door never asks (a multiplexer can answer the probe and still not draw the sizing: spaced-out letters and a blank row), so it is bold on one row with no blank row; `EP0CH_SIZED=1` forces it there.
- **Callouts** (PIE-538, [Obsidian's syntax](https://obsidian.md/help/callouts)). `> [!type]± title` draws a box in the
  type's icon and tone, the title on its top edge (the type's own title when there's none; an author's title names
  the type on the right of the edge). One list of types: Obsidian's thirteen and their aliases (note, abstract
  (summary, tldr), info, todo, tip (hint, important), success (check, done), question (help, faq), warning (caution,
  attention), failure (fail, missing), danger (error), bug, example, quote (cite)), plus the types the outline
  declares (below); a type nobody declared draws in neutral under its own name. Outline-core's `src/callouts.ts`
  holds the list and the grammar, so the outliner's Detail draws them the same.
  - **Nesting.** `> > [!warning]` inside a callout is a callout in its frame, to any depth; a callout's body is drawn
    like a note's (paragraphs, lists, a plain `>` quote).
  - **Folding.** Every callout with a body is a fold point of the reader (see Folding): `▾` open, `▸` folded. `-` starts
    it folded the first time the reader meets it, `+` (or nothing) open; after that it's yours: `( )` then `f` or `⏎`,
    or a click on its title, folds or opens it, and `z` opens them all. Folding never writes the note.
  - **Changing the type.** `[ ]` stops on a callout's icon (and its type on the edge); `⏎` or a click opens the type
    choice under its top edge, the same list picker as a step's status choice: the outline's types with their icons,
    `j k ⏎` or a double click picks one, and `-` or `+` there makes it start folded or open (the only change to the
    `±`, written). Either is one line of the note rewritten through its save, checked against the revision and the
    header as drawn, recorded as you; `ctrl+z` puts it back.
  - **Typing one.** In an edit, `> [!` opens the completion popup with the types and their icons; what you type narrows
    it (an alias finds its type), `⏎` or `Tab` writes `[!name]`.
  - **Your own types.** A note in the outline declares one: `[callout-type::recipe] [callout-icon::♨]
    [callout-tone::green] [callout-title::Recipe] [callout-aliases::dish, meal]` (icon: one glyph one column wide;
    tone: blue, green, violet, amber, coral or neutral). The host lists them (`callouts.types`); the reader, the popup,
    the type choice and the outliner's Detail all take them from there. Naming a built-in restyles it. What can't be
    used (a taken name, a wide icon) is said by `callout.list` and left out.
- **Tables.** Markdown tables render as real tables: columns sized to fit, long cells wrap onto more lines.
- **mdxcn figures** ([mdxcn.dev](https://mdxcn.dev)): `::graph-*` Comark blocks with YAML props draw natively in
  a dotted `+ ··· [ TITLE ] ··· +` frame: check, timeline, stat, kpi, rank, funnel, waterfall, spark, plot, meter,
  gantt, tree, table, tabs (`src/graphs.ts`), and decision, chat, keys, uptime, activity, calendar, annotate (`src/figures/`).
  The official fenced ASCII an agent pastes (`+--- [ TITLE ] ---+`) is re-framed the same way, and `ep0ch export`
  writes each figure as that ASCII (60 wide, live ones answered first; `--source` keeps the block). Unknown kinds say
  so inside the frame.
  - **Rows in Markdown** (outline-core's `figure-markdown.ts`, one reading for every client): after the `---` YAML, or
    as the child bullets of a figure block (a note whose body is the figure, nothing above it but its title; `rows: children` asks anywhere),
    each a row that opens its note. `**bold**` is now, chosen, the accent; `*italic*` next, rejected, receding;
    `- label: value` a row (the label is up to the first `: `); `x — note` a muted side note; `a → b → c` (or `->`) a
    path; `ok*40` a run of forty in any list of values; `- [x]` done. timeline, check, rank, funnel, stat/kpi and
    spark/plot read them too. Where the YAML gives the same field, the YAML wins.
  - `decision`: `- **chosen** — why`, `- *rejected* — why`, `- open`; paragraphs after; `status:`, `date:`. Live,
    `query: "type=decision"`: each note a row, its `decision-state` (chosen, rejected, open) its glyph, `reason: <property>`.
  - `chat`: `- speaker: message`; the first speaker (or `you:`) gets the `>` prompt, a speaker isn't named twice in a
    row, an italic turn is an aside.
  - `keys`: `- ctrl+k: what it does`, `g then d`, drawn as keycaps `[ctrl][k]`; bold learns first. `actions: note`
    (a scope, or a list) reads the door's own keys from the action registry; `learn: [edit]`, `limit:`.
  - `uptime`: a glyph a day (ok █, degraded ▒, down ·, none -), wrapped every 30 (`wrap:`), with the % ok and
    `from`/`to`. Rows: `- 2026-09-01: ok*20 degraded down`. Live: `query:` with `date: <property>` and
    `state: <property>` (date, status), the worst run of a day counting; `last: 30` is the thirty days to today; `source: backups` is
    `query: "type=backup-run"`, the notes `scripts/backup-runs.ts` writes (below).
  - `activity`: a contribution grid, weeks as columns, ·░▒▓█. Rows: `- 2026-03-02: 0 1 4 2 0*3` (that day and the
    days after). Live: `query:` with `count: created|updated` (or a date property), `weeks: 26`.
  - `calendar`: one month, marked days in the accent, today in `[brackets]`, `- 12: launch` listed under it;
    `year`, `month`, `weekStartsOn` (mon), `today`. Live: `query:` with `date: <property>` marks the month's notes.
  - `annotate`: a fence whose lines end in `// (1)` or `# (1)`, then `1. what it is`: marked lines bright with `[1]`
    in the gutter, the rest dim.
  - **Backup runs:** `bun scripts/backup-runs.ts --ws pie --source restic -- ~/.local/bin/ep0ch-snapshot` runs the
    backup and adds one note under `Backup runs [type::backup-log]` (`[type::backup-run] - [status::ok] -
    [date::…] - [source::restic] - [took::…]`), exiting as the backup did; `--status degraded` records a run it was
    told about. It never reads the backup's secrets, only its exit code.
- **Live figures** (`src/live.ts`): give a figure `query: "type=outbox-item ticket=PC-762"` or `view: ((block-ref))`
  instead of values, and the door answers it from the outline on every render, re-asking when the outline changes.
  The note stores the question, so status lives in one place. Footer reads `live · N results`.
  - `check`: `done: "outbox=done"` ticks rows, `note: waiting-on` adds a property line
  - `stat`/`kpi`: each item takes its own `query`/`view`; the value is a live count
  - `rank`: `group: ticket` counts per value · `table`: `columns: [ticket, title, waiting-on, updated]`
  - `timeline`: dated by `updated`/`created` or `date: <property>`, `now: "<filter>"` · `meter`: share matching `done`
  - `tabs`: `group: work-stage` gives a tab per value, labelled with its count (`doing 3 · review 4 · validate 1`),
    the chosen tab's rows drawn as a `table` (`columns:`, a row opens its note). `order: [doing, review, validate]`
    puts those first, shown even when empty; the other values follow alphabetically (a count changing never moves
    a tab), results with no value last. `limit:` is rows per tab (50); the question asks for up to 1000 results.
    `[ ]` onto a tab or a row, then `←` `→` or `Tab` `Shift+Tab` switch (`figure.tab`), `⏎` or a click on a tab
    shows it. Which tab is the reader's, like a fold: kept across repaints and live answers, never written into
    the note. `ep0ch show` prints every tab in turn under a heading.
  - `density: compact | cozy | comfortable` on a `table` or `tabs`: a row's title takes one line (cut with `…`,
    the default), up to two, or up to three with a blank line between rows. A wrapped title hangs under its text,
    past a work id (`PIE-541 — `); the other columns stay on the first line. `=` while a figure's tab or row is
    the `[ ]` position, or a click on its `≡ cozy` footer control, steps through them (`figure.density`); the
    YAML value is only where it starts.
  - `view:` reads a saved virtual branch the faithful way (ranks, limit, errors); `query:` is an explicit filter
    in the saved-view grammar (`OR`, `NOT`, parentheses, `created`/`updated` ranges), sent to the service as
    `blocks.query` `expression` (PIE-398). `done:` and `now:` are queries in the
    same grammar: the service says which results they hold for (`query.matches`, PIE-490). They match
    properties only; there is no `author=` pseudo-key.
- Long callout titles keep a short head on the border and flow the rest into the box (a nested one too). A
  `> [!quote]` whose last line starts with `— ` draws it as the byline, to the right, the source after a comma
  muted (outline-core's `quoteByline`; Detail draws it the same).
- Code fences, headings, lists, blockquotes, `**bold**`, `[[links]]`, `((refs))` and `[key::value]` are styled.

### The component library (PIE-618)

Each component says what its properties are once, as a schema in outline-core (`src/component-schema.ts`): heading
styles, callouts, rules, every `::graph-*` figure, `::links` and its kin, `::box`, pictures and header images, embeds,
code fences and tables (a test fails when a component the readers draw has no schema), and any an extension ships in
its `extension.json`
(`components`). The outline adds its own values (a `[heading-style::plot]` note makes `plot` a value of `[heading::]`).
Two things are made from that and nothing else: property completion in a draft (above) and the **library**, a
design-system page per component. `ep0ch --screen library` opens it (`--screen library callout` on a component;
`screen.open name=library` from anywhere; `I` on the main menu; `ep0ch --showcase --screen library` opens it on the
showcase outline). On a running session, `ep0ch --screen library` opens it there and says so on the status bar.

A page has four parts. **Overview**: what it is, where it goes, the minimal example and the properties table (key,
where it's written, values, default, meaning). **One property at a time**: each value drawn live, the exact source
under it (`## Your calls [heading::band]`, and for a style's own properties the declaring note:
`My style [heading-style::mine] [heading-pattern::waffle]`). **Grids**: the pairs the schema marks (pattern × align,
rows × row), side by side where they fit. **Every combination**: the whole space (heading styles have 2430) behind a
filter, never dumped: pick values per axis and the matching variations are drawn, eight at a time. Every variation
is drawn by the readers' own renderer at 40, 80 or 160 columns, or all three one under another, so the narrow fallback shows too; a figure's live form (`query:`) is asked of the outline, which the library has none of, and its page says so; a rule's are drawn
as the service draws them.

| Keys | Action |
|---|---|
| `,` `.`, or a click on a tab | the previous or next component (`library.component`) |
| `1` `2` `3` `4`, or a click | overview, one property at a time, grids, every combination (`library.part`) |
| `←` `→` (`h` `l`) | the previous or next property (`library.axis`) or grid (`library.grid`); in every combination, the value under the cursor (`library.cursor`) |
| `[` `]` | every combination: the axis above or below |
| `space`, `⏎`, or a click on a value | every combination: pick or unpick it (`library.pick`); `x` clears (`library.clear`), `n` `p` page (`library.page`) |
| `j` `k` (`↓` `↑`), or a click on a variation | select a variation (`library.select`) |
| `y`, or a click on `copy` | copy its source (`library.copy`: the declaring note and the line that uses it; `part=use` or `part=note` one of them). An agent's copy comes back as its answer, never to your clipboard |
| `w`, or a click on a width | draw at 40, 80, 160 or all three at once (`library.width`) |
| the wheel, `PgUp` `PgDn` | scroll (`library.scroll`) |

`ep0ch library` lists the components; `--brief` prints what an agent reads (per component its purpose, where it goes,
each property as `key: values (default) — meaning` and a minimal example; the Claude mod's and the MCP gateway's
`outline_components` say the same, and the gateway serves each as a resource); `--json` prints their schemas as the outline merges them (what an editor's
completion source or an agent's tool description reads); `--out <dir> [--width 80]` writes a Markdown page each
(`<id>.md`, and `README.md` listing them), every variation drawn above its source. Attach one to a published note
(`[file::<dir>/heading-style.md] [publish::true]`) and the publisher serves it as HTML.

## The river

`Q` on the menu, or `ep0ch --screen river`. Quay's model (built with Grok from an outline export, in
`~/projects/tundra-heart-crane-lotus`) on the live outline instead of a seed file. Since PIE-515 the River is a
screen spec on the desk: its columns are tiles of one kind (`river.column`) in a **flow** container, so the layout
is the engine's (`src/desk/screen-layout.ts`) and every column is a reader of the shared note surface.

- **Placement (niri):** `⏎` inserts a column right after its source, or goes to the column that already has that note. `alt+⏎` forces a duplicate.
- **Focus is not the layout:** a click in a column, `h` `l` (`tile.focus dir=`) and `tab` give it the keys and nothing else moves. `w` (`tile.widen`, or a click on a column's header, or anywhere on a spine) widens it: the layout is built around that column, and the one you were reading stays full beside it when there's room. ⏎ and a followed link add the column after its source and shift only if the new one wouldn't show full. A click opens a card only in the column that already has the keys.
- **Compression (Andy's notes):** columns get full, peek or spine width by distance from the wide column; held (`p`, `tile.hold`: held full; `⊙` on the header) columns resist, and the Library starts held. A peek draws its whole note at reading width, covered by its right-hand neighbour like a dock (`▒` on the edge) and dimmed; only the far columns become spines.
- **Threads (Twitter):** `space` expands replies in place under a rail; `s` stacks the selected note as its own column tile under this one (`column.split`).
- **Links under the replies:** a note's column ends with its links, the links tile's rows (outlinks, resources, backlinks): `j` `k` walk on past the cards into them, `⏎` opens one in the next column (`alt+⏎` a new one), `space` folds a group, `b` or a click on `── ▾ links` folds them all (`column.links`, `column.link`). A swipe sideways on a trackpad steps to the column beside, as `h` `l` do, one column a swipe.
- **The mouse:** a click on a card selects it, a double click opens it beside (as `⏎`), an alt-, ctrl- or middle-click too; the click that gives a column the keys only selects.
- **Filter this column:** `/`, then `type:hub -status:done author:codex word`; the hint row is the prompt.
- **Same property:** `#` lists the selected note's properties (or says it has none to follow); a digit opens a column of every note sharing that one (`column.tag`).
- **Go to:** `g` is the desk's search; ⏎ on a hit opens it in the next column.
- **The note surface:** every full-width column is a reader of the same note surface as every screen's. `e` edits the column's note (`ctrl+e` in `$EDITOR`), `C` picks a passage to comment on, `m` lists its comment threads, `i` its properties, `[ ]` step through its elements and `f` `( )` fold (or a click on a heading), as in every reader; `⏎` on a link follows it into the next column (a click on a link does too), `u` opens the parent there. Back and forward (alt+← alt+→, backspace, the mouse's side buttons, or the `← back` row under the title: `tile.travel`) go between the columns: to the one this was opened from, and back again. The column's note is the one it was opened on; in the Library and a `#tag` column it's the selected one. A column holding an edit resists compression. Peek and spine columns are read-only to note actions. Leaving the river (or a SIGTERM) with unsaved text copies it to disk first.
- **Agents:** columns are tiles, named as any tile (`library`, then `column`, `column2`…), so `tile=` takes their names and every desk action works there. The column's own actions: `column.select` (by `id=`, `n=` or `by=`; its links' rows count after its cards; refused in the column you have the keys in, `id=` too), `column.links` (`on=`), `column.link` (`n=` from the first links row, `fresh=`), `column.replies` (alias `replies`), `column.scroll`, `column.filter` (alias `filter`), `column.tag` (alias `tag`), `column.split` (alias `split`), `column.copy` (alias `copy`); the layout's: `tile.widen` (alias `widen`), `tile.hold` (`on=`; `p`: held full), `tile.close` (not the Library: its spec holds it closable off, so a restarted river always comes back with its columns, and its hint row leaves out `x`), `tile.travel dir=back|forward` (`alt+←`/`backspace`/`alt+b`, `alt+→`/`alt+f`; the person's: an agent opens beside). `open id= from=<column>` opens a note in the column after that one (`fresh=true` for a duplicate); an `open` naming no tile lands after the column with the person's keys. `search query=` lists notes. An agent never moves the person's focus, and the column they have the keys in is theirs (its cursor, scroll and filter).
- **The person's keys and an agent's session:** a column holding an agent's edit or comment (or one of yours you moved away from) doesn't take your keys: `h l`, `tab` and `x` keep working, and `e` or `⏎` enters it.
- **Notices:** "properties changed" and an agent's line under a note clear on your next key or click in that column, or, in one you aren't in, after 30 seconds on screen.
- **Back:** `q`, or `Esc` once no link is selected, goes back to the menu.

Reply counts come from one `tree.index` call (cached in `river-index.json` and refreshed in the background).
Card bodies come from `children`. The layout is saved to `river.json` (the desk's layout shape).

## What maps to what

| BBS | Outline |
|---|---|
| New scan | blocks updated since your last logoff (`lastcall.json` in the outline's folder of the state dir) |
| Join conference | top-level blocks |
| Message reader | a block on the note surface (links, properties, folds, comments, edit, selection), under a BBS header: author, date, `to::`, breadcrumb; `T` its children, `U` its parent |
| Who's online | `clients.list`: every Tree, Detail, agent, and this door (the who tile, as a screen) |
| Last callers | `activity.recent` across user, agent and system edits (the activity tile beside a reader, as a screen) |
| File areas | the WOE zips, with each pack's `FILE_ID.DIZ` as its description |
| Stats | 7×24 heatmap of when messages were written, and top posters |

## Graphics

Kitty graphics are used only where cells can't do it, and every word stays real terminal text:

- **Art** is rasterized with the 9×16 VGA font (lifted from ep0ch.html into `src/vga.ts`) and placed under the text layer.
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
| `calm` | every day: a near-black ground with a little blue in it, ink-slate bars instead of saturated blue, off-white text (never `#fff`), accents desaturated but each still its hue: cyan for links into the outline, a muted blue-violet with a ↗ for links to the web (`external`), amber for the focused tile, yellow for headings, red for errors, magenta for agents |
| `night` | late hours and sensitive eyes: calm with the brightest text held near 10:1 and dim text still at 4.5:1 or more |
| `classic` | the VGA palette, unchanged |

- **Tiles you can tell apart:** every tile's frame is a mid-tone line at 3:1 or more on the ground in each theme, so
  two tiles stacked in a column part clearly; the tile with your keys is double-lined (`╔═╗`) with its frame and name
  in the theme's warm amber, apart from the typing yellow. In your drawer, no screen tile looks focused.
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
  slot, a dock handle, a mark) take text that reads on them (`chip` in `src/style.ts`).
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

A running door listens on `door.sock` in its outline's folder of the state dir (`EP0CH_CONTROL` moves it; with it unset,
`ep0ch act|peek|…` reach the door on this folder's outline, else the only one running; a second door uses
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
| `note.new` | `text=` (the person's starts empty), `near=<id>` (under that note) or `inbox=true`, `opens=float\|tab\|drawer\|lands`. On every screen. The service's placement rule puts it: under the note in the reader you're in (an agent's: only `near=`), else the top of the Inbox. Yours opens in its edit where the screen's `newNote` says, else your `note.opens`, else floating (PIE-591); the board's lanes run `card.new` instead; an agent's opens nothing (with `opens=float` or `tab`, shown unfocused) and is said on the status bar (PIE-544) | `ctrl+n` on every screen (in an edit too), `+` on the menu |
| `note.opens` | `opens=float\|tab\|drawer\|lands`: where your new notes open where a screen doesn't say; saved (`EP0CH_NEW_NOTE` overrides). The person's own (PIE-591) | none |
| `card.new` | `lane=<name>` (default yours): the board's composer for a new card there, born on ctrl+s with the lane's properties. The person's own (PIE-591) | `n`, `ctrl+n` on the lanes |
| `page.create` | `address=` (default the selected `[[link]]`'s): the page a missing `[[address]]` names, `X [page::X]` where new notes go, then opened as the link would (yours); a page already there is opened. In any reader | `⏎` or a click on a missing `[[page]]`, twice (the first offers it) |
| `open` | `id`, `tile=detail\|new-detail\|float` (board: where the screen's opens land), `tile=preview` or any reader, `tile=<tile>` (desk); on the menu or a BBS list, the note opens in a message reader over it | `Enter`, `Alt+Enter`, `o` |
| `brief.step`, `brief.newest`, `brief.date`, `brief.show` | `by=-1\|1`; `date=YYYY-MM-DD`; `id=<brief>` (the daily brief) | `,` `.`; a link to another day's brief |
| `screen.spec` | none: the screen shown as its spec, the data a screen note holds (PIE-515) | |
| `search` | `query=` (2 characters or more), `limit=`: the desk's search. An agent's answers numbered hits and opens nothing; yours opens the power bar in its notes scope, and its `⏎` runs `open` | `/` |
| `bar.open`, `bar.pick`, `bar.close` | `query=`, `scope=tiles\|notes\|actions\|recent\|screens\|<an extension's>` (or its prefix); `n=` (from 1), `alt=true`. The power bar (PIE-656): yours opens it with your keys in it and picks from it; an agent's `bar.open` answers the rows and opens nothing, its `bar.pick` lists for itself (`query=`, `scope=`) and picks as itself (a tile on another screen refused; a note lands where an agent's opens land); `bar.close` is yours | `ctrl+k`, `cmd+k`, `^K`; ⏎, alt+⏎; esc |
| `tile.enter`, `tile.leave` | `send=` (enter: a key to pass on, the second `ctrl+]`): type in a terminal tile, or leave it. The person's only: an agent uses `tile.type` | `e`, `⏎` or a click on a terminal tile; `ctrl+]` |
| `activity.pick`, `activity.reload`, `reader.mode` | `n=`, `open=true`; `mode=follows\|held\|pinned` and `page=` (reader.mode: any reader, a detail too; left out it is `p`'s toggle of follows and held; a click on the mode chip on the frame cycles all three). The activity and reader tiles' own keys, registered on their tile kinds. An agent's pick answers the row and moves nothing of yours (a thread's replies are a links tile's Children: `backlinks.pick`) | `j k ↑↓`, a click, `⏎`; `r`; `p` |
| `tree.fold` | `n=` or `id=`, `open=true\|false`: a tree row's children. An agent can't fold away the rows your selection is in | `l → space h ←`, a click on a row's mark |
| `backlinks.fold` | `kind=`: a group in a backlinks tile (`backlinks.view` takes `step=` for its status-line controls) | `.`, `space`; `s K w h n` |
| `section.try` | `name=`: the showcase's part, given the keys. The person's only (`section` is the agent's) | `⏎ → l Tab`, a click into the stage |
| `host.enter`, `host.leave` | `send=`, `restart=true` (an exited agent runs again: `⏎` only); `quiet=true`: type in the drawer, or leave it. The person's only | a click in it, `ctrl+]`, `⏎` on an exited agent |
| `welcome.select`, `welcome.read`, `welcome.logo`, `welcome.reload` | `n=<place>` (1-10 are the tabs' `1`-`9` `0`) or `id=`; `read=true` gives the detail your keys (never an agent's); `id=` any note for `read`; `by=-1\|1` (the welcome screen) | `1`-`9` `0`, tabs, the list; `alt+⏎`, ctrl-click; `L` |
| `tree.links`, `tree.pick` | `tile=<outline tile>` (the board: its outline dock); `n=` (as peek's `tree.rows`) or `id=`; `show=true\|false` (links); `open=true` (pick: as `⏎`; a ticket the Jira extension keeps as a block opens that block). An agent's never moves your selection or keys | `L`, `l h space` on a link; `j k`, `⏎`, clicks |
| `projection.refresh` | `tile=`; `block=` (a page or a ticket block; default the one the `[ ]` position is on, else the reader's note), `line=` (one line: an extension's output or component runs again, an `@name` request is asked again, a record fetched). Without `line=`, every line, and every `@name` request not answered yet. Fetches its tickets and runs its extension lines now; the service writes as the extension (`ext:jira`, `ext:moon`), and whoever ran it is who asked (`asked by you`, `asked by an agent (<id>)`) | `r`, a click on a ticket's age or a line's `[r run again]` |
| `ext.<extension>.<action>` | `block=` (the note with the handler line, or the block it acts on), `line=` (when the note has several of that handler's lines). An extension's action as the service lists it (`ext.fancy-horror.ward`, the built-in `ext.<id>.keep`); the service runs it and what it writes is `ext:<id>`. A tile's actions (`ext.tarot.draw`, `ext.tarot.keep`) are its tile kind's: `tile=<the tile>`, `block=` defaults to the tile's own | the action's key on its line (`w`), a click on its control (`[w ward]`); in a tile, the program's own keys |
| `changes.extensions` | `include=true\|false` (default: toggle). Whether "what changed" (the status bar's `+N new`, the new scan) includes what extensions wrote, such as a refreshed ticket. Off by default; the person's only | a click on the status bar's `+N ext` |
| `backlinks.groups` | `tile=<backlinks tile>`; `show=` (outlinks, resources, backlinks, children, comma-separated, or all), `toggle=<group>`, `choose=true` (yours: the list of groups). At least one group stays; saved with the layout | `v`, a click on the counters |
| `backlinks.pick`, `backlinks.open`, `backlinks.view` | `tile=<backlinks tile>`; `n=` (as peek's rows) or `id=`, `open=true`, `fresh=true` (pick; open's `where=origin|new` says the same); `kind stage resolved related sort` as `backlinks` takes them (a backlinks tile: the welcome's, or `^W o l`) | `j k`, `⏎`, `alt+⏎`, clicks; `s K w h n` |
| `focus` | `tile=<tile>` or `tile=lanes`. An agent's is refused while you're typing, and within 2s of your last key. On the desk it is `tile.focus` | `Tab`, `Shift+Tab`, a click, `esc`/`q` back to the lanes |
| `card.select`, `card.move` | `id`, or `lane` and `by` (steps; `lanes=` steps lanes; `focus=false` leaves the current lane, as the wheel over another lane does); `lane`, `card` (default the selected card; an agent's own `card.select` first, which never moves your cursor) | `h l j k ↑↓ ← → PgUp PgDn`, a click, the wheel; `H L`, `m` then `⏎`, drag |
| `card.reorder` | one of `by` (places; negative up), `to` (position from 0), `before`/`after` (another card in the lane); `card`, `lane` (default the selected card and the lane listing it). The lane's hand-set order, moved by the service in one step (`virtual.occurrences.move`; `by` stays within what the lane shows), recorded as who asked; a sorted lane refuses, naming the `[sort::]` to remove. An agent's is refused only while you're typing in the lanes, and never moves your cursor | `alt+↑ alt+↓`, drag a card up or down its lane |
| `board.hub` | `id` (a board's block id): show that board; none: the boards there are (yours opens the picker, an agent's only lists them); `close=true` puts the picker away (yours) | `g`, then `j k ⏎` or a click; `esc` `q` |
| `lane.collapse` | `lane` (default the lit one), `on=true\|false` (default toggles) | `c` on the lanes, `⏎`/`space` on a collapsed lane, a click on its spine |
| `tile.slide`, `tile.dock` on `tile=tree` | the board's outline dock: `tile.slide` opens or shuts it (`open=true\|false`, default toggles), `tile.dock on=false` undocks it into the layout, `on=true` docks it again, `edge=other` moves it to the other side. An agent's open leaves your keys where they are, and it can't shut the dock you're in. An open dock's `[×]` shuts it as `esc` does | `t`, `T`, `S`, `esc` `q` in it, a click on `[×]` |
| `float.place` | `dx dy` (steps) or `col row cols rows`: move or size a float, kept on screen | `H J K L` on a float, dragging its title or `◢` |
| `backlinks.pick`, `backlinks.fold` | `n`, `id` or `by`; `open=true`, `fresh=true`; `kind` (fold: a group). One grammar on the board's backlinks dock and the desk's backlinks tile. An agent's pick leaves your selection and preview; folding is your view, an agent's is refused | `j k Home End`, `⏎`, `alt+⏎`, clicks, the wheel; `.` `space` |
| `board.reload` | none: read the lanes again | `r` |
| `card.create` | `lane`, `text`, `parent` (default the lane's) | `n`, typing, `Ctrl+S` |
| `note.create` | `text`, `parent` (default the selected card) | `N`, typing, `Ctrl+S` |
| `steps`, `step.set` | `card` (default the selected card); `step` (number from 1, or `^id`), `status=todo\|done\|waiting\|problem` (default toggles done) | `s`, `j k`, `space x w !` |
| `card.trash`, `card.restore` | `confirm=<the card's id>` (the second `d`; without it the person's first `d` arms, an agent's is refused), `card`; `id` (default the card trashed last) | `d d`, `u` |
| `tile.widen` | `tile=<tile>` in a flow | desk `^W W`, a click on a flow column's spine |
| `tile.collapse` | `tile=preview\|detail1\|detail2` or a lane's tile (the focused one by default), `on=true\|false` (default toggles), `dir=v\|h` (vertical or horizontal spine); `tile=all` opens everything (board) | `c`, `⏎` or a click on a spine, `alt+c`; desk `^W c`, `alt+h` (alt+H horizontal), bare `-` folds and `+` `=` open the focused tile where it takes no text, `✦-` `✦=` (hyper), the ◂ ▾ on a tile's frame (alt+click horizontal) |
| `tile.expand` | `tile` | a click on a spine; dragging a tile onto it |
| `tile.resize` | `tile=<tile>` (`lanes`, a reader, `tree`, `backlinks`, a float; default the focused one), `by` (steps, `-20`…`20`), `axis=row\|col` (width, default; or height) | board `{ } < >`, desk `^W < > + -`, dragging a border |
| `tile.close`, `tile.float`, `tile.dock` | `tile=<tile>`; `on=true\|false` for `dock` (true docks it to an edge, false undocks it; default toggles). `close` takes a detail, a float or a dock's tile (it shuts the dock); the lanes and the preview stay and say why. `float` pops a reader out or puts a float back, `dock` on the board's `tree` and `backlinks` undocks or docks the whole dock. An agent can't close or float the tile that has your keys | board `x`, `esc`, `o`, a click on a float's `⧉`, `T`, `B`; desk `^W x`, `^W f`, `^W p` |
| `tile.zoom` | `tile=<tile>`, `on=true\|false` (default toggles). The desk and every screen on it, the board too. An agent zooms only the tile that has your keys | `^W z` |
| `pane.split` | `kind=` any tile kind (`actions` lists them: reader, tree, detail, preview, thread, activity, who, art, an extension's, …), `dir=row\|col` (default along the longer side): `tile.open` with its own arguments. On the board a detail opens with a note (`open tile=new-detail`) | desk `^W o` |
| `backlinks` (the backlinks tile's) | `id` (default the tile's note; yours, none: the reader you read through), `filter`, `kind` (key or label, or `all`), `stage` (`all open waiting draft active done`), `resolved`, `related`, `sort` (`updated`, `created`, `title`, optionally `-asc`/`-desc`). Answers the view: status line, groups, rows. An agent's reads the person's view with its own options on top and changes nothing of theirs; yours (`as=you`) sets the dock | `b`, `/ s K w h n .`, clicks |
| `edit`, `edit.text`, `edit.save`, `edit.reload`, `edit.close` | `text`; `discard=true`; `external=true` (edit: open it in `$EDITOR`, the person's only) | `e` then `⏎`, typing or `Ctrl+E` (`$EDITOR`, from a reader), `Ctrl+S`, `Ctrl+R`, `Esc` |
| `edit.external` (the board's new card: `composer.external`) | none: hand the open edit, or the comment or reply being written, to `$EDITOR`; the person's only | `Ctrl+X Ctrl+E` in a draft, the tile menu's `edit in $EDITOR` |
| `edit.arm` | `external=true` (`Ctrl+E`'s) | the person's `e`: asks before `edit` opens (refused to an agent, which runs `edit`) |
| `edit.arm.set` | `on`, `ms` | whether `e` asks first and how long it waits; kept in the state dir (`edit-arm.json`), `EP0CH_EDIT_ARM` over it |
| `hyper.set` | `on` | the hyper layer on or off; kept in the state dir (`hyper.json`), `EP0CH_HYPER` over it |
| `keys.probe` | `on` | describe the next keys (bytes, modifiers, the key read) instead of running them; the person's, esc ends it |
| `reader.overscroll` | `rows=half\|none\|<n>` | how far readers (detail, preview, the desk's, a river column, the BBS reader) and drafts scroll past their last line (PIE-622): `half` (the default) lets it come up to the middle, `none` stops it on the bottom edge, a number of rows that far; kept in the state dir (`reader-overscroll.json`) |
| `reader.hero` | `on`, `mode=first\|follow` | whether a reader's sticky header takes the note's hero image as a dimmed background as it scrolls under (PIE-598), or (`follow`) each picture in turn; kept in the state dir (`reader-hero.json`) |
| `session.leave` | none: leave the edit or comment as a click elsewhere does (an unchanged edit closes, a changed one saves, a refused save or a comment is kept as unsent). An agent: only a session it opened | a click outside the draft; desk `^W` then a window key |
| `composer.leave` | none: the board's new card or note is kept as unsent, never created. The person's only | a click outside the composer |
| `composer.close` | `discard=true` with typed text: the board's new card or note closes, typed text put aside as unsent. The person's only | `Esc` (twice with typed text) |
| `draft.newline`, `draft.indent`, `draft.outdent`, `draft.place`, `draft.scroll`, `draft.preview` | `plain=true`; `from`, `to` (lines from 1; default the cursor's or the selection's); `line`, `col`, `extend=true`; `by` (rows); `on`. On the reader's edit or the comment being written, and only a draft the agent opened and alone has typed in: the person's draft, typed in or not, is theirs (an agent's change lands there as a `draft.patch`) | `Enter` (`Alt+Enter` plain), `Tab`, `Shift+Tab`, a click or a drag, the wheel, `Ctrl+P` |
| `draft.undo`, `draft.redo` | none: the newest change in the reader's draft taken back, or put back (an agent: only its own steps; in the person's draft its last patch where it is now) | `Ctrl+Z`; `Ctrl+Y`, `Ctrl+Shift+Z` in a draft |
| `draft.paste` | `text`: put in at the cursor as a paste does, one undo step | a paste in a draft |
| `draft.copy` | none: the draft's selection, returned (the person's to their clipboard) | `Cmd+C`, `Alt+C`, `[copy]`, a drag's release |
| `revisions` | none: the note's revisions, the current one then the earlier texts the outline keeps, newest first (when saved, by whom, size, first line) | `ep0ch revisions <id>` |
| `revision.restore` | `revision` (default: the one before what the edit holds; again goes further back): that revision's text into the edit as one undo step, written on `ctrl+s`. An agent's only in an edit it opened | the tile menu's `an earlier revision`; `ep0ch revisions <id> <n> --restore` from a shell |
| `proposal.apply` | `id` (default: the proposal whose embed or control is the current element, else the note shown): apply anyway, as an edit by whoever runs it; refused on one marked `[proposal-applies::no]` | `A`, a click on `[apply]` |
| `proposal.dismiss` | `id` (default: the proposal whose embed or control is the current element, else the note shown): the service (`draft.proposal.dismiss`) takes its embed line out of the note or the draft of it, marks it dismissed and puts it in Trash, all recorded as whoever runs it; an agent dismisses only its own | `X`, a click on `[dismiss]` |
| `complete` | `text` ending in the token (`[[HOME-4`, `((beds`, `((plan#`, `[file::notes/`), or none for the draft's cursor; `insert=n` puts the nth into the draft (an agent's: only a draft it opened, or with `invitation=`) | `[[ (( [file::`, `Tab`, `Ctrl+Space`, `↑↓`, `Enter` |
| `passage.select`, `comment.write`, `comment.send`, `comment.close`, `comment.reload` | `quote` (exact words), `near`; `body` (an agent's: only a comment it opened, never yours; `invitation`, `base`: an invited agent's reply); reload finds the quote again, or goes back to picking | `C`, `j k J K h l H L`, `Enter`, `Ctrl+S`, `Esc`, `Ctrl+R` |
| `comment` | `quote`, `body` (select, write and send in one) | |
| `threads`, `reply`, `resolve` | `thread` (id or 6+ chars), `body`; `open=true` reopens | `m`, `r`, `x`; the Reply and Resolve controls |
| `thread.toggle` | `thread`, `expand=true\|false` (default toggles). The person's only | `Enter` or a click on a comment mark |
| `link.select`, `link.follow`, `up` | `n` (from 1); `fresh=true` (follow) opens it in a new reader. An agent's is refused in the reader that has your keys (and its `link.follow n=` never moves your `[ ]` position); a web link or a figure an agent follows is never opened in your browser or viewer: it gets the address back | `[ ]`, `Enter`, `alt+Enter` or a click, `u` (`U` in the message reader) |
| `elements`, `element.select`, `element.open` | `n` (from `elements`), or `by=1\|-1` (select: the next or previous), `n=0` lets go; `fresh=true` opens a link, row or embed in a new reader. `element.select` is the person's only | `[ ]`, `esc` lets go, `Enter`, `alt+Enter`, a click |
| `scroll` | `by=` rows, or `to=top\|end`: the reader's own scroll. `to=end` puts the last line on the bottom edge; again, it goes on past the end (`reader.overscroll`, to the middle by default, PIE-622). It answers the viewport, with `atEnd` and `past` (the blank rows scrolled under the last line). An agent's is refused on the reader that has your keys: it uses `view.scrollTo` | `j k ↑↓ PgUp PgDn space Home End G`, the wheel |
| `callouts` | `show=true\|false` (default toggles): every callout open, or back as written. The person's only | `z` |
| `callout.list` | none: the note's callouts (`n`, `line`, type, title, whether it starts folded, whether it's folded here) and the outline's callout types, with any problem in their declarations | |
| `callout.type`, `callout.start` | `n` (from `callout.list`) or `line` (its header, 1 is the subject); `to=<type>` or `folded=true\|false`. One header line rewritten through the note's save, revision-checked, attributed; an agent never under a draft someone has open on the note | the type choice's `⏎`, `-`, `+` |
| `callout.undo` | none: the asker's own last callout change in this reader, while reading this note | `ctrl+z` (when it was the last change here) |
| `callout.menu` | `n` or `line`: opens the type choice. The person's only | `⏎` or a click on a callout's icon or type |
| `images` | none: the note's images and videos (`n`, `line`, path, the layout its line writes, what's wrong with it, how it's drawn here) | |
| `image.size` | `n` (from `images`) or `line`; `to=40\|40%\|full\|none` (its width), `height=N\|none`, or `by=1\|-1` (a step; a header's height by two rows). Its line rewritten through the note's save, revision-checked, attributed | `+` `-` with an image the `[ ]` position, the caption's `[−][+]` |
| `image.align` | `n` or `line`; `to=left\|center\|right` or `by=1\|-1` | `←` `→` with an image the `[ ]` position, the caption's `[◂][▸]` |
| `image.hero` | `n` or `line`; `on=true\|false` (default toggles): `[layout::hero]` on its line, and off any other image's, in one save | `H` with an image the `[ ]` position, the caption's `[▀]` |
| `image.fit` | `n` or `line`; `to=cover\|contain` (default: the other one): a header too tall for its rows cropped to fill, or shown whole | `=` with the header image the `[ ]` position, its caption's `[whole]` / `[fill]` |
| `image.dim` | `n` or `line`; `to=0..1\|auto`: how much it's dimmed (`[dim::…]`). No key brightens an image | |
| `image.undo` | none: the asker's own last image change in this reader, while reading this note | `ctrl+z` (when it was the last change here) |
| `select.mode` | none: keyboard selection starts (`h j k l` extend, `y` copies). The person's only: an agent selects with `select text=` | `v` |
| `fold.select` | `by=1\|-1`: the next or previous heading, list item or callout to fold. The person's only | `( )` |
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
shut dock (`tree`, `backlinks`) are refused until the dock is open, so nothing changes out of sight.

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
    bun scripts/snap.ts           # drives the real door, read-only, against the outline this folder names (or EP0CH_SOCKET); writes out/snap-kitty-*.png
    bun scripts/snap.ts cells     # same, cells mode
    bun scripts/snap.ts desk      # the desk at 200×60: expand, focus, add a tile, move one to an edge, search
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
    bun scripts/snap.ts backlinks    # its own scratch host: the board's backlinks dock as Detail shows it, a kind and a filter
    bun scripts/snap.ts steps     # its own scratch host: nested and anchored embeds, a cycle, a step's status choice, an agent's change

`test/kanban.test.ts` creates cards and notes, sets steps, trashes and restores, and moves into OR lanes
by keys and through the control socket, with the service's plans (`views.planWrite`; its planning is
tested in the outliner's `test/view-writes.test.ts`). `test/edit.test.ts`, `test/move.test.ts` and `test/comment.test.ts` save, move, comment and race real
writes against a throwaway outline host they start themselves (`test/scratch.ts`: its own outlines folder,
one outline). `test/platform.test.ts` covers which lanes a change asks again, a dropped
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

- The door has no query evaluator of its own: live figures, lanes, moves and new cards all ask the service
  (`blocks.query`, `query.matches`, `views.read`, `views.planWrite`).
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
- Sessions (PIE-418): one per outline.
  Two terminals share one size, the latest typer's (as tmux's `window-size latest`); the other sees the frame cut or
  padded. Text typed into a draft since it was last put aside lives only in the daemon's memory: a daemon killed
  with `-9` loses it (a handoff puts it aside first). The terminal host's own code can't be upgraded under its
  programs: a change to its protocol ends them, and their tiles start them again.
