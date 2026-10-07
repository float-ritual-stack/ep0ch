# Done stamp (a rule that runs)

The forkable example for **rules** (PIE-600) with **`on`**: "when a block starts or stops matching, run this".

```text
Mend the water butt [status::todo]
  → set status to done, and two seconds later:
Mend the water butt [status::done] [done-at::2026-03-11]      ← written by ext:done-stamp, asked by you
```

- `match: { "property": "status=done" }`, `on: { "start": "stamp", "stop": "unstamp", "quiet": "2s" }`: the service
  watches the change feed; once the block has been quiet for 2 seconds it compares what it matched before with what
  it matches now and runs the action (`change` runs one on every save while it matches).
- The actions are ordinary ones (`outliner ext act done-stamp stamp --block <id>` works too). Their writes are
  `ext:done-stamp`'s, with `requestedBy` the one whose save set them off.
- **No loops:** a save any extension makes never sets a rule off; it only moves what the rule remembers. Stamping
  writes the block again, and nothing runs.
- A rule installed over blocks that already match runs nothing for them: it starts from what matches now.

Install: `outliner ext add done-stamp`. See [rules](../../docs/extensions/README.md#rules-when-a-block-matches).
