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
2. The focused tests pass: the files you touched and their neighbours. That and step 1 are the whole gate
   ([AGENTS.md](AGENTS.md#machines-checkouts-and-processes)). The door's tests start their own scratch outline host from
   `../outliner` (`test/scratch.ts`; `EP0CH_OUTLINER` overrides it). outline-core's tests are pure. The Claude mod's
   run under `claude plugin test` (`claude` on PATH).
   - **Focused runs on float-2** go through `scripts/agent-env <name> --test -- timeout 900 bun test <files>`: two at
<<<<<<< HEAD
     once on the machine at most (`EP0CH_TEST_SLOTS`), each capped in a systemd user scope (`EP0CH_TEST_CPU`,
     `EP0CH_TEST_MEM`), in the foreground, never `--parallel`. Each door `parity-*` file takes two to four minutes
     whole (a scenario is held to `PARITY_BUDGET_MS`, 60 s); run the scenarios you touched with `PARITY_ONLY` (see the
     ep0ch-core skill). Name the files from the package or from the root (`packages/door/test/edit.test.ts`): from the
     root, the root `bunfig.toml` runs every package's own `test/preload.ts` (`scripts/test-preload.ts`).
   - **Whole suites** (loki's merge batch, the nightly run on main) go through
     `scripts/box-test [--on float-box|boxd] [--each] [door|outliner|outline-core|claude-mod|all]`: float-box when it
     answers, else a boxd fork of the golden box (`--refresh-golden` rebuilds it after a `bun.lock` change). It runs
     your commit (unpushed goes up as a bundle) in a private dir it removes, exits with the first failing suite's
     code, and logs each run in `~/.local/state/ep0ch/box-test.tsv`. On float-box `scripts/box-test-guard` owns each
     run (PIE-998): one per worktree (`--replace` stops the old one), at most `EP0CH_BOX_SLOTS` (default 2) at once,
     each killed whole on exit, a leaked process fails it (exit 97). `--each` runs the door's files each alone: a file
     that loads only because another loaded a module first passes in one process and fails alone (#204).
=======
     once on the machine at most (`EP0CH_TEST_SLOTS`), each capped in a systemd user scope (`EP0CH_TEST_CPU`, `EP0CH_TEST_MEM`), in the
     foreground, never `--parallel`: five agents' parallel runs once froze float-2. Each door `parity-*` file takes
     two to four minutes whole (a scenario well under a minute, held to `PARITY_BUDGET_MS`, 60 s: past it the scenario fails by
     name with its slowest key); run it in parts with `PARITY_ONLY` (see the ep0ch-core skill), or in a box.
     Name the files from the package or from the root (`packages/door/test/edit.test.ts`): from the root, the root
     `bunfig.toml` runs every package's own `test/preload.ts` (`scripts/test-preload.ts`), which Bun otherwise reads
     only from the folder it starts in.
   - Before merging a series, and in every review round, run the door's files each alone too
     (`scripts/box-test --each`, or `bun run test:each` in packages/door with file names to run a few;
     `TEST_EACH_JOBS` runs several at once): `bun test` loads every file into one process, so a file that only
     loads because another loaded a module first passes there and fails alone. #204's import cycle left 13 files
     unable to load alone for a day, and nobody saw.
   - **A door test file leaves nothing for the next** (PIE-1412). Between files the door's preload
     (`packages/door/test/preload.ts`) retires the earlier file's Apps (which unbinds the extensions they read), stops
     its scratch hosts, puts the environment back and unbinds an extension list it bound itself; a scratch host still
     running or an extension list still bound is named (`test leak: <file> left behind: …`) and fails the run. Stop
     what you start in `afterAll` (`scratch.dispose()`, `bindExtensions(null)`, `app.quit()`); a part with
     process-wide state of its own registers it with the check, as `src/extensions.ts` does.
>>>>>>> origin/main
3. A change to what one package prints or answers that another reads is tested against the real other side,
   not a fake: the mod's readers over the real `ep0ch` (`packages/door/test/claude-mod-contract.test.ts`), the
   outliner's CLI under the mod's work tools (`packages/outliner/test/work-tools.test.ts`). Stderr another program
   reads is plain unless it is a terminal: `ep0ch`, `outliner` and the Herdr opener call `colourOnlyToATerminal`
   first (packages/outliner `src/plain-stderr.ts`, a declared export), and a new such entry does too.
4. Tests defend observable contracts: canonical graph and cycle invariants, optimistic conflicts, query
   completeness, virtual occurrence behavior, terminal width and security, cursor and selection transitions,
   restart reconstruction. Avoid tests that merely inspect source text or implementation plumbing.

   **What a test must earn** (PIE-760). It is what to test, not how many:
   - It fails when something a person would notice breaks, or when a guard the code can't check itself breaks
     (the protocol version, a copied module, a flag the binary reads). A test that fails only when wording or the
     implementation changes, and passes when the behaviour breaks, costs more than it catches.
   - A workflow test with real input beats twenty tidy unit tests of the parts: write the comment, make the syntax
     mistake, save, and check nothing was lost ([Capture is more reliable than interpretation](AGENTS.md#capture-is-more-reliable-than-interpretation)).
     A malformed reference refused a bug report on Oct 9 while every parser unit was green. Tests that only pin a
     parser helper's internals, or repeat a ranking case an interaction test already drives, are merged or go.
   - It doesn't boot a host to test a pure function. A file that needs a host starts one in `beforeAll` and shares
     it (and the showcase seed) across its tests.
   - It doesn't get a new file when an existing file already drives that action: add the case there, or to the
     action's showcase section.
   - A second copy of a module doesn't get a second grid. The copy goes (then the grid that compared them).
   - A count is not a result. A run whose number only went up is not a report: say what it catches now that it
     didn't.
5. Snapshots are regenerated and looked at. `bun scripts/snap.ts <scenario>` (in the door) writes PNGs to
   `out/`; open them. A snapshot nobody looked at is not evidence.
6. When interaction changes, do a real-pane pass. Run the door in a terminal pane against a scratch host, under
   `scripts/agent-env <name> -- …` (your own `EP0CH_STATE`, `EP0CH_CONTROL`, `EP0CH_OUTLINES` and `TMPDIR`, and
   `EP0CH_DAEMON=0`; see the door's rules, [.claude/rules/door.md](.claude/rules/door.md)).
   - Drive it with keys, and with injected SGR mouse sequences (`ESC [ < b ; x ; y M` press, `… m` release) for
     clicks, drags and the wheel.
   - Check the result with `peek` or `snap` on your own control socket.
   - For Tree, Detail, pane orchestration or the host, the outliner's
     [live smoke test](packages/outliner/CONTRIBUTING.md#live-smoke-test) and
     [user-workflow walkthrough](packages/outliner/CONTRIBUTING.md#user-workflow-walkthrough) are the equivalent.

7. A change meant to make drawing, layout or images faster or lighter gives `bun run bench:resize` (packages/door,
   `scripts/bench-resize.ts`) before and after, from one quiet box, never float-2's numbers; `--check` holds the
   budgets, and `test/resize-bench.test.ts` runs it in the whole suite, so other drawing changes leave it to the
   nightly run.

The PR says what ran, the journey you drove, what was looked at, and what wasn't tested.

## Review checklist

The PR's one review ([AGENTS.md](AGENTS.md#fixtures-prs-and-merging)) goes through these sections in order; the
author reads them once before opening it.

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
- **Properties are open:** does a filter, group, sort or picker work for any property name, through the query
  grammar and the service's facets? A list of property keys in client code is a finding
  ([AGENTS.md](AGENTS.md#properties-are-open)).
- **One grammar:** do keys, layout operations and terms match the glossary and the other screens? For layout,
  the words are block, tile, container and screen ([Layout](packages/door/docs/UI-GRAMMAR.md#layout-block-tile-container-screen)).
- **Did you really?** Check the diff uses the shared parts the brief named. Name any place where it built its own
  instead (a second dock or drawer, a screen-only layout, a key with no action, a switch on a tile kind's name, a
  second renderer or parser, a client re-deriving what the service owns, a tool path that skips the shared action
  list); fix it or say why not.
- **Keys said once, from the actions:** does every hint row, footer, strip, card or help line the change adds read its keys from the key table that binds them (`W_KEYS`; PIE-1173 for every mode), not from free text? A key list typed as a string is a finding, and so is a second line saying the same keys in another place or other words (PIE-1171). Check Esc's word against what Esc actually closes.
- **Questions answered twice:** for each new helper that reads existing state, is that question already answered
  elsewhere (the function behind a panel row, a status line, an error, `^W P`)? A re-derivation of an answer the
  door already shows is a parallel part, however small; make the owner return data and call it.
- **Service meaning (boundary):** the service owns truth and meaning; clients own presentation. Does the change
  re-derive what the service owns (view membership, property parsing, query evaluation, backlinks, what changed)
  instead of asking it?
- **Versions:** wire and shared write-location changes bump `PROTOCOL`; parse/draw changes bump `GRAMMAR`
  ([Protocol and schema](#protocol-and-schema)).
- **The map and the docs:** does a new or changed shared part need a row in the door's reuse map, with a
  showcase section and seed content (`packages/door/src/showcase/`)? Is a new outliner shared part named in its
  Source boundaries or `docs/ARCHITECTURE.md` so the next change finds it?
- **Ids, names, roles:** for each reference the change keeps (a tile, pane, note, outline, session), is it an id,
  a name or a role, and does it store only ids or roles ([ADR 0001](docs/adr/0001-ids-names-roles.md))?
- **Demo it in the kitchen sink** ([the door's rules](.claude/rules/door.md#demo-it-in-the-kitchen-sink)).

### 2. Correctness

- It does what the PR says on every view it touches.
- It works by keys, mouse and `act`.
- An error or refusal that tells the person to do something shows the exact command, with this machine's values
  filled in.
- A client and the service it needs are on the same `PROTOCOL`; a mismatch is refused, never worked around.
- **Load** (PIE-1413: a backfill's records froze pie's host for minutes). A change that writes in bulk, reads the same
  thing again and again, runs on a schedule or adds a subscription (a watch, a feed reader, a fan-out) answers three
  questions in the PR:
  - **Fan-out:** what each write or event sets off downstream (events to every subscriber, watch passes, rules,
    routing, the clients' re-reads).
  - **Count:** how much of it at pie's size (about 11k notes, 86 views, two doors and the publishers): writes per run,
    reads per write.
  - **Proof:** the host's measured impact, from where the person waits: `bun run bench:host` in packages/outliner
    (the real door's own requests, ping p50, p95, p99, max and the longest stall per phase, before and after), or a
    case in `test/host-stalls.test.ts`. A client that reads after changes reads once per burst, one read in flight,
    and only what is on screen (the query tile's `refresh`).

  The host keeps it fair by itself (work the service does for itself takes a turn per request, watch passes a watch
  per turn, a write patches the graph instead of reloading it); a job never throttles itself to stay out of the way.
  A PR none of this touches says so in one line ("no bulk writes, reads or subscriptions").

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
- **A hydra: one question decided in a new place.** Does the change add a place that decides who acts, which
  tile, where an open lands, or what an action takes and returns? Then the PR lists every existing place that
  decides it and shows each one calls the owner (the invitation's standing predicate beside `actorRule`, the
  dispatcher's `tile=`, `placement()`, the action registry); a grep count isn't an audit, each site gets a stance.
  A fix to one trigger (a click, and not its key or its `act`) is incomplete until the others are checked, each
  three ways: a tile on the screen, in a group, in a group in the drawer. The owner carries a "the one place that
  decides X" comment and a test that fails when a new caller goes around it. *Seen: groups and wiring fixed seven
  times (#330 to #803) and the agent check copied ~225 times, both found by the `neat` probe (pie b567bc2a);
  floatty's navigation consolidated three times and still leaking. Check: parity sweeps, and the owner's caller
  test.*
- **A contract changed under another package.** Does the change alter output another package reads (the `ep0ch`
  CLI's argv and output, stderr wording, outline-core grammar, socket shapes)? Run the consumer's tests against
  the real producer. *Seen: #174 broke the Claude mod's `help` probe (#179); `FORCE_COLOR` in refusals (#184).
  Check: `packages/door/test/claude-mod-contract.test.ts`, extend it for new contracts.*
- **A cached read with no invalidation.** Does the change keep a copy of outline data (rows, a note, an embed)?
  Name what re-reads it: the change feed, and a replaced database (PIE-559). *Seen: #182 (outline tile), #187
  (showcase reset), the river column (open). Check: a real-host test that changes the data from another client.*
- **Silent success.** Can a step that didn't happen still report success? A skipped or blocked step says ✗ with
  the reason and the command. *Seen: `ep0ch install` reporting success with the checkout's fast-forward blocked;
  litestream's folder mode failing quietly for an hour; again Oct 22 (install on float-box left behind by an
  unrelated local change, PIE-1193); a fallback nobody sees (Jev ranking off for ~19 days, said only in an answer's
  field, PIE-1195). Check: a test for the failure path's output; a fallback shows where the person looks (PIE-1196).*
- **Real config or real outlines reached from a test.** Does a test or scratch host read `~/.config`, `~/outlines`
  or the person's door? *Seen: a scratch host ran the real Inbox agent. Check: `test-door-env.sh`, scratch
  `XDG_CONFIG_HOME`.*
- **Work for nobody.** Does a session, screen or tile keep doing per-frame or per-event work (drawing, publishing a
  view, scaling images) while nobody is attached or looking? Gate it on someone watching. *Seen: #196 (a detached
  session drew every frame of a busy terminal tile, about 30% of a core); PIE-1413 (a board's 86 lanes each re-read
  every change, off the screen too: query tiles off the screen now read behind, `src/frames.ts`). Still to check: the
  media cache's `nextFrame`, the live view's publish. Check: a test that a detached session draws nothing.*

Keeping this list honest, at each push-review round:

- **Add** a mistake the second time it appears, with where it was seen and a check.
- **Retire** an entry once a test or the code makes it impossible (say which), or when it hasn't been seen in
  three rounds; delete it (git keeps the history).
- **Merge or reword** entries that overlap. The list stays short enough to read in one review; past about ten, the
  oldest unseen ones go.

## Protocol and schema

The policy is in [AGENTS.md](AGENTS.md#schema-and-protocol-one-version): one schema version, one protocol number.

**Protocol and grammar.** outline-core's `protocol.ts` owns both numbers. `PROTOCOL` guards the wire and
shared computations that place writes (draft.patch compare, anchors and patch-named ranges); its comment lists
those computations. A mismatch refuses and names the side to update (`protocolMismatch`). Parse/draw changes
bump `GRAMMAR`: `ping` reports `protocolVersion` and `grammarVersion`, and an older renderer warns once and
continues. The host's parsing owns saved content. Long-lived MCP clients reload installed code between requests,
keeping stdio and caller identity; door sessions use their checkpointed handover, and the HTTP gateway drains
responses before re-exec. Installed code still behind the host says `ep0ch install --apply`. Embedded Pi's SDK
only exposes reload in user command contexts, so its stale extension retains its `/reload` instruction. Add
round-trip coverage and install the host, then its clients when the wire changes.
The door's control-socket answers and ActionDefs are not the PROTOCOL wire; their shape is held by
`packages/door/docs/AGENT-INTERFACE.md` and `packages/door/test/claude-mod-contract.test.ts`.

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
   replaces the file (rather than writing in it) in `withLitestreamPaused`. `0004-block-revisions.ts` is the
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

Worktrees, one PR per experience, the one review and who merges are in
[AGENTS.md](AGENTS.md#fixtures-prs-and-merging). Beyond those:

- Don't commit runtime databases, sockets, logs, session exports, screenshots or unrelated local command files.
- Prefer clean cutovers: migrate every caller, test and import, then remove obsolete code. Don't leave
  compatibility aliases unless an external consumer requires one.
- A PR states the observable problem, the experience it delivers, preserved contracts, and what ran (above).
- Answer actionable review comments with the fix, pushed in one go, and resolve the thread. CodeRabbit's generic
  docstring warning is advisory here.

## Documentation

Update documentation when a change affects installation or startup, keyboard controls (the door's README key
tables, its hint rows and UI-GRAMMAR §7), protocol or schema invariants, process boundaries, runtime paths, or
shipped versus planned behavior. Don't duplicate the roadmap into Markdown: the workboard is canonical; repository
docs describe durable architecture and workflow. After a big push, refresh the READMEs and CHANGELOG, the demo
hubs, the fresh-outline seed, the showcase and skills, and the regenerated architecture map
(in packages/door: `bun scripts/architecture-map.ts --sync` moves the citations and stamps the commit, `bun scripts/architecture-map.ts` checks and draws it; the push-review round runs the line-exact `--check`; `test/architecture-map.test.ts` fails only on a missing file or marker).
