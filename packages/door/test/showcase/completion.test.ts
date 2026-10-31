// The completion section (PIE-1339): a comment ending in ((Gree with its popup open; each row says its kind at the
// right edge with a dim detail, the lit row's docs wrap beside the list at 120 columns and under it at 80, and the
// popup's keys are actions: the person's keys and `act` run the same ones. Scratch service, fictional notes.
import { describe, expect, test } from "bun:test";
import { completionOf } from "../../src/surface/completer";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("showcase: completion (PIE-1339)", () => {
  const h = useShowcaseScreen(120);
  const { press, screen, S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const d = () => stage().pane("guide").surface.session?.composer;
  const pop = () => (d() ? completionOf(d()) : null);
  const settled = async (what: string) => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 1, what, 8000); return pop()!; };
  const rows = (cols: number) => { h.app.t.cols = cols; return h.sc.render(h.app).lines.map(plain); };

  test("the popup reads and inserts the same at 120 and 80 columns, through keys, mouse and act (PIE-1478)", async () => {
    await h.app.act({ action: "section", args: { name: "completion" }, as: "test-agent" });
    await until(() => marks.completion!.every(m => screen().includes(m)), "the completion section", 8000);
    await settled("the initial popup");
    press({ kind: "enter" });
    const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, args, tile: "guide" }, { kind: "user" });
    const ask = async () => {
      await act("comment.write", { body: "Ask about the beds, see ((Gree" });
      await act("complete.ask");
      const p = await settled("reference rows");
      await act("complete.move", { by: p.items.findIndex(i => i.blockId === h.seeded.notes.meeting.id && !i.fragmentId) - p.index });
      await until(() => !!pop()?.items[pop()!.index]?.preview, "the selected note's docs", 8000);
      return p;
    };
    for (const cols of [120, 80]) {
      h.app.t.cols = cols;
      let p = await ask();
      let lines = rows(cols);
      const header = lines.findIndex(l => l.includes("references "));
      const end = lines.findIndex((l, i) => i > header && l.includes("↑↓"));
      expect(lines.slice(header - 1, end + 2).join("\n")).toMatchSnapshot(`reference popup at ${cols}`);
      if (cols === 120) expect(p.previewRect!.col).toBeGreaterThanOrEqual(p.listWidth!);
      else { expect(p.previewRect!.col).toBeLessThanOrEqual(1); expect(p.previewRect!.row).toBeGreaterThan(2); }
      const text = d()!.text, first = p.index;
      press({ kind: "char", ch: "n", ctrl: true });
      expect(pop()!.index).toBe(first + 1);
      press({ kind: "char", ch: "p", ctrl: true });
      expect(pop()!.index).toBe(first);
      expect(d()!.text).toBe(text);
      await expect(stage().dispatch.act({ action: "complete.move", args: { by: 1 }, tile: "guide" }, { kind: "agent", id: "test-agent" })).rejects.toThrow("the person is typing in this draft");
      const before = rows(cols).join("\n");
      await act("complete.docs", { by: 1 });
      expect(rows(cols).join("\n")).not.toBe(before);
      for (const kind of ["tab", "enter"] as const) {
        p = await ask();
        const insertion = p.items[p.index]!.insertion;
        press(kind === "enter" ? { kind: "enter" } : { kind: "tab" });
        await until(() => d()!.text.endsWith(insertion) && !pop(), `${kind} inserts`, 8000);
      }
      p = await ask();
      lines = rows(cols);
      const index = p.items.findIndex((item, i) => i !== p.index && lines.some(l => l.includes(item.label.trim().slice(0, 20))));
      const item = p.items[index]!, label = item.label.trim().slice(0, 20);
      const y = lines.findIndex(l => l.includes(label));
      const x = lines[y]!.indexOf(label) + 2;
      press({ kind: "mouse", action: "drag", button: 3, x, y });
      await until(() => pop()!.index === index, "hover lights the row");
      expect(d()!.text).toBe(text);
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "up", button: 0, x, y });
      await until(() => d()!.text.endsWith(item.insertion) && !pop(), "one click inserts", 8000);
      await ask();
      press({ kind: "esc" });
      expect(pop()).toBeNull();
      expect(d()!.text).toBe(text);
    }
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);
});
