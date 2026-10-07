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
   `../outliner` (`test/scratch.ts`; `EP0CH_OUTLINER` overrides it). outline-core's tests are pure. The Claude
   mod's run under `claude plugin test` (`claude` on PATH).
   - **Whole suites run in a boxd box** (PIE-597): `scripts/box-test [--each] [door|outliner|outline-core|claude-mod|all]`
     forks the golden box (the repo cloned, `bun install` done), checks out your commit (unpushed is fine: it goes
     up as a bundle), streams the output, exits with the first failing suite's code and removes the fork (one it
     couldn't remove, its run killed, powers itself off and the next run removes it). Each run's time
     and estimated cost are kept in `~/.local/state/ep0ch/box-test.tsv`. `scripts/box-test --refresh-golden`
     rebuilds the golden box (after a `bun.lock` change it saves the install). It needs the boxd CLI, signed in.
   - **Focused runs on float-2** go through `scripts/agent-env <name> --test -- timeout 900 bun test <files>`: two at
     once on the machine at most (`EP0CH_TEST_SLOTS`), each capped in a systemd user scope (`EP0CH_TEST_CPU`, `EP0CH_TEST_MEM`), in the
     foreground, never `--parallel`: five agents' parallel runs once froze float-2. The door's `parity-screens`
     takes more than ten minutes whole; run it in parts with `PARITY_ONLY` (see the ep0ch-core skill), or in a box.
     Name the files from the package or from the root (`packages/door/test/edit.test.ts`): from the root, the root
     `bunfig.toml` runs every package's own `test/preload.ts` (`scripts/test-preload.ts`), which Bun otherwise reads
     only from the folder it starts in.
   - Before merging a series, and in every review round, run the door's files each alone too
     (`scripts/box-test --each`, or `bun run test:each` in packages/door with file names to run a few;
     `TEST_EACH_JOBS` runs several at once): `bun test` loads every file into one process, so a file that only
     loads because another loaded a module first passes there and fails alone. #204's import cycle left 13 files
     unable to load alone for a day, and nobody saw.
3. A change to what one package prints or answers that another reads is tested against the real other side,
   not a fake: the mod's readers over the real `ep0ch` (`packages/door/test/claude-mod-contract.test.ts`), the
   outliner's CLI under the mod's work tools (`packages/outliner/test/work-tools.test.ts`). Stderr another program
   reads is plain unless it is a terminal: `ep0ch`, `outliner` and the Herdr opener call `colourOnlyToATerminal`
   first (packages/outliner `src/plain-stderr.ts`, a declared export), and a new such entry does too.
4. Tests defend observable contracts: canonical graph and cycle invariants, optimistic conflicts, query
   completeness, virtual occurrence behavior, terminal width and security, cursor and selection transitions,
   restart reconstruction. Avoid tests that merely inspect source text or implementation plumbing.
5. Snapshots are regenerated and looked at. `bun scripts/snap.ts <scenario>` (in the door) writes PNGs to
   `out/`; open them. A snapshot nobody looked at is not evidence.
6. When interaction changes, do a real-pane pass. Run the door in a terminal pane against a scratch host, under
   `scripts/agent-env <name> -- …` (your own `EP0CH_STATE`, `EP0CH_CONTROL`, `EP0CH_OUTLINES` and `TMPDIR`, and
   `EP0CH_DAEMON=0`; see [AGENTS.md](AGENTS.md)).
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
  it. Name any place where it built its own instead (a second dock or drawer, a screen-only layout, a key with no action,
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
- **Ids, names, roles:** for each reference the change keeps (a tile, pane, note, outline, session), is it an id,
  a name or a role, and does it store only ids or roles ([ADR 0001](docs/adr/0001-ids-names-roles.md))?
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

### 5. Recurring gotchas

Mistakes that came back more than once. Check the change against each. Every entry says where it was seen and
how to check it (automated when possible), so it can be retired once a test or the code makes it impossible.

- **Names used as identity** ([ADR 0001](docs/adr/0001-ids-names-roles.md)). Does the change store a name (a tile
  name, a pane label, a title) where it means one exact thing or a role? Store ids or roles; refuse an ambiguous
  name with the candidates. *Seen: #172 (moved previews, drawer/screen name shadowing, `where` after a move, the
  `door-claude` pane label). Check: by hand.*
