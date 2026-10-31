// PIE-1198: the power bar's / says how sure a ranked search is. A weak top says "no strong match" in the footer instead
// of reading as the answer, each row carries its Jev score, and the person's pick is kept with the words (PIE-1197).
// A scratch service whose Jev is a fake, fictional notes.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
setDefaultTimeout(30_000);

describe.skipIf(!outliner)("the power bar says how sure a search is", () => {
  // Jev as search asks it: the compost schedule scores high; "is it among these?" as the test sets it.
  let exists = 0.1;
  const fake = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const { model, questions } = await request.json() as { model: string; questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }> };
      const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, id === "exists" ? { type: "noul", noul: questions.which ? 0.9 : exists }
        : id === "which" ? { type: "choice", probabilities: Object.fromEntries(Object.entries((q as unknown as { criteria: Record<string, string> }).criteria).map(([n, d]) => [n, d.includes("Compost turning") ? 0.9 : 0.001])) }
        : q.type === "noul" ? { type: "noul", noul: 0 }
        : q.type === "choice" ? { type: "choice", choice: "none", probabilities: { none: 1 }, confidence: 1 }
        : { type: "score", score: q.instructions.includes("Compost turning") ? 2.6 : 0.3 }]));
      return Response.json({ model, answers, usage: { input_tokens: 300, output_tokens: 2 } });
    },
  });
  const scratch = new Scratch();
  scratch.hostEnv = { OUTLINER_FIGURE_FIT: "on", TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` };
  let board: SocketBoard, app: App, painted: string[] = [], key: (k: Key) => void = () => {}, resized: () => void = () => {};
  let info = { cols: 140, rows: 44, cellW: 9, cellH: 16, kitty: false };
  const saved: Record<string, string | undefined> = {};
  const frame = () => { (app as any).paint(); return painted.map(plain); };
  const type = (s: string) => { for (const c of s) key({ kind: "char", ch: c }); };
  let compost = "";

  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    compost = (await board.createBlock(null, "Compost turning schedule\nturn the heap every two weeks")).id;
    await board.createBlock(null, "Compost bin repairs\nthe lid hinge");
    const term: any = {
      get info() { return info; }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; },
      invalidate() {}, onKey(f: any) { key = f; }, onResize(f: any) { resized = f; }, stop() {}, resume() {},
    };
    app = new App(term, board, Date.now(), () => {});
    app.push(openScreen("desk") as Desk);
    await Bun.sleep(100);
  }, 30_000);
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose(); fake.stop(true);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  test("a top Jev doesn't back says no strong match; each row its score", async () => {
    exists = 0.1;
    key({ kind: "char", ch: "k", ctrl: true });
    type("/compost tea for tomatoes");
    await until(() => frame().some(l => l.includes("no strong match")), "the footer saying no strong match", 10_000);
    const rows = frame();
    expect(rows.some(l => l.includes("Compost turning schedule") && l.includes("2.6/3"))).toBe(true);
    expect(rows.some(l => l.includes("Compost bin repairs") && l.includes("0.3/3"))).toBe(true);
    // Not sure: the footer says how to read every note.
    expect(rows.some(l => l.includes("// reads every note"))).toBe(true);
    key({ kind: "esc" }); key({ kind: "esc" });
  });

  test("a second / reads every note: a note none of whose words were typed is found by meaning", async () => {
    exists = 0.6;
    key({ kind: "char", ch: "k", ctrl: true });
    type("//rotating the pile");
    await until(() => frame().some(l => l.includes("found by meaning")), "the deep search's footer", 15_000);
    expect(frame().some(l => l.includes("Compost turning schedule") && l.includes("by meaning"))).toBe(true);
    // PIE-1409: a right #1 found by meaning, scored a match (2.6) with "is it among these?" unsettled (0.6), says
    // "not sure", never "no strong match".
    expect(frame().some(l => l.includes("jev ranked · not sure"))).toBe(true);
    expect(frame().some(l => l.includes("no strong match"))).toBe(false);
    key({ kind: "esc" }); key({ kind: "esc" });
  });

  test("the top row stays the top as Jev re-orders: its best lit, not the old best wherever it sank (PIE-1409)", async () => {
    exists = 0.1;
    key({ kind: "char", ch: "k", ctrl: true });
    type("/compost bin");
    const bar = () => (app as any).bar.describe();
    await until(() => !!bar().rows?.length && bar().rows[0].label.includes("Compost bin repairs"), "the words' order", 10_000);
    await until(() => Object.values(bar().said ?? {}).some(s => String(s).includes("jev ranked")), "Jev's order", 10_000);
    expect(bar().rows[0].label).toContain("Compost turning schedule");
    expect(bar().selected).toBe(1);
    key({ kind: "esc" }); key({ kind: "esc" });
  });

  test("at 40 columns the verdict reads whole, on a row of its own when the query leaves no room (PIE-1409)", async () => {
    exists = 0.1;
    info = { ...info, cols: 40 }; resized();
    try {
      key({ kind: "char", ch: "k", ctrl: true });
      type("/compost tea for tomatoes");
      await until(() => frame().some(l => l.includes("no strong match")), "the verdict at 40 columns", 10_000);
      expect(frame().some(l => l.includes("jev ranked · no strong match"))).toBe(true);
      key({ kind: "esc" }); key({ kind: "esc" });
    } finally { info = { ...info, cols: 140 }; resized(); }
  });

  test("a top it backs says sure, and the person's pick is kept with the words", async () => {
    exists = 0.95;
    key({ kind: "char", ch: "k", ctrl: true });
    type("/when to turn the compost");
    await until(() => frame().some(l => l.includes("jev ranked · sure")), "the footer saying sure", 10_000);
    key({ kind: "enter" });
    let picks: { query: string; blockId: string; surface: string }[] = [];
    for (let i = 0; i < 100 && !picks.length; i++) { picks = (await board.searchPicks()).picks; if (!picks.length) await Bun.sleep(50); }
    expect(picks[0]).toMatchObject({ query: "when to turn the compost", blockId: compost, rank: 0, surface: "power-bar" });
  });
});
