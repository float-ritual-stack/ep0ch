import { describe, expect, test } from "bun:test";
import { PTY_ACTIONS } from "../src/desk/pty-actions";
import { PtyPane, cttyPrefix } from "../src/desk/pty";
import { COPY_MAX } from "../src/surface/selection";
import { until } from "./scratch";

describe.skipIf(!cttyPrefix())("terminal.clip in the door", () => {
  const tile = () => {
    const copies: [unknown, string | undefined][] = [];
    const p = new PtyPane({ cmd: ["sh"] });
    p.tileName = "claude";
    p.init({ redraw() {}, ctx: { flash() {}, copy: (t: unknown, from?: string) => { copies.push([t, from]); return typeof t === "string"; } } } as any);
    return { p, copies };
  };

  test("copies as the tile's own OSC 52 would: for a tile the person typed in lately, else it says why not, whoever asks", async () => {
    const { p, copies } = tile();
    try {
      p.render(60, 8, false, { redraw() {} } as any);
      await Bun.sleep(150);
      const on = { pane: p, desk: {} as any, tile: "drawer.agent" };
      // Nobody has typed in it: not copied, and said.
      await PTY_ACTIONS.run("terminal.clip", { text: "Lift the onions" }, on as any, { kind: "user" } as any);
      expect(copies).toEqual([[{ away: true }, "sh"]]);
      // The person types in it: now it's theirs.
      p.inputRaw("\r");
      expect(await PTY_ACTIONS.run("terminal.clip", { text: "Lift the onions" }, on as any, { kind: "user" } as any)).toEqual({ tile: "drawer.agent", copied: 15 });
      expect(copies.at(-1)).toEqual(["Lift the onions", "sh"]);
      // A request over the control socket (an agent or a program) gets the same rule, nothing more.
      expect(await PTY_ACTIONS.run("terminal.clip", { text: "Net the brassicas" }, on as any, { kind: "agent", id: "garden-agent" } as any)).toEqual({ tile: "drawer.agent", copied: 17 });
      expect(copies.at(-1)).toEqual(["Net the brassicas", "sh"]);
      // Over the clipboard's cap: refused with its size, as a too-big OSC 52 is.
      await PTY_ACTIONS.run("terminal.clip", { text: "x".repeat(COPY_MAX + 1) }, on as any, { kind: "user" } as any);
      expect(copies.at(-1)).toEqual([{ tooBig: COPY_MAX + 1 }, "sh"]);
    } finally { p.dispose(); }
  }, 15_000);
});
