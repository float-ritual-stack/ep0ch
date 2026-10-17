// Yolo (PIE-973): the person lifted the agent gate for this outline, for as long as their door says so.
//
// The door's `agents.yolo` (ctrl+k > agents.yolo) sets it here as well, so an agent passes the service's own rules as
// the person would: the MCP access level, a proposal to apply or dismiss, the guard on dropped structure. It is held in
// memory, per outline, by the connection that set it: a door that disconnects, ends or restarts takes its yolo with it,
// and a service that restarts starts with it off (the door asks again when it reconnects). Nothing about who wrote what
// changes: an agent's write is still `author: agent` with its actor id, revisions still check, undo still works.

/** Who holds yolo on: the clients (doors) that turned it on and are still connected. */
export class Yolo {
  private readonly holders = new Set<string>();

  /** Whether any connected door has yolo on. */
  get on(): boolean { return this.holders.size > 0; }

  /** A door turned it on. Returns whether the state changed. */
  set(clientId: string): boolean {
    const was = this.on;
    this.holders.add(clientId);
    return this.on !== was;
  }

  /** The person took it back, on any door: off for all. Returns whether the state changed. */
  clear(): boolean {
    const was = this.on;
    this.holders.clear();
    return was;
  }

  /** A client went away: what it held goes with it. Returns whether the state changed. */
  release(clientId: string): boolean {
    const was = this.on;
    this.holders.delete(clientId);
    return was && !this.on;
  }
}
