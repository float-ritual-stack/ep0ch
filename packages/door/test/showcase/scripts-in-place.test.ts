// PIE-955: the showcase's "Scripts in place" section. A render-mode script (beds-table::) and a ::= line draw under their
// lines in the reader, read the note's owner, and are drawn again when it changes; drawing writes nothing. One of the
// showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen on it.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: scripts in place", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("a render script and a ::= line draw under their lines, redraw when the note changes, and write nothing", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts-in-place" }, as: "test-agent" });
    screen();
    const id = seeded.notes.scriptsInPlace.id;
    const first = (await board.get(id))!;
    // The script's table (Owner/Week columns) and the ::= line's sentence, both under their lines.
    await until(() => screen().includes("Sam sows beans") && /Owner\s.*Week/.test(screen()), "both lines drawn", 15_000);
    // Drawing wrote nothing: the note's text and its children are as seeded.
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
    expect(await board.children(id)).toHaveLength(0);
    // The note they read changes: both redraw.
    await board.update(id, after.text.replace("[owner::Sam]", "[owner::Robin]"), after.revision!, USER);
    await until(() => screen().includes("Robin sows beans") && /Robin\s.*42/.test(screen()) && !screen().includes("Sam sows"), "both lines redrawn", 15_000);
  }, 40_000);

  test("the published showcase draws its visible seed count through both embed forms", async () => {
    const page = await board.resolvePage("showcase-published-script-lines");
    const template = await board.resolvePage("showcase-seed-count");
    expect(page.block?.id).toBeDefined();
    expect(template.block?.id).toBeDefined();
    await board.request("resources.projection.read", { blockId: template.block!.id, materialize: true });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rendered = await board.request<{ text: string }>("notes.render", { blockId: page.block!.id, format: "html", audience: "public" });
      if ((rendered.text.match(/Seeds shown here: 1/g) ?? []).length >= 3 &&
        (rendered.text.match(/Shelf complete: true; children: 0/g) ?? []).length === 2) {
        expect(rendered.text).not.toContain("Seeds shown here: 2");
        expect(rendered.text).not.toContain("hidden here");
        expect(rendered.text).toContain("not shared");
        expect(rendered.text).not.toContain("PRIVATE_SCRIPT_SECRET");
        break;
      }
      if (Date.now() > deadline) throw new Error(`The published showcase did not draw both counts: ${rendered.text}`);
      await Bun.sleep(25);
    }
  }, 15_000);

});
