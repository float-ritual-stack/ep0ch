// PIE-1659: pasted text never runs as commands. Bytes go through the door's real key decoder, as a terminal sends a
// bracketed paste (mode 2004), to a door on the desk: pasted where nothing types (a reader with no edit open, a board, the
// drawer), the text is offered in the power bar, never typed out as keys (its `dd` would trash the note or card in front,
// its `x` close a tile); pasted while an edit or a comment opens, it lands in it; a terminal tile takes it as its program
// asked. A scratch service and made-up notes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { MainMenu } from "../src/screens";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { PtyPane } from "../src/desk/pty";
import { traceActions } from "../src/surface/actions";
import { SocketBoard } from "../src/socket";
import { KeyDecoder } from "../src/term";
import * as BV from "./board-view";
import { outliner, Scratch, showIn, until } from "./scratch";

const USER = { kind: "user" } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A bracketed paste as a terminal sends it. */
const bracketed = (text: string) => `\x1b[200~${text}\x1b[201~`;
/** Pasted text holding the reader's and the board's command letters: dd trashes, x closes, a newline is ⏎. */
const TEXT = "dig the odd bean trench\nx marks the compost bay";
/** How the power bar's one line holds it: its line break a space. */
const LINE = TEXT.replace(/\n/g, " ");

