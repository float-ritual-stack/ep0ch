// PIE-498: the general drawer. Any tile joins your drawer as a tab and leaves it again into the screen shown,
// whole: a terminal's program keeps running (the same pid), a reader keeps its note. By `act` (tile.drawer, attributed,
// never the person's keys), by ^W a, by a drag onto the drawer's chip or out of the dock, and by a key while dragging.
// It's saved (drawer-tiles.json) and comes back in the next door. Scratch outline host, fictional notes, `cat` programs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { PtyPane } from "../src/desk/pty";
import { outlineState } from "../src/state";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[^m]*m/g, "");
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });
const mouse = (action: "down" | "up" | "drag", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });
const USER = { kind: "user" } as const;
const AS = "drawer-agent-498";

describe.skipIf(!outliner)("the drawer: any tile, moved whole between screens", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  /** Who hears the outline's events (the board takes one subscriber): the door a test points it at. */
  let listen: ((e: any) => void) | null = null;
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(e => listen?.(e));
    await board.request<any>("create", { parentId: null, text: "Seed potatoes: chit them by the window", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-drawertiles-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  // bun:test doesn't run a function beforeEach returns: the environment and the state folder go back here.
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  /** A door on the desk with a terminal tile running `cat` (named `kettle`), on a fake 140x40 terminal. */
  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    paint();
    const kettle = () => desk.pane("kettle") as PtyPane | undefined;
    await until(() => kettle()?.running === true, "kettle runs");
    const inDrawer = (name: string) => app.drawer.tabs().some(t => t.name === name);
    const pane = (name: string) => app.drawer.desk!.pane(name);
    return { app, desk, key: (k: Key) => key(k), paint, kettle, inDrawer, pane, A: app as any };
  }
  /** Another screen (last callers), on top: the screen switch. */
  const otherScreen = () => new Desk({ name: "lastcall", title: "last callers", layout: { focus: "activity", root: { t: "split", dir: "row", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "activity", name: "activity" }, { t: "leaf", kind: "reader", name: "notes" }] } as any } });

  test("an agent puts a terminal tile by act: moved, not started again; said; the dock and the person's keys stay put", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      const out = await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS }) as any;
      expect(out).toMatchObject({ tile: "kettle", inDrawer: true, from: "desk" });
      expect(d.desk.pane("kettle")).toBeUndefined();
      expect(d.inDrawer("kettle")).toBe(true);
      const p = d.pane("kettle") as PtyPane;
      expect(p.pid).toBe(pid);                                   // the same program: moved, not respawned
      expect(p.running).toBe(true);
      expect(d.app.drawer.open).toBe(false);                       // an agent's drawer doesn't pull it up
      expect(d.desk.focusedName()).toBe("tree");                 // nor move the person's keys
      expect(d.A.message).toContain(`an agent (${AS})`);
      expect(d.paint().at(-1)).toContain("▲ cat +1");          // the chip: its own program, and one more tile
    } finally { d.app.quit(); }
  });

  test("it travels: switch screens, pull the drawer up, it's the same tile; take it into the other screen beside a tile", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      const other = otherScreen();
      d.app.push(other);
      d.paint();
      // Shown on its tab in the drawer, on the other screen.
      d.key({ kind: "alt", ch: "a" });
      expect(d.app.drawer.open).toBe(true);
      await d.app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      const shown = d.paint();
      expect(shown.some(l => l.includes("kettle"))).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      // Out of the drawer, into the other screen, right of its notes reader: the person's.
      const out = await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "notes", where: "right" }, tile: "kettle" }, USER) as any;
      expect(out).toMatchObject({ tile: "kettle", inDrawer: false, into: "last callers" });
      expect(d.inDrawer("kettle")).toBe(false);
      const back = other.pane("kettle") as PtyPane;
      expect(back.pid).toBe(pid);
      expect(back.running).toBe(true);
      // And it types: the same program, its screen kept.
      back.input("still here\r");
      await until(() => back.text().some(l => l.includes("still here")), "cat echoes");
    } finally { d.app.quit(); }
  });

  test("keys: ^W a puts the focused tile (the drawer comes up on it); ^W a in the drawer puts it back into the screen", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "thread" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("thread"), "thread in");
      expect(d.app.drawer.open).toBe(true);
      expect(d.app.drawer.tabs().find(t => t.name === "thread")?.shown).toBe(true);
      d.paint();
      // Into the drawer (a click in it), then ^W a there: back beside the tile the person had.
      const r = d.app.drawer.rect!;
      d.key(mouse("down", 20, r.row + 3)); d.key(mouse("up", 20, r.row + 3));
      expect(d.app.drawer.entered).toBe(true);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => !d.inDrawer("thread"), "thread out");
      expect(d.desk.pane("thread")).toBeDefined();
    } finally { d.app.quit(); }
  });

  test("keys for a terminal in the drawer: in the drawer its keys are its program's, so ^W A on the screen brings it back", async () => {
    const d = await door();
    try {
      const pid = d.kettle()!.pid;
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      d.paint();
      // Into the drawer: typing in the kettle (^W is the program's there); ctrl+] back to the desk.
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      expect(d.app.drawer.entered).toBe(true);
      d.key({ kind: "char", ch: "]", ctrl: true });
      expect(d.app.drawer.entered).toBe(false);
      d.key(ctrl("w")); d.key({ kind: "char", ch: "A" });
      await until(() => !d.inDrawer("kettle") && !!d.desk.pane("kettle"), "^W A brings it back");
      expect((d.desk.pane("kettle") as PtyPane).pid).toBe(pid);
    } finally { d.app.quit(); }
  });

  test("a terminal in the drawer that exited closes by ^W x in the drawer (its keys wait, but ^W is the window's again); said on screen", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.made?.rawKeys(), "the person types in the kettle");
      // An agent never closes the tab the person types in.
      await expect(d.app.act({ action: "tile.close", args: {}, tile: "kettle", as: AS })).rejects.toThrow(/keys|typing/);
      d.app.drawer.rawInput(d.A.drawerRun)!("\x04");
      await until(() => (d.pane("kettle") as PtyPane).exited !== null, "cat ended");
      expect(d.paint().some(l => l.includes("kettle exited · ⏎ runs it again · ^W x closes · Esc or ctrl+] back to the desk"))).toBe(true);
      // Any other key waits; ^W x closes it at once (nothing runs to ask about), the person still in the drawer.
      d.key(char("x"));
      expect(d.inDrawer("kettle")).toBe(true);
      d.key(ctrl("w")); d.key(char("x"));
      await until(() => !d.inDrawer("kettle"), "^W x closed it");
      expect(d.app.drawer.entered).toBe(true);
      // The drawer's own tab, exited too, doesn't offer ^W x: it never closes.
      expect(d.app.drawer.made!.exitedSay("drawer.agent")).not.toContain("^W x");
    } finally { d.app.quit(); }
  });

  test("the mouse: a tab in the drawer has the ×; a running program asks twice, one that exited closes at once; the drawer's own tab has none", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      const x = () => { const lines = d.paint(), row = d.app.drawer.rect!.row + 1; return { row, col: lines[row]!.lastIndexOf("×") }; };
      const click = () => { const at = x(); expect(at.col).toBeGreaterThan(0); d.key(mouse("down", at.col, at.row)); d.key(mouse("up", at.col, at.row)); };
      click();
      expect(d.inDrawer("kettle")).toBe(true);                   // running: asked first
      click();
      await until(() => !d.inDrawer("kettle"), "the second click closed it");
      expect(x().col).toBe(-1);                                 // the drawer's own tab: no ×
      // A terminal opened in the drawer (alt+s) that exited: one click.
      d.key({ kind: "alt", ch: "s" });
      await until(() => d.app.drawer.tabs().length === 2, "a shell tab");
      const shell = d.app.drawer.tabs().find(t => t.name !== "drawer.agent")!.name;
      await until(() => (d.pane(shell) as PtyPane).running, "the shell runs");
      await until(() => !!d.app.drawer.made?.rawInput(), "the person types in it");
      d.app.drawer.rawInput(d.A.drawerRun)!("exit\r");
      await until(() => (d.pane(shell) as PtyPane).exited !== null, "the shell exited");
      click();
      await until(() => d.app.drawer.tabs().length === 1, "closed at once");
    } finally { d.app.quit(); }
  });

  test("the mouse: a tile's title dragged onto the drawer's chip puts it (the chip lights up); a tab dragged out lands by the screen's drop zones", async () => {
    const d = await door();
    try {
      const lines = d.paint();
      const head = (d.desk.describe().panes as any[]).find(p => p.name === "activity").rect;
      const chip = d.app.drawer.chipAt!;
      d.key(mouse("down", head.col + 4, head.row));
      d.key(mouse("drag", head.col + 8, head.row + 2));
      d.key(mouse("drag", chip.from + 1, chip.row));
      expect(d.paint().at(-1)).toContain("⤓ activity into your drawer: travels with you");     // the drop zone lights up
      d.key(mouse("up", chip.from + 1, chip.row));
      await until(() => d.inDrawer("activity"), "activity in");
      expect(lines.length).toBeGreaterThan(0);
      // Pulled up (the person's drawer shows it); its tab's title dragged out over the screen's tree: lands there.
      expect(d.app.drawer.open).toBe(true);
      d.paint();
      const r = d.app.drawer.rect!;
      const tabRow = r.row + 1;
      const row = d.paint()[tabRow]!;
      const at = row.indexOf("activity");
      expect(at).toBeGreaterThan(0);
      d.key(mouse("down", at + 1, tabRow));
      d.key(mouse("drag", at + 4, tabRow));
      const tree = (d.desk.describe().panes as any[]).find(p => p.name === "tree").rect;
      d.key(mouse("drag", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      d.key(mouse("up", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      await until(() => !d.inDrawer("activity") && !!d.desk.pane("activity"), "activity back on the desk");
    } finally { d.app.quit(); }
  });

  test("a key while dragging acts on the dragged tile: a puts it in the drawer, f floats it, p puts it in a dock", async () => {
    const d = await door();
    try {
      d.paint();
      const head = (n: string) => (d.desk.describe().panes as any[]).find(p => p.name === n).rect;
      const grab = (n: string) => { const h = head(n); d.key(mouse("down", h.col + 4, h.row)); d.key(mouse("drag", h.col + 9, h.row + 3)); };
      grab("activity"); d.key(char("a"));
      await until(() => d.inDrawer("activity"), "a puts it in");
      d.paint();
      grab("thread"); d.key(char("f"));
      await until(() => (d.desk.layoutGet() as any).floats.some((f: any) => f.tile === "thread"), "f floats");
      d.paint();
      // p on the float: straight into a dock (one step), and ^W f floats it again: float → dock → float.
      await d.desk.dispatch.act({ action: "tile.dock", args: { on: true }, tile: "thread" }, USER);
      expect((d.desk.layoutGet() as any).floats).toEqual([]);
      expect((d.desk.layoutGet() as any).tiles.find((t: any) => t.name === "thread").dock).toBeTruthy();
      await d.desk.dispatch.act({ action: "tile.float", args: {}, tile: "thread" }, USER);
      expect((d.desk.layoutGet() as any).floats.map((f: any) => f.tile)).toEqual(["thread"]);
    } finally { d.app.quit(); }
  });

  test("the drawer's own tab leaves onto the screen, its program running, and the drawer starts a new one when it comes up; it never closes, said plainly", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.running === true, "the drawer's own program runs");
      const own = d.app.drawer.tile!, pid = own.pid, name = d.app.drawer.name;
      // ^W x on it: what and why in a person's words, no kind or policy names.
      const why = await d.app.drawer.desk!.dispatch.act({ action: "tile.close", args: {}, tile: "drawer.agent" }, USER).then(() => "", (e: Error) => e.message);
      expect(why).toContain("your drawer's own program doesn't close");
      expect(why).not.toMatch(/drawer\.own|closable|draggable/);
      const out = await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER) as any;
      expect(out).toMatchObject({ tile: name, fresh: true, into: "desk" });
      const moved = d.desk.pane(name) as PtyPane;
      expect(moved).toBe(own);
      expect(moved.pid).toBe(pid);
      expect(moved.running).toBe(true);
      expect(moved.kind).toBe("pty");                            // an ordinary terminal tile now: it closes, moves, goes back in
      expect(d.app.drawer.open).toBe(false);                     // the person's: the drawer went away with it
      expect(d.app.drawer.tile).not.toBe(own);
      expect(d.app.drawer.tile!.running).toBe(false);            // the new one starts when the drawer comes up
      expect(d.app.drawer.tabs()[0]!.name).toBe("drawer.agent");
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.running === true, "a new own program");
      expect(d.app.drawer.tile!.pid).not.toBe(pid);
      expect(d.app.drawer.tile!.keptAs).not.toBe(moved.keptAs);   // each kept under a key of its own
      // The one that left goes back in as an ordinary tab, beside the new own one.
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.desk.dispatch.act({ action: "tile.drawer", args: {}, tile: name }, USER);
      expect(d.app.drawer.tabs().map(t => t.name)).toEqual(["drawer.agent", name]);
      expect((d.pane(name) as PtyPane).pid).toBe(pid);
    } finally { d.app.quit(); }
  });

  test("leaving a screen with a program running carries it into your drawer, said", async () => {
    const d = await door();
    try {
      const other = otherScreen();
      d.app.push(other); d.paint();
      await other.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "shell" }, tile: "notes" }, USER);
      const shell = () => other.pane("shell") as PtyPane | undefined;
      d.paint();
      await until(() => shell()?.running === true, "shell runs");
      const pid = shell()!.pid;
      d.app.pop();                                               // no refusal: last callers goes, its shell comes along
      expect(d.app.screens().at(-1)).toBe(d.desk);
      expect(d.inDrawer("shell")).toBe(true);
      expect((d.pane("shell") as PtyPane).pid).toBe(pid);
      expect((d.pane("shell") as PtyPane).running).toBe(true);
      expect(d.A.message).toContain("shell went into your drawer · alt+a shows it");
      expect(d.app.drawer.open).toBe(false);                     // nobody's keys or view moved
    } finally { d.app.quit(); }
  });

  test("^W P in your drawer: the policy panel opens over the drawer's tab and Esc closes it, the keys still in the drawer", async () => {
    const d = await door();
    try {
      await d.app.act({ action: "tile.drawer", args: {}, tile: "tree", as: AS });
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "tree" }, USER);
      expect(d.app.drawer.entered).toBe(true);
      d.key(ctrl("w")); d.key(char("P"));
      const shown = d.paint().join("\n");
      expect(shown).toContain("─ policy ─");
      expect(shown).toContain("draggable · its tiles move out");
      d.key({ kind: "esc" }); d.paint();
      expect(d.paint().join("\n")).not.toContain("─ policy ─");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.app.quit(); }
  });

  test("refused, with why: the screen's last tile stays; an agent never moves the tile the person types in", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      // The person in kettle: an agent's drawer of it is refused.
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.desk.dispatch.act({ action: "tile.enter", tile: "kettle" }, USER);
      await expect(d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS })).rejects.toThrow(/typing|has the person's keys/);
      expect(d.inDrawer("kettle")).toBe(false);
    } finally { d.app.quit(); }
  });

  test("never lost: a screen that goes for good hands a running tile it was given back to the drawer; ids never collide; a kept tile stays", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      expect(d.app.drawer.tabs().find(t => t.name === "kettle")!.id).toMatch(/^k\d+$/);     // a drawer id, never a screen's t<n>
      const other = otherScreen();
      d.app.push(other); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "notes" }, tile: "kettle" }, USER);
      expect(other.pane("kettle")).toBeDefined();
      d.app.pop();                                               // last callers is left: gone for good
      expect(d.inDrawer("kettle")).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      expect((d.pane("kettle") as PtyPane).running).toBe(true);
      // The river's Library (closable off: its save needs it) stays, said.
      const river: any = (await import("../src/desk/screen-specs")).openScreen("river");
      d.app.push(river); d.paint();
      await expect(d.app.act({ action: "tile.drawer", args: {}, tile: "library", as: AS })).rejects.toThrow(/library stays/);
    } finally { d.app.quit(); }
  });

  test("the drawer is the door's too: a reader in the drawer hears outline changes, its unsaved edit holds a quit, one name in both is refused", async () => {
    const d = await door();
    listen = e => d.app.event(e);
    try {
      const note = await board.request<any>("create", { parentId: null, text: "Rhubarb: force it under a bucket", author: "agent" });
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", note: note.id, name: "rhubarb" }, tile: "reader" }, USER);
      await until(() => (d.desk.pane("rhubarb") as any)?.msg?.id === note.id, "the detail shows it");
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "rhubarb", as: AS });
      // Changed by someone else while inDrawer: the reader in the drawer reads it again, as a shown one does.
      const b = await board.request<any>("get", { blockId: note.id });
      await board.request("update", { blockId: note.id, text: "Rhubarb: forced, pick in March", expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
      await until(() => /pick in March/.test((d.pane("rhubarb") as any)?.msg?.text ?? ""), "the reader in the drawer re-read");
      // The person's unsaved edit in it, inDrawer: quitting asks first, and a forced end copies the text to disk.
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "edit.text", args: { text: "Rhubarb: forced, pick in March\nunsaved: lift the bucket in April" }, tile: "rhubarb" }, USER);
      expect(drawer.unsaved?.()).toBe(true);
      expect(d.app.confirmQuit()).toBe(false);
      expect(d.A.message).toContain("an edit isn't saved");
      const kept = d.app.terminate();
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.map(p => readFileSync(p, "utf8")).join("\n")).toContain("lift the bucket in April");
    } finally { listen = null; d.app.quit(); }
  });

  test("a moved preview follows the tile it followed, by identity: never another screen's tile of the same name", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "preview", source: "tile:tree", name: "peek" }, tile: "reader" }, USER);
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pv = d.desk.pane("peek")!, follows = (desk: any) => desk.followers(desk.idNamed("tree")) as unknown[];
      expect(follows(d.desk)).toContain(pv);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "peek", as: AS });
      // Another desk with a tree of its own: the preview lands there, and that tree never drives it.
      const other = new Desk(undefined, { layout: "desk" });
      d.app.push(other); d.paint();
      expect((other as any).idNamed("tree")).toBeDefined();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "peek" }, USER);
      expect(other.pane("peek")).toBe(pv);
      expect(follows(other)).not.toContain(pv);
      // Back on the desk it came from, beside the tree it followed: it follows that one again.
      await other.dispatch.act({ action: "tile.drawer", args: {}, tile: "peek" }, USER);
      d.app.pop(); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "peek" }, USER);
      expect(d.desk.pane("peek")).toBe(pv);
      expect(follows(d.desk)).toContain(pv);
    } finally { d.app.quit(); }
  });

  test("a preview keeps following its tree into your drawer and back: by the tree's identity, never by its name", async () => {
    const d = await door();
    listen = e => d.app.event(e);
    try {
      const a = await board.request<any>("create", { parentId: null, text: "Leeks: earth them up", author: "agent" });
      const b = await board.request<any>("create", { parentId: null, text: "Garlic: plant the cloves", author: "agent" });
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "preview", source: "tile:tree", name: "peek" }, tile: "reader" }, USER);
      const pv = d.desk.pane("peek") as any, tree = d.desk.pane("tree") as any;
      const pick = (desk: Desk, id: string) => desk.dispatch.act({ action: "tree.pick", args: { id }, tile: "tree" }, USER);
      await until(() => tree.list().some((r: any) => JSON.stringify(r).includes(a.id)), "the tree lists the notes", 2000);
      await pick(d.desk, a.id);
      await until(() => pv.msg?.id === a.id, "the preview shows the tree's pick");
      // The tree goes into your drawer; the preview stays on the desk and still follows it.
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "tree", as: AS });
      expect(d.pane("tree")).toBe(tree);
      await pick(d.app.drawer.desk!, b.id);
      await until(() => pv.msg?.id === b.id, "the preview follows the tree in the drawer");
      // A new tree on the desk by the same name never drives it.
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "tree", name: "tree" }, tile: "kettle" }, USER);
      const twin = d.desk.pane("tree") as any;
      expect(twin).not.toBe(tree);
      await until(() => twin.list().some((r: any) => JSON.stringify(r).includes(a.id)), "the new tree lists the notes");
      await pick(d.desk, a.id);
      await Bun.sleep(50);
      expect(pv.msg?.id).toBe(b.id);
      await d.desk.dispatch.act({ action: "tile.close", tile: "tree" }, USER);
      // Back out of the drawer: it follows the same tree, here.
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "kettle" }, tile: "tree" }, USER);
      expect(d.desk.pane("tree")).toBe(tree);
      await pick(d.desk, a.id);
      await until(() => pv.msg?.id === a.id, "the preview follows it back on the desk");
    } finally { listen = null; d.app.quit(); }
  }, 20_000);

  test("one name on the screen and in the drawer: refused by name, reached by id", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      const kid = d.app.drawer.tabs().find(t => t.name === "kettle")!.id;
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
      await expect(d.app.act({ action: "tile.type", args: { text: "hello" }, tile: "kettle", as: AS })).rejects.toThrow(new RegExp(`names a tile here .* and one in the drawer \\(${kid}\\)`));
      expect(d.A.message).toContain(`an agent (${AS}) · tile.type refused: kettle names a tile here`);   // said on the status bar, as every refusal
      await until(() => (d.pane("kettle") as PtyPane).running, "the kettle in the drawer runs");
      await d.app.act({ action: "tile.type", args: { text: "by id\r" }, tile: kid, as: AS });
      await until(() => (d.pane("kettle") as PtyPane).text().some(l => l.includes("by id")), "typed into the one in the drawer");
    } finally { d.app.quit(); }
  });

  test("the drawer's agent: listed for an agent, chosen by act (saved for this session), the picker by alt+g", async () => {
    const d = await door();
    try {
      const listed = await d.app.act({ action: "host.agent", args: {}, as: AS }) as any;
      expect(listed.agents.map((a: any) => a.name)).toContain("shell");
      await expect(d.app.act({ action: "host.agent", args: { name: "no-such-agent" }, as: AS })).rejects.toThrow(/no agent no-such-agent here; installed: shell/);
      const r = await d.app.act({ action: "host.agent", args: { name: "shell" }, as: AS }) as any;
      expect(r).toMatchObject({ agent: "shell", herdr: false });
      expect(JSON.parse(readFileSync(join(outlineState(), "drawer-agent.json"), "utf8"))).toEqual({ agent: "shell" });
      // EP0CH_DAILY_AGENT (cat, here) still overrides it, and the door says so.
      expect((d.app.describe() as any).drawer.runs.why.program).toContain("EP0CH_DAILY_AGENT");
      // The person's alt+g: the picker, over the drawer.
      d.A.lastInput = 0;
      d.key({ kind: "alt", ch: "g" });
      expect(d.app.drawer.open).toBe(true);
      expect(d.paint().some(l => l.includes("the drawer's agent"))).toBe(true);
      d.key({ kind: "esc" });
    } finally { d.app.quit(); }
  });

  test("typing in the drawer's terminal: alt+g's picker takes the keys from it (no byte goes past), alt+s opens a shell tab", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.tile?.running, "the drawer's own cat runs");
      d.paint();
      await until(() => !!d.app.drawer.made?.rawKeys(), "the person types in it");
      const raw = () => d.app.drawer.rawInput(d.A.drawerRun);
      raw()!("\x1bg");
      await until(() => d.paint().some(l => l.includes("the drawer's agent")), "the picker");
      expect(d.app.drawer.made!.rawInput()).toBeNull();            // the picker has the keys, not cat
      expect(d.paint().some(l => l.includes("the picker has the keys"))).toBe(true);
      d.key({ kind: "esc" });
      expect(d.app.drawer.made!.rawInput()).not.toBeNull();        // back to cat
      const tabs = d.app.drawer.tabs().length;
      raw()!("\x1bs");
      await until(() => d.app.drawer.tabs().length === tabs + 1, "a new shell tab");
    } finally { d.app.quit(); }
  });

  test("a session handover: the person's edit in a reader in the drawer is checkpointed and comes back in the next daemon's drawer", async () => {
    const { Checkpoints, readCheckpoint, restore } = await import("../src/session/restore");
    const { MainMenu } = await import("../src/screens");
    const note = await board.request<any>("create", { parentId: null, text: "Leeks: earth them up", author: "agent" });
    const term = (): any => ({ info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} });
    const one = new App(term(), board, Date.now(), () => {});
    one.push(new MainMenu());
    const desk = new Desk(undefined, { layout: "desk" });
    one.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "detail", note: note.id, name: "leeks" }, tile: "reader" }, USER);
    await until(() => (desk.pane("leeks") as any)?.msg?.id === note.id, "the detail shows it");
    await desk.dispatch.act({ action: "tile.drawer", args: {}, tile: "leeks" }, USER);
    await one.drawer.desk!.dispatch.act({ action: "edit.text", args: { text: "Leeks: earth them up\nhalfway: the second row next" }, tile: "leeks" }, USER);
    // The handover's order (src/session/daemon.ts): the checkpoint with the edits, then the drafts put aside.
    new Checkpoints(one, () => ({ cols: 140, rows: 40 })).write(true);
    for (const x of one.holders()) x.keepDrafts?.();
    const c = readCheckpoint()!;
    expect(c.reopen.some(s => s.drawer && s.action === "edit" && s.tile === "leeks")).toBe(true);
    one.quit();
    const two = new App(term(), board, Date.now(), () => {});
    try {
      const r = await restore(two, c);
      expect(r.errors).toEqual([]);
      expect(r.reopened).toBe(1);
      const back = two.drawer.desk!.pane("leeks") as any;
      expect(back?.surface.draft).toBeTruthy();
      expect(back.unsaved()).toBe(true);
    } finally { two.quit(); }
  });

  test("saved: the next door's drawer has the tile back (drawer-tiles.json), the dock as it was", async () => {
    const d = await door();
    await d.app.act({ action: "tile.drawer", args: {}, tile: "thread", as: AS });
    d.app.quit();
    const file = join(outlineState(), "drawer-tiles.json");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("thread");
    const e = await door();
    try {
      e.paint();
      expect(e.inDrawer("thread")).toBe(true);
      expect(e.desk.pane("thread")).toBeDefined();               // the desk's own layout has a thread again (its spec): two tiles, one in the drawer
    } finally { e.app.quit(); }
  });
});
