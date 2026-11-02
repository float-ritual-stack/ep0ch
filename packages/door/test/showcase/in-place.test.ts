// PIE-1516's demo is its end-to-end test: the in-place section's links tile is wired to itself; an open there shows the
// note in that tile, ← back puts the list back, and the frame says so. Driven through act, as the person.
import { describe, expect, test } from "bun:test";
import { BacklinksPane } from "../../src/desk/backlinks-pane";
import { ReaderPane } from "../../src/desk/panes";
import { SECTIONS } from "../../src/showcase/showcase";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("showcase: open in place (PIE-1516)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "in-place")).top; };
  const act = (action: string, args: Record<string, unknown> = {}, tile = "links") => stage().dispatch.act({ action, tile, args }, { kind: "user" }) as Promise<any>;

  test("the links tile, wired to itself, opens its row in place and ← back returns to the list", async () => {
    await h.app.dispatch.act({ action: "section.try", args: { name: "in-place" } }, { kind: "user" });
    const links = () => stage().pane("links");
    const outlink = () => (links() as BacklinksPane).rows().findIndex(r => r.kind === "outlink");
    await until(() => links() instanceof BacklinksPane && outlink() >= 0, "the walk's links listed", 8000);
    expect(h.screen()).toContain("open → in place");
    const count = stage().layoutGet().tiles.length;
    await act("tile.focus");
    await act("list.open", { n: outlink() + 1 });
    await until(() => links() instanceof ReaderPane && !!(links() as ReaderPane).msg, "the note in the links tile");
    expect(stage().layoutGet().tiles.length).toBe(count);
    expect((stage().pane("walk") as ReaderPane).msg?.id).toBe(h.seeded.notes.trailGate.id);
    await act("back");
    await until(() => links() instanceof BacklinksPane, "back: the list again");
    expect(h.screen()).toContain("open → in place");
  }, 60_000);
});
