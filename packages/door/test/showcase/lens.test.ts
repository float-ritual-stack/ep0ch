// The showcase's lens section (PIE-1461): the lab's Jobs note draws a live table from one `lens::` line; pressing a
// stage cell in the reader steps that job's property and the table redraws; the day note's line reads this.page;
// uninstalled, the line says how to bring the lens back, and installing by act brings it. Scratch services; made up.
import { describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const AGENT: Actor = { kind: "agent", id: "test-agent" };
const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("the showcase screen: the lens", () => {
  const h = useShowcaseScreen();

  /** Presses a square the note's lens drew, in the reader holding it, once it's there; waits for the run's answer. */
  const press = async (tile: string, label: string, expected: RegExp, actor: Actor = USER) => {
    const { app } = h;
    const before = new Set(app.describe().messages.map(row => row.id));
    for (const end = Date.now() + 15_000; ;) {
      try { await app.dispatch.act({ action: "button.press", tile, args: { label } }, actor); break; }
      catch (error) {
        if (Date.now() > end) throw new Error(`the lens's ${label} cell never drew: ${error}; screen:\n${h.screen()}`);
        await Bun.sleep(100);
      }
    }
    const answer = () => app.describe().messages.find(row => !before.has(row.id) && expected.test(row.message));
    await until(() => !!answer(), `${label}'s answer`, 15_000).catch(error => { throw new Error(`${error.message}; last messages: ${JSON.stringify(app.describe().messages.slice(-3))}`); });
    return answer()!.message;
  };
  const chip = async (id: string, key: string) => new RegExp(`\\[${key}::([^\\]]*)\\]`).exec((await h.board.get(id))!.text.split("\n")[0]!)?.[1];

  /** The note's lens as the service drew it (its line's projection), once it holds `holds`. */
  const drawn = async (id: string, holds: string, ms = 15_000) => {
    for (const end = Date.now() + ms; ;) {
      const read = await h.board.request<{ projections?: { output?: { markdown?: string } }[] }>("resources.projection.read", { blockId: id, materialize: true }).catch(() => null);
      const hit = (read?.projections ?? []).map(p => p.output?.markdown ?? "").find(m => m.includes(holds));
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`${holds} never drew on ${id}; last: ${JSON.stringify(read?.projections?.map(p => p.output?.markdown ?? "(none)"))}`);
      await Bun.sleep(100);
    }
  };

  test("the section draws the lab, and a pressed stage cell steps the job's property; the table redraws", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    expect(h.screen()).toContain("draw a live, editable table");
    const jobs = seeded.notes.lensJobs!, day = seeded.notes.lensDay!, order = seeded.notes.lensOrder!;
    expect(jobs && day && order).toBeTruthy();
    const job = async (start: string) => (await board.queryNotes("type=job")).notes.find(m => m.text.startsWith(start))!;
    const gate = await job("Fix the gate latch"), hose = await job("Mend the hose");
    expect(await chip(gate.id, "stage")).toBe("todo");
    expect(await drawn(jobs.id, "| Fix the gate latch | todo | Ada |")).toContain("high · 2");

    const reader = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: jobs.id, name: "jobs" } }, USER) as { tile: string };
    // The stage column's cell is a press of its own: todo → doing, as the person; the table redraws from the change.
    expect(await press(reader.tile, "todo", /Fix the gate latch: stage todo → doing/)).toContain("todo → doing");
    expect(await chip(gate.id, "stage")).toBe("doing");
    expect(await drawn(jobs.id, "| Fix the gate latch | doing | Ada |")).not.toContain("| Fix the gate latch | todo |");
    // Past the last choice the property comes off: done → (unset), and the cell draws a dot to press.
    expect(await press(reader.tile, "done", /Mend the hose: stage done → \(unset\)/)).toContain("(unset)");
    expect(await chip(hose.id, "stage")).toBeUndefined();
    await drawn(jobs.id, "| Mend the hose | · | Sam |");
    // An agent presses the same cell, attributed to it, and lands on the first choice.
    await app.dispatch.act({ action: "button.press", tile: reader.tile, args: { label: "·" } }, AGENT);
    for (const end = Date.now() + 15_000; (await chip(hose.id, "stage")) !== "todo";) { if (Date.now() > end) throw new Error("the agent's press never landed"); await Bun.sleep(100); }
    // Written by the lens's script, not as the person: the door says who.
    expect((await board.get(hose.id))!.author).toBe("ext:lens");
  }, 60_000);

  test("the day note's line reads this.page: one line, each day its own meetings; the order sums its computed column", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    const day = seeded.notes.lensDay!, order = seeded.notes.lensOrder!;
    const one = await drawn(day.id, "Standup");
    expect(one).toContain("Retro");
    expect(one).not.toContain("Planning");
    expect(await drawn(order.id, "| Σ | 10 |  | 28 |")).toContain("| Beans | 5 | 2 | 10 |");
  }, 60_000);

  test("uninstalled, the lens's lines say so; installed by act, they draw again without a second lab", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    const order = seeded.notes.lensOrder!;
    await app.dispatch.act({ action: "extensions.uninstall", args: { id: "lens", demo: "keep" } }, USER);
    await app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "lens"), "lens removed from the door");
    expect((await board.get(order.id))!.text).toContain("lens::");
    const rows = await app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "lens" } }, AGENT) as { rows: { label: string }[] };
    expect(rows.rows.some(r => r.label === "install Lens")).toBe(true);
    const installed = await app.dispatch.act({ action: "extensions.install", args: { id: "lens" } }, AGENT) as { state?: string };
    expect(installed.state).toBe("active");
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.some(e => e.id === "lens"), "lens installed in the door");
    expect((await board.queryNotes("type=seed-line")).notes).toHaveLength(3);
  }, 40_000);
});
