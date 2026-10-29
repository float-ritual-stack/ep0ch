// The trail section (PIE-208): a reader walks five linked notes, then lists where it has been and goes straight back
// to a stop. The person's alt+T opens the list over the screen; an agent's act reads it and opens nothing; a choice is
// back that many steps, so back and forward walk the same trail after. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: trail (PIE-208)", () => {
  const h = useShowcaseScreen(177);
  const as = "test-agent";

  test("five stops walked; alt+T lists them by title; a choice two back lands there; an agent's trail reads the same", async () => {
    await h.app.act({ action: "section", args: { name: "trail" }, as });
    await until(() => marks.trail!.every(m => h.screen().includes(m)), "the trail section", 15_000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const walk = () => stage().pane("walk").surface;
    // The person, by keys: into the stage, then ] to the walk's link and ⏎, four times.
    h.press({ kind: "enter" } as never);
    expect(h.S().focus).toBe("stage");
    for (const [i, stop] of ["the pond", "the orchard", "the shed", "the compost heap"].entries()) {
      // The note shown drawn first, so ] steps through its own elements.
      await until(() => h.screen().includes(`Stop ${i + 1} of 5`), "the stop drawn", 8000);
      h.ch("]"); h.press({ kind: "enter" } as never);
      await until(() => walk().msg?.text.startsWith(`Garden walk: ${stop}`), `walked to ${stop}`, 10_000);
    }
    // The reader's last row and the hint row say how to find it.
    await until(() => h.screen().includes("≡ trail") && h.screen().includes("alt+T trail"), "the ≡ trail chip and the hint", 8000);
    // An agent reads it: every stop back, nearest first; nothing opens over the person's screen.
    const read = (await h.app.act({ action: "trail", tile: "walk", as })) as { here: { title: string }; back: { title: string }[]; shown: boolean };
    expect(read.shown).toBe(false);
    expect(read.here.title).toBe("Garden walk: the compost heap");
    expect(read.back.map(s => s.title)).toEqual(["Garden walk: the shed", "Garden walk: the orchard", "Garden walk: the pond", "Garden walk: the gate"]);
    // The person's: a trail tile beside the reader (PIE-1425), docked, resized and closed like any tile, the note shown lit.
    const tiles = () => stage().tiles().length as number, before = tiles();
    h.press({ kind: "alt", ch: "T" } as never);
    await until(() => tiles() === before + 1 && stage().panes.get(stage().focus)?.kind === "trail", "the trail tile beside the walk", 8000);
    await until(() => h.screen().includes("● Garden walk: the compost heap · here"), "the trail drawn", 8000);
    expect(h.screen()).toContain("← Garden walk: the orchard · 2 back");
    await stage().dispatch.act({ action: "tile.resize", args: { by: 1 }, tile: "trail" }, USER);
    // ↓ ↓ ⏎: two stops back, at once; the trail stays beside it, the note shown lit again.
    h.press({ kind: "down" } as never); h.press({ kind: "down" } as never); h.press({ kind: "enter" } as never);
    await until(() => walk().msg?.text.startsWith("Garden walk: the orchard"), "two stops back", 10_000);
    expect(walk().describeHistory().forward.map((s: { title: string }) => s.title)).toEqual(["Garden walk: the shed", "Garden walk: the compost heap"]);
    await until(() => h.screen().includes("● Garden walk: the orchard · here"), "the trail follows its reader", 8000);
    // alt+T again is the same tile; esc closes it, the keys back in the walk.
    h.press({ kind: "alt", ch: "T" } as never);
    expect(tiles()).toBe(before + 1);
    h.press({ kind: "esc" } as never);
    await until(() => tiles() === before, "esc closed the trail tile", 8000);
    expect(stage().nameOf(stage().focus)).toBe("walk");
    // Forward walks the same trail.
    await stage().dispatch.act({ action: "forward", tile: "walk" }, USER);
    await until(() => walk().msg?.text.startsWith("Garden walk: the shed"), "forward one", 10_000);
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) h.press({ kind: "esc" } as never);
  }, 90_000);
});
