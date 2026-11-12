// PIE-1772: the showcase's preview section, as its aside says. ^W v on the reader opens an empty detail beside it; ^W x
// on the reader then hands the detail its note (the notebook), so the note stays on screen. An agent reading the layout
// there says nothing on the person's screen; its write is said with its name. Scratch service, the showcase's seed.
import { describe, expect, test } from "bun:test";
import type { Desk } from "../../src/desk/desk";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase's preview section: a close keeps its note, a read stays quiet (PIE-1772)", () => {
  const h = useShowcaseScreen();
  const said = () => String((h.app as any).message ?? "");

  test("^W v then ^W x on the notebook's reader: the detail beside it shows the notebook; an agent's layout.get says nothing", async () => {
    await h.app.act({ action: "section", args: { name: "preview" }, as: "fern" });
    h.press({ kind: "enter" });                                                    // the person goes into the section
    const desk = () => h.S().stages.get(h.S().sel).top as Desk;
    const tiles = () => ((desk() as any).layoutGet().tiles as any[]).map(t => ({ tile: t.tile as string, name: t.name as string, note: t.showing?.id as string | undefined }));
    const notebook = h.seeded.notes.notebook!.id;
    await until(() => tiles().some(t => t.note === notebook), "the reader on the notebook");
    const reader = tiles().find(t => t.note === notebook)!;
    await desk().dispatch.act({ action: "tile.focus", args: {}, tile: reader.name }, { kind: "user" });

    (h.app as any).flash("the person's own words");
    await h.app.act({ action: "layout.get", args: {}, as: "fern" });
    expect(said()).toBe("the person's own words");

    h.press({ kind: "char", ch: "w", ctrl: true }); h.press({ kind: "char", ch: "v" }); h.screen();
    const detail = tiles().find(t => t.name === `${reader.name}-preview`)!;
    expect(detail.note).toBeUndefined();
    h.press({ kind: "char", ch: "w", ctrl: true }); h.press({ kind: "char", ch: "x" }); h.screen();
    expect(tiles().some(t => t.tile === reader.tile)).toBe(false);
    expect(tiles().find(t => t.tile === detail.tile)?.note).toBe(notebook);
    expect(h.screen()).toContain(h.seeded.notes.notebook!.text.split("\n")[0]!.replace(/\s*\[.*$/, "").slice(0, 20));

    await h.app.act({ action: "tile.title", args: { text: "pines" }, tile: "tree", as: "fern" });
    expect(said()).toContain("an agent (fern)");
  }, 30_000);
});
