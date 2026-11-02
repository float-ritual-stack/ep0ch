import { treeRows } from "./figures/tree";
import { dayLabel, visitDay, type Trail, type Visit } from "./trail";
export interface TrailRow { title: string; visit?: Visit; folded?: number; heading?: boolean; dim?: boolean }
export interface TrailView { view: "forest" | "timeline" | "tile"; folded: boolean; agents: "show" | "dim" | "hide"; q: string }
export function visitLine(trail: Trail, v: Visit, now = Date.now()): string {
  const dwell = trail.dwell(v, now), glyph = dwell === "held" ? "●" : dwell === "read" ? "◐" : "·";
  const seconds = Math.floor(trail.seconds(v, now)), duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  const place = trail.places[v.open.target.tile];
  const where = place?.closed ? `tile closed ${new Date(place.closed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ↺`
    : `${place?.drawer ? "drawer · " : ""}${place?.name ?? "tile"} · ${v.left === undefined ? "open now" : "left"}`;
  return `${glyph} ${v.title}  ${duration}  ${where}${v.open.actor.kind === "agent" ? ` · opened by ${v.open.actor.id}` : ""}`;
}
export function trailRows(trail: Trail, options: TrailView, now = Date.now()): TrailRow[] {
  const all = trail.query("recent", { q: options.q }).filter(v => options.agents !== "hide" || v.open.actor.kind !== "agent").reverse();
  const days = [...new Set(all.map(v => visitDay(v.open.at)))].reverse(), rows: TrailRow[] = [];
  for (const day of days) {
    rows.push({ title: dayLabel(day, now), heading: true });
    const visits = all.filter(v => visitDay(v.open.at) === day);
    const ids = new Set(visits.map(v => v.open.target.visit));
    const parents = new Set(visits.map(v => v.open.source?.visit));
    type Node = { row: TrailRow; children: Node[] };
    const nodes = new Map<string, Node>(visits.map(v => [v.open.target.visit, { row: { title: visitLine(trail, v, now), visit: v, dim: options.agents === "dim" && v.open.actor.kind === "agent" }, children: [] }]));
    const roots: Node[] = [], byTile = new Map<string, Node[]>(), folds = new Map<string, Node>();
    for (const v of visits) {
      const id = v.open.target.visit, parent = v.open.source?.visit;
      const parentNode = options.view === "forest" && parent && ids.has(parent) ? nodes.get(parent) : undefined;
      const tile = v.open.target.tile;
      if (!byTile.has(tile)) byTile.set(tile, []);
      const list = parentNode ? parentNode.children : options.view === "tile" ? byTile.get(tile)! : roots;
      const hasChildren = parents.has(id);
      const skim = trail.skim(v, now);
      if (!options.q && !hasChildren && (options.folded && (skim || (trail.dwell(v, now) === "flipped" && v.left !== undefined)))) {
        const key = `${options.view === "tile" ? tile : ""}/${parent ?? ""}/${v.open.source?.tile ?? v.open.target.tile}/${skim}`;
        let folded = folds.get(key);
        if (!folded) { folded = { row: { title: "", folded: 0 }, children: [] }; folds.set(key, folded); list.push(folded); }
        folded.row.folded!++;
        folded.row.title = `· ${skim ? "skimmed" : "flipped"} ${folded.row.folded} from ${trail.places[v.open.source?.tile ?? v.open.target.tile]?.name ?? "the list"} (f shows)`;
      } else {
        const node = nodes.get(id)!;
        if (options.view === "timeline") node.row.title = `${new Date(v.open.at).toLocaleTimeString()} ${v.open.method} · from ${trail.places[v.open.source?.tile ?? ""]?.name ?? "outside"} → ${node.row.title}`;
        list.push(node);
      }
    }
    if (options.view === "tile") {
      for (const [tile, nodes] of byTile) {
        rows.push({ title: trail.places[tile]?.name ?? tile, heading: true });
        rows.push(...nodes.map(n => n.row));
      }
    } else if (options.view === "timeline") rows.push(...roots.map(n => n.row));
    else rows.push(...treeRows(roots, n => n.children).map(({ node, lead }) => ({ ...node.row, title: lead + node.row.title })));
  }
  return rows;
}
