### pie's file stays near its own size, and gives space back (PIE-1786)

- **Compaction keeps the log small:** a new genesis once the edits since the last reach a quarter of it (was 4 times), the old genesis and what came before it deleted, the edits since it kept so a reader behind by less than a generation reads on.
- **Freed space goes back to the disk:** every outline is `auto_vacuum = INCREMENTAL` from schema 13, and each compaction runs `PRAGMA incremental_vacuum`. A compaction that wouldn't fit on its filesystem is refused and said, never half-done.
- **Schema 13 makes each outline again:** `0013-incremental-vacuum.ts` copies every row into a new incremental file beside it with its log begun again at one genesis, checks it (integrity, row counts, auto_vacuum) and renames it over the outline. A pie-sized outline: 1.15 GB → 509 MB in 5.5 s. No room on its filesystem: refused, the outline untouched.
- **Run:** `ep0ch install --apply` on float-2 (pie and its other outlines), then the laptop (float-hub and the rest), then float-box (its follower's copy). Each machine's followers rebuild once from the new genesis.
