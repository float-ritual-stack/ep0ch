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

## Shell handler lines

- **In any note:** type `sh:: ls ~/projects/ep0ch/packages/*/docs/*.md | as files`.
  - Completion after `::` offers `sh::` and `nu::`, with a worked `ls | sed` demo.
- **Run:** select the line and press **x**, or click its **run** chip.
  - `act ext.runbook.run-sh block=<id> line=<zero-based line>` does the same; `run-nu` uses Nushell.
- **Output:** lands under the command as an owned region, with `sh · as of <time> · run again` above it.
  - Running again replaces that region; other lines stay where you put them.
- **Your edits:** the next press asks before replacing them. **Keep as my text** in the line's menu, its button, or **K** detaches the region.
  - Agents use `ext.runbook.keep-sh` / `keep-nu`, or confirm replacement with the `with=` answer returned by the action.
- **Format:** append `| as files`, `links`, `tasks`, `list`, `table` or `code`; stages run left to right after the shell pipeline.
  - These are ordinary `[script::name]` notes under Runbook's page: copy or edit one, and `| as ` completion finds it.
  - Each gets `props.lines` and `props.cwd[0]`, and returns text. Files become absolute `[file::…]` lines.
  - Quotes and ordinary shell pipes stay in the command. A missing formatter names the nearest scripts and a close match.
- **Folder:** nearest `[cwd::…]` or `cwd::` in the note and its ancestors, otherwise the outline's folder.
  - An `env` fence in the runbook context supplies the same environment as a fence step.
- **Failures:** exit code and first stderr line appear beside the command, with a run-record link; existing output is kept.
  - The record holds stderr, exit, cwd and who pressed. Output is capped at 200 lines followed by `+N lines`.
  - The runbook's five-minute deadline stops a command that never ends.
- **Nushell:** `nu::` uses `nu -c`; install `nu` on the outline host and put it on PATH.
  - `sh::` uses `sh -c`. Interactive prompts belong in the terminal runbook fences above.
- **Live, not copied:** `sh:: cat <path>` still runs and writes a snapshot.
  - Its hint offers `[file::<path>]`, and `!((ref))` when a note names that file, as the live alternatives.
- **On open:** append `[run::open]` to the command to run it when the door opens the note. Off by default.
  - Edited output stays yours; use its run chip to answer the replacement question.
- **Remove Runbook:** the extensions screen offers whether to keep its demo notes. Written output and run records remain ordinary notes.
- **Kitchen sink:** open **sh-lines** for files in the showcase's own folder and the run/edit/failure walk.

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
