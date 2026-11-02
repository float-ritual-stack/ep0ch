# 0008: Extension first: core gains primitives, behaviours live in extensions

Status: accepted, 2026-11-02 (Evan's call, Nov 2 ~7 AM: "feels like this is a question everything should be getting asked").

## Context

**The problem:** a behaviour built into the door's core stays there. The glass ([ADR 0007](0007-surfaces-about-the-current-thing.md),
PIE-1481, PIE-1485) shipped as `packages/door/src/glass.ts`, wired into the app and the tune screen: hover post-its, their stack,
peel, drop and shelves. Nobody asked whether it could be an extension; the brief didn't, and neither did the review. When it
misfired (a drag made 14 post-its, PIE-1499) the fix went into core too.
**The precedent:** the runbook was built as an extension (Oct 16), so when shared context (PIE-533) made its own `{{props}}`
redundant it was rebuilt with nothing to unpick in core. [ADR 0004](0004-kernel-contracts.md) made the built-ins stand on the
extension contracts; AGENTS.md's "Is it the next `neat`?" asks the same of the person's requests. Neither was asked of our own
designs.

## Decision

**Every behaviour is asked first whether it can be a rule note, a script or an extension** on the parts that exist: by the
brief before building, by the builder before writing code, by the review before merging (CONTRIBUTING's architecture pass).
**When it can't, the gap is a primitive:** a hook, an event or a placement an extension can't reach yet. Core gains that
primitive, documented in the extensions README with an example, and the behaviour is built as its first user, outside core.
**Core keeps** the parts every behaviour stands on: the layout module, the dispatcher and actions, the reader, the service
contracts, placements (the attached surface, the float layer), and the primitives added this way.
**A PR that adds behaviour to core** says which primitive was missing and why the behaviour couldn't wait for it.

## Consequences

- The glass moves out (PIE-1505): core gains a hover event and an extension's status chip; the float layer stays core; hover
  post-its, the stack, peel, drop and shelves become an extension, listed on the extensions screen.
- A behaviour can be dropped, swapped or rewritten without a core change, and a better primitive later doesn't strand it.
- Some features take one more step (the primitive first). That step is the point: it is what the next extension uses.
