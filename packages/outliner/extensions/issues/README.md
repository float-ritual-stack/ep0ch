# Issues

A completion source (PIE-1340): a tracker's open issues, offered where you already type a reference.

- `[[log` lists the pages that match and the issues that do, ranked together; choosing an issue writes `[issue::#12]`.
- `[issue::` lists the open issues; `[issue::12` finds #12 by its number.
- The list is a made-up `issues.json` beside it, read once a call and filtered here, as pi's
  `github-issue-autocomplete.ts` preloads `gh issue list`. Swap the file for a real tracker's answer to make it yours.

It declares one `sources[]` entry with `triggers` (and `keys` for `key::`) and answers the `source` operation with
rows: `label`, `kind`, `detail`, `docs` (Blockdown, the docs panel beside the list) and `insert`.
Uninstall it and the rows are gone: nothing else was written.
