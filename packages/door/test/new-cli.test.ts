// `ep0ch new` (PIE-544, src/new-cli.ts): a new note from outside the door, through the service call the door's
// note.new makes (`notes.create`): an empty outline gets its first note from a shell or an agent. Scratch host,
// fictional notes.
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

describe.skipIf(!outliner)("ep0ch new on an empty outline", () => {
  const scratch = new Scratch();
  let env: Record<string, string> = {}, board: SocketBoard, inbox = "";
  beforeAll(async () => {
    const sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    board = new SocketBoard(sock, undefined, scratch.name);
    inbox = (await board.roots()).find(r => r.props["system-view"] === "inbox")!.id;
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("the words are the note, made at the top of the Inbox as the person; it says where, and its id", async () => {
    const r = await run(["new", "Seed", "swap", "Saturday"], env);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const id = r.out.trim().split(/\s+/).at(-1)!;
    expect(r.out).toContain("made “Seed swap Saturday” in the Inbox");
    expect(await board.get(id)).toMatchObject({ text: "Seed swap Saturday", parentId: inbox, author: "user" });
  }, 30_000);

  test("--as names the agent; --near puts it under a note; --json says it all; [page::x] titles itself", async () => {
    const r = await run(["new", "[page::2026-10-04]", "--as", "gardener", "--json"], env);
    expect(r.code).toBe(0);
    const made = JSON.parse(r.out);
    expect(made).toMatchObject({ title: "2026-10-04", parentId: inbox, rule: "inbox", said: "in the Inbox" });
    expect(await board.get(made.id)).toMatchObject({ text: "2026-10-04 [page::2026-10-04]", author: "gardener" });
    const under = JSON.parse((await run(["new", "Beans up", "--near", made.id, "--json"], env)).out);
    expect(under).toMatchObject({ parentId: made.id, rule: "near" });
  }, 30_000);

  test("a --near that's gone is refused with the command to run instead; no text is refused, naming the form", async () => {
    const gone = await board.request<{ id: string }>("create", { parentId: null, text: "Old bed plan", author: "agent" });
    await board.trash(gone.id);
    const ok = await run(["new", "Beans up", "--near", gone.id], env);
    expect(ok.code).toBe(1);
    expect(ok.err).toContain(`No live note ${gone.id}`);
    expect(ok.err).toContain("in the Inbox instead: ep0ch new 'Beans up'");
    const none = await run(["new"], env);
    expect(none.code).toBe(2);
    expect(none.err).toContain('ep0ch new "<text>"');
  }, 30_000);
});
