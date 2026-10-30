// The navigator section (PIE-1443): the facets tile on #frost-jobs, its Matches in a tile of its own (Pinned first,
// then the service's day groups, each row its excerpt), wired to a reader. Picked by act as a click does, opened,
// pinned, narrowed to a day and put back inline, every step through `act`. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: the navigator (PIE-1443)", () => {
  const h = useShowcaseScreen(177);
  const { S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const act = (action: string, args: Record<string, unknown> = {}, tile = "facets") => stage().dispatch.act({ action, args, tile }, { kind: "agent", id: "test-agent" }) as Promise<any>;
  const groups = async () => ((await act("facets.list")).matches.groups as { label: string; notes: { title: string; excerpt: string }[] }[]);

  test("the tree, Matches grouped with the pinned note first, and a reader its picks open in", async () => {
    await h.app.act({ action: "section", args: { name: "navigator" }, as: "test-agent" });
    await until(() => marks.navigator!.every(m => h.screen().includes(m)), "the navigator section", 15_000);
    const g = await groups();
    expect(g[0]).toMatchObject({ label: "Pinned", notes: [{ title: "Lag the standpipe", excerpt: "The lagging is in the shed, top shelf." }] });
    expect(g.slice(1).flatMap(x => x.notes.map(n => n.title))).toEqual(expect.arrayContaining(["Fleece over the brassicas", "Lift the dahlias"]));
    expect(stage().layoutGet().tiles.map((t: any) => t.kind)).toEqual(expect.arrayContaining(["facets", "matches", "reader"]));

    // A pick and an open go through the Matches tile's wires to the reader.
    const dahlias = g[1]!.notes.find(n => n.title === "Lift the dahlias")!;
    const id = (await act("facets.list")).matches.groups.flatMap((x: any) => x.notes).find((n: any) => n.title === dahlias.title).id;
    await act("facets.open", { id });
    await until(() => stage().layoutGet().tiles.some((t: any) => t.kind === "reader" && t.showing?.id === id), "the reader shows it");

    // Pinned, it joins the standpipe at the top; a day with nothing that day empties Matches; inline again closes the tile.
    await act("facets.pin", { id });
    await until(() => h.screen().includes("◆ Lift the dahlias"), "pinned");
    await act("facets.pin", { id, on: false });
    await act("facets.day", { day: "2001-01-01" });
    expect((await act("facets.list")).matched).toBe(0);
    await act("facets.day", { day: "" });
    await act("facets.place", { place: "inline" });
    await until(() => !stage().layoutGet().tiles.some((t: any) => t.kind === "matches"), "the Matches tile closed");
    expect(h.screen()).toContain("── Matches");
  }, 40_000);
});
