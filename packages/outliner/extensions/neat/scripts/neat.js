// ep0ch-script effects=write
// [form-field::page note]: the left page, then the right (each left out: this outline's home, then the note in front of you)
// [form-field::left text]: what goes to the far left, in order (repeat it): a [[page]], a note, a Work ID, or a tile: %name, tile:name, or a kind (terminal, agent)
// [form-field::right text]: the same, for the far right
// [form-field::fold text]: terminal and/or agent: fold those tiles to spines too (they are left alone otherwise)
// Resolve explicit slots before arranging anything; defaults belong to this outline and this reader.
const list = v => (v ?? []).map(String).filter(Boolean);
const edges = Boolean(props.left?.length || props.right?.length);
const layout = await act('layout.get');
const layer = layout.layers.find(x => !x.drawer);
const current = layer.tiles.find(x => x.tile === layer.focus && x.kind === 'reader')?.showing?.id;
const failed = [];
// A step that couldn't be done is said in the door's own words, whole (never "Error:" or clipped).
const step = async (name, args) => { try { return await act(name, args); } catch (e) { failed.push(`${name}: ${e?.message ?? String(e)}`); return null; } };
const tiles = async () => (await act('layout.get')).layers.find(x => !x.drawer).tiles;

// A ref is a tile (%name, tile:name, or a kind word naming tiles that exist) or a note (anything `read` understands).
// A tile's name is the door's to resolve (tile.info takes the name `tile=` takes), never parsed here.
const KINDS = { terminal: t => t.kind === 'pty' || t.kind === 'terminal', agent: t => t.kind === 'agent' || /(^|[./])agent/.test(t.path ?? '') };
// A page nobody has is said with the page names nearest to it (the notes that have a [page::]), never a quiet default.
async function nearest(ref) {
  const word = (/^\[\[(.+)\]\]$/.exec(ref)?.[1] ?? ref).toLowerCase();
  const pages = (await q('page', { limit: 200 })).blocks.map(b => b.properties?.find(p => p.key === 'page')?.values?.[0] ?? b.title).filter(Boolean);
  const near = pages.filter(p => p.toLowerCase().includes(word.slice(0, 3)) || word.includes(p.toLowerCase().slice(0, 3))).slice(0, 3);
  return near.length ? `; nearest pages: ${near.map(p => `[[${p}]]`).join(', ')}` : '';
}
async function resolve(ref) {
  // %name and tile:name are a tile's name, resolved by the door (tile.info): a tile called "terminal" is that tile, not every terminal.
  // Only the bare words terminal and agent mean every tile of that kind.
  const named = /^(?:tile:|%)(.+)$/.exec(ref)?.[1];
  if (named !== undefined) {
    const t = await step('tile.info', { tile: named });
    return t ? { tiles: [t.tile] } : null;
  }
  if (Object.hasOwn(KINDS, ref)) {
    const all = (await tiles()).filter(KINDS[ref]);
    if (all.length) return { tiles: all.map(t => t.tile) };
  }
  try { return { note: (await read(ref)).id }; } catch (e) { failed.push(`${ref}: ${e?.message ?? String(e)}${await nearest(ref)}`); return null; }
}

let lefts = list(props.left), rights = list(props.right);
if (edges) {
  // page= is the first left and the first right.
  if (props.page?.[0]) lefts = [props.page[0], ...lefts];
  if (props.page?.[1]) rights = [props.page[1], ...rights];
} else {
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
  lefts = [props.page?.[0] ?? home];
  rights = [props.page?.[1] ?? current ?? this.id];
}
const wantL = [], wantR = [];
for (const r of lefts) { const w = await resolve(r); if (w) wantL.push(w); }
for (const r of rights) { const w = await resolve(r); if (w) wantR.push(w); }

