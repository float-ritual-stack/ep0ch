// One reading position, one activation (PIE-1556): ⏎ on the current element, a click on it and `act` (element.open,
// link.follow) all end in the same action on the same element, so they open or toggle the same thing. A note holds a
// link, an embed, a figure's row, a proposal's control and a step's box; each is pressed the three ways on a fresh
// reader and the outcome compared. The reader keeps one position: a link selected is its element, never a second cursor.
// Made-up notes, against a scratch outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Msg } from "../src/board";
import { SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { READER_KEYS } from "../src/surface/reader-keys";
import { outliner, Scratch, until } from "./scratch";

const W = 90, H = 60;
const TIDY: Actor = { kind: "agent", id: "tidy" };
type Way = "key" | "click" | "act";
const WAYS: Way[] = ["key", "click", "act"];

describe.skipIf(!outliner)("one activation for ⏎, a click and act, on a scratch service", () => {
  const scratch = new Scratch();
  let board: SocketBoard, agent: SocketBoard;
  const flashes: string[] = [];
  const opened: string[] = [];
  const host = (): SurfaceHost => ({
    ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate(m: Msg) { opened.push(m.id); },
  });
  const create = async (text: string, parentId: string | null = null) => (await board.request<any>("create", { parentId, text, author: "user" })).id as string;
  const n: Record<string, string> = {};

  /** A note with every kind of target, tidy's suggestion beside it (a proposal's [dismiss]). */
  async function fixture() {
    const id = await create(`Allotment week\nFirst read [[Seed ledger]].\n\n!((${n.shed}))\n\n- [ ] water the beans\n\n::graph-table\n---\ntitle: Beds\nquery: "type=parity-bed"\ncolumns: [title]\n---\n::\n\nThe peas climb  the net.\n`);
    const read = (await board.get(id))!;
    const observed = "The peas climb  the net.", start = read.text.indexOf(observed);
    const r = await agent.request<any>("draft.patch", {
      blockId: id, revision: read.revision, propose: true, mutation: { author: "agent", actorId: "tidy" },
      patches: [{ observed, replacement: "The peas climb the net.", range: { start, end: start + observed.length }, unit: "utf16", before: read.text.slice(0, start), after: read.text.slice(start + observed.length) }],
    });
    expect(r).toMatchObject({ outcome: "proposed" });
    return id;
  }

  async function reading(id: string) {
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    const frame = () => s.render(W, H, h).lines.map(visible);
    await until(() => { frame(); const e = s.describeElements(); return e.some(x => x.kind === "embed") && e.some(x => x.kind === "row") && e.some(x => x.kind === "task") && e.some(x => x.control === "dismiss"); }, "every target drawn", 10_000);
    return { s, h, frame };
  }

  /** The targets, each by how to find its element and its words on screen, and what pressing it does. */
  const TARGETS = [
    { name: "a link", find: (e: any) => e.kind === "link" && /Seed ledger/.test(e.label), text: "Seed ledger", outcome: async (_s: NoteSurface) => { await until(() => opened.at(-1) === n.ledger, "the ledger opened"); return opened.at(-1); } },
    { name: "an embed", find: (e: any) => e.kind === "embed", text: "Paint the shed", outcome: async (_s: NoteSurface) => { await until(() => opened.at(-1) === n.shed, "the shed opened"); return opened.at(-1); } },
    { name: "a figure's row", find: (e: any) => e.kind === "row" && /North bed/.test(e.label), text: "North bed", twice: true, outcome: async (_s: NoteSurface) => { await until(() => opened.at(-1) === n.north, "the bed opened"); return opened.at(-1); } },
    { name: "a proposal's [dismiss]", find: (e: any) => e.control === "dismiss", text: "[dismiss]", outcome: async (_s: NoteSurface) => { await until(() => flashes.some(f => f.includes("dismissed the proposal")), "the dismiss"); return "dismissed"; } },
    { name: "a step's box", find: (e: any) => e.kind === "task", text: "water the beans", box: true, outcome: async (s: NoteSurface) => { await until(() => s.picker !== null, "the status choice"); return `choice on ${s.picker!.key.split("#")[0]!.slice(0, 5)}`; } },
  ] as const;

  async function press(t: (typeof TARGETS)[number], way: Way) {
    flashes.length = 0; opened.length = 0;
    const { s, h, frame } = await reading(await fixture());
    const i = s.describeElements().findIndex(t.find) + 1;
    expect(i).toBeGreaterThan(0);
    if (way === "key") {
      await s.runKey("element.select", { n: i }, h);
      expect(s.key({ kind: "enter" }, h)).toBe(true);
    } else if (way === "click") {
      const lines = frame(), y = lines.findIndex(l => l.includes(t.text));
      expect(y).toBeGreaterThanOrEqual(0);
      // A step's box sits two cells before its words.
      const x = lines[y]!.indexOf(t.text) + ("box" in t ? -2 : 1);
      s.click(x, y, h);
      // A list row selects on the first press and opens on the second, as ⏎ opens the row it is on.
      if ("twice" in t) { frame(); s.click(x, y, h); }
    } else await s.runKey("element.open", { n: i }, h);
    const out = await t.outcome(s);
    // Wherever it came from, the press left the position on that element.
    expect({ way, at: s.describeElements().find(e => e.current)?.n }).toEqual({ way, at: i });
    return out;
  }

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});
    agent = new SocketBoard(scratch.sock);
    await agent.info();
    n.ledger = await create("Seed ledger [page::Seed ledger]\nWhat came in, what went out.");
    n.shed = await create("Paint the shed\nTwo coats, green.");
    n.north = await create("North bed [type::parity-bed]\nBeans.");
    n.south = await create("South bed [type::parity-bed]\nLeeks.");
  }, 30_000);
  afterAll(async () => { board?.close(); agent?.close(); await scratch.dispose(); }, 20_000);

  for (const t of TARGETS) {
    test(`${t.name}: ⏎, a click and act do the same thing`, async () => {
      const got: Record<string, unknown> = {};
      for (const way of WAYS) got[way] = await press(t, way);
      expect(got.click).toEqual(got.key);
      expect(got.act).toEqual(got.key);
    }, 60_000);
  }

  test("an agent's act opens the same things, as itself, and leaves the person's position alone", async () => {
    for (const t of TARGETS.filter(t => t.name !== "a step's box")) {
      flashes.length = 0; opened.length = 0;
      const { s, h } = await reading(await fixture());
      const i = s.describeElements().findIndex(t.find) + 1;
      // A reader the person isn't in (an agent never acts in the one with their keys).
      const r = await s.act("element.open", { n: i }, { ...h, focused: false }, TIDY);
      expect(r).toMatchObject({ element: i });
      expect(await t.outcome(s)).toEqual(await press(t, "key"));
      expect(s.describeElements().find(e => e.current)).toBeUndefined();
    }
  }, 120_000);

  test("link.follow on a drawn link is its element's activation: the person's lands the position on it", async () => {
    flashes.length = 0; opened.length = 0;
    const { s, h } = await reading(await fixture());
    const k = s.describe().links.findIndex((l: any) => l.page === "Seed ledger") + 1;
    await s.runKey("link.follow", { n: k }, h);
    await until(() => opened.at(-1) === n.ledger, "the ledger opened");
    expect(s.describeElements().find(e => e.current)?.label).toContain("Seed ledger");
    expect(s.describe().links.filter((l: any) => l.selected).map((l: any) => l.page)).toEqual(["Seed ledger"]);
  }, 30_000);

  test("r is the key table's: its row picks, with no branch after the table", () => {
    const r = READER_KEYS.find(row => row.key === "r" && row.action === "proposal.resolve")!;
    expect(r.pick).toBe("resolve");
  });
});
