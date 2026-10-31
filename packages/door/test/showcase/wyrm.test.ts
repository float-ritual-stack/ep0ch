// The showcase's wyrm section: Legend of the Ep0ch Wyrm, installed with its demo town. Pressing the town board's
// "join the realm" makes a player note; pressing a move on that player's sheet changes its chips; uninstalled, a
// press names the reinstall command, and installing by act brings the moves back. Scratch services; all made up.
import { describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { loadShowcase } from "../../src/showcase/seed";
import { useShowcaseScreen } from "./harness";
import { SECTIONS } from "../../src/showcase/showcase";
import type { ReaderPane } from "../../src/desk/panes";

const AGENT: Actor = { kind: "agent", id: "test-agent" };

describe.skipIf(!outliner)("the showcase screen: the wyrm", () => {
  const h = useShowcaseScreen();

  /** Presses a labelled button in a note and waits for the run's answer in the status messages. */
  /** `note=` presses a ::button written in the note; `tile=` presses a square the note's view drew in that reader. */
  const press = async (where: { note: string } | { tile: string }, label: string, expected: RegExp, actor: Actor = USER) => {
    const { app } = h;
    const before = new Set(app.describe().messages.map(row => row.id));
    if ("note" in where) await app.dispatch.act({ action: "button.press", args: { note: where.note, label } }, actor);
    else {
      // The sheet draws after the note: press once its square is there.
      for (const end = Date.now() + 15_000; ;) {
        try { await app.dispatch.act({ action: "button.press", tile: where.tile, args: { label } }, actor); break; }
        catch (error) {
          if (Date.now() > end) throw new Error(`the sheet's ${label} square never drew: ${error}; screen:\n${h.screen()}`);
          await Bun.sleep(100);
        }
      }
    }
    const answer = () => app.describe().messages.find(row => !before.has(row.id) && expected.test(row.message));
    await until(() => !!answer(), `${label}'s answer`, 15_000).catch(error => { throw new Error(`${error.message}; last messages: ${JSON.stringify(app.describe().messages.slice(-3))}`); });
    return answer()!.message;
  };
  const chip = async (id: string, key: string) => {
    const note = await h.board.get(id);
    return new RegExp(`\\[${key}::([^\\]]*)\\]`).exec(note!.text.split("\n")[0]!)?.[1];
  };

  test("the town board's press makes a player, and the player's sheet plays a move on its chips", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "wyrm" } }, USER);
    expect(h.screen()).toContain("play a door game whose state is notes");
    const town = seeded.notes.wyrm!;
    expect(town).toBeDefined();
    expect(seeded.notes.wyrmSleeper).toBeDefined();
    // Opening the showcase again finds the extension's demo notes under its page, with no lookup of the wyrm's own.
    const again = (await loadShowcase(board))!.notes;
    expect(again.wyrm?.id).toBe(town.id);
    expect(again.wyrmSleeper?.id).toBe(seeded.notes.wyrmSleeper!.id);

    expect(await press({ note: town.id }, "join the realm", /joins Wyrmhold/)).toMatch(/^Stranger \d+ joins Wyrmhold/);
    const players = (await board.queryNotes("type=wyrm-player")).notes;
    const player = players.find(m => m.text.startsWith("Stranger "))!;
    expect(player.parentId).toBe(town.id);
    expect(await chip(player.id, "turns")).toBe("15");

    // A square the sheet drew (a row of the fields' table) is pressed by label on a note open nowhere, by an agent, with nothing in front of it.
    expect(await press({ note: player.id }, "Dozing Gerald", /Dozing Gerald/, AGENT)).toMatch(/kill|wakes/);
    const ambushes = (await board.queryNotes(`parent:((${town.id})) type=wyrm-event verb=ambush`)).notes;
    expect(ambushes).toHaveLength(1);
    const event = (await board.get(ambushes[0]!.id))!;
    expect(event.text).toContain(`[by::((${player.id}))]`);
    expect(event.text).toContain(`[on::((${seeded.notes.wyrmSleeper!.id}))]`);
    const balances = [Number(await chip(player.id, "gold")), Number(await chip(seeded.notes.wyrmSleeper!.id, "gold"))];
    expect(balances.sort((a, b) => a - b)).toEqual([0, 170]);
    expect(await chip(player.id, "wyrm-through")).toBe(await chip(seeded.notes.wyrmSleeper!.id, "wyrm-through"));
    const sheet = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: player.id, name: "sheet" } }, USER) as { tile: string };
    await press({ tile: sheet.tile }, "forest", /steps out|gem|purse|fairy/);
    expect(await chip(player.id, "turns")).toBe("14");
    // The news has today's arrival on the town.
    const events = (await board.queryNotes("type=wyrm-event")).notes.map(m => m.text);
    expect(events).toContainEqual(expect.stringContaining("wanders into Wyrmhold"));
  }, 40_000);

  test("an ambush folds both balances when the attacker's sheet is open in a draft", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "wyrm" } }, USER);
    const town = seeded.notes.wyrm!.id;
    const day = new Date().toISOString().slice(0, 10);
    const ash = await board.createBlock(town, `Ash [type::wyrm-player] [hp::100] [str::200] [gold::50] [ambushes::3] [day::${day}]\nwyrm-sheet::\n\nKeep my notes here.`);
    const birch = await board.createBlock(town, `Birch [type::wyrm-player] [hp::1] [gold::40] [rest::fields] [day::${day}]\nwyrm-sheet::`);
    const opened = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: ash.id, name: "draft-player" } }, USER) as { tile: string };
    const stage = h.S().stage(SECTIONS.findIndex(s => s.key === "wyrm")).top;
    const reader = stage.paneNamed("draft-player") as ReaderPane;
    await until(() => reader.surface.msg?.id === ash.id, "the player's sheet is loaded");
    await stage.startSession(reader, "edit");
    const draft = reader.surface.draft!;
    await stage.dispatch.press("draft.place", { line: 4, col: 1 }, opened.tile);
    await stage.dispatch.press("draft.paste", { text: "Still writing. " }, opened.tile);
    try {
      const result = await app.dispatch.act({ action: "button.press", args: { note: ash.id, label: "Birch" } }, AGENT) as { state: string; message: string };
      expect(result.state).toBe("done");
      expect(draft.text).toContain("[gold::90]");
      expect(draft.text).toContain("Still writing. Keep my notes here.");
      expect(await chip(ash.id, "gold")).toBe("50");
      expect(await chip(birch.id, "gold")).toBe("0");
      expect(await stage.dispatch.press("edit.save", {}, opened.tile)).toMatchObject({ saved: false, warning: expect.stringContaining("this save changes properties") });
      expect(await stage.dispatch.press("edit.save", {}, opened.tile)).toMatchObject({ saved: true });
      expect(await chip(ash.id, "gold")).toBe("90");
      expect(await chip(ash.id, "wyrm-through")).toBe(await chip(birch.id, "wyrm-through"));
    } finally { if (reader.surface.draft) await stage.dispatch.press("edit.close", { discard: true }, opened.tile); }
  }, 30_000);

  test("uninstalled, its moves name the reinstall command; installed by act, the screens and moves come back", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "wyrm" } }, USER);
    const town = seeded.notes.wyrm!;
    await app.dispatch.act({ action: "extensions.uninstall", args: { id: "wyrm", demo: "keep" } }, USER);
    await app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "wyrm"), "wyrm removed from the door");
    expect((await board.get(town.id))!.text).toContain("wyrm-town::");
    // The screens went with the extension, so the town draws no join button now; the move itself names its install (`ep0ch act wyrm …`).
    await expect(app.dispatch.act({ action: "button.press", args: { note: town.id, label: "join the realm" } }, AGENT)).rejects.toThrow("it has none");
    await expect(app.act({ action: "wyrm", args: { do: "join" }, as: "test-agent" })).rejects.toThrow("ep0ch act extensions.install id=wyrm");
    const rows = await app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "wyrm" } }, AGENT) as { rows: { label: string }[] };
    expect(rows.rows.some(r => r.label === "install Legend of the Ep0ch Wyrm")).toBe(true);

    const installed = await app.dispatch.act({ action: "extensions.install", args: { id: "wyrm" } }, AGENT) as { state?: string };
    expect(installed.state).toBe("active");
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.some(e => e.id === "wyrm"), "wyrm installed in the door");
    expect(await press({ note: town.id }, "join the realm", /joins Wyrmhold/)).toMatch(/joins Wyrmhold/);
    // Reinstalling doesn't write the demo twice.
    expect((await board.queryNotes("type=wyrm-world")).notes).toHaveLength(1);
  }, 40_000);
});
