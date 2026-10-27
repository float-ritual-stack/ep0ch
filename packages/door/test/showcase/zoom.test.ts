// The zoom section (PIE-780): a figure, a table and a heading's section of one long note each fill the reader, by act, by
// W and by a click on the ⤢ at its right edge; esc, back and a click on the zoom's row come back to the whole note as it
// was, and forward zooms in again. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: zoom (PIE-780)", () => {
  const h = useShowcaseScreen(160);
  const as = "test-agent";
  const stage = () => h.S().stages.get(h.S().sel).top;
  const reader = () => stage().pane("plan").surface;
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, args, tile: "plan" }, USER) as Promise<any>;
  const click = (x: number, y: number) => { h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never); };
  const open = async () => {
    // Each test starts on the whole note, its keys in the stage.
    if (h.S().focus === "stage" && reader().zoom) await act("element.zoom", { on: false });
    if (h.S().focus !== "stage") await h.app.act({ action: "section", args: { name: "zoom" }, as });
    await until(() => marks.zoom!.every(m => h.screen().includes(m)), `the zoom section: ${marks.zoom!.filter(m => !h.screen().includes(m)).join(" | ")}`, 15_000);
    await until(() => h.screen().includes("Prune the Bramley"), "the figure's rows", 15_000);
    if (h.S().focus !== "stage") h.press({ kind: "enter" } as never);
    expect(h.S().focus).toBe("stage");
  };

  test("act zooms into the figure, its rows still open notes; esc comes back as it was; forward zooms in again", async () => {
    await open();
    const plan = h.seeded.notes.zoomPlan;
    await act("scroll", { by: 3 });
    const scrolled = reader().scroll;
    const r = await act("element.zoom", { line: 4 });
    expect(r.zoomed).toMatchObject({ kind: "component", label: "Winter jobs", lines: [4, 9] });
    await until(() => !h.screen().includes("Pruning"), "only the figure", 8000);
    const zoomed = h.screen();
    expect(zoomed).toContain("WINTER JOBS");
    expect(zoomed).toContain("Prune the Bramley");
    expect(zoomed).toContain(`⤢ Winter jobs · in ${plan.text.split("\n")[0]}`);
    expect(zoomed).not.toContain("Egremont");
    // Interactive at full size: a row of the figure is still an element that opens its note.
    const rows = await act("elements");
    expect(JSON.stringify(rows)).toContain("Prune the Bramley");
    // Esc: the whole note, scrolled where it was.
    h.press({ kind: "esc" } as never);
    await until(() => h.screen().includes("Pruning"), "the whole note again", 8000).catch(e => { console.log(h.screen(), h.S().focus, JSON.stringify(reader().describe?.()?.elements)); throw e; });
    expect(reader().zoom).toBeNull();
    expect(reader().scroll).toBe(scrolled);
    // Forward: zoomed in again.
    await act("forward");
    await until(() => !!reader().zoom && !h.screen().includes("Pruning"), "zoomed in again", 8000);
    await act("element.zoom", { on: false });
    await until(() => h.screen().includes("Pruning"), "the whole note", 8000);
  }, 90_000);

  test("a click on the table's ⤢ zooms into the table; a click on the zoom's row comes back", async () => {
    await open();
    await act("scroll", { to: "top" });
    await until(() => h.screen().includes("Egremont"), "the table on screen", 8000);
    const lines = h.screen().split("\n");
    const y = lines.findIndex((l, i) => l.includes("⤢") && (lines[i + 1] ?? "").includes("rootstock"));
    expect(y).toBeGreaterThan(0);
    click(lines[y]!.indexOf("⤢"), y);
    await until(() => reader().zoom?.kind === "paragraph" && !h.screen().includes("WINTER JOBS"), "only the table", 8000);
    expect(h.screen()).toContain("Conference");
    expect(h.screen()).not.toContain("Pruning");
    expect(h.screen()).toContain("⤢ table · tree, rootstock, prune · in Orchard winter plan");
    const now = h.screen().split("\n"), bar = now.findIndex(l => l.includes("· in Orchard winter plan ·"));
    expect(bar).toBeGreaterThan(0);
    click(now[bar]!.indexOf("⤢") + 2, bar);
    await until(() => !reader().zoom && h.screen().includes("Pruning"), "the whole note again", 8000);
  }, 60_000);

  test("W zooms into the heading's section the [ ] position is on, down to the next heading", async () => {
    await open();
    await act("fold.select", { by: 1 });
    h.ch("W");
    await until(() => reader().zoom?.kind === "heading", "the section zoomed", 8000)
      .catch(e => { console.log(h.screen(), JSON.stringify(reader().zoom)); throw e; });
    const shown = h.screen();
    expect(reader().zoom!.label).toBe("Pruning");
    expect(shown).toContain("leave the plums until summer");
    expect(shown).not.toContain("Next spring");
    expect(shown).not.toContain("WINTER JOBS");
    await act("back");
    await until(() => !reader().zoom, "back to the whole note", 8000);
  }, 60_000);

  test("refused, nothing moved: a line in no part, and an agent on the reader the person has focused", async () => {
    await open();
    await expect(act("element.zoom", { line: 3 })).rejects.toThrow("in no part");
    expect(reader().zoom).toBeNull();
    await expect(stage().dispatch.act({ action: "element.zoom", args: { line: 4 }, tile: "plan" }, { kind: "agent", id: "test-agent" })).rejects.toThrow();
    expect(reader().zoom).toBeNull();
  }, 60_000);
});
