// The reader's list mode (PIE-693, PIE-747) and the collection walk (PIE-1491): what j k ⏎ tab esc do in and around a
// collection. Rows, elements and the reading line stay NoteSurface's; this reads them.
import type { NoteSurface, SurfaceHost } from "./note";
import type { ReaderMode } from "./modes";
import { modeHint } from "./modes";
import { PERSON, type ListHandle } from "./list-view";
import { LIST_KEYS, collectionHint, listBinding } from "./list-keys";
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
    hint: () => surface.listViews.get(list)?.typing ? "type to filter the list · ⏎ keep · esc clear" : surface.listsDrawn.find(l => l.key === list)?.collection ? collectionHint() : `${title} · ${modeHint(LIST_KEYS, name => LISTVIEW_ACTIONS.def(name))}`,
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
    if (l.change) void l.change({ where: view.filter() }, PERSON).then(() => host.redraw());
    host.redraw();
    return true;
  }
  const binding = listBinding(k, !!l.change, view.pickable().length);
  // In a collection, j or k past its edge walks on through the note, as it walked in (PIE-1491).
  if (binding && l.collection && binding.action === "list.step" && (binding.args?.axis ?? "row") === "row" && !view.stepTarget(PERSON, binding.args?.by as number)) {
    const by = (binding.args?.by as number) > 0 ? 1 : -1;
    surface.leaveList();
    // Nothing that way (the collection ends the note): stay in it, on its edge row.
    void surface.runKey("reading.step", { by, through: true }, host, true).then(() => {
      if (!surface.listIn && collectionAtReading(surface)?.key === l.key && (by > 0 || !collectionTextStop(surface))) surface.enterList(l, true, by > 0 ? "last" : "first");
      host.redraw();
    });
    return true;
  }
  if (binding) { void surface.runList(binding.action as ListActionName, { list, ...binding.args } as never, host); return true; }
  if (l.collection) return true;
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

/** The [ ] position landed on a collection's row (`]`, a click): the person is in that collection, on that row (PIE-1491). */
export function enterCollectionRow(surface: NoteSurface) {
  const e = surface.selectedElement(), row = e?.link?.listRow;
  if (!row?.row) return;
  const l = surface.listsDrawn.find(l => l.key === row.key && l.collection);
  if (!l || surface.listIn === l.key) return;
  surface.modes.push(listMode(surface, l.key, l.title));
  l.view.pick(PERSON, row.row, row.group);
}
/**
 * A collection in the walk (PIE-1491): j from above stops on the text of its block when there is some (a saved view's
 * last body line), then goes in at its first row; k from below goes in at its last row. `through` (from its edge row)
 * walks out instead: up, onto that text; down, on to the next block.
 */
export function collectionTextStop(surface: NoteSurface): boolean {
  const line = surface.msg?.text.split("\n")[surface.readingSourceLine()] ?? "";
  return line.trim() !== "" && !line.trimStart().startsWith("::");
}

