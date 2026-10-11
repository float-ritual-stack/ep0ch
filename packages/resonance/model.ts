import type { BlockRecord } from "@ep0ch/outline-core/block-record";
export type { BlockRecord };
export interface Edge { source: string; target: string; kind: "link" | "parent"; label: string }
export interface Group { value: string | null; count: number; ids: string[] }
export interface Facet { key: string; values: { value: string; count: number }[]; more?: number }
export interface Atlas {
  records: BlockRecord[]; edges: Edge[]; groups: Group[]; facets: Facet[];
  completeness: unknown; total: number; sequence: number; outline: string; root: string;
}
export interface Point { x: number; y: number }
export type Mode = "constellation" | "islands" | "chronology";

/** Display only resolved service relations whose endpoints are in this bounded answer. */
export function edgesFor(records: readonly BlockRecord[]): Edge[] {
  const ids = new Set(records.map(r => r.id)), edges: Edge[] = [];
  for (const r of records) {
    if (r.parent && ids.has(r.parent)) edges.push({ source: r.parent, target: r.id, kind: "parent", label: "contains" });
    const seen = new Set<string>();
    for (const link of r.links) {
      if (!link.target || !ids.has(link.target) || link.target === r.id || seen.has(link.target)) continue;
      seen.add(link.target);
      edges.push({ source: r.id, target: link.target, kind: "link", label: link.label });
    }
  }
  return edges;
}

