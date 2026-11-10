### Two PRs that both add a CHANGELOG entry or rewrite the health baseline merge without a conflict (PIE-1696)

- **A CHANGELOG entry is a file of its own:** `changelog/<date>-<branch>.md`, one `###` section, so two PRs never touch the same lines, on GitHub or locally. loki folds them into CHANGELOG.md with `bun scripts/changelog-fold.ts`; `ep0ch work groom` reads both.
- **The health baseline keeps no commit id and no count:** `scripts/health-baseline.json` lists each pattern's sites, and its count is their number. Two branches whose counts agree write the same file; two that each remove a different copy merge to the right count; overlapping removals still conflict. `--report` reads the commit it compares with from git.
- **Run:** nothing. PROTOCOL and the schema don't move. A branch that rewrote the baseline before this: merge main, then `bun scripts/health-ratchet.ts --write`.
