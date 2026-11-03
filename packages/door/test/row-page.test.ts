// PIE-1534: PgDn and PgUp page every row container the `[ ]` position is on, not only a collection. A note holds a
// ::links list, a ::backlinks list, a live table or an embedded saved view, each longer than its window; j lands on its
// first row, PgDn moves the pick one window of rows (the rows shown, less one) and keeps it, PgDn again, PgUp back one.
// With no row picked, PgDn still scrolls the note. Fictional notes, against a throwaway outliner service only, real keys.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const pad = (i: number) => String(i).padStart(2, "0");

describe.skipIf(!outliner)("PgDn pages the row container the pick is in (PIE-1534)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk;
  let key: (k: Key) => void = () => {};
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const frame = () => b.render(BV.view(b).ctx).lines;
  const text = () => plain(frame().join("\n"));
  const n: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.shed = await create(null, "Tool shed [type::walk-place]");
    for (let i = 1; i <= 30; i++) await create(null, `Letter ${pad(i)} [type::walk-letter]`);
    for (let i = 1; i <= 30; i++) await create(null, `Crate ${pad(i)} [type::walk-crate]`);
    for (let i = 1; i <= 30; i++) await create(null, `Visit ${pad(i)} to ((${n.shed.id}))`);
    for (let i = 1; i <= 30; i++) await create(null, `Parcel ${pad(i)} [type::walk-parcel]`);
    n.parcels = await create(null, "Parcels [type::virtual-branch] [query::type=walk-parcel] [sort::title] [direction::asc]");
    const body = (lists: string[]) => ["Before the rows.", "", ...lists, "", "After the rows.", ...Array.from({ length: 80 }, (_, i) => `Filler line ${i + 1}.`)];
    n.links = await create(null, ["Letters page", ...body(['::links{query="type=walk-letter" title="Letters"}', "::"])].join("\n"));
    n.table = await create(null, ["Crates page", ...body(["::graph-table", "---", "title: Crates", 'query: "type=walk-crate"', "sort: title", "---", "::"])].join("\n"));
    n.embed = await create(null, ["Parcels page", ...body([`!((${n.parcels.id}))`])].join("\n"));
    n.back = await create(null, ["Shed visits", ...body([`::backlinks{of=((${n.shed.id}))}`, "::"])].join("\n"));
    const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 60_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  const open = async (note: any, first: string) => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = openScreen("detail", { note: note.id, persist: false }) as Desk;
    app.push(b);
    const d = b.pane("detail") as ReaderPane;
    await until(() => !!d.msg && !d.msg.partial && d.msg.id === note.id, "the note");
    await until(() => new RegExp(`${first} \\d\\d`).test(text()), `${first} rows drawn`, 10_000);
    return d;
  };

  for (const [name, word] of [["links", "Letter"], ["table", "Crate"], ["back", "Visit"], ["embed", "Parcel"]] as const) test(`j then PgDn PgDn PgUp in a ${name} list moves the pick a window of rows and keeps it`, async () => {
    const d = await open(n[name], word);
    // Where the pick is: the row of its container the [ ] position is on (from 0), and that row's label.
    const at = () => d.surface.selectedElement()?.link?.inlineList?.row;
    const label = () => d.surface.selectedElement()?.label ?? "";
    const press = (k: Key) => { key(k); frame(); return at(); };
    // j walks from the note's first line into the container's first row.
    for (let i = 0; i < 4 && at() === undefined; i++) press(char("j"));
    expect(at()).toBe(0);
    // The rows the container shows at once (a preview naming the picked one counts once): a page is fewer, and more than one.
    const window = new Set(text().match(new RegExp(`${word} \\d\\d`, "g"))).size;
    expect(window).toBeLessThan(30);
    const page = press({ kind: "pgdn" });
    expect(page, `PgDn kept the pick (hint: ${d.surface.hint()})`).toBeDefined();
    expect(page!).toBeGreaterThan(1);
    expect(page!).toBeLessThan(window);
    expect(press({ kind: "pgdn" })).toBe(2 * page!);
    expect(text()).toContain(label().match(new RegExp(`${word} \\d\\d`))![0]);
    expect(press({ kind: "pgup" })).toBe(page);
    expect(d.surface.hint()).not.toContain("blocks/rows");
  }, 30_000);

  test("with no row picked, PgDn scrolls the note a page", async () => {
    const d = await open(n.links, "Letter");
    expect(d.surface.selectedElement()).toBeUndefined();
    key({ kind: "pgdn" }); frame();
    expect(text()).not.toContain("Before the rows.");
    expect(d.surface.selectedElement()).toBeUndefined();
  }, 30_000);
});
