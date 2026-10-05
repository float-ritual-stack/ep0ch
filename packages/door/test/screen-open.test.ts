// `--screen <name> [<target>]`, the one landing flag: the screen by name through `screen.open` (a menu item, a
// built-in screen, one registered at runtime), its target where it takes one (detail's block as an id, ((ref)) or
// ep0ch:// URI; the board's hub), and a name nobody knows refused with the names there are. Scratch outline,
// fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { registerScreen } from "../src/desk/screen-spec";
import { canonicalLocalMachineName } from "../src/machine-name";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { startScreens } from "../src/start";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { outliner, Scratch } from "./scratch";

describe.skipIf(!outliner)("--screen <name> [<target>], through screen.open", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, note: Msg;
  const top = () => (app as any).stack.at(-1) as { name?: string; title: string; openArgs?(): Record<string, unknown> | null };
  /** The door starting with `args`, as door.ts starts it: the screens, then the screen asked for through screen.open. */
  const start = async (args: string[]) => {
    while ((app as any).stack.length) (app as any).stack.pop();
    const s = startScreens(args, {}, () => new MainMenu());
    for (const x of s.screens) app.push(x);
    if (s.open) return app.dispatch.act({ action: "screen.open", args: { ...s.open } }, USER);
    return null;
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.outline = scratch.name;
    note = await board.request<Msg>("create", { parentId: null, text: "Seed potatoes\nChit them on the windowsill.", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a built-in screen by name, over the main menu", async () => {
    await start(["--screen", "river"]);
    expect((app as any).stack[0]).toBeInstanceOf(MainMenu);
    expect(top().name).toBe("river");
    await start(["--screen", "board", "a1111111-1111-4111-8111-111111111111"]);
    expect(top().name).toBe("board");
    expect(top().openArgs?.()).toEqual({ target: "a1111111-1111-4111-8111-111111111111" });
  });

  test("detail on its target: an id, a ((ref|label)) or this outline's URI; another outline's URI is refused", async () => {
    await start(["--screen", "detail", note.id]);
    expect(top().name).toBe("detail");
    expect(top().openArgs?.()).toEqual({ target: note.id });
    await start(["--screen", "detail", `((${note.id}|the potatoes))`]);
    expect(top().openArgs?.()).toEqual({ target: note.id });
    const uri = formatEp0chBlockUri({ outline: scratch.name, machine: canonicalLocalMachineName(), blockId: note.id });
    await start(["--screen", "detail", uri]);
    expect(top().openArgs?.()).toEqual({ target: note.id });
    await expect(start(["--screen", "detail", uri.replace(`${scratch.name}@`, "other-garden@")])).rejects.toThrow("that URI names other-garden");
    await expect(start(["--screen", "detail", "a1111111-1111-4111-8111-111111111111"])).rejects.toThrow("no block a1111111");
  });

  test("a screen registered at runtime is a --screen name with no code change", async () => {
    registerScreen("seed-tray", () => ({ name: "seed-tray", title: "seed tray", layout: { focus: "who", root: { t: "leaf", kind: "who", name: "who" } } }));
    await start(["--screen", "seed-tray"]);
    expect(top().name).toBe("seed-tray");
    expect(top().title).toBe("seed tray");
    await expect(start(["--screen", "seed-tray", "hub-1"])).rejects.toThrow("the seed-tray screen takes no target");
    const listed = await app.dispatch.act({ action: "screen.list", args: {} }, USER) as { named: { name: string; target?: string }[] };
    expect(listed.named).toContainEqual({ name: "seed-tray" });
    expect(listed.named).toContainEqual({ name: "detail", target: "note" });
  });

  test("a name nobody knows is refused with the names there are", async () => {
    await expect(start(["--screen", "nonesuch"])).rejects.toThrow(/no screen "nonesuch" · screens: .*board.*detail.* · try ep0ch --screen /);
    expect(top()).toBeInstanceOf(MainMenu);
  });
});
