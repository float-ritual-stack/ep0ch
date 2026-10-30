# Runbook

Run a note's shell steps one at a time, from the note, with each run recorded beside it.

## Where to look

- **Runbook demo:** under the extension's page.
- **The Runs table:** inserted once under a runbook, with one `[type::run]` record per run.
- **Each step's control:** shows its last result.

## What you do

- **Run a step:** press **run** beside a fence, or select its control with `[` / `]` and press Enter.
  - Each press opens a terminal tile named for the step.
- **Stop or focus:** press again while it runs and choose.
- **Choose the order:** run any step, in any order; there is no run-all.
- **Give keys back:** Ctrl+] returns keys to the door; close the tile or choose stop to stop its program.
- **Run again:** press the step's control again.

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

## Writing a runbook

- **A runbook** is a `[type::runbook]` note with runnable fences, inline or in child blocks.
- **Runnable:** only `sh run`, `bash run`, `zsh run`, or a fence right after a `run::` line.
  - An `env` fence and ordinary example fences stay plain.
- **Anchors:** saving assigns a stable `^step-…` anchor; keep it when editing the title or command.
  - A child step keeps its anchor when moved.
- **Folder:** `cwd::` changes the working folder; a step's `run:: --cwd=/folder` overrides it.
- **Environment:** an `env` fence sets literal `KEY=value` lines for every step below, until later context changes them.
  - These lines never run shell expansions.
  - Malformed lines stay saved with a warning; the affected step says what to fix before it runs.
- **Order of context:** the runbook's own text, then children depth first.

## Values

- **`{{self.name}}`:** a property of the runbook note.
- **`{{ask.name}}`:** a fresh answer, asked each run.
  - `[choices::pot clay,wood]` supplies fixed choices for `{{ask.pot}}`.
- **`{{secret.name}}`:** a masked answer.
- **Other braces** such as Docker's `{{.Names}}` stay literal.
- **How they arrive:** as quoted environment variables, including inside shell quotes.
  - Writing `"$TOKEN"` inside an argument puts it in that process's argv, like any shell would.
  - Prefer passing secrets by environment (`curl -H @-`) or a config file.
- **Agents** supply answers with `with='{"ask.pot":"clay"}'`.
  - Private values stay in the door and are never sent as service action arguments.

## How it works

- **Shell:** commands run in your login shell (`$SHELL -lc`) with the context applied; terminal input works for prompts.
- **Records:** every run creates a child `[type::run]` note under the runbook.
  - It holds the step anchor, who, start and end, status, exit, folder, variable names and a trimmed plain-text output tail.
  - Running never writes into the step's command; a cancelled prompt makes no record.
- **Lost runs:** after an unexpected door exit, the next door marks records whose owning process ended as lost.
- **Secrets:** masked in records, including encoded and terminal-escape-split forms; masking is best-effort.
  - The live terminal shows what the program prints, so avoid printing secrets.
  - Secret answers are never remembered.
- **Not yet:** with-secrets references with completion, and one step reading another's output, with a confirmation.
