# television: the outline in tv

A userland extension of the door: three [television](https://github.com/alexpasmantier/television) (`tv`) channels
that read the outline the way the `git-log` channel reads a repository, and a helper they call. Nothing in the door
imports this folder. Delete it and the door works as before; the next `ep0ch install` takes away its links.

| Channel | What it lists | Enter prints | Other keys |
|---|---|---|---|
| `tv ep0ch` | every note in the outline, newest first, as `title · path` (tv matches on both) | `((id))` for each note chosen | `ctrl-g` opens it in the running door; `ctrl-d` shows it in the Outliner's Tree and its Detail |
| `tv ep0ch-files [<folder>]` | the files under `<folder>` (default: here), relative; a path holding a `'` or a `]` is left out (tv pastes fields into commands unescaped, and `]` would end the token) | `[file::<absolute path>]` for each file chosen | |
| `tv ep0ch-outlines` | this machine's outlines, then each machine you've opened before, with its outlines | opens the door on it: `ep0ch --ws <name> [--machine <ssh-name>]` | |

`Tab` picks several entries (tv's `toggle_selection`); Enter prints one output per line, in the order picked. The
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
row, hands the terminal to `tv ep0ch` the way `ctrl+e` hands it to `$EDITOR`. What you choose goes in at the cursor,
space-separated. Switch to `ep0ch-files` with tv's `ctrl-t` to put in files. That action is the door's (`draft.pick`,
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
and never replaces a file it didn't make; it records what it linked (`ext-links.json` in the door's state), so after
this folder is deleted the next install takes those links away. By hand:

```sh
ln -s "$PWD"/cable/*.toml ~/.config/television/cable/
ln -s "$PWD"/bin/ep0ch-tv ~/.local/bin/
```

`ep0ch-tv` runs the door from the checkout it's in (`../../src/main.ts`), so the channels and the door are the same
code.

## How it works

- **Source:** `ep0ch find --lines` prints every note as `id<TAB>title<TAB>path`; tv runs a source once and filters
  as you type, so the channel lists them all and tv's matcher ranks them. `ep0ch find <words>` is the service's
  forgiving ranker (as `((` and Goto rank), for scripts.
- **Preview width:** tv tells a preview command nothing about its panel (it runs the command with stdout to a pipe,
  and sets no `COLUMNS`). `ep0ch-tv preview` reads the terminal's width from `/dev/tty` (`stty size`) and takes the
  channel's preview share (60%) less the border; `EP0CH_TV_PREVIEW` changes the share it assumes.
- **Output:** tv prints each chosen entry's `output` template on its own line, and draws its screen on stderr when
  its stdout isn't a terminal: that's how the door's `ctrl+t` reads the choice.
