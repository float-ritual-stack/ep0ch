---
name: ep0ch-core
description: Use when changing the code of ep0ch-door or pi-herdr-outliner (the outline service, Tree/Detail, the Claude mod, the door): before planning a feature, while building it, when testing it against a scratch service or in a real terminal pane, when reviewing a PR, and when merging and deploying. Covers where the architecture and reuse maps are, the layout words, actions as the only UI path, two clients over one outline, scratch-only testing, the real-pane recipe, the review checklist and the deploy steps.
---

# ep0ch-core: changing the door or the outliner

Two repos, one system. **pi-herdr-outliner** is the outline service (it owns truth and meaning), its Herdr
clients Tree, Detail and Preview, the CLI, the publisher and the Claude mod. **ep0ch-door** is the terminal
door people use every day: screens built from tiles, all over one note surface. This skill is a map. The
rules live in the repos' docs; read the ones a change touches, and trust them over this page.

For working *in* an outline for someone, rather than on the code, use `ep0ch-outline`. For driving a door,
use `ep0ch`.

## Read first

| Before you… | Read |
|---|---|
| plan any door feature | ep0ch-door `docs/UI-GRAMMAR.md`, [Before adding a feature](../../docs/UI-GRAMMAR.md#before-adding-a-feature) (the reuse map) and the glossary (§1) |
| plan any outliner feature | pi-herdr-outliner `CONTRIBUTING.md`, "Source boundaries" and "Architecture pass"; `docs/ARCHITECTURE.md` |
| touch the agent interface | ep0ch-door `docs/AGENT-INTERFACE.md`; the Claude mod's `claude-mod/README.md` |
| change workboard state | the live **How this workboard works** block (pi-herdr-outliner `AGENTS.md` names it) and the `outliner-workflow` skill's roadmap reference |
| build or change an extension | pi-herdr-outliner `docs/extensions/README.md` (the contract, the four kinds, `@name` agents, worked examples); the door draws what `extensions.list` gives (`src/extensions.ts`) |
| change the protocol | pi-herdr-outliner `CONTRIBUTING.md`, "Protocol and schema changes": additive means a capability, not a version bump |
| need the whole picture | the architecture map, `docs/architecture/map.json` in the door: every structure in both repos, its ladder position and its open questions; `bun scripts/architecture-map.ts` checks its citations and draws it |

Then both repos' `AGENTS.md` and `CONTRIBUTING.md`. They are short and they are the contract.

## Rules that shape every change

- **Reuse before building.** Name the shared part each need uses (a row of the reuse map): `NoteSurface`,
  the action registry, the layout tree, entity navigation, the editing component, the service contracts. If
  none fits, extend one, or say in the PR why not. Never a second reader, pane model, search, editor or
  presence view. A new shared part gets its reuse-map row and a showcase section in the same PR.
- **The service owns meaning.** View membership, property parsing, query evaluation, backlinks, what a
  write into a view must change, what changed: ask the service (`views.read`, `views.planWrite`,
  `query.matches`, `references.*`, `changes.since`). Against an older service, say which capability is
  missing; never compute it locally. Where a call per paint is too slow, use the vendored module
  (`src/vendor/`), never a local copy of the rule.
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
- **One session, many terminals** (PIE-418, `src/session/`): the door can run as a session that outlives every
  terminal; quitting detaches (`Ctx.logoff`), `session.end` ends it. Anything that must outlive a terminal lives in
  the session; never a second keep-alive. A frame goes to a `Display` (`src/display.ts`): a `Painter` per terminal,
  so never write CP437 or Kitty bytes from a screen. A program the person runs in their own terminal (the drop
  shell, `$EDITOR`) goes through `Ctx.suspend`'s `Handover`, never `stdio: "inherit"` from the door: in a session the
  door has no terminal.
- **Two clients, one outline.** Tree/Detail in Herdr is the sysop console (find any block, edit it); the door
  is the everyday board. Both are maintained. A service capability added for one stays usable by the other.
  Don't call the Herdr UI legacy.
- **The layout words** (UI-GRAMMAR, "Layout: block, tile, container, screen"): a *block* is outline content,
  never UI; a *tile* shows one thing (its kind from the tile-kind registry); a *container* arranges tiles
  (`split`, `tabs`, `columns`, `drawer`, `flow`: the river's columns, each opening into the next, squeezed full,
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
  layout on the same module (`hostLayer`, `placeHost`): a slot for the screen beside a drawer of tabs; a screen's
  policy `host` (`beside`, `over`, `none`) says where it may appear. Put what the person carries between screens
  there, never as a tile duplicated on each screen.
- **Build the real shape.** Prefer the design that makes the end state true (the open registry over a
  closed list with one escape hatch) and ship it in coherent slices of that architecture. Don't pick the
  minimal option "until we outgrow it".
- **Keys.** Before adding or changing a key, check what it does on every screen and say what moves where;
  update the hint rows, the README's key tables and UI-GRAMMAR §7.

## Testing: scratch services only

Never write to a real outline or touch the person's door. Their door may be on the default control socket.

- **Tests:** `EP0CH_OUTLINER=<pi-herdr-outliner checkout> bun test` in the door; each test starts its own
  service with `Scratch` (`test/scratch.ts`). In the outliner, `bun run check` and `bun test`. Fixtures are
  fictional: made-up notes, names and ids.
- **Snapshots:** `bun scripts/snap.ts <scenario>` writes PNGs to `out/`. Open them; a snapshot nobody looked
  at isn't evidence. Writing scenarios need `EP0CH_SOCKET=<scratch socket>` and `EP0CH_SNAP_WRITES=1`.
- **Your own door:** set `EP0CH_STATE` and `EP0CH_CONTROL` under a temp folder and pass the same
  `EP0CH_CONTROL` to every `peek`, `act`, `snap` or `open`. `EP0CH_STATE` moves everything else the door
  writes (layouts, drafts, marks, the media cache).
- **Real outline shapes without real writes:** `ep0ch try --ws <root> --copy --outliner <checkout>` serves a
  private copy of that outline's database from its own service, deleted on exit. Never copy its content
  into fixtures, commits or PRs; report counts and shapes only.

### The real-pane pass

When interaction changes, drive the real door in a terminal pane, by keys and by mouse:

```sh
# in the door checkout (or your worktree of it)
mkdir -p -m 700 /tmp/claude-$(id -u); d=$(mktemp -d /tmp/claude-$(id -u)/e5-XXXX); chmod 700 "$d"  # short: a socket path over ~104 bytes fails
# scripts/test-door-env.sh unsets every inherited EP0CH_* (EP0CH_DAILY_AGENT, EP0CH_HERDR_AGENT_CMD, EP0CH_DAILY_CWD,
# EP0CH_LANDING, EP0CH_NOW_PAGE by name too) inside the session, sets EP0CH_DAILY_AGENT=sh, then what you pass.
tmux new-session -d -s try -x 160 -y 48 \
  "scripts/test-door-env.sh EP0CH_STATE=$d/s scripts/try-it.sh --showcase --outliner <pi-herdr-outliner checkout>"
C=$d/s/showcase/door/door.sock                  # the showcase sets its own EP0CH_CONTROL; it prints it
EP0CH_CONTROL=$C bun src/main.ts peek           # the screen as text, plus state
EP0CH_CONTROL=$C bun src/main.ts act layout.get --as <your-id>
tmux send-keys -t try j                                       # a key
tmux send-keys -t try -l $'\e[<0;6;7M'; tmux send-keys -t try -l $'\e[<0;6;7m'   # click col 6, row 7
tmux send-keys -t try -l $'\e[<65;6;7M'                       # wheel down (64 is up)
tmux capture-pane -p -t try                                   # or: bun src/main.ts snap out.png
EP0CH_STATE=$d/s ep0ch session end --yes      # a session (EP0CH_DAEMON=1) outlives its pane: end yours
tmux kill-session -t try; rm -rf "$d"           # then check no server-main.ts (or `session serve`) of yours is left
```

- **Never the person's agent.** Start every test door through `scripts/test-door-env.sh` (or
  `env -u EP0CH_DAILY_AGENT -u EP0CH_HERDR_AGENT_CMD -u EP0CH_DAILY_CWD -u EP0CH_LANDING -u EP0CH_NOW_PAGE
  EP0CH_DAILY_AGENT=sh …`, with any other inherited `EP0CH_*` unset too). As a backstop, a door on its own
  `EP0CH_STATE` or `EP0CH_CONTROL` refuses to start the Herdr daily agent (`doorScope`, src/desk/herdr-agent.ts);
  `EP0CH_HERDR_SCOPED=1` gives it one of its own (`door-claude-<hash>`), never the person's. Never attach to or type
  into a Herdr pane you didn't make; kill only your own pids.
- **Short paths.** Unix sockets fail past about 104 bytes. The scratchpad folders agents get are too long:
  use `mktemp -d /tmp/…`.
- **Mode 700.** The door serves no control socket in a folder others can reach, and says why.
- **SGR mouse** is `ESC [ < button ; col ; row M` for a press and `… m` for the release, 1-based; drags
  add 32 to the button. In Herdr, `herdr pane send-text <pane> …` sends the same bytes.
- Check results with `peek`, `layout.get` or `view.get` on *your* control socket, and with your eyes on
  `capture-pane` or `snap`. Injected keys don't prove a physical keyboard, ssh or macOS path: say so.
- For an outliner Tree/Detail change, CONTRIBUTING's "Live smoke test" and "User-workflow walkthrough"
  are the equivalent.

Verify the whole experience yourself, the way the person would use it daily, not one acceptance check at a
time. Hand back one thing to try, never a checklist of increments.

## Review

Both repos' CONTRIBUTING has the checklist, architecture pass first. Door: ep0ch-door `CONTRIBUTING.md`,
[Review checklist](../../CONTRIBUTING.md#review-checklist). The question that catches the most:

- **Did you really?** List each shared part the brief or PR said it would use and check the diff actually
  uses it. Name every place it built its own instead (a second drawer, a screen-only layout, a key with no
  action, a switch on a tile kind's name). Expect at least one; fix it or say why not.

After a big push or two, review the system as a whole: one lens per reviewer (architecture and reuse,
portability and runtime, daily-driver interaction), reporting, not fixing. Then refresh the docs (README and
CHANGELOG, the demo hubs, the fresh-workspace seed, the showcase and skills, the regenerated architecture map).

## Branches, PRs, merging

- Work in a worktree (`git worktree add -b <branch> ../<repo>-<slug> origin/main`). Never switch branches in
  the live checkouts: they are what runs.
- One coherent PR per change. A feature split across agents uses a feature branch: slices branch from it
  (`<feature>/<slice>`) and open PRs into it; one PR goes from the feature branch to main.
- Paid review runs on PRs into main. Put `[skip review]` in the title of docs-only, mechanical or small PRs
  and review them yourself (`/code-review` for code). Push fixes in one go; don't re-trigger reviews.
- Don't commit lockfile churn from a local bun; commit `bun.lock` only when dependencies change.
- Merge yourself once review is resolved: `gh pr merge --squash --delete-branch`, then
  `git pull --ff-only` in the live checkout.

## Deploy and back up

- **Back up before touching a live database** by hand: `outliner outlines --json` names each outline's
  storage; `sqlite3 <db> ".backup ~/backups/<name>-<UTC stamp>.sqlite"`. A bad `update` is only recoverable
  from a backup: the service keeps no earlier text.
- **`ep0ch doctor`** (read-only) says what's behind. **`ep0ch install`** prints the plan; `--apply` backs up
  every outline to `~/backups/ep0ch/`, fast-forwards both checkouts, links `ep0ch`, and restarts the outline
  host when the plugin changed. See the door README, "Install and update".
- **After an outliner merge,** restart the outline host on new code (`systemctl --user restart
  outliner-host.service` on Linux, `launchctl kickstart -k gui/$(id -u)/io.ep0ch.outliner-host` on macOS).
  Doors and panes reconnect by themselves. A Claude started before the mod changed has old tools until it
  restarts (`ep0ch act agent.restart` for the door's agent).
- **After a door merge,** pull the live checkout; `ep0ch` links to it. Restart doors that should run the
  new code; say what you restarted and how to reopen it.
- Report implemented, exercised, merged, deployed and accepted separately.
