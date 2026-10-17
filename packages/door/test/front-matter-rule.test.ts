// PIE-970: a rule line (`---`) or a list line right under a note's header ends its front matter; it doesn't pull
// the lines after it into the header, and the reader still scrolls. Fictional notes, no service.
import { describe, expect, test } from "bun:test";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const note = (text: string) => ({ id: "c1111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] });

// What the service answers for a line of only hashtags inside the first paragraph: block-scope, a metadata line.
const records = (text: string) => text.split("\n").flatMap((l, line) => (line > 0 && /^(?:[-*+] +)?#\S+(?: +(?:- +)?#\S+)*$/.test(l.trim()) && !text.split("\n").slice(1, line).includes("") && !text.split("\n").slice(1, line).some(x => /^-{3,}$/.test(x))
  ? [...l.matchAll(/#(\S+)/g)].map((m, ordinal) => ({ key: "tag", value: m[1]!, raw: m[0], start: m.index!, end: m.index! + m[0].length, line, column: m.index!, placement: "metadata-line", syntax: "hashtag", ordinal, scope: "block" }))
  : []));

describe("a rule right under the header (PIE-970)", () => {
  const W = 60, H = 12;
  const host = (s: NoteSurface): SurfaceHost => {
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [], get: async () => null, propertyRecords: async (t: string) => records(t) }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate: m => { s.show(m, h); }, focused: false,
    };
    return h;
  };
  const open = async (text: string) => { const s = new NoteSurface(), h = host(s); s.show(note(text) as any, h); s.render(W, H, h); await Bun.sleep(20); s.render(W, H, h); return { s, h, rows: () => s.render(W, H, h).lines.map(plain) }; };
  const header = "Sat plan [page::sat-day] [type::plan] [status::current]";

  test("the rule is drawn, then the tags under it", async () => {
    const { rows } = await open(`${header}\n---\n- #wk43 - #bed7\nSow the peas.`);
    const r = rows(), rule = r.findIndex(l => l.includes("---")), tags = r.findIndex(l => l.includes("#wk43"));
    expect(rule).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(rule);
  });

  test("the same note with a blank line after the rule reads the same", async () => {
    const { rows } = await open(`${header}\n---\n\n- #wk43 - #bed7\nSow the peas.`);
    const r = rows();
    expect(r.findIndex(l => l.includes("#wk43"))).toBeGreaterThan(r.findIndex(l => l.includes("---")));
  });

  test("a note with nothing under the rule but tags still scrolls", async () => {
    const long = `${header}\n---\n- #wk43 - #bed7\n${Array.from({ length: 30 }, (_, i) => `Row ${i + 1}.`).join("\n")}`;
    const { s, h, rows } = await open(long);
    for (let i = 0; i < 6; i++) s.wheel(1, h);
    await Bun.sleep(5);
    s.render(W, H, h);
    expect(s.viewport()!.top).toBeGreaterThan(0);
    expect(rows().join("\n")).not.toContain("Row 1.");
  });

  test("a tag line under prose still scrolls: the tag row stands first but the place keeps its order", async () => {
    const { s, h } = await open(`${header}\nA line of prose.\n#wk43\n${Array.from({ length: 30 }, (_, k) => `Row ${k + 1}.`).join("\n")}`);
    for (let i = 0; i < 6; i++) s.wheel(1, h);
    await Bun.sleep(5); s.render(W, H, h);
    expect(s.viewport()!.top).toBeGreaterThan(0);
  });

  test("a header-only note with a rule and tags does not trap the wheel", async () => {
    const { s, h } = await open(`${header}\n---\n- #wk43 - #bed7`);
    for (let i = 0; i < 6; i++) s.wheel(1, h);
    await Bun.sleep(5);
    expect(() => s.render(W, H, h)).not.toThrow();
    expect(s.viewport()!.total).toBeGreaterThan(0);
  });
});
