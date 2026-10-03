# television: the outline in tv

A userland extension of the door: three [television](https://github.com/alexpasmantier/television) (`tv`) channels
that read the outline the way the `git-log` channel reads a repository, and a helper they call. Nothing in the door
imports this folder. Delete it and the door works as before; the next `ep0ch install` takes away its links.

| Channel | What it lists | Enter prints | Other keys |
|---|---|---|---|
| `tv ep0ch` | the outline's notes, three ways (`ctrl-s` cycles): **Tree**, the outline depth first as Tree orders it, drawn with `├─ │ └─`, each level's titles in their own colour and what a note is (work id, stage, type) dim beside it; **Recent**, the newest notes; **All**, every note, newest first, as `title · path` (tv matches on what's shown) | `((id))` for each note chosen | `ctrl-g` opens it in the running door; `ctrl-d` shows it in the Outliner's Tree and its Detail |
| `tv ep0ch-files [<folder>]` | the files under `<folder>` (default: here), relative; a path holding a `'` or a `]` is left out (tv pastes fields into commands unescaped, and `]` would end the token) | `[file::<absolute path>]` for each file chosen | |
| `tv ep0ch-outlines` | this machine's outlines, then each machine you've opened before, with its outlines | opens the door on it: `ep0ch --ws <name> [--machine <ssh-name>]` | |

`Tab` picks several entries (tv's `toggle_selection`); Enter prints one output per line. A note's preview is the same
from each of the `ep0ch` channel's sources.

A Tree of part of the outline: `EP0CH_TV_ROOT=<id> tv ep0ch` (tv takes no channel argument: its second word is a
folder), or `tv ep0ch --source-command "ep0ch-tv tree <id>"`. The channel keeps its sources' order (`no_sort`, no
frecency), as the `git-log` channel keeps git's: typing narrows the tree without reordering it, and Recent and All stay
newest first.

```
Kitchen sink  · showcase
├─ House jobs  · work-queue
│  ├─ HOME-001 — Fix the back gate latch  · queued · roadmap-item
│  └─ HOME-002 — Bleed the radiators  · queued · roadmap-item
├─ Kitchen whiteboard
│  └─ Kitchen tap
├─ Bike shed
│  ├─ Puncture kit
│  └─ Comment on “The spare inner tubes”  · annotation
│     └─ Comment on “The spare inner tubes”  · annotation-reply
└─ Allotment figures
``` The
preview of a note is the note as the door draws it (`ep0ch show <id> --ansi`, the note surface), of a file its start
(`bat` when it's there), of an outline its newest notes. `ctrl-x` lists a channel's actions, `ctrl-t` switches channel.

## Which outline

The door's one rule: `--ws`, `EP0CH_WS`, the nearest `.ep0ch` from the folder tv runs in (a `.ep0ch`'s `machine`
too). In a folder that names none, set `EP0CH_WS=<name>`. From the door's `ctrl+t` (below), the channel reads the
outline the draft is in: the door passes `EP0CH_SOCKET` and `EP0CH_WS`.

`[file::…]` names a file on the outline host's machine, so pick files there (for an outline on another machine, run
`tv ep0ch-files` in a shell on it).

## In the door: ctrl+t

In any draft (an edit, a comment or reply, the board's new card) `ctrl+t`, or a click on `[insert]` in its title
row, opens `tv ep0ch` where `ctrl+e` opens `$EDITOR`: on the desk and the river, in a terminal tile beside (or below) the
note, with your keys (the draft stays in view); on a screen without tiles or with a locked shape (the board), over the
whole terminal. What you choose
goes in at the cursor, space-separated, and the tile closes. Switch to `ep0ch-files` with tv's `ctrl-t` to put in
files. `ctrl+]` leaves the tile for the door with tv still open; another `ctrl+t` on that draft meanwhile opens no
second one. That action is the door's (`draft.pick`,
src/pick.ts) and knows nothing of tv: `EP0CH_PICKER` names another picker (`fzf -m`), and `EP0CH_PICK_CHANNEL`
its argument (default `ep0ch`, empty for none).

`ctrl-g` in the `ep0ch` channel opens the note in the door through its control socket (`ep0ch open <id> --as
television`): the agent path, so the door says "an agent (television) opened a note" and your focus stays where it
is. Inside the door's `ctrl+t` that is the door you came from; from a shell, your running door (`EP0CH_CONTROL` names
another).

