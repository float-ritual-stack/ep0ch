// The answer tile beside an edit follows the ask it shows, by mouse (PIE-1771, PIE-1770): a click on another ask's
// `show ▸` retitles the tile in the frame that swaps it, a newly answered ask in the same words as a saved one takes the
// tile, and a quick second click on `show ▸` (a double click) still shows the answer. Real panes over a scratch
// service with a made-up agent; made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "./scratch";
import { cellOf, TallyDoors, type Pane } from "./tally-pane";

/** A frame plus tmux's round trip: what "at once" is here. */
const AT_ONCE_MS = 400;

describe.skipIf(!outliner || !Bun.which("tmux"))("the answer tile follows the ask by mouse", () => {
  const doors = new TallyDoors();
  beforeAll(() => doors.start(), 30_000);
  afterAll(() => doors.stop());

  /** An edit of a made-up note at 177×30 with `asks` answered in it, the tile beside on the last. */
  async function edit(title: string, ...asks: string[]) {
    const p = await doors.pane(await doors.create(`${title}\nstake the runners`), title, 177, 30);
    p.keys("e");
    await until(() => p.capture().includes("editing"), "the edit");
    for (const a of asks) await doors.ask(p, a);
    return p;
  }
  /** The tile's title (its single-line frame's top), and each row of ask `ask`'s words after it, as drawn. */
  const tileTitle = (p: Pane) => p.capture().split("\n")[0]!.split("┌─ ")[1]?.split(" ─")[0] ?? "";
  const rowsOf = (p: Pane, ask: string) => p.capture().split("\n").filter(l => l.includes(`${ask} ·`)).map(l => l.split(`${ask} · `)[1]!.split("║")[0]!.trim());

  test("a click on another ask's show ▸ retitles the tile in the frame that swaps it", async () => {
    const p = await edit("Bean rows", "@tally the beans", "@tally the peas");
    try {
      expect(tileTitle(p)).toBe("@tally the peas");
      p.click(cellOf(p.capture(), "show ▸")!);
      await until(() => p.capture().includes("counted: the beans"), "the beans' answer in the tile", AT_ONCE_MS);
      // No input after the click: the frame that drew the answer draws its title.
      await until(() => tileTitle(p) === "@tally the beans", "the tile retitled", AT_ONCE_MS).catch(e => { throw new Error(`${e.message}: "${tileTitle(p)}"`); });
    } finally { p.close(); }
  }, 30_000);

  test("a newly answered ask in the same words as a saved one takes the tile", async () => {
    const p = await edit("Pea sticks", "@tally the canes", "@tally the twine");
    try {
      p.keys("C-s");
      await until(() => !p.capture().includes("editing"), "saved");
      p.keys("e");
      await until(() => p.capture().includes("editing"), "the edit again");
      await doors.ask(p, "@tally the canes");
      // The new ask's row names the tile's side; the saved twin's says show ▸.
      await until(() => rowsOf(p, "@tally the canes").length === 2 && rowsOf(p, "@tally the canes")[1]!.endsWith("beside ▸"), "the new twin credited", 3000).catch(e => { throw new Error(`${e.message}: ${JSON.stringify(rowsOf(p, "@tally the canes"))}`); });
      expect(rowsOf(p, "@tally the canes")[0]).toEndWith("show ▸");
    } finally { p.close(); }
  }, 30_000);

  test("a second click on show ▸ within a double click's time shows the answer; a double click on a word still selects it", async () => {
    const p = await edit("Shed rota", "@tally the hoes", "@tally the rakes");
    const close = async () => { p.click(cellOf(p.capture(), "x┐")!); await until(() => !p.capture().includes("┌─"), "the tile closed"); };
    try {
      // Shown by one click, closed at once, shown again by the next click on the same row: no tile came back before.
      await close();
      const show = cellOf(p.capture(), "show ▸")!;
      p.click(show);
      // Red once in the nightly's parallel run and never again alone or under load (PIE-1805): a timeout shows the pane.
      await until(() => p.capture().includes("┌─"), "the tile back").catch(e => { throw new Error(`${e.message} (clicked ${JSON.stringify(show)})\n${p.capture()}`); });
      await close();
      p.click(show);
      await until(() => p.capture().includes("┌─ @tally the hoes"), "the tile back by the quick second click", 1500).catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
      // A double click on the other ask's show ▸ shows its answer, and nothing else: its callout stays shut.
      await Bun.sleep(450);
      const other = cellOf(p.capture(), "show ▸")!;
      p.click(other); p.click(other);
      await until(() => p.capture().includes("┌─ @tally the rakes"), "the rakes shown by a double click", AT_ONCE_MS);
      await Bun.sleep(AT_ONCE_MS);
      expect([tileTitle(p), p.capture().includes("[!note]")]).toEqual(["@tally the rakes", false]);
      // A double click on a word in the text selects it, as before.
      await Bun.sleep(450);
      const word = cellOf(p.capture(), "runners")!;
      p.click(word); p.click(word);
      await until(() => p.capture().includes("copied 7 chars"), "the word selected and copied (runners)").catch(e => { throw new Error(`${e.message}\n${p.capture()}`); });
    } finally { p.close(); }
  }, 30_000);
});
