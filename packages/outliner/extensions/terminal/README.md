# Terminal

A shell and an agent in a tile beside your notes. The extension is two rows, and no code: each is a tile kind a
door's terminal drawer (`pty`) draws, and the row says what runs.

- **Shell** (`terminal.shell`): your login shell. Nothing is typed into it.
- **Agent** (`terminal.agent`): your shell with the agent's command typed into it once it is ready for a line
  (`command` in the row's `fields`). Leaving the agent leaves you in the shell.

A tile's own fields win over its kind's, so one tile runs something else without a new kind:
`terminal.open command="seedbot --plan beds" cwd=~/plots`. To change the agent for every tile, fork the extension
(`ep0ch ext add terminal`) and edit `fields.command`; to add another program, add a row.

**Any extension's program is a row too.** A tile kind an extension declares with `run` is served to a door with the
terminal drawer as the line that starts it, the folder it starts in and the machine that folder is on
(`screens.list`'s `kinds`), so the drawer draws it with no code for that program.

**Which door draws it.** The native window, when it is built with its terminal (`cargo build --features pty`, see
`packages/native/README.md`); built without, a tile of these kinds says so, in the row's own words. The door has
terminal tiles of its own (its `pty` kind) and no `pty` drawer for these rows: a tile of them there says that. The
two doors don't share a program yet (the door's terminal host has one client).

**The list.** `lists.read from=programs` lists the programs a door hands over, a row each with the jump as its pick
(`terminal.jump key=`). The `programs` tile kind over it is the screens extension's, beside its other lists, and the
kitchen screen has it with the buttons that open a shell and an agent.

It is on wherever the service runs. Uninstalled, a tile of its kinds says the kind is gone;
`extensions.install id=terminal` brings it back.
