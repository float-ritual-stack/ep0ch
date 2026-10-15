# Agent workflow

Rules for any agent working in this repository. This file is the core every agent needs; the rest lives where it
applies:

- **Package rules** are in `.claude/rules/`: [door](.claude/rules/door.md), [outliner](.claude/rules/outliner.md),
  [outline-core](.claude/rules/outline-core.md), [claude-mod](.claude/rules/claude-mod.md), and
  [outlines-by-name](.claude/rules/outlines-by-name.md) for the code that picks an outline or a machine. Claude Code
  loads each one when you read its files, and the repository's mod (below) gives it to a Claude session when a Bash
  command touches them. **Any other tool (Codex, Pi), and any agent about to plan, change or run
  something in a package (a test door, snapshots, sessions) without having opened its files: read that package's file
  first,** and `outlines-by-name.md` too when the change touches which outline or machine a client opens.
- [CONTRIBUTING.md](CONTRIBUTING.md) has the verification steps and the review checklist. The `ep0ch-core` skill
  ([packages/door/skills/ep0ch-core](packages/door/skills/ep0ch-core/SKILL.md)) is the map across the packages, with
  the real-pane test recipe; `ep0ch-outline` is for working in an outline for someone, `ep0ch` for driving a door,
  `echonet` for carrying notes between outlines (`ep0ch --skill` lists them all).

## The repository

One repo, `ep0ch`, of bun workspaces (no Turborepo). `bun run check` and `bun run test` at the root run each package's
own. Both histories are kept: `git log --follow` and `git blame` reach back into ep0ch-door and pi-herdr-outliner.

- **packages/outline-core**: pure shared code with no I/O (the property, header, link and code-fence grammars, the
  block record, the search matcher, `protocol.ts` with `PROTOCOL` and the wire types, `outline-location.ts`). Both
  sides import it; nobody copies it.
- **packages/outliner**: the outline host (the board software), its Herdr clients Tree, Detail and Preview (the sysop
  console), the CLI, the publisher, prompts, extensions and the Pi extension; the Herdr plugin root. Its
  [CONTRIBUTING.md](packages/outliner/CONTRIBUTING.md) has the source boundaries, invariants and live smoke test.
- **packages/door**: ep0ch, the terminal door people call into: screens built from tiles over one note surface. Its
  `docs/UI-GRAMMAR.md` is the glossary and the reuse map.
- **packages/claude-mod**: the Claude Code mod (outline and workboard tools, reference links, Recent Mentions).

## Before you build

- **Infrastructure: read the hub first.** Before anything about machines, services, domains, tunnels, DNS, TLS,
  backups or public access, read `ep0ch show --ws pie 50fe932d-4314-4c1b-88c9-13e79a41ef83`: more is often running
  than the person remembers. Reuse it, and update the hub in the same step when you change infrastructure.
