// Which component a line of a note starts: the one finder every reader of a note's components asks (the published
// page's walk, `notes.page`, the door's reader). Each kind's own grammar stays where it is (view-spec.ts,
// link-blocks.ts, template-use.ts, button-call.ts, site-blocks.ts, figure-props.ts); this file is the order they are
// asked in and one answer shape, so two readers can't disagree about what a line is. Pure: no I/O.
import { buttonCallAt, type ButtonCall } from "./button-call";
import { componentBlocks, type ComponentBlock } from "./component-block";
import { graphKind } from "./figure-props";
import { linkBlockAt, type LinkBlockSpec } from "./link-blocks";
import { siteBlockAt, type SiteBlock } from "./site-blocks";
import { useCallAt, type UseCall } from "./template-use";
import { viewSpec, type ViewSpec } from "./view-spec";

/** The container whose body is note content (component-block.ts reads it so). */
export const BOX_NAME = "box";

/** A component found at a line: what it is, the line it ends on (inclusive), and its own reading. */
export type ComponentAt =
  /** A `::view`, or a `::graph-table` with a query or a view: a collection the service answers. */
  | { kind: "view"; end: number; block: ComponentBlock; spec: ViewSpec }
  /** `::links`, `::outlinks`, `::backlinks`, `::resources`. */
  | { kind: "links"; end: number; block?: ComponentBlock; spec: LinkBlockSpec }
  /** `::use`: a template drawn in place of its line. */
  | { kind: "use"; end: number; call: UseCall }
  /** `::button`: a labelled press. */
  | { kind: "button"; end: number; call: ButtonCall }
  /** `::fields`. */
  | { kind: "fields"; end: number; site: Extract<SiteBlock, { kind: "fields" }> }
  /** `::if`: `end` is its closing `::`. */
  | { kind: "if"; end: number; site: Extract<SiteBlock, { kind: "if" }> }
  /** A `::graph-*` figure: `figure` is its kind (`stat`, `check`…). */
  | { kind: "figure"; end: number; block: ComponentBlock; figure: string }
  /** A `::box`: its body (the lines between its two) is note content, read line by line as the note is. */
  | { kind: "box"; end: number; block: ComponentBlock }
  /** Any other component block (an extension's, one nobody knows): its block, as written. */
  | { kind: "component"; end: number; block: ComponentBlock };

export type ComponentKind = ComponentAt["kind"];

/** A note's component blocks by the line each starts on: what `componentAt` reads, made once a note. */
export const componentStarts = (lines: readonly string[]): Map<number, ComponentBlock> => new Map(componentBlocks(lines).map(block => [block.start, block]));

/**
 * The component that starts at line `i` of `lines`, or null when the line starts none. The order is the readers' own:
 * a collection, then a links list, a `::use`, a `::button` (at its line's start: one inside a list item or a quote is
 * its container's line, read with `buttonCallAt`), `::fields` and `::if`, a figure, a box, then whatever block is left.
 */
export function componentAt(lines: readonly string[], i: number, starts: ReadonlyMap<number, ComponentBlock> = componentStarts(lines)): ComponentAt | null {
  const block = starts.get(i);
  const spec = block && viewSpec(block, lines);
  if (spec) return { kind: "view", end: block!.end, block: block!, spec };
  const links = linkBlockAt(lines, i, starts);
  if (links) return { kind: "links", end: links.end, ...(block ? { block } : {}), spec: links.spec };
  const use = useCallAt(lines, i);
  if (use) return { kind: "use", end: i, call: use };
  const button = buttonCallAt(lines, i);
  if (button && !button.prefix) return { kind: "button", end: button.endLine, call: button };
  const site = siteBlockAt(lines, i, starts);
  if (site?.kind === "fields") return { kind: "fields", end: site.end, site };
  if (site?.kind === "if") return { kind: "if", end: site.end, site };
  const figure = block && graphKind(block);
  if (block && figure) return { kind: "figure", end: block.end, block, figure };
  return block ? { kind: block.name === BOX_NAME ? "box" : "component", end: block.end, block } : null;
}
