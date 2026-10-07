// PIE-622: scroll past the end. A reader (and a draft) can scroll its last line up to the middle of the view
// instead of stopping with it on the bottom edge; End (or G, or to=end) goes to the last line first and, pressed
// again, past it; a draft keeps a few rows round its cursor; `reader.overscroll half|none|<rows>` sets how far.
// Fictional notes, no service.
import { afterEach, describe, expect, test } from "bun:test";
import { Draft } from "../src/edit";
import { endTop, lastTop, overscroll, overscrollOf, overscrollRows, scrollOff, useOverscroll } from "../src/scroll";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

afterEach(() => useOverscroll(undefined));

describe("the rule (src/scroll.ts)", () => {
  test("half lets the last row come up to the middle; none stops it on the edge; rows sets how many", () => {
    expect(overscroll()).toBe("half");
    // 100 rows in a view of 20: End's first stop has row 99 on the bottom edge, the furthest has it on row 9 of 20.
    expect(endTop(100, 20)).toBe(80);
    expect(lastTop(100, 20)).toBe(90);
    expect(99 - lastTop(100, 20)).toBe(9);
    useOverscroll("none");
    expect(lastTop(100, 20)).toBe(80);
    useOverscroll(5);
    expect(lastTop(100, 20)).toBe(85);
    // Never so far that the last row leaves the view.
    useOverscroll(200);
    expect(lastTop(100, 20)).toBe(99);
  });

  test("a short note: no scroll while its last line is already at the middle; past it, up to the middle", () => {
    expect(lastTop(5, 20)).toBe(0);
    expect(lastTop(10, 20)).toBe(0);
    expect(lastTop(15, 20)).toBe(5);
    expect(lastTop(0, 20)).toBe(0);
  });

  test("the setting reads half, none or whole rows; anything else is half", () => {
    expect(overscrollOf("half")).toBe("half");
    expect(overscrollOf("none")).toBe("none");
    expect(overscrollOf("7")).toBe(7);
    expect(overscrollOf(7)).toBe(7);
    for (const bad of ["most", "-1", 2.5, 201, null, undefined]) expect(overscrollOf(bad)).toBeNull();
    useOverscroll("most");
    expect(overscroll()).toBe("half");
    expect(overscrollRows(20)).toBe(10);
    expect(overscrollRows(20, "none")).toBe(0);
    expect(scrollOff(20)).toBe(3);
    expect(scrollOff(6)).toBe(1);
  });
});

