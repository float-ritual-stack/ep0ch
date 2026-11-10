# Waiting CHANGELOG entries

One file per pull request, `<date>-<branch>.md` (the branch's `/` as `-`): one `###` section, written as it would sit
under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). No other PR touches it, so entries never conflict.
loki folds them in with `bun scripts/changelog-fold.ts`, newest first; this README stays (PIE-1696).
