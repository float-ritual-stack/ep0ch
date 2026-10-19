# Runbook

A `[type::runbook]` note holds runnable fences, inline or in child blocks. Press **run** beside a fence, or select
its control with `[` / `]` and press Enter. Each press opens a terminal tile named for the step. Another press
while it runs offers to focus its tile or stop it. You choose the order.

Paste this whole example as one note:

````text
Tend the demo garden [type::runbook] [herb::sage]

Garden context
cwd:: /tmp
```env
LABEL=The herb garden
HERB={{self.herb}}
```

Print the label
```sh run
printf '%s: %s\n' "$LABEL" "$HERB"
```

Choose a pot
run::
```sh
printf 'Pot: %s\n' {{ask.pot}}
```

Check a token
```sh run
test -n {{secret.token}} && printf 'Token received\n'
```
````

Only `sh run`, `bash run`, `zsh run`, or a fence immediately preceded by `run::` is runnable. An `env` fence
and ordinary example fences stay plain. Saving assigns a stable `^step-…` anchor; keep it when editing the title
or command. A child step keeps its anchor when moved.

Context follows document order: the runbook's own text, then children depth first. `cwd::` changes the working
folder. An `env` fence sets literal `KEY=value` lines for every step below, until later context changes them.
These lines never execute shell expansions. A step's `run:: --cwd=/folder` overrides its folder.
Malformed env lines stay saved and show a warning; the affected step names what must be fixed before it runs.

Values use `{{self.name}}` for a runbook property, `{{ask.name}}` for a fresh answer, and `{{secret.name}}` for a
masked answer. References pass through quoted environment bindings, including when used inside shell quotes.
A value reaches the command as an environment variable; writing "$TOKEN" inside an argument puts it in that process's argv like any shell would, so prefer passing secrets by environment (`curl -H @-` or a config file).
Other braces, such as Docker's `{{.Names}}`, stay literal. `[choices::pot clay,wood]` supplies fixed choices for
`{{ask.pot}}`. Agents supply answers with `with='{"ask.pot":"clay"}'`; private values stay in the door and
are not sent as service action arguments.

Commands run in your login shell (`$SHELL -lc`) with the context applied. Terminal input works for prompts.
Ctrl+] returns keys to the door; close the tile or choose stop to stop its program. Re-run from the note.

Every run creates a child `[type::run]` record under the runbook: step anchor, who, start/end, status, exit,
folder, variable names and a trimmed plain-text output tail. A live **Runs** table is inserted once and can be
sorted through the existing figure controls. The step's control shows its last result. Running never writes
into the step's command. Cancelled prompts create no record. After an unexpected door exit, the next door
marks records whose local owning process ended as lost.

Secrets are masked in records, including encoded and terminal-escape-split forms. Masking is best-effort.
The live terminal shows what the program prints; avoid printing secrets. Secret answers are never remembered.

with-secrets references and completion belong to slice 2. Output references and confirmation belong to slice 3.
