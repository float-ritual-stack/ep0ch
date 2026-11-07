# Yo

Ask `@yo` how to do an ep0ch thing and get two lines quoted from the action's own doc, with a button. Say `@yo do it` and it presses it for you, attributed to yo, as one undo step. Next time it answers from memory.

```text
@yo how do I lift the agent again
> `agent.lift`: "lift the agent tab you're using above everything as a column"
> keys: ✦a · ^W Z
> ▲ lift

@yo do it                              ← yo presses it, in your door, as yo
> ✓ yo pressed ▲ lift · undo

@yo lift                               ← a week later, from memory, no model
```

## What you do

- **Ask on a line:** write `@yo …` on its own line in any note and keep typing. The answer opens under the line.
- **Ask about a tile:** `ask yo about this` in a tile's menu, `ask yo` in the power bar, or `✦y` (the key note under this page).
  - **From a shell:** `ep0ch act agent.ask to=yo about=tile`.
  - **Where it lands:** a thread on the note in that tile; a tile with no note, on this page.
- **Have it pressed:** `@yo do it`, or the button yourself. In a thread, reply `@yo do it`.
- **Take it back:** the `undo` on the done row. An action that changes no note and no layout has none, and the row says so.
- **See how it knew:** the steps fold under each answer: what it read and each model call, with its cost.
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
  - **While it can't be reached:** yo answers without it and says so in its steps.
- **The models:** each default is `claude` in safe mode, sending only the prompt; the settings row shows the whole command.
- **`door.act`** is the primitive under the button: an agent's process asks the door to run one action line, as the agent, and gets its undo id ([Agents in the note](../../docs/extensions/README.md#agents-in-the-note)).
