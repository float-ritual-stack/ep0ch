// PIE-439: the showcase, across a reset.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import { Help, MainMenu } from "../../src/screens";
import { seedShowcase } from "../../src/showcase/seed";
import { Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");


// `ep0ch --showcase --reset` while a showcase door stays open: the reset stops the host, deletes the outline and
// seeds a new one, and the open door reconnects to it. The new seed's notes are new blocks, and the same seed ends
// on the same sequence, so the catch-up finds nothing missed: the screen has to notice its root is another one and
// read the notes again, or the notebook it keeps embeds ids the new outline doesn't have (each read `◌`).
describe.skipIf(!outliner)("the showcase screen across a --reset", () => {
  const scratch = new Scratch(undefined, "showcase");
  let board: SocketBoard, app: App, sc: Showcase;
  const screen = () => sc.render(app).lines.map(plain).join("\n");
  const S = () => sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    await scratch.start();
    await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    board.reconnectMs = 50;
    await board.info();
    // Tall enough that the notebook's embeds, near its end, are on screen.
    const term = { info: { cols: 200, rows: 130, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const embeds = ["» Kitchen whiteboard", "Shopping: oats, lemons, washing-up liquid.", "» Kitchen tap ^t-7a9c11", "[~] fix the dripping tap"];

  test("the notebook's embeds show their notes after the outline is reset under the open door", async () => {
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), "the notebook's embeds before the reset", 8000);
    const before = S().notes.root.id;
    // The person has the help over it meanwhile: the showcase isn't on top, so the outline's events don't reach it.
    app.push(new Help());
    // What try-it.sh --reset does: stop the host, delete the outline, start again and seed it anew.
    await scratch.stop();
    rmSync(scratch.outlines, { recursive: true, force: true });
    mkdirSync(scratch.outlines, { recursive: true });
    await scratch.start();
    await scratch.seedShowcase();
    await until(() => (app.reconnects ?? 0) > 0, "the door reconnected", 10_000);
    app.pop();
    screen();
    await until(() => S().notes?.root?.id !== before && !!S().notes?.root, "the showcase read again", 15_000);
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), `the notebook's embeds after the reset: ${embeds.filter(m => !screen().includes(m)).join(" | ")}`, 10_000);
    expect(screen()).not.toContain("◌");
  }, 60_000);
});
