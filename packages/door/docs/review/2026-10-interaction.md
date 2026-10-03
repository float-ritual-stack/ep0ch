# Whole-system review, lens C: interaction (keys, mouse, text)

Reviewer C, daily-driver brief. Repos read in place on float-2: `ep0ch-door` (main, c6887a0) and
`pi-herdr-outliner` (main). Runs were against a private scratch service seeded with the showcase
(`test/scratch.ts` + `src/showcase/seed.ts`), a door with its own `EP0CH_STATE`/`EP0CH_CONTROL` under a temp
directory, driven in a private tmux server with injected keys and SGR mouse (`ESC [ < b ; x ; y M/m`) and read
back with `peek`, `act view.get`, `act layout.get` and `tmux capture-pane`. Nothing touched a real outline or the
owner's door. Each finding says **read** or **ran**.

Citation aliases: `app` src/app.ts · `scr` src/screens.ts · `dsk` src/desk/desk.ts · `del` src/desk/delivery.ts ·
`riv` src/river/river.ts · `note` src/surface/note.ts · `pan` src/desk/panes.ts · `pp` src/surface/props-panel.ts ·
`cmt` src/comment.ts · `sel` src/surface/selection.ts · `act` src/surface/actions.ts · `term` src/term.ts ·
`pty` src/desk/pty.ts · `bl` src/desk/backlinks-pane.ts · `wel` src/hub/welcome.ts · `oa` pi-herdr-outliner/src/outliner-actions.ts ·
`dk` pi-herdr-outliner/src/detail-keymap.ts.

## Summary

1. The door is livable on the desk and the board: focus never shifts the layout (ran: a click on a tile leaves every
   rect unchanged, a click in a river column leaves the wide column and every cell where it was), the mouse reaches
   most reading actions, terminal tiles pass paste and a lone ESC through, and history works by keys, side buttons
   and backspace. The reader's keys are consistent because they come from one surface.
2. Everything above the reader is not one grammar. Keys are matched in place at ~620 sites across 21 files
   (`del` 132, `dsk` 78, `riv` 70, `note` 69, `scr` 67); `ActionDef.keys` is a display string, never a binding;
   the board and the river mutate state from their key handlers without the registry; the BBS shell (menu and ten
   screens) has no actions at all, so an agent on the menu can do nothing and `open` is refused.
3. **Top problem: Esc logs you off.** Esc leaves a reader, then the lanes, then the screen, and on the main menu
   Esc is Goodbye, which quits the door 1.6 s later with no question unless something is running (ran). Any BBS
   habit of "Esc until it stops" ends the session.
4. **Second: the same key means four things and the hints don't say.** `q` is back on eight screens, nothing on
   the board's lanes, and a "quote isn't here" flash on the river; `s p w t x o c` each do two to four things by
   screen; hint rows are hand-written strings that omit or misname keys, overflow 200 columns, and on the desk hide
   the reader's own hint (`[ ] 2/9 · link … · ⏎ follow` is drawn nowhere on the desk, ran).
5. **Third: no keymap, no `?`, no right button.** The outliner has a per-action, per-scope, collision-checked,
   reloadable `keybindings.json`; the door has none and no way to list a screen's keys but reading source or `actions`
   over the socket. The right mouse button is the left button everywhere (`term:127` keeps `button`, no consumer
   reads it), so there is no context menu and the README's "(or right-click)" is an accident.

## Recognised systems

| We have effectively built a … | but treat it as … | Ladder | Evidence |
|---|---|---|---|
| **command bus** (`ActionSet.run` with typed args, actor, refusal, provenance) | key handlers: the desk routes every key through `cmd()` → `TILE_ACTIONS`/`PANE_ACTIONS` (`dsk:829-871`, `883-937`); the board and river call methods or mutate fields directly (`del:2218-2293`, `riv:1144-1176`); the BBS screens have none | **recognised** on the desk, **accidental** elsewhere. Two more users of the desk's shape (board, river) before "shared" | read + ran (`actions` on Stats: "no actions yet") |
| **key dispatcher** (chord → scope → action) | 620 in-place `c === "x"` comparisons and 12 copies of the `ch(k)` helper (`cmt:14`, `pan:73`, `wel:108`, `bl:62`, waiting.ts:61, inline in `dsk:812`, `del:2155`, `riv:1106`, `scr:524`, showcase.ts:259, frame.ts:114, screen-tile.ts:74). The outliner already has the dispatcher (`oa:481-672`) and uses it for Tree and Detail | **accidental** in the door; **shared** in the outliner (Tree + Detail + `?` menu + key inspector) | read |
| **modal input-state machine** (^W prefix, add/move/tab sub-prefixes, `alt+l` link mode, search overlay, layout picker, mover, composer, steps overlay, backlink filter, step choice, `entered`, "in a pty", drag, ctrl+] chord) | booleans and nullable fields per screen, each with its own priority order in `keyIn` (`dsk:784-871`, `del:2149-2258`, `riv:1102-1182`, `note:1133-1200`) | **accidental** | read |
| **hit-testing layer** (what the mouse is over → a key or an action) | ten private ones: `Pointer` spots (`scr:56-94`), desk `hits/heads/handles/markHits` (`dsk:1493-1588`), board `rects/laneRects/readerSpines/laneEdges/bl:*` (`del:2344-2460`), river `hits/colRects` (`riv:1215-1300`), surface `hits` (`note:1702-1750`), panel `at` (`pp:92`), backlinks `controls` (`bl:271-282`), welcome `tabs` (`wel:528-537`), showcase index maths (showcase.ts:270-290), tile drop zones (`src/desk/drop.ts`) | **accidental** (the surface's and the desk's are the two best; `Pointer` is the cleanest idea: a spot *sends a key*, so click and key are one path) | read + ran |
| **hint-row / help system** | a string per screen and per mode, 14 composers (`dsk:718-747`, `del:2094-2140`, `riv:593-601`, `riv:625-648` help modal, `scr` hotLine per screen, `note:402-421`, `pp:127`, `cmt:232`, editor.ts:48, `wel:524`, showcase.ts:250, pane `hint()`s) | **accidental**; the river's `?` modal is the only help screen | read + ran |
| **keymap config** | absent in the door; `OutlinerActionKeymap` (`oa:481`) is the outliner's: JSON id → chords, scopes, collision validation, atomic `Ctrl+R` reload, `?` menu, key inspector | **shared** (outliner), **missing** (door) | read |

## Findings

### Converge now

