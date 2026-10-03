// PIE-415: a click on a link opens it, in every reader: `((…))`, `[[page]]`, a Work ID, a property value
// in the summary line or the property panel, an embed's title, and a row of the backlinks list. It opens
// where ⏎ on the same link would (the board: in place, or a detail from a drawer; the desk: its reader;
// the river: a column beside). Clicks are found by the cells the link was drawn in, so scrolling and
// wrapping move them with the text. Against a throwaway outliner service (never a real outline).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { renderDoc, type DocEnv } from "../src/doc";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "./board-view";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { extractLinks, LINK_END, linkTag, pad, width } from "../src/style";
import type { Key } from "../src/term";
import { SCROLL_ROWS } from "../src/scroll";
import { wrap } from "../src/text";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
type Rect = { col: number; row: number; cols: number; rows: number };

describe("link tags", () => {
  const tagged = (n: number, s: string) => linkTag(n) + s + LINK_END;

  test("take no room, and say which columns each link was drawn in", () => {
    const line = `see ${tagged(0, "Garden plan")} and ${tagged(1, "the beans")}.`;
    expect(width(line)).toBe("see Garden plan and the beans.".length);
    const { lines, ranges } = extractLinks([line]);
    expect(lines).toEqual(["see Garden plan and the beans."]);
    expect(ranges).toEqual([{ line: 0, from: 4, to: 15, n: 0 }, { line: 0, from: 20, to: 29, n: 1 }]);
  });

  test("a link that wraps is one target on both lines; colour codes don't count as columns", () => {
    const out = wrap(`first ${tagged(3, "Stake the beans")} then`, 12);
    expect(out.map(l => l.replace(/[\u{100000}-\u{10FFFD}]/gu, ""))).toEqual(["first Stake", "the beans", "then"]);
    const { ranges } = extractLinks(out.map(l => `\x1b[38;2;1;2;3m${l}\x1b[0m`));
    expect(ranges).toEqual([{ line: 0, from: 6, to: 11, n: 3 }, { line: 1, from: 0, to: 9, n: 3 }]);
  });

  test("a cut line keeps the tags past the cut, so the next line isn't taken for the link", () => {
    const cut = pad(`${tagged(0, "a very long title indeed")} tail`, 8);
    expect(plain(cut).replace(/[\u{100000}-\u{10FFFD}]/gu, "")).toBe("a very …");
    const { ranges } = extractLinks([cut, "next line"]);
    expect(ranges).toEqual([{ line: 0, from: 0, to: 8, n: 0 }]);                // the … stands for the rest of it
  });
});

