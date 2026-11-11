// The showcase's lens section (PIE-1461): the lab's Jobs note draws a live table from one `lens::` line; pressing a
// stage cell in the reader steps that job's property and the table redraws; the day note's line reads this.page;
// uninstalled, the line says how to bring the lens back, and installing by act brings it. Scratch services; made up.
import { describe, expect, test } from "bun:test";
import { ASKED_IN_PLACE, extensionList, scriptActions } from "../../src/extensions";
import { ReaderPane } from "../../src/desk/panes";
import { MainMenu } from "../../src/screens";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const AGENT: Actor = { kind: "agent", id: "test-agent" };
const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("the showcase screen: the lens", () => {
  const h = useShowcaseScreen();

  /** Presses a square the note's lens drew, in the reader holding it, once it's there; waits for the run's answer. */
  /** Presses the cell once the reader has drawn it (the table redraws after the service's projection does). */
  const pressDrawn = async (tile: string, label: string, actor: Actor) => {
    for (const end = Date.now() + 15_000; ;) {
      try { await h.app.dispatch.act({ action: "button.press", tile, args: { label } }, actor); return; }
      catch (error) {
        if (Date.now() > end) throw new Error(`the lens's ${label} cell never drew: ${error}; screen:\n${h.screen()}`);
        await Bun.sleep(100);
      }
    }
  };
  const press = async (tile: string, label: string, expected: RegExp, actor: Actor = USER) => {
    const { app } = h;
    const before = new Set(app.describe().messages.map(row => row.id));
    await pressDrawn(tile, label, actor);
    const answer = () => app.describe().messages.find(row => !before.has(row.id) && expected.test(row.message));
    await until(() => !!answer(), `${label}'s answer`, 15_000).catch(error => { throw new Error(`${error.message}; last messages: ${JSON.stringify(app.describe().messages.slice(-3))}`); });
    return answer()!.message;
  };
  const chip = async (id: string, key: string) => new RegExp(`\\[${key}::([^\\]]*)\\]`).exec((await h.board.get(id))!.text.split("\n")[0]!)?.[1];

  /** The note's lens as the service drew it (its line's projection), once it holds `holds`. */
  const drawn = async (id: string, holds: string, ms = 15_000) => {
    for (const end = Date.now() + ms; ;) {
      const read = await h.board.request("resources.projection.read", { blockId: id, materialize: true }).catch(() => null);
      const hit = (read?.projections ?? []).map(p => p.output?.markdown ?? "").find(m => m.includes(holds));
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`${holds} never drew on ${id}; last: ${JSON.stringify(read?.projections?.map(p => p.output?.markdown ?? "(none)"))}`);
      await Bun.sleep(100);
    }
  };

  test("the section draws the lab, and a pressed stage cell steps the job's property; the table redraws", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    expect(h.screen()).toContain("draw a live, editable table");
    const jobs = seeded.notes.lensJobs!, day = seeded.notes.lensDay!, order = seeded.notes.lensOrder!;
    expect(jobs && day && order).toBeTruthy();
    const job = async (start: string) => (await board.queryNotes("type=job")).notes.find(m => m.text.startsWith(start))!;
    const gate = await job("Fix the gate latch"), hose = await job("Mend the hose");
    expect(await chip(gate.id, "stage")).toBe("todo");
    expect(await drawn(jobs.id, "| Fix the gate latch | todo | Ada |")).toContain("high · 2");

    const reader = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: jobs.id, name: "jobs" } }, USER) as { tile: string };
    // The stage column's cell is a press of its own: todo → doing, as the person; the table redraws from the change.
    expect(await press(reader.tile, "todo", /Fix the gate latch: stage todo → doing/)).toContain("todo → doing");
    expect(await chip(gate.id, "stage")).toBe("doing");
    expect(await drawn(jobs.id, "| Fix the gate latch | doing | Ada |")).not.toContain("| Fix the gate latch | todo |");
    // Past the last choice the property comes off: done → (unset), and the cell draws a dot to press.
    expect(await press(reader.tile, "done", /Mend the hose: stage done → \(unset\)/)).toContain("(unset)");
    expect(await chip(hose.id, "stage")).toBeUndefined();
    await drawn(jobs.id, "| Mend the hose | · | Sam |");
    // An agent presses the same cell, attributed to it, and lands on the first choice.
    await pressDrawn(reader.tile, "·", AGENT);
    for (const end = Date.now() + 15_000; (await chip(hose.id, "stage")) !== "todo";) { if (Date.now() > end) throw new Error("the agent's press never landed"); await Bun.sleep(100); }
    // Written by the lens's script, not as the person: the door says who.
    expect((await board.get(hose.id))!.author).toBe("ext:lens");
  }, 60_000);

  test("the day note's line reads this.page: one line, each day its own meetings; the order sums its computed column", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    const day = seeded.notes.lensDay!, order = seeded.notes.lensOrder!;
    const one = await drawn(day.id, "Standup");
    expect(one).toContain("Retro");
    expect(one).not.toContain("Planning");
    expect(await drawn(order.id, "| Σ | 10 |  | 28 |")).toContain("| Beans | 5 | 2 | 10 |");
  }, 60_000);

  test("the power bar's Run lens asks every slot the lens declares, query among them, and it completes from the grammar (PIE-1473)", async () => {
    const { app } = h;
    await app.dispatch.act({ action: "section.try", args: { name: "lens" } }, USER);
    const name = scriptActions().find(x => x.action.label === "Run lens")!.action.name;
    await app.dispatch.act({ action: "bar.open", args: { scope: "actions", query: "run lens" } }, USER);
    await app.bar!.settled();
    const preview = () => h.painted.map(plain).join("\n");
    await until(() => preview().includes("ARGUMENTS"), "the script's preview");
    expect(preview()).toContain("query");
    expect(preview()).not.toContain("invitation");
    await app.dispatch.act({ action: name }, USER);
    await until(() => (app.describe() as any).bar?.form, "the lens's form", 5000);
    const form = () => (app.describe() as any).bar.form;
    expect(form().fields.map((f: any) => f.name)).toContain("query");
    expect(form().fields.map((f: any) => f.name)).toEqual(expect.arrayContaining(["view", "columns", "limit", "dir"]));
    expect(form().fields.some((f: any) => f.required)).toBe(false);
    expect(form().line).toBe("lens");
    await app.dispatch.act({ action: "bar.cancel" }, USER).catch(() => {});
  }, 30_000);

  test("Run lens keeps its live line in the reader and one ctrl+z takes it back (PIE-1488)", async () => {
    const { app, board } = h;
    await app.dispatch.act({ action: "section.try", args: { name: "lens" } }, USER);
    const note = await board.createBlock(null, "Garden jobs\nPut the table here.\nKeep these instructions.");
    await app.dispatch.act({ action: "open", tile: "jobs", args: { id: note.id } }, USER);
    await app.dispatch.act({ action: "tile.focus", tile: "jobs" }, USER);
    await app.dispatch.act({ action: "reading.place", tile: "jobs", args: { line: 3 } }, USER);
    const name = scriptActions().find(x => x.action.label === "Run lens")!.action.name;
    await app.dispatch.act({ action: "bar.open", args: { scope: "actions", query: "run lens" } }, USER);
    await app.bar!.settled();
    await app.dispatch.act({ action: "bar.pick", args: { source: "actions", key: name } }, USER);
    await until(() => !!app.bar?.describe().form, "the lens's form");
    await app.dispatch.act({ action: "bar.form", args: { op: "set", field: "query", value: "type=job" } }, USER);
    await app.dispatch.act({ action: "bar.form", args: { op: "set", field: "columns", value: "title,stage" } }, USER);
    const before = new Set(app.describe().messages.map(row => row.id));
    await app.dispatch.act({ action: "bar.form", args: { op: "run" } }, USER);
    await until(() => app.describe().messages.some(row => !before.has(row.id) && /lens.*(done|failed|inserted)/.test(row.message)), "the lens run's result");
    expect((await board.get(note.id))!.text).toBe('Garden jobs\nPut the table here.\nlens:: query="type=job" columns="title,stage"\nKeep these instructions.');
    expect(await drawn(note.id, "Fix the gate latch")).toContain("Mend the hose");
    expect((await board.get(note.id))!.text).toContain("Keep these instructions.");
    const runMessage = app.describe().messages.find(row => !before.has(row.id) && /lens.*(done|failed|inserted)/.test(row.message))!.message;
    h.press({ kind: "char", ch: "z", ctrl: true });
    await until(() => (h.sc.tilesHere()!.pane("jobs") as ReaderPane).surface.msg?.text === note.text, "ctrl+z restored the reader's text");
    expect((await board.get(note.id))!.text).toBe(note.text);
    expect(runMessage).toContain("ctrl+z undoes");
  }, 30_000);

  test("Run lens says where to run it when no note is open (PIE-1488): lens's own run says it, heard when it ends (PIE-1507)", async () => {
    const { app } = h;
    app.push(new MainMenu());
    try {
      const before = new Set(app.describe().messages.map(row => row.id));
      // The door's own word for "asked in place" is door:asked since PIE-1676 (#1404); a bare asked= is a script slot.
      await app.dispatch.act({ action: "script.run", args: { of: "lens", query: "type=job", [ASKED_IN_PLACE]: true } }, USER);
      await until(() => app.describe().messages.some(row => !before.has(row.id) && /open a note/i.test(row.message)), "lens's refusal", 15_000);
    } finally { app.pop(); }
  });

  test("a missing lens slot reports failure and keeps the line editable (PIE-1488)", async () => {
    const { app, board } = h;
    await app.dispatch.act({ action: "section.try", args: { name: "lens" } }, USER);
    const note = await board.createBlock(null, "Unfinished garden lens\nKeep this paragraph.");
    await app.dispatch.act({ action: "open", tile: "jobs", args: { id: note.id } }, USER);
    await app.dispatch.act({ action: "tile.focus", tile: "jobs" }, USER);
    const before = new Set(app.describe().messages.map(row => row.id));
    // The line lands (lens answers its insert, PIE-1507), and the door says what its drawing found wrong, line kept.
    await app.dispatch.act({ action: "script.run", args: { of: "lens", [ASKED_IN_PLACE]: true } }, USER);
    await until(() => app.describe().messages.some(row => !before.has(row.id) && /needs query=/.test(row.message)), "the missing slot said", 15_000);
    expect((await board.get(note.id))!.text).toContain("lens::");
    expect(app.describe().messages.filter(row => !before.has(row.id)).some(row => /lens done/.test(row.message))).toBe(false);
  }, 30_000);

  test.each(["open", "put aside"])("Run lens keeps a %s draft unsaved, reports errors and undoes with ctrl+z (PIE-1488)", async state => {
    const { app, board } = h;
    await app.dispatch.act({ action: "section.try", args: { name: "lens" } }, USER);
    const note = await board.createBlock(null, "Garden draft\nSaved paragraph.");
    const unsaved = `${note.text}\nUnfinished thoughts.`;
    try {
      await app.dispatch.act({ action: "open", tile: "jobs", args: { id: note.id } }, USER);
      await app.dispatch.act({ action: "tile.focus", tile: "jobs" }, USER);
      await app.dispatch.act({ action: "edit.text", tile: "jobs", args: { text: unsaved } }, USER);
      if (state === "put aside") await app.dispatch.act({ action: "edit.close", tile: "jobs", args: { discard: true } }, USER);
      // The person's run answers when it ends (PIE-1507): the line goes in the draft, and a bad line is said at once.
      const said = (words: RegExp) => { const before = new Set(app.describe().messages.map(row => row.id)); return () => until(() => app.describe().messages.some(row => !before.has(row.id) && words.test(row.message)), `${words}`, 15_000); };
      let heard = said(/needs query=/);
      await app.dispatch.act({ action: "script.run", args: { of: "lens", [ASKED_IN_PLACE]: true } }, USER);
      await heard();
      const draft = (h.sc.tilesHere()!.pane("jobs") as ReaderPane).surface.draft!;
      expect(draft.text).toContain("lens::");
      expect(draft.text).toContain("Unfinished thoughts.");
      expect((await board.get(note.id))!.text).toBe(note.text);
      await app.dispatch.act({ action: "draft.undo", tile: "jobs" }, USER);
      expect(draft.text).toBe(unsaved);
      heard = said(/ctrl\+z undoes/);
      await app.dispatch.act({ action: "script.run", args: { of: "lens", query: "type=job", [ASKED_IN_PLACE]: true } }, USER);
      await heard();
      expect(draft.text).toContain('lens:: query="type=job"');
      h.press({ kind: "char", ch: "z", ctrl: true });
      await until(() => draft.text === unsaved, "ctrl+z restored the unsaved draft");
      expect((await board.get(note.id))!.text).toBe(note.text);
    } finally {
      if ((h.sc.tilesHere()!.pane("jobs") as ReaderPane).surface.draft) await app.dispatch.act({ action: "edit.close", tile: "jobs", args: { discard: true } }, USER);
      await board.trash(note.id);
    }
  }, 30_000);

  test("uninstalled, the lens's lines say so; installed by act, they draw again without a second lab", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "lens" } }, USER);
    const order = seeded.notes.lensOrder!;
    await app.dispatch.act({ action: "extensions.uninstall", args: { id: "lens", demo: "keep" } }, USER);
    await app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "lens"), "lens removed from the door");
    expect((await board.get(order.id))!.text).toContain("lens::");
    const rows = await app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "lens" } }, AGENT) as { rows: { label: string }[] };
    expect(rows.rows.some(r => r.label === "install Lens")).toBe(true);
    const installed = await app.dispatch.act({ action: "extensions.install", args: { id: "lens" } }, AGENT) as { state?: string };
    expect(installed.state).toBe("active");
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.some(e => e.id === "lens"), "lens installed in the door");
    expect((await board.queryNotes("type=seed-line")).notes).toHaveLength(3);
  }, 40_000);
});
