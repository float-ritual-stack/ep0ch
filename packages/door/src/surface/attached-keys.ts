import type { ModeKey } from "./modes";

// Pointer targets dispatch through their drawn hit records; these rows keep action metadata on the same table.
const row = (key: string, action: string, label: string, args?: Record<string, unknown>): ModeKey => ({ key, action, label, args });

export const SOURCES_KEYS: readonly ModeKey[] = [
  row("esc", "sources.close", "close sources"), row("q", "sources.close", "close sources"), row("S", "sources.close", "close sources"),
  row("j", "sources.pick", "select", { by: 1 }), row("down", "sources.pick", "select", { by: 1 }), row("tab", "sources.pick", "select", { by: 1 }),
  row("k", "sources.pick", "select", { by: -1 }), row("up", "sources.pick", "select", { by: -1 }),
  ...["enter", "shift+enter", "ctrl+enter"].map(key => row(key, "sources.enter", "open")), row("alt+enter", "sources.enter", "open beside", { fresh: true }),
  row("r", "sources.refresh", "read again"), row("pgdn", "sources.scroll", "scroll", { by: 8 }), row("space", "sources.scroll", "scroll", { by: 8 }), row("pgup", "sources.scroll", "scroll", { by: -8 }),
  row("ctrl+o", "sources.place", "placement"), row("ctrl+g", "sources.grip", "move"), row("ctrl+z", "sources.undo", "undo"),
  ...["sources.close", "sources.enter", "sources.refresh", "sources.place"].map(action => row("click", action, "")),
  row("wheel", "sources.scroll", ""),
];
export const SOURCE_KEYS: readonly ModeKey[] = [
  ...SOURCES_KEYS.map(row => ["enter", "shift+enter", "ctrl+enter"].includes(row.key) ? { ...row, label: "choose row" } : row),
  row("left", "sources.back", "source list"), row("e", "sources.set", "edit"), row("y", "sources.copy", "copy"), row("g", "sources.jump", "jump"),
  row("c", "sources.download", "CSV", { format: "csv" }), row("J", "sources.download", "JSON", { format: "json" }),
  row("1", "sources.fold", "query", { fold: "query" }), row("2", "sources.fold", "transform", { fold: "transform" }), row("3", "sources.fold", "result", { fold: "result" }),
  ...["sources.back", "sources.pick", "sources.copy", "sources.download", "sources.jump", "sources.fold"].map(action => row("click", action, "")),
];
export const SOURCE_FIELD_KEYS: readonly ModeKey[] = [
  row("esc", "sources.field", "keep field", { op: "cancel" }), row("enter", "sources.field", "save", { op: "save" }), row("ctrl+s", "sources.field", "save", { op: "save" }),
  row("ctrl+z", "sources.field", "undo typing", { op: "key", value: "ctrl+z" }), row("click", "sources.field", ""),
];
/**
 * Zoom into a part of a reader's note (PIE-780): W on the part the [ ] position (else the reading line) is in, a click on
 * the ⤢ at a figure's, a table's or a heading's right edge; esc (or back) returns to the whole note.
 */
export const ZOOM_KEYS: readonly ModeKey[] = [
  row("W", "element.zoom", "zoom into this part"), row("click", "element.zoom", ""), row("esc", "element.zoom", "whole note", { on: false }),
];
export const REPLIES_CONTROLS = ["note.thread.full", "note.thread.groups", "note.thread.close"] as const;

export const REORDER_KEYS: readonly ModeKey[] = [
  row("K", "note.move", "up", { step: "up" }), row("alt+up", "note.move", "up", { step: "up" }),
  row("J", "note.move", "down", { step: "down" }), row("alt+down", "note.move", "down", { step: "down" }),
  row("I", "note.move", "in", { step: "in" }), row("O", "note.move", "out", { step: "out" }), row("Z", "note.move", "move to"),
  row("ctrl+z", "note.move.undo", "undo move"),
];
export const TREE_MOVE_KEYS = REORDER_KEYS.map(binding => ({ ...binding, action: "tree.move", ...(binding.action === "note.move.undo" ? { args: { undo: true } } : {}) }));
export const COLUMN_MOVE_KEYS = TREE_MOVE_KEYS.map(binding => ({ ...binding, action: "column.move" }));
export const LIST_MOVE_KEYS = TREE_MOVE_KEYS.map(binding => ({ ...binding, action: "note.move" }));
export const READER_MOVE_KEYS = REORDER_KEYS.filter(binding => binding.action === "note.move" && binding.args?.step !== "in" && binding.args?.step !== "out");

export const REPLIES_KEYS: readonly ModeKey[] = [
  row("esc", "note.thread.close", "close replies"), row("q", "note.thread.close", "close replies"), row("t", "note.thread.close", "close replies"),
  row("j", "note.thread.pick", "select", { by: 1 }), row("down", "note.thread.pick", "select", { by: 1 }), row("k", "note.thread.pick", "select", { by: -1 }), row("up", "note.thread.pick", "select", { by: -1 }),
  ...["enter", "shift+enter", "ctrl+enter"].map(key => row(key, "note.thread.open", "open")), row("alt+enter", "note.thread.open", "open beside", { fresh: true }),
  row("b", "note.thread.groups", "links"), row("T", "note.thread.full", "full list"),
  ...REORDER_KEYS,
  ...[...REPLIES_CONTROLS, "note.thread.pick", "note.thread.open", "note.thread.unfold"].map(action => row("click", action, "")),
  row("wheel", "note.thread.pick", ""),
];
export const REPLIES_FOLD_KEYS: readonly ModeKey[] = REPLIES_KEYS.map(row => row.action === "note.thread.open" ? { ...row, action: "note.thread.unfold", args: undefined, label: "unfold" } : row);

export const COMMENT_KEYS: readonly ModeKey[] = [
  row("esc", "comment.escape", "close comment"), row("ctrl+s", "comment.send", "send"),
  row("ctrl+o", "comment.place", "placement"), row("ctrl+g", "comment.grip", "move"), row("ctrl+r", "comment.reload", "find quote"), row("click", "comment.place", ""),
];
export const EDIT_PREVIEW_KEYS: readonly ModeKey[] = [
  row("esc", "draft.preview", "close preview", { on: false }), row("ctrl+p", "draft.preview", "close preview", { on: false }),
  row("up", "draft.scroll", "scroll", { preview: true, by: -1 }), row("k", "draft.scroll", "scroll", { preview: true, by: -1 }),
  row("down", "draft.scroll", "scroll", { preview: true, by: 1 }), row("j", "draft.scroll", "scroll", { preview: true, by: 1 }),
  row("pgup", "draft.scroll", "scroll", { preview: true, by: -10 }), row("pgdn", "draft.scroll", "scroll", { preview: true, by: 10 }),
  row("click", "draft.preview", ""), row("wheel", "draft.scroll", ""),
];

export const EDIT_PREVIEW_READER_KEYS = EDIT_PREVIEW_KEYS.filter(row => row.action === "draft.preview");

export const ATTACHED_KEYS = [SOURCES_KEYS, SOURCE_KEYS, SOURCE_FIELD_KEYS, REPLIES_KEYS, REPLIES_FOLD_KEYS, COMMENT_KEYS, EDIT_PREVIEW_KEYS];
