export const BUTTON_SEQUENCES = [
  "One button, two tiles",
  "Press Fold the bottom, then ctrl+z: both tiles come back. Sugar does the same. Pipe passes [2,3] through an action and two more scripts. Sources (S) shows each input, output, answer and remaining effects.",
  "```js script=pick", "return [2, 3];", "```",
  "```js script=convert", "return input.map(n => n * 2);", "```",
  "```js script=wire", "return input.join(',');", "```",
  "```js script=write-log", "await tools.outline_create({ parent: this.id, text: 'Sequence left this entry' });", "```",
  '::button{label="Partial"}', "tile.collapse on=true tile=links", "((write-log))", "tile.collapse tile=missing", "tile.collapse on=true tile=preview", "::",
  "```js script=nothing", "return;", "```",
  "```js script=observe", "return input === undefined ? 'empty input' : 'stale input';", "```",
  '::button{label="Fold the bottom"}',
  "tile.collapse on=true tile=links", "tile.collapse on=true tile=preview", "::",
  '::button{label="Refused"}',
  "tile.collapse on=true tile=missing", "tile.collapse on=true tile=links", "::",
  '::button{label="Pipe"}', "((pick))", "tile.collapse on=true tile=links", "((convert))", "((wire))", "::",
  '::button{label="Nothing" of=[pick, nothing, observe]}',
  `::button{label="Sugar" act=["tile.collapse on=true tile='links'", "tile.collapse on=true tile='preview'"]}`,
].join("\n");

/** Every tone, frame and state of the one button part (PIE-1287): Sync waits, Water fails, Turn the compost is refused now. */
export const BUTTON_LOOKS = [
  "Buttons that look like buttons",
  "A tone, a glyph, a frame and a fill: each line says how its button looks. Press Sync now: it reads ◐ while the script runs and ✓ when it's done. Water fails: it says ! until it is pressed again, and the pointer over it reads why. Turn the compost can't run here (no tile is called compost-heap): it is drawn dim, and the pointer reads the refusal.",
  "```js script=sync-beds", "await wait(1500);", "return 'beds synced';", "```",
  "```js script=water-beds", "throw new Error('the water butt is empty');", "```",
  '::button{label="Fold all" glyph="▤" act="status.log"}',
  '::button{label="Ship it" glyph="▶" tone=primary act="status.log"}',
  '::button{label="Delete" glyph="✕" tone=danger act="status.log"}',
  '::button{label="Sync now" glyph="⟳" frame=round of=sync-beds}',
  '::button{label="Water" frame=heavy tone=primary of=water-beds}',
  '::button{label="Clear" frame=double tone=danger act="status.log"}',
  '::button{label="Lift" fill=on act="status.log"}',
  '::button{label="Turn the compost" act="tile.collapse tile=compost-heap"}',
].join("\n");
