# Yo

Ask `@yo` how to do an ep0ch thing and get two lines quoted from the action's own doc, with a button. Say `@yo do it` and it presses it for you, attributed to yo, as one undo step, and next time it answers from memory. Ask it to find notes and it answers with them, and the query that found them.

```text
@yo how do I lift the agent again
> `agent.lift`: "lift the agent tab you're using above everything as a column"
> keys: ✦a · ^W Z
> ▲ lift

@yo do it                              ← yo presses it, in your door, as yo
> ✓ yo pressed ▲ lift · undo

@yo lift                               ← a week later, from memory, no model

@yo find me all hub items that are not sent yet
> 2 notes: `type=hub-item NOT status=sent`
> - ((…|Seed swap flyer))
> - ((…|Shed rota))
> read: hub items → type=hub-item · not sent → NOT (status=sent)
> ▸ open in facets   ▸ edit the query   ▸ save as a view
```

## What you do

- **Ask on a line:** write `@yo …` on its own line in any note, then go on to the next line (or save). The answer opens under the ask.
  - **A pause never sends half an ask:** while the cursor is on the line, it says `asks once you leave the line or save`.
  - **Ask again:** delete the ask and write it again, and yo answers again. An undo that brings the ask back brings its answer back too, with no new run.
  - **Every ask is heard:** a note's tenth ask like its first, and the same words asked again further down get an answer of their own.
- **Find notes:** `@yo find me all hub items that are not sent yet`, `@yo list the plans tagged garden`, `@yo which notes are drafts`.
  - **The answer:** up to ten notes as links, the query that found them, and how it read each word (`not sent → NOT (status=sent)`).
  - **Its buttons:** open it in a facets tile, put it on that tile's query line to edit, or save it as a view (you name it).
  - **Where the query comes from:** the outline's own facets, read by the service (`query.suggest`, Jev picking): yo keeps no list of properties.
  - **Without Jev:** it says so and offers your words on the facets query line.
  - **Nothing found:** the query, and the keys nearest your words.
  - **Told by its words:** "find", "list", "show me the…" or "which notes…" is a find, and code decides before any model.
  - **Not a find:** "how do I find…" is a how-do-I.
- **Ask about a tile:** `ask yo about this` in a tile's menu, `ask yo` in the power bar, or `✦y` (the key note under this page).
  - **From a shell:** `ep0ch act agent.ask to=yo about=tile`.
  - **Where it lands:** a thread on the note in that tile; a tile with no note, on this page.
- **Have it pressed:** `@yo do it`, or the button yourself. In a thread, reply `@yo do it`.
  - **A question never presses:** `how do I…`, `what's the key for…`, `is there a way to…`, or anything ending in `?` gets the quote and the button. Code reads the words before any model runs.
  - **A command presses:** `@yo lift the agent` (the act model fills it in, once).
- **Take it back:** the `undo` on the done row. An action that changes no note and no layout has none, and a press that changed nothing (dropping what wasn't lifted) has nothing to undo: the row says which.
- **The button's words** are the action's own: the `::button` its doc gives for those arguments (`agent.lift on=false` reads `▼ drop`), else what its key for them does (`backlinks.view step=kind` reads `▸ by kind`), else its verb.
- **The argument the ask names:** `@yo how do I see backlinks by kind` answers `backlinks.view step=kind`, and its keys line names that key alone: `K: by kind`.
- **The way there:** an action of a tile you don't have open (backlinks.view needs a backlinks tile) gets a button that opens it first (`links`), then does it, one press.
- **A note action** (`note.rename`'s `▸ rename`) pressed in the answer tile beside your edit acts on your note: the title changes in your edit.
- **See how it knew:** the steps fold under each answer: what it read and each model call, with its cost.
- **Ask about yo:** `@yo how do I use you`, `@yo how do I set you up` or `@yo whats good` answers from this page and its settings, with no model, and a button to its settings.
- **Banter:** `@yo mamama` gets one line in character, then quiet.
- **Not yo's:** anything about your projects or the repository. It says so in a line.

## What it remembers

- **Where:** one note per fact in the `yo` outline (`config.memory`), each `[yo-memory::answer]` or `[yo-memory::habit]`. Read, fix and delete them like any note.
- **When:** a pressed button or a `do it`, never on every ask.
- **With what:** the arguments that worked, so `agent.lift on=false` comes back as that.
- **When notes disagree:** an exact ask wins; otherwise yo shows each and asks which.
- **Not kept:** what you're in the middle of, and what your projects are about.
- **A habit** you write yourself (`the lift goes on hyper [yo-memory::habit]`) goes with every ask.

## What it costs

- **Nothing:** a memory hit and `do it`.
- **Haiku:** an ask it has to pick for (`config.answer`).
- **Sonnet:** an ask to act now, once (`config.act`). Code steps up, never the model.
- **No model:** an empty `config.answer` still answers, with the closest action by its words, and says so.

## Setup

- **Install:** `ep0ch ext add yo`, or `&` in the power bar.
- **Its memory:** `ep0ch outline create yo` on one machine, and `ep0ch mcp access full --ws yo` when other machines read it.
  - **From another machine:** `ep0ch act ext.yo.settings memory='{"outline":"yo","machine":"<ssh-name>"}'`.
  - **Before there is one:** yo answers anyway; its first step says `no memory yet` with the command that makes it.
  - **While it can't be reached:** yo answers without it and says so in its steps.
- **The models:** each default is `claude` in safe mode, sending only the prompt.
  - **Change one:** ⚙ settings on this page opens the settings screen at yo: each command as one line you can read and edit in place.
  - **Try one:** `t` (or `[try]`) beside it runs it once and says its answer, or why not in its own words ("Not logged in"). A failed answer offers the same button.
  - **Where `claude` can't read its login** (a host under launchd): `with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN` once; with none, the answer's steps and its try say that command.
  - **No model:** `ep0ch act ext.yo.settings answer='[]' act='[]'`, or `[]` in its settings form; `unset=answer` puts Haiku back.
- **`door.act`** is the primitive under the button: an agent's process asks the door to run one action line, as the agent, and gets its undo id ([Agents in the note](../../docs/extensions/README.md#agents-in-the-note)).
