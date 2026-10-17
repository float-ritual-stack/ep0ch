// PIE-981: the showcase's "Pressable views" section. A render script draws a noughts-and-crosses board whose free squares
// each carry an action; a click, ⏎ on the element and `act` run the move script as the person, and the board is drawn
// again. Edit and rich edit keep the board drawn under its line, read-only. One of the showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

describe.skipIf(!outliner)("the showcase screen: pressable views", () => {
  const h = useShowcaseScreen();
  const { screen, press, ch } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });
  const boardOf = async () => (await board.get(seeded.notes.press.id))!.text.match(/\[board::([.xo]+)\]/)![1]!;
  /** Where a square's number is drawn on the screen, by its text row and column. */
  const find = (square: string) => {
    const rows = screen().split("\n");
    for (let y = 0; y < rows.length; y++) { const m = rows[y]!.match(new RegExp(`\\[${square}\\]`)); if (m) return { x: m.index! + 1, y }; }
    return null;
  };
  /** The square, once the board is drawn again (a move briefly leaves the line unread until the service answers). */
  const at = async (square: string) => { await until(() => !!find(square), `square ${square} drawn`, 15_000); return find(square)!; };

  test("a click on a square, ⏎ on it and act each run the move as the person; the board is drawn again", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "press" }, as: "test-agent" });
    screen();
    await until(() => /\[1\]\s+\[2\]\s+\[3\]/.test(screen()), "the board drawn with its squares", 15_000);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "ttt-move"), "the move script loaded");
    expect(await boardOf()).toBe(".........");
    // By mouse: a click on square 5.
    const five = await at("5");
    press({ kind: "mouse", action: "down", button: 0, x: five.x, y: five.y });
    press({ kind: "mouse", action: "up", button: 0, x: five.x, y: five.y });
    await untilAsync(async () => (await boardOf()) === "o...x....", "x on 5 and the reply o on 1");
    await until(() => !/\[5\]/.test(screen()) && !/\[1\]/.test(screen()), "the played squares are no longer presses", 15_000);
    // By keys: [ ] to square 9's element, ⏎.
    const nine = await at("9");
    press({ kind: "mouse", action: "down", button: 0, x: nine.x, y: nine.y });
    press({ kind: "mouse", action: "up", button: 0, x: nine.x, y: nine.y });
    await untilAsync(async () => (await boardOf()).charAt(8) === "x", "x on 9 by a second click");
    // By act: the action the square names, as the person would run it, with the slot it carries.
    const extension = extensionList()!.extensions.find(e => e.name === "ttt-move")!;
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "4" } }, USER);
    await untilAsync(async () => (await boardOf()).charAt(3) === "x", "x on 4 by act");
  }, 60_000);

  test("edit and rich edit keep the board drawn under its line, read-only, while the lines around it are edited", async () => {
    (app as any).lastInput = 0;
    screen();
    await until(() => /\[\d\]/.test(screen()), "the board drawn", 15_000);
    const played = await boardOf();
    press({ kind: "enter" });
    ch("e");
    press({ kind: "enter" });
    await until(() => /editing/.test(screen()), "the note in an edit", 5000);
    // The line is raw source now, and its last drawing is still under it; its controls are not (nothing in an edit presses).
    const pane = () => screen().split("\n").filter(l => l.includes("║")).map(l => l.split("║")[1]!.trim());
    const under = () => { const i = pane().findIndex(l => l === "ttt-board::"); return i < 0 ? [] : pane().slice(i + 1, i + 5); };
    await until(() => /∙ ttt-board/.test(under()[0] ?? "") && /\[\d\]|\[[xo]\]/.test(under()[1] ?? ""), "the board under its line in the edit");
    expect(screen()).not.toContain("[r run again]");
    // Typing around it leaves it: a new line above it moves its line down, and the drawing goes with it.
    await app.dispatch.act({ action: "draft.place", args: { line: 1, col: 1 } }, USER);
    press({ kind: "enter" });
    for (const c of "A new first line") ch(c);
    expect(pane().indexOf("ttt-board::")).toBeGreaterThan(3);
    expect(under().join("\n")).toMatch(/∙ ttt-board[\s\S]*\[[\dxo]\]/);
    // Rich edit keeps it too.
    await app.dispatch.act({ action: "rich.toggle", args: { on: true } }, USER);
    expect(screen()).toContain("[+row]");
    await until(() => /∙ ttt-board/.test(under()[0] ?? "") && /\[[\dxo]\]/.test(under()[1] ?? ""), "the board under its line in rich edit");
    await app.dispatch.act({ action: "rich.toggle", args: { on: false } }, USER);
    press({ kind: "esc" }); press({ kind: "esc" });
    await untilAsync(async () => !(/editing/.test(screen())), "the edit closed");
    // Looking and typing in a draft that was let go wrote nothing: the board is as the last move left it.
    expect(await boardOf()).toBe(played);
  }, 60_000);
});
