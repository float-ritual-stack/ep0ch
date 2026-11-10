// PIE-1669: keys typed into an attachment's own tile go to that attachment, whichever others are open beside it, and its
// hint row names that attachment's keys, as Sources has done. The showcase's collection-tune section: a made-up garden.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: an attachment's tile takes its own keys (PIE-1669)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "collection-tune")).top; };
  const act = (action: string, args: Record<string, unknown> = {}, tile = "garden") => stage().dispatch.act({ action, tile, args }, { kind: "user" }) as Promise<any>;
  const surface = () => stage().pane("garden").surface;
  const tileOf = (kind: string) => stage().layoutGet().tiles.find((t: any) => t.kind === kind)?.name as string | undefined;

  test("with the settings card in its tile, a comment in its own tile takes what's typed there, and each tile's hint is its own", async () => {
    await h.app.dispatch.act({ action: "section.try", args: { name: "collection-tune" } }, { kind: "user" });
    await act("tile.focus");
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await stage().dispatch.act({ action: "tile.close", tile: tile.name }, { kind: "user" });
    const note = await h.board.createBlock(null, 'Bed settings\n\n::view{layout=table query="collection=garden" group=area} ^beds\n::\n\nThe end.');
    await act("open", { id: note.id });
    await until(() => surface().msg?.id === note.id && (surface().listsDrawn as any[]).some(l => l.view.pickable().length > 0), "the beds", 8000);
    await act("list.enter", { on: true });
    h.ch(",");
    await until(() => !!surface().panel?.card, "the settings card");
    await act("settings.place", { place: "tile" });
    await until(() => !!tileOf("settings"), "the settings tile");
    await act("comment.note");
    await until(() => !!surface().session?.composer, "the composer");
    await act("comment.place", { place: "tile" });
    await until(() => !!tileOf("comment"), "the comment tile");
    await act("tile.focus", {}, tileOf("comment")!);
    const sel = surface().panel!.card!.sel;
    for (const c of "jx") h.ch(c);
    await until(() => surface().session?.composer?.text === "jx", `what is typed in the comment tile to reach the comment (it holds ${JSON.stringify(surface().session?.composer?.text)}, settings field ${surface().panel!.card!.sel}, was ${sel}, focused ${stage().focusedName?.()})`, 3000);
    expect(surface().panel!.card!.sel).toBe(sel);
    // The tiles' hints are their own attachments': the comment's says send, the card's its fields.
    const hint = (kind: string) => surface().attachmentHint(kind);
    expect(hint("comment")).toContain("send");
    expect(hint("settings")).toContain("field");
    // And back: the settings tile takes its keys again.
    await act("tile.focus", {}, tileOf("settings")!);
    h.press({ kind: "down" });
    await until(() => surface().panel!.card!.sel !== sel, "the settings tile's ↓ moving its field");
    expect(surface().session?.composer?.text).toBe("jx");
  }, 30_000);
});
