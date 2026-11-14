# ep0ch, native

ep0ch as a native window: tiles arranged by a layout (readers, and lists of whatever the service lists: the
outline's tree, a board's lanes, a question's matches, a note's links), drawn on the GPU with
[Rune](https://github.com/anomalyco/rune) and its `rune-kit` components. A screen is a note: an arrangement saved
here opens in the door, and one saved there opens here. It is a third client of the same outline, beside the door
and the Herdr console, and a thin host like every small client: it draws, and nothing in it reads Blockdown. It
ships no screen and no tile kind of its own: the ones every door ships are one extension's
([`extensions/screens`](../outliner/extensions/screens)), read the way any extension's are.

![The board: lanes grouped by a property its screen names, a card open beside them, dark](docs/board-dark.png)
![The navigator: facets, what they leave, and a reader, dark](docs/navigator-dark.png)
![The board's cards as a table: the title and the properties they carry as columns, under their groups, dark](docs/table-dark.png)

![About a note, on the kitchen screen: a comment being written on words of it, its thread with a reply, an agent's proposed edit as the lines the service found, and an earlier revision opened to what changed since, dark](docs/about-dark.png)

![A note read with a pen: the words two comment threads are on marked where they are drawn, the first thread opened whole in the margin beside them (the comment, an agent's answer, its own Reply and Resolve), the second folded to its first words, dark](docs/margin-dark.png)

![A comment written where its words are, inside a part: the note's prose is one part, and the field stands in it under the list whose last item was picked (a press late at each end, found as whole words), over the paragraph that follows, the words two threads are on still marked on both sides, dark](docs/inplace-dark.png)

![A comment on words as the reader draws them: begun on words across bold text and a reference, beside a thread the service anchored to the source such words were drawn from (the link whole, the bold run with its marks), dark](docs/quote-dark.png)
![The keys screen: every way to press an action, a list made from the actions' own rows, dark](docs/keys-dark.png)
![A screen saved as a note with keys of its own: the list of the keys beside its reader puts that screen's first, dark](docs/screenkeys-dark.png)
![The library: the components under their groups, one picked with its own example as written and as drawn, dark](docs/library-dark.png)

![A note whose headings and rule name a style: drawn without the properties that style a line, the ones that say something kept; its properties beside it, a table whose rows scroll under a line below its column header, dark](docs/headings-dark.png)
![A note with a query-backed component, dark](docs/note-dark.png)
![Live figures answered by the service, dark](docs/figures-dark.png)
![A query with the facets its matches carry, dark](docs/query-dark.png)
![A header image and a picture where they stand, dark](docs/pictures-dark.png)
![The command bar with an action typed, its keycap from the key table, dark](docs/bar-dark.png)
![A note's figures, a box and two buttons, one pressed and saying what it ran, dark](docs/parts-dark.png)
![A note's links on its page and in the links tile beside it: one list, drawn once, dark](docs/links-dark.png)
![A block written in place: an agent's edit lit above the caret and said on the tile, and the list that completes a note's name, dark](docs/draft-dark.png)
![The list that completes a word: one box hung under the token's start, each row a tag for what it is, its name with the typed letters set apart and one quiet detail, the count and the keys in its foot, the lit row's own words in the card beside it, and the rest of the lit row dimmed after the caret, dark](docs/complete-dark.png)
![A property's values, each with its look: every row draws its glyph track beside its name, and the card of the lit row draws that pattern as a band over an example heading, dark](docs/complete-values-dark.png)
![A component chosen from the list: its skeleton written from its own schema with the first stop selected, and the line under the field saying which Tab this is, dark](docs/complete-component-dark.png)
![The kitchen screen, with the bar on the extensions and a name typed: open its page, its settings, install, remove, dark](docs/extensions-dark.png)
![An extension's own screen, its tile drawn from what its script answered, and the form its settings schema makes, dark](docs/settings-dark.png)
![A tile torn out into a second window over the same store, dark](docs/window-dark.png)
![A shell and an agent beside a note: rows on the column grid across wide characters and coloured grounds, each tile saying what keeps its program and what it reports of itself, dark](docs/terminal-dark.png)

## Run it

```sh
cd packages/native
cargo install --locked --path .               # once a machine: builds the window, puts ep0ch-native on the PATH
ep0ch-native -- --ws pie                      # the window; any outline the usual rule names
ep0ch-native -- --ws pie --machine float-2    # another machine's, over its forward
cargo run --release -- -- --ws pie            # the same from the checkout, with nothing installed
```

- **Nothing installs the window.** `ep0ch install --apply` builds no Rust: the command is there once `cargo install
  --locked --path .` has run on that machine, from this folder (its `rust-toolchain.toml` is read from where cargo
  runs, and `--locked` builds the crates `Cargo.lock` names).
  The door says the same when asked for a window that isn't built (`ep0ch act --door native …` with no
  `ep0ch-native` on the PATH names this line).
- **Build it again after each `PROTOCOL` bump.** The window carries the checkout's number (`build.rs`); a host on
  a later one refuses it with "this window is older: build it again from the checkout", which is this line again.
- **It runs from the checkout it was built in:** `resolve.ts` is read there, with `bun` on the PATH or `EP0CH_BUN`.

Everything after the `--` (the second one, under `cargo run`) names the outline as every client does: `--ws`, then
`EP0CH_WS`, then the nearest `.ep0ch`. That rule is the door's own, run once at launch (`resolve.ts`, with `bun` on the PATH or `EP0CH_BUN`);
after that the window speaks the host's socket itself and runs nothing else. `EP0CH_SOCKET` names a host
outright, as it does for the door, and is read by that same rule (a typed `--machine` wins over it): the window
never reads it itself.

Linux builds need `libxkbcommon-dev` and `libwayland-dev`; a machine with no GPU draws through lavapipe
(`mesa-vulkan-drivers`, `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`).

Rune is pre-release, so `Cargo.toml` pins one rev of its `dev` branch (`a5360a6`, Nov 13) for `rune` and
`rune-kit`, and patches the four crates Rune patches (`winit`, `parley_engine`, `wgpu-hal`, `accesskit_windows`) from
that same rev, as Rune's README asks of an app ("Depending on Rune"): a dependency's `[patch]` does not reach the
crate that depends on it, and without the table the window is built on the stock crates, with none of Rune's
macOS input-method fixes in winit. Moving the pin moves all six revs together (and the probes' crate's), and an
entry Rune adds to its own table is added here. What that rev changed for this window is in
[PROBES.md §18](docs/PROBES.md#18-rune-at-a5360a6-r0).

## What Evan can do in it

| Do | How |
|---|---|
| Walk the outline | The tree tile: a press opens a note, a press on the open note folds or unfolds it. A row has a fold's mark when notes are under it, and only then: a note with nothing under it but comments or an edit proposed beside it has none (they are in the Comments and Proposals tiles) |
| Start from nothing | A reader shows the note it was told and no other. One told none is empty: it says what it is, in its kind's own words (written for the person at the tile), and what to do next under them, a line each: Find and New note as buttons, each with its key and what the key does, read from the action's own row |
| Open a screen | The bar's Screens (`bar.open scope=screens`, the toolbar's Screens): the desk, the navigator, the board, last callers, who's online, the keys, the library, the kitchen sink (this window's parts on one screen), and every screen note the outline has. A row opens one (`screen.open name=`; `target=` is what it opens on, where its spec takes one) |
| Read a board | The board's lanes: the matches of a question, a lane a value of the property the screen names. `list.group by=<any property>` groups them by another, `list.layout layout=rows\|table\|lanes` arranges them another way (a table whose tile names no `columns` shows the title and the properties its rows carry), `list.sort by=<any property>` orders them; a card pressed opens beside |
| Narrow by what notes carry | The navigator: a facet's row, or a chip on any list, narrows that list's question (`facets.set key= value=`); the Matches tile beside it lists what is left, and the chip that says what it is narrowed by takes it back |
| See what changed | Last callers: the notes people and agents edited, newest first; a row opens its note beside |
| Arrange the window by mouse | Hold a tile by its title (or a tab by its label) and carry it: every tile shows the places it would take it in, as boxes with their words (a side to split it, its middle for a tab above and a swap below, its title for a place among its tabs, the window's left, right and bottom strips for a whole column or row, a shut dock's strip), the one under the pointer is lit, the held tile is dimmed, and the foot of the tiles says what is held, where it would land and that Escape lets go. Let go and it lands there (`layout.move to= where= index=`, `layout.swap to=`, the door's acts by the door's arguments); over no place, or with Escape, nothing moves and the window says so. A place the layout refuses is marked (✕) while the tile is held, and says why in its own box once the pointer is over it. A tab carried to a side of its own set leaves the set; let go outside the window, a tile is torn into a window of its own, and a torn window's tile dragged out of its window (or the put-back on its title, `tile.return`) goes back into the window it came from. A float follows the hand and lands on a title, an edge or a dock's strip. A press anywhere in a tile gives it the keys |
| Arrange it by key or act | `tile.split` (a second reader on the same note, or `kind=`), `layout.move`, `layout.swap`, a border dragged (`layout.resize`), `tile.close`, `tile.dock`, `dock.toggle`, `tile.collapse` (fold to a spine: `mod+shift+c`, the fold on the title of the tile with the keys; a press on a spine opens it), `tile.zoom` (`mod+shift+enter`), `tile.float` (`mod+shift+o`, the float on a title) and `float.place`, `layout.lock` (`mod+shift+l`, the lock on the toolbar), `layout.policy` (what a container lets its tiles do) and `tile.agent` (what an agent may do to a tile); `layout.undo` takes each back |
| Keep an arrangement | `screen.save name="Garden work"` writes it as a `[type::screen]` note; `screen.open name=` lays the window out as any screen the outline has; `screen.reset` puts it back as its screen has it. The window opens as it was left |
| Read what is wrong | A tile whose kind nobody draws, or that names a tile its screen hasn't, says so on the tile, in the service's words, and draws its spec as data |
| Read a note | Prose as Markdown, links that open, callouts, code; `::links`, `::fields`, `::view` and the notes under it as the same list a list tile draws (rows under their groups, a table's columns, lanes; a long one builds only the rows in view), query-backed `::graph-table` as rows that open; figures as the primitives the service lowers them to (tiles, bars, a checklist, a table, a sparkline); a `::box` with its parts inside it. [How each component fares](docs/prim-coverage.md) |
| Press a button | A `::button` in a note is a button: an act line this window has runs here; one with steps or a script is run by the service, and what its script does in a window happens in this one. What it did is said under the button |
| See its pictures | The header image (`[layout::hero]`) as a band above the title; `[img::…]` lines (PNG, JPEG, SVG) where they stand; an ```svg fence as the picture its text is; a ```mermaid fence as a diagram |
| Follow anything | A link, a child, a backlink, a row in a component; `back` goes back |
| Do anything | The command bar: every action there is, by a word of its name or of what it does, with its keys beside it. A whole act line typed runs as written (`open id=…`) |
| Write | `edit` opens the note's Blockdown source where the note stands, with the rest of its page around it; `edit.save` saves at the revision it read and keeps you in the editor; Esc leaves once everything is saved. Another note opened meanwhile lands beside, and may be written too: a block each |
| Indent a list | Tab puts the caret's line, or every line the selection touches, a level in: a list item under the item above it, anything else two spaces (`draft.indent`); Shift+Tab takes it back out (`draft.outdent`). Each is one step of the editor's undo, and the door's rule (outline-core's `indentText`) |
| Paste | ⌘V (Ctrl+V) puts the clipboard in at the caret as one step (`draft.paste`; `text=` says the words outright). Lines stay lines: a carriage return between two of them, as two files copied in a file manager have, goes in as a newline |
| Complete what you type | A page's name begun (`[[se`), a note's (`((po`), a property, a component, a callout: the service's list hangs at the caret. Down and Up light a row, Tab or Return writes it, Esc puts the list away. Beside the list is what the lit row says of itself (a property's meaning, how many notes carry it, a value's own words) and what choosing it makes, as written and as the service drew it; under it, what it is a list of and which row of how many is lit (`properties 2/5`) |
| Write while an agent edits | The block is held on the service while it is open: an agent's edit lands in your text in front of you, lit, and the tile says who changed what. Never in the paragraph you are typing in, never under an input method's marked text, and your caret and selection stay yours. The editor's own undo takes it back |
| Find your words back | What you type is kept as you type it. A window that ended before a save finds the text back in its block, and says so |
| Comment on words | Select words in a reader and press the comment's key (`comment`: `a` then `c` while words are picked, as in the door, or its own chord anywhere; its button stands by the selection, and the bar runs it for the same words): the comment opens in place, in the page under the block the words end in (inside a long run of prose too, with the rest of it under the field: the service says where the words are in what was drawn; under the part when they end in its last block, or the host is an older one), with both scrolled into view, in the editor a block has, under the words it quotes (a long passage by its start and its end); Save sends it. The words are whole words: a selection that starts or ends inside one (a press past the middle of a first letter) takes the whole word, as the service finds the passage when the words are picked (`passages.find`), and words the note doesn't hold as picked are said over the field before anything is written. The words may cross a link, bold text or paragraphs: they are sent as the reader drew them, and the service anchors the thread to the source they were drawn from. Words the note draws twice are told apart by the part they were selected in, and refused with why when one part draws them twice. With nothing selected it is on the whole note. `comment quote="…" body="…"` sends one outright |
| See what is commented | The words a thread is on are marked where the note is read, and the thread stands beside them: in a margin when the reader is wide enough for one, under the part when it isn't. Folded it is the comment's first words; a press on it, or on the marked words, shows it whole, with its replies and its own Reply and Resolve (`thread.toggle thread=`). A comment you send brings the Comments tile to the front of its tabs (`threads`); somebody else's moves no tab, and is marked and listed as it lands |
| Answer and resolve | The Comments tile lists the note's threads, the open ones first, each with what it is on and its replies under it. Reply opens the same editor where the note is read (`reply thread=`); Resolve puts the thread among the earlier ones, and Reopen brings it back (`resolve thread=`) |
| Review a proposed edit | The Proposals tile lists the edits waiting beside the note: who sent each, why it didn't apply, and what it would change, line by line as the service found it. Apply and Dismiss are its presses (`proposal.apply id=`, `proposal.dismiss id=`) |
| Look back, and go back | The Revisions tile lists the texts the note had. A press on an earlier one opens what changed since under its row (`list.pick id=<its number> tile=revisions`); Restore puts that text in the editor, to save or drop (`revision.restore revision=`) |
| See every key | The keys screen (`screen.open name=keys`, from the bar's Screens): every way to press an action, where it holds and what it does; a pick runs it |
| Browse the components | The library screen (`screen.open name=library`): every component there is to write, under its group; a press on one shows what it is, its own example as written and that example drawn |
| Make, move, bin | `note.new` under the open one; `note.move` up, down, in, out; `note.trash` (the notice has Undo) |
| Add to it | The bar's Extensions (`bar.open scope=extensions`, the toolbar's Extensions): the outline's extensions as the service lists them. A row opens an installed one's page, installs one the repo has (`extensions.install id=`), and, once a name is typed, removes one, its demo notes kept or binned (`extensions.uninstall id= demo=keep\|remove`). What one adds is here as soon as the service lists it: its screens among the Screens, its tiles drawn (one its script renders is drawn from the primitives the service answers), its actions run by a line (`extensions.act id= action=`). What an action answers is done or said not done: a note it asks to have opened is opened, words for the clipboard are copied, a question it asks before going on is said with the line that says yes |
| Change an extension's settings | Its settings row opens a form: a field each as the extension's own schema says it (its name, what it means, what it takes, what it does left empty). Enter saves, Esc puts it away; a value the service refuses keeps the form, every word as typed, with why. A line does the same (`extensions.configure id=waiting warn-days=7`) |
| Switch outline | The bar's Outlines (`bar.open scope=outlines`, the toolbar's Outlines): this machine's outlines and the ones on the machines it holds a forward to, as the service lists them. A row switches this window (`outline.switch name= [machine=]`). Only an outline that is listed opens: a name nobody has is refused, and nothing is made. The outline left keeps its arrangement, what each tile showed and the blocks being written, as typed; its name stays on the toolbar, a press back to it. In a window on another machine's outline the list is that machine's host's: its own outlines open, and one it lists on a further machine is refused with the launch that opens it from here (the machine's name on that row is that host's, not this machine's) |
| Open a second window | `tile.tear` (`mod+shift+t`, the kitchen's Tear out): the tile leaves this window for one of its own, on the same outline, showing what it showed. Both windows read one store: a note both show is read once, and a link's 64 watches are shared. A window may switch outline by itself; `window.close` closes it |
| Find | The bar, with words: the service's search, under the actions that match |
| Query | The bar on a query: the views' grammar (`type=letter mail=waiting`), with the facets the matches carry as chips that narrow it; a header chip on a note, or a row of its properties, opens the query for it |
| Run a shell beside a note | `terminal.open` (`mod+j`, the kitchen's Shell): a terminal tile on the reader's right, your login shell in it, and your keys in the shell. Every key is the program's until `ctrl+]` (`tile.leave`); the same key steps back in (`tile.enter`, or a press on its screen). The tile says, over its screen, what keeps the program and whether that outlives the window, before you rely on it. Needs a window [built with its terminal](#the-terminal): one built without says so on the tile |
| Run an agent beside it | `terminal.open agent=true` (`mod+shift+j`, the kitchen's Agent): the first terminal kind whose row starts with a command of its own (the [terminal extension](../outliner/extensions/terminal)'s Agent: fork it to change the command), under the shell that is there. `command=` types another line, `cwd=` starts it in a folder. What the agent reports of itself (working, blocked, done) is on its tile and its row of the list, as herdr-core passes it on |
| Detach, and come back | `terminal.detach` (`ctrl+backslash` in a program, the tile's Detach): the tile closes and the program runs on. On herdr-core (and tmux) it outlives the window: the next launch's tile attaches to the same program, with its screen as it was and nothing typed into it. On a plain pty it runs until the window ends, and the tile and the notice said so. `tile.close` ends a program with its tile, and asks nothing |
| Jump between agents | The bar's Programs (`bar.open scope=programs`, the kitchen's Programs and its tile): the programs this window runs, in a tile or not, each with what it reports of itself; a row takes the keys to its program (`terminal.jump key=`), in a tile beside the note when it has none. What herdr-core runs that this window never started is listed after them in the tile, and is never ended, typed into or attached from here |
| Scroll, paste and copy in a terminal | `shift+pageup` and `shift+pagedown` or the wheel move through what scrolled off (`terminal.scroll`); `mod+shift+v` pastes the clipboard as a paste (`terminal.paste`); words are selected with the mouse, as in a note, and copied with ⌘C on a Mac (elsewhere step out with `ctrl+]` first: Ctrl+C in a program is the program's) |
| See it change | An edit from the door, an agent or another machine redraws what's open |
| Read what an agent did, and move on | The toolbar's status line names the agent and the act, or why it was refused, for as long as it takes to read (4 s at least, about 14 characters a second, 30 s at most: the door's rule for its status bar), then it goes. It has the room the toolbar has left between the names and the screen's buttons, and takes none of theirs; where that cuts it short, the pointer resting on it reads the whole of it. A refusal of your own is the notice under the toolbar: it stays until you have had time to read it and do something else, or dismiss it; the clock alone takes no notice away |

**The keys are the actions' own.** Each action's row says its chords (`src/actions/*.rs`), and the key table, the
keycap on a button, the bar's rows and `actions` over the control socket all read the row. The defaults:

A key's place is where the keys are when it holds: `selection` is a reader with the keys while words of its note are
picked there, and its keys are the door's for a selection (`a` then a letter: `a` `c` comments). The door's own
comment on the whole note is `C`; here that is the comment's chord with nothing picked. Plain letters are bound
nowhere else in a tile, so `a` alone is nobody's key until words are picked.

<!-- keys: the key table, as keys.rs reads it from the rows (a test keeps this true) -->
| Chord | Act line | Where | Does |
|---|---|---|---|
| `mod+[` | `back` | everywhere | back |
| `mod+n` | `note.new` | everywhere | a new note under the open one |
| `mod+backspace` | `note.trash` | tile | move the open note to the Trash |
| `alt+up` | `note.move step=up` | tile | move the note up |
| `alt+down` | `note.move step=down` | tile | move the note down |
| `alt+right` | `note.move step=in` | tile | move the note in, under the one above |
| `alt+left` | `note.move step=out` | tile | move the note out, after its parent |
| `mod+e` | `edit` | everywhere | edit the open note |
| `mod+s` | `edit.save` | everywhere | save |
| `mod+enter` | `edit.save` | draft | save |
| `escape` | `edit.close` | draft | done |
| `tab` | `draft.indent` | draft | indent |
| `shift+tab` | `draft.outdent` | draft | outdent |
| `mod+v` | `draft.paste` | draft | paste |
| `tab` | `complete.accept` | complete | accept |
| `enter` | `complete.enter` | complete | accept |
| `down` | `complete.move by=1` | complete | next |
| `up` | `complete.move by=-1` | complete | previous |
| `ctrl+n` | `complete.move by=1` | complete | next |
| `ctrl+p` | `complete.move by=-1` | complete | previous |
| `pagedown` | `complete.move by=8` | complete | a page down |
| `pageup` | `complete.move by=-8` | complete | a page up |
| `home` | `complete.jump to=first` | complete | the first row |
| `end` | `complete.jump to=last` | complete | the last row |
| `ctrl+space` | `complete.ask` | draft | complete here |
| `escape` | `complete.dismiss` | said | close |
| `tab` | `snippet.next` | stops | next stop |
| `shift+tab` | `snippet.previous` | stops | previous stop |
| `escape` | `snippet.end` | stops | leave the stops |
| `mod+shift+m` | `comment` | everywhere | comment on the selected words, or on the note |
| `a then c` | `comment` | selection | comment on the selected words |
| `mod+k` | `bar.open` | everywhere | open the bar on everything |
| `mod+l` | `bar.open scope=query` | everywhere | open the bar on a query |
| `escape` | `bar.close` | bar | put the bar away |
| `enter` | `bar.pick` | bar | pick the lit row |
| `down` | `bar.move by=1` | bar | the next row |
| `up` | `bar.move by=-1` | bar | the row before |
| `escape` | `notice.dismiss` | tile | dismiss the notice |
| `mod+d` | `tile.split` | everywhere | split this tile: a new one on its right |
| `mod+shift+d` | `tile.split dir=down` | everywhere | split this tile: a new one below |
| `mod+w` | `tile.close` | everywhere | close this tile |
| `mod+alt+left` | `tile.focus dir=left` | everywhere | the keys to the tile on the left |
| `mod+alt+right` | `tile.focus dir=right` | everywhere | the keys to the tile on the right |
| `mod+alt+up` | `tile.focus dir=up` | everywhere | the keys to the tile above |
| `mod+alt+down` | `tile.focus dir=down` | everywhere | the keys to the tile below |
| `mod+shift+c` | `tile.collapse` | everywhere | fold this tile to a spine, or open it again |
| `mod+shift+enter` | `tile.zoom` | everywhere | zoom this tile to the whole window, or back |
| `mod+shift+o` | `tile.float` | everywhere | pop this tile out as a float, or put it back |
| `mod+j` | `terminal.open` | everywhere | a shell beside the note |
| `mod+shift+j` | `terminal.open agent=true` | everywhere | an agent beside the note |
| `ctrl+]` | `tile.enter` | tile | into the terminal: every key goes to its program |
| `ctrl+]` | `tile.leave` | program | back to the window's own keys |
| `ctrl+backslash` | `terminal.detach` | program | detach: close the tile, the program runs on |
| `shift+pageup` | `terminal.scroll lines=-12` | program | up through what scrolled off |
| `shift+pagedown` | `terminal.scroll lines=12` | program | back down |
| `mod+shift+v` | `terminal.paste` | program | paste the clipboard into the program |
| `mod+shift+b` | `dock.toggle side=left` | everywhere | show or hide the dock on the left |
| `mod+i` | `dock.toggle side=right` | everywhere | show or hide the dock on the right |
| `mod+alt+z` | `layout.undo` | everywhere | undo the last change to the arrangement |
| `mod+shift+l` | `layout.lock` | everywhere | lock or unlock the arrangement |
| `escape` | `layout.drop cancel=true` | moving | lets go: the tile stays where it was |
| `mod+shift+s` | `screen.save` | everywhere | save the arrangement as its screen |
| `mod+shift+r` | `screen.reset` | everywhere | put the arrangement back as its screen has it |
| `enter` | `form.save` | form | save the form |
| `escape` | `form.close` | form | put the form away |
| `mod+shift+t` | `tile.tear` | everywhere | this tile, in a window of its own |
<!-- /keys -->

A screen adds its own (its spec's `keys`, as a screen note or an extension writes them: `ctrl+l`, `L`, `esc`, the
names screens give keys). While that screen is open and a tile has the keys they are tried first, each running its
action as the person, in the tile it names, over the kinds of tile it says; the keys list on that screen
(`kind: keymap`) puts them first, under "this screen".

`mod` is ⌘ on a Mac and Ctrl elsewhere. Where: a chord that is a tile's (`alt+up`) is the editor's own while a note
is being written, and Esc closes one thing at a time (the bar, then a completion list, then the editor, then the
notice). While the list that completes a word is open its keys come first and the editor's still hold (`complete`
is a layer over `draft`); a list with nothing to choose from, only the service's word (no such page yet), keeps
Esc alone (`said`), and every other key is the editor's. Tab is one key in three layers, and the line under the
field (and the list's own foot) says which it is now: it writes the lit row while the list is open (`complete`),
steps the stops of a skeleton a completion wrote while that is being filled in (`stops`: Shift+Tab steps back, Esc
leaves them), and indents the line otherwise (`draft`). `ctrl+space` asks for the list where the caret is: it is
Ctrl on a Mac too (⌘Space is Spotlight's), and a Mac with more than one input source gives ⌃Space to the input
menu unless that shortcut is turned off there (not run on a Mac). Both docks resize by their inner edge.

Capture comes first here too. What is typed is written to a file as it is typed
(`native-<outline>.drafts.json`, beside the arrangement's), so a window that ends finds it back. Saving never ends
editing, so a key typed around a save always has somewhere to land, and a save sends what was typed as typed: a
reference that names nothing is the service's to say of afterwards, never a reason to hold the save. A save the
service refuses (the note changed underneath) leaves every word in the editor and says why. Leaving the editor with
unsaved text is refused; another note opened meanwhile opens in a reader of its own beside it (the layout's rule
for a tile that holds an edit). Only Discard, by name, drops words.

## How it fits

```text
src/ (Rust, Rune)                                      the outline host
  shell.rs, bar.rs  draw any layout; a press, a drag, a drop runs an act line; a held title draws
                    the places the model holds for it (actions/carry.rs, layout/drop.rs)
  tiles/            a drawer an answer shape: page (a note), list (one list, whatever it is of),
                    view (what an extension's script draws), pty (a program's screen)
  pty.rs, pty/      programs in terminal tiles, with no renderer's type: the grid, the run's registry, and
                    what runs them (the terminal's crates behind the `pty` feature; a scripted host for scenes)
  tiles/prim.rs     PRIMS: one builder a primitive type; the page drawer walks parts through it
  tiles/diff.rs     a change to a text, drawn from the lines the service found
  keys.rs           chord -> act line, by where the person is
  control.rs        an agent's act line, over native.sock
        │ an act line, whoever asks
        ▼
  actions/          the one dispatcher; one module a noun     ────────▶ update, create, move, delete, screens.save,
                    (review.rs: what is written about a note)            annotations.*, draft.proposal.*
  layout.rs         apply(layout, op) and place(layout, open): pure, the door's rules
  tiles/rendered.rs the view drawer: a tile an extension's script renders, through the same registry
  screen.rs         screens and tile kinds, as served         ◀───────  screens.list
  store.rs          one slot an ask; 64 watches a link; one   ◀───────  notes.page, lists.read, tiles.view
                    hub the windows of a run share
  ext.rs            what the extensions add, a row each;      ◀───────  extensions.list
                    a setting's schema, typed
  client.rs         the socket                                ◀───────  queries.changed
  page.rs           the wire's shapes
  parts.rs          a page as primitives: its head and foot, the walk, the button a press names
  draft.rs          a block being written: its session, its hold, the file that keeps it  ◀──▶  drafts.hold, draft.place, completion.rows
  list.rs           the one virtualised list
  actline.rs        the act-line grammar, read and written
  query.rs          a question narrowed by picked values
```

- **Every change is an act line through one dispatcher** (`App::act`, `actions/mod.rs`). A key, a press and an
  agent say the same thing (`note.trash`, `open id=…`); the dispatcher reads the line, types its arguments by the
  action's row, finds the tile the act is about (`App::target`, by the sort of tile the action says it acts in:
  the one named, else the one with the keys when it is of that sort, else the nearest; a tile named that is not
  of the sort is refused), checks the actor against what the row touches there, runs it and records the step. A
  request that was never a line (a script's call, a row's pick) goes in as it is (`act_request`); a line is
  written by one writer (`actline::word`). A press comes from its tile without naming it (`App::act_from`): a
  note's button that edits runs in its reader, one in a list that acts on a note runs in the reader that list
  speaks for (`App::home_of`), and one that folds the tree or sorts a list runs where the same line typed in the
  bar would. `App`'s state is
  private to `actions/`: a view reads everything and changes nothing except by a line.
- **An action describes itself** (`actions/row.rs`, outline-core's `ActionRow`): its name, summary, arguments,
  what it touches, its keys and its menu labels. Nothing restates them: a button names its act line and is
  labelled from the row.
- **The arrangement is a layout, and two functions decide about it** (`layout.rs`, no Rune and no socket).
  `apply(layout, op, ctx)` answers the layout after an operation or the refusal in words; `place(layout, open,
  ctx)` answers the tile an open lands in and why. Both are the door's (`desk/screen-layout.ts`,
  `desk/landing.ts`), rule for rule: the door's own answers are written down in `outline-core/fixtures/` and
  `src/tests/contract.rs` asks every row of `layout-contract.json` and `place-contract.json` here. Only an action
  issues an `Op`, and only `open` asks `place`.
- **Where a held tile lands is the layout's drop rule** (`layout/drop.rs`, no Rune). It is the door's
  `desk/drop.ts` in cells, ported once: the zones a tile offers (`zones_of`), the place a cell is in (`drop_at`:
  the outer strips first, then a title's row, then a tile's bands), a shut dock's handle (`handle_drop`), and the
  act and the operation a drop runs. The door's own answers are `outline-core/fixtures/drop-contract.json`
  (the drop under every cell of eleven made-up layouts, every zone, seven handles), and `tests/contract.rs` asks
  each. `actions/carry.rs` tells the rule what is on screen (each tile's frame in cells, a tab set's labels, a
  shut dock's strip), keeps what it answers for the cell the pointer is over (`State.moving`), and `layout.drop`
  runs the place's act as a request of its own. The shell says the pointer's cell (`layout.carry`) and that it let
  go, and draws what the model holds: it knows no zone's shape, words or act. Both actions are the person's; an
  agent's `layout.move` moves the tile outright and shows no drag. A tab's label sits in the cells the model says
  (`App::tab_cells`), so a tile let go over one lands before that tab.
- **A tile is a kind and a drawer** (`tiles/`). A kind's row is the service's (`screens.list`'s `kinds`, an
  extension's `tiles[]`): it names the drawer that draws it and the fields a tile of it starts with. There are four
  drawers, `page`, `list`, `view` (what an extension's script draws for a tile) and `pty` (a program's screen: [the terminal](#the-terminal)); a drawer is handed a `TileCx` (the store to read, its spec, its kind's row, its own
  state) and speaks only by act lines (`cx.act`). The window keeps no catalogue of kinds and names
  none: a kind is found by the name a tile carries, or the name the service says its row serves (`serves`), and
  one with no drawer here is drawn as its spec. The
  shell (`shell.rs`) draws whatever tree the layout holds from the boxes the layout answers, so a split, a tab
  set, a dock, a flow and a float are one loop.
- **One list, whatever it is of** (`tiles/list.rs` over `list.rs`). A list tile asks `lists.read` for what its
  kind's row says it lists (`from`), with the parameters that source says it reads, each from what the person
  chose here, the tile's spec, then the row. The answer is rows that say what they show and the act line a pick
  runs, how they are arranged (`tree`, rows under their groups, `table`, `lanes`), a table's columns and the
  facets the listed notes carry. The window draws that, builds only the rows in view, and maps nothing: a tree,
  a board, a question's matches, a note's links and its properties are the same drawer, and so is a list in a
  note (`list::on_page`: a view, its `::links`, the notes under it). A pick is one action, `list.pick` (the door's
  `tree.pick` is the same run): it runs the row's own act line as a request, and folds a folder's row. What a list is sorted or
  grouped by is a property's name, handed to the service as written.
- **A screen is data** (`screen.rs`): a row of `screens.list` (a `[type::screen]` note in either body, or an
  extension's), validated by the service. The window ships none: it opens on the one whose spec says `start`,
  else what its file kept. `screen.save` is the service's write (`screens.save`), so the note's form has one
  writer. The arrangement as it stands is kept in a file beside the control socket
  (`native-<outline>.layout.json`), written on each change: the layout, each tile's own state, the screen's name
  and a mark of the spec it was laid out from, never the spec. What an open screen says of itself (where opens
  land, its toolbar, its rule for new notes) is the service's row, read each time, and a screen changed in the
  outline under the arrangement is said, with the act that lays it out again.
- **Every read is an ask in the store** (`store.rs`): an outline, a wire action, its parameters, watched or not.
  Equal asks share a slot; a tile is a slot's user; a slot nobody shows keeps its answer and gives its watch to
  the next ask. `peek` lists the slots, who shows each and how much of the budget is held.
- **One store, however many windows** (`store.rs`). The links, the slots and the watch keys are a hub the windows
  of a run share; each window's `Store` is its face on it: what that window wants, the answers as it last took
  them (a view reads those, never the hub), and what the service said that is its to hear (the answer to its own
  write, a script's act for the window that pressed, an ask about a draft it holds). A link is one an outline and
  machine: two windows on one outline share it, and a window on another outline brings a second.
- **A window is an `App` of its own** (`actions/window.rs`, `shell::open`): its arrangement, its keys, its bar and
  the blocks written in it. `tile.tear` takes a tile out by the layout's rule for a tile closed, makes the state
  of the window it goes to, and the shell opens it (`App::born`); a block is written in one window at a time.
- **An outline is switched by name** (`actions/outline.rs`). Which outlines there are is the service's list
  (`outlines.known`, asked each time); how one is reached is the rule every client opens an outline by
  (`resolve.ts --to <name> [<machine>]`, the door's `resolveTarget`). A machine's name belongs to the machine that
  says it: this machine's own host names the machines it reaches as this machine does, and the rule follows them;
  a host on another machine names them its own way, so it speaks for its own machine's outlines alone
  (`vouched`), and nobody is asked the way by a name of its. The outline left is parked whole in the
  window (arrangement, tiles, the way back, the blocks being written with their holds let go) and its
  arrangement kept in its own file; coming back asks nobody.
- **What an extension adds is the service's word** (`ext.rs`, `actions/ext.rs`). The bar's Extensions is a list
  the service answers (`lists.read from=extensions`), each row with the act line it runs. What one of its actions
  answers (`extensions.act`) is read whole where it was asked (`acted`): everything such an answer may ask of a
  client is the service's list, written down with a real answer (`outline-core/fixtures/served-act.json`), and a
  test holds the reader to doing or saying each. Its kinds arrive with
  the screens (`screens.list`): one its script renders names the `view` drawer (`tiles/rendered.rs`), which asks
  `tiles.view` and builds the primitive it answers through the one registry, so a list in it is the list
  drawer's. Its settings are a form drawn from its schema as `extensions.list` says it; what is typed is sent as
  the value its field's type says, and the service checks it. Nothing in the window names an extension.
- **A property that styles a line is no content.** A heading's `[heading::band]` and its own fields, a line that
  declares a style, a rule's `[rule::fade]` and any `style.*` are left out of the prose the service serves
  (outline-core's `unstyledLines`, by the readers the door's own reader asks); a property that says something
  stays the note's words. The window reads no Blockdown to do it.
- **The service answers a note whole** (`notes.page`, outline-core's `note-page.ts`): title, chips, properties, the
  body as parts, and the notes above, under and linking to it. It walks the note as a published page does (one
  finder says which component a line starts, outline-core's `componentAt`) and asks the same questions; where a
  page writes HTML, it hands over data. A part says where it is written (its note, its line, its span in the
  note's text) and what to draw: a primitive of the catalogue (outline-core's `primitive.ts`), or prose as Markdown,
  a picture, or its lines as written when nobody has an answer for it.
- **A page is drawn by walking its parts through one registry** (`tiles/prim.rs`, `PRIMS`): an entry a primitive
  type, each its name, how it is drawn here and its builder. `parts.rs` makes the page's own head and foot
  primitives too (the title beside its edit, the chips as presses, the notes under it), so the page drawer does one
  thing: build each primitive by its type. `outline-core/fixtures/primitives.json` lists the types, and a test holds
  the registry to it; a type nobody builds is drawn as its data.
- **A press is `button.press`** (`actions/script.rs`), by a click, a key or an agent. An act line this window has
  an action for runs here, through the dispatcher, as whoever pressed. A button with steps or a script is the
  service's to run (`scripts.sequence`): the window registers as itself (`events.subscribe`), each act the run has
  for a window comes back as a call, the dispatcher runs it and the store answers (`scripts.answer`).
- **A script's act runs as the script, on the invitation of the press that started it.** The person's press mints
  an invitation, the service passes it on with every act of that run, and while a call carries it the script
  stands as the person (`App::stands`, the one answer: the actor rule reads it, the layout is told it): their own
  button may open their editor or move their keys. The step and the write are the script's all the same. Who
  the service says asked for a run is never read; an agent's press invites nothing; a run's end spends it.
- **The window is a function of what's chosen and what's answered** (`actions/app.rs`). Each tile on screen wants
  what its drawer asks (a reader its note's page, a list its one list; a hidden tab asks nothing), and the bar its
  words; an answer lands in the slot of its own ask, or nowhere. There is no "is this answer still for what's on
  screen?" to get wrong.
- **Changes arrive as answers, not events to interpret.** A watched read (ADR 0004) is registered under one of the
  link's 64 keys: the service says which answer moved and the slot reads it by generation, when someone shows it.
  The window never works out what a change touches.
- **The tree is one list** (`lists.read from=children`, with the folders that are open): only what's unfolded is
  listed, and only the rows in view are built, so a large outline costs what's on screen.
- **A fold's mark is the row's own word** (`folds`), and the service says it of a note only when a note is under
  it: the reading that lists the notes under a note (outline-core's `isNoteUnder`: a comment, a reply and a
  proposed edit are none) is the one that says whether there are any (`blocks.read`'s `hasNotes`, the outliner's
  `notes-under.ts`). The tree, a question's matches and a page's own rows all fold by it, so a mark never opens
  onto nothing. The window draws the mark in one place and decides nothing.
- **The bar's sources are the service's too** (`bar.rs`). What a bar can list is what the list producers say of
  themselves (`lists.read from=sources`): the notes by the service's search, a question's matches, the screens.
  Their rows, facets and hint are one list answer each, asked as a tile's list is (`App::ask_of`); the window's
  own source is its actions, read from their rows. The source a question is typed on is the one the service
  says carries facets, and a facet picked is a term written by one writer (`query.rs`, outline-core's
  `selectionQuery`).
- **A block is written where it is read** (`draft.rs`, `actions/draft.rs`, the page drawer). A draft is a session
  the window holds: the block, the revision and text it stands on, and what is typed. The page drawer puts its
  source where what is drawn from it would stand (in place of its parts, its title and its chips), in the page's
  own scroll, and the field is the kit's editor behind `keys::Text`, so the model names no renderer. The window
  reads no Blockdown to do any of it:
  - **Completions are a served list** (`completion.rows` with the text and the caret). The service finds the token,
    asks its sources and merges the rows as every client's are merged; the window draws them and writes the
    chosen row's own `insert` over the token it was told. One box, built from the kit's popover parts
    (`popover::anchored`, `raised`, `fit_scroll`) around the one list (`list.rs`): hung under the caret's line with
    its left edge at the token's start (above the line when there is no room below, always inside the window), as
    wide as its rows need and eight rows tall at most, scrolling inside itself. A row is `list::line`, the row the
    bar's rows are too: a tag for what it is, its name with the letters the service matched set apart, how what it
    writes looks (`sample`, a primitive built by the registry: a heading pattern's track), one quiet detail. The
    foot, inside the box, says which row of how many and what the keys do there, from the key table and the row's
    own word for Return. The card (the lit row's `docs` and its `view`) stands at the list's side once the row has
    been lit a third of a second: at the right when the window has room, else at the left, else under it, never
    over the line being typed.
  - **Choosing a row does the next thing, each the row's own word:** a key's values open at once (`next`), a
    component's skeleton is written with its first stop selected and Tab steps the rest (`slots`), a page nobody
    has written is made first and then linked (`makes`; lit and never chosen, Tab and Return stay the field's, as
    in the door), and a value closes its bracket without doubling one that is there. What of the lit row is still
    to come is shown dimmed after the caret (`rest`, an overlay at the caret: never part of the field's words),
    and the characters that end a token count the row they finish as chosen. The row the person chose stays lit
    by what it is while the list narrows, and the list never blinks away between two letters of a word.
  - **The window is the draft's holder, and places nothing.** While the draft is open it is held on the service
    (`drafts.hold`, renewed every five seconds), so an agent's `draft.patch` on the note comes here. Asked to
    patch, the window answers with its draft as it stands (the text, where the caret is); the service decides
    where the patch goes and whether it may, by the rule the door runs over its own buffer (outline-core's
    `placeDraftPatch`), and hands back the spans to replace (`draft.place`). They are taken under the caret as one
    step of the field's own undo, only while the text is still the one they were found in.
  - **A row says what it is, and the service says it.** Each row carries its source's own words (`docs`), and the
    lit one what choosing it makes (`view`: its example as written and lowered through the page's walk, asked with
    `lit` once another row than the first is lit). The window builds both through the one registry (`PRIMS`) and
    holds no description and no drawing of a component, a value or a callout.
  - **A level in or out is the door's rule.** `draft.indent` and `draft.outdent` ask `draft::indent`, the one port
    of outline-core's `indentText` (the door's `Draft.indent` asks the same rule of its lines), and
    `core-contract.json` holds every row of it.
  - **A paste is the window's to take.** The block's field hands a paste over before its editor (Rune's
    `on_input_paste`, which is why `keys::area` builds the field from Rune's own text field in the kit's frame:
    the kit's `TextArea` hands over keys and changes, no paste). `App::pasted` gives it to the block being written
    in that tile (`App::paste_in`, the one way in, which makes line ends plain: `draft::plain_ends`), as it gives
    a terminal's to its program.
  - **The editor is the person's.** `edit`, `edit.save`, `edit.close`, `draft.paste`, `draft.indent`,
    `draft.outdent` and the list's own actions say so on their rows, and the dispatcher refuses an agent.
    `draft.patch` is the way in for everybody else.
- **Pictures are parts too.** The page names each picture (its path, or an svg fence's own text) and how the note
  lays it out; the window reads a file's bytes with `media.read`, hands them to Rune's image cache to decode off
  the UI thread, and keeps those of the pages its readers show, with the last few they showed still decoded behind
  them (eight at most, and no more than 128 MiB of pixels: a note come back to draws its photos at once). One the
  host can't read says so, in the host's words, where it would be.
- **What is said goes when it has been read** (`App::fade`, `App::read`; `actions::stays` is outline-core's
  `staysMs` by port, the rule the door's status bar keeps a message by). The status line is news and goes by the
  clock. A notice is the person's: a problem's goes with their next act once it has been up long enough to read,
  unless that act says something in its place.
- **The toolbar starts past the window's own buttons** where they sit over it (`shell::toolbar_lead`, from Rune's
  `Cx::titlebar_inset`): on a Mac the content fills the window under a clear title bar, and the outline's name is
  drawn after the traffic lights. In full screen, and on every other platform, it starts at the edge. Each window's
  frame is said once (`shell::frame`).
- **What is about a note is a list that follows a reader** (`extensions/screens`: the `threads`, `proposals` and
  `revisions` kinds, each the list drawer over a producer of `lists.read`, with `source: tile:<reader>` and
  `subject: follows`, as the links tile has). The window has no code for any of them. The desk holds the three as
  tabs in its dock; a tab behind another asks nothing.
- **A row shows what it holds** (`tiles/list.rs`). A cell of a row that carries an act line is a press of its own
  (Reply, Apply, Restore: the service's words and the service's line), and what a row shows under itself is its
  `view`, a primitive built by the registry like any part of a page. A row that folds, in a list whose source says
  it reads which rows are open, is opened by picking it: the list is asked again with it open, and the service
  answers what is under it. That is how a revision's change and a component's example are shown, with no action
  of their own.
- **A change is drawn as served** (`tiles/diff.rs`, the `diff` primitive). The service finds what changed between
  two texts (the outliner's `text-diff.ts`) and answers the lines, each saying what it is; the window draws them and
  compares nothing.
- **A draft says what it writes** (`draft.rs`, `Writes`): a block's own text, a comment on a note, a reply in a
  thread. One session type, one field (the page drawer's), the same list that completes a word, the same file that
  keeps what is typed, and the same actions: `edit.save` saves a block and sends a comment, `edit.close` leaves
  either. Only a block's own text is held on the service. A comment is on words by quoting them (`passage.select`
  is what a selection in a reader says, as it is made: the words as drawn, and the span of the note's text the
  service says the parts they were selected in are written in). They are sent said as drawn (`Quoted`, `drawn` and
  `within` on the passage); where they are in the note is the service's to find, for every client alike
  (outline-core's `drawn-passage.ts`: the source read as a reader draws it, asked of the one exact lookup). The
  window reads no source to know what a link or a bold run was written as. A press on the toolbar leaves the
  selection as it is (`keeps_text_selection`), and the bar put away lets it go.
- **One send is one request** (`DraftSession.send`, `draft::send_name`): a comment's or a reply's request is named
  by its draft and its words, so a draft tried again is the request it was and the same words written another time
  (a second "Agreed." in a thread) are another, which the service writes.
- **A list speaks for one reader** (`App::home_of`): the tile it names as its source when that reads notes, else
  the reader its selection feeds, else where the screen's opens land. Its subject when it follows, the note it
  marks as open, where its own opens land and the reader a press in it acts in are that one tile. Reply and
  Restore act there, and Restore names the note its text is of (`revision.restore of=…`), so a list that kept its
  note while the reader moved on puts nothing into another note's editor.
- **A closed reader's note stays on screen** when the layout says a reader is its heir (`close_heir`, the door's
  rule by contract: the empty reader its opens land in). `tile.close` shows it there, with the way back.
- **A reader shows the note it was told, and no other** (`App::note_of`). One told none shows none: the layout's
  rules read that (`Facts.showing`) and the tile draws that, so a close's heir and an open's landing replace
  nothing that was on screen. What an empty tile says is its kind's own row (`tiles::waiting`: the name and the
  description the service serves for the kind, which is written for the person at the tile; how a screen writes a
  tile of the kind is the extension's page to say), for a reader and for a list about a note nobody shows alike,
  and what to do next is a line an act (`tiles::way`: the button its action's row labels, the key the table binds
  and what that key does, in the row's words); a
  window opens on its screen with its reader empty, and the arrangement kept between runs brings back what each
  reader showed.
- **The keys screen has no table of its own.** The window hands `lists.read from=actions` its action rows (where a
  list is asked, `App::ask_of`) and the name of the screen it has open, and the service answers them as rows, the
  line each key runs written by outline-core's one writer: that screen's own keys first (the service's spec, the
  one the key table reads through `keys::screen_binds`), then the actions'. The key table and the list are read from
  the same rows, and a test holds them equal against a real service.
- **It holds no grammar and names no property, kind or screen.** A tile's body is `rune-kit`'s `Markdown`, `Badge` and `Button`;
  `bar.rs` is its `Dialog` over the one list; every field is `keys.rs`'s; the toolbar is the screen's own list of
  act lines, each button labelled from its action's row. No drawer matches a figure's kind or a component's name:
  a figure with no primitive form shows the service's Markdown for it, and a component the service answers nothing
  for shows its source. Nothing is hidden.
- **`PROTOCOL` is the checkout's**: `build.rs` reads it from outline-core's `protocol.ts`, and a host on another
  number is refused with the side to update, as every client does.

## The terminal

A terminal tile is a kind whose row names the `pty` drawer: the [terminal extension](../outliner/extensions/terminal)'s
Shell and Agent, and any extension's tile that runs a program (`run`), which the service serves bound to that
drawer with the line that starts it. The window has no code for any one program.

```sh
cargo build --release --features pty      # with the terminal
cargo build --release                     # without: what the window was, and no new crate
```

The feature is off by default. With it, the pty and the emulator are [Moonframe](https://github.com/moonframehq/moonframe)'s
(`moonframe-terminal` with its `alacritty` emulator, in Rust, and `moonframe-mux`; MIT, pinned to one rev in
`Cargo.toml`), and through its mux herdr-gpui's client of herdr-core. Never Moonframe's `ghostty` feature: that
builds Ghostty's source with Zig. Without the feature a terminal tile says the terminal is not built in, with the
kind's own words under it (they say the command above).

The mux picks what runs a program by what the machine has, and the tile says which:

| Backend | When | What it keeps alive |
|---|---|---|
| **herdr-core** (`hc`) | `hc` is installed (a core that isn't running is started, as Moonframe's backend does) | The program outlives the window. The next launch's tile attaches to it, and so does `terminal.attach`. It is one of the core's own terminals, named `ep0ch-native.<outline>-<n>` for `hc ls`, and `hc attach` reaches it from any other terminal. What it reports of itself (OSC 7501: idle, working, done, blocked, error) is read from the core's list, never guessed from its screen |
| **tmux** | no `hc`, and `tmux` is installed | The same, on a tmux server of the window's own (`tmux -L ep0ch-native`, without your `tmux.conf`). It comes with the mux as its second choice. Run where the machine has tmux: `pty_live.rs` on a server of the test's own, and a live window under Xvfb over two launches (a shell and an agent, the agent detached, both found by the next launch) |
| **pty** | neither | Nothing: the login shell on a pseudo-terminal that ends with the window. A tile detached runs until the window ends |

- **herdr-core is the one it is built for.** A terminal is started by the window itself (`src/pty/hc.rs`) as
  nobody's child, to outlive what started it, at its tile's size, as the manual `hc --skill` prints says an API
  client should; Moonframe's backend then finds it by its labels and attaches. A program found still running is
  attached to and nothing is typed into it.
- **Only this window's are touched.** `hc ls` lists every live terminal, your other work among them. The window's
  list shows which are its own (the ones it started, by their labels) and lists the rest after them with no
  pick; it ends only a terminal its own labels name, and only when you close its tile.
- **A program is the run's, not a tile's** (`pty::Programs`, in the store's hub): a tile torn into a second window
  keeps its program, and a tile names its program by a key kept with the arrangement.
- **Not built:** the door and this window don't share a program (the door's terminal host has one client, PROBES
  §8; `HOST_PROTOCOL` is untouched): a terminal herdr-core keeps is reached from the door by `hc attach` in one of
  the door's own terminal tiles, as from anywhere. A terminal this window did not start is listed and gets no
  tile here. A line struck through is drawn plain, the cursor is a block, the mouse is the window's (a program
  that asks for the mouse gets no clicks), and nothing rings. `herdr-app`, which arranges windows, is not used.
- **What keeps a program is asked off the frame.** The window asks herdr-core, or its tmux server, what it keeps
  when anything first reads the list (so a window that returns with no terminal tile lists what the launch
  before left), when a terminal is opened or ended, and every two seconds on a thread of the host's own. A tile
  and the list read what it last said: tmux's answer is a process, which a frame never starts.
- **herdr-core itself was not run in this repository's tests.** `src/tests/pty_live.rs` runs a real plain pty, and
  speaks herdr-core's protocol to a stand-in core written from herdr-gpui's client's source. On a machine with
  `hc`: `hc --skill`, then `cargo run --features pty -- -- --ws <a scratch outline>` and `hc ls`.

## An agent in it

The window serves a control socket that speaks the door's control protocol (`control.rs`; the door's
`src/control.ts`): `native.sock` beside the outline's `door.sock`, or `--control <path>` after the second `--`
(`EP0CH_NATIVE_CONTROL`). So the door's own client reaches it:

```sh
ep0ch act --door native note.trash --as compost-agent   # the same action a key runs, recorded as the agent's
ep0ch peek --door native --json                         # {screen, focus, whereabouts, watches, tiles, layout, …, text}
ep0ch act --door native tile.split tile=reader dir=down # the layout's own rules say what an agent may arrange
ep0ch actions --door native                             # every action, as its row; every primitive type, as its entry
ep0ch act --door native button.press label="Sow the peas" --as compost-agent   # a note's button, pressed as the agent
ep0ch act --door native draft.patch observed="beans  go" replacement="beans go" --as tidy-agent   # into the draft being written
ep0ch act --door native comment quote="The beans go in May" body="June is safer." --as compost-agent   # a comment, recorded as the agent's
ep0ch act --door native proposal.dismiss id=<a proposal's id, as peek lists it> --as tidy-agent
```

- **An act is attributed.** Its write carries `mutation: {author: "agent", actorId}`, its step says who, and the
  toolbar's status line names the agent and the action.
- **An act takes nothing of the person's,** unless it is a step of a button they pressed themselves (the run
  carries their press's invitation; its acts are still recorded as the script's). Not their keys, not the bar they
  have open or its lit row, not the editor: `edit`, `edit.save`, `edit.close`, `draft.paste`, the completion list's actions, `bar.close` and
  `notice.dismiss` are refused to an agent with why, `tile.focus` is the person's alone, and an agent's `open`
  lands without taking their keys: beside the reader when a block is being written in it.
- **An agent changes a note's text with `draft.patch`** (`observed=`, `replacement=`, `start=` when the passage is
  there twice): sent to the service as the agent. A note being written here takes it in the draft, in front of the
  person; any other takes it as saved. The act answers that it was sent; what became of it is on the status line
  and in `peek` (the reader's `editing.said`, and its `text` as typed).
- **An agent comments, answers and reviews by the same lines.** `comment` and `reply` with `body=` are sent at
  once and open no editor; without it they are refused with what to name. `resolve`, `proposal.apply` and
  `proposal.dismiss` are the service's writes, recorded as the agent. `passage.select` and `revision.restore` are
  the person's (a selection, the editor) and say so on their rows. `peek` lists each list's rows with their own
  presses (`cells`, each with its `act`) and what they show (`shows`).
- **An agent arranges by the layout's rules.** `tile.split`, `layout.move`, `layout.swap`, `tile.close`, `tile.dock`, `tile.collapse`, `tile.zoom`, `tile.float`, `layout.lock`, `layout.policy`,
  `layout.resize` are refused for the door's reasons when they would take the tile with the person's keys, resize
  the tile they type in, or undo a lock of theirs. A tile is addressed by name (`tile=reader2`); `peek` lists
  each with its kind, what it asks and what its drawer says of it. `layout.get` answers the arrangement with every
  container's id and its revision: the read a refusal about a split points at.
- **A refusal names a way out that is here.** The layout names a way out as an act (an action, its arguments, what
  it does), never a key. The window says it: to the person by the key its own table binds to that act (`Ctrl+E
  enters it`), to an agent as the act line (`comment body="…" on the note gets their attention`), and not at all
  for an action this window hasn't. One function words it (`actions::says`), for the layout's refusals and the
  actor rule's own.
- **An agent's `bar.open` lists the actions** for its words and opens nothing. A served source's rows (the
  notes, a query's matches, the screens) are the service's answer, which an act can't wait for: it is answered
  the rows the store holds now, whether that is an answer yet, and the `lists.read` request that lists them, so
  an agent asks the service the same thing the bar does. `list.pick`, `list.sort`, `list.group`, `list.layout`
  and `facets.set` take a list tile by name, and `peek` gives each list's rows with their act lines.
- **An agent runs programs by the same lines, and never types where the person types.** `terminal.open` (with
  `command=`, `name=`) gives it a terminal beside the note without the person's keys, never by splitting the
  terminal they type in; `tile.type text="…\n"` sends a program keys (`\n` is Return, `\e` Escape), and is held
  back with why for the tile the person is typing in. `peek` gives each terminal's lines, cursor, backend, what
  it reports of itself and whether the person's keys are in it (`whereabouts.takesKeys`). `tile.enter`,
  `tile.leave`, `terminal.jump` and `terminal.paste` are the person's (their keys, their clipboard) and say so
  on their rows; `terminal.attach key=` gives a program a tile without their keys. An agent doesn't end a program
  that runs (`tile.close` on its tile is the layout's refusal, as in the door); `terminal.detach` ends nothing.
- **A request is for one window.** `window=<name>` among an act's words (or `window` in the request) says which:
  `ep0ch act --door native open id=… window=reader`. Left out, it is the run's first (`main`); `peek` says the
  window's name and every window there is, and a name none has is refused with the ones there are.
- **`peek` is state, not a frame:** a hidden window answers it. The element tree and a picture of a live window
  are not served yet; `--snap` and `--tree` draw headless, and a headless run serves no control socket.

## Check it

```sh
cargo test                          # the window over a stand-in link that answers by wire action; also what a
                                    # change under packages/outline-core/fixtures or the door's layout is held by
                                    # (scripts/box-test native runs it on the test box)
cargo test --features pty           # the same, and the terminal's crates: a real pty, herdr-core by a stand-in
cargo test -- --ignored live        # the same window against a scratch outline host it starts (needs bun)
bun run check                       # resolve.ts, and scripts/native-forkable
```

**No bun gate runs cargo, and the fixtures have a second reader here.** `bun run check` in this folder is `tsc` over
one file and `scripts/native-forkable`. `packages/outline-core/fixtures/` holds what the door, outline-core and the
service answer, written down (the layout, place, drop, address and actor tables, `core-contract.json`,
`action-rows.json`, `act-lines.json`, `served-screens.json`, `served-act.json`, `primitives.json`). The door's and
the outliner's own tests only make those files again and compare them with what is committed, so a door change that
moves a row is green there; the window's ports of the same rules (`layout::apply` and `place`, the drop rule, the
address resolver, the action rows, outline-core's rules in `tests/contract.rs`) are asked the rows by `cargo test`
alone. So a diff under `packages/native` **or** `packages/outline-core/fixtures` runs `cargo test` here, and a row
that goes red is fixed in the window's port in the same PR. In the foreground, up to ten minutes once the build is
warm: `export CARGO_TARGET_DIR=<a build folder that is kept>` (a first build is about 480 crates) and, where there
is no GPU, `export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`. On the test box `scripts/box-test native`
runs the same (this folder's check, then the suite) with the build kept between runs; it is never part of `all`, so
a merge batch names it when a PR in it touches this folder or the fixtures.

`src/tests/` has one file a kind of test: the garden (what the window asks and does with the answers), the window
drawn and pressed, the parity table (every action by its chord, by its bar row pressed and by its act line, one
step record), the store (one slot an ask, the budget, what the service dropped), the fixtures (the act-line grammar
and the action rows against `outline-core/fixtures/`), the contract tables (every row of the door's layout and
place answers), the shell (one test a container kind, opens through the `open` action, a screen saved and broken),
the control socket, the lists (a board's lanes, the navigator's facets, a table, a long list, the shipped screens
opened from the bar's own row), typing (`typing.rs`: Tab and Shift+Tab on a list's line and on a selection, each one
step of the editor's undo and the list's while a list is open; a paste event with a carriage return between its
lines taken by the window, once, as lines; the paste chord's row; the completion list's count, its lit row's words
and the drawing asked with that row lit), completing (`complete.rs`, every step a key, a press or a frame: where the
list hangs and that it stays there, its flip above the line and its card's side at the window's edges on laid-out
rects, what a row shows, Tab through a key and its value, Return before and after a choice, the keys that move, a
row kept lit by what it is, the character that finishes a row, the rest after the caret, a skeleton's stops, the
pointer and the wheel, a page made when chosen, and the hint line's one height), the parts (every primitive type has a builder, a button runs here or is the service's,
a script's act is run and answered, and every component's own example is drawn: the test writes
[docs/prim-coverage.md](docs/prim-coverage.md)), the drafts (a block typed in, completed and saved by keys; held,
read and patched under the caret by what the host says; kept as typed and found back by the next window; how the
kit's editor carries undo, an input method and a long block), arranging by mouse (`arrange.rs`: a title pressed, carried and let go through the window: the zones drawn where the rule says, the lit one, the drop as the door's act, Escape and no place, a refused place, a tab among tabs and out of its set, an edge, a shut dock, a float, a tile out of the window and back, the fold, the zoom, the lock, and a press that gives a tile the keys), and `one_owner.rs`, which scans the source for a second place that
binds a key, writes to the wire, lists rows, labels a button, issues an `Op`, places an open, draws a part, keeps a
kind or a screen, maps an answer to rows, writes a line's word, chooses the tile an act is about, says which
reader a list speaks for, makes the person the actor of somebody else's act or names Rune
outside the renderer seam (`shell.rs`, `tiles/`, `bar.rs`, `list.rs`, `keys.rs`, `control.rs`, `main.rs`: the
model names no Rune type). `owners.rs`, `sweep2.rs` and `sweep3.rs` hold the same deciders by what the window does
(sweep 3's: a pressed script acts as the script on its press's invitation, a list speaks for one reader, a closed
reader's note goes to its heir, Return under a row that would write nothing, a refusal names an action here;
F2's are in `lists.rs` and `shell.rs`: a fold's mark only on a row the service says opens onto notes, and a reader
told no note drawn as empty in its kind's own words), and
`small.rs` has what the first run by hand met (wave H3: the status line letting an agent's refusal go once it has
been read, a refusal's notice going with the person's next act, the toolbar starting past a Mac's window buttons,
a table's rows scrolling under a line below its column header, an empty reader's words and ways from the rows), and
`margin.rs` has a comment in place (picked words found as whole words by the service, the comment's field under the
part its words are in with both in view, the words a thread is on marked and its card beside them, opened by a press
on either, the person's send bringing the comments forward and an agent's moving no tab, the door's keys for picked
words), and
`review.rs` has what is about a note (the tiles
that follow the reader, a comment written on words selected in the window across a link, bold text and two
paragraphs, words drawn twice told apart by their part, a reply and a thread resolved by the
row's own presses, a proposal applied and dismissed on the wire, a revision opened and put back, the keys screen made
from the rows handed over, a component's example drawn), and
`contract.rs` also asks every row of `actor-contract.json` (who may run an action, as the door's dispatcher answers
it) and of `outline-core/fixtures/core-contract.json` (outline-core's own rules, as the
window ports them: a list's sections, the new-note rule that applies, a screen filled with its target, a question
narrowed by picks). The stand-in host answers the screens and kinds from
`outline-core/fixtures/served-screens.json`, which the outliner's own test writes from a real service with the screens
extension installed.

`scripts/native-forkable` (run by `bun run check`) fails when `src/` names a shipped screen or kind, compiles a
screen in, or the extension names a drawer the window hasn't: what the window opens on is changed by forking the
extension or saving a screen note, never by building the window again.

`cargo test -- --ignored live` runs the same window against a scratch host: among them the draft's whole sentence
(written with completions from the service's own sources while an agent patches it over the control socket, the
window ended mid-word, the text found back), what is about a note (a comment on words of it, a reply, the
thread resolved; words dragged over with the mouse from one paragraph into the next, across a link and bold text;
words selected across each form of link, a reference drawn as its note's title, bold text, two paragraphs and a
rule between two, each comment anchored to the source they were drawn from, and words not in the note refused with
the comment kept; an agent's proposed edit applied and another dismissed; an earlier text opened and put back; the
keys screen equal to the key table, row for row; a component's example drawn), and W7's (on a scratch outline the
bundled Waiting extension installed from the bar's own row, its screen used, its setting changed in its form,
removed by an agent's act; then a switch to a second outline of the same host and back), RW's (the default-on what-changed extension's `change` run about the reader's note: the note the service asks for opened by the open action as the person and as an agent, and the comparison said not drawn), H1's (two lines pasted with a carriage return between them saved as two lines and served as two picture parts, Tab on the second, and the five values a heading's pattern has listed with each one's own words, the lit one's drawing and the count), and the tree's folds (beds
with only a comment, only a proposed edit and both under them drawn with no mark, the one with a note among them
unfolded onto it, and the window's reader empty until a note is opened). `cargo test --release measure_a_long_block -- --ignored --nocapture`
prints what a key costs in a long block (PROBES.md §12).

`src/tests/terminal.rs` is W8's over a scripted host (`src/pty/canned.rs`: a made-up shell that plays a script, so
a row is the same every run): a row cut where a wide character sits, each piece on its column and a ground as a
rect; keys into the program and its rows back, the window's own chords the program's until `ctrl+]`, and the
window's again after; a size, the scrollback and a paste; an agent detached, listed with no tile and jumped back
to by its row; the next launch attaching to what herdr-core kept and starting over on a plain pty; a close ending
a program and nothing it did not start; a tile torn into a second window with its program; an agent's `tile.type`
held back while the person types there, its own terminal opened without their keys; and a window with no terminal
saying so in the kind's own words. `src/tests/pty_live.rs` (`--features pty`) is the terminal's crates
themselves: the login shell on a real pty runs a made-up script (it prints lines, one coloured with a wide
character, reads a key and exits), with keys typed in the window and rows read from the emulator; and "a shell and
an agent, detached and found by the next launch" as two launches of the window (this test binary again, twice)
against a stand-in herdr-core in a scratch folder (and two more that leave no terminal tile behind: the window
that returns opens no terminal and lists what the core kept all the same), which records what it was asked: each terminal started once,
to outlive its starter at its tile's size, attached to and never typed into again, and only the one whose tile was
closed ended. `hc` itself is not run. `cargo test -- --ignored live_the_programs` holds the list to a real
service: the rows it writes are what runs, and a row's pick is the jump.
`cargo test --release measure_a_terminal_s_frame -- --ignored --nocapture` prints what a terminal's frame costs
(PROBES.md §7).

`src/tests/ext.rs` is W7's over the stand-in host: an extension installed from the bar's row, used, configured by
its form (a value refused keeps the form) and removed; what an extension's action answers done or said not done
(a note opened as whoever asked, from the answer a real service gave; a Resource, a question, words for the
clipboard, a caret's line and a runbook); a window on another machine's outline following no machine name of that
host's; a switch of outline and back to a block as it was being
written (a name nobody has refused, nothing made); a tile torn into a second window drawn headless, two links in
one store, and the control socket naming the window an act is for; a torn window that switches outline keeping
no arrangement there and its words in a file of its own; and a window closed mid-block holding nothing afterwards.

The service's side is `packages/outliner/test/notes-under.test.ts` (whether a note has notes under it, said on the row: the tree, a question's matches and a page), `packages/outliner/test/list-extensions.test.ts` (the bar's Extensions and Outlines as
lists, a rendered tile's view, a setting reaching the script its extension ships), `packages/outliner/test/draft-place.test.ts` (a patch placed for a holder that places none,
and `completion.rows` for a text and a cursor), `packages/outline-core/test/draft-patch-place.test.ts` (whether a
patch may land in a live draft: the door's rule and the service's), `packages/outliner/test/notes-page.test.ts`, `test/component-pages.test.ts` (each component's
example page, `outline-core/fixtures/component-pages.json`), `test/screens.test.ts`, `test/lists.test.ts` and `test/about-lists.test.ts` (one test a
list producer) and `test/screens-extension.test.ts` (the extension installed, forked and uninstalled); the block form
of a screen note is `packages/outline-core/test/screen-note.test.ts`. The shapes an extension's author writes against
(an action's row, a list's rows, the view primitives) are written out from the source as
`outline-core/fixtures/extension-types.d.ts`, kept true by `outline-core/test/extension-types.test.ts`.

Dark is the look the pictures here show. The theme follows the system's, and the same note drawn light is the
proof it switches:

![The same note as above, light: the theme follows the system](docs/note-light.png)

Rune renders headless, so a change can be looked at without a display, on a scratch outline. The headless flags
are a debug build's: Rune links them into a release build only with its `tooling` feature, which this crate
leaves off, so `target/release/ep0ch-native --snap …` ends saying so.

Most pictures on this page were drawn on the Rune pin before `a5360a6`. A render made now has the same boxes and
the same words, and differs at the edges of its letters: on Linux a hinted face's rows now land on whole pixels
([PROBES.md §18](docs/PROBES.md#18-rune-at-a5360a6-r0) has the two side by side). A picture is drawn again by the
wave that changes what it shows, on that wave's own scratch outline.

```sh
target/debug/ep0ch-native --snap out.png --scene bar --theme dark -- --ws scratch
target/debug/ep0ch-native --snap out.png -- --ws scratch --act steps.act
target/debug/ep0ch-native --tree tree.json -- --ws scratch
target/debug/ep0ch-native --snap out.png -- --ws scratch --screen garden-work   # opened on a screen the outline has
```

![A saved custom screen: two readers, the tree in a tab with the backlinks](docs/screen-dark.png)

![A reader closed: its note stays on screen, in the reader its opens were wired to](docs/heir-dark.png)

![A fold's mark opens onto notes: the bean rows, with only a comment and a proposed edit under them, have none, and the folder the open note is in is unfolded; the reader told no note is empty, in its kind's own words](docs/caret-dark.png)

![A close the layout refuses: the notice names the way out by this window's own key](docs/ways-dark.png)

![An extension's action answered more than words: the note it asked for is opened, and the comparison this window doesn't draw is said in the notice, not claimed](docs/acted-dark.png)

![A tile held by its title: every tile shows the places it would take it in, the one under the pointer lit, the held tile dimmed, and the foot says what is held, where it would land and the key that lets go](docs/drag-dark.png)

A scene is a file of act lines, `scenes/<name>.act`: `arrange`, `bar`, `edit`, `find`, `query`, `screens` (each opens the
outline's first note by picking the tree's first row: a window opens with its reader empty), `board`,
`navigator`, `lastcall`, `table`, `keys`, `library`, `screenkeys` (a screen with keys of its own, which `about.seed.ts` saves as a note),
`complete` (a block of `parts.seed.ts`'s being written with a property's name begun and the second row lit: the list under the token's start, its card beside it, the rest of the row after the caret), `complete-values` (a heading pattern's values, each row with its glyph track, the lit one's card a band), `complete-component` (a component chosen by keys: run it with `--script scenes/complete-component.keys.json --at 2` before the first `--`, a Rune script that types Return, `::graph-met` and Tab, since an act line holds no line break; the skeleton stands with its first stop selected),
`terminal` (a shell and an agent beside `parts.seed.ts`'s note, their programs a made-up shell: run it with `--programs scenes/terminal.programs.json` after the second `--`, the script a scripted host plays, since a headless render has no pty to wait on),
`heir` (two readers `about.seed.ts` saves as a screen, the first's opens wired to the second: the first is closed and its note stays on screen in the second),
`caret` (the same screen with the seed list opened in the first reader: the way to it unfolds in the tree, the bean rows beside it have no fold's mark, and the second reader, told no note, is empty),
`drag` (the tree held by its title over the second reader's upper middle, by `layout.carry`: the zones every tile offers, the lit one, the held tile dimmed; `layout.drop` would land it),
`headings` (a note `parts.seed.ts` writes: headings and a rule that name a style and a line that declares one, drawn without the properties that style a line, with its properties listed beside it),
`ways` (a reader a block is being written in is asked to close: the layout's refusal is the notice, its way out said by the key this window binds; an agent's resize under the typing is told the act that gets the person's attention here; `parts.seed.ts` writes its note),
`extensions` (the kitchen screen with the bar on the extensions), `settings`
(Waiting's screen and its settings form), `window` (a tile torn out: run it with `--act scenes/window.act --torn
reader` after the second `--` to draw the second window, since a headless run opens none), and `plan`, `figures`, `callouts` (which open notes of the showcase outline by
title), and `parts`, `links` and `draft` (notes `bun scenes/parts.seed.ts <a scratch host's socket> <outline>` writes: figures, a
box, a live list, two buttons, the first pressed; a note whose `::links` and the links tile beside it list the
same groups; and a note written in place, with a name begun and an agent's edit landed above it), and `about` and
`pictures` (notes `bun scenes/about.seed.ts <socket> <outline> <a scratch folder>` writes: a note with three texts
behind it, a comment thread on words of it and an agent's proposed edit beside it; and a note with a header image,
pictures it draws into the folder, an svg fence and a mermaid fence), and `quote` (a note the same seed writes, its
words across a link, a reference and bold text: a comment already anchored to the source such words were drawn from,
and one begun on words picked as a selection says them), and `margin` (a note the same seed writes with two comment
threads on words of it: the passages marked, the first thread opened beside its words; draw it wide, `--size 1760x900 --at 0.5`,
for the margin, since the tiles' area is measured on the first frame), and `inplace` (the same note with words of its list picked and a comment begun on them: the field stands in the note's one part, under the list), and `acted` (the same seed's note in the kitchen's reader, and the default-on what-changed extension's `change` run about it by a line: the notice says its words and what of its answer is not done here). `--act <file>` runs any file of them before the
first frame; a line that says who (`as=tidy-agent`) runs as that agent. A Rune `--script` taps by element key: a tile's parts are under `tile/<name>/` (`tile/reader/edit`,
`tile/reader/save`, `tile/reader/child/<id>`, `tile/reader/part/<n>` (a part's frame),
`tile/reader/part/<n>/view` (what it draws: its button), `tile/reader/part/<n>/<id>` (a row of its list, by the row's id: the note it opens), `tile/reader/part/<n>/group/<name>` (a group's header),
`tile/reader/part/<n>/said`, `tile/reader/chip/<key>/<value>`, `tile/<name>/bar` its title, `tile/<name>/close`; in
a list `tile/<name>/row/<id>`, `tile/<name>/group/<group>`, `tile/<name>/lane/<group>`,
`tile/<name>/column/<column>`, `tile/<name>/facet/<key>/<value>` and `tile/<name>/narrowed/<key>/<value>`), in a
block being written `tile/reader/source` (its field), `tile/reader/save`, `tile/reader/done` or `tile/reader/discard`,
`tile/reader/told` (who changed it), `tile/reader/held`, `tile/reader/on` (what a comment or a reply is on), `tile/reader/on-problem` (why its words are no passage of the note), `tile/reader/editor` (the field's frame, where it stands in the page), `tile/reader/picked/<act line>` (an action of the words picked, by them), `tile/reader/mark/<thread>/<part's line>/<n>` (the words a thread is on, a line of them), `tile/reader/card/<thread>` (the thread beside them; its line `tile/reader/margin/<thread>` folded and `…/head` whole, its own presses `…/press/<n>`) and, for the list that completes a word, `tile/reader/complete` (its box), `tile/reader/complete/row/<n>` (a row, from 0; its sample `tile/reader/complete/sample/<n>`, a section's header `…/group/<n>`), `tile/reader/complete/foot` (its `…/count` and `…/keys`), `tile/reader/complete-docs` (the card), `tile/reader/complete-at` (the mark it hangs by) and `tile/reader/complete-rest` (the rest of the lit row, after the caret); in a
list whose rows hold more than a line `tile/<name>/row/<id>/head` (the row's own line), `tile/<name>/row/<id>/press/<n>` (a press of its own) and
`tile/<name>/row/<id>/view` (what it shows under itself: a change's lines are `…/view/line/<n>`), in a terminal `tile/<name>/screen` (its screen), `tile/<name>/row/<n>` (a row; its pieces `…/at/<column>`, its grounds `…/ground/<column>`, the cursor `…/cursor`), `tile/<name>/kept` (what keeps its program), `tile/<name>/report` (what it reports of itself) and `tile/<name>/do/<act line>` (its buttons); a
toolbar button is
`tool/<its act line>`, a border `grip/<split id>/<n>`, and the bar's are `bar/field`, `bar/row/<source>/<key>`,
`bar/facet/<key>/<value>`.

## Not here yet

- Tiles: four drawers (`page`, `list`, `view`, `pty`). The terminal is behind the `pty` feature, and what it
  leaves out is under [The terminal](#the-terminal). A tile's own level for agents (`tile.agent`) has no chip on its title,
  a pinned reader has no action (`reader.pin`: a reader's mode is its own field, and no layout operation sets one),
  a float is sized by `float.place` and has no corner to drag, and a zoom is not said on the tile (the key again puts it back).
- Lists are pressed, not walked: no cursor row moved by keys in a list tile, no `/` filter over its rows, no
  preview beside the picked row. Lanes share their tile's width (they don't scroll sideways), a card isn't dragged
  between lanes, and `grid` is drawn as rows. A tree lists at most a thousand rows and says when there are more.
- The board here is the matches of one question in lanes; the door's own board (a hub's views as lanes) and its
  desk (its named layouts) are still the door's, under the same names.
- A refusal of the layout's names its way out as an act, and the window says it in its own keys (`Ctrl+E enters
  it`, `Ctrl+Shift+L in it unlocks it`, `layout.policy closable=true node=screen turns closable on`). The lock, a
  container's policy, the fold, the float, the move and an agent's level are rows here since wave H2. What is
  still no row here reads as its reason alone: a flow's wide place (`tile.widen`), a dock's own slide
  (`tile.slide`), a pinned reader's pin (`reader.pin`), and what belongs to the door's drawer and its lifts.
- A dock that slides over the layout is drawn where the layout says, without the door's tab strip along its edge.
- A held tile: the place under the pointer is found by the cell (8 by 18 points), so a title's row is the first
  18 points of its 26 and the band under it starts inside the title. A group (a screen in a tile) takes no tile
  dropped into it, and no part of a note is dragged out of a reader (the door's `element.detach`). No tile kind
  here takes a tile's content (the door's shelves), so the rule's `receive` is ported and never asked.
- On a Mac: the toolbar starting past the traffic lights was built from Rune's source and run here by telling a
  headless runtime the inset a Mac's window reports; it was not run on a Mac. The toolbar is no drag region of its
  own (AppKit's title bar band moves the window). A torn-out window has the same row over its tile and starts
  past its own buttons by the same rule, held by the same test and run on no Mac either.
- The status line on a full toolbar: on the desk in a window 1180 points wide its room is about a dozen characters,
  the start of the agent's name; the act and why it was refused are read on a hover. The window keeps no log of
  what it said once it has gone.
- Windows: a torn-out window isn't opened again at the next start (its unsaved text is: the first window brings
  it back) and has no toolbar of its own (the bar is its `mod+k`). Its tile goes back into the window it came from
  along that window's right edge, by the layout's rule for a new tile: it is not dropped at a place chosen across
  the two windows (that needs both windows' frames on the desktop, `Drag::screen_point` and
  `WindowHandle::placement`, which no headless run has). A held tile's drag outside the window, the put-back, and
  everything above about a hold were run on Linux in headless windows: none of it was run on a Mac or on a display.

- Writing: a block is its whole source in one field, as typed: nothing is drawn of it until it is saved (no
  preview beside). A long block types as fast as its frame draws since the pin moved: Rune lays out the paragraph
  a key changed, not the field (6.7 ms a key at a thousand lines, 13 ms at three thousand, where it was 38 and
  113: PROBES.md §12). The editor's own keys (undo, word motion, select all) are Rune's and have no act line; Return
  types a line and continues no list (the door's `draft.newline` does). A completion row for an anchor on a
  heading or a new component (each needs more than one request and a check between them) isn't offered, nor are
  a row's variations, the copy of a component's source or the jump to an agent's definition; the list shows what the service sent, with no Jev
  re-ranking asked, and its docs don't scroll. A value whose look a primitive draws (a
  heading style's pattern) is drawn, in its row and on the card: the `band` and `track` primitives draw a glyph
  track's cells as small boxes (the door's rule for which cell holds what, ported in `band.rs`; no contract table
  holds the two together yet). A page still draws a styled heading as a plain one: `notes.page` serves no `band`
  for it. A note's line that holds only properties (`[ctx::…]` under its title) is still drawn as a paragraph of
  those tokens: `proseMarkdown` keeps a property that styles nothing as the note's words, and the page's walk has
  no part for a line of properties. A picture on the clipboard isn't
  pasted as a file (the door's `draft.image`): a paste is its words. A save refused because the note changed keeps the text and says so,
  and offers no merge. An `@agent` line typed in a draft is told to the service once the keys go quiet (`drafts.touch`);
  what an agent answers there was not run in this wave, and no progress is shown on the line. A draft stays in its tile: closing the
  tile is refused until it is closed, a tile takes one thing being written (a comment waits for the block's edit to
  close, and the other way), and a card's draft is not built.
- Comments: words one part of a note draws twice can't be told apart by a selection (the window knows the part a
  selection is in, not where in it), so such a comment is refused with why until a few more words are selected; and
  words a part shows that the note's text doesn't hold (a figure's numbers, a list's rows, another note's text
  embedded) are no passage of it. A drag that starts on a link's label selects nothing (the press is the link's):
  a selection across a link starts beside it. A press in the gutter left of a line starts no selection either (Rune's
  text is selected from a press on it), which is why a selection is asked of the service as whole words. A thread on
  words of the note's first line (its title, its chips) is marked nowhere on the page, and one on a figure's own
  lines marks the figure whole; a press on marked words is asked of the box each line of the mark was last drawn
  in, so the unmarked start of a marked line that wraps opens it too. A thread's card stands beside the top of
  the part its words are in (under the part in a narrow reader), not beside the words themselves: in a run of prose
  longer than the reader the card of a thread far down it is out of view until the page is scrolled to the part's
  top (its end, when narrow), and the Comments tile is where it is read meanwhile. The actions offered by a selection are this
  window's own rows (Comment): an extension's actions for a passage (Marginalia's highlight, define, cite: the door's
  `a` then `h`, `d`, `k`) are not offered or bound here yet. A posted comment isn't edited here, nor a thread marked seen or kept; highlights and
  the agent that answers in threads have no press. A reply is written in the reader, not in the list.
- Proposals: a proposal that also makes or moves notes says how many such changes it holds and doesn't list them;
  "resolve against the note now" (the outline agent's) has no press here.
- Revisions: one is opened against the note as it is now, never against the one after it; the list isn't walked by
  keys (older, newer), and a change opens under its row rather than beside the note.
- The keys screen lists the rows' own keys and the open screen's: nothing is rebound there. The library draws each component's one
  example, not its properties one value at a time, its grids or every combination.
- The window draws no list of agent sessions: the service keeps none to list (the door reads them off its own
  terminal tiles).
- Figures with no primitive form yet (`uptime`, `activity`, `calendar`, `quadrant`, `flow`) show their lines as
  written, and a live `tabs` with nothing in it the service's Markdown; a view draws as rows whatever its layout; a
  `::use` shows its line (a template's body isn't walked yet); an extension's component shows its source; a
  property written in prose stays as written. A button with an empty slot (the part's `needs`) says what to write and doesn't ask for
  it; one whose look word isn't read says so and still runs; a button inside a list item draws as a part between the items. `docs/prim-coverage.md` has each.
- A list in a note has no filter, selection or preview pane, and its lanes show eight rows each and scroll the
  rest; a row that copies or inserts is words, in a note and in a list tile alike. A heading
  style's band, glyph track, tone and lettering aren't drawn: a heading that names a style is drawn as a plain
  heading, without the properties that style it (the service says no style a page could draw yet).
- Pictures: text inside an SVG isn't drawn (Rune rasterises without fonts); a header image crops to its middle
  (`hero-focus`, `blur`, `tint`, `fade` and a title over it aren't read); artifacts and video stay as written;
  a view's card covers and pictures in properties aren't shown.
- Outlines: a window on another machine's outline lists that host's outlines, so this machine's are reached from
  there only by the name left on the toolbar (an outline this window was on), and an outline that host lists on a
  further machine not at all: both are refused with the launch that opens them from here (`ep0ch-native -- --ws
  <name>`), since no link to this machine's own host is made from such a window. A machine that doesn't answer is
  listed from the copies kept here and can't be switched to. A new outline isn't made from the window (`ep0ch
  outline create`).
- Extensions: an extension's own bar source isn't listed in this bar (its rows carry no act line yet), its
  actions have no row there either (a line runs one: `extensions.act id= action=`), its
  secrets are said in the form and set elsewhere, and a schema that isn't an object of named fields has no form.
  Of what an action may answer, a Resource to open, the note's last change drawn beside it, a line put at the
  caret and a runbook are said and not done here, and a question it asks first has no button: the notice says the
  line that says yes.
  A kind that runs a program is a terminal tile, in a window built with its terminal.
- A connection keeps at most 64 watched answers (the host's bound): the page, the bar's query and one per unfolded
  folder. Past the budget an answer is read unwatched and registered when a key is free (`peek` says which).
- Keys are the rows' defaults and the open screen's own (its spec's `keys`, asked first while a tile has the keys);
  the person's `keybindings.json` isn't read yet, so nothing is rebound and the keys screen lists no key of
  theirs, and a button's keycap is its row's default even where a screen binds another key to the same line. A
  screen's key named with Hyper is listed and has no chord here.
- With the screens extension uninstalled the window says there is no screen to open on, and opens when it is
  back (the bar's Extensions installs it).
- After its own write the window reads what it shows at once rather than waiting for the watch to say so.
- The bar's list bounds itself to seven rows (`list::bounded`): `rune-kit`'s `Dialog` doesn't bound a scroll view in its body.
- Windows: the socket is a Unix one. (Rune's own patches, `wgpu-hal` among them, are in `Cargo.toml` since R0.)
- A quit drops what the run holds (`rune::orderly_exit`): the control socket leaves its folder as it is dropped.
  Rune's faster default, which ends the process at the quit's last hook, would leave the file behind until the
  next launch; the socket's removal is not a quit hook yet.
