// PIE-1593: when the door asks the host again is decided once. A scratch host and a real door: an agent writes, and
// welcome, the brief, a river column and a reader's comments show it with the door's clock in the test's hands. The
// watched ones show with that clock never moved (the host says their answer moved); the others pause on it, never on a timer of their own.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { BriefReader } from "../src/brief/brief";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import type { WelcomeList } from "../src/hub/welcome";
import type { RiverColumn } from "../src/river/column";
import { MainMenu } from "../src/screens";
import { FakeSearchClock, useSearchClock } from "../src/search-schedule";
import { SocketBoard, type Actor } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";
import { view } from "./river-view";

/** Past the host's own settle (WATCH_LIMITS, 250 ms) and the 300 ms these tiles used to wait: a read a change alone caused would be out by now. */
const HOST_SETTLED = 600;
const AGENT: Actor = { kind: "agent", id: "ask-again-agent" };

describe.skipIf(!outliner)("a write shows in every tile that reads it, against a scratch host", () => {
  const scratch = new Scratch();
  let board: SocketBoard, writer: SocketBoard, app: App, clock: FakeSearchClock, put: () => void;
  /** What this door asked with a plain `board.query`: the host says when, never a change it hasn't said moved the answer. */
  const plain: string[] = [];
  const write = (parent: string | null, text: string) => writer.request("create", { parentId: parent, text, author: "agent" });
  const open = (name: string) => { const d = openScreen(name) as Desk; app.push(d); return d; };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    writer = new SocketBoard(board.path);
    await board.info();
    const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    const query = board.query.bind(board);
    board.query = (q: string, ...rest: any[]) => { plain.push(q); return (query as any)(q, ...rest); };
  }, 30_000);
  afterAll(async () => { app?.quit(); board?.close(); writer?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });
  beforeEach(() => { clock = new FakeSearchClock(); put = useSearchClock(clock); });
  afterEach(() => put());

  test("welcome: a note tagged anywhere is listed, told by the host", async () => {
    await write(null, "Start here [welcome::true]\nThe first welcome note.");
    const desk = open("welcome"), list = desk.pane("welcome") as unknown as WelcomeList;
    await until(() => list.items?.length === 1, "the first welcome note");
    plain.length = 0;
    await write(null, "Nothing to do with it\nAnother note.");
    await Bun.sleep(HOST_SETTLED);
    expect(plain).toEqual([]);
    await write(null, "House rules [welcome::true]\nThe second.");
    await until(() => list.items?.length === 2, "the note an agent tagged");
    app.pop();
  });

  test("the brief: a brief written anywhere is counted, told by the host", async () => {
    await write(null, "Brief one [type::daily-brief] [brief-date::2026-01-05]\nYesterday.");
    const desk = open("brief"), brief = desk.pane("brief") as BriefReader;
    await until(() => brief.briefs?.length === 1, "the first brief");
    plain.length = 0;
    await write(null, "Nothing to do with it\nAnother note.");
    await Bun.sleep(HOST_SETTLED);
    expect(plain).toEqual([]);
    await write(null, "Brief two [type::daily-brief] [brief-date::2026-01-06]\nToday.");
    await until(() => brief.briefs?.length === 2, "the brief an agent wrote");
    app.pop();
  });

  test("a river column: a new note at the top level and a new child of its note, after the door's one pause", async () => {
    const river = open("river"), library = () => view(river).column(1) as RiverColumn;
    await until(() => !!library().items?.length, "the Library");
    const before = library().items!.length;
    const made = await write(null, "A new root\nWritten by an agent.");
    await until(() => clock.pending > 0, "the library's pause, on the door's clock");
    clock.runOut();
    await until(() => library().items!.length === before + 1, "the new root in the Library");
    await app.act({ action: "open", args: { id: made.id }, as: "ask-again-agent" });
    const column = () => view(river).column(2) as RiverColumn;
    await until(() => !!column()?.items, "the note's column");
    await write(made.id, "A child\nUnder it.");
    await until(() => clock.pending > 0, "the column's pause, on the door's clock");
    clock.runOut();
    await until(() => column().items?.length === 1, "the new child in the column");
    app.pop();
  });

  test("a #tag column: a note tagged elsewhere is listed, told by the host", async () => {
    await write(null, "Prune the plum [garden::yes]\nIn February.");
    const river = open("river");
    await app.act({ action: "column.tag", args: { key: "garden", value: "yes" }, as: "ask-again-agent", tile: view(river).name(view(river).column(1)) });
    const column = () => view(river).tiles.find(c => c.source.kind === "tag");
    await until(() => column()?.items?.length === 1, "the column's first note");
    await write(null, "Net the currants [garden::yes]\nBefore the birds.");
    await until(() => column()?.items?.length === 2, "the note tagged elsewhere");
    app.pop();
  });

  test("a reader's comments: a comment and a reply written elsewhere, after the door's one pause", async () => {
    const note = await write(null, "A commented note\nRead in the river.");
    const river = open("river");
    await app.act({ action: "open", args: { id: note.id }, as: "ask-again-agent" });
    const surface = () => (view(river).column(2) as RiverColumn)?.surface;
    await until(() => surface()?.comments !== undefined && surface()?.msg?.id === note.id, "the note's comments read");
    clock.runOut();
    const receipt = await writer.comment("ask-again-1", note.id, note.revision, "Where does this go?", null, AGENT);
    await until(() => clock.pending > 0, "the comments' pause, on the door's clock");
    clock.runOut();
    await until(() => surface()?.comments?.length === 1, "the comment");
    await writer.reply("ask-again-2", receipt.id, "In the shed.", AGENT);
    await until(() => clock.pending > 0, "the reply's pause, on the door's clock");
    clock.runOut();
    await until(() => surface()?.comments?.[0]?.replies.length === 1, "the reply");
    app.pop();
  });
});
