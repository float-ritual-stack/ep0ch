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


import { table } from "../src/doc";
import { resolveMediaPath } from "../src/media";
describe("document rendering", () => {
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  test("tables wrap long cells onto more lines instead of truncating, and fit the width", () => {
    const out = table(["| Ticket | Notes |", "|---|---|", "| PC-762 | Three eFax values into dev's Key Vault before the dev end-to-end test can run |"], 40).map(strip);
    expect(out.every(l => [...l].length <= 40)).toBe(true);
    const body = out.filter(l => l.startsWith("│") && !l.includes("Ticket"));
    expect(body.length).toBeGreaterThan(1);
    expect(body.map(l => l.split("│")[2]!.trim()).join(" ")).toContain("end-to-end test can run");
  });
  test("media paths: backslash spaces and macOS screenshot names", () => {
    expect(resolveMediaPath("/tmp/no\\ such\\ file.png").path).toBe("/tmp/no such file.png");
  });
});

describe("Kitty placement ids", () => {
  test("moving an image to a new key never deletes the new placement", () => {
    const out: string[] = [];
    const k = new KittyLayer(s => out.push(s));
    const img = rasterize([[{ code: 65, fg: 15, bg: 1 }]], 0, 0, 1, 1);
    k.sync([{ key: "detail0:img", image: img, col: 0, row: 0, cols: 1, rows: 1 }]);
    out.length = 0;
    k.sync([{ key: "float0:img", image: img, col: 5, row: 5, cols: 1, rows: 1 }]);
    const s = out.join("");
    const placed = s.match(/a=p,i=(\d+),p=(\d+)/)!, deleted = s.match(/a=d,d=i,i=(\d+),p=(\d+)/)!;
    expect(placed[2]).not.toBe(deleted[2]);
    expect(s.indexOf("a=d")).toBeLessThan(s.indexOf("a=p"));
  });
});

import { renderGraph, reframeAscii } from "../src/graphs";
import { renderDoc } from "../src/doc";
describe("mdxcn figures and callouts", () => {
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  test("a ::graph-check block renders framed with its title, within the width", () => {
    const out = renderGraph("check", 'title: launch\nitems:\n  - { label: "freeze tokens", done: true }\n  - { label: "write it up", note: "still open" }', 40).map(strip);
    expect(out[0]).toContain("[ LAUNCH ]");
    expect(out.some(l => l.includes("[x]  freeze tokens"))).toBe(true);
    expect(out.every(l => [...l].length <= 40)).toBe(true);
  });
  test("pasted mdxcn ASCII fences are re-framed", () => {
    const out = reframeAscii(["+---- [ LAUNCH ] ----+", "|                    |", "| [x]  ship it       |", "+--------------------+"], 60)!.map(strip);
    expect(out[0]).toContain("[ LAUNCH ]");
    expect(out.some(l => l.includes("[x]  ship it"))).toBe(true);
  });
  test("a long callout title never runs past the box", () => {
    const doc = renderDoc("> [!note] Notes (not part of the message): follows the 2:34 PM ask, no reply yet.\n> body", { width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 10, unfold: false });
    const lines = doc.lines.map(strip);
    expect(lines.every(l => [...l].length <= 40)).toBe(true);
    expect(lines.join(" ")).toContain("no reply yet.");
  });
});

test("a figure title wider than a narrow pane is shortened, and the frame keeps both borders", () => {
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  const out = renderGraph("check", 'title: "PC-762 path to prod"\nitems:\n  - { label: "PR 1 and PR 2 merged", done: true }', 24).map(strip);
  expect(out.every(l => [...l].length === 24)).toBe(true);
  expect(out[0]).toContain("…");
  expect(out[0]!.endsWith("+")).toBe(true);
});

import { setLiveSource } from "../src/live";
import { Watched } from "../src/watched";
describe("live figures answer from the outline", () => {
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  test("a query-backed check shows current state, and asks again when the service says its answer changed", async () => {
    let stage = "waiting", watch = "", matchesWatch = "", generation = 0;
    const block = (id: string, title: string, props: Record<string, string>) => ({ id, parentId: null, text: title, author: "agent", createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", properties: Object.entries(props).map(([key, value]) => ({ key, value })) });
    const fake: any = {
      request: async (a: string, p: any) => {
        // The service says which results `done:` holds for (query.matches, watched).
        if (a === "query.matches") { matchesWatch = p.watch; return { generation: p.generation ?? 0, blockIds: p.expression === "outbox=done" && stage === "done" ? p.blockIds : [] }; }
        watch = p.watch;
        return { generation, blocks: [block("a", "Nudge Sumit", { type: "outbox-item", outbox: stage, "waiting-on": "Sumit" })].filter(() => p.query.where === "type=outbox-item"), completeness: { kind: "complete" } };
      },
      toMsgs: (bs: any[]) => bs.map(b => ({ id: b.id, text: b.text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "agent", props: Object.fromEntries(b.properties.map((x: any) => [x.key, x.value])) })),
    };
    fake.watched = new Watched(fake);
    let redraws = 0;
    setLiveSource(fake, () => redraws++);
    const yaml = 'title: outbox\nquery: "type=outbox-item"\ndone: "outbox=done"\nnote: waiting-on';
    expect(renderGraph("check", yaml, 60).map(strip).join("\n")).toContain("asking the outline");
    await Bun.sleep(10);
    let out = renderGraph("check", yaml, 60).map(strip).join("\n");
    expect(out).toContain("[ ]  Nudge Sumit");
    expect(out).toContain("live · 1 result");
    // A paint asks nothing; the service's queries.changed does.
    stage = "done";
    renderGraph("check", yaml, 60); await Bun.sleep(10);
    expect(renderGraph("check", yaml, 60).map(strip).join("\n")).toContain("[ ]  Nudge Sumit");
    generation = 1;
    // Both answers changed: the results' (a property moved) and done:'s.
    fake.watched.changed([{ key: watch, generation: 1 }, { key: matchesWatch, generation: 1 }]);
    await Bun.sleep(10);
    out = renderGraph("check", yaml, 60).map(strip).join("\n");
    expect(out).toContain("[x]  Nudge Sumit");
    expect(redraws).toBeGreaterThanOrEqual(2);
    setLiveSource(null, () => {});
  });
});

test("a title-only callout has no empty row inside its frame", () => {
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
  const doc = renderDoc("> [!note] Every item here uses existing actions", { width: 60, cellW: 9, cellH: 18, graphics: false, maxImageRows: 10, unfold: false });
  expect(doc.lines.map(strip).filter(l => /[╭│╰]/.test(l))).toHaveLength(2);
});
