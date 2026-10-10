# Agent workflow

Rules for any agent working in this repository. [CONTRIBUTING.md](CONTRIBUTING.md) has the verification
steps and the review checklist. The `ep0ch-core` skill ([packages/door/skills/ep0ch-core](packages/door/skills/ep0ch-core/SKILL.md))
is the short map across the packages, with the real-pane test recipe; `ep0ch-outline` is for working in an
outline for someone, and `ep0ch` for driving a door. `ep0ch --skill` lists them with the outliner's
`pi-extension/skills/`.

## The repository

One repo, `ep0ch`, of bun workspaces (no Turborepo). `bun run check` and `bun run test` at the root run each
package's own.

- **packages/outline-core**: pure shared code with no I/O: the property grammar, the header line (`header-line.ts`),
  the block-as-a-record shape (`block-record.ts`), the one code fence rule (`code-fence.ts`) and where a note is
  code or literal (`code-ranges.ts`), the link grammar (`link-syntax.ts`: references, page links, embeds,
  anchors), the draft.patch compare, the search matcher, `protocol.ts` (`PROTOCOL` and the wire types) and
  `outline-location.ts` (which outline a client opens, and the outlines folder's layout). Both sides import it; nobody copies it.
- **packages/outliner**: the outline host (the board software), its Herdr clients Tree, Detail and Preview
  (the sysop console), the CLI, the publisher, prompts, extensions and the Pi extension. It is the Herdr
  plugin root (`herdr-plugin.toml`). Its own [CONTRIBUTING.md](packages/outliner/CONTRIBUTING.md) has the
  source boundaries, correctness invariants and the Herdr live smoke test.
- **packages/door**: ep0ch, the terminal door people call into: screens built from tiles over one note
  surface. Its `docs/UI-GRAMMAR.md` is the glossary and the reuse map.
- **packages/claude-mod**: the Claude Code mod (outline and workboard tools, reference links, Recent
  Mentions). Its tests run under `claude plugin test` (the root `bun run test` runs them, so `claude` must be on
  PATH). It reads `ep0ch`'s output, so the door's `test/claude-mod-contract.test.ts` runs the real CLI through the
  mod's own readers: a CLI change that breaks the mod fails there.

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
  editor or presence view: that means a second *implementation* of one, not a second place to read notes (see
  [Many clients, one set of parts](#many-clients-one-set-of-parts)).
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

## Many clients, one set of parts

Small purpose-built clients are welcome: a reader for the phone, a sidebar, a pane in another terminal, a detail
screen, an MCP client (ADR 0002). Each is a thin host. It reads and writes through the service (or MCP), parses
with outline-core, and draws with a renderer that exists: the door's NoteSurface in a terminal, PIE-520's
ViewSpec elsewhere (HTML, Markdown). What no client does is implement the parts again:

- reference, page, embed and anchor scanning; property tokens and scope; code fences and literal regions; note
  titles;
- resolution, search and ranking, backlinks and views (the service answers them);
- drafts, revisions, proposals and attribution;
- the wire types (outline-core `protocol.ts`).

Where one of those isn't shared yet, extend the shared part instead of copying it. The door still mirrors several
from the outliner; the map of what's shared, server-side and duplicated, with the copies that already disagree,
is the note "Note logic: shared, server-side and duplicated" under the latest push-review round, and converging
them is ongoing work. Drawing is each client's own: the door, Detail and the publisher draw differently, and they
share the structure (blocks, links, figures, fences), not the drawing.

## Blockdown, not Markdown

A note's source is **Blockdown**: Markdown-adjacent, plus the outline's own forms (properties, references, embeds,
page links, components). It makes no promise of Markdown compatibility and deviates where the outline needs to.
Markdown is a render target (export, the publisher, MCP), not the source's definition. Say "Blockdown" for the
source; the grammars are outline-core's ([glossary](packages/door/docs/UI-GRAMMAR.md#reading-and-editing-the-note-surface)).

## Capture is more reliable than interpretation

What a person writes always lands. Saving a note, a comment or a draft never depends on every reference, property
or component in it being valid: the raw text is saved first, then references are resolved, and anything unresolved is
marked inline as a warning (with a did-you-mean), never a refusal of the whole save. A refused action keeps the text
in front of the person with why and what to do. The comment box, the note editor and every other place a person
types share one editor (mouse select, delete, undo, paste, edit after save), not a second, weaker one.

The test for it is the human workflow, not parser units: write a comment, select and delete a phrase with the mouse,
insert a reference, make a syntax mistake, fix it (or don't), save, and nothing is lost.

## Properties are open

The schema is fluid: a note's properties are whatever its author wrote (`[key::value]`), and new keys appear every day.
So no client or component hard-codes which properties can be filtered, grouped or sorted on.

- Anything that narrows, groups or sorts notes takes the views' query grammar (`where=`/`query=`, the outliner's
  `block-query.ts` with outline-core's atoms) and a property *name* (`group=`, `sort=`), and the service answers it
  (`blocks.query`, `blocks.facets`). A control that offers choices lists the properties and values the rows actually
  have (facets), never a list in code.
- A familiar filter (Kind, Stage, the bookkeeping fold) is a saved query or a rule note in the outline, not a branch in
  a client.
- A property's *meaning* is still allowed in code where a part owns it: the workboard owns `work-stage` and `work-id`,
  the outbox its states. What's not allowed is a filter, group or sort that works for those keys and not for the next
  one someone writes.
- A query that names a property nobody has written answers "no notes have `<key>`" with the nearest keys that do
  exist, never a silent empty list.

## Mouse and agents are first-class

- Every action works by mouse, by keys and through `act`. Define it as an action in an `ActionSet`
  (`packages/door/src/surface/actions.ts`); the key binding and the click call the same action.
- An agent's action never takes the person's focus, selection or keys, and it is always attributed
  (`author: agent` with its actor id, and said on screen).

## Outlines by name

Which outline a client opens (PIE-530, `outline-core/src/outline-location.ts`), first match wins: `--ws
<name>`, then `EP0CH_WS`, then the nearest `.ep0ch` walking up from the folder. It holds names only:
`ws = "<name>"`, `machine = "<ssh-name>"` for an outline on another machine, and `agent = "<persona>"`, the name an
agent working in this folder writes as (ADR 0003: recorded, never a permission). Nothing else names one: a
folder that names none gets the home base (the door's `home` screen: open, new or import, here or on a machine),
never a guess taken silently and never a default. Outlines are
`<EP0CH_OUTLINES or ~/outlines>/<name>.sqlite`, each with its own folder `<name>/` beside it; the host's socket
and lock are in `.host/`.

Which machine, first match wins: `--machine <ssh-name>`, then `EP0CH_MACHINE`, then the `machine` of the
nearest `.ep0ch` when it names the same outline. A machine is an ssh config name; ssh owns its keys and hops. Every client
reaches it through one shared ssh forward, `<outlines>/.remote/<ssh-name>.sock`, started by the first client that
needs it (outline-core's `src/machine.ts`, `ensureForward`). `EP0CH_SOCKET` names any host's socket outright, the
low-level escape hatch.

A name nobody has yet is created when a client opens it on this machine (like `herdr --session`), never on another
machine (PIE-545): there (`--machine`, `--remote`, a `.ep0ch`'s `machine`) it is refused with the exact commands, or
the door's home base offers the choices (the one here, create it there, cancel). Only `--create`, `outline create`
or the home base's "new outline on <machine>" makes one there. The rule is outline-core's `mayCreate`; `--here`
names this machine over `EP0CH_MACHINE` and a `.ep0ch`'s machine.

A session's outline is named (flag, `EP0CH_WS`, the folder it started in), never inferred from where its shell is now. The door passes `EP0CH_WS` (and `EP0CH_MACHINE` for another machine) to every program it starts; a session that loses its binding gets it back with `/outline <name>` or the mod's `outline_bind`.

## Schema and protocol: one version

This is a weeks-old project with one user and two databases that matter (pie on float-2, float-hub on the
MacBook). It does not support every version a client ever connected with.

- **One schema version.** The store's schema is the CREATE statements for the current version and nothing
  else (`packages/outliner/src/schema.ts`). There are no detect-old-shape checks in the runtime, ever. On open, a
  database whose `user_version` isn't the current one is refused with a message that names the version and the
  command that upgrades it.
- **Changing the schema:** bump `SCHEMA_VERSION` and write a one-off script,
  `packages/outliner/scripts/migrations/<N>-<what>.ts`, that takes a database from N-1 to N
  (`bun <script> <database>`: one transaction, refuses a served file, exits non-zero leaving the file as it was).
  `ep0ch install --apply` runs it on each machine (PIE-617): it stops the host, migrates every outline at N-1,
  starts the host, and refuses to update when an outline can't take the step. Delete the script once the machines
  that matter (today pie and float-hub) have run it; git keeps it, and install then refuses an older outline with
  the import route. No runtime chain of migrations.
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
- The owner's door may be running on the default control socket. A test door, and every
  `bun src/main.ts act|peek|snap|open|actions` aimed at it, runs under **`scripts/agent-env <your name> -- …`**.
  It gives you your own `EP0CH_STATE`, `EP0CH_CONTROL`, `EP0CH_OUTLINES` (a scratch folder) and `TMPDIR` in
  `~/.agent-env/<name>/`, unsets every `EP0CH_*` you inherit (through `packages/door/scripts/test-door-env.sh`,
  which also runs the drawer on `EP0CH_DAILY_AGENT=sh` and the door with `EP0CH_DAEMON=0`), and is the same for
  every command you run under the same name. `--print` shows the settings. Wrap commands, never your own
  session: your outline tools would follow `EP0CH_OUTLINES` to the scratch folder.
  - name the scratch outline with `--ws`; testing a session, end it yourself
    (`scripts/agent-env <name> -- ep0ch session end --all --yes`);
  - never attach to or type into a Herdr pane you didn't make (the real-pane recipe is in the ep0ch-core skill).
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
- **The live checkout is what runs.** `~/projects/ep0ch` on float-2 (and the laptop's checkout) is what `ep0ch`,
  the Herdr plugin and the outline host run from, and it may hold the owner's uncommitted files. Work, pull and
  commit in a worktree of your own (`git worktree add ~/projects/ep0ch-wt-<topic> -b <branch> origin/main`),
  never there. It moves only through `ep0ch install --apply`, which backs up the outlines, fast-forwards it and
  hands everything to the new code together. Run that only when the person (or the agent they made the deployer)
  asks: a merged protocol bump with the host not yet restarted makes every client refuse it.
- **Tests on a shared machine:** whole suites run off float-2, on float-box by default and a boxd box as the fallback (`--on boxd`): `scripts/box-test` (the door) or
  `scripts/box-test all --each` before merging a series ([CONTRIBUTING](CONTRIBUTING.md#verification)). A focused
  run on float-2 goes through `scripts/agent-env <name> --test -- timeout 900 bun test <files>`: it waits for one
  of two test slots, is capped in CPU and memory (where there's a systemd user manager, as on float-2), and
  whatever it leaves running is stopped with it. Everything agent-env runs has `oom_score_adj` 1000, so when memory
  runs out the kernel kills a test before the outline host (it once killed the host during a whole-suite run).
  Several agents testing at once froze float-2 (4 cores), so never `--parallel` here. Heavy suites (a whole
  package, `--each`) go only through `scripts/box-test`, never on float-2. Run in the foreground, or poll your own
  background run (read its output file, check its pid) until it exits: a background run's notification may never
  reach you, so don't end a turn idling for one. Judge a run by its exit code: grepping colourised output for
  "fail" hides failures (153 outliner tests were red for a day that way).
- **Never kill what you didn't start.** No `pkill` or `pkill -f <pattern>`, no `kill` of a pid or process group you
  didn't launch: a pattern matches other agents' runs (one `pkill -f "box-test door"` killed several agents' suites).
  Stop your own by the pid you were given (or `scripts/agent-env <name> --clean`), after checking `pstree` for what
  it owns.
- **Merge with `gh pr merge <n> --squash`,** and check `gh pr view <n> --json state` says `MERGED`. GitHub deletes the
  remote branch itself (the repo's "automatically delete head branches") and retargets any PR stacked on it to main; never
  delete a merged branch by hand (`gh api -X DELETE …/refs/heads/…` closed a stacked PR instead of retargeting it). Never
  `gh pr merge -d`/`--delete-branch`: it also deletes the local branch and its worktree, which can be another agent's.
- **A roadmap item's title is plain words.** No `[key::value]` property syntax in it: the title is read as the
  block's text, and the header parser takes the brackets as properties.
- **Scratch files are yours alone.** A session's tmp folder is shared by every agent in it: write PR bodies and
  scratch files in a private `mktemp -d` there, and re-read a body before `gh pr create/edit --body-file` (one
  agent's draft was once published on another's PR).
- **Rebase on the way in, hand the sha on the way out.** main moves many times a day: rebase before the final test
  run, keep `PROTOCOL` one above main's when you bump it (when several open PRs bump at once, the deployer
  allocates the numbers: ask before you pick one), and after merging tell the deployer (the person, or the
  agent they made the deployer) the merge sha. A protocol or schema bump also says, in the PR, exactly what to
  run on each machine (migration commands with real values).
- **A second opinion before merging** catches what one reviewer misses: pipe the diff to Codex
  (`{ echo "<what to look for>"; git diff origin/main...HEAD; } | codex exec -c model='"gpt-6-astra"' --skip-git-repo-check -`;
  its sandbox can't read the repo on float-2, so the diff is all it sees). CodeRabbit and Greptile review PRs on
  their own. Never tag them or ask for a re-review (paid bots were turned off for PR volume). After a merge,
  check for a bot review that landed late, and follow up in a new PR.
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

## Agent skills

### Issue tracker

Issues are roadmap items (PIE-n) on the outline's workboard, written through the mod's `work_*` and `outline_*` tools or the outliner CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each a `[triage::<role>]` property on the item. A role never sets `work-stage`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: the glossary is UI-GRAMMAR.md §1 and ADRs go in the root `docs/adr/`. See `docs/agents/domain.md`.