describe("a reader (NoteSurface): the wheel, the keys and act at the end", () => {
  const id = "a1111111-2222-4333-8444-555555555555";
  const long = { id, text: `Seed swap ledger\n${Array.from({ length: 40 }, (_, i) => `Packet ${i + 1}: runner beans.`).join("\n")}\nLast packet.`, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} };
  const short = { ...long, id: "b1111111-2222-4333-8444-555555555555", text: `Short list\n${Array.from({ length: 6 }, (_, i) => `Tray ${i + 1}.`).join("\n")}` };
  const host = (s: NoteSurface): SurfaceHost => {
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async () => null }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate: m => { s.show(m, h); }, focused: false,
    };
    return h;
  };
  const W = 60, H = 20;
  const open = (m: typeof long) => { const s = new NoteSurface(), h = host(s); s.show(m as any, h); s.render(W, H, h); return { s, h, draw: () => s.render(W, H, h), vp: () => { s.render(W, H, h); return s.viewport()!; } }; };
  const settle = () => Bun.sleep(5);

  test("End (and G) puts the last line on the bottom edge; again, it comes up to the middle; past it is blank", async () => {
    const { s, h, vp, draw } = open(long);
    const v0 = vp();
    expect(v0.atEnd).toBe(false);
    const end = v0.total - v0.room;
    s.key({ kind: "end" }, h); await settle();
    expect(vp()).toMatchObject({ top: end, atEnd: true, past: 0 });
    expect(plain(draw().lines.at(-1)!)).toContain("Last packet.");
    s.key({ kind: "end" }, h); await settle();
    const v = vp();
    expect(v.top).toBe(end + Math.floor(v.room / 2));
    expect(v).toMatchObject({ atEnd: true, past: Math.floor(v.room / 2) });
    const lines = draw().lines.map(plain), at = lines.findIndex(l => l.includes("Last packet."));
    // The last line sits at the body's middle, and every row under it is blank.
    expect(at - (H - v.room)).toBe(v.room - 1 - Math.floor(v.room / 2));
    expect(lines.slice(at + 1).every(l => !l.trim())).toBe(true);
    // Home goes back; G does what End does.
    s.key({ kind: "home" }, h); await settle();
    expect(vp().top).toBe(0);
    s.key(char("G"), h); await settle();
    expect(vp().top).toBe(end);
    s.key(char("G"), h); await settle();
    expect(vp().top).toBe(end + Math.floor(v.room / 2));
  });

  test("the wheel and j keep going past the edge, and stop at the middle", async () => {
    const { s, h, vp } = open(long);
    for (let i = 0; i < 200; i++) s.wheel(1, h);
    await settle();
    const v = vp();
    expect(v.top).toBe(v.total - v.room + Math.floor(v.room / 2));
    s.key({ kind: "home" }, h); await settle();
    for (let i = 0; i < 200; i++) s.key(char("j"), h);
    await settle();
    expect(vp().top).toBe(v.top);
  });

  test("act scroll to=end: the same two stops, and the viewport says where it is", async () => {
    const { s, h, vp } = open(long);
    const agent = { kind: "agent" as const, id: "test-agent-622" };
    await s.act("scroll", { to: "end" }, h, agent);
    const first = vp();
    expect(first).toMatchObject({ atEnd: true, past: 0, top: first.total - first.room });
    // What the action answers, before any paint, is where it went.
    expect(await s.act("scroll", { to: "end" }, h, agent)).toMatchObject({ top: first.top + Math.floor(first.room / 2), past: Math.floor(first.room / 2), atEnd: true });
    expect(vp()).toMatchObject({ top: first.top + Math.floor(first.room / 2), past: Math.floor(first.room / 2) });
    await s.act("scroll", { by: 3 }, h, agent);
    expect(vp().top).toBe(first.top + Math.floor(first.room / 2));
  });

  test("a short note doesn't move while its last line is above the middle", async () => {
    const { s, h, vp } = open(short);
    s.key({ kind: "end" }, h); s.key({ kind: "end" }, h); s.wheel(1, h); await settle();
    expect(vp()).toMatchObject({ top: 0, atEnd: true, past: 0 });
  });

  test("reader.overscroll none: End stops on the edge and stays there", async () => {
    useOverscroll("none");
    const { s, h, vp } = open(long);
    s.key({ kind: "end" }, h); s.key({ kind: "end" }, h); s.wheel(1, h); await settle();
    const v = vp();
    expect(v).toMatchObject({ top: v.total - v.room, past: 0, atEnd: true });
  });
});

describe("a draft: scrolloff round the cursor, and the wheel past the end", () => {
  const text = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the sowing plan.`).join("\n");
  const H = 12;
  const shown = (d: Draft) => d.render(60, H).map(plain);

  test("typing on the last line keeps a few blank rows under it", () => {
    const d = new Draft("note-622", 1, text);
    d.place(29, Infinity);
    d.follow = true;
    const rows = shown(d), off = scrollOff(H);
    expect(rows.findIndex(r => r.includes("Line 30"))).toBe(H - 1 - off);
    expect(rows.length).toBe(H - off);
    d.key({ kind: "enter" }); d.key(char("x"));
    const again = shown(d);
    expect(again.findIndex(r => r.trimEnd().endsWith("x"))).toBe(H - 1 - off);
  });

  test("moving up keeps rows above the cursor too", () => {
    const d = new Draft("note-622", 1, text);
    d.place(29, 0); shown(d);
    for (let i = 0; i < 20; i++) d.key({ kind: "up" });
    const rows = shown(d);
    expect(rows.findIndex(r => r.includes("Line 10 "))).toBe(scrollOff(H));
  });

  test("the wheel goes past the end to the middle; none keeps the last line on the edge", () => {
    const d = new Draft("note-622", 1, text);
    shown(d);
    for (let i = 0; i < 100; i++) d.scrollBy(1);
    let rows = shown(d);
    expect(rows.findIndex(r => r.includes("Line 30"))).toBe(H - 1 - Math.floor(H / 2));
    useOverscroll("none");
    for (let i = 0; i < 100; i++) d.scrollBy(1);
    rows = shown(d);
    expect(rows.findIndex(r => r.includes("Line 30"))).toBe(H - 1);
  });

  test("a draft that fits doesn't move", () => {
    const d = new Draft("note-622", 1, "Seed order\nBeans\nPeas");
    d.place(2, Infinity);
    expect(shown(d)[0]).toContain("Seed order");
    d.scrollBy(5);
    expect(shown(d)[0]).toContain("Seed order");
  });
});
