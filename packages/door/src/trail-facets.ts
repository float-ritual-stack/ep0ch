import { facetRows, type FacetRow } from "@ep0ch/outline-core/facet-source";
import { registerFacetSource } from "./facet-sources";
import { visitDay } from "./trail";
import { ActionRefused } from "./surface/actions";

registerFacetSource({
  id: "trail", title: "Trail", rows: "visits",
  subscribe: (desk, changed) => desk.ctx.trail!.subscribe(changed),
  async query(request, desk) {
    const trail = desk.ctx.trail!, now = Date.now();
    const rows: FacetRow[] = trail.query("recent").map(v => {
      const at = new Date(v.open.at).toISOString(), place = trail.places[v.open.target.tile];
      return { id: v.open.target.visit, title: v.title, createdAt: at, updatedAt: at,
        properties: { note: [v.open.target.note], title: [v.title], tile: [place?.name ?? v.open.target.tile],
          ...(v.open.source ? { "from-tile": [trail.places[v.open.source.tile]?.name ?? v.open.source.tile] } : {}),
          method: [v.open.method], actor: [v.open.actor.kind === "agent" ? v.open.actor.id : v.open.actor.kind],
          day: [visitDay(v.open.at)], dwell: [trail.dwell(v, now)], closed: [String(place?.closed !== undefined)] } };
    });
    return facetRows(rows, request, now);
  },
  async open(row, desk, _pane, actor) {
    const visit = desk.ctx.trail!.get(row.id);
    if (!visit) throw new ActionRefused("that visit is no longer in the trail · facets.reload reads it again");
    return desk.reopenTrail!(visit, actor);
  },
});
