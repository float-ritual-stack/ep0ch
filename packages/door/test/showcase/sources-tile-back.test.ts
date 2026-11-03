// PIE-1545: Sources opened on a note, handed to its own tile by ^O and back inline by ^O again, holds the keys as after
// a fresh S: its footer says "sources has keys" and Esc closes it. Before, the reader's footer came back, Esc said
// "nothing to close" and S did nothing. Driven by keys, as a person does. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("showcase: Sources back inline from its tile (PIE-1545)", () => {
  const h = useShowcaseScreen(177);
  const ctrlO = () => h.press({ kind: "char", ch: "o", ctrl: true });

  test("^O to [tile ▸] and once more: back inline, Sources keeps the keys and Esc closes it", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "tabs" } }, { kind: "user" });
    h.press({ kind: "enter" });
    h.ch("S");
    await until(() => h.screen().includes("Sources ·"), "the sources panel");
    expect(h.screen()).toContain("sources has keys");
    const desk = () => h.S().stages.get(h.S().sel).top;
    const tiled = () => desk().layoutGet().tiles.some((t: { name: string }) => t.name === "sources");
    // ^O round the placements until Sources has its own tile.
    for (let i = 0; i < 6 && !tiled(); i++) { ctrlO(); await Bun.sleep(150); h.screen(); }
    await until(() => { h.screen(); return tiled(); }, "Sources in its own tile");
    // Once more: back inline, in the reader.
    ctrlO();
    await until(() => { h.screen(); return !tiled(); }, "Sources back in the reader");
    await until(() => h.screen().includes("[inline ▸]"), "the chip says inline");
    expect(h.screen()).toContain("sources has keys");
    h.press({ kind: "esc" });
    await until(() => !h.screen().includes("Sources ·"), "Esc closed Sources");
  }, 30_000);
});
