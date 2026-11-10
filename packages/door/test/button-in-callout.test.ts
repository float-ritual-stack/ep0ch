// PIE-1693: a `::button` inside a callout runs its sequence as it does outside one (yo writes its remembered button as
// `> ::button{…act=[…]}` in its answer callout). Pressed by label through `button.press`, as the person and as an agent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { Scratch, outliner } from "./scratch";

describe.skipIf(!outliner)("a sequence button inside a callout (PIE-1693)", () => {
  const scratch = new Scratch();
  const savedAgent = process.env.EP0CH_DAILY_AGENT, savedState = process.env.EP0CH_STATE;
  const size = { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: true };
  let board: SocketBoard, app: App;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "cat";
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App({ info: size, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(_f: (k: Key) => void) {}, onResize() {}, stop() {}, resume() {} }, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(openScreen("desk")!);
  }, 60_000);
  afterAll(async () => {
    app?.quit(); app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    if (savedState === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = savedState;
    if (savedAgent === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = savedAgent;
  });

  test("pressed from a frame drawn before an edit moved it, in a callout, it still runs its steps", async () => {
    const desk = app.keysScreen() as any;
    const note = await board.createBlock(null, 'Shelf\n\n> [!note]+ answered\n> ::button{label="Twice" act=["theme.cycle", "theme.cycle"]}');
    await app.dispatch.act({ action: "open", args: { id: note.id } }, USER);
    const reader = desk.dispatch.tile("focused");
    const surface = () => desk.pane(reader.name).surface;
    for (let i = 0; i < 100 && !surface().describeElements().some((e: { label: string }) => e.label.includes("Twice")); i++) await Bun.sleep(50);
    // Two lines written above it (the person, or yo answering above), and pressed before the reader draws again.
    const now = (await board.get(note.id))!;
    await board.update(note.id, `Top line\nanother\n${now.text}`, now.revision!, USER);
    const said = app.messages.rows.length;
    const r = await desk.dispatch.act({ action: "button.press", tile: reader.name, args: { label: "Twice" } }, USER) as { extension?: string };
    // The person's refusal is said where they look, never thrown: the log holds it.
    expect(app.messages.rows.slice(said).map(m => m.message).join("\n")).not.toContain("key=value");
    expect(r.extension).toBe(`button:${note.id}:5`);
  }, 30_000);

  for (const [where, prefix] of [["outside a callout", ""], ["in a callout", "> "]] as const) {
    test(`pressed ${where}, both steps run`, async () => {
      const note = await board.createBlock(null, `Shelf\n\n${prefix ? "> [!note]+ answered\n" : ""}${prefix}::button{label="Twice" act=["theme.cycle", "theme.cycle"]}`);
      const r = await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Twice" } }, USER) as { state?: string; message?: string };
      expect(r.message ?? "").not.toContain("key=value");
      expect(r.state).not.toBe("failed");
    }, 30_000);
  }
});
