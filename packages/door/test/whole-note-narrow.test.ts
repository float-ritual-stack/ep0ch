// PIE-1572: a comment on the whole note reads in a narrow tile (a phone, a squeezed tile), in every comment mode, by a
// click and by keys: in the plain reader and under a host's own header (the BBS message reader), at 44 and 60 columns.
// No service: made-up notes and threads.
import { describe, expect, test } from "bun:test";
import { subject } from "../src/board";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { MarginMode } from "../src/surface/margin";
import type { Key } from "../src/term";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const until = async (ok: () => boolean, what: string, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(10); }
};
const char = (ch: string): Key => ({ kind: "char", ch });

const TEXT = "Shed jobs\nOil the chain before the frost.\nThe pump lives by the door.";
const WORDS = "Keep this list by the back door so the jobs get done before the first frost.";
const note = { id: "5eed0000-1111-4222-8333-157200000001", text: TEXT, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] };
const thread = (lifecycle: "open" | "seen") => ({ id: "c0ffee00-1111-4222-8333-157200000002", author: "sam", body: WORDS, quote: "", at: Date.now(), open: lifecycle === "open", lifecycle, start: null, end: null, replies: [] });

/** A reader's host; `bbs`: the BBS message reader's own header rows above the surface. */
const hostFor = (lifecycle: "open" | "seen", bbs: boolean): SurfaceHost => ({
  ctx: { board: { ancestors: async () => [], comments: async () => [thread(lifecycle)], request: async () => { throw new Error("no service here"); } }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
  redraw() {}, navigate() {},
  ...(bbs ? { header: (m: any, w: number) => ["Date: today", "From: you", `Subj: ${subject(m)}`, "Stat: PUBLIC MESSAGE"].map(l => l.padEnd(w)) } : {}),
});

async function reader(w: number, mode: MarginMode, lifecycle: "open" | "seen" = "open", bbs = false) {
  const s = new NoteSurface(), h = hostFor(lifecycle, bbs);
  s.show(note as any, h);
  await until(() => s.comments?.length === 1, "the whole-note comment");
  s.setMargin(mode);
  const draw = () => s.render(w, 24, h).lines.map(plain);
  return { s, h, draw };
}

/** Every row holds the comment's words, wrapped, between them. */
const reads = (rows: string[]) => rows.map(r => r.replace(/[│┌└─┐]/g, " ")).join(" ").replace(/\s+/g, " ").includes(WORDS);

describe("a whole-note comment in a narrow reader (PIE-1572)", () => {
  // The Nov 3 sighting: read wide (the card beside the text), then narrowed to 60 or 44. The card folds in at the top of
  // the body; the reader at its top stays at its top, the card in view, never scrolled up past it to the first line.
  test("narrowed from 120 to 60 and 44, a reader at its top keeps the card in view (a short tile: the drawer's)", async () => {
    for (const w of [60, 44]) for (const mode of ["trim", "full"] as const) {
      const { s, h } = await reader(120, mode);
      expect(s.render(120, 14, h).lines.map(plain).some(r => r.includes("┌─ comment"))).toBe(true);
      // A key (here `]`, as the wheel does) anchors the view to the text while the reader is at its top.
      s.key(char("]"), h);
      s.render(120, 14, h);
      expect(s.scroll).toBe(0);
      const rows = s.render(w, 14, h).lines.map(plain);
      expect(rows.some(r => r.includes("┌─ comment")), `${mode} at ${w}:\n${rows.join("\n")}`).toBe(true);
      expect(rows.some(r => r.includes("Keep this list by the back door"))).toBe(true);
      expect(rows.findIndex(r => r.includes("┌─ comment"))).toBeLessThan(rows.findIndex(r => r.includes("Oil the chain")));
    }
  });

  for (const bbs of [false, true]) for (const w of [44, 60]) {
    const where = `${bbs ? "under the BBS header" : "in the reader"} at ${w} columns`;

    test(`${where}: short cards and whole draw its card; as marks, a [+] that opens it`, async () => {
      for (const mode of ["trim", "full"] as const) {
        const { draw } = await reader(w, mode, "open", bbs);
        const rows = draw();
        expect(rows.some(r => r.includes("┌─ comment"))).toBe(true);
        expect(rows.some(r => r.includes("Keep this list by the back door"))).toBe(true);
        if (mode === "full") expect(reads(rows)).toBe(true);
        // Nothing is drawn cut in the gutter beside it: the card's own [–] is its control.
        expect(rows.some(r => /^\s*…/.test(r))).toBe(false);
        expect(rows.every(r => r.length <= w)).toBe(true);
      }
      const { draw } = await reader(w, "off", "open", bbs);
      const rows = draw();
      expect(rows.some(r => r.includes("Keep this list"))).toBe(false);
      expect(rows.some(r => r.includes("[+]"))).toBe(true);
    });

    test(`${where}: a click reads it whole, from a short card and from its [+]`, async () => {
      // Short cards: a click on the card opens it whole.
      {
        const { s, h, draw } = await reader(w, "trim", "open", bbs);
        const rows = draw(), y = rows.findIndex(r => r.includes("Keep this list"));
        expect(reads(rows)).toBe(false);
        expect(s.click(rows[y]!.indexOf("Keep") + 2, y, h)).toBe(true);
        await until(() => reads(draw()), "the card whole");
      }
      // As marks, and a comment put away as seen in any mode: its [+] opens just that card.
      for (const [mode, lifecycle] of [["off", "open"], ["trim", "seen"], ["full", "seen"]] as const) {
        const { s, h, draw } = await reader(w, mode, lifecycle, bbs);
        const rows = draw(), y = rows.findIndex(r => r.includes("[+]"));
        expect(y).toBeGreaterThanOrEqual(0);
        expect(s.click(rows[y]!.indexOf("[+]") + 1, y, h)).toBe(true);
        await until(() => reads(draw()), `the card opened from its [+] (${mode}, ${lifecycle})`);
      }
    });

    test(`${where}: by keys, ] reaches it and ⏎ reads it whole`, async () => {
      for (const [mode, lifecycle] of [["trim", "open"], ["off", "open"], ["full", "seen"]] as const) {
        const { s, h, draw } = await reader(w, mode, lifecycle, bbs);
        draw();
        // Its stop: the [+] that opens it (as marks, or put away), or a short card's "Open thread".
        let found = false;
        for (let i = 0; i < 6 && !found; i++) {
          s.key(char("]"), h);
          const e = s.describeElements().find(e => e.current) as { kind?: string; control?: string } | undefined;
          found = e?.kind === "comment" || e?.control === "card";
        }
        expect(found).toBe(true);
        s.key({ kind: "enter" }, h);
        await until(() => reads(draw()), `the card opened by ⏎ (${mode}, ${lifecycle})`);
      }
    });
  }
});
