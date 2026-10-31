# Legend of the Ep0ch Wyrm

A door game in the shape of the old BBS ones, whose whole state is notes: forest fights, a town and its Daily News.

## Where to look

- **Wyrmhold:** the town note, with the players ranked, the join button and today's Daily News.
- **Your player note:** its sheet shows your stats and a press for every move.
- **Daily News:** one `[type::wyrm-event] [day::]` note per event, newest first.

## What you do

- **Join:** press **join the realm** on the town.
  - Or `wyrm do=join name=…`; without `name=` you are a Stranger, and renaming is editing the title.
- **Play a move:** press a square on your sheet, which runs `wyrm do=…` on your note.
- **Take a move back:** undo (ctrl+z); a move is one attributed edit of your note.
- **Agents:** press the town's button with `button.press note=<town> label="join the realm"`.

## The moves

- **`forest`:** spend a fight; a monster of your level steps out, or a gem, a purse, a fairy circle.
- **`hit`, `run`:** one exchange of blows.
  - Running fails a quarter of the time, and never from the Wyrm.
- **`heal`:** the healer, `2 × level` gold a point, as much as you can afford.
- **`train`:** duel your level's master once you have the xp; there are twelve levels.
- **`buy item=weapon|armor`:** the next tier, trading the old one in for half.
- **`deposit`, `withdraw`:** what's in your purse is what you lose when you die.
- **`sleep where=inn|fields`:** the inn costs `20 × level` and nobody reaches you.
  - The fields are free and anyone can reach you.
- **`ambush target=<note>`:** three a day, on a player asleep in the same town's fields.
  - The whole fight happens at once; the loser is dead until tomorrow, the news says so, and the victim gets a comment.
  - A defender whose last death was on an earlier day has risen first, with full hp and a new morning's turns.
  - One event under the town records the fight and gold transfer. Both players fold it into their chips; a repeated create lands once. Each player keeps a `wyrm-through` timestamp with those chips, so the next move can finish an interrupted fold without charging twice. A stale fold reads again and rebuilds at the new revision.
  - Overlapping ambushes admit one next fight in the town's log. The log head is read before either player's balance, so one attacker cannot spend the same purse against two sleepers. A competing press refreshes the sheets and asks you to press again. If a player sheet is being edited, its chips join that draft and become saved state when the person saves it.
- **`wyrm`:** at level 12, go up the mountain.
  - Kill it and you start again at level 1, with a kill to your name.
- **A new day:** your first move on a new date refills `turns` and `ambushes`, and the dead rise; there is no routine.

## Setup

- **Install:** from the power bar (ctrl+k, `&wyrm`, pick **install Legend of the Ep0ch Wyrm**) or `ep0ch act extensions.install id=wyrm`.
- **The demo:** lands under the extension's page with the town, its Daily News and a player asleep in the fields.
  - The two screens come with the extension.
- **Remove:** `ep0ch act extensions.uninstall id=wyrm demo=keep`.
  - The town and its players stay, and so does what the sheets show as text.
  - The screens and moves go; a move named afterwards says `ep0ch act extensions.install id=wyrm` brings them back.

## Make it yours

- **Change a screen:** make a note of your own with the same name, such as `Player sheet [script::wyrm-sheet] [mode::render]` and a `js` fence.
  - A note with the same `[script::]` name wins over the file, so every sheet redraws from it.
- **Change the moves:** an outline's own `[script::wyrm]` note overrides the installed moves the same way.
- **Monsters, masters and gear** are tables at the top of `scripts/wyrm.js`.
- **Updates:** the screens are files the extension ships, so `ep0ch install --apply` brings new ones.

## How it's made

Building it found six rough edges in the script surface (PIE-1264); the parts below now carry it. The test: "if you can build games on it, it's a good infra piece."

| Need | The part that's there |
|---|---|
| A player | a note under the town, `[type::wyrm-player]` |
| Stats, the foe, today's turns | chips on that note's first line (`[hp::]`, `[gold::]`, `[foe::]`, `[turns::]`…) |
| A move | the script `wyrm` (`scripts/wyrm.js`), one action line per press: `wyrm do=forest` |
| The sheet | the render script `wyrm-sheet` (`scripts/wyrm-sheet.js`, headed `// ep0ch-script mode=render`), its line `wyrm-sheet::` on each player |
| The town board and Daily News | the render script `wyrm-town` on the town, newest first by each note's `created` |
| Joining | the town board's own *join the realm* square, drawn by `wyrm-town` |
| Taking a move back | the run's undo (ctrl+z) |

- **Chips are written together** with `outline_set_property`'s `properties` map; the sheet's squares are `view.button`s.
- **The mechanics** follow the old door games; the names, monsters and text are this extension's own.
- **Tests:** `packages/outliner/test/wyrm-extension.test.ts` (install, moves, ambush, screens, uninstall) and the showcase's **wyrm** section, `packages/door/test/showcase/wyrm.test.ts`.
