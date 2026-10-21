import type { ModeKey } from "./modes";

const row = (key: string, action: string, label: string, args?: Record<string, unknown>): ModeKey => ({ key, action, label, args });

export const SOURCES_KEYS: readonly ModeKey[] = [
  row("esc", "sources.close", "close sources"), row("q", "sources.close", "close sources"), row("S", "sources.close", "close sources"),
  row("j", "sources.pick", "select", { by: 1 }), row("down", "sources.pick", "select", { by: 1 }), row("tab", "sources.pick", "select", { by: 1 }),
  row("k", "sources.pick", "select", { by: -1 }), row("up", "sources.pick", "select", { by: -1 }),
  row("enter", "sources.enter", "open"), row("alt+enter", "sources.enter", "open beside", { fresh: true }),
  row("r", "sources.refresh", "read again"), row("pgdn", "sources.scroll", "scroll", { by: 8 }), row("space", "sources.scroll", "scroll", { by: 8 }), row("pgup", "sources.scroll", "scroll", { by: -8 }),
  row("ctrl+o", "sources.place", "placement"), row("ctrl+g", "sources.grip", "move"), row("ctrl+z", "sources.undo", "undo"),
];
export const SOURCE_KEYS: readonly ModeKey[] = [
  ...SOURCES_KEYS.map(row => row.key === "enter" ? { ...row, label: "choose row" } : row),
  row("left", "sources.back", "source list"), row("e", "sources.set", "edit"), row("y", "sources.copy", "copy"), row("g", "sources.jump", "jump"),
  row("c", "sources.download", "CSV", { format: "csv" }), row("J", "sources.download", "JSON", { format: "json" }),
  row("1", "sources.fold", "query", { fold: "query" }), row("2", "sources.fold", "transform", { fold: "transform" }), row("3", "sources.fold", "result", { fold: "result" }),
];
export const SOURCE_FIELD_KEYS: readonly ModeKey[] = [
  row("esc", "sources.field", "keep field", { op: "cancel" }), row("enter", "sources.field", "save", { op: "save" }), row("ctrl+s", "sources.field", "save", { op: "save" }),
  row("ctrl+z", "sources.field", "undo typing", { op: "key", value: "ctrl+z" }),
];
export const REPLIES_KEYS: readonly ModeKey[] = [
  row("esc", "note.thread.close", "close replies"), row("q", "note.thread.close", "close replies"), row("t", "note.thread.close", "close replies"),
  row("j", "note.thread.pick", "select", { by: 1 }), row("down", "note.thread.pick", "select", { by: 1 }), row("k", "note.thread.pick", "select", { by: -1 }), row("up", "note.thread.pick", "select", { by: -1 }),
  row("enter", "note.thread.open", "open"), row("alt+enter", "note.thread.open", "open beside", { fresh: true }),
  row("b", "note.thread.groups", "links"), row("T", "note.thread.full", "full list"),
  row("K", "note.move", "up", { step: "up" }), row("alt+up", "note.move", "up", { step: "up" }), row("J", "note.move", "down", { step: "down" }), row("alt+down", "note.move", "down", { step: "down" }),
  row("I", "note.move", "in", { step: "in" }), row("O", "note.move", "out", { step: "out" }), row("Z", "note.move", "move"), row("ctrl+z", "note.move.undo", "undo move"),
];
export const REPLIES_CONTROLS = ["note.thread.full", "note.thread.groups", "note.thread.close"] as const;

export const COMMENT_KEYS: readonly ModeKey[] = [
  row("esc", "comment.escape", "close comment"), row("ctrl+s", "comment.send", "send"),
  row("ctrl+o", "comment.place", "placement"), row("ctrl+g", "comment.grip", "move"), row("ctrl+r", "comment.reload", "find quote"),
];
export const EDIT_PREVIEW_KEYS: readonly ModeKey[] = [
  row("esc", "draft.preview", "close preview", { on: false }), row("ctrl+p", "draft.preview", "close preview", { on: false }),
  row("up", "draft.scroll", "scroll", { preview: true, by: -1 }), row("k", "draft.scroll", "scroll", { preview: true, by: -1 }),
  row("down", "draft.scroll", "scroll", { preview: true, by: 1 }), row("j", "draft.scroll", "scroll", { preview: true, by: 1 }),
  row("pgup", "draft.scroll", "scroll", { preview: true, by: -10 }), row("pgdn", "draft.scroll", "scroll", { preview: true, by: 10 }),
];

export const EDIT_PREVIEW_READER_KEYS = EDIT_PREVIEW_KEYS.filter(row => row.action === "draft.preview");

export const ATTACHED_KEYS = [SOURCES_KEYS, SOURCE_KEYS, SOURCE_FIELD_KEYS, REPLIES_KEYS, COMMENT_KEYS, EDIT_PREVIEW_KEYS];
