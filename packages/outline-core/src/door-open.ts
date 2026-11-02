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
