// `ep0ch mark` and `ep0ch marks` (PIE-1237, src/mark-cli.ts): a mark from a shell through the service's one verb, the
// person's or an agent's (--as), listed and taken off again; `marked:today` answers it. Scratch host, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe.skipIf(!outliner)("ep0ch mark", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {}, board: SocketBoard;
  beforeAll(async () => {
    const sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    board = new SocketBoard(sock, undefined, scratch.name);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("marks as the person, lists it, an agent's look-here beside it, and --remove takes yours off", async () => {
    const beans = await board.request("create", { text: "Runner bean poles [page::bean-poles]", author: "user" });
    const r = await run(["mark", "[[bean-poles]]"], env);
    expect([r.code, r.err]).toEqual([0, ""]);
    expect(r.out).toContain("marked “Runner bean poles”: marked:today lists it");
    expect((await board.request("blocks.query", { query: { where: "marked:today" } })).blocks.map(b => b.id)).toEqual([beans.id]);
    expect((await run(["mark", "[[bean-poles]]"], env)).out).toContain("already has that mark");
    const agent = JSON.parse((await run(["mark", beans.id, "--reason", "needs your call", "--as", "gardener", "--json"], env)).out);
    expect(agent).toMatchObject({ already: false, mark: { author: "agent", by: "gardener", reason: "needs your call", surface: "cli" } });
    const listed = (await run(["marks", "--today"], env)).out;
    expect(listed).toContain("you  “Runner bean poles”");
    expect(listed).toContain("gardener  “Runner bean poles”  ◆ needs your call");
    expect((await run(["mark", "[[bean-poles]]", "--remove"], env)).out).toContain("took your mark off “Runner bean poles”");
    expect((await board.request("marks.list", {})).marks.map(m => m.by)).toEqual(["gardener"]);
    expect((await run(["mark", "[[no-such-page]]"], env)).code).toBe(1);
    expect((await run(["mark"], env)).code).toBe(2);
  }, 60_000);
});
