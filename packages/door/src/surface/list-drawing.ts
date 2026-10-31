import { activationOf, type ListPrimitive } from "@ep0ch/outline-core/list-row";
import { actionLine } from "@ep0ch/outline-core/action-line";
import { listOpenTarget, type LinkTarget } from "../refs";
import type { LinkBlocksEnv } from "../links";
import type { NoteSurface } from "./note";
import { listRowLines, listRowsOf, type ListViewRow } from "./list-view";

/**
 * An extension's `list` view drawn (PIE-747): the rows are the primitive's, the view is this reader's (`#n` among the
 * lists the note draws), and each row is the element its one activation makes it: a block or Resource it opens, an
 * action line it presses, text it copies or puts in the person's draft.
 */
export function renderPrimitiveList(surface: Pick<NoteSurface, "listFor" | "listIn">, node: ListPrimitive, width: number, run: (act: string) => LinkTarget, lb: LinkBlocksEnv | undefined, tagged: (to: LinkTarget, text: string) => string, markdown: (text: string) => string[]): string[] {
  if (!lb) return listRowsOf(node).flatMap(r => listRowLines(r, { cols: width, lines: 2 }));
  const n = ++(lb.drawn ??= { n: 0 }).n, key = `#${n}`;
  const view = surface.listFor(key, true, "list"), entered = surface.listIn === key;
  view.set(listRowsOf(node));
  const previewing = node.preview !== undefined && node.preview !== "none" && view.rows.some(r => r.preview);
  const tag = (row: ListViewRow, x: string): string => {
    const a = activationOf(row);
    if (!a) return x;
    const at = { listRow: { key, row: row.id, group: row.group } };
    const to: LinkTarget = a.kind === "open" ? listOpenTarget(row)!
      : a.kind === "run" ? run(actionLine({ action: (a.value as { action: string }).action, args: (a.value as { args?: Record<string, string> }).args }))
      : { role: "row", label: row.label, listText: a.kind === "copy" ? { copy: a.value as string } : { insert: a.value as string } };
    return tagged({ ...to, ...at }, x);
  };
  const drawing = view.draw({
    primitive: node, cols: width, focused: entered, selection: entered || previewing, tag, empty: node.empty ?? "nothing here",
    ...(previewing ? { preview: { side: node.preview!, of: (row: ListViewRow, w: number) => {
      const p = row.preview;
      return !p ? null : "block" in p ? lb.preview?.(p.block, w) ?? null : markdown(p.markdown);
    } } } : {}),
  });
  lb.seen?.({ n, key, title: `list ${n}`, view, entered, detail: { preview: null } });
  // The frame's control, above the rows: ⏎ in (or esc out), unless the view said the list takes no keys.
  const control = node.enter !== false && lb.control ? [" ".repeat(Math.max(0, width - 7)) + lb.control(key, entered ? "esc out" : "⏎ in")] : [];
  return [...control, ...drawing.lines];
}

