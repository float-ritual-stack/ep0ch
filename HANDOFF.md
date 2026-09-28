# Handoff: working on ep0ch-door

For the next Claude picking this up, on float-box or anywhere else. Read this, then README.md.
The laptop Claude that built this with Evan in one session wrote it on 2026-09-27.

## What this is

ep0ch-door is a terminal client for Pi Outliner (pi-herdr-outliner) outlines. It draws everything in terminal character cells, talks straight to the
service's Unix socket, and owns its whole terminal canvas:

- boards over saved views, drawers and floating panes
- a Quay-style river
- a document renderer: callouts, tables, images through Kitty, mdxcn figures, and live figures that query the outline
- the ep0ch BBS door that started it

It is **not** part of the outliner repo, on purpose.

## Why it exists (read this before planning anything)

- **Evan's decision on 2026-09-27: Herdr is one host, not the application's layout manager.**
  - Building the app out of Herdr panes and tabs went "pretty damn far", but it now adds complexity.
  - About 17k lines of recent outliner PRs went into pane routing, focus and handing previews between panes.
  - The canonical record is in the pi-outliner workspace under Architecture decisions: `((845e722d-76da-4b8b-8a84-901f59ecc2cb))`. The review is beneath it: `((46ba739c-4929-40ff-97a9-7db98a34797c))`.
