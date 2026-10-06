# Effect 4 spike

**Not for merge.** This branch (`spike/effect-4`) is a guide, not an implementation. It is never merged into
`main`. If ep0ch adopts Effect, the real work is planned from the findings in this folder and in the outline
([[effect-4-spike]], ticket PIE-570), and this branch is deleted.

## Goal

Answer, with code rather than opinion, what moving ep0ch to Effect 4.0 would look like:

1. **Incrementally.** Where Effect can enter at an edge without the rest of the code noticing, what each step
   buys (which of the project's own bug classes it removes) and what it costs (dependency, startup time, a
   second error world while both styles coexist, agents writing in a style they half know).
2. **From scratch.** Knowing what we know now (the shared-parts map, the bug archaeology, the two-clients-one-
   outline shape), what the packages, services and boundaries would be if the project were started on Effect.

## What the branch holds

- `docs/spikes/effect-4/` — this goal, `FINDINGS.md` (what happened when real slices were rewritten), and
  `VERDICTS.md` (per bug class: prevents, helps, nothing, worse; filled from the outline's archaeology note).
- A few real slices rewritten on Effect, each small enough to read in one sitting and each chosen because it
  touches a bug class the project has actually had. The slices are listed in `FINDINGS.md` as they land.

## Rules for this branch

- It builds and its own tests pass, so the findings are about Effect and not about broken code.
- Nothing here changes behaviour for anyone: no `ep0ch install --apply`, no deploy, no real outline.
- Code review of the branch's own code counts as evidence (how many findings, which classes) and is recorded.
- Every claim about Effect 4 cites the checkout at `~/recon/effect` (docs path or source path), because 4.0
  shipped on 2026-10-06 and the agents' training knowledge is v3.