- **A contract changed under another package.** Does the change alter output another package reads (the `ep0ch`
  CLI's argv and output, stderr wording, outline-core grammar, socket shapes)? Run the consumer's tests against
  the real producer. *Seen: #174 broke the Claude mod's `help` probe (#179); `FORCE_COLOR` in refusals (#184).
  Check: `packages/door/test/claude-mod-contract.test.ts`, extend it for new contracts.*
- **A cached read with no invalidation.** Does the change keep a copy of outline data (rows, a note, an embed)?
  Name what re-reads it: the change feed, and a replaced database (PIE-559). *Seen: #182 (outline tile), #187
  (showcase reset), the river column (open). Check: a real-host test that changes the data from another client.*
- **Silent success.** Can a step that didn't happen still report success? A skipped or blocked step says ✗ with
  the reason and the command. *Seen: `ep0ch install` reporting success with the checkout's fast-forward blocked;
  litestream's folder mode failing quietly for an hour. Check: a test for the failure path's output.*
- **Real config or real outlines reached from a test.** Does a test or scratch host read `~/.config`, `~/outlines`
  or the person's door? *Seen: a scratch host ran the real Inbox agent. Check: `test-door-env.sh`, scratch
  `XDG_CONFIG_HOME`.*
- **Work for nobody.** Does a session, screen or tile keep doing per-frame or per-event work (drawing, publishing a
  view, scaling images) while nobody is attached or looking? Gate it on someone watching. *Seen: #196 (a detached
  session drew every frame of a busy terminal tile, about 30% of a core). Still to check: the media cache's
  `nextFrame`, the live view's publish. Check: a test that a detached session draws nothing.*

Keeping this list honest, at each push-review round:

- **Add** a mistake the second time it appears, with where it was seen and a check.
- **Retire** an entry once a test or the code makes it impossible (say which), or when it hasn't been seen in
  three rounds; delete it (git keeps the history).
- **Merge or reword** entries that overlap. The list stays short enough to read in one review; past about ten, the
  oldest unseen ones go.

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
2. Write a one-off script, `packages/outliner/scripts/migrations/<NNNN>-<what>.ts` (NNNN the new version), that
   takes a database from the previous version to the new one and stamps it. `ep0ch install --apply` runs it
   (PIE-617) as `bun <script> <database>` on every outline at the previous version, with the host stopped, and
   reads `user_version` after, so the script: runs in one transaction, refuses a served file
   (`acquireWorkspaceOwnership`), exits non-zero leaving the file as it was when it can't, and wraps a change that
   replaces the file (rather than writing in it) in `withLitestreamPaused`. `0003-drop-agent-tables.ts` is the
   model: it checks the shape before it stamps. `openSchema`'s refusal finds it by its number and prints the exact
   commands for the machine (`schemaRefusal`).
3. The PR says the merge needs `ep0ch install --apply` on each machine; its plan shows the outlines it migrates.
4. Delete the script once the outlines that matter (pie on float-2, float-hub on the MacBook) are upgraded; git
   keeps it. Install then refuses an outline still at the old version, with the import route.
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
- Merge yourself once review is resolved: `gh pr merge --squash` (never `--delete-branch` or `-d`: gh also deletes the local branch, and with it the worktree an agent has it checked out in; delete the remote branch alone with `gh api -X DELETE repos/float-ritual-stack/ep0ch/git/refs/heads/<branch>`). The live checkout
  moves only through `ep0ch install --apply`, run by the deployer.

## Documentation

Update documentation when a change affects installation or startup, keyboard controls (the door's README key
tables, its hint rows and UI-GRAMMAR §7), protocol or schema invariants, process boundaries, runtime paths, or
shipped versus planned behavior. Don't duplicate the roadmap into Markdown: the workboard is canonical; repository
docs describe durable architecture and workflow. After a big push, refresh the READMEs and CHANGELOG, the demo
hubs, the fresh-outline seed, the showcase and skills, and the regenerated architecture map
(`bun packages/door/scripts/architecture-map.ts`).
