// ep0ch-script effects=write
// [form-field::page note]: the left page, then the right (each left out: this outline's home, then the note in front of you)
// Resolve explicit slots before arranging anything; defaults belong to this outline and this reader.
const pick = async ref => (await read(ref)).id;
const layout = await act('layout.get');
const layer = layout.layers.find(x => !x.drawer);
const current = layer.tiles.find(x => x.tile === layer.focus && x.kind === 'reader')?.showing?.id;
let home;
if (!props.page?.[0]) {
  home = (await q('welcome=1', { limit: 1 })).blocks[0]?.id
    ?? (await q('page=home', { limit: 1 })).blocks[0]?.id;
  if (!home) {
    let note = await read(current ?? this.id);
    while (note.parent) note = await read(note.parent);
    home = note.id;
  }
}
const BRIEF = props.page?.[0] ? await pick(props.page[0]) : home;
const CURRENT = props.page?.[1] ? await pick(props.page[1]) : (current ?? this.id);
const failed = [];
// A step that couldn't be done is said in the door's own words, whole (never "Error:" or clipped).
const step = async (name, args) => { try { return await act(name, args); } catch (e) { failed.push(`${name}: ${e?.message ?? String(e)}`); return null; } };
const tiles = async () => (await act('layout.get')).layers.find(x => !x.drawer).tiles;

// A reader holding a note: one showing it already, else a new held one.
async function readerFor(id, name, except) {
  const t = (await tiles()).find(x => x.kind === 'reader' && x.showing?.id === id && x.tile !== except);
  if (t) return t.tile;
  const r = await step('tile.open', { kind: 'reader', mode: 'held', note: id, name });
  return r?.tile ?? name;
}
const A = await readerFor(BRIEF, 'brief');
const B = await readerFor(CURRENT, 'current', A);
await step('reader.follow', { tile: A, source: 'none' });
await step('reader.follow', { tile: B, source: 'none' });

// side by side, 50/50; every other tile a spine
await step('tile.collapse', { tile: A, on: false });
await step('tile.collapse', { tile: B, on: false });
await step('layout.move', { tile: B, to: A, where: 'right' });

// the briefing's links in the drawer, wired: select and open → B, alt → A
const shown = await step('links', { tile: A });
const L = shown?.tile;
if (L) {
  await step('tile.drawer', { tile: L, on: true });
  await step('tile.link', { tile: L, to: B, verb: 'select' });
  await step('tile.link', { tile: L, to: B, verb: 'open' });
  await step('tile.link', { tile: L, to: A, verb: 'alt' });
}
for (const t of await tiles()) {
  if (t.tile === A || t.tile === B || t.tile === L || t.collapsed || t.shown === false) continue;
  // A float has no place to fold in: it goes back into the layout first, then folds as the rest do.
  const back = t.float ? await step('tile.float', { tile: t.tile, on: false }) : t;
  if (back) await step('tile.collapse', { tile: back.tile ?? t.tile, on: true });
}
await step('layout.even', {});
// Said in the notes' words, never the tiles' ids.
const titled = async id => { try { return (await read(id)).title; } catch { return id; } };
return failed.length ? `neat: ${failed.length} ${failed.length === 1 ? 'step' : 'steps'} failed · ${failed.join(' · ')}` : `neat: ${await titled(BRIEF)} | ${await titled(CURRENT)}, links wired`;
