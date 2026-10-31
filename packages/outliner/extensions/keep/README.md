# Keep

Turns a quick `::=` line into a named component: its code moves to a note of its own, and the line calls it by name.

## What you do

- **Install:** from the power bar, ctrl+k, type `&keep`, and pick **install Keep** (Enter or a double click).
  - An agent runs `ep0ch act extensions.install id=keep`.
- **Keep a line:** on a line such as `::= (await q("type=seedling")).blocks.length + " seedlings"`, run `keep name=tray-count` from the power bar.
  - An agent runs `ep0ch act ext.script:keep.run block=<note> name=tray-count`, or a script `await act("ext.script:keep.run", { block: this.id, name: "tray-count" })`.
- **What changes:** the line becomes `::tray-count{}`, and a child note **Tray count** `[script::tray-count] [mode::render]` holds `return (…)` in a `tsx` fence.
  - Each `props.x` the expression read becomes a `[form-field::x text]`, so `::tray-count{x="…"}` passes it.
  - Write `::tray-count{}` in any other note to draw it there; `this` is the note the line is in.
- **Undo:** it is one run, so one undo takes back the line and the note together.
- **Remove:** `ep0ch act extensions.uninstall id=keep demo=keep`, or the power bar's remove row. Kept components stay: they are your notes.

## Which line

- **The line it was run from,** when that line is a `::=` line: the power bar on a line, or a script's `act(…, { line: 2 })` (a number counts from 0, as `extensions.act` does).
- **Else a `line=` word:** the line's text, or its number counting from 1 (`line=3`).
- **Else the note's first `::=` line** outside a code fence.

## Refusals

- **No name, or not a slug:** `keep needs name=`, with what a name may hold.
- **A taken name:** it names the note that already says `[script::<name>]`, or who else has the name (a built-in component, an extension).
- **A changed note:** the line is patched at the revision keep read; a note saved since refuses it, and no note is made.

## The errand board demo

Installing writes a second demo, **Errand board**, with a component built by hand from notes:

- **UI kit** `[script::ui-kit] [mode::module]` returns a `Lane` other scripts import by name.
- **Errand board** `[script::board] [mode::render]` takes `where` and `group` from its `[form-field::]` chips: `::board{where="type=errand" group=status}` draws a lane per status.
- **Errand done** is what a card runs when pressed; **Pull GH errands** runs `gh issue list` through `sh` and makes an errand per issue under **Errands**.
- Its names (`board`, `ui-kit`, `errand-done`, `gh-errands`) are this outline's once installed; uninstall with `demo=remove` to take them out.

## Make it yours

- **Edit the script:** an outline's own `[script::keep]` note wins over the bundled one.
- **Follow the source:** [scripts/keep.ts](./scripts/keep.ts) reads the note with `tools.outline_read`, patches the line with `tools.outline_patch`, and makes the note with `tools.outline_create`.
