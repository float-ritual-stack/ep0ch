// The parity walk's settled look covers its terminal tiles (PIE-1811, test/settle.ts `watchTerminals`): a program that
// exits by itself has exited, and its tile has drawn that it did, before the walk looks. The nightly's red on Nov 19
// (parity-desk-tiles, "desk: daily", ctrl+w alt+p) was a build looked at too soon: the daily layout's draft tile runs
// the walk's $EDITOR (`true`) in every build, and the walk compares builds. Real programs in real ptys; no outline.
import { afterEach, describe, expect, test } from "bun:test";
import { PtyPane } from "../src/desk/pty";
import { watchTerminals } from "./settle";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

describe("a terminal tile is settled for the walk's look (PIE-1811)", () => {
  const panes: PtyPane[] = [];
  afterEach(() => { for (const p of panes.splice(0)) p.dispose(); });

  /** A tile running `cmd` on a desk that counts the repaints it asks for; `look` draws it, as a paint does. */
  const tile = (cmd: string[]) => {
    let redraws = 0;
    const desk = { redraw() { redraws++; }, ctx: { flash() {} } } as any;
    const p = new PtyPane({ cmd });
    p.init(desk);
    panes.push(p);
    return { p, redraws: () => redraws, look: () => p.render(60, 8, false, desk).lines.map(plain) };
  };

  test("an editor that exits by itself has exited and its tile says so, however late the exit comes", async () => {
    // The walk's $EDITOR on a busy box: it exits by itself, 60 ms late.
    const t = tile(["sh", "-c", "sleep 0.06"]);
    const terminals = watchTerminals(p => p === t.p);
    terminals.drew(t.p);
    t.look();                                    // the build's first paint starts it
    const asked = await terminals.settle();
    expect([t.p.exited, asked]).toEqual([0, true]);
    expect(t.look().at(-1)).toContain("exited 0");
    // Nothing is left to change by itself: the repaint its exit asked for "soon" was made, not left on its 16 ms timer.
    const drawn = t.redraws();
    expect(drawn).toBeGreaterThan(0);
    await Bun.sleep(60);
    expect(t.redraws()).toBe(drawn);
  });

  test("a program that keeps running is not waited for, and a tile nothing drew is left alone", async () => {
    const t = tile(["sleep", "30"]), other = tile(["sh", "-c", "sleep 0.06"]);
    const terminals = watchTerminals(p => p === other.p);
    terminals.drew(t.p);
    t.look(); other.look();
    const t0 = performance.now();
    await terminals.settle();
    expect(performance.now() - t0).toBeLessThan(50);
    expect([t.p.running, other.p.exited]).toEqual([true, null]);
  });
});
