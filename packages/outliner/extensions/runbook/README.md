# Runbook

A note is a runbook. Each step is a block with a `run::` line and its command in the first code fence. Press
**run** on a step, or **run all** at the top of the runbook. The step's last status is beside its control.
The controls use the same actions as `act ext.runbook.run-step block=<id>` and `act ext.runbook.run-all block=<id>`.
On a selected run line, `x` runs the step; controls also open with Enter or a mouse click.

````text
Tend the demo garden [type::runbook]
  Choose a herb [choices::herb basil,mint,sage]
  run:: --keep
  ```sh
  printf 'Planting %s\n' {{ask.herb}}
  ```
  Supply a token
  run::
  ```sh
  garden-login --token-env RUNBOOK_SECRET_token
  # A placeholder declares the value; its replacement is a quoted environment reference.
  test -n {{secret.token}}
  ```
````

## Where commands run

`--mode=terminal` is the default. The door opens a terminal tile beside the note, with your shell, PATH and keys.
Type directly into it when a command prompts: `read`, `sudo`, and `ep0ch keys set` work normally. Ctrl+] returns
keys to the door. The tile stays after exit; `--close=on-success` dismisses it after a successful final step.
Run the step again from the note to answer its form again.

`--mode=host` runs a noninteractive script in the outline host as its service user, with the existing timeout
(`config.json`: `{ "config": { "timeoutSeconds": 120 } }`). Use terminal mode for commands that prompt or restart
that host. The existing `dry` and `apply` modes remain host actions; an apply step requires the person and its
confirmation word. They do not mean a shell command is simulated.

`--on=laptop` (also `--on laptop`) runs a terminal step with your SSH configuration, using `ssh -tt -- laptop`.
The outline's existing connection carries the plan and result; its link does not carry shell commands. For steps
with supplied values, the remote machine needs `python3`: a fixed helper turns terminal echo off, receives the
values through SSH's input, restores the terminal and starts your shell. Values never appear in SSH's arguments.
If SSH exits 255, the step is marked **waiting**, with a command to paste under it. Secret values are replaced by
instructions to enter them in the terminal. Continue tries the machine again.

## Values and confirmation

- `{{ask.name}}` asks for text. `--keep` remembers it on the runbook as `[name::value]`; otherwise it is kept only for
  this run. The next run offers a remembered value in the form.
- `{{secret.name}}` asks for masked text. It is never remembered. Closing the form discards its answers.
- `[choices::name first,second,third]` on the step makes that field a pick list.
- `[form-field::name file]` on the step opens the shared file picker. Select a folder to browse into it.
- `--confirm=ship` asks for exactly `ship` in the form before running the step.

Write these placeholders as shell arguments without surrounding quotes: they become quoted environment
references, `"${RUNBOOK_ASK_name}"` or `"${RUNBOOK_SECRET_name}"`. A value containing spaces, quotes or shell
operators stays data. Do not embed a placeholder inside another quoted shell string. Values are not inserted
into the command's text, a draft, or the undo history. A secret is scrubbed from the recorded output, including
its encoded forms and text interrupted by terminal escapes. A command may still display what it prints in its
terminal; use the program's own masked prompt when that is what it expects.

The existing Site grammar is still available: `{{self.name}}` reads the nearest runbook's own property, and
`{{props.name}}` reads action arguments or the runbook's `[form-field::name text]` fields. The service fills these
through `site.answer`; values outside the runbook's own properties must be plain shell-safe characters. Prefer
`ask` for values the person supplies at run time.

`--secrets=group[,group]` loads named with-secrets groups into the environment. Terminal mode reads them on the
door's machine; host mode reads them on the host. Their values are scrubbed with the same shared scrubber.

## Walking and recording

Run all visits steps in outline order, reusing one terminal tile. A command's own prompt waits in that terminal.
A failed step offers **continue** (the next step) and **stop**; a waiting remote step's Continue tries that step
again. These are `runbook.continue` and `runbook.stop`, also available through `act`.

Each exit is recorded in an output region under the step, with status, exit code, time, attribution and the last
15 lines. `[run.last::ok|failed|waiting]` is queryable. If the host is restarting when the command ends, Continue
saves the pending record without running the command again. The pending result lives in this door until saved;
keep the door open. Closing the door ends its temporary terminals. A session handover is refused while a runbook
is active, so an install cannot kill the terminal running that install. The install reports that session as left
on its current code; after the runbook finishes, run `ep0ch session upgrade` from your shell.

## The demo

The extension page includes *Try a terminal runbook*: one command asks for a herb in the terminal, then another
asks for a fictional masked token in the argument form. It is also the **runbook** section of `ep0ch --showcase`.
*Ship the demo widget* demonstrates the existing host runner and its secrets groups. All demo content is made up.
