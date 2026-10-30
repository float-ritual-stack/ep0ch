# Issues

Your tracker's open issues, offered where you already type a link.

## What you do

- **Link an issue:** type `[[log`; pages and issues that match are ranked together, and choosing an issue writes `[issue::#12]`.
- **List open issues:** type `[issue::`.
- **Find one by number:** type `[issue::12`.

## Setup

- **The list** is a made-up `issues.json` beside the extension.
  - Swap the file for a real tracker's answer to make it yours.
- **Uninstall it** and the rows are gone; nothing else was written.

## How it works

- **A completion source** (PIE-1340): one `sources[]` entry with `triggers` (and `keys` for `key::`).
- **It answers the `source` operation** with rows: `label`, `kind`, `detail`, `docs` (Blockdown, shown beside the list) and `insert`.
- **The file is read once a call** and filtered in the extension, as pi's `github-issue-autocomplete.ts` preloads `gh issue list`.
