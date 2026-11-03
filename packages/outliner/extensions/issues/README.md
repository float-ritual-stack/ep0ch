# Issues

Your tracker's open issues, offered where you already type a link.

## What you do

- **Link an issue:** type `[[log`; pages and issues that match are ranked together, and choosing an issue writes `[issue::#12]`.
- **List open issues:** type `[issue::`.
- **Find one by number:** type `[issue::12`.
- **Say it your way on a query line:** on the facets tile's `where:`, a view's `[query::` or the power bar's `=`, type `seed sw`; choosing `issue="#15"` writes the query for the notes about that issue.
- **Notes about an issue:** in the power bar, `$` then a query (`stage=ready`): the notes with an `issue` that it selects. The line completes as a query, as `=` does.

## Setup

- **The list** is a made-up `issues.json` beside the extension.
  - Swap the file for a real tracker's answer to make it yours.
- **Uninstall it** and the rows and the `$` scope are gone; nothing else was written.

## How it works

- **A completion source** (PIE-1340): one `sources[]` entry with `triggers` (and `keys` for `key::`); `issue-words` answers the `query` trigger (PIE-1508), its row writing the whole line.
- **A bar source with a query line:** `issue-notes` has `prefix: "$"` and `grammar: "query"`, and asks the outline (`blocks.query`, through `outline.ts`) for what it lists.
- **It answers the `source` operation** with rows: `label`, `kind`, `detail`, `docs` (Blockdown, shown beside the list) and `insert`.
- **The file is read once a call** and filtered in the extension, as pi's `github-issue-autocomplete.ts` preloads `gh issue list`.
