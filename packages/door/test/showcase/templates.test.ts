// PIE-533 S4: the showcase screen's "Templates": one template used live on three pages (`this` is each page), the mistakes
// a call can make said where they are, a missing prop asked for and written onto the line, and the daily note stamped as a
// new note beside it. Driven through `act`, as an agent drives a door; the harness (harness.ts) seeds a scratch outline.
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { beforeAll, describe, expect, test } from "bun:test";
import { App } from "../../src/app";
import type { Seeded } from "../../src/showcase/seed";
import { SECTIONS } from "../../src/showcase/showcase";
import { SocketBoard, USER } from "../../src/socket";
import type { Desk } from "../../src/desk/desk";
import type { ReaderPane } from "../../src/desk/panes";
import { ITEM_BG, RULER_BG } from "../../src/surface/selection";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: templates (PIE-533 S4)", () => {
  const h = useShowcaseScreen();
  const { screen, S } = h;
  let board!: SocketBoard, app!: App, seeded!: Seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });
  const agent = { as: "test-agent" } as const;
  const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
  const stage = () => { screen(); return S().stage(SECTIONS.findIndex((s: { key: string }) => s.key === "templates")).top; };
  const readers = () => (["sowing", "potting", "unfinished"] as const).map(name => {
    const pane = stage().pane(name);
    // One run of words: the region's gutter and where a line wraps are the width's, not what is said.
    return strip(pane?.render(100, 40, false, stage()).lines.join("\n") ?? "").replace(/\s*▌\s*/g, " ").replace(/\s+/g, " ");
  });

  test("one template on three pages: this is each page, the figure lists each page's own actions, the mistakes are said where they are", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "templates" }, ...agent })).toMatchObject({ key: "templates" });
    await until(() => readers().every(t => t.includes("Filed on")) && readers().slice(0, 2).every(t => /met \w+, mood/.test(t)) && readers()[2]!.includes("no prop with was passed"), "the three pages drawn", 12_000);
    const [sowing, potting, unfinished] = readers();
    expect(sowing).toContain("met Ada, mood good");        // the default
    expect(sowing).toContain("Filed on Sowing meeting.");
    expect(potting).toContain("met Jay, mood meh");
    expect(potting).toContain("Filed on Potting meeting.");
    expect(sowing).toMatch(/: met Ada/);
    // The default date is a path read where the template is used: today.
    expect(sowing).toMatch(/\d{4}-\d\d-\d\d.* met Ada/s);
    // The figure over this: each page lists its own project's actions.
    await until(() => readers()[0]!.includes("Prune the roses") && readers()[1]!.includes("Pot up the tomatoes"), "the figures", 12_000);
    expect(readers()[0]).toContain("Sow the carrots");
    expect(readers()[0]).not.toContain("Pot up the tomatoes");
    expect(readers()[1]).not.toContain("Prune the roses");
    // The call's mistakes are said where they are, with the nearest name; a prop it needs is an offer.
    expect(unfinished).toContain("Meeting note template has no prop `wiht`; did you mean `with`?");
    expect(unfinished).toContain("{{props.with}} · no prop with was passed");
    expect(unfinished).toContain("mood=gud isn't one of good, meh, rough; did you mean");
    expect(unfinished).toContain("needs with [fill it in]");
    // Nothing was written to draw any of it.
    expect((await board.get(seeded.notes.meetingSowing.id))!.text).toContain("::use{of=[[meeting-template]] with=Ada date=2026-10-14}");
  }, 40_000);

  test("a prop the call leaves out is given by use.fill (an agent names it), the line says it, the template draws it, and use.undo takes it back", async () => {
    const page = seeded.notes.meetingUnfinished;
    const fill = (args: Record<string, unknown>) => app.act({ action: "use.fill", tile: "unfinished", args, ...agent }) as Promise<any>;
    // An agent is never asked: it names the prop, or is told how.
    await expect(fill({})).rejects.toThrow(/needs with: use\.fill line=\d+ with=/);
    const done = await fill({ with: JSON.stringify({ with: "Kit", mood: "meh" }) });
    expect(done.wrote).toEqual({ with: "Kit", mood: "meh" });
    const after = (await board.get(page.id))!;
    expect(after.text).toContain("::use{of=[[meeting-template]] wiht=Kit with=Kit mood=meh}");
    await until(() => readers()[2]!.includes("met Kit, mood meh"), "the page drawn with the prop", 12_000);
    // Undone, the line is as it was.
    expect(await app.act({ action: "use.undo", tile: "unfinished", ...agent })).toMatchObject({ block: page.id });
    expect((await board.get(page.id))!.text).toContain("::use{of=[[meeting-template]] mood=gud wiht=Kit}");
  }, 40_000);

  test("use.fill with block= writes the line of the note the call is written in, not the note shown (a call inside an embed or a template)", async () => {
    const inner = await board.createBlock(null, "Embedded call\n::use{of=[[meeting-template]]}", { kind: "agent", id: "test-agent" });
    const shown = (await board.get(seeded.notes.meetingUnfinished.id))!;
    const done = await app.act({ action: "use.fill", tile: "unfinished", args: { block: inner.id, line: 2, with: JSON.stringify({ with: "Zed" }) }, ...agent }) as any;
    expect(done).toMatchObject({ block: inner.id, wrote: { with: "Zed" } });
    expect((await board.get(inner.id))!.text).toContain("::use{of=[[meeting-template]] with=Zed}");
    // The note shown is as it was.
    expect((await board.get(shown.id))!.text).toBe(shown.text);
    // A value the line can't hold is refused, nothing written.
    await expect(app.act({ action: "use.fill", tile: "unfinished", args: { block: inner.id, line: 2, with: JSON.stringify({ mood: "a}b" }) }, ...agent })).rejects.toThrow(/can't be written on line 2/);
  }, 30_000);

  test("template.stamp writes today's daily note under Daily notes: now filled, this and parent left to read where it lands", async () => {
    const out = await app.act({ action: "template.stamp", args: { of: "[[daily-template]]", as: "new", parent: "[[daily notes]]", title: "{{now.date}}" }, ...agent }) as any;
    expect(out.stamped).toHaveLength(1);
    const made = (await board.get(out.stamped[0].id))!;
    expect(made.parentId).toBe(seeded.notes.dailyNotes.id);
    expect(made.text).toMatch(/^\d{4}-\d\d-\d\d \[type::daily\] \[from-template::/);
    expect(made.text).toContain("in {{parent.title}}; its owner is {{owner}}.");
    // Read where it landed, the braces answer for that note.
    const read = await board.siteAnswer(made.id);
    expect(read.values.map(v => v.values?.[0])).toEqual(["Daily notes", "Ada"]);
    const target = seeded.notes.dailyNotes.id;
    await app.act({ action: "template.stamp", args: { of: "[[daily-template]]", into: `((${target}^log))`, freeze: "all" }, ...agent });
    const region = findOutputRegions((await board.get(target))!.text)[0]!;
    expect(region.body).toContain("its owner is Ada");
    expect(region.body).not.toContain("{{");
    expect(region.edited).toBe(false);
  }, 30_000);

  test("PIE-1492: a template day plan steps by headings and figure rows, with working tabs and density", async () => {
    await app.dispatch.act({ action: "section", args: { name: "template-steps" } }, USER);
    await until(() => screen().includes("morning 1"), "the template's live jobs", 12_000);
    const desk = S().stages.get(S().sel).top as Desk;
    const reader = desk.pane("plan") as ReaderPane;
    const current = () => { screen(); return reader.surface.describeElements().find(e => e.current); };
    const stepTo = (label: string) => {
      for (let i = 0; i < 30; i++) { h.ch("]"); if (current()?.label.startsWith(label)) return current(); }
      expect(current()?.label).toStartWith(label);
    };
    const click = (text: string) => {
      const rows = screen().split("\n"), y = rows.findIndex(row => row.includes(text));
      expect(y).toBeGreaterThan(-1);
      const x = rows[y]!.indexOf(text);
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    h.press({ kind: "enter" });
    expect(stepTo("Morning")?.kind).toBe("fold");
    for (const [key, label] of [[")", "Evening"], [")", "After the plan"], ["(", "Evening"], ["(", "Morning"]]) {
      h.ch(key!);
      expect(current()).toMatchObject({ kind: "fold", label });
    }
    const { folds } = await desk.dispatch.press("folds", {}, "plan") as { folds: { n: number; text: string; line: number }[] };
    const evening = folds.find(f => f.text === "Evening")!;
    await expect(desk.dispatch.act({ action: "fold", tile: "plan", args: { line: evening.line } }, { kind: "agent", id: "test-agent" })).rejects.toThrow("pass n= from folds");
    expect(await desk.dispatch.act({ action: "fold", tile: "plan", args: { n: evening.n } }, { kind: "agent", id: "test-agent" })).toMatchObject({ text: "Evening", line: 3, folded: true });
    expect(screen()).not.toContain("Leave the tools");
    expect(screen()).toContain("Carry the seed trays");
    await desk.dispatch.act({ action: "unfold", tile: "plan", args: { n: evening.n } }, { kind: "agent", id: "test-agent" });
    expect(h.sc.render(app).lines.find(row => row.includes("Leave the tools"))).not.toContain(RULER_BG);
    click("≡ ");
    await until(() => current()?.label === "Day plan sections", "the gutter mark selects the template's source");
    expect(screen()).toContain("morning 1");
    stepTo("Morning");
    h.press({ kind: "enter" });
    await until(() => !screen().includes("Carry the seed trays"), "the template's Morning section folds");
    h.ch(")");
    expect(current()).toMatchObject({ kind: "fold", label: "Evening" });
    h.ch("(");
    expect(current()).toMatchObject({ kind: "fold", label: "Morning" });
    h.press({ kind: "enter" });
    await until(() => screen().includes("morning 1"), "the template's Morning section unfolds");
    expect(stepTo("morning 1")?.kind).toBe("figure");
    h.ch(")");
    expect(current()).toMatchObject({ kind: "fold", label: "Evening" });
    h.ch("(");
    stepTo("morning 1");
    h.press({ kind: "tab" });
    await until(() => screen().includes("Water the beans"), "Tab switches the template's jobs");
    h.press({ kind: "backtab" });
    await until(() => !screen().includes("Water the beans"), "Shift+Tab returns to morning");
    h.press({ kind: "right" });
    await until(() => screen().includes("Water the beans"), "Right switches to afternoon");
    h.press({ kind: "left" });
    await until(() => !screen().includes("Water the beans"), "Left returns to morning");
    expect(stepTo("≡ cozy")?.kind).toBe("figure");
    h.press({ kind: "enter" });
    await until(() => screen().includes("≡ comfortable"), "Enter changes density inside the template");
    click("≡ comfortable");
    await until(() => screen().includes("≡ compact"), "the density control answers a click");
    expect(stepTo("Carry the seed trays")?.kind).toBe("row");
    click("afternoon 1");
    await until(() => screen().includes("Water the beans"), "a mouse click switches tabs");
    expect(stepTo("row 1 · Day details")?.kind).toBe("figure");
    expect(screen()).toContain("beside the blue gate.");
    h.press({ kind: "enter" });
    expect(stepTo("Evening")?.kind).toBe("fold");
    expect(screen()).toContain("beside the blue gate.");
    await desk.dispatch.press("figure.row", { figure: "Day details", row: 1, open: false }, "plan");
    expect(screen()).not.toContain("beside the blue gate.");
    click("▸ Carry the seed trays");
    await until(() => screen().includes("beside the blue gate."), "a click expands the template's table row");
    stepTo("Evening");
    h.ch("]");
    expect(current()).toMatchObject({ kind: "fold", label: "After the plan" });
    h.ch("[");
    expect(current()).toMatchObject({ kind: "fold", label: "Evening" });
    await desk.dispatch.press("figure.tab", { tab: "afternoon" }, "plan");
    expect(stepTo("Water the beans")?.kind).toBe("row");
    h.press({ kind: "enter" });
    await until(() => reader.surface.msg?.text.startsWith("Water the beans") === true, "Enter opens the template's job");
    expect((await board.get(seeded.notes.templatePlan.id))!.text).toBe(seeded.notes.templatePlan.text);
  }, 30_000);

  test("a selected figure in a template tints only its own rows, leaving prose and the other figure alone", async () => {
    const template = await board.createBlock(null, `Two reminders [type::template]

Before the reminders.

::graph-tabs
---
title: Morning reminder
query: type=day-plan-job day=2026-10-14
group: slot
order: [morning, afternoon]
columns: [title]
lines: 1
---
::

Between the reminders.

::graph-table
---
title: Evening reminder
headers: [Task]
rows: [["Close the greenhouse"]]
---
::

After the reminders.`, { kind: "agent", id: "test-agent" });
    const page = await board.createBlock(null, `Garden reminders\n\n::use{of=((${template.id}))}`, { kind: "agent", id: "test-agent" });
    await app.dispatch.act({ action: "section", args: { name: "template-steps" } }, USER);
    const desk = S().stages.get(S().sel).top as Desk;
    await desk.dispatch.press("open", { id: page.id }, "plan");
    await until(() => { const text = screen(); return text.includes("Close the greenhouse") && text.includes("Carry the seed trays"); }, "both template figures", 12_000);
    await app.dispatch.act({ action: "section.try" }, USER);
    const reader = desk.pane("plan") as ReaderPane;
    const current = () => { screen(); return reader.surface.describeElements().find(e => e.current); };
    for (let i = 0; i < 30 && !current()?.label.startsWith("Carry the seed trays"); i++) h.ch("]");
    expect(current()).toMatchObject({ kind: "row", label: expect.stringContaining("Carry the seed trays") });
    const rows = h.sc.render(app).lines;
    const row = (text: string) => { const line = rows.find(l => strip(l).includes(text)); expect(line).toBeDefined(); return line!; };
    expect(row("Carry the seed trays")).toContain(ITEM_BG);
    expect(row("morning 1")).toContain(RULER_BG);
    for (const text of ["Before the reminders.", "Between the reminders.", "Close the greenhouse", "After the reminders."])
      expect(row(text)).not.toContain(RULER_BG);
  }, 30_000);

  test("PIE-1492: previewing a list in one template call leaves the other call expanded", async () => {
    await board.createBlock(null, "Tray list [page::tray-list] [type::template]\n[form-field::time text required]\n\n- Seed packet\n  - Prepare the {{props.time}} tray", { kind: "agent", id: "test-agent" });
    const page = await board.createBlock(null, "Two trays\n\n::use{of=[[tray-list]] time=morning}\n\n::use{of=[[tray-list]] time=evening}", { kind: "agent", id: "test-agent" });
    await app.dispatch.act({ action: "section", args: { name: "template-steps" } }, USER);
    const desk = S().stages.get(S().sel).top as Desk;
    await desk.dispatch.press("open", { id: page.id }, "plan");
    await until(() => screen().includes("Prepare the morning tray") && screen().includes("Prepare the evening tray"), "both template lists", 12_000);
    await app.dispatch.act({ action: "section.try" }, USER);
    const reader = desk.pane("plan") as ReaderPane;
    h.ch(")");
    screen();
    expect(reader.surface.describe().folds?.selected).toBe("- Seed packet");
    const rows = screen().split("\n"), y = rows.findIndex(row => row.includes("Seed packet"));
    const x = rows[y]!.indexOf(" p", rows[y]!.indexOf("Seed packet") + "Seed packet".length) + 1;
    expect(x).toBeGreaterThan(0);
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => { screen(); return !!reader.surface.describe().folds?.folded.length; }, "the selected list enters preview", 1000);
    const { folds } = await desk.dispatch.press("folds", {}, "plan") as { folds: { text: string; folded: boolean }[] };
    expect(folds.filter(f => f.text === "Seed packet").map(f => f.folded)).toEqual([true, false]);
    expect(screen()).toContain("Prepare the evening tray");
    expect((await board.get(page.id))!.text).toBe(page.text);
  }, 30_000);
});
