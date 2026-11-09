// Marks in the door (PIE-1237's door side; the attention marks of PIE-423): the service's marks (`marks.add`,
// `marks.remove`, `marks.list`, outliner src/marks.ts), kept as the service last answered and read again when it says a
// mark was made or taken off (its `marks` event), so a mark made in one door, on the phone or by an agent is in every
// door at once. One store per door (the App's), handed to every desk through its ctx: nothing here decides alone.
//
// A marked block is framed and labelled in every tile that shows it ("◆ needs your call · by loki" for an attention
// mark, a mark with a reason; "◆ marked · by you" for a pocket mark, the person's alt+m); a marked line of a file gets an
// extmark with virtual text in the nvim tile editing it (the extmark's id is this door's own, kept beside). `alt+'` (or
// `marks.next`) steps through them. Marks never move the person's focus, selection or cursor.
import type { MarkAddInput, MarkRecord, MarkRemoveInput } from "@ep0ch/outliner/wire";
import { ServiceList } from "../outline-store";
import { authorName, requesterOf, type Actor, type OutlineEvent, type SocketBoard } from "../socket";

export type Mark = MarkRecord;

/** The door's copy of the service's live marks. */
export class DoorMarks extends ServiceList<Mark, SocketBoard> {
  constructor() { super(30); }
  protected read(board: SocketBoard) { return board.request("marks.list", {}).then(r => r.marks); }
  protected wants(e: OutlineEvent): boolean { return e.domain === "marks" || e.action === "reconnected" || e.action === "reset"; }

  /** Mark, as `actor`; the list is read again at once, so the frame is there when the answer is. */
  async add(board: SocketBoard, input: MarkAddInput, actor: Actor): Promise<{ mark: Mark; already: boolean }> {
    const answer = await board.request("marks.add", { input: { surface: "door", ...input }, mutation: requesterOf(actor) });
    await this.seed(board);
    return answer;
  }

  /** Unmark, as `actor`: the marks taken off. */
  async remove(board: SocketBoard, input: MarkRemoveInput, actor: Actor): Promise<Mark[]> {
    const { removed } = await board.request("marks.remove", { input, mutation: requesterOf(actor) });
    await this.seed(board);
    return removed;
  }
}

/** Who made a mark, as a label says it: "you" for the person. */
export const markBy = (m: Mark) => (m.author === "user" ? "you" : authorName(m.by));

/** How a mark reads in a tile's header: its reason (an attention mark), else "marked" (a pocket mark). */
export const markLabel = (m: Mark) => `◆ ${m.line ? `line ${m.line}: ` : ""}${m.reason ?? m.words ?? "marked"} · by ${markBy(m)}`;
