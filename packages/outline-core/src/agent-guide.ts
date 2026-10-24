// What an agent should know an outline can hold (PIE-721), so it reaches for the outline's parts without being reminded:
// a few house lines, then every component the outline has, one line each, grouped by the group each schema names for
// itself and marked live when it takes a query. Built from the merged schemas (`components.schemas`: the built-ins, the
// outline's own styles and types, each extension's), so a new component, or an extension's, appears here with nothing
// written again. The MCP gateway's `instructions`, `ep0ch library --guide` and the Claude mod's context block read it.
// Pure: no I/O.

import { componentGist, componentIsLive, type ComponentSchema } from "./component-schema";

/**
 * The components the house lines name as examples. agent-guide.test.ts holds each to a built-in, so a renamed component
 * fails there instead of sending agents to a name that isn't one.
 */
export const GUIDE_NAMES = ["graph-stat", "graph-tabs", "graph-table", "graph-decision", "graph-compare", "graph-timeline", "graph-check", "callout", "rule", "view", "links"] as const;

const HOUSE = [
  "Who reads it: one person, often mid-task, in a terminal, on a phone or between other work. Lead with the conclusion; one fact per line, a bold lead on each; a section is one component plus at most three short lines; no paragraph past three sentences. A wall of text is a bug.",
  "Notes are Blockdown: Markdown-adjacent text plus the outline's own forms. Reach for those forms instead of prose:",
  "- A count, a status or a list that will change goes in a live figure or view with `query:` (the saved views' grammar), so it stays true: graph-stat (each tile counts its own `query:`), graph-tabs, graph-table, a `view` note or `::links` with a query. Never paste numbers a query can count.",
  "- A decision, a comparison, a plan or a history, a checklist: graph-decision, graph-compare, graph-timeline, graph-check, not paragraphs.",
  "- An aside or a warning is a callout (`> [!tip]`); never a section: sections are headings, and a callout inside a callout is a heading too. Worked example: [[callouts-to-figures]] in pie: plan -> graph-check; today/route/rules -> graph-compare; superseded choices/rules -> graph-decision; edges -> graph-table; an untested warning stays a callout. A look or a behaviour that should follow every matching note is a rule note, with no code.",
  "- Point with links, not directions: `((id|label))`, `[[page]]`, a Work ID. Properties are open: `[key::value]` on a note's first line, any key.",
  "- Before writing a component, `outline_components` with its id gives its properties and a working example. A write answers with `warnings` (a reference that leads nowhere, with a did-you-mean; a figure or fence left open): fix them in the same turn.",
  "- Read a note before you write it. What you write is attributed to you and can be undone from the record.",
];

export interface GuideOptions {
  /** Lines about the surface's own tools (how to orient, how to read a note back drawn), after the house lines. */
  tools?: readonly string[];
  /** What the components listed are: "this outline's", or the built-ins with each outline adding its own. */
  scope?: string;
  /**
   * `names`: each group's ids on one line, a live one marked `(live)`, for a surface that cuts what it reads (an MCP
   * server's `instructions` are cut at 4,096 characters in Claude Code); `lines` (the default): a line each, with its gist.
   */
  index?: "lines" | "names";
}

/** The components by the `group` each names for itself, in the order the groups first appear. */
function byGroup(schemas: readonly ComponentSchema[]): [string, ComponentSchema[]][] {
  const groups = new Map<string, ComponentSchema[]>();
  for (const s of schemas) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return [...groups];
}

const originOf = (s: ComponentSchema) => (s.origin && s.origin !== "built-in" ? ` (${s.origin})` : "");

/** The components grouped, each `- id: gist`, ` · live` when it reads a query, its origin when an extension's. */
export function componentIndex(schemas: readonly ComponentSchema[]): string {
  return byGroup(schemas).map(([group, members]) => [
    `### ${group}`,
    ...members.map(s => `- ${s.id}: ${componentGist(s)}${componentIsLive(s) ? " · live" : ""}${originOf(s)}`),
  ].join("\n")).join("\n");
}

/** Each group's ids on one line, `(live)` after one that reads a query, an extension's origin after its id. */
export function componentNames(schemas: readonly ComponentSchema[]): string {
  return byGroup(schemas).map(([group, members]) =>
    `- ${group}: ${members.map(s => `${s.id}${componentIsLive(s) ? " (live)" : ""}${originOf(s)}`).join(", ")}`).join("\n");
}

/** The guide: the house lines, the surface's tool lines, then the component index. */
export function agentGuide(schemas: readonly ComponentSchema[], options: GuideOptions = {}): string {
  const extensions = schemas.filter(s => s.origin && s.origin !== "built-in").length;
  const counted = `${schemas.length} component${schemas.length === 1 ? "" : "s"}${extensions ? `, ${extensions} from extensions` : ""}`;
  return [
    "# What an ep0ch outline can hold",
    "",
    ...HOUSE,
    ...(options.tools ?? []),
    "",
    `## Components (${counted}${options.scope ? `; ${options.scope}` : ""})`,
    "`outline_components` gives any of them in full.",
    "",
    options.index === "names" ? componentNames(schemas) : componentIndex(schemas),
  ].join("\n");
}
