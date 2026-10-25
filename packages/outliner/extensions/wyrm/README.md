# Legend of the Ep0ch Wyrm

A door game in the shape of the old BBS ones, built from the outline's own parts: no new primitive. (Building it found six rough edges in the script surface, PIE-1264; the table below names the parts that now carry it.)
"If you can build games on it, it's a good infra piece." This is that test, and the worked example of a game whose
whole state is notes.

Install from the power bar (ctrl+k, `&wyrm`, pick **install Legend of the Ep0ch Wyrm**) or
`ep0ch act extensions.install id=wyrm`. The demo lands under the extension's page: the town **Wyrmhold**, its
**Daily News** and a player asleep in the fields; the two screens come with the extension. Press **join the realm** on the town.

## How it's made

| Need | The part that's there |
|---|---|
| A player | a note under the town, `[type::wyrm-player]` |
| Stats, the foe in front of you, today's turns | chips on that note's first line (`[hp::]`, `[gold::]`, `[foe::]`, `[turns::]`…) |
| A move | the installed script `wyrm` (`scripts/wyrm.js`), one action line per press: `wyrm do=forest`; its chips are written together with `outline_set_property`'s `properties` map |
| The sheet with a press per move | the file render script `wyrm-sheet` (`scripts/wyrm-sheet.js`, headed `// ep0ch-script mode=render`), its line `wyrm-sheet::` on each player; `view.button` squares |
| The town board and Daily News | the file render script `wyrm-town` on the town (newest first by each note's `created`); each event a note `[type::wyrm-event] [day::]` under Daily News |
| Joining | the town board's own *join the realm* square, drawn by `wyrm-town`; an agent presses it with `button.press note=<town> label="join the realm"` |
| Taking a move back | the run's undo (ctrl+z): a move is one attributed edit of the player's note |
| A day's reset | lazy: a player's first move on a new date refills `turns` and `ambushes`, and the dead rise. No routine |

## The moves

`wyrm do=…` on a player's note (the sheet's squares press these):

- `forest`: spend a fight; a monster of your level steps out (or a gem, a purse, a fairy circle).
- `hit`, `run`: one exchange of blows; running fails a quarter of the time, and never from the Wyrm.
- `heal`: the healer, `2 × level` gold a point, as much as you can afford.
- `train`: duel your level's master once you have the xp. Twelve levels.
- `buy item=weapon|armor`: the next tier, trading the old one in for half.
- `deposit`, `withdraw`: what's in your purse is what you lose when you die.
- `sleep where=inn|fields`: the inn costs `20 × level` and nobody reaches you; the fields are free and anyone can.
- `ambush target=<note>`: three a day, on a player asleep in the same town's fields. The whole fight happens at once;
  the loser is dead until tomorrow, the news says so, and the victim gets a comment on their note. A defender whose
  last death was on an earlier day has risen first (full hp, a new morning's turns), and keeps what's left of that if they win.
  Both notes are checked for changes before either is written, and gold is debited before it is credited, so a refusal between the two saves loses gold rather than minting it.
- `wyrm`: at level 12, go up the mountain. Kill it and you start again at level 1, with a kill to your name.

`wyrm do=join name=…` on the town makes a player (without `name=`, a Stranger; rename by editing the title).

## Make it yours

The screens are files the extension ships, so `ep0ch install --apply` brings new ones. To change one, make a note of your
own with the same name (`Player sheet [script::wyrm-sheet] [mode::render]` and a `js` fence) and every sheet redraws from
it: a note with the same `[script::]` name wins over the file, the way `neat`'s does for the moves. An outline's own
`[script::wyrm]` note overrides the installed moves the same way. Monsters, masters and gear are tables at the top of
`scripts/wyrm.js`.

Remove it with `ep0ch act extensions.uninstall id=wyrm demo=keep`: the town and its players stay, and so does what the
sheets show as text; the screens and moves go with the extension, and a move named afterwards (`ep0ch act wyrm do=forest`,
or the service's own refusal) says `ep0ch act extensions.install id=wyrm` brings them back.

The mechanics follow the old door games; the names, monsters and text are this extension's own.

Tests: `packages/outliner/test/wyrm-extension.test.ts` (install, moves, ambush, the screens, uninstall) and the
showcase's **wyrm** section, `packages/door/test/showcase/wyrm.test.ts`.
