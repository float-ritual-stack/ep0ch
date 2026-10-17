// PIE-533 S3: the showcase's notes that read themselves: `::fields` and `::if` on the vent rail, and one figure on two
// project pages. Driven through act, as an agent drives a door; the harness (harness.ts) seeds a scratch outline.
import { beforeAll, describe, expect, test } from "bun:test";
import { App } from "../../src/app";
import type { Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { fieldsDrawn } from "../../src/site-blocks";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: notes that read themselves", () => {
  const h = useShowcaseScreen();
  const { screen, S } = h;
  let board!: SocketBoard, app!: App, seeded!: Seeded;
  beforeAll(() => { ({ board, app, seeded } = h); void (null as unknown as Showcase); });
  const agent = { as: "test-agent" } as const;
  const stage = (key: string) => { screen(); return S().stage(SECTIONS.findIndex((s: { key: string }) => s.key === key)).top; };

  test("fields-if: ::fields lists the connectTo lines and gains a row on save, ::if draws the body that matches, the row's ¶ anchors its line", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "fields-if" }, ...agent })).toMatchObject({ key: "fields-if" });
    const text = (): string => { screen(); return stage("fields-if").pane("reader")?.render(150, 40, false, stage("fields-if")).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "") ?? ""; };
    await until(() => text().includes("live · 6 occurrences"), "the fields rows", 8000);
    // One key in every form, each row with its line: the header chip (1), two front-matter lines (2, 3: the list is a row each), the inline chip (5) and the line of its own (6).
    expect(text()).toContain("EVERY CONNECTTO IN THIS NOTE");
    for (const [row, line] of [["in the header", 1], ["in the front matter", 2], ["a list", 3], ["is a row each", 3], ["inline in a sentence", 5], ["a line of its own", 6]] as const) {
      expect(text().split("\n").find((l: string) => l.includes(row) && l.includes("∙")) ?? "").toContain(`line ${line}`);
    }
    // The hashtags are the key tag: the header's and the body's.
    await until(() => text().includes("live · 2 occurrences"), "the hashtag rows", 8000);
    expect(text()).toContain("HASHTAGS (KEY TAG)");
    expect(text().split("\n").find((l: string) => l.includes("∙ greenhouse")) ?? "").toContain("line 1");
    expect(text().split("\n").find((l: string) => l.includes("∙ spring")) ?? "").toContain("line 5");
    expect(text()).toContain("drawn only while the note is active");
    expect(text()).not.toContain("drawn only while the note is paused");
    expect(text()).not.toContain("::if");

    // Each row is an element the reader steps to and opens (its line, lit), with its ¶ beside it.
    const elements = async () => ((await app.act({ action: "elements", tile: "reader", ...agent })) as any).elements as { n: number; kind: string; label: string }[];
    const rows = (await elements()).filter(e => e.kind === "row");
    expect(rows.map(r => r.label)).toEqual(expect.arrayContaining(["in the header", "in the front matter", "a list", "is a row each", "inline in a sentence", "a line of its own"]));

    // A click on a row opens its line, front matter included, lit (a person's click; an agent's open leaves the person's focus alone).
    const reader = () => { screen(); return stage("fields-if").pane("reader") as any; };
    const click = (label: string) => {
      const rows = screen().split("\n"), y = rows.findIndex(l => l.includes(`∙ ${label}`)), x = rows[y]!.indexOf(label);
      h.press({ kind: "mouse", action: "down", button: 0, x: x + 1, y }); h.press({ kind: "mouse", action: "up", button: 0, x: x + 1, y });
    };
    click("in the front matter");
    await until(() => reader().surface?.focusMark?.line === true && reader().surface.focusMark.spec.line === 2, "the front-matter line marked");
    // Not drawn in the note, so the door says where it is instead of lighting nothing.
    await until(() => String((app as any).message).includes("front-matter property"), "the front-matter line said");
    click("a line of its own");
    await until(() => reader().surface?.focusMark?.line === true && reader().surface.focusMark.spec.line === 6, "the body line lit");

    // A third line saved: a row appears, on its own.
    const rail = (await board.get(seeded.notes.fieldsRail.id))!;
    await board.update(rail.id, rail.text.replace("\n::fields{key=connectTo", "\n- third pass [connectTo::trust the drift]\n::fields{key=connectTo"), rail.revision!);
    await until(() => text().includes("trust the drift") && text().includes("live · 7 occurrences"), "the third row", 8000);

    // A front-matter row's ¶ is refused: an anchor there would become part of the property's value.
    await expect(app.act({ action: "fields.anchor", tile: "reader", args: { key: "connectTo", n: 2 }, ...agent })).rejects.toThrow(/front-matter property/);

    // The anchor is explicit: drawing wrote nothing, then the ¶ on the second row gives that line an anchor.
    const before = (await board.get(rail.id))!;
    expect(before.text).not.toMatch(/\^[a-z0-9-]+\s*$/m);
    const anchored = await app.act({ action: "fields.anchor", tile: "reader", args: { key: "connectTo", n: 6 }, ...agent }) as any;
    expect(anchored.created).toBe(true);
    expect(typeof anchored.noteLine).toBe("number");
    expect(anchored.link).toBe(`((${rail.id}^${anchored.anchor}))`);
    const after = (await board.get(rail.id))!;
    // The second row's own line (not the first's), found by what it says.
    const anchoredLine = after.text.split("\n").find(l => l.includes(`^${anchored.anchor}`))!;
    expect(anchoredLine).toContain("a line of its own");
    expect(after.text.split("\n").filter(l => /\^[a-z0-9-]+$/.test(l))).toHaveLength(1);
    expect(after.text.split("\n")[anchored.noteLine - 1]).toContain(`^${anchored.anchor}`);
    // Again, once the list has been read from the anchored text: already anchored, nothing more written.
    await until(() => { screen(); const d = fieldsDrawn(rail.id, "connectTo"); return "found" in d && d.found.revision === after.revision; }, "the list read again", 8000);
    expect(await app.act({ action: "fields.anchor", tile: "reader", args: { key: "connectTo", n: 6 }, ...agent })).toMatchObject({ created: false, anchor: anchored.anchor });
    await expect(app.act({ action: "fields.anchor", tile: "reader", args: { key: "connectTo", n: 9 }, ...agent })).rejects.toThrow(/has rows 1 to/);

    // The other body: the note paused.
    const now = (await board.get(rail.id))!;
    await board.update(rail.id, now.text.replace("[status::active]", "[status::paused]"), now.revision!);
    await until(() => text().includes("drawn only while the note is paused") && !text().includes("drawn only while the note is active"), "the paused body", 8000);
    // The clicks put the person in the section; back on the index, an agent can move again.
    for (let i = 0; i < 4 && S().focus === "stage"; i++) h.press({ kind: "esc" });
  }, 40_000);

  test("page-figure: the same figure on two project pages lists each page's own tickets", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "page-figure" }, ...agent })).toMatchObject({ key: "page-figure" });
    const drawn = (name: string) => { screen(); const t = stage("page-figure"); return (t.pane(name)?.render(100, 40, false, t).lines.join("\n") ?? "").replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, ""); };
    await until(() => drawn("lego").includes("Sort the bricks") && drawn("garden").includes("Water the beans"), "both pages' tickets", 8000);
    expect(drawn("lego")).toContain("Build the tower");
    expect(drawn("lego")).not.toContain("Water the beans");
    expect(drawn("garden")).toContain("Order the seed potatoes");
    expect(drawn("garden")).not.toContain("Sort the bricks");
  }, 30_000);
});
