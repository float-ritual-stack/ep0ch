import { componentMarkdown, ROW_MIN_WIDTH, validatePrimitive, type Primitive } from "./component-primitives";
import { inertBlockdown } from "./extension-records";

/**
 * A component's `row` in Detail: side by side when the pane is wide enough for each child's `minWidth`, one under the
 * other when it isn't. Detail draws a component as Markdown in the note (src/detail-embeds.ts), so a row travels as a
 * fenced block only Detail's own generated text may hold (`~~~ep0ch-row <minWidth>`, its children's Markdown split by
 * COLUMN_BREAK lines), and its reader (src/attributed-markdown.ts) lays the children out at the width it has. An
 * authored fence with that language is code, as written.
 */

export const DETAIL_ROW_LANGUAGE = /^ep0ch-row(?:\s+(\d{1,3}))?\s*$/;
export const COLUMN_BREAK = "␞";

/** Whether a view holds a row anywhere. */
const hasRow = (node: Primitive): boolean => node.type === "row" ||
  ((node.type === "box" || node.type === "stack" || node.type === "card") && (node.children ?? []).some(hasRow));

/**
 * A component's view as the Markdown Detail draws: its rows fenced for side by side, made inert. Null when it has no
 * row (the service's Markdown target is the same text, as the door's text layout reads it) or isn't a view.
 */
export function detailComponentMarkdown(view: unknown): string | null {
  try {
    const checked = validatePrimitive(view);
    if (!hasRow(checked)) return null;
    return inertBlockdown(componentMarkdown(checked, {
      row: (parts, node) => {
        const body = parts.join(`\n${COLUMN_BREAK}\n`);
        // Longer than any tilde fence inside it, so a child's own fence never closes the row.
        const inner = Math.max(2, ...[...body.matchAll(/^[ \t]*(~+)/gm)].map((match) => match[1]!.length));
        const fence = "~".repeat(inner + 1);
        return [`${fence}ep0ch-row ${node.minWidth ?? ROW_MIN_WIDTH}`, ...body.split("\n"), fence];
      },
    }));
  } catch {
    return null;
  }
}
