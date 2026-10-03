# Agent workflow

Rules for any agent working in this repository. [CONTRIBUTING.md](CONTRIBUTING.md) has the verification
steps and the review checklist. The `ep0ch-core` skill ([packages/door/skills/ep0ch-core](packages/door/skills/ep0ch-core/SKILL.md))
is the short map across the packages, with the real-pane test recipe; `ep0ch-outline` is for working in an
outline for someone, and `ep0ch` for driving a door. `ep0ch --skill` lists them with the outliner's
`pi-extension/skills/`.

## The repository

One repo, `ep0ch`, of bun workspaces (no Turborepo). `bun run check` and `bun run test` at the root run each
package's own.

- **packages/outline-core**: pure shared code with no I/O: the property grammar, the draft.patch compare, the
  search matcher, `protocol.ts` (`PROTOCOL` and the wire types) and `outline-location.ts` (which outline a
  client opens, and the outlines folder's layout). Both sides import it; nobody copies it.
- **packages/outliner**: the outline host (the board software), its Herdr clients Tree, Detail and Preview
  (the sysop console), the CLI, the publisher, prompts, extensions and the Pi extension. It is the Herdr
  plugin root (`herdr-plugin.toml`). Its own [CONTRIBUTING.md](packages/outliner/CONTRIBUTING.md) has the
  source boundaries, correctness invariants and the Herdr live smoke test.
- **packages/door**: ep0ch, the terminal door people call into: screens built from tiles over one note
  surface. Its `docs/UI-GRAMMAR.md` is the glossary and the reuse map.
- **packages/claude-mod**: the Claude Code mod (outline and workboard tools, reference links, Recent
  Mentions). Its tests run under `claude plugin test`.

Both histories are kept: `git log --follow` and `git blame` reach back into ep0ch-door and pi-herdr-outliner.

## Before you build

- Read [Before adding a feature](packages/door/docs/UI-GRAMMAR.md#before-adding-a-feature) for the door, and
  the outliner's [Source boundaries](packages/outliner/CONTRIBUTING.md#source-boundaries) and
  [Architecture pass](CONTRIBUTING.md#1-architecture-pass) for the outliner. Name the shared parts the change
  uses, and use the glossary's words for screens, panes and actions.
- Use the layout vocabulary: block, tile, container, screen
  ([Layout](packages/door/docs/UI-GRAMMAR.md#layout-block-tile-container-screen)). "Pane" means Herdr's or tmux's box.
  A brief handed to another agent carries this vocabulary and the shared parts it must use, and its review asks
  whether it really used them.
- If no shared part fits, extend one or say in the PR why not. Don't add a parallel reader, pane model, search,
  editor or presence view.
- **Demo it in the kitchen sink.** Each reuse-map row gets a showcase section (the door README names the few still
  without one), and a user-visible feature gets a showcase section or note in the same PR, live where possible (`ep0ch --showcase`; `packages/door/src/showcase/`).
  The demo is also its end-to-end test: a new section's test in `packages/door/test/showcase.test.ts` opens it on the seeded outline, drives it
  through `act` and checks the result, so a feature can't quietly break its own demo. If it can't be shown there,
  the PR says why.
- For AI feature design, semantic judgments, or TypeSafe/Jev integration, use the installed `typesafe-ai`
  skill, resolved through the agent's skill catalog. Follow its live-documentation workflow before choosing
  primitives or writing API calls. If the skill is unavailable, start with the
  [TypeSafe documentation index](https://docs.typesafe.ai/llms.txt) and read the relevant current API/SDK and
  cookbook pages; report unavailable sources rather than inventing their contracts.

## The workboard

- Before planning work, changing roadmap state, or reporting delivery, read the live **How this workboard
  works** block `d5b3e557-a166-4c50-baad-7a0ed8db8fe6` through the outline host (`get` RPC). It owns the
  working flow; [the roadmap reference](packages/outliner/pi-extension/skills/outliner-workflow/references/roadmap-items.md)
  documents the operations and metadata. The workboard owns task status.
- When a live request fails, follow the
  [connection diagnostics](packages/outliner/CONTRIBUTING.md#connecting-to-the-running-service) before
  declaring the host unavailable or leaving workboard updates pending.
- For the reviewed data-safety fixes and Herdr/Pi interaction work, the outliner's
  [implementation plan](packages/outliner/docs/IMPLEMENTATION_PLAN.md) has dependencies and acceptance checks.
- Before changing runtime behavior or claiming implementation complete, follow
  [Verification](CONTRIBUTING.md#verification), including the outliner's
  [real-application testing and evidence requirements](packages/outliner/docs/IMPLEMENTATION_PLAN.md#execution-and-completion-requirements).

## Two clients, one outline

- The outline host (packages/outliner) is the board software, and its Tree, Detail and Preview panes in Herdr
  are the sysop console: find any block and fix it. The door is the board people call into, and a client
  that calls more than one outline. Both are maintained; the door doesn't replace the outliner. Don't treat
  the Herdr UI as legacy or drop its features because the door covers a case.
- When a service capability is added for one client, keep it usable by the other.
- Before adding a feature to a door screen, ask which client it belongs in. Finding and editing any block is
  the outliner's job, opened beside the door in Herdr (split, then zoom the door back). A screen doesn't need
  its own copy of that.

## Mouse and agents are first-class

- Every action works by mouse, by keys and through `act`. Define it as an action in an `ActionSet`
  (`packages/door/src/surface/actions.ts`); the key binding and the click call the same action.
- An agent's action never takes the person's focus, selection or keys, and it is always attributed
  (`author: agent` with its actor id, and said on screen).

## Outlines by name

Which outline a client opens (PIE-530, `outline-core/src/outline-location.ts`), first match wins: `--ws
<name>`, then `EP0CH_WS`, then the nearest `.ep0ch` walking up from the folder. It holds names only:
`ws = "<name>"`, and `machine = "<ssh-name>"` for an outline on another machine. Nothing else names one: a
folder that names none gets the home base (the door's `home` screen: open, new or import, here or on a machine),
never a guess taken silently and never a default. Outlines are
`<EP0CH_OUTLINES or ~/outlines>/<name>.sqlite`, each with its own folder `<name>/` beside it; the host's socket
and lock are in `.host/`.

Which machine, first match wins: `--machine <ssh-name>`, then `EP0CH_MACHINE`, then the `machine` of the
nearest `.ep0ch` when it names the same outline. A machine is an ssh config name; ssh owns its keys and hops. Every client
reaches it through one shared ssh forward, `<outlines>/.remote/<ssh-name>.sock`, started by the first client that
needs it (outline-core's `src/machine.ts`, `ensureForward`). `EP0CH_SOCKET` names any host's socket outright, the
low-level escape hatch.

## Schema and protocol: one version

This is a weeks-old project with one user and two databases that matter (pie on float-2, float-hub on the
MacBook). It does not support every version a client ever connected with.

- **One schema version.** The store's schema is the CREATE statements for the current version and nothing
  else (`packages/outliner/src/schema.ts`). There are no detect-old-shape checks in the runtime, ever. On open, a
  database whose `user_version` isn't the current one is refused with a message that names the version and the
  command that upgrades it.
- **Changing the schema:** bump `SCHEMA_VERSION` and write a one-off script in
  `packages/outliner/scripts/migrations/` that takes a database from N-1 to N. Run it by hand on the databases
  that matter (today pie and float-hub), and delete it once those are done. Git keeps it. No runtime chain of
  migrations.
- **Big changes:** the preferred path can be a fresh database plus an agent importing what matters now, not the
  entire history. The `import` command (`outliner import`, `ep0ch outline import`, and init's import option;
  `packages/outliner/src/outline-import.ts`) reads blocks, properties, page addresses and work ids from an older file.
- **Protocol works the same way.** Client and service must match: one shared constant, `PROTOCOL` in
  outline-core, replaces capability negotiation. A mismatch says which side to update. Bump it with any wire
  change and any change to what outline-core's shared modules match or compute.

## Never touch a real outline or a real door

- Tests run only against scratch hosts each test starts itself: the door's `Scratch` and `ScratchHost`
  (`packages/door/test/scratch.ts`, which finds `../outliner` by itself), the outliner's in-process servers and
  `test/scratch-outline.ts`. Never write to a real outline.
- `bun scripts/snap.ts` (in packages/door) scenarios that write need `EP0CH_SOCKET` pointing at a scratch host and
  `EP0CH_SNAP_WRITES=1`.
- A manual check uses a scratch outlines folder passed explicitly (`EP0CH_OUTLINES=<temp dir>`), never
  `~/outlines`.
- The owner's door may be running on the default control socket. Never run
  `bun src/main.ts act|peek|snap|open|actions` without pointing at your own test door:
  - start the door with `EP0CH_STATE` and `EP0CH_CONTROL` set under a temp directory, with `EP0CH_OUTLINES`
    (or `EP0CH_SOCKET`) pointing at a scratch host and `--ws` naming its outline, and `--no-daemon` (or
    `EP0CH_DAEMON=0`) so it doesn't run as a session that outlives your pane; testing a session, end it
    yourself (`EP0CH_STATE=… ep0ch session end --all --yes`);
  - pass the same `EP0CH_CONTROL` to every control command;
  - start it through `packages/door/scripts/test-door-env.sh`, which unsets every `EP0CH_*` you inherit and runs
    the agent drawer on `EP0CH_DAILY_AGENT=sh` (the person's shell exports their Herdr daily agent: see the
    real-pane recipe in the ep0ch-core skill). Never attach to or type into a Herdr pane you didn't make.
- A test door or test that names a machine (`--machine`, `EP0CH_MACHINE`, a `.ep0ch`'s `machine`) runs with
  `EP0CH_OUTLINES` under a temp dir (its forwards live in `.remote/` there, never `~/outlines/.remote`) and
  `EP0CH_SSH` pointing at the fake ssh (`packages/outliner/test/fake-ssh.ts`, through a two-line shell wrapper), whose
  "other machine" is a scratch host of its own (`FAKE_SSH_HOME`, `FAKE_SSH_OUTLINES` under the temp dir). Spawned
  processes get the environment passed explicitly: Bun's spawn doesn't see changes made to `process.env`.
- `EP0CH_CONTROL` moves the control socket; `EP0CH_STATE` moves everything else the door writes (layouts,
  drafts, marks, `lastcall.json`, snaps, `ctrl+e` files, the media cache, the sessions and the default socket). Set
  both. Sessions are one per outline, each in its own folder of the state dir
  (`sessions/<local or ssh-name>/<name>/`, `packages/door/src/session/place.ts`): its session files, control socket,
  saved desk, river and board layouts and last call. Two doors on one outline (and one `EP0CH_STATE`) share marks,
  but the desk layout is whichever saves last; the second is warned.

## Fixtures and commits

- Use fictional fixtures: made-up notes, names and ids in tests, snapshots and docs. No private details from a
  real outline, and no machine-specific paths.
- One coherent PR per change. For a feature split across agents, branch each slice from the feature branch
  (`<feature>/<slice>`, for example `door-writes/reuse-map`) and open the PR into it.
- A local bun may rewrite `bun.lock`. Don't commit lockfile churn; commit it only when dependencies change.
- Before calling it done, run [Verification](CONTRIBUTING.md#verification) and go through the
  [review checklist](CONTRIBUTING.md#review-checklist), architecture pass first.

## Per package

- **outline-core**: no I/O and no imports outside itself (node:path is fine). A change to what it matches or
  computes, or to a wire type, bumps `PROTOCOL`.
- **outliner**: the service owns truth and meaning; clients own presentation. Changes to Tree, Detail, pane
  orchestration or the host need the [live smoke test](packages/outliner/CONTRIBUTING.md#live-smoke-test).
  The plugin's `.claude/commands/` and the Pi extension are host adapters, not second implementations.
- **door**: every UI change is an action; the parity tests (`test/parity-*.test.ts`) catch one that isn't.
  Snapshots that changed are looked at. Interaction changes get a real-pane pass.
- **claude-mod**: a hooks module can't import application code; it runs the outliner's CLI from the Herdr
  plugin root, and draws a block through the door's (`ep0ch show --cells`, BlockView). A session's folder feeds
  the outline its nearest `.ep0ch` names, or nothing. Only `hooks/register.ts` is handed `$` (the engine
  refuses `$` passed across an import), so the other files are pure: parsing, argv and trees.
