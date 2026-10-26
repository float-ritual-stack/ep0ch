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

  test("the rows say what they are, the docs sit beside the list at 120 and under it at 80; move, accept and dismiss by act and by keys", async () => {
    await h.app.act({ action: "section", args: { name: "completion" }, as: "test-agent" });
    await until(() => marks.completion!.every(m => screen().includes(m)), "the completion section", 8000);
    let p = await settled("the (( popup");
    const meeting = h.seeded.notes.meeting.id;
    expect(p.items.some(i => i.insertion === `((${meeting}))` && i.kind === "block")).toBe(true);
    expect(p.items.some(i => i.kind === "anchor")).toBe(true);
    // Wide: each row ends in its kind, and the docs panel is to the right of the list.
    let lines = rows(120);
    const at = lines.findIndex(l => l.includes("Greenhouse meeting, October"));
    expect(lines[at]).toMatch(/Greenhouse meeting, October.*block +│/);
    expect(p.previewRect!.col).toBeGreaterThanOrEqual(p.listWidth!);
    expect(lines.find(l => l.includes("^a10  We agreed"))).toMatch(/anchor +│/);
    expect(lines.some(l => /↑↓ (move · )?⏎\/tab/.test(l))).toBe(true);
    // The lit note's own reader in the docs, without its margin's comment cards.
    await until(() => !!pop()!.items[pop()!.index]!.preview, "the lit note read", 8000);
    lines = rows(120);
    const head = lines.findIndex(l => l.includes("references 1/") || / references \d+\//.test(l));
    const docs = lines.slice(head + 1, head + 12).map(l => l.split(" │ ")[1] ?? "").join("\n");
    expect(docs).toContain("Greenhouse");
    expect(docs).not.toContain("[–]");
    // Narrow: the same list with its docs under it.
    lines = rows(80);
    p = pop()!;
    expect(p.previewRect!.col).toBeLessThanOrEqual(1);
    expect(p.previewRect!.row).toBeGreaterThan(2);
    rows(120);
    // The person's keys go into the stage; ↓ is complete.move, as act's is.
    press({ kind: "enter" });
    const first = pop()!.index;
    press({ kind: "down" });
    expect(pop()!.index).toBe(first + 1);
    const moved: any = await stage().dispatch.act({ action: "complete.move", args: { by: -1 }, tile: "guide" }, { kind: "user" });
    expect(moved).toMatchObject({ index: first + 1 });   // from 1, as act counts rows
    // An agent doesn't move the person's list: the draft is theirs.
    await expect(stage().dispatch.act({ action: "complete.move", args: { by: 1 }, tile: "guide" }, { kind: "agent", id: "test-agent" })).rejects.toThrow();
    expect(pop()!.index).toBe(first);
    // Accept the meeting through act: what tab or ⏎ would insert.
    const n = pop()!.items.findIndex(i => i.insertion === `((${meeting}))`) + 1;
    await stage().dispatch.act({ action: "complete.accept", args: { n }, tile: "guide" }, { kind: "user" });
    await until(() => d()!.text.endsWith(`((${meeting}))`), "the meeting inserted", 8000);
    expect(pop()).toBeNull();
    // Esc closes a list asked for again, leaving the text; complete.dismiss is the same action.
    press({ kind: "backspace" }); press({ kind: "backspace" });
    await stage().dispatch.act({ action: "complete.ask", args: {}, tile: "guide" }, { kind: "user" });
    await settled("asked again");
    press({ kind: "esc" });
    expect(pop()).toBeNull();
    expect(d()!.text).toContain("Ask about the beds, see ((");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);
});
