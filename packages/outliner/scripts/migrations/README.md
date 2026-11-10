# One-off schema migrations

Empty between schema bumps. A schema change adds `<NNNN>-<what>.ts` here (NNNN the new `SCHEMA_VERSION`), taking a
database from the previous version to the new one; `ep0ch install --apply` finds it by its number and runs it on each
machine's outlines. Delete it once pie and float-hub have run it: git keeps it, and install then refuses an older
outline with the import route. The rules are in the root `AGENTS.md` ("Schema and protocol: one version") and
`CONTRIBUTING.md` ("Protocol and schema"); the last script, `0010-marks.ts`, is the model
(`git show bf5568e9b:packages/outliner/scripts/migrations/0010-marks.ts`).
