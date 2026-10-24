Start here: Legend of the Ep0ch Wyrm
A door game in the shape of the old BBS ones, written in this outline's own parts. It's yours now: rename the town, edit the screens, delete what you don't use.

- **The town** is ((wyrmhold|Wyrmhold)). Press *join the realm* there for a new player under it; rename them by editing their note's title.
- **A player is a note.** Every stat is a chip on its first line (`[hp::]`, `[gold::]`, `[turns::]`…), so a view can query the realm and undo takes a move back.
- **Fifteen forest fights a day.** The first move of a new day gives them back, and the dead rise.
- **Sleep at the inn** (it costs gold) or **in the fields** (free, and anyone can find you). A player asleep in the fields shows on everyone's sheet with a press that ambushes them.
- **Bank your gold**: what's in your purse is what you lose.
- **The masters** train you up a level when you have the xp. At level 12, go up the mountain after the Wyrm.
- **The Daily News** is ((daily-news|a note)) of today's events, one note each, drawn on the town board.
- **The screens** are ((screens|two render scripts)): `wyrm-sheet` on every player, `wyrm-town` on the town. The moves are the installed script `wyrm` (`wyrm do=forest`, `hit`, `run`, `heal`, `train`, `buy item=weapon`, `deposit`, `sleep where=inn`, `ambush target=…`).
