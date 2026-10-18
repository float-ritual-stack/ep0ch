// PIE-439: the showcase screen, figures: steps, tabs and Markdown kinds. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { osc52 } from "../../src/surface/selection";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import { liveBoard } from "../../src/live";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { drawNote } from "../../src/notes-cli";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: figures: steps, tabs and Markdown kinds", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("activity days open their notes below the reader through act (PIE-972)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "figures" }, as: "test-agent" });
    await until(() => screen().includes("CHORES WRITTEN"), "activity figures");
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const now = new Date(), today = localDate(now);
    const tomorrow = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const elements = async () => ((await app.act({ action: "elements", tile: "reader", as: "test-agent" })) as any).elements;
    for (const [query, title] of [[`created >= ${today} created < ${tomorrow}`, ""], [`updated >= ${today} updated < ${tomorrow}`, ""], ["date = 2026-03-04", "Raised beds for the squash"], ["date = 2026-03-05", ""]] as const) {
      await untilAsync(async () => (await elements()).some((e: any) => e.label === query), `activity cell ${query}`);
      const e = (await elements()).find((e: any) => e.label === query);
      expect(e, `selectable activity cell: ${query}`).toBeDefined();
      const result = await app.act({ action: "element.open", tile: "reader", args: { n: e.n }, as: "test-agent" }) as any;
      expect(result.query).toBe(query);
      if (title) expect(result.notes.map((n: any) => n.title)).toEqual([title]);
      else if (query.startsWith("date")) expect(result.notes).toEqual([]);
      else {
        expect(result.notes.length).toBeGreaterThan(0);
        const note = (await board.get(result.notes[0].id))!;
        expect(localDate(new Date(query.startsWith("created") ? note.createdAt : note.updatedAt))).toBe(today);
      }
    }
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "figures")).top;
    const tiles = desk.layoutGet().tiles;
    expect(tiles.find((t: any) => t.kind === "query")).toMatchObject({ home: "reader", query: `created >= ${today} created < ${tomorrow}` });
    expect(desk.focus).toBe(desk.idNamed("reader"));
    const drawn = (await drawNote(board, seeded.notes.markdownFigures.id, 100))!.map(plain).join("\n");
    expect(drawn).toContain("3 in 3 weeks");
    const reader = tiles.find((t: any) => t.name === "reader"), lane = tiles.find((t: any) => t.kind === "query");
    expect(lane.rect.row).toBeGreaterThanOrEqual(reader.rect.row + reader.rect.rows);
    press({ kind: "enter" });
    for (let i = 0; i < (await elements()).length && !(await elements()).some((e: any) => e.current && e.label === "date = 2026-03-04"); i++) ch("]");
    expect((await elements()).find((e: any) => e.current)?.label).toBe("date = 2026-03-04");
    press({ kind: "enter" });
    await until(() => {
      screen();
      const list = desk.layoutGet().tiles.find((t: any) => t.kind === "query");
      return list?.query === "date = 2026-03-04" && list.cards?.some((c: any) => c.title === "Raised beds for the squash");
    }, "the selected day's notes opened with Enter");
    await desk.dispatch.act({ action: "tile.focus", tile: "reader", args: {} }, { kind: "user" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 20_000);

  test("steps (PIE-811): the person approves a step by keys; an agent reads the answer and rejects another (the mouse path is tasks.test's)", async () => {
    const id = seeded.notes.buildLog.id;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "steps" }, as: "test-agent" })).toMatchObject({ key: "steps" });
    await until(() => screen().includes("felt from the merchant"), "the build log", 8000);
    const statuses = async () => ((await app.act({ action: "tasks", tile: "build log", as: "test-agent" })) as any).steps.map((t: any) => t.status).join(" ");
    await untilAsync(async () => (await statuses()) === "todo todo approved rejected done waiting", "the steps read");
    // Keys: into the reader, [ ] to the felt, ⏎ opens its choices, + approves it.
    press({ kind: "enter" });
    for (let i = 0; i < 20 && !screen().includes("step [ ] felt from the merchant"); i++) ch("]");
    expect(screen()).toContain("step [ ] felt from the merchant");
    press({ kind: "enter" });
    await until(() => screen().includes("Approve"), "the choices");
    ch("+");
    await untilAsync(async () => (await board.get(id))!.text.includes("- [✓] felt from the merchant, not the DIY shop ^t-b1d001"), "the approval");
    // An agent reads the answer and rejects the gutter, recorded as its own.
    await untilAsync(async () => (await statuses()).startsWith("approved todo"), "the agent to see the approval");
    expect(await app.act({ action: "task.status", tile: "build log", args: { n: "2", to: "rejected" }, as: "test-agent" })).toMatchObject({ status: "rejected" });
    await untilAsync(async () => (await board.get(id))!.text.includes("- [✗] patch the gutter until spring"), "the agent's rejection");
    // Back to the index, and the note put back as it was seeded.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
    const text = (await board.get(id))!;
    await board.update(id, text.text.replace("- [✓] felt", "- [ ] felt").replace("- [✗] patch", "- [ ] patch"), text.revision!);
  }, 30_000);


  test("figure steps (PIE-864): a ::graph-check row's code span copies by a click and its link is an element, as on the plain line; its box takes x by keys and an agent's mark; a live row's mark writes its note's status; ctrl+z undoes", async () => {
    const id = seeded.notes.testPlan.id, before = (await board.get(id))!.text;
    const jobs = (await board.children(id)).filter(j => j.text.includes("[type::door-job]"));
    const plane = jobs.find(j => j.text.startsWith("Plane"))!;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "figure-steps" }, as: "test-agent" })).toMatchObject({ key: "figure-steps" });
    await until(() => screen().includes("lift the latch twice") && screen().includes("Plane the door"), "the test plan, its live jobs", 8000);
    // The row reads as the line above it does: the backticks aren't drawn, emphasis is, and its link is the note's title.
    expect(screen()).toContain("open http://localhost:4175/gate?code=7");
    expect(screen()).not.toContain("`http://localhost:4175");
    const tasks = async () => ((await app.act({ action: "tasks", tile: "test plan", as: "test-agent" })) as any).steps.map((t: any) => `${t.status} ${t.text}`);
    await untilAsync(async () => (await tasks()).length === 6, "the steps read: the plain line, three rows, two live jobs");
    expect((await tasks()).slice(0, 4)).toEqual([
      "todo the same step on a plain line: open `http://localhost:4175/gate?code=7`",
      "todo open `http://localhost:4175/gate?code=7` — as **Ana**, from [[Shed roof build log]]",
      "todo lift the latch twice", "waiting the new hinge pins",
    ]);
    // The live rows, in the outline's order: each job's box is its status.
    expect((await tasks()).slice(4).sort()).toEqual(["done Oil the hinges", "todo Plane the door's bottom edge"]);
    const planeN = String((await tasks()).indexOf("todo Plane the door's bottom edge") + 1);
    const els = ((await app.act({ action: "elements", tile: "test plan", as: "test-agent" })) as any).elements as { n: number; kind: string; label: string }[];
    // Its code span copies as the line's does, and its [[link]] is an element as the line's is.
    expect(els.filter(e => e.label === "code · http://localhost:4175/gate?code=7")).toHaveLength(3);
    expect(els.filter(e => e.kind === "link" && e.label.includes("Shed roof build log"))).toHaveLength(2);
    const sent = written.length;
    const rows = screen().split("\n"), y = rows.findIndex(l => l.includes("open http://localhost:4175/gate?code=7") && l.includes("┊")), x = rows[y]!.indexOf("http://");
    press({ kind: "mouse", action: "down", button: 0, x: x + 3, y }); press({ kind: "mouse", action: "up", button: 0, x: x + 3, y });
    await until(() => written.slice(sent).some(w => w.includes("\x1b]52;")), "the click copied");
    expect(written.slice(sent).filter(w => w.includes("\x1b]52;")).at(-1)).toBe(osc52("http://localhost:4175/gate?code=7"));
    // Keys: into the reader, [ ] to the latch row's box, x through its choices marks it done; the line keeps its words.
    press({ kind: "enter" });
    for (let i = 0; i < 30 && !screen().includes("step [ ] lift the latch twice"); i++) ch("]");
    expect(screen()).toContain("step [ ] lift the latch twice");
    press({ kind: "enter" });
    await until(() => screen().includes("Mark done"), "the choices");
    ch("x");
    await untilAsync(async () => (await board.get(id))!.text.includes("- [x] lift the latch twice\n"), "the latch row ticked");
    // An agent marks the live job done: the job's own status is written, as the agent.
    expect(await app.act({ action: "task.status", tile: "test plan", args: { n: planeN, to: "done" }, as: "test-agent" })).toMatchObject({ status: "done", property: { key: "status", value: "done" } });
    await untilAsync(async () => (await board.get(plane.id))!.text.includes("[status::done]"), "the job's status");
    await untilAsync(async () => (await tasks()).includes("done Plane the door's bottom edge"), "the figure redrawn from the outline");
    // ctrl+z undoes the person's own mark (the agent's stays theirs).
    press({ kind: "char", ch: "z", ctrl: true });
    await untilAsync(async () => (await board.get(id))!.text.includes("- [ ] lift the latch twice\n"), "the undo");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // Put back for the sections after this one.
    const job = (await board.get(plane.id))!;
    await board.update(plane.id, job.text.replace("[status::done]", "[status::todo]"), job.revision!);
    const now = (await board.get(id))!;
    if (now.text !== before) await board.update(id, before, now.revision!);
  }, 40_000);


  test("tabs: a live figure's tabs and density, switched through act, by keys and by click; the note never written", async () => {
    const id = seeded.notes.plotJobs.id, before = (await board.get(id))!.text;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "tabs" }, as: "test-agent" })).toMatchObject({ key: "tabs" });
    await until(() => screen().includes("doing 2 · review 1 · validate 0 · done 1 · queued 2"), "the tab bar", 8000);
    const left = (l: string) => l.slice(S().stageRect.col, S().stageRect.col + Math.floor(S().stageRect.cols / 2));
    const half = () => sc.render(app).lines.map(plain).map(left).join("\n");
    // The first tab listed in order: doing, its rows; the others' rows aren't drawn.
    expect(half()).toContain("PLOT-2 — Sow the broad beans");
    expect(half()).not.toContain("PLOT-4");
    // An agent reads the figures, then switches the left reader's tab (a reader the person isn't typing in).
    const figs = await app.act({ action: "figures", tile: "1", as: "test-agent" }) as any;
    expect(figs.figures).toEqual([expect.objectContaining({ n: 1, kind: "tabs", title: "Plot jobs", density: "compact", tab: "doing" })]);
    expect(figs.figures[0].tabs.map((t: any) => `${t.value} ${t.count}`)).toEqual(["doing 2", "review 1", "validate 0", "done 1", "queued 2"]);
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "queued" }, as: "test-agent" })).toMatchObject({ tab: "queued", count: 2 });
    await until(() => half().includes("PLOT-4 — Order the seed potatoes"), "the queued tab");
    expect(half()).not.toContain("PLOT-2");
    // Only that reader: the other one on the same note still shows doing.
    expect(((await app.act({ action: "figures", tile: "2", as: "test-agent" })) as any).figures[0].tab).toBe("doing");
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "2" }, as: "test-agent" })).toMatchObject({ tab: "review" });
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "nope" }, as: "test-agent" })).rejects.toThrow(/no tab nope; its tabs: 1 doing, 2 review/);
    // element.open on a tab, as an agent, is figure.tab (its rules, its provenance): the right reader's 5th tab.
    const els = await app.act({ action: "elements", tile: "2", as: "test-agent" }) as any;
    const queued = els.elements.find((e: any) => e.kind === "figure" && e.label.startsWith("queued"));
    expect(await app.act({ action: "element.open", tile: "2", args: { n: queued.n }, as: "test-agent" })).toMatchObject({ tab: "queued" });
    expect(await app.act({ action: "figure.tab", tile: "2", args: { tab: "doing" }, as: "test-agent" })).toMatchObject({ tab: "doing" });
    // Density: compact cuts the long title with …; cozy wraps it to two lines, hanging past "PLOT-3 — "; comfortable all of it.
    await until(() => half().includes("PLOT-3 — Mend"), "the review tab");
    expect(half()).toMatch(/PLOT-3 — Mend the netting[^\n]*…/);
    expect(await app.act({ action: "figure.density", tile: "1", args: { to: "cozy" }, as: "test-agent" })).toMatchObject({ density: "cozy" });
    await until(() => half().includes("≡ cozy"), "cozy");
    const hang = () => { const rows = half().split("\n"), i = rows.findIndex(r => r.includes("PLOT-3 — Mend")); return { first: rows[i]!, next: rows[i + 1]!, third: rows[i + 2]! }; };
    let h = hang();
    const textAt = h.first.indexOf("Mend");
    expect(h.next.slice(0, textAt).replace(/[│║┊ ]/g, "")).toBe("");          // the second line starts under "Mend", past the id
    expect(h.next.slice(textAt, textAt + 1)).toMatch(/\S/);
    expect(h.next).toContain("…");
    expect(await app.act({ action: "figure.density", tile: "1", as: "test-agent" })).toMatchObject({ density: "comfortable" });
    await until(() => half().includes("≡ comfortable"), "comfortable");
    h = hang();
    expect(h.third.slice(textAt, textAt + 1)).toMatch(/\S/);
    // The whole title: no … on any of its lines.
    {
      const rows = half().split("\n"), i = rows.findIndex(r => r.includes("PLOT-3 — Mend")), at = rows[i]!.indexOf("PLOT-3");
      const cellOf = (r: string) => { const rest = r.slice(at), end = rest.search(/[┊│]/); return end < 0 ? rest : rest.slice(0, end); };
      const cells: string[] = [];
      for (let j = i; j < rows.length && cellOf(rows[j]!).trim(); j++) cells.push(cellOf(rows[j]!).trim());
      expect(cells.length).toBeGreaterThanOrEqual(3);
      expect(cells.join(" ")).not.toContain("…");
    }
    await expect(app.act({ action: "figure.density", tile: "1", args: { to: "roomy" }, as: "test-agent" })).rejects.toThrow(/compact, cozy, comfortable/);
    // The person, by keys: into the stage (the left reader), [ ] onto the first element (a tab), → and tab step on.
    await app.act({ action: "figure.density", tile: "1", args: { to: "compact" }, as: "test-agent" });
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]");
    press({ kind: "right" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("validate");
    await until(() => half().includes("nothing in validate"), "the empty validate tab, listed in order");
    press({ kind: "tab" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("done");
    press({ kind: "backtab" }); press({ kind: "left" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("review");
    ch("=");
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].density).toBe("cozy");
    // By mouse: a click on the queued label in the left reader's bar.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => left(l).includes("queued 2")), x = left(rows[y]!).indexOf("queued 2") + S().stageRect.col + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => half().includes("PLOT-5 — Clear the bindweed"), "the queued tab, clicked");
    // The person types in the left reader (an edit): an agent's switch there is refused; the right reader's isn't.
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "doing" }, as: "test-agent" })).rejects.toThrow(/isn't typing in/);
    expect(await app.act({ action: "figure.tab", tile: "2", args: { by: 1 }, as: "test-agent" })).toMatchObject({ tab: "review" });
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
    // Every switch was reading state: the note's text is as seeded.
    expect((await board.get(id))!.text).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("figures (mdxcn): every Markdown kind drawn, live ones answered; a figure block's child bullets open their notes by act, keys and mouse", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "figures" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(x => x.key === "figures") + 1, key: "figures" });
    // Each kind, by what its Markdown drew; the live decision and uptime answered from the seeded notes.
    const shown = [
      "● Raised beds", "× Straight into the clay", "○ Grow bags",                       // decision, from Markdown
      "THE PLOT'S DECISIONS (LIVE)", "Netting the whole plot",                          // decision, live
      "> Ada", "Bo", "goes to look",                                                   // chat
      "PHOTO DRIVE BACKUPS (LIVE)", "2026-02-16", "2026-03-11",                         // uptime, live (source: backups)
      "SEEDS SOWN", "March 2026", "[11]", "seed potatoes in",                            // activity, calendar
      "[1] close the tap", "[2] three turns of PTFE tape",                              // annotate
      "— Ada, the allotment newsletter",                                               // a quote's byline
      "BEAN ROWS (CHILD BULLETS)", "May  plant out", "live · child notes",                                    // the figure block's child bullets
    ];
    // The whole note as a reader draws it (`ep0ch show`'s drawing, the surface itself): every kind there.
    // On a connection of its own, as `ep0ch show` from a shell beside the door would be.
    const own = new SocketBoard(scratch.sock);
    await own.info();
    const drawn = (await drawNote(own, seeded.notes.markdownFigures.id, 100))!.map(plain).join("\n");
    for (const m of shown) expect(drawn).toContain(m);
    // Narrow, the timeline of child bullets wraps its note whole (no · cut) with the spine beside it.
    const narrow = (await drawNote(own, seeded.notes.markdownFigures.id, 40))!.map(plain);
    const tlAt = narrow.findIndex(l => l.includes("plant out"));
    expect(tlAt, narrow.join("\n")).toBeGreaterThan(-1);
    expect(narrow.slice(tlAt, tlAt + 3).join("\n")).toMatch(/plant out[\s\S]*│\s+when the nights are warm/);
    const keys = (await drawNote(own, seeded.notes.keys.id, 100))!.map(plain).join("\n");
    own.close();
    for (const m of ["THE READER (FROM THE REGISTRY)", "[e]", "edit", "[g] then [d]", "[ctrl][k]"]) expect(keys).toContain(m);
    // drawNote listened for the door's answers: it never took the door's live connection.
    expect(liveBoard()).toBe((app as any).board);
    // The left reader scrolls: read every element's label instead of the screen for what's below it.
    const els = async () => ((await app.act({ action: "elements", tile: "reader", as: "test-agent" })) as any).elements as { n: number; kind: string; label: string; current?: boolean }[];
    for (let end = Date.now() + 8000; !(await els()).some(e => e.kind === "row" && e.label.includes("plant out")); await Bun.sleep(50))
      if (Date.now() > end) throw new Error("timed out waiting for the figure block's child rows as elements");
    const rows = (await els()).filter(e => e.kind === "row");
    // The live decision's rows and the child bullets are rows; the Markdown ones (no note behind them) aren't.
    expect(rows.map(r => r.label)).toEqual(expect.arrayContaining(["Raised beds for the squash", "sow under glass", "plant out", "first picking"]));
    expect(rows.some(r => r.label === "Raised beds")).toBe(false);
    const may = rows.find(r => r.label === "plant out")!;
    // An agent opens a child bullet's note in another reader (never the person's).
    const opened = await app.act({ action: "element.open", tile: "reader", args: { n: may.n, fresh: true }, as: "test-agent" }) as any;
    expect(JSON.stringify(opened)).toContain("plant out");
    // The person, by keys: into the stage, [ ] to the row, ⏎ opens its note in the reader.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    for (let i = 0; i < (await els()).length && !(await els()).find(e => e.current && e.label === "sow under glass"); i++) ch("]");
    expect((await els()).find(e => e.current)?.label).toBe("sow under glass");
    press({ kind: "enter" });
    await until(() => screen().includes("Apr: sow under glass") && !screen().includes("SQUASH BEDS"), "the child bullet's note open in the reader", 5000);
    // Back (backspace), where the reader was, then by mouse: a click on another child row opens its note.
    press({ kind: "backspace" });
    // Back where it was, the figure block's row on screen (the reader keeps its place).
    const rowAt = () => sc.render(app).lines.map(plain).findIndex(l => /┊ ●  Apr  sow under glass/.test(l));
    await until(() => rowAt() >= 0, "back on the figures note, the child row on screen", 5000);
    const y = rowAt(), x = sc.render(app).lines.map(plain)[y]!.indexOf("sow under glass") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !screen().includes("BEAN ROWS (CHILD BULLETS)"), "the child bullet's note opened by a click", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);
});
