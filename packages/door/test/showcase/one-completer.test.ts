// The one completer (PIE-1076): an action and its arguments complete where the person types, in a note's edit (ctrl+k,
// or / first on a line) and on the power bar's line, from the same rows. Driven by the person's keys as Evan would:
// sort the list from inside its edit, choose order=desc in place, ⏎ runs it; then tile= in the bar lists this
// screen's tiles by the names tile= takes. Scratch service, fictional notes.
import { describe, expect, test } from "bun:test";
import { completionOf } from "../../src/surface/completer";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe("showcase: one completer (PIE-1076)", () => {
  const h = useShowcaseScreen(120);
  const { press, screen, S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const draft = () => stage().pane("jobs").surface.draft;
  const pop = () => (draft() ? completionOf(draft()) : null);
  const type = (s: string) => { for (const c of s) h.ch(c); };
  const listed = async (what: string, ok: (labels: string[]) => boolean) => {
    await until(() => { const p = pop(); return !!p && !p.loading && ok(p.items.map(i => i.label)); }, what, 8000);
    return pop()!;
  };

  test("in the edit: ctrl+k lists the actions here, the chosen one's arguments complete in place, ⏎ runs it; the bar's tile= lists this screen's tiles", async () => {
    await h.app.act({ action: "section", args: { name: "one-completer" }, as: "test-agent" });
    await until(() => marks["one-completer"]!.every(m => screen().includes(m)), "the one-completer section", 8000);
    press({ kind: "enter" });
    // The stage opened the edit and asked for the actions here: a / line under the cursor's, its list open.
    await listed("the actions here", labels => labels.length > 3);
    type("sort list");
    let p = await listed("sort-list by its words", labels => labels[0] === "Sort the list in this block");
    // What the host binds (block=, with=) is never offered; ⏎ takes the action and lists its arguments next.
    press({ kind: "enter" });
    p = await listed("its arguments", labels => labels.includes("order="));
    expect(p.items.map(i => i.label)).toEqual(expect.arrayContaining(["by=", "order="]));
    for (const bound of ["block=", "line=", "with=", "invitation=", "via="]) expect(p.items.map(i => i.label)).not.toContain(bound);
    type("o");
    await listed("order= alone", labels => labels.length === 1 && labels[0] === "order=");
    press({ kind: "tab" });
    p = await listed("order's values", labels => labels.includes("desc"));
    press({ kind: "down" }); press({ kind: "enter" });
    await until(() => draft()?.lines[draft()!.row]?.endsWith("order=desc") === true, "order=desc on the line", 8000);
    await until(() => pop() === null, "nothing left to complete: the list closes", 8000);
    // ⏎ on the line: the line goes, the edit saves and the list is sorted, last first.
    press({ kind: "enter" });
    const id = h.seeded.notes.oneCompleter.id;
    await until(() => !draft(), "the edit saved and left", 8000);
    let text = "";
    await until(() => { void h.board.get(id).then(m => { text = m?.text ?? ""; }); return text.indexOf("Water the leeks") >= 0 && text.indexOf("Water the leeks") < text.indexOf("Label the chilli trays"); }, "the list sorted desc", 8000);
    expect(text).not.toContain("/ext.structure");
    expect(text.indexOf("Sow the broad beans")).toBeLessThan(text.indexOf("Label the chilli trays"));

    // The power bar's line: the same completer, its argument values this screen's tiles by the names tile= takes.
    press({ kind: "char", ch: "k", ctrl: true });
    const bar = () => (h.app as any).bar;
    await until(() => !!bar(), "the power bar", 4000);
    type("tile.zoom t");
    const line = () => completionOf(bar().input);
    await until(() => !!line()?.items.some(i => i.label === "tile="), "tile= offered", 8000);
    press({ kind: "tab" });
    await until(() => bar().query === "tile.zoom tile=" && !!line()?.items.some(i => i.label === "jobs"), "this screen's tiles", 8000);
    expect(line()!.items.every(i => i.kind === "value")).toBe(true);
    // ⏎ takes the lit tile; esc closes a list and leaves the line.
    press({ kind: "enter" });
    await until(() => /^tile\.zoom tile=\S+$/.test(bar().query), "a tile chosen", 8000);
    type(" reach=c");
    await until(() => !!line()?.items.some(i => i.label === "column"), "reach's choices", 8000);
    press({ kind: "esc" });
    expect(line()).toBeNull();
    expect(bar().query).toMatch(/ reach=c$/);
    press({ kind: "esc" }); press({ kind: "esc" });
  }, 60_000);
});
