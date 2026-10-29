// The at-revision section (PIE-1433): a suggestions page row opens its note as it was at the revision the review read,
// beside how it is now, marked against the next revision; the note's history opens the same compare; Esc goes back to
// the note. At 177 columns, the page above the note, both wide enough to put it beside. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: at a revision (PIE-1433)", () => {
  const h = useShowcaseScreen(177);
  const as = "test-agent";

  test("a suggestions row opens revision 1 beside the note; the history opens it too; esc goes back", async () => {
    await h.app.act({ action: "section", args: { name: "at-revision" }, as });
    await until(() => marks["at-revision"]!.every(m => h.screen().includes(m)), "the at-revision section", 15_000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const surface = (name: string) => stage().pane(name).surface;

    // An agent reads the compare and opens nothing.
    const read = (await h.app.act({ action: "revision.compare", args: { revision: 1 }, tile: "note", as })) as { revision: number; to: number; shown: boolean; diff: string[] };
    expect(read).toMatchObject({ revision: 1, to: 2, shown: false });
    expect(read.diff).toContain("+ - **Nothing leaked.**");
    expect(read.diff.some(r => r.startsWith("- - The shed roof went on at nine"))).toBe(true);
    expect(surface("note").revisionMode).toBeNull();

    // The person double-clicks the finding's row on the page: the note opens with revision 1 beside it.
    await until(() => h.screen().split("\n").some(l => l.includes("Shed status") && l.includes("dense")), "the finding's row", 15_000);
    const lines = h.screen().split("\n"), y = lines.findIndex(l => l.includes("Shed status") && l.includes("dense")), x = lines[y]!.indexOf("Shed status");
    for (let i = 0; i < 2; i++) { h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never); }
    await until(() => h.screen().includes("REVISION 1 → 2 (now)"), "the compare beside the note", 15_000);
    const screen = h.screen();
    expect(screen).toContain("[‹ older] [newer ›] [against now] [esc back]");
    expect(screen).toContain("+ - **Roof on** at nine");
    // Beside: the compare and the note as it is now on the same rows.
    const row = screen.split("\n").find(l => l.includes("REVISION 1 → 2"))!;
    expect(row.indexOf("REVISION")).toBeGreaterThan(40);
    const opened = (["page", "note"] as const).find(n => surface(n).revisionMode)!;
    expect(surface(opened).msg.id).toBe(h.seeded.notes.writeReview.id);
    expect(surface(opened).revisionMode.describe()).toMatchObject({ revision: 1, to: 2, against: "next" });

    // n: against the note now (the same revision here); esc: back to the note, nothing left beside it.
    await stage().dispatch.act({ action: "revision.against", args: { to: "now" }, tile: opened }, USER);
    expect(surface(opened).revisionMode.describe()).toMatchObject({ against: "now", to: 2 });
    // The keys stayed on the page (an open lands without taking them); a click in the compare's tile gives it the keys, then esc.
    const shown = h.screen().split("\n"), ty = shown.findIndex(l => l.includes("REVISION 1 → 2")), tx = shown[ty]!.indexOf("REVISION");
    h.press({ kind: "mouse", action: "down", button: 0, x: tx + 2, y: ty + 4 } as never); h.press({ kind: "mouse", action: "up", button: 0, x: tx + 2, y: ty + 4 } as never);
    await until(() => stage().nameOf(stage().focus) === opened, "the compare's tile has the keys", 8000);
    expect(surface(opened).revisionMode).not.toBeNull();
    h.press({ kind: "esc" } as never);
    await until(() => !h.screen().includes("REVISION 1 → 2"), "esc closed the compare", 8000);
    expect(surface(opened).revisionMode).toBeNull();
    expect(surface(opened).msg.id).toBe(h.seeded.notes.writeReview.id);

    // The history (the tile menu's), a row chosen: the same compare.
    const hist = (await stage().dispatch.act({ action: "revision.history", tile: "note" }, USER)) as { shown: boolean; revisions: { revision: number }[] };
    expect(hist.shown).toBe(true);
    await until(() => h.screen().includes("history · Shed status tonight"), "the history list", 8000);
    h.press({ kind: "enter" } as never);
    await until(() => !!surface("note").revisionMode, "the compare in the narrow tile", 8000);
    await until(() => h.screen().includes("REVISION 1 → 2"), "drawn", 8000);
    expect(surface("note").revisionMode.describe()).toMatchObject({ revision: 1, to: 2 });
    await stage().dispatch.act({ action: "revision.close", tile: "note" }, USER);
    expect(surface("note").revisionMode).toBeNull();
  }, 90_000);
});
