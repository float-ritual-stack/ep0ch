// PIE-439: the showcase screen, search. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../src/app";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { jevOff } from "../../src/surface/completer";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: search", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("a subtitle finds the short title and prints beneath it", async () => {
    const hits = await board.searchBlocks("Growing together through the seasons");
    expect(hits.matches[0]).toMatchObject({ title: "Allotment notebook", exact: true });
    const p = Bun.spawn(["bun", join(import.meta.dir, "../../src/main.ts"), "show", seeded.notes.notebook.id, "--width", "90"], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_SOCKET: scratch.sock, EP0CH_WS: scratch.name },
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(out.split("\n").slice(0, 2).map(l => l.trim())).toEqual(["Allotment notebook", "Growing together through the seasons"]);
    const record = (await board.records([seeded.notes.notebook.id])).records[0]!;
    expect(record.subtitle).toBe("Growing together through the seasons");
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "search" }, as: "test-agent" });
    screen();
    const completion = await app.act({ action: "complete", args: { text: "((Growing together through the seasons" }, as: "test-agent" }) as any;
    expect(completion.items[0].label).toBe("Allotment notebook");

  }, 30_000);

  test("subtitle rows, default figure columns and tile titles read the same note", async () => {
    const note = await board.createBlock(null, "Orchard [subtitle::Apples, pears and plums] [patch::subtitle-demo]\nFruit trees.\n\n::backlinks");
    const page = await board.createBlock(null, `Fruit guide [subtitle::Choosing trees for a small garden]\n((${note.id}))\n\n::outlinks\n\n::graph-table\n---\nquery: patch=subtitle-demo\n---\n::\n\n::graph-tabs\n---\nquery: patch=subtitle-demo\ngroup: patch\n---\n::`);
    const show = async (width: number, id = page.id) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../../src/main.ts"), "show", id, "--width", String(width)], {
        stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_SOCKET: scratch.sock, EP0CH_WS: scratch.name },
      });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect({ code, err }).toEqual({ code: 0, err: "" });
      return out;
    };
    const wide = await show(110);
    expect(wide).toContain("Orchard · Apples, pears and plums");
    expect(wide.match(/subtitle/g)?.length).toBeGreaterThanOrEqual(2);
    expect(await show(25)).toContain("Orchard");
    expect(await show(110, note.id)).toContain("Fruit guide · Choosing trees for a small garden");
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "detail" }, as: "test-agent" });
    screen();
    await until(() => screen().includes("Growing together through the seasons"), "the detail note to load");
    expect(await app.act({ action: "tile.title", tile: "detail", args: { text: "{{this.subtitle}}" }, as: "test-agent" })).toMatchObject({ title: "Growing together through the seasons" });
  }, 30_000);

  test("search, driven by an agent: the section's own desk answers the service's forgiving search, the person's overlay left alone", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    // The door draws a frame after it: that is when the section's desk is entered and has the door's context.
    screen();
    const r = await app.act({ action: "search", args: { query: "alotment notebok" }, as: "test-agent" }) as any;
    expect(r.query).toBe("alotment notebok");
    expect(r.hits[0]).toMatchObject({ n: 1, title: "Allotment notebook" });
    expect(r.hits.map((h: any) => h.title)).toContain("Allotment figures");
    // Any word order, punctuation folded.
    const lentil = await app.act({ action: "search", args: { query: "soup, lentil" }, as: "test-agent" }) as any;
    expect(lentil.hits[0].title).toBe("Lentil soup");
    expect(S().focus).toBe("index");
  }, 20_000);


  test("search, from a shell (PIE-534): the section opened through act; find --query, show $(find --ids) and export answer from the same outline", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    // The section's note says what to try from a shell, under the search overlay the section opens with.
    await until(() => screen().includes("From a shell"), "the finding note's shell section");
    expect(SECTIONS.find(x => x.key === "search")!.aside).toContain("ep0ch export");
    const cli = async (...args: string[]) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../../src/main.ts"), ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_SOCKET: scratch.sock, EP0CH_WS: scratch.name, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock" } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { out, err, code };
    };
    const errand = seeded.notes.errand.id;
    const found = await cli("find", "--query", "type=errand tag=spring", "--ids");
    expect(found.out.trim()).toBe(`((${errand}))`);
    const shown = await cli("show", "--width", "70", found.out.trim());
    expect(shown.out.split("\n")[0]).toBe("Seed order for the plot");          // the ` - ` separators aren't in the title
    const out = mkdtempSync(join(tmpdir(), "ep0ch-sink-export-"));
    try {
      expect((await cli("export", "--query", "type=errand", "--children", "--out", out)).code).toBe(0);
      const file = readFileSync(join(out, `seed-order-for-the-plot-${errand.slice(0, 8)}.md`), "utf8");
      expect(file).toContain('type: "errand"\narea: "garden"\nctx: "2026-03-09 @ 09:27:29 AM"\ntag:\n  - "seeds"\n  - "spring"\n---\nSeed order for the plot\nBroad beans');
      expect(file).toContain("\n- Ask the neighbour about netting\n  She has a spare roll.\n");
    } finally { rmSync(out, { recursive: true, force: true }); }
    expect(S().focus).toBe("index");
  }, 30_000);


  test("search: (( forgives a typo and another order through act, from the note read there; the bar's notes scope asks from that note, then Jev keeps the pick", async () => {
    (app as any).lastInput = 0;
    const finding = seeded.notes.finding.id;
    const asked: { query: string; semantic: boolean; near?: string }[] = [];
    const real = board.searchBlocks.bind(board), rows = board.completionRows.bind(board);
    // The popup's (( is the service's blocks source (PIE-1340): asked with the note it's asked from.
    board.completionRows = async (r) => { asked.push({ query: r.target.query, semantic: !!r.semantic, near: r.near }); return rows(r); };
    // Jev, as a host with a key would answer: the same hits, reversed, said "ranked".
    board.searchBlocks = async (text, opts = {}) => {
      asked.push({ query: text, semantic: !!opts.semantic, near: opts.near });
      const r = await real(text, { ...opts, semantic: false });
      return opts.semantic ? { ...r, matches: [...r.matches].reverse(), semantic: { status: "ranked" } } : r;
    };
    // A scratch host has no Jev key (test/scratch.ts): the bar that said so is asked again, of the stand-in.
    jevOff.delete(board);
    try {
      expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
      // The person's / on the section's desk: the power bar's notes scope, typed in.
      press({ kind: "enter" });
      await until(() => S().focus === "stage", "in the stage");
      press({ kind: "char", ch: "/" });
      await until(() => (app as any).bar?.scope === "notes", "the bar's notes scope", 5000);
      for (const c of "alotment notebok") press({ kind: "char", ch: c });
      const bar = () => (app as any).bar;
      await until(() => bar()?.items.length > 0, "the hits", 5000);
      // (( in the reader's note: the same search a draft's popup asks, with a typo in each word, then another order.
      const typo = await app.act({ action: "complete", args: { text: "((alotment notebok" }, as: "test-agent" }) as any;
      expect(typo).toMatchObject({ kind: "block", query: "alotment notebok" });
      expect(typo.items[0]).toMatchObject({ n: 1, label: "Allotment notebook", insertion: `((${seeded.notes.notebook.id}))` });
      const order = await app.act({ action: "complete", args: { text: "((soup lentl" }, as: "test-agent" }) as any;
      expect(order.items[0].label).toBe("Lentil soup");
      expect(asked.filter(a => a.query === "soup lentl").map(a => a.near)).toEqual([finding]);
      // The bar asked from the note under it; after a pause, Jev's order with the pick kept.
      await until(() => bar()?.describe().said?.notes === "jev ranked", "Jev's order in the bar", 5000);
      expect(asked.some(a => a.query === "alotment notebok" && a.semantic && a.near === finding)).toBe(true);
      const drawn = () => { (app as any).paint(); return h.painted.map(plain).join("\n"); };
      expect(drawn().split("\n").find(l => l.includes("› alotment notebok"))).toContain("jev ranked");
      // Jev's order (the stand-in reversed it) puts another note first, and the notebook, picked before, is still lit.
      const d = bar().describe();
      expect(d.rows[0].label).not.toBe("Allotment notebook");
      expect(d.rows[d.selected - 1].label).toBe("Allotment notebook");
      press({ kind: "esc" });
      expect(bar().describe().query).toBe("");
      press({ kind: "esc" });
      expect(bar()).toBeNull();
      press({ kind: "esc" });
      expect(S().focus).toBe("index");
    } finally {
      board.searchBlocks = real;
      board.completionRows = rows;
      // Whatever failed above, the next test starts at the index with no bar open.
      if ((app as any).bar?.query) press({ kind: "esc" });
      if ((app as any).bar) press({ kind: "esc" });
      if (S().focus === "stage") press({ kind: "esc" });
    }
  }, 20_000);
});
