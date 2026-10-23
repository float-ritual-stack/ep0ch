---
paths:
  - "packages/outline-core/**"
---

# outline-core (packages/outline-core)

Rules for changing the shared code both sides import. The root `AGENTS.md` holds the rules for every package; this
file adds outline-core's. Claude Code loads it when you touch a file under `packages/outline-core/`; other tools read
it before changing outline-core.

- **No I/O, and no imports outside itself** (`node:path` is fine).
- **Wire types and shared write-location computations bump `PROTOCOL`; parse/draw rules bump `GRAMMAR`**
  (`src/protocol.ts` lists the boundary). Take PROTOCOL to main's plus one at the final rebase. Grammar differences
  warn once and keep working; protocol differences refuse, as the root `AGENTS.md` says.
- **It is the one copy.** References, page links, embeds and anchors (`link-syntax.ts`), property tokens and scope,
  the header line (`header-line.ts`), code fences and literal regions (`code-fence.ts`, `code-ranges.ts`), the
  block-as-a-record shape (`block-record.ts`), the draft.patch compare, the search matcher and the wire types live
  here. A client that needs one imports it; where one isn't shared yet, move it here rather than copy it.
