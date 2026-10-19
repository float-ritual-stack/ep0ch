import { ServiceList } from "./outline-store";
import type { WaitingAsk } from "@ep0ch/outline-core/protocol";
import type { OutlineEvent, SocketBoard } from "./socket";

export class WaitingAsks extends ServiceList<WaitingAsk, SocketBoard> {
  protected read(board: SocketBoard) { return board.waitingAsks(); }
  protected wants(e: OutlineEvent): boolean {
    return e.domain === "content" || e.action === "reconnected" || e.action === "reset";
  }
}
