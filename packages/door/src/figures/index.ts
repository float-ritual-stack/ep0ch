// The figure kinds in this folder (ideas from mdxcn.dev, none of its code), registered in src/graphs.ts's KINDS beside
// the first ones: each kind's drawing, and what it makes of Markdown rows (src/figures/markdown.ts says the first
// kinds'). A new kind is a module here and a line in each map.
import { annotateMarkdown, drawAnnotate } from "./annotate";
import { chatMarkdown, drawChat } from "./chat";
import { activityMarkdown, calendarMarkdown, drawActivity, drawCalendar, drawUptime, uptimeMarkdown } from "./days";
import { compareMarkdown, drawCompare } from "./compare";
import { decisionMarkdown, drawDecision } from "./decision";
import { drawFlow, flowMarkdown } from "./flow";
import { drawMatrix, matrixMarkdown } from "./matrix";
import { drawQuadrant, quadrantMarkdown } from "./quadrant";
import { drawKeys, keysFromRegistry, keysMarkdown } from "./keys";
import { BASE_MARKDOWN, type Markdown } from "./markdown";
import type { Draw, Props } from "./palette";

export const FIGURES: Record<string, Draw> = {
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
};

/** What each kind makes of a figure's Markdown rows: props under its YAML's. */
export const MARKDOWN: Record<string, (md: Markdown, p: Props) => Props> = {
  ...BASE_MARKDOWN,
  decision: decisionMarkdown,
  chat: chatMarkdown,
  keys: keysMarkdown,
  uptime: uptimeMarkdown,
  activity: activityMarkdown,
  calendar: calendarMarkdown,
  annotate: annotateMarkdown,
  quadrant: quadrantMarkdown,
  matrix: matrixMarkdown,
  compare: compareMarkdown,
  flow: flowMarkdown,
};
