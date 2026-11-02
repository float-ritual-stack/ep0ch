// PIE-1517: a press keeps its actor and its note. An agent's `button.press note=<other note>` on a button whose action
// is a comment runs as that agent, on the note it names: the person's reader (its note, its focus, its keys) stays as it
// was, and the comment lands on the named note attributed to the agent, or the press is refused with why. Made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { openScreen } from "../src/desk/screen-specs";
import type { Desk } from "../src/desk/desk";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { Scratch, outliner } from "./scratch";

describe.skipIf(!outliner)("an agent's press acts on the note it names, never the person's reader (PIE-1517)", () => {
  const scratch = new Scratch();
  const savedAgent = process.env.EP0CH_DAILY_AGENT, savedState = process.env.EP0CH_STATE;
  const size = { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: true };
  let board: SocketBoard, app: App, desk: Desk;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "cat";
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App({ info: size, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(_f: (k: Key) => void) {}, onResize() {}, stop() {}, resume() {} }, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    await app.loadExtensions();
    desk = openScreen("desk")! as Desk;
    app.push(desk);
  }, 60_000);
  afterAll(async () => {
    app?.quit(); app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    if (savedState === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = savedState;
    if (savedAgent === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = savedAgent;
  });

  const reader = () => desk.pane("reader") as any;
  const AGENT = "kitty-press";

  test("the person's reader keeps its note, focus and keys; the comment lands on the pressed note as the agent, or is refused", async () => {
    const reading = await board.createBlock(null, "Plant the garlic\nCloves pointy end up, a hand apart.");
    const other = await board.createBlock(null, [
      "Frost dates",
      "Last frost is mid May.",
      '::button{label="Ask" act="comment.note"}',
      '::button{label="Note it" act="comment.note body=\\"Check the frost dates\\""}',
      '::button{label="Quote" act="comment quote=\\"mid May\\" body=\\"Which year?\\""}',
    ].join("\n"));
    await desk.dispatch.act({ action: "open", args: { id: reading.id }, tile: "reader" }, USER);
    await desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    for (let i = 0; i < 100 && reader().surface?.msg?.id !== reading.id; i++) await Bun.sleep(30);
    expect(reader().surface.msg.id).toBe(reading.id);
    const focus = desk.focusName();

    const unchanged = () => {
      expect(reader().surface.msg.id).toBe(reading.id);
      expect(reader().surface.session).toBeNull();
      expect(desk.focusName()).toBe(focus);
    };
    const press = (label: string) => app.act({ action: "button.press", args: { note: other.id, label }, as: AGENT }).then(r => ({ ok: r }), (e: Error) => ({ refused: e.message }));
    const threadsOn = (id: string) => board.comments(id);

    // Open nowhere: each press is refused with why, or lands on the note it names.
    for (const label of ["Ask", "Note it", "Quote"]) {
      const before = (await threadsOn(other.id)).length;
      const r = await press(label);
      unchanged();
      expect(await threadsOn(reading.id)).toHaveLength(0);
      if ("refused" in r) expect(r.refused).toMatch(/open it first \(open id=/);
      else {
        const after = await threadsOn(other.id);
        expect(after.length).toBe(before + 1);
        expect(after.map(c => c.author)).toContain(AGENT);
      }
    }

    // Open in another reader the person isn't in: the comment lands there, on that note, as the agent; the person's reader stays.
    await desk.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "frost", note: other.id }, tile: "reader" }, USER);
    await desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    for (let i = 0; i < 100 && (desk.pane("frost") as any)?.surface?.msg?.id !== other.id; i++) await Bun.sleep(30);
    const before = (await threadsOn(other.id)).length;
    const r = await press("Note it");
    expect(r).toHaveProperty("ok");
    unchanged();
    expect(await threadsOn(reading.id)).toHaveLength(0);
    const after = await threadsOn(other.id);
    expect(after).toHaveLength(before + 1);
    expect(after.find(c => c.body === "Check the frost dates")?.author).toBe(AGENT);
    // An agent's comment is sent at once: one with no body is refused, saying so.
    expect(await press("Ask")).toMatchObject({ refused: expect.stringMatching(/body=/) });
    unchanged();
  }, 60_000);

  // Codex on #1209: three routes that still wrote to the reader the person holds. A in the focused reader, B in another.
  test("with B open beside the person's A: the person's press, an agent pointed at A, and a sequence all act on B", async () => {
    const a = await board.createBlock(null, "Prune the roses\nJust above an outward bud.");
    const b = await board.createBlock(null, [
      "Rose feed",
      '::button{label="Feed" act="comment.note body=\\"Feed in April\\""}',
      '::button{label="Seq" act="[comment.note body=hello, theme.cycle]"}',
    ].join("\n"));
    await desk.dispatch.act({ action: "open", args: { id: a.id }, tile: "reader" }, USER);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "feed", note: b.id }, tile: "reader" }, USER);
    await desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    for (let i = 0; i < 100 && ((desk.pane("feed") as any)?.surface?.msg?.id !== b.id || reader().surface?.msg?.id !== a.id); i++) await Bun.sleep(30);
    const focus = desk.focusName();
    const still = () => { expect(reader().surface.msg.id).toBe(a.id); expect(reader().surface.session).toBeNull(); expect(desk.focusName()).toBe(focus); };
    const bodies = async (id: string) => (await board.comments(id)).map(c => `${c.author}: ${c.body}`);

    // The person's own press of B (the status bar's route, App.dispatch): B's reader, not their focus.
    await app.dispatch.act({ action: "button.press", args: { note: b.id, label: "Feed" } }, USER);
    expect(await bodies(a.id)).toEqual([]);
    expect(await bodies(b.id)).toContain("user: Feed in April");

    // An agent whose own focus is on A: its press of B still acts on B.
    await app.act({ action: "agent.focus", tile: "reader", as: AGENT });
    await app.act({ action: "button.press", args: { note: b.id, label: "Feed" }, as: AGENT });
    still();
    expect(await bodies(a.id)).toEqual([]);
    expect(await bodies(b.id)).toContain(`${AGENT}: Feed in April`);
    await app.act({ action: "agent.focus", args: { clear: true }, as: AGENT });

    // A sequence's steps run where its press acts: B, for the person and for an agent.
    // (A step is the run's own, said as the script on whoever's press: `script:Seq`.)
    const hellos = async () => (await bodies(b.id)).filter(x => x === "script:Seq: hello").length;
    for (const [n, run] of [[1, () => app.dispatch.act({ action: "button.press", args: { note: b.id, label: "Seq" } }, USER)], [2, () => app.act({ action: "button.press", args: { note: b.id, label: "Seq" }, as: AGENT })]] as const) {
      await run();
      for (let i = 0; i < 100 && (await hellos()) < n && !(await bodies(a.id)).length; i++) await Bun.sleep(50);
      expect(await bodies(a.id)).toEqual([]);
      expect(await hellos()).toBe(n);
      still();
    }
  }, 60_000);

  test("the person's own press of a note open nowhere still acts where they are (a status-bar button)", async () => {
    const reading = await board.createBlock(null, "Mulch the beds\nStraw, ten centimetres.");
    const bar = await board.createBlock(null, 'Bar buttons\n::button{label="Note here" act="comment.note body=\\"Straw from the farm\\""}');
    await desk.dispatch.act({ action: "open", args: { id: reading.id }, tile: "reader" }, USER);
    await desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    for (let i = 0; i < 100 && reader().surface?.msg?.id !== reading.id; i++) await Bun.sleep(30);
    await app.dispatch.act({ action: "button.press", args: { note: bar.id, label: "Note here" } }, USER);
    expect((await board.comments(reading.id)).map(c => c.body)).toContain("Straw from the farm");
    expect(await board.comments(bar.id)).toHaveLength(0);
  }, 60_000);
});