/** A navigation route, not an assertion of causality: authored references can be followed backwards. */
export function shortestRoute(records: readonly BlockRecord[], edges: readonly Edge[], from: string, to: string): string[] {
  const adjacency = new Map(records.map(r => [r.id, [] as string[]]));
  if (!adjacency.has(from) || !adjacency.has(to)) return [];
  if (from === to) return [from];
  for (const e of edges) {
    // A common folder is not evidence connecting two ideas.
    if (e.kind !== "link" || !adjacency.has(e.source) || !adjacency.has(e.target)) continue;
    adjacency.get(e.source)!.push(e.target); adjacency.get(e.target)!.push(e.source);
  }
  for (const neighbors of adjacency.values()) neighbors.sort();
  const queue = [from], previous = new Map<string, string | null>([[from, null]]);
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacency.get(queue[i]!)!) {
      if (previous.has(next)) continue;
      previous.set(next, queue[i]!);
      if (next === to) {
        const path = [to];
        for (let at = previous.get(to); at; at = previous.get(at)) path.push(at);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

export function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
const margin = 80;

/** Disposable presentation coordinates. No proximity is treated as a semantic relation. */
export function arrange(records: readonly BlockRecord[], edges: readonly Edge[], mode: Mode, groups: readonly Group[]): Map<string, Point> {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length, points = new Map<string, Point>();
  if (!n) return points;
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.ids.forEach(id => { if (!groupOf.has(id)) groupOf.set(id, i); }));
  const count = Math.max(1, groups.length), cols = Math.ceil(Math.sqrt(count * 1.5)), rows = Math.ceil(count / cols);
  if (mode === "chronology") {
    const dated: { r: BlockRecord; date: number }[] = [], undated: BlockRecord[] = [];
    for (const r of sorted) {
      const authored = r.properties.find(p => p.key === "when")?.values[0];
      const date = authored ? Date.parse(authored) : NaN;
      if (Number.isFinite(date)) dated.push({ r, date });
      else undated.push(r);
    }
    dated.sort((a, b) => a.date - b.date || a.r.id.localeCompare(b.r.id));
    if (dated.length) {
      const min = dated[0]!.date, span = Math.max(1, dated[dated.length - 1]!.date - min);
      dated.forEach(({ r, date }, i) => {
        const band = groupOf.get(r.id) ?? 0;
        points.set(r.id, { x: margin + (date - min) / span * (1200 - margin * 2), y: 80 + (band + 0.5) / count * 540 + ((i % 3) - 1) * 32 });
      });
    }
    // An ingestion timestamp is not a missing event date. Keep unknown chronology visibly separate.
    undated.forEach((r, i) => points.set(r.id, { x: margin + (i + 0.5) / undated.length * (1200 - margin * 2), y: 740 }));
    return points;
  }
  const positions = new Float64Array(n * 2), velocities = new Float64Array(n * 2);
  const indices = new Map(sorted.map((r, i) => [r.id, i]));
  const anchors = new Float64Array(n * 2);
  const memberIndex = new Map<number, number>();
  sorted.forEach((r, i) => {
    const g = groupOf.get(r.id) ?? count - 1;
    const member = memberIndex.get(g) ?? 0; memberIndex.set(g, member + 1);
    const ax = 140 + (g % cols + 0.5) * 920 / cols;
    const ay = 80 + (Math.floor(g / cols) + 0.5) * 640 / rows;
    anchors[i * 2] = mode === "islands" ? ax : 600;
    anchors[i * 2 + 1] = mode === "islands" ? ay : 400;
    const angle = member * 2.39996323 + hash(r.id) / 4294967296;
    const radius = mode === "islands" ? 25 + Math.sqrt(member + 1) * 28 : 180 + hash(r.id) % 120;
    positions[i * 2] = anchors[i * 2]! + Math.cos(angle) * radius;
    positions[i * 2 + 1] = anchors[i * 2 + 1]! + Math.sin(angle) * radius;
  });
  const springs = edges.flatMap(e => {
    const a = indices.get(e.source), b = indices.get(e.target);
    return a === undefined || b === undefined ? [] : [[a, b, e.kind === "parent" ? 0.003 : 0.014] as const];
  });
  // Fixed iterations, no perpetual animation or work while the atlas is idle.
  for (let step = 0; step < 180; step++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[i * 2]! - positions[j * 2]!, dy = positions[i * 2 + 1]! - positions[j * 2 + 1]!;
        const d2 = Math.max(100, dx * dx + dy * dy), force = 90 / d2;
        const fx = dx * force, fy = dy * force;
        velocities[i * 2]! += fx; velocities[i * 2 + 1]! += fy;
        velocities[j * 2]! -= fx; velocities[j * 2 + 1]! -= fy;
      }
    }
    for (const [i, j, strength] of springs) {
      const dx = positions[j * 2]! - positions[i * 2]!, dy = positions[j * 2 + 1]! - positions[i * 2 + 1]!;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - (mode === "islands" ? 130 : 155)) / distance * strength * (mode === "islands" ? 0.1 : 1);
      velocities[i * 2]! += dx * force; velocities[i * 2 + 1]! += dy * force;
      velocities[j * 2]! -= dx * force; velocities[j * 2 + 1]! -= dy * force;
    }
    for (let i = 0; i < n; i++) {
      const gravity = mode === "islands" ? 0.03 : 0.035;
      for (let axis = 0; axis < 2; axis++) {
        const k = i * 2 + axis;
        velocities[k] = (velocities[k]! + (anchors[k]! - positions[k]!) * gravity) * 0.72;
        positions[k] = Math.min((axis === 0 ? 1200 : 800) - margin, Math.max(margin, positions[k]! + velocities[k]!));
      }
    }
  }
  if (mode === "constellation" && n > 1) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, positions[i * 2]!); maxX = Math.max(maxX, positions[i * 2]!);
      minY = Math.min(minY, positions[i * 2 + 1]!); maxY = Math.max(maxY, positions[i * 2 + 1]!);
    }
    const scale = Math.min(1040 / Math.max(1, maxX - minX), 640 / Math.max(1, maxY - minY));
    for (let i = 0; i < n; i++) {
      positions[i * 2] = 600 + (positions[i * 2]! - (minX + maxX) / 2) * scale;
      positions[i * 2 + 1] = 400 + (positions[i * 2 + 1]! - (minY + maxY) / 2) * scale;
    }
  }
  sorted.forEach((r, i) => points.set(r.id, { x: positions[i * 2]!, y: positions[i * 2 + 1]! }));
  return points;
}
