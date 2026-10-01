# Agent workflow

Rules for any agent working in this repository. [CONTRIBUTING.md](CONTRIBUTING.md) has the
verification steps and the review checklist.

## Before you build

- Read [Before adding a feature](docs/UI-GRAMMAR.md#before-adding-a-feature) first. Name the
  shared parts the change uses, and use the glossary's words for screens, panes and actions.
- If no shared part fits, extend one or say in the PR why not. Don't add a parallel reader, pane
  model, search, editor or presence view.

## Two clients, one outline

- The outline service (pi-herdr-outliner) is the board software, and its Tree, Detail and Preview panes in
  Herdr are the sysop console: find any block and fix it. The door is the board people call into, and a
  client that calls more than one outline. Both are maintained; the door doesn't replace the outliner.
- Before adding a feature to a door screen, ask which client it belongs in. Finding and editing any block
  is the outliner's job, opened beside the door in Herdr (split, then zoom the door back). A screen
  doesn't need its own copy of that.

## Mouse and agents are first-class

- Every action works by mouse, by keys and through `act`. Define it as an action in an
  `ActionSet` (`src/surface/actions.ts`); the key binding and the click call the same action.
- An agent's action never takes the person's focus, selection or keys, and it is always attributed
  (`author: agent` with its actor id, and said on screen).

## Never touch a real outline or a real door

- Tests run only against scratch services: `EP0CH_OUTLINER=<pi-herdr-outliner checkout> bun test`.
  Each test starts its own service with `Scratch` (`test/scratch.ts`). Never write to a real outline.
- `bun scripts/snap.ts` scenarios that write need `EP0CH_SOCKET` pointing at a scratch service and
  `EP0CH_SNAP_WRITES=1`.
- The owner's door may be running on the default control socket. Never run
  `bun src/main.ts act|peek|snap|open|actions` without pointing at your own test door:
  - start the door with `EP0CH_STATE` and `EP0CH_CONTROL` set under a temp directory, and with
    `EP0CH_SOCKET` (or the socket argument) pointing at a scratch service;
  - pass the same `EP0CH_CONTROL` to every control command.
- `EP0CH_CONTROL` moves the control socket; `EP0CH_STATE` moves everything else the door writes (layouts,
  drafts, marks, `lastcall.json`, snaps, `ctrl+e` files, the media cache, and the default socket). Set both.
  Two doors on one `EP0CH_STATE` share marks, but the desk layout is whichever saves last; the second is warned.

## Fixtures and commits

- Use fictional fixtures: made-up notes, names and ids in tests, snapshots and docs. No private
  details from a real outline, and no machine-specific paths.
- One coherent PR per change. For a feature split across agents, branch each slice from the feature
  branch (`<feature>/<slice>`, for example `door-writes/reuse-map`) and open the PR into it.
- A local bun may rewrite `bun.lock`. Don't commit lockfile churn; commit it only when dependencies
  change.
- Before calling it done, run [Verification](CONTRIBUTING.md#verification) and go through the
  [review checklist](CONTRIBUTING.md#review-checklist), architecture pass first.
