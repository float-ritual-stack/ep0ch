import type { Tab, StripHit, StripOptions } from "./chip-rows";
import { fullValue, type StripTarget } from "../overflow";
import { visible } from "../style";

export interface StripRecord {
  id: string; tabs: readonly Tab[]; tile?: string; scroll?: number; cursor: number;
  /** A breadcrumb or dock acts on its segment without entering the tile underneath. */
  direct: boolean; about?: string;
}
interface Owner { tile?: string; width: number }
let drawing: { strips: StripState; owner: Owner; hover?: StripTarget } | undefined;

/** Rendering supplies the tile once; every strip inside it keeps that address through composition and clipping. */
export function withStrips<T>(strips: StripState, draw: () => T, frame = false, hover?: StripTarget): T {
  const before = drawing;
  if (frame) strips.begin();
  drawing = { strips, owner: { width: Infinity }, hover };
  try { return draw(); } finally { drawing = before; if (frame) strips.end(); }
}
export function withStripOwner<T>(tile: string | undefined, width: number, draw: () => T): T {
  if (!drawing) return draw();
  const before = drawing.owner;
  drawing.owner = { tile, width };
  try { return draw(); } finally { drawing.owner = before; }
}
export const stripWidth = () => drawing?.owner.width ?? Infinity;
export const stripHint = () => drawing?.hover ? drawing.strips.rows.get(drawing.hover.id)?.about : undefined;
export function recordStrip(tabs: readonly Tab[], o: StripOptions): StripRecord | undefined {
  return drawing?.strips.record(tabs, o, drawing.owner.tile);
}

/** Compose hints supplied by several key tables without inventing their actions again. */
export function stripSegments(text: string): Tab[] {
  const tabs: Tab[] = [];
  const words = (s: string) => { for (const label of s.split(" · ")) if (visible(label).trim()) tabs.push({ label }); };
  let at = 0;
  for (const m of text.matchAll(/(\x1b\[777;[01];\d+m)[\s\S]*?\x1b\[778m/g)) {
    words(text.slice(at, m.index));
    const full = fullValue(m[1]!);
    if (full?.tab) tabs.push(full.tab);
    else words(full?.text ?? m[0]);
    at = m.index! + m[0].length;
  }
  words(text.slice(at));
  return tabs;
}

/** Cursor and sideways position belong to the strip; choosing still runs the segment's existing action. */
export class StripState {
  readonly rows = new Map<string, StripRecord>();
  active?: string;
  private drawn = new Set<string>();
  begin() { this.drawn.clear(); }
  end() { for (const id of this.rows.keys()) if (!this.drawn.has(id)) this.rows.delete(id); }
  record(tabs: readonly Tab[], o: StripOptions, tile?: string): StripRecord {
    const key = `${tile ?? "door"}/${o.id ?? JSON.stringify([o.lead, tabs.map(t => t.hit ?? t.key ?? t.label)])}`;
    this.drawn.add(key);
    const old = this.rows.get(key), current = Math.max(0, tabs.findIndex(t => t.on));
    const row: StripRecord = { id: key, tile, tabs, direct: !!o.direct, about: o.about, cursor: old?.scroll === undefined ? current : Math.min(old.cursor, Math.max(0, tabs.length - 1)), scroll: old?.scroll };
    this.rows.set(key, row);
    return row;
  }
  get(id?: string, tile?: string): StripRecord | undefined {
    const all = [...this.rows.values()];
    if (id) return this.rows.get(id) ?? all.find(r => r.id.endsWith(`/${id}`) && r.tile === tile) ?? all.find(r => r.id.endsWith(`/${id}`) && !r.tile);
    return (this.active ? this.rows.get(this.active) : undefined) ?? all.find(r => r.tile === tile && r.id.endsWith("/tabs")) ?? all.find(r => r.tile === tile && r.tabs.some(t => t.on)) ?? all.find(r => r.tile === tile && r.id.endsWith("/hint"));
  }
  move(row: StripRecord, by: number, keys = true) {
    row.scroll = (((row.scroll ?? row.cursor) + by) % row.tabs.length + row.tabs.length) % row.tabs.length;
    if (keys) { row.cursor = row.scroll; this.active = row.id; }
    return { strip: row.id, n: row.scroll + 1, label: row.tabs[row.scroll]?.label };
  }
  target(hit: StripTarget, alt: boolean): StripHit | undefined {
    const row = this.rows.get(hit.id);
    if (!row) return;
    if (hit.n < 0) return { action: hit.n === -1 ? "strip.more" : "strip.scroll", args: { strip: row.id, ...(hit.n === -1 ? {} : { by: hit.n === -2 ? -1 : 1 }) } };
    const tab = row.tabs[hit.n], press = alt ? tab?.alt ?? tab?.hit : tab?.hit;
    return press ? { ...press, tile: press.tile ?? row.tile } : undefined;
  }
}
