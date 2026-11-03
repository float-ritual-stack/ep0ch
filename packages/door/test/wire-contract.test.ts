// The wire contract (PIE-1375): the door asks the outline host by action name and gets that action's answer type, the
// outliner's own (@ep0ch/outliner/wire). This file holds the contract to biting: each `@ts-expect-error` below is a
// drift the check must refuse, so if the contract ever stops checking, `bun run check` fails on the unused directive.
import { describe, expect, test } from "bun:test";
import { SocketBoard, type Reads, type WireAnswer } from "../src/socket";

/** A board that answers every ask with `answer`, saying what it was asked. */
function asked(answer: unknown) {
  const board = Object.create(SocketBoard.prototype) as SocketBoard;
  const sent: { action: string; params: Record<string, unknown> }[] = [];
  (board as unknown as { send: SocketBoard["send"] }).send = async (action, params = {}) => { sent.push({ action, params }); return answer; };
  return { board, sent };
}

describe("the door's asks compile against the host's answers", () => {
  test("a request names its action, sends its fields as they are and answers the action's type", async () => {
    const { board, sent } = asked({ blocks: [], unavailable: [], fields: ["title"] });
    const r = await board.request("blocks.read", { ids: ["3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650"], fields: ["title"] });
    expect(sent).toEqual([{ action: "blocks.read", params: { ids: ["3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650"], fields: ["title"] } }]);
    expect(r.unavailable).toEqual([]);
  });

  test("what the check refuses", () => {
    const { board } = asked({});
    const never = () => {
      // @ts-expect-error a field of the wrong type: blocks.read takes ids as strings
      void board.request("blocks.read", { ids: [1] });
      // @ts-expect-error a field the action doesn't take
      void board.request("children", { parentId: null, depth: 2 });
      // @ts-expect-error an action the host doesn't answer
      void board.request("blocks.teleport", {});
      // @ts-expect-error a required field left out: move names its block
      void board.request("move", { parentId: null, expectedRevision: 1, mutation: { author: "user" } });
      return board.request("children", { parentId: null }).then(rows => {
        // @ts-expect-error a field no answer has: children answers blocks, and a block has no `title`
        void rows[0]?.title;
        // A field every block carries reads as itself.
        const text: string | undefined = rows[0]?.text;
        return text;
      });
    };
    expect(typeof never).toBe("function");
  });

  test("a reader's view is held to the wire type it reads", () => {
    type Wire = WireAnswer<"agents.yolo">;
    // The view reads what the host sends.
    type Fine = Reads<{ yolo: boolean }, Wire>;
    // @ts-expect-error the view reads a field the host never sends as that type
    type Drifted = Reads<{ yolo: string }, Wire>;
    const fine: Fine = { yolo: true };
    expect(fine.yolo).toBe(true);
    expect(((x?: Drifted) => x)()).toBeUndefined();
  });
});
