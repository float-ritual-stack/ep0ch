---
paths:
  - "packages/door/**"
  - "scripts/agent-env"
---

# The door (packages/door)

Rules for changing the door. The root `AGENTS.md` holds the rules for every package; this file adds the door's.
Claude Code loads it when you touch a file under `packages/door/`; other tools read it before changing the door.

## Which client, which parts

- Before adding a feature to a door screen, ask which client it belongs in. Finding and editing any block is
  the outliner's job, opened beside the door in Herdr (split, then zoom the door back). A screen doesn't need
  its own copy of that.
- Read [Before adding a feature](../../packages/door/docs/UI-GRAMMAR.md#before-adding-a-feature) (the reuse map) and
  name the shared parts the change uses, in the glossary's words.
- The door still mirrors several parts from the outliner; the map of what's shared, server-side and duplicated,
  with the copies that already disagree, is the note "Note logic: shared, server-side and duplicated" under the
  latest push-review round. Converge them; never add another copy.

## Every UI change is an action

- Every action works by mouse, by keys and through `act`. Define it as an action in an `ActionSet`
  (`packages/door/src/surface/actions.ts`); the key binding and the click call the same action. The parity tests
  (`test/parity-*.test.ts`) catch one that isn't.
- An agent's action never takes the person's focus, selection or keys, and it is always attributed
  (`author: agent` with its actor id, and said on screen).
- Snapshots that changed are looked at. Interaction changes get a real-pane pass (the recipe is in the ep0ch-core
  skill).

## Demo it in the kitchen sink

Each reuse-map row gets a showcase section (the door README names the few still without one), and a user-visible
feature gets a showcase section or note in the same PR, live where possible (`ep0ch --showcase`;
`packages/door/src/showcase/`). The demo is also its end-to-end test: a new section's test in
`packages/door/test/showcase/` opens it on the seeded outline, drives it through `act` and checks the result,
so a feature can't quietly break its own demo. If it can't be shown there, the PR says why.

## Capture, tested as a person works

The comment box, the note editor and every other place a person types share one editor (mouse select, delete,
undo, paste, edit after save), not a second, weaker one. The test for capture is the human workflow, not parser
units: write a comment, select and delete a phrase with the mouse, insert a reference, make a syntax mistake, fix it
(or don't), save, and nothing is lost.

## Test doors and their state

The root `AGENTS.md` ("Never touch a real outline or a real door") has the rules; these are the door's details.

- `scripts/agent-env <name>` runs through `packages/door/scripts/test-door-env.sh`, which also runs the drawer on
  `EP0CH_DAILY_AGENT=sh` and the door with `EP0CH_DAEMON=0`. It is the same for every command you run under the same
  name; `--print` shows the settings. End a session you tested with
  `scripts/agent-env <name> -- ep0ch session end --all --yes`.
- `EP0CH_CONTROL` moves the control socket; `EP0CH_STATE` moves everything else the door writes (layouts,
  drafts, marks, `lastcall.json`, snaps, `ctrl+e` files, the media cache, the sessions and the default socket). Set
  both. Sessions are one per outline, each in its own folder of the state dir
  (`sessions/<local or ssh-name>/<name>/`, `packages/door/src/session/place.ts`): its session files, control socket,
  saved desk, river and board layouts and last call. Two doors on one outline (and one `EP0CH_STATE`) share marks,
  but the desk layout is whichever saves last; the second is warned.
- The door's `Scratch` and `ScratchHost` (`packages/door/test/scratch.ts`) find `../outliner` by themselves.
- The mod reads `ep0ch`'s output: `test/claude-mod-contract.test.ts` runs the real CLI through the mod's own readers,
  so a CLI change that breaks the mod fails there.