- **Architecture pass.** Read [Before adding a feature](packages/door/docs/UI-GRAMMAR.md#before-adding-a-feature) for
  the door, and the outliner's [Source boundaries](packages/outliner/CONTRIBUTING.md#source-boundaries) and
  [Architecture pass](CONTRIBUTING.md#1-architecture-pass). Name the shared parts the change uses, in the glossary's
  words: block, tile, container, screen
  ([Layout](packages/door/docs/UI-GRAMMAR.md#layout-block-tile-container-screen)); "pane" means Herdr's or tmux's box.
  A brief handed to another agent carries this vocabulary and the shared parts it must use, and its review asks
  whether it really used them.
- **Extend a shared part rather than write a parallel one** (a second *implementation* of a reader, pane model,
  search, editor or presence view; a second place to read notes is fine). If none fits, say in the PR why not.
- **A user-visible feature gets a kitchen-sink demo** (`ep0ch --showcase`) in the same PR, which is also its
  end-to-end test, or the PR says why not (details in the door's rules).
- For AI feature design, semantic judgments, or TypeSafe/Jev integration, use the `typesafe-ai` skill (from the skill
  catalog) and follow its live-documentation workflow before choosing primitives or writing API calls. Without it,
  start at the [TypeSafe documentation index](https://docs.typesafe.ai/llms.txt) and read the current API/SDK and
  cookbook pages; report unavailable sources rather than inventing their contracts.
- **Before changing runtime behaviour or calling it done,** follow [Verification](CONTRIBUTING.md#verification) (for
  the outliner, with its real-application evidence) and the [review checklist](CONTRIBUTING.md#review-checklist).

## The workboard

- Issues are roadmap items (PIE-n) on the outline's workboard. Before planning work, changing roadmap state, or
  reporting delivery, read the live **How this workboard works** block `d5b3e557-a166-4c50-baad-7a0ed8db8fe6` (`ep0ch
  show --ws pie d5b3e557-a166-4c50-baad-7a0ed8db8fe6`, or `outline_read`). It owns the working flow; [the roadmap
  reference](packages/outliner/pi-extension/skills/outliner-workflow/references/roadmap-items.md) documents the
  operations and metadata, `docs/agents/issue-tracker.md` the tools. It owns task status.
- When a live request fails, follow the [connection
  diagnostics](packages/outliner/CONTRIBUTING.md#connecting-to-the-running-service) before declaring the host
  unavailable or leaving workboard updates pending.
- **A roadmap item's title is plain words,** with no `[key::value]` in it: the header parser takes the brackets as
  properties.

## How the parts fit

- **Two clients, one outline.** The outline host's Tree, Detail and Preview in Herdr are the sysop console (find any
  block and fix it); the door is the board people call into, and a client that calls more than one outline. Both are
  maintained; neither replaces the other. A service capability added for one client stays usable by the other.
- **Many clients, one set of parts.** Small clients (a phone reader, a sidebar, an MCP client, ADR 0002) are thin
  hosts: they go through the service, parse with outline-core and draw with a renderer that exists (the door's
  NoteSurface in a terminal, PIE-520's ViewSpec elsewhere). No client implements again reference, page, embed and
  anchor scanning, property tokens and scope, code fences and literal regions, note titles; resolution, search and
  ranking, backlinks and views (the service answers them); drafts, revisions, proposals and attribution; or the wire
  types. Drawing is each client's own; they share the structure (blocks, links, figures, fences). Feature parity
  across surfaces isn't a goal: each offers the slice that's useful where it runs.
- **Blockdown, not Markdown.** Say "Blockdown" for a note's source: Markdown-adjacent plus the outline's own forms,
  with no promise of Markdown compatibility. Markdown is a render target. The grammars are outline-core's.
- **Agents act, nodes mail, readers read** ([ADR 0005](docs/adr/0005-agents-act-nodes-mail.md)): agents (MCP, the mod)
  are gated by the MCP access level (`ep0ch mcp access`) and nothing else; EchoNet nodes never write another outline's
  blocks (they hand over a packet; the receiving outline's subscription notes are the consent, and EchoNet never reads
  the MCP access level); readers see only what `[publish::…]`, shares and sign-in allow. They share how a change is
  recorded (attribution, `[from::]`, revisions, undo), never what permits it.
- **Mouse and agents are first-class.** Every action works by mouse, keys and `act` (one `ActionSet` action). An
  agent's action never takes the person's focus, selection or keys, and is always attributed (`author: agent` with its
  actor id, and said on screen).

## Capture is more reliable than interpretation

What a person writes always lands. Saving a note, a comment or a draft never depends on every reference, property or
component being valid: the raw text is saved first, then references are resolved, and anything unresolved is marked
inline as a warning (with a did-you-mean), never a refusal of the whole save. A refused action keeps the text in front
of the person with why and what to do. Every place a person types shares one editor (mouse select, delete, undo,
paste, edit after save), and capture is tested as a person works, not with parser units.

## Properties are open

A note's properties are whatever its author wrote (`[key::value]`), and new keys appear every day, so no client or
component hard-codes which properties can be filtered, grouped or sorted on.

- Anything that narrows, groups or sorts takes the views' query grammar (`where=`/`query=`, the outliner's
  `block-query.ts` with outline-core's atoms) and a property *name* (`group=`, `sort=`), and the service answers it
  (`blocks.query`, `blocks.facets`). A control that offers choices lists the facets the rows have, never a list in
  code.
- A familiar filter (Kind, Stage, the bookkeeping fold) is a saved query or a rule note, not a branch in a client.
- A part may own a property's *meaning* (the workboard owns `work-stage` and `work-id`, the outbox its states); what's
  not allowed is a filter, group or sort that works for those keys and not the next one.
- A query naming a property nobody has written answers "no notes have `<key>`" with the nearest keys, never a silent
  empty list.

## Outlines by name

Which outline a client opens, first match wins: `--ws <name>`, then `EP0CH_WS`, then the nearest `.ep0ch` walking up
from the folder. Nothing else names one, and nothing guesses: a folder that names none gets the home base. A name
nobody has yet is created on this machine, never implicitly on another (only `--create`, `outline create` or the home
base make one there). The details (machines, forwards, sessions) are in
[outlines-by-name](.claude/rules/outlines-by-name.md).

## Schema and protocol: one version

One user, two databases that matter (pie on float-2, float-hub on the MacBook), no support for old versions.

- **One schema version.** The store's schema is the CREATE statements for the current version only
  (`packages/outliner/src/schema.ts`). No detect-old-shape checks in the runtime, ever. A database at another
  `user_version` is refused with a message naming the version and the command that upgrades it.
- **Changing the schema:** bump `SCHEMA_VERSION` and write a one-off script,
  `packages/outliner/scripts/migrations/<N>-<what>.ts`, taking a database from N-1 to N (`bun <script> <database>`:
  one transaction, refuses a served file, exits non-zero leaving the file as it was). `ep0ch install --apply` runs it
  on each machine (PIE-617). Delete the script once pie and float-hub have run it. No runtime chain of migrations.
- **Big changes** can be a fresh database plus importing what matters now, not the entire history (`ep0ch outline
  import`, `packages/outliner/src/outline-import.ts`).
- **Protocol works the same way.** One shared constant, `PROTOCOL` in outline-core, replaces capability negotiation; a
  mismatch says which side to update. Bump it with any wire change and any change to what outline-core matches or
  computes.

## Never touch a real outline or a real door

- **Tests run only against scratch hosts each test starts itself** (the door's `Scratch`/`ScratchHost` in
  `packages/door/test/scratch.ts`, the outliner's in-process servers and `test/scratch-outline.ts`). Never write to a
  real outline. A manual check passes a scratch folder explicitly (`EP0CH_OUTLINES=<temp dir>`), never `~/outlines`.
- **The owner's door may be running on the default control socket.** A test door, and every `bun src/main.ts
  act|peek|snap|open|actions` aimed at it, runs under **`scripts/agent-env <your name> -- …`**: your own
  `EP0CH_STATE`, `EP0CH_CONTROL`, `EP0CH_OUTLINES` (scratch) and `TMPDIR` in `~/.agent-env/<name>/`, with every
  inherited `EP0CH_*` unset (set both `EP0CH_CONTROL` and `EP0CH_STATE` if you ever do it by hand). Wrap commands,
  never your own session (your outline tools would follow it to the scratch folder). Name the scratch outline with
  `--ws`, and end a session you tested yourself. `bun scripts/snap.ts` scenarios that write need `EP0CH_SOCKET` at a
  scratch host and `EP0CH_SNAP_WRITES=1`.
- **Never attach to or type into a Herdr pane you didn't make** (the real-pane recipe is in ep0ch-core).
- **A test naming a machine** (`--machine`, `EP0CH_MACHINE`, a `.ep0ch`'s `machine`) runs with `EP0CH_OUTLINES` under
  a temp dir (its forwards live in `.remote/` there, never `~/outlines/.remote`) and `EP0CH_SSH` pointing at the fake
  ssh (`packages/outliner/test/fake-ssh.ts`, through a two-line shell wrapper), whose "other machine" is a scratch
  host (`FAKE_SSH_HOME`, `FAKE_SSH_OUTLINES` under the temp dir). Spawned processes get the environment passed
  explicitly: Bun's spawn doesn't see changes made to `process.env`.

## Machines, checkouts and processes

- **The live checkout is what runs.** `~/projects/ep0ch` on float-2 (and the laptop's checkout) is what `ep0ch`, the
  Herdr plugin and the outline host run from, and it may hold the owner's uncommitted files. Work in a worktree of
  your own (`git worktree add ~/wt/ep0ch-wt-<topic> -b <branch> origin/main`; `~/wt` is beside bun's cache, so `bun
  install` hard-links), never there. It moves only through `ep0ch install --apply` (which backs up the outlines,
  fast-forwards it and hands everything to the new code together), run only when the person (or the agent they made
  the deployer) asks: a merged protocol bump with the host not restarted makes every client refuse it.
- **Tests on a shared machine.** Whole suites (a whole package, `--each`) run off float-2 through `scripts/box-test`
  (float-box, or `--on boxd`); `scripts/box-test all --each` before merging a series. A focused run on float-2 is
  `scripts/agent-env <name> --test -- timeout 900 bun test <files>` (two slots, capped, cleaned up, first for the OOM
  killer). Never `--parallel` on float-2 (several agents testing at once froze it). Run in the foreground, or poll
  your own background run until it exits (its notification may never reach you). **Judge a run by its exit code,**
  never by grepping coloured output.
- **Never kill what you didn't start.** No `pkill` or `pkill -f <pattern>`, no `kill` of a pid or process group you
  didn't launch. Stop your own by its pid (or `scripts/agent-env <name> --clean`), after checking `pstree`.
- **Scratch files are yours alone.** A session's tmp folder is shared: write PR bodies and scratch files in a private
  `mktemp -d`, and re-read a body before `gh pr create/edit --body-file`. Clean scratch up with
  `scripts/scratch-clean <dir>…` (or `scripts/agent-env <name> --clean`), never `rm -rf`: Claude Code's dangerous-command
  check can stop an `rm -rf` for a permission prompt even under bypass, and a builder's prompt waits in the deployer's
  session. `scratch-clean` removes only folders under `/tmp/claude-<uid>/`, `/tmp/ep0ch-agent-<uid>/`, `~/.agent-env/`
  and worktrees in `~/wt/` (through `git worktree remove`), and refuses the rest with why.
  Never put a removal inside a `bash -c`/`sh -c` string (or a tmux, ssh or `agent-env --` command string): Claude Code
  can't check an `rm` whose target is a variable there, and no permission rule or hook can allow it, so it always asks.
  Run `scripts/scratch-clean` as its own command instead.

## Fixtures, PRs and merging

- **Fixtures are made up:** notes, names and ids in tests, snapshots and docs. No private details from a real outline,
  and no machine-specific paths.
- **One coherent PR per change.** A feature split across agents branches each slice from the feature branch
  (`<feature>/<slice>`) and opens its PR into it. Don't commit `bun.lock` churn; commit it only when dependencies
  change.
- **Rebase on the way in, hand the sha on the way out.** Rebase before the final test run. Set `PROTOCOL` to main's
  value plus one at the final rebase, right before merging, never earlier (when several PRs bump it, the deployer
  orders their merges). A protocol or schema bump says in the PR exactly what to run on each machine, with real
  values.
- **A second opinion before merging:** pipe the diff to Codex
  (`{ echo "<what to look for>"; git diff origin/main...HEAD; } | codex exec -c model='"gpt-6-astra"' --skip-git-repo-check -`;
  its sandbox can't read the repo on float-2). CodeRabbit and Greptile review PRs on their own: never tag them or ask
  for a re-review. After a merge, check for a bot review that landed late and follow up in a new PR.
- **Merge with `gh pr merge <n> --squash`,** and check `gh pr view <n> --json state` says `MERGED`. Never
  `-d`/`--delete-branch` (it deletes the local branch and its worktree, which can be another agent's), and never
  delete a merged branch by hand: GitHub deletes it and retargets stacked PRs. After merging, tell the deployer the
  merge sha.

## Agents and skills here

`.claude/agents/` holds the agent definitions a brief starts from: `ep0ch-builder` (a ticket or wave slice end to
end), `ep0ch-verifier` (reproduce an old ticket, then close it with evidence or fix it test-first, leaving the close
to the deployer), and the read-only `ep0ch-recon` and `ep0ch-auditor` (one findings note in an outline, `path:line`
citations). For any bug or failing test the one debugging skill is `diagnosing-bugs` (`.agents/skills/`): a
reproduction that goes red before any fix. The `loki` skill (`.claude/skills/loki/`) is the deployer's runbook. The
five default triage roles are `[triage::<role>]` properties and never set `work-stage`
(`docs/agents/triage-labels.md`). The glossary is UI-GRAMMAR.md §1, and ADRs go in `docs/adr/`
(`docs/agents/domain.md`).

The repository's own Claude mod, `.claude/skills/ep0ch-repo/` (loaded for sessions in this repository only), turns the
hard rules above into refusals that name the command to run instead: `pkill`/`killall`, `git stash`, `gh pr merge
-d`/`--delete-branch`, `bun test --parallel` on float-2, and a merge into main whose `PROTOCOL` isn't main's plus one.
In the deployer's sessions it also runs the freshness sweep: after every three deploys or merges, a read-only agent
checks what `.claude/freshness.md` lists as stale and hands its findings to the main thread. It also attaches a package's
`.claude/rules/` file, once a session, to the first Bash command that touches that package.
