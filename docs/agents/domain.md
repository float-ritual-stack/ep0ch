# Domain Docs

How the engineering skills should use this repo's domain documentation when they explore the codebase.

## Before exploring, read these

- **[packages/door/docs/UI-GRAMMAR.md](../../packages/door/docs/UI-GRAMMAR.md) §1 Glossary**: this repo's
  glossary, covering the door and the outliner. There is no root `GLOSSARY.md`. Don't create one.
- **[AGENTS.md](../../AGENTS.md)**: the shared words (block, tile, container, screen; outline host, door,
  sysop console; outlines by name). "Pane" means Herdr's or tmux's box.
- **Architecture docs** for the area: `packages/outliner/docs/ARCHITECTURE.md`,
  `packages/door/docs/architecture/`, `packages/door/docs/AGENT-INTERFACE.md`.
- **`docs/adr/`** at the repo root: read the ADRs about the area you will work in.

If one of these doesn't exist (for example `docs/adr/` before the first ADR), **proceed silently**.

## Where `/domain-modeling` writes

- **New or sharper terms**: add them to UI-GRAMMAR.md §1. Never put them in a new `GLOSSARY.md`.
- **Decisions**: `docs/adr/NNNN-<slug>.md` at the repo root, one directory for all packages. Create it with
  the first ADR.

## Use the glossary's vocabulary

When your output names a domain concept (in an item title, a refactor proposal, a hypothesis, a test name),
use the term the glossary defines. Don't use a synonym the glossary avoids.

If the concept you need isn't in the glossary, that's a signal. Either you're inventing language the project
doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, say so. Don't override it silently:

> _Contradicts ADR-0007 (one schema version), but worth reopening because…_
