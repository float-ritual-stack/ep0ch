// Where each structure stands on the isometric map. Computed from map.json, so a regeneration puts the same
// structure in the same place: a lane per group (kept at the back, clients at the front), dependency depth
// along the lane (what a structure rests on is never in front of it), and rows inside a lane packed in
// depth, chapter and map order. `iso.place` in map.json sets a structure's cell by hand, lane-relative, for
// tuning; the packing leaves those cells alone.

export interface IsoInput {
  groups: { id: string }[];
  chapters: { id: string }[];
  structures: { id: string; group: string; chapter: string; dependsOn: string[] }[];
  iso?: IsoTuning;
}
export interface IsoTuning {
  /** Rows per lane, by group id. Without it a lane is about half as deep as it is long. */
  rows?: Record<string, number>;
  /** Space between lanes, in rows (a fraction is fine). */
  gap?: number;
  /** Hand-set cells: structure id → [column, row inside its lane]. */
  place?: Record<string, [number, number]>;
}
export interface Placed {
  id: string;
  /** Short name drawn on the block's top: the group's letter and its place in the map (K1, S3, D12, C2). */
  tag: string;
  col: number;
  row: number;
  depth: number;
  /** How many structures rest on this one. */
  dependents: number;
  /** 0, 1 or 2: drawn bigger the more rests on it. */
  size: number;
  hand: boolean;
}
export interface IsoLayout {
  placed: Placed[];
  lanes: { group: string; row: number; rows: number }[];
  cols: number;
  rows: number;
}

const LETTER: Record<string, string> = { kept: "K", service: "S", door: "D", clients: "C" };

/** Dependency depth: 0 for what rests on nothing, else one more than the deepest thing it rests on. */
export function depths(structures: IsoInput["structures"]): Map<string, number> {
  const byId = new Map(structures.map(s => [s.id, s]));
  const out = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const s = byId.get(id);
    if (!s || seen.has(id)) return 0; // a cycle or a missing id: shapeProblems reports it; don't loop
    seen.add(id);
    const d = s.dependsOn.length ? 1 + Math.max(...s.dependsOn.map(x => visit(x, seen))) : 0;
    seen.delete(id);
    out.set(id, d);
    return d;
  };
  for (const s of structures) visit(s.id, new Set());
  return out;
}

export function isoLayout(d: IsoInput): IsoLayout {
  const depth = depths(d.structures);
  const chapterAt = new Map(d.chapters.map((c, i) => [c.id, i]));
  const order = new Map(d.structures.map((s, i) => [s.id, i]));
  const dependents = new Map<string, number>(d.structures.map(s => [s.id, 0]));
  for (const s of d.structures) for (const x of s.dependsOn) dependents.set(x, (dependents.get(x) ?? 0) + 1);
  const counter: Record<string, number> = {};
  const tags = new Map(d.structures.map(s => {
    const L = LETTER[s.group] ?? s.group.slice(0, 1).toUpperCase();
    counter[L] = (counter[L] ?? 0) + 1;
    return [s.id, `${L}${counter[L]}`];
  }));
  const gap = d.iso?.gap ?? 1;
  const place = d.iso?.place ?? {};
  const placed: Placed[] = [];
  const colOf = new Map<string, number>();
  const lanes: IsoLayout["lanes"] = [];
  let top = 0;
  for (const g of d.groups) {
    const members = d.structures.filter(s => s.group === g.id);
    if (!members.length) continue;
    const rows = Math.max(1, d.iso?.rows?.[g.id] ?? Math.round(Math.sqrt(members.length / 2)));
    const taken = new Set<string>();
    const cell = (c: number, r: number) => `${c},${r}`;
    for (const s of members) {
      const at = place[s.id];
      if (at) taken.add(cell(at[0], at[1]));
    }
    const sorted = [...members].sort((a, b) =>
      (depth.get(a.id)! - depth.get(b.id)!) || (chapterAt.get(a.chapter)! - chapterAt.get(b.chapter)!) || (order.get(a.id)! - order.get(b.id)!));
    let used = rows;
    for (const s of sorted) {
      const dep = depth.get(s.id)!;
      let col: number, row: number;
      const hand = place[s.id];
      if (hand) [col, row] = hand;
      else {
        // Never in front of what it rests on: at its depth, or past where packing pushed a dependency.
        col = Math.max(dep, ...s.dependsOn.map(x => colOf.get(x) ?? 0)); row = 0;
        for (;; col++) {
          const free = [...Array(rows).keys()].find(r => !taken.has(cell(col, r)));
          if (free !== undefined) { row = free; break; }
        }
        taken.add(cell(col, row));
      }
      used = Math.max(used, row + 1);
      colOf.set(s.id, col);
      const n = dependents.get(s.id) ?? 0;
      placed.push({ id: s.id, tag: tags.get(s.id)!, col, row: top + row, depth: dep, dependents: n, size: n >= 4 ? 2 : n >= 2 ? 1 : 0, hand: !!hand });
    }
    lanes.push({ group: g.id, row: top, rows: used });
    top += used + gap;
  }
  placed.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { placed, lanes, cols: Math.max(1, ...placed.map(p => p.col + 1)), rows: Math.max(1, top - gap) };
}
