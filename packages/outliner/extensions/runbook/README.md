# runbook

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
- `--secrets=<group>[,<group>]` names `with-secrets` groups. The step runs as `with-secrets <group> -- …`; the values
  reach only the command, and the output is scrubbed of them (and their base64 and URL-encoded forms) before it is kept.
- `--mode=apply` steps are the person's: an agent's request is recorded as refused. They also need
  `confirm=<word>` (`--confirm=<word>` on the line; default `apply`).
- A run is a child of the step: `[run.status::ok|failed|refused]`, `[run.exit::N]`, `[run.at::…]`, `[run.by::person|agent:<id>]`,
  and the last 15 lines of output. The step carries `[run.last::<status>]`, so `run.last=failed` finds the steps that failed.

Actions: `ext.runbook.run-step` (on a `run::` line; `outliner ext act runbook run-step --block <id> --arg confirm=ship`)
and `ext.runbook.run-all` (on the runbook note: steps in order, stopping at the first that fails or is refused, with a
summary child on the note). In the door: `act ext.runbook.run-all block=<id>`.

`config.json`: `{ "config": { "secretsDir": "…", "timeoutSeconds": 120 } }`. `secretsDir` is where `with-secrets`
groups live (default `~/.config/secrets`); a test points it at a scratch folder.
