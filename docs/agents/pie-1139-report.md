# PIE-1139 implementation and verification

> [!success] Implemented and verified on pie-1139
> List selection previews its children through the existing embed renderer without writing an anchor.
> > [!abstract]+ Why
> > - Five calls should stay in place while their details change beside them.
> > [!tip]+ Reuses
> > - Fold spans, reader elements, embedRegion, attached placements, Inspector/DraftSession and draft.patch.
> > [!note]+ New
> > - Glue selects a span, hides its children, places the existing drawing and patches those source lines.
> > [!warning]+ Not
> > - No PR, merge, deployment or owner acceptance is claimed.

The addressing ruling is implemented literally: the selected fold point supplies the note's source lines, excluding its own line. Reading neither resolves nor creates an anchor. Cross-note `!((note^target))` keeps its existing authored-anchor path. Saving children uses the existing optimistic patch path and undo history.

Callout metadata `> [!type|preview]` and a plain list's preceding `[children::preview]` enable previews. `list.preview`, alt+F, the reader menu and the fold row's `p` chip change reader state. j/k or a click selects; Enter or a second click unfolds in place. Overrides survive back/forward and saved reader navigation. Placement uses the shared menu and attachment geometry: beside when wide, twelve fixed rows below when narrow, inline, floating, popup or a paired tile. A select wire lends the same source surface to the existing preview tile, including input and draft ownership.

## Parts it uses

Paths below are relative to the repository root. The earlier branch commit supplies the approved fold-scan and callout-grammar extensions.

| Need | Shared part and implementation location |
| --- | --- |
| Find the item's children | `packages/door/src/doc.ts:306`, foldPoints; `packages/door/src/surface/note.ts:4400`, readable-source lines map them to the original note |
| Address within this note | The selected fold span at `packages/door/src/surface/note.ts:1266`; no ensureFragment call |
| Draw those lines | `packages/door/src/embeds.ts:207`, embedRegion's span input and the reader's existing bodyHooks |
| Select and unfold | Reader elements and existing fold actions in `packages/door/src/surface/note.ts:4455` and the list.preview action at `packages/door/src/surface/note.ts:10741` |
| Place the drawing | `packages/door/src/surface/attached.ts:78`, attachedRect; `packages/door/src/desk/attached-tile.ts:14`, AttachedTilePane; the existing paired layout |
| Follow a select wire | `packages/door/src/desk/desk.ts:1002`, selectionSource; `packages/door/src/desk/preview.ts:37`, PreviewPane hosts the source surface |
| Edit the children | `packages/door/src/surface/note.ts:1293`, Inspector's DraftSession over patchSource/draft.patch; existing optimistic patch and undo |
| Author the mode | `packages/outline-core/src/callouts.ts:165`, existing callout metadata; plain-list properties use outline-core's propertyTokensInLine |
| Demonstrate and protect it | `packages/door/src/showcase/seed/list-folds.ts:3`, five fictional calls without anchors; `packages/door/test/showcase/sections.test.ts:272`, the real-host showcase workflows |
| New (glue only) | Reader preview state and a span passed to the existing embed hook; attachment/tile/action adapters and no second renderer, editor, anchor or transclusion implementation |

## Evidence

- Initial red: `../../scripts/agent-env pie1139 --test -- timeout 900 bun test test/showcase/sections.test.ts -t 'list preview'` in packages/door exited **1** because all calls' children were drawn. The first command had an incorrect relative script path and exited 127; the corrected invocation produced the intended red.
- Focused regressions: `../../scripts/agent-env pie1139 --test -- timeout 900 bun test test/action-pages.test.ts test/showcase/sections.test.ts test/folds.test.ts test/history.test.ts test/terminal-output.test.ts` exited **0**, 80 tests. The new workflows check stationary rows, keys/mouse/second click, unchanged read revision/text, plain-list scope, real-key span edits, a child task's existing picker, navigation state, all placements, tile side controls and wired editing.
- Final mouse regressions each first exited **1**: clicking Save did not save, then dragging blank editor space onto Save saved. Routing the existing Inspector button hits and checking the existing gesture's click result repairs both.
- `bun run check` exited **0** across the workspaces.
- After the final rebase onto `bc565d83`, the same focused command passed **80 tests**, exit **0**; `bun run check` and the architecture-map check also exited **0** again. The same box command on checkout `7d6f8fb6` (runtime `23b06e08`) exited **0** in 27m50s: door **3,200 pass, 2 skip, 0 fail**, outline-core **376 pass, 0 fail**, outliner **2,852 pass, 2 skip, 0 fail**. All package type checks passed again; the same four checks were skipped.
- `nice -n 15 scripts/box-test --replace door outline-core outliner` on runtime commit `729fe1e2` exited **0** in 32m4s: door **3,197 pass, 2 skip, 0 fail**; outline-core **376 pass, 0 fail**; outliner **2,851 pass, 2 skip, 0 fail**. All three package type checks passed. The skipped door checks are the 2,600-child scroll-budget test and the systemd scope/cap test; the explicit resize-budget runs below passed. Outliner's two skipped checks need a real-outline copy (schema-stamp and import preservation); neither was run against a person's outline.
- `bun scripts/architecture-map.ts --sync --check` exited **0**.
- Earlier box runs were deliberately replaced as the final interaction corrections landed and exited **143**. The first run exposed missing examples on two new actions; those were supplied and the focused action-pages checks pass. Invoking the architecture script from the repository root once exited **1** (module not found); the corrected door-package invocation above passes.
- Resize benchmark, baseline and changed tree, same float-box: `scripts/agent-env <private-name> --test -- nice -n 15 timeout 900 bun scripts/bench-resize.ts --runs 1 --check --json` exited **0** on both. All four configurations stayed within the image/upload/byte budgets. For cells at 120x40, baseline p50/p95 was 8.3/22.8 ms and changed was 11.9/25.9 ms; Kitty at 250x70 was 10.5/21.4 ms and 13.1/22.4 ms. The runs overlapped other checks; these are budget checks, not a clean latency comparison. Neither used --check-time.
- Scratch terminal: opened the showcase under agent-env; j/k changed the selected call, an injected SGR click selected the gate, Enter unfolded it, and resizing from 190x48 to 100x40 moved the preview below. Clicking the gate's child opened its shared Inspector; actual terminal paste and Ctrl+S saved only those child lines. Captured and visually inspected wide, mouse-selection, narrow and edited PNGs. The wide and narrow frames showed the expected shared embed drawing and fixed preview room. Owned terminal sessions and benchmark checkout were ended and cleaned.
- Independent review identified session entry, tile gesture/side routing, wired ownership and child-control registration gaps. Those findings were repaired through the existing session, element, picker and attachment paths; focused workflows exercise them.

## Delivery and remaining limits

The required checks passed before and after the final rebase. Main advanced during the first run to `bc565d83` (PIE-1141); the clean rebase produced runtime commit `23b06e08`, verified in checkout `7d6f8fb6`. Only this report changed after that final run. PROTOCOL is 251 against main's 250 at the final rebase. Delivery is the pushed `pie-1139` branch, without a PR, merge or deploy. Saved reader navigation is version 3, so older saved reader navigation resets. The real glass note was not edited; all interaction writes used scratch fixtures. Daily-driver acceptance remains Evan's after a separately authorized deployment.
