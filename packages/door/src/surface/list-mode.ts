// The reader's list mode (PIE-693, PIE-747: a ::links list the person goes into, and a filter being typed) and the
// collection walk (PIE-1491, PIE-1501): a collection has no mode. Its rows are elements like a live figure's rows: the
// `[ ]` position on one of them routes the list keys (collectionKey), j k step its rows through reading.step and walk
// on past its edges, and esc lets go of the position as it does anywhere. Rows, elements and the reading line stay
// NoteSurface's; this reads them.
import type { NoteSurface, SurfaceHost } from "./note";
import type { ReaderMode } from "./modes";
import { modeHint, type ModeKey } from "./modes";
import { PERSON, type ListHandle } from "./list-view";
import { LIST_KEYS, listBinding } from "./list-keys";
import { LISTVIEW_ACTIONS } from "./list-actions";
import type { ListActionName } from "./note";
import type { Key } from "../term";

export type ListMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { list: string; describe(): { list: string; title: string | null; selected: string | null; typing: string | null } };

export function listMode(surface: NoteSurface, list: string, title: string): ListMode {
  return {
    name: "list", of: { list }, list, word: "list",
    // Not a session: it holds no note. Its keys come first while it's open; the screen's (Tab, ^W, digits) stay the screen's.
    holdsKeys: false, editing: () => false, covers: () => false,
    key: (k, host) => listKey(surface, list, k, host),
    click: (x, y) => {
      const h = surface.hitAt(x, y);
      // A click in its own rows or its control is reading's (a row selects, the control comes out); anywhere else leaves it.
      if (!(h && "link" in h && h.link.listRow?.key === list)) surface.leaveList();
      return undefined;
    },
    rows: () => null,
    leave: async () => { surface.leaveList(); return { left: "nothing" }; },
    hint: () => surface.listViews.get(list)?.typing ? "type to filter the list · ⏎ keep · esc clear" : `${title} · ${modeHint(LIST_KEYS, name => LISTVIEW_ACTIONS.def(name))}`,
    state: () => "in a list",
    describe: () => ({ list, title, selected: surface.listViews.get(list)?.picked(PERSON)?.id ?? null, typing: surface.listViews.get(list)?.typing?.text ?? null }),
  };
}

function listKey(surface: NoteSurface, list: string, k: Key, host: SurfaceHost): boolean {
  const l = surface.listsDrawn.find(x => x.key === list);
  if (!l) { surface.leaveList(); return surface.key(k, host); }
  const view = l.view, T = view.typing;
  if (T) {
    // Typing a filter: letters go into it and the list follows; ⏎ keeps it, esc goes back to what it was.
    if (k.kind === "enter") view.stopTyping(true);
    else if (k.kind === "esc") view.stopTyping(false);
    else if (!T.take(k)) return true;
    // A collection's mode is only the filter being typed: kept or cleared, its row keys are the [ ] position's again.
    if (!view.typing && l.collection) surface.leaveList();
    if (l.change) void l.change({ where: view.filter() }, PERSON).then(() => host.redraw());
    host.redraw();
    return true;
  }
  const binding = listBinding(k, !!l.change, view.pickable().length);
  if (binding) { void surface.runList(binding.action as ListActionName, { list, ...binding.args } as never, host); return true; }
  // Any other key: out of the list, and the key does what it does in the reader.
  surface.leaveList();
  host.redraw();
  return surface.key(k, host);
}

/** The collection drawn in the block the reading line is on (its row elements fall in that block's rows), or null (PIE-1491). */
export function collectionAtReading(surface: NoteSurface): ListHandle<any> | null {
  const d = surface.drawn, rows = surface.readingRows();
  if (!d || !rows) return null;
  for (const e of surface.elems) {
    const key = e.link?.listRow?.key;
    if (key === undefined || e.row - d.top < rows[0] || e.row - d.top >= rows[1]) continue;
    const l = surface.listsDrawn.find(l => l.key === key && l.collection);
    if (l) return l;
  }
  return null;
}

/** The collection whose row the `[ ]` position is on (`j`, `]`, a click), or null (PIE-1501). */
export function collectionAtCursor(surface: NoteSurface): ListHandle<any> | null {
  const row = surface.selectedElement()?.link?.listRow ?? surface.rowWanted();
  if (!row?.row) return null;
  return surface.listsDrawn.find(l => l.key === row.key && l.collection) ?? null;
}

/**
 * The list key `k` binds to while the `[ ]` position is on a collection's row (PIE-1501), as figureKey reads a figure's:
 * the tables in list-keys.ts, less list.enter (esc lets go of the position, as anywhere; tab is the screen's). Null
 * for any other key, or off a collection.
 */
export function collectionBinding(surface: NoteSurface, k: Key): { list: ListHandle<any>; binding: ModeKey } | null {
  if (surface.modes.top()) return null;
  const list = collectionAtCursor(surface);
  if (!list) return null;
  const binding = listBinding(k, !!list.change, list.view.pickable().length);
  return binding && binding.action !== "list.enter" ? { list, binding } : null;
}

/** `k` run on the collection the `[ ]` position is in: j k step its rows through the reading walk (one owner of a row step, stepReading), the rest through its list.* action. True when it ran. */
export function collectionKey(surface: NoteSurface, k: Key, host: SurfaceHost): boolean {
  const found = collectionBinding(surface, k);
  if (!found) return false;
  const { list, binding } = found;
  if (binding.action === "list.step" && (binding.args?.axis ?? "row") === "row") void surface.runKey("reading.step", { by: (binding.args?.by as number) > 0 ? 1 : -1 }, host);
  else void surface.runList(binding.action as ListActionName, { list: list.key, ...binding.args } as never, host);
  return true;
}
/**
 * A collection in the walk (PIE-1491): j from above stops on the text of its block when there is some (a saved view's
 * last body line), then its first row; k from below lands on its last row. From its edge row the walk goes on: up,
 * onto that text; down, on to the next block.
 */
export function collectionTextStop(surface: NoteSurface): boolean {
  const line = surface.msg?.text.split("\n")[surface.readingSourceLine()] ?? "";
  return line.trim() !== "" && !line.trimStart().startsWith("::");
}

