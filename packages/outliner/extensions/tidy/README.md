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
- `@tidy <instruction>` rewrites the paragraph or list above, skipping adjacent ask lines. For example, `@tidy remove the cruft and wrap each item in a callout` returns one patch, not a chat answer. It uses `claude -p --model haiku --tools ""`, pie’s cheap text model, with a 20-second extension deadline.
- Like marginalia, `config.answer` in `config.json` names a command: prompt on stdin, answer on stdout. Tidy expects JSON `{ "replacement": "the full rewritten passage", "message": "rewrote 4 items as callouts" }`. An empty command list disables the model and says so. Command failures, invalid JSON and deadline failures show on the ask line; the answer tile shows the same result even when there is no answer fold.
- Repeated asks share a run and its outcome; each spelling of the line receives the result.
- The edit is an ordinary attributed edit (`author: agent`, `ext:tidy`, `ext.tidy.agent.tidy` in
  the change feed) applied through `draft.patch` with the `edit` policy. If you are typing in that
  passage in the door, it becomes a proposal beside the note, drawn under the line, instead (apply or dismiss it).
- Under the line, the note shows what it did (`formatted 2 lines`). `r` on the line asks again.
- A `@tidy` line written by an agent lands held (`held: <agent> may not wake @tidy · r to send`) and waits for a person's `r`, so agents can't set each other off.

Install: `outliner ext add tidy`. See [the four kinds](../../docs/extensions/README.md#agents-in-the-note).

## Resolving a stale proposal

`outline_proposal_resolve` (service: `draft.proposal.resolve`) hands the proposal, including its author's
note, the original revision, and the current note to this responder. It uses the same `config.answer`
command as an instructed tidy. The model returns the full rewritten note and a short message; returning
the current text unchanged leaves the proposal open with that message and the two conflicting readings.
The router compares the answer against the text read for this call, writes as `ext:tidy` with `[from::]`
the proposer, and marks the proposal resolved with a link. `extensions.undo` takes its receipt back in one
step; the door records that receipt for Ctrl+Z in the reader. Receipts last for this host process.

Automatic resolution is off until the outline contains this rule note:

```text
Resolve stale proposals [rule-name::resolve-stale-proposals] [rule-on::proposal/resolve] [rule-match::type=proposal stale=true]
```

Proposal creation and target edits maintain the proposal's `stale` property. The rule engine supplies its
ordinary quiet wait and loop guard; resolution writes carry `trigger:` attribution and rule-driven target
edits carry `[via-trigger::]`. A failed resolution leaves the existing proposal open, never another proposal.
For deployment, enable this note in pie and float-hub after updating their hosts and clients together.
This change does not modify either live outline. A wire change requires a protocol bump at final rebase.

A text resolution in an extension write group retains its structural operations: the existing group writer
checks and lands them in the same transaction and undo receipt. A proposal with no text passage has nothing
for the resolver to rewrite; it stays open for apply or dismiss.
