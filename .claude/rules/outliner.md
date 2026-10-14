---
paths:
  - "packages/outliner/**"
---

# The outliner (packages/outliner)

Rules for changing the outline host, Tree, Detail and Preview, the CLI, the publisher, extensions and the Pi
extension. The root `AGENTS.md` holds the rules for every package; this file adds the outliner's. Claude Code loads it
when you touch a file under `packages/outliner/`; other tools read it before changing the outliner.

- **The service owns truth and meaning; clients own presentation.** Read the outliner's
  [Source boundaries](../../packages/outliner/CONTRIBUTING.md#source-boundaries) and the root
  [Architecture pass](../../CONTRIBUTING.md#1-architecture-pass) before planning.
- **The Herdr UI is maintained.** Tree, Detail and Preview are the sysop console: find any block and fix it. Don't
  treat them as legacy or drop their features because the door covers a case. When a service capability is added
  for one client, keep it usable by the other.
- **Changes to Tree, Detail, pane orchestration or the host** need the
  [live smoke test](../../packages/outliner/CONTRIBUTING.md#live-smoke-test).
- **Host adapters, not second implementations:** the plugin's `.claude/commands/` and the Pi extension call the
  service; they don't reimplement it.
- **The data-safety fixes and Herdr/Pi interaction work:** the
  [implementation plan](../../packages/outliner/docs/IMPLEMENTATION_PLAN.md) has dependencies and acceptance checks,
  and its [real-application testing and evidence requirements](../../packages/outliner/docs/IMPLEMENTATION_PLAN.md#execution-and-completion-requirements)
  apply before you change runtime behaviour or call it complete.
- **Tests** start the outliner's in-process servers or `test/scratch-outline.ts`, never a real outline.
- **The schema** is the CREATE statements in `src/schema.ts` for the current version only; a change follows the
  root `AGENTS.md`, "Schema and protocol: one version" (a one-off script in `scripts/migrations/`).
  `ep0ch install --apply` stops the host, migrates every outline at N-1, starts the host, and refuses to update when
  an outline can't take the step. Once the script is deleted (git keeps it), install refuses an older outline with
  the import route.
- **Import** (`outliner import`, `ep0ch outline import`, and init's import option; `src/outline-import.ts`) reads
  blocks, properties, page addresses and work ids from an older file: the route for big changes.
