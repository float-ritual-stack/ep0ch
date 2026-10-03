// PIE-489: the BBS shell. Esc never logs you off (Goodbye is G, a click on it, or the logon's hang-up);
// q is back on every screen; the menu and the BBS lists are actions (screen.open, screen.back, screen.list,
// list.select, list.open, list.read) that the keys, the clicks and `act` all run. An agent's screen change
// is said on the status bar and refused while the person is typing or in an edit. Scratch services and
// fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { boardScreen, openScreen } from "../src/desk/screen-specs";
import * as BV from "./board-view";
import { Conferences, MainMenu, MessageList, MessageReader, Stats } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { shellRunner } from "../src/drop";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ESC: Key = { kind: "esc" };

describe.skipIf(!outliner)("the BBS shell, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, hub: any, quits = 0;
  let key: (k: Key) => void = () => {};
  const AS = "shell-agent-9";
  const A = () => app as any;
  const top = () => A().stack.at(-1);
  const titles = () => A().stack.map((s: any) => s.title) as string[];
  const message = () => A().message as string;
  const act = (action: string, args: Record<string, unknown> = {}) => app.act({ action, args, as: AS });
  /** The person has been away from the keys: an agent may change their screen. */
  const idle = () => { A().lastInput = 0; };
  /** Back to the main menu alone, the way the person would leave whatever is open. */
  const home = () => { while (A().stack.length > 1) A().stack.pop(); };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    const plot = await make(null, "Allotment plot 7");
    await make(plot.id, "Water the leeks [type::chore] [stage::todo]");
    await make(plot.id, "Net the brassicas [type::chore] [stage::todo]");
    await make(null, "Seed library");
    hub = await make(null, "Chores board");
    await make(hub.id, "To do [type::virtual-branch] [query::type=chore stage=todo]");
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stops: 0, stop() { this.stops++; }, resume() {} };
    app = new App(term as any, board, Date.now(), () => { quits++; });
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  describe("F1: Esc never logs you off", () => {
    test("Esc on the main menu stays on the menu and says how to log off", async () => {
      home();
      key(ESC);
      expect(titles()).toEqual(["main menu"]);
      expect(message()).toContain("G logs off");
      await Bun.sleep(1800);                   // Goodbye would have quit by now
      expect(quits).toBe(0);
    });

    test("the board's Esc chain stops at the menu: one Esc too many does nothing", async () => {
      home();
      app.push(boardScreen(hub.id));
      await until(() => BV.view(A().stack.at(-1)).lanes?.[0]?.items, "the lanes", 10_000);
      for (let i = 0; i < 6; i++) key(ESC);
      expect(titles()).toEqual(["main menu"]);
      await Bun.sleep(1800);
      expect(quits).toBe(0);
    });

    test("G is still Goodbye", () => {
      home();
      key(char("G"));
      expect(top().title).toBe("logoff");
      A().stack.pop();
    });
  });

  describe("F2: q is back on every screen", () => {
    test("q on the board's lanes goes back to the menu", async () => {
      home();
      app.push(boardScreen(hub.id));
      await until(() => BV.view(A().stack.at(-1)).lanes?.[0]?.items, "the lanes", 10_000);
      expect(top().describe().focus).toBe("lanes");
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
    });

    test("q on the river goes back to the menu", () => {
      home();
      app.push(openScreen("river"));
      expect(top().name).toBe("river");
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
    });

    test("q on the menu is still the Quay (the menu is the top: nothing to go back to); q on the Quay comes back", () => {
      home();
      key(char("q"));
      expect(top().name).toBe("river");
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
      key(char("Q"));
      expect(top().name).toBe("river");
      key(ESC);
      expect(titles()).toEqual(["main menu"]);
      key(ESC);
      expect(titles()).toEqual(["main menu"]);
      expect(message()).toContain("G logs off");
    });

    test("q and Esc on a list are back", async () => {
      home();
      key(char("J"));
      expect(top()).toBeInstanceOf(Conferences);
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
      key(char("S"));
      expect(top()).toBeInstanceOf(Stats);
      key(ESC);
      expect(titles()).toEqual(["main menu"]);
    });
  });

  describe("PIE-506: the BBS screens' keys are actions, and an agent can run each", () => {
    test("menu.select: the arrows run it; an agent's lights an item, said, and waits for the person to be idle", async () => {
      home(); idle();
      const menu = top();
      const keys: string[] = menu.describe().items.map((i: string) => i.split(" ")[0]);
      const was = keys.indexOf(menu.describe().selected);
      key({ kind: "down" });
      expect(menu.describe().selected).toBe(keys[(was + 1) % keys.length]);
      idle();
      expect(await act("menu.select", { name: "S" })).toEqual({ selected: "S", label: "Stats" });
      expect(menu.describe().selected).toBe("S");
      expect(message()).toContain("an agent (shell-agent-9) · lit Stats");
      key({ kind: "up" });
      await expect(act("menu.select", { by: 1 })).rejects.toThrow(/at the keys/);
    });

    test("ctrl+letter on the menu no longer opens that letter's screen", () => {
      home();
      key({ kind: "char", ch: "s", ctrl: true });
      expect(titles()).toEqual(["main menu"]);
    });

    test("? runs screen.help; any key on help is screen.back; V runs video.cycle", async () => {
      home(); idle();
      key(char("?"));
      expect(top().title).toBe("help");
      key(char("x"));
      expect(titles()).toEqual(["main menu"]);
      idle();
      await act("screen.help");
      expect(top().title).toBe("help");
      expect(message()).toContain("an agent (shell-agent-9) · opened help");
      home();
    });

    test("who.refresh: r and an agent's act, as soon as the screen is open", async () => {
      home(); idle();
      key(char("W"));
      expect(top().title).toBe("who's online");
      const out: any = await act("who.refresh");
      expect(Array.isArray(out.callers)).toBe(true);
      expect(top().dispatch!.list().actions.map((a: any) => a.name)).toContain("who.refresh");
      home();
    });

    test("list.thread: t on a message list, and an agent's names the row", async () => {
      home(); idle();
      key(char("R"));
      await until(() => (top().listRows?.() ?? []).length > 0, "the recent list", 10_000);
      const rows = top().listRows();
      const n = rows.findIndex((r: any) => r.title === "Allotment plot 7") + 1;
      expect(n).toBeGreaterThan(0);
      idle();
      const out: any = await act("list.thread", { n });
      expect(out.opened).toBe("thread: Allotment plot 7");
      expect(top().title).toBe("thread: Allotment plot 7");
      home();
    });
  });

  describe("drop to shell (screen.shell): the person's, never an agent's", () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    test("an agent's is refused, and the terminal stays the door's", async () => {
      home(); idle();
      const stops = A().term.stops ?? 0;
      await expect(act("screen.shell")).rejects.toThrow(/an agent doesn't drop the person to a shell/);
      expect(A().term.stops ?? 0).toBe(stops);
      expect(app.suspended()).toBeNull();
      expect(message()).toContain("screen.shell refused");
      // Nor through the menu's item: `screen.open !` is the same action.
      await expect(act("screen.open", { name: "!" })).rejects.toThrow(/an agent doesn't drop the person to a shell/);
    });

    test("the person's `!`: the door suspends for the shell, waits for it, and comes back where it was", async () => {
      home();
      idle();
      await act("screen.open", { name: "stats" });
      key(char("q"));                         // back at the menu, as the person left it
      const was = shellRunner.run;
      const seen: unknown[] = [];
      let release: (code: number) => void = () => {};
      shellRunner.run = () => { seen.push(app.suspended(), (app.describe() as any).suspended); return new Promise(r => { release = r; }); };
      try {
        key(char("!"));
        await tick();
        expect(seen).toEqual(["shell", "shell"]);
        // While the shell runs, an agent doesn't move the person's screen, and nothing is painted.
        idle();
        await expect(act("screen.open", { name: "stats" })).rejects.toThrow(/door's shell/);
        release(3);
        await tick(); await tick();
        expect(app.suspended()).toBeNull();
        expect(titles()).toEqual(["main menu"]);
        expect(message()).toBe("back from the shell · it exited 3");
      } finally { shellRunner.run = was; }
    });
  });

  describe("F3: the menu and the lists are actions", () => {
    test("the menu lists the shell's actions", () => {
      home();
      const names = app.actions().actions.map((a: any) => a.name);
      expect(names).toEqual(expect.arrayContaining(["screen.open", "screen.back", "screen.list", "screen.shell"]));
    });

    test("screen.list says what the menu opens and where the person is", async () => {
      home();
      const r = await act("screen.list") as any;
      expect(r.stack).toEqual(["main menu"]);
      expect(r.screens.map((s: any) => s.key)).toEqual(expect.arrayContaining(["N", "J", "K", "S", "D", "X", "T"]));
    });

    test("an agent opens a screen by its key or its name, said on the status bar; q brings the person back", async () => {
      home(); idle();
      const r = await act("screen.open", { name: "stats" }) as any;
      expect(r).toMatchObject({ opened: "board stats" });
      expect(top()).toBeInstanceOf(Stats);
      expect(message()).toContain(`an agent (${AS})`);
      expect(message()).toContain("board stats");
      expect(A().messageUntil - Date.now()).toBeGreaterThan(5000);   // "q goes back" stays 6s, through asActor
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
      idle();
      await act("screen.open", { name: "J" });
      expect(top()).toBeInstanceOf(Conferences);
      idle();
      await act("screen.back");
      expect(titles()).toEqual(["main menu"]);
    });

    test("an agent can't log the person off, go back from the menu, or name a screen that isn't there", async () => {
      home(); idle();
      await expect(act("screen.open", { name: "G" })).rejects.toThrow(/log/);
      await expect(act("screen.open", { name: "goodbye" })).rejects.toThrow(/log/);
      await expect(act("screen.back")).rejects.toThrow(/main menu/);
      await expect(act("screen.open", { name: "nowhere" })).rejects.toThrow(/no screen/);
      expect(titles()).toEqual(["main menu"]);
    });

    test("while the person is at the keys, an agent's screen change is refused, not done over them", async () => {
      home();
      key({ kind: "down" });                    // the person just moved the menu's light
      await expect(act("screen.open", { name: "S" })).rejects.toThrow(/typing|keys/);
      expect(titles()).toEqual(["main menu"]);
      await expect(act("screen.list")).resolves.toBeTruthy();   // reading is always fine
    });

    test("an edit, a comment or the property panel the person is in holds their screen, however long they pause", async () => {
      home();
      const b = boardScreen(hub.id), B: any = BV.view(b);
      app.push(b);
      await until(() => B.lanes[0]?.items?.length && B.preview.msg && !B.preview.msg.partial, "the lanes and the preview", 10_000);
      const refused = async () => {
        idle();                                 // they've paused longer than the idle window
        await expect(act("screen.open", { name: "S" })).rejects.toThrow(/edit, a comment or the property panel/);
        await expect(act("screen.back")).rejects.toThrow(/edit, a comment or the property panel/);
        expect(top()).toBe(b);
      };
      key(char("e"));                           // an edit in the preview
      await until(() => !!B.preview.draft, "the draft");
      await refused();
      key(ESC);
      await until(() => !B.preview.draft, "the edit closed");
      key(char("i"));                           // the property panel
      await until(() => !!B.preview.surface.panel, "the panel");
      await refused();
      key(ESC);
      await until(() => !B.preview.surface.panel, "the panel closed");
      key(char("C"));                           // a comment: picking the passage
      await until(() => !!B.preview.surface.session, "the comment session");
      await refused();
      key(ESC);
      await until(() => !B.preview.surface.session, "the comment closed");
      // Nothing held: after the idle window, the agent may move them, and q brings them back.
      idle();
      await act("screen.open", { name: "S" });
      expect(top()).toBeInstanceOf(Stats);
      key(char("q"));
      expect(top()).toBe(b);
    });

    test("a river column's filter being typed (/) holds the person's screen too", async () => {
      home();
      app.push(openScreen("river"));
      key(char("/"));
      idle();
      await expect(act("screen.back")).rejects.toThrow(/edit, a comment or the property panel/);
      expect(top().name).toBe("river");
      key(ESC);
      idle();
      await act("screen.back");
      expect(titles()).toEqual(["main menu"]);
    });

    test("an agent can't open a second copy of a screen already on the stack (a desk would start its programs twice)", async () => {
      home();
      app.push(openScreen("river"));
      idle();
      await expect(act("screen.open", { name: "Q" })).rejects.toThrow(/already open/);
      idle();
      await act("screen.open", { name: "S" });
      expect(top()).toBeInstanceOf(Stats);
      idle();
      await expect(act("screen.open", { name: "river" })).rejects.toThrow(/already open under this screen/);
      expect(titles().filter(t => t === titles()[1])).toHaveLength(1);
      key(char("q")); key(char("q"));
      expect(titles()).toEqual(["main menu"]);
    });

    test("on a list: list.read reads the rows without moving anything; list.select and list.open act as ⏎ does", async () => {
      home(); idle();
      await act("screen.open", { name: "Join" });
      const confs = top() as Conferences;
      await until(() => ((confs as any).confs?.length ?? 0) >= 3, "the conferences");
      expect(app.actions().actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["list.select", "list.open", "list.read", "screen.back"]));
      const read = await act("list.read") as any;
      expect(read.selected).toBe(1);
      const n = read.rows.findIndex((r: any) => r.title === "Allotment plot 7") + 1;
      expect(n).toBeGreaterThan(0);
      expect((await act("list.read")) as any).toMatchObject({ selected: 1 });
      idle();
      await act("list.select", { n });
      expect((confs as any).sel).toBe(n - 1);
      expect(message()).toContain(`an agent (${AS})`);
      idle();
      await act("list.open");
      expect(top()).toBeInstanceOf(MessageList);
      await until(() => ((top() as any).items?.length ?? 0) === 2, "the plot's messages");
      const rows = (await act("list.read") as any).rows.map((r: any) => r.title);
      expect(rows.sort()).toEqual(["Net the brassicas", "Water the leeks"]);
      idle();
      await act("list.open", { n: 2 });
      expect(top()).toBeInstanceOf(MessageReader);
      idle();
      await act("screen.back"); idle();
      await act("screen.back"); idle();
      await act("screen.back");
      expect(titles()).toEqual(["main menu"]);
    });

    test("the person's keys on a list run the same actions", async () => {
      home();
      key(char("J"));
      const confs = top() as Conferences;
      await until(() => ((confs as any).confs?.length ?? 0) >= 3, "the conferences");
      A().message = "";
      key(char("j"));
      expect((confs as any).sel).toBe(1);
      expect(message()).not.toContain("an agent");
      key({ kind: "enter" });
      expect(top()).toBeInstanceOf(MessageList);
      key(char("q")); key(char("q"));
      expect(titles()).toEqual(["main menu"]);
    });

    test("list.select and list.open are refused on a screen with no list, with the reason", async () => {
      home(); idle();
      await expect(act("list.select", { n: 1 })).rejects.toThrow(/no list|no action/);
    });

    test("`open <id>` from the menu opens the note in a message reader over it", async () => {
      home(); idle();
      const [m] = await board.search("Seed library", 5);
      await app.act({ action: "open", args: { id: m!.id } });
      expect(top()).toBeInstanceOf(MessageReader);
      key(char("q"));
      expect(titles()).toEqual(["main menu"]);
    });

    test("the menu has the shell's open: act open, attributed, waits for the person to be idle (E1)", async () => {
      home(); idle();
      const [m] = await board.search("Seed library", 5);
      expect(app.actions().actions.filter(a => a.name === "open")).toHaveLength(1);
      const r = await act("open", { id: m!.id }) as any;
      expect(r).toMatchObject({ id: m!.id, opened: m!.id });
      expect(top()).toBeInstanceOf(MessageReader);
      expect(message()).toContain(`an agent (${AS})`);
      // A message reader's own open pushes a screen too: the same idle wait.
      A().lastInput = Date.now();
      await expect(act("open", { id: m!.id })).rejects.toThrow(/at the keys/);
      expect(titles()).toHaveLength(2);
      key(char("q"));
      home(); A().lastInput = Date.now();
      await expect(act("open", { id: m!.id })).rejects.toThrow(/at the keys/);
      expect(titles()).toEqual(["main menu"]);
      idle();
      await expect(act("open", { id: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/no block/);
    });
  });
});
