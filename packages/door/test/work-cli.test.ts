// `ep0ch work stage|set … --as <id>` (PIE-1760): the door's work command lists `--as` for an agent writer, so it
// records the write as that agent, and the person's own run (no --as) is recorded as the person. Scratch host only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

describe.skipIf(!outliner)("ep0ch work stage with --as", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  const work = async (...args: string[]) => {
    const p = Bun.spawn(["bun", MAIN, "work", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock } });
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    return { out, err, code };
  };
  const lastWriter = async (id: string) => {
    const page = await board.request("changes.since", { sequence: 0, limit: 500 }) as { changes?: { blockId?: string; actor?: { author: string; actorId?: string } }[] };
    return page.changes?.filter(c => c.blockId === id).at(-1)?.actor;
  };

  test("--as names the agent the stage change is recorded as; without it, the person", async () => {
    const ticket = (await board.request("create", { parentId: null, text: "Mend the gate [type::roadmap-item] [work-stage::queued] [work-id::GATE-7]", author: "user" })).id as string;
    const asAgent = await work("stage", ticket, "doing", "--as", "fern");
    expect({ code: asAgent.code, err: asAgent.err }).toEqual({ code: 0, err: "" });
    expect((await board.get(ticket))!.text).toContain("[work-stage::doing]");
    expect(await lastWriter(ticket)).toMatchObject({ author: "agent", actorId: expect.stringMatching(/^fern\b/) });
    const asPerson = await work("stage", ticket, "review");
    expect(asPerson.code).toBe(0);
    expect(await lastWriter(ticket)).toMatchObject({ author: "user" });
  }, 30_000);
});
