// The requests held for a person's `r` (PIE-888): an `@name` line an agent or an extension wrote that no grant lets
// wake its agent. The service keeps them (`agents.held`: the note, the agent, why it waits); this is the door's copy
// (a `ServiceList`, src/outline-store.ts), which the status bar counts and the waiting-on-you list shows beside the
// terminals' programs. The door never decides what is held.
import { ServiceList } from "./outline-store";
import type { HeldAsk, OutlineEvent, SocketBoard } from "./socket";

export class HeldAsks extends ServiceList<HeldAsk, SocketBoard> {
  protected read(board: SocketBoard) { return board.heldAsks(); }

  /** A content change, a held request changing (the service says so as an `extensions.agent` event) or a reconnect. */
  protected wants(e: OutlineEvent): boolean {
    const agent = e.domain === "resource-catalog" && e.action === "extensions.agent";
    return e.change?.kind !== "draft" && (e.domain === "content" || agent || e.action === "reconnected" || e.action === "reset");
  }
}
