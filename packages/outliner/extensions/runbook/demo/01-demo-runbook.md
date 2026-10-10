Ship the demo widget [type::runbook] [env::scratch]
A made-up runbook, written when the runbook extension was installed. Nothing in it touches anything real: every command is an echo.

Each step below has a `run::` line and its command in a code fence. Run one with its `[x run-step]` control (or `x` on its line), or the whole runbook from here: `ep0ch ext act runbook run-all --block <this note>`. Each run is recorded under its step, and the step says `[run.last::…]`.

- ((check|Check the widget)) is a dry step: an agent may run it too.
- ((stage|Stage with the demo token)) joins the made-up with-secrets group `runbook-demo`. Until you make it (`with-secrets --add runbook-demo DEMO_TOKEN`) it fails and says so; the token's value is never written here.
- ((fail|A step that fails)) exits 3, so you can see a failed run, and run-all stops there.
