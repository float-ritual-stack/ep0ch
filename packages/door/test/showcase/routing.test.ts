// PIE-1010: the showcase screen, notes that file themselves. One of the showcase's test files (a section's test is a
// file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it. The section drives
// the real part: the outliner's routing rules (rule notes), the service's one move, the door's note.route by key and
// act, note.new placed by routing, and the Routing view. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import type { NoteRouteResult } from "@ep0ch/outline-core/protocol";
import { App } from "../../src/app";
import { prop } from "../../src/props";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard, type Actor } from "../../src/socket";

const AGENT: Actor = { kind: "agent", id: "test-agent" };
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

describe.skipIf(!outliner)("the showcase screen: notes that file themselves", () => {
  const h = useShowcaseScreen();
  const { press, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });

  test("routing (PIE-1010): alt+z routes the note read by the first rule that holds, ctrl+z puts it back, a dry run moves nothing, a new note lands where its rule says", async () => {
    const { routing, recipeShelf, seedTin, pickled } = seeded.notes;
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "routing") + 1;
    expect(await app.act({ action: "section", args: { name: "routing" }, as: "test-agent" })).toEqual({ section: n, key: "routing" });
    await until(() => screen().includes("Pickled walnuts"), "the recipe shown", 8000);
    const stage = () => S().stages.get(n - 1).top as any;
    const readerOf = (id: string) => [...stage().panes.entries()].find(([, p]: [string, any]) => p.msg?.id === id) as [string, any] | undefined;
    await until(() => !!readerOf(pickled.id), "the reader on the recipe");
    const readerName = stage().nameOf(readerOf(pickled.id)![0]) as string;

    // An agent's dry run (act): says what would move where and why, and moves nothing.
    const dry = await stage().dispatch.act({ action: "note.route", args: { id: pickled.id, dry: true }, tile: readerName }, AGENT) as NoteRouteResult;
    expect(dry).toMatchObject({ outcome: "would-move", to: { id: recipeShelf.id }, rule: { title: "Recipes go to the shelf" } });
    expect(dry.said).toBe("would move “Pickled walnuts” from “Notes that file themselves” to “Recipe shelf” (rule “Recipes go to the shelf”)");
    expect((await board.get(pickled.id))!.parentId).toBe(routing.id);

    // The person, by keys: into the stage, tab to the reader on the recipe, alt+z routes it; the status bar says which rule.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    for (let i = 0; i < 3 && stage().panes.get(stage().focus)?.msg?.id !== pickled.id; i++) press({ kind: "tab" });
    expect(stage().panes.get(stage().focus)?.msg?.id).toBe(pickled.id);
    press({ kind: "alt", ch: "z" });
    await untilAsync(async () => (await board.get(pickled.id))!.parentId === recipeShelf.id, "the recipe routed to the shelf");
    // The agent's dry run is said under the reader's byline, named; the person's move is said on the status bar.
    expect(screen()).toContain("an agent (test-agent) would move “Pickled walnuts”");
    // A move is structural: the note's text and revision are as they were.
    expect((await board.get(pickled.id))!).toMatchObject({ parentId: recipeShelf.id, revision: pickled.revision, text: pickled.text });
    // ctrl+z puts it back where it was.
    press({ kind: "char", ch: "z", ctrl: true });
    await untilAsync(async () => (await board.get(pickled.id))!.parentId === routing.id, "the recipe put back");
    // Routed again, it is already there: said, nothing moved.
    const again = await stage().dispatch.act({ action: "note.route", args: { id: pickled.id }, tile: readerName }, AGENT) as NoteRouteResult;
    expect(again.outcome).toBe("moved");
    const once = await stage().dispatch.act({ action: "note.route", args: { id: pickled.id }, tile: readerName }, AGENT) as NoteRouteResult;
    expect(once).toMatchObject({ outcome: "unchanged" });
    expect(once.said).toBe("“Pickled walnuts” is already in “Recipe shelf” (rule “Recipes go to the shelf”)");

    // A new note with its words: placement asks routing first, so a seed packet lands in the Seed tin directly.
    const made = await app.act({ action: "note.new", args: { text: "Nasturtium [type::seed]\nSow in May.", near: routing.id }, as: "test-agent" }) as { id: string; parentId: string; rule: string; said: string };
    expect(made).toMatchObject({ parentId: seedTin.id, rule: "route" });
    expect(made.said).toBe("in “Seed tin” (routed by “Seeds go to the tin”)");

    // The Routing view at the root lists every rule, in the order they're tried.
    const view = (await board.roots()).find(r => prop(r, "page") === "routing")!;
    expect(view).toBeDefined();
    const order = await board.request<{ blockIds: string[] }>("virtual.occurrences.order", { viewId: view.id });
    const rules = (await board.children(routing.id)).filter(c => prop(c, "type") === "route").map(c => c.id);
    expect(rules).toHaveLength(2);
    for (const id of rules) expect(order.blockIds).toContain(id);
    expect(sc).toBeDefined();
  });
});
