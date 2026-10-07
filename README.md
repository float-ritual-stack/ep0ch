# ep0ch

A BBS-style terminal door into a programmable outline, and the outline service it calls.
Your notes live in one SQLite file per outline. Both you and your agents read and write them,
always attributed, through the same actions.

```
packages/
  outline-core/   the shared pure code: protocol, property grammar, search matching, which-outline rules (no I/O)
  outliner/       the outline host (one per machine, serves ~/outlines/<name>.sqlite by name), the admin
                  Tree/Detail panes in Herdr, the CLI, the publisher and the extensions
  door/           ep0ch: the door: screens, a tiling desk, the river (Quay), the board, your drawer
  claude-mod/     the Claude Code mod: outline tools and recent mentions in every Claude session
```

Two clients, one outline: the outliner's Tree/Detail in [Herdr](https://herdr.dev) is the sysop console for
finding and fixing any block, and the door is the board people (and agents) call into.

## Start

```sh
git clone git@github.com:float-ritual-stack/ep0ch.git ~/projects/ep0ch
cd ~/projects/ep0ch && bun install
ln -s ~/projects/ep0ch/packages/door/src/main.ts ~/.local/bin/ep0ch
ep0ch doctor            # every piece of the stack, and the command that fixes each
ep0ch install --apply   # backs up ~/outlines/*.sqlite, then brings the rest current
```

Then:

| | |
|---|---|
| `ep0ch` | the outline this folder names in `.ep0ch`; with none, the home base (open, new, import, here or on a machine) |
| `ep0ch --ws garden` | an outline by name, from anywhere (a name nobody has yet is created on this machine; on another, only with `--create`) |
| `ep0ch --machine box-a` | the door here, the outline on that machine (an ssh config name), over a shared forward |
| `ep0ch --remote box-a` | this terminal on the door session running there |
| `ep0ch --screen library` | any screen by name (`--screen <name> [<target>]`); `library` is the component library, a page for each component |
| `ep0ch revisions <note>` | a note's earlier texts (the newest 100); `--restore` saves one as the note |
| `ep0ch backup status` | the 15-minute restic backups: `list`, `run`, `restore <outline> --to <path>` |
| `ep0ch mcp access read\|propose\|full` | what claude.ai may do on an outline through the MCP gateway; `ep0ch mcp pull` and `queue status` for the laptop's queued writes |
| `ep0ch --showcase` | every shared part of the door, live, on its own seeded outline of made-up notes |
| `ep0ch find <words>`, `ep0ch show <id>` | the service's forgiving search, and a note drawn as the door draws it, at your shell |
| an ssh login | lands straight in the door where the host's login shell runs `ep0ch` (the door README, "Getting started") |

`ep0ch help` lists every command.

A folder names its outline with a two-line `.ep0ch`, names only:

```
ws = "garden"
machine = "box-a"   # optional
```

## Where to read next

- [CHANGELOG.md](CHANGELOG.md): what changed, and what to run after an update.
- [packages/door/README.md](packages/door/README.md): the door, screen by screen.
- [packages/outliner/README.md](packages/outliner/README.md): the outline host, Tree/Detail, the CLI and publishing.
- [packages/outliner/docs/extensions/README.md](packages/outliner/docs/extensions/README.md): userland extensions (data, inline output, rich components, tiles, `@agents`).
- [packages/claude-mod/README.md](packages/claude-mod/README.md): the Claude Code mod.
- [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md): how agents work here, verification and review.
  Agents load the stack's skills: `ep0ch` (drive a door), `ep0ch-outline` (work in an outline for someone),
  `ep0ch-core` (change this code).

## Development

```sh
bun run check   # tsc in every package
bun run test    # every package's suite, each against scratch services it starts itself
```

On a shared machine, whole suites go through `scripts/box-test [--on float-box|boxd]`, and anything that starts a
door or a scratch host through `scripts/agent-env <name> [--test] -- <cmd>` ([CONTRIBUTING](CONTRIBUTING.md#verification)).

Tests never touch a real outline. The schema has one version: a database at any other version is refused,
and a schema change ships as a one-off migration script that runs once, then is deleted.
