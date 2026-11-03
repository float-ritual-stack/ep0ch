// PIE-1529: the showcase's long-collection section. Forty seed packets in a table, more than the reader holds: PgDn
// moves the pick one screen of rows (the reader following it), PgUp moves back one, and act's list.step page=true
// does what PgDn does; the plain ::links list of the same packets below it pages the same way once a row is picked
// (PIE-1534). Driven by the person's keys and by act on the seeded outline.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { PERSON } from "../../src/surface/list-view";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: a long collection (PIE-1529)", () => {
  const h = useShowcaseScreen(120);

  test.each([120, 44])("PgDn moves one screen of packets, PgUp one back, act the same, at %s columns", async cols => {
    (h.app as any).term.info.cols = cols;
    (h.app as any).term.info.rows = 30;
    try {
      await h.app.dispatch.act({ action: "section.try", args: { name: "long-collection" } }, { kind: "user" });
      const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "long-collection")).top; };
      const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "packets", args: action.startsWith("list.") ? { list: 1, ...args } : args }, { kind: "user" }) as Promise<any>;
      const list = () => (stage().pane("packets").surface.listsDrawn as any[])[0];
      await until(() => list()?.view.pickable().length === 40, "the forty packets", 8000);
      await act("tile.focus");
      await act("list.enter", { on: true });
      await act("list.pick", { n: 1 });
      const at = () => list().view.indexOf(PERSON, list().view.picked());
      const seen = () => h.screen().includes(list().view.picked().label.split(":")[0]);
      const onScreen = list().view.pickable().filter((r: any) => h.screen().includes(r.label.split(":")[0])).length;
      // One page: fewer packets than were on screen, and the one picked before stays in view (the row at the edge).
      const step = async (dir: 1 | -1, how: "key" | "act") => {
        const before = at(), was = list().view.picked().label.split(":")[0];
        const inView = list().view.pickable().filter((r: any) => h.screen().includes(r.label.split(":")[0])).length;
        if (how === "key") h.press({ kind: dir > 0 ? "pgdn" : "pgup" });
        else await act("list.step", { by: dir, page: true });
        await until(() => at() !== before, `${how} pages ${dir > 0 ? "down" : "up"} from ${was}`, 4000);
        const moved = Math.abs(at() - before);
        expect(moved).toBeLessThan(inView);
        await until(seen, `the packet ${how} picked is on screen`, 4000);
        expect(h.screen()).toContain(was);
        return moved;
      };
      const page = await step(1, "key");
      expect(page).toBeLessThan(onScreen);
      if (cols === 120) expect(page).toBeGreaterThan(4);
      await step(1, "key");
      await step(-1, "key");
      await step(1, "act");
    } finally { (h.app as any).term.info.rows = 60; }
  }, 30_000);

  test("the same packets as a plain ::links list: once a row is picked, PgDn and PgUp page it and keep the pick (PIE-1534)", async () => {
    (h.app as any).term.info.cols = 120;
    (h.app as any).term.info.rows = 30;
    try {
      await h.app.dispatch.act({ action: "section.try", args: { name: "long-collection" } }, { kind: "user" });
      const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "long-collection")).top; };
      const surface = () => stage().pane("packets").surface;
      const links = () => (surface().listsDrawn as any[]).find(l => !l.collection);
      await until(() => links()?.view.pickable().length === 40, "the shelf's forty packets", 8000);
      await stage().dispatch.act({ action: "tile.focus", tile: "packets" }, { kind: "user" });
      // The table's last packet, then j walks on past its edge and the line under it onto the shelf's first packet.
      await stage().dispatch.act({ action: "list.pick", tile: "packets", args: { list: 1, n: 40 } }, { kind: "user" });
      for (let i = 0; i < 6 && surface().listAtCursor()?.key !== links().key; i++) { h.press({ kind: "char", ch: "j" }); h.screen(); }
      const at = () => links().view.indexOf(PERSON, links().view.picked(PERSON));
      expect(surface().listAtCursor()?.key).toBe(links().key);
      expect(at()).toBe(0);
      h.press({ kind: "pgdn" });
      await until(() => at() > 1, "PgDn pages the shelf", 4000);
      const page = at();
      expect(surface().listAtCursor()?.key).toBe(links().key);
      h.press({ kind: "pgdn" });
      await until(() => at() === 2 * page, "PgDn pages it again", 4000);
      h.press({ kind: "pgup" });
      // Back a page of what it shows now (the shelf sits lower in the reader there, so a row or so fewer).
      await until(() => at() < 2 * page - 1, "PgUp pages back one", 4000);
      expect(at()).toBeGreaterThanOrEqual(page);
      expect(surface().hint()).not.toContain("blocks/rows");
    } finally { (h.app as any).term.info.rows = 60; }
  }, 30_000);
});
