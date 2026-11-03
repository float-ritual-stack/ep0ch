// The reader's list mode (PIE-693, PIE-747: a ::links list the person goes into, and a filter being typed) and a
// collection's keys (PIE-1501): a collection has no mode. The `[ ]` position on one of its rows routes the list keys
// (collectionKey); j k go to reading.step, whose walk the row containers answer (row-container.ts).
import type { NoteSurface, SurfaceHost } from "./note";
import type { ReaderMode } from "./modes";
import { modeHint, type ModeKey } from "./modes";
import { PERSON, type ListHandle } from "./list-view";
import { LIST_KEYS, listBinding } from "./list-keys";
import { LISTVIEW_ACTIONS } from "./list-actions";
/** While a list's filter is being typed: the list.filter action's own two exits. */
const FILTER_KEYS: readonly ModeKey[] = [{ key: "enter", action: "list.filter", label: "keep" }, { key: "esc", action: "list.filter", args: { words: "" }, label: "clear" }];
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
    hint: () => surface.listViews.get(list)?.typing ? `type to filter the list · ${modeHint(FILTER_KEYS, () => undefined)}` : `${title} · ${modeHint(LIST_KEYS, name => LISTVIEW_ACTIONS.def(name))}`,
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

/**
 * The list key `k` binds to while the `[ ]` position is on a list's row, as figureKey reads a figure's. On a
 * collection's row (PIE-1501): the tables in list-keys.ts, less list.enter (esc lets go of the position, as anywhere;
 * tab is the screen's). On another list's row (a ::links list, ::backlinks, an extension's list: PIE-1534): its page
 * only (PgDn PgUp); j k stay the host's (the reader's walk steps the rows, a river column's j selects its next note),
 * and ⏎ / and the rest the reader's until ⏎ in gives it the keys. Null for any other key, or off every list's row.
 */
export function collectionBinding(surface: NoteSurface, k: Key): { list: ListHandle<any>; binding: ModeKey } | null {
  if (surface.modes.top()) return null;
  const list = surface.listAtCursor();
  if (!list) return null;
  const binding = listBinding(k, !!list.change, list.view.pickable().length);
  if (!binding || binding.action === "list.enter") return null;
  return list.collection || (binding.action === "list.step" && binding.args?.page) ? { list, binding } : null;
}

/** `k` run on the collection the `[ ]` position is in: j k step its rows through the reading walk (one owner of a row step, stepReading), the rest through its list.* action. True when it ran. */
export function collectionKey(surface: NoteSurface, k: Key, host: SurfaceHost): boolean {
  const found = collectionBinding(surface, k);
  if (!found) return false;
  const { list, binding } = found;
  if (binding.action === "list.step" && (binding.args?.axis ?? "row") === "row" && !binding.args?.page) void surface.runKey("reading.step", { by: (binding.args?.by as number) > 0 ? 1 : -1 }, host);
  else void surface.runList(binding.action as ListActionName, { list: list.key, ...binding.args } as never, host);
  return true;
}
