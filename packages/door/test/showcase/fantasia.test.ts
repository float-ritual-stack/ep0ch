// PIE-959 (S9): Fantasia, the acceptance test of Landing B. A button in a note runs the fantasia script as the person; its tiles
// float, dance with motion=fantasia and settle, as one layout transaction. An agent's run is the same script attributed to it,
// without the press's invitation. Stopping it mid-dance puts the layout back; undo takes a whole run back in one step.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { SECTIONS } from "../../src/showcase/showcase";
import { USER } from "../../src/socket";
import { INVITES } from "../../src/surface/invite";
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
    if (S().shown !== SECTIONS.findIndex(x => x.key === "fantasia")) await app.act({ action: "section", args: { name: "fantasia" }, as: "test-agent" });
    screen();
    await until(() => screen().includes("[✦ Fantasia]"), "the button drawn", 15_000);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "fantasia"), "the script loaded");
  }

  test("the person's press: every tile floats and dances with motion, the run takes itself back to the layout it began as one transaction", async () => {
    await openSection();
    const start = names();
    desk().settle();
    const b = button();
    click(b.x, b.y);
    // They float (the press invited the run, so the tile the person is in too), and the desk draws them moving.
    await untilAsync(() => tiles().filter(t => t.float).length >= 3, "the tiles floated", 20_000);
    expect(tiles().find(t => t.name === "notes")?.float).toBe(true);
    await untilAsync(() => desk().moving, "motion in flight", 20_000);
    const openIds = desk().history.openIds() as string[];
    expect(openIds.length).toBe(1);
    const run = openIds[0]!;
    await untilAsync(() => !desk().history.isOpen(run), "the run's end", 40_000);
    desk().settle();
    // No layout was asked: the run took its own changes back, so the screen is as it began, and its transaction is closed.
    expect(tiles().every(t => !t.float)).toBe(true);
    expect(names()).toEqual(start);
    expect(desk().history.entriesOf(run).length).toBe(0);
    const note = await runNoteOf(run);
    expect(note?.text).toMatch(/fantasia: 3 tiles danced 3 beats at 450 ms, the layout as it began/);
    expect(note?.text).toContain("onBehalfOf: user · button by user");
  }, 90_000);

  test("no frame of the dance goes sparse: every frame from the press to the settle holds the tiles (a tile vanishing for a frame would be a flash)", async () => {
    await openSection();
    desk().settle();
    const ink = () => [...desk().render(desk().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "")].filter(c => c !== " " && c !== "\n").length;
    const rest = ink();
    const b = button();
    click(b.x, b.y);
    const seen: number[] = [];
    const end = Date.now() + 40_000;
    let started = false;
    while (Date.now() < end) {
      seen.push(ink());
      if (tiles().some(t => t.float)) started = true;
      if (started && desk().history.openIds().length === 0) break;
      await Bun.sleep(15);
    }
    desk().settle();
    expect(started).toBe(true);
    expect(seen.length).toBeGreaterThan(20);
    const low = Math.min(...seen);
    expect(low).toBeGreaterThan(rest * 0.5);
  }, 90_000);

  test("a run that leaves the tiles where they danced is one transaction: one undo, the layout as it was", async () => {
    await openSection();
    desk().settle();
    const start = names();
    (app as any).lastInput = Date.now();
    const run = await app.dispatch.act({ action: `ext.${script().id}.run`, args: { block: seeded.notes.fantasia.id, beats: "2", tempo: "300", stay: "1", invitation: INVITES.mint("you") } }, USER) as { undo: string; written: string[] };
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.split("\n")[0]!.includes("· working"), "the run to finish", 40_000);
    await untilAsync(() => !desk().history.isOpen(run.undo), "the run's end", 20_000);
    desk().settle();
    expect(tiles().filter(t => t.float).length).toBeGreaterThanOrEqual(3);
    expect(desk().history.entriesOf(run.undo).length).toBe(1);
    expect(desk().history.forTxn(run.undo).steps).toBeGreaterThan(5);
    // One undo, whole: the four tiles as they were, none floating.
    await app.dispatch.act({ action: "layout.undo", args: { txn: run.undo } }, USER);
    desk().settle();
    expect(desk().history.entriesOf(run.undo).length).toBe(0);
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
    // No layout was asked. It took its own changes back (layout.undo) where it may; where the person's section holds the screen
    // (the showcase), it leaves the tiles where they danced and says so, and one undo puts them back.
    expect(text).toMatch(/the layout as it began|left where they danced/);
    await untilAsync(() => !desk().history.isOpen(r.undo), "the agent's run's end", 20_000);
    if (desk().history.entriesOf(r.undo).length) await app.dispatch.act({ action: "layout.undo", args: { txn: r.undo } }, USER);   // the person may undo what an agent asked for
    desk().settle();
    expect(names()).toEqual(start);
    expect(tiles().every(t => !t.float)).toBe(true);
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