describe.skipIf(!outliner)("pasted text never runs as commands (PIE-1659)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  let beans!: Msg, plot!: Msg;
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    beans = await board.createBlock(null, "Runner beans [type::job] [area::plot] [stage::todo]\nstake them in May\n- canes from the shed");
    await board.createBlock(null, "Turn the compost [type::job] [area::plot] [stage::todo]");
    plot = await board.createBlock(null, "Plot jobs");
    await board.createBlock(plot.id, "To do [type::virtual-branch] [query::type=job area=plot stage=todo]");
    await board.createBlock(plot.id, "Done [type::virtual-branch] [query::type=job area=plot stage=done]");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_EDIT_ARM"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-paste-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  async function door(screen?: Desk | MainMenu) {
    const info = { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info as any);
    const term: any = {
      info, decoder, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { decoder.keyHandler = f; }, onResize() {}, stop() {}, resume() {},
      get rawSink() { return decoder.rawSink; }, set rawSink(f) { decoder.rawSink = f; },
    };
    const app = new App(term, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    const desk = (screen ?? new Desk(undefined, { layout: "desk" })) as Desk;
    app.push(desk);
    const A = app as any;
    const paint = () => A.paint();
    paint();
    /** Bytes as the terminal sends them, in one read or several. */
    const feed = async (...reads: string[]) => { for (const r of reads) { decoder.feed(r); paint(); await sleep(30); } paint(); };
    /** Feed the reads and say every action they ran, as the person or anyone, until things settle. */
    const ran = async (...reads: string[]) => {
      const names: string[] = [];
      const stop = traceActions(r => names.push(r.name));
      try { await feed(...reads); await sleep(300); } finally { stop(); }
      return names;
    };
    const peek = () => app.describe() as any;
    const reader = (on: Desk = desk) => [...(on as any).panes.values()].find((p: any) => p instanceof ReaderPane && p.msg?.id === beans.id) as ReaderPane | undefined;
    const tiles = (on: Desk = desk) => (on.layoutGet().tiles as any[]).map(t => t.name).sort();
    /** The note as saved before the paste: same revision, not trashed. */
    const untouched = async (what: string, before: Msg) => {
      const after = (await board.get(before.id))!;
      expect({ what, revision: after.revision, trashed: !!(after as any).effectiveDeletedRootId }).toEqual({ what, revision: before.revision, trashed: false });
    };
    /** Only the power bar's own actions ran (it opened, offering the paste, and its screens source listed them). */
    const onlyBar = (names: string[]) => expect(names.filter(n => !n.startsWith("bar.") && n !== "screen.list")).toEqual([]);
    const onBeans = async () => {
      showIn(desk, beans);
      await until(() => !!reader(), "the beans in a reader");
      desk.focusPane(reader()!, USER);
    };
    return { app, desk, A, feed, ran, peek, reader, tiles, untouched, onlyBar, onBeans, quit: () => { app.quit(); for (const p of (desk as any).panes?.values() ?? []) if (p instanceof PtyPane) p.kill(); app.drawer.tile?.kill(); } };
  }

  test("pasted in a reader with no edit open: no letter runs, and the text is offered in the power bar", async () => {
    const d = await door();
    try {
      await d.onBeans();
      const before = (await board.get(beans.id))!, tiles = d.tiles();
      d.onlyBar(await d.ran(bracketed(TEXT)));
      await d.untouched("a paste in a reader", before);
      expect(d.tiles()).toEqual(tiles);
      await until(() => d.peek().bar?.query === LINE, "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 20_000);

  test("a paste cut by the reads (inside its markers, with a pause) is still one paste, offered whole", async () => {
    const d = await door();
    try {
      await d.onBeans();
      const before = (await board.get(beans.id))!;
      const all = bracketed(TEXT);
      // Cut inside the start marker with a pause longer than a lone Esc waits, then inside the text and the end marker.
      const names: string[] = [];
      const stop = traceActions(r => names.push(r.name));
      try {
        await d.feed(all.slice(0, 4));
        await sleep(120);
        names.push(...await d.ran(all.slice(4, 30), all.slice(30, -3), all.slice(-3)));
      } finally { stop(); }
      d.onlyBar(names);
      await d.untouched("a split paste", before);
      await until(() => d.peek().bar?.query === LINE, "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 20_000);

  test("pasted in the gap while an edit opens: it lands in that edit, as it came", async () => {
    const d = await door();
    try {
      await d.onBeans();
      // e (arming off, as the tests run) and the paste in the same read: the edit is still opening when the paste comes.
      await d.feed(`e${bracketed(TEXT)}`);
      await until(() => !!d.reader()?.surface.draft, "the edit opened", 5000);
      await until(() => d.reader()!.surface.draft!.text.includes(TEXT), "the paste in the edit", 3000);
      expect(d.peek().bar).toBeUndefined();
      await d.feed("\x1b");
    } finally { d.quit(); }
  }, 20_000);

  test("pasted in the gap while a comment opens: no letter runs, and it lands in the comment", async () => {
    const d = await door();
    try {
      await d.onBeans();
      const before = (await board.get(beans.id))!;
      const names = await d.ran(`C${bracketed(TEXT)}`);
      expect(names.filter(n => /trash|close|collapse/.test(n))).toEqual([]);
      await d.untouched("a paste while a comment opens", before);
      const comment = () => (d.reader()?.surface.session?.writing?.draft.text ?? "") as string;
      await until(() => comment().includes(TEXT), "the paste in the comment", 5000);
      expect(d.peek().bar).toBeUndefined();
    } finally { d.quit(); }
  }, 20_000);

  test("pasted while an armed edit waits for ⏎: the arm lets go, no letter runs, and the text is offered", async () => {
    process.env.EP0CH_EDIT_ARM = "2000";
    const d = await door();
    try {
      await d.onBeans();
      const before = (await board.get(beans.id))!;
      await d.feed("e");
      expect(!!d.A.armed()).toBe(true);
      d.onlyBar(await d.ran(bracketed(TEXT)));
      await d.untouched("a paste while armed", before);
      expect(!!d.A.armed()).toBe(false);
      await until(() => d.peek().bar?.query === LINE, "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 20_000);

  test("pasted on a board's lanes: no card trashed or moved, and the text is offered", async () => {
    const b = BV.boardScreen(plot.id, false);
    const d = await door(b);
    try {
      await until(() => BV.view(b).lanes.length === 2 && BV.view(b).lanes.every((l: any) => l.items), "the lanes", 10_000);
      BV.at(b, "lanes");
      await until(() => !!BV.view(b).card(), "a card selected", 5000);
      const before = (await board.get(BV.view(b).selectedCardId()))!, tiles = d.tiles();
      d.onlyBar(await d.ran(bracketed(TEXT)));
      await d.untouched("a paste on a board", before);
      expect(d.tiles()).toEqual(tiles);
      await until(() => d.peek().bar?.query === LINE, "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 30_000);

  test("pasted in the drawer on a reader there: no letter runs, and the text is offered", async () => {
    const d = await door();
    try {
      await d.app.dispatch.press("host.toggle", { open: true });
      await until(() => d.app.drawer.tile?.running === true && d.app.drawer.entered, "in the drawer");
      const dd = d.app.drawer.desk!;
      await dd.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "pantry" } }, USER);
      showIn(dd, beans, "pantry");
      dd.focusPane(dd.pane("pantry")!, USER);
      await until(() => d.reader(dd)?.msg?.id === beans.id, "the beans in the drawer's reader");
      const before = (await board.get(beans.id))!, tiles = d.tiles(dd);
      d.onlyBar(await d.ran(bracketed(TEXT)));
      await d.untouched("a paste in the drawer", before);
      expect(d.tiles(dd)).toEqual(tiles);
      await until(() => d.peek().bar?.query === LINE, "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 20_000);

  test("pasted after ^W: the chord runs nothing and no tile closes", async () => {
    const d = await door();
    try {
      await d.onBeans();
      const before = (await board.get(beans.id))!, tiles = d.tiles();
      const names = await d.ran("\x17", bracketed(TEXT));
      d.onlyBar(names);
      await d.untouched("a paste after ^W", before);
      expect(d.tiles()).toEqual(tiles);
    } finally { d.quit(); }
  }, 20_000);

  test("pasted after ^W in an edit: the chord lets go, the edit stays open and the paste is its text", async () => {
    const d = await door();
    try {
      await d.onBeans();
      await d.feed("e");
      await until(() => !!d.reader()?.surface.draft, "the edit opened", 5000);
      d.onlyBar(await d.ran("\x17", bracketed(TEXT)));
      expect(d.reader()!.surface.draft!.text).toContain(TEXT);
      expect(!!d.reader()!.surface.editing).toBe(true);
      await d.feed("\x1b");
    } finally { d.quit(); }
  }, 20_000);

  test("pasted on the main menu: no item opens, and the text is offered", async () => {
    const d = await door(new MainMenu() as any);
    try {
      const top = d.A.stack.at(-1);
      // G logs off, and every letter is an item's.
      d.onlyBar(await d.ran(bracketed("Go fetch the hose\nnow")));
      expect(d.A.stack.at(-1)).toBe(top);
      await until(() => d.peek().bar?.query === "Go fetch the hose now", "the power bar offers the paste", 3000);
    } finally { d.quit(); }
  }, 20_000);

  test("a terminal tile takes the paste as its program expects: plain unless it asked for bracketed paste, a marker cut by the reads included", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat -v", name: "kettle" }, tile: "reader" }, USER);
      const kettle = () => d.desk.pane("kettle") as PtyPane;
      await until(() => kettle()?.running === true, "kettle runs");
      await d.desk.dispatch.press("tile.enter", {}, "kettle");
      const all = bracketed("descale\n");
      await d.feed(all.slice(0, 4), all.slice(4, -2), all.slice(-2));
      // Read joined: the tile is narrow, so a line wraps.
      await until(() => kettle().text().join("").includes("descale"), "the paste reached the program", 3000);
      expect(kettle().text().join("")).not.toContain("[20");
      expect(d.peek().bar).toBeUndefined();
      // A program that asked for bracketed paste (mode 2004) gets the markers, so it reads one paste.
      await d.feed("\x1d");
      const asks = join(state, "asks-bracketed.sh");
      writeFileSync(asks, "printf '\\033[?2004h'\nexec cat -v\n");
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: `sh ${asks}`, name: "kiln" }, tile: "kettle" }, USER);
      const kiln = () => d.desk.pane("kiln") as PtyPane;
      await until(() => kiln()?.running === true, "kiln runs");
      await d.desk.dispatch.press("tile.enter", {}, "kiln");
      await sleep(200);
      await d.feed(bracketed("fire at dusk"));
      await until(() => kiln().text().join("").includes("^[[200~fire at dusk^[[201~"), "the markers reached the program", 3000);
    } finally { d.quit(); }
  }, 20_000);
});
