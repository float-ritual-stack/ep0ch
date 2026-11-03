import { ServiceList } from "./outline-store";
import type { WaitingAsk } from "@ep0ch/outline-core/protocol";
import type { OutlineEvent, SocketBoard } from "./socket";

/** The asks waiting on the person (`waiting.list`), watched: the service says when they changed (PIE-1546). */
export class WaitingAsks extends ServiceList<WaitingAsk, SocketBoard> {
  protected read(board: SocketBoard) { return board.waitingAsks(); }
  protected watched() { return { action: "waiting.list", params: {} }; }
  protected wants(e: OutlineEvent): boolean {
    return e.domain === "content" || e.action === "reconnected" || e.action === "reset";
  }
}
