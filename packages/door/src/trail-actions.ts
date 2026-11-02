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
    run(args, app: App) { return app.trail.query(kind, args).map(v => ({ ...v, dwell: app.trail.dwell(v), seconds: app.trail.seconds(v), skimmed: app.trail.skim(v), place: app.trail.places[v.open.target.tile] })); },
  }),
]));
export const TRAIL_QUERIES = actionSet<App>()("trail", {
  ...queries,
  "door.opens": def({ summary: "Read recent door.open envelopes, since a timestamp in milliseconds", touches: "nothing", replay: "safe",
    args: { since: { type: "number", optional: true, about: "milliseconds since the epoch" } }, run({ since }, app) { return app.doorOpens(since); } }),
  "trail.settings": def({ summary: "Set retention days and dwell thresholds in seconds, or read them with no arguments", touches: "nothing", replay: "safe",
    args: Object.fromEntries(["days", "linger", "read", "held", "idle"].map(key => [key, { type: "number" as const, optional: true, about: key === "days" ? "days to retain" : `${key} threshold in seconds` }])),
    run(args, app) {
      if (Object.values(args).some(v => v !== undefined && (!Number.isFinite(v) || Number(v) <= 0))) throw new ActionRefused("trail.settings values must be positive numbers");
      return app.trail.configure(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as Partial<TrailSettings>);
    } }),
});
