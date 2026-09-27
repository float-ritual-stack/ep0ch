import { describe, expect, test } from "bun:test";
import { parseAnsi, readSauce } from "../src/ansi";
import { locate } from "../src/art-view";
import { KittyLayer } from "../src/kitty";
import { find, loadArt } from "../src/packs";
import { rasterize } from "../src/vga";

const bytes = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)));

describe("ANSI.SYS interpreter", () => {
  test("bold is bright foreground, blink is bright background only with iCE", () => {
    const art = parseAnsi("t", bytes("\x1b[1;34;45mA\x1b[0;5;41mB"));
    expect(art.rows[0]![0]).toEqual({ code: 65, fg: 9, bg: 5 });
    expect(art.rows[0]![1]).toEqual({ code: 66, fg: 7, bg: 4 });
    expect(parseAnsi("t", bytes("\x1b[5;41mB"), { ice: true }).rows[0]![0]!.bg).toBe(12);
  });
  test("wraps at 80 columns, honours cursor moves, stops at ^Z", () => {
    const art = parseAnsi("t", bytes("x".repeat(81) + "\x1b[3CZ\x1aignored"));
    expect(art.rows[1]![0]!.code).toBe(120);
    expect(art.rows[1]![4]!.code).toBe(90);
    expect(art.height).toBe(2);
  });
  test("SAUCE record and comment block are read and excluded from the art", () => {
    const sauce = new Uint8Array(128);
    sauce.set(bytes("SAUCE00"), 0);
    sauce.set(bytes("epOch menu"), 7);
    sauce.set(bytes("Shypht"), 42);
    new DataView(sauce.buffer).setUint16(96, 80, true);
    sauce[104] = 1;
    const comment = bytes("COMNT" + "ENJOY THE DAMN THING".padEnd(64));
    const file = new Uint8Array([...bytes("hi\x1a"), ...comment, ...sauce]);
    const { sauce: s, dataEnd } = readSauce(file);
    expect(s?.title).toBe("epOch menu");
    expect(s?.author).toBe("Shypht");
    expect(s?.comments).toEqual(["ENJOY THE DAMN THING"]);
    expect(dataEnd).toBe(3);
  });
});

describe("Kitty layer", () => {
  const img = rasterize([[{ code: 65, fg: 15, bg: 1 }]], 0, 0, 1, 1);
  test("uploads each distinct image once and only re-places what moved", () => {
    const out: string[] = [];
    const k = new KittyLayer(s => out.push(s));
    k.sync([{ key: "a", image: img, col: 0, row: 0, cols: 1, rows: 1 }]);
    const uploads = () => out.join("").match(/a=t,/g)?.length ?? 0;
    expect(uploads()).toBe(1);
    out.length = 0;
    k.sync([{ key: "a", image: img, col: 0, row: 0, cols: 1, rows: 1 }]);
    expect(out.join("")).toBe("");                      // unchanged: nothing written
    k.sync([{ key: "a", image: img, col: 2, row: 0, cols: 1, rows: 1, crop: { x: 0, y: 0, w: 9, h: 8 } }]);
    expect(uploads()).toBe(0);                          // moved and cropped, pixels reused
    expect(out.join("")).toContain("a=d,d=i");
    expect(out.join("")).toContain("h=8");
    out.length = 0;
    k.dispose();
    expect(out.join("")).toContain("a=d,d=I");          // exit frees image data
  });
});

const packsHere = find("SHY-EMNU.ANS");
describe.skipIf(!packsHere)("the real ep0ch screens", () => {
  test("the ep0ch menu has twelve Menu Cmd slots for live commands", () => {
    const art = loadArt(packsHere!);
    expect(art.sauce?.title).toBe("epoch menu");
    expect(locate(art.rows, "Menu Cmd")).toHaveLength(12);
  });
});