describe("link ranges: each rendered row stands alone (review of PIE-415)", () => {
  const tagged = (n: number, s: string) => linkTag(n) + s + LINK_END;
  const env = (w: number, unfold = true): DocEnv => ({ width: w, cellW: 9, cellH: 18, graphics: false, maxImageRows: 10, unfold });
  /** What each link's ranges cover, as drawn, piece by piece. */
  const pieces = (d: { lines: string[]; links: { line: number; from: number; to: number; n: number }[] }) => {
    const out: Record<number, string[]> = {};
    for (const r of d.links) (out[r.n] ??= []).push([...plain(d.lines[r.line]!)].slice(r.from, r.to).join(""));
    return out;
  };

  test("a link wrapped in a table cell covers only its own cell's text, and a second link on the row doesn't cut it off", () => {
    const d = renderDoc(`| Job | Notes |\n| --- | --- |\n| ${tagged(0, "Stake the beans along the fence")} | ${tagged(1, "Garden plan")} |\n\nafter`, env(30));
    // Cells are measured as drawn (link tags take no room), so the column fits "Stake the beans" (PIE-444).
    expect(pieces(d)).toEqual({ 0: ["Stake the beans", "along the fence"], 1: ["Garden", "plan"] });
  });

  test("a wrapped list item or callout body leaves out the indent and the frame", () => {
    const d = renderDoc(`- ${tagged(0, "a long link text that wraps")}\n\n> [!note] Title\n> ${tagged(1, "another long link that wraps too")}`, env(16));
    expect(pieces(d)).toEqual({ 0: ["a long link", "text that", "wraps"], 1: ["another long", "link that", "wraps too"] });
  });

  test("a callout title cut through a link: never splits a tag, closes it on the top edge, re-opens it in the spill", () => {
    // Cut by code units, this title's cut fell between the two halves of the link's open tag.
    const split = renderDoc(`> [!note] Read abcd${tagged(0, "Garden plan")} tail\n> body`, env(20));
    for (const l of split.lines) expect(l.isWellFormed()).toBe(true);
    expect(pieces(split)).toEqual({ 0: ["G", "arden plan"] });
    const title = `Read ${tagged(0, "Garden plan and more words here")} tail end`;
    expect(pieces(renderDoc(`> [!note] ${title}\n> hidden`, env(20)))).toEqual({ 0: ["Garde", "n plan and more", "words here"] });
    // Folded, the spill isn't drawn: the link ends on the top edge and the rest of the note isn't it.
    const folded = renderDoc(`> [!note]- ${title}\n> hidden\n\nnext ${tagged(1, "x")}`, env(20, false));
    expect(folded.links.filter(r => r.n === 0)).toEqual([{ line: 0, from: 10, to: 15, n: 0 }]);
    expect(pieces(folded)).toEqual({ 0: ["Garde"], 1: ["x"] });
  });
});

