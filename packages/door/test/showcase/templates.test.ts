// PIE-533 S4: the showcase screen's "Templates": one template used live on three pages (`this` is each page), the mistakes
// a call can make said where they are, a missing prop asked for and written onto the line, and the daily note stamped as a
// new note beside it. Driven through `act`, as an agent drives a door; the harness (harness.ts) seeds a scratch outline.
import { beforeAll, describe, expect, test } from "bun:test";
import { App } from "../../src/app";
import type { Seeded } from "../../src/showcase/seed";
import { SECTIONS } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
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
    return strip(pane?.render(100, 40, false, stage()).lines.join("\n") ?? "");
  });

  test("one template on three pages: this is each page, the figure lists each page's own actions, the mistakes are said where they are", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "templates" }, ...agent })).toMatchObject({ key: "templates" });
    await until(() => readers().every(t => t.includes("Filed on")) && readers().slice(0, 2).every(t => /met \w+, mood/.test(t)), "the three pages drawn", 12_000);
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
    expect(unfinished).toContain("needs with");
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
  }, 30_000);
});
