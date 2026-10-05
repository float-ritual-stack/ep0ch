// Code fences in the reader: the door finds them with outline-core's one fence rule (code-fence.ts), so a fence
// the service treats as code (no property read there, outliner test/literal-regions.test.ts) is drawn as code,
// on the same notes.
import { describe, expect, test } from "bun:test";
import { type Msg } from "../src/board";
import { foldPoints } from "../src/doc";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { LIST_FENCE_NOTE, LONG_FENCE_NOTE, TILDE_FENCE_NOTE } from "../../outline-core/test/fixtures/code-notes";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const note = (text: string): Msg => ({ id: "bbbbbbbb-1111-4222-8333-444444444444", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 2, props: {} });
const host = (): SurfaceHost => ({
  ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
  redraw() {}, navigate() {},
});
const read = (text: string) => { const s = new NoteSurface(), h = host(); s.show(note(text), h); return s.render(90, 40, h).lines; };

describe("a fence the service treats as code is drawn as code (shared fixture)", () => {
  test("a ~~~ fence: its **bold** stays as typed, its [key::value] isn't a property, and a ``` inside doesn't close it", () => {
    const lines = read(TILDE_FENCE_NOTE);
    const text = lines.map(plain);
    expect(text.some(l => l.includes("╭ text"))).toBe(true);
    const code = lines.find(l => plain(l).includes("are code"))!;
    expect(plain(code)).toContain("│ **not bold** and [crate::7] are code, as is #compost");
    expect(code).toContain("[crate::7]");
    expect(text.find(l => l.includes("still code"))).toContain("│ still code [lid::open]");
    // Outside the fence a property is styled: its key and value are coloured apart.
    const after = lines.find(l => plain(l).includes("After it,"))!;
    expect(plain(after)).toContain("[shelf::low]");
    expect(after).not.toContain("[shelf::low]");
  });

  test("a four-backtick fence holds a ``` pair as its text", () => {
    const text = read(LONG_FENCE_NOTE).map(plain);
    expect(text.some(l => l.includes("│ [tray::3] stays text"))).toBe(true);
    expect(text.filter(l => l.trim() === "│ ```")).toHaveLength(2);
    expect(text.some(l => l.includes("Then [tray::4] is read."))).toBe(true);
  });

  test("a fence under a bullet, four columns in, is code in the list item", () => {
    const text = read(LIST_FENCE_NOTE).map(plain);
    expect(text.some(l => l.includes("│     [can::2] stays text"))).toBe(true);
    expect(text.some(l => l.includes("Then fill [can::3] cans"))).toBe(true);
  });

  test("a heading inside a ~~~ fence is not a fold point", () => {
    expect(foldPoints("Intro\n## Shed\ntools\n~~~\n## Not a heading\n~~~\n## Beds\nleeks").map(f => f.text)).toEqual(["Shed", "Beds"]);
  });
});
