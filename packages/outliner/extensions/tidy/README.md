# Tidy (an agent you address while you write)

The example for **agents in the note** (PIE-501). Write a line that starts with `@tidy` and keep
typing. Once the line has been quiet for a moment, the service asks the agent, and the paragraph
above is tidied in place: bullets as `-`, one space after list markers and `#`, no runs of spaces,
no trailing spaces, and two spaces per nesting level with no jumps. Links, references, properties and code are never touched by the formatter.

```text
Morning plan
*  call the  printer people
-   **  order  ** paper
@tidy                              ← tidies the two lines above, as ext:tidy
```

- In the door, `@` at the start of a line offers the agents the outline's extensions serve, `@tidy` among them,
  with what each does: choosing one writes `@tidy ` and you go on typing (PIE-592).
- Bare `@tidy` and `@tidy all` run the deterministic formatter (all never includes the title). Its count names actual changes: `fixed nesting in 3 items, trimmed 1 line`, or `nothing to tidy above`.
- `@tidy <instruction>` rewrites the paragraph or list above, skipping adjacent ask lines. For example, `@tidy remove the cruft and wrap each item in a callout` returns one patch, not a chat answer. It uses `claude -p --model haiku --tools "" --bare`, pie’s cheap text model, with a 10-second extension deadline.
- Like marginalia, `config.answer` in `config.json` names a command: prompt on stdin, answer on stdout. Tidy expects JSON `{ "replacement": "the full rewritten passage", "message": "rewrote 4 items as callouts" }`. An empty command list disables the model and says so. Command failures, invalid JSON and deadline failures show on the ask line; the answer tile shows the same result even when there is no answer fold.
- Repeated asks share a run and its outcome; each spelling of the line receives the result.
- The edit is an ordinary attributed edit (`author: agent`, `ext:tidy`, `ext.tidy.agent.tidy` in
  the change feed) applied through `draft.patch` with the `edit` policy. If you are typing in that
  passage in the door, it becomes a proposal beside the note, drawn under the line, instead (apply or dismiss it).
- Under the line, the note shows what it did (`formatted 2 lines`). `r` on the line asks again.
- A `@tidy` line written by an agent lands held (`held: <agent> may not wake @tidy · r to send`) and waits for a person's `r`, so agents can't set each other off.

Install: `outliner ext add tidy`. See [the four kinds](../../docs/extensions/README.md#agents-in-the-note).