### F1  Esc on the main menu is Goodbye: the door quits without asking
- where: `scr:302` (`esc` → `ctx.push(new Goodbye())`), `scr:943` (`Goodbye.enter` asks only when `confirmQuit` refuses: programs running or unsaved text), `app:158-164` (`pop`), the Esc chains that end on the menu: board `del:2239-2248`, desk `dsk:865-869`, river `riv:1176`, every BBS list `scr:35`.
- evidence: **ran**. On the board with a detail focused: Esc → lanes, Esc → menu, Esc → `logoff`; the door exited 1.6 s later. My next keystrokes went to the shell.
- impact: one extra Esc, a habit on every other screen, ends the session over ssh; nothing warns; the desk's background programs are asked about, a plain door is not.
- fix: Esc on the menu does nothing (or selects nothing), Goodbye stays on `G`/`Q`; or `Goodbye.enter` asks once when reached by Esc. Add the case to `test/bbs-mouse.test.ts`'s key section.

### F2  `q` means back, nothing, or a flash about quoting, by screen
- where: back: `scr:35` (`isBack`, every BBS list), `scr:526` (message reader), `dsk:864` (desk), showcase.ts:262, `wel` (the desk's). Nothing: the board's lanes (`del:2260-2293` has no `q`; `q` only closes the mover `del:1256` and the steps overlay `del:1505`). Flash: `riv:1174` ("quote (a new note quoting this one) isn't in the door yet"). Closes the panel: `pp:121`.
- evidence: **ran** (board: `q` then `x` on the lanes, screen unchanged; river: `q` flashes).
- impact: leaving a screen needs a different key on each; the river's message is about a feature that doesn't exist yet and hides the way out (`esc`, which on the menu is F1).
- fix: `q` = back on every screen (the river's quote-to-be can take another key when it exists); one `shell.back` action bound in one place (F9/F10).

### F3  The BBS shell has no actions: an agent on the menu can't open, switch screens or read
- where: `app:300-320` (`actions()`/`act()` refuse: "this screen has no actions yet; open the board, the desk or the river first"), `app:291-299` (`openBlock` refused: "the main menu screen can't open blocks"), `scr` MainMenu/MessageList/Conferences/WhoOnline/LastCallers/FileAreas/ArtViewer/Stats/Help/Logon/Goodbye have no `actions`/`act`. Only `MessageReader` does (`scr:575-588`).
- evidence: **ran** (`actions` on the main menu answered with the Welcome screen's set only because the door had landed there; on Stats: "no actions yet"; `open <id>` on the menu: refused).
- impact: the daily agent (Herdr pane, `ep0ch act`) works only while Evan is on the desk/board/river; every `open` from the Outliner's `show` fails when he is on the menu or a list; the menu itself (the screen switcher) is keyboard/mouse-only.
- fix: a `SHELL_ACTIONS` set on `App`: `screen.open name=<menu key or title>`, `screen.back`, `screen.list`, `video.cycle`, run through `openItem` (`scr:316`) so key, click and `act` share the path; `App.act` falls back to it when the screen has none. Lists get `list.select n=`, `list.open`.

### F4  Board and river keys and mouse bypass the action registry
- where: board lane cursor/focus `del:2260-2293` (`h l j k`, `⏎`), Tab/click focus `del:2218-2223`, `del:2418`, `t T S b B o c x { } < >` → methods `del:2224-2245`, border drag → `dragBorder` on the tree `del:2447` (the desk's drag runs `layout.resize`, `dsk:1508`), float nudge `HJKL` `del:2233-2238`. River: `h l` focus, `w` shift, `j k`, `⏎` open, `space`, `s`, `p`, `x` all mutate in `riv:1144-1170`; `f` `#` `/` `?` modes have no actions (`riv:1171-1176`, `RIVER_ACTIONS riv:1303-1360`); a click sets `focus`/`shift` directly `riv:1236-1242`. The desk is the counter-example: every key and drag goes through `cmd()` (`dsk:829-871`, `1508`, `1525`, `1549`).
- evidence: **read**; **ran** that the board drag resizes (border row 20 → 24) and the river click focuses; neither is visible as an action in `subscribe` (the feed is the desk's, `app:203`).
- impact: the person's board/river moves leave no action trace, no provenance path, and cannot be replayed or bound (F10); `card.select`/`focus`/`widen` exist as actions but the keys don't call them, so the two code paths can drift (they already differ: key `⏎` → `this.open(m, dup)` `riv:1161`, action `open` → `openById` `riv:1312`).
- fix: the desk's pattern: a private `cmd(name, args, reader)` per screen that keys, clicks and `act` all call; add `river.filter text=`, `river.jump text=`, `river.tags`, `lane.focus`, `lane.select` as actions so the missing `·a` cells in UI-GRAMMAR §3 fill in.

### F5  The right mouse button is the left button, everywhere
- where: `term:124-129` (`button: b & 3` is decoded), no consumer reads `.button` except `pty:346` (forwarding to a program). Screens branch on `action` only: `scr:70-93`, `dsk:1493`, `del:2344`, `riv:1215`, `note:2193-2237`, `bl:271`.
- evidence: **ran** (a right-click on "Q back" in Who's Online went back; right-clicks on a card select and open it).
- impact: no context menu anywhere; README:797 "a click (or right-click) on a step's box" is true by accident; a future right-click meaning would silently change today's behaviour.
- fix: decide once: right button = "open fresh / beside" (today's ctrl-/alt-click, `dsk:1568`, `bl:280`) or a small action menu from `actions()` for the thing under the pointer (the outliner's `?` `menuItems` shape, `oa:571`). Either way one rule in one place, and a test with `button: 2` (none exists: `grep "button: 2" test/` is empty).

### F6  Hint rows are hand-written and disagree with the keys
- where and what (each **read**, the desk/board/river rows also **ran**):
  - Logon `scr:183` says "press ENTER to log on"; any printable key logs on (`scr:196`).
  - Help `scr:936`: `[C] Welcome  Claude · now: the [[claude-now]] page, pinned and live` (C is the Welcome screen); `R … the 200 most recently changed blocks` (it reads 40 then 400, `scr:351-355`); the `V` and `?` entries in `HELP` are never drawn (`scr:911` iterates `ITEMS`).
  - Desk hint `dsk:745`: omits `alt+n alt+p` (tabs), `alt+m alt+x` (marks), `ctrl+e`, `V`, `esc` (unzoom / shut a drawer / menu), `⏎`/`e` into a terminal. `^W` and `^W o` hints are complete.
  - Desk: while a reader has an element current, the surface's hint (`note:412-416`) is not drawn: `dsk:730` shows it only when `rd.holdsKeys`; the tile's bottom border is plain (**ran**). README:1016 "The reader's footer names the current one" is true on the board and the BBS reader only. The hint row's trailing title is the desk's `current`, not the focused reader's note (ran: "Bike shed" while the reader showed "Allotment notebook").
  - Board lanes hint `del:2126`: ~230 cells; cut at 200 columns after `b backlin…` (**ran**); on an 80-column tether `s d i C c alt+c t b o tab` are invisible. It omits `g`? no; omits `r` (reload), `S` (drawer side), `V`, `{ } < >`, `u` (restore, shown only after a trash), `esc`. Reader-focused hint omits `{ }` meaning, `alt+c`, `o` on a preview.
  - River hint `riv:601` omits `x s p f # C e m i v y Y ? alt+←/→`; the `?` modal `riv:625-648` omits `i` (properties, `riv:1128`), `v y Y` (selection, `riv:560-591`), `alt+←/→ backspace` and side buttons (`riv:1139`), `V`, `PgUp/PgDn/Home/End`, `esc` (menu), `q`/`c` (flashes). Hint says "esc menu"; `q` does not.
  - Message reader hint `scr:515`: `n next · p prev · t thread` (also `N P T → ← ⏎ U`, fine) but omits `esc` back.
  - ArtViewer `scr:843`: `v video` (lowercase) while every other screen uses `V`, and `v` in a reader starts selection.
  - Props panel `pp:129`: complete. Comment session `cmt:232-236`: complete. Edit `editor.ts:48-51`: complete.
  - Welcome `wel:524`: complete for its own keys; the desk's `^W` layer works there too but isn't said.
- impact: on a phone the hint row is the only help, and it is wrong or cut where it matters.
- fix: hints derived from bindings (F10): each screen declares its actions with chords and scopes; the hint row is `helpText(scopes)` and `?` is `menuItems(scopes)` on every screen (the outliner's `oa:560-583`), wrapped to the width instead of cut.

### F7  Nothing works on hover (an empty result)
- where: `term:53` requests button-event tracking (`?1002h`), not any-motion (`1003`); drags carry the pointer.
- evidence: read. Drop zones (`dsk:1512`), border follow (`dsk:1508`) and the board's card drag (`del:2455`) happen with a button down only.
- impact: none; hover-only affordances don't exist, so nothing is hidden from keyboards or phones.
- fix: none. Keep 1002.

### Small extraction

### F8  One hit map instead of ten
- where: the ten listed under "Recognised systems". `Pointer` (`scr:56-94`) is the right shape: a spot records `{y, x0, x1, key | index}` and a click *sends the key back through `key()`*, so click and key are one path by construction. The surface's `hits` (`note:1702-1750`) is the same idea keyed by element. The others store rects and branch.
- evidence: read.
- impact: every new screen writes its own pointer maths; right-click, hover or touch semantics would have to be added ten times (F5).
- fix: lift `Pointer` into `src/surface/hits.ts` (spots that send a key or run an action by name), used by the desk's header/handles/marks, the board's lanes/spines/drawers/controls, the river's hits/headers, the panel rows, the backlinks controls, the welcome band. Keep `drop.ts` (zones are geometry, not spots).

### F9  Keys are matched in place; `ActionDef.keys` is a caption
- where: `act:12-20` (`keys?: string`, free text), the counts above (`grep` of `c === "…"`, `ch(k) === "…"`, `k.kind === "…"` per file: `del` 132, `dsk` 78, `riv` 70, `note` 69, `scr` 67, `pan` 32, `pp` 26, `cmt` 26, showcase 22, `bl` 17, `sel` 16, `wel` 14, completer 12, `pty` 7, frame 6, waiting 6, edit 6, brief 4). 97 `ActionDef`s carry a `keys:` caption (`note` 37, tile-actions 19, `del` 13, `riv` 8, pane-actions 6, others 14); the caption is what `actions` prints and nothing else.
- evidence: read.
- impact: a key change is a grep across 21 files (the memory note "key clash audit" exists because the code can't do it); the caption can drift from the handler with no test noticing (e.g. `pane.split` says "board alt+⏎" but the board's `alt+⏎` never runs `pane.split`: `del:2257` → `openDetail`).
- fix: `keys` becomes structured bindings resolved by one dispatcher (F10). The captions become derived.

### F10  No keymap in the door; one shape for both repos
- where: door: no config file, no chord grammar, no scopes (nothing under `src/` reads a keybindings file). Outliner: `oa:463-468` (`$XDG_CONFIG_HOME/pi-herdr-outliner/keybindings.json` or `OUTLINER_KEYBINDINGS_PATH`), `oa:481-672` (`OutlinerActionKeymap`: `validate` rejects unknown ids, duplicate chords, active-scope collisions and an unbound cancel; `resolve(surface, scopes, str, key)` ranks by scope and *suppresses* a default chord an action owns so it never falls through; atomic `reload`; `helpText`, `menuItems`), `dk:61-100` (`detailActionScopes`: the mode stack), README.md:755-770 (the file format).
- evidence: read.
- impact: Evan cannot move `w` off "widen" or `C` onto `c` (Detail's comment key) in the door while he can in Detail; the desk's `^W` layer, the board's `x` and the river's `x` cannot be reconciled by config; the collision check that would have caught F2/F12 runs only in the outliner.
- fix, the proposed shape (shared with `detail-keymap.ts`):
  - **File:** the same grammar and loader. Either one file, `~/.config/pi-herdr-outliner/keybindings.json`, with door ids under their own prefixes (`door.shell.back`, `door.pane.close`, `note.edit`…), or a sibling `~/.config/ep0ch-door/keybindings.json` read by the same code. Chord grammar is `oa:363-380` (`Ctrl+W`, `Alt+Enter`, `Shift+C`, `Esc`, `Space`…); the door adds **sequences** for its prefix layer, space-separated: `"pane.close": ["Ctrl+W x"]`, `"layout.move.edge": ["Ctrl+W Shift+H"]`. An empty array unbinds (this is how F1 becomes `"shell.logoff": ["g"]`).
  - **Code:** `ActionDef` gains `defaultChords: string[]` and `scopes: string[]` (the door's scopes: `menu`, `list`, `reading`, `element`, `edit`, `comment.select`, `comment.compose`, `threads`, `props`, `props.field`, `picker`, `selection`, `lanes`, `backlinks`, `backlinks.filter`, `mover`, `composer`, `steps`, `desk`, `desk.prefix`, `desk.add`, `desk.move`, `terminal`, `river`, `river.filter`, `river.jump`, `river.tags`, `search`, `layout.picker`, `linking`, `drag`). `ActionSet.resolve(key, scopes)` returns `{actionId | null, suppressed}` exactly as `oa:517-540`; a screen's `key()` becomes: compute scopes (its `keyIn` priority order, as `detailActionScopes` does), resolve, `run`. Import the ~120 lines of chord normalisation and resolution from the outliner (the door already mirrors outliner rules with parity tests: `literal.ts`, `inline.ts`, `query.ts`), or publish them from the outliner as a tiny module.
  - **Startup check:** `validate` across every scope pair that can be active together is the "key clash audit" as code; run it in `bun run check` and as a test.
  - **Help:** `?` on every screen = `menuItems(scopes)`; the hint row = `helpText(scopes)` truncated by priority, not by column.
  - **Agents:** `actions` lists the effective bindings (they already list captions); `act` is unchanged.

### F11  Same action, different keys by screen (the pane operations)
- where: close: board `x` (`del:2231`), desk `^W x` (`dsk:903`), river `x` (`riv:1166`). Open beside: board `alt+⏎` (`del:2257`), desk `^W o <kind>` (`dsk:905`), river `⏎`/`alt+⏎` (`riv:1161`). Focus: board `Tab`/click (`del:2218`), desk `Tab 1-9 ^W hjkl` click (`dsk:836-840`), river `h l tab` click (`riv:1144-1160`). Squeeze/collapse: board `c` (`del:2226`), river automatic + `w`/`p`, desk none. Resize: board `{ } < >`, desk `^W < > + -`. Comment: door `C`, Detail `c` (`oa` detail.comment.begin). Video: `V` everywhere, `v` in ArtViewer (`scr:857`). Up: `u` everywhere, `U` in the BBS reader too. Reload: board `r` lanes, who/activity panes `r`, Detail `Ctrl+R` = keymap reload.
- evidence: read (UI-GRAMMAR §3/F4 names most; the ArtViewer `v`, the river `⏎`-as-open and Detail's `c` are new here).
- impact: the daily driver: `x` closes on the board and the river but on the desk `x` alone does nothing; `⏎` opens beside in the river and into the detail on the board.
- fix: one pane-operation layer (the desk's `^W` is complete; the board and river take the same chords for close/open beside/resize/zoom, and keep their un-prefixed single letters as aliases while F10 lets Evan drop them).

### F12  Same key, different things by screen (full clash table)
- where: the Tables section below has every screen; the clashes: `c C s p w t x o m f n q v [ ] space ⏎ alt+⏎ tab 1-9 / ? r h l H J K L`.
- evidence: read; `q`, `c`, `v`, `Esc` **ran**.
- impact: with the same finger memory, `s` shows steps (lanes), splits a column (river), swaps a tile (`^W s`), sorts backlinks (drawer/tile), toggles a summary key (panel); `w` widens a column, sets a backlink stage, marks a step waiting, saves a layout (`^W w`); `p` holds a reader, docks a column, reads the previous message, pins a tile (`^W p`); `n` is a new card, the next message, "this note" in backlinks; `t` is the outline drawer, a thread, into-tabs (`^W t`).
- fix: F10 makes them visible and rebindable; the clash audit as a check; single-letter mode keys in scoped modes are fine when the mode is shown (the step choice, the mover) and wrong when the mode is invisible (`w` on the river vs `w` in the backlinks drawer, both "reading").

### Extension blocker

### F13  No screen can add a key or a mouse spot without editing its `keyIn`
- where: every `keyIn` is a linear `if` chain with a hand-ordered priority (`dsk:784-871`: search, picker, pty, chord, screen tile, drag, linking, pending, choosing, holdsKeys, mouse, prefix, alt, tab, pty enter, sessionStart, pane.key, chars, esc); the board's and river's are similar and different. `ScreenTile.key` (`src/desk/screen-tile.ts:72-80`) and `FramedScreen.key` (`src/showcase/frame.ts:112-122`) then re-filter `1-9 V / q esc` by hand.
- evidence: read.
- impact: a tile kind from an extension (A's question) could register actions but not keys, mouse spots or a hint; the outliner's extension manifests (`extensions/*/manifest.json`) have no bindings either.
- fix: F8 + F10: a tile kind declares `actions` with chords and scopes and gets a hit map; the desk dispatches by scope instead of by `instanceof` (`dsk:807, 815, 848, 858`).

### Portability (my lens only)

### F14  OSC 52 copy and the mouse's side buttons depend on the path to the phone
- where: `app:236` (`copy` writes `osc52`), `sel` `osc52`; `term:124-126` (buttons 8/9 as `back`/`forward`).
- evidence: read; side buttons **ran** through tmux (tmux passes SGR 128/129 through `send-keys -l`; a real tmux client may not forward buttons 8/9, and OSC 52 needs `set-clipboard on`). Not verifiable on a phone from here.
- impact: over ssh + tmux on a tether the two mouse extras may silently not arrive; `y` then says "copied N chars" whether or not the clipboard took it.
- fix: nothing in the door; document the tmux settings in the README's selection paragraph (README:374 still says to use the terminal's selection modifier, which PIE-419 made unnecessary in readers).

### F15  Terminal-tile key passthrough is right; two edges
- where: `term:131-150` (`feedRaw`: raw bytes to the program except mouse reports and `0x1d`), `dsk:790-801` (ctrl+] chord, 1.5 s), `pty:312-340` (`keyBytes` for keys arriving as `Key`s when the person is *not* in the tile), `dsk:858` excludes `PtyPane` from `pane.key`.
- evidence: **ran**: in a shell tile `cat -v` showed a bracketed paste as `ab` (markers consumed by bash's paste mode, so they arrived) and a lone ESC as `^[` at once; `tile.type` refused while in it, attributed ("an agent (loki) typed into pty") when not; `^W x` asked twice.
- impact: fine daily. Edges: `alt+<letter>` typed while *not* in the tile is the desk's (`dsk:831-836`), so `alt+l` cannot reach a program until you `⏎` into it (correct, but not said); a tile is named by kind (`pty`), so `EP0CH_TILE` and `reader=` are `pty`, `pty2`…, while README:359 calls it "the program's name in the layout" and `tile.type reader=shell` fails (**ran**).
- fix: name terminal tiles by program (`shell`, `nvim`, `claude`) as the daily layout does; one sentence in the README.

### Consistency

### F16  Word collisions still in code
- where: `region` `del:45` (type `Region`), outliner `PreviewRegion`; `preview`: `PreviewPane` (desk tile, src/desk/preview.ts:33), board `preview` region and its `previewLink` (`del:2299`), desk `/` search's right half (`dsk:1652`); `detail`: `DetailPane` (tiles.ts:69), `WelcomeDetail`, board `openDetail`, all meaning the outliner's *Current*; `pin`: `tile.pin` (desk drawer↔layout), `pane.pin` (board drawers), river action `pin` whose summary says "dock" (`riv:1342-1344`), `p` "hold" on the desk reader (`pan:245`, resolved to *hold*); `focus`: the keys (`tile.focus`, `focus`) and `focus.set`/`focus.clear` still exported as "older names" of the tint (`note:3098-3099`); `open`: three `ActionSet`s define `open` with different args and meanings (desk `dsk:1676`, board `del:2559`, river `riv:1308`), so `actions` on a board tile inside the desk lists two `open`s; `reader`: resolved (`MessageReader`); `spine`: one part (src/spine.ts).
- evidence: read.
- impact: a person reading `actions` or the README meets "pin" for four things and "open" for three; an agent writing `act open` gets a different contract per screen.
- fix: rename the river's `pin` to `dock` (keep `pin` as alias one release); `open` → `desk.open`, `board.open`, `river.open` with one shared arg shape (`id`, `reader`, `fresh`); drop `focus.set`/`focus.clear` names after a deprecation flash; `Region` → `Pane` id.

### F17  Refusal wording while offline
- where: `note:944` ("can't edit: the outline didn't say which revision this note is at"), `app:150` (`offline` known to the shell).
- evidence: **ran** (service stopped; `e` in a reader).
- impact: the first thing you see when the tether drops is a message about revisions.
- fix: hosts pass `offline` into the refusal: "offline · the edit will work when the outline is back".

### F18  Focus clicks never shift the layout (confirmed rule, with two documented exceptions)
- where: desk `dsk:1549-1552` (click → `tile.focus` only), drawers slide shut when the keys leave (`dsk:781`, `del:2418`), river `riv:1236-1242` (body click: focus; header or spine: `shift`), board spine click opens it (`del:2432-2440`).
- evidence: **ran**: desk rects identical before/after a click into another tile; river's top row identical after a body click and changed after a header click; board lane header identical after a focus click on another lane.
- impact: the standing rule holds. The drawer sliding shut on a focus click is a visual change, not a layout move, and matches the desk's rule.
- fix: none. Keep the two exceptions (header = act on the pane) and say them in the hints (river's does).

### LEAVE ALONE

- The note surface's reading keys (`note:1133-1200`) and their agent twins are one code path already; the `[ ]`/`( )`/`⏎`/`esc` priority is careful and tested (elements, folds, history, tasks, select tests). Don't touch while F10 lands; wrap them in scopes.
- The desk's `^W` layer and `cmd()` routing: it is the model for the rest; the `^W`+arrows aliases (`dsk:886`) are a good un-documented touch.
- The escape-chord design for terminal tiles (`ctrl+]`, twice sends it, 1.5 s): right for telnet-era fingers, and the raw sink keeps F-keys and pastes intact.
- The river's "focus is not the layout" (`riv:5-20`, `riv:1236-1242`): keep, and keep the header as the only pointer path that widens.
- Step choice keys `x o w !` inside a shown mode: fine.

### Later

- **Touch:** a tap is a press+release at the same cell, which every surface treats as a click, so phones work; there is no long-press or two-finger anything (the wheel is what scrolls). A long-press → the F5 menu would be the one touch affordance worth adding.
- **`?` everywhere** comes free with F10.
- **Where A and C disagree.** A's "make splits general" and my "these screens behave too differently" are both half true: the *layout engines* differ for good reasons (the river's compression policy, the board's slide-over drawers), but the *key layer* differences (F11) are accidents. My position, with F11/F12 as evidence: converge the keys first (one pane-operation keymap, one `q`, one `open`), independently of whether the river's columns ever join the tree; a shared keymap doesn't need a shared layout tree, and it is what Evan feels daily.

## Tables

### Key map: screen × key → action

Legend: **A** runs an `ActionDef` through `ActionSet.run` (agent parity by construction) · **M** calls the same method an action calls, not through the registry · **D** direct mutation, no action exists · **—** ignored · ⚠ clash with another screen's meaning of the key.

**Shell (App, `app:352-360`)**: `ctrl+c` quit (asks twice with programs/unsaved; the program's inside a terminal tile) D · paste → typed as keys unless the screen accepts pastes D.

**Logon (`scr:189-202`)**: any char / `⏎` log on (hint says ENTER) D · `q Q esc` Goodbye D · click anywhere = ⏎ D.

**Main menu (`scr:288-310`)**: letters = the item (`N J K R W L F S Q B D G X T O C`) D · `↑↓ ←→ tab` move the light D · `⏎` open D · `esc` **Goodbye** D ⚠(F1) · `V` video D · `?` help D · click a slot or key-line key D · wheel moves the light D.

**Message list / Conferences / Last callers / File areas (`scr:385-394, 636-646, 739-746, 777-787`)**: `j k ↑↓ PgUp PgDn Home End` select D · `⏎` read/join/browse D · `t T` thread (list) D · `q Q esc` back D · click selects, click on the selected opens D · wheel selects D · hint keys clickable D.

**Who's online / Stats (`scr:703-706, 895-898`)**: `q Q esc ⏎` back D · `r` refresh (who) D · hint keys clickable D · everything else — (F3).

**Art viewer (`scr:846-864`)**: `, < ←` / `. > →` piece D · `i` iCE D · `v` video D ⚠(`V` elsewhere; `v` = selection in readers) · `⏎ space` finish reveal D · `j k ↑↓ PgUp PgDn` scroll D · wheel scroll D.

**Help (`scr:922-930`)**: any key closes; click on an item opens it D.

**Message reader (`scr:518-539`)**: the surface's keys first (below) · `n N → ⏎`(no element) `message.next` A · `p P ←` `message.previous` A ⚠(`p` hold/dock) · `t T` `message.thread` A ⚠(`t` drawer) · `U` → surface `u` A · `q Q esc` back D · `Home End` scroll D · mouse: surface press/drag/release/wheel.

**Board, lanes focused (`del:2149-2293`)**: `h l ←→` lane D · `j k ↑↓ PgUp PgDn` card D (`card.select` exists, not called) · `⏎` detail, `alt+⏎` second detail M (`open`) ⚠ · `H L` move card M (`card.move`) · `m` mover D → M · `n` composer D → M (`card.create`) · `N` note composer D → M · `s` steps overlay D → M (`step.set`) ⚠ · `d d` trash M · `u` restore M · `c` collapse lane D ⚠ · `alt+c` reopen all M (`reader.expand all`) · `r` reload D · `g` boards picker D · `e C i I ctrl+e` start a session in the preview and move focus there M · `t` outline drawer D ⚠ · `T` pin drawer M (`pane.pin`) · `S` drawer side D · `b` backlinks drawer M (`backlinks`) · `B` pin M · `o` pop out M (`pane.float`) ⚠ · `x` — (lanes) ⚠ · `{ } < >` resize M (`pane.resize`) · `tab shift+tab` region D (`focus` exists) · `V` video D · `esc` drawers shut, then menu D · `q` — ⚠ · mouse: click card selects / opens on the selected, drag card to a lane M (`card.move`), drag borders D (tree), spine click opens D, wheel moves the lane cursor D.

**Board, a reader focused**: surface keys (below) · `c` collapse reader M (`reader.collapse`) · `x` close detail/float M (`pane.close`) · `o` float/dock M · `t b T B S { } < >` as above · `⏎ alt+⏎` in the preview (no element) open detail M · `esc` → lanes D · float: `H J K L` nudge D.

**Board overlays**: mover `j k ↑↓ ⏎ esc m q` D → M · steps `j k space ⏎ x w ! esc q s` D → M ⚠(`w`) · composer: draft keys (below), `ctrl+s` create M · backlinks drawer `j k Home End PgUp PgDn ⏎ alt+⏎ . space / s K w h n` D → M (`backlinks`) ⚠(`s w h n`) · filter typing holds every key D · boards picker `j k ⏎ esc` D.

**Desk (`dsk:784-871`)**: `Tab shift+tab 1-9` `tile.focus` A · click tile `tile.focus` A · click header/tab `tab.select` A, drag header `layout.move` A · drag border `layout.resize` A · `alt+l` link mode → `tile.link` A · `alt+d` `layout.load daily` A · `alt+n alt+p` `tab.select` A · `alt+m` `marks.next` A · `alt+x` `block.unmark` A · `/` search overlay (typing, `↑↓ tab ⏎ esc`) D, `⏎` → `setCurrent` M-ish (`open` action uses `openIn`) · `V` video D · `q esc` menu (esc first unzooms `pane.zoom` A / shuts a drawer `tile.drawer` A) D · `⏎ e` on a terminal tile: type in it D · `e ⏎` on a reader holding a session: enter it D · `ctrl+e` edit in `$EDITOR` tile M · `p` hold/follow reader D (`pan:280`) ⚠ · wheel: pane's · ctrl-/alt-click a link: open beside M.

**Desk `^W` layer (`dsk:883-937`)**: `h j k l ←↓↑→` `tile.focus` A · `m`+dir `layout.move beside` A · `t`+dir `layout.move tabs` A · `T` tab out A · `H J K L` edge A · `[ ]` `tab.select` A ⚠(elements in a reader, but prefixed) · `< >` `pane.resize row` A · `+ -` `pane.resize col` A · `=` `layout.even` A · `z` `pane.zoom` A · `x` `tile.close` A (asks twice for a program) · `o`/`O`+kind `tile.open` A (`t r d p e s h a w b k v f l`) · `v` `tile.preview` A · `p` `tile.pin` A · `d` `tile.drawer` A · `r` load picker → `layout.load` A · `w` save picker → `layout.save` A ⚠ · `s` `layout.swap` A ⚠.

**Terminal tile, person in it (`dsk:790-797`, `term:131-150`)**: every byte is the program's (F-keys, modified arrows, pastes, `^W`, `ctrl+c`) · `ctrl+]` leaves; twice within 1.5 s sends it · mouse: to the program when it asked (`pty:240-256`), else wheel scrolls back · exited: `⏎` `tile.restart` A, `ctrl+]` leaves, other keys wait.

**River (`riv:1102-1182`)**: `h l ←→` focus column D (`focus` action exists) · `w` widen D (`widen` exists) ⚠ · `j k ↑↓ PgUp PgDn Home End` note/scroll D · `tab shift+tab` stacked pane D ⚠ · `⏎` open beside / reveal, `alt+⏎` duplicate D (`open`) ⚠ · `space` replies D (`replies`) ⚠(page elsewhere) · `s` split D (`split`) ⚠ · `p` dock D (`pin`) ⚠ · `x` close D (`close`) · `f` filter mode D (no action) ⚠(fold) · `#` tags mode D (no action) · `/` jump palette D (no action) · `?` help D · `e ctrl+e C m i [ ] u` the surface's, in a full column only M · `esc` lets go of a link, else menu D · `q` flash "quote isn't here" ⚠ · `c` flash · `V` video · `v y Y` selection D · `alt+← alt+→ backspace` side buttons: between columns D (`SurfaceHost.history`) · mouse: click body = focus, header/spine = widen, click card in the focused column = open, drag = select, wheel = scroll lines.

**River modes**: filter/palette: typing, `backspace`, `⏎ alt+⏎`, `esc`, palette `↑↓` D · tags: `1-9` D · help: any key closes D.

**Note surface, reading (`note:1133-1200`)**: `alt+← backspace alt+b` `back` A · `alt+→ alt+f` `forward` A · side buttons same A · `v` selection mode, `y` copy, `Y` source, `esc` clear (`select*`) A · `i I` `props` A · `C` `passage.select` A ⚠(Detail `c`) · `c` flash · `m` `threads` A ⚠ · `e` `edit` A · `ctrl+e` `edit` external A · `esc` let go of element / focus mark A(`focus.clear`) · `j k ↑↓` scroll D (`view.scrollTo` on the desk only) · `space` step toggle when a step is current (`task.status`) A, else page D · `ctrl+z` `task.undo` A · `PgUp PgDn` page D · `[ ]` `element.select` A · `z` unfold callouts D (no action) · `⏎` `element.open` / `link.follow` A · `alt+⏎` fresh A · `( )` fold select, `f` `fold.toggle`, `F` all A · `u` `up` A · click: link/fold/mark/step/prop/copy control/history row (`element.open`, `fold.toggle`, `thread.toggle`, `task.menu`, `props.follow`, `select.copy`, `back`/`forward`) A · double/triple click select word/row A(`select`) · drag select · wheel scroll (draft: cursor; full panel: rows; popup: candidates).

**Step choice (`note:1854-1864`)**: `j k ↑↓ tab shift+tab` D · `⏎` choose (`task.status`) A · `x o w ! y a` choose A ⚠(`x o w` mean close/float/stage outside, but the choice holds keys) · `esc q` cancel · click a row chooses, elsewhere closes.

**Draft (edit.ts:129-175, completer.ts:275-300)**: `ctrl+s` save/send/create A · `ctrl+e` `$EDITOR` A · `ctrl+r` reload A · `esc` close (twice when dirty) A · `ctrl+a` line start, `ctrl+k` kill to end D · arrows/PgUp/PgDn/Home/End/⏎/backspace/delete/typing D · completion: `↑↓` move, `⏎ tab` accept, `esc` dismiss, `tab ctrl+space` ask (`complete`) A · wheel moves cursor / popup.

**Comment session (`cmt:82-107, 238-270`)**: select: `j k ↑↓ PgUp PgDn` line, `J K` extend, `h l ←→` start, `H L` end, `⏎` write, `esc` back (`passage.select`, `comment.write`) A · compose: draft keys (`comment.send`) A · threads: `j k` pick, `r ⏎` reply, `x` resolve/reopen, `C` new, `esc` done (`reply`, `resolve`) A · **no mouse in the picker or the list** (`cmt:239`).

**Property panel (`pp:97-125`)**: `tab shift+tab j k ↑↓` row D · `y` `props.copy` A · `o` `props.follow` A ⚠ · `⏎ e` `props.edit` A · `s` `props.summary` A ⚠ · `I` full D · `esc i q` `props.close` A · field: typing, `←→ Home End ctrl+a ctrl+e ctrl+u backspace delete`, `⏎` save, `esc` cancel · `PgUp PgDn space` page the note · click a row picks/follows; controls not clickable.

**Backlinks tile (`bl:255-282`)**: `j k ↑↓ Home End` `backlinks.pick` A · `⏎ alt+⏎` pick open/fresh A · `. space` group A · `s K w h n` `backlinks.view` A ⚠ · click row opens (ctrl/alt: fresh), click control, wheel A.

**Welcome (`wel:159-257, 528-544`)**: `1-9 0` `welcome.select read` A (the desk's digits are the tabs' here) · `L` `welcome.logo` A · list `j k Home End ⏎` `welcome.select` A · detail `p` refused · preview `alt+⏎` `welcome.read` A, click `⇱ read here` A · band clicks: tab, `… more`, logo A · plus the desk's keys.

**Brief (brief.ts:225-232)**: `, .` `brief.step` A · the desk's. **Waiting** (waiting.ts:147-153): `j k ↑↓ ⏎ r` `waiting.pick`/`reload` A. **Showcase** (showcase.ts:257-290): `j k ↑↓ 1-9 0` pick D, `⏎ → tab l` into the part D (`section` action exists), `esc q` back, `V`; click a section / the stage, wheel.

**Pane kinds on the desk (`pan`)**: outline `j k ↑↓ PgUp PgDn Home End` select D, `l → space` expand, `h ←` collapse D, `⏎` open (`setCurrent`, not `open`) M, click row/disclosure D, wheel D · thread `j k ⏎ u` D, click, wheel · activity `j k ⏎ r` D, click, wheel · who `r` D · art `, .` piece, `j k` scroll D, wheel.

### Mouse coverage per action

| Action / thing | Keys | Mouse path | Notes |
|---|---|---|---|
| menu: open an item | letter, ⏎ | click slot or key line ✓ | wheel moves the light |
| lists: select / open / thread | j k ⏎ t | click / second click ✓; `T` on the hint ✓ | wheel ✓ |
| Who's online, Stats | r q | only hint keys | mouse otherwise does nothing (F3) |
| Search screen | — | — | unreachable (`scr:649`, no `new Search`) |
| reader: follow link, fold, mark, step, copy, history | ⏎ f [ ] y | click ✓, `[y copy]` ✓, `← back` row ✓, side buttons ✓ | ctrl/alt-click = fresh ✓ |
| reader: select text | v h j k l | drag, double/triple click ✓ | copy needs `y` or the control |
| reader: edit / comment / threads / props | e C m i | **no mouse** to start an edit or a comment (a mark click opens its thread; the inline thread's Select/Reply/Resolve controls are clickable) | the passage picker and thread list take no mouse at all (`cmt:239`) |
| reader: page/scroll | j k PgUp PgDn space | wheel ✓ | |
| props panel rows / controls | tab y o ⏎ s I | row click ✓ (follows a target); `y o s I` no | |
| step choice | x o w ! y a ⏎ | row click ✓ | |
| completion | ↑↓ ⏎ tab esc | click a candidate ✓, wheel ✓ | |
| board: lane/card cursor | h l j k | click ✓, wheel ✓ | |
| board: open detail / second detail | ⏎ alt+⏎ | second click ✓ / no mouse for alt+⏎ on a card | ctrl-click on a *link* is fresh |
| board: move card | H L m | drag onto a lane ✓ | mover has no clicks |
| board: n N s d d u g | keys | **no mouse** | composer/steps/picker: keyboard only |
| board: collapse/expand lane or reader | c ⏎ alt+c | spine click opens ✓; no click collapses | |
| board: drawers open/pin/side | t b T B S | `[ ] pin` click ✓; no click opens a drawer; `S` no | esc shuts |
| board: float / dock / nudge / close | o x H J K L | drag title ✓, drag ◢ ✓; no click for o/x | |
| board: resize | { } < > | drag any border ✓ | |
| board: backlinks controls/filter | / s K w h n . | status-line controls ✓, group header ✓ | filter typing only |
| desk: focus / tabs / move / resize / link / drawer | Tab 1-9, alt+n/p, ^W …, alt+l | click ✓, tab click ✓, header drag ✓, border drag ✓, alt+l then click ✓, handle click ✓ | |
| desk: open/close/zoom/swap/even/pin/preview/layouts | ^W o x z s = p v r w | **no mouse** (picker rows not clickable; a click closes it `dsk:1604`) | |
| desk: search | / | typing only; hits not clickable | |
| desk: marks | alt+m alt+x | label click dismisses ✓ | |
| terminal tile | ⏎ ctrl+] | click enters ✓; mouse to the program when asked; wheel = scrollback | |
| river: focus / widen / open / select | h l w ⏎ j k | body click = focus ✓, header/spine = widen ✓, click in the focused column opens ✓ | |
| river: replies / split / dock / close / filter / tags / jump | space s p x f # / | **no mouse** | |
| welcome: pick note / logo / read here | 1-9 0 L alt+⏎ | tab click ✓, logo click ✓, `⇱ read here` ✓ | |
| video | V | — | |
| keyboard-only everywhere | ^W layer, alt+letters, Esc chains, `?` (river) | | |

Hover: nothing (F7). Right button: same as left (F5). Shift-click: unused by the door (`mods & 4` never read), left to the terminal. Side buttons: readers only (lists ignore them; `back` on a BBS list could mean `q`).

### Hard-coded values in my lens

| Value | Where | Verdict |
|---|---|---|
| every key chord | 620 sites (F9) | should be bindings (F10) |
| 3 s "again within 3s" for quit, ^W x, trash | `app:188`, `dsk:1038`, `del` trash arm | sensible default; one constant |
| 1.5 s ctrl+] chord | `dsk:800` | sensible default |
| 30 ms lone-ESC timeout | `term:181` | invariant-ish; slow tethers may split sequences: 30 ms is tight over a phone (alt+letter arrives as ESC + letter; if the letter lands after 30 ms it is Esc then a plain key) |
| 450 ms multi-click | `sel:145` | sensible default |
| 400 ms double click (showcase actions pane) | showcase.ts:418 | a second constant for the same thing; use `sel`'s gesture |
| 50 ms feed coalescing, 16 ms frame | `app:213`, `app:337` | invariant |
| wheel steps 3 rows (readers, lists), 2 (art), 15 page | `note:1211`, `pan:200,426,464,543`, `note:1180` | fine; one place |
| 40 / 400 list pages | `scr:351-355` | fine; Help says 200 |
| hint strings | 14 composers | derive (F6) |
| mouse mode 1002 + 1006 + 2004 | `term:53` | invariant |

### Client → server candidates (my lens)

None that the service should own: keys, hints and hit maps are presentation. The one cross-client item is the **keymap file** (F10): both clients should read the same grammar, and ideally the same file, so one `keybindings.json` moves `c`/`C` for Detail and the door together.

### Tests, docs drift, dead code (the brief's "also look for", my lens)

- Parity tests start the real checkout's service (`test/scratch.ts:36`; `EP0CH_OUTLINER`, default `../pi-herdr-outliner`): real code, not a frozen copy, but whichever branch is checked out, not the service Evan runs.
- No `toMatchSnapshot` anywhere; `scripts/snap.ts` PNGs are looked at by people and asserted by nobody, so nothing can "pass on wrong behaviour" and nothing checks the picture either.
- **No CI in either repo** (`.github/` absent in both); the showcase has a test (`test/showcase.test.ts`) and nothing runs it automatically.
- Untested in my lens: the Esc chain to Goodbye (F1); right-button clicks (no `button: 2` in tests); hint text against handlers; a key-clash audit; any keymap. Covered well: BBS mouse (`test/bbs-mouse.test.ts`), history and side buttons (`test/history.test.ts`), selection (`test/select.test.ts`), term decoding of mods and ctrl+] (`test/term.test.ts:105`).
- Dead code: `Search` screen (`scr:649-662`), `HELP.V` and `HELP["?"]` (`scr:936`), `focus.set`/`focus.clear` kept as aliases (`note:3098`).

## Gap matrix

Reviewer A's. My contribution to it, as evidence for the "keys before splits" position (Later, above): the key-layer gaps per screen are in the key map; the capabilities a river or board *preset* would need are all interaction ones (a focus-only click rule, a header-as-handle rule, a squeeze policy), and none of them requires the screens' keys to differ.

## Docs that are wrong

| Doc | Line | Says | Is |
|---|---|---|---|
| UI-GRAMMAR TL;DR | 57-58 | "Backlinks exist only on the board … There are no Outlinks/Resources lists and no history on any screen" | backlinks tile `^W o l` and the welcome's; history since PIE-453 (§2 line 229 and §3 say so) |
| UI-GRAMMAR F5 | 421 | "No history anywhere" | stale, as above |
| UI-GRAMMAR F10 | 460 | Help says "Read-only…" (`scr:568`) | fixed since; Help now lists writers (`scr:912-913`); the remaining stale Help lines are `C` and `R` (F6) |
| UI-GRAMMAR §3 Shell | 260 | enter from menu `k··` | the menu is clickable (PIE-452): `km·` |
| UI-GRAMMAR §1 | 98 | hint row `dsk:210 del:1450 riv:397` | now `dsk:718`, `del:2094`, `riv:593` (every citation in §1-§4 has drifted; the doc says "at the time of writing", so treat as a re-anchor job) |
| UI-GRAMMAR §7 | 590 | `ctrl+c` "the shell's quit" | quit asks twice (`app:188`); fine, but say it |
| note.ts header | 2 | hosted "(next) a river column" | the river hosts it (UI-GRAMMAR F10 already says so; still not fixed) |
| README desk keys | 288-307 | table | missing `alt+m`, `alt+x` (marks; AGENT-INTERFACE has them), `^W` + arrows, `Esc` (unzoom / shut drawer / menu), `⏎`/`e` into a terminal tile |
| README | 374 | "Mouse reporting is on, so use your terminal's selection modifier (Shift in Ghostty) to select text" | readers select themselves (PIE-419); true only outside readers, and tmux needs `set-clipboard on` for `y` |
| README | 359 | `EP0CH_TILE` "the program's name in the layout" | the tile's name is its kind (`pty`) unless the layout names it (ran) |
| README steps | 797 | "a click (or right-click) on a step's box" | any button; right-click has no meaning of its own (F5) |
| README reader | 1016 | "The reader's footer names the current one" | not on the desk (F6) |
| README river | 1160-1166 | keys | omits `x s p f #` from the hint claim; the `?` modal omits `i v y Y alt+←/→` |
| README board | 701-739 | key tables | `r` reload, `V`, `S` (in prose only) missing from the tables; hint row omits them too |
| Help screen | `scr:933-936` | `R … 200 most recently changed`; `C … Claude · now: the [[claude-now]] page, pinned and live` | 40 then 400; C is Welcome |
| Logon hint | `scr:183` | "press ENTER to log on" | any key does |
| AGENT-INTERFACE | 197-200 | "The board has card.* and reader.* for most of what its keys do (lane focus and the lane cursor aren't actions). The river has RIVER_ACTIONS … but not its filter, # or / jump. The BBS list screens … have none" | accurate; add: `t T S b B o c x { } < >` and the border drag on the board don't run their actions either (F4) |
