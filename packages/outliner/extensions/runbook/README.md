# Runbook

A note is a runbook. Each step is a block with a `run::` line and its command in the first code fence; running it
records the run under the step. Everything here is made up.

```text
Deploy the demo widget [type::runbook] [env::scratch]
  Stage the build with the token
  run:: --mode=dry --secrets=widget-demo
  ```sh
  widget stage --env {{env}}
  ```
  Apply the patch
  run:: --mode=apply --secrets=widget-demo --confirm=ship
  ```sh
  widget apply --env {{env}}
  ```
```

- `{{name}}` is filled from the runbook note's own `[name::value]` properties (or `name=value` when you run it).
- `--secrets=<group>[,<group>]` names `with-secrets` groups. When the step runs, the extension asks the service for each
  group by name (`secrets.group`; the manifest's `"secretGroups": ["*"]` allows any) and runs the command with the
  values in its environment. The service scrubs them (and their base64 and URL-encoded forms, and a value split by
  terminal escapes) from everything the extension writes and answers.
- `--mode=apply` steps are the person's: an agent's request is recorded as refused. Who asked is the action's
  `requestedBy`. They also need
  `confirm=<word>` (`--confirm=<word>` on the line; default `apply`).
- A run is a child of the step: `[run.status::ok|failed|refused]`, `[run.exit::N]`, `[run.at::…]`, `[run.by::person|agent:<id>]`,
  and the last 15 lines of output. The step carries `[run.last::<status>]`, so `run.last=failed` finds the steps that failed.

Actions: `ext.runbook.run-step` (on a `run::` line; `outliner ext act runbook run-step --block <id> --arg confirm=ship`)
and `ext.runbook.run-all` (on the runbook note: steps in order, stopping at the first that fails or is refused, with a
summary child on the note). In the door: `act ext.runbook.run-all block=<id>`.

`config.json`: `{ "config": { "timeoutSeconds": 120 } }`. Groups are read where `with-secrets` reads them
(`~/.config/secrets`, or the service's `WITH_SECRETS_DIR`).

## The demo

Installing it writes a made-up runbook under its page in the Extensions hub (`demo/`): *Ship the demo widget*, with a
dry step, one that joins the made-up secrets group `runbook-demo` (it fails until you make the group), and one that
exits 3. Every command is an `echo`. Run the steps from their lines to see each kind of record.