## In bash: tv's shell integration

With `eval "$(tv init bash)"` in `~/.bashrc`, `ctrl+t` opens tv on a channel chosen by the command being typed. To
have commands open these channels, add triggers to your tv `config.toml` (this extension doesn't edit it):

```toml
[shell_integration.channel_triggers]
"ep0ch" = ["ep0ch show", "ep0ch open"]
```

Then `ep0ch show <ctrl+t>` picks a note and puts `((id))` on the line, shell-quoted (`ep0ch show` and `ep0ch open`
take `((id))` as the id). `ep0ch-outlines` isn't for a trigger: its Enter opens the door rather than printing.

## Install

`ep0ch install --apply` links the files `ext.json` names, when `tv` is on PATH: the cable files into
`$TELEVISION_CONFIG/cable` (else `~/.config/television/cable`) and `bin/ep0ch-tv` beside `ep0ch`. It says each link,
and never replaces a file it didn't make; it records what it linked (`install-links.json` in the door's state), so after
this folder is deleted the next install takes those links away. By hand:

```sh
ln -s "$PWD"/cable/*.toml ~/.config/television/cable/
ln -s "$PWD"/bin/ep0ch-tv ~/.local/bin/
```

`ep0ch-tv` runs the door from the checkout it's in (`../../src/main.ts`), so the channels and the door are the same
code.

## How it works

- **Sources:** `ep0ch find --tree [<root>] --lines` prints the outline depth first, in the service's own order (its
  tree index, the walk Tree draws), each note with its depth and the `├─ │ └─` that draw its place (past ten levels the
  outer rails become `…<depth>`, so a deep title stays in view); `ep0ch find --recent --lines` and `ep0ch find --lines`
  print the newest and every note as `id<TAB>title<TAB>path`. `ep0ch-tv` colours them as git's `--color` colours a log
  (`ansi = true`, `no_sort`, no frecency, as the `git-log` channel) and puts the note's id after the line in an empty
  OSC 8 link (`ESC ]8;;ep0ch:<id> ESC \`). tv drops escapes from what it shows and from what it matches, so the id is
  out of view and the letters you type never match its hex (an id after a tab, or past the right edge, would be
  matched: tv matches an ansi line whole, and a `display` template can't colour). The templates take it from the raw
  line with `{replace:s/^.*\x1b\]8;;ep0ch:([0-9A-Za-z_-]+)\x1b.*$/$1/}` (and `ep0ch-tv` takes nothing but an id's letters), where `git-log`'s take the hash with
  `{strip_ansi|split: :0}` (`strip_ansi` drops the link with its id). An outline reference needs the whole id (a short
  one doesn't resolve), so it is whole and out of view rather than shortened. tv runs a source
  once and filters as you type. `ep0ch find <words>` is the service's forgiving ranker (as `((` and Goto rank), for
  scripts.
- **Preview width:** tv tells a preview command nothing about its panel (it runs the command with stdout to a pipe,
  and sets no `COLUMNS`). `ep0ch-tv preview` reads the terminal's width from `/dev/tty` (`stty size`) and takes the
  channel's preview share (60%) less the border; `EP0CH_TV_PREVIEW` changes the share it assumes.
- **Output:** tv prints each chosen entry's `output` template on its own line, and draws its screen on stderr when
  its stdout isn't a terminal: that's how the door's `ctrl+t` reads the choice. The door runs `tv ep0ch > <file>` (a
  private file in its state); in a tile, tv's stderr is the tile's terminal, so it draws there, and the door reads the
  file when tv exits.
