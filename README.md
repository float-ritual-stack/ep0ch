# ep0ch

A BBS-style terminal door into a programmable outline, and the outline service it calls.
Your notes live in one SQLite file per outline. Both you and your agents read and write them,
always attributed, through the same actions.

```
packages/
  outline-core/   the shared pure code: protocol, property grammar, search matching, which-outline rules (no I/O)
  outliner/       the outline host (one per machine, serves ~/outlines/<name>.sqlite by name), the admin
                  Tree/Detail panes in Herdr, the CLI, the publisher and the extensions
  door/           ep0ch: the door: screens, a tiling desk, the river (Quay), the board, the agent drawer
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
| `ep0ch` | the outline this folder names in `.ep0ch`; with none, the home base (pick, new, import) |
| `ep0ch --ws pie` | an outline by name, from anywhere |
| `ep0ch --machine float-2` | the door here, the outline on that machine (an ssh name), over a shared forward |
| `ep0ch --remote float-2` | this terminal on the door session running there |
| `ssh ep0ch` | on a host set up for it, lands straight in the door |

A folder names its outline with a two-line `.ep0ch`, names only:

```
ws = "pie"
machine = "float-2"   # optional
```

## Where to read next

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

Tests never touch a real outline. The schema has one version: a database at any other version is refused,
and a schema change ships as a one-off migration script that runs once, then is deleted.
