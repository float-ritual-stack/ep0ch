/** The service transports door kinds unchanged; each producer owns its extra fields. */
export interface DoorEvent {
  kind: `door.${string}`;
  actor: { kind: "user" } | { kind: "agent"; id: string };
  target: { tile: string; note?: string };
  source?: { tile: string; note?: string };
  method: string;
  [field: string]: unknown;
}

/** One landing, shared by the door's local feed and the outline's event stream. */
export interface DoorOpen extends DoorEvent {
  kind: "door.open";
  type: "door.open";
  at: number;
  actor: { kind: "user" } | { kind: "agent"; id: string };
  target: { tile: string; note: string; address?: { outline: string; machine?: string }; visit: string };
  source?: { tile: string; note?: string; visit?: string };
  method: "link" | "search" | "back" | "forward" | "select" | "open" | "alt" | "hover" | "action" | "agent" | "script";
}

/**
 * What is under the pointer (PIE-1505): a link, a cut title or a note row, with its target, once the pointer has rested
 * on it. Never sent while a mouse button is down or over chrome (a bar, a hint row, the status line). The door's hover
 * primitive (packages/door/src/hover.ts) sends it; the glass extension is its first user.
 */
export interface DoorHover extends DoorEvent {
  kind: "door.hover";
  at: number;
  actor: { kind: "user" };
  /** The tile under the pointer, and the note the target names when it names one by id. */
  target: { tile: string; note?: string };
  method: "pointer";
  /** Where the link points, as the reader read it: a block, a page, another outline's, or a URL. */
  link?: { block?: string; page?: string; outline?: string; machine?: string; url?: string };
  /** The words under the pointer when they aren't a link (a cut-off title): what a post-it shows. */
  text?: string;
}
