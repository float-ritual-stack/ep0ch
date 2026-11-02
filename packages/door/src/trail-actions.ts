import { ActionRefused, actionSet, def } from "./surface/actions";
import type { App } from "./app";
import type { TrailSettings } from "./trail";

const queryArgs = {
  visit: { type: "string", optional: true, about: "a visit id" },
  note: { type: "string", optional: true, about: "a note id" },
  from: { type: "string", optional: true, about: "a tile id" },
  q: { type: "string", optional: true, about: "search the visits" },
} as const;
const queries = Object.fromEntries(["recent", "children", "visits", "branch", "closed", "held", "from"].map(kind => [
  `trail.${kind}`, def({ summary: `Read the trail's ${kind} visits without moving the person's view`, touches: "nothing", replay: "safe", args: queryArgs,
    examples: [{ act: `trail.${kind}${kind === "children" || kind === "branch" ? " visit=visit-garden" : kind === "visits" ? " note=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" : kind === "from" ? " from=t-garden" : " q=garden"}`, does: `reads ${kind} visits; visit and tile ids come from trail.recent`, safe: true }],
    run(args, app: App) { return app.trail.query(kind, args).map(v => ({ ...v, dwell: app.trail.dwell(v), seconds: app.trail.seconds(v), skimmed: app.trail.skim(v), place: app.trail.places[v.open.target.tile] })); },
  }),
]));
export const TRAIL_QUERIES = actionSet<App>()("trail", {
  ...queries,
  "facets.trail": def({
    summary: "Facets over the trail: pick dwell, day and source tile to find a visit",
    touches: "shape", replay: "safe", args: {},
    examples: [{ act: "facets.trail", does: "opens facets over the trail" }],
    run(_, app, actor) { return app.dispatch.act({ action: "tile.open", args: { kind: "facets", source: "trail", name: "trail-facets", where: "right" } }, actor); },
  }),
  "door.opens": def({ summary: "Read recent door.open envelopes, since a timestamp in milliseconds", touches: "nothing", replay: "safe",
    examples: [{ act: "door.opens since=0", does: "lists the recent open envelopes with their causes", safe: true }],
    args: { since: { type: "number", optional: true, about: "milliseconds since the epoch" } }, run({ since }, app) { return app.doorOpens(since); } }),
  "trail.settings": def({ summary: "Set retention days and dwell thresholds in seconds, or read them with no arguments", touches: "nothing", replay: "safe",
    examples: [{ act: "trail.settings", does: "reads retention and dwell thresholds", safe: true }, { act: "trail.settings days=14 linger=5 read=60 held=300", does: "keeps two weeks and sets the dwell thresholds in seconds" }],
    args: Object.fromEntries(["days", "linger", "read", "held", "idle"].map(key => [key, { type: "number" as const, optional: true, about: key === "days" ? "days to retain" : `${key} threshold in seconds` }])),
    run(args, app) {
      if (Object.values(args).some(v => v !== undefined && (!Number.isFinite(v) || Number(v) <= 0))) throw new ActionRefused("trail.settings values must be positive numbers");
      return app.trail.configure(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as Partial<TrailSettings>);
    } }),
});
