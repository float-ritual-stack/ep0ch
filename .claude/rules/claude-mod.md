---
paths:
  - "packages/claude-mod/**"
---

# The Claude Code mod (packages/claude-mod)

Rules for changing the mod. The root `AGENTS.md` holds the rules for every package; this file adds the mod's. Claude
Code loads it when you touch a file under `packages/claude-mod/`; other tools read it before changing the mod.

- **A hooks module can't import application code.** It runs the outliner's CLI from the Herdr plugin root, and draws a
  block through the door's (`ep0ch show --cells`, BlockView).
- **Only `hooks/register.ts` is handed `$`** (the engine refuses `$` passed across an import), so the other files are
  pure: parsing, argv and trees.
- **A session's folder feeds the outline its nearest `.ep0ch` names, or nothing.**
- **Tests run under `claude plugin test`** (the root `bun run test` runs them, so `claude` must be on PATH).
- **The mod reads `ep0ch`'s output.** The door's `test/claude-mod-contract.test.ts` runs the real CLI through the mod's
  own readers; change the two together.
