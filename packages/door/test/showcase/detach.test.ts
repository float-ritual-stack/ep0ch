// The detach section (PIE-1247 slice 2, materialize): a part of a long plan comes out of it. By mouse, an alt+drag of
// a list item onto the pad, then embed chosen; through act, the figure detached into a tile of its own (a block under
// .detached with no header, its anchor written in the plan) and the callout copied into the pad. Scratch service,
// made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: detach (PIE-1247)", () => {
  const h = useShowcaseScreen(200);
  const as = "test-agent";
  const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 8000) => {
    const end = Date.now() + ms;
    while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); }
  };
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => h.press({ kind: "mouse", action, button: 0, x, y, mods: 8 } as never);

  test("alt+drag a list item onto the pad embeds it; act detaches the figure into a tile of its own and copies the callout with its words", async () => {
    await h.app.act({ action: "section", args: { name: "detach" }, as });
    await until(() => marks.detach!.every(m => h.screen().includes(m)), `the detach section: ${marks.detach!.filter(m => !h.screen().includes(m)).join(" | ")}`, 15_000);
    const plan = h.seeded.notes.shedPlan.id, pad = h.seeded.notes.shedPad.id;
    await until(() => h.screen().includes("order the felt"), "the plan's list", 15_000);

    // By mouse: the person's alt+drag, from the plan's "order the felt" onto the pad's text.
    const rows = h.screen().split("\n");
    const y = rows.findIndex(l => l.includes("order the felt")), x = rows[y]!.indexOf("order the felt") + 2;
    const y2 = rows.findIndex(l => l.includes("Drop a part of the plan here.")), x2 = rows[y2]!.indexOf("Drop a part of the plan here.") + 3;
    expect(x2).toBeGreaterThan(x);
    mouse("down", x, y);
    mouse("drag", x + 2, y);
    mouse("drag", x2, y2);
    expect(h.screen()).toContain("→ into Shed sticky pad, after line 2");
    mouse("up", x2, y2);
    await until(() => h.screen().includes("embed it: a reference"), "the embed-or-copy choice", 8000);
    h.press({ kind: "enter" } as never);
    await untilAsync(async () => (await h.board.get(pad))!.text.split("\n")[2] === `((${plan}^order-the-felt))`, "the reference put into the pad", 10_000)
      .catch(async e => { console.log(h.screen(), (await h.board.get(pad))!.text); throw e; });
    expect((await h.board.get(plan))!.text).toContain("- order the felt ^order-the-felt");

    // Through act, as the person's alt+D does (an agent's layout change is the section's to refuse): the figure detached,
    // into a tile of its own beside the plan.
    const d = await h.S().stages.get(h.S().sel).top.dispatch.act({ action: "element.detach", args: { line: 4 }, tile: "plan" }, USER) as { detached: string; part: string; anchored?: boolean };
    expect(d).toMatchObject({ part: `${plan}^shed-jobs`, anchored: true });
    const detached = (await h.board.get(d.detached))!;
    expect(detached.text).toBe(`Shed jobs [header::none]\n[from::((${plan}^shed-jobs))]\n!((${plan}^shed-jobs))`);
    expect((await h.board.get(plan))!.text.split("\n")[3]).toBe("::graph-table ^shed-jobs");
    // Its tile draws the figure from its first row, answering the plan's children (parent:this is the plan's).
    await until(() => h.screen().split("\n").filter(l => l.includes("Fix the latch")).length >= 1 && h.S().stages.get(h.S().sel).top.layoutGet().tiles.length === 3, "the detached tile", 15_000);

    // And the callout copied into the pad, its words with it.
    const q = await h.app.act({ action: "element.quote", tile: "plan", args: { line: 11, into: pad, at: 2, copy: true }, as }) as { into: { outcome: string } };
    expect(q.into.outcome).toBe("applied");
    expect((await h.board.get(pad))!.text.split("\n").slice(1, 4)).toEqual(["Drop a part of the plan here.", "> [!warning] Paint the door last", "> The primer needs two dry days."]);

    // By mouse again: the callout dragged onto the screen's right edge detaches into a full-height column.
    const tiles = () => h.S().stages.get(h.S().sel).top.layoutGet().tiles.length;
    // The new tile slides into place: read where things are once the screen holds still.
    let last = "";
    await until(() => { const now = h.screen(); const still = now === last; last = now; return still && now.includes("2 Shed jobs"); }, "the screen settled", 10_000, );
    // The plan's callout: the leftmost "Paint the door last" (the pad's copy is drawn further right).
    const now = h.screen().split("\n");
    const [cy, cx] = now.flatMap((l, i) => (l.includes("Paint the door last") ? [[i, l.indexOf("Paint the door last") + 2] as const] : [])).sort((a, b) => a[1] - b[1])[0]!;
    const right = Math.max(...now.map(l => l.trimEnd().length));
    const edge = now.findIndex((l, i) => i > cy && l.length >= right);
    mouse("down", cx, cy);
    mouse("drag", cx + 2, cy);
    mouse("drag", right - 1, Math.max(edge, cy + 1));
    expect(h.screen()).toContain("⧉ detach it:");
    mouse("up", right - 1, Math.max(edge, cy + 1));
    await until(() => tiles() === 4, "the callout's tile", 15_000);
    expect((await h.board.get(plan))!.text).toContain("> The primer needs two dry days. ^paint-the-door");
    const holder = (await h.board.resolvePage(".detached")).block!;
    const kids = await h.board.children(holder.id);
    expect(kids.map(c => c.text.split("\n").at(-1))).toContain(`!((${plan}^paint-the-door))`);

    // By keys: alt+D on the plan detaches the part the reader is on.
    const before = tiles();
    h.press({ kind: "char", ch: "1" } as never);
    h.press({ kind: "alt", ch: "D" } as never);
    await until(() => tiles() === before + 1, "alt+D's tile", 15_000);
  }, 90_000);
});
