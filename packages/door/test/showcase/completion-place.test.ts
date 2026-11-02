// The completion placement section (PIE-1511): the sowing calendar's edit with [[sow- typed on Bed 1. The matches drop
// under the cursor with the preview beside them (A); lower down, where they won't fit, a sheet along the bottom (B);
// near the bottom, above the cursor. Walked at 200 and 44 columns, by act, keys and the mouse. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { completerOf, completionOf } from "../../src/surface/completer";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe("showcase: completion placement (PIE-1511)", () => {
  const h = useShowcaseScreen(200);
  const { press, S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const d = () => stage().pane("calendar").surface.draft;
  const pop = () => (d() ? completionOf(d()) : null);
  const layout = () => (d() ? completerOf(d())?.drawn?.layout : undefined);
  const rows = (cols: number) => { h.app.t.cols = cols; return h.sc.render(h.app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "")); };
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, args, tile: "calendar" }, { kind: "user" });
  const settled = async () => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 5, "the sowing weeks", 8000); return pop()!; };
  /** The popup's own lines: from the row whose frame starts at its column to the row it ends on. */
  const popupLines = (lines: string[]) => {
    const at = completerOf(d()!)!.drawn!, top = lines.findIndex(l => /» (sow-wk\d+ · )?Sowing week/.test(l));
    const start = lines.slice(0, top).findLastIndex(l => /┌─/.test(l)), end = lines.findIndex((l, i) => i > top && /└─/.test(l));
    return { start, end, lines: lines.slice(start, end + 1), at };
  };
  /**
   * The popup's own columns, for a snapshot: the frame's left edge to its width, with what the lookup's order decides
   * (which week is lit, its crop, its stage) made the same every run. The layout is what's compared.
   */
  const crops = /broad beans|sweet peas|leeks|lettuce|beetroot|runner beans|carrots|chard|kale|spinach|radish|garlic/g;
  const same = (m: string) => "~".repeat(m.length);
  const shape = (lines: string[], col: number, cols: number) => lines.map(l => l.slice(col, col + cols).replace(/\d/g, "#").replace(crops, same).replace(/\b(done|planned)\b/g, same)).join("\n");
  /** Ask at line `n` of the draft, [[sow- typed at its end; the line asked at before is put back first (one undo). */
  let base = "";
  const askAt = async (n: number, typed = "[[sow-") => {
    await act("complete.dismiss").catch(() => {});
    base ||= d()!.text;
    for (let i = 0; i < 3 && d()!.text !== base; i++) await act("draft.undo");
    expect(d()!.text).toBe(base);
    await act("draft.place", { line: n });
    if (n !== 5 || typed !== "[[sow-") await act("draft.paste", { text: typed });
    await act("complete.ask");
    return settled();
  };

  test("A under the cursor, B as a sheet lower down, above it near the bottom; at 200 and 44 columns", async () => {
    await h.app.act({ action: "section", args: { name: "completion-place" }, as: "test-agent" });
    await until(() => marks["completion-place"]!.every(m => h.screen().includes(m)), "the completion-place section", 8000);
    await settled();
    press({ kind: "enter" });
    for (const cols of [200, 44]) {
      // A, opened by the stage on Bed 1: under the caret's line, at its column, only as tall as its rows.
      if (cols === 44) await askAt(5);
      await until(() => rows(cols).some(l => l.includes("What goes in the cold")), "the lit week's note in the preview", 8000);
      let lines = rows(cols);
      expect(layout()).toBe("below");
      const caret = lines.findIndex(l => l.includes("Bed 1: plan [[sow-"));
      let p = popupLines(lines);
      expect(p.start).toBe(caret + 1);
      expect(p.lines.join("\n")).not.toContain("↑↓");                     // the key hints are the status bar's
      expect(lines.filter((_, i) => i < p.start || i > p.end).join("\n")).toContain("↑↓ move");
      expect(p.lines.at(-2)).toMatch(/pages \d+\/\d+/);                   // the status row, last
      if (cols === 200) {
        // The preview is a real column beside the rows, and the popup is no wider than they are.
        const row = p.lines.find(l => /» sow-wk\d+ · Sowing week/.test(l))!;
        expect(row).toMatch(/» sow-wk\d+ · Sowing week \d+.*│ /);
        expect(p.lines.some(l => /sow-wk\d+.*│ .*What goes in the cold/.test(l) || /[│█] +│ .*What goes in the cold/.test(l))).toBe(true);
        expect(p.at.cols!).toBeLessThan(cols - 40);
      }
      const left = p.lines[0]!.indexOf("┌─  ");
      expect(shape(p.lines, left, p.at.cols!)).toMatchSnapshot(`A at ${cols}`);
      // ((Sowing week lower down: its rows are two lines each (the note and where it is), so the list is taller than a
      // third of the screen. Where it won't fit under the caret: the sheet along the bottom at 200 (list left, preview
      // right), and near the bottom it goes above the caret. At 44 a sheet has no room for the preview beside: A above.
      const seen: string[] = [];
      for (let n = 6; n <= 44; n += 2) {
        await askAt(n, "((Sowing week");
        rows(cols);
        if (seen.at(-1) !== layout()) seen.push(layout()!);
        if (layout() === "sheet" && cols === 200 && !seen.includes("snapped")) {
          lines = rows(cols);
          const top = lines.findIndex(l => /references \d+\/\d+ +\(\(Sowing week▌/.test(l));
          expect(top).toBeGreaterThan(0);
          const sheet = lines.slice(top - 1, lines.findIndex((l, i) => i > top && /└─/.test(l)) + 1);
          expect(sheet.length).toBeLessThanOrEqual(Math.ceil(lines.length / 3) + 2);
          expect(sheet.find(l => /» Sowing week/.test(l))).toMatch(/» Sowing week \d+ .*│ /);
          expect(lines.slice(0, top - 1).some(l => l.includes("plan ((Sowing week"))).toBe(true);   // the caret's line is above the sheet
          expect(shape(sheet, sheet[0]!.indexOf("┌─  "), cols)).toMatchSnapshot("B at 200");
          seen.push("snapped");
        }
      }
      const order = seen.filter(s => s !== "snapped");
      expect(order[0]).toBe("below");
      expect(order.at(-1)).toBe("above");
      if (cols === 200) expect(order).toContain("sheet");
      else expect(order).not.toContain("sheet");
      // Above the caret, the popup ends on the row over the caret's: the typing stays in view (at 44 the line wraps,
      // and the caret is on its last row).
      lines = rows(cols);
      p = popupLines(lines);
      expect(lines[p.end + 1]).toMatch(/║ +(- Bed \d+: plan \(\()?(Sowing )?week /);
    }
  }, 120_000);

  test("the mouse: a click lights a row and previews it, a second click inserts, the wheel moves", async () => {
    h.app.t.cols = 200;
    const p = await askAt(5);
    const lines = rows(200);
    const index = p.items.findIndex((it, i) => i !== p.index && it.address === "sow-wk3");
    const y = lines.findIndex(l => l.includes("Sowing week 3") && l.includes("page"));
    const x = lines[y]!.indexOf("Sowing week 3") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    expect(pop()!.index).toBe(index);
    expect(d()!.lines[4]).toBe("- Bed 1: plan [[sow-");
    await until(() => rows(200).some(l => l.includes("cold frame in week 3")), "the clicked row's preview", 8000);
    press({ kind: "mouse", action: "wheel-down", button: 0, x, y });
    expect(pop()!.index).toBe(index + 1);
    press({ kind: "mouse", action: "wheel-up", button: 0, x, y });
    expect(pop()!.index).toBe(index);
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => d()!.lines[4] === "- Bed 1: plan [[sow-wk3]]" && !pop(), "the second click inserts", 8000);
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);
});
