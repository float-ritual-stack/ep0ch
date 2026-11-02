/** One landing, shared by the door's local feed and the outline's event stream. */
export interface DoorOpen {
  type: "door.open";
  at: number;
  actor: { kind: "user" } | { kind: "agent"; id: string };
  target: { tile: string; note: string; visit: string };
  source?: { tile: string; note?: string; visit?: string };
  method: "link" | "search" | "back" | "forward" | "select" | "open" | "alt" | "hover" | "action" | "agent" | "script";
}
