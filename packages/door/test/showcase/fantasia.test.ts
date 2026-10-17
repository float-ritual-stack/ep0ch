// PIE-959 (S9): Fantasia, the acceptance test of Landing B. A button in a note runs the fantasia script as the person; its tiles
// float, dance with motion=fantasia and settle, as one layout transaction. An agent's run is the same script attributed to it,
// without the press's invitation. Stopping it mid-dance puts the layout back; undo takes a whole run back in one step.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { SECTIONS } from "../../src/showcase/showcase";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const untilAsync = async (ok: () => Promise<boolean> | boolean, what: string, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

describe.skipIf(!outliner)("the showcase screen: Fantasia", () => {
  const h = useShowcaseScreen();
  const { screen, press, S } = h;
  let app!: typeof h.app, board!: typeof h.board, seeded!: typeof h.seeded;
  beforeAll(() => { ({ app, board, seeded } = h); process.env.EP0CH_MOTION = "full"; });
  afterAll(() => { process.env.EP0CH_MOTION = "off"; });
  const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
  const desk = () => S().stage(SECTIONS.findIndex(s => s.key === "fantasia")).top as any;
  const tiles = () => (desk().layoutGet() as { tiles: { id: string; name: string; float?: boolean }[] }).tiles;
  const names = () => tiles().map(t => t.name).sort();
  const runNoteOf = async (undo: string) => {
    const scripts = await board.children(seeded.notes.scripts.id);
    const kids = (await Promise.all(scripts.map(sc => board.children(sc.id)))).flat();
    return [...scripts, ...kids].find(k => k.text.includes(`script-run::${undo}`));
  };
  const script = () => extensionList()!.extensions.find(e => e.name === "fantasia")!;
  const button = () => { const rows = screen().split("\n"), y = rows.findIndex(r => r.includes("[✦ Fantasia]")); return { x: rows[y]!.indexOf("[✦ Fantasia]") + 3, y }; };

  async function openSection() {
    (app as any).lastInput = 0;
    if (!screen().includes("[✦ Fantasia]")) await app.act({ action: "section", args: { name: "fantasia" }, as: "test-agent" });
    screen();
    await until(() => screen().includes("[✦ Fantasia]"), "the button drawn", 15_000);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "fantasia"), "the script loaded");
  }

  test("the person's press: every tile floats and dances with motion, the run settles them back as one transaction, and one undo is one step", async () => {
    await openSection();
    const start = names();
    desk().settle();
    const size = desk().history.size;
    const b = button();
    click(b.x, b.y);
    // They float (the press invited the run: the tile the person is in too), and the desk draws them moving.
    await untilAsync(() => tiles().filter(t => t.float).length >= 3, "the tiles floated", 20_000);
    await untilAsync(() => desk().moving, "motion in flight", 20_000);
    const openIds = desk().history.openIds() as string[];
    expect(openIds.length).toBe(1);
    const run = openIds[0]!;
    // It ends with every tile back in the layout, the transaction closed; one entry per step it made, all of this run's.
    await untilAsync(() => !desk().history.isOpen(run), "the run's end", 40_000).catch(async e => {
      const note = await runNoteOf(run);
      console.log("RUN NOTE", note?.text.slice(0, 1500), JSON.stringify(tiles().map(t => [t.name, t.float])));
      throw e;
    });
    desk().settle();
    expect(tiles().every(t => !t.float)).toBe(true);
    expect(names()).toEqual(start);
    const note = await runNoteOf(run);
    expect(note?.text).toMatch(/fantasia: \d+ tiles? danced 3 beats at 450 ms, \d+ of them back/);
    expect(desk().history.entriesOf(run).length).toBeGreaterThan(0);
    expect(desk().history.size).toBeGreaterThan(size);
    // Undo takes the whole run back, newest first, in as many presses of one action as it made entries: layout.undo txn= is all of it.
    await app.dispatch.act({ action: "layout.undo", args: { txn: run } }, USER);
    desk().settle();
    expect(desk().history.entriesOf(run).length).toBe(0);
    expect(names()).toEqual(start);
    expect(tiles().every(t => !t.float)).toBe(true);
  }, 90_000);

  test("an agent's run is the same script, attributed to it and without the press's invitation: the tile the person is in stays", async () => {
    await openSection();
    desk().settle();
    const start = names();
    (app as any).lastInput = 0;
    const r = await app.act({ action: `ext.${script().id}.run`, args: { block: seeded.notes.fantasia.id, beats: "2", tempo: "300" }, as: "test-agent" }) as { undo: string; written: string[] };
    await untilAsync(async () => !(await board.get(r.written[0]!))!.text.split("\n")[0]!.includes("· working"), "the agent's run to finish", 40_000);
    const text = (await board.get(r.written[0]!))!.text;
    expect(text).toContain("· done");
    expect(text).toContain("onBehalfOf: test-agent");
    // Without an invitation the tile the person's keys are on is refused, and said.
    expect(text).toContain("stayed put");
    desk().settle();
    expect(names()).toEqual(start);
    expect(tiles().every(t => !t.float)).toBe(true);
    // And the run is one transaction to undo, attributed to the script on the agent's behalf.
    const e = desk().history.forTxn(r.undo);
    expect(e).toBeTruthy();
    expect(e.party).toBe("agent:script:fantasia");
    expect(e.owner).toBe("agent:test-agent");
    await app.dispatch.act({ action: "layout.undo", args: { txn: r.undo } }, USER);   // the person may undo what an agent asked for
    expect(desk().history.entriesOf(r.undo).length).toBe(0);
  }, 90_000);

  test("stopping mid-dance puts the layout back, the floats gone, one line said", async () => {
    await openSection();
    desk().settle();
    const start = names();
    (app as any).lastInput = Date.now();
    const b = button();
    click(b.x, b.y);
    await untilAsync(() => tiles().filter(t => t.float).length >= 3, "the tiles floated", 20_000);
    const run = (desk().history.openIds() as string[])[0]!;
    await board.stopScript(run, USER);
    await untilAsync(() => !desk().history.isOpen(run), "the stopped run's transaction closed", 20_000);
    desk().settle();
    expect(tiles().every(t => !t.float)).toBe(true);
    expect(names()).toEqual(start);
    expect(desk().history.entriesOf(run).length).toBe(0);
  }, 90_000);

  test("a locked screen refuses the dance and says so; nothing moved", async () => {
    await openSection();
    desk().settle();
    const start = names();
    await app.dispatch.act({ action: "layout.lock", args: {} }, USER);
    (app as any).lastInput = 0;
    const r = await app.act({ action: `ext.${script().id}.run`, args: { block: seeded.notes.fantasia.id }, as: "test-agent" }) as { written: string[] };
    await untilAsync(async () => !(await board.get(r.written[0]!))!.text.split("\n")[0]!.includes("· working"), "the run to finish", 30_000);
    expect((await board.get(r.written[0]!))!.text).toContain("the screen is locked");
    expect(names()).toEqual(start);
    expect(tiles().every(t => !t.float)).toBe(true);
    await app.dispatch.act({ action: "layout.lock", args: {} }, USER);
  }, 60_000);
});
