// The copy-a-page section (PIE-1355): a live page whose copy (Y, note.copy) carries each figure's rows under it as
// Markdown. Driven through act, as an agent and as the person; the copy parsed back with a Markdown parser: the check
// keeps its ticks, the 60-parcel table is cut at the cap with the command that reads the rest, and the tabs are a list
// per bay. Scratch service; the seed is fictional.
import { describe, expect, test } from "bun:test";
import { RESULTS_CAP } from "@ep0ch/outline-core/figure-results";
import { osc52 } from "../../src/surface/selection";
import { COPY_PAGE } from "../../src/showcase/seed/work";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { first, lex, paragraphs, resultsOf, type Tokens } from "../results-markdown";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: copy a page with its figures' results (PIE-1355)", () => {
  const h = useShowcaseScreen(160);
  const agent = "copy-agent";

  test("note.copy carries each figure's results as Markdown; source=true is the text alone; Y copies it to the clipboard", async () => {
    await h.app.act({ action: "section", args: { name: "copy-page" }, as: agent });
    await until(() => marks["copy-page"]!.every(m => h.screen().includes(m)), "the copy-page section", 10_000);
    const sent = h.written.length;

    const copied = await h.app.act({ action: "note.copy", tile: "page", as: agent }) as { text: string; figures: number; cut: number; clipboard: boolean };
    expect(copied).toMatchObject({ figures: 3, cut: 1, clipboard: false });
    // The text as written stays, figures and all.
    for (const line of COPY_PAGE.split("\n")) expect(copied.text).toContain(line);
    const tokens = lex(copied.text);

    const crates = resultsOf(tokens, "Crates")!;
    const steps = first<Tokens.List>(crates, "list");
    expect(steps.items.map(i => [i.checked, i.text.replace(/\(\([0-9a-f-]+\|/, "((…|")])).toEqual([[true, "((…|Apples crate))"], [false, "((…|Beets crate))"], [true, "((…|Chard crate))"]]);

    const parcels = resultsOf(tokens, "Parcels")!;
    expect(paragraphs(parcels)[0]).toContain("60 rows");
    const table = first<Tokens.Table>(parcels, "table");
    expect(table.rows).toHaveLength(RESULTS_CAP);
    expect(table.rows[0]![0]!.text).toMatch(/^\(\([0-9a-f-]{36}\|Parcel 01\)\)$/);
    expect(paragraphs(parcels).find(p => p.startsWith("_showing"))).toContain("showing 50 of 60 · the rest: `ep0ch find");

    const bays = resultsOf(tokens, "Crates by bay")!;
    expect(paragraphs(bays).filter(p => /^\*\*\w+\*\* · \d$/.test(p))).toEqual(["**north** · 2", "**south** · 1"]);

    // The source alone, from the copy menu's "copy source only" (its args), and the person's Y on their clipboard.
    const source = await h.app.act({ action: "note.copy", tile: "page", args: { source: true }, as: agent }) as { text: string; figures: number };
    expect(source).toMatchObject({ text: COPY_PAGE, figures: 0 });
    expect(h.written.slice(sent).some(w => w.includes("\x1b]52;"))).toBe(false);
    const said: string[] = [], flash = h.app.flash.bind(h.app);
    h.app.flash = ((text: string, ...rest: unknown[]) => { said.push(text); return (flash as any)(text, ...rest); }) as typeof h.app.flash;
    const mine = await h.app.dispatch.act({ action: "note.copy", tile: "page" }, USER).finally(() => { h.app.flash = flash; }) as { text: string; clipboard: boolean };
    expect(mine.clipboard).toBe(true);
    await until(() => h.written.slice(sent).includes(osc52(mine.text)), "the page on the clipboard");
    expect(said.at(-1)).toMatch(/^copied the page with 3 figures' results \(1 cut\), \d+ lines$/);
  }, 30_000);
});
