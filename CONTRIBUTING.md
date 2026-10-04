# Contributing

[AGENTS.md](AGENTS.md) has the workflow rules. The door's [docs/UI-GRAMMAR.md](packages/door/docs/UI-GRAMMAR.md)
has the words to use and the shared parts to build on; the outliner's
[CONTRIBUTING.md](packages/outliner/CONTRIBUTING.md) has its source boundaries, correctness invariants and the
Herdr live smoke test. Both packages are developed through live dogfooding: changes preserve canonical data,
make incomplete results explicit, and are proved on the real surface (a door screen, Tree or Detail).

## Setup

```sh
bun install --frozen-lockfile     # once, at the root: every package, one bun.lock
herdr plugin link packages/outliner --enabled
bun run check
bun run test
```

The outliner's pinned Pi TUI patch is registered at the root (`patchedDependencies`); install through Bun with
the lockfile so it is applied.

## Verification

Before a PR claims a change works:

1. `bun run check` passes at the root (each package's `tsc --noEmit`).
2. The full suites pass once the change is stable: `bun run test` at the root, or `bun test` in each package.
   Focused tests are fine while developing. The door's tests start their own scratch outline host from
   `../outliner` (`test/scratch.ts`; `EP0CH_OUTLINER` overrides it); `bun run test:parallel` in the door runs
   the same suite in under half the time, and the parity test is three files (`test/parity-*.test.ts`) so it
   spreads too. outline-core's tests are pure. The Claude mod's run under `claude plugin test` (`claude` on PATH).
3. A change to what one package prints or answers that another reads is tested against the real other side,
   not a fake: the mod's readers over the real `ep0ch` (`packages/door/test/claude-mod-contract.test.ts`), the
   outliner's CLI under the mod's work tools (`packages/outliner/test/work-tools.test.ts`). A CLI's stderr is
   plain unless it is a terminal: every entry calls `colourOnlyToATerminal` (outline-core `plain-stderr.ts`).
4. Tests defend observable contracts: canonical graph and cycle invariants, optimistic conflicts, query
   completeness, virtual occurrence behavior, terminal width and security, cursor and selection transitions,
   restart reconstruction. Avoid tests that merely inspect source text or implementation plumbing.
5. Snapshots are regenerated and looked at. `bun scripts/snap.ts <scenario>` (in the door) writes PNGs to
   `out/`; open them. A snapshot nobody looked at is not evidence.
6. When interaction changes, do a real-pane pass. Run the door in a terminal pane against a scratch host, with
   your own `EP0CH_STATE`, `EP0CH_CONTROL` and `EP0CH_OUTLINES` and `--no-daemon` (see [AGENTS.md](AGENTS.md);
   `packages/door/scripts/test-door-env.sh` sets `EP0CH_DAEMON=0`).
   - Drive it with keys, and with injected SGR mouse sequences (`ESC [ < b ; x ; y M` press, `… m` release) for
     clicks, drags and the wheel.
   - Check the result with `peek` or `snap` on your own control socket.
   - For Tree, Detail, pane orchestration or the host, the outliner's
     [live smoke test](packages/outliner/CONTRIBUTING.md#live-smoke-test) and
     [user-workflow walkthrough](packages/outliner/CONTRIBUTING.md#user-workflow-walkthrough) are the equivalent.

The PR says what ran, what was looked at, and what wasn't tested. Report implemented, exercised (with the actual
journey), merged, deployed and owner-accepted separately ([Delivery claims](packages/outliner/CONTRIBUTING.md#delivery-claims)).

## Review checklist

Every review, by the author before opening the PR and by the reviewer, goes through these sections in order.

### 1. Architecture pass

- **Reuse:** does the change use the shared part for each need? For the door, cite the row of
  [Before adding a feature](packages/door/docs/UI-GRAMMAR.md#before-adding-a-feature). For the outliner, it builds
  on the existing renderers, components and actions: PreviewRegions (`src/detail-preview-regions.ts`), the
  property inspector (`src/property-inspector.ts`), reference completion (`src/reference-completion.ts`),
  saved-view reads (`src/saved-view-read.ts`, `views.read`) and the action list (`src/outliner-actions.ts`); see
  its [Source boundaries](packages/outliner/CONTRIBUTING.md#source-boundaries). Shared pure code lives in
  outline-core and is imported, never copied.
- **No parallel implementation:** does it add a second reader, body renderer, pane model, search, editor,
  completion, presence view, parser or action path next to an existing one? A parallel implementation needs a
  reason written in the PR.
- **One grammar:** do keys, layout operations and terms match the glossary and the other screens? For layout,
  the words are block, tile, container and screen ([Layout](packages/door/docs/UI-GRAMMAR.md#layout-block-tile-container-screen)).
- **Did you really?** List each shared part the brief or PR said it would use, and check the diff actually uses
  it. Name any place where it built its own instead (a second drawer, a screen-only layout, a key with no action,
  a switch on a tile kind's name, a second renderer or parser, a client re-deriving what the service owns, a tool
  path that skips the shared action list). Expect at least one; fix it or say why not.
- **Service meaning (boundary):** the service owns truth and meaning; clients own presentation. Does the change
  re-derive what the service owns (view membership, property parsing, query evaluation, backlinks, what changed)
  instead of asking it?
- **Protocol:** any wire change, and any change to what outline-core matches or computes, bumps `PROTOCOL`
  ([Protocol and schema](#protocol-and-schema)).
- **The map and the docs:** does a new or changed shared part need a row in the door's reuse map, with a
  showcase section and seed content (`packages/door/src/showcase/`)? Is a new outliner shared part named in its
  Source boundaries or `docs/ARCHITECTURE.md` so the next change finds it?
- **Demo it in the kitchen sink:** a user-visible feature gets a showcase section or note in the same PR, live
  where possible (`ep0ch --showcase`), as each reuse-map row gets its section, and its test drives that section
  through `act` and checks the result (`packages/door/test/showcase.test.ts`). If it can't be shown there, the PR
  says why.

### 2. Correctness

- It does what the PR says on every view it touches.
- It works by keys, mouse and `act`.
- An error or refusal that tells the person to do something shows the exact command, with this machine's values
  filled in.
- A client and the service it needs are on the same `PROTOCOL`; a mismatch is refused, never worked around.

### 3. Safety

- **No lost text:** drafts survive refusals, conflicts and exits (`drafts/`, the unsaved guard).
- **No stolen focus or keys:** an agent's action never moves the person's selection, focus or entered state.
- **Revision checks:** writes name the revision they were based on. A conflict is refused, never overwritten. A
  create whose answer was lost is never retried blindly.
- **Provenance:** agent writes carry `author: agent` and the actor id, and the screen says so.

### 4. Tests

- Tests run against scratch hosts only, with fictional fixtures.
- The refusal paths are covered, not just the happy path.
- Snapshots that changed were looked at.

After a big push or two, review the system as a whole: one lens per reviewer (architecture and reuse,
portability and runtime, daily-driver interaction), reporting, not fixing.

## Protocol and schema

The policy is in [AGENTS.md](AGENTS.md#schema-and-protocol-one-version): one schema version, one protocol number.

**Protocol.** Client and service must speak the same protocol. There is one number, `PROTOCOL` in
`packages/outline-core/src/protocol.ts`; `ping` reports the service's as `protocolVersion`, and every client
refuses a service whose number differs from its own, older or newer, with words that name the side to update
(`protocolMismatch`). The outliner applies it in `src/service-compatibility.ts` (the Herdr launcher and panes wait
through `waitForCompatibleService`); the door in `SocketBoard.info()`. There are no capability lists and no
minimums: the long-running host and a remote door on another checkout are the case the one check is for. Bump
`PROTOCOL` with any wire change (a new action, a new or changed request or response field, a changed meaning, a
removal) and with any change to what outline-core's shared modules match or compute (the property grammar, the
draft.patch compare, the search matcher). Add round-trip coverage, and restart the complete topology (the host,
then its clients) when it ships.

**Schema.** `packages/outliner/src/schema.ts` owns the database's one schema: the CREATE statements of the
current version and nothing else, stamped in `PRAGMA user_version`. A new, empty file gets them; any other
database whose version isn't `SCHEMA_VERSION` is refused at open, with its version and the command that upgrades
it. The runtime never inspects an old shape and never migrates. To change it:

1. Change the CREATE statements in `src/schema.ts` and bump `SCHEMA_VERSION`.
2. Write a one-off script, `packages/outliner/scripts/migrations/<NNNN>-<what>.ts`, that takes a database from the
   previous version to the new one (on a file no host is serving) and stamps it. `0001-stamp.ts` is the model:
   it checks the shape before it stamps.
3. Back up, then run it by hand on the outlines that matter (pie on float-2, float-hub on the MacBook). Name the
   script in `openSchema`'s refusal for the old version.
4. Delete the script once those outlines are upgraded; git keeps it.
5. For a change too large for a script, make a fresh database and import (`outliner import <old.sqlite>
   <new.sqlite>`, `src/outline-import.ts`, which reads tables by column name).

Migrations preserve canonical text and timestamps unless the person actually edited the block, rebuild only
derived indexes when possible, and are exercised on a copy of an existing database, not only a fresh one. If
property-parser behavior changes, bump `PROPERTY_PARSER_VERSION`: the store parses every block again on its next
open (`block_properties` and the page addresses declared there are derived), without touching block text or
timestamps.

## Branches, commits and pull requests

- Work in a worktree (`git worktree add -b <branch> ../ep0ch-<slug> origin/main`). Never switch branches in the
  live checkout: it is what runs.
- One focused branch per roadmap item (`feature/<behavior>`, `fix/<bug>`, `docs/<topic>`), and one coherent PR per
  change. A feature split across agents uses a feature branch: slices branch from it (`<feature>/<slice>`) and open
  PRs into it; one PR goes from the feature branch to main.
- Keep commits reviewable. Don't include runtime databases, sockets, logs, session exports, screenshots or
  unrelated local command files. Don't commit lockfile churn; commit `bun.lock` only when dependencies change.
- Prefer clean cutovers: migrate every caller, test and import, then remove obsolete code. Don't leave
  compatibility aliases unless an external consumer requires one.
- A PR states the observable problem, the chosen behavior and invariants, preserved contracts, exact verification
  commands and results, and live pane proof when applicable.
- Paid review runs on PRs into main. Put `[skip review]` in the title of docs-only, mechanical or small PRs and
  review them yourself. Push fixes in one go; don't re-trigger reviews.
- Address actionable review comments with minimal fixes. Reply with the validating evidence and resolve the
  thread. Re-run affected checks after the fix. Before patching a finding, fetch the current remote head and any
  bot patch already in flight; assign one active writer for that finding, and after a remote change verify the
  combined source and update the PR's evidence to the exact revision being reviewed.
- CodeRabbit's generic docstring warning is advisory here. Add comments only when they explain a non-obvious
  invariant.
- Merge yourself once review is resolved: `gh pr merge --squash --delete-branch`, then `git pull --ff-only` in the
  live checkout.

## Documentation

Update documentation when a change affects installation or startup, keyboard controls (the door's README key
tables, its hint rows and UI-GRAMMAR §7), protocol or schema invariants, process boundaries, runtime paths, or
shipped versus planned behavior. Don't duplicate the roadmap into Markdown: the workboard is canonical; repository
docs describe durable architecture and workflow. After a big push, refresh the READMEs and CHANGELOG, the demo
hubs, the fresh-outline seed, the showcase and skills, and the regenerated architecture map
(`bun packages/door/scripts/architecture-map.ts`).
