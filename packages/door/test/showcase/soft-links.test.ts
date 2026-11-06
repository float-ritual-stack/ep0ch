// PIE-408's demo: the showcase's soft-links section, by clicks' same path (element.open as the person) on the seeded outline.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("the soft links section", () => {
  const h = useShowcaseScreen();

  test("each word lands where it means, two projects ask, and the page lists the note as a soft mention", async () => {
    await h.app.act({ action: "section", args: { name: "soft-links" }, as: "test-agent" });
    const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "soft-links")).top; };
    const detail = () => stage().pane("detail") as any;
    const person = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "detail", args }, { kind: "user" });
    const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "detail", args }, { kind: "agent", id: "test-agent" });
    const elem = (word: string, nth = 0) => (detail().surface.describeElements() as any[]).filter(e => e.label === word)[nth];
    const home = h.seeded.notes.softLinks!.id;
    const back = async () => { await person("open", { id: home }); await until(() => detail().msg?.id === home && !!elem("seed-swap"), "the note, its words as links", 8000); };
    await until(() => detail()?.msg?.id === home && !!elem("seed-swap"), "the note, its words as links", 8000);

    for (const [word, title] of [["seed-swap", "Seed swap"], ["2026-03-14", "Plot log"], ["HOME-001", ""], ["PR#12", "PR#12 mend the gate"]] as const) {
      const opened = await person("element.open", { n: elem(word).n }) as any;
      if (title) expect(opened.title).toContain(title);
      else expect(opened.opened).toBeTruthy();
      await back();
    }

    // Two projects in one scope: an agent is told the choices, and nothing moves.
    const told = await agent("element.open", { n: elem("PR#12", 1).n, fresh: false }).catch((e: Error) => e);
    expect(detail().msg?.id).toBe(home);
    expect(JSON.stringify(told)).toMatch(/PR#12 mend the gate|PR#12 paint the shed|reader/);
    const answer = await h.board.softLink({ kind: "pr", number: 12 }, { blockId: home, line: detail().msg.text.split("\n").findIndex((l: string) => l.startsWith("On the fence")) });
    expect(answer.status).toBe("ambiguous");
    expect(answer.candidates.map(c => c.context)).toEqual(["elm-row", "riverside"]);

    const page = stage().pane("page") as any;
    await until(() => (page.surface.describeElements() as any[]).some(e => /Soft mentions/.test(JSON.stringify(e))) || /Soft mentions/.test(h.screen()), "the mention's group", 8000);
    // An excluded key stays text.
    expect((await h.board.softLinkScope()).ignore).toContain("rota");
    expect((detail().surface.describeElements() as any[]).some(e => e.label === "north-fence")).toBe(false);
  }, 40_000);
});
