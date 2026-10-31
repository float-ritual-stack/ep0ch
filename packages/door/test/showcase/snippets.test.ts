import { describe, expect, test } from "bun:test";
import { completionOf } from "../../src/surface/completer";
import { traceActions } from "../../src/surface/actions";
import type { Key } from "../../src/term";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: snippet slots (PIE-1480)", () => {
  const h = useShowcaseScreen(120);
  const { press, S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const d = () => stage().pane("guide").surface.session?.composer;
  const pop = () => (d() ? completionOf(d()) : null);
  const settled = async (what: string) => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 0, what, 8000); return pop()!; };
  const actionKey = (key: Key, action: string) => {
    const runs: string[] = [], stop = traceActions(run => runs.push(run.name));
    try { press(key); expect(runs).toContain(action); } finally { stop(); }
  };

  test("a component's slots take Tab and Shift+Tab, Esc ends them, and one undo removes the filled insertion", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "snippets" } }, { kind: "user" });
    await settled("the completion section");
    press({ kind: "enter" });
    const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, args, tile: "guide" }, { kind: "user" });
    await act("comment.write", { body: "::graph-stat" });
    await act("complete.ask");
    const p = pop()!;
    const n = p.items.findIndex(i => i.component === "graph-stat");
    expect(n).toBeGreaterThanOrEqual(0);
    await act("complete.accept", { n: n + 1 });
    const first = d()!.selectedText();
    expect(first).toBeTruthy();
    for (const ch of "Garden totals") h.ch(ch);
    const filled = d()!.text;
    actionKey({ kind: "tab" }, "snippet.next");
    expect(d()!.text).toBe(filled);
    expect(d()!.selectedText()).toBeTruthy();
    actionKey({ kind: "backtab" }, "snippet.previous");
    expect(d()!.selectedText()).toBe("Garden totals");
    await act("snippet.next");
    expect(d()!.selectedText()).not.toBe("Garden totals");
    await act("snippet.previous");
    expect(d()!.selectedText()).toBe("Garden totals");
    actionKey({ kind: "esc" }, "snippet.end");
    expect(d()).toBeTruthy();
    expect(d()!.selectedText()).toBeNull();
    press({ kind: "char", ch: "z", ctrl: true });
    expect(d()!.text).toBe("::graph-stat");
    await h.app.dispatch.act({ action: "section.leave" }, { kind: "user" });
  }, 30_000);

  test("an extension's button selects its named slots, including a mouse move, and undoes whole", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "snippets" } }, { kind: "user" });
    await settled("the snippet section");
    press({ kind: "enter" });
    const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, args, tile: "guide" }, { kind: "user" });
    await act("comment.write", { body: "::button issue" });
    await act("complete.ask");
    const n = pop()!.items.findIndex(i => i.kind === "snippet");
    expect(n).toBeGreaterThanOrEqual(0);
    await act("complete.accept", { n: n + 1 });
    expect(d()!.selectedText()).toBe("{label}");
    press({ kind: "paste", text: "carrot\tbean" });
    expect(d()!.text).toContain("carrot\tbean");
    expect(d()!.text).toContain("{note}");
    const lines = h.sc.render(h.app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    const y = lines.findIndex(l => l.includes("[next]"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = lines[y]!.indexOf("[next]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    expect(d()!.selectedText()).toBe("{note}");
    press({ kind: "paste", text: h.seeded.notes.meeting.id });
    await act("snippet.end");
    press({ kind: "char", ch: "z", ctrl: true });
    expect(d()!.text).toBe("::button issue");
    await h.app.dispatch.act({ action: "section.leave" }, { kind: "user" });
  }, 30_000);
});