- **The service is the platform.** The outliner's native TUI feels "like a pgsql client for the database". This door is meant to be the app that uses the data.
- **Don't default to the smallest possible increment.**
  - Evan has validated these ideas for months: web prototypes, Quay, floatty, PR 200. Shrinking the scope only re-validates the boring part he has already proven.
  - This whole repo was built in one day, at the scale of the idea.
  - What earns trust is **verifying specific claims**: parity checks (34/34 saved views identical to the outliner's own evaluator), snapshots of the real screen, and tests that flip real state.
  - Build the thing, then prove it. Ask Evan when the *shape* is unclear, not for permission to be ambitious.
- **Evan's style:**
  - Put the conclusion first. Use short lines and bullets, not walls of prose.
  - He is AuADHD, so readability is an accessibility need, not a preference.

## Boundaries

1. **The service owns truth and meaning. Clients own presentation and layout.**
   - Where the door re-derives meaning today, that is a stopgap: saved views in `src/views.ts`, document structure in `src/doc.ts`.
   - The backend asks that would replace them: `views.read`, a change feed, `document.read`, `views.createChild`.
2. **Writes go through revision checks and record who made them:**
   - `update` takes the block's `expectedRevision` and `mutation: { author: "agent", actorId: "<you>" }`. Agent writes need an `actorId`.
   - `properties.patch` for metadata.
   - `checklist.update` for checklist steps.
   - `annotations.batch` or `annotations.reply` take a `requestId`, so a retry can't create a duplicate.
   - `create` has no such protection, so read before you retry it.
3. **Never write test data into a real outline** (float-hub, or the pi-outliner `test` workspace).
   - Use a scratch workspace with its own service.
   - Turn its background agents off: `OUTLINER_INBOX_AGENT=0 OUTLINER_NOTE_ASSISTANCE=0`.
   - The pi-outliner skill and the outliner's CONTRIBUTING ("Connecting to the running service") explain how to start one.
4. **Register only as an `observer`.** Don't call `selection.set`, `browsing-context.publish` or `ui.command.send` unless a feature explicitly needs them.

## Backend work (pi-herdr-outliner), authorized by Evan on 2026-09-27

- You may change the outliner service itself, and manage its work in the pi-outliner outline
  (your default workspace on float-box, `/home/evan/test`, PIE-NNN).
- **Follow that outline's conventions.** Read its agent documentation guide and "How this workboard works" first.
  Allocate tickets with the roadmap allocator; never hand-write Work IDs.
- **Real work records belong there. Test data never does.** Door write tests still run against a scratch service.
- **Best first candidates** (each one deletes client-side ports in the door):
  - `views.read`, together with a richer query language (OR, NOT, date ranges). Evan has asked for the query language repeatedly.
  - a change feed: parent, revision and actor on each event, plus `changes.since(sequence)`.
  - batch get with field projection.
  - Context: the review `((46ba739c-4929-40ff-97a9-7db98a34797c))`.
- **Shared runtime:** Evan, 2026-09-27, while stepping away: on float-box you may close, restart and redeploy
  services and panes as needed; it won't disrupt him. Don't change the laptop. For merges, follow the pi-outliner
  workboard's review and merge contract.
- **Astra (codex, pane `wF:pC`) works the same repo and outline.** Its goal is paused.
  Check open PIE items and branches before claiming work, so the two of you don't collide.

## Running it

    bun install
    bun test && bun run check
    bun src/main.ts --ws <workspace root> --board    # or --desk, --river, or no flag for the BBS door

- **Socket:** `--ws` derives it as `~/.local/state/pi-herdr-outliner/<sha256(root)[0:12]>/outliner.sock`. If `OUTLINER_STATE_DIR` is set, it replaces the base directory: `$OUTLINER_STATE_DIR/<sha256(root)[0:12]>/outliner.sock`.
- **pi-outliner outline:** on float-box it is `--ws /home/evan/test`, local and fast there.
- **Art packs:** read from `EP0CH_PACKS` (default `/opt/float/bbs/inbox/evan`). Without them the art screens and the tests that need them are skipped.

## Verifying

- **Snapshots:** `bun scripts/snap.ts <scenario>` drives the real door against a live outline and writes PNGs to `out/`.
  - Scenarios: `board`, `board2`, `board3`, `desk`, `river`, `doc`, `live`, `float`.
  - `EP0CH_SOCKET=<sock>` picks the outline. The harness keeps its own state in `out/state`.
- **A running door** answers `bun src/main.ts peek | snap [png] | open <block-id>`.
  - `snap` is exactly what the terminal was sent, because `src/mirror.ts` sees every byte.
- **In Herdr:** `herdr pane read <pane> --source visible` shows the door's text.

## Map

- `src/socket.ts`: the protocol client (reads, `index`, `query`, `backlinks`, `comments`, `activity`).
- `src/views.ts`: saved-view evaluation ported from the outliner.
- `src/desk/delivery.ts`: the board.
- `src/desk/desk.ts`: the tiled desk.
- `src/river/river.ts`: the river.
- `src/desk/panes.ts`: reader, tree, thread and other panes.
- `src/doc.ts`: the document renderer.
- `src/graphs.ts`: mdxcn figures.
- `src/live.ts`: live figures.
- `src/media.ts`: `img::` and `video::` media.
- `src/kitty.ts`: image placements. Placement ids must stay unique for the whole session; a test covers this.
- `src/mirror.ts`: the terminal mirror.
- `src/control.ts`: `peek`, `snap` and `open`.

## Work that's ready

Tickets EPD-001 to EPD-012 live in the laptop's ep0ch-door outline (`--ws ~/projects/ep0ch-door`).
That outline is offline whenever the laptop is. Treat this list as the brief and record progress in PRs.
The laptop Claude updates the EPD stages when it's back.

1. **EPD-001: edit notes from any reader.**
   - `e` edits in place; `Ctrl+E` hands off to `$EDITOR`.
   - Save with `update` + `expectedRevision`. A stale draft is refused with a clear message, never overwritten.
   - Done when a test changes text through a scratch outline and a conflicting write is refused.
2. **EPD-002: move cards between board lanes.**
   - Moving a card patches the property its target lane's query matches (for example `work-stage::` or `outbox::`) with `properties.patch`.
   - For queries with more than one clause, patch only the values that differ. Refuse lanes that can't be satisfied.
3. **EPD-004: comment and reply from readers.**
   - `annotations.batch` block-comment with a quoted passage from the reader selection.
   - Reply and resolve too, always with a `requestId`.
4. **EPD-003: checklist toggles.**
   - Toggle steps with `checklist.update`.
   - Add a live figure over `checklist.query`.
5. **EPD-008: keep Enter's destination stable.**
   - Focusing another detail must not change which one Enter opens into.

Work on one branch per ticket and open a **draft PR**. Don't merge to main. In the PR, say what you verified, with snapshots attached or described.

## Talking to the laptop side

- **Questions:** comment on your draft PR or open an issue on the repo. The laptop Claude and Evan read those.
- **Herdr:** when the laptop is reachable you can also message its session through Herdr, if a machine profile for it exists.
- **Budget:** not a constraint right now (Evan, 2026-09-27: half the week left, a reset on Tuesday, and a spare reset before then).
  - Use subagents where they genuinely help, for example parallel tickets or independent verification.
  - Spend effort on verification, not on rationing.