// A reader holding a note: one showing it already, else a new held one.
const used = new Set();
async function readerFor(id, name) {
  const t = (await tiles()).find(x => x.kind === 'reader' && x.showing?.id === id && !used.has(x.tile));
  if (t) return t.tile;
  const r = await step('tile.open', { kind: 'reader', note: id, name });
  return r?.tile ?? name;
}
// What a want is on the screen: the tiles it names, or the reader holding its note.
async function place(wants, name) {
  const out = [];
  for (const w of wants) {
    if (w.tiles) { for (const t of w.tiles) { used.add(t); out.push({ tile: t, reader: false }); } continue; }
    const t = await readerFor(w.note, out.length ? `${name}${out.length + 1}` : name);
    used.add(t);
    out.push({ tile: t, reader: true, note: w.note });
  }
  return out;
}
const L = await place(wantL, 'brief'), R = await place(wantR, 'current');
for (const r of [...L, ...R].filter(x => x.reader)) await step('reader.follow', { tile: r.tile, source: 'none' });
for (const t of [...L, ...R]) await step('tile.collapse', { tile: t.tile, on: false });

if (edges) {
  // The first of each side farthest out: lefts are moved last-first, rights first-last.
  for (const t of [...L].reverse()) await step('layout.move', { tile: t.tile, where: 'edge-left' });
  for (const t of R) await step('layout.move', { tile: t.tile, where: 'edge-right' });
} else if (L[0] && R[0]) {
  // side by side, 50/50; every other tile a spine
  await step('layout.move', { tile: R[0].tile, to: L[0].tile, where: 'right' });
}

// The first reader of each side holds the briefing's links in the drawer, wired: select and open → the right one, alt → the left.
const A = L.find(x => x.reader)?.tile, B = R.find(x => x.reader)?.tile ?? A;
let linksTile;
if (A) {
  const shown = await step('links', { tile: A });
  linksTile = shown?.tile;
  if (linksTile) {
    await step('tile.drawer', { tile: linksTile, on: true });
    await step('tile.link', { tile: linksTile, to: B, verb: 'select' });
    await step('tile.link', { tile: linksTile, to: B, verb: 'open' });
    await step('tile.link', { tile: linksTile, to: A, verb: 'alt' });
  }
}

// Everything else folds to a spine by the book, except what you keep: terminals and agents (unless fold= names them),
// tiles you pinned, and, when you name edges, the tile you are in.
const fold = list(props.fold);
// A group holds tiles of its own: it is left alone when a terminal or agent is anywhere inside it (full layout lists them).
const inside = t => [t, ...((t.mount?.layout?.tiles ?? []).flatMap(inside))];
const full = (await act('layout.get', { full: true })).layers.find(x => !x.drawer).tiles;
const holds = id => inside(full.find(x => x.tile === id) ?? {});
const foldable = t => !holds(t.tile).some(x => (KINDS.terminal(x) && !fold.includes('terminal')) || (KINDS.agent(x) && !fold.includes('agent'))) && !t.pinned;
for (const t of await tiles()) {
  if (used.has(t.tile) || t.tile === linksTile || (edges && t.tile === layer.focus) || t.collapsed || t.shown === false || !foldable(t)) continue;
  // A float has no place to fold in: it goes back into the layout first, then folds as the rest do.
  const back = t.float ? await step('tile.float', { tile: t.tile, on: false }) : t;
  if (back) await step('tile.collapse', { tile: back.tile ?? t.tile, on: true });
}
await step('layout.even', {});
// Said in the notes' words, never the tiles' ids.
const titled = async id => { try { return (await read(id)).title; } catch { return id; } };
const nameOf = async x => x.note ? titled(x.note) : (await tiles()).find(t => t.tile === x.tile)?.name ?? x.tile;
const said = async xs => (await Promise.all(xs.map(nameOf))).join(', ') || '-';
if (failed.length) await act('script.failed', { steps: failed.map(f => f.replace(/\s*\n\s*/g, ' ')).join('\n') });
return failed.length ? `neat: ${failed.length} ${failed.length === 1 ? 'step' : 'steps'} failed · ${failed.join(' · ')}` : `neat: ${await said(L)} | ${await said(R)}${linksTile ? ', links wired' : ''}`;
