<!-- To append to packages/outliner/docs/scripts.md as the fifth worked example (PIE-959; PIE-982 left the slot, and that file is on main, not on the wave branch). -->

## Worked example: Fantasia (a button, a transaction, motion, undo)

`::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 motion=fantasia}` in a note, and this script as `[script::fantasia] [effects::write]`.
It is the wave's acceptance test: one click runs the whole chain.

```js
const beats = Math.max(1, Math.min(12, Number(props.beats && props.beats[0]) || 4));
const tempo = Math.max(150, Math.min(3000, Number(props.tempo && props.tempo[0]) || 500));
const style = (props.motion && props.motion[0]) || 'fantasia';
const home = (props.layout && props.layout[0]) || '';
const stay = !!(props.stay && props.stay[0]);
const before = await act('layout.get');
if (before.locked) return 'fantasia: the screen is locked; alt+k unlocks it, then run again';
const dancers = (before.tiles || []).filter(t => t.shown && t.kind !== 'drawer.own').map(t => ({ id: t.id, name: t.name }));
const notes = [], floated = [];
for (const d of dancers) {
  try { const r = await act('tile.float', { tile: d.id, on: true, motion: style }); floated.push({ id: r && r.now && r.now !== d.name ? r.now : d.id, name: d.name }); }
  catch (e) { notes.push(d.name + ' stayed put: ' + (e && e.message || e)); }
}
if (!floated.length) return 'fantasia: no tile would float. ' + notes.join('; ');
const drift = [[7, -2], [-5, 3], [6, 2], [-8, -3], [4, 4], [-4, -4], [9, 1], [-6, 2]];
for (let beat = 0; beat < beats; beat++) {
  for (let i = 0; i < floated.length; i++) {
    const [dx, dy] = drift[(beat + i * 3) % drift.length];
    try { await act('float.place', { tile: floated[i].id, dx: i % 2 ? -dx : dx, dy, motion: style }); }
    catch (e) { notes.push('beat ' + (beat + 1) + ', ' + floated[i].name + ': ' + (e && e.message || e)); }
  }
  await wait(tempo);
}
let settled = '';
if (stay) settled = 'and left where they danced (layout.undo puts them back)';
if (!settled && home) {
  try { await act('layout.load', { name: home, motion: 'settle' }); settled = 'into the screen ' + home; }
  catch (e) { notes.push('layout.load ' + home + ': ' + (e && e.message || e)); }
}
if (!settled) {
  // No layout asked: the run's own changes are taken back, so the screen is as it began.
  try { await act('layout.undo'); settled = 'the layout as it began'; } catch (e) { notes.push('layout.undo: ' + (e && e.message || e)); }
}
if (!settled) settled = 'left where they danced (layout.undo, or ctrl+z, puts them back)';
return 'fantasia: ' + floated.length + ' tile' + (floated.length === 1 ? '' : 's') + ' danced ' + beats + ' beat' + (beats === 1 ? '' : 's') + ' at ' + tempo + ' ms, ' + settled + (notes.length ? '\nnotes: ' + notes.join('; ') : '');
```

What happens, step by step:

1. **The note.** The door reads `::button{…}` (outline-core `button-call.ts`) and draws a chip; `of=` names a script and every other word is a slot, so the press is the action line `fantasia beats="3" tempo="450" motion="fantasia"`.
2. **The press.** A click, or ⏎ on the chip, runs the line through the door's one dispatcher as you. The script is resolved to its `ext.<id>.run`; `motion=` on a press becomes the script's `props.motion`. Because you pressed, the door mints a one-run invitation (shape, screen): the run may move the tile you are in; it never reaches a draft's text.
3. **The run.** The service starts the run (`requestedBy` you, the button's author recorded on its note). Every `act()` goes back to your door as `script:fantasia` on your behalf, carrying the run's id as `txn=` and the invitation, so the run's layout changes are **one transaction**.
4. **The dance.** `layout.get` lists the tiles; each shown tile but the drawer's is floated (`tile.float on=true`, so a tile already floating isn't toggled back) and nudged (`float.place`) a few beats with `motion: "fantasia"`. The desk draws each change as movement (`motion.set` caps it: calm is a short plain glide, off snaps). A refusal (a locked screen, the tile somebody types in) is caught per tile and said at the end; a locked screen refuses up front.
5. **The settle.** `layout=<screen>` loads that screen. With none, the run takes its own changes back (`layout.undo`, which inside a run is the run's transaction), so the screen is as it began; where that is refused (an uninvited run on a screen the person holds) it leaves the tiles where they danced and says so, and `layout.undo` puts them back. `stay=1` does the same by choice, a scene to undo.
6. **The close.** The run note ends with `fantasia: 3 tiles danced 3 beats at 450 ms, the layout as it began`, and the status bar says once how many layout changes the run made and that ctrl+z puts them back.

Paths:

- **An agent's run** (`act ext.<id>.run block=<the note> beats=3`) is the same script on the same path, attributed to the agent (`onBehalfOf` it, `layout.undo` by it works on its own run), but with no press there is no invitation: the tile the person's keys are on is refused and left docked, and said in the run note.
- **Stop** (`script.stop run=<id>`): the run ends, the service says `scripts.ended`, the door's end rule puts the layout back (as far as nobody changed it since) and says so. Floats never stay strewn.
- **Undo** (`layout.undo`, ctrl+z, or `ext.undo` for the run's writes and layout together; a run with `stay=1` or `layout=` leaves something to undo): the whole run is taken back, newest step first; it is refused over a change somebody else made since ("undo that first").
- **By hand**, with no script: `door_act tile.float tile=… on=true txn=g1 motion=fantasia` per tile, `door_act layout.load name=… txn=g1`, then `door_act layout.txn.end txn=g1`. `txn=` and `motion=` are the dispatcher's own arguments, open to every actor.

Try it: `ep0ch --showcase`, `act section name=fantasia`.
