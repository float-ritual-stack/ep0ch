# Contributing

[AGENTS.md](AGENTS.md) has the workflow rules. [docs/UI-GRAMMAR.md](docs/UI-GRAMMAR.md) has the
words to use and the shared parts to build on.

## Verification

Before a PR claims a change works:

1. `bun run check` passes.
2. The full suite passes once the change is stable:
   `EP0CH_OUTLINER=<pi-herdr-outliner checkout> bun test`. Focused tests are fine while developing.
3. Snapshots are regenerated and looked at. `bun scripts/snap.ts <scenario>` writes PNGs to `out/`;
   open them. A snapshot nobody looked at is not evidence.
4. When interaction changes, do a real-pane pass. Run the door in a terminal pane against a scratch
   service, with your own `EP0CH_STATE` and `EP0CH_CONTROL` (see [AGENTS.md](AGENTS.md)).
   - Drive it with keys, and with injected SGR mouse sequences (`ESC [ < b ; x ; y M` press,
     `… m` release) for clicks, drags and the wheel.
   - Check the result with `peek` or `snap` on your own control socket.

The PR says what ran, what was looked at, and what wasn't tested.

## Review checklist

Every review goes through these sections in order.

### 1. Architecture pass

- **Reuse:** does the change use the shared part for each need in
  [Before adding a feature](docs/UI-GRAMMAR.md#before-adding-a-feature)? Cite the row.
- **No parallel implementation:** does it add a second reader, body renderer, pane model, search,
  editor, completion, presence view or action path next to an existing one?
- **One grammar:** do keys, pane operations and terms match the glossary and the other screens?
- **Service meaning:** does it re-derive what the service owns (view membership, property parsing,
  query evaluation, backlinks, what changed) instead of asking it?
- **The map:** does a new or changed shared part need a row in the reuse map?

### 2. Correctness

- It does what the PR says on every view it touches.
- It works by keys, mouse and `act`.
- Against an older service (a missing `Capability`), it says why, instead of showing nothing.

### 3. Safety

- **No lost text:** drafts survive refusals, conflicts and exits (`drafts/`, the unsaved guard).
- **No stolen focus or keys:** an agent's action never moves the person's selection, focus or
  entered state.
- **Revision checks:** writes name the revision they were based on. A conflict is refused, never
  overwritten. A create whose answer was lost is never retried blindly.
- **Provenance:** agent writes carry `author: agent` and the actor id, and the screen says so.

### 4. Tests

- Tests run against scratch services only, with fictional fixtures.
- The refusal paths are covered, not just the happy path.
- Snapshots that changed were looked at.