describe.skipIf(!outliner)("clicking links and backlinks opens them, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk, hub: any, workId = "";
  const n: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const B = () => BV.view(b);
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  const whole = (p: ReaderPane, id?: string) => until(() => !!p.msg && !p.msg.partial && (!id || p.msg.id === id), `the whole note${id ? ` ${id.slice(0, 8)}` : ""}`);
  const click = (at: { x: number; y: number }) => {
    key({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
    key({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y });
  };
  /** Where `text` is drawn inside `r` (its `nth` occurrence, top to bottom), as a person would find it. */
  const where = (lines: string[], text: string, r: Rect, nth = 0) => {
    let seen = 0;
    for (let y = r.row; y < r.row + r.rows; y++) {
      const l = plain(lines[y] ?? "");
      for (let x = l.indexOf(text); x >= 0; x = l.indexOf(text, x + 1)) {
        if (x >= r.col && x + text.length <= r.col + r.cols && seen++ === nth) return { x: x + 1, y };
      }
    }
    throw new Error(`"${text}" isn't drawn in ${JSON.stringify(r)}:\n${lines.slice(r.row, r.row + r.rows).map(plain).map(l => l.slice(r.col, r.col + r.cols)).join("\n")}`);
  };
  const frame = () => b.render(B().ctx).lines;
  const rect = (region: string): Rect => { b.render(B().ctx); return BV.rectOf(b, region); };
  const shows = (region: string, text: string) => until(() => { try { where(frame(), text, rect(region)); return true; } catch { return false; } }, `"${text}" in ${region}`);
  /** A new board on the hub, the preview on the one Queued card (the note full of links). */
  const fresh = async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = boardScreen(hub.id);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1, "the lane", 10_000);
    await whole(B().preview, n.jobs.id);
    await shows("preview", "» Paint the shed");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.OUTLINER_PROPERTY_SUMMARY_KEYS = "stage,related";
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "HOME" });
    n.plan = (await board.request<any>("pages.follow", { address: "Garden plan", author: "agent" })).block;
    n.hinge = await create(null, "Oil the hinges\nThe back door squeaks.");
    workId = (await board.request<any>("work-ids.allocate", { blockId: n.hinge.id, expectedRevision: n.hinge.revision })).workId;
    n.beans = await create(null, "Stake the beans\nCanes along the fence.");
    n.shed = await create(null, "Paint the shed\nTwo coats, green.");
    n.jobs = await create(null, `Weekend jobs [stage::queued] [related::${workId}]\nFirst ((${n.beans.id})), then [[Garden plan]] and [[${workId}]]; [[Nowhere yet]] later.\n\n!((${n.shed.id}))`);
    n.sunday = await create(null, `Sunday list\nStart with ((${n.jobs.id})).`);
    n.long = await create(null, `Year plan\n${Array.from({ length: 30 }, (_, i) => `Week ${i + 1}: weed the beds.`).join("\n")}\nThen read [[Garden plan]] again.\n${Array.from({ length: 60 }, (_, i) => `Week ${i + 31}: water.`).join("\n")}`);
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
    delete process.env.OUTLINER_PROPERTY_SUMMARY_KEYS;
  }, 20_000);

  // PIE-441: a link in the preview opens in a detail, as ⏎ on a card does (it used to replace the preview).
  test("the board's preview: each link kind opens its target where ⏎ on it would (in a detail); the preview stays", async () => {
    const kinds: [string, string, number][] = [
      ["((block))", "Stake the beans", 0],
      ["[[page]]", "Garden plan", 0],
      ["[[Work ID]]", workId, 1],                                            // the first is the summary's
      ["summary value (Work ID)", workId, 0],
      ["embed title", "» Paint the shed", 0],
    ];
    const targets = [n.beans, n.plan, n.hinge, n.hinge, n.shed];
    for (const [i, [kind, text, nth]] of kinds.entries()) {
      await fresh();
      click(where(frame(), text, rect("preview"), nth));
      await until(() => B().details[0]?.msg?.id === targets[i].id, `${kind} to open`).catch(e => { throw new Error(`${kind}: ${e.message}`); });
      expect(B().preview.msg.id).toBe(n.jobs.id);
      expect(BV.where(b)).toBe("detail0");
    }
  }, 20_000);

  test("a missing target says so, and the clicked link is the selected [ ] link (⏎ and link.follow agree)", async () => {
    await fresh();
    click(where(frame(), "Nowhere yet · Missing target", rect("preview")));
    await until(() => /Missing target/.test(message() ?? ""), "the flash");
    expect(message()).toBe("[[Nowhere yet]] · Missing target");
    expect(B().preview.msg.id).toBe(n.jobs.id);
    const links = B().preview.surface.describe().links;
    expect(links.find((l: any) => l.selected)).toMatchObject({ page: "Nowhere yet" });
  }, 20_000);

  test("a detail and a float open a clicked link in place, scrolled or not", async () => {
    await fresh();
    key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d, n.jobs.id);
    await shows("detail0", "Garden plan");
    click(where(frame(), "Garden plan", rect("detail0")));
    await until(() => d.msg?.id === n.plan.id, "the page in the detail");
    // A float: its reader keeps its own note.
    await fresh();
    key({ kind: "enter" });
    await whole(B().details[0], n.jobs.id);
    key(char("o"));
    const f = B().floats[0], fp = f;
    await whole(fp, n.jobs.id);
    const fr = () => B().describe().floats[0].rect;
    await until(() => { try { where(frame(), "Stake the beans", fr()); return true; } catch { return false; } }, "the float drawn");
    click(where(frame(), "Stake the beans", fr()));
    await until(() => fp.msg?.id === n.beans.id, "the block in the float");
  }, 20_000);

  test("the property panel: a click picks a row, a click on a linked value follows it", async () => {
    await fresh();
    key(char("i"));
    const s = B().preview.surface;
    expect(s.panel).not.toBeNull();
    await shows("preview", "Oil the hinges");
    click(where(frame(), "stage", rect("preview"), 1));                    // the panel's row (the summary's is first)
    expect(s.panel.sel).toBe(s.rows(s.msg).findIndex((r: any) => r.key === "stage"));
    expect(B().preview.msg.id).toBe(n.jobs.id);
    click(where(frame(), "Oil the hinges", rect("preview")));
    await until(() => B().details[0]?.msg?.id === n.hinge.id, "the Work ID value to open (in a detail, PIE-441)");
    expect(s.panel).toBeNull();
  }, 20_000);

  test("a backlinks row opens its source in a detail, the preview follows it, and a link in that preview opens in a detail too", async () => {
    await fresh();
    key(char("b"));
    await until(() => !!B().linksTile.data?.sources.length, "the backlinks");
    // Grouped as Detail groups them (PIE-442): a note isn't an open item, so its group opens first.
    click(where(frame(), "+ Note 1", rect("backlinks")));
    // A click selects it (the preview shows it); a double click opens it, as ⏎.
    click(where(frame(), "Sunday list", rect("backlinks")));
    await whole(B().linksPreview, n.sunday.id);
    expect(B().details.length).toBe(0);
    click(where(frame(), "Sunday list", rect("backlinks")));
    await until(() => B().details[0]?.msg?.id === n.sunday.id, "the source in a detail");
    expect(BV.where(b)).toBe("detail0");
    await whole(B().linksPreview, n.sunday.id);
    // The backlink preview: its link opens in a detail, and the list's preview stays on its source.
    BV.at(b, "backlinks");
    const pr = rect("links-preview");
    await until(() => { try { where(frame(), "Weekend jobs", pr, 1); return true; } catch { return false; } }, "the preview drawn");
    click(where(frame(), "Weekend jobs", pr, 1));                          // the first is the quoted snippet in its title, not a link
    await until(() => B().details.some((x: ReaderPane) => x.msg?.id === n.jobs.id), "the link in a detail");
    expect(B().linksPreview.msg.id).toBe(n.sunday.id);
  }, 20_000);

  test("only the links rows drawn are clickable: not the frame, the status line, nor the spare rows under the last source", async () => {
    await fresh();
    key(char("b"));
    await until(() => !!B().linksTile.data?.sources.length, "the backlinks");
    await Bun.sleep(700);                                                     // a re-read the last changes queued has landed (it would replace the rows below)
    const L = B().linksTile, one = L.data.sources[0];
    // More sources than fit, one line each (PIE-442), under the status line; without facets, so one flat list.
    L.data = { ...L.data, sources: Array.from({ length: 40 }, (_, i) => ({ ...one, blockId: one.blockId, facets: undefined, title: `Source ${String(i).padStart(2, "0")}`, updatedAt: `2026-01-01T00:00:${String(59 - i).padStart(2, "0")}.000Z` })) };
    L.sel = 0; L.top = 0;
    const r = rect("backlinks"), head = L.head, fit = r.rows - 2 - head;
    expect(fit).toBeGreaterThan(3);
    click({ x: r.col + 3, y: r.row + r.rows - 1 });                            // the bottom border
    // The status line's first part isn't a control (on the header when it fits there: the header's title isn't either).
    if (head) click({ x: r.col + 3, y: r.row + 1 });
    await Bun.sleep(50);
    expect(L.sel).toBe(0);
    expect(B().details.length).toBe(0);
    click({ x: r.col + 3, y: r.row + head + fit });                            // the last source drawn: a double click opens it
    click({ x: r.col + 3, y: r.row + head + fit });
    expect(L.sel).toBe(fit - 1);
    await until(() => B().details[0]?.msg?.id === one.blockId, "the source in a detail");
    // A short list leaves spare rows under it: a click there does nothing.
    L.data = { ...L.data, sources: L.data.sources.slice(0, 2) };
    BV.at(b, "backlinks"); L.sel = 0; L.top = 0;
    const before = B().details.length;
    const under = r.row + head + L.rows().length + 1;                           // under the last row drawn
    click({ x: r.col + 3, y: under });
    click({ x: r.col + 3, y: under });
    await Bun.sleep(50);
    expect(L.sel).toBe(0);
    expect(B().details.length).toBe(before);
  }, 20_000);

  test("a summary-line value follows as the panel's o does: no fuzzy search, and the panel closes", async () => {
    await fresh();
    key(char("i"));
    const s = B().preview.surface, bd = B().ctx.board;
    await shows("preview", "Oil the hinges");
    // The registry can't answer: `o` says so rather than searching (a search would find the hinges).
    const resolvePage = bd.resolvePage;
    bd.resolvePage = () => Promise.reject(new Error("the registry is offline"));
    try {
      click(where(frame(), workId, rect("preview")));                       // the summary line's value
      await until(() => /couldn't resolve/.test(message() ?? ""), "the flash");
      expect(message()).toBe(`couldn't resolve ${workId}: the registry is offline`);
      await Bun.sleep(100);
      expect(B().preview.msg.id).toBe(n.jobs.id);
    } finally { bd.resolvePage = resolvePage; }
    click(where(frame(), workId, rect("preview")));
    await until(() => B().details[0]?.msg?.id === n.hinge.id, "the Work ID to open (in a detail, PIE-441)");
    expect(s.panel).toBeNull();
  }, 20_000);

  test("the desk's reader opens a clicked link in its reader", async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    const desk = new Desk();
    app.push(desk);
    try {
      await app.act({ action: "open", args: { id: n.jobs.id }, as: "test-agent-415" });
      const reader = () => [...(desk as any).panes.entries()].find(([, p]: any) => p.kind === "reader") as [number, ReaderPane];
      await whole(reader()[1], n.jobs.id);
      const r = () => (desk as any).placed.rects.get(reader()[0]) as Rect;
      await until(() => { try { where(desk.render((desk as any).ctx).lines, "Stake the beans", r()); return true; } catch { return false; } }, "the desk reader drawn");
      click(where(desk.render((desk as any).ctx).lines, "Stake the beans", r()));
      await until(() => reader()[1].msg?.id === n.beans.id, "the block in the desk reader");
      // Scrolled: the link is found where it is drawn now, and a click where it was drawn opens nothing.
      await app.act({ action: "open", args: { id: n.long.id }, as: "test-agent-415" });
      await whole(reader()[1], n.long.id);
      await until(() => { try { where(desk.render((desk as any).ctx).lines, "Garden plan", r()); return true; } catch { return false; } }, "the long note drawn");
      const was = where(desk.render((desk as any).ctx).lines, "Garden plan", r());
      key({ kind: "mouse", action: "wheel-down", button: 0, x: was.x, y: was.y });
      const now = where(desk.render((desk as any).ctx).lines, "Garden plan", r());
      expect(now.y).toBe(was.y - SCROLL_ROWS);
      click(was);
      await Bun.sleep(100);
      expect(reader()[1].msg?.id).toBe(n.long.id);
      click(now);
      await until(() => reader()[1].msg?.id === n.plan.id, "the page, scrolled");
    } finally { app.pop(); }
  }, 20_000);

  test("a river column opens a clicked link in a column beside it", async () => {
    const river = openScreen("river") as Desk, R = () => riverView(river);
    app.push(river);
    try {
      await until(() => !!R().column(1)?.items?.length, "the Library", 10_000);
      await app.act({ action: "open", args: { id: n.jobs.id }, as: "test-agent-415" });
      const col = () => R().byNote(n.jobs.id);
      await until(() => !!col()?.root, "the column");
      const rectOf = () => { river.render(river.ctx); return river.rectOf(col()!)! as Rect; };
      await until(() => { try { where(river.render(river.ctx).lines, "Garden plan", rectOf()); return true; } catch { return false; } }, "the column drawn with titles");
      const before = R().columns.length;
      click(where(river.render(river.ctx).lines, "Stake the beans", rectOf()));
      await until(() => !!R().byNote(n.beans.id), "a column for the block");
      expect(R().columns.length).toBe(before + 1);
      expect((R().focused.source as { id?: string }).id).toBe(n.beans.id);
    } finally { app.pop(); }
  }, 20_000);
});
