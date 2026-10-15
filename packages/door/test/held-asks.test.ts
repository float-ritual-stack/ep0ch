// Requests held for a person's r (PIE-888): an `@name` line an agent wrote that no grant lets wake its agent. The service
// keeps them (`agents.held`); the door counts them in the status bar and lists them in the waiting-on-you list beside the
// terminals' programs: ⏎ or a click opens the note, r sends the request, an agent can read and open but not send.
// A throwaway outliner with the tidy example extension, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { App, waitingText } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));

test("the status bar counts held requests beside what the terminals say", () => {
  expect(waitingText({ blocked: 0, error: 0, done: 0, held: 0 }).plain).toBe("");
  expect(waitingText({ blocked: 1, error: 0, done: 2, held: 3 }).plain).toBe("◆1 ✓2 ‖3 on you");
});

describe.skipIf(!outliner)("the waiting-on-you list shows requests held for r, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    // The tidy example answers `@tidy`: its line is held when an agent writes it.
    const dir = join(scratch.root, "config", "pi-herdr-outliner", "extensions");
    mkdirSync(dir, { recursive: true });
    cpSync(resolve(import.meta.dir, "../../outliner/extensions/tidy"), join(dir, "tidy"), { recursive: true });
    board = new SocketBoard(await scratch.start());
    await board.info();
    const held = await board.createBlock(null, "Reply to the swap thread\n*  messy  line\n@tidy", { kind: "agent", id: "loki" });
    ids.held = held.id;
    const term = { info: { cols: 160, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    void app.heldAsks.seed(board);
    await until(() => app.heldAsks.count() === 1, "the held request");
  }, 60_000);

  afterAll(async () => { app?.heldAsks.stop(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("the service says what is held and why; the door's copy and the status bar's count follow", async () => {
    expect(app.heldAsks.list()[0]).toMatchObject({ blockId: ids.held, agent: "tidy", request: "", why: "held: loki may not wake @tidy · r to send", by: "agent:loki", line: 2 });
    expect(await board.heldAsks()).toHaveLength(1);
  }, 60_000);
});
