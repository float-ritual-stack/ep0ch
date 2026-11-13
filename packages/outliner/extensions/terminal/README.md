# Terminal

A shell and an agent in a tile beside your notes. The extension is two rows and no code: each is a tile kind a
door's terminal drawer (`pty`) draws, and the row says what runs.

- **Shell** (`terminal.shell`): your login shell. Nothing is typed into it.
- **Agent** (`terminal.agent`): your shell, with the agent's command typed into it once it reads a line.
- **The command** is the row's `fields.command`. Leaving the agent leaves you in the shell.

## Run something else

- **One tile:** `terminal.open command="seedbot --plan beds" cwd=~/plots`. A tile's own fields win over its kind's.
- **Every agent tile:** fork the extension (`ep0ch ext add terminal`) and edit `fields.command`.
- **Another program:** add a row.
- **Any extension's program** is a row too: a tile kind declared with `run` is served bound to the same drawer.

## Which door draws it

- **The native window,** built with its terminal: `cargo build --features pty` (`packages/native/README.md`).
- **What keeps the program:** herdr-core where the machine has `hc`, else tmux, else a plain pty.
- **Built without,** a tile of these kinds says so, in the row's own words.
- **The door** has terminal tiles of its own (its `pty` kind) and no drawer for these rows.
- **The two doors share no program yet:** the door's terminal host has one client.

## The list

- **`lists.read from=programs`** lists the programs a door hands over.
- **A row's pick is the jump:** `terminal.jump key=`.
- **A row says** what the program is, what it reports of itself and what keeps it.
- **What the door never started** is listed after its own, with no pick.
- **The `programs` tile kind** is the screens extension's; the kitchen screen has it.

It is on wherever the service runs. Uninstalled, a tile of its kinds says the kind is gone;
`extensions.install id=terminal` brings it back.
