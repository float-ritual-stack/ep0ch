# Changelog

Notable changes to ep0ch, for the people who use it: what you can now do, what changed, and what you must run.
One file for the whole repository (outline-core, the outliner, the door and the Claude mod). The project is
active dogfood: the protocol and the schema still change, one version at a time.

Before the two repositories became one (October 3, 2026), the door kept no changelog; its merged pull requests
are its record. The outliner's entries from then are kept below, under
[Outliner, before the one repository](#outliner-before-the-one-repository).

## [Unreleased]

### A drawer Claude is its own session, and a program with no tile is listed and put back (PIE-1432)

- **Its own name:** the door drops the Claude settings it inherited (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_JOB_DIR`, `AI_AGENT`) when it starts its terminal host and every tile, so a Claude started in your drawer shows its own name and saves its transcript.
- **Where you left it:** a tile you dragged out of the drawer comes back on that screen after a restart; the old drawer-only key and its conversion step are gone (PIE-1332).
- **Never lost:** a program the terminal host still keeps with no tile shows in the agents tab (alt+g) as "no tile" with when it last wrote, and ⏎ puts it back in a tile, the same process.
- **Run:** nothing beyond the usual `ep0ch install --apply`.

### A dropped connection leaves the terminal clean (PIE-1429)

- **`ep0ch door`** carries the ssh door (`ssh ep0ch`) in this terminal and gives it back clean however it ends, a
  dropped link included: no mouse codes over the screen, the normal screen back, and one line with the command that
  reattaches. `ep0ch door gurgle`, `ep0ch door ep0ch fern` name another login or outline. `ep0ch --remote` does the same.
- **A dead link ends in about a minute:** both send ssh keepalives instead of freezing until TCP gives up.
- **"float-2 via ssh" is said once,** when a command starts the forward, not on every call (`EP0CH_VERBOSE=1`: every time).
- **The ssh door's script is in the repository** (`packages/door/scripts/ssh-door.sh`): it logs a hangup, and resets
  the terminal when the door client crashes.
### The door's tests pass together as alone (PIE-1412)

- **For builders:** a door test file that leaves a scratch host running or an extension list bound is named
  (`test leak: <file> left behind: …`) and fails the run; the shared teardown between files puts the rest back. The
  tests that failed only beside other files, or only on a loaded box, now hold: the power bar's extension actions,
  the kitchen sink's panes and regions marks, the kettle's close click, the no-op repaint count, the copy-ref and
  motion checks, and the drawer program's handovers.
- **Run:** nothing.
### Back goes back in every tile, whichever tile changed it (PIE-1426)

- **A preview steps back through what it showed:** a pick in the links tile, a link opened up top into it, a source
  tile's selection: each is a stop, so alt+← in the preview goes to the one before, in order.
- **Browsing is one stop:** a run of j or k through a list is one stop, so Back goes to what the preview showed before
  you started, not through every row you passed.
- **Giving a list the keys changes nothing:** Tab or a click into the links tile (or a query tile) leaves its preview,
  and the preview's forward, as they were (an empty preview still fills); a new selection still shows.
- **The links tile goes back too:** after `b` (or its home moving) lists another note's links, alt+← (or `tile.travel
  tile=links`) lists the one before; its hint says where back goes.
- **One history a tile:** a reader's back and forward and the links tile's are one shape (`Pane.trail`), so the trail
  lists either. The kitchen sink's "back anywhere" section is Evan's layout to try it in.
- **Run:** nothing beyond the usual `ep0ch install --apply`.

### The river at 40 columns, smoothed: floats keep the keys, words show (PIE-1418, PIE-1392)

- **Esc in a float keeps the keys there** (it gave them to the hidden column under it, so `x` closed that column). With
  nothing left to close it says `nothing to close · x closes the float`, and the float's hint row leads with `x close`.
  Tab, a click or h/l still move the keys out. *What moves:* Esc no longer hands a float's keys to the tile under it,
  on every screen.
- **The power bar at 40 columns** shows a long query whole, or scrolled sideways with a `«` where its start is off the
  line and a `»` where it goes on; home brings the start back. Every one-line field scrolls the same way.
- **A button that can't run here says why in plain words:** a sequence whose first step names no tile on this screen is
  drawn dim and refused before it runs (`Fold the bottom can't run here: no tile is called links on the river`); one
  that stops midway says `Pipe stopped at step 2 of 4: …`. The person reads tiles by name, never by id; Sources keeps
  each run step's spelling (a press refused before it runs leaves no run there).
- **The trail follows you across columns:** from any river column it is the one chain of opens, back and ahead, and
  forward goes to the column opened from this one. Read's `n` and `p` leave a trail too (back, alt+T).
- **On the web:** an error page has a way back to the outline (or the share's first page), and the trail's rows read as
  links.
### Nothing decided quietly disappears: the groom's cut keeps, and later gives back (PIE-1421)

- **`ep0ch work groom --park`** is the cut: queued items untouched for `--older-than` (30d) go to later with
  `[wreckage::<day>]`, except high priority, under 14 days old, or decided (a ticked `- [x]`, a decided
  `::graph-decision`, `[decided::]`). Each kept one says why. `work stage … later` by hand warns the same way.
- **`ep0ch work groom --later`** is the way back, weekly: a parked item someone commented on, a note made since names
  or links (Jev reads it: asked for, or only cited?), or live work links goes back to queued with a
  "**Back from later, <day>:**" line naming the note. One parked against the keep rule is listed with its restore
  command. Then the groom's pass runs over what stays, so a shipped one gets its comment. `--apply` writes it.
- **The count is a query:** `type=groom-later outcome=restored created >= -7d`, on Jev's suggestions page and for the build log.

### The keys window and the trail are tiles you resize, dock and close; ⏎ runs a key; Conflicts are real (PIE-1425)

- **`?` opens the keys window as a tile beside the one you're in** (below it when that one is narrow, so both keep
  their width) on the desk, the board and the river: drag its
  border, dock it, `esc` or `q` closes it and the keys go back where they were. `?` again goes back to it.
- **`⏎` runs the selected row** where you opened the window, as its key would there (a second click on the row too).
  One that needs arguments (`^W o` opens a tile, which kind?) asks for them in the power bar's form.
- **Conflicts lists only keys that really fight:** two rows of one key table on one key, or one key given twice in your
  `keybindings.json`, each saying which one runs. Today's built-in keys have none (it said 176: esc clearing then closing
  the power bar, alt+Q starting or stopping a recording, were counted as clashes).
- **Every row reads as a whole sentence:** the action's own words, then where or when ("start recording, while
  recording"), never a fragment like "then macro.stop". The power bar's typed lines (`> share.list`) aren't listed as keys.
- **A fourth tab, Unbound:** every action you can run that no key reaches on any screen, by where it runs, with its
  count. `r` gives one a key (what that key does now is said first), `⏎` runs it.
- **The trail (alt+T, `≡ trail`) is a tile beside its reader too:** dock it to the side and it follows the reader as
  you walk; `⏎` or a click on a picked stop goes there, `esc` closes it. A screen without tiles still lists it over itself.

### Undo never takes back what's saved (PIE-1414)

- **ctrl+z stops at the save:** in a note you opened again after saving, the first ctrl+z keeps the saved text and says "saved · ctrl+z again undoes past the save (revision N stays in its history)"; a second press after a pause goes past it. A held key never crosses a save, and an agent's undo never does.
- **Everywhere you type:** a reader, a float, the river and comments share the one editor, so the same holds in each.
- **Run:** nothing beyond the usual `ep0ch install --apply`.

### Your door stays quick with a board and a live query open while a bulk job runs (PIE-1413, round two)

- **What you'll notice:** with a board tile and a query tile on the Desk during a backfill or an import, reading a
  note and saving answer in tenths of a second, nothing in the door times out, and every tile shows what the
  outline says once the job ends. Measured from the door's own side on a private copy of pie (the person's note
  reads and saves, p95 / max, ms):

  | while | before | after |
  |---|---|---|
  | an ordinary day | 1560 / 1560 | 77 / 77 |
  | a backfill writes its records | 15067 / 15165 (835 requests timed out) | 156 / 419 (none) |
  | an import writes notes | 15057 / 15057 (1,524 timed out) | 135 / 138 (none) |
  | after the import is stopped | 15070 / 15070 | 119 / 119 |
  | the board and query tiles match the outline after | 1 of 8 | 8 of 8 |

- **Why the first fix wasn't enough:** a ping on a connection of its own stayed fast while the door's own
  connection starved. Its board read every one of 86 lanes after each change, on one connection, and the host
  answered that connection's requests in order, so a note read waited behind them. The activity tile's read took
  2.4 s on pie, a records read of 200 notes took 24 s on gurgle (seen live at 14:22), and a door that went away left
  its queue running.
- **What changed:** a connection's whole-outline reads no longer hold its other requests; a closed connection's
  queue is dropped; a board reads a lane once per burst of changes, one read at a time; lanes and tiles off the
  screen read behind, one at a time; the activity read takes 15 ms and a 200-note records read 0.3–0.6 s.
- **What's left:** a board lane off the screen can show the outline up to about 10 s late until it is drawn; one
  whole-outline read or watch is still a single 0.1–0.4 s turn at pie's size.
- **The harness** now runs a real door (`packages/door/scripts/bench-door-desk.ts`) and holds its own requests to
  the bar: `bun run bench:host` in packages/outliner (`--crowd` for a heavier day).

### The status bar's last rough edges (PIE-1415, PIE-1224, PIE-1410)

- **A group inside a group opens where you clicked:** More inside Tools opens over Tools, not at the left edge.
- **A message never leaves an invisible button:** the pins, `!` and `+N` kept beside it are the ones drawn, and a click
  on the bar finds only those; pins give way first, `+N` last.
- **A failed button's `!` stays its own:** deleting a line no longer moves it onto the next button, and it follows its button when lines move.
- **Right-click a note's `::button`** to pin it to the status bar: it becomes the `[ ]` position and nothing runs.

### Jev's patches, round three: buried prose questions and kept chips (PIE-1419)

- **A question at the bottom is buried** whether or not it names Evan: a line that ends in a question counts unless
  Jev says firmly it asks nothing, so an unsure or unheard Jev never hides it. Its patch moves it to the top.
- **A wall under a chip line keeps its chips as chips:** the chip line is never part of the paragraph, and the patch's
  list starts below it.
- **A stacked bullet of clauses** (joined by `;` or a dash) comes with a patch, one clause a bullet.
- **The words say what's wrong:** "a paragraph of 5 sentences (keep one to 3)" or "one sentence of 612 characters";
  a callout is "would read better as a callout", not "a callouts"; every finding leads with its fix, so
  the 44-column suggestions page reads it.

### Only the power bar answers the mouse, and it reads right at 44 and 40 columns (PIE-1407, PIE-1405)

- **Nothing behind an overlay shows through it:** with the bar open over a reader, hovering the bar drew the reader's
  byline across it. A tile's cut-short value or button now ends where the bar, a float, a menu or a toast starts, so
  the pointer over an overlay reads only the overlay.
- **The second click on a row runs it**, as ⏎ does: a click lights a row and shows its preview, the next click on it
  runs it, however long between (a double click still does).
- **A pasted link reads on the line at 40 columns**, the field scrolling sideways to the cursor instead of showing its
  last few characters; the count takes what's left.
- **A lit row's name stays put at 44 columns:** only its detail scrolls.
- **Copy command copies what the row runs:** a tile's `tile.focus tile=<it>`, a screen's `screen.open`, an
  extension's install or remove; a note's row says its menu copies its reference.
- **Rows say themselves:** a script reads under its own name with its own words (no `ext.script-…run`, no "neat ·
  neat:"); a pasted id that isn't here is named once, on one line; Jira's install row says what it does.
- **Run:** nothing beyond the usual `ep0ch install --apply`.

### A chat's "what changed lately" is real work, and says what it left out (PIE-1427)

- **Fetched notifications are machinery:** the notifications hub stamps each one `[machine::notification]`, so lists,
  `ep0ch find` and a chat's orient read leave them out; its boards say `[machinery::show]` and keep their cards.
- **The count:** `outline_query` (claude.ai, ChatGPT, Grok) and the mod's `outline_find` answer a recent-activity
  read (`updated >= -1d`) with `machineryOmitted`: "212 notifications and bookkeeping notes left out", by producer.
- **One word brings them back:** `machinery: "show"` on `outline_query` (new) or `outline_find`; `"only"` with
  `machine=notification` asks for just the notifications.
- **Run once per outline that has the hub,** on its machine: `ep0ch machinery backfill --ws <name> --apply` stamps
  the notes and boards an earlier version wrote.

### The keys window: every binding, what it shadows, and a rebind said before it lands (PIE-492, PIE-1048)

- **`?` on any screen opens it,** filtered to where you are (`in:note` in a reader); `ep0ch --screen keys`,
  `keys.open` and the power bar too. Type `/` to filter by a key, an action, a scope or words; `Bindings 1350 ·
  Conflicts · Yours` with a count, each row a keycap, its scope and what it does.
- **Help on the main menu is `H` now** (`?` there is the keys window); its key line says `? keys H help`, each a click.
- **The detail says what the key runs, its layer, what it takes the key from and what gets it first,** and whether a
  program in a terminal tile still sees it.
- **Rebind:** `r`, then the new key (`^W` then a key for a ^W key). What it would take from what is said first; `⏎`
  saves it, `esc` drops it. `u` unbinds, `d` gives the built-in keys back, `ctrl+z` undoes. Agents: `keys.rebind
  id=tile.close key="^W x" to="ctrl+w q" tile=keys`, `keys.find text=…`.
- **One keymap file:** `keybindings.json` in the door's state dir, `{"<act line>": ["<key>", …]}` (the outliner's
  shape; `[]` unbinds). Edit it by hand too: the door reads it again within half a second and says a bad entry.
- **What follows a rebind:** the key itself, the ^W panel, the tile menu's keycaps, the power bar and the desk's hint
  row (`^N new` becomes your key). A key you moved away says where it went instead of running.
- **An action's keys are rows of keys and what each does** (PIE-1048): its page's keys table draws right
  (tile.collapse's no longer reads "or" under the wrong key); 157 garbled ones were rewritten.
- **Not yet:** the hint rows written by hand on some screens still say the built-in key; a key bound to several
  meanings under one name (^W h j k l) or after another key (`a then c`) can't be moved alone, and the window says so.
- **Run:** nothing; no protocol or schema change.
### Send to ep0ch from your phone in one tap (PIE-1408)

- **One link, one tap:** open the Send to ep0ch page on my.ep0ch.sh on your iPhone, tap Add Shortcut, and "Send to ep0ch" is in your share sheet; a PDF or photo you share to it lands as a card in today's note. The Shortcut is signed and carries its own device link, so there is nothing to copy or edit.
- **Run:** nothing beyond the usual `ep0ch install --apply`.
### @loki in a comment reaches loki, and stays on its list until it answers (PIE-1404)

- **Write `@loki …` (or `@daddy`, `@kitty`) in a comment on any note,** from the door, a web page on your phone or
  another agent: that persona's live Claude sessions hear it within 30 minutes, with the note, the words and who
  wrote it, yours first.
- **It stays on the list** in every wake until the persona replies in the thread or the thread is resolved; a session
  started later hears what's still open within a minute of starting.
- Nothing to run: it ships with the Claude mod (`ep0ch install --apply`).
### A bulk job never freezes the host: your door answers at once while thousands of records are written (PIE-1413)

- **What you'll notice:** a write-review backfill, an import or an agent's bulk writes no longer stall the outline
  host. The door's ping, a note read and a save answer in tens of milliseconds while it runs, and nothing catches up
  in a rush when it stops. Measured on a private copy of pie (ping p95 / max / longest stall, ms):

  | while | before | after |
  |---|---|---|
  | an ordinary day (clients re-reading after each write) | 1800 / 1911 / 1710 | 31 / 66 / 0 |
  | a backfill writes its records | 5272 / 7004 / 4502 | 61 / 311 / 271 |
  | an import writes notes | 7458 / 7458 / 2130 | 53 / 240 / 235 |
  | after the import is stopped | 657 / 657 / 1224 | 23 / 111 / 0 |

- **Faster jobs too:** the backfill finishes (297 notes' records in 43 s; before, 44 in two minutes), and an import
  writes 1,503 notes in 8.5 s where it wrote 55 in a minute. A note read, a query and a save on an ordinary day went
  from 1.8 s, 2.8 s and 56 ms (p95) to 41, 74 and 34 ms.
- **Why it froze:** every write threw away the whole-outline graph (~200 ms to read again on pie), a job's own
  requests ran back to back without letting anything in, each watch pass ran every watch at once, and the routing
  rules, script sources and the waiting-on-you list were read again after every write.
- **How it's fair now:** a write patches the graph; the service's own requests and each watch take a turn on the
  loop; the next turn goes to whoever used the loop least lately; those lists are read only when what they read
  changed. No job throttles itself and no client changes.
- **What's left:** a single whole-outline read (a 200-row view, the backlinks of a busy hub) is still one turn of
  0.2–0.4 s at pie's size, so a ping can wait that long once, never seconds.
- **The harness:** `bun run bench:host` in packages/outliner measures it (ping p50, p95, p99, max and the longest
  stall per phase); `scripts/box-test host-bench` runs it on float-box, and CONTRIBUTING's review checklist asks a
  bulk or subscription change for its fan-out, its count at pie's size and that measured proof.

### A patch applied as written leaves nothing to fix, and a backfill rerun costs nothing twice (PIE-1402)

- **The buried question's patch:** its box is its own paragraph, the text under it stays out of it, and on a note whose
  chips sit on the line under the title, the box goes below them.
- **A wall's or a stacked bullet's patch** splits at sentences, never commas; a sentence too long for one bullet comes
  with no patch, and the finding names it.
- **Twins and the groom give one answer:** the groom asks the filing's same-work question and reads it the same way
  ("maybe the same work as PIE-n" in the band where Jev is unsure).
- **A live check's chooser says what each choice writes** (`Mark done · jev::right`, `Reject · jev::rejected`).
- **The backfill:** a note Jev read and said nothing of is kept as quiet, so a rerun asks only about what's new; a
  run keeps one row; its records look the Records page and templates up once. The host's own load under a backfill
  is PIE-1413's.
### A note written in the river opens with its text, and neat speaks plainly (PIE-1403)

- **Reopened, it shows what you wrote:** a note written in a float over the river, saved and opened again from the
  power bar showed "(empty)" until the door restarted. An open now takes the newest copy on screen, and the screen's
  current note is read again when it changes.
- **x closes a float over the river**, as it closes a column there and a float on the board.
- **The power bar says "no matches"** when nothing matches what you typed, and never stays on "notes…" once the
  search has answered.
- **neat from the power bar works** as it does from its button: your own run of a script acts as you, the way a
  press does. From a float it puts other floats back and folds them; a step it can't do is said whole, in the
  door's words, and its line names your notes, never tile ids. Typed as its row reads, `run neat` lists the run
  row first, before any note named Neat.
- **The ▾ at a heading's words folds it** on a click, as the gutter's ▾ does, at 38 columns too.
- **Run:** nothing beyond the usual `ep0ch install --apply`.

### The trail: where a reader has been, and straight back to any stop (PIE-208)

- **In a reader or the river:** `alt+T`, the `≡ trail` beside `← back`, or the tile menu lists every stop back and
  forward by title, the note shown lit. ⏎ or a click goes straight there; `← back` and `forward →` walk the same trail.
- **On the web page:** `≡ trail` at the end of the breadcrumbs lists the notes this tab opened, newest first.
- **Agents:** `act trail` reads the stops (it opens nothing); `act back steps=2` goes two at once; `ep0ch.trail()` on a page.
- **Run:** nothing extra; `ep0ch install --apply` as usual (no protocol or schema change).

### Approve from the phone grants what it says, and leaves the list when answered anywhere (PIE-1386)

- **The session step says what it grants:** ``allow every `touch` command for this session`` adds that one rule for this session,
  never the dialog's accept-edits mode (a tap on `touch` used to let the next `rm` run unasked), a folder or a standing
  rule. An `rm` gets only its exact command; a call no rule names exactly (`a && b`, a `*`) offers only once and deny.
- **Answered at the terminal, gone from the list:** the dialog shows in the session at once, beside the ask; answer it
  there and the note leaves Waiting on Evan within 3 s, saying it was answered in the session and whether it ran (it
  used to wait 10 minutes and then say nobody ticked). After 600 s with no answer the note leaves the list and says
  the dialog still waits in the session.
- **Which list:** pie's Waiting on Evan holds every session's asks beside pie's own `needs` notes; a `needs` note in
  gurgle or float-hub stays on that outline's list, and the ask page says so.
- **Every error page is dark:** a 404 (`/pub/p/PIE-9999`), a 502 or a busy 503 that a browser opens is the dark page
  with the same words; a page's own fetches still get plain text.
- **Run:** nothing beyond the next `ep0ch install --apply` (the publisher and the Claude mod pick it up).

### The status bar keeps your buttons: narrow bars, typos and groups (PIE-1213, PIE-1227, PIE-1224)

- **Your pins stay:** when the bar is narrow, built-ins shorten first (the drawer chip to `▲ shell`, then its arrow;
  `+3 machine` to `+3`), then built-ins drop, and only then your last pinned buttons go into `+N`. A click on `+N`
  lists what it hid by name; alt+click opens the bar note.
- **A typo costs one line:** a line of your `[status-bar::true]` note the bar can't read is skipped, not the whole bar.
  A `! line N` item says so (a click opens the note at that line), and the message log says it once with a did-you-mean
  (`drawer` → `- drawer`). Fixing the line clears it.
- **A message leaves them** (PIE-1410): a long message on the bar replaces the location, never `+N`, `!` or a pin
  on the left; they stay drawn and clickable while it shows.
- **Groups:** nest items under a list item and the bar shows its label; a click opens them as a menu
  (`status.bar.menu group=Tools` by act).
- **A list item holds a button,** in any note: `- ::button{…}` draws after its bullet and presses; the publisher shows
  its label, and `button.press` finds buttons in list items and quotes too.
### Agents work in your door while you type, and every refusal says the same thing (PIE-1294)

- **Your edit is yours:** an agent's open never replaces the note you're editing, on any screen; on Welcome your own
  pick while the detail holds an edit now opens beside it, as the desk does (it was refused). `ep0ch where` says
  "typing" while you're in an edit in a reader, not only in a terminal.
- **One wording:** a reader keeping its note says "<reader> holds an edit or a comment; it stays on its note until
  that's saved or closed" on the desk, Welcome, the brief, EchoNet, the river and the message reader.
- **What's yours alone stays yours:** access changes, handing over yolo, logging off, ending or upgrading the
  session and sending a held request are refused to an agent even on a script you pressed (`personAlways`); the
  action's page says so. An agent turns yolo off with `on=false`.
- **One record:** a save you and an agent both wrote says what was stored ("yours, naming …"), as the revision
  records it; a trash receipt and a share say who was recorded the same way (`recorded()` in the door's socket.ts).
- **Your tile keeps its size** (seen in use, Oct 29): an agent's `open` while you type lands in another reader or
  beside another tile, never splitting the one you type in; its `tile.open` beside that tile is refused, naming `to=`.
  Any agent step that would change your tile's size on screen (a fold beside it, a move along its edge, neat's
  steps) is refused the same way and waits until you're done. Your own `@name` ask still opens its answer beside
  your edit: you asked for it, and the keys stay where you type.
- **Every typing refusal reads one way:** "the person is typing in <tile>; an agent doesn't <what> · <what to do>",
  from the layout, the action rule and the draft rule alike (four forms before).
- **A short id opens:** `ep0ch open 221caa3c` (or `open id=PIE-1294`) resolves as `show` and `find` do.
- **Kitchen sink:** `ep0ch --showcase`, section while-typing.
### Jev's review and twins read right where Evan looks (PIE-1402)

- **Jev's suggestions at 44 columns:** a table of three or more columns in a narrow tile draws each row as a card, its
  title then every cell as `header: value`, three cards to a scroll; the web page does the same at phone width. Each
  finding shows the passage, what was said and what the writer did, once.
- **A finding is told once:** a writer who heard a finding on an earlier write hears it carried, so a note whose
  patches were applied ships; the record keeps the writer's words (`[needs::sysop]` stays, quoted) and the fix
  offered. "Followed" means Jev read the rewrite and didn't say it again, and a patch applied as written reads
  patched. A component code can't build is advice, never a fix; a context finding quotes the phrase it leans on.
- **Patches that leave nothing to fix:** the buried question's moves whole sentences, its chip cut at a word, its box
  its own paragraph; a wall's or a stacked bullet's long sentence nests its clauses. Compare (`label: A | B`, columns
  from the line above), decision (chosen, rejected) and word-marked check rows come as patches too (PIE-1252).
- **Mark Jev right or wrong** with the status chooser's keys (x right, `-` Reject wrong), by click too; the row
  stays where it was.
- **Twins by meaning:** a ticket filed in other words meets its original (its body is read, and deep search
  finds it by meaning); one Jev is unsure of is offered for the writer to decide; the original is named first. The groom
  calls the newer twin the duplicate and lists every open ticket with what it was read against. A ticket's
  experience is any "Evan <does> …" sentence.
- **The backfill finishes:** `ep0ch review backfill --into` sends each note's findings in one request as it goes (the
  service makes the records), a rerun skips notes already kept, and Jev's own page and rule are no longer reviewed.
- **Run:** `ep0ch install --apply` (PROTOCOL changes: a twin's verdict can be `unsure`).

### Facets answer in under a second on pie, and a docs-only deploy keeps door sessions (PIE-1396, PIE-1400)

- **Facets:** the facets read made one pass per key over every note; it now reads each note once, for the keys it
  carries, with the same answer. On pie it went from 2–7.6 s to 116–218 ms on float-2's live host, so the facets tile,
  filters and the write review's count rule answer at once, and nothing queued behind them on the connection waits.
- **Docs-only deploys keep your door:** `ep0ch install --apply` hands a door session over only when the door code it
  runs changed, and says `session unchanged: no handover (a → b changed N files, none it runs)` otherwise.
- **Run:** nothing extra; `ep0ch install --apply` as usual.
### Answer your agents from the phone (PIE-1235, PIE-1386, PIE-1383, PIE-926)

- **Approve from the phone:** a background session's permission dialog now waits up to 10 minutes as an ask note
  under pie's `[[permission-asks]]` page, whatever outline the session is bound to (`EP0CH_APPROVE_WS`; a float-hub
  session keeps its asks in float-hub), with `[needs::sysop: …]`, so pie's Waiting on Evan is the one list: tick
  `allow this once`, `allow for this session` or `deny` on my.ep0ch.sh (or in the door) and the session carries on.
  Only your tick counts (an agent's does nothing); nobody ticks, and the ordinary dialog shows. Sessions you watch show
  their dialog at once as before; `EP0CH_APPROVE_WAIT=<seconds>` sets the wait (0 is off).
- **Ticks and comments are one tap on a phone:** a step's box ticks (to do and done swap) with Undo in the toast, and
  a long press opens its other choices; every box is a 44px target. A tap on a list item, paragraph or table row
  selects its words, so Comment is the next tap: the same passage comment a selection makes.
- **Sources downloads are real files:** CSV and JSON come from `…/p/<note>/_sources/<n>.<csv|json>` with the
  source's name, behind the note's own sign-in, lock and share; on a phone they open the share sheet (Save to Files,
  AirDrop), where the browser has one. The page no longer carries every result twice as `data:` links.
- **Work IDs and references in Claude's replies open the note's web page:** `my.ep0ch.sh/pub/o/<outline>/p/<PIE-n>`
  (the origin from `EP0CH_WEB_URL`), so they work in a browser, in claude.ai and on the phone; a press in the
  terminal still opens the note in the door or Detail.
- **Changed:** `outline_read` (and `ep0ch agent read`) says who last wrote the note, as it always claimed, not who
  made it.
- **Run:** nothing beyond the next `ep0ch install --apply` (the publisher and the Claude mod pick it up).
### Search says how sure it is, finds by meaning, and the Jev pin moves only on evals (PIE-1197–1200)

- **No confident wrong answer:** a ranked search (the power bar's `/`, `[[` and `((`, `ep0ch find`, `outline_find`)
  asks Jev, in the same request as its scores, whether the note wanted is among the hits; code decides. A weak top says
  **no strong match** (in the bar's and the completer's footer, under `ep0ch find`'s rows, and in `outline_find`'s
  `search`) instead of reading as the answer; a sure one says so. Each hit carries its Score (`2.6/3`).
- **`ep0ch find <words>` and the gateway's `outline_find` ask Jev by default** (`--lexical`, `semantic: false` don't);
  the mod's `outline_find` with text alone is the same ranked search (with a property, query or subtree, text stays a
  filter).
- **Evals before the pin moves:** `ep0ch search harvest` turns agents' real searches (Claude Code's session logs, read
  only) and the note opened next, and your picks from a search, into `search-eval-case` records in pie (pie's and
  gurgle's notes only); `ep0ch search eval --into pie` ranks them with each model (cached by request), and keeps a
  `jev-run` per model and a report under pie's **Search evals** page. First run: jev-1.13.0 stays pinned (jev-1.14.0
  wasn't better); the "sure" threshold (Noul 0.8) comes from it.
- **Found even without your words (PIE-1200):** when the ranked hits hold no sure answer, `outline_find` and
  `ep0ch find` have Jev read every note's title (windows of 250, four at a time) and find the ones the words missed;
  in the power bar, a second `/` (`//words`) does it, and an unsure footer says so (`// reads every note`). Such a row
  says `by meaning`. On 16 queries asked in none of their note's words, the right note came first 3 times and in the
  top 5 4 times without it, and 7 and 15 with it.
- **Candidates read better (PIE-1199):** a search's snippet is the passage holding the most words of the query, not the
  first place one appears. The candidates-in-state shape and type/length facts were measured and not adopted: neither
  beat today's hit@1 on the eval set.
- **Costs show:** every ranked search counts on the day's `search-live` jev-run (searches, sure, no strong match,
  tokens, cost), beside the other Jev loops on Jev's suggestions page.
- **Run:** PROTOCOL 280: `ep0ch install --apply` on float-2 and the laptop.

### Paste a note's address into the power bar and it opens; copy rows first in the tile menu (PIE-1398, PIE-1399, PIE-1284)

- **Any address opens:** paste an id, `((id|label))`, another outline's `((outline:id|…))`, a line's `((id^anchor|…))`,
  an `ep0ch://` address or a note's web link into the power bar: that note is the first row, lit, and ⏎ opens it (a
  line's at that line, another outline's in its own outline). A note that isn't there says so on the row. In a note, a
  reference opens as before, and a Markdown link to a note's web link now opens the note in its `/pub/p/` form and on
  the web client's own origin too (a bare URL in a note isn't a link yet).
- **The list holds still:** typing no longer empties the bar between keys; the rows stay until the next answer replaces them.
- **The row menu by its digits:** alt+m (or a right-click) on a hit shows `1 copy note id`, `2 copy note reference`…;
  press the digit (alt+digit works too). The chips wrap onto a second row in a narrow tile instead of being cut.
- **Copy rows first:** the tile menu opens with its Copy group (the note's id, reference, web link and line reference,
  then the tile's id and reference), so they're in reach in a short tile and typing "copy" finds them together.
- **Installed reads as installed:** an extension installed as it ships (neat) no longer says "your copy overrides the
  built-in"; only a copy you changed here, or one behind the built-in, does. The status line names what was added
  (`extensions: Neat added`), never a script id.

### A deploy restarts the outline host only when the host's own code changed (PIE-1397)

- **Docs- and mod-only merges leave it running:** `ep0ch install --apply` compares the code the host runs
  (packages/outliner, outline-core, bun.lock, the root package.json; tests aside) between the commit it started on
  and the one the checkout moves to, and restarts it only when one of those files changed. Otherwise the host step
  says `host unchanged: no restart (<from> → <to> changed N files, none it runs)`: doors, panes and kitty's scheduled
  passes keep their connections through a night of merges.
- **A restart names what changed:** `1 file it runs changed from <from> to <to> (packages/outliner/src/server.ts)`. A
  PROTOCOL bump (outline-core) and a schema step still restart it; when what changed can't be listed, an update
  restarts it as before.
- **The same rule for the MCP gateway** (it runs the door, so door code counts too), and for the
  **publishers**: install now restarts `outliner publish serve` and the artifact services itself (a unit running a
  script of this checkout's packages/outliner/src), after the host, only when the outliner's code changed. The
  deployer's by-hand restart of them after every deploy is gone.
- **Run:** nothing; the next `ep0ch install --apply` decides by the new rule.

### Writing, reading and pressing work the same in the river and at 40 columns (PIE-1392)

- **The wide column is never cut:** at 36 to 44 columns the river's column you read is laid out at the width it has, as a
  desk tile is, never drawn wider and clipped under its neighbour's ▒ edge.
- **A selected row reads once:** a wrapped title in the Library (or any list) shows its first line, then the rest; the
  selection reveals only what the last line cut, never the whole title again.
- **A press in the river is a press:** a click on a `::button` in a river column runs it as a click in a reader does
  (it asked `[[undefined]]` before); every element of the river's note goes through the reader's one click.
- **A pick finishes the press:** a button's empty slots are asked in order and the last answer runs it, no second
  press. In the page picker, ⏎ on words typed takes the note they find; "as typed" is the last row.
- **neat in the river:** `tile.collapse` folds a river column to a spine (the wide place passes on, `^W W` opens it),
  so two up works there as on the desk.
- **Writing components:** ⏎ after `::box{…}` (any component with a body) brings its closing `::`; a query's values
  in completion are their words, without a glimpse of the figure's example.
### The backlog is checked by Jev, a new ticket meets its twin first, and validation starts from what to try (PIE-1258)

- **Twins at filing:** `work_create` (MCP, `ep0ch work create`, the board's new card) asks the service for open items
  like the new one (`roadmap.items.similar`: the search matcher's candidates, one Jev request, code's call). An
  agent's create with a twin is refused naming it and the two calls: `attach: "PIE-n"` adds the ask under that item
  in its words, dated (`roadmap.items.attach`); `new: true` files it beside them. Never reopens done work.
- **The person is never blocked:** the new card's composer shows `looks like PIE-n (stage) … [attach here] [file new]`;
  ctrl+s again files it new, ctrl+x a or a click attaches it (`card.attach`). With Jev off, a strong title match is
  the offer, said as one.
- **`ep0ch work groom`:** each queued ticket against the CHANGELOG, merged pull requests and the other tickets:
  solved, superseded, duplicate or open, with confidence and evidence; merged then found wrong in use is open. Read
  only; `--into` keeps `groom-verdict` records, a comment on each confident "solved" for the verifier, and the "Jev
  thinks these are done" view. Jev never closes.
- **`ep0ch work try PIE-a …`:** for a batch of merged tickets, the door's actions Jev picks (keys, `act` call) and the
  ticket's lines that say what should show; `--into` keeps a `[type::validation-plan]` note. The verifier starts there.
- **Costs on the page:** each pass is a `jev-run` (experiment `work-groom`, `work-twins`, `work-try`) with tokens and
  `cost` in dollars; Jev's suggestions page has a section for the loops. All wording is in `prompts/work-jev.json`.
- **What to run:** `PROTOCOL` is 279 (`roadmap.items.similar`, `roadmap.items.attach`, `new` on
  `roadmap.items.create`): `ep0ch install --apply` on float-2, float-box and the laptop.
### A script's empty slots ask in order, in the kind the script declares (PIE-1298)

- **In the order written:** a button that runs a script (neat's "two up") asks for page 1, then page 2, as the line
  writes them, in the note picker.
- **The script says what a slot is:** `[form-field::page note]` on the script's note, or in a file's opening comments,
  makes the question a note picker; each pick is written on the line as the note's id.

### Every agent write is reviewed, ship or fix, and Evan sees each review (PIE-1388)

- **A verdict on every write:** `outline_create`, `outline_edit` and `outline_patch` answer with `review`: `ship` or
  `fix`, each finding under Evan's rubric (dense, format, buried, unclear, mixed, context, argues, qa-for-evan) with
  where it is and the smallest fix.
- **Ready patches:** a stacked bullet split a point a line, a wall made a list, a long title cut to a name, a buried
  question moved to the top, a bare id made a reference, a list Jev
  reads as a timeline, checklist or table built into that figure from its own lines (PIE-1252). Pass them to
  `outline_patch` as written. A count typed in prose names the `::graph-stat` that would count it, with no patch:
  only the writer knows whether it means the live count.
- **Jev reads prose too:** no shape gate first; one request per write over the sections it changed, judged against the
  outline's whole kit (its component schemas) and the rubric (PIE-1313's buried question and paragraph title included).
- **Jev is heard on a big outline, and an answer without Jev says why** (#1019): each read the review makes has its
  own limit and the slow facets read runs beside Jev, not before it, so pie's writes come back `jev: asked`; one that
  wasn't heard says why (`not heard: the review ran past 6.0 s`, the error, or `Jev is not configured`), never a bare
  `off`. A ticket's `PIE-n — ` lead is not counted in its title's length, and no patch moves a ticket's title down.
- **The workboard's rules where agents act:** `work_complete` with proof that names only tests, and `work_create` with
  no sentence of what Evan will open and do, are answered fix; a note asking Evan to try or check things is
  `qa-for-evan`. A note carrying `[house-rule::<name>]` (validation, experience, qa-for-evan) words each rule.
- **Jev's suggestions page:** made with an outline's first finding: each finding with its note, what was said and the
  passage; what the writer did (followed, patched, ignored); a box to mark Jev right (x) or wrong (✗).
- **A table cell naming a note draws its title, linked,** in every `::graph-table` and on the web page; `link: <property>`
  makes a row open the note its property names (the page's rows open the note a finding is about).
- **A record reads when it's opened:** a review's records are titled as a sentence ("fix: buried in Garden beds"), and
  a rule note made with the page draws a card of what each says (its note by title, the passage, what was said), for
  the records written before it too. A card leaves out fields its block doesn't have, and its fields read one a line
  on the web.
- **Buried means anywhere but the top:** an ask in the last sentence of a paragraph is buried; its patch moves that
  sentence alone to a top `- [ ]`. A short, clear note ships: Jev's judgment needs a section with room for the problem
  (rows for a figure, length for dense and mixed).
- **`ep0ch review backfill --ws <name> [--since 7d] [--into <name>]`** reviews what agents already wrote, read only,
  counted by rubric, rule and writer with samples and Jev's tokens; `--into` keeps it as records for the page.
- **What to run:** `GRAMMAR` is 11; an older renderer warns once until `ep0ch install --apply`.
### A copy of a built-in extension lists once and says it overrides the built-in (PIE-1283)

- **One row:** a copy of neat (or any built-in) in your extensions folder is one row in `ep0ch ext ls`, the power
  bar's `&` list and the Extensions hub. The script it ships is no longer a second row or a second page.
- **Says what runs:** the row reads "your copy overrides the built-in". `ext ls --long` and the preview show both
  folders. `ep0ch doctor` and `ep0ch install --apply` give the command to remove a stale or changed copy.
- **Two renames:** a tile's menu has "rename this tile…" and, when the tile shows a note, "rename this
  note…" (`note.rename text=`). That one changes the note's title only; its first line's properties and its body
  stay.
### One search scheduler: the completer waits for typing, and a replaced search stops (PIE-1382)

- **The completer waits for a pause:** `((garden` typed quickly asks the service once, 150 ms after the last key, as
  the power bar does; Tab and Ctrl+Space still ask at once. Before, every key was a round trip.
- **A replaced search stops:** typing on in the power bar, or a query tile read again, stops the request it replaces
  instead of letting it run to the end; its answer is never drawn.
- **One owner:** the bar, the completer and a query tile go through `SearchSchedule` (`src/search-schedule.ts`): the
  pause, latest-wins, abort and Jev's re-order pause. The parity walk runs those pauses out on a fake clock, as shipped.

### The extensions list reads at a glance, settings and scripts too (PIE-1284)

- **One line a row:** `settings <name>` rows are one line with their state; where config.json lives is in the preview.
- **Each row's own words:** a note script's row says its note's title, an extension's script the about it declares,
  and one with no description the first thing it adds (`agent @planter`), never "a script in a note" for all of them.
- **Grouped under installed, with a kind chip:** headings read `installed · scripts · 24`, `settings · 7`; each row
  names its kind at its right where the width allows, so it still says so once a typed name hides the headings.


### Copy a note's link, a line's reference, or any row's address (PIE-1297)

- **Every row that is a note copies it:** a list's, the tree's or a lane's menu (⋯, or a right-click on the row) has
  copy id, copy reference and copy web link for that row, as a reader's has for its note. A power-bar hit has them on
  its menu (alt+m, a right-click), and a BBS message reader copies its message.
- **Another outline's notes copy as that outline's:** a links list on another outline's note, an EchoNet area's
  messages and `/outline:<name>` hits give `((outline:id|title))` and its `/pub/o/<outline>/` link.
- **A web link:** copy web link gives `https://my.ep0ch.sh/pub/o/<outline>/p/<id>`, a roadmap item's by its Work
  ID; pie's opens as `/pub/p/<id>`.
- **A line's reference:** in a reader, copy a reference to this line gives `((id^anchor|words))`, adding the anchor
  once when the line has none. Another outline's note copies as `((outline:id|title))`.
- **Two keys:** `^W y` copies the reference of the note the tile points at; `^W ,` shows a tile's id, place and wires
  in a card, with its copy rows. `act note.copy-ref kind=id|ref|link|line` does the same for an agent.
### An open that names no tile reaches a mounted screen's reader (PIE-1306)

- **Mounts take opens:** on a screen whose only readers sit inside mounted screens, `ep0ch open` and an agent's open
  with no `from=` hop into the mount that has the person's keys first, then the others; a mounted Welcome takes the
  note in its preview, a mounted board through its group.
- **Your place stays yours:** the person's focused tile and keys never move. A group carried into the drawer is still
  refused, since the drawer isn't the screen's.

### One grammar for references, titles, fences and ages (PIE-1292)

- **A labelled reference reads the same everywhere:** `((id|Rough edges (x)))`, `((id^intro))` and `((org:id))` name
  one block (or another outline's) in the Pi tools, a query's view, the mod's rows, rules, output regions and paths.
- **A note's title is the service's:** a note that starts with a bare `status:: draft` line lists by its real first
  line in the door, as in Detail; extensions read the same title.
- **Code is code:** `@tidy` no longer trims inside a fence a ```` ```js ```` line seemed to close, and four spaces
  before backticks no longer opens one; Structure, screen notes and Detail's row columns read fences the same way.
- **One way to say how old:** `29s`, `29 s` or `29 s ago`, with one rounding, in the door, Detail and the CLIs.
- **What to run:** `GRAMMAR` is 10; an older renderer warns once until `ep0ch install --apply`.

### The parity walk reads the paint it follows, and probes the power bar on purpose (PIE-1347)

- **Fewer looks, same work:** a probe's look reuses the door's last paint instead of drawing the screen again (it never
  matched before: 4,196 looks in the EchoNet read, now ~960). Every probe, input state and replay is the same as main's.
- **The power bar is an input state:** the first key in a part that opens it has the bar's keys probed, with the bar's rows
  compared; before, it was typed into only when a reader's state was lost unseen. Its 150 ms pause stays as shipped
  (`EP0CH_BAR_ASK_MS` is gone): the walk ends it with the bar's `askNow`, and `settled()` resolves on the last answer.
- **Counts, not seconds:** the EchoNet scenarios fail on more looks, paints or host round trips than they make today, not
  on time.

### A figure's values complete in Detail too (PIE-1366)

- **Detail offers what the door offers:** a figure's YAML values (`density: `, `group: `, `query: `) and a
  component's attributes (`::box{li`, `::button{of=`) list the same rows in both, from the service.
- **One owner for property completion:** a filter's keys and values come from the service's catalog and schemas,
  never merged again in the door. A value you picked before rises among equals, as it does for `[key::`.
- **What to run:** the wire changed (PROTOCOL); `ep0ch install --apply` on float-2 and the laptop.

### Buttons look like buttons, and the power bar's extensions read at a glance (PIE-1287, PIE-1284)

- **A button says how it looks:** `::button{… glyph="▶" tone=primary frame=round fill=on}`. Tones are quiet, primary
  and danger; frames none (one row), box, round, heavy and double. With none of them it is `[label]`, as before.
- **A button says what its press did:** ◐ while a slow one runs, ✓ after, `!` when it failed (the pointer reads why,
  until the next press). One whose action would be refused now is drawn dim, in parentheses. Under the pointer a
  button lights up, in a note, a script's view and on the status bar alike.
- **One part draws them all:** note buttons, a script view's buttons, an output region's and a proposal's controls,
  a thread's controls, the empty screen's and the status bar's (now `[Collapse]`, a button like the rest). Published
  pages draw the same tone, glyph and frame, inert.
- **`&` in the power bar** lists one line per extension, grouped by what it adds first (rules, components, scripts,
  programs, sources, agents, tiles), each with a count; the hub says how many of the repo's are installed. Its id,
  version, folder and everything it adds are in the preview beside.
- The kitchen sink's **buttons** section shows every tone, frame and state. GRAMMAR is 9: an older door doesn't read the
  look words and refuses those buttons until `ep0ch install --apply`.

### One answer to an @margin ask in a comment (PIE-1374)

- **Explain answers once:** the page's and the door's Explain, and a typed `@margin` in a comment or reply, get one
  answer: a reply in the thread by the agent. The note's in-place answer no longer also writes into the comment.
- **Your comment stays yours:** no agent text is written into it under your name. An `@name` line in a note still
  gets its answer under the line.

### Every arrival is visible and connectable (PIE-1370)

- **A PDF sent by lease shows its first page:** a lone PDF lands as a document whose page draws page 1 (poppler's
  `pdftoppm`) and links the file, instead of an empty box. Without `pdftoppm` the page says so and names the install.
- **The card says what arrived:** `[arrival::new] [arrival-kind::page|site|document|image] [sent-by::…]` on its title
  line. A tidy pass queries `arrival=new`, connects each arrival and clears the chip.
- **Decks go on the wall:** the lease's description (MCP, the drop page, the ep0ch-outline skill) says a deck or PDF
  meant to be read becomes a poster, not an artifact.

### The drain runs on its own clock (PIE-1372)

- **No cron by hand:** the repository's mod hands the deployer's session (loki's `.ep0ch`) the drain every 30
  minutes, the first a minute after it starts: merge what's ready, fill builder slots up to 3, the daily sweep while
  Evan is offline, a build-log line per pick. `EP0CH_DRAIN=on|off` overrides.
- **The deployer is found again:** the mod reads `.ep0ch/config.toml` (and the old `.ep0ch` file), so the freshness
  sweep runs in the live checkout without `EP0CH_AGENT`.
- **The drain validates too (#998):** each tick, when no verifier is out, one that built none of them takes the oldest
  items in validate, closes each with proof and sends a finding back to queued with its repro.

### Agent tools take a short id (PIE-1371)

- **One resolver:** `outline_read`, `outline_patch`, `outline_set_property` and the other agent tools, in the Claude mod,
  the MCP gateway and scripts, name a note by its id's first 8 characters (`b234391f`), as `ep0ch show` does.
- **Errors teach:** an ambiguous prefix lists each note's id, title and where it sits; a miss names the nearest ids;
  a title still points at `outline_find`.
- **Work IDs by any spelling:** `PIE-12` finds PIE-012 everywhere a note is named.

### One tab strip for every tab set (PIE-1288)

- **The power bar's scopes are actions:** alt+← alt+→ (alt+b alt+f), a prefix and a click on a scope run
  `bar.open by=±1` or `bar.open scope=<s> keep=true`, keeping what's typed; an agent can do the same.
- **Six tab sets, one strip:** the power bar's scopes, a tile's tab set, `::graph-tabs`, the library, Welcome and Tune
  draw through `tabStrip`, each in its own look. A one-row strip that doesn't fit shares the room evenly, then puts the
  rest into "… N more", never the lit tab (the power bar's scopes no longer run off the edge).

### Wide text keeps to its frame (PIE-1291)

- **CJK and emoji fit:** a callout title, a code fence, an artifact card and an extension's box with wide glyphs stay
  inside their width; a callout's corner no longer falls off at 30 columns.
- **The editor counts glyphs:** joined emoji (👩‍💻) and a soft hyphen wrap and place the cursor where they're drawn,
  and a click lands on the glyph under it.
- **One frame:** a callout takes the look's `border` (heavy, double, line) as a `::box` does; round stays the default.
- **One sparkline:** an extension's sparkline scales from zero, as `::graph-spark` does.

### A Claude session running twice is said, in the session and in the door (PIE-1369)

- **In the session that just started:** when `claude agents` shows another live process on this session's id (a
  `claude --continue` while it ran elsewhere), the Claude mod's status line leads with `running twice: pid N too ·
  ep0ch agent stop N --session <id>`, and the first prompt tells the model, which tells you, with both pids and the
  commands. Nothing is refused.
- **In the door:** a red `⚠ <name> ×2` chip on the status bar while a split lasts, on this machine or the outline's.
  A click lists the processes (pid, machine, started, busy or idle; the session's last transcript write); `a`
  attaches a background job, `s` stops one after asking. Agents: `act claude.splits`, `claude.attach`, `claude.stop pid=<pid> confirm=<pid>`.
- **`ep0ch agent splits [--session <id>] [--json]`** lists them with the commands; **`ep0ch agent stop <pid> --session
  <id> [--machine <ssh-name>]`** stops one process, only while it is still that session's and another still holds it.
  `ep0ch agent ls --json` rows carry `pid`, `startedAt` and `lastWrite`.
- **What to run:** `ep0ch install --apply` on each machine (no PROTOCOL change); a door reads another machine's
  sessions only once that machine's `ep0ch` has this change.

### Retired look keys: one line a note in the tune, with the fix (PIE-1365, PIE-1362)

- **One line per note, not a sentence per key.** A note (or a line) still writing `style.header.image…` or
  `style.header.title`, inert since PIE-1361, shows in the tune as "tile reader style 641d8976: 11 retired
  header-image keys", with `[remove]` and, when they name a picture, `[move to a hero line]`. Why is said once: under
  the pointer on that line, and as a hint card the first time a fix runs.
- **The fix is one tune step.** `[remove]` (`D`, `tune.retired.remove note=<id>`) takes the keys off the note;
  `[move to a hero line]` (`M`, `tune.retired.move`) writes the picture as the shown note's `[img::…] [layout::hero]`
  line with the look moved over (height, blur, fade, tint, dim, fit, bleed, scroll, title; the old crop offsets as
  `hero-focus`), says what has no place there (a width's own value), and removes the keys. A hero line the note
  already has stays the header; its own properties win. Attributed; `u` in the tune undoes it.
- **A template figure's title reads its props (PIE-1362).** In a `::use` template, `title: merged {{props.day}}` is
  filled from the call's props, as the figure's `query:` already was.
- **What to run:** `PROTOCOL` moved (styles.list's sheets carry `retired`; a figure's answer carries its read
  `title`): `ep0ch install --apply` on each machine.

### Door fixes: an agent's own socket, the lift's fetch, wrapped headings (PIE-1363, PIE-1337, PIE-1349)

- **An agent's own `EP0CH_CONTROL` never reaches the person's door (PIE-1363).** `EP0CH_PLACE` stands in only for a
  socket of that place (its session folder's, gone stale through a handover: PIE-604 holds). A socket elsewhere that
  answers nothing is refused by `ep0ch act|peek|open|where` and the outliner's `door-open`, naming the path and
  `scripts/agent-env`, and nothing falls through to the folder's or the only door after it.
- **agent.lift leaves a put-away drawer put away (PIE-1337).** Lifting an agent tab that's out on a screen another one
  covers fetches it into the drawer and lifts it there; the drawer itself stays down.
- **A wrapped heading is one heading (PIE-1349).** A click on any of its rows folds it, and "· N lines folded" stays inside
  the tile (after the last word, else on a row of its own) and out of a copy. List items, plain headings and styled
  headings drawn plainly share one hanging wrap: the same rows, cuts and joins.

### Zoom into part of a note: a figure, a table or a heading's section fills the reader (PIE-780)

- **A ⤢ at the right edge** of a figure, a table or a heading: a click zooms the reader into that part, interactive at
  full size (a figure's rows still open notes, its tabs still switch). `W` zooms into the part the `[ ]` position (or
  the reading line) is in; the tile menu has "zoom into this part".
- **Back returns.** Esc, `alt+←`, `⌫` or a click on the zoom's top row comes back to the whole note, scrolled as it was;
  `alt+→` zooms in again; a part zoomed inside another steps back to that one first. A zoom is saved with the layout,
  like the rest of a reader's history, and follows its part when lines are written above it.
- **The part is the one `alt+D` detaches**, as the service finds it (the new read `fragments.at`); nothing is written to
  the note. Agents: `element.zoom tile=<reader> line=<n>` (or `anchor=`), `on=false` to come back; refused on the
  reader the person has focused.
- The kitchen sink's `zoom` section shows it. **Run after updating:** `ep0ch install --apply` (the protocol changed:
  the `fragments.at` action).

### Components, properties and callout types complete in Detail too (PIE-1344)

- **`::`, `[key::` and `> [!` in Detail, Tree and Quick Capture** offer the rows the door does: the service answers
  them (`completion.rows`'s `components`, `properties` and `callouts` sources), and the door's own copies are gone.
- **`[key` offers the keys your notes carry** (most used first, from the outline's property index), then the keys the
  component schemas give a meaning; `[key::` the values that key has, then the schema's.
- **A component chosen in Detail writes all its lines** (a figure's YAML too), its first value selected.
- **`bar[]` in an extension's manifest is refused** with the rename: write `sources[]` and answer the `source` operation.
- **Run:** `ep0ch install --apply` (PROTOCOL bump: `completion.rows` rows carry `example`, `component` and
  `variations`; the request's target `headingShort`). An extension still writing `bar[]` must be renamed first.

### A header picture is set one way: the note's hero line (PIE-1361)

- **The note owns its header.** Its first `[img::…] [layout::hero]` line is the header picture, and its look is that
  line's properties (`height`, `hero-focus`, `fit`, `dim`, `tint`, `fade`, `blur`, `bleed`, `title`, `scroll`), so the
  source shows every value and the look travels with the note. A second `[layout::hero]` is an image in the text that
  says so.
- **No hidden pictures.** The look cascade's `header.image` and `header.image.*`/`header.title` are gone: a picture
  set at a tile, screen or global level no longer shows on every note there. A note or style note still carrying one
  says, in the tune, that it's gone and where the look is written now. The header's surface and rule stay look values.
- **The tune edits the line.** alt+y shows the hero's properties as its Hero rows at the top; − + ×, the wheel and
  `tune.nudge row=hero.tint by=1` write the line at once (ctrl+z in the reader puts it back), with no level and nothing
  to save. New `image.look` does the same for an agent.
- **Drag it.** The header's bottom row drags its height (it stays that tall, cropped to fill, past the picture's own);
  the picture above it drags its focus. One save on release.
- **Fixed:** the picture drawn twice (a page-level `header.image` naming no picture of the note was drawn behind the
  header while the hero showed), the tile-level picture on other notes, "none (this note has no hero)" with a header
  showing, and the wide tune's cut names.
- GRAMMAR 7 → 8 (the style tokens). No PROTOCOL or schema change; `ep0ch install --apply` as usual. A note with old
  `style.header.image…` keys: move what's wanted onto its hero line (the tune names each one).
### An outline tells its agents where to start: `[orient::<agent>]` (PIE-1353)

- **A note carrying `[orient::<agent>]` or `[orient::all]`** is read by the Claude mod at session start and again
  after a compaction or `/clear`, in the session's outline for the agent it writes as, and given to the model as one
  context block, newest first. A long note is cut with `read the rest: ep0ch show --ws <outline> <id>`.
- **The binding card says it:** "orients from <note>". The ep0ch-outline skill has a worked example.
- **Run:** nothing; the mod picks it up on its next session.

### Every merge to main is on the record (PIE-1352)

- **A delivery says when it merged:** syncing a merged PR stamps `merged-at` (GitHub's `mergedAt`) beside
  `pull-request-state=merged` and `merge-commit`, so "merged today" is `merged-at=<day>`, not `updated`.
- **One merge row per merged PR, ticket or not:** `[type::merge]` under the Merges page (under Records), with the
  PR's number, title, author, branches, merge commit and `merged-at`, linking the items it delivers.
  `work deliver --repo R --pr N` with no item (`work_deliver` with no `ref`) writes it and syncs every delivery that
  records the PR; the repository's Claude mod runs it after each `gh pr merge` and says the row.
- **The build log is a template:** pie's `[template-for::build-log]` draws a day's merges, deliveries, validate lane
  and notable changes live from `::use{of=type:build-log day=<YYYY-MM-DD>}`, so a day's log is right before any
  narrative is written.
- **Run:** PROTOCOL changes (`deliveries.sync` takes `mergedAt`): `ep0ch install --apply` on each machine.

### ✦a's lifted agent takes your keys and clicks with the drawer down (PIE-1359)

- **With the drawer put away or folded, ✦a lifted the agent but your keys stayed on the screen behind:** the first key
  dropped the lift, and a click in it said "the drawer is put away". Now the lift is your way into that program: what
  you type and click goes to the lifted tile, the drawer stays as it was (PIE-1336), and ✦a again (or a
  click outside it) gives the keys back to the screen. A click in a lifted agent always gives it your keys, and what it
  prints draws as it comes (the drawer put away no longer held its repaints back). An agent's
  lift still never takes your keys.

### A dropped part lands in your edit, shows where it will land, and has room around it (PIE-1357)

- **Your own edit takes it.** Dropping a part on a note you're writing (a new note not saved yet, an edit) puts it in
  your draft at once, one step `ctrl+z` takes back. It used to arrive as proposals to approve; those stay for an
  agent's drop.
- **A drop line** shows where it will land while you drag: under the block the pointer is over, across the tile, with
  "drop: embed or copy here" on the hint row.
- **A blank line before and after** a landed part, unless one is there already or it ends the note; the same in the
  saved note and in your edit.
### A note's Work ID comes first wherever its title is drawn (PIE-1356)

- **One name, ID first.** A note with `[work-id::HUB-062]` titled "PC-582 acceptance summary…" reads
  `HUB-062 · PC-582 acceptance summary…` in the tile bar and its tabs, spines, the drawer's tabs, river columns and
  their rows, the outline tile's rows, `((` completion, the power bar, backlinks, `ep0ch find` and the publisher's
  page and index titles, as the reader's header already did. Another ticket key in the title no longer reads as the ID.
- **Said once.** A title that already starts with its ID (pie's `PIE-n — …`) reads `PIE-n · …`, never doubled.
- **The title is cut, never the ID.** A short room cuts the title from its end.
- One rule for all of them, outline-core's `headedTitle` (`work-id-title.ts`); the per-place versions are gone. The
  outline tile's row no longer repeats the ID as its right-hand tag (it shows the status or type).
- GRAMMAR 6 → 7 (a draw rule). No PROTOCOL or schema change; `ep0ch install --apply` as usual.

### Copying a page carries its live figures' results (PIE-1355)

- **`Y` copies what a live page says now.** With nothing selected, `Y` (the tile menu's "copy note", `act note.copy`)
  copies the note's text and, under each live figure (`query:` or `view:`), its rows as plain Markdown: a check as
  `- [ ]`/`- [x]` steps, a table as a Markdown table, tabs as a list per group, every row a `((id|title))` link. Each
  is headed with the figure's title, its row count, the time and its query. An agent without the outline's MCP can
  read a pasted page.
- **Cut, and said so.** At most 50 rows a figure (400 in one copy): a cut figure ends with
  `showing 50 of 60 · the rest: ep0ch find --ws <outline> --query …` and the `outline_query` arguments. Rows are never
  dropped silently. The status line says `copied the page with 3 figures' results (1 cut)`.
- **The text alone is still there:** the tile menu's "copy source only", or `act note.copy source=true`.
- **`ep0ch show <id> --markdown`** prints the same at a shell. The rows are the ones the reader draws: no second query.
- No wire change, no PROTOCOL bump, no schema change.

### Desk screens draw each frame for less (PIE-1347, PIE-1335)

- **EchoNet, Welcome and the home base no longer rebuild their logo every frame:** its cells, its densest rows and
  its drawn lines are worked out once. The nodelist works out its day in words once a day, not every frame.
- **Every desk frame asks the layout about each tile's ×, fold and float on one context,** made once per frame, and
  those dry runs no longer seal the state they throw away. On the EchoNet reader a frame costs about a third less
  CPU, and its parity walk alone went from 55 s to 44 s on the same load.
- **Tests:** the session's mouse-burst check waits for what the burst's last report shows, not a quiet spell, and
  bounds its frames by the time the door spent on it (it failed 5 runs in 5 beside another test run; now passes 5 of 5).
  The parity walk probes the power bar once a part and then puts it away, rather than typing every key into it from
  each input state (the EchoNet walk's host waits 16 s → 5 s, and those keys now reach the states themselves). Its log
  line says how many host round trips a scenario made and how long it waited on them.

### Take a part out of a note: detach it into a tile, or drop it into another note (PIE-1247)

- **alt+drag a part** (a figure, a callout, a list item, a paragraph) out of a reader. Drop it on another reader's note
  and choose **embed** (a live reference; the part's `^anchor` is written if it had none) or **copy** (its own lines: a
  figure comes with its query, which then answers for the note it's in). Drop it on a tile's side, its header or the
  screen's edge and it **detaches** there.
- **Detached** means a block of its own under a `.detached` page that embeds the part, drawn with no header, in a tile
  of its own. It's an ordinary note: it outlives the tile, and the part's note lists it among its backlinks by the
  anchor. `alt+D` (or the tile menu's "detach this part") detaches the part you're on; `ctrl+z` takes it back.
- **One operation** behind the margin's quote, detach and the drop: the service's `quote` (was `marks.quote`, renamed
  with no alias) takes marks and parts of a note, into a new block or into a note's text. Agents: `element.detach`,
  `element.quote`, and MCP `outline_quote` with `elements`, `where: detached`, `into`/`at`/`as`.
- The kitchen sink's `detach` section shows it. **Run after updating:** `ep0ch install --apply` (the protocol changed:
  the `quote` action).
### An agent's write to the laptop's outline lands as soon as the link is back (PIE-1351)

- **Queued writes drain over the link.** A write to an outline on another machine already went live when that machine
  answered; one made while it didn't (a dropped link, a gateway restart) waited for that machine's own pull, which may
  never run. Now the MCP gateway applies them itself, over the link, the moment it reaches the machine again: the first
  call that finds it live, or its own try every 15 seconds while writes wait. Same rules as a pull: the outline's own
  access level, the writer's attribution, a note changed since becomes a proposal.
- **A short drop isn't a queue.** A write tries the machine again even inside the 45-second backoff of a failed try,
  and waits up to 20 seconds for a link restarting under a deploy before it queues.
- **Says why, lands once.** A queued answer starts with why (`laptop didn't answer over link or ssh …`, also as `why`).
  A live write whose answer is lost is queued as that same write and lands once.
- **`ep0ch mcp queue drop <id>… [--why <words>]`** withdraws a waiting write (one redone by hand) and says what it was;
  `ep0ch mcp queue status` lists the waiting writes by id. A pull that couldn't apply a write now says why in its own
  summary (a pull run mid-deploy, its CLI a protocol behind its host, waits and applies on the next).
- No wire change, no PROTOCOL bump, no schema change.

### Any element takes an anchor: embed or link one figure, callout or list item (PIE-1247)

- **No heading needed to aim at a figure.** A component's opening line takes an `^anchor` (`::graph-timeline ^sowing`),
  and `!((note^sowing))` embeds just that figure; a callout's head line names the whole callout, as its last line does.
  The figure's `query:` (`this`, `parent:this`) still answers for the note it lives in.
- **Written for you.** `((words` and `!((words` list a note's figures, callouts and list items beside its headings, each
  saying the anchor it adds; choosing one writes it on that line (attributed). Same in Detail.
- **By page.** `[[Spring plan^sowing]]` links into a page and `![[Spring plan^sowing]]` embeds that part; typing
  `[[Spring plan^` lists the page's parts.
- **Which part is linked.** Backlinks group by the anchor aimed at (`page link ^sowing ×1`), in the door's links tile
  and Detail.
- The kitchen sink's `sticky-pad` section shows it. Parsing rules changed (GRAMMAR 6); the `transclusions.read` and
  `references.backlinks` answers gained fields (see the PR for the PROTOCOL note).

### Floats draw above the drawer, and menus above everything (PIE-1221)

- **A float over the open drawer is drawn whole:** its frame, its text and its pictures sit above the drawer's rows,
  and a click on it there goes to the float, never the drawer.
- **The last one you touched is on top:** click in the drawer (or go in with `ctrl+]`) and the drawer comes above
  the float; click the float, or step out of the drawer, and the float is back above. No dragging it out of the way.
- **Menus are never cut off:** a tile's menu, a hint card or a completion list opened low on a float runs down over
  the drawer. A lifted tile (PIE-1189) still draws above both.

### One checklist drawing, and plain headings wrap when narrow (PIE-1348)

- **A component's checklist looks like a `::graph-check`:** the same box, two spaces, and the same hang under the
  words, which now line up under the first row's. A done step is bright and an open one grey, as in the figure (a
  component's done steps were dimmed before). One drawing (`src/figures/check.ts`) draws both; a component's steps
  still aren't links or tickable steps.
- **A long `##` heading wraps under its words** in a narrow reader, past its `#`s, instead of running off the edge. A
  copy takes it as one line.

### Narrow readers never cut a checklist step or show a heading's source (PIE-1302)

- **A checklist step wraps whole:** a `::graph-check` row (and a component's checklist) takes as many rows as its
  words need, at any width. It was cut with `…` after two.
- **A styled heading too narrow for its band** (under 48 columns, or too long) draws its words in the heading's ink:
  `▾ Due Monday`, not `▾ ## Due Monday`. A heading with no style, or a style nobody declared, still shows its `#`s.
- **A table cell's next row starts at the cell's edge:** a cell like `PC-12 / acceptance` no longer hangs its next
  row six cells in. A Work ID still hangs a title it leads (`PLOT-3 — Mend the netting`, `PLOT-3 Mend the netting`).
- **The byline's property count moves to the next line whole** (`i 14 properties`) when the date leaves no room,
  with the summary after it where that fits. It was cut to `i 14 proper…`.

### ^W's panel shows the focused tile's own keys first (PIE-1338)

- **Pause after `^W` and the panel starts with "this tile: <its name>":** the keys the focused tile takes by itself,
  drawn in the accent, before `^W`'s own groups. They're its ⋯ menu's rows that have a key (What changed's `d the
  change` and `x all seen`, a reader's `e edit`, `R reply`, `u` up…), in the same words.
- **A click on one runs it in the tile,** as the ⋯ menu does. Typed, they work once the panel is closed: after `^W` the
  next key is still `^W`'s (`^W d` slides a dock, `^W x` closes), and the panel's foot says so. The hint row is as it was.
- **In your drawer too:** the panel opens over the screen, since the drawer is too short for it (`^W` there showed no
  panel before). `act keys.panel` gives an agent the same group, each key with the action it runs.
- **The panel fits more screens:** too tall at its widest, it lays out in more, narrower columns before giving up.
- **What changed's ⋯ menu** now lists "open its note", "the change" and "all seen".

### An extension's settings show and edit in the door (PIE-1343)

- **See them where you find the extension.** ctrl+k then `&`: each extension's row says its settings (default, set,
  needs setup, failing), and `settings <name>` previews every field, its value or default, and the `config.json` it
  lives in on the machine that hosts the outline.
- **Change them without the file.** ⏎ on that row opens a form drawn from the extension's configSchema, filled with
  what's set; saving checks it against the schema (a bad value is refused with why, nothing written) and the next call
  uses it. An agent: `ep0ch act ext.tidy.settings answer='claude -p --model sonnet'`. Secrets are only references.
- **A failing @tidy says where to fix it,** and tidy's row says `failing` with its error until the settings change.
- Wire change: `extensions.list` entries carry `settings`, and the new `extensions.configure` request writes them
  (PROTOCOL bump).

### A lock says which layout it is; alt+k opens the power bar (PIE-1346)

- **Your drawer's lock names itself.** Locking or unlocking says so on the status bar, naming the layout ("locked your
  drawer · a click on ▣ drawer locked (or ^W P) unlocks it"), and a refusal names it too ("your drawer is locked:
  closing details5 is refused"). It used to say "the screen" for both.
- **You can see which is locked.** The hint row's chip reads `▣ screen locked` or `▣ drawer locked` (both when both
  are), and a locked drawer's frame shows it; a click on either chip unlocks that layout.
- **The power bar's lock row is the layout your keys are in:** "lock your drawer", "unlock the screen". The bar's
  tile-menu rows come from the tile your keys are in, in the drawer too.
- **`alt+k` opens the power bar,** like `ctrl+k`, and both now work with your keys in the drawer (not in a terminal
  tab). The lock has no key: it's the chip, the bar's row and `^W P`.

### Completion asks one set of sources, ranks them with one matcher, and extensions add their own (PIE-1340)

- **Extensions add rows where you type.** An extension's `sources[]` entry with `triggers` (`[[`, `key::` with its
  `keys`, `@`, `::`…) answers the `source` operation with rows, and they join the list beside the outline's own pages,
  notes, properties and components; there's no new sigil. The `issues` example offers made-up open issues under `[[`
  and `[issue::`; the kitchen sink's `sources` section installs, uses and uninstalls it.
- **One order for every list.** Every source's rows are ranked together by the search matcher (a title that starts
  with what you typed, then one that holds it, then typos and letters in order), and among equals what you picked more
  often and more lately comes first. The outline host keeps those picks, so the door, Detail, Tree and Quick Capture
  agree. The matched letters are lit the same way everywhere.
- **Detail shows what the door shows.** Detail, Tree's quick edit and Quick Capture ask the same sources as the door
  (`completion.rows`), so the same token lists the same rows; Detail draws each row's kind at its right, its detail
  dim and the lit row's docs under the list, and offers a new page for a `[[name` nobody has written (↓ then ⏎).
- **For developers.** outline-core has the one trigger detector (`completion-triggers.ts`, replacing the door's
  `src/completion.ts` and most of the outliner's) and the source contract and merge (`completion-source.ts`). The
  completer's per-kind if-chain is gone. `bar[]` in a manifest is read as the old name of `sources[]`; write
  `sources[]`, answered by the `source` operation (glyphs moved).
- **Run:** `ep0ch install --apply` (a wire change: `completion.rows`, `completion.picked`, `sources[]`; PROTOCOL bumps
  at merge).

### After an update, the lift finds your agent before the drawer comes up (PIE-1342)

- **The kept agent answers first.** After a session handover with the drawer put away, `role:agent` (and
  `drawer.agent`, `tile.info`) named nothing until alt+a drew the drawer, so ✦a would have started a second claude. The
  drawer's saved tabs are restored the first time a tile is asked for, and their programs reattached then: ✦a lifts the
  same claude, and the drawer stays put away.
- **A tab behind another lifts.** A lift of a tab that sat behind another (your agent behind what-changed) was dropped
  as soon as it was drawn; the lift now brings its tab to the front, and the next ✦a drops it.

### Completion says what each row is, and its docs wrap beside the list (PIE-1339, PIE-1245)

- **Kind and detail on every row.** Each row of the `[[`, `((`, `::`, `@` and `[key::` list ends in what it is
  (block, anchor, page, property, component, agent, value) with a dim detail after its title (where it sits, why it's
  offered, a property's type).
- **Docs beside the list.** The lit row's description wraps beside the list when 30 columns are free, else under it,
  sized to what it holds and never cut at its start; shift+↑↓, PgUp/PgDn or the wheel over it scroll it.
- **⏎ and tab both insert.** ⏎ inserts the lit row as tab does, except in a figure's YAML, before anything is typed for
  a property or a heading's `::`, and where the row would change nothing: there the footer says `⏎ new line`. In a
  filter or a property's value, ⏎ still applies what's typed. ctrl+n and ctrl+p stay a new note and the edit preview.
- **The list's keys are actions.** `complete.ask`, `complete.move by=`, `complete.accept n=`, `complete.dismiss` and
  `complete.preview` are what the keys, wheel and clicks run, so `act` drives the list the same way. The kitchen sink's
  `completion` section shows it. `complete`'s rows carry `detail` and `docs` in place of `context`.

### Every drawer agent is a tab; the arrow opens a new one and never ends yours (PIE-1331, PIE-1330)

- **The arrow starts, it never replaces.** Picking an agent from the drawer chip's picker (alt+click or a right-click,
  now titled "a new agent tab") starts it in a new tab; the claude you had keeps running in its own, the same process.
  Before, the pick restarted the drawer's one special tab and an idle conversation was ended without asking. Ending an
  agent is only ever `^W x` on its tab. The last pick is what the next new agent tab starts.
- **One kind of agent tab.** The drawer's special "own program" (its holder tab, `agent.back`, its numbered keys) is
  gone: every agent is a terminal tab with role `agent`. `drawer.agent` and `role:agent` name the one you typed in or
  clicked last, and `agent.lift`, `agent.type`, `agent.restart` and the chip act on it.
- **Groups keep their programs through a handover.** An agent tab (or any terminal) gathered into a group, in the
  drawer or on a screen, comes back running in that group after a handover; before, the drawer's tab came back as
  "drawer.own isn't available here" and its program was lost (PIE-1330). `session list`'s kept programs stay current,
  and `tile.into` with several groups asks "into which group?" instead of "moved … into undefined".
- **Run:** `ep0ch install --apply`. The handover onto this code reads your drawer's old own tab as an agent tab and
  keeps its program running.

### An agent ssh'd in from a tile opens where that tile's wire points (PIE-1306)

- **The terminal says which tile it is.** A Claude on another machine, reached by ssh from a door's terminal tile (or a
  background session attached from it), has no `EP0CH_TILE_ID`; a reference pressed in its reply now opens where
  that tile's wire points, not "no reader takes this open". The Claude mod writes a marker to its terminal and the
  door names the tile that drew it (`host.tileOf mark=`).
- **Any program can ask:** `OSC 7501 ; ?tile` is answered with the tile's `t-<uuid>` on the program's input, through
  ssh; the outliner's `door-open` with no `--from` asks it. Not through tmux: the mod's marker goes through tmux's
  passthrough, which needs `tmux set -g allow-passthrough on`.
- **Run:** `ep0ch install --apply` on the door's machine and the agent's (the door answers the query and the marker;
  an older door opens as before).

### One line field everywhere you type one line (PIE-1290), and ^W shows its keys (PIE-1304)

- **Every one-line input is the same field.** The power bar, a rename, a picker's line, the tile menu's search, a river
  column's `/` filter, a `::links` list's filter, the facets and backlinks queries, the message log's `/`, the drawer's
  folder, the home base's machine name, a form's field and a property's value now share one editor: undo and redo
  (ctrl+z, ctrl+y), ctrl+w and alt+backspace (the word before), ctrl+k, ctrl+x cut, shift+arrows select, and the mouse
  (a click places the cursor, a drag selects, a double click a word, a triple the line).
- **ctrl+w erases a word while a line has the keys.** In a filter, a property's value or a picker's line, ctrl+w is the
  word before the cursor, as in the power bar; `^W` comes back after esc (or a click elsewhere). The tile menu keeps
  `^W` as its chord (^W x closes); alt+backspace erases a word there.
- **Backspace takes a whole character.** A family emoji, a flag or an accented letter goes in one press, in the door's
  edits and lines and in the outliner's filters (Tree's action menu, Detail's filters, the outline chooser, Pi's query):
  one set of steps in outline-core (`graphemes.ts`).
- **Pause after ^W and a panel shows every key it takes,** grouped (focus & move, size & shape, tabs, open, mounts &
  groups, drawer, layouts & more), each in its action's own words; a click on a row runs it, esc closes it. A fast typist
  never sees it. `^W o` and `^W O` show the kinds they open the same way. `act keys.panel` opens it at once; an agent's
  answers the groups and moves nothing. The short keys box it replaces is gone.
### Views, finds and agents read a line's properties, not only the note's header (PIE-1277)

- **A view says `[property-scope::all]`** and its query reads every chip in the note: a `- [ ] … [needs::sysop: …]`
  on line 30 puts the note in the view. Without it a view reads the header only, as before. The scope applies to the
  query's positive clauses; a `NOT` clause still asks the note's own header, so a body line's `[work-stage::done]`
  never hides a note.
- **A ticked step settles its chips.** A chip on an `[x]`, `[✓]` or `[✗]` step no longer matches, so an ask drops
  out of the view when its box is ticked. Facets and groups count line chips at the same scope.
- **Each row says where it matched,** with the step's state: the door's view rows read `line 12 to do`, and opening
  one lands on that line, lit, as a `::fields` row does.
- **`ep0ch find --query … --property-scope all`**, the mod's `outline_find` and MCP `outline_query` take the same
  scope (`propertyScope`) and return each note's matched lines. The door's waiting-on-you list finds buried
  `[needs::sysop: …]` asks too, each opening at its line.
- **To use it on Waiting on Evan,** add `[property-scope::all]` to the view note once the host runs this.
- Kitchen sink: the **line-asks** section.

### EchoNet copies keep labelled links whole (PIE-1289)

- **A labelled reference survives the trip.** `((id|Rough edges (x)))` in an echoed note reads `[Rough edges (x)](ep0ch://…)` in
  the copy (it was cut at the first `)`), `[[PIE-12|the plan]]` links PIE-12 as "the plan" (it looked up a page named
  `PIE-12|the plan`), and `[[[[2026-10-06]] - notes]]` stays one link. `((attic:id))` links the attic on the origin's machine, and code (any fence, indented code, a component's YAML) stays as written.
- **One grammar.** The tosser reads links with outline-core's, bundled beside it (`link-grammar.js`, written and checked by
  `bun scripts/link-grammar.ts`, which also writes the Claude mod's); the door's move messages name a note by its whole title.
- **Run:** `ep0ch install --apply` on each machine with a node: it refreshes the installed copies, so both ends of a toss read links the same way.

### A note can leave out its reader header: `[header::none]` (PIE-1319)

- **A dashboard draws only its body.** `[header::none]` on a note's first line leaves out the crumbs, the title and the
  byline in the readers, a river column and the drawer (the BBS message reader keeps its own header): its figures start on the first row, and the tile's border
  still names it. `[header::crumbs]` or `[header::title]` leave out only those rows; `[header::crumbs, title]` both.
  Take it off and the header comes back at once.
- **Still reachable:** the tile menu (⋯) has comment on the whole note, comments, properties and sources, the byline's
  ways in. `ep0ch show` keeps the title first, as scripts read its first line.
- **It describes itself:** the component library has a `header` page, and `[header::` completes its three values
  with what each leaves out. The showcase's `header` section is a dashboard in a reader and a river column.
### A button asks for what it's missing; copy any tile's or note's address; a `::button` line is read as you type (PIE-1298, PIE-1297, PIE-1312)

- **An empty slot asks.** `::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}`: pressed with `target=`
  empty, the door asks you to click a tile (or press its number; esc cancels). A tile whose place has a name of its own (the
  drawer's program, `drawer.agent`) asks once more: this tile exactly, or whichever fills its place. The choice is written on the
  line (`target=t-…`, ctrl+z takes it back) and the next press runs it. Alt+click asks again. An agent passes the value
  (`button.slot label="pop it" key=target value=<tile>`) and never opens your picker; a name or a number it passes is kept as
  the tile's id.
- **A button that misreads runs nothing.** Nested quotes that end `act=` early, a word the button doesn't read, an action that
  doesn't exist, an argument the action doesn't take, or a `tile=` that names no tile now: the press is refused with the line
  to write, and the save says it too. It never acts on the focused tile instead.
- **The editor reads a `::button` line as you type it**: attribute names, values, the action and its arguments in their own
  colours, what won't run underlined, and one row under the line saying what it runs or why not. Same reader as the save's
  warning.
- **Copy id, copy reference** on the tile menu (headed with the tile's name and short id, as its x-ray card is) and on the
  note's: a tile's `t-<uuid>` or the address of its place; a note's full id or `((id|title))`. `tile.copy-ref`,
  `note.copy-ref`; an agent's copy comes back to it and never touches your clipboard.

### `tile=` has one address grammar, and the drawer's program is a tile with a role (PIE-1286)

- **Five kinds of address, one resolver.** `t-<uuid>` (or 8+ characters of it) is that exact tile; `role:<role>[@<screen>]` is a
  tile of that kind wherever it is; `<slot>@<screen>` is the place, whatever fills it; `^` is the tile that opened the one with
  your keys; a name is matched last and is never an identity. No match is refused with why and what to type; it never acts on
  the focused tile instead.
- **The drawer's own program is `role:agent`** (`drawer.agent` stays as its alias). The role is a property of the tile, saved
  with it, so `agent.lift` and `::button{act="tile.zoom tile=role:agent reach=column"}` keep working across a door restart, a
  session handover and a restore from a `drawer-tiles.json` that saved the own tile under another name (Evan's door, Oct 25).
  The guesses it replaces are gone: the program's told id, its program key and its saved name no longer decide which tile it is.
- **Keys, clicks and menu rows address their tile by id**, through the path an `act` string takes (`^W Z`, `✦u`, `agent.lift`),
  and the parity walk checks it: each targeted action a key ran is run again by `tile=t-<uuid>` and by role.
- **One tile registry** (`src/desk/tile-registry.ts`) holds a tile's id, role, opener and copy lineage; the pane, the desk and the drawer keep none of them. An action gets the tile's id from the dispatcher, and the drawer remembers only whether its program is out, not which tile it is.
- **Saved layouts.** A tile's slot (`slot`, the place a screen's spec gave it) is no longer the leaf's `role`, which now says
  what the tile is for. An older saved layout moves to the new words with one command, with the sessions ended first (a running session writes its old layout back over it): `ep0ch session end --all --yes`, then `bun packages/door/scripts/migrations/tile-roles.ts <state dir> --write` (without `--write` it says what it would change), then start the door. It also gives the drawer's own program its role in a drawer-tiles.json an older door saved under another name, where `drawer.agent` would otherwise answer "closed".

### The door's key-by-key tests wait on nothing, and one that runs long fails by name (PIE-1307)

The door's parity tests press every key and click every cell of each screen; together they added up to about 7,500 s, with
`desk: facets tile` at 150 to 330 s and showcase `X` at 570 s against a 600 s limit, on a machine that was idle. Rebuilding the
screen after each probe took 143 ms a build, about 60% of the facets scenario, in sleeps and settle loops.

- **Measured:** `desk: facets tile` 92 to 127 s, now about 21 s; showcase `X` 208 s, now about 27 s; the six `parity-*` files 861 s
  whole on float-2 (a scenario at most about 40 s).
- **The door is settled when its paint has been made and no host answer is awaited,** not after a sleep. The outline host is asked
  each read once while nothing changes. A scenario's setup keys are pressed as one chunk of input after the first build has reached
  the same screen both ways. A state two keys open the same way is probed once, and a second key whose action names it is not built
  again to confirm (the docs name these narrowings in `packages/door/docs/AGENT-INTERFACE.md`).
- **A scenario over `PARITY_BUDGET_MS` (60 s) fails by its own name** with its slowest key and build, instead of running on to the
  test's timeout and taking the next scenario with it. `PARITY_KEYS=<file>` writes every probe's milliseconds.
- **The door itself got cheaper where the tests found waste:** the power bar's action list weighs each action with one answer to
  where you are and which tile an address names, not one each (it was 19% of showcase `X`'s time); the policy panel
  (`^W P`) no longer builds every action's menu rows to find the one it shows; the drawer chip reads its tabs once; a note's readable
  source, titles and the facets tile's rows are kept while their text and answers are the same; the logo is drawn from its cells once.
- **The hover test's frame bound follows its duration** (the door paints once per 16 ms, so a slow machine paints more for the same
  burst), where `frames <= 10` flaked at 12 or 13 under load.

### A slow or stalled ssh link is sent the latest frame, never a queue of old ones (PIE-1163)

Evan, Oct 21, tethered over ssh: after a wifi drop mid-drag he watched a replay of every intermediate frame. The daemon
can't see the link (its socket to the client is local; sshd's window holds about 2 MB, 60 to 250 frames), and nothing dropped them.

- **A frames-in-flight window per client.** A client's terminal is asked to answer `CSI 5 n` after each frame; with two unanswered the
  client isn't painted, and its next answer paints the latest. The rows it missed are remembered by the diff (`Rows.paint`), so no
  stale frame is ever sent. Measured on a pty stand-in for a 100 KB/s ssh link with a 2 MB window, 100 resize steps at 20 Hz: the
  screen stopped changing about 0.4 s after the last step, from 8 to 10 s before, and 40 KB were still queued after it, from 0.8 to 1 MB.
- **Off where it can't work.** Asked at the probe (`Hello.acks`): a terminal that doesn't answer, or a client behind Herdr, tmux or screen
  (which answer for themselves), is sent every frame as before. A frame unanswered for 5 s is given up on; a program handed the terminal
  (`$EDITOR`, the drop shell) waits for the answers first, so none is typed into it.
- **A drag held still isn't over.** The resize's 0.5 s hold now lasts while the button is down (30 s for a release that never comes), so a
  link that stalls mid-drag doesn't trigger the full relayout and image uploads onto the link that just stalled.
- **Catching up after a stall draws every row again and frees no image** (it disposed every Kitty image and uploaded them all again).
- **`peek` shows it:** `speed.clients` has each terminal's `unacked` frames, `skipped` paints, `ackMs` and `ackTimeouts`.
  No protocol bump: `Hello.acks` is optional.

### Jev's figure suggestions are recorded, and whether each was followed is worked out (PIE-1251)

- **Every suggestion a write's answer carries leaves a record** (`type::suggestion` under Records): the note and revision,
  who wrote (persona and harness), the figure, Jev's gate and confidence, the callout it named, the prompt revision. An ask
  where Jev stayed quiet is a count on that day's `type::jev-run` note (`experiment::figure-fit-live`, the run-level keys the lab's runs share: items, agreed, agreement, tokens), not a note each.
- **Followed, a different figure or ignored is derived, never typed.** A later write that draws the suggested figure within
  five writes or a day (or a figure-fit thread marked Kept) is followed; one that draws another is a different figure once that window has closed
  (the suggested one could still follow); neither is ignored. The verdict is a `suggestion-outcome` record, written once. A "Jev's suggestions" view in pie counts
  them by figure and writer over 7 and 30 days.
- **The records land when the write came through the Claude mod's CLI too.** A note written through `outline_create` was told "this reads as a stat" and pie held
  no record: the CLI exits when its answer is printed, and the first write's bookkeeping (the Records page's templates, a create each, 0.4 to 1 s on pie under load) was cut off after two.
  The writer now sends one request, `suggestions.keep`, and the service makes the records itself, finishing whether or not the writer waits; the MCP gateway, the CLI and scripts keep the same way.
  A new request, so `PROTOCOL` moves: `ep0ch install --apply` on each machine.
- The records writer (`ep0ch record`) moved from the door to the outliner (`@ep0ch/outliner/records`) so the service can write
  records itself; the door imports it from there.

### The door tells its terminal only what deserves a nudge, and `peek` and the speed measure get easier to use (PIE-1310, PIE-1308, PIE-1309, PIE-1302)

- **Tern, Ghostty and Rex no longer get an `ep0ch - done` for every Claude turn (PIE-1310).** The door's own program status
  (OSC 7501) used to follow its tiles: working, idle and done flipped the root every turn. Now the root changes only when a
  tile is blocked on you, a tile failed, or a job that ran two minutes or more is done, and only once the change has held four
  seconds (a tile answered within them sends nothing). A program rewording its ask is the same nudge, sent once; the time a job waited on you isn't its run time. Each report says who, where and what: `scribe in garden · approve:
  Allow Edit: src/seeds.ts?`, `scribe in garden failed: stopped on an API error`, `scribe in garden · 4 min: <its last
  line>` (`finished after 4 min` without one); when it clears, `nothing waits on you in garden`. A terminal that shows the tile
  records (Herdr's sidebar) is still sent each tile as a child; the others hear the root alone. `EP0CH_PROGRAM_STATUS=children`
  or `root` says which for a terminal the door can't tell; `0` is still off.
- **`ep0ch peek` is the compact text by default (PIE-1302).** A few KB: where the door is, `person`, `speed`, and the screen as
  text (at the door's own width: a second render at another width is not side-effect free). `ep0ch peek --json` is the whole
  state and the screen's `text` as one JSON object and nothing else (it printed the screen after the object, so `| jq` failed:
  PIE-1308); `ep0ch peek <section>` (`speed`, `person`, `layout`, …) is one part as JSON. The Claude mod's `door_peek` takes
  `full: true` and `section` for the same; the four narrow-width drawing fixes of PIE-1302 are not in this change.
- **`peek`'s `speed` measures how fast the door settles (PIE-1309).** `since`, `frames`, `reports`, `motionCoalesced` and
  `settle {p50, p95, worst, n}`: the time from the last input of a burst to the frame that shows it, over the latest 200
  bursts. When the last minute's p95 has stayed over 100 ms for a minute the status bar says `slow: N ms to settle` (a click is
  the new `status.speed` action: the numbers, and the same object); nothing when it's fine.

### A links tile with hundreds of rows no longer makes every layout read take seconds (PIE-1303)

- **`layout.get` (and so `act` and the parity probes) listed a links tile's rows once per row.** With a note open that has a few
  hundred links or replies, one read of the layout took seconds of the door's time (keys and paint wait behind it); it now lists
  them once. Found as the reason `group-gather.test.ts` went red under load.
- **Door tests: a scratch host Bun ended at a test's timeout is started again for the next test.** Bun ends every process a file
  started when one of its tests times out, so one slow test used to fail every test after it with `connect ENOENT …/host.sock`;
  now only the slow one fails (`test/scratch.ts` `revive`, asked by `test/preload.ts` before each test).

### An action that changed nothing doesn't repaint, and none paints twice (PIE-1301)

Part of the door-speed audit (a hover that moved nothing painted a whole frame; over ssh every key painted twice).

- **The dispatcher's blanket redraw after every press is gone.** An action says whether it changed what's shown
  (`ActionDef.repaints`: `true`, `false`, or from its answer). Left out, an action that touches `nothing` of the
  person's changed nothing shown, and every other did. An action that already asked for its paint (a `redraw()` of
  its own) gets no second one behind it; one that answers later is painted when it does.
- **Whose redraw it was is known:** a redraw counts for the press whose action asked for it (not for another press running at
  the same time), and a frame an inner press painted doesn't stand for what its outer action changed after it. A screen
  host's `beforeAction` says when it changed what's shown (the desk dropping a hint card), and the press repaints for it.
- **Parity checks it:** a key or click that changes the screen through an action must have asked for a repaint.
- No protocol change.

### A mounted screen acts and looks like one screen (PIE-1283, PIE-1305)

Evan, Oct 25: four screens mounted in screens drew four hint rows and a box inside every box, and a click on a tile's menu refused with "several tiles named reader".

- **The tile menu opens on the tile you clicked.** The person's click, key and right-click go to the dispatcher by the tile's id, so two tiles named `reader` in different layers never refuse the person. Only an agent's `tile=reader` is refused, naming the paths (`calls/reader`) or ids to use.
- **A mount is named for its screen**: `tile.open kind=screen screen=who` is `who` (a part is named for the part, a group is `group`, a second is numbered), so names don't clash in the first place.
- **One rename.** `^W n` (`tile.title`, "rename this tile…") renames any tile, mounted or not: a name-shaped text becomes its name and its title together, so `tile=yo` and the path `who/yo` resolve it; a title with spaces is written on the tile and the name stays. A name already taken in its layer is refused.
- **One hint row, one box.** A mounted screen draws no hint row of its own: the outermost screen's one row says the keys of the tile that has focus at any depth. A tile with a screen in it is its header (name, ▲ full, ⏎ in) with no second box around tiles that already have frames. A mounted screen's shut-dock handle and lock chip, which lived on its hint row, are not drawn (use the key or the tile menu).
- **Kitchen sink:** section `nested-mounts` mounts the last callers' screen with who's online in it.

### The lift works on every screen (PIE-1285)

- **`lift` on the component library said "no tile drawer.agent on the component library".** The drawer is above every screen, so `tile=drawer.agent`, a tile's id and an `@screen/tile` path are read once, by the host layer (`HostLayer.resolveTile`), and every screen's dispatcher asks it when its own tiles name nothing. `agent.lift`, a `tile.zoom tile=drawer.agent` button and `✦a` lift and drop the drawer's agent from any screen; a tile name that doesn't exist is still refused.

### Settle settings live on their capability note, not in the folder config (PIE-1299)

#918 let the settle check read a `settle-tuning` line from `.ep0ch/config.toml` (and PIE-1268 a `settle-outlines` one), but
that file holds names only, so such a line makes every session in the folder lose its outline. The check now reads both
from the outline: `[settle-tuning::…]` and `[settle-outlines::…]` on a `type=capability` note (pie's settle note has the
tuning), the newest edited note carrying each winning, read at every check. The `settleTuning` and `settleOutlines`
options and their `EP0CH_SETTLE_*` variables still override. The folder config is never read for either. No protocol change.

### A new agent starts fresh where Claude has no conversation to continue (PIE-1295)

- **`alt+g` in a new folder no longer ends in "No conversation found to continue".** Claude leaves a transcript of settings lines only (no
  user turn) when a start closes before a prompt, and a folder of only `claude -p` runs has user turns that an interactive `--continue` refuses
  too; the door took any `.jsonl` for a conversation. One question, `hasConversation` (claude: an interactive user turn in the head of the
  newest twenty transcripts; pi and codex as before), now decides a start and a restart both: a restart of a fresh
  claude runs plain instead of adding `--continue` blindly. No protocol change.

### Sweeping the mouse over ssh paints where the pointer is now, not every cell it crossed (PIE-1300)

Evan, Oct 25: over ssh, sweep the mouse and stop, and the highlights replayed the path for dozens of seconds. A flick of 200 reports took
2.6 s to settle and a key typed after it waited as long; the door painted a whole frame for every cell the pointer crossed.

- **Hover reports are handled at most once a frame, and the newest wins.** The door asks the terminal for a report for every cell
  (`?1003h`); `App.key` now holds the newest no-button motion and handles it when the batch being read ends, or when a frame has passed since the last
  one, whatever size the link cuts the reads in. A click, a key, a press, a release or a drag with a button held is never held or dropped: it is
  handled at once, after the hover before it.
- **The session daemon handles one socket read as one batch,** so the frames a busy link delivers together paint once, not once each.
- **`text.hover` redraws only when what the pointer reveals changed** (`Overflow.hover` says so).
- **`peek` shows how the door keeps up:** `speed` (`frames` painted, `motionCoalesced` hover reports folded into a newer one) and `hover` (where the pointer
  rests and the cut-short value being read).

### A terminal knows its agent from the agent's own report, on every machine (PIE-1296)

On the Mac, a claude running in the drawer was reporting `claude-code` over OSC 7501 and still listed no session, so
alt+g's `agent.start` started a second one beside it (and that one, `--continue` with nothing to continue, exited).

- **The report is the answer.** The latest root OSC 7501 report's `app` names the agent in a terminal tile (`claude-code` is
  claude), as soon as it starts: the Claude mod reports once when a session starts, so an idle claude is known too.
  `agent.start` for it attaches to that tile instead of starting another.
- **It goes when the program says so.** A `clear` that leaves no record, the program exiting, a new prompt (OSC 133 A)
  or a reset ends it, and on Linux so does the shell taking the terminal back from an agent that was killed before it
  could clear. Its `done` and `error` records still stay for you.
- **Programs that report nothing (codex, pi) are found as before:** their processes by name (Linux `/proc`), else the tile's
  own command. The wrapper's printed "exited" line is still read, for the exit code the drawer shows.

### One list, drawn the same everywhere: the `list` primitive and the door's ListView (PIE-747)

Asked Oct 25 ("i want it"): a real list in every client without a door feature. An extension (marginalia's notebook, a
Readwise board) returns `view.list({ rows })` and gets selection, a filter, a preview and one thing for ⏎ to do per row.

- **The `list` view primitive.** Rows have an `id`, a `label`, and optionally a `detail`, `mark`, `tone`, `group`, a `preview` (a block or Blockdown) and
  `do`: exactly one of `open` (a block or Resource), `run` (an action), `copy` or `insert`. A row with no `do` is a header. The door draws it with its
  one `ListView`; Detail and Markdown as a bulleted list, a published page as `<ul>`, CSV as label and detail. The service refuses a row with two
  activations and says which.
- **`^name` names a component** inside its note: `::links{query="…"} ^orders`. A list's pick, filter and scroll are kept under it (else under the
  component's place among the note's), no longer under its title, so editing a title above no longer moves one list's selection to another.
  `((note^orders))` opens the line.
- **The links tile, the inline `::links` and an extension's `list` are one list.** One row drawer, one `ListView` over `RowView`. The tree's links rows use the same drawer.
- **`list.blocks`, `list.pick`, `list.step`, `list.open`, `list.filter` and `list.enter` replace `links.blocks`, `links.pick`, `links.open`, `links.enter`,
  `backlinks.pick` and `backlinks.open`** (an old name answers with the new call). `tile=` names a reader or a links tile, `list=` which list
  (its number, `^name` or title).
- **An agent's pick and filter are its own.** They are drawn in its tint on the row and in a line under the list, and never move your selection, filter,
  preview or keys (an agent's pick used to preview in the tile beside; `list.open` is what shows a note). `list.enter` is yours only.
- Kitchen sink: the `list-view` section, a links block, an extension's list and the links tile on one note.

PROTOCOL and GRAMMAR change (the primitive catalogue, the `^name` form): restart the outline host and the doors on this code (`ep0ch install --apply`).

### A refused press says why (PIE-1264)

- **`ep0ch act`, MCP `script_run` and the door's press answer with what the script said.** They wait up to 3 seconds
  for the run to end and return its last word: the line it returned, the refusal it threw ("the cellar is closed: it
  needs candles >= 4"), or "<name> done", with `state` (`done`, `failed`, `stopped`) and the whole `answer` when it
  returned more than a line. A run still going says "still running" and names `script.stop run=<id>`, never just
  "working". An agent's press of a run that failed is refused with the script's message. No protocol change.

### Restart a background Claude session with `ep0ch agent restart`, from your laptop too (PIE-1273)

Asked Oct 25, from the laptop: "is it just `ep0ch ... stuff`, or does it have to be run from scripts?" It is `ep0ch` now:

- **`ep0ch agent ls [--machine <ssh-name>] [--json]`** lists the machine's Claude Code sessions: name, short id, background or interactive (with the door terminal tile and outline an interactive one runs in, when its parents say), busy or waiting, and the version each process runs beside the installed one, `behind` when older.
- **`ep0ch agent restart <name | short id | --all> [--if-update] [--fresh-daemon] [--check-env VAR] [--now] [--dry-run] [--machine <ssh-name>]`** runs `scripts/agent-restart --bg` there (over ssh with `--machine`, to that machine's own `ep0ch`) and prints the log's place. A name matching nothing or several is refused at once (it used to be said only into the log once detached); an interactive session is refused with why and the way out (`/exit`, then `claude --continue` in its terminal); `--all` stays background-only and says which interactive sessions it left out and which of them are behind. `--dry-run` no longer waits for a safe moment: it says what it would wait for. Only `--machine` names the machine, never `EP0CH_MACHINE` or a `.ep0ch`.
- The remote-`ep0ch` helper (`remoteEp0ch`) now escapes single quotes in what it carries, so a session name like `it's` crosses the hop.

No protocol change. Restarting an interactive session in a door tile would be a tile action (restart the tile's program): not built.

### A status-bar button that lifts toggles, and `agent.lift` is `tile.zoom` on the drawer's agent (PIE-1279)

Evan, Oct 25: a `::button{label="lift" act="agent.lift"}` lifted the agent the first time, and the second click did nothing, as did every one after.

- **A status-bar click no longer undoes what its action did to a lift.** A click on the bar dropped any lift first (so work that moved to the bar didn't land under it), then ran the button: a lift button saw nothing lifted and lifted again. Now the action runs, and a lift it left as it found it drops after; one it lifted, dropped or moved is its own. Both `agent.lift` and `tile.zoom tile=drawer.agent reach=column` buttons toggle (lift, drop, lift).
- **`agent.lift` is a preset.** A new `preset()` in the action sets (an action defined as another with arguments bound, its own name, summary and `actions` row, and steps run first) makes it `tile.zoom` on `drawer.agent` at `reach=column`, after starting the drawer's program when it never ran, or bringing it home when it was left on a screen that isn't shown. Which tile is the drawer's agent is the tile grammar's answer alone (`drawer.agent` names the running program, in the drawer or out on the screen shown), so a stale or second tab can't be lifted instead of the live one.
- **A status click drops its lift a moment later**, once the button's action has finished, not before it starts.

No protocol change.

### The write tools hold the house rules where the writing happens, and the answer says what to fix (PIE-1270)

Agents followed "write notes Evan can read" after a reminder and drifted back, because the rule was read once. Now it is next to every call:

- **The rules are in the write tools' descriptions** (`outline_create`, `outline_edit`, `outline_patch`, `outline_comment`, for MCP, the Claude mod and the CLI alike): conclusion first, a title line under about 70 characters, a section of one component plus three short lines, a paragraph of three sentences, counts in live figures, a question for Evan first as one `- [ ]` with `[needs::sysop: …]`.
- **The answer measures what was written**, in code (outline-core's `write-shape.ts`): a long title, a paragraph past three sentences or 500 characters, twelve lines of prose with no figure or callout, a callout inside a callout, a question for Evan below the top with no `[needs::sysop]`. Each is a `warnings` entry starting "fix before you call this done", and the answer always ends with `next`, the check to make (`ep0ch show <id>`). An edit is told what it added, not what the note already was. Nothing is refused: the note is saved as written.
- **A live figure reports its rows.** A `::graph-*` with a `query:` or `view:` that a write added or changed comes back in `figures` ("graph-table on line 2: 14 rows"), asked of the service as the page and the door ask it; one that returns 0 rows, or can't be asked, is a "fix before you call this done" warning with the service's own words (the nearest property keys). Over MCP an agent can't see a figure draw, so this is how it finds out.
- **The descriptions add the self-check** (no paragraph over three sentences, no count typed in prose) **and the chirp rule** (an idea still forming is `[type::chirp]`; a request is something ready to work on). The ep0ch-outline skill gains graph-props in its shape table, the two-part question convention, suggest mode, and the script traps.
- **The figure suggestion is now a gate.** A note that reads as a timeline, a table or a check answers with "fix before you call this done: this reads as a …" in `warnings`; the `suggestion` field is gone.

No protocol change. The MCP gateway's `said` now reads "N to fix before you call this done (warnings)" and carries `next`. The judgments code can't make (is this a title or a paragraph, does this ask Evan) are PIE-1251's.

### An extension ships its screens, and an agent presses what a script drew (PIE-1264)

What the wyrm door game ran into building on scripts, fixed in the parts it used:

- **Several properties in one write.** `outline_set_property` (the tool, in scripts, MCP and the Claude mod) takes
  `properties: { key: value, other: null }`: all the chips change in one revision, and a null removes its key.
- **File render scripts.** A file script headed `// ep0ch-script mode=render` draws its `name::` lines in place, so an
  extension ships a renderer that `ep0ch install --apply` updates (a note with the same `[script::]` name still wins).
  The wyrm's sheet and town board are now such files, and its town draws its own join button.
- **`button.press note=` reaches what a render script drew** (a view's button, badge, card or row) in a note open
  nowhere, from the service's projection.
- **A missing script names its install.** The service's refusal for a script no extension serves, and the door's
  `ep0ch act <script>`, say `ep0ch act extensions.install id=<extension>` when an extension the repo offers adds it.
- **`q` rows carry `created`**, so a newest-first list doesn't reorder when a note is edited.
- The showcase finds an extension's demo notes under its page by itself.

No protocol change. A wyrm installed before this keeps its old screens as notes ("Player sheet", "Town board" under its
page) and its join button; they win over the new files. Delete them and reinstall to take the shipped ones.

### The settle check: threads gather while warm, and loki is woken when one goes quiet (PIE-1268)

In loki's session the Claude mod now looks at every `[thread::…]` every 30 minutes, in gurgle and pie. A thread is
warming while it is being touched, settled once it has 3 notes (one of them yours) and an hour of quiet, shaped once
roadmap items carry it. A newly settled thread wakes the session with its counts and capability note (the five newest
at a time), and each move into or out of settled or shaped is a line under the day's build log. pie's new Threads page
shows warming and shaped live. `outliner list` takes `--facets <key,…>` (and `--facet-values <n>`) for the service's
value counts of any key over every match. It reads `pie` and `gurgle` on the outline's machine
(`EP0CH_SETTLE_OUTLINES`, or a `settle-outlines` property on the settle capability note, name others); the first check only records what
is already settled, so only threads that settle afterwards wake. `EP0CH_SETTLE=on|off` and `EP0CH_SETTLE_TUNING` change
who runs it and the thresholds (`packages/claude-mod/README.md`). No protocol change.

### Artifacts follow the access model: signed in you see them all, an outsider only what a share opens (PIE-1266)

An artifact is no longer a public link nobody asked for. Signed in, every artifact opens (a note's page frames it, and
`/pub/a/<name>/` shows any artifact full-bleed). Unsigned and unshared, the artifact host answers a sign-in prompt, never
the artifact: the old `artifacts.ep0ch.sh/<id>/<name>/` addresses stop working. `ep0ch share start --artifact <name>` (the
MCP `share_start {artifact}`, the door's `artifact.share` and the card's `[share]`) gives someone a link to that artifact
alone, full-bleed; a share of a page opens the artifacts that page frames for as long as it lasts, and revoking it closes the page and the frames together. Share links stay on the outline's own host
(`https://pie.ep0ch.sh/s/<token>/`). No surface prints an artifacts.ep0ch.sh address any more: an artifact's `url`
(`artifact put`, `artifact ls`, the MCP tools, receipts) is its page in the web client. Deployed repos stay public.
Shares (of a page, the outline or an artifact) now last until you revoke them: `--ttl 4h` (any time from a minute, no 24h
cap) makes one expire, and the shares page's form defaults to "until I end it"; a Cloudflare tunnel still defaults to an
hour, and a snapshot's download and a lease keep their bounded lifetimes. Shares already issued keep their expiry.
Protocol changed (`ShareSession.scope`, `ArtifactInfo.frame`, `shares.start artifact`): `ep0ch install --apply`.
On float-2, the units that run the artifact server, its watcher and the host need `EP0CH_WEB_URL` (see the PR).

### Hand a file to ep0ch from anywhere: a curl, a phone's share sheet, a card in today's note (PIE-1267)

A page, a zip or a tar of a built site now reaches the artifacts inbox without the laptop's sync folder. Ask for a lease
(`ep0ch artifact lease orrery`, `> artifact.lease` in the power bar, or the MCP tool `artifact_upload_lease` for an agent
in claude.ai) and run the `curl -sS -T <file> '<link>/'` it prints where the file is: one upload, one hour, and a link
preview, a HEAD or a dropped transfer never uses it up. The file is checked and installed as the next version, the answer
says what was installed or why it was refused, and a card (titled by the page's `<title>`) lands in the outline's note for
today, with a record line under `artifact-uploads`. Zips (and tars) are unpacked under the tar path's rules, plus caps on
entry count and unpacked size, for the synced inbox too; a refused one waits in `.failed/` with its reason. `ep0ch device
add <name>` makes a revocable token for a phone's "Send to ep0ch" Shortcut (the recipe is in the Artifacts hub). Protocol
change: new host actions (`uploads.take`, `uploads.finish`, `devices.*`) and `artifacts.lease`; restart the publisher and
`ep0ch-artifact-watch` after `ep0ch install --apply`. No schema change.

### Signed in, the site never locks a note against its owner (PIE-1265)

`[publish::never]` now means "never share this outside". Signed in as yourself, the published site draws every note as
it is: a never note opens, is a row in its parent's folder (no more "locked note" rows), turns up in search, embeds on
pages and lists its replies, in every outline the host serves. An unsigned reader, the public listener and every share
link keep the lock exactly as before, and a note under `[publish::never]` still can't be shared. No protocol change.

### A terminal folded to a spine keeps its size, and so does one the layout glides (PIE-1254)

Folding a terminal drew it at every width on the way to its spine, so its shell re-wrapped the line you were typing at 3
columns and kept what it cut (`$ echabc def` after opening). A terminal now keeps the size its program has while it is
folded or moving, and is told the size it lands at once. `layout.get` reports the drawer layer's rect as `peek` does
(the strip while folded). No protocol change.

### A tile dragged onto the drawer lands where you drop it, not always as a tab (PIE-1263)

Drop a tile's title on a side of a drawer tile, its tab strip or the drawer's edge and it lands there, with the drawer's
own ghost and the landing said on the chip (`into your drawer: right of activity`); before, every drop joined the tabs and
you pulled it out and split it by hand. The chip still takes a tab. `tile.drawer` takes `to=` and `where=` going in, as it
does coming out, so act places a tile the same way. No protocol change.

### `-` folds the thing you're on to a spine, in the drawer too, and never hides the drawer (PIE-1254)

In the drawer, `-`, `alt+h`, `^W c`, the tile menu and the frame's fold glyph hid the whole drawer for any tile that
wasn't in a group. Now a drawer tile with a tile beside it folds in the drawer's own layout, as on a screen; a lone one
folds the drawer to a strip at its edge with its title (`+`, `=`, `⏎`, space, `alt+h`, `^W c` or a click opens it as it
was). Putting the drawer away stays `Esc` (step out, then away) and `alt+a`, and is its own row in a drawer tile's menu.
`ctrl+]` in a drawer terminal now steps out of the program first, as on a screen, so `ctrl+]` then `-` folds the tile
(then `Esc` leaves the drawer; a second `ctrl+]` soon after still sends one to the program). A terminal folded while
you type in it stops taking your keys. No protocol change.

### A Claude Code session's writes through the claude.ai connector carry its own persona (PIE-1256)

The connector is one principal, and the gateway's `EP0CH_MCP_PERSONAS` gave every write through it the same default
persona, so a patch from `loki`'s session was recorded as `daddy (claude.ai)` unless the call passed `persona`. The
Claude mod now fills `persona` on the connector's write tools with the session's own (the "writes as" line's) when the
call names none; one that names a persona keeps it. This covers every connector tool that records an actor: the writes,
`outline_write_status` (it only finds a queued write when its persona matches), `outline_snapshot`, `script_run`, the
shares that start and end, `loki_lease`, `outline_new` and `outline_archive`, which now take `persona` at the gateway too.
A write recorded as another persona than the session's says so once in the transcript. No protocol change. The gateway
needs a restart to take `persona` on those tools (`ep0ch install --apply`); the mod loads with Claude Code.

### A disabled or shadowed extension no longer supplies scripts, and a button names the plain install command (PIE-1240)

An extension's declared scripts now come from the extension registry's own list: a disabled extension, or a copy another
folder shadows (the outline's own `neat` beats the user's), supplies none, and enabling it brings them back on the next
reload. A button whose script is not installed says `install with ep0ch act extensions.install id=<extension>` (it was
"reinstall", wrong for a first install). No protocol change.

### A link pressed in a chat or terminal opens where that tile's open wire points, also in the drawer's own chat (PIE-1257)

A reference pressed in Claude (or `door_open`, or `ep0ch open … from=$EP0CH_TILE`) from the drawer's own chat landed in a
new reader on the screen, whatever its `open` wire said: the program names its tile by the name it was told (`shell`,
`claude`), which the door didn't know for that tile, and the mod then asked again without a tile. The door now finds a
tile by what its program was told (`EP0CH_TILE`, `EP0CH_TILE_ID`) when no tile has that name, and the Claude mod names
its tile by the id the door gave it (`EP0CH_TILE_ID`), which names one tile where a name can be shared. A tile of the
drawer with no wire opens the note on the screen shown, as before, instead of refusing. `door-open` still lands a note for a tile the door can't find on the screen, but now says which tile it named
(`tileNotFound` in its answer, a line on stderr). Hyperlinks the outer terminal
opens itself (ctrl/cmd-click on an OSC 8 link) never reach the door, so they don't use the wire. No protocol change.

### Typing never lands in the wrong place while a note is opening in edit, and a failed open keeps what you typed (PIE-1153)

The key that opens or resumes an edit (`e`, ⏎) is no longer typed into the draft, also when the door was restarted
under you. While a slow read is still opening the edit, what you type waits for that edit and goes only to it; a
command or a click cancels the wait and is routed as usual (ctrl+w, menu filter keys and esc work; repeated ⏎ no
longer inserts a newline). If the read fails, the typing is kept as a copy on disk and the tile menu offers
"recover typed text": copy it, or open a fresh edit with it inserted. No protocol change (#824).

### Typing `::` offers each component once, and its attributes and values complete from the schema (PIE-1127)

`::` lists one row per component (its name and what it's for), grouped by the component's own group and ranked by
what this outline uses most; the preview shows the selected component's library demo, and → or a click on `›` opens
its variations and arguments. After `::fields{`, props come from the schema with the ones you wrote left out
(attributes after the cursor too); `key="`, `sort=` and `group=` offer this note's keys first, then the outline's;
`where="key=` offers that key's values; `act="` offers the actions with their arguments; `of=` offers script names or
references. Protocol 252: update the host and clients together (`ep0ch install --apply`) (#823).

### A list previews the selected item's children beside it (PIE-1139)

Mark a list `[children::preview]` (or press `p` on its fold chip, or use the reader menu) and each item is one line;
the selected item's children draw in the attached surface beside it. `j`/`k` or a click select and preview, ⏎ or a
second click unfolds in place, `e` edits the children. List items inside callouts now fold individually (`f`), and a
callout can carry metadata (`> [!success|preview] Five calls`). Protocol 251: update the host and clients together
(`ep0ch install --apply`) (#821).

### The edit preview draws live components from the unsaved draft (PIE-1141)

In the door's edit preview (ctrl+p), `::fields`, `::if` and `{{ }}` now draw as the note being edited, so a
`mode:: bam` you've just typed shows in the preview before you save. While an answer is pending the previous value
draws dimmed, never as current. No protocol change (#818).

### Sources takes the comment box's placements (PIE-1138)

The comment box and the Sources panel share one attached surface: inline, floating, split (beside or below, with a
divider), popup or a tile. Clicking the placement chip opens a menu at the chip with the current placement drawn as the
selected row (ctrl+o still cycles). A floating comment no longer vanishes when Sources opens, a covered float no longer
takes clicks or the wheel, and Sources in a tile shows Query, Transform and Result side by side when wide (#817).

### Cut-off text scrolls in place, not as a band across the screen (PIE-1140)

Hovering or selecting a string the door cut short now scrolls it in its own cells, on its own row, in the selection's
colours, and the tiles beside it stay as they were (#816).

### Style one list of several without touching the others (PIE-1135)

Tuning the middle of three lists through tune's "this list" changed the first list's spacing too, because a list's
first item took the layer before it. A list now saves to and reads from its own layer only. The kitchen sink has a
"style one list of several" section. Protocol 250: update the host and clients together (`ep0ch install --apply`)
(#812).

### The tune panel never hides your choice and groups its values; a note's header is one band with a rule (PIE-1128, PIE-1129)

In tune, the level and width rows wrap, the chosen level says what it means, the revert-all warning wraps and leads
with what it drops, and the tokens sit in collapsible groups (Text, Space, Surface, Header, Lists, Headings, Figures,
Images, Other) that remember their folds; `header.image` says "none (this note has no hero)" when there isn't one. A
note's header is one band across every header row, so `header.bg` colours all of it, in a dark red where you asked
for red. New tokens `header.rule` (none, line, dots, heavy) and `header.rule.tone` draw a rule under it. Protocol
249: update the host and clients together (`ep0ch install --apply`) (#807).

### Where did that open: the tile an open landed in stands out (PIE-1131)

The tile an open, preview or agent action just landed in gets a bright frame and a ✶ in its title until you focus,
scroll or click it (or 10 seconds pass); the status line says "opened in 2 · detail3", an agent's too. Tile names are
unique across the drawer and the screen (a clash in a saved layout is renamed once on load, and said), and on a drawer
tile alt+l lists the screen's tiles by number and name (#808).

### Alt or ctrl + drag on a tile's title resizes it instead of moving it

With alt or ctrl held, the whole header row is the border above: drag the title up and the tile gets taller. A plain
drag still moves the tile and shift+click still gathers (#806).

### A click on a figure's row selects it, as in every list

One click on a row of a live figure (tabs, table, check, decision, rank) selects it and the preview follows; a second
click or ⏎ opens it and alt+click opens fresh. A click no longer fires the open wire at once (#805).

### The scripts page's noughts and crosses plays on a click, and one esc closes the power bar after a run

Each empty square on the scripts page's Example 3 is a badge you click, with a "new game" badge; a view row of short
children stays one row in Markdown. The kitchen sink's seed-report demo is a button that ticks its checklist, and in
the power bar one esc closes the bar right after a typed line ran (↑ still recalls it) (#809, #810).

### Note links in Claude replies show their titles again (PIE-1130)

A note link in a Claude reply had fallen back to the first eight characters of its id, because the title lookup was
refused and never asked again. It is asked again with backoff and drawn as the title. Reload the mod
(`/reload-plugins`) in a running Claude (#804).

### Grouped tiles keep taking opens and previews, and a group travels whole through the drawer (PIE-1120)

A tile inside a group is a target like any other: opens, previews and wires reach it, `b` from a detail reuses the
grouped links and preview instead of opening new ones, and alt+l wires across a group's boundary both ways.
`tile.drawer` on a group moves it whole (tiles, tabs, wires, drafts) and brings it back the same way, and a note's
`::button` with `host.toggle` or `tile.collapse tile=<group>` pops the drawer or a group up and down (#803).

### The power bar corrects commands and lets you take them into notes (PIE-1126)

A mistyped action, argument or fixed value shows its correction or allowed values on the run row. Tab and right
at the line's end complete arguments from the same schemas and system values as the form. The docs scroll,
select and copy; clicking an example puts it on the line. Runs keep their answers in a short session history,
and up on an empty line recalls the last. Alt+o copies the command, Alt+y copies a note button, Alt+i inserts
it at your note cursor as one unsaved draft step, and Alt+m or a row's right click opens the copy menu. Alt+j/k
scroll the docs; Alt+v gives them selection keys (esc returns to the line).

### Every hint card can be turned off for good, stays put, and marks the current choice (PIE-1096)

A hint card has `[pin] [dismiss] [never]` (alt+shift+N is never); never sends that hint to a short line in the status
line, kept per person. Tune › Hints lists every hint with its setting (card, status or off) and a reset; `hints.list`,
`hints.set id= to=card|status|off` and `hints.reset` are the same by `act`. Edit mode's prompt now defaults to the
status line. A card also stays where it was placed while the pointer moves across it, and the wire card (alt+l) draws
the wire being changed as a selected row (#801, #799, #800).

### No dead ellipsis: anything the door cuts short can be read whole (PIE-1113)

Every string the door cuts short carries its full value: hover it, or select it with the keys, and it shows whole;
status lines scroll as a marquee; alt+? cycles the clipped values in view. Fewer cuts to begin with: the sources panel
wraps, tables drop the id column before cutting titles, and recent status messages keep their full text. Copies,
refusals, `act` and `peek` results and CLI output stay plain (#798).

### The reference picker never covers what you're typing (PIE-1104)

The `((` picker opens below the line you're typing when it fits, else above it, never over it, up to half the tile
tall. Its header echoes your query with the scope chips (`references 1/17  ((Kitchen`), rows highlight the matched
characters, scrolling past the first page loads more, and the preview opens at the passage that matched with its
line highlighted. Protocol 248: update the host and clients together (`ep0ch install --apply`) (#797).

### Deploys reach the Mac over the machine link (PIE-1124)

`ep0ch install --apply` on float-2 sends an install request over the link to each connected machine; the machine runs
the install on a clean `main` (fast-forward to that exact commit, nothing else) and sends its result back to the
Deploys note. An offline machine installs on its next connect; the door shows "update ready · installing". With
`ep0ch link auto-install off` it shows "update ready · ep0ch install --apply" instead. A deploy is no longer stopped
by a machine that is away: the server's link step checks only its own service. A machine that never ran this needs one
manual `ep0ch install --apply` first. Protocol 247: update the host and clients together (#792, #794).

### An agent's edit that can't apply is refused like a stale file edit (PIE-1125)

An agent's `outline_patch` or `outline_edit` on a note that changed since it read it is refused with nothing written:
"not applied: <title> changed since you read it (revision N, now M); read it again and send the patch against the new
text." The agent re-reads and retries, and no proposal pile builds up under "waiting on you". A clean merge into your
live draft still applies; `propose: true`, queued netmail writes and propose-only access still make proposals.
Protocol 246: update the host and clients together (#795).

### Arrow keys step through every live figure's tabs and rows reliably (PIE-1099)

On a live figure, ← → move between tabs, ↑ ↓ between rows (crossing into and out of the tab bar), ⏎ opens and esc
leaves; it no longer stops working for a while after a tab switch. Protocol 245: update the host and clients together
(`ep0ch install --apply`) (#790).

### Machine links come back after restarts, and remote reads try the link before ssh (PIE-1118)

A silent or dropped link reconnects with backoff after either end restarts (install, reboot, sleep and wake), and
`ep0ch link status` keeps a short history (last up, why down). Everything that reaches another machine's outline
(`--machine`, a `.ep0ch` machine, the door's remote sessions, the mod) tries the link, then ssh, and says which it
used (`box-a via link` / `via ssh`); a refusal names both routes and the fix for each. `ep0ch install --apply` checks
the link came back. Protocol 244: update the host and clients together (#789).

### Backspace on an empty power bar keeps its scope, and alt+backspace deletes a word (PIE-1101)

Backspace on an empty line no longer jumps you back to "all"; leaving a scope is alt+← or esc. Alt+backspace deletes a
word in the power bar (and wherever the shared editor does), including over kitty-protocol terminals (#788).

### Every tile closes into a calm home, and the drawer's agent changes with one click (PIE-1119, PIE-1117)

An empty screen, drawer or agent panel shows a home with Search or command, New note, Shell and Agent buttons and a
"Getting about" list, and a shell is still one key away; one more ctrl+w x on an empty home says what to press.
"New note" in the drawer opens a draft in that tile, returning to an open screen reuses it, and a mode's keys appear in
the tile footer only. The drawer chip's agent picker replaces the agent tab (asking first if it's busy), says when
`EP0CH_DAILY_AGENT` overrides it and which line removes that, and `ep0ch agent use <name> [--everywhere]` does the same.
A plain click on the chip opens and closes the drawer as before; the picker is alt+click or right click. Protocol 243:
update the host and clients together (`ep0ch install --apply`) (#786, #787).

### Note buttons run the screen's actions, and every status message is kept in a log you can open (PIE-1115)

A note's `::button{label="Desk" act="layout.load name=daily-test-ride"}` runs any action the screen has, attributed,
instead of flashing a raw error; an unknown action is refused in words with a did-you-mean. Every status line,
refusal, warning and error is kept in the session's message log: `status.log` (a click on the status line, the keys, or
`act`) opens it and `/` searches; `ep0ch log` prints it and `--follow` tails it (#785).

### The sources panel is a real panel (PIE-1100)

A click in the sources panel beside a live figure gives it the keys; `j`/`k` and the wheel move inside, esc gives the
keys back, and clicks no longer fall through to the reader. Each Result row is selectable: ⏎ opens its note, alt+⏎
opens it beside, and `g` jumps to the figure's line. Whole values wrap, and a figure's properties (density, group, sort,
title, query…) edit in the shared inspector and save back to the figure as one undo step. Protocol 242: update the
host and clients together (`ep0ch install --apply`) (#784).

### A button that opens a screen already under this one goes back to it

`screen.open name=board` pressed on a screen opened over the board used to refuse ("already open under this screen");
it now pops back down to the board, never a second copy (#782).

### A script press says its own answer, and keeps only useful output (PIE-1112)

Pressing a script button shows the script's own answer plus `ctrl+z undoes`, not "running as script:x; results in
((id))" in the warning slot, and it leaves a results note only for multiline or structured output, explicit output
writes, or `[results::keep]`. The script's identity stays in revisions, attribution, peek and x-ray. Protocol 241:
update the host and clients together (`ep0ch install --apply`) (#781).

### A page's figure or view can no longer freeze the outline host; the publisher says "busy" instead of failing (PIE-1047, PIE-1009)

On Oct 18 one published page held float-2's outline host for 57 s twice: the page's `thread:me` replies view asked
which of its 50 rows the page may show, and the host read every note's links once per row (a `links:` atom over pie
took a second on its own). Both are fixed: a `links:` atom reads the link index (about 20 ms instead of 950 ms on pie,
so every figure, view and `::links` query with `links:` is faster), and the row check reads the links of every row
at once (53 s to 22 ms on a copy of pie). One `site.answer` now has a 2 s budget: past it the answer stops and says
"still counting", so no one note's computation can hold every outline. The host's `slow_request` log names the note,
figure and query a request was computing. The publisher draws "still counting" in a figure the host couldn't answer
in time, answers a page it couldn't read with 503 "The outline host is busy; try again in a moment" (the sign-in
listener too, where my.ep0ch.sh said "could not be reached"), and a publisher started while the host is busy waits
for it instead of exiting. Needs a protocol bump (the new `still-counting` problem code) and `ep0ch install --apply`.

### Claude replies: a bare `((id))` shows its note's title, and links out look different (PIE-1043)

An unaliased `((id))` or `((id^anchor))` in a reply is drawn as the note's title (with `› anchor` for a fragment),
not the raw uuid; until the lookup lands, or when the block is not found, it is the first eight characters and `…`.
Links to the web, bare or `[label](url)`, are drawn dim with a trailing `↗` and open in the browser; references to the
outline keep the underline and open in the door.

### A press on a reference in a Claude reply opens in the live door; bold and tables survive (PIE-1043)

A press (and the `show` tool) resolves the door the way the door tools do, by `ep0ch where`, so a Claude resumed after
its door restarted, or started outside a tile, opens the note in the folder's door instead of the mentions pane; when
no door answers the toast says why. `**bold**` and `*italic*` around a reference and other text draw as bold and
italic, and a table with a reference in a row stays one table with pressable cells. A Claude that came in over ssh
(no `EP0CH_TILE`) opens from the tile it is drawn in: the new read-only door action `host.tileOf` finds the terminal
tile whose ssh client holds the connection named in `SSH_CONNECTION`, so the press follows that tile's opens; when no
tile is found it opens where the screen's opens land, silently. Reload the mod (`/reload-plugins`); the door needs
`ep0ch install --apply` for `host.tileOf` (an older door just opens without a tile).

### References in Claude's replies show their label, never the address (PIE-1042)

The Claude mod no longer prints `(https://pi-outliner.invalid/work/PIE-n)` after every reference in a terminal: the
reference is its underlined label, and a press still opens it in the door. `https://my.ep0ch.sh/pub/p/...` links Claude
writes are read as the same references. Reload the mod (`/reload-plugins`) in a running Claude.

### A tile's menu taller than the screen scrolls (PIE-1036)

The wheel over a tile's ⋯ menu scrolls its rows (the cursor goes to a row in view, so ⏎ never runs one off the screen),
a thumb on the box's right edge shows how far down it is, and the foot (the hint) and the last rows stay reachable at
any height; the arrows still move the cursor. A `ListPicker` takes `scrolls: true` for the same.
### The access view reads the machine that serves the gateway (PIE-1037)

"Who can reach what" (the tile, `ep0ch mcp access --matrix`, `mcp.access.matrix`) read the caps (`mcp.env`) and the usage
records of the machine the door runs on, so a door on float-box beside a gateway on float-2 showed no usage and the default
caps. It now asks the outline host of the machine the outline is on (a new host action, `mcp.access.files`: that machine's
caps and the last week's usage) and says on the tile, and in the CLI's last line, which machine it read. A cap is written into
`mcp.env` on the gateway's machine, so a plan for one from another machine says the `ssh <machine> ep0ch mcp access --cap ...`
to run there. The CLI's usage line (`115 calls 43m   58 calls 43m   unused`) pads each cell to its column with a gap.
The host action is new on the wire: the machines need the new code on both sides (`ep0ch install --apply` on each).

### The scripts page's code pointers follow their symbols (PIE-1040)

`bun packages/outliner/scripts/scripts-doc.ts` now writes each `path:line` pointer from the symbol it sits beside, so a moved
line is regenerated and never a red build; `test/scripts-docs.test.ts` fails only when a symbol or file is gone, and names it.

### An action's arguments are a form in the power bar (PIE-1031)

In the power bar (`ctrl+k`), ⏎ on an action that takes arguments opens its form, as charmbracelet's gum does: a field
per argument (the ones it needs first, then `tile=`, the tile it runs on, then the rest), each with what it means and
its answer so far, and the `ep0ch act` line it will run under them. The field you're on lists its values: a tile field
the screen's tiles (by title and path), a note field the outline's search, a page, a screen, a saved view, a property's
key or value, a tile kind, a fixed list of choices (`where=left, right, up, down, tabs, …`), or true and false. Type to
filter them; ⏎ answers and moves on, and past the last field ⏎ runs the line as you (or copies it). alt+⏎ answers and
runs at once, shift+tab goes back a field, and a click on a field or on the act line goes there. The action's examples
are rows too: picking one fills the form. A line typed without an argument it needs (`tile.open where=right`) opens
the form with what you typed answered. The actions scope now lists every action, not only those that need nothing;
alt+⏎ still runs one that needs nothing as it is.

Each action declares what its arguments name (`kind`: tile, note, page, screen, view, key, value, tile-kind) and its
`choices`, so `ep0ch actions` and an action's page say it too; agents read a form's fields with
`ep0ch act bar.form op=open action=layout.move`. The kitchen sink's power bar section moves a tile through
layout.move's form. No protocol change: the outline's wire is untouched (the door's control socket answers `kind` and
`choices` in `actions`).

### Notes route themselves by rules written as notes (PIE-1010)

A routing rule is a note: `[type::route] [query::type=recipe] [route-to::((recipes))]`, with optional
`[route-when::create|edit|command]` (default create), `[route-order::N]` and `[route-at::top|end]`. The first
rule whose query holds for a note moves it there, by the service's one move, as `ext:route`, in one change, with
a history under the rule. A new note made with its words lands where its rule says (`ep0ch new`, an agent's
`outline_new`); a quick capture, a bare note and a new note's first words route a moment after you stop typing; a
note you have open in a draft waits until you close it. A new **Routing** view at the root (`[[routing]]`) lists every
rule; its order is the rules' order. `ep0ch route <note> --dry-run` and `ep0ch route --all --dry-run` say what
would move where and why; `ep0ch route <note>` and `--all` move them; in the door, `alt+z` on a note routes it
(`alt+Z` says what would move, `ctrl+z` puts it back; the tile menu's "route by rules"). New wire request:
`notes.route`; `notes.create`'s placement gains `rule: "route"`. Showcase: "Notes that file themselves".
### One view of who can reach what (PIE-1034)

- **New:** `ep0ch mcp access --matrix` (and a tile in the door: `ctrl+k`, `access.open`) shows every MCP caller (daddy, gpty,
  kitty's batches, the stdio clients, any name in usage or the caps) against every outline: the effective level as a glyph
  and a word (`● full`, `♦ propose`, `○ read`, `✗ none`), why when a caller has less than the outline allows ("rotfield
  allows full; gpty is capped at propose"), and each caller's calls in the last 7 days and last call, so an unused grant
  stands out. It reads what was already there: the outlines' grants, `EP0CH_MCP_PATH_ACCESS` and the usage records.
- **New:** in the tile, pick a cell and press `n r p f` (or click the chips): it says which command runs (the outline's
  grant, the path's cap, or both) and whom it affects, and `⏎` applies it. Only you apply it; an agent reads the matrix
  (`mcp.access.matrix`) and can ask what a change would do (`access.plan`). `ep0ch mcp access --cap gpty@gurgle=full` is the
  cap write on its own.
### An action's documentation is drawn with components, with real examples (PIE-1032)

- **Changed:** the power bar's preview of an action is its page, not a paragraph: its one line, its keys as keycaps, one
  or two real `ep0ch act` lines with what each does (`safe` on one an agent may run as it is), its arguments as a
  properties table (name, values, default or needed, what it means), then the rest of what it says, a fact a line.
- **New:** `ep0ch actions --doc <action>` draws the same page in a shell (`--source` prints its Blockdown, `--json` both),
  from the running door when there is one, else the door's own registry.
- **New components:** `::graph-props` (a properties table; the library's component pages and an extension's page draw
  their tables with it) and `::graph-example` (commands and what each does). They draw in the door, the library and
  on published pages; `::graph-keys` now draws on published pages too, and takes a key with nothing after it (`- esc:`).
- **For agents:** every action that takes arguments has examples (`ep0ch actions` lists them as `examples`).
- **Changed:** `tune.aim` takes `target=` (was `tile=`, which an act line takes as the tile to run in).

### In the power bar tab completes, and alt+← alt+→ change scope (PIE-1014)

- **Changed:** `alt+←` and `alt+→` move between the bar's scopes (all, tiles, notes, actions…); `tab` no longer does, and
  `shift+tab` does nothing. A typed prefix, a click on a scope and backspace on an empty line work as before.
- **New:** `tab` fills the line with the lit row's words (a note's title, an action's name, a tile's path) and keeps the
  bar open, as a shell completes; the list narrows to it, and `⏎` still picks. Inline completion in a draft is unchanged
  (tab inserts). No other screen's `alt+←` (a reader's back) is touched: the bar already held every key while open.

### Each agent can keep its own focus pointer (PIE-997)

`agent.focus tile=… note=… line=…` gives an agent an explicit pointer without moving your keys.
Its untargeted tile actions use that pointer; a dim name in the footer and on its line shows where
it is. Click the name to go there. Presence, `peek` and `where` list all pointers. Clearing the
pointer, closing its tile or leaving its screen restores today's targeting. Agents without a
pointer and `tile.focus` behave as before. Try the showcase's agent-focus section with two agents.


### MCP calls have measured costs (PIE-1003)

Local and gateway MCP tool calls record bytes, estimated tokens, duration and query
shape with values elided, in daily state-directory logs retained for 30 days.
`ep0ch mcp usage` reports totals, median and p90 by tool, actor or outline;
`--census --ws <name>` asks the service for block-size statistics by latest
actor, top-level branch and outline. Both reports accept `--json`.
New wire request: `blocks.census` (protocol 207).

### YOLO survives a session update (PIE-980)

When an update hands your door session to new code, its YOLO stays on in the door and the outline service.
The status line says “YOLO kept across the update” once. Ending or crashing the door still ends its grant,
as does losing the service connection; a new session starts off.

### Fantasia: one button, the whole chain (PIE-959, S9 of the self-reference wave)

`::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 motion=fantasia}` in a note floats the screen's tiles, dances them with
`motion=fantasia` and settles them back, as one layout transaction: your press invites it (it may move the tile you are in), an agent's run
is the same script without the invitation (that tile stays), stopping it puts the layout back, and one `layout.undo` takes the whole run
back. The showcase has it (`act section name=fantasia`); the worked example is `packages/outliner/docs/scripts.md` ("Fantasia").
**Esc, or a click on "■ stop the dance" in the status bar, stops a dance**: while a script run is rearranging the screen, Esc (or `layout.stop`) stops the run and puts the layout back, and the status bar says so when it starts ("fantasia is rearranging the screen · esc stops it"); with no run Esc is the screen's own, and a draft, an overlay, a ^W command or a drag keep theirs. `motion=` on a button is the script's `props.motion`; alone on any action it is a hint for that one action. The showcase screen forwards
script ends and undos to the desks it stages.

### Layout changes move (PIE-958, S8 of the self-reference wave)

What you can now do: a layout change shows itself. Close a tile, load a layout, press a script's button, undo: the tiles that
moved glide from where they were to where they are, over about a quarter of a second (a script's `motion=fantasia` takes a
bit over a second and wanders), and then it is the layout. Nothing fades or flashes and no brightness changes: they only move.

- **The `motion` setting** is `full` (the default: a script's Fantasia is Fantasia), `calm` (a short plain glide whatever
  was asked) or `off` (snap). `act motion.set mode=calm` keeps it; `EP0CH_MOTION` overrides it. It caps every actor's hint,
  an agent's and a script's included.
- **It is paint only.** The layout, `peek`, `layout.get` and snapshots read the settled state; the first key or click snaps
  what is in flight and is then handled where the tile is. Focus never moves for it. A resize drag and a float dragged by
  the pointer are not animated: the pointer is the motion.
- **A region stays drawn while a write is read again.** A write that moves none of the lines a handler line's region hangs
  on no longer makes the region vanish for a frame (a board a script just wrote to); one that moves a line still waits.
- **A published page draws a button as its label** (`::button{…}` and `[label](act: …)`), never the line it would run.

### Sources: where a generated region comes from (PIE-956, S6b)

A generated region shows no mark until the `[ ]` position is in it. The way in is the header's `[sources]`, `S`, or selected
words in a region and the passage toolbar's "Where from" (`a` then `w`): the Sources inspector lists every generated region
of the note with when it last read, and opens one with Query (its parameters, written back onto the note's line), Transform
(its script, template or figure YAML, with a jump) and Result (rows, copy, Outline, Read, Query). One service answer,
`site.sources`, so a published page can draw the same thing. New wire request `site.sources` (the landing's PROTOCOL bump
covers it); outline-core `sources.ts`; actions `sources.*`.

### Acting from content: buttons, transactions, one layout history (PIE-957, PIE-981; S7 of the self-reference wave)

What you can now do: write a button in a note, and let a script's drawing be pressed. Kitty's noughts and crosses is the
example: `ttt-board::` draws the board, each free square runs `ttt-move at=5`, and the board redraws with the move.

- **A press is an action line.** `::button{label="Review" act="layout.load name=review"}` runs one action line;
  `::button{label="Fantasia" of=fantasia layout=focus}` runs a script with its slots; `[review layout](act: layout.load
  name=review)` is the same in prose. A view a script returns has a `button` primitive, and `act` on a `text`, `badge` or
  `card` (and `acts` on a table's rows). A click, or ⏎ on the element, runs the line as you through the door's one
  dispatcher; `act` runs the same line. Your click is the consent: a press runs at once, and what it does is attributed and undoable (`ext.undo`, `layout.undo`). Any other client (a page, an export, Detail) draws the primitive as it was, with nothing to press.
- **An agent presses a button by its words.** `act button.press label="Review"` (or `n=` from `elements`) runs the same line through the same dispatcher, in the reader the person holds too, and lists the buttons when none matches.
- **A press invites the run.** A script you start by pressing may move your tiles, including the one you are looking at,
  where "you are at the keys" would otherwise refuse an agent the moment after your click. It never reaches a draft's text,
  and a tile you start typing in is still refused. The invitation is spent when the run ends. The run's note records you
  and the button's author.
- **A script's drawing arrives as a view.** A render script's output used to reach the door as Blockdown only; the stored
  output now carries the view too, so the door draws primitives (and presses work) while every other client keeps the
  Blockdown. A script's write redraws the render line that reads it (a move redraws the board).
- **One layout history, for every actor.** Every change to a screen's shape is recorded with who made it; `layout.undo`
  (ctrl+z when a reader has nothing of its own to undo and the layout changed after the last trash, the tile menu's row,
  `act layout.undo`) rebuilds from the newest. An agent undoes its own only; nobody undoes over someone else ("the layout
  changed since (you moved notes); undo that first").
- **Transactions.** `txn=<id>` and `motion=<style>` are the dispatcher's own arguments, open to every actor. The first
  action carrying `txn=` opens a transaction: all its layout changes are one history entry. A script run is one, keyed by
  its run id; `layout.txn.end txn=<id>` closes one by hand, and one nothing joins for a minute closes itself. One that ends
  early (the run stopped or failed, the door lost the service) puts its start back and says so; `ext.undo` takes a run's
  writes and layout back together, and says which part it could not.
- **`act` with no door.** A script's `act` with no door connected is refused with where to find one ("no door on pie;
  open one or pass door=<client>"); with several doors it uses the one that asked, else lists them. `scripts.run` takes
  `door=`.
- **Edit and rich edit keep a handler line's last drawing under it**, read-only and without its controls, while you edit
  the lines around it. A line typed above it moves it with the line.

Wire (the landing bumps `PROTOCOL` once): `component-primitives` gains `button`, `act`/`acts`; a render script's stored
output carries `view`; `extensions.act` takes `invitation` and `button`; `ScriptActionCall` gains `requestedBy` and
`invitation`; the events `scripts.ended` and `scripts.undone`; `scripts.run` takes `door`.

### Generated output reads as the note's own content; `r` runs one line, never all (PIE-956, S6 of PIE-533, door)

A handler's output, a component's view, an `@name` request, a `::use` and a written `[!output]` callout draw flush with
the text around them: no box, no indent, no "ran 2 min ago" header and no `[keep] [r run again]` row. One dim `≡` in the
gutter beside each is the only sign it is generated; the `[ ]` position on it, or a click, shows its name, when it ran and
its controls as one dim row, and what is wrong with it stays in the text. `r` with no `[ ]` position used to run every
ticket, handler line and pending `@name` request on a note; with several lines that run it now runs none and says which
there are. A reference or `[key::value]` inside an output region is the producer's, not the note's: no backlink, no
property. Detail's drawing is unchanged.

### `place()`: scripts write output where you say (PIE-956, S6 of PIE-533, service side)

A script with `[effects::write]` calls `place(content, { at: "^week", mode })` and its output lands in the note as an
output region: a folded `> [!output]-` callout it owns, hashed in the text so ownership survives restarts. `append`
(the default) and `prepend` add a region next to the anchor; `upsert` replaces the script's own region or creates it;
`replace` only ever touches an unedited region of its own. A missing anchor is one proposal at the caller with a
did-you-mean, never the end of the note; a region you edited is yours and the new output waits as a proposal. The
note's record (fields, tasks) leaves regions out. `ExtensionCalls.materialize` is now `refreshOutput`.

### box-test enforces its own limits (PIE-998)

`scripts/box-test` on float-box now refuses a second run from the same worktree (it names the running one and how to stop it;
`--replace` stops it and takes over), lets at most `EP0CH_BOX_SLOTS` (default 2) runs go at once (the rest wait and say so), kills
each run's whole process group on every way out and fails loudly (exit 97) if anything tied to the run survives, and sweeps
orphans of finished runs first. The Claude mod and a new Codex hook (`.codex/`) refuse a whole-suite `bun test` typed directly on
float-box or float-2, naming `scripts/box-test`; Codex asks you to trust the hook once (`/hooks`). Nothing to run.

### Published pages: every relation is cut, in one place (PIE-978, follow-up)

The cut now sits in the store the producers ask, so a figure, an `::if`, a `| filter`, a view lane and a `::links` query are
all cut by construction, for every relation (`child:`, `links:`, `linkedfrom:`, `under:`, `parent:`), not only `child:`. The
publisher asks the service (`unknowable`) instead of keeping its own rule. A render script that prints a breadcrumb, or counts
matches it was not shown, says *hidden here*; a script defined in an unpublished note draws as it should. Old render outputs are
drawn again once (the script stamp carries the version of what a render records). Nothing to run beyond `ep0ch install --apply`.

### A published page reads only what it may show (PIE-978, permissions)

Closes the ways a page drawn from the Site could tell a reader about a note the page may not show: a render script's
output (`::= …`, a script line) says *hidden here* when the script read such a note; `::if` over `child:`, `links:` or
another relation says nothing when a note it could consult is hidden (the body stays out); `self` and `chain` hosts the
reader may not see are refused; an ambiguous id prefix names no hidden title; a figure asked outside any note obeys
`hidden` too; a `child:` clause (in a figure, an `::if`, a `| filter`, a script's `q()`) never answers for a note with a child the page may not show. Nothing to run (a protocol bump: update the host and the publisher together); pie's and gurgle's published pages were checked and none drew such a line.

### `::fields` counts front matter, the header and hashtags (PIE-979)

`::fields{key=…}` listed only a note's body lines, so a key written in its front matter (`- connectTo:: v`, a list
value a row each) or header chip answered "0 occurrences". It now lists every occurrence wherever it is written, each
with its line, and a row opens that line lit (a front-matter line isn't drawn in the note, so its row says it is in the property panel, and its `¶` anchor is refused). A `#hashtag` is the key `tag` (`::fields{key=tag}`); `key=tags` finds
only a `tags::` property, and says to try `tag` when it finds none. The showcase's `fields-if` section writes one key
in every form beside the `::fields` that lists them. `PROTOCOL` moves (what outline-core's record holds changed).

### Scripts in a note: one reference page, and examples you can paste (PIE-982)

What you can now do: learn the whole script surface from one page and copy a working example.
`packages/outliner/docs/scripts.md` lists the globals (`this`, `self`, `caller`, `props`), the functions (`q`, `read`, `resolve`,
`act`, `wait`), every `tools.*` and `view.*` with its fields, the modes (action, render, `::=`), effects, access, deadlines,
run notes, undo and yolo, and the traps (an empty `this.children`, a `q` row with no properties, a handler line that
`ep0ch show` doesn't draw). Every entry points at its source as `path:line`. Five worked examples (a sentence from
properties, a table with a computed column, tic-tac-toe in a `[board::]` property, a checklist stamped by a rule, a table from a query) are notes
you can paste; `ep0ch --showcase` seeds them in a *Script examples* section. Nothing to run.

### Install rewrites the old brace forms (PIE-533, landing)

`ep0ch install --apply` runs the brace sweep on every outline, after the schema step and before the host starts: rule
labels and places, `actions` slots and a runbook's `{{env}}` (now `{{self.env}}`). It looks first and writes nothing when
no note needs it; only then does it stop the host (the sweep refuses a served file), and it says what it changed per
outline. Each outline is one transaction and one attributed change (`brace-sweep`), so every previous text is in its
revisions, and a second install changes nothing. `ep0ch install` (without `--apply`) lists the step.

### Templates: `::use`, `template.stamp`, and the runbook on the shared grammar (PIE-954, S4 of PIE-533)

What you can now do: write a template once and use it two ways. Draw it live where a page says
`::use{of=[[meeting-template]] date=2026-10-14 with=Jay}`, or write it out as a note of its own to edit.

- **`::use` draws a template live.** Its body is drawn in place with `this` the page the line is on, so `{{this.title}}`
  in the template is that page's title, also inside a figure, `::fields` or `::if` in its body; `{{props.with}}` is what
  the line passed. Edit the template and every page that uses it redraws.
- **A template declares its props** with `[form-field::with text required]`, `[form-field::mood choice good|meh
  default=good]` chips (text, number, choice, note, tag; `required`, `default=`; a default may be a path:
  `default={{parent.owner}}`). A prop written on the line that the template doesn't declare is a warning with the nearest
  name (`stauts` → did you mean `status`?); a value outside a choice's options says the nearest option; a required one
  left out is asked for by a press (the picker of its kind), or refused with the call that works.
- **A prop can be a path.** `status={{parent.status}}`, or `owner="[[evan schultz]].firstName"` / `ref=((id)).status`
  written as a person writes them, are read in the page's own Site before the template is drawn.
- **`template.stamp` writes the filled text as a new note.** `ep0ch act template.stamp of='[[daily-template]]' as=new
  parent='[[Daily notes]]' title='{{now.date}}'` makes today's daily note: `props.*`, `self.*` and `now.*` become text now;
  `this.*`, `parent.*`, a bare key and a reference stay as `{{ }}` and read where the note lands (`freeze=all` writes those
  too). `for=<query>` stamps once per match (each is `props.for`, `{{props.for.title}}`) and skips a match already stamped
  from the template. The template's own chips are not stamped; `[template-for::meeting]` becomes the new note's
  `[type::meeting]`, and `[from-template::((id))]` says where it came from. The person is asked, in the power bar, for the
  template and for what it needs; an agent names it (`with='{"who":"Jay"}'`).
- **Templates are found by what they make, too.** `of=type:meeting` is the one note that says `[template-for::meeting]`.
- **The runbook runs on the shared grammar** (breaking for runbooks: see its CHANGELOG). A step's `{{self.env}}` is the
  runbook note's own value, `{{props.env}}` a value the run is given; the service fills them. A placeholder with no value,
  or a value from anywhere but the runbook note that could build a command, stops the step. `ep0ch install --apply` rewrites
  an old step's `{{env}}` to `{{self.env}}`.
- **The last single-brace expanders are gone from the grammar's neighbourhood:** an extension's resource link
  `browse/{{key}}` reads `{{ }}`; intake's archive command takes `%word%` (an extension's own argv, not a note's text).
- **A stamped note carries no generated step ids** (`^t-3fa9c1`, a step made addressable): they were the template's steps' addresses, and nothing links to the new note's, so an agent can fill a placeholder step in without declaring an identity change (PIE-818's first request; a name the author wrote, `## Log ^log`, is kept).
- **Kitchen sink:** the section "Templates" (`ep0ch --showcase`, `act section name=templates`).
- Wire: new service reads `template.use` (watched) and `template.props`, and write `template.stamp`; `site.answer` takes
  `interpolate` (a text filled in the Site; the runbook's step) and answers `interpolated` and each value's `head`.
  `form-field` types `note` and `tag`; a template's fields may be named `with` and `color`, the names an action's
  request reserves. No `PROTOCOL` change in this slice.

### Notes that read themselves: `::fields`, `::if` and one figure orchestrator (PIE-953, fourth slice of PIE-533)

What you can now write in a note, and what it does:

- **`::fields{key=connectTo}`** lists every place the note wrote that key, one row per occurrence with its line. A row
  opens its own line, lit, found again by the text it was written as, so it still works after edits above it; a row
  appears as soon as a line is saved. `of=((id))` lists another note's. A row's `¶` anchors its line when you ask
  (`fields.anchor`, by click, `⏎` or `act`) and gives you `((note^anchor))`; drawing it never writes.
- **`::if{where="status=active"}` … `::`** draws its lines only while the note matches the query (the views' grammar,
  `{{this.owner}}` operands bound). A query it can't read hides the body and says why. Its body holds Blockdown but no
  other component (components don't nest yet).
- **A figure copied onto two pages lists each page's own** (`query: type=ticket project={{this.project}}`), including
  drawn inside another note (`site.answer` takes the `chain`), and takes call-site args: `::graph-table{project=lego}`
  reads `{{props.project}}`.
- **One orchestrator.** A figure's question (view or query, groups, `done:`/`now:`, a stat's per-item counts) and a
  figure block's child bullets are asked of the service once, in the figure's Site (`site.answer` with `produce`); the
  door and the published pages both draw that answer, and a page cuts it to the notes it may show. The child-bullets
  query now leaves out proposals as well as comments.

For people who run things: no `PROTOCOL` bump in this slice (the wave bumps it once at landing). Wire: `site.answer`
takes `produce` and answers `produced`; `blockId` may be left out for a figure asked outside any note; a
`.fields.` path answers `offsets` too; `blocks.query`/`query.matches` are unchanged.

### Scripts in their Site (PIE-955, S5 of PIE-533)

What changes for a script: it knows which note asked, takes slots, draws in place, and can be stopped.

- **The Site's globals.** A script reads `this` (the note it is about: a rule's matched block, the note in front of a key
  press, `block=` of an agent's act), `self` (its own note), `caller` and `props` (`week=42` is `props.week[0]`; the
  power bar offers every `props.x` the code reads). No id is written in the script: the Showcase's seed report no longer
  looks itself up.
- **Reads.** `read()` returns the note's record (header, body, properties, fields, tasks, links, backlinks) with its
  children. `resolve("this.owner")` answers as `{{this.owner}}` does, with a did-you-mean for a typo. `q("parent:this")`
  binds `this`. A returned string shows as plain text; one `view.table(…)` is drawn without wrapping it.
- **Render mode.** `[mode::render]` makes a script a handler: a `name:: week=42` line draws what it returns under the
  line, live, redrawn when a note it read changes. It writes no run note and refuses `[effects::write]`. A `::= expression`
  line is a one-line render-mode script. The kitchen sink has a "Scripts in place" section.
- **Running.** A script that writes into its own note keeps running (only an edit of its code ends a run). `wait(ms)` is
  bounded by the script's deadline (`[deadline::2m]`, five minutes at most). `script.stop run=<id>` (`scripts.stop`)
  ends one run. A run note is machinery (`[machine::script]`): lists, queries and what-changed leave it out by default, and
  it counts for no backlink. The backlink relation now leaves out every note stamped `[machine::…]` as a source
  (deliveries, tosses, receipts too); `links:` and `linkedfrom:` are unchanged. An action run now stops at five
  minutes unless the script says `[deadline::…]` (it was unbounded).
- Wire: `site.answer` takes `self` and `caller`; new service action `scripts.stop`. No `PROTOCOL` bump of its own.

### Notes that read themselves: `::fields`, `::if` and one figure orchestrator (PIE-953, fourth slice of PIE-533)

What you can now write in a note, and what it does:

- **`::fields{key=connectTo}`** lists every place the note wrote that key, one row per occurrence with its line. A row
  opens its own line, lit, found again by the text it was written as, so it still works after edits above it; a row
  appears as soon as a line is saved. `of=((id))` lists another note's. A row's `¶` anchors its line when you ask
  (`fields.anchor`, by click, `⏎` or `act`) and gives you `((note^anchor))`; drawing it never writes.
- **`::if{where="status=active"}` … `::`** draws its lines only while the note matches the query (the views' grammar,
  `{{this.owner}}` operands bound). A query it can't read hides the body and says why. Its body holds Blockdown but no
  other component (components don't nest yet).
- **A figure copied onto two pages lists each page's own** (`query: type=ticket project={{this.project}}`), including
  drawn inside another note (`site.answer` takes the `chain`), and takes call-site args: `::graph-table{project=lego}`
  reads `{{props.project}}`.
- **One orchestrator.** A figure's question (view or query, groups, `done:`/`now:`, a stat's per-item counts) and a
  figure block's child bullets are asked of the service once, in the figure's Site (`site.answer` with `produce`); the
  door and the published pages both draw that answer, and a page cuts it to the notes it may show. The child-bullets
  query now leaves out proposals as well as comments.

For people who run things: no `PROTOCOL` bump in this slice (the wave bumps it once at landing). Wire: `site.answer`
takes `produce` and answers `produced`; `blockId` may be left out for a figure asked outside any note; a
`.fields.` path answers `offsets` too; `blocks.query`/`query.matches` are unchanged.

### Notes that read themselves: values in every reader (PIE-952, fourth slice of PIE-533)

What you can now do: write `Play it at {{this.target}}. Owner: {{this.owner}}.` in a note and see the value, not the
braces, in the door, in Detail's preview, on a published page, in `ep0ch show` and in what an agent reads. The editor
shows what you typed.

- **The door's reader** draws a value in place, lightly marked as computed (italic; a URL in a link's colour). ⏎ or a
  click on it (or `[ ]` to it first) lights the line it is written on, said in the banner (`the line this.owner reads`),
  or says it is computed (`now.date`) or why it has no value. Selecting the drawn words and commenting anchors on the
  whole `{{this.owner}}`, not on a lookalike word elsewhere on the line.
- **A typo never loses the save.** `{{this.ownr}}` is saved as typed and drawn dimmed as `{{this.ownr}} · did you mean
  owner?`; fix it and the value redraws. Values follow a change to any note they were read from.
- **The property panel (`i`) lists the values read here** under the properties: what each says, what it reads as (or why
  not) and the note it came from. Detail's property inspector does the same.
- **Detail's read preview** shows the values line for line; a comment on a drawn value anchors on its token.
- **Published pages** carry the value in the HTML. A value that read a note the page may not show (a locked note, a note
  outside a share or a public page) says *hidden here* and names nothing; a bare key is not supplied by an ancestor the
  page may not show, nor any above it.
- **`outline_read` returns `site`** for a note that holds a `{{ }}` (`values`, `problems`, `route`, `deps`);
  `ep0ch show <id> --site` prints the same as a line of JSON with the text.
- **Kitchen sink:** the section "Notes that read themselves" (`ep0ch --showcase`, `act section name=values`).
- Wire: `site.answer` takes `hidden` (notes the reader may not see), answers `hidden` and `source` (the property token a
  value is written in) per value; `outline_read` has `site`. No `PROTOCOL` change in this slice.

### The Site: one read for what a note says about itself (PIE-951, third slice of PIE-533)

What changes for an agent, a script or a figure: a note's own values, its parent's, its ancestors', another note's and
the clock are read through one resolver, with a route that says how each was found. (The door, Detail and the web draw
`{{this.target}}` in the next slice; this one is the service and the tool.)

- **`site.answer`** (new, watched) answers a note's `{{ }}` placeholders and any `paths` asked: `this.owner`,
  `parent.project`, a bare `project` (the nearest value up the outline), `((id)).query` (a unique id prefix works; an
  ambiguous one lists its matches), `[[page]].title`, `person.firstName` through a link value, `this.tasks | status=todo
  .count`, `this.children | type=task`, `now.date-1d`, `props.week`, `caller.line`. Every key is a list. A missing key is
  a problem with a did-you-mean and an example, never an empty string. `draft` reads unsaved text; `chain` reads a note as
  drawn inside another (a `::use` in a host keeps the host as `this`; an embed starts fresh).
- **`outline_site`** (the Claude mod; `outliner agent site`) is the same read for an agent.
- **Properties win over record fields.** A note that writes `[created::…]` or `[actor::…]` (hundreds do) gets its
  property from `this.created`; `this.$created` is always the record's. A key with a dot is `this.echo.node` or
  `this["echo.node"]`.
- **Links in values.** A value that is a `((id))`, a `[[page]]`, a Work ID or an id of 8 or more hex characters is tried
  as a note: exactly one match is a link (shown by its title), anything else is plain text, silently. No key is special
  (a `commit::` value is text unless it names one note).
- **Tasks take open or done from the checkbox**, not a chip: `status` (the chip, else the box), `box` and `state`
  (`open` or `done`) on `this.tasks`.
- **A question can take a value from the note:** `where: project={{this.project}}` binds the note's values as an
  operand (any of a list, nothing for none); a value holding `OR` or a quote cannot change the query. One figure copied
  onto two pages lists each page's own.
- **Watches name their notes.** A watched `site.answer` is evaluated again only when a change touched a note it was
  computed from.
- A figure takes call-site arguments (`::graph-table{project=lego}`) as props under its YAML, and a YAML value that starts
  with `{{` stays text instead of parsing as a map.
- Wire: `site.answer`, `outline_site` and the new `Site` types; nothing to run on a machine.

### One property shape for clients and extensions (PIE-950, second slice of PIE-533)

What changes for an agent or an extension author: a property is read from the note's record, never from a flattened
`key → value` map that kept only the last of a repeated key.

- **`outline_read`** (the mod's tool, the MCP gateway's and a script's `read()`) answers `properties` as
  `[{ key, values }]`, each key once with its values in order, as `ep0ch find --json` does, and a new `fields` for
  the properties of a line or a spot in the text (with where they start). It was a map from key to a value or a list.
  Absorbs PIE-572.
- **An extension's `context`** carries `block` and each of `children` as records (`properties` as `{ key, values }`,
  `fields`, `header`, `title`, `text`) instead of `properties: [{ key, value }]`. An extension reads a value from them,
  not by a regex over `text`: notify, readwise, gallery, columns, glyphs, meeting-card, echonet and runbook do now
  (the runbook's `{{name}}` fills from the runbook note's properties the same way, and a run's status and exit code
  from the run's record). An extension that read `context.block.properties[i].value` reads `values` now.
- **A figure** reads each note it draws through the same record (`FigureItem.properties`), and the mod reads the
  Recent files page's `[file-touches::…]` globs from `outline_read`'s `properties` and `fields`, so a glob with a
  brace's comma, a front-matter one and one further down the page all count, and one in code doesn't.
- **A figure written without its `---` lines** (`::graph-table` then `query:` and `columns:` lines) is read as
  Markdown rows, so its props never arrived. It now says so, in outline-core's words, in the door (the figure and the
  reader's list of what a note leaves open), in Detail (a line after the figure), on a published page (in the figure)
  and in a save's warnings (PIE-941).
- **The door** reads a note's properties from its list (`Msg.properties`, with `prop(m, key)` and `propValues(m, key)`),
  not from `Msg.props`, a map that kept only the last value of a repeated key and left a `[a, b]` list as one string. A
  repeated key now reads its first value, and a list its first element (`system-view` asks every value).
- The showcase's seed and tests are split by area (`src/showcase/seed/*.ts`, `test/showcase/*.test.ts`), so a new
  section is a new file. Nothing changes on screen.
- The MCP `pending.body` fences a queued edit `⟦pending <id>⟧…⟦/pending⟧`, not `{{pending <id>}}…{{/pending}}`, so
  the note's `{{ }}` values (coming) can never mistake it for one.

### Grammar collisions: colours, dividers, `::` and `@name` (PIE-950, PIE-533)

- A `#word` that is a hex colour (`#00e5ff`, `#fff`, `#1a2b3c`) is not a tag: 3, 4, 6 or 8 hex digits, with a digit among
  them, or 6 or more, or one digit repeated. Short hex-letter words (`#bed`, `#cafe`, `#fade`) stay tags; `#facade` reads as
  a colour, and `[tag::facade]` says tag. The property parser version is 12, so
  every outline reparses once.
- A file whose first line is a `---` divider with a blank line before the next `---` is a divider, not empty front
  matter (the front-matter block is the first paragraph, as PIE-684 says), so importing it no longer swallows the text
  between the dividers.
- Tests pin the other collisions: `---` as a figure fence, a rule or a table row; `std::vec` and `Foo::bar` mid-prose
  are neither a component nor a property; an `@name` wakes an agent only at a line start and only for a name an agent answers (`@e_p82 said…`, `@tidy.host`, `me@tidy.host` and `ask @tidy` wake nothing).

### One placeholder grammar, `{{ path || default }}` (PIE-950, PIE-533)

The three single-brace templates are one. A rule's label, an `actions` fence's slots and a component's `use` snippet all
read outline-core's `interpolation.ts`: `{{this.title}}`, `{{match.text}}`, `{{match[1]}}`, `{{props.tag}}`,
`{{props.week || main}}`. A `{{` in a code span, a fence or a literal region stays as written, and `\{{` is a literal
`{{` anywhere. A slot is filled per argument value, after the line is split into words, so a value holding `x tile=other`
or `"; layout.load` is one value and can't become another argument or action. A component's `{…}` attributes and a handler
line's `--option=value` words read quotes as a shell's words do (`query="a b"`, `'a b'`, `a\ b`).
Rule placement uses the words every producer will share: `[rule-place::prepend|append|replace|around]` (`above` is now
`prepend`, `below` is `append`; a rule note still saying them is told so).

**What you must run:** the sweep rewrites your rule notes and scripts (`{title}` becomes `{{this.title}}`, `{slot}` in an
`actions` fence becomes `{{props.slot}}`, `above` and `below` become `prepend` and `append`). `outliner sweep
<database.sqlite>` prints the diff and writes nothing; adding `--apply` (host stopped) writes it as one attributed change,
and a second run changes nothing. The landing runs it for each outline in the install step. An extension's own
`extension.json` writing `"place": "above"` or `{key}` in a component's `use` is yours to edit. The runbook keeps its own `{{name}}` until it is rebuilt.

### One parser, one scope walk, one path resolver (PIE-950, first slice of PIE-533)

Nothing changes on screen. The property parser (`parsePropertyRecords` and its strip and title helpers), the property
summary line and the scope walk ("the nearest key") moved into outline-core, so the service, the door and the mod read
properties with one copy; the door's copies of the `PropertyRecord` type and the summary are gone. A block record's
`fields` now say the `column` and `offset` of each inline or line property. New in outline-core, not yet used by a
client: `resolvePath` (`this.key`, `parent.key`, `props.x` and a bare `key` answered from a note's record, with
did-you-mean for a missing key) and the `Site` and `PropsSpec` types it reads. The comment on `propertyValueLinks` no
longer says `[blocks::PIE-12, PIE-14]` is two links: a plain value's commas are one value, and a list is written in
brackets (#604).

### The Claude mod is called ep0ch (PIE-971)

The mod's plugin name is now `ep0ch` (it was `pi-outliner`): its tools read `mcp__ep0ch__outline_read` and the rest,
its message command is `/ep0ch:msg`, and a tool row reads `ep0ch - outline_edit`. `ep0ch install --apply` moves the
old name in `~/.claude/settings.json`, `settings.local.json` and `plugins/installed_plugins.json`, and in the
`.claude/settings*.json` of `~/projects/ep0ch`, `~/float-hub` and any folder given with `--project` (permission rules
such as `mcp__pi-outliner` and `mcp__pi-outliner__*`, hook matchers, `enabledPlugins` and `pluginConfigs` keys such as
`pi-outliner@inline`), leaving one name. Nothing else in those files is touched. A malformed file stops the whole
step, naming the file and the command to run again. A running Claude session keeps the old tool names until you restart it (`/reload-plugins` is not enough:
permissions and tool names are read at start). The mod's saved choices (the Mentions pane's preferences, the session
binding) were stored under the old name and start fresh. The Herdr plugin id `float.pi-outliner` is unchanged.

### Two focus levels: which figure has the keys, which row the cursor is on (PIE-969)

A figure, table or list with the cursor keeps its amber tint (the container has the keys). The row the cursor is on
inside it is now a blue band with a bar at its left edge, so the bullet changing colour is no longer the only sign.
Every selectable list draws its cursor row in the same band: the outline, the links and query tiles, the river, the
board's cards, the thread and step panels. The band is a theme value (`focus` in `src/theme.ts`) in calm, night and
classic, dark (no bright fill), and every text colour reads on it at 4.5:1 or better (checked from the theme's own
values). `ep0ch --showcase` has a "focus" section.

### A rule under a note's header ends its front matter

A note whose header line is followed by `---` and a list line of tags (`- #a - #b`), with no blank line between,
draws the rule and then the tags as a body line, as it does with a blank line. A `---` line, or a list item with no
property in it, now ends front matter like a blank line; a bulleted line with properties (`- [a::b]`, `- re:: why`)
stays in it. `tag=` still matches the tags on that line. The reader's scroll no longer snaps back to the top on a note
whose tag row stands above a drawn line. Run `ep0ch install --apply` (the protocol is bumped and properties are
re-read).

### Yolo reaches the service: agents act as you in the outline too (PIE-973)

Yolo used to lift only the door's guards, so the service still refused an agent where it would let you: an agent
couldn't apply or dismiss another agent's proposal, an outline at `propose` or `read` still held its writes, and the
guard on dropped `^anchors` and `[page::]` still stopped its edit. Now `agents.yolo` also tells the outline's
service, and while it's on every agent passes as you would: the MCP access level reads `full`, a proposal of anyone's
can be applied or dismissed, an `@name` line that waits for a person's `r` is released by an agent's `r`, and the
dropped-structure guard lets the edit through. The service holds yolo for the door that set it: close, restart or lose
the door and it's off. A second door on the outline shows the red **YOLO** too, and `ep0ch where` and
`ep0ch mcp access` say it. Still true in yolo: every write is attributed to the agent, revisions are checked and undo
works, and a write made in yolo says so in its record (`taskId` `via:yolo`, in `activity.recent`). ADR 0005 says why this is the person's choice and not an outline setting. Protocol bump.

### Yolo: hand the door to your agents

`agents.yolo` in the power bar (ctrl+k) hands the door to your agents until you take it back. In yolo no guard of
yours holds an agent back: not your typing (in the drawer or on the screen), your focus, the two idle seconds, a
tile's agent limit, a lock or an action that is otherwise yours alone. Use it when a screen is in a state you want an
agent to just fix. One thing stays: an agent never types into the draft you're typing in (`draft.patch` lands in it),
so what you write always lands. What keeps state valid
(revisions, the layout's own shape) still holds, and every agent action is still attributed and said. The status bar
shows a red **YOLO** while it's on; a click on it (or `agents.yolo on=false`) takes it back. It's off whenever the door
starts. Turning it on is yours; an agent may turn it off.

### The thread panel is a tree, and a click only selects (PIE-944)

`t` in a reader opens the thread as a phpBB-style tree: the root post, the chain of parents down to the note you're
reading (marked ►), the posts beside each and the note's replies, each with its author and how long ago. A level with
many posts, a long chain and a long run of replies fold around the note with a count; ⏎ (or a second click) on the
fold shows them. `T` is still the full list and `b` the outlinks and backlinks. A click on a row of the panel now only
selects it (the click that gave the reader the keys too); a second click on the selected row, a double click or ⏎
opens it, in the links tile, the query tile, what-changed, EchoNet's lists, the river's cards and a note's `::links` rows too (a click on the row that's already selected opens it, however slowly the second click comes; the click that gives a tile the keys only selects). The kitchen sink's `thread` section shows the panel.

### The Deploys note's table draws (PIE-941)

The Deploys note `ep0ch install` writes failed to draw its table ("String.prototype.repeat argument must be greater
than or equal to 0") because its figure's lines weren't between `---` lines, so the table had no query and no columns.
A new install writes them between `---`. A table figure with nothing to draw now says to put `query:`, `columns:` and
`rows:` between `---` lines, and no figure takes a negative width into a repeat. A Deploys note an earlier install made
needs its `::graph-table` lines wrapped in `---` once (edit the note, or delete it and run `ep0ch install --apply`).

### An agent can move the notes the service keeps (PIE-942)

`outline_move` now moves a system note (Deploys, a snapshot record, the Inbox, Trash, Bookmarks, a guide) anywhere,
attributed like any move: the service finds them by their properties, never their place. Refused still: a place under
Trash, Bookmarks or a guide (the service fills them itself) and a note under itself. The refusal says what the note is
and why. `outline_trash` of a system note, or of a note that holds the Inbox, Trash or Bookmarks, is still refused, now saying what it is. No wire change.

### Move a note from the door (PIE-943)

The door had no way to give a note a new parent. Now `note.move` is one action, run by a key, a click or `act`:
`Z` in a reader (or "move to…" in the tile menu, or a click on a new note's `→ …` row) asks in the power bar where,
with the note's parents and the notes changed lately first, then the Inbox, then any note by its words; `alt+↑`
`alt+↓` put the note up or down among its siblings. In the outline tile the same keys move the selected row (`K` `J`
for up and down on a terminal that doesn't send Option+arrows, `I` in under the note above, `O` out after its parent),
`ctrl+z` puts the last move back, and a drag onto a row moves the note under it (onto its `▸` mark: above or below
it). A river column moves its selected card the same way (`column.move`). The person's move and an agent's are one
rule, the outliner's `moveBlock` (`outline_move`'s), which also takes a `step`. `note.place` (PIE-883) is now
`note.move to=…`. New kitchen-sink section `move-note`. No protocol or schema change.

### A read never creates an outline, and an empty outline file never holds an install back (PIE-938)

`ep0ch show --ws pie <id>` run in a folder with no `.ep0ch` on a machine that doesn't have `pie` (a builder's worktree
on float-box, with the outlines on float-2) now says so instead of "create it with `ep0ch init pie`": nothing was made,
which machines have it (the shared forwards in `.remote/` and the machines you have opened), and the command, as
`ep0ch show --ws pie <id> --machine float-2`. The same for `find`, `export` and `revisions`. Opening a door, `outline
create` and `init` still make a name this machine lacks. `ep0ch install` and `doctor` now report an empty (0-byte)
outline file with its path and the `rm` that removes it, and leave it out of the schema step, so it never holds back an
update. `ep0ch outline list --all` also lists the machines whose forwards are in `.remote/`. No protocol or schema
change.

### Every comment has its target (PIE-933)

A comment written as plain text (an EchoNet toss copying a thread before copies were kept as notes, an agent's plain
write) used to land with `[type::annotation]` and no target: no margin showed it, and opening, answering or
resolving it threw "Annotation target not found". Now any write that leaves a block a comment gives it its target
in the same transaction (a comment on the note it sits under), so a comment made by any write has one. Text that can't be a comment
on a note (at the top of the outline, or with properties that don't read, like an unknown `annotation-status`) is
saved as written and listed by `outline_threads` as `untargeted`, with why, per note and in the inbox; opening one
now says why instead of "not found". Pie's four existing ones: with the outline host stopped and a backup taken,
`bun packages/outliner/scripts/repairs/2026-10-16-annotation-targets.ts ~/outlines/pie.sqlite` (delete the script
once run). No protocol or schema change.

### One relative-date rule: `-7d` means the same in a view, a figure, a find and a question (PIE-922)

- `created`/`updated` clauses no longer keep their own reader of `-N<unit>`: they use outline-core's `readDateBound`, as property comparisons (`due >= -7d`) already did. `d` and `w` are calendar days, `m` and `h` instants. **Visible change:** `updated >= -7d` used to cut at exactly 7 x 24 hours ago (at 3 pm, from 3 pm a week back) and now includes all of the day 7 days ago from its midnight; `-Nw` the same; `> -7d` and `<= -7d` flip at that day's end. `today`, `yesterday` and `now` go through the same reader (the host's clock day). Minutes and hours are unchanged.
- Saved views checked: none of pie's 71 `[type::virtual-branch]` notes uses `-Nd` or `-Nw` in its `[query::…]`, so no view shifts there; a view that does gets up to a day more at its old edge.
- **Deployment:** PROTOCOL 196. `ep0ch install --apply` on float-2, float-box and the MacBook.

### A command run under agent-env never reaches the machine a folder names (PIE-912)

- Under `scripts/agent-env`, a `.ep0ch`'s `machine` and an inherited `EP0CH_MACHINE` are ignored, with a line on stderr saying so; only `--machine <ssh-name>` reaches another machine. Running `ep0ch outline create` from the repo under agent-env used to create the outline on float-2's live host.
- **Deployment:** PROTOCOL 195. `ep0ch install --apply` on float-2, float-box and the MacBook.

### Reply while keeping the message in sight (PIE-707)

`R` opens a temporary reply beside or below the message, using the existing draft editor.
Save posts it; Esc discards it (twice after typing). The message scrolls independently.
Select text and reply, or press `"`, to include a frozen quote with its source.
`t` opens replies in place, including replies moved elsewhere; `b` switches link groups and `T`
opens the full thread list. Raw decoration moves to `~`; comments are unchanged.
The `replies` showcase exercises the shared actions. No schema or protocol change.

### Queries can look back in minutes

- `updated >= -30m` (and `-40m`, any `-Nm`) now works in queries, views, `ep0ch find --query` and the MCP tools. Before, only `h`, `d` and `w` were understood, so "the last half hour" had to be written as `-1h`.
- **Deployment:** PROTOCOL 192. `ep0ch install --apply` on float-2, float-box and the MacBook.

### Inline asks explain unknown agents and use the draft's context (PIE-914)

- `@prior-art` without a reference searches the ask and its note, returning links or “Nothing like this yet.” Questions about when it triggered get a one-line explanation of what it does.
- Unknown line-start `@name` asks stay as typed, with an inline note naming the agents here. Quoted asks stay inert.
- Draft titles follow the first line while typing. Answer badges shorten or wrap without clipping or inheriting the cursor highlight.
- The asks showcase walks through these in a new unsaved note.
- Deployment: PROTOCOL 191; run `ep0ch install --apply` on float-2 and the MacBook to restart the host and clients together.

### Every comment can fold to its mark (PIE-910)

Click `[–]` on any comment card, including a whole-note thread, to leave only its `[+]` mark.
The gutter stays at the reader's left edge outside padding, margin and measure. `M` cycles shown,
full and marks, named beside the comment count; marks hides all cards and restores their expansion
when you return. Agents can change this reading state with `margin` and `thread.toggle`.

### Scripts opt in and run read-only by default (PIE-908)

Only header-opted-in files in the outline folder’s `.ep0ch/scripts/` load. `ep0ch ext ls` explains ignored
files. Write effects must be declared; runs and writes belong to `script:<name>`, with the requester recorded
separately. Bindings now live in `.ep0ch/config.toml`. `ep0ch doctor --fix` and install repair old binding
files, keeping `.ep0ch.bak`; scripts move only with `doctor --fix --move-scripts` after review.

### Agents and extensions wake each other by default (PIE-906) (#592, #593)

- **Changed:** Evan's agents and extensions may wake each other without his `r`; `[invoke-…]` notes now only deny or narrow; an ask a person started (over the OAuth'd connector, or a line an extension copied from the person's note) runs as the person's; a line is held only when a loop guard trips (repeat, hops, budget, cap), and says which. The showcase explains it (#593).
- **Deployment:** PROTOCOL 189; `ep0ch install --apply` on each machine.

### Plain inline answers stream while you type (PIE-903)

- PIE-903: plain inline agent answers stream through the existing draft patch, answer fold and beside tile;
  the caret stays anchored, the status counts paragraphs, and the whole answer is one draft undo step.
- **Deployment:** wire changed; PROTOCOL 188 requires updating the host and its clients together.

### Keep typing while an inline ask answers (PIE-902)

- **Changed:** typing elsewhere no longer postpones an ask. Replies land in the live draft through
  `draft.patch`, folded under the ask, with the caret's screen row held steady.
- **Added:** an answer tile shares the comment tile's dock pair; an agent-written `[script::]` reply
  runs immediately and can return the existing component view primitives. The `asks` showcase and a
  scratch tmux test exercise typing while an answer arrives.
- **Deployment:** wire changed; PROTOCOL 187 requires the host and its clients to update together.

### Scripts run from keys, names, rules and inline asks (PIE-900)

- **Added:** `[keys::]` binds a script through the dispatcher with key-clash checks; the power bar and `/`
  accept its name and `slot=value` arguments. Script keys leave typing alone.
- **Added:** `rule-on::script:name` uses existing rule triggers. `@name` uses existing quiet timers, live
  drafts and invocation grants; runs stream into the same attributed run notes.

### A component's words work as the note's, and a `::graph-check` row ticks like a step (PIE-864)

- **Changed:** a figure's rows (check, timeline, decision) are drawn through the reader's own inline drawing: a
  code span in a row copies on a click, a `[[link]]`, `((ref))` or `#tag` in it is followed with `[ ]` and ⏎, and
  `**bold**` reads bold, as on a line of the note. On a web page the same words are drawn as the page's.
- **Added:** a `::graph-check` row's box takes a checklist step's marks (`x` done, `o` to do, `+` approved, `-`
  rejected, `w` waiting, `!` problem), by ⏎ or a click on the box, `space`, and `act task.status`. A written row's
  box is rewritten in the note; a live row's mark writes the property its `done:` names on the row's own note
  (`done: "status=done"`: `x` writes `[status::done]`, `w` writes `[status::waiting]`). `ctrl+z` undoes it. The
  note's web page draws the same boxes as buttons.
- **Changed:** `checklist.query` answers a figure's boxed rows as steps (`figure: true`); `checklist.update` changes
  only their box and refuses to give one an id.

### A single tilde never strikes text; only double tildes do (PIE-899) (#584)

- **Fixed:** home paths and approximations (`~/.claude/~/projects`, `~178 … ~`) read as written in the door, Detail and on published pages; `~~double~~` still strikes. One rule in outline-core (PROTOCOL 183).

### Agents settle proposals by id, with no reader (PIE-898) (#582)

- **Added:** an agent applies or dismisses a proposal by its id through one shared tool (mod and MCP), and the dispatcher's `tile=` reaches tiles inside a mounted screen, so no reader is opened beside the person to do it (PROTOCOL 181).

### Recording actions saves an editable script (PIE-540) (#585)

- Record your actions with `alt+Q` or the status bar, then stop to save an editable `[script::]` block. Its action lines replay through the script runtime; `{slot}` values are filled when run. Agent actions stay out of your recording (PIE-540).

### Script blocks run through the host API while typing continues (PIE-601) (#583)

- **Added:** QuickJS runs for script blocks and outline script files, reached through extension actions and the power bar, with attributed progress in a child note.
- **Added:** MCP script runs reuse the gateway's proposal path; run undo groups saved writes, dispatcher writes and live draft patches. The scripts showcase exercises these paths.


### A published backlink lands on the line it names (PIE-889) (#575)

- **Changed:** published HTML keeps anchor and heading destinations; a backlink opens at its source line and marks the passage, phone screens included.

### Held requests and what changed share one store (#573)

- **Internal:** the door's held requests and the what-changed list share outline-store notifications. Nothing changes on screen.

### The drawer's program comes back through one action (PIE-892) (#574)

- **Fixed:** Enter, a click, the power bar or an agent brings the drawer's own program back from the desk through
  `agent.back`, keeping the same tile and process. Restart is refused while the program is out, and closing its tile
  lets the drawer tab run its program again; an agent's return preserves the person's focus.

### Edit table cells in the reader (PIE-593) (#579, #580)

- Rich edit draws Markdown and static graph-table flow rows over the existing draft. Click or navigate cells,
  type, add/remove rows and columns, undo and save; Ctrl+O returns to raw source. Streamed draft tables use
  the same view. A door-side ElementEditor contract lets component authors supply source spans and drawing.
- PROTOCOL: 179. On each machine: `ep0ch install --apply`.

### The agent tools are defined once, and code can call them (PIE-720, scripting slice 1)

- **Changed:** each outline tool an agent has (`outline_read` … `outline_restore`, `view_order`) is defined once, in
  outline-core's `agent-tool-definitions.ts`: its words, arguments, a call that works and the check that refuses a wrong
  call. The Claude mod and the MCP gateway register those definitions, so a tool on both answers a wrong call in the same
  words (the mod's tools now also refuse an empty `observed` in a patch, and `position` with `before` or `after` in a
  move, as the gateway did). Remaining surface gaps are listed with their reasons.
- **Added:** the outliner's host API (`src/host-api.ts`): every one of those tools as a plain async function, plus
  `q(query)` and `read(ref)`, for code. A script's call, a mod tool and an MCP write reach the same agent operation.
  Each write is attributed to the API's actor; calls run side by side, and an `onStep` observer hears each start, end
  and refusal as it happens, never holding the run. The runtime that runs a script is slice 2.
- PROTOCOL: 180. On each machine: `ep0ch install --apply`. The shared definitions change the MCP tool schemas and argument checks.

### The drawer's own program leaves whole, and comes back (PIE-892)

- **Fixed:** dragging the drawer's Claude onto the desk left a second tile in the drawer on the same Herdr pane,
  "watching · another door has it", that couldn't be typed in or closed: the drawer started its own program again and
  it attached to the same agent. Now its tab starts nothing while the program is out and says where it went
  (`claude is on the desk · ⏎ or a click brings it back`); that brings the same tile back, no restart (`tile.drawer`
  from its screen too). It holds across a handover.

### A facets tile, and a tags tile on it (PIE-881)

- **Added:** a `facets` tile (`^W o f`, `tile.open kind=facets query=…`) lists the properties the notes have, each opening
  to its values with how many notes carry them and when one was last updated. A tag is one facet among the rest, and
  `kind=tags` (`^W o #`) opens the same tile on it. A click on a value includes it, again excludes it, again drops it
  (`+` `-` `0`; alt-click excludes): included values of one facet are ORed, facets are ANDed, an exclusion is a NOT.
  Path values (`project=x/y/z`, a nested tag) group as a tree, and picking `x` includes `x/…`. The selection is shown as
  query text in the views' grammar (`e` edits it) and `v` saves it as a view on the board hub. The notes the selection
  leaves are listed under the facets and open as every list's do; sorted by uses, name or last use; `z` lists what the
  selection leaves at 0, dimmed. Kitchen sink: the `facets` section.
- **Added:** `property=x/*` in a query (a view, a figure, `ep0ch find --query`) matches the value `x` and every path below it,
  as `#x` already matched `x/…` for tags.
- **Changed (protocol):** `blocks.query` facets say when each value was last updated (`last`), and a question can ask for more
  than 50 keys and values (`facetKeys`, `facetValues`, at most 1000), so a client lists a whole outline's facets from the service.
- **Run:** `ep0ch install --apply` on each machine (PROTOCOL 176: facet values carry `last`, `facetKeys` and `facetValues` are
  question fields, and `property=x/*` is a query form; both sides must run the same copy).

### Runbook steps no longer take 1.5 s longer than their command (PIE-893) (#569)

- **Fixed:** the runbook's wrapper left a 1.5 s timer pending after every command, so each step ended 1.5 s after its
  command did (a three-step "run all" took 4.7 s for a few `echo`s). It now ends when the output is in; a command that left
  something holding its output open is still waited for, for a moment, as before.

### A link in a property's value is an edge (PIE-874) (#555)

PROTOCOL 174: outline-core's property grammar now finds links in values (`propertyValueLinks`).

- **Added:** `[via::[[HUB-023]]]`, `((id))` inside a value, the outline's Work IDs in a value's words and a value item
  that is exactly a ticket key (`[ticket::PC-582]`, whatever the key) are references: the target's backlinks (the
  links tile, Detail, `::backlinks`, the web), the source's links out and `ep0ch find --json` all see them, labelled by
  the property. One scanner, outline-core's `propertyValueLinks`; `[page::…]` and `[work-id::…]` name the note itself and
  never link. Backlinks are read at query time, so nothing needs reindexing: the host's restart on deploy is enough.

### EchoNet's ledger gets its mark on the next toss (PIE-868) (#565)

- **Fixed:** a ledger written before the `[echonet::<node>]` mark kept none until an entry changed; the next toss writes it
  with the mark.

### An agent's CLI write is recorded as the agent (PIE-890) (#564)

- **Fixed:** `--actor <id>` without `--author agent` on the outliner CLI's write commands (`work set|stage|link|body|create`,
  `update`, `move`, `create`, `new`, `comment`, `delete`, `restore`) was recorded `author=user`, so an agent's property edit
  read as the person's. A writer that names itself is an agent now; only one that says nothing is the person at the
  terminal. The mod's tools already passed `--author agent`; this is the form an agent types in a shell.
- Past rows stay as they are (the change feed is history). They are recognisable: `author=user` with an actor that
  isn't `cli`, e.g. `loki`.

### The what-changed list catches up after a restart (PIE-891)

- **Fixed:** a door that started long after the person last looked (a session handover, `ep0ch session upgrade`) read only
  the first 500 changes of the feed since then, the oldest, so the what-changed list showed rows from the session's start
  (14 to 23 hours old) and missed the recent ones. It now reads the feed on, page by page, until it reaches now.
  After 400 pages, or if the feed resets, it clears the list and starts from the current feed position.
- **Fixed:** a note purged from the trash, and the notes that went with it, stayed in the list as a stack of `(gone)`
  rows. They leave it; a trashed note is still one row, with its title.

### A note's block-level tags show in its body (PIE-880)

- **Fixed:** a `#tag` written with a note's properties (`[status::new] #pie-request`) counted as the note's tag and was
  hidden with them, so the reader showed no tags; people edited notes to `- #a - #b` just to see them. The door's
  reader now draws them as one row of tag links under the byline, before the text, and the web page as one row under the
  title (Detail already left them in the text). `i` still lists them as properties; what queries match is unchanged,
  and a tag in the text or a hand-made `- #a - #b` first line stays as written, with no second row for its tags.
- **Run:** `ep0ch install --apply` on each machine (PROTOCOL 173: outline-core's `blockTags` decides which tags are block-level,
  so both sides must run the same copy).

### A preview of the tree reads as part of it (PIE-886) (#563)

- **Added:** `border=joined`, a tile option (a style note, the tune inspector's `border` row, or the tile's own look):
  no frame, and the tile's surface (`raised` at `bg.strength` 2 unless `bg` says another, dark and capped like every
  surface) run to its edges, so it reads as part of the tile beside it. **Changed:** a preview that follows a tree (or
  that a tree's link makes its preview) is joined by default; `border=line` (or any other) frames it again. No wire change.

- **Changed:** previews and readers following a tree keep the joined appearance through the door's shared follow
  relationship, so the border uses the same source as the rest of the door (PIE-886) (#568).

### EchoNet copies say whose words they hold, and everything it writes is marked (PIE-868) (#562)

- **Added:** an EchoNet copy carries `[from-author::user]` (or `agent:<id>`): the source's author, beside the copy being the
  extension's write (`author: agent`, `ext:echonet`, as it always was). The nodelist, the ledger, toss logs, receipts,
  carried comments and undeliverable notes carry `[echonet::<node>]`, so what EchoNet wrote can be told apart.
- Found while checking: the copies that read as `author=user` in a graph walk are later property edits by loki's tools
  (`author=user`, actor `loki` or `cli`); the tosser's own writes are all the extension's, and a test now says so.

### The EchoNet tosser stops when its folder is gone (PIE-850) (#561)

- **Fixed:** a toss waiting for another toss's lock spun a core for ever if its outline's folder was removed meanwhile
  (a scratch tosser orphaned by a finished test ran at 100% for 38 hours). Only "the lock is there already" is waited
  for now; a folder that is gone ends the toss at once, saying so (`EchoNet can't take its toss lock …: its folder is gone`).

### `ep0ch keys`: which secrets exist, and who may have each (PIE-887) (#558)

PROTOCOL 171: an `extensions.list` entry carries `keys` (names, state and scopes, never a value). After merging, restart the
outline host and the publishers with `ep0ch install --apply`; a client on 170 is told to update.

- **Added:** `ep0ch keys list` names every `with-secrets` group's keys, where each lives, its mode, its scope and which
  extensions name it; `keys check <KEY>` says present or not and exits 1 when it isn't; `keys who <KEY>` says who may
  receive it. They never print a value. `keys set <group> <KEY>` prompts for one (the person's; it wraps
  `with-secrets --add`).
- **Added:** scopes on a key, kept beside the groups in `scopes.json` (no values in it): `machine` (the default),
  `outline:<name>`, `ext:<id>` or `ext:<id>@<outline>`, set with `keys grant` and `keys revoke`. The service checks the
  scope before it hands a key to an extension (a manifest `secrets` entry or a `secretGroups` read); a refusal names the
  command that grants it.
- **Added:** an extension's page has a "Keys" section, and `ep0ch ext ls` (and `--long`) say each key it names as present,
  missing or not allowed, by name.
- **Docs:** a "Keys and secrets" section at the top of the extensions README and in the ep0ch-outline skill: check
  `ep0ch keys list` before calling a key missing.

### Grants: who may wake whom, and held asks in the waiting-on-you list (PIE-888) (#559)

PROTOCOL 175: `agents.held`, and `extensions.list` answers `grants` and each extension's `held` count (an older host leaves the list without them).

- **Added:** a note the person writes can let an extension or an agent wake an agent without their `r`:
  `[invoke-from::ext:requests] [invoke-to::kitty]`, with `max-hops` (default 1: what a woken agent writes is held
  again), `budget` (wakes one chain may spend), `cap` (a day) and `agents`/`all`. A repeat in the chain is always held,
  and a held line says which limit it met. A grant an agent or extension wrote counts for nothing. `ep0ch ext ls` lists
  the grants and each extension's held requests.
- **Added:** the door's waiting-on-you list (`alt+w`) shows the requests held for your `r` after the terminals' programs,
  and the status bar counts them (`‼2`): `⏎` or a click opens the note, `r` sends it (`held.open`, `held.send`).

[PIE-906](#agents-and-extensions-wake-each-other-by-default-pie-906-592-593) later changed the default: agents and extensions wake each other, with notes only denying or narrowing the loop guards.

### Machinery stays consistent when notes are received, queried and moved (PIE-867)

- **Fixed:** EchoNet stamps new seen-by receipts as machinery; `by:` asks who last wrote the text or properties,
  using revision history's provenance, and a view's write planner honors the machinery mode its reader uses.
- **Protocol:** PROTOCOL 178 (the latest-writer query meaning). Update hosts and clients together.

### Machinery hides by default (PIE-867)

Since Oct 11, about two thirds of the new notes in pie were tools' bookkeeping, and no one property marked them.
- **Added:** `[machine::<producer>]`, one stamp on what a tool writes for its own bookkeeping: file touches and their
  folders, EchoNet's nodelist, tosses, ledger and seen-by receipts, delivery records, intake's prior art, backup runs.
  One flag, `machinery: hide|only|show`, on `blocks.query`, `tree.search`, `activity.recent` and `changes.since`, and
  `[machinery::show|only]` on a saved view or a live figure. Hidden is the default of every reader (`changes.since`
  excepted: it is also how a client catches up, so it holds everything unless asked, and each change says
  `machinery: true`). `outline_find` and `outline_changes` take `machinery` too. Change rows say `bookkeeping: true` when
  an edit moved only `[key::value]` tokens.
- **Added:** the atoms `by:user|agent|system|<actor id>` and `revision >= 2`: "what did a person write today" is
  `by:user updated >= today`.
- **Changed:** the main menu's newscan line reads `changes on the outline since you logged on: 73 · 12 by people`, and a
  click on it opens the new scan of the people's changes. The what-changed list and the status bar hold machinery back
  as `+N machine` (it was `+N ext`); the action is `changes.machinery` (it was `changes.extensions`).
- **Added:** `ep0ch machinery backfill [--ws <name>] [--apply]` stamps what tools wrote before they stamped (a dry run
  first). A kitchen-sink section, `machinery`, asks one query twice.
- **Protocol:** PROTOCOL 177 (new request fields and atoms). No schema change.

### A backlink says which line links, and opening it lands there (PIE-884) (#556)

- **Added:** a backlink row in the links tile, the tree's `l` and an inline `::links` now quotes the line of the linking
  note that holds the reference and the anchor it names (`“Check ((Garden plan^butt)) …” ^butt`). Opening the row (⏎, a
  click, the preview following the selection) scrolls the linking note to that line and lights it; esc lets go.
- **Fixed:** an outlink with an anchor (`((note^anchor))`) opened from the links tile or the tree landed at the top of
  the note; it now lands on the anchor, as following the link in text does.
- **Added:** the published page's `::links` backlink rows quote the line too (the page has no per-line anchors to land on).
  The rows an agent reads (`backlinks`, `links`) carry `line` and `anchor`.

### An @name an extension or agent writes lands, held with its reason (PIE-888) (#557)

- **Fixed:** an `@name` line an extension's action, an extension's agent answer or an agent's `draft.patch` writes is no
  longer a refused write that loses the words. It lands as written, in the saved note or a door's live draft, and is held:
  `held: ext:requests may not wake @kitty · r to send` shows under the line, nothing is asked, and a person's `r` sends it
  (an agent's `r` on it is still refused). A trigger's new block still asks its own extension's agents at once.
  The extensions README says this in each place it came up (it said both "refused" and "held").

[PIE-906](#agents-and-extensions-wake-each-other-by-default-pie-906-592-593) later changed the default: agents and extensions wake each other, with notes only denying or narrowing the loop guards.

### A new note is a tile while you write it, and says where it lands (PIE-883)

- **Fixed:** a new note's float couldn't be dragged, docked or its `⋯` opened while you wrote in it: a press on its
  header went to the edit. Its header and edges are the tile's now; the edit stays open through a drag, a dock and the
  menu.
- **Added:** under a new note's edit, `→ Inbox › 2026-10-14 [move ▸]` says where it is; a click asks in the power bar
  where it should go and moves it (`note.place parent=inbox|<note>`; an agent's by outline_move's rules, attributed).

### Typing in a tile's menu filters it (PIE-879)

- **Added:** open a tile's menu (the ⋯, a right-click, `^W .`) and type: the rows narrow to the ones that match (the
  power bar's matching, over the label, the group and the key), the query shows on the box's top row, the letters
  that match are lit and a group with no row left goes. Backspace widens, esc clears the query before it closes the
  menu, ⏎ or a click runs a row. `act tile.menu q=<text>` gives an agent the matching rows.
- **Changed:** a row's bare-letter key no longer runs it from inside the open menu (the letter is for the query); a
  chord (`^W x`, `alt+h`) still does.

### The door's tree shows a virtual branch's matches (PIE-882) (#554)

PROTOCOL 170: `views.read` answers `childDepth` (an older host leaves the tree's matches without a depth).

- **Added:** open a note with `[type::virtual-branch]` in the outline tree and it shows its physical children, then
  what its query matches (`◇`, the count in its tag, the view's limit with a `more` row for the next page). Each match
  can be opened (`l`, a click) to its children as far as the view's `[child-depth::]`; `D` (or a click or `⏎` on the results line) steps how
  far for that view (results only, 1, 2, 3, the view's own) without writing anything; agents set it with `tree.depth`.
  The matches follow the outline's changes.
- **Changed:** `views.read` answers `childDepth` (the view's own, else the default), so no client reads the
  property itself. The wire grows by that one field: `PROTOCOL` moves with this change.

### Trash a note from wherever you see it (PIE-878)

- **Added:** `d` in a reader, a links list, the tree or a query tile (Delete too) says what would go, the note and the
  notes under it, in a two-row choice. `d` again, ⏎ or a click on the first row trashes them; esc keeps them. ctrl+z
  (when the tile has nothing of its own to undo) or the tile menu's "bring back the note trashed last" puts them back
  where they were. The tile menu has the same "trash this note" row. An agent passes `confirm=<the note's id>`
  (`act note.trash`, `act note.untrash`), recorded as the agent. The Inbox and the other system notes, the workspace
  root, a note already in the Trash and a note with a draft open on it are refused, and the refusal says why.
- **Changed:** the board's `d d` on a card is recorded as who trashed it (the service's delete takes an author).
- Try it: `ep0ch --showcase`, the `trash` section.

### `ep0ch show PIE-870`: the CLI reads take a Work ID (PIE-875) (#552)

- **Changed:** `ep0ch show`, `find --under|--view|--tree`, `export` and `revisions` name a note the way a link in a
  note does: an id, `((id))`, an id's first 8+ characters, a Work ID of any prefix the outline has (`PIE-870`,
  `HUB-021`) or a `[[page]]`, through the service's one resolver (`blocks.resolve`). A Work ID nothing has says the
  nearest it does (`did you mean PIE-870, PIE-871?`), or the prefixes the outline has.
- **Protocol:** `PROTOCOL` 172 (a new read action, `blocks.resolve`): restart the host with `ep0ch install --apply`; a door or CLI on the old code is refused until then. No schema change.

### A size lock can't squeeze the screen (PIE-869)

- **Fixed:** `⏎` on a container's "fixed size" in `^W P` took 10 cells when none of its tiles was on screen (another tile
  zoomed): Evan's desk's only row was fixed at 10, four readers in 10 columns. It now takes the size as laid out, a zoom
  aside, and refuses with the command when there's nothing to measure.
- **Fixed:** a `fixed` size that would leave the rest of the screen to nobody (the only row beside a dock that slides
  over) is ignored; `^W P` says "10 · ignored: nothing beside · ⏎ clears".
- **Changed:** the size locks are listed first in `^W P`, a set one with how to clear it; a border a fixed size holds says
  `layout.policy node=… clear=fixed`.

### A comment keeps its kind (PIE-871)

- **Fixed:** `outline_comment` with `kind: "patch-note"` stored the comment without `[kind::patch-note]`: the Claude mod
  dropped the name silently. `kind` is now an argument of `outline_comment` (the mod, MCP and `outliner agent comment`),
  the same as `properties.kind`; the two disagreeing is refused. A kind no other thread in the outline has is kept
  (kinds are open) and said in the answer's warnings, with the kinds in use and a did-you-mean (`patch-notes` → `patch-note`).
- **Changed:** a name a mod tool has no argument for still doesn't stop the call (a host's own metadata arrives that
  way), but the answer now starts with `Not used: …`, naming it and the tool's arguments.

### Agents move and trash notes (PIE-877) (#546)

- **Added:** `outline_move`, `outline_trash` and `outline_restore` in the Claude mod and over MCP. A tidy pass now
  puts a note under a day or beside a sibling, and a duplicate in Trash, as the agent, and says why when it can't:
  a system note, a place inside the note itself, a stale revision, a ref that doesn't resolve (with the nearest
  notes). Over MCP at propose access a move or a trash is a comment on the note for its owner; a restore needs full
  access. `outliner agent move|trash|restore` run the same operations.

### Marks only, found and kept (PIE-873)

- **Added:** the byline's comment count is the margin's switch: a click cycles it as `M` does (cards a row each, whole,
  marks only), and with the margin off it reads `4 comments · marks only (M)`. Comments on the whole note fold to one
  `▐` after the title; a click opens them.
- **Changed:** the margin's mode is kept with the reader's tile: a handover, a restart and the next note read the same
  way, and a reader opened from it (alt+⏎, a ctrl-click) starts in the same mode.

### Scratch cleanup never stops for a permission prompt

- **Added:** `scripts/scratch-clean <dir>…` removes scratch folders (a `mktemp -d`, an agent-env folder, a finished worktree) and
  refuses any path outside the scratch roots, saying why. The repository's Claude mod now allows an `rm -r` whose paths all
  resolve under those roots, without the permission prompt. Agent instructions use these in place of `rm -rf`.

### TL;DR: none without a model, shown once, and it can be taken away (PIE-860)

PROTOCOL 169: `annotations.tldr` takes `remove`, and an ask can be refused (an older host would write one instead).

- **Fixed:** asking for a TL;DR when @margin has no model set up no longer posts the note's own sentences (or a
  stitched-together summary) as the thread's face. Nothing is posted, and it says how to set one up:
  `~/.config/pi-herdr-outliner/extensions/marginalia/config.json`: `{ "config": { "answer": ["claude", "-p"] } }`.
  An agent that errors writing one posts nothing either.
- **Added:** take a TL;DR away: `[No TL;DR]` on an expanded thread, `T` in the thread list, `thread.tldr remove=true`
  (the service's `annotations.tldr remove: true`). `[TL;DR again]` asks for a new one, `[Edit TL;DR]` edits its words.
- **Fixed:** an expanded thread shows its TL;DR once, as its face, not again as a reply under it.
- **Fixed:** a thread you put away (seen) leaves no card under its passage in a narrow reader, TL;DR or not, as the
  side column already did; and asking for a TL;DR doesn't bring a seen thread back.
### The links list keeps the row you moved to (PIE-854)

- **Fixed:** a links tile re-reads its list after an outline change (the list asks again, half a second after the
  last change). If you moved the selection (a key, a click) while that read was out, its answer put the selection
  back on the row you had left, and the click's preview was dropped. The re-read now keeps the row selected when the
  answer arrives.

### Installed built-in extensions follow updates (PIE-861)

- **Fixed:** a built-in extension copied in with `ep0ch ext add` (tarot, marginalia, tidy, echonet…) never got the
  built-in's later fixes: nothing refreshed the copy. `ext add` now records what it installed (`.installed.json`
  beside `config.json`: the built-in, its version, the commit and a hash of its files), and `ep0ch install --apply`
  refreshes each copy nobody changed, in place, keeping `config.json`, `node_modules` and your dotfiles.
- **Added:** `ep0ch ext update <name>|--all`: refreshes an unchanged copy; one changed here (forked) shows its diff
  against the built-in and asks (`--yes` takes it, your version copied to `extensions-forks/` first). Install lists a
  forked copy with what's new instead of touching it, and `ep0ch doctor` lists stale and forked copies.
- A copy made before the record counts as unchanged when it matches an earlier version of the built-in in git history.
- **Run:** `ep0ch install --apply` on each machine; the first install with this code is the one that adds the step, so
  run `ep0ch ext update --all` once after it (no protocol or schema change).

### A file link whose folder was made again keeps working (PIE-853)

- **Fixed:** a `[file::]` link whose folder was deleted and made again in the same place (a sync renaming a new copy
  into place, an agent rewriting the folder) was refused for good with "Filesystem source root no longer resolves to
  its bound directory identity". The outline host now re-binds the folder on the next read and says so once, above the
  file: "~/float-hub/inbox was made again; its files are read from it again".
- **Changed:** a folder whose path now leads to another directory (a symlink retargeted, another folder moved over it)
  is still not read, and the file's reader says where it leads now and the command that reads it there.
- **Added:** `ep0ch resource rebind <folder> [--ws <outline>]`: the files under that folder are read from where it
  leads now.
- **Run:** `ep0ch install --apply` on each machine (the protocol changed).

### The comment's tile sits beside its note on any side (PIE-846)

- **Changed:** the comment's own tile (`ctrl+o` to **tile**) now opens in the note's place, beside it, instead of floating:
  the tiles round them never move, and closing it gives the note its room back, the layout exactly as it was.
  `ctrl+g` then an arrow (or a click on the tile's last row, or `comment.place side=left|right|up|down`) puts it on that
  side of the note; drag the border between them (or `^W < >`) to size it, and it keeps that size as it moves round.
- **Added:** reading comments there too: in the thread list (`m`), `ctrl+o` puts the list in that tile beside the note;
  `r` writes a reply in it.
- **Fixed:** a comment sent from the reader shows its thread open at once (it could be drawn closed for a moment).

### Recent files records only where the outline asks (PIE-870)

- **Changed:** a Claude session's file touches are filed only when the file matches a `[file-touches::<glob>]`
  property on the Recent files page (`~/rangle/**/*.md`, `**/plans/**`); with none, nothing is recorded. A session
  reads the globs when it first needs them and again when a minute old. The `fileTouches` option and
  `PI_OUTLINER_FILE_TOUCHES` are now only an off switch (`off`), and off wins. To record somewhere, add the property
  to the page; the globs are the outline's, so nothing to run on a machine.

### `ep0ch ext ls` reads well (PIE-866)

- **Changed:** `ep0ch ext ls` prints one aligned row per extension (state, where it comes from, version, what it serves,
  and what is wrong: its error, a failed last call or a failed schedule). `--long` adds each one's folder, action
  arguments, schedules and last call, as the old output did. **Added:** `--json`, the registry's own answer, for scripts.


### The comment editor: the whole note, a tile of its own, scrolling, pictures (PIE-846)

From Evan's comments written in the floating editor while using it.
- **Added:** a comment on the whole note. `C` with nothing selected, or a click on `[comment]` after the note's date,
  opens the box at the top of the note; its thread sits there (its card on the margin's first row). `act comment.note`
  does the same (`body=` sends it at once). `C` in the thread list does too.
- **Changed:** one way in. `C` on selected words opens the same box as `a` then `c`; the passage picker that `C` with
  nothing selected used to open is gone for the person (an agent still names its words with `passage.select quote=`).
- **Added:** a fifth place for the box, **tile**: `ctrl+o` (or `comment.place place=tile`) puts the comment in a tile of
  its own beside the reader, so the whole note stays in view. It's a tile like any other: drag it, size it, dock it to an
  edge with `^W p`. `ctrl+s` sends and the tile closes; `ctrl+o` puts it back in the reader.
- **Fixed:** the wheel over a comment's box scrolls the comment (and over its preview, the preview); elsewhere it
  scrolls the note. Typing in a floating, split or popup comment no longer scrolls the note back to the passage.
- **Fixed:** `img::` in a comment draws the picture (under Kitty graphics) in its preview and in the posted thread, as
  in a note, instead of only its name. A margin card names it (`▣ <alt or file>`) instead of showing its path.

### A tile says what it follows and where it opens, and you can cut either (PIE-855)

- **Added:** `^W P` starts with two plain rows for the tile it's opened on. **Follows:** "the #tags opened in
  detail", "tree's selection (a link)", "the current note, as it changes", "nothing: held on its note". **Opens
  into:** "detail, its reader (⏎ replaces its note…)", "preview (its link…)", "a new column after it", "the current
  note (no link…)". Each has a row to change it (⏎ or a click: what it follows, or a list of the tiles its opens may
  land in) and, where there's a link, one to unlink it.
- **Added:** a tag's list shows `◄ detail` on its frame while it follows its reader's tags. A click on it, or on a
  tile's `→ preview` or `⏎ detail` mark, opens `^W P` on that row.
- **Added:** `tile.info` answers `follows=` and `opens=` in the same words, for agents.

### An action line runs from any scope of the power bar (PIE-856)

- **Changed:** `run tile.open kind=query query="#build-report"` is offered first in every scope of the power bar
  (`/` notes, `%` tiles, an extension's), not only the main list and `>`: typed after `/`, the line still runs. Not
  in a question the bar asks for an argument, where what's typed is the answer.

### A picture in an extension's view shows in Tern (PIE-839)

- **Fixed:** `pic::`, a `gallery::` card's cover and any extension view's `image` drew an empty box of the right height
  in Tern, while an `[img::]` line in the same note drew. The door places a picture under the text, and the view's
  rows are tinted (the extension's region); Kitty draws a picture over a tinted cell, Tern under it. A picture's cells
  now keep the terminal's own background in a reader, whatever tints the rows around it (a region, the ruler, a box).
- **Added:** `caption: false` on the `image` primitive draws the picture alone, without its caption line (and with no
  `[ ]` stop of its own): a card's cover, where the card is what opens. Without graphics the caption still says what it
  is; a web page leaves out the figure's caption. The gallery example's covers use it.
- **Added:** one reference page for image lines, `packages/door/docs/IMAGE-LINES.md`: the grammar, the properties,
  the paths it takes and where it draws, linked from the door README and the ep0ch-outline skill.
- **Run:** `ep0ch install --apply` on each machine (PROTOCOL 167: the image primitive's `caption` on the wire; clients
  and the host update together; no schema change).

### Paste works in the power bar (PIE-856)

- **Fixed:** a paste into the power bar (ctrl+k), and into a question it asks for an action's argument, was dropped:
  the bar takes every key before the door types a paste out. Every one-line input (the bar, filters, searches,
  names) now takes a paste whole, its line breaks as spaces and a trailing one dropped.
- **Added:** an action line typed or pasted with its arguments, quoted as a shell quotes them
  (`tile.open kind=query query="#build-report"`, as `ep0ch act` takes it), is the bar's first row, `run …`; ⏎ runs
  it as typed. An argument the action doesn't take, of the wrong type or missing is said on the row, with the
  action's arguments and a call that works (the action's summary and arguments are on the right as you type).

### Keep a tag's list (PIE-855)

- **Added:** a list a `#tag` opened can be held: `p` in it, a click on the `○` on its frame (`●` while held), its tile
  menu, or `act tile.hold tile=<list>`. A held list keeps its tag and stays where you dock it (`^W p`); the next tag you
  open in the reader gets a list of its own instead of replacing it. ⏎ in a held list still opens in its reader. `p`
  again lets it go, making it the reader's list again (refused, with what to do, while the reader already has another).
  The hint says `held · a new tag opens its own list`, and the hold is saved with the layout.

### A handover keeps the comment you were writing (PIE-847)

- **Fixed:** when the door is handed to new code (a deploy, `ep0ch session restart`) while you're writing a comment,
  it comes back as you left it: its words, where it sat (inline, floating, split or popup), a floating box's place and
  size, the cursor and the preview. A reply or an edit of a posted comment comes back the same way. The status line
  says "your comment is as you left it". Before, the comment was put aside and you had to select the passage again.
- **Fixed:** look nudges made in the tune inspector and not saved yet (a measure widened for a split) survive a
  handover too, still unsaved.
- **Added:** `ep0ch act reply thread=…` without `body=` opens your reply on the thread to write, as the [Reply]
  control does; an agent's reply still needs `body=`.

### The edit's preview expands embeds (PIE-852)

- **Changed:** ctrl+p's preview under an edit (and under a comment being written in the reader's comment mode) draws
  `!((id))` and `!((id^anchor))` as the reader does: the note or passage, framed and labelled, while the text is still
  unsaved, so you can see you picked the right passage before saving. Each embed is read once and kept across
  keystrokes; the preview is drawn again when the answer comes, and typing never waits for it.
- **Added:** an embed whose anchor its note doesn't have says so wherever it's drawn (the preview and the reader):
  `MISSING FRAGMENT in "<note>"`, then `did you mean ^<anchor>?` with the nearest anchor that note has (the save
  warning's rule); a click on it opens that passage beside the edit.

### A link selected before a note is drawn is its current element

- **Fixed:** `link.select` (or the surface's `selectLink`) on a note just shown again (back, a reread) and not yet
  drawn left the hint on the bare "link 2/3 …" form, with no `[ ]` element current, until the next `[ ]`. It now
  becomes the current element at the note's next layout, unless the selection moved meanwhile. Seen as the showcase
  test "new notes (PIE-544)" failing in CI (6 of 64 runs under load on float-box; 0 of 96 with the fix).

### CI: a slow run is told from a hung one (PIE-831)

- **Changed:** the door's agent-parity probe runs in five files, not three, and the shell's input states (ctrl+n, the
  drawer's alt keys) are probed once in the suite, not again in each file. The longest file was about 8½ minutes of a
  9-minute run; a runner that slowed every parity test 2-3x (Oct 13 and 14) ran it past the 12-minute stop, which
  called it "hung".
- **Changed:** CI's stop at 12 minutes says "Test run hung" only when the output stopped 3 minutes or more before, and
  "Test run too slow" while tests are still passing. Its report starts with the machine (load, CPU steal, the busiest
  processes anywhere) and the run's last output, and gives the main thread's stack first. Every test job also keeps a
  `machine-<package>` artifact: the runner every 30 s (load, CPU stolen, cgroup throttling, the busiest processes), so
  a run that slows part-way shows when and why.

### Package rules reach commands too

- **Added:** a Claude session in this repository that runs a command touching a package (`cd packages/door && bun
  test …`, `scripts/agent-env … --`) gets that package's `.claude/rules/` file the first time, as Claude Code already
  gives it when a file is read. Each rule's own `paths:` decide; the `ep0ch-repo` mod attaches it once a session.

### The repository's own mod: guardrails and a freshness sweep (PIE-842)

- **Added:** agents working in this repository (any checkout or worktree) are refused with the reason and the command
  to run instead when they reach for `pkill` or `killall`, `git stash`, `gh pr merge -d`/`--delete-branch`,
  `bun test --parallel` on float-2, or a merge into main whose `PROTOCOL` isn't main's plus one. These were rules in
  AGENTS.md; the mod in `.claude/skills/ep0ch-repo/` makes them refusals.
- **Added:** in the deployer's sessions, after every three deploys or merges, a read-only agent checks what
  `.claude/freshness.md` lists as stale (build-log lines, tickets behind their PRs, patch notes, the Infrastructure
  hub, the CHANGELOG, docs naming removed files) and hands its findings to the main thread, which makes the updates.

### Sessions start oriented: the workboard now (PIE-843)

- **Added:** a Claude session bound to an outline with a workboard gets "the workboard now" in its first prompt, and
  again after a compaction or `/clear`: the latest build log, the items in doing, review and validate, what waits on
  you (`needs::sysop`) and the folder's open PRs. Read from the outline each time; nothing to configure, and nothing
  shown for an outline without a workboard.

### Done has a date, requests name their ticket, waves are recorded (PIE-844)

- **Added:** moving a roadmap item into done stamps `[done-at::<day>]` and takes `[needs::sysop]` off; a reopen takes
  `done-at` off. "Done today" is `type=roadmap-item done-at=today`, no longer the last-edited time a groom moves.
- **Added:** a note that names its ticket with `[ticket::PIE-n]` (a request copy) carries `[ticket-stage::…]`, and the
  service keeps it equal to the item's stage on every move: `work stage`, a PR sync, `work complete`, the Pi session
  tools, a board drag or an edit by hand. `work create --source <copy>` (the mod's `from`) names the ticket on a
  `[type::request]` copy in the same step; `work link <copy> PIE-n` (the mod's `work_link`) names one later.
- **Added:** `work create --wave <theme>` (the mod's and Pi's `wave`) writes `[wave::<theme>]`; `work set` already sets it.
- **Needs:** PROTOCOL 166 (`roadmap.items.create` takes `wave`, and the service writes these properties): deploy with `ep0ch install --apply` on each
  machine. To see what a backfill of `ticket::` on existing request copies would set, run
  `bun packages/outliner/scripts/request-tickets.ts --ws pie` (read-only).

### AGENTS.md is a short core; package rules load where they apply (PIE-841)

- **Changed:** `AGENTS.md` keeps the rules every agent needs (the repository map, real outlines and doors, tests on
  shared machines, PROTOCOL and the schema, fixtures, merging) and drops from 26 KB to 17 KB (335 lines to 206). Each package's rules
  moved to `.claude/rules/` (`door.md`, `outliner.md`, `outline-core.md`, `claude-mod.md`, and `outlines-by-name.md` for
  the code that picks an outline or a machine), which Claude Code loads only when an agent touches those files.
  Codex and other tools read `AGENTS.md`, which tells them to read the package's file before changing it.

### Recent files recording is off by default

- **Changed:** the Claude mod no longer files each Edit and Write under `[[recent-files]]` unless asked: code edits were
  more noise than signal there, and plans and handoffs land in the outline directly now. The file rows in Claude Code
  are unchanged (a file outside git loses the first copy its `diff` compared with). Turn it back on with the mod's
  `fileTouches` option set to `on`, or `PI_OUTLINER_FILE_TOUCHES=on` in Claude's environment. Existing notes stay.

### One Detail host (PIE-833)

- **Removed:** the second, ANSI Detail host (`src/detail.ts`) and its selector (`detail-main.ts`,
  `OUTLINER_DETAIL_RENDERER`). Herdr has started the pi-tui Detail (`src/detail-pi.ts`) by default for months; the
  ANSI one only ran in tests, and most Detail changes had to be made twice. Nothing a person sees changes.
- **Fixed:** Detail in Herdr now draws what a rule decorates (a card, a band, a text mark, PIE-600) and reads a
  resource provider's lines, and learns a rule written while it is open. Only the ANSI host ever asked the outline for
  its rules, so the Detail people use never showed them.
- **Changed:** `OUTLINER_DEBUG_KEYS=1` (open the key inspector on startup, for keys the host intercepts) now works in
  the Detail Herdr opens; it only worked in the ANSI host before.
### A form written in the note it's for (PIE-828)

- **Added:** an extension action can ask for the fields of the note it runs on: `"fieldsFrom": "block"` in its
  `extension.json`, and the note writes its fields as chips, `[form-field::mood choice good|meh|rough]`
  (`<name> <type> [<options>] [required] [default=<value>]`; types `text`, `number`, `choice`, `property`). One action
  serves every note that writes its own form, and the form is edited where it's used. The service checks the answers as
  it checks declared arguments and tells the action the note's `fields`.
- **Added:** the example **Form** extension (`outliner ext add form`): Fill in the form asks the note for its fields and
  writes an entry under it with the answers as properties.
- **Added:** the door asks for a note's fields through the power bar's one prompt, by keys or a click, as it asks a
  sort's `by`; a text or number not needed can be left empty, and a needed one says it's waiting for what you type.
  An agent gives them in `with=` as JSON and is never asked.
- **Added:** a `[form-field::…]` chip that can't be read is saved as written and warned on with a did-you-mean
  (`choise isn't a field type …; did you mean choice?`); the action refuses with the same words.
- A kitchen-sink section, **forms**: the reading log and the shed repairs, two forms, one action.

### Moving a linked anchor with its text (PIE-829)

- **Added:** an extension action's write group can `move-anchor`: `{ op: "move-anchor", from: "<block>^s5", to }`
  moves the anchor to another block (or one the group makes) and points every link to it there (`((A^s5))`, labelled,
  embedded, `ep0ch://…#s5`), in the same group, attributed to the extension, one undo for all of it. A split or a merge
  no longer leaves a forwarding line behind.
- **Added:** structure's `extract` takes the anchors on the lines it extracts with them: extract an item ending in
  `^s5` and the notes linking to it point at the new child.
- **Changed:** the structural guard judges links as the whole write group leaves them: a group that repoints the link
  and drops the anchor lands; one that leaves a link dangling is refused as before. A list item's `^id` the same group
  writes in another note counts as moved, not removed.
- **Added:** an EchoNet copy that links to a moved anchor is never written (ADR 0005): it gets a comment saying where the
  anchor went, which the tosser carries to the origin as netmail.

### Pictures in an extension's view (PIE-827)

- **Added:** an `image` primitive for extension views: `{ type: "image", src, alt?, size?, fit?, height? }`, `src` a
  path as a note's `[img::]` line names one (or `file:/path`). Each reader draws it the way it draws a note's image
  line: the door with Kitty graphics, dimmed dark-first, its caption a `[ ]` stop that ⏎ opens; a web page with the
  image it serves (`/p/<id>/media/<line>/<n>`) when the publish roots allow the file; the `terminal` target as alt
  text and path, Markdown (Detail, exports, MCP) as alt text and the file's name. Nothing is written to the outline.
- **Added:** the `gallery` example extension: `gallery::` draws the notes under it as cards with their `[cover::]`
  pictures, `pic:: path` one picture. The kitchen sink's gallery section shows it.
- **Needs:** PROTOCOL 165 for the wave (the image primitive, the form-field grammar and `fieldsFrom` on the wire): the door and the service update together.

### An agent's pick stays the agent's; a replaced draft keeps the person's place (PIE-632)

- **Fixed:** an agent's `tree.pick` (or a links-tile pick) showed its row where the tree's selection goes as if the
  person had picked it: into a tile the screen limits for agents (edit only, hands off) too. Every open into a tile now
  carries who made it through one guard, so a limited tile keeps its note and an agent's `open` into one is refused,
  saying why and the command that frees it.
- **Fixed:** text replaced under a selection (an agent's text, `$EDITOR`'s, a chosen completion) left the selection
  pointing past the new text: the next key threw, or typed over the inserted reference. The selection now stays on the
  text it was on, or is let go.
- **Fixed:** an agent undoing or redoing its own edit moved the person's cursor and cleared their selection. Only the
  person's own ctrl+z moves the cursor now.

### Typing `+`, a crash log for Detail, and a few leftovers removed (PIE-476, PIE-477, PIE-636)

- **Fixed:** typing `+` in Tree, Detail or a Herdr pane no longer shows "Key chord cannot be empty", and in an edit
  it is no longer swallowed. A chord whose key is `+` (`+`, `Shift++`, `Ctrl++`) parses and shows as `⇧+`.
- **Added:** if Detail crashes, it puts the terminal back, keeps the stack in `<outlines>/.host/detail-crash.log` and
  says where on the way out.
- **Fixed:** two imports to one new outline name no longer race: the second is refused ("is being imported into by
  another import") and never removes the first's file.
- **Removed:** six helpers nothing called, a stale pointer in the outliner's CONTRIBUTING, and a dead test guard.

### Dates and numbers on any property (PIE-769)

- **Added:** a query compares any property, not only `created` and `updated`: `due <= +3d` (overdue too),
  `wait-until <= today`, `sent >= -7d`, `rating > 3`, `stage >= beta`. A date bound compares dates, a number compares
  numbers, anything else compares text. It works everywhere the views' grammar does: saved views and board lanes,
  live figures, `ep0ch find --query`, MCP `outline_query`, the web pages and the Pi tools.
- **Added:** dates as people write them, read by one reader in outline-core (`dates.ts`): `2026-10-20`, `Oct 20`,
  `October 20, 2026`, `20 Oct`, `10/20`, `10/20/26`, with a time after (`2026-10-20 4:23 PM`). A span
  `2026-10-20..2026-10-24` answers `release-window = today` while today is inside it. `due=today` and
  `due="Oct 20"` find the day however it was written.
- **Added:** a date bucket on any property: `group: due:week` (day, week, month or year), soonest first. Sorting by a
  date property orders by date, not by how it's spelled.
- **Added:** a value a comparison can't read (`[due::someday]`) never matches and is never refused: the answer says
  which (`due: 1 note has a value that isn't a date: “someday”`), under a figure, in `ep0ch find` and over MCP. A
  save of a value shaped like a date that isn't one (`[due::Oct 32]`) keeps the text and says so.
- **Added:** a watched question is asked again when the host's day turns, so a `wait-until <= today` lane on
  Welcome or a board fills itself in the morning.
- **Changed:** `key=<date>` clauses go through the query evaluator (they find the same text as before, plus the same
  day written another way).
- **Run:** `ep0ch install --apply` on each machine (PROTOCOL 163: clients and the host update together; no schema change).

### A checklist step can be approved or rejected (PIE-811)

- **Added:** two step states beside to do, done, waiting and problem: **approved** (`[✓]`, your yes) and **rejected**
  (`[✗]`, your no). Pick Approve or Reject from a step's box: in the door's status choice (`+` and `-`, or a click), the
  board's steps overlay, Detail's checklist menu, and now on your tailnet web pages, where every step's box is a button
  that opens the same choices (by tap, or `x o + - w !` on a keyboard). Typing `[+]` or `[-]` in a note reads the same.
- **Changed:** web pages draw each step's box as its state (☐ ✔ ✓ ✗ ~ !) instead of a grey checkbox that knew only
  done; a share link's and a public page's boxes are drawn but don't change. `space` on an approved or rejected step
  reopens it to to do. Approved counts as done in a step tally; rejected doesn't.
- **For agents:** `checklist.query` (`statuses: ["approved"]`) tells them apart, and an approved step is the person's
  yes (the ep0ch-outline and daily-brief skills say so).

### Edit a comment or reply after it's posted (PIE-763)

- **Added:** a posted comment or reply can be edited in the same editor it was written in: in the door (`e` in the
  thread list, `[Edit]` on an expanded thread and on each reply), in Detail (`Shift+U`, or the Edit link on a comment
  or reply), and on the web pages (Edit in a card's ⋯ and on each reply). Agents edit with `outline_reply` and `edit`
  (the mod and the MCP), `outliner agent edit-comment`, or the door's `comment.edit`.
- The edit is checked against the revision it started from, so one made meanwhile is refused and your words are kept.
  The comment stays its author's and says "edited" (or "edited by" whoever did); its earlier words are its revisions.
  Below a share link, only what was written through that link can be edited.
- **Fixed:** a click on a reply's `[Quote]` on an expanded thread quoted the whole thread.
- **Run:** a protocol bump: `ep0ch install --apply` on each machine, then restart the publishers.

### Writing papercuts from sysops-log (PIE-592)

- **Added:** links work from an edit. `Ctrl+L` (or an alt- or ctrl-click) on a `[[page]]`, `((reference))` or
  `[text](url)` in an edit or a comment opens it in a detail beside the draft; a click on a link in the draft's preview
  (`Ctrl+P`) does the same. The draft stays open and keeps your keys, and the next link opens in the same detail.
- **Fixed:** the links tile's `⏎` (and any open) into a reader that holds an edit opened nothing visible
  ("the note opened as the current one instead"); it opens beside the edit now.
- **Added:** `[[` and a name no page has yet offers `new page · <name>` last: choosing it makes the page and links it.
- **Fixed:** a `` `[[` `` quoted in a code span earlier on the line no longer opens the completion popup as you type.
- **Fixed:** a page link can hold another: `[[[[2026-10-06]] - editor thoughts]]` is one link to the page
  "[[2026-10-06]] - editor thoughts", read as "2026-10-06 - editor thoughts", and the 2026-10-06 page lists the note
  among its backlinks too. Brackets are counted (outline-core's `pageLinkSpans`), never matched by the first `]]`,
  which made a page called "[[2026-10-06" before.
- **Added:** `@` at the start of a line offers the agents the outline's extensions serve (`@tidy`), with what each
  does and when it runs, so a request is found by typing `@`.
- **Added:** pictures into a draft. `Ctrl+V` puts in the clipboard's picture (read on the door's machine); on the path
  an image file dropped on the terminal pasted, it puts in that file instead. Either is copied into the outline's
  folder (`media/`) and written as `[img::<path>]` on its own line.
- **Checked, not reproduced:** the Oct 4 "a blank version after a save" (save, follow a link, back; save and reopen):
  the reader reads the note again on back and after a save. Say the steps if it comes back.
- **Added:** embed a part without visiting it. `((Gree` or `!((Gree` lists the first note's headings, quotes and
  callouts with no anchor yet under it; choosing one adds its anchor there (attributed) and links it.
- **Fixed:** a quote or a callout is one passage: offered by its words or its callout title, anchored on its last line,
  and `!((id^anchor))` on it carries every line of it, not the lines down from a blank one.
- **Run:** the protocol changed (160: the page link grammar, and quotes and callouts as fragment kinds on the wire): `ep0ch install --apply` on each machine (the outline host and the doors together).

### A folder names who works in it: `agent` in `.ep0ch` (PIE-718)

- **Added:** `agent = "<name>"` in a folder's `.ep0ch` names the persona every agent write from there carries: the
  Claude mod's outline, workboard and door tools, `ep0ch mcp` over stdio, and a bare `ep0ch act` from Claude Code. Order:
  the call's `actor`, `OUTLINER_ACTOR`, `EP0CH_AGENT`, the folder's `agent`, then `EP0CH_MCP_PERSONAS`. `ep0ch where`
  and the mod's binding card say which one a session writes as.
- **Changed:** a persona is a recorded name, never a permission (ADR 0003): `ep0ch mcp` no longer refuses a persona
  `EP0CH_MCP_PERSONAS` gives another principal; it records it with its own principal (`loki/claude-code@laptop`).
- **Changed:** the mod's door tools act as the same actor id as its outline writes (`kitty/claude-code@float-2`, not
  `kitty`), so one agent is one actor in the change feed. An `@kitty` line still invites it.
- **Changed:** who wrote something is shown persona first everywhere a byline is drawn: the door's message lists,
  readers, river, comments and margin, activity and what-changed, agent flashes (`an agent (kitty · claude-code@float-2)`),
  the web inbox, proposal headers and MCP comment bodies. The principal stays one step away (revisions, receipts).
- **Run:** `ep0ch install --apply` on each machine first (older code refuses an `agent` line in `.ep0ch`), then add the
  line where you want one, for example `agent = "loki"` under `ws = "pie"`.

### The mod's text-replacing tools need the revision you read (PIE-631)

- **Changed:** the Claude mod's `work_body` and `note_section` require `expectedRevision`. Without it they answer
  "read it first with outline_read", and a note that changed since the read is refused, so a replacement built on an
  old read no longer overwrites an edit made in between.
- **Fixed:** references in Claude's replies use the one fence rule: a reference inside a four-backtick fence, or in
  indented code, is no longer turned into a link, and `((id^fragment|label))` links to its note instead of a page of
  that name.

### A note in Trash no longer keeps its page name (PIE-312)

- **Fixed:** trashing a note named `[page::2031-04-02]` and writing a new one with the same name was refused ("is
  already the page of … (in Trash)"), and `[[2031-04-02]]` kept pointing at the note in Trash. Now the live note takes
  the name and the links follow it.
- **Changed:** restoring a note whose page name was taken meanwhile still restores it, as `[page::2031-04-02-2]` (the
  next free name), and Tree, Detail and the board's `u` say which name changed. `trash.restore`'s reply names each
  rename (`renamedPages`).
- **Added:** Tree's restore (`r`) and purge (`p`) are in its action menu on a Trash root, so a click runs them;
  `outliner purge --id <id> --confirm <work id or first 8>` purges from a shell.
- **Run:** PROTOCOL bump; restart the host and the clients together (`ep0ch install --apply`).

### A half-written note never loses what follows it (PIE-669)

- **Fixed:** an unclosed code fence no longer turns the rest of the note into code: it ends at its paragraph (the next
  blank line), and what follows is read as before: its properties, links and tags count. A fence left open above a
  later code block no longer pairs with that block's closing line and shifts every fence after it.
- **Fixed:** a half-typed `[[`, `((` or `[key::` stays text on its own line: it no longer swallows the next link or
  property on that line (`[[Gard and [[Beds]]` links Beds; `[due:: friday [owner::Ilse]` reads `owner`), and an
  unclosed `((` no longer hides the tags after it.
- **Added:** each construct left open is said, with how to close it: ⚠ rows above the note in the door's reader, the
  save's flash, `ep0ch new`, and the `warnings` of an agent's write. Detail and published pages close an open fence
  where the service ends it.
- **Run:** PROTOCOL bump (what outline-core's grammar matches changed); restart the host and the clients together
  (`ep0ch install --apply`).

### The web client and the MCP gateway answer on a second domain (PIE-813)

- **Added:** `EP0CH_WEB_URL` and `EP0CH_MCP_RESOURCE` take several origins, comma-separated. The web client answers
  each one as itself: its own sign-in redirect and cookie, and writes only from its own pages. The gateway gives each
  host its own OAuth resource, discovery and tokens. Any other host name is refused. Links still use the first one.
- **Run:** see the PR for the env lines; add `https://my.floatbbs.net/signin/callback` to the Clerk app ep0ch-web.

### An open edit stays open when you go elsewhere (PIE-812)

- **Changed:** clicking another tile, `^W` then a window key, the hyper layer's moves or `ctrl+n` no longer save and
  close your edit: it stays open in its tile as it was (cursor, selection, undo), dim and titled `(kept open)`, nothing
  saved. A click on it or the keys coming back put you straight in it at the same place: no `e`, never twice. `Ctrl+S`
  saves, `Esc` closes, and opening another note in that tile goes by the draft session's rules.

### Rewriting a note's lines keeps each mark on its own words (PIE-805)

- **Fixed:** an edit that changed many lines (renaming a speaker through a transcript) left comments and highlights on
  their old offsets, which were then other people's lines. The service now places a note's marks again in the same
  write that changes its text: on their quote's words wherever they are now, or "couldn't place".
- **Fixed:** a mark is never moved onto words that were already in the note (a near twin of a deleted line, or the
  other copy of a repeated phrase). The web page no longer looks for an unplaced mark's words by itself, and the door
  draws a mark only where its own words are.

### Tags on the web open the notes carrying them; the margin setting stays in reach (PIE-800, web)

- **Added:** a `#tag` on a tailnet or share page is a link to the notes tagged with it (nested tags too). Each row has
  the title, the line with the tag and the note's crumbs. Inside a share, it lists only the share's notes.
- **Changed:** the margin setting (off · current · all) is a bar held at the bottom of the window, not at the foot of a
  long page. Selecting text still brings up its actions over it.

### The drawer agent's clipboard workaround changes nothing else (PIE-799)

- **Checked:** under the pane's env, with Claude Code 2.1.296, nothing behaves differently: image paste (ctrl+v, a pasted
  screenshot path), clipboard reads, `xdg-open`, vim and nvim (same start time, same clipboard provider).
- **Fixed:** Claude decides it's headless (print the login link, don't open a browser) from "no display" or an ssh
  session, and the fake display undid the first. The pane now carries the door's own `SSH_CONNECTION`, and the
  workaround applies only when there is one.

### Copying from the drawer's Claude reaches your clipboard (PIE-797)

- **Fixed:** a copy in Claude Code in the drawer (an agent in Herdr) said "sent via OSC 52" and nothing arrived, because
  Herdr's direct attach doesn't pass a pane's OSC 52 on (herdrdev/herdr#4612). The agent's pane now copies through the
  door's own `wl-copy`, and the door puts the text on your clipboard with a "copied from claude" toast.
- **Run:** after deploying, restart the drawer's agent (`agent.restart`, or quit and start Claude again in it): a pane
  started before this keeps its old environment.

### claude.ai artifacts in a note (PIE-793)

- **New:** a line that is only `[artifact::path]` (or floatty's `artifact:: path`) runs that artifact in the note on its
  web page, as claude.ai does: a React `.jsx`/`.tsx` (Tailwind, Tone, three and the rest of claude.ai's packages), an
  `.html` page (its CDN scripts too), an `.svg` or a `.mermaid` diagram, in a sandboxed frame, dark until it draws, with
  "open full page" under it. `[height::N]`, `[size::]`, `[align::]` and `[alt::]` go beside it. Drop a downloaded
  artifact in `~/outlines/<name>/artifacts/` and point at it (`[artifact::artifacts/fidget.jsx]`).
- **New:** in the door the line is a card (its kind, its title, `[open ↗]`); ⏎ or a click opens it running in the
  browser, on the signed-in web client (`EP0CH_WEB_URL`, my.ep0ch.sh) when the publisher has one, else its tailnet
  listener (`--url`, `OUTLINER_PUBLISH_URL`); with neither the door names the path and the variable to set.
- **Changed:** a publisher with a sign-in origin (`EP0CH_WEB_URL`) gives notes' web links on it (`notes.address`), the
  address used on every device, instead of the tailnet's.
- **Changed:** a React artifact's page is dark until it draws, and its error box is dark.
- **Run:** `ep0ch install --apply` (PROTOCOL 156; every block's properties are parsed again on the host's next open).

### Seen, Keep and TL;DR instead of Resolve (PIE-791)

- **Changed:** a margin thread is seen (put away, on an Earlier shelf; a new reply brings it back), kept (it stays), or
  given a TL;DR (@margin's summary, or yours, as its face, the discussion folded behind it). In the door's thread list
  `s`, `p` and `t` (`x` is gone there); on the web, an open card's one row; in Detail, Seen and Bring back. A resolved
  thread reads as seen.
- **New:** the web page's margin setting at the foot: off, current (the default) or all.
- **Changed:** Define on a word the note's glossary lacks asks @margin instead of stopping; card words are drawn as a
  note's (bold, links).
- **Run:** PROTOCOL 155: `ep0ch install --apply` on each machine.

### The web client is your own reader (PIE-789)

- **New:** a search box on every web page, on the tailnet and signed in at my.ep0ch.sh: the door's power bar search,
  nearest notes first, each result its title, the line that matched and where it sits. `/` or ctrl+k opens it; on a
  phone it's a sheet. A share link searches only what it shares.
- **New:** `[[`, `((` and `#` complete in the web's comment and reply boxes, writing what the door writes.
- **Changed:** on the tailnet and signed in, nothing is held back by `[publish::]` but `[publish::never]`: a
  `[publish::false]` note, an extension's records ("… data, not published") and links to unpublished notes all show.
  The public listener and share links hold back as before.
- **Fixed:** a highlight on a web page shows: a warm tint on its words at once, and after a reload (the tones never
  applied before). Tapping it offers Comment, Ask and Remove.
- **Changed:** on a wide web page, comment, ask and explain cards sit beside their words with a line to the open one,
  short until opened, their actions on one row. Words across bold or a link are marked; a thread whose words can't
  be found is at the foot under "Couldn't place", and "On this note" lists them all.
- **Changed:** an outline's top level lists its notes; Trash and Bookmarks are no longer drawn as a board (Bookmarks is
  a link at its foot), and a note in Trash never shows as an "untitled" row.

### The web client at my.ep0ch.sh, signed in

- **New:** the tailnet's web client, whole, at `https://my.ep0ch.sh` behind a sign-in (GitHub through Clerk, only the
  people the MCP gateway lets in): every page and folder, marginalia, `@margin`, quotes, Recent replies, shares and
  the page helpers. Signed in once, a browser stays signed in for 30 days from its last visit.
- **New:** every outline the host serves is in the web client: the home one at `/pub/`, the others at
  `/pub/o/<name>/` (`/pub/o/` lists them), on the tailnet too.
- **New:** `/pub/sessions` (and `ep0ch web sessions`, `ep0ch web revoke <id>|--all`) lists the signed-in browsers,
  with Revoke and Sign out everywhere.
- **Run:** PROTOCOL 146: `ep0ch install --apply`, then the deploy steps in the PR (a Caddy change for my.ep0ch.sh, the
  publisher's `--signin-port`, and one shared `signin.env` for the allowed list).

### The floating comment box stays with you (PIE-785)

- **Changed:** clicking another tile (or ^W, or a hyper chord) no longer closes the comment you're writing: the box
  stays on screen as it was, unsent text and all, and the keys are back in it the moment that reader has them again.
- **New:** a floating comment box drags by its top edge (`≡ move`) and sizes by its `◢` corner or its right and bottom
  edges; by keys, `ctrl+g` then the arrows or `h j k l` (shift, or `H J K L`: size), `0` its usual place, `⏎` done
  (`comment.move`, `comment.grip`). Moving it never changes the passage it's on, and it's for this sitting only:
  opened again (or read later), it's in its usual place.
- **Changed:** following a link, a comment mark, back or forward while a comment is unsent asks instead of doing
  nothing: the power bar asks (its `ask` scope, as a quote's "where" does): save and continue (kept as unsent, `C` and
  the passage bring it back), keep writing, or discard (a copy stays on disk); `⏎` or a click on a row, esc keeps
  writing (`comment.leaving`). An agent's action never asks.

### Marks you can quote: a highlight, comment or reply becomes a block of its own, and traces back

- **New:** quote marks into a new block, the margin's quote-tweet. One highlight, comment or reply, or several, become
  one block that transcludes each (`!((mark))`) under a `[from::((mark))]` back-link, in the Inbox (the default),
  under the note, or under any note you pick. The marks stay where they were; each card then says **quoted in** it.
  One write, one undo. In the door: `[Quote]` on an open thread or a reply, or `m` then `q` (`space` picks several);
  the power bar asks where. On a web page (tailnet or a share that takes comments): a card's Quote, or Pick on
  several, then a sheet with where and your own words; the toast opens it or undoes it. An agent: `act quote` or MCP
  `outline_quote`. The service's `marks.quote` (PROTOCOL 144).
- **New:** words in a comment can be highlighted, commented on or asked about on a web page, the same as a note's
  (threads of threads); they're drawn in its card, and tapping them opens their card.
- **Fixed:** a mark's own page (`/p/<mark id>`, where `((mark))` links on the web) was empty; it shows the mark.

### Talking to the thing on screen: page helpers an agent beside the page calls

- **New:** every web client page (tailnet and share) has `window.ep0ch`: `help()`, `view()` (the note, the selection
  with its block and offsets in the source, the blocks on screen, the scroll), `reveal('((id))')` (scroll to a block
  and outline it) and `journal(since)` (pages opened, words selected, folds), the same as WebMCP tools on
  `navigator.modelContext` (the `@mcp-b/global` polyfill, served by the publisher). They only read and point; the page
  says when an agent calls one. `reader.view` and the MCP's `reader_view` carry the same view and the journal.
- **Fixed:** a web client page asked the threads route about once a second while anything else in the outline changed;
  it now waits until what the page itself draws changes (about three requests a minute when idle).
- **Run:** `ep0ch install --apply` (protocol 143; `bun install` adds the polyfill), then restart the publishers.

### Conversations in the margin: a thread is a conversation, and replies come back to you

- **New:** a margin thread is one conversation. The first `@margin` starts the agent's session and keeps its id on the
  thread (`[margin-session::<id>]`); a later `@margin` in a reply there resumes it, so it remembers the earlier turns.
  A reply without `@margin` is a note to self: never sent, never answered. Every ask sees the whole thread and the
  page's other comments. An answer that writes `[query::]`, `[sort::]` or `[group::]` has them checked by the outline,
  and one that doesn't work is marked under it.
- **New:** Recent replies. The web client's `/replies` page (bookmark it on the phone) lists every reply on a thread
  you started or wrote in, newest first, the unread marked; opening one goes to its thread, and opening a thread (from
  there, tapping it, replying, or expanding it in the door) marks it read. In the outline it's a saved view:
  `Recent replies [type::virtual-branch] [query::type=annotation-reply AND thread:me AND NOT annotation-source=user] [sort::created] [direction::desc] [limit::50]`.
- **New:** query atoms `unread:me` and `thread:me` (or an agent's actor id), over read marks per reader (PIE-708's
  core: `id@revision`, set by `annotations.read`); and a counted `child>=N:`: `child>=2:type=virtual-branch` lists
  every hub.
- **Fixed:** wide tables on the web client scroll sideways instead of crushing their columns.
- **Fixed:** `@margin`'s Claude session had its outline tools off when the host handed it `EP0CH_SOCKET` with
  `EP0CH_WS`; the mod now takes that pair (a host on this machine and the outline on it) and still refuses a forward to
  another machine.
- Protocol 139. Schema stays 5: the read marks table joins version 5 before it ships (0005's migration creates it).

### Any extension can provide Resources, as Jira does

- **New:** an extension with a `kind: "resource"` handler is a provider of remote entities (`ext:<id>`): its keys are
  read in notes (`kanboard:: KB-7`, `[kanboard::KB-7]`), each entity is a Resource the service keeps (Source, snapshot,
  history, comments on its text) and a block the extension owns, refreshed on open and on its poll. The handler's
  `keyPattern`, `fields` and `link` say its key grammar, what a projection shows and its web page. Before, only Jira
  could; a new provider had to use `data`.
- **Changed:** Jira is one of these providers: its Resources' provider is `ext:jira` (was `jira`); its Sources,
  Resources, records and history are kept. Its `jira::` lines are read once its extension is installed (in a folder or
  the legacy `resource-extensions.json`), as any provider's.
- **Changed:** `extensions.list` lists `resourceProviders`; the door, Detail and the service read `key::` lines with
  each outline's own.
- Also in this change (wave 2's runtime, #379): `lastRun` on `extensions.list` entries.
- Protocol 136 and schema 5: `ep0ch install --apply` on each machine migrates every outline at schema 4
  (`packages/outliner/scripts/migrations/0005-extension-providers.ts`: the provider checks opened, `jira` renamed
  `ext:jira`, nothing else changed) and restarts the host; update every client with it.

### Every extension has a page in the outline, and ships its demo notes

- **New:** an **Extensions** hub at the outline's root (`[[extensions]]`): what's installed, each a link to its page,
  and what the repo's `extensions/` folder has that isn't, with its description. The outline service writes it from
  the extensions' folders and again whenever one is added, updated or removed.
- **New:** a page per installed extension under the hub: its README drawn as the note, its version, what it adds
  (handlers, actions and their keys, schedules, tiles, rules, agents, power bar rows, secrets by group, settings) and
  its newest CHANGELOG entry. A `key::` line or an `@name` in a README is drawn, never run.
- **New:** an extension can ship notes. A `demo/` folder (`"demo": "demo"` in `extension.json`, one Blockdown file per
  note, nested by folder or `parent:`) is written under its page when it's installed, once, as `ext:<id>`, with fresh
  ids and its references rewritten. They're yours: a reinstall never writes them again; `ep0ch ext remove <id>` keeps
  them, `--demo remove` moves the ones you didn't change to Trash.
- **New:** install and remove from the door: `ctrl+k` then `&` lists the hub, each page, `install <name>` for each one
  not installed, and (type a name) `remove <name>`, keeping its demo notes or not; agents `act extensions.install
  id=<id>` and `act extensions.uninstall id=<id> demo=keep|remove`.
- **Changed:** the notifications hub's boards and the runbook's demo runbook are their demo notes now (notify v2,
  runbook v2): a pull no longer makes the boards.
- **Changed:** `&` is the door's extensions scope: an extension's bar source can't take it as its prefix.
- Kitchen sink: the `ext-pages` section shows the hub beside the notifications hub's page.
- Protocol 135 (`extensions.install`, `extensions.uninstall`, `hub`, `pages` and `available` on
  `extensions.list`): update the host and every client together, `ep0ch install --apply` on each machine. No schema
  change. On the next start each outline the host serves gets its Extensions hub and a page per installed extension.

### Your outline in the browser on the tailnet: browse it like folders, read on the phone, mark it up (PIE-782, PIE-774, PIE-775)

- **New:** on the tailnet every note is a page, no `[publish::]` needed: `https://float-2.<tailnet>.ts.net/pub/` (or
  `https://my.ep0ch.sh/p/<id>`) in a browser. A page is a folder that is also a file: breadcrumbs, the note's own
  text, then its children as links with a summary line, a count and a date. Addresses are the published slug, else the
  page name (`/p/Field%20Notes`), else the id. `[publish::never]` still hides a subtree.
- **New:** select words on a page for Highlight, Comment, Ask (`@margin`), Copy (with a `((reference))`), Explain and
  Define. Threads sit beside the text when the window is wide and under the passage when it's narrow, with Reply and
  Resolve; answers appear when they land. Every write goes through the service as the door's do, so the door and
  Detail show the same threads. Being on the tailnet is the sign-in: no accounts, no tokens.
- **Changed:** on the tailnet a browser opening `/p/<address>` gets the page; curl and agents still get the Markdown
  (`?view=md` asks for it). `?view=html` is the folder page there; `?view=full` is the old all-in-one page.
- **Changed:** an extension's annotation (marginalia's highlight or definition) is drawn on published pages like any
  other annotation; before, the extension-data rule left it off.
- **Unchanged:** the public listener (`pie.ep0ch.sh`, `/share`) is read-only and shows only `[publish::public]` notes,
  with no script.
- No protocol or schema change. On each machine: `ep0ch install --apply`, then restart the publishers, which keep the
  code they started with: on float-2 `systemctl --user restart outliner-publish.service outliner-publish-gurgle.service`.
- *Why it matters:* the feedback loop from the phone. An agent writes a plan, you read it on the phone, mark it up,
  and the marks are in the outline for the agents.

### A comment is written where you're reading: inline at the passage, or floating, split or popup by choice (PIE-770)

- **New:** select words and press `C` (or a passage toolbar's Comment, Ask, Explain, or a thread's `[Reply]`): the
  comment box opens right under the passage, inside the note, which still reads and scrolls around it. `ctrl+s` saves and
  the thread sits where the box was. Nothing takes you to another screen.
- **New:** four placements, inline (the default), floating beside the passage, split (the reader shared with the note)
  and a popup. `ctrl+o` or a click on the box's chip moves the one you're writing; `ep0ch act composer.place
  place=<inline|floating|split|popup>` sets where new ones open, kept for the next start.
- **Changed:** a posted thread's body and replies, its margin card and the composer's preview draw `((references))` by
  their titles and `!((embeds))` as the reader does. A reply's author and time sit on a line of their own above it.
- **Changed:** the composer's title row says the keys (`comment · ctrl+s saves · esc cancels`); the note's title is the
  reader's header.
- The showcase's `composer` section shows the four at once.
- No protocol or schema change. On each machine: `ep0ch install --apply`.
- *Why it matters:* commenting is the core reading loop (marginalia, Readwise, feedback on plans); being taken to
  another screen mid-thought broke it.

### Extensions from the docs alone: a call reference, a schedule once per host, a note's address and its rendering (PIE-767)

- **New:** `"once": "host"` on a schedule runs it in one outline of the host instead of in every outline that serves
  the extension; `ep0ch ext ls` and the door's extensions list say `once per host` and where it runs.
- **New:** `notes.address` gives a note's `ep0ch://` URI, this machine's name and, when it's published, its web URLs
  (`url`, `publicUrl`, `permalink`). `ep0ch publish serve --url <its tailnet URL>` (OUTLINER_PUBLISH_URL) tells the
  service where the publisher is opened.
- **New:** `notes.render` renders a note as its published page reads, as Markdown or HTML, through the publisher's own
  renderer; a `[publish::never]` note is refused.
- **Changed:** Readwise's hourly pull runs once per host (its claim on the board page is gone), `send` sends the note
  as the publisher renders it, and a published note's link in Reader is its page.
- **Docs:** the extension README's call reference is written from the types and checked by a test; new sections on
  idempotent syncs and `requestId`, where state lives, editing an annotation, `effects` for outside writes, imported
  text, two-outline tests, a showcase recipe and a worked sync.
- PROTOCOL 132. On each machine: `ep0ch install --apply`. To give published notes web URLs on float-2, add
  `Environment=OUTLINER_PUBLISH_URL=https://<float-2's tailnet name>/pub` to `outliner-publish.service` and restart it.
- *Why it matters:* the next agent building an extension (the notifications hub) shouldn't have to read the source.

### A Readwise extension: send a note to Reader, pull highlights back (PIE-743)

- **New:** `extensions/readwise`, an example extension. `ext.readwise.send` saves a note (and the notes under it) to
  Readwise Reader as a document that links back to it. `ext.readwise.pull` runs every hour: a highlight on a sent note
  becomes an annotation at its passage (`kind=highlight`, your note as the body); every other highlight lands on a
  `readwise` board outline, a block per book and per highlight. Running it twice writes nothing new.
- Setup: `with-secrets --add readwise READWISE_TOKEN`, `ep0ch init readwise`, `ep0ch ext add readwise`.
- *Why it matters:* the first real extension built from the extension docs alone by an agent that hadn't seen the code;
  your Reader notes come back into the outline without copy and paste.

### Extensions are programs: a schedule, a connection to the outline, writes anywhere, secrets by group (PIE-754)

- **New:** a handler or action may declare `schedule` (`every` or `cron`). The outline host runs it and records each
  run; `ep0ch ext ls` shows each schedule's next run and what the last did, and `ep0ch ext run <ext> <entry>` runs one
  now. A scheduled action acts on the outline (`on: "outline"`, no block).
- **New:** every extension process gets `EP0CH_SOCKET`, `EP0CH_WS` and `EP0CH_EXT_GRANT`. Over that connection it reads,
  creates, updates and annotates through the normal paths, in any outline the host serves, as `ext:<id>` with who asked
  beside it. An update while you type in that passage becomes a proposal; no extension write sets an extension off.
- **Changed:** an action's writes may land anywhere in the outline, not only inside the block it acts on.
- **New:** a secret may name a `with-secrets` group and key (`{ "group": "readwise", "key": "READWISE_TOKEN" }`): only
  that key reaches only that extension's process, never the host's environment.
- **New:** a data handler may answer a collection (`records`, keyed by the extension's own ids), written idempotently
  under its line's record.
- **New:** an extension can name a Resource to open (`file:/path`, `web:https://…`, `resource:<id>`) in a bar row, a
  table or card link, or an action's `open` answer; the door opens it as the links tile opens a Resource.
- **New:** `ep0ch ext ls|add|remove|act|run`, the outliner's extension command through the one front door.
- *Why it matters:* a real extension (a Readwise sync, a morning digest, notifications) no longer needs core changes;
  an agent in another project can build one from the extensions README alone. The showcase's `extensions` section
  shows almanac, a scheduled program that writes a dated note under a page.
- **Changed (wire):** `PROTOCOL` 130. Update the outline host and every client together (`ep0ch install --apply`).

### Questions the service answers and keeps answered: this, linkedfrom:, parent:, groups and facets (PIE-745)

- **New:** in any query (a view, a figure, `::links{query=…}`, `ep0ch find --query`, `outliner_query`): `linkedfrom:<target>`
  (the blocks the target links to), `parent:<target>` (its children), and `this` as a target, the note the question
  sits in. `links:this NOT linkedfrom:this` lists what mentions a note that the note doesn't link back.
- **New:** `blocks.query` groups (`group=` any property, or `created:week` and the like), sorts (`sort="title"`,
  `work-stage` in the workboard's order) and counts values (`facets`) over every match, and says `no notes have <key>;
  nearest: …` for a key nobody has written. A `::graph-tabs` or `::graph-rank` draws the service's groups.
- **Changed:** live figures and `::links` no longer drop every answer on any change and ask again on the next paint: they
  watch their questions, and the service says when an answer changed (at most every 250 ms, at least once a second
  under steady writes). *Why it matters:* the door stops polling and stops owning query meaning, so every terminal gets
  the same answers, and "what haven't I linked back" is one line. The showcase's `questions` section shows it.
- **Changed (wire):** `blocks.query`'s `expression` is now `where`, and its structured form `predicate`. A rank or tabs
  figure over a `view:` says to write `query:` instead (the service groups queries). `PROTOCOL` 129: update the outline
  host and every client together (`ep0ch install --apply`).

### Read with a pen: highlights, margin notes and passage actions (PIE-751, PIE-753)

- **New:** select words in a reader and act on them. A toolbar appears on the selection's line: Comment, Ask, Explain
  and each extension's passage action. Click a chip, or press `a` then its key. With marginalia (`outliner ext add
  marginalia`): `a h` highlights, `a d` defines from the note's own glossary, `a k` copies the words with a citation
  (`> the words` then `— ((note^fragment))`), `a a` asks `@margin` (its answer lands in the passage's margin thread).
  It works on a file you opened as a Resource too; the file is never written.
- **New:** highlights are drawn on their words in a dark tone, and comments as cards in the margin: beside the text
  when the reader is wide (the measure keeps room for them), under the passage when it's narrow. `M` cycles the cards: a
  row each, whole, off. Detail draws highlights and cards too, and published pages show them read-only (`<mark>` and a
  margin aside).
- **New:** annotations carry open properties: `kind`, `tags`, `color` (a theme tone, never a raw colour), or any key.
  A highlight is an annotation with no body. Agents write them with `outline_comment` (`properties`, and no body for a
  highlight); `outline_threads` returns them.
- **New for extensions:** an action can act on a passage (`"on": "passage"`); the service checks the passage before it
  runs (exact at its revision, found once with its context at a newer one, else refused with the nearest match). It
  can `annotate` the passage and hand back `copy`. An agent with `"threads": true` answers `@name` in comment threads.
  `outliner ext act <id> <action> --block <id> --quote "<words>"` runs one from a shell.
- **Changed:** `Y` on a selection with a link or bold inside copies exactly those words' source (the whole link, the
  whole bold run), not the whole line.
- **Run:** PROTOCOL 128. Update the outline host and every door together (`ep0ch install --apply`).
### One kind of agent session: started from any folder, shown in the drawer or a tile, listed in one panel (PIE-737)

- **Added:** `ep0ch agent` in any folder starts that folder's agent session in the door on its outline, or names the one
  already running there (`--program codex`, `--in <folder>`, `--persona <name>`, `--new`). It opens as a tab in the drawer,
  continuing the program's last conversation in that folder (claude and pi `--continue`, codex `resume --last`).
- **Added:** the agent panel, `alt+g` on any screen: every session (started with `ep0ch agent` or its `n`, a claude typed in
  a `^W o s` shell, the drawer's own), its folder, persona, what it's doing and where it's shown. `⏎` jumps to one, `a` pulls
  it into your drawer, `d` docks it here: the same process, the conversation kept. Agents: `agent.start`, `agents.list`,
  `agents.go`, `agents.drawer`, `agents.dock`.
- **Added:** agent configs in the outline: a note with `[agent-config::<name>] [program::…] [args::…] [persona::…]
  [folder::…]` is a program the panel offers, run under that persona.
- **Changed:** `alt+g` opens the agent panel; choosing the drawer's own agent (`host.agent`) is the picker its first pull
  offers, and the power bar's. `host.agent in=<folder>` saves the folder it starts in.
- **Removed:** `EP0CH_DAILY_CWD`. *What to run:* `ep0ch doctor` says it when it's still set, with the command
  (`ep0ch act host.agent name=… in=<that folder>`), then drop it from your shell's profile.
- *Why it matters:* "talk to an agent here" was three things that looked alike and acted differently (a claude in a shell
  tile, the daily agent, the drawer's); it is one now, wherever it was started.
### A lost patch's proposal sits beside its note, and a retry returns the open one (PIE-725)

- **Changed:** when an agent's patch loses its race (the note changed since it read it, a door holds a draft, or the
  outline takes only proposals), the proposal is a block beside the note, never a line in its text. The note's text and
  revision stay as the winner left them, so the next writer near there doesn't lose too. The door's reader and Detail
  draw it where its embed line used to go: under the mark, else after the note's last line, with `[apply]`, `[dismiss]`,
  `A` and `X` as before.
- **New:** the same open patch sent again by the same agent (same note, passages, replacements and mark) returns that
  proposal with `deduped: true`, through the CLI, the Claude mod and MCP, instead of another copy. *Why it matters:*
  five agents racing on one guide left four copies of one fix for someone to clear by hand.
- **New:** `draft.proposals.list` lists the open proposals beside a note, with the line each is drawn after. The
  showcase's `proposals` section shows a race between two agents.
- **Kept:** proposals made before this keep their `!((id))` line in their note and are drawn by it, never twice. Dismiss
  still takes that line out. Nothing rewrites note texts; to list the notes that still carry one, run on each machine
  (read-only):
  `sqlite3 -readonly ~/outlines/<name>.sqlite "SELECT h.id, substr(h.text, 1, instr(h.text || char(10), char(10)) - 1), p.id FROM blocks p JOIN block_properties t ON t.block_id = p.id AND t.key = 'type' AND t.value = 'draft-proposal' JOIN blocks h ON h.id = p.parent_id WHERE instr(h.text, '!((' || p.id || '))') > 0 AND h.effective_deleted_root_id IS NULL;"`
- **Run:** PROTOCOL 127 (`draft.proposals.list`, the proposal receipt's `beside` and `deduped`, the draft-holder `embed`
  request gone). `ep0ch install --apply` on each machine (float-2 for pie, the MacBook for float-hub) restarts the host on
  the new code; then restart the doors and Detail. No schema change.

### A refused key says why on the tile you're looking at; q leaves a desk holding only a group (PIE-727)

- **Fixed:** on a desk whose only tile is a group (`tile.group`), `q` was refused ("the group is a tile") and `Esc` said
  `q leaves`, so the screen couldn't be left by keys. `q` in a group or a mounted screen now leaves the screen holding it,
  as on any desk; from inside a mount (`^W e`) it comes out.
- **Changed:** when the door refuses your key or click (a refused action, `nothing to close`, a spine's keys, a dimmed
  tile-menu row), the focused tile says why on its bottom edge, in amber, as well as on the status bar. Press the same key
  again and it gets loud: bold on a dim amber band, the frame amber, and it stays until you press a different key. Dark
  only, never a bright flash. *Why it matters:* it took seven presses of `q` before the one-line status bar message was
  noticed; the reason is now where you're looking. The showcase's `refusals` section shows it.

### One reader, three modes: follows, held or pinned to a page, instead of reader and detail (PIE-705)

- **Changed:** a detail is no longer a kind of tile of its own. The `reader` tile has a mode, shown as a chip on its frame:
  `follows` the current note, `held` on the note it shows, or `pinned [[page]]` (shown again each time it starts). `p`
  toggles follows and held in any reader, a click on the chip cycles all three, and `act reader.mode tile=<name>
  mode=follows|held|pinned [page=<name>]` does it as an agent, attributed. `^W o d` still opens a reader started held, and
  `tile.open kind=detail` (and `kind: detail` in a saved layout or a screen note, with or without `page=`) reads as a held
  (or pinned) reader. *Why it matters:* you pick follow or hold on the tile you are looking at, and the old refusal
  "reader.hold is for readers" for a detail is gone, because every reader can switch.
- **Changed:** `reader.hold` is now `reader.mode` (its `on=` is `mode=held` or `mode=follows`). A detail you let go of now
  follows the current note again (it used to stay put); a held reader is saved with its note and comes back held.
  A pinned reader that is opened into another note than its page is held on it, not pinned.
- **Run:** nothing: no protocol or schema change; saved layouts of the old form load as they are.

### Your look, part two: surfaces, frames, edges and the header, tuned live (PIE-675)

- **New:** a tile or a box can sit on a surface (`[style.bg::raised]`, `sunken`, or a tone: blue, green, violet, amber,
  coral, neutral) at a strength of 1 to 6 (`bg.strength`), get a frame (`border`: line, round, heavy, double, none; a
  tile's `auto` is its screen's) and an accent in its tone (`edge`: a bar down its left side, or the whole frame; `tone`).
  Surfaces are theme roles, never colours: each theme draws them dark, under a brightness cap, with every word at 4.5:1
  or better on them, and a tile's yields under a header's picture. In a note: `::box{bg=sunken border=round tone=amber}`.
- **New:** a list's divider can be dashed, double, a fade (the `--- [rule::fade]` track) or a glyph of your own
  (`[style.list.divider::glyph] [style.list.divider.glyph::✦]`), at the top, centre (now the default) or bottom of the gap
  (`list.divider.align`). The zebra stripe takes a surface and a strength (`list.zebra.bg`, `list.zebra.strength`), so it
  shows on a near-black theme.
- **New:** a reader's sticky header (title, byline, crumbs) gets a surface of its own (`header.bg`, `header.bg.opacity`),
  and its picture can be chosen (`header.image`: one of the note's pictures by its file's name, or a path) and its crop
  moved (`header.image.x`, `header.image.y`, in % of the picture).
- **New: a look per list and per tile, not for every list in the system.**
  - **This list:** a list's own tokens go on the heading of its section or its lead-in line, by placement:
    `## Seed trays [style.list.gap::1] [style.list.divider::dots]`. A sibling list stays as the page has it.
  - **This tile:** one tile's own look is kept in its tile spec and saved with the layout, so one links tile or one
    reader can be airy while the rest stay tight.
  - **Order:** the nearest wins: built-in, global, the tile's kind, the screen, the page, this tile, this list (or a box).
  - **In the inspector:** both are levels (`v`), and the source column names them. With the reader's `[ ]` on a list or
    its heading, "this list" saves onto that line.
- **New:** one field, three widths: `[style.pad::0 1 | 1 3 | 1 6]` is narrow, normal and wide. A reader in a wide tile
  gets padding 1 4 by default.
- **Changed in the tune inspector, back to "as if I had done nothing":**
  - `u` and `U` (or `ctrl+r`) undo and redo every nudge and save of the session, one step at a time, each said on the
    status line ("undo: pad.x 6 → 4 at this page"). Undoing a save writes the note back; a note changed since is refused.
  - `x` (or a row's ×, or `[reset value]`) resets a value to what it inherits: what sets it is taken off the note that
    wrote it, a width variant before its plain value; the save removes the property.
  - `X` (`[reset level]`) clears every value the picked level sets here, off its style notes; `R` (`[revert all]`)
    puts every style note the session wrote back as it was, saved changes included, and refuses, naming the note, when
    one changed since. Both ask in place: the key again, or `[confirm]`.
- **New in the tune inspector:** with a level (`v`) or one width (`w`) picked, each row shows what that level says
  itself beside the value in force, and a row something nearer wins is marked ⊘ ("page overrides", "narrow overrides
  at this width"). A nudge there asks first: `a` nudges anyway, `o` nudges what wins instead, `c` clears it. A surface's
  row shows a swatch of it, and `+ −` on `header.image` step through the note's pictures.
- **Run:** PROTOCOL 125 (the cascade's tokens). `ep0ch install --apply` on each machine (float-2 for pie, the MacBook for
  float-hub) restarts the host on the new code. No schema change.

### A note's children join its links; the thread tile is a links tile with Children alone (PIE-693, slice 1)

- **New:** the links tile lists a fourth group, `↓ children`: the notes under the note (a thread's replies; comments stay
  under Backlinks, kind Comment). Kind, Stage, Sort and the filter narrow it as every group, by the kind and stage the
  service computes, and the counters count it (`↓3/4`).
- **New:** which groups a links tile lists is the tile's own, saved with the layout: `v`, a click on the counters (a list
  whose rows switch a group, one click each), the tile menu's "choose its groups", `act backlinks.groups show=|toggle=`.
- **Changed:** the thread tile is gone. A layout saved with one gets a links tile with Children alone (`^W o h` opens
  one); the desk layout's `replies` tile is one. Its pick and open are `backlinks.pick` and `backlinks.open` (⏎ where the
  list's opens land, alt+⏎ a new detail); `thread.pick` and `thread.up` are gone (`u` in the reader goes up).
- **Run:** PROTOCOL 124 (`blocks.facets`, new). After `ep0ch install --apply` on each machine, restart the host, then the
  doors. No schema change.
### A chain of linked readers: what-changed opens into reader 9, reader 9's links into reader 10 (PIE-700)

- Opening a note from outside a reader (the what-changed list in the drawer, `ep0ch open`) no longer asks the link of the reader your keys were last in. Before, with the keys last in reader 9 (linked to reader 10), ⏎ on a what-changed row moved both 9 and 10; now it opens in the reader that follows the current note and 10 only changes when a link is followed in 9.
- `alt+l` works across the drawer's edge: in the drawer, `alt+l` on what-changed, then a click on a reader above (or its number), and that reader takes the list's `⏎` whatever has the keys, kept through the drawer shut and opened, another screen, a restart and a saved layout. `tile.link to=@chain/reader9` does it for agents (`@drawer/<tile>` the other way). The frames show it: `what-changed → reader9`, `reader10 ← reader9`; an unlinked list says which reader its `⏎` lands in now.

### The ^W keys come from one list, and `^W ?` opens it to filter (PIE-704)

After `^W`, the keys box now shows the most-used keys grouped (focus and move, size, tabs, open), and the status line no longer repeats them: it says `^W … · ? all keys · esc`. `^W ?`, or a click on "all keys", opens every `^W` key as a list on the power bar: grouped, each with its key, typing filters it, ⏎ presses the key. The box, the tile menu and the list are generated from one table, so they agree; the old hand-written hint lacked `G`, `i`, `space`, `e`, `u`, `M` and `I`. Nothing to run.

### Every component has a schema, so the library shows them all (PIE-701)

- **New:** the component library, `ep0ch library --brief` and `outline_components` now cover every component a note can
  draw: all the `::graph-*` figures (stat, kpi, rank, funnel, waterfall, plot, gantt, tree, check, timeline, table, tabs,
  decision, chat, keys, uptime, activity, calendar, annotate, quadrant, matrix, compare, flow), `::links`, `::outlinks`,
  `::resources`, `::backlinks`, `::box`, pictures, header images, embeds and references, code fences and tables. Each page
  has a live minimal example, each property's values drawn, and the source to copy. *Why it matters:* an agent (or you)
  finds a component's properties and values without reading code, and an extension's component joins the same list with
  no code of ours.
- **New:** the library draws at all three widths (40, 80, 160) one under another: `w` cycles to `all`, or click it.
- **Fixed:** a `::graph-waterfall` whose running total rose past its first bar drew as "couldn't draw".
- **Changed:** a test fails when a component the readers draw has no schema, so a new component cannot ship without a
  library page. A figure's live form (`query:`) is not drawn in the library, which has no outline to ask; its page says so.
- **Run:** PROTOCOL 123 (the components the service lists grew). After `ep0ch install --apply` on each machine, restart the host so clients and service agree. No schema change.

### Every MCP write says which call made it, and your own writes stop coming back as news (PIE-685)

- **New:** a caller's visit to the board is a call. Every MCP write (stdio and the gateway) records its call id beside who made
  it, a readable handle for it (`leaping_otter_convergence`, minted once and stored) shows in `list_outlines`, in a write's
  answer and in the gateway log, and `call:<id or handle>` finds what one call wrote. The id comes from the `call` argument,
  the gateway's `Mcp-Session-Id`, or one per stdio connection; a write with none is a call of its own and says how to keep
  one. Display stays `daddy (claude.ai)`. *Why it matters:* you can review or undo one chat's batch of notes without touching
  another's.
- **New:** a recent-activity `outline_query` (an `updated` range or sort, or `fold`) leaves out the rows only your own call
  changed, counting them (`ownOmitted`), unless `includeOwn: true`. Other calls' writes still show. *Why it matters:* an agent
  orienting after its own writing burst doesn't re-read what it just wrote.
- **Run:** PROTOCOL 122 (a new query atom). After `ep0ch install --apply` on each machine, restart the host and reconnect MCP
  clients to see the `call` argument. No schema change; the handles live in `<outlines>/.clients/mcp-calls/calls.sqlite`.

### Gather tiles into a group by mouse and keys, and keep their links (PIE-696)

- Drag a tile's title onto a group (its frame, or a drop zone inside it) and it goes in; drag one out past the group's content and it goes back out onto the screen. The tile moves whole: a running shell keeps running, and its agent limit, spine and links go with it. `layout.move into=<group>` and `out=true`, and `^W i`, do the same by keys and `act`.
- Shift+click on tile titles (or `^W space`) picks tiles, marked ◆ on their frames; `^W G` gathers the picked into one group in the arrangement they had, esc lets go. Your picks are yours: an agent's picks (`tile.select`) are its own and never touch them.
- `^W G` on a tile in a split asks whether to gather this tile or the whole split; the tile menu's row asks the same.
- A link between a tile and one in a group survives gathering, spilling, moving in and out, and a restart: the tree outside opens notes in the reader inside, and a preview across the edge keeps following. Across the edge a tile is `<group>/<tile>` (and `../<tile>` from inside): `tile.link to=<path>`.

### Agents make outlines of their own over MCP, and every write says who made it (PIE-679)

- **New:** `outline_new` over MCP (stdio and the gateway): an agent makes a scratch outline on this machine for link sprees,
  the day's discourse and other fleeting things, with `full` for itself and `read` for the other principals. Its root note
  says who made it and why (`[created-by::…] [purpose::…] [kind::scratch]`), and the door's home base, `ep0ch outline list`
  and `list_outlines` show the same. A taken name is refused with the nearest names; `EP0CH_MCP_SCRATCH_CAP` (default 5 a
  week per principal) is a soft cap. `outline_archive` and `ep0ch outline archive|unarchive <name>` put one away and bring it
  back, keeping the database; nothing deletes over MCP.
- **Changed:** a write's actor id carries the principal auth proved and the persona it declared: `mcp:loki/claude-code@float-2`,
  `mcp:claude.ai`, the mod's `cowboy/claude-code@laptop`. The door, receipts, proposals and threads show
  `loki (claude-code@float-2)`. `EP0CH_MCP_PERSONAS` keys are principals now (`claude-code@float-2=loki`; a bare client name
  still works for the gateway's); a persona can't be claimed across principals. Older writes keep their ids.
- **Run:** PROTOCOL 117. After `ep0ch install --apply` on each machine, restart the Claude mod's sessions and reconnect MCP
  clients to see `outline_new`. No schema change.

### Your look, tuned live: spacing and list density from notes, with a tune inspector (PIE-673)

- **New:** a tile's padding, a note's measure (the widest its text runs, centred in a wider tile; a reader's is 88 by
  default) and margin, a list's gap, dividers and zebra, and a heading's spacing come from notes in the outline, so you
  change them without an agent or a build. A note says what it styles and how: `[style-for::global]`,
  `[style-for::tile:detail]`, `[style-for::screen:desk]`, or a name a page uses (`[style::airy]`), with fields such as
  `[style.measure::72] [style.pad::1] [style.list.gap::1] [style.list.divider::dots]`; a page can set its own, and a box
  in a note too (`::box{margin.x=4 list.gap=0}` … `::`). Any field takes a width (`[style.narrow.margin.x::0]`, under 60
  columns). The nearest level wins: built-in, a heading style, global, the tile's kind, the screen, the page, a box. An
  edit to a style note restyles every door on the outline at once.
- **New:** the tune inspector (`alt+y`, `^W o y`, or "tune its look" in a tile's ⋯ menu) beside a tile lists each value
  and where it comes from. `+` `−`, a click on `[−] [+]` or the wheel over a value nudge it, and the tile moves in the
  next frame. A nudge goes where the value is set (or to the level you pick with v), for every width or (w) this width
  only. `s` saves to the outline, `u` undoes, `x` resets. Quitting with nudges unsaved says so.
- **Unchanged text:** spacing is drawn, never text. A drag, `y`, `Y`, `select.copy`, `peek` and `ep0ch export` give the
  note's words, a wrapped line joined, with no margin, gap or divider in them; a click lands on the character under it.
  A terminal's own selection (a shift-drag, tmux or Herdr copy-mode) copies the screen as it is, spaces included: use the
  door's own drag, which copies the text over OSC 52.
- **Heading styles:** a heading style's `heading-margin` and `heading-padding` are the same tokens as a style note's
  `heading.margin` and `heading.padding`, so an outline can set a default margin for every heading. A style's margin rows are no longer copied as blank
  lines.
- **Protocol 115:** the host lists the style notes (`styles.list`), and outline-core's component rule reads `::name{…}`.
  Run `ep0ch install --apply` on each machine (float-2 for pie, the MacBook for float-hub): it restarts the host on the
  new code; until then a door on this code refuses the old host and says to run it.

### Orient from an outline: `outline_query` sorts, projects, folds, and no read re-sends what the caller has (PIE-674)

- **New:** an agent arriving cold can orient from the outlines' recent changes in a few KB instead of a separate context
  store. `outline_query` takes `sort` (`updated desc`; the service orders, not the client), `fields` (`id,title,updated,actor,path`
  or any property key; a projected row never carries the body, and `outline_read` fetches it), `under` (a note's subtree;
  `subtreeRootId` works too) and `fold: true` (proposals, comments and deliveries collapse into their note with a count:
  `4 changes (1 proposal, 2 comments, 1 delivery)`). `updated >= -1d` on a busy outline was 25 rows and 74k to 230k
  characters, unsorted; the orient form is titles only.
- **New:** no body is sent twice. Within one response (a batch is one response) a later hit is `{id, revision, see}`.
  A proposal reads as its diff and the target's `id@revision`, not the note again; a comment as its own words and the
  span it is about (`raw: true` gives either as stored). `seen: ["id@rev", …]` on `outline_read`, `outline_query` and
  `outline_find` returns `{id, revision, unchanged: true}` for any block the caller holds at that revision, like
  If-None-Match; a block that changed since comes back whole. No wire change, no `PROTOCOL` bump.
### The query grammar can ask about relations: `#tag`, `links:`, `under:`, `title~` and `text~` (PIE-554)

- **New:** every client that queries (saved views, live figures, board lanes, `ep0ch find --query`, MCP `outline_query`)
  now takes five more atoms, combined with `AND`, `OR`, `NOT` and parentheses like `key=value`: `#tag` (also nested
  tags), `links:[[page]]` / `links:((id))` / `links:PIE-123` (the backlink index), `under:[[page]]` / `under:((id))`
  (a subtree), `title~text` and `text~text` (caseless substrings). "What points at X" and "everything under Y except
  Z" are views now, with no type-exclusion lists. A malformed atom, or a target that names no block, says which atom
  and shows a working one.
- **Protocol:** `PROTOCOL` is 118 (the grammar's shared part moved into outline-core `query-atoms.ts`). Update the
  host and every client together with `ep0ch install --apply`; there is no schema change.

### The MCP gateway reads and writes the laptop's live outline when the laptop answers; stdio writes by the same grant (PIE-661)

- **Changed:** the local stdio server (`ep0ch mcp`) is no longer always read-only. It honours the same access levels as
  the gateway, through the one shared tool path: `read` reads, `propose` offers the write tools and writes become
  proposals, `full` applies against the revision read. The actor is `mcp:<client>` from the MCP `initialize`'s client
  name (Claude Desktop's, for example), mapped by `EP0CH_MCP_PERSONAS` as the gateway's callers are. Writes go straight
  to the outline's host (through the ssh forward with `--machine`). `list_outlines` over stdio now also says whether
  the write tools are offered. A connected client keeps its tool list until it reconnects.

- **New:** for a mirrored outline (`float-hub@laptop`), the gateway first tries that machine's own host through the
  shared ssh forward, with a 2 second budget and a 45 second backoff after a failure. When it answers, reads, finds,
  queries and threads are live (`source: "live"` and the machine) and writes are applied or proposed there at once, with
  the usual revision check and `mcp:<persona>` attribution, instead of queuing as netmail. Claude.ai no longer shows a
  copy that is 40 minutes old while the laptop is awake.
- **Unchanged fallback:** when it doesn't answer, the mirror serves and writes queue exactly as before, and the answer
  says why and when it tried. A host on another `PROTOCOL` counts as away, naming `ep0ch install --apply` to run on it.
- **One identity:** the mirror's private copy kept a fresh instance id of its own, so the same outline answered with two
  (the mirror's, the laptop's). It now keeps the one the copy carries. Answers name the outline by its machine's own
  name once its host has answered live (the ssh name stays accepted, `list_outlines` gives both), and a URI under
  either reaches it; a queued write applies the same under both.
- **Live writes show up:** a write made live is remembered, so a read that falls back to the mirror shows it over the
  note as `pending` and says `staleSince` until the copy catches up.
- **Safe:** a write queued while the laptop was away applies once when it pulls (a note changed live meanwhile becomes a
  proposal); a live write says how many of the caller's queued writes to that note still wait; a live read still shows
  them as `pending`. `list_outlines` gives each mirrored outline's `route`. `EP0CH_MCP_LIVE=0` turns it off. No
  `PROTOCOL` change: restart the gateway (`ep0ch install --apply` on float-2) to get it.
### A property value holding links parses whole (PIE-663)

- **Fixed:** `[related::[[PC-967]], ((id|daytime plan step 6))]` was read as `[[PC-967`. A value now runs to the
  property's own closing `]`, with `[[page]]`, `[[page|label]]`, `((id))`, `((id|label))` and embeds balanced inside it
  (a `]` in a `((id|label))` label is fine). Brackets that don't balance on their line end the value at the first `]`,
  as before, and never reach the next line.
- **New:** a query `related=[[PC-967]]` (or `related=((id))`) finds a note whose value is a list holding that link; a
  property can be written with a link value (`properties.patch`, the door's property editor).
- **Changed:** `PROTOCOL` is 114 and the property parser is version 8: the host re-indexes every outline's properties
  the first time it opens one. **Run:** restart the host (`ep0ch install --apply`), nothing else.

### Agent tools take one `ref` argument, and wrong arguments get the right call back

- **New:** `ref` names "which block or note" on every agent surface: the Claude mod's tools (`outline_*`, `work_*`,
  `note_section`, `view_order`, `show`, `door_open`), the MCP gateway, the door's `act` (for its `id`) and `open`, the
  Pi extension's block tools and `outliner agent`. `id`, `reference`, `block`, `blockId`, `uri` and `note` are accepted
  wherever `ref` is; the old names (`item`, `view`, `reference`, `id`, `blockId`, `viewId`, `address`) still work.
- **Safer:** a call that gives two of them for different notes is refused as ambiguous, naming both values, and nothing
  runs or opens. The same note spelt two ways (`((id))` and the id) is fine.
- **Better errors:** an unknown argument is named with the closest valid one ("did you mean `ref`?"), a missing or
  mistyped one says what it needs, and every such error restates the tool's arguments and gives a call that works (the
  corrected one when the fix is exact). No `PROTOCOL` change.

### Comment on a Resource (PIE-650)

- **Fixed:** a reader showing a Resource (a file opened from a `[file::…]` link, a fetched page) refused C with "shown here
  to read". It now takes C and m: select text, press C, write. The thread is stored in the outline, anchored to the
  Resource (it is registered first when the link is followed), and quotes the file's own source, mapped back from what the
  reader drew (a heading, a link, emphasis, a list item). The file is never written. The note whose link opened the
  Resource is the thread's reference context, so the thread also lists among that note's comments.
- **New (service):** the `resource-comment` batch operation (`annotations.batch`) and `annotations.reconcile` with only a
  Resource subject: the service reads the Resource's text itself, anchors the quote, and re-anchors a rewritten file's
  threads through the resolution events (a thread whose passage went stays, as it read). `PROTOCOL` 112.
- **New (agents):** `outline_read` on a Resource (`resource:<id>` or `[file::path]`) returns its text and open threads;
  `outline_comment` takes the same ref (the Claude mod's tools, `outliner agent`, and the MCP gateway on a live outline).
  The mod holds the first Edit or Write of a file with open threads once, with them in the answer.

### A note's title stands out (PIE-657)

- **The reader's header leads with the title.** The breadcrumb is a dim eyebrow above it, the title is the one bright,
  bold line, and one dim line under it holds the author, the day, the work id, `i N properties`, the summary values (still
  links) and the comment count. One blank row, then the body. In a narrow tile the summary takes a line of its own, so no
  chip is cut off. Detail, preview, note tiles, the board's preview and a river column share it (`NoteSurface.headerBlock`).
- **The tile's frame bar no longer repeats the title** (it reads `3 note detail`); a tile too short for the header keeps it
  there. `peek`, `layout.get` and every agent read keep the title as data.
- **Double height in Kitty.** Where the terminal has text sizing (OSC 66, answered at start-up; `EP0CH_SIZED=1|0` says it
  outright) and the title fits twice over, it is drawn at scale 2. Elsewhere it is bold on one row. Herdr panes don't pass it on.
- **The focused tile's title is the theme's brightest;** the other tiles' are a clear step down, never above the theme's cap.
- **Run:** nothing. The kitchen sink has a `title` section.

### The power bar: one palette for tiles, notes, actions, what changed and extensions (PIE-656)

- **`ctrl+k` on any screen** (or `cmd+k` where your terminal sends it, or a click on `^K` at the status bar's left) opens
  one palette over the screen and your drawer: a list on the left, the lit row read on the right (a note as a reader
  draws it, a terminal's screen, an action's summary and keys), its scopes along the top.
- **Nothing typed:** the tiles open on every screen and in your drawer, indented as each screen's layout tree, with the
  note each shows; then what others changed since you looked.
- **Typed:** tiles, notes (the service's one search, as Goto ranks it), the actions you can do here with their keys,
  what changed and the screens, each under its heading. `%` `/` `>` `+` `@` (or tab) narrow it to one.
- **⏎ goes there:** a tile gets your keys (a spine opens, a screen under this one comes up), a note opens where opens
  land, an action runs. `alt+⏎` zooms a tile, or opens a note in a new detail. Mouse: a click lights a row, a double
  click goes, an alt-click is the alternate, a click on a scope picks it.
- **The desk's `/` and a river column's `g` open it in its notes scope.** The desk's own search overlay is gone; the
  search and its keys are the same.
- **Extensions add sources:** a `bar[]` in an extension's `extension.json` answers what's typed with rows that open a
  block, run one of its actions or copy text (`extensions.bar`). The outliner ships `glyphs` as the example: `~shade`.
- **Agents:** `bar.open` answers the rows and opens nothing; `bar.pick` picks as the agent, through the same paths and
  their rules. `peek` shows the bar while it's open.
- **Run:** a protocol change (113): `ep0ch install --apply` on each machine, which restarts the outline host; doors
  and the host must both be on it. The kitchen sink has a `bar` section.

### The status bar's +N new opens what changed (PIE-647)

- **`+N new` counts notes, not events.** It is the distinct notes an agent, another client or (when asked for, with a click
  on `+N ext`) an extension changed since you last looked; your own edits are never news. It used to count every change event
  since the door started and never went down.
- **Click it, or press `alt+o`, to see them.** The **what-changed list** opens as a tab in your drawer: one row per note,
  newest first, with its title, who changed it (an agent's id, `ext:…`), what (edited, created, moved, commented, property
  set) and when. `⏎` or a double click opens the note where opens land, `alt+⏎` or an alt-click in a new detail, `d` shows the
  change under the row (the note's earlier text against the new, from the revisions the service keeps), `x` marks it seen.
- **Looking clears it, and it stays cleared.** Opening the list marks what it holds seen and the count goes to 0; where you
  last looked is kept per outline, so a restart counts only what changed after it. An agent's open or read never clears it.
- **Agents:** `changes.open` (behind your tab, marking nothing), `changes.list` (the rows), `changes.go`, `changes.diff`;
  `changes.seen` is yours. Rows come from the service's change feed (`changes.since`): no second log.
- **Run:** nothing beyond the usual `ep0ch install --apply`. The kitchen sink has a `changes` section.

### MCP: write receipts, read-your-writes and outline_query (PIE-648)

- **New:** `outline_write_status(queueId)` follows a write queued for another machine's outline: queued (with that machine's
  last pull), applied (with the revision), proposed (with the proposal's URI), superseded or rejected (with why).
- **New:** `outline_read` on a mirror's block shows the caller's own still-queued edits as `pending`, laid over the mirror's
  text and marked per span. Nobody else's waiting writes are shown.
- **New:** `outline_query` runs the views' grammar (or a saved view by id) read-only over MCP, on live outlines and mirrors,
  with `limit`, `more` and `total`. A read-only copy now answers `blocks.query`, `views.read` and `query.matches`.
- **You must run:** on the gateway's machine, with the gateway stopped:
  `bun packages/door/scripts/migrations/netmail-v1-to-v2.ts ~/outline-mirrors/.netmail.sqlite --write` (the queue store
  is version 2). Then update the home machines (the laptop) so their pull reports revisions and proposals back.

### The links tile filters and sorts all three groups, and its header stays put

- **Fixed:** in the links tile (`b`), Kind, Stage and Sort now apply to Outlinks and Resources as well as Backlinks,
  by the target's kind, stage and dates (the service sends them with each link). A link with no target block
  (unregistered, missing) stays until Kind or Stage narrows, then drops out, and sorts last. The counter reads
  `N of M match · →a/b ♦c/d ←e/f` across the groups. Outlinks and Resources keep the note's order in the tree and the
  inline components; the tile sorts them.
- **Fixed:** the header's controls no longer jump: counters on line 1, Kind, Stage and Sort each in a fixed-width slot
  on line 2 (a long value is cut with …), the filter and notes below. Clicks follow.
- **Run:** protocol 111. Restart the outline host and the doors on this code (`ep0ch install --apply`). No schema change.

### A handover keeps where each reader has been (PIE-643)

- **Fixed:** `ep0ch install --apply` (and `ep0ch session upgrade`, a restart, a quit and come back) no longer empties a
  reader's back and forward. Each reader tile (reader, detail, and one in the drawer) saves its note, its back and forward
  stacks, how far down it is, the `[ ]` position, folds, expanded threads and figure choices with the layout; a zoomed tile
  comes back zoomed, and the focus was already kept. A reader that follows the current note shows the note it had.
- **Kept as before:** the river's trails (saved with its layout), the drawer's open state and its tiles, floats, programs and
  open edits.
- **Still lost:** a river column's own scroll, selection and folds; the outline tree's open rows and selection; the main
  menu's selection. Their saved history is `nav` in the tile's entry in `desk.json`, versioned: a file of another version is
  read as having none.
- **Run:** nothing beyond `ep0ch install --apply`. No protocol or schema change.

### Component discovery for agents

- **New:** agents discover components without the library screen: `ep0ch library --brief [<component>…]`, the Claude mod's and the MCP gateway's `outline_components` tool, and each component as an MCP resource (`resources/list`, `ep0ch://<outline>@<machine>/components/<id>`) for claude.ai to `@`-mention. Per component: purpose, where it goes, each property as `key: values (default) — meaning`, one example.

### Copy the whole note

- **New:** `Y` in a reader or river column with nothing selected, the tile menu's "copy note" and `act note.copy` copy the note's whole source text ("copied the note, N lines"; an agent's is returned, never your clipboard). With a selection, `Y` still copies that selection's source.

### What an agent may do to each tile (PIE-639)

- **New:** each tile has a level for agents. `free` (the default) is as before; `edit` lets an agent edit the note the tile
  shows (patch, comment, set properties) but not navigate, close, move or retarget the tile; `off` lets it read the tile
  through `peek` and do nothing else. A screen has a default and each tile its own exception ("the screen is free, except
  this one"). Set it with `^W g` (cycles), a click on the chip on the tile's frame (`✎ agents: edit only`, `⊘ agents: hands
  off`), the tile's `⋯` menu, `tile.agent policy=free|edit|off|inherit tile=…`, or `layout.policy node=screen agents=edit`
  (a row in `^W P`). Saved with the layout.
- **Reported:** `peek` (`agentLimits`, each limited tile's `agents`), `layout.get`, and `ep0ch where` (`agents may: …`), so
  an agent reads its limits before acting. A refusal names the policy and the command that frees the tile.
- **Enforced for agents only:** your own keys and clicks are never limited. An agent's `open` naming no tile skips limited
  tiles (a limited reader keeps its note); an agent can tighten a tile but never loosen one. The lock (`alt+k`) still fixes
  the shape for everyone; this limits only agents.
- **Run:** nothing; `ep0ch install --apply` and restart the door to get it. No protocol or schema change.

### Copy a block's text cleanly: a ⧉ on code blocks, quotes and callouts (PIE-638)

- **New:** every fenced code block, quote and callout in a reader (detail, preview, desk, the BBS reader) and a river column
  has a small dim `⧉` at its top right edge. A click, `y` with `[ ]` on the block (or on anything in it), ⏎ on a block, or
  `act block.copy n=…` copies its content as written: a fence's lines without the fence, a quote's lines without the `>`
  markers, a callout's body without its marker line, links and styles as typed. It goes to your clipboard (OSC 52) and the
  status line says "copied N lines". An agent's copy is returned to it and never touches your clipboard. `[ ]` now stops on
  code blocks and quotes (a callout already was one); `act blocks` lists them.
- **New:** an inline `code span` is copyable too: a click copies its contents without the backticks ("copied N chars"), it is a
  `[ ]` element so `y` copies it, and `act block.copy element=n` works. Links stay as they were; a code span isn't one.
- **Fixed:** a mouse selection in a reader or a river column copies the words, not the drawing: the bars of a quote, the frame of
  a callout or a code block, a fence's info line and fold arrows are left out. A list item keeps its marker as the note has it
  (`- `, `* `, `1. `) and its indent, not the `∙` drawn for it. Selecting part of a quote copies just those words.

### Mirrors follow a schema bump, and the gateway never sends you to `install` for one

- **Fixed:** the backup job treated a migration as no change (it moves `user_version`, not the change feed), so
  mirrors kept the old schema for good. A different schema than the newest snapshot's is a change now; snapshots carry
  a `schema=N` tag, `backup status` state keeps it, and a mirror takes a snapshot at a newer schema even at the same
  change (never an older one over a newer copy).
- **Fixed:** the remote MCP gateway migrates a copy one or more schemas behind on its own private `.serve` copy, with
  the migration scripts install runs (never the mirror), and says so in the outline's note. Where no script reaches
  the version it lists the outline `unreachable` with `on <machine>: ep0ch backup run --force`, and still shows the
  outline's access and `writes` (read from the copy's metadata), with the reason.
- **Changed:** between a Litestream follower's copy and the backup job's, the one nearer this build's schema wins, then
  the later change; a stale follower loses a tie. `ep0ch doctor` gives an erroring follower
  (`error applying updates`) its fresh-restore command.
- **Run:** on the machine behind (the laptop): `ep0ch backup run --force` once, so the mirror gets a current snapshot.
### A kept edit says what it changes, and asks for nothing (PIE-637)

- **Changed:** the notice under a note for an edit you started and didn't save no longer compares the draft with the note
  as it is now (twelve later revisions buried the draft's own changes). It compares the draft's own changes with the
  note through the text the draft started from (the draft's own copy, else the note's history, `block.revisions`), and answers in one calm sentence, in grey, never amber:
  - every change already in the note: it settles when you open the note, a copy is kept, one dim line says so;
  - lines the note lacks: `2 lines from your edit on Oct 1 aren't in the note` with `[show them]`, `[add them]` (one
    undoable patch, nothing saved until ctrl+s), `[keep as a note]` and `[let it go]`;
  - lines changed differently since: `[compare]` shows both versions;
  - no starting text: a two-way comparison, labelled, that never settles by itself.
  Edits on an older revision more than three days old fold to a `1 old edit` chip. `[take it back]` is now `[add them]`
  (`unsent.take` → `unsent.add`), `[diff]` is `[show them]` or `[compare]`, `[dismiss]` is `[let it go]`; `[keep as a
  note]` (`unsent.keep`) is new. The exit message and the lane title say it the same way (`is kept here`, `■ card kept`).
  A letting go always keeps a copy. Demo: the showcase's `kept` section. No protocol or schema change.

### A rule's text pattern can no longer hang the host (PIE-630)

- **Changed:** a rule's text pattern is read structurally and refused when it can backtrack without bound: a repeated
  group that holds a repetition, an optional atom or alternatives at any depth (`((a+))+`, `(?:a+)+`, `(a*)*`, `(a|a)*`),
  a backreference, or three repeating or optional atoms side by side that match the same characters (`a*a*a*b`,
  `a*aa*aa*b`; `a+b+c+` and `\s*(\S+)` are fine). A pattern sees the first 400 characters of a line (was 1000). A rule
  that used such a pattern is reported with its reason; nothing else changes.
- **Run:** PROTOCOL 108: `ep0ch install --apply`, then restart the doors.

### Litestream stays stopped no longer, and mirrors take newer snapshots (review fixes)

- **Fixed:** when starting Litestream again after a change to an outline's file fails, the host no longer counts as holding
  the pause for as long as it lives (replication used to stay stopped until the host restarted). The failure is kept on
  the record, retried 5 s, 15 s, a minute, five, then every fifteen minutes, said in the host's log each time, a failed
  line in `ep0ch doctor` and a backup alert with `systemctl --user start …`, until it runs.
- **Fixed:** a mirror whose snapshot has no change feed now takes a newer snapshot (the job compared the wrong time field).

### Scratch runs stay off real config and machines (PIE-634)

- **Fixed:** `scripts/agent-env` gives a run private `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` (so
  the backup commands no longer read your `~/.config/ep0ch/backup.env`), and clears `RESTIC_*`, `LITESTREAM_*` and `AWS_*`.
  `try-it.sh --copy` (and the showcase) clear `EP0CH_MACHINE` and pass `--here`, so a copy never routes to a remote outline.
  `scripts/box-test --on` or `--ref` with no value exits 2 instead of looping forever.

### Back to an earlier revision of a note (PIE-621, #277)

- **The outline keeps a note's earlier texts:** the newest 100 each note had, from the first save after this update,
  each with when it was saved and by whom. For a paste that was already saved.
- **`ep0ch revisions <note>`** lists them, `ep0ch revisions <note> <n>` prints one, `--restore` saves it as the note (a
  new revision, recorded as you, so it can be gone back on too). In the door the tile menu's `an earlier revision`
  puts it into the edit as one undo step, written on `ctrl+s`; again goes one further back.
- **Run:** PROTOCOL 107 and schema version 4: `ep0ch install --apply` on both machines. It stops the outline host,
  runs `packages/outliner/scripts/migrations/0004-block-revisions.ts` on every outline at schema 3 and starts it
  again; then restart the doors.
### Completion wherever you write (PIE-626, #278)

- **New:** `[`, `[[`, `((`, `[file::` and a callout's `> [!` complete in every place the door takes outline text, not
  just a note's edit: a comment or reply, the board's composer, a new note's float, the property panel's value (`i`,
  `⏎` on a row: the outline's own values for that key, then the schemas'), and a river column's `/` filter
  (`ty` offers the keys the outline carries, most used first; `stage:` their values). One completer, one attachment
  point: a draft session and every `LineInput` complete by default; a line that holds a name, a path or plain words
  (the search overlay, the links filter, a layout's name, the home base) opts out.
- **Agents:** `complete text=… key=heading` lists what a property's value offers; `column.complete text=…` what a
  filter's word offers. No protocol or schema change.
### The outline host keeps answering after a change and a restart (PIE-625, #276)

- **Fixed:** requests to the outline host timed out at 3 s in bursts, and for about a minute after each restart. Each
  change made every Tree re-read the tree and all its saved views, and each read parsed the whole outline again on
  the host's one loop. A working outline's write cost about 4.5 s of it. Now the outline is read once per change and
  shared, titles and tree labels are remembered by text, and each request takes its turn: the whole-outline reads go
  after note reads and writes, and the tree index is made in slices. On the bench, the slowest note read went from
  3.8 s to under 80 ms at start-up, under load, during a backup and after a restart.
- **New:** the host's log says what held its loop: `loop_stalled` and `slow_request` lines
  (`journalctl --user -u outliner-host | grep -E 'loop_stalled|slow_request'`).
- **For contributors:** `bun scripts/bench-host-stalls.ts` (in packages/outliner) is the guard: it exits 1 when a
  note read takes over 200 ms.
- **What to run:** nothing beyond the usual update (`ep0ch install --apply`). No protocol or schema change.

### Editing basics in a draft: copy, undo and redo, a paste in one step (PIE-621, #272)

- **Copy out of an edit.** A drag in a draft copies when the button comes up, as in a reader (`EP0CH_COPY_ON_SELECT=0`
  turns it off), and so does a double click's word, a triple click's line and a shift+click. `shift+arrows` select by
  keys; `cmd+c`, `alt+c` (any terminal, tmux too) or the frame's `[copy]` copy. Through OSC 52, said `copied N chars`.
- **Undo and redo everything.** `ctrl+z` takes back the newest change, typing a word at a time, a paste in one step
  however big (a paste over 20 lines or 2 KB says `pasted N lines · ctrl+z undoes`), an insert, `$EDITOR`'s text, a
  reload, an agent's patch; `ctrl+y` (or `ctrl+shift+z` under the Kitty keyboard protocol) puts it back. Undo goes back
  past a save: open the note again unchanged and `ctrl+z` carries on.
- **Run:** nothing beyond `ep0ch install --apply` and a door restart; no protocol or schema change.

### Components describe their own properties once: a library page each, and completion (PIE-618, #275)

- **New:** the component library, `ep0ch --screen library`: a design-system page for each component (heading
  styles, callouts, rules, `::graph-meter`, `::graph-spark`, and any an extension ships). An overview with the
  properties table, each value of each property drawn live with the exact source under it, the grids (pattern ×
  align, rows × row), and every combination (heading styles have 2430) behind a filter you pick per axis. Each
  variation at 40, 80 or 160 columns; `y` or a click copies its source. Every key and click is an action
  (`library.*`), so an agent drives it through `act`; the showcase's `library` section opens it.
- **New:** property completion in a draft: `[head` offers the keys with where they go and what they mean,
  `[heading-pattern::` the values, each with a one-row preview of what it draws, `[heading::` the built-in styles and
  the outline's own; the same inside a `::graph-meter` block's YAML.
- **New:** `ep0ch library` lists the components, `--json` prints their schemas (what an editor's completion or an
  agent reads), `--out <dir>` writes a Markdown page each, the variations drawn above their source; attached to a
  published note, the publisher serves one as HTML.
- **For extensions:** `extension.json` takes `components[]`, component schemas: the extension's properties get a
  library page and completion with no code. A schema it can't use fails the load and names the field.
- **What to run:** protocol is now 106 (two new reads, `components.schemas` and `rules.preview`): update the host and
  every client together (`ep0ch install --apply` on each machine). No schema change.

### What waits on you: program status in terminal tiles (OSC 7501, PIE-614, #270)

- **Programs say what they're doing.** A program in a door's terminal tile can report its status with OSC 7501 (Mitchell
  Hashimoto's Program Status Protocol): working (with progress), blocked on you (a permission, a question, a login),
  done, failed. The tile's header and tab show a calm glyph, the drawer's chip says it (`▲ claude · needs you`), and the
  status bar counts what waits (`◆1 ✓2 on you`).
- **The waiting-on-you list.** `alt+w`, or a click on that count, opens it in your drawer on any screen: every
  terminal's blocked, failed and unseen done work; `⏎` or a click goes there, `x` marks it seen. Being back in a tile
  clears its done.
- **Who reports.** Claude Code through the mod (working, a permission dialog, a question, done with its answer's first
  line, errors); `ep0ch install --apply`; `ep0ch backup run`; `scripts/box-test`; `scripts/agent-env --test`; Tree and
  Detail while they wait for the outline host. Each reports only to a terminal that speaks the protocol (`Pst` in
  terminfo, which the door gives its tiles, or the `?` query).
- **The door reports its own.** In Ghostty or Rex (any terminal answering the query) the door says what waits inside
  it: the most urgent across its tiles, each tile a child record. `EP0CH_PROGRAM_STATUS=0` turns that off.
- **`ep0ch backup run` shows what it's doing.** At a terminal, each step spins with its time and ends ✓ the way `ep0ch
  install` does (checking the outlines, which changed, "garden: snapshotting (VACUUM INTO)", "uploading to restic",
  mirrors, the drill); under the timer, the same plain lines as before.
- **Agents:** `peek` gives each terminal's `status` records; `status.list` reads the list; `host.waiting`. Marking
  something seen is the person's: an agent never clears a done they haven't seen.
- **Run:** nothing beyond the usual `ep0ch install --apply`; a Claude started before the mod changed reports once
  restarted (`alt+R` in the drawer).
### Scroll past the end (PIE-622, #269)

- **A note's last line no longer hugs the bottom edge.** In every reader (detail, preview, the desk's, a river column,
  the BBS reader) the wheel, `j`, space and PgDn go on past the last line until it sits at the middle, blank under it.
- **End (or `G`) goes to the last line, then past it.** The first press puts it on the bottom edge; the second brings it
  to the middle. `scroll to=end` does the same for an agent, and `view.get` says `atEnd` and `past`.
- **Drafts keep room round the cursor.** Typing on the last line keeps about three blank rows under it, and the wheel
  scrolls a draft past its end as a reader does.
- **`ep0ch act reader.overscroll rows=none`** stops at the last line as before; `rows=half` is the default, a number of
  rows scrolls that far. Kept for the next start, as the theme is. Shown in the kitchen sink's `scroll` section.

### A schema change is one `ep0ch install --apply` (PIE-617, #265)

- **Install migrates the outlines itself.** When the code it updates to opens a newer schema, the plan says so
  before anything moves ("schema 2 → 3: will migrate 2 outlines (pie, pie-hole) with 0003-drop-agent-tables.ts"),
  and `--apply` backs up, fast-forwards, stops the host, runs the step's script on each outline behind, starts the
  host and hands the door sessions over. No more stopping the host and running a script per outline by hand.
- **It refuses before updating** when an outline can't take the step (older than it, or its script already
  deleted) or the host can't be stopped (outside its unit): the checkout stays where it was, and the plan says the
  commands (for an old outline, moving it aside and `ep0ch outline import`).
- **When a migration fails** it stops there: the message names the outline, its exact copy from just before and
  the way back, and the host is left stopped rather than serving only some outlines. Fix it and run `ep0ch install --apply`
  again; it migrates what's left and starts the host.
- **`ep0ch doctor`** flags an outline whose schema is behind the checkout's code, with install as the fix.
- **The refusal says what to paste.** An outline at an older schema is refused with one sentence and then the
  exact commands for this machine, each on its own line: `ep0ch install --apply`, or by hand the host's stop
  command, the migration for every outline here at that version (real paths) and the start command; with no
  script for the step, the import route. The door, `ep0ch` commands and the MCP gateway pass it on as it is.
- **What to run:** nothing new. The next schema change is one `ep0ch install --apply` on each machine.

### Heading styles as you write them: one heading's own fields, and a style declared on any line (PIE-599, #266)

- **One heading, its own look.** `## Odd jobs [heading::dots] [heading-tone::amber]` takes amber for itself; any
  `heading-*` field on a heading or `---` restyles it alone (over its level's default, else the base style), and
  leaves the drawn heading. Any other property on a banded heading draws as a chip after it, whole.
- **Declare a style on any line.** `# Plot style [heading-style::plot] [heading-pattern::dots] [heading-rows::2]`,
  anywhere in any note, declares `plot` with that line's fields (a note's own properties still do). The door draws
  the line as what it declares, a chip summary and a small band; raw and the editor show the tokens.
- **Run:** PROTOCOL 105: restart the outline host and every door after `ep0ch install --apply`, on both machines.

### MCP gateway fixes from the first claude.ai run (PIE-620, #268)

- **`list_outlines` lists pie.** It reads this machine's outlines from the outlines folder instead of asking the host,
  which once left every live outline out; one the host can't open is listed as `unreachable`.
- **Links and backlinks agree.** A property naming a block's id (`[source-block::<id>]`) is now a `property` link in a
  record (`ep0ch find --json`, `ep0ch export --format json`, MCP), as backlinks already counted it, so a note's
  backlinks are never missing from its source's links. A Markdown export keeps such a property as written.
- **Refs as the Claude mod takes them.** `outline_read`, `outline_links` and the write tools take a Work ID,
  `[[page]]`, `((id))` or an id, on a live outline or a mirror.
- **Rough edges.** A `limit` of 0 (or past the maximum) is refused, naming both; `outline_links` cuts and counts
  each group; a `uri` with a conflicting `outline` is refused; searches say lexical or semantic and why
  (`semantic: true` asks); a top-level path is `(root)`; a mirror says which copy it serves (`copy`) and serves the
  newer of the follower's and the backup job's; `list_outlines` and `ep0ch mcp access` say to reconnect claude.ai's
  connector after an access change; a laptop that hasn't pulled its queued writes is said in `list_outlines` and doctor.
- **Run:** PROTOCOL 104: `ep0ch install --apply` on float-2 and the laptop, then restart the outline host, the MCP
  gateway (`ep0ch-mcp.service`) and every door.

### Write from claude.ai: remote MCP writes, and a queue for the laptop's outlines (PIE-615, #264)

- **Write tools on mcp.ep0ch.sh.** `outline_create`, `outline_patch`, `outline_comment` and `outline_set_property`,
  for an outline whose access is `propose` (a patch or property is a proposal under the note, a new block a comment on
  its parent) or `full` (applied against the revision read; a note changed since, or open in your draft, gets a
  proposal instead). `ep0ch mcp access full --ws pie` is yours to run; `read` stays read-only.
- **Said and attributed.** Each write is an agent's, `mcp:claude.ai`, with your Clerk subject; the door says it on
  the status line as it lands, and the gateway's log has a line for each.
- **Netmail for float-hub.** A write to an outline read from a mirror (float-hub@laptop) waits on float-2 in
  `~/outline-mirrors/.netmail.sqlite`, and the laptop's backup job pulls it over ssh and applies it (or
  `ep0ch mcp pull`). A note that changed meanwhile gets a proposal, never an overwrite. `ep0ch mcp queue status`,
  `ep0ch backup status`, doctor and `list_outlines` show what waits; a queue a day old while the laptop was online is
  an alert.
- **Claude mod:** `outline_set_property` (one header chip, as a patch), beside `outline_patch`.
- **Run:** PROTOCOL 103: restart the outline host, the MCP gateway (`ep0ch-mcp.service`) and every door after
  `ep0ch install --apply`, on both machines. On the laptop, install adds `EP0CH_MCP_HUB=float-2` to
  `~/.config/ep0ch/backup.env` (an empty `EP0CH_MCP_HUB=` line there turns the pull off).

### The Inbox agent and note assistance are gone (PIE-613, #259)

- **Removed:** the Inbox agent (Tree's `Shift+I` panel, its results, Pause, Undo, Reconsider and Inbox history
  search), note assistance (automatic types, tags and answers, and **Assist this note**), and edit recovery's
  **Ask agent** merge. Edit recovery itself stays: the mechanical merge, the versions, Edit draft, Save separate,
  Discard and Restore. The Inbox note, Quick Capture and where new notes go are unchanged; file what lands in
  the Inbox yourself or ask an agent to.
- **Your original writing stays.** What the agent rewrote is still kept, read only: a cleaned note's **Original
  capture** and **Before this rewrite** links still open the exact text it started from, and comments on those
  originals still work. Note assistance's originals are kept too, not yet shown anywhere (PIE-345).
- **Gone with them:** `OUTLINER_INBOX_AGENT`, `OUTLINER_NOTE_ASSISTANCE` and `OUTLINER_INBOX_TIMEOUT_MS`, the
  `inbox.*`, `edit-recovery.assist` and `edit-recovery.cancel` actions, the `inbox` event, the prompt files
  `inbox-editor.md`, `inbox-relationships.json`, `inbox-routing.json`, `note-assistance.json`, `note-answer.md`
  and `edit-merge.md` (`goto-ranking.json` stays; old copies in an outline's `prompts/` are left alone and unused),
  and the outline folder's `assistant-sessions/`, no longer written.
- **What to run:** protocol is now 102 and the schema version 3, so the host and every client move together, and
  the new host refuses an outline still at version 2 until it is migrated. On each machine, from its checkout:

  ```sh
  # float-2: pie and pie-hole
  cd ~/projects/ep0ch && ep0ch install --apply        # backs up the outlines and moves the code
  systemctl --user stop outliner-host.service
  for o in pie pie-hole; do bun packages/outliner/scripts/migrations/0003-drop-agent-tables.ts ~/outlines/$o.sqlite; done
  systemctl --user start outliner-host.service

  # the MacBook: float-hub, sysops-log, bbs, boops, float-bbs-test, techno-breakout
  cd ~/projects/ep0ch && ep0ch install --apply
  launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host
  for o in float-hub sysops-log bbs boops float-bbs-test techno-breakout; do
    bun packages/outliner/scripts/migrations/0003-drop-agent-tables.ts ~/outlines/$o.sqlite
  done
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.ep0ch.outliner-host.plist
  ```

  In one transaction it drops the four agent state tables (`inbox_agent_settings`, `inbox_agent_instructions`,
  `inbox_retry_triggers`, `note_assistance_state`), keeps `inbox_agent_results` and `note_assistance_results` as
  they are, and stamps version 3, or changes nothing and says why. It refuses a file a host is serving. The
  `OUTLINER_INBOX_AGENT=0` and `OUTLINER_NOTE_ASSISTANCE=0` lines in the host's unit are now unused and harmless.

### Rules: when a block matches, draw this or run this (PIE-600, #251)

- **A rule note, no code.** Write a note like `Committee headings [rule-name::committee-bands] [rule-kind::heading:2]
  [rule-decorate::band] [rule-pattern::stack]` and every `##` heading (under `rule-under::((id))`, if you scope it)
  is drawn as a band of glyph tracks in its place, still a heading you fold and `( )` to. Match by a query
  (`[rule-match::type=meeting]`), a text pattern (`[rule-text::…]`, never in code) or a kind (heading, callout,
  list, rule, image); draw a band, a divider, a card of the block's properties, a badge, words, or a box around it.
- **Rules in extensions.** `rules[]` in `extension.json`: `match`, then `decorate` (the extension draws the view)
  and `on` (run an action when a block starts or stops matching, or changes while it matches; a quiet wait, no
  loops on an extension's own writes). Three examples to fork: `outliner ext add meeting-card` (a card over every
  meeting), `done-stamp` (`[done-at::]` when status becomes done) and `shout` (a line ending `!!!` as a band).
- **Your text never changes.** `R` in a reader shows the note as written, and back. Detail shows each decoration as
  text under what it matched; the publisher puts it in the page (a band is its heading).
- **Agents:** `peek` lists a reader's `decorations`; `extensions.list` lists every rule, what it matches, how many
  blocks match a trigger and its last run.
- **Run:** PROTOCOL 101: restart the outline host and update every door (`ep0ch install --apply`).

### Litestream and an outline's file (PIE-607, #254)

- **Deleting, re-creating or importing an outline pauses Litestream for it.** Litestream doesn't track a database
  being removed or replaced, so the outline host now stops this machine's replicator for that folder while the
  file changes, keeps Litestream's own state, and starts it again; if it can't stop it, the change is refused with the
  commands to do it by hand. Nothing resets Litestream behind your back.
- **Doctor reads the mirror followers by their instances** (`litestream-mirror@float-hub`), says when a follower
  doesn't restore fresh on start (Litestream 0.5.17's crash loop, upstream #1385) or when the replicator keeps only a
  day of snapshots, and treats a follower that healed itself by restarting as healed.
- **A machine with no backups yet** (the laptop, before its install) is said in doctor, not raised as an alert.
- **Install asks for the machine's name** (`EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply`) instead of taking the
  host name: other machines mirror it by that name. A laptop already set up under its host name: set
  `EP0CH_BACKUP_MACHINE=laptop` in its `~/.config/ep0ch/backup.env`, then `ep0ch backup run`.
- **A dead-man's ping:** with a secrets group `heartbeat` (HEARTBEAT_URL, e.g. a healthchecks.io check), every
  clean backup run pings it, so a job that stops is noticed off the machine too.

### Heading styles and rules that fade (PIE-599, #248)

- **Headings that divide the page.** `## Your calls [heading::band]` draws the heading inside a band made of the
  figures' glyphs. Built-ins: `band` (centred, spaced capitals), `tab` (left, on the top row), `waffle`, `uptime`,
  `dots` and `rule`.
- **Rules that fade.** `--- [rule::fade]` draws a full-width track that fades in from both edges.
- **Still Markdown.** The line is a plain heading or rule to everything else: folds, `( )` stops, sections and
  `^anchors`, Detail, the publisher and export. Under 48 columns (the figures' width rule) the door draws it as written.
- **Your outline's own styles,** declared the way callout types are: a note with `[heading-style::plot]` and
  `[heading-pattern::dots]`, `-rows`, `-align`, `-row`, `-padding`, `-margin`, `-tone`, `-letters`.
  `[heading-default::1]` (or `rule`) styles every `#` (or every `---`) with no property. A change to the note
  restyles every heading that uses it, with no door change.
- **Calm by design.** The band is dim and never a full block. The heading carries the colour, in every theme.
- **The kitchen sink's `headings` section** shows every built-in on one note, banded in a wide reader and as
  written in a narrow one beside it.
- **Run:** PROTOCOL is now 100 (a new read, `headings.styles`). Every client and the outline host must be on this
  code together, so run `ep0ch install --apply` on each machine (it restarts the host).
### Backups you can stop thinking about (PIE-607, #252)

- **Every 15 minutes, each outline that changed goes to restic.** `ep0ch install --apply` sets up the job on Linux
  (a systemd timer) and macOS (a launchd agent): a consistent, integrity-checked copy of each outline whose change
  feed moved, into this machine's restic repository in the `ep0ch` bucket (`restic/<machine>`). An unchanged outline
  isn't snapshotted, and every run stands alone, so a VPN that drops Hetzner for hours or an offline night leaves
  nothing to repair. Kept: every snapshot of the last 48 hours, and the newest of each of the last 72 hours, 30 days and 12 weeks that have one.
- **Mirrors from the newest snapshot.** float-2's read-only copies of the laptop's outlines (what the MCP gateway
  serves) are refreshed from the laptop's newest snapshot by an atomic rename, and straight from the laptop with
  `sqlite3_rsync` when it answers; the newer copy wins.
- **A stale backup is on your status bar.** Changes waiting more than 2 hours for a backup show `✗ backup` on the
  door's status bar until they clear; a click says which outline, since when and the exact command that fixes it.
  It's announced once in Herdr (and on your phone, with a secrets group `ntfy`), and `ep0ch doctor` lists every
  outline's newest snapshot.
- **`ep0ch backup restore <outline> [--machine laptop] [--at 3h] --to <path>`** writes an integrity-checked copy of
  any snapshot; `ep0ch backup list` and `status` show what there is. A restore drill runs every month by itself.
- **What to run:** on the laptop, `EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply` (its plan names restic and the
  `restic` secrets group if they're missing). Litestream stays for float-2's own outlines; the laptop's Litestream
  and float-2's followers retire after three clean days (scripts/backup/README.md has the commands).

### New notes float, as many as you like (PIE-591, #240)

- **`ctrl+n` never takes over the note you're in.** On the desk (and every screen built on it) a new note floats
  over the screen with your keys, a draft of its own. Press it again for another, and again: each is cascaded a
  little lower and to the right, nothing waits on the last, and none is ever refused for "a reader didn't take it".
- **From an edit too.** `ctrl+n` while you write saves what you typed (as a click away does) and floats the next.
- **Move it, dock it, close it.** Drag a float by its title; onto a tile's header it joins that tile's tabs, onto
  the screen's edge it becomes a column, onto a dock's handle it goes into the dock. Its `×` closes it: written,
  it's saved; still empty, it goes to the trash (as `Esc` on it does).
- **Never lost.** A float you leave with nothing typed stays open and empty where it is; one you typed in is saved
  as you leave it. Quitting keeps an open draft as unsent, as any draft.
- **Your way.** `ep0ch act note.opens opens=tab` (a tab on the tile you're in), `drawer` (your drawer) or `lands`
  (where the screen's opens land, as before); `float` is the default. `EP0CH_NEW_NOTE` overrides it for one door.
- **The board's lanes make cards.** `ctrl+n` on a lane opens the new-card composer in that lane (`card.new`, as `n`
  does), so the card is born with the lane's properties and lands in it. A screen spec says this with `newNote`.
- **Agents:** `note.new opens=float` (or `tab`) shows an agent's new note to you there, unfocused and attributed.

### Also merged, by theme (#239 to #280)

**Door**

- **Hero header (PIE-598, PIE-609, #242, #244, #253).** A note's hero image that scrolls under a reader's sticky header
  becomes the header's backdrop: muted, held dark, fading in over three steps (Kitty graphics, or one colour per cell).
  `reader.hero [on=…] [mode=first|follow]`: `follow` takes the last picture of the note that has gone under, the old one
  staying until the new is drawn so the header is never plain. `[hero-focus::x,y]` sets the crop. A picture on the line
  right under a title is drawn now, not read as metadata. River columns keep the sticky header. PROTOCOL 99.
- **`ctrl+e` in a draft is the end of the line (#241).** `ctrl+a` the start (a Mac's `cmd+←/→` send these). `$EDITOR`
  moved to `ctrl+x ctrl+e` (`edit.external`, `composer.external`, and the tile menu's "edit in $EDITOR"); a person's,
  never an agent's. In a reader `ctrl+e` still arms an edit.
- **Resizing tiles is smooth, and a program hears its size once (PIE-623, #271, #273, #274).** Nothing is scaled or
  uploaded during a drag, and a terminal tile's program is told its new size when the resize ends, not on every frame:
  Claude Code no longer wraps its output mid-word after a resize. `bun run bench:resize` (packages/door) is the guard
  (`--check`).
- **`ep0ch --screen <name>` always lands (#279).** Attaching to a running session says `opened <name> · attached to the
  running session` (or `already on <name>`); `ep0ch --showcase --screen <name>` opens that screen on the showcase outline;
  an unknown name is refused before anything starts, with the names and a command that works. The component library is on
  the main menu (`I`).
- **A change reaching a desk never entered no longer crashes the door (#262),** seen as `desk.ctx.board` undefined with
  the showcase open.

**Claude mod**

- **Mentions are only what resolves (PIE-603, #243).** A `((id))`, `[[page]]` or Work ID the outline can't resolve (chat
  identifiers like `S-87`) isn't kept; `gone` only for a block deleted since. `/mentions preview` and `scope` no longer
  open or move the panel; only `m`, `/mentions band|pane|off` do.
- **Files a session touches become `[file::]` blocks (PIE-602, #250).** After a successful `Edit` or `Write`, a block under
  `[[recent-files]]` › day › project › session (one per file per session, with touches and lines added and removed);
  a view per project under *By project*. The Edit and Write rows open the file, or its diff, in the door.
- **A Claude in a door follows its door through a handover or restart (PIE-604, #249).** Tiles get `EP0CH_PLACE`, the
  outline's session folder; `ep0ch act|peek|open|snap|where` and the mod's door tools find the door from it. `ep0ch where`
  says when the environment is stale and which door answers now.

**Install and ops**

- **`ep0ch install --apply` restarts the MCP gateway on new code (PIE-612, #255),** and `ep0ch doctor` flags one that
  runs older code than the checkout. It never restarts a gateway that runs another checkout.
- **A host that is up but slow to answer is restarted, not "started" and waited on (#256).** The probe asks three times
  before calling the host down.

**Tooling for agents and tests**

- **`scripts/agent-env <name> [--test] -- cmd` and `scripts/box-test` (PIE-597, #246, #247, #260, #280).** A scratch
  environment of your own (state, control socket, outlines, temp folder outside `$HOME`), and with `--test` a systemd
  scope with a CPU and memory cap. Every run has `oom_score_adj` 1000, so the kernel kills a test before the outline host.
  `scripts/box-test [--on float-box|boxd]` runs the suites off this machine (float-box when it answers, else a boxd box).
- **Tests run on a fresh machine (PIE-596, #245).** The door keeps the nine art pieces its menus draw in
  `test/fixtures/packs`; no packs is fine. `ep0ch doctor` shows an `art packs` line.
- **Tests named from the repository's root run the packages' preloads (#258).** A root `bunfig.toml` preloads
  `scripts/test-preload.ts`; before, a door test run from the root kept your `EP0CH_*` settings and real state folder.
- **Scratch dirs go where a session's sockets fit and no `.ep0ch` is above them (#267),** and an App a test file leaves
  running is retired when the next file runs (#261, PIE-595).
- **Follow-ups from review (#257, #263):** a click between `ctrl+x` and `ctrl+e` cancels the chord; `where` marks a door
  handed over only when it was reached through the outline's session; the agent-interface test passes under `agent-env`.

### Figures that compare, and figures that fit (PIE-575 to PIE-581)

- **Four kinds for comparisons.** `::graph-quadrant` places notes by two properties (`x:`, `y:`; `xs:`, `ys:` order
  the axes, `quadrants:` names the corners); `::graph-matrix` counts over two (`down:`, `across:`), toned by share
  with totals; `::graph-compare` aligns two or three columns by row label (`- cost: £60 | £12`); `::graph-flow` shows
  where things came from and went (`- a → b: 7`, or `from:` and `to:`). Each takes Markdown rows or a live
  `query:`/`view:`. The kitchen sink's figures note has one of each.
- **A meter with a limit.** `limit:` and `unit:` on `::graph-meter` draw each value against a budget, the limit as a
  mark, the headroom or overrun said beneath (`- with the barrel: 181` against `limit: 150` reads "31 ms over").
- **Every figure fits its width.** One rule (narrow under 48 columns, cozy under 90, wide): a narrow table keeps its
  title column and one more and says `+n columns`; stat tiles wrap into rows; a timeline's or decision's side note
  goes under its row; `compare` stacks; `matrix` cuts its heads; `quadrant` draws dots with a legend. Nothing a
  figure draws is wider than its frame at any width.
- **A figure can be linked to.** An anchor alone on the line after a figure's closing `::` names it:
  `((id^quadrant|the quadrant))` lands on the figure, and `!((id^quadrant))` embeds just that block.

Since October 2, 2026: pull requests #136 to #197, the outliner's #280 to #282 (in pi-herdr-outliner), and the
move into one repository (PIE-530).

### Update: what to run

- **One checkout.** ep0ch-door and pi-herdr-outliner are now one repository, `ep0ch`
  (`git@github.com:float-ritual-stack/ep0ch.git`). Clone it, run `bun install` at its root, and link `ep0ch` to
  `packages/door/src/main.ts`. Point Herdr's plugin at the same checkout: `herdr plugin link packages/outliner
  --enabled`.
- **Then `ep0ch doctor`, then `ep0ch install --apply`.** Doctor says what is behind and the command for each. The
  install backs up every `~/outlines/*.sqlite` to `~/backups/ep0ch/<time>/`, fast-forwards the checkout, links
  `ep0ch` and restarts the outline host. A host unit from before PIE-530 (another checkout's `host-main.ts`,
  `OUTLINER_STATE_DIR`, `OUTLINER_DEFAULT_OUTLINE`) is shown the exact change to make; the install never edits it.
- **Outlines live in `~/outlines`.** Each is `<name>.sqlite` (`EP0CH_OUTLINES` moves the folder). To bring an older
  database over, make a new outline from it: `ep0ch outline import <old.sqlite> <name>` (or `outliner import`). The
  old file is only read.
- **A database made before schema versions** is refused at open, with the command that stamps it. Back it up, stop
  the host, then run `bun packages/outliner/scripts/migrations/0001-stamp.ts ~/outlines/<name>.sqlite` once. It
  stamps only a database whose shape matches a fresh one.
- **Restart the host, then the doors.** The host and every client speak the protocol this checkout speaks
  (PIE-538 added `callouts.types`, PIE-544 `notes.create` and the page-title rule; `delete` takes
  `expectedRevision` and `ifEmpty`; a sort may name a property; a view's hand-set order takes `first` and records
  who placed it; a component block is one token in a note's sections, and its code fence closes only on its own
  fence; addressable-resource MCP reads use the persisted per-outline local MCP access setting). `ep0ch doctor`
  prints that protocol and the one the running host speaks. A client refuses a host on any other number, saying
  which side to update. `ep0ch install --apply` restarts the host. Restart doors and Claude sessions that should
  run the new code.
- **Delete `~/.config/pi-herdr-outliner/document-renderers.json`** if you have one. Nothing reads it now.
- **Your shell's dock settings (float-2's `~/.bashrc`).** Delete `EP0CH_HERDR_AGENT_CMD` (nothing reads it) and
  `EP0CH_DAILY_AGENT` (it overrides the dock's choice in every door), and choose in the dock instead (`alt+g`, "claude
  · in Herdr"). Drop `EP0CH_DAILY_CWD` to let each outline's dock start in its project or outline folder.
  `~/.local/bin/door-claude` isn't used any more. An old `door-claude` Herdr pane stays until you close it.
- **The dock's program and folder.** With `EP0CH_DAILY_AGENT` unset the dock now runs a shell. If you set
  `EP0CH_DAILY_CWD` to pin its Claude to a folder, drop it to let the dock follow the outline (the project's `.ep0ch`
  folder, else the outline's own); `ep0ch doctor` shows the result. An existing Herdr `door-claude` pane keeps the
  folder it was made in until it's made again (`/exit` in it, then `alt+a`).
- **Agent skills.** `ep0ch doctor` checks the links in `~/.claude/skills/` (and `~/.agents/skills/` when it exists)
  for the stack's skills, and `ep0ch install --apply` makes them, or replaces a link into an old `ep0ch-door`
  checkout or a deleted worktree. It never touches a real folder or another skill's link. If you ran an earlier
  install that linked television's channels, rename `ext-links.json` to `install-links.json` in the door's state
  folder (`$XDG_STATE_HOME/ep0ch-door`, or `EP0CH_STATE`).
- **Television (optional).** With `tv` on your PATH, `ep0ch install --apply` links the outline's channels into
  television's cable folder.
- **Welcome numbers become an order** (once per outline with numbered welcome notes; pie and float-hub):
  `bun packages/door/scripts/welcome-order.ts --ws <outline>` prints the order it would set; `--apply` makes the
  Welcome view if there's none, sets its order from the numbers and rewrites the values to `true`.
- **Layouts you saved by name** (`^W w`, kept in the door's `layouts.json`) are screen notes in the outline now, and
  the door no longer reads `layouts.json`. Bring them across once per outline that should have them:
  `bun packages/door/scripts/import-layouts.ts --ws <outline>` says what it would write, `--apply` writes it; then
  delete `layouts.json` (its path is printed).
- **The dock is now your drawer, and a screen's drawer is now a dock** (once per machine, doors stopped first: end
  sessions with `ep0ch session end --all --yes`). `bun packages/door/scripts/migrations/drawer-words.ts --ws <outline>`
  says what it would change; `--write` changes it: `dock.json`, `dock-tiles.json` and `dock-agent.json` in the state
  dir become `drawer.json`, `drawer-tiles.json` and `drawer-agent.json`, saved layouts (and, with `--ws`, that
  outline's screen notes, through its host) say `dock` where they said `drawer`, and the drawer's own tile is
  `drawer.agent`. The door keeps no reader for the old words; the
  script is deleted once it has run on the machines that matter (pie on float-2, float-hub on the MacBook).

### `e` asks before it edits; the tile with your keys stands out (#239)

- **`e` arms an edit instead of opening it.** In a reader (the desk's, the board's preview, a river column, the BBS
  reader) the status bar asks `edit <title>? ⏎ · any other key cancels` and the tile turns yellow (`✎ edit?`) for
  2 seconds. `⏎` or `e` again opens it; any other key lets it go and does what it does. `Ctrl+E` arms the same way.
  The tile menu's edit row, a click on the hint's `e` and an agent's `edit` open at once.
- **Turn it off:** `ep0ch act edit.arm.set on=false` (kept for the next start; `on=true ms=<n>` sets the wait).
  `EP0CH_EDIT_ARM` (`off`, or milliseconds) overrides it.
- **Focus and edges.** The tile with your keys has a double frame (`╔═╗`) and title in a warm amber. Every other
  frame is a mid-tone that shows where one tile ends and the next begins in calm, classic and night, never dimmed
  toward black. A terminal tile you're typing in stays yellow.

### Your drawer, and docks: the words swapped

What travels with you across screens (the status bar's `▲ claude` chip, `alt+a`, the agent in its first tab) is
**your drawer**; a screen's sliding edge container (the board's outline and backlinks) is a **dock**, and putting a tile
in one is docking it to an edge. The actions follow the words, with no old names kept:

- `host.dock` is `tile.drawer`: `on=true` puts a tile in your drawer, `on=false` takes it out. `^W a` still does it
  ("put in your drawer", "take out").
- `tile.pin` is `tile.dock`, the right way round now: `on=true` docks the tile to an edge, `on=false` undocks it
  back into the layout. Its answer says `docked`. `^W p`, the board's `T` and `B` are unchanged; a header's
  `⇤ docked` label undocks on a click.
- `tile.drawer` (slide a screen's drawer open or shut) is `tile.slide`. `^W d` is unchanged.
- `ep0ch where --json` says `tile.drawer`, and the drawer's own tile is `drawer.agent` (`EP0CH_TILE_ID`, the
  `EP0CH_NEST` layer `drawer/drawer.agent`).

And what changed with them:

- **Leaving a screen with a terminal running** puts the terminal in your drawer instead of refusing: `shell went into
  your drawer · alt+a shows it`. An unsaved edit still asks.
- **The drawer's own first tab can leave.** `^W a` on it, or a drag out, puts it on the screen as an ordinary terminal
  tile, still running; the drawer starts a fresh own program the next time you pull it up.
- **Drags say where a tile goes:** over the chip or the open drawer, `into your drawer: travels with you`; over a
  dock's handle, `docked here: stays on this screen`.
- **`^W P`** (the policy panel) works in your drawer.
- **A preview keeps following** the tile it follows (`source=tile:tree`) when that tile goes into your drawer and back.
- **Refusals say what and why in plain words,** with what to do instead, and no internal names.

### Welcome: `[welcome::true]` marks a note, the order is set by hand

Any `[welcome::…]` value now only marks a welcome note; a number is no longer its place. The order is the Welcome
view's hand-set order (a saved view `[query::welcome]`, the same order a board lane keeps): `alt+↑` `alt+↓` or a drag in
Welcome's list, `ep0ch view order`, or a lane on that view. The first move makes the view. Two notes can no longer share
a place, so nothing shifts silently.

### Make your own screens: start blank, save it to the outline (PIE-565)

`M` on the main menu (or `ep0ch --screen blank`) opens a blank screen: one tile whose rows start it with the outline, a
reader, a detail, a terminal or a query lane (you pick the view), or open a screen. Build the rest with the desk's keys,
then `^W w` saves it as a **screen note** in the outline (`[type::screen]`, its layout as data). Every door on the
outline opens it by name (`ep0ch --screen <name>`, the blank tile's `o`, `^W r`), saving again writes over the same note
with a revision check, and `screen.delete` or trashing the note takes it away. Leaving a screen you built without saving
asks first. Agents do the same with `blank.fill`, `screen.save`, `screen.open` and `screen.delete`.

Found by building a screen from blank: an empty tile now says what it's for ("links you follow in detail land here",
or how to send opens there); `^W v` on a tile whose opens already land somewhere says so and how to unlink it, instead of
seeming to do nothing; the outline's `⏎` with no reader to show the note says so; `^W o q` with no view open picks one;
a detail whose note isn't in the outline, and a preview whose tile is gone, say so; the `⋯` menu saves and loads screens.

### Read an outline from claude.ai: the remote MCP gateway

`ep0ch mcp serve --http` serves `ep0ch mcp`'s read-only tools (`outline_read`, `outline_find`, `outline_links`) and
`ep0ch://` resources over streamable HTTP, for claude.ai and other remote MCP clients. Clerk signs you in (GitHub);
the gateway accepts only a Clerk JWT access token for its own URL whose subject you've listed in
`EP0CH_MCP_ALLOWED_SUBJECTS` (unset, it refuses everyone and logs who asked). It reads the outlines on its own
machine, each only when `ep0ch mcp access read --ws <name>` has granted it, and refuses another machine's. The tools
take an `outline` name now, for a ref or a search; a URI names its own. The door README's "Remote MCP gateway" has
the unit, the Caddy block and the Clerk settings. `ep0ch mcp access` now says the grant covers both servers, and
`initialize` answers a client's own MCP protocol version when it is one the server speaks (else the newest).

### Unsent drafts: fewer, and easier to decide about

An edit opened by mistake no longer leaves an `■ unsent` line. `e`, then a `j` or `q` meant for the reader, became
text; now an edit open under ten seconds with at most three characters typed into it (nothing taken out) closes on
the first `Esc`, says `dropped 2 stray characters · ctrl+z brings them back`, and `ctrl+z` within a minute opens it
again with them. Its copy still goes to `drafts/`. A real edit keeps the `Esc` twice.

Each `■ unsent` line has controls (a click, `[ ]` then `⏎`, the tile's `⋯` menu, `act unsent.*`): `[diff]` shows the
note as it is now against the unsent edit in a reader beside it, coloured, with the revision it was written on;
`[open copy]` shows it as written; `[dismiss]` lets it go (the copy stays on disk); `[take it back]` opens the edit
with the unsent changes in it, replayed change by change against the note now, so a passage that changed since is
left as it is and said. An old one on an older revision (over three days) folds into `■ 1 old unsent edit · [show]`.
An edit put aside before this change can be diffed, copied and dismissed; taking one back that was written on an
older revision needs the text it started from, which only newer ones keep.

### Esc closes what popped up, and never leaves the screen

`Esc` closes the innermost temporary thing, one per press: a picker or the tile menu, the keys box
(`? more`), a `^W` chord, link mode (`alt+l`), a filter, a drawer or the dock, a zoom, a float's keys (back to the tile
under it), an edit with nothing typed (unsaved text still asks for a second `Esc`), a selection. With nothing left it
does nothing and says `nothing to close · q leaves`. It never goes back to the menu, and never quits a door whose only
screen it was (the home base, `--screen`). Leaving a screen is `q` on every one; quitting is `G` or `ctrl+c`, as
before. `Esc` on the board's picker with no board shown yet leaves an empty board (`g` picks one, `q` leaves). The
showcase's `esc` section opens three nested things to close.

### A menu on every tile (PIE-492)

Every tile has a `⋯` in its top right corner, left of its `×`: a click opens the tile's menu, and so does a
right-click anywhere in the tile, or `^W .`. It lists what you can do there, grouped: the tile itself (close, zoom,
float, put in a drawer, fold to a spine, dock, preview beside or below), then what its kind adds (a note's edit,
comment, links, properties, back and forward; a terminal's type in it or run it again; a board lane's steps,
collapse, reload). Each row shows its key as a keycap; one click, `⏎` or that key runs it. A row that can't run
now is dimmed and says why. A terminal whose program asked for the mouse keeps its right-clicks: use its `⋯`.
Agents get the same rows from `act tile.menu tile=<tile>`, without anything drawn on your screen.

### Close a tile with a click

Every tile that can close has a `×` in its top right corner: a click closes it (`tile.close`, as `^W x`) without
moving your keys there first. A tile with a running program asks twice, as `^W x` does.

### Fixed: ctrl+n replaced the note you were reading

A new note made with `ctrl+n` in a detail opens in a detail beside it (as `O` opens one), on the board in a new
detail in its reading row, and in a river in a new column: the note you were reading stays. An empty detail
(`^W o d`) offers `+ New note · ctrl+n`, and a new note made there is written in it.

### `--screen <name> [<target>]` opens any screen; the old landing flags are gone

- **One landing flag.** `ep0ch --screen <name> [<target>]` opens the door on any screen by name: a menu item (board,
  desk, river, brief, welcome, waiting, who…), or any registered screen (`ep0ch act screen.list` names them), on its
  target where it takes one: `--screen board <hub-id>`, `--screen detail <id | ((ref)) | ep0ch://…>`. It goes through
  `screen.open`, the action a menu letter and an agent's `act` run, and a session you attach to with it opens it too.
  A screen registered later is a valid name with no code change.
- **Removed:** `--board [<hub>]`, `--desk`, `--river`, `--brief` and `--welcome`. Each is refused with its
  replacement (`ep0ch --board hub-1` says `ep0ch --screen board hub-1`). Update any alias or script that used them.
- **`EP0CH_LANDING`** takes any screen name now (`brief` and `welcome` as before), opened after the logon through
  the same action.
- An unknown name is refused before the door starts, with the names there are.

### Fixed: addressable resources, after review (#201–#206, #211, #212)

- **An outline's instance id changes exactly when its database is replaced.** It is the `outline_instance_id` in
  the database, so a reboot or a new inode no longer change it. A backup restored over the file (a `cp`, sqlite's
  `.restore`, a Litestream restore), a copy opened at another path, or an open after a crash gets a new one: each
  open leaves `<name>.sqlite.instance.json` beside the outline, and a database the last clean close didn't describe
  gets a fresh id. Each outline gets a new id once, at its first open on this version; caches keyed on the old one
  are dropped.
- **`ep0ch --screen detail <uri>`** keeps a host named by `EP0CH_SOCKET` and never makes an outline: one nobody has
  is refused with the commands.
- **`ep0ch mcp`** refuses another outline's URI given as `ref` (it read the block of the same id in its own outline).
- **An imported outline starts with MCP access `none`**: the old outline's grant isn't carried.
- **`ep0ch open`** takes `((id|label))` and `((id^anchor))`, and a URI's `#anchor`: the reader scrolls to it.
- **`ep0ch find --tree --lines`**: the URI is the last column again (`id title path depth glyphs about uri`).
- A version 2 database missing its instance id is refused with the exact command that repairs it
  (`bun packages/outliner/scripts/migrations/0002-outline-instance-id.ts <database>`).

### Fixed: addressable-resource MCP reads require an outline MCP grant

`ep0ch mcp` now refuses `outline_read`, `outline_find`, `outline_links` and
`resources/read` unless the bound outline has an explicit persisted local MCP
grant. Configure it with `ep0ch mcp access read --ws <outline>`; `none` revokes
it. The setting is service-owned, per outline and independent of `[publish::…]`:
published blocks do not bypass `none`, and a granted local reader can read
private outline content. The server remains read-only even if the stored level
is `propose` or `full`. `resources/read` returns the required envelope:
canonical URI, outline instance id, revision, reachability and block record,
beside the Markdown content. `ep0ch open <ep0ch://…> --json` reports the
receiving door session and any attached generic client host pane.

### Fixed: published pages read as HTML linked to raw Markdown

On a page read as HTML (`?view=html`), a link to another published note now opens that note's HTML too, as the
index does. Published text leaves out line anchors (`^see`) outside code. The pages are dark only, and a ticked
step shows ticked on a phone (a disabled checkbox in iOS's dark mode hid its tick).

### Fixed: a door session with no terminal attached used CPU drawing frames nobody saw

A terminal tile whose program keeps writing (a Claude session, a log tail) made the session draw a whole frame for each
write, up to 60 a second, with nobody attached: about 30% of a core on float-2. A session nobody watches now draws
nothing until a terminal attaches or `peek`, `snap` or an `act` reads the screen. Run `ep0ch session upgrade` to hand
a running session to the new code.

### Fixed: two outlines whose names read alike shared one Herdr agent pane

A session's Herdr pane label was its outline's name lowered and dashed, so `Kitchen Remodel` and `kitchen-remodel`
(or `Front_End` and `Front.End`) got the same pane: one session could attach to, type into or close the other's
agent. The label now ends in a short hash of the exact `outline@machine` (`door-kitchen-remodel-1a2b3c4d`), and
the launcher writes down the pane's Herdr id when it finds or makes it, then attaches, types and closes by that id.
An agent pane from before keeps its old label: the next start makes a new one, and the old pane can be closed in
Herdr by hand.

### Fixed: images held more memory than their budget after a resize

While a resized image's new scale was being made, the one drawn meanwhile wasn't counted as just drawn, and the
in-memory image cache stopped evicting at it: it could stay over its 96 MB. Every draw now counts, and an image on
screen is passed over rather than ending the eviction.

### Fixed: refusals arrived in escape codes when another program read them

Claude Code's shells set `FORCE_COLOR`, and Bun then paints every `console.error` red, even into a pipe. So
the Claude mod's cards and tools, and `door-open`, got `ep0ch` and `outliner` refusals (and crashes) wrapped in
colour codes, and their `ep0ch: ` or `error: ` went unrecognised. `ep0ch`, `outliner` and the Herdr opener now
write plain text to a stderr that isn't a terminal, a long refusal arrives whole, and a terminal keeps its colour. The root `bun run test` also runs the Claude mod's
own tests (`claude plugin test`, so `claude` must be on PATH), and a door test runs the real `ep0ch help`,
`where --json`, `show --cells`, `export`, `peek` and `act` through the mod's readers, so a CLI change that breaks
the mod fails at the root.

### No outline made silently on another machine; a typo'd command says so (PIE-545, PIE-547)

- **A name nobody has yet is made only on this machine.** `ep0ch --machine float-2 --ws fern` used to make an empty
  `fern` there. Now, on another machine (`--machine`, `EP0CH_MACHINE`, a `.ep0ch`'s `machine`, `--remote`), the home
  base offers the choices: open the one on this machine (when there is one), `+ create fern on float-2`, or cancel.
  The cursor starts on cancel or the local one, so ⏎ alone never makes anything. Without a terminal it's a refusal
  with the commands: `ep0ch --here --ws fern`, `ep0ch --machine float-2 --ws fern --create`,
  `ep0ch outline list --all`. Tree and Detail's opener and `outliner init` follow the same rule.
- **`--create`** (on the door, `outline attach` and `init`) makes it there on purpose, as do `ep0ch outline create`
  and the home base's "new outline on <machine>". **`--here`** means this machine over `EP0CH_MACHINE` and a
  `.ep0ch`'s machine. A local `--ws <new name>` still makes the outline, as before.
- **A typo'd command says so**, and no longer opens the door: `ep0ch sessionss` exits 2 with
  `ep0ch: no command "sessionss" · did you mean: ep0ch session`. An unknown door flag suggests the closest one.
  `--help`, `-h` and `help` work in any position and show that command's usage.
- **`ep0ch outline delete`** also removes the outline's owner lock file, and refuses while another process holds
  it.
- A `work_create` title that starts with `--` is no longer refused as an ambiguous option.

### The Claude mod says which outline it's bound to (PIE-546)

- **A card** above the prompt, at the start and after `/clear`: the outline and its machine, why (the `.ep0ch` that
  names it, or "nothing names one" with the `ep0ch init …` to run), where Claude runs, and the door and Herdr pane it
  sits in. It says **careful** in yellow when the folder names one outline and the door is on another. `h` hides it;
  `/outline` shows it again.
- **A status line** that stays: `outline: garden @ float-2 · folder`, with `⚠ door is harbor @ far` on a mismatch,
  or `none (tools off)` and the command. It reads the binding again at most every 30 seconds.
- **The first prompt's context** carries the same lines, so the model knows too.
- `ep0ch where --json` gains `here` (machine and folder) and `herdr` (the pane, its label, whether it's an agent
  pane), and `door.machine`.

### Fixed: a new note's cleanup could trash a note someone had written meanwhile

`Esc` on a new note with nothing typed puts it in the trash. If another client, an agent or the person in Detail
wrote to it, or added a child under it, between the door's read and its trash, that work went to the trash with it.
The trash is now conditional in the service: `delete` takes `expectedRevision` and `ifEmpty`, checked in the trash's
own transaction, and the door's cleanup passes both, so a note written or given a child meanwhile stays, and the
door says so with its id and `ep0ch show <id>`. A cleanup that fails says it failed, never "it went to the trash".
`Esc` while a new note's edit is still opening cancels it. From a shell: `outliner delete --id <id> [--expected
<revision>] [--if-empty]`. Protocol bump: restart the host and the doors (see "Update: what to run").

### Fixed: a fenced example inside a figure cut it short in the door

A `::graph-*` figure whose Markdown body held a fenced code example with a bare `::` line ended at that line in the
door's reader, its export and its links, and the rest of the figure read as text. The Claude mod's preview did the
same. They all ask outline-core now (`componentBlocks`), the rule Detail and `replaceSection` use: a code fence closes
only on its own fence (a `~~~` inside a ``` fence no longer ends it), an unclosed figure is plain text (it used to
run to the end of the note in the door), and an opener indented four spaces or more is code.

### Figures written in Markdown, and seven new kinds (ideas from mdxcn.dev)

- **A figure's rows can be Markdown.** After a `::graph-*` block's `---` YAML (or instead of it), write rows:
  `**bold**` is now, chosen or the accent; `*italic*` next, rejected or receding; `- label: value` is a row;
  `x — note` adds a muted side note; `a → b → c` is a path; `ok*40` is a run of forty in any list of values.
  timeline, check, rank, funnel, stat/kpi and spark/plot read them. Where the YAML gives the same field, the YAML
  wins. One reading for every client (outline-core's `figure-markdown.ts`).
- **A figure block's child bullets are its rows.** A note whose body is a figure takes its child notes as rows
  (`rows: children` asks anywhere): each row opens its note by `[ ]` and `⏎`, a click, or `element.open`.
- **New kinds:** `decision` (● chosen, × rejected, ○ open, each with its reason; live over notes with a
  `decision-state`), `chat` (speakers, the first one prompted, asides dim), `keys` (keycaps like `[ctrl][k]`;
  `actions: note` reads the door's own keys from the action registry), `uptime` (a glyph a day and the % ok),
  `activity` (a contribution grid), `calendar` (one month, marks and today) and `annotate` (code with numbered
  callouts). The README's "mdxcn figures" lists each one's Markdown and live forms.
- **Backups as an uptime strip.** `::graph-uptime` with `source: backups` draws the `[type::backup-run]` notes
  that `bun packages/door/scripts/backup-runs.ts --ws pie --source restic -- ~/.local/bin/ep0ch-snapshot` adds,
  one per run, with its status from the backup's exit code. Nothing is hooked up for you: add that line to the
  timer's unit when you want it.
- **A quote's byline.** In a `> [!quote]`, a last line starting `— ` is drawn as the attribution, to the right, the
  source after a comma muted, in the door and in Detail.
- **`ep0ch export` writes figures as ASCII.** Each `::graph-*` becomes its drawing in mdxcn's fenced frame
  (`+---[ TITLE ]---+`, 60 wide, no colour, live ones answered first), so an exported file reads as the door shows
  it. `--source` keeps the blocks as written.
- **The showcase** has a `figures` section: every new kind in its Markdown form, live ones, the figure block and
  the reader's keys read from the registry.

### Fixed: the outline tile showed a note as it was when the desk opened

The desk's outline tile (and the board's outline drawer) read its rows once. A note saved in the reader, in Detail or by
an agent kept its old text in the tree, and picking its row showed that old copy in the reader: a body just written read
as blank until `e` (which reads the note) or a restart. A note made elsewhere didn't appear. The tree now reads its top
level and its open notes again when the outline changes them, and a row picked while that read is due is read itself.
The river's replies under a note are read again the same way. Restart the door (`ep0ch session upgrade --all`) to get it.

### Images: sized, placed, and a note's header (PIE-532, PIE-494)

- **Images render on Linux too.** JPEG, WebP and GIF (its first frame) used to need macOS's `sips`; now decoding and
  scaling are sharp's prebuilt libvips, on Linux and macOS, with no system tool. `bun install` (or `ep0ch install
  --apply`) brings it. An image is scaled down to about the box it's drawn in, never up, so a big screenshot no longer
  crosses ssh at full size. A video's poster frame still needs `ffmpeg` (or Quick Look on a Mac); without one the line
  says what to install.
- **Layout as properties on the image's line:** `[size::40%]` (or cells, or `full`), `[height::12]` (rows),
  `[align::center]`, `[alt::…]`, and `[layout::hero]`: the note's **header**, drawn above the title, the full width,
  whole when it fits in a third of the pane (or its `height`), else cropped to fill (`[fit::contain]` shows it whole);
  it scrolls away with the top of the note.
- **Dark first:** a bright image (a page, a slide, a screenshot) is dimmed as it's scaled, never shown bright first,
  so the part drawn has a mean luminance of at most 0.3. Its rows are kept while it loads: the note doesn't move. `[dim::0]` shows it as it is, `[dim::0.6]` at 40%. For example `- [img::~/shots/plot.png] [layout::hero]`.
- **Change it from the reader:** `[ ]` to an image (or click it), then `+` `-` size it, `←` `→` move it, `H` makes it the
  header; or click its caption's `[−][+] [◂][▸] [▀]`. Each is one save of that line, recorded as you; `ctrl+z` undoes
  it. Agents: `act images`, `image.size n=1 to=50%`, `image.align`, `image.hero`, `image.undo`.
- The showcase has an `images` section.
### New notes from anywhere (PIE-544)

- **`ctrl+n` on every screen** makes a new note and opens it to be written where the screen's opens land, in the
  same editor as `e` (`+` on the main menu does it too). From a reader it goes under the note the reader shows, as
  its last child; from anywhere else, at the top of the Inbox. `Esc` on it with nothing typed puts it in the trash.
  Never taken while you type, and the outliner binds nothing on it.
- **One placement rule, kept by the service:** `notes.create` (and `outliner new`) asks it; the client only says
  which note you were in. Today: under that note, else the top of the Inbox, where quick capture puts its notes.
  It's the seam for rules your outline will define later ("pages go under Pages").
- **A missing `[[page]]` is offered, never made silently:** the first `⏎` or click on `[[Evans Thotts]]` says it has
  no page yet; the next makes `Evans Thotts [page::Evans Thotts]` in the Inbox and opens it (`page.create`). The
  outliner's Tree, which makes a stub when it follows one, now puts it in the Inbox too instead of at the top level.
- **`[page::x]` names itself:** a note whose first line is only `[page::2026-09-30]` becomes
  `2026-09-30 [page::2026-09-30]` on save from any client (the door, Detail, the CLI, agents) and on `⏎` in the
  door's editor. A title already there is never touched. A new note saves on the first `Ctrl+S`.
- **Agents:** `act note.new text=… [near=<id>]`, `act page.create address=…`: attributed, said on the status bar,
  opening nothing. A `near` that's gone is refused, nothing made, with the command to run instead (so is
  `outliner new --near`); only the person's own reader falls back to the Inbox.
- **`ep0ch new "<text>"`** makes a note from a shell or an agent with no door open (`--near`, `--as`, `--json`,
  `--ws`), through the same service call as `ctrl+n`.
- **An empty outline offers a note:** the welcome's list, an empty board, the brief and waiting screens show
  `+ New note · ctrl+n` (a click is `ctrl+n`); `ctrl+n` in a BBS message reader opens the note in a reader over it. A note still empty isn't the Inbox agent's to file.
- **Protocol 86:** restart the outline host on this code (`ep0ch install --apply`), then the doors.
### Sort by a property

- **A saved view, a live figure or a `blocks.query` sorts by any property**, not only `created` and `updated`:
  `[sort::due]` with `[direction::asc]` in a view, `sort: due` and `direction: asc` in a `::graph-*` figure,
  `sort: { field: "due", direction: "asc" }` on the wire. Numbers compare as numbers (`2` before `10`; decimal
  only, so `0x10` is text) and before any text in either direction; text compares without case; blocks without the property come last in either direction, in outline
  order. The query's property scope counts (`propertyScope: "all"` reads a property mid-sentence too).
  `property:created` names a property called created or updated; plain `created` and `updated` are the timestamps.
  A direction may be written in any case.
- **`ep0ch find --sort <key> [--direction asc|desc]`** orders `--query`, `--under` or words the same way
  (`ep0ch find --query type=chore --sort due`); with `--view` it refuses, since a view has its own order.
- **A bad sort says so.** A sort that isn't `created`, `updated` or a key is refused with the key it seems to mean
  ("Sort by rank, not [rank::]"); a live figure says which of its lines it was. Figures used to fall back to
  `updated` without a word.

### Order a view by hand, from the door and from agents

- **A view with no `[sort::]` is ordered by hand**, and its lane, its `view:` figures and Tree all show that order.
  Tree could always change it (alt+↑ alt+↓); now the door, the shell and agents can too.
- **On the board:** `alt+↑` `alt+↓` move the selected card up or down its lane, and a card dragged up or down its
  own lane goes where it's dropped (the hint says above or below which card). Both run `card.reorder` (`by=`,
  `to=`, `before=`, `after=`), which agents call through `act`; theirs never moves your cursor.
- **From a shell:** `ep0ch view order <view> [<id>…]` prints the order, or puts those members first in the order
  given (block ids, `((id))` or Work IDs such as PIE-552), the rest after them as they were. `--json`, `--as <agent>`,
  `--ws`. **Claude:** the `view_order` tool does the same.
- **One service step:** `virtual.occurrences.move` resolves the refs, reads, plans and writes the order in one
  transaction; the door, the shell and the tool call it, so two quick alt+↓ never race. A step (`by`) stays within
  what a `[limit::]` view shows, so a card never slips out of sight.
- **Who reordered is recorded:** `virtual.occurrences.move`, `.place` and `.reorder` take `mutation`, written on the
  change and as a `move` on each block whose place changed (Tree's are recorded as `tree`).
- **A sorted view says how to order it by hand:** "This view sorts by updated desc, so it has no hand-set order:
  remove [sort::updated] from ((id)) to order it by hand" (and its `[direction::]`, as the view writes them). Tree
  says the same, where it said "manual reorder is disabled".
- **Refs as people write them:** a view and its members can be an id, `((id))`, an id's first 8+ characters, a Work
  ID or a `[[page]]`; a trashed block is refused as in Trash, and the same block named twice is refused.

### A figure no longer cuts a section short

- **`outline_edit` `replaceSection` and `note_section` replace the whole section** when it holds a component
  block (`::graph-stat`, `---` YAML `---`, `::`). Its first `---` was read as a setext underline, so `::graph-stat`
  became a level-2 heading that ended the section: the edit reported `previous: ""` and left the old figure under
  the new body. A component block is now one token wherever the outliner finds headings, sections and folds
  (outline-core `component-block.ts`), so Detail's folds agree, with or without a blank line above the figure.
  A section runs to the next heading of its level or higher, sub-sections and figures included.
- **A figure never swallows Markdown around it.** A heading, fence, list or table between a paragraph and a figure
  keeps its meaning (a table's rows stop before the figure); a `::name` with no closing `::` before the next heading
  is plain text, so it can't eat the sections after it; a `#` comment in its YAML or code fence isn't a heading. The
  reading stays linear in the note's length.

### Tabs in a live figure, and titles that wrap

- **`::graph-tabs`** groups a query's (or a view's) results by a property, a tab per value, each labelled with its
  count (`doing 3 · review 4 · validate 1`). The chosen tab's rows are a live table; a row opens its note.
  `order: [doing, review, validate]` puts those tabs first, shown even when empty; the rest follow alphabetically, so
  a count changing never moves a tab. `limit:` is rows per tab.
- **Switch tabs** with `←` `→` or `Tab` `Shift+Tab` while one of its tabs or rows is the `[ ]` position, `⏎` on a
  tab, a click on one, or `act figure.tab n=<number or value>` (an agent: in a reader you aren't typing in). The
  tab is the reader's, like a fold: kept across repaints and live answers, never written into the note.
- **`density: compact | cozy | comfortable`** on a table or tabs figure: a title takes one line (cut with `…`, as
  before), up to two, or up to three with a blank line between rows. A wrapped title hangs under its own text, past
  a work id (`PIE-541 — `). `=` or a click on the `≡ compact` footer steps through them (`figure.density`); the YAML
  is only where it starts. `act figures` lists a reader's figures, tabs and counts.
- **`ep0ch show`** (and `--cells`) prints every tab in turn under a heading. The showcase has a `tabs` section.

### Copy from a program in a terminal tile (PIE-537)

- **A program's copy reaches your clipboard.** Its OSC 52 (Claude Code's "sent N chars via OSC 52") goes on to your
  terminal through the door's own copy, in a session to the terminal with the keys (never a watcher), and a toast says
  "✓ copied from claude · N chars". Before, the terminal tile swallowed it.
- **Only from a tile you're using:** one you typed, pasted or clicked in within the last two minutes, so an agent
  typing into a shell you haven't touched can't fill your clipboard. Otherwise nothing is copied and the toast says "✗ not copied from
  claude · you haven't typed or clicked in it for 2 min · click in it, then copy again".
- Only writes pass: a program can't read your clipboard. Over 512 KB nothing is copied, and the door's own copies have
  the same limit. The kitchen sink's terminal section shows it (`ep0ch --showcase`, section 9).

### A mention opens right in Claude, with no door or Herdr around (PIE-542)

- **In the Claude desktop app (Code tab), VS Code or a terminal outside Herdr**, a press on a mention or a reference
  now opens the note in the mod's mentions pane, in place of the list, instead of copying a command. The heading
  says "opens here". The desktop and VS Code draw it as Markdown (a heading, the text, its children as a nested
  list, references as links); the terminal draws the door's cells, with the references as buttons under them.
- **Links in it open there too**, with history: `b` back (to the list from the first note), `f` forward, `l` the
  list. `c` copies `ep0ch show <id> --ws <outline>`, which a press used to copy.
- `show` lands there as well when neither a door nor Herdr is around.

### The docs site's design system (PIE-523)

- **`site/`**: the system for the docs site, with Showcase (what the door does, in casts) and Build (guides for
  adding to it) under one shell. `site/DESIGN.md` is the spec: the sections and page types, the colour roles, the
  type and the components, and the content rules. `site/kitchen-sink.html` draws every component. Two sample pages
  show the system in use: the callouts feature page, with a cast you can scrub by chapter, and a guide to adding
  a callout type.
- **The door's own colours:** `bun site/tokens.ts` writes the site's colours from the door's calm and night
  themes. Dark only, with no light flash.
- **`bun site/check.ts`:** each page is screenshotted before and after its stylesheets load, at desktop and phone
  widths, and every example marked to run is run on a scratch outline, as a reader would (`ep0ch new`, `ep0ch
  show`). Its callouts are checked against the door's own types, and a page that loads anything from another host
  fails. `site/` is a workspace package, so `bun run check` typechecks it and runs its examples.
- **Fonts served by the site:** JetBrains Mono and Atkinson Hyperlegible Next are in `site/assets/fonts`; a page
  asks no other host.
- The callouts cast is a stand-in, recorded by a one-off script; the showcase tours (PIE-523) re-record it.

### Find by query, export to Markdown or JSON (PIE-534)

- **`ep0ch find --query "<expression>"`** lists the notes a query holds for, as the outline evaluates it: the saved
  views' grammar (properties, `OR`, `NOT`, parentheses, `created`/`updated` ranges such as `updated >= -7d`), in
  outline order. `--view <id>` lists a saved view's members, `--under <id>` a subtree; they combine with each other
  and with words. `--updated-after`, `--updated-before`, `--created-after` and `--created-before` only write the
  query (`--updated-after 2026-03-01` is `updated > 2026-03-01`, a whole UTC day).
- **`--ids` prints `((id))` a line**, and `show` and `export` take `((id))` or a bare id: `ep0ch show $(ep0ch find
  --ids --query type=errand)`. **`find --json` now prints block records** (below) instead of `{id, title, path}`
  rows; `--tree --json` keeps its rows.
- **`ep0ch export`** writes notes out as files: the ids given and anything find's flags select, `--children` for
  what's under them, `--format md|json`, `--out <dir>` (stdout without), `--split`, `--resolve-links`, `--manifest`.
  In Markdown the note's header line (the `[k::v]` chips ending its first line) moves into YAML front matter, values
  verbatim strings and a repeated key a list, with the note's id, parent, created, updated and author; the prose
  that shared line 1 stays the body's first line, the rest is verbatim, children are nested lists (files of their
  own with `--split`). Output is deterministic: sorted JSON keys, outline order, one timestamp format, no export
  time except in `manifest.json`.
- **A block as a record:** one shape in outline-core (`block-record.ts`: title, header, properties as lists, fields,
  children, tasks with status, links, backlinks, resources, created, updated, author), built by the outline host
  (`blocks.records`). PIE-533 reads the same shape.
- **` - ` between header chips:** `Seed order [type::errand] - [area::garden]` gives both chips to the block, and the
  title is "Seed order" (before, every chip but the last was an inline aside, and a chips-only line's title was
  "-"). The header line is one definition in outline-core (`header-line.ts`): the parser, every title, the door and
  Detail's property table (which now says `header` for those chips) use it. The host re-reads every note's
  properties once on its next start (property parser version 5); text and timestamps are untouched.
- **tv:** `ep0ch-tv query "<expression>"` is a source for the `ep0ch` channel (`tv ep0ch --source-command 'ep0ch-tv
  query "type=chore updated >= -7d"'`).
- **Protocol 84:** restart the outline host on this code (`ep0ch install --apply`), then the doors.

### Callouts in full (PIE-538)

- **Obsidian's callouts, all of them.** `> [!type]± title` nests to any depth (`> > [!warning]` is a box in the box),
  with Obsidian's thirteen types and their aliases; a callout's body is drawn like a note (paragraphs, lists).
  Obsidian's own examples are in the showcase's new `callouts` section.
- **Folding.** A callout is a fold point like a heading: `[!x]-` starts folded and `[!x]+` open, then `( )` `f`, `⏎` or a
  click on its title opens or folds it, and `z` opens them all and puts them back. Folding never writes the note.
- **Change a type while reading.** `⏎` or a click on a callout's icon opens the type choice (the step status choice's
  picker); `-` and `+` there make it start folded or open. One line rewritten through the note's save, recorded as
  you; `ctrl+z` puts it back. Agents: `callout.list`, `callout.type`, `callout.start`, `callout.undo`.
- **Type one.** In an edit, `> [!` offers the types with their icons in the completion popup.
- **Your own types.** A note with `[callout-type::recipe] [callout-icon::♨] [callout-tone::green]
  [callout-aliases::dish]` adds a type to the outline: the door's reader, popup and type choice and the outliner's
  Detail all draw and offer it. The list and the grammar are one module in outline-core; the host answers
  `callouts.types` (protocol 85). Detail's built-in icons are now the door's (one list).

### One repository, outlines by name (PIE-530)

- The packages: `packages/outline-core` (the shared pure code: the protocol, the property grammar, the search
  matcher, which outline a client opens), `packages/outliner` (the outline host, Tree, Detail and Preview in Herdr,
  the CLI, the publisher; the Herdr plugin root), `packages/door` (ep0ch) and `packages/claude-mod`. Both histories
  are kept.
- One outline host per machine serves every outline in `~/outlines` by name. Its socket and lock are in
  `~/outlines/.host/`.
- Which outline a client opens, first match wins: `--ws <name>`, then `EP0CH_WS`, then the nearest `.ep0ch` from
  the folder up. `.ep0ch` holds names only: `ws = "<name>"`, and optionally `machine = "<ssh-name>"`. `ep0ch init
  [<name>]` writes it. An outline's own folder (`~/outlines/<name>/`) names it too.
- A folder that names no outline is never given a guess. The door opens the home base; Herdr shows the Choose
  outline popup; `outliner init` and `ep0ch init` name one.
- `ep0ch outline list | attach | create | import | stop | delete` and `ep0ch status` manage the host's outlines.
  The outliner's CLI takes `--ws <name>` before a command.
- `ep0ch doctor` says which outline this folder opens. It no longer lists the host's owner lock
  (`<name>.sqlite.owner`) as an outline: one rule in outline-core says which files are outlines.

### Starting ep0ch

- **The home base.** `ep0ch` in a folder that names no outline opens a door screen instead of a text prompt. It
  lists this machine's outlines and the machines you opened from here, with each one's outlines. Open one, make a
  new one (`n`), import one (`i`), add a machine from `~/.ssh/config` (`a`), forget one (`x`), reload (`r`).
  Choosing an outline offers to write the folder's `.ep0ch`, or to open it this time only. It works by keys, by
  mouse (one click on a row chooses it) and by `act` (`home.*`).
- **Another machine.** `ep0ch --machine <ssh-name>` runs the door here on an outline served by that machine's
  host. `EP0CH_MACHINE` and a `.ep0ch`'s `machine` line do the same. Every client on this machine shares one ssh
  forward per machine (`~/outlines/.remote/<ssh-name>.sock`). A door starts it again when it drops, and says so on
  the status bar. `ep0ch doctor` shows each forward's state. Herdr panes and the Claude mod follow the same rule.
- **`ep0ch --remote <ssh-name>`** puts this terminal on the door session running on that machine (`ssh -t
  <ssh-name> ep0ch …`), so the drop shell and `$EDITOR` run where the door is.
- **The positional socket argument is gone.** `ep0ch <socket>` is refused and says what to use. `EP0CH_SOCKET`
  still names a host's socket outright.
- **`ep0ch --showcase [--reset]`** opens the showcase on its own seeded outline of made-up notes (the same as
  `ep0ch try --showcase`). `--reset` seeds it again. Before, it opened the showcase screen on this folder's outline
  and asked for a seeded database.

### One door session per outline

- **A session per outline,** like `herdr --session <name>`. `ep0ch`, `ep0ch --ws <name>` and `--machine <m> --ws
  <name>` attach to that outline's session, starting it when none runs. Before, one session held the whole state
  dir and naming another outline was refused. Bare `ep0ch` in a folder that names no outline still opens the home
  base, even with one session running: which outline is never guessed. The home base marks outlines whose session
  runs (`● running · 1 attached`), and choosing one attaches.
- **`ep0ch session list`** shows every session (outline, machine, pid, code, terminals, programs). `attach`, `end`,
  `upgrade` and `restart` act on this folder's (or `--ws`'s) outline, else the only one running; `upgrade --all`,
  `restart --all` and `end --all` act on every one. `install --apply` hands every session behind the checkout to the
  new code.
- **One outline's own state lives in its folder** of the state dir (`sessions/local/<name>/`, or
  `sessions/<ssh-name>/<name>/`): its session, its desk, river and board layouts, its last call, marks and drafts put
  aside. The theme, named layouts, machines and the dock stay shared.
- **An error that tells you to run something shows the exact command,** filled in for this machine (with
  `EP0CH_STATE=` when it isn't the default).
- The one-off move of a session from before this ran on both machines and is gone (#162): a state dir's old
  top-level session files are ignored.

### Search

- **Forgiving search.** Goto, Detail's and the door's `((` (`tree.search`) and `[[` (`pages.complete`)
  completion, the door's `/` search and `ep0ch find` (`tree.search`), Inbox history search, the Backlinks filter,
  the links tile's Outlinks and Resources filter and a river column's `/` words share one matcher (outline-core's
  `search-match.ts`). Punctuation folds ("Claude - now" finds "claude now"). Words match in any order. A longer
  word may be off by a typo or two ("party hast" finds "party hats"). When all but one word match, the result
  still shows, below every exact match.
- **Search from the note you are writing**, in Detail and in the door. `((` and `[[` rank from the draft's note (the
  note being edited, the one a comment is on, a new note's parent, a new card's view): nearer notes come first. An
  empty `((` lists what the note's parent and siblings link to, then nearby notes, then your recent edits. `[[`
  also finds a work id by its note's title. The door's `/` searches from the note you are on.
- **Jev after a pause.** Where the host has a Jev key, a 300 ms pause in the door's `((`, `[[` or `/` asks Jev to
  re-order the same hits, told the note. What you picked stays picked; if you moved or typed meanwhile, the answer
  is dropped. The footer says `jev…` while it asks and `jev ranked` after. A host without a key is asked once.
- In a river column's `/`, `-word` now hides exactly the notes `word` would show (a typo included).
- `blocks.query`'s `text` (agent tools, `list --text`) matches every word in any order, not one phrase.

### Links and resources on every screen

- **One links model**: a block's Outlinks, Resources and Backlinks, in the Tree's order and words, drawn the same
  way in four places:
  - the tree's `L` panel;
  - the links tile (the backlinks tile, extended): its filter covers the three groups (the backlinks with the forgiving matcher, outlinks and resources by plain
    words for now), `.` folds a group, and its
    preview shows the selected row;
  - a river column, under its replies: `j` and `k` walk into the rows, ⏎ opens one in the next column, and `b` or a
    click on `── ▾ links` folds them;
  - inline in a note: `::links`, `::outlinks`, `::resources` and `::backlinks`, drawn in a figure's frame. Words
    after the name filter the rows (`::resources jira`).
- **`b` in any reader** shows the note's links. It aims the screen's links tile, or opens one below the reader with
  its preview beside it.
- **Resources.** Previewing a Resource only reads (its stored content, or the Jira extension's ticket block). One
  that isn't registered says that ⏎ registers it. ⏎ registers and fetches it once, as the Tree's ⏎ does.

### The mouse does what the keys do

- In lists (the tree, the links tile, list pickers, the query tile, the board's lanes, the river's cards and link
  rows): a click selects and previews, like `j`/`k`; two presses on the same row within 400 ms are ⏎; alt-click,
  ctrl-click or a middle click is alt+⏎. The click that gives a tile the keys only selects.
- **Sideways wheel** (a trackpad swipe) moves one step: the next river column, or the next lane on the board.
  Terminal tiles get the real wheel bytes.
- **Every desk screen leaves by mouse.** The keys drawn in a hint row (and in its `? more` box, and a `^W` chord's
  keys box) are clickable: `q menu`, `/ search`, `alt+k lock` and the rest.
- The board's mover and steps, the layout picker and the search take the mouse: a click on a lane moves the card,
  a click on a step checks it off, a click on a layout loads it.
- The mouse's back button runs a screen's `alt+←`, as in the river.

### River and tiles

- **A preview split in one key (PIE-536).** `O` in a reader, `^W v` (beside) or `^W V` (below) on any tile opens a
  reader beside it where its opens land, linked in the same step: links you follow there, the tree's `⏎` or a
  list's pick show in the split and the tile keeps its note. A reader gets a detail; a terminal a preview of its
  file; the board one of its card. Again, it shows that split instead of making another. Agents: `act tile.preview
  tile=<tile> where=…`. `^W v` was a follower preview, not linked; `^W o p` still opens one. On a tile already linked (the daily desk's outline → `middle`) `^W v` now jumps to that tile. A river column refuses it: its opens already open the next column.
- **River columns draw a note's images** in a terminal with Kitty graphics, scrolling and cropping with the column.
  Where images can't be drawn, the label says why (`no Kitty graphics in this terminal`, or `alt+v draws
  images`).
- **A tile paints its whole box.** Text from a column behind a short one no longer shows through.
- **A river column owns its keys** on any desk: `h l ← → w p x g` and back/forward work there as in the river.
- **The river's property filter asks the service.** `type:hub`, `-status:done` and `key:*` match as the service
  matches (any of a note's values for the key). `type:` lists notes without a `type`, `-type:` notes with one. A
  key the service refuses is said as the column's error.
- **Fixed:** typing `e`, `i` or `C` in a river column's `/` filter started an edit, the property panel or a comment
  instead of typing the letter.

### Television, and ctrl+t inserts from a picker

- **The outline in [television](https://github.com/alexpasmantier/television)**, as a door extension
  (`packages/door/ext/television/`, deletable):
  - `tv ep0ch`: the outline's notes, with three sources (`ctrl-s` cycles them): Tree (depth first, drawn with
    `├─ │ └─`; `EP0CH_TV_ROOT=<id>` roots it), Recent and All. The preview is the note as the door draws it. Enter
    prints `((id))` per note (Tab picks several), `ctrl-g` opens it in the running door (attributed to
    `television`), and `ctrl-d` shows it in the Outliner's Tree and Detail.
  - `tv ep0ch-files`: files, printed as `[file::<path>]` Resource tokens.
  - `tv ep0ch-outlines`: this machine's outlines and the remembered machines'. Enter opens the door on one.
- **ctrl+t in a draft** (an edit, a comment, a reply or a new card), or a click on `[insert]` in the edit frame's
  title row, opens the picker in a terminal tile beside the note and inserts what you choose at the cursor. `^W x`
  closes it without inserting. On a screen with no room for a tile (the board), the picker gets the whole terminal.
  `EP0CH_PICKER` (default `tv`) and `EP0CH_PICK_CHANNEL` (default `ep0ch`) change what runs. It is the person's
  action: an agent's `draft.pick` is refused.
- **New commands** for pickers and scripts:
  - `ep0ch find [words… | --recent | --tree [<root id>]] [--lines | --json]`: the service's ranked search, the
    newest notes, the outline as a tree, or every note;
  - `ep0ch show <id>… [--source | --ansi | --cells] [--width <n>]`: each note drawn as a reader draws it, its live
    figures, `::links` and a view note's results answered by the outline, folded callouts open (no key hints); `--source` prints each note's text exactly as written, `---`
    between notes, for a Markdown file (`ep0ch show --source $(tv ep0ch) >> notes.md`);
  - `ep0ch outline list --all`: every outline, here and on the machines you opened;
  - `ep0ch open ((id))` takes the bracketed form.

### No dead panes; choose the dock's agent; one agent per outline session (PIE-498)

- **Quitting an agent leaves you a shell.** Every agent, in the dock or a terminal tile (`claude`, `codex`, `pi`, the
  Herdr pane's too), starts inside your login shell. When it exits or crashes, the tile says `claude exited · shell`
  and is your shell, in the same folder with the same environment: `claude --resume`, another agent, anything.
  Nothing restarts it behind your back.
- **Choose the dock's agent.** `alt+g` opens a picker of the agents installed here (Herdr's agent kinds found on
  your PATH, each also "in Herdr" when Herdr is installed) and a shell; the choice is saved per outline session
  (`host.agent name=<agent> [herdr=true] [default=true]`). `alt+s` opens a new shell in the dock. `ep0ch doctor`
  lists each session's dock agent, where the choice came from, and the command to change it.
  Both work while you type in a dock terminal too (as `alt+a` does), and the picker has your keys over it. Pulling
  the dock up the first time with no agent chosen (`alt+a`, a click on the chip) offers the picker once a door.
- **One Herdr agent per outline session.** The Herdr pane is the session's own (`door-<outline>[--<machine>]`),
  started with that session's `EP0CH_CONTROL`; a door on another outline never attaches it. Ending a session closes
  its pane.
- **Plain `claude`.** The dock no longer starts `door-claude` or adds `--continue` by itself (only `agent.restart`
  does, when you ask). `EP0CH_HERDR_AGENT_CMD` is gone: the agent is the dock's choice.

### The dock: any tile travels with you (PIE-498)

- **Dock any tile.** `^W a` on a tile (a terminal with a Claude in it, a reader, the tree, a query tile) moves it into
  the dock, the drawer the status bar's chip pulls up over every screen. So does dragging its title onto the chip or
  the open dock, or pressing `a` while you drag it. It's the same tile, moved: a terminal's program keeps running
  (the same pid), a reader keeps its note, history and draft. Switch to the desk, the board or the river and it's
  still in the dock. `^W a` in the dock, or dragging its tab out over a screen, puts it back by the usual drop
  zones. The dock shows tabs when it holds more than one; the chip says how many (`▲ claude +2`).
- **It's kept.** What's docked is saved (`dock-tiles.json` in the outline's folder of the state dir) and comes back
  in the next door. In a session, a docked terminal's program survives `ep0ch session upgrade` and is adopted again.
- **The dock's own program is yours.** Its first tab runs `EP0CH_DAILY_AGENT` when you set one, else a shell (it was
  `claude`). It starts in `EP0CH_DAILY_CWD` when you set it, else the folder of the `.ep0ch` naming the outline above
  where the door started, else the outline's own folder, else where the door started. `ep0ch doctor` says which,
  and why. The Herdr launcher makes a new `door-claude` pane in that folder, not the door's.
- **Agents:** `host.dock tile=<t>` (and `on=false to=<tile> where=<side>`), attributed, never with your keys; an
  agent can dock its own tile (`tile=$EP0CH_TILE_ID`) unless you're typing in it. `tile=` naming a docked tile
  reaches it in the dock; a name both the screen shown and the dock have is refused, naming each tile's id.
  `peek`'s `dock` lists `tiles` and what it `runs`.
- **Nothing in the dock is out of reach.** A docked reader re-reads a note changed elsewhere, as a shown one does; its
  unsaved edit asks before a quit and is copied out on a forced end or a session handover; `ep0ch where` from a
  docked terminal names its dock tile, never a screen tile its old `EP0CH_TILE_ID` happens to match.
- **Floats and drawers, one step each way.** `^W p` (or `tile.pin`) on a float puts it straight into a drawer, and
  `^W f` on a tile in a drawer floats it. A click on the `⧉` in the focused tile's top right corner floats it; the
  `⧉` before a float's title puts it back, the cell either side of it counting too. A float's other header controls
  (a mark's label, a tile's own controls) work again: a press on its header no longer always started a drag.
- **While dragging a tile,** `f` floats it, `p` puts it in a drawer and `a` docks it: what `^W f`, `^W p`, `^W a` run.
- **One word, one meaning.** "Dock" is the dock above. The river's `p` (a column that keeps its full width) is
  `tile.hold` now, "held" on its header (`⊙`); a tile in the layout rather than a drawer is "pinned" (`tile.pin`); a
  float goes "back" into the layout. The status bar and the drawer say "the dock" for what was the agent drawer.

### Smaller changes you may notice

- Who's Online (`W`) and Last Callers (`L`) are desk screens: tiles with the desk's keys, mouse and `act`. In Last
  Callers, ⏎ shows the note in a reader beside the list.
- A board or river tile opens as its screen was last saved, and what changes in the tile isn't saved over the
  screen's own layout. The board screen (`K`) no longer comes back with its preview folded.
- Every line input has ← → Home End and delete. A layout's name can be longer than 40 characters while you type;
  ⏎ then says it is too long.
- Lists keep their view where the wheel left it. The board's steps list no longer jumps when you move up from the
  bottom. Titles are cut by terminal cells, so CJK and emoji titles fit their room.
- `ep0ch session list` shows ages as the rest of the door does (`up 2d`). `ep0ch act` and `peek` with no door say
  `no door answered at <path>`.
- The showcase index scrolls, so no section is cut off.
- Inline code that wraps onto the next row is code on both rows; no stray backtick is left showing.
- A line that several comment threads quote gets one mark in the margin (yellow while any is open). Each extra mark
  used to print a colour code as text, such as `[38;2;230;206;120m`, at the start of the line (PIE-541).
- `outliner --help` (and `-h`, `help`, or no command) prints the CLI's usage; it used to throw, or list the folder's
  outline. An unknown command says so and exits 2.
- `ep0ch --help` lists `ep0ch outline list --all` and `--lines`.
- A link, property value or embed whose target doesn't exist yet ends in a quiet `◌` (embeds drawn dim), not
  "· Missing target". Selecting or clicking it still says in words what's missing and how to make it.
- `ep0ch install` and `ep0ch doctor` read at a glance: a step says what it did once, each backed-up outline is one
  line (`✓ pie  2.1 MB  integrity ok`), sessions are a table, and skill links are one line per folder. A fetch that
  raced another git process is no longer reported as an error. `--json` keeps its shape.
- `ep0ch install` checks each workspace package's dependencies, not only the root's, so a new door dependency
  (sharp, image-size) is installed before the sessions are handed over. A failed handover says its cause once.
- `ep0ch find --recent` and `find --tree` refuse an option they don't take (`--sort` included) by naming it, and
  print the same find without it.
- A showcase door left open across `ep0ch --showcase --reset` reads the new seed; its notebook's embeds no longer
  read missing.

### Recent mentions in Claude Code, and BlockView

- **The Claude mod shows Recent Mentions** in a band above the prompt or a pane beside the transcript (`m` moves it,
  `x` hides it, `p` previews, `s` all conversations; `/mentions band|pane|off|preview|scope`). A click or a
  mention's number opens it through the mod's one open: in a door tile, in that door; in Herdr, Claude's own
  Detail; elsewhere a toast with the exact `ep0ch show <id> --ws <outline>` command, copied.
- **Previews are the door's own drawing** (BlockView): `ep0ch show <id> --cells [--width N] [--rows N]` prints the
  note surface as cells, and the mod paints them. Without a usable `ep0ch` it shows the note's text.
- `outliner mentions list` takes `--agent`, `--session` and `--limit`.

### For agents

- `ep0ch act` names a tile with `tile=` only. `reader=` and `--reader` as names for it, the `reader` tile alias and
  the old `{cmd:"open"}` request are gone, and so are the action aliases (`pane.close`, `pane.resize`, `pane.zoom`,
  `pane.float`, `pane.pin`, `agent.enter`, `agent.leave`, `agent.toggle`, `agent.height`, `focus`, `focus.set`,
  `focus.clear`, `layout.restore`, `reader.collapse`, `reader.expand`, and the river's old short names). Use the
  canonical names `ep0ch actions` lists.
- New actions: `links` (an agent's opens a links tile where the screen has none, and never moves the person's
  keys; refused in a river column, where `column.links` is the way),
  `column.links` and `column.link` in the river, and `home.pick`, `home.open`, `home.new`, `home.import`,
  `home.connect`, `home.add`, `home.forget` and `home.reload` on the home base. An agent's `home.open` writes
  `.ep0ch` only with `write=true`, and the door says which agent opened the outline.
- `draft.pick` and `composer.pick` are the person's: an agent is refused.
- The Claude mod: `door_act` takes `tile`. `show`, `door_open` and a click on a reference name the tile they come
  from; when the door doesn't know it, the note goes where the door's opens land, never into the reader the person
  is on. A folder whose `.ep0ch` names a machine gives Claude's tools that machine too (`EP0CH_MACHINE`).
- Action argument types come from each action's schema, so a wrong argument is caught when the door is built.

### Removed

- **`tile.dock` and `flow.dock`** are `tile.hold` and `flow.hold` (PIE-498: "dock" is the dock). A river layout saved
  with a held column (`docked` in its flow) comes back without the hold: press `p` on the column again.

- **Component fences.** A ` ```component:<name> ` fence is an ordinary code block now. The document-renderer
  registry (`document-renderers.json`, `OUTLINER_DOCUMENT_RENDERERS`) and its one example (`status-summary`) are
  gone. Live `::graph-*` figures and rich component extensions cover the need.
- **Capability negotiation.** One number, `PROTOCOL` in outline-core (now 83), replaces the capability lists and
  the minimum protocol. `ping` no longer reports `propertyGrammar`, `draftPatchCompare` or `searchMatch`, and the
  door's grammar-mismatch warning is gone.
- **Copies of shared code.** The door imports outline-core; its vendored copies of the property grammar, the
  draft.patch compare and the search matcher are gone. The door reaches the outliner only through the outliner's
  declared exports, and a test holds it.
- **Per-folder outlines.** `client.json`, path-hash state folders, `outline.json` descriptors, `by-name/` links,
  `outline adopt|rename|set-root`, the single-outline service, and `OUTLINER_STATE_DIR`, `OUTLINER_OUTLINE`,
  `OUTLINER_REMOTE`, `OUTLINER_SOCKET_PATH`, `OUTLINER_CONFIG_PATH` and `OUTLINER_DEFAULT_OUTLINE`. (`EP0CH_DEFAULT_WS`
  is the host's default outline, for tests and scripts.)
- **Runtime migrations.** The schema has one version (`PRAGMA user_version`, now 1). The store's
  detect-old-shape steps, the roadmap migration and the legacy annotation conversion are gone.
- **Older doors and services.** The door's code for services without today's actions, and its saved-layout
  migrators. A saved `desk.json` or `layouts.json` from before the board became a screen spec is reset.

## Outliner, before the one repository

These entries were pi-herdr-outliner's changelog, from its first dogfood tag (August 22, 2026) to October 2, 2026.
Pull request numbers in them (`#270`) are pi-herdr-outliner's. Some describe things since replaced, such as
`client.json` and capability lists; the [Unreleased](#unreleased) section above says what replaced them.

### Pane bars you choose, glyph dock buttons, and a chrome budget (PIE-525)

- Preview's bar is back to one click for docking: `[▐]` right, `[▄]` below,
  `[◙]`/`[○]` Auto docking on/off and `[×]` close, each the same action as its
  key and menu item.
- In any `[⋯]` menu, right-click an item or press `Alt+Enter` to pin it to that
  pane's bar (Tree, Preview or Detail), or unpin it. Pins are saved in
  `ui.json` beside `keybindings.json`, can be edited by hand, and reload with
  `Ctrl+R`. Defaults ship in code; the shape (`bar` and `chrome` per pane kind)
  is the one ep0ch-door will share.
- Compact chrome is one bar row and one hint row per pane. The hint row is
  generated from the bound actions, every hint is clickable, and statuses flash
  there instead of taking a row. Docked below, Preview's bar is the divider.
  Workspace path, counts, Inbox and "Opens in" moved to the menu's top row.
- `chrome: compact | full` per pane kind replaces `view.json`'s `density`
  (no longer read). **View → Tree/Preview/Detail chrome** switches it.
- Tree and Preview at a 65×20 pane: 10 content rows with the former full chrome,
  18 now; chrome rows around Tree with Preview below went from 11 to 3.

### The Claude mod follows the folder you run Claude in (PIE-526)

- A Claude session's Recent Mentions, links and outline tools use the outline
  its folder is bound to: the nearest folder with a `client.json`, or an
  outline root the host serves. No allowlist to configure, and a folder bound
  to no outline feeds nothing (never the host's default outline).
- `outliner bound-folder [folder]` prints that binding as JSON (never a guess).
- `PI_OUTLINER_MENTIONS_WORKSPACES` (and the mod's `workspaces` option) opts
  folders out. `PI_OUTLINER_MENTIONS_MODE=allowlist` keeps the old behaviour.
  An old allowlist with no mode feeds nothing anywhere (one toast) until the
  mode is set or the list dropped with `install-claude-mod.ts --folder`.
- `install-claude-mod.ts` needs no folder. `--exclude` opts a folder out,
  `--folder` drops an old allowlist (naming listed folders bound to no
  outline), and folders given bare (or `--allowlist`) are strict mode. `install.sh` gains `--claude-exclude`; `--claude-workspace` is
  strict mode, and `--claude-mod` no longer asks for a folder.

### Anyone with the link: `[publish::public]` (PIE-518)

- Tag a note `[publish::public]` or `[publish::public:<slug>]` and anyone with
  its link can open it, including claude.ai and ChatGPT. `publish serve
  --public-port N` adds a public listener from the same publisher: it serves
  only public notes, has no index, and shows "not shared" for an embed of a
  note that isn't public. `[publish::never]` still wins. Expose it with
  Tailscale Funnel on its own port (Funnel opens a whole port, so never beside
  the tailnet mounts on 443).
- `publish list` and the tailnet index gain a PUBLIC column with each public
  note's link (`--public-url`).
- `[publish::public]` used to publish at the slug `public`; it now means the
  above.

### Proposals apply once, never past their passage, and dismiss in the service (PIE-510)

- "Apply anyway" places only the passage the proposal shows. If the person
  changed that passage since, the apply is refused and their text stays. It
  used to replace whatever stood between the context kept around the passage,
  which at a note's end was everything after it. A forced apply also stays
  above the mark. A proposal whose passage was already gone when it was made, or
  is at or below the mark, carries `[proposal-applies::no]`, so clients offer only dismiss.
- A proposal is applied or dismissed once: a second call made at the same time
  is refused. If the applied status can't be written, the answer has a
  `warning`.
- `draft.proposal.dismiss` (capability of the same name) dismisses a proposal
  in one step. Its embed line comes out of the note or of the door's live
  draft, the proposal gets `[proposal-status::dismissed]` and goes to the
  Trash, attributed. An agent can dismiss only its own proposals. A patch the
  service sends a door's live draft to apply or dismiss a proposal carries
  `proposal: { id, op }`.
- An `@name` request whose proposal was applied or dismissed now shows
  `applied` or `dismissed` under its line. A proposal's text no longer names a
  door key.

### Agents addressed while you write (PIE-501)

- An extension can declare `agents[]`. A person's `@name …` line (quiet for a
  moment, outside code) runs that agent's `respond` with the note as the person
  sees it. Its patches apply as an attributed edit through `draft.patch` with the
  `edit` policy, landing in a door's live draft when one holds the note; only a
  failed compare becomes a proposal under the line. A reply shows under the
  line. Each request runs once; `r` asks again; a line an agent wrote waits for
  `r`. Example: `extensions/tidy` (`@tidy`, `@tidy all`).
- PIE-510: every agent's `draft.patch` passes one guard that refuses writing or
  rewording an `@name` line (not only an `@name` agent's own answer). Notes from
  before agent requests keep their old `@name` lines old (a one-time baseline at
  start). A request a restart cut off says so; one still waiting for quiet when
  the service stops waits for `r`. Undoing the removal of an answered line brings
  its answer back instead of asking again. `r` records who pressed it
  (`requestedBy`: `user` or `agent:<id>`), an agent's `r` doesn't release a line
  an agent wrote, and `r` on the note (Detail's) asks the requests not answered
  yet. `drafts.touch { holdId }` lets a door say the person typed in a held
  draft, so a request runs while they write, before any save. Note assistance
  leaves lines addressed to an extension's agent alone.

### Extensions wave B: watched folders and the four kinds (PIE-507)

- Extension folders are watched: `<outline root>/extensions/<id>/` and
  `~/.config/pi-herdr-outliner/extensions/<id>/` load, reload and unload with no
  restart. A broken folder keeps serving its last good version and says what is
  wrong, naming the file and the field. `extensions.list` reports every folder,
  its state, its handlers, actions and tile kinds; an `extensions` event says when
  it changed.
- The four kinds, each with an example in `extensions/`: data put into a block
  (`moon::`, beside `jira::`), inline output under a line (`horoscope::`), a rich
  component composed from shared primitives with its own actions
  (`fancy-horror::`), and a whole tile for the door's tile-kind registry
  (`tarot.reading`). Handler lines share one grammar (argument, typed `--options`,
  display options), run by `effects` (`read`, `spend`, `write`), and show in
  `resources.projection.read` beside Jira's tickets; `r` runs them.
  `extensions.render` gives a result as markdown, blockdown, html, json, csv or
  terminal text; `extensions.act` runs an action (or the built-in `keep`), its
  writes kept inside the block and attributed `ext:<id>`.
- `outliner ext add <name|path>`, `ext remove <name>`, `ext ls` (from the running
  service) and `ext act`. Detail draws handler outputs and its `r` refreshes a
  note's tickets and extension lines. See
  [docs/extensions/README.md](packages/outliner/docs/extensions/README.md).

### Merged without an entry, Sep 30 – Oct 1 (added in the PIE-510 cleanup)

Newest first.

- An applied proposal says what was done: "Applied as an ordinary edit." rather
  than "A applies it anyway". The tarot tile fits a door tile 8 to 60 columns
  wide, cutting long lines with `…` (#270).
- Claude mod: a click on a reference, `show` and `door_open` share one open. In
  a door (`EP0CH_CONTROL` set) it asks that door through `door-open --from
  <tile>`, using the `t<n>` id when the tile has no name, and the door's refusal
  is the answer; else Herdr's Detail split; else a toast or denial that says
  why and gives the `((id))` to copy. `door_open` no longer runs its own
  `ep0ch` command (#264).
- **Behaviour change:** `draft.patch` defaults to the `edit` policy, the same
  guard as `outline_edit`: only a dropped `[page::]` or a dropped `^anchor`
  another note links to is refused, as an error with nothing written, unless
  `allowStructural`. Before, every patch got the strict prose check, and a
  dropped `[[link]]` turned the whole patch into a proposal. The prose check is
  opt-in (`policy: "prose"`); its refusals still become proposals. A patch
  stays atomic, and a proposal reads as one edit of N changes. The mod's
  `outline_patch` takes `policy` and `allowStructural` (#263).
- A store opened at `:memory:` takes no ownership lock, so tests no longer leave
  a `:memory:.owner.sqlite` file in the working directory (PIE-510).

### Merged without an entry, Sep 22–30 (added in the PIE-502 catch-up)

These shipped with README or PR notes but no changelog line. Newest first.

- macOS parity: a leftover file at a socket path (`ENOTSOCK` on macOS) reads as
  a stopped outline rather than a busy one, and the artifact cache is resolved
  to its real path before a build, so pinned packages load under `/tmp` and
  `/var` links (#257).
- Claude mod: the `whereAmI` context names the ep0ch skill and its `peek`,
  `actions` and `act` commands, so a door agent knows how to drive the door
  (#256). The first door-tile `show` routing is #249; #251's entry below
  describes the current behavior.
- Detail links survive an embedded note whose title has parentheses: resolved
  text is no longer re-parsed, and `((uuid|Label (with parens)))` keeps its
  whole label (#247).
- Recent Mentions from a folder bound to a hosted outline is accepted, and the
  mod expands `~` in `PI_OUTLINER_MENTIONS_WORKSPACES` entries (#246).
- Opening from Herdr never creates an outline by itself: in a folder with no
  outline, **Choose outline** lists the known outlines (running or stopped) and
  offers **New outline here**; Esc creates nothing. `service-only` refuses in
  such a folder (PIE-458, #241).
- The client and service survive Bun 1.4's repeated socket errors (`EPIPE`);
  the suite passes on Bun 1.3.14 and 1.4.2 (PIE-454, #240).
- CLI `create` and `update` take `--author user|agent|system`, `--actor` and
  `--session`, and the new `activity` command reads `activity.recent`
  (`--limit`, `--since`, `--after`, `--author`) (#238).
- A Preview that already shows a note narrows to one checklist step when that
  note reloads with a step anchor (PIE-446, #235).
- A `jira::` line shows the ticket's stored details beneath it in Detail
  (accepted forms include floatty's `- jira:: --comments`), and a ticket page
  shows its ticket at the top. Reads never contact Jira. Capability
  `resources.projection` (PIE-445 slice 1, #234).
- Backlinks carry service facets (kind, stage, placement, comment
  resolution; capability `references.backlinks.facets`). Detail and Backlink
  Peek group them by kind with stage counts, hide the note itself, its
  descendants and resolved comments by default, and filter with `k`, `t`, `h`,
  `n` and `/` (PIE-442, #233).
- Checklist requests report missing `query`, `target.start` and
  `expectedRevision` as caller errors, and generated step anchors are short
  (`^t-daca0f`); existing `^task-<uuid>` anchors still work (PIE-443, #232).
- `properties.preview { text }` returns the block properties and every token a
  save would parse, from the save-time parser; CLI `properties-preview`
  (PIE-401, #222).
- `blocks.read { ids, fields? }` reads up to 1000 blocks in one request with
  field projection, and `blocks.query` accepts `fields`; CLI `read <id>…
  --fields` and `list … --fields` (PIE-400, #221).
- Virtual branches take `[expand-when::…]` to reveal collapsed paths to
  matching blocks, such as open high-priority comments, inside the view's budget
  (PIE-379, #197), and `[child-depth::0..8]` and `[expanded::false]` to bound
  descendants and start roots collapsed; **Reset view expansion** restores the
  view's policy (PIE-378, #196).
- Claude mod: Work IDs, `[[page]]` and `((uuid))` in Claude replies are links.
  A click opens the target in a Detail that Claude owns, split below its pane
  and reused, never taking focus; the `show` tool opens a reference there on
  purpose. The CLI gains read-only `resolve <pi-outliner-uri>` and `link …
  --detail-client <id> [--no-focus]` (PIE-359, #192, #193, #195).
- `install.sh --capture-key` binds a global Quick Capture shortcut (default
  `prefix+shift+c`; the comment-on-selection default moves to
  `prefix+shift+a`) (PIE-206, #146).

### Recorded with their PRs

- `draft.patch` has two policies. `edit`, the default, is the guard every agent
  edit has (`droppedLinkedStructure`, shared with `outline_edit`): only a
  dropped `[page::…]` or a dropped `^anchor` another note links to is refused,
  as an error with nothing written, unless `allowStructural`. A dropped
  `[[link]]` or `((ref))` applies, as an ordinary attributed edit when no door
  holds a draft of the note, or into the draft when one does. `prose` (opt-in,
  for tidying the person's words; `outliner patch-demo` uses it) keeps every
  structural token, and what it refuses becomes a proposal as before. Only a
  compare that fails or a prose refusal parks a proposal, and a proposal reads
  as one: `1 proposed edit (6 changes) from @agent: not applied, because change
  1 would … · A applies all`. `outline_patch` takes `policy` (default `edit`) and
  `allowStructural`.
- Outline tools for agents in the Claude mod (PIE-504): `outline_read` (full
  text, properties, revision, bounded children, completeness), `outline_find`,
  `outline_resolve`, `outline_edit` (revision-checked; refuses an empty write
  and dropping a `[page::…]` or a linked anchor), `outline_create`,
  `outline_comment`, `outline_reply`, `outline_resolve_thread`,
  `outline_changes` and `outline_patch` (`draft.patch`), each attributed to the
  agent; and in a door tile `door_where`, `door_peek`, `door_act` and
  `door_open`. They run the new CLI `agent` command. CLI `comment` takes
  `--author agent --actor`, and `activity` takes `--actor` (service capability
  `activity.actor`, which also gives `activity.recent` a `beforeCursor` so
  `outline_changes` pages back through a cut answer instead of skipping it). An
  agent's `note_section` and `work_body` refuse dropping a `[page::…]` or a
  linked anchor too.

- Fresh workspaces get seed 6 of the Documentation hub (PIE-502). The agent
  guide describes the boolean saved-view grammar, `[child-depth::…]`,
  `[expanded::…]`, `[expand-when::…]` and `views.planWrite`, page rename by
  editing `[page::…]`, literal regions, nested transclusion through the service,
  write attribution and `activity`, and that `outliner_publish` is not web
  publishing. The tour adds working selections, Preview comments, folding,
  grouped Backlinks, **New Tree**, and a section on outline names, publishing,
  the Claude Code mod and ep0ch-door; its example view uses an `OR` query.
  Existing workspaces are never reseeded.

- Published blocks run claude.ai artifacts: attach a downloaded `.html`,
  `.jsx`/`.tsx` (React, compiled on the server with `Bun.build`, never run
  there; claude.ai's packages fetched pinned into `<state root>/publish/artifacts`;
  shadcn/ui and Tailwind included), `.svg`, `.mermaid`/`.mmd`, `.md` or code file
  and it works at its URL, sandboxed with an opaque origin. Embeds on published
  pages (and in rendered markdown attachments) now show the embedded note's text,
  published or not, within the service's transclusion limits; `[[page]]` and
  `((block))` links in rendered markdown attachments link published targets; and
  `[publish::never]` locks a note and everything under it from every page, embed
  and link. See README "Artifacts".
- Claude mod: a session started in an ep0ch-door tile (or the door's Herdr agent
  pane) is told where it runs. At session start the mod runs `ep0ch where --json`
  (read-only) and gives its one-line summary to Claude as the `whereAmI` context
  block of the first prompt: the stack of layers from `EP0CH_NEST`
  (`ssh:pts/5 › door:<pid>/desk/t1:claude`), what is live, and where the person's
  keys are. Without an `ep0ch` that knows `where`, it gives the variables alone,
  marked unchecked. Outside a door it does nothing.

- Outline as server: `outliner publish serve` gives every block carrying
  `[publish::…]` a URL on 127.0.0.1 (`/p/<page address|block id|slug>`), serving
  an attached `.html`/`.md` file or the block and its subtree as markdown (with
  `?view=html`), and `/index` lists them all. Read-only; attachments are served
  only from allowed roots, never through `..`, escaping symlinks, hidden paths
  or non-regular files, never from `/` or the home folder, and not at all when the
  service runs on another machine. Attached HTML runs sandboxed, with an opaque
  origin. Embeds, titles and links never show an unpublished block's text or id.
  Any `[publish::false]` on a block wins, and a request naming a foreign Host is
  refused.
  Expose it with `tailscale serve --set-path /pub`. See README "Publishing blocks".

- In an ep0ch-door tile, `show` and a click on a reference open the note from
  Claude's own tile (`door-open --from $EP0CH_TILE`): the door puts it where
  that tile's opens land and says which reader, instead of the mod assuming a
  tile called `middle` (ep0ch-door PIE-491). A door without that tile, or older
  than `open from=`, is asked for its `middle` reader as before, then for none.

- The service plans writes into saved views (PIE-490). `views.planWrite` says
  what moving a block into each view would patch (with token ordinals, at the
  block's revision), or what a new block there is born with, and why not when a
  patch can't satisfy the view's query; `query.matches` says which of given
  blocks a query holds for. The property token grammar moved into
  `src/property-grammar.ts`, one definition the parser, the query language and
  context resolution share, and `ping` reports its version for clients that
  copy it. ep0ch-door uses all three instead of its own copies. Additive
  capabilities `views.planWrite`, `query.matches`, `ping.propertyGrammar`.

- Rename or remove a page by editing its text. Changing `[page::x]` to
  `[page::y]` in Detail, Tree, `outliner update` or any client renames the page
  (`[[x]]` stays an alias, so links keep resolving; renaming back promotes it);
  deleting the token frees the address. Saves were refused before with "requires
  pages.rename" / "requires pages.remove". An address another note owns is
  refused as `[[y]] is already the page of block <id>; pick another name`, and
  nothing is saved; an owner in Trash is named as such. Work IDs stay immutable.
  Quick Capture's idle draft saves are provisional: a page name corrected
  before Save to Inbox leaves no alias behind.

- Fragment completion searches every note (PIE-424; fixes PIE-295's
  "Searched only 500 blocks"). `fragments.candidates` finds `((note#heading` /
  `((note^anchor` targets across all active notes by the service's fragment
  rules, the draft's note first; an unanchored heading comes with the anchor it
  would get, and `fragments.ensure` writes it with a revision check. Detail,
  Tree and Quick Capture use them (with the old bounded search against an older
  service). `transclusions.read` now sends each note and its steps once, parses
  a note once per revision, stops scanning a document past its 17th embed, and
  caps a read at 512 KB (`EMBED TOO LARGE`). Additive capabilities
  `fragments.candidates`, `fragments.ensure`.

- Workspace and connection: Copy on **Client protocol** copies the number
  alone; "needs service ≥ N" is the field's note, shown as before (PIE-355).
  After leaving an edit with retained writing, the status names Alt+R and the
  actions menu; compact chrome has no header cue for Writing history.

- The service owns fragment slices and nested transclusion (PIE-424).
  `fragments.read { blockId, fragmentId }` returns what `((id^fragment))`
  covers: its kind, label, note lines, offsets and the text a reader shows (a
  step with its nested content, a heading's section, a paragraph), or
  `missing` / `duplicate`. `transclusions.read { targets, hostBlockId?,
  maxDepth? }` projects `!((id))` and `!((id^fragment))` nested to a bounded
  depth (default 3, ceiling 6), stops at a cycle (`CYCLE · this embed is
  already open above it`) and past the depth (`DEPTH LIMIT · embeds nest N
  deep`), keeps Detail's 16-per-document limit, and caps a read at 64 embeds;
  each ready projection carries the checklist steps inside what it shows.
  Both are additive capabilities; no protocol bump. A heading's section no
  longer ends at a `#` line inside a code fence, and fragment completion no
  longer offers headings inside code. Detail's embeds take their limit and
  wording from the same module (`src/transclusions.ts`), and neither Detail
  nor `transclusions.read` expands `!((…))` written inside fenced or indented
  code.

- Clients name their outline on the outline host (PIE-457 step 3).
  `OutlinerClient` sends `outline` on every request and subscription, and
  refuses a single-outline service when a name is asked for. The endpoint is
  `OUTLINER_OUTLINE` (global CLI flag `outliner --outline <name> <command>`),
  else one folder rule (`resolveFolderOutline`): the nearest bound folder
  walking up (`client.json`), else the git repository root's name, else the
  folder's name, never `$HOME`, `/` or `/tmp`-like folders (those need a name;
  Ctrl-b u shows the chooser). A guess applies once a host is set up
  (`outlines/` exists), also while it restarts: such a client waits for the host
  and never falls back to a hash database. `outlines.attach { name, create,
  root? }` and `outlines.create { name, root? }` record the outline's folder in
  `outlines/<name>.json`; its resources, file links and Inbox use it, and a
  guess from another same-named folder does not take it. Only the opens that
  open panes create (not `focus-existing`, not Pi's check). Panes register
  their outline; Herdr actions invoked from a pane (ensure-detail,
  focus-existing, link clicks, comment on selection) use it through the host's
  new `outlines.pane`. Herdr panes all get `OUTLINER_OUTLINE`; no service pane
  in host mode. New host requests `outlines.close` and `outlines.delete`; new
  action **choose-outline** (the switcher). `outliner outlines` lists an
  adopted database once, with `running`/`stopped`/`broken` from the host.
  `doctor` shows the host and how the outline was chosen. The host exits after
  5 contained faults within a minute, for systemd to restart it.

- One outline host per user and machine (PIE-457, steps 1 and 2). `bun run host`
  (`src/host-main.ts`) listens on `<state root>/outliner.sock` and serves every
  outline in `<state root>/outlines/`: it reads the first line of each
  connection and hands the whole connection to the outline its `outline` field
  names, or to `OUTLINER_DEFAULT_OUTLINE` when it names none, so existing
  clients reach the default unchanged. Outlines open on their first request and
  stay open; one that cannot open (corrupt, or held by another process) fails
  only its own requests. The host answers `outlines.list`, `outlines.create
  { name }` (the only way a new outline is born) and `outlines.adopt { path,
  name }` (serve an existing database where it lies, through a symlink; refused
  while another process holds it). `ping` adds `host` (capabilities
  `outlines.list`, `outlines.create`, `outlines.adopt`, `ping.host`,
  `request.outline`). `outliner outlines` lists through a running host, and
  `outliner outline create <name>` / `outline adopt <path> <name>` ask it.
  The single-outline service is unchanged and refuses `outlines.*`.

- Outlines have names (PIE-457, service side). Each database describes itself
  in `outline.json` (`name`, `root`, optional `label`, `host`, `created`,
  `updated`), written by the service on start. A new outline is named by
  `OUTLINER_OUTLINE_NAME` or its folder's basename, with a numeric suffix on
  collision; a name is unique in the state root, and a service refuses to start
  when another outline, running or stopped, has its name. While running, the
  service publishes `<state root>/by-name/<name>.sock` and `ping` reports
  `outline` (capability `ping.outline`). `outliner outlines [--json]` lists
  outlines by scanning; `outline rename` and `outline set-root` change a
  stopped outline explicitly (by name or storage key; an ambiguous name is
  refused), and `OUTLINER_OUTLINE=<name>` starts the service
  on a moved outline's existing database. Starting by folder at a root another
  outline already claims is refused instead of creating a second database.
  Writing the descriptor or the link never stops a service: failures are
  logged and it keeps serving on its hash socket, and an unreadable descriptor
  is left in place. Clients still address local outlines by hash until they
  resolve names.

- Who moved, trashed or restored a block: `move`, `delete` and `trash.restore`
  accept an optional `mutation` (capability `mutations.provenance`), recorded
  like an update's in the change feed's `actor` and in activity, as `move`,
  `delete` or `restore` entries. `activity.recent` returns them when asked with
  `kinds`; by default it still returns edits only. Without `mutation` nothing
  changes. The CLI's `move` and `delete`, the new `restore`, and Pi's
  `outliner_move` say who made the change, as do the Tree's and Detail's
  moves, trashing and restores (the person, through `tree` or `detail`) and the
  Inbox worker's (`inbox-agent`, as its edits already were). A trash entry is
  hidden once its block is out of Trash. The CLI's `--author agent` now needs
  `--actor` on every write, including `create` and `update`. The activity table
  is rebuilt once on startup to allow the new kinds, keeping every row whose
  block still exists, its ids and cursors; the rebuild checks its copy before
  replacing the table. **Downgrading:** an older build reads the new `move`,
  `delete` and `restore` rows as if they were edits (Pi's recent-edit context,
  note assistance and edit recovery would count them), and its own table
  definition keeps the widened check. PIE-451.

- Items with several deliveries: `work deliver --key <name>` records a PR as
  its own delivery (`PIE-123/<name>`); without a key, a PR in another
  repository than primary's is named after its repository instead of failing
  with "conflicting repository". `work complete` takes several `--delivery`
  values or `--all-merged`, and is refused while any other delivery is
  incomplete, naming it and how to finish it, so none is left in Validate under
  a Done item. `work set <delivery> delivery-stage complete|validate` finishes
  or reopens one merged delivery, revision-checked. `work help` prints the
  synopsis. Pi's task completion and the Claude `work_*` tools share the same
  rules. No service change. PIE-447.

- Agent workboard commands: `work create`, `work stage`, `work set`,
  `work deliver`, `work complete`, `work body` and `note section` in the CLI,
  and matching `work_*` / `note_section` tools in the Claude mod. Items are
  named by Work ID or block UUID; writes are checked against the revision read
  and read back; results name the Work ID, block reference and new revision.
  `work deliver` reads the PR through `gh` and refuses one whose branches differ
  from the delivery's; `work complete` needs the named delivery merged and
  records the proof. Pi's task completion uses the same code, and a
  multi-paragraph `outliner_publish` artifact is now typed as block metadata
  rather than as an inline property. PIE-438.

- Literal regions: text between `<!-- literal -->` and `<!-- /literal -->`
  lines shows outline syntax as plain text. Bracket, bare `key::` and hashtag
  properties inside are not stored, queried, indexed or previewed; links still
  resolve. Detail hides the marker lines and warns about an opening marker with
  no closer, which protects nothing. Titles skip marker lines. A property
  appended to a note that starts with a region goes on a line before it, where
  it is block metadata. Property parser version 4: the service
  re-indexes existing notes on startup without changing their text, and
  `properties.preview` reports `parserVersion` 4. PIE-422.

- Detail comment threads render comment and reply text like note text:
  `[[pages]]`, `((blocks))` (with resolved titles) and Work IDs are links you
  can click or reach with Tab and open with Enter, and bold, italics and code
  render. Headings, fences, tables, rules and HTML blocks in a comment show as
  plain lines so the thread box stays intact. A link that wraps is one Tab
  stop, `<https://…>` links its address and `[1]: https://…` lines stay
  visible. Block titles for every comment come from one request; if the
  service is slow, comments show linked block IDs instead of waiting. Backlink
  titles and snippets containing `[` no longer show stray backslashes, and a
  backlink title such as `Meeting [draft] notes` links as a whole. No service
  change. PIE-421.

- Tree's **Advanced property filter** accepts the query grammar: `OR`, `NOT`,
  parentheses and `created`/`updated` ranges, for example
  `status=open OR status=review` or `NOT status=done updated >= -7d`. Clause
  lists are sent exactly as before and keep their meaning, including
  `deleted=true`. Invalid queries show the character position and keep the
  previous filter. Uses the existing `query.expression` capability. PIE-192.

- Content events now say what changed: block, parent (and previous parent for
  moves), revision, change kind and declared actor. A client that reconnects
  can ask `changes.since` for exactly what it missed, in order, or get an
  explicit reset when history is gone. Tree skips index reloads the feed shows
  are already reflected and keeps its index across a reconnect with no changes.
  The service advertises the `changes.since` capability; restart the service
  to use it. PIE-399.

- Clients negotiate with the service instead of requiring the same protocol
  number. `ping` reports `capabilities` (`blocks.read`, `properties.preview`)
  and the oldest client protocol it serves; a newer service is accepted, and a
  client fails with a restart instruction only when the service is too old or
  lacks a capability it uses. `doctor` lists the service's capabilities.
  Additive features now add a capability rather than bumping the protocol.
  Protocol 82 introduces negotiation, so restart the service and clients once
  when upgrading. PIE-402.

- Saved views and block queries can use `OR`, `NOT`, parentheses and
  `created`/`updated` ranges: `work-stage=review OR work-stage=validate`,
  `NOT status=done`, `NOT priority`, `updated > 2026-09-20`, `updated >= -7d`.
  Existing clause lists keep their meaning. Invalid queries fail with the
  character position (`views.read` problems, `blocks.query` error `problem`)
  instead of returning nothing. Available in `[query::…]`, `blocks.query`
  `expression`/`where`, CLI `list --query` and `outliner_query`. Service
  capability `query.expression`; restart the service to use it. PIE-398.

- The service evaluates saved virtual-branch views. `views.read` returns a
  view's members in branch order with its authored limit, paging (`offset`,
  `nextOffset`), an exact `total`, truncation and structured errors, from one
  read transaction. Tree, the branch navigator, Detail view embeds, CLI `view`
  and `outliner_view` now read membership through it instead of evaluating the
  query themselves. Service capability `views.read`; restart the service to
  use it. PIE-397.

- Keep ticket-key autolinks outside complete Markdown URL spans. Plain and
  angle-bracket URLs, including Jira smart links, stay one destination through
  narrow wrapping; adjacent bare ticket keys still open local pages. PIE-392.

- Install the declarative status-summary renderer independently of the app.
  Detail, Tree Preview and Inbox Preview share responsive labelled counts,
  links, copying and comments. Disabled or missing installations preserve
  readable, editable source; reopen the note after configuration changes.
  Resizing and folding retain the open document’s renderer settings.
  Installation lifecycle and narrow-reader behavior now have a repeatable
  native application journey. PIE-382.

- Detail and Preview share cell-level source evidence for rendered copying and
  comments, including formatted text, tables, Unicode and repeated embeds.
  Comments retain immutable quotes and separate source fragments; ambiguous
  edits stay unpositioned. Saved Inbox versions retain their processing attempt
  and cannot assign IDs into live checklists. A developer provenance inspector
  explains source ranges and generated cells. An optional declarative status
  component uses the same responsive layout and evidence contract. Protocol 81
  adds passage observations and fragment resolutions; restart service and
  readers together when upgrading. PIE-350.

- Create a quoted block comment through `outliner_comment` or CLI `comment`
  without constructing annotation internals. Exact quotes require unique context,
  stale revisions fail atomically, and retrying a saved request does not duplicate
  comments even after checklist identity assignment. Source-aware readers share
  quote resolution. Protocol80 adds the convenience operation to the existing
  annotation batch ledger. PIE-377.

- Agents and CLI users can read saved virtual-branch matches in branch order
  without opening a pane or translating the query. Reads honor authored limits,
  report incomplete/invalid/unsupported results and reject mixed reads after a
  concurrent workspace change. Tree and agent reads share membership evaluation.
  PIE-376.

- Checklist steps keep stable fragment addresses through rewording and reordering.
  Pi/ANSI Detail and Preview offer monochrome status pickers, keyboard toggling,
  Copy step link and Undo, including embedded steps. Targeted agent updates
  preserve neighboring text; whole-note rewrites require explicit intent to
  remove task addresses. Comments follow item identity while retaining their
  original quoted evidence. Live checklist views correlate status and properties
  on the same step across canonical plans and update their originals. Protocol
  79 adds checklist operations and item-attached annotation targets. PIE-367.

- Tree groups root comment threads under one collapsed Comments row per displayed
  note. Open it by mouse, Space or Enter; replies remain under their own thread,
  ordinary children remain visible, and physical/virtual occurrences expand
  independently. Direct reveal opens the comment path without copying or moving
  discussion. Counts name projected root threads, excluding replies. PIE-383.

- Detail Comment supports a whole-note target without selecting text. General
  comments appear under Note comments, separate from lost passage anchors.
  Detail's local Preview composes and replies in place, preserving Current and
  protecting unsaved Preview drafts. Local Tree and Inbox readers share comment
  display and composition; Inbox Before comments retain their saved receipt and
  source identity. Comment typing takes precedence over Inbox shortcuts.
  Drag-selected local Preview passages retain their quoted text without guessing
  source offsets. Inbox navigation and receipt updates preserve active drafts;
  completed Escape input no longer consumes the next Tree shortcut as Alt.
  Keyboard passage selection uses v, arrows and Shift+arrows in the visible
  Preview viewport. Preview comment actions appear in the shared action menu
  and have their own configurable shortcuts, separate from Tree browsing.
  Short composers keep writing and save/cancel controls visible. Saved-version
  readers preserve proven historical ranges; unchanged plain text can retain
  exact coordinates while transformed layouts keep honest quoted evidence.
  Protocol 78 adds the whole-subject anchor and captured Preview/Inbox evidence.
  PIE-290.

- PIE-396: Tree `/` temporarily fuzzy-filters the selected occurrence's descendants,
  preserves rank and ancestry, searches collapsed content within projection limits,
  and restores the browsing context on Clear/Escape. The selected-items menu adds
  full-order before/after placement; filtered nudges explicitly include hidden items.
  Structured property queries remain under Advanced property filter.

- Collect Tree items with `x` or row checkboxes, inspect the finite set with
  `Shift+X`, copy canonical references or verified page links, and rank selected
  roots together in an unsorted virtual branch. Focus stays independent;
  selections survive restarts with explicit recovery and Clear. Protocol 77.
  PIE-240.

- Compact Tree, Detail and Preview chrome gives rows back to content. Shared
  searchable menus retain actions and shortcuts, Expanded layout remains
  available, and document titles use the Herdr frame with a standalone fallback
  and respect for custom pane labels. Density is a client preference; note text
  stays unchanged. PIE-385.

- Fold headings and nested list content locally in Pi Detail and Preview. Mouse and keyboard disclosures preserve nested choices, hidden links leave navigation, and fragments or comments reveal their enclosing sections. Copying omits generated arrows without deleting authored glyphs. Fold state never changes canonical text. PIE-386.

- Properties supports direct value copying and link following. Ordinary values copy on click; linked values expose a separate Copy control. Full canonical values survive wrapping, repeated keys stay distinct, and multiple embedded links have individual mouse/keyboard targets. Editing remains explicit. PIE-387.

- Quick Capture can dock left, right or below the Outliner and return to a popup while preserving its draft, cursor and selection. Editor launches use the existing recovery journal; History / Ctrl+R reviews conflicting writing before a revision-guarded save, and short panes keep the editor cursor visible. Prepared notes stay protected from assistance until Save to Inbox. A global `capture-editor` action opens that same note directly in a right sidebar editor; repeated entry returns to the live owner instead of opening a competing draft. Protocol 76. PIE-335.

- Workspace and connection groups diagnostic fields and supports drag-copy, per-value Copy buttons and keyboard field navigation. Long values copy in full without labels or wrap breaks; remote client paths stay distinct from service storage. PIE-355.

- Ordinary mouse selection and copying no longer protect Detail navigation. Retained quotes are retired when the document changes, including delayed capture replies; actual edit and comment drafts remain protected (PIE-384).

- Add a canonical first child directly from a virtual-branch result in Tree, retaining the exact occurrence context. Collapsed results open locally; depth and row-budget limits refuse before creation. PIE-148.

- Reordering a virtual branch works when that same branch also appears in another projection. Moves stay within the selected appearance and update the shared branch order, including hub embeds. PIE-395.

- ANSI Detail keeps the writing-recovery dialog visible when its pane is resized; redraw no longer waits for the open dialog to finish.

- Remove redundant test-only Store/Pi surfaces while retaining coverage through production APIs. PIE-369.

- Tree Enter opens the selected note without leaving Tree; repeat within one second to focus the same Detail, or use Alt+Enter to open and focus immediately. Draft protection and missing-destination recovery still apply. Protocol 75 requires updating the service and clients together. PIE-364.

- Jira is an installed read-only Resource extension with explicit Basic/Bearer authentication; built-in Jira HTTP, ADF and comment code is removed. Source credentials now belong to extension configuration. Protocol 74 fences the changed Source contract; service and clients must be updated together. PIE-380/381.

- Detail labels retained drafts as Writing history; actual recovery errors keep their needs-attention message.

- External-editor return automatically combines independent canonical edits into the current draft, including a newly added final newline. Clean merges no longer require the multi-version recovery dialog; Ctrl+S saves with the revision guard and exact original writing remains recoverable. Actual overlaps still require review. PIE-365.
- Human note edits can remove a `[page::…]` declaration when saving. The note and existing aliases remain; stale saves and Work ID changes still fail atomically.

- Claude Code Recent Mentions follows sessions into subdirectories of configured workspaces. The nearest configured ancestor supplies the destination database; similarly named siblings remain excluded.

- Bare external ticket keys such as PC-7 link to registered local page addresses alongside the workspace's own Work IDs. Tree, Detail, Preview, Backlinks and Recent Mentions share recognition; external keys never allocate tickets or fetch Jira during rendering. PIE-357.

- Quick Capture shares contextual reference completion with Tree and Detail, including pointer insertion, multiline drafts and Escape-to-dismiss (PIE-232).

- Tree’s Workspace and connection action and CLI `doctor` expose resolved config, endpoint and service storage identity without creating or moving data. Startup failure logs include connection paths. Actual laptop relocation recovery remains a separate verification step (PIE-337).

- Detail and Tree reference completion filter while typing, show target kind and selected context, and accept mouse or keyboard choices through one provider. Escape retains the draft; stale replies and deleted/reassigned targets cannot silently insert old choices. Work-ID labels omit nested reference syntax. PIE-295.

- Authored local file references open in Preview beside the daily note through keyboard or mouse, retaining Current and its draft. Rendered Markdown file links navigate to outline pages; missing files show an error without replacing the note. PIE-323.

- Cleaned and split notes link directly to Original capture; later rewrites also expose Before this rewrite. Merges preserve each source, snapshots reuse Inbox recovery evidence, and Preview follows them in place. New cleanups establish the links atomically. Protocol 73. PIE-345.

- Detail retains returned external-editor writing and ordinary save conflicts in a visible Recover writing flow. Compare original/local/latest versions, combine independent edits, request a reviewable Pi proposal, or keep a separate quoted draft. Recovery survives reopen; saved history offers Restore draft and Undo save as new reviews. Canonical saves remain revision guarded. Protocol 72. PIE-333.

- Pi Detail includes document body links in Tab/Shift+Tab traversal, with visible focus and canonical Enter activation. Property focus follows scrolling and keeps wrapped entries visible after resize in Current and Preview. PIE-346.

- PIE-331: Jev routes Inbox captures to keep, metadata, reversible archive or Pi editorial work; activity records the decision. Editable prompt and paired live comparison document costs, recovery and limitations.

- Inbox proposals can repair validation errors before finishing, within the same Pi session and budget. Attempt history explains retries and failures; prompt evidence shows active/package differences. PIE-330.

- Inbox activity reports effective metadata changes and no-ops, labels aggregate model-work time, and retains visible structured omissions for bounded retrieval, incomplete reads and skipped/failed relationship checks. Historical coverage stays explicitly unknown. PIE-328.

- Recent agent mentions in Tree/Detail menus, with canonical previews, conversation scope, message context, clear/save/bookmark controls, and a workspace-scoped Codex completion adapter. Protocol 71 requires a coordinated service/client restart for the new mention RPCs. PIE-325.

- Tree connection groups include Backlinks and support explicit nested disclosure on resolved block targets. Siblings retain independent state; cycles expand only by user action. PIE-324.

- A missing or closed linked reader offers Enter/click to Open here once, a destination choice, or Cancel. Tree and Inbox keep their list while Detail retains draft protections. PIE-332.

- Outlinks omit repeated titles and Work-ID prefixes while retaining custom labels, fragment names and occurrence counts. PIE-329.
- Tree and Inbox Preview follow links in place, with local Back/Forward history, keyboard link selection and explicit Open in Detail. Dragging links still copies text. The destination picker retains the browsed target. PIE-326.

- Inbox review shows Activity above independently scrollable Source/Output readers when space permits, with draggable dividers and a compact fallback. Inspect saved **Before this attempt** text without Undo; current source remains separate. Technical details collapse and errors remain visible. PIE-320.

- Inbox history can be searched across all retained attempts using original capture titles, summaries and current Source/Output text. Text matches remain usable offline; optional Jev reranks a bounded shortlist using the editable Goto prompt. Cancellation restores the browsing context. The new `inbox.search` RPC requires protocol **70** and a coordinated service/client restart; capability negotiation remains a separate architecture follow-up. PIE-319.
- Inbox now opens typed Source/Output content instead of incidental session logs, exposes reader linking, and shares Tree's rich Preview reader with separate Activity controls. PIE-317 / PIE-318.
- Tree Preview has mouse controls for visibility, right/bottom/automatic placement, size buttons and divider dragging. Prefix+Shift+U and **? → New Tree** open an independent Tree without a companion Detail. PIE-315 / PIE-316.

- Clicking Tree returns keyboard focus from local Preview in beside/below layouts. Delayed selection-publication echoes cannot replace a newer Preview.

- Creating a Detail from Link destination now links the original view to it, including sidebar placements. Ordinary split commands keep their existing links.

- Tree now keeps an interactive projection-aware breadcrumb and reclaims offscreen ancestor indentation (PIE-304).

### Capture and AI instructions

- Tree can focus an occurrence as its root or open independent rooted Tree splits. Shift+Left/Right fold/reveal one hierarchy layer. Nested query results survive collapse of their physical source folder. PIE-303 / PIE-292.
- Inbox deadlines fail only the current note and let other pending work continue. The total editing budget defaults to five minutes and can be configured with `OUTLINER_INBOX_TIMEOUT_MS`. PIE-310.
- Inbox editing and bounded note answers retain native Pi sessions per attempt. Select an activity result and press `t` to inspect its transcript through the service; early interruptions are explicitly labelled snapshots. Canceled attempts remain inspectable without suppressing retry or consuming new instructions. Protocol 65; restart service and clients together. PIE-311.
- New and meaningfully edited ordinary notes receive automatic type/tag assistance. Hashtags share the property index, semantic calendar tags follow authored dates, and human corrections survive restart. Direct supported requests can be answered in the original note; complete property inventories bypass autocomplete limits. Existing notes require explicit opt-in, and tickets/other managed records retain their contracts. PIE-302.
- The hashtag/property change requires protocol 64. Restart the service and all clients together, including remote clients; older editors use incompatible property positions.
- Inbox opens directly on outstanding questions or errors, including failures older than the recent-results page. The highlighted attention count and destination-labelled shortcut keep unresolved work easy to find; history remains available without automatic view switching.
- Quick Capture retains text and cursor across closing/reopening, inserts new captures at the top of Inbox, and supports generated titles for `/send-to-outline`. Payload-bound receipts and retained uncertain submissions prevent a retry from discarding newer text. [#84](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/84), [#85](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/85), [#86](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/86), [#120](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/120)
- A service-owned automatic Inbox editor uses the configured Pi model, with optional Jev relationship judgments. Tree `Shift+I` opens results, questions, Pause/Resume, guarded Undo, and directed reconsideration. Ordinary notes stay notes; concrete tasks enter Backlog without joining a committed batch. This is a single-user editorial experiment. [#141](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/141)
- Inbox and Goto instructions are editable Markdown/JSON file Resources. Saved changes apply to the next job/search; running jobs keep their captured instructions. Workspace prompt files survive upgrades, and results retain their exact text, path, and hash. Invalid files produce visible errors instead of stale fallbacks. [#142](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/142)

### Navigation and reading

- **? → Inspect received keys** in Tree/Pi Detail shows raw bytes, Unicode and decoded modifiers inside the existing pane. It distinguishes Option-produced characters from actual Alt shortcuts without executing them. Ctrl+Q closes only the inspector; no keystroke log is persisted.

- Standalone Tree keeps rich Preview beside its own rows regardless of detached Details. Tree and Detail expose persistent **Opens in / Change**, with Shift+L as an Alt+L fallback. Link settings remain available in Properties; active edits/filters receive an explanation without losing their text. New readers can be placed beside another Detail, or as left/right sidebars around the Outliner area or whole Herdr tab. Existing terminal sessions and saved links survive placement. Protocol **69** requires a coordinated service/client restart. PIE-305 / PIE-306.

- Tree/Detail destination pickers show document titles, Herdr workspace/tab locations and a rich selected-document preview; unlocated/other-host readers are opt-in. Preview uses available beside/below space, supports `Alt+P` and contextual Escape, and Tree-local Preview wraps Markdown and bounds pointer selection/copy. Each Tree can compare viewport versus selection indentation with `Alt+I` or its Indent badge. PIE-304 / PIE-305 / PIE-306.

- `Alt+L` in Tree or Detail chooses its linked destination. Explicit Open follows that source-to-Detail link or a one-off destination. Pane movement does not change links; missing destinations report recovery choices without automatic splits. Current stays in place while passive selection updates a separate local Preview (`F7` switches, `Shift+F7` closes, `Alt+Enter` keeps). Drafts and active source selections protect replacement. Runtime reader locks and spatial reader pools are removed; transient watchers register as observers. Herdr reader reuse follows the Tree’s link. PIE-223 / PIE-305 / PIE-306.
- Protocol **68** removes reader-lock wire fields and adds the observer role. Restart service and all clients together. Workspace ownership locks and retained Resource revision protection remain independent. PIE-306.

- Tree `g` opens searchable results with location context and a document preview, in a Herdr popup or inside Outliner. Optional Jev ranking scores up to 80 text-selected candidates; 30 results are shown with limits disclosed. Exact identities and ordinary search work without Jev. [#139](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/139)
- The opt-in `open-composed` action places Tree and Detail in one pane, with local navigation, independent view state, `F6` region switching, and explicitly detached readers. The separate-pane layout remains the default. [#133](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/133)
- Reorder appears in the action menu and keybinding registry. Defaults are now Option/Alt+Up/Down for Tree reorder and Option/Alt+Shift+Right/Down for independent Details. At that release, locked Detail used `🔐` and unlocked used `🔓`; PIE-306 removes both indicators. [#138](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/138), [#136](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/136)
- Nested Tree inline previews stay occurrence-local. Bookmark mouse reports no longer trigger the keyboard removal shortcut. [#134](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/134), [#135](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/135)
- Canonical bookmarks, virtual-branch navigation, explicit Detail destinations, attention marks, typed walkthroughs, and external editor handoff support longer reading sessions. Editor recovery preserves drafts and discovers the interactive-shell editor configuration. [#78](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/78), [#79](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/79), [#103](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/103), [#105](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/105)

### Resources and comments

- Durable Resource UUIDs and provider-qualified Sources cover filesystem, web, PDF, Jira, Linear, application, and computed providers. Immutable snapshots and representations retain provenance and provider revisions; host negotiation and dependency-aware retention preserve the same identity across presentations. [#90](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/90), [#97](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/97), [#98](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/98), [#99](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/99), [#100](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/100), [#101](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/101)
- Tree **Show authored links** projects Outlinks and Resources without creating targets. Detail activates authored `[file::…]`, `[web::…]`, `[jira::…]`, and `[app::…]` occurrences by exact block revision and source span; repeated references stay distinct in Properties while sharing one Resource. [#111](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/111), [#130](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/130)
- Durable block and Resource annotations retain original evidence and append-only reconciliation history. Direct selections support filesystem text, cached web Markdown, and extracted PDF text; unresolved changes can receive bounded agent-assisted proposals. [#94](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/94), [#95](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/95), [#96](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/96), [#108](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/108), [#110](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/110)
- Comments distinguish a Resource-wide thread from a particular authored reference and its passage. `[`/`]`, `Shift+C`, and `Shift+D` navigate, reply, and resolve/reopen in place. Stale or ambiguous anchors remain reachable under **Unpositioned comments** instead of marking unrelated text. [#129](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/129), [#131](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/131), [#132](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/132)
- Multiline comment composition uses the actual body geometry to keep the cursor visible. [#112](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/112)

### Persistence and recovery

- A service acquires exclusive workspace ownership before writable startup, migrations, or recovery, so a competing launch cannot interrupt the active owner's work. [#119](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/119)
- Normal text writes require the integer `Block.revision` from the original read. Stale writes fail atomically; sibling moves no longer invalidate unchanged text drafts. Filesystem revisions also include a hash of the original bytes. [#121](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/121), [#122](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/122)
- Filesystem saves retain the submitted draft and displaced original, preserve competing replacements, and recover interrupted saves. Recovery directories remain available for manual inspection and cleanup. This is recoverable replacement with a brief absent-path interval, not atomic compare-and-swap. [#128](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/128)

### Remote work and performance

- Tree, Detail, popups, CLI, and Pi clients connect through an SSH-forwarded Unix socket. Endpoint configuration is project-scoped, pane identities are host-scoped, and remote Tree/Detail startup opens both panes before awaiting registration. [#115](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/115), [#116](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/116), [#117](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/117)
- File previews and completion read from the canonical service host, including remote clients; passive reads create no Source or Resource. [#123](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/123)
- Tree loads a complete compact structural index and fetches exact bodies on demand. Detail paints primary content before optional enrichment, while its 32-target revisit cache revalidates revisions and passive preview scheduling keeps the newest target. Reused virtual projections and indexed ranked queries remove repeated work without adding a persistent search index or cursor system. [#124](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/124), [#125](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/125), [#127](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/127)

### Workflow and onboarding

- Roadmap items use `work-stage` alone, with Queued replacing Next and Superseded separate from accepted Done. Item-side `work-batch` references preserve committed scope through progress, pause, and completion. Resume and unchanged PR synchronization preserve explicit review/rework state. [#137](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/137)
- Fresh databases use workspace seed version 5. **Explore the Outliner** adds addressable feature guides and working reading/projection examples beside the existing agent documentation guide and authored-links example. Existing databases retain their customized content; package upgrades do not reinstall the seed.
- The guided installer and portable runtime discovery support source-checkout installation. Actual Herdr keyboard journeys use isolated workspaces and retain failure evidence. [#82](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/82), [#83](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/83), [#114](https://github.com/float-ritual-stack/pi-herdr-outliner/pull/114)
- The current JSON-lines RPC protocol is **78**. Restart the service and all clients together when upgrading across incompatible versions; `src/types.ts` owned the version then (today it is `PROTOCOL` in outline-core).

### Known limits

- Tree-generated Resource opens require a valid linked Detail; missing or protected destinations fail before registration. Resource references inside Detail use its shared chooser.
- SSH authored references are application deep links, not source-backed remote files. Tracked as PIE-261.
- Metadata-only Resource fields cannot yet receive direct Detail comments. Tracked as PIE-262.
- Computed and remote-entity cached Markdown cannot yet create direct Detail text annotations. Tracked as PIE-264.

### [0.1.0-dogfood.1] - 2026-08-22

- First tagged dogfood build of the workspace-scoped Outliner service, Tree, Detail, block graph, properties, references, virtual branches, and Pi/OMP integration.

[0.1.0-dogfood.1]: https://github.com/float-ritual-stack/pi-herdr-outliner/releases/tag/v0.1.0-dogfood.1
