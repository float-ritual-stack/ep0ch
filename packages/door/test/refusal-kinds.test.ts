// Nov 3 review, card 13: the door acts on a refusal's `kind` from the envelope, never on its words. Each behaviour that
// used to match the message (a trash that lost a race, a note gone, a near= that isn't live, a retry on stale) is shown
// with words that match nothing, and once against a scratch host so the kind is the wire's own. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ActionRefused } from "@ep0ch/outline-core/action-line";
import { changedSinceRead, Refused, SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

test("a trash that lost a race is told by kind: other words still count, the old words alone do not", () => {
  expect(changedSinceRead(new Refused("this wording is new", "stale-revision"))).toBe(true);
  expect(changedSinceRead(new Refused("this wording is new", "conflict"))).toBe(true);
  expect(changedSinceRead(new Refused("Block changed since it was read: x", "failed"))).toBe(false);
  expect(changedSinceRead(new Error("x"))).toBe(false);
});

test("an act refusal carries its kind, and defaults to an invalid request", () => {
  expect(new ActionRefused("no note here").kind).toBe("invalid");
  expect(new ActionRefused("no note here", "not-found").kind).toBe("not-found");
});

describe.skipIf(!outliner)("against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
  });
  afterAll(async () => { await scratch.stop(); });

  test("the host's kind comes through the door's socket as Refused.kind", async () => {
    const note = await board.createBlock(null, "Seed swap");
    const stale = await board.trash(note.id, undefined, { revision: (note.revision ?? 1) + 5 }).catch(e => e);
    expect(stale).toBeInstanceOf(Refused);
    expect((stale as Refused).kind).toBe("stale-revision");
    expect(changedSinceRead(stale)).toBe(true);
    const gone = await board.newNote("Bean row", "00000000-0000-4000-8000-000000000000", undefined, true).catch(e => e);
    expect(gone).toBeInstanceOf(Refused);
    expect((gone as Refused).kind).toBe("not-found");
    expect(await board.read("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
