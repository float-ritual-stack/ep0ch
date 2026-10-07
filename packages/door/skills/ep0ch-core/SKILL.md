---
name: ep0ch-core
description: Use when changing the code of the ep0ch repository (outline-core, the outliner's host, Tree/Detail and CLI, the Claude mod, the door): before planning a feature, while building it, when testing it against a scratch host or in a real terminal pane, when reviewing a PR, and when merging and deploying. Covers where the architecture and reuse maps are, the layout words, actions as the only UI path, two clients over one outline, scratch-only testing, the real-pane recipe, the review checklist and the deploy steps.
---

# ep0ch-core: changing the door or the outliner

One repo, `ep0ch`, four packages. **packages/outliner** is the outline host (it owns truth and meaning), its
Herdr clients Tree, Detail and Preview, the CLI and the publisher. **packages/door** is the terminal door people
use every day: screens built from tiles, all over one note surface. **packages/outline-core** is the pure code
both import (the property grammar, the draft.patch compare, the search matcher, `PROTOCOL` and the wire types,
which outline a client opens). **packages/claude-mod** is the Claude Code mod. This skill is a map. The rules
live in the repository's `AGENTS.md` and `CONTRIBUTING.md` and the packages' docs; read the ones a change
touches, and trust them over this page.

For working *in* an outline for someone, rather than on the code, use `ep0ch-outline`. For driving a door,
use `ep0ch`.

## Read first

| Before you… | Read |
|---|---|
| plan any door feature | packages/door `docs/UI-GRAMMAR.md`, [Before adding a feature](../../docs/UI-GRAMMAR.md#before-adding-a-feature) (the reuse map) and the glossary (§1) |
| plan any outliner feature | packages/outliner `CONTRIBUTING.md`, "Source boundaries"; the root `CONTRIBUTING.md`, "Architecture pass"; `docs/ARCHITECTURE.md` |
| touch the agent interface | packages/door `docs/AGENT-INTERFACE.md`; `packages/claude-mod/README.md` |
| change workboard state | the live **How this workboard works** block (the root `AGENTS.md` names it) and the `outliner-workflow` skill's roadmap reference |
| build or change an extension | packages/outliner `docs/extensions/README.md` (the contract, the four kinds, `@name` agents, worked examples); the door draws what `extensions.list` gives (`src/extensions.ts`) |
| change the protocol or the schema | the root `AGENTS.md`, "Schema and protocol: one version", and `CONTRIBUTING.md`, "Protocol and schema": one `PROTOCOL` in outline-core, bumped by any wire change, and a mismatch refused; a schema change bumps `SCHEMA_VERSION` with a one-off script in `packages/outliner/scripts/migrations/`, run by hand and deleted. No runtime compat, ever |
| change which outline a client opens | outline-core `src/outline-location.ts` (PIE-530): one rule for every client |
| need the whole picture | the architecture map, `packages/door/docs/architecture/map.json`: every structure in the door and the outliner, its ladder position and its open questions; `bun scripts/architecture-map.ts` in packages/door checks its citations and draws it |

Then the root `AGENTS.md` and `CONTRIBUTING.md`. They are short and they are the contract.

## Rules that shape every change

- **Reuse before building.** Name the shared part each need uses (a row of the reuse map): `NoteSurface`,
  the action registry, the layout tree, entity navigation, the editing component, the service contracts. If
  none fits, extend one, or say in the PR why not. Never a second reader, pane model, search, editor or
  presence view. A new shared part gets its reuse-map row and a showcase section in the same PR.
- **Packages meet at their public faces.** The door imports all of outline-core (`@ep0ch/outline-core/*`)
  and only what the outliner's `package.json` `exports` declares (today `machine-forward` and `plain-stderr`);
  `packages/door/test/package-boundary.test.ts` fails on any other import across packages. Shared pure code moves
  into outline-core and is imported, never copied.
- **An error says what to run.** A refusal or failure names why and the command that fixes it, as `doctor`,
  the schema refusal (the migration script) and the protocol mismatch (which side to update) do; a bare
  "failed" is a bug.
- **The service owns meaning.** View membership, property parsing, query evaluation, backlinks, what a
  write into a view must change, what changed: ask the service (`views.read`, `views.planWrite`,
  `query.matches`, `references.*`, `changes.since`); never compute it locally. Client and service speak one
  protocol (`PROTOCOL` in outline-core) and the door refuses a service on another number: a wire change bumps it. Where a call
  per paint is too slow, import the rule from outline-core (`@ep0ch/outline-core/*`), never a local copy of it.
- **Every action is an action.** Define it once as an `ActionDef` in an `ActionSet`
  (`src/surface/actions.ts`); the key, the click or drag and `act` all call it. A UI change that isn't an
  action is a bug, and `test/parity.ts` (run by `test/parity-*.test.ts`) catches it: it presses every key and clicks every row on every
  screen and fails on a change no action named that key ran. Mouse is first-class: every feature states its
  mouse path and its key path.
- **One dispatcher per screen host runs every action** (`src/surface/dispatch.ts`, PIE-514). A screen
  registers its action sets, its tiles (`TileRef`) and where the person's keys are on it (`Screen.keys`); keys
  and clicks call `press`, the control socket `act`. `tile=` has one grammar there (name, id, number, alias,
  `focused`, block id): never parse a tile name in a screen. Each `ActionDef` declares what it `touches`
  (`nothing`, `tile`, `shape`, `draft`, `screen`), whether a `replay` is `safe`, and `person` when it is the
  person's only; the dispatcher checks that once against the shell's whereabouts query (`App.person()`,
  `src/whereabouts.ts`). Don't write `actor.kind === "agent"` checks for the person's keys: declare it. What
  remains per actor is whose state it is (an agent's own card selection) and who is told.
- **Every draft is a draft session** (`src/draft-session.ts`): a new kind of text the door writes is a
  target adapter on it (block, comment or reply, card or child), never its own put-aside, restore, hold or
  click-away. Every rule about an agent and a draft is its `draftRule` (`agentRefusal`), which the dispatcher asks for `touches: "draft"`.
- **A reader's modes are one stack** (`src/surface/modes.ts`): a new thing that takes a reader's keys (a
  picker, a panel, an editor) is a `ReaderMode` with its place in `PRECEDENCE`, never a field `key`, `click`
  and `render` each check. NoteSurface stays the only reader.
- **Agents are first-class, and never take the person's cursor.** An agent can do what the person can, with
  honest provenance (`author: agent`, its actor id, said on screen). It never moves the person's focus,
  selection or keys, and never the reader they type in; refusals say why. Safety comes from revision
  checks, attribution and undo, not from forbidding agents.
- **One session per outline, many terminals** (PIE-418, `src/session/`): the door can run as a session that outlives
  every terminal; quitting detaches (`Ctx.logoff`), `session.end` ends it. Where a session lives is one rule,
  `src/session/place.ts` (`placeFor`, `placeOf`): the outline's folder of the state dir, which also holds what's that
  outline's (`outlineState()`: the screens' saved layouts, the last call, the control socket); shared state stays in the
  state dir itself. Never build a session or per-outline path any other way. Anything that must outlive a terminal lives in
  the session; never a second keep-alive. A frame goes to a `Display` (`src/display.ts`): a `Painter` per terminal,
  so never write CP437 or Kitty bytes from a screen. A program the person runs in their own terminal (the drop
  shell, `$EDITOR`) goes through `Ctx.suspend`'s `Handover`, never `stdio: "inherit"` from the door: in a session the
  door has no terminal. A terminal tile's program starts through the `PtyBackend` (`src/desk/pty-backend.ts`), never
  `Bun.Terminal` directly: in a session it runs in the terminal host, so a daemon upgrade adopts it. State that must
  come back after an upgrade comes back through an action that declares `replay: "safe"` (the session's checkpoint) or a
  screen's saved state, never a restore of its own.
- **Two clients, one outline.** Tree/Detail in Herdr is the sysop console (find any block, edit it); the door
  is the everyday board. Both are maintained. A service feature added for one stays usable by the other.
  Don't call the Herdr UI legacy.
- **The layout words** (UI-GRAMMAR, "Layout: block, tile, container, screen"): a *block* is outline content,
  never UI; a *tile* shows one thing (its kind from the tile-kind registry); a *container* arranges tiles
  (`split`, `tabs`, `columns`, `dock`, `flow`: the river's columns, each opening into the next, squeezed full,
  peek or spine around the wide one) under a saved *policy* (`layout.policy`, `^W P`; `locked` fixes a screen's
  shape; `opens` is the open rule); a *screen* is a saved tree of containers and tiles. *Pane* means Herdr's or
  tmux's box only. Don't switch on a tile kind's name. A container's tiles can come from data (a tile source:
  the board's columns are `hub:<id>`); a screen is a **spec** on the desk, the one screen host (PIE-515,
  `src/desk/screen-spec.ts`: containers with policy, tiles by kind, a key map naming actions, a hint, a band, where
  opens land), never a subclass and never a second layout host. What a screen does beyond layout goes in its
  tiles' kinds (a kind's actions, `peek`, `band`, `take`, its default policy), a columns source's model (the board's
  lanes: `TileSource.model`, `src/desk/lanes.ts`) or a policy field; a spec stays plain
  data (`specData`/`readSpec`), because a screen note can't hold an override.
- **A layout changes one way:** an operation of the screen-layout module (`src/desk/screen-layout.ts`,
  `apply(state, op, ctx)`): one step for one actor, the new state or a refusal with its reason. Its rules
  (floats, policy, the lock, never the tile the person types in) live inside it, so a view never checks them
  itself and never writes to a tree: it calls `Desk.apply` (the state is frozen under test; a write throws).
  Need a new kind of change? Add an operation to the module and test it through `apply`, with no App
  (`test/screen-layout.test.ts`, `test/flow.test.ts`).
- **Two layers:** the *screen layer* is swapped per screen and stays as small as it was designed; the *host
  layer* (the agent, admin outline and detail, terminals) is above every screen and kept across switches. It is a
  layout on the same module (`hostLayer`, `placeHost`): a slot for the screen beside a dock of tabs; a screen's
  policy `host` (`beside`, `over`, `none`) says where it may appear. That dock holds **your drawer** (PIE-498): the
  drawer's own desk (`hostSpec`), its tiles the drawer's tabs, and `tile.drawer` moves any tile in or out whole (the screen's
  `take`, the other's `open`; a terminal keeps the key its program runs under, `PtyPane.keptKey`). Put what the
  person carries between screens there, never as a tile duplicated on each screen. "Drawer" means only this; a **dock** is a
  screen's edge container a tile is docked into (`tile.dock`), which stays on that screen. A river column is held
  (`tile.hold`), a float put back.
- **Build the real shape.** Prefer the design that makes the end state true (the open registry over a
  closed list with one escape hatch) and ship it in coherent slices of that architecture. Don't pick the
  minimal option "until we outgrow it".
- **Keys.** Before adding or changing a key, check what it does on every screen and say what moves where;
  update the hint rows, the README's key tables and UI-GRAMMAR §7.

## Testing: scratch services only

Never write to a real outline or touch the person's door. Their door may be on the default control socket.

- **Running them:** whole suites in a boxd box, off the shared machine: `scripts/box-test` at the repo root (the
  door; `all`, `--each`), which streams the output and exits with the suites' code. On float-2 a focused run goes
  through `scripts/agent-env <name> --test -- timeout 900 bun test test/<file>.test.ts`: queued for one of two
  test slots, capped, in the foreground. Never `--parallel`, never in the background waiting for a notification:
  report the result you saw. The door's `parity-screens` takes more than
  ten minutes whole, so run it in parts: `PARITY_ONLY="main menu,message reader"` names scenarios by their labels
  (`test/parity.ts`), split on commas, so a label with a comma in it ("home base, an outline missing") is picked
  with `-t "home base, an outline missing"` instead.
- **Tests:** `bun run check` and `bun run test` at the root, or `bun test` in a package. The door's tests start
  their own outline host with `Scratch` or `ScratchHost` (`test/scratch.ts`, which finds `../outliner`): a
  scratch outlines folder, one outline `scratch` as the host's default. Fixtures
  are fictional: made-up notes, names and ids.
- **Snapshots:** `bun scripts/snap.ts <scenario>` writes PNGs to `out/`. Open them; a snapshot nobody looked
  at isn't evidence. Writing scenarios need `EP0CH_SOCKET=<scratch host socket>` and `EP0CH_SNAP_WRITES=1`.
- **Your own door:** set `EP0CH_STATE` and `EP0CH_CONTROL` under a temp folder and pass the same
  `EP0CH_CONTROL` to every `peek`, `act`, `snap` or `open`. `EP0CH_STATE` moves everything else the door
  writes (layouts, drafts, marks, the media cache). Point it at a scratch host with `EP0CH_OUTLINES=<temp
  outlines folder>` and `--ws <name>`, never at `~/outlines`.
- **A scratch host by hand:** with `d=$(mktemp -d)`, `EP0CH_OUTLINES=$d/outlines EP0CH_DEFAULT_WS=garden XDG_CONFIG_HOME=$d/config
  bun packages/outliner/src/host-main.ts` (as `scripts/try-it.sh` starts one: without `XDG_CONFIG_HOME` it reads the
  person's `~/.config`),
  then `EP0CH_OUTLINES=$d/outlines ep0ch outline create garden` (`ep0ch init` would write a `.ep0ch` into the
  folder you run it in). Its socket is `$d/outlines/.host/host.sock`.
- **Real outline shapes without real writes:** `ep0ch try --ws <name> --copy` serves a private copy of that
  outline's database from a host of its own, deleted on exit. Never copy its content into fixtures, commits or
  PRs; report counts and shapes only.

### The real-pane pass

When interaction changes, drive the real door in a terminal pane, by keys and by mouse:

```sh
# in packages/door (of your worktree). ../../scripts/agent-env <name> gives you your own EP0CH_STATE, EP0CH_CONTROL,
# EP0CH_OUTLINES and TMPDIR in ~/.agent-env/<name>/ (mode 700, short enough for sockets), the same every time, and
# unsets every inherited EP0CH_* through scripts/test-door-env.sh (EP0CH_DAILY_AGENT=sh, EP0CH_DAEMON=0: the door in
# the pane, not a session that outlives it). `--print` shows them.
E="../../scripts/agent-env me --"
tmux new-session -d -s try -x 160 -y 48 "$E scripts/try-it.sh --showcase"   # its own host, outline `showcase`
d=$(../../scripts/agent-env me --print | sed -n "s/^export EP0CH_STATE=//p")
C=$d/showcase/door/door.sock                    # the showcase sets its own EP0CH_CONTROL; it prints it
# any other outline: $E bun src/main.ts --ws garden   (its control socket is the agent-env's EP0CH_CONTROL)
EP0CH_CONTROL=$C bun src/main.ts peek           # the screen as text, plus state
EP0CH_CONTROL=$C bun src/main.ts act layout.get --as <your-id>
tmux send-keys -t try j                                       # a key
tmux send-keys -t try -l $'\e[<0;6;7M'; tmux send-keys -t try -l $'\e[<0;6;7m'   # click col 6, row 7
tmux send-keys -t try -l $'\e[<65;6;7M'                       # wheel down (64 is up)
tmux capture-pane -p -t try                                   # or: bun src/main.ts snap out.png
$E ep0ch session end --all --yes                # a session (EP0CH_DAEMON=1) and its terminal host outlive the pane: end yours
tmux kill-session -t try; ../../scripts/agent-env me --clean   # then check no host-main.ts (or `session serve`, `session pty-host`) of yours is left
```

- **Never the person's agent.** Start every test door through `../../scripts/agent-env` or `scripts/test-door-env.sh` (or
  `env -u EP0CH_DAILY_AGENT -u EP0CH_DAILY_CWD -u EP0CH_LANDING -u EP0CH_NOW_PAGE
  EP0CH_DAILY_AGENT=sh …`, with any other inherited `EP0CH_*` unset too). As a backstop, a door on its own
  `EP0CH_STATE` or `EP0CH_CONTROL` refuses to start the Herdr daily agent (`doorScope`, src/desk/herdr-agent.ts);
  `EP0CH_HERDR_SCOPED=1` gives it one of its own (`door-<outline>-<hash>`), never the person's. Never attach to or type
  into a Herdr pane you didn't make; kill only your own pids.
- **Short paths.** Unix sockets fail past about 104 bytes. The scratchpad folders agents get are too long:
  agent-env's `~/.agent-env/<name>/` is short, or use `mktemp -d /tmp/…`.
- **Mode 700.** The door serves no control socket in a folder others can reach, and says why.
- **SGR mouse** is `ESC [ < button ; col ; row M` for a press and `… m` for the release, 1-based; drags
  add 32 to the button. In Herdr, `herdr pane send-text <pane> …` sends the same bytes.
- Check results with `peek`, `layout.get` or `view.get` on *your* control socket, and with your eyes on
  `capture-pane` or `snap`. Injected keys don't prove a physical keyboard, ssh or macOS path: say so.
- For an outliner Tree/Detail change, packages/outliner `CONTRIBUTING.md`'s "Live smoke test" and
  "User-workflow walkthrough" are the equivalent. Tree (`src/outliner.ts`) and Detail (`src/detail-main.ts`)
  also run in a plain tmux pane against a scratch host (`EP0CH_OUTLINES`, `EP0CH_WS`); the Herdr journeys
  (`bun run test:e2e:*`) run a private Herdr session of their own.

Verify the whole experience yourself, the way the person would use it daily, not one acceptance check at a
time. Hand back one thing to try, never a checklist of increments.

## Review

The root `CONTRIBUTING.md` has the checklist, architecture pass first
([Review checklist](../../../../CONTRIBUTING.md#review-checklist)). The question that catches the most:

- **Did you really?** List each shared part the brief or PR said it would use and check the diff actually
  uses it. Name every place it built its own instead (a second dock, a screen-only layout, a key with no
  action, a switch on a tile kind's name). Expect at least one; fix it or say why not.
- **Is it in the kitchen sink?** A user-visible feature gets a showcase section or note in the same PR, live
  where possible (`ep0ch --showcase`), as each reuse-map row gets its section, and its test drives that section
  through `act` (`packages/door/test/showcase.test.ts`); if it can't be shown, the PR says why.

After a big push or two, review the system as a whole: one lens per reviewer (architecture and reuse,
portability and runtime, daily-driver interaction), reporting, not fixing. Then refresh the docs (README and
CHANGELOG, the demo hubs, the fresh-outline seed, the showcase and skills, the regenerated architecture map).

## Branches, PRs, merging

- Work in a worktree (`git worktree add -b <branch> ../ep0ch-<slug> origin/main`). Never switch branches, pull or
  commit in the live checkout: it is what runs, and it may hold the person's uncommitted files. It moves only on
  `ep0ch install --apply`, which fast-forwards it, restarts the outline host when it needs to and hands this
  machine's door sessions to the new code (a door on another machine is restarted there).
- One coherent PR per change. A feature split across agents uses a feature branch: slices branch from it
  (`<feature>/<slice>`) and open PRs into it; one PR goes from the feature branch to main.
- Paid review runs on PRs into main. Put `[skip review]` in the title of docs-only, mechanical or small PRs
  and review them yourself (`/code-review` for code). Push fixes in one go; don't re-trigger reviews.
- Don't commit lockfile churn from a local bun; commit `bun.lock` only when dependencies change.
- Merge yourself once review is resolved: `gh pr merge --squash` (never `--delete-branch` or `-d`: gh also deletes the local branch, and with it the worktree an agent has it checked out in; delete the remote branch alone with `gh api -X DELETE repos/float-ritual-stack/ep0ch/git/refs/heads/<branch>`). Check for bot reviews posted
  after the merge, and answer them in a follow-up PR.

## Deploy and back up

- **Back up before touching a live database** by hand: every outline is `~/outlines/<name>.sqlite`;
  `sqlite3 ~/outlines/<name>.sqlite ".backup ~/backups/<name>-<UTC stamp>.sqlite"`. A bad `update` is only
  recoverable from a backup: the host keeps no earlier text.
- **`ep0ch doctor`** (read-only) says what's behind. **`ep0ch install`** prints the plan; `--apply` backs up
  every outline to `~/backups/ep0ch/`, fast-forwards the checkout, links `ep0ch`, and restarts the outline
  host when its code changed. See the door README, "Install and update".
- **A schema change** ships with its one-off script: back up, stop the host, run
  `bun packages/outliner/scripts/migrations/<NNNN>-*.ts ~/outlines/<name>.sqlite` on each outline that matters,
  start the host. A database on another version is refused at open, never migrated by the runtime.
- **After an outliner or outline-core merge,** restart the outline host on new code (`systemctl --user restart
  outliner-host.service` on Linux, `launchctl kickstart -k gui/$(id -u)/io.ep0ch.outliner-host` on macOS).
  Doors and panes reconnect by themselves. A Claude started before the mod changed has old tools until it
  restarts (`ep0ch act agent.restart` for the door's agent).
- **Deploy only when asked.** A protocol mismatch in your tools is not a reason to run `ep0ch install --apply`:
  ask the person.
- **After a door merge,** `ep0ch install --apply` moves the live checkout; `ep0ch` links to its packages/door. A `PROTOCOL` bump needs
  the host and the doors (and a remote door on another machine) on the same code. Restart doors that should run the
  new code; say what you restarted and how to reopen it.
- Report implemented, exercised, merged, deployed and accepted separately.
