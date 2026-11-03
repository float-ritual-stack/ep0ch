// PIE-1529: the showcase's long-collection section. Forty seed packets in a table, more than the reader holds: PgDn
// moves the pick one screen of rows (the reader following it), PgUp moves back one, and act's list.step page=true
// does what PgDn does. Driven by the person's keys and by act on the seeded outline.
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
      const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "packets", args }, { kind: "user" }) as Promise<any>;
      const list = () => (stage().pane("packets").surface.listsDrawn as any[])[0];
      await until(() => list()?.view.pickable().length === 40, "the forty packets", 8000);
      await act("tile.focus");
      await act("list.enter", { on: true });
      await act("list.pick", { n: 1 });
      const at = () => list().view.indexOf(PERSON, list().view.picked());
      const seen = () => h.screen().includes(list().view.picked().label.split(":")[0]);
      h.press({ kind: "pgdn" });
      await until(() => at() > 0, "PgDn moves the pick", 4000);
      const page = at();
      expect(page).toBeLessThan((stage().pane("packets").surface as any).bodyRoom);
      if (cols === 120) expect(page).toBeGreaterThan(4);
      await until(seen, "the picked packet is on screen", 4000);
      h.press({ kind: "pgdn" });
      await until(() => at() === 2 * page, "a second PgDn, one more screen", 4000);
      h.press({ kind: "pgup" });
      await until(() => at() === page, "PgUp, one screen back", 4000);
      expect(await act("list.step", { by: 1, page: true })).toMatchObject({ row: 2 * page + 1 });
      await until(seen, "the packet act picked is on screen", 4000);
    } finally { (h.app as any).term.info.rows = 60; }
  }, 30_000);
});
