// The figure kinds in this folder (ideas from mdxcn.dev, none of its code), registered in src/graphs.ts's KINDS beside
// the first ones: each kind's drawing. What it makes of Markdown rows is outline-core's figure-props.ts. A new kind
// is a module here and a line in each map.
import { drawAnnotate } from "./annotate";
import { drawCheck } from "./check";
import { drawChat } from "./chat";
import { drawActivity, drawCalendar, drawUptime } from "./days";
import { drawCompare } from "./compare";
import { drawDecision } from "./decision";
import { drawFlow } from "./flow";
import { drawMatrix } from "./matrix";
import { drawQuadrant } from "./quadrant";
import { drawKeys, keysFromRegistry } from "./keys";
import { drawProps } from "./props";
import { drawExample } from "./example";
import type { Draw } from "./palette";

export const FIGURES: Record<string, Draw> = {
  check: drawCheck,
  decision: drawDecision,
  chat: drawChat,
  keys: (p, w, link) => drawKeys(keysFromRegistry(p), w, link),
  uptime: drawUptime,
  activity: drawActivity,
  calendar: drawCalendar,
  annotate: drawAnnotate,
  quadrant: drawQuadrant,
  matrix: drawMatrix,
  compare: drawCompare,
  flow: drawFlow,
  props: drawProps,
  example: drawExample,
};

/** What each kind makes of a figure's Markdown rows: outline-core's, shared with the publisher. */
export { FIGURE_MARKDOWN as MARKDOWN } from "@ep0ch/outline-core/figure-props";
