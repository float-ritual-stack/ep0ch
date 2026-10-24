// Legend of the Ep0ch Wyrm (extensions/wyrm): a door game built from parts that exist. Installing it seeds a town,
// a sleeping player and the two render scripts; `wyrm do=…` plays moves as the person pressing; the sheet and town
// board draw what the chips say; uninstalling leaves the notes and refuses the moves with the reinstall command.
// A scratch service in a temp folder; every note and name is made up.
import { expect, test } from "bun:test";
import type { ScriptEnded } from "@ep0ch/outline-core/protocol";
import { setup, until } from "./script-harness";

async function realm() {
  const h = await setup();
  const ended = new Map<string, ScriptEnded>();
  let connected = false;
  const watcher = h.client.watch({ client: { clientId: "wyrm-player", role: "observer", contextId: "wyrm" },
    onConnect: () => { connected = true; }, onEvent: e => { if (e.ended) ended.set(e.ended.run, e.ended); } });
  await until("the answer reader", () => connected);
  const installed = await h.client.request<{ state?: string; page?: string }>({ action: "extensions.install", extension: "wyrm" });
  const one = (where: string) => h.store.queryBlocks({ where }).blocks[0]!;
  /** One press: `wyrm do=<verb>` on a note, answered when the run ends. */
  const play = async (blockId: string, args: Record<string, string>) => {
    const run = await h.client.request<{ undo: string }>({ action: "extensions.act", extension: "script:wyrm", extensionAction: "run", blockId, args, clientId: "wyrm-player" });
    const answer = await until(`wyrm ${JSON.stringify(args)}`, () => ended.get(run.undo));
    return answer;
  };
  const chips = (id: string) => Object.fromEntries(h.store.require(id).properties.map(p => [p.key, p.value]));
  return { ...h, installed, one, play, chips, stop: () => watcher.stop() };
}

test("installing the wyrm seeds a town; joining, the forest, the healer and the bank play on the player's chips", async () => {
  const { installed, one, play, chips, store, stop } = await realm();
  try {
    expect(installed.state).toBe("active");
    const town = one("type=wyrm-world");
    expect(store.require(town.id).text).toContain("wyrm-town::");
    expect(one("type=wyrm-news")).toBeDefined();
    expect(one("script=wyrm-sheet")).toBeDefined();

    const joined = await play(town.id, { do: "join", name: "Ash Quill" });
    expect(joined.reason).toBe("done");
    expect(joined.message).toBe("Ash Quill joins Wyrmhold: open their note to play");
    const ash = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Ash Quill" + " ["))!;
    expect(store.require(ash.id).parentId).toBe(town.id);
    expect(store.require(ash.id).text).toContain("wyrm-sheet::");
    expect(chips(ash.id)).toMatchObject({ level: "1", hp: "20", gold: "50", turns: "15", wields: "bare fists" });
    expect(store.queryBlocks({ where: "type=wyrm-event" }).blocks.map(b => b.text)).toContainEqual(expect.stringContaining("Ash Quill wanders into Wyrmhold"));

    // Into the forest until something steps out, then fight it to the end, one press a blow.
    let foe: string | undefined;
    for (let i = 0; i < 15 && !foe; i++) {
      await play(ash.id, { do: "forest" });
      foe = chips(ash.id).foe;
    }
    expect(foe).toBeString();
    expect(Number(chips(ash.id).turns)).toBeLessThan(15);
    expect((await play(ash.id, { do: "forest" })).message).toContain("is still in front of you");
    for (let i = 0; i < 60 && chips(ash.id).foe && chips(ash.id).dead !== "1"; i++) await play(ash.id, { do: "hit" });
    expect(chips(ash.id).foe).toBeUndefined();
    const after = chips(ash.id);
    if (after.dead === "1") {
      expect((await play(ash.id, { do: "forest" })).message).toBe("Ash Quill is dead until tomorrow");
    } else {
      expect(Number(after.xp)).toBeGreaterThan(0);
      const bank = await play(ash.id, { do: "deposit" });
      expect(bank.message).toMatch(/^deposited [\d,]+ gold/);
      expect(chips(ash.id)).toMatchObject({ gold: "0" });
      expect((await play(ash.id, { do: "heal" })).message).toMatch(/nothing to mend|costs \d+ gold a point/);
    }
    // A verb it doesn't know names the ones it does.
    const wrong = await play(ash.id, { do: "dance" });
    expect(wrong.reason).not.toBe("done");
  } finally { stop(); }
}, 60_000);

test("a player asleep in the fields can be ambushed; the news says so and the inn keeps you safe", async () => {
  const { one, play, chips, store, stop } = await realm();
  try {
    const town = one("type=wyrm-world");
    const gerald = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Dozing Gerald" + " ["))!;
    await play(town.id, { do: "join", name: "Brick" });
    const brick = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Brick" + " ["))!;
    const ambush = await play(brick.id, { do: "ambush", target: gerald.id });
    expect(ambush.reason).toBe("done");
    const news = store.queryBlocks({ where: "type=wyrm-event" }).blocks.map(b => b.text);
    if (chips(gerald.id).dead === "1") {
      expect(ambush.message).toBe("you kill Dozing Gerald in their sleep: +120 gold, +" + ambush.message!.split("+").pop());
      expect(chips(brick.id).gold).toBe("170");
      expect(news).toContainEqual(expect.stringContaining("found Dozing Gerald asleep in the fields"));
      expect((await play(brick.id, { do: "ambush", target: gerald.id })).message).toBe("Dozing Gerald is already dead");
      // Killed today, he stays dead today, though his day had been long past.
      expect((await play(gerald.id, { do: "forest" })).message).toBe("Dozing Gerald is dead until tomorrow");
    } else {
      expect(chips(brick.id).dead).toBe("1");
      expect(news).toContainEqual(expect.stringContaining("Dozing Gerald woke up and won"));
    }
    // A death from an earlier day doesn't count: they've risen, so an ambush finds them.
    const ghost = store.create("Old Wren [type::wyrm-player] [level::1] [hp::0] [maxhp::20] [str::10] [def::1] [gold::5] [dead::1] [day::2001-02-03] [rest::fields]\nwyrm-sheet::", town.id, "user");
    await play(town.id, { do: "join", name: "Fen" });
    const fen = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Fen ["))!;
    expect((await play(fen.id, { do: "ambush", target: ghost.id })).message).not.toBe("Old Wren is already dead");
    // Asleep at the inn, nobody reaches you.
    await play(town.id, { do: "join", name: "Cinder" });
    const cinder = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Cinder" + " ["))!;
    expect((await play(cinder.id, { do: "sleep", where: "inn" })).message).toContain("Nobody can reach you there");
    expect(chips(cinder.id)).toMatchObject({ rest: "inn", gold: "30" });
    await play(town.id, { do: "join", name: "Dusk" });
    const dusk = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Dusk" + " ["))!;
    expect((await play(dusk.id, { do: "ambush", target: cinder.id })).message).toBe("Cinder isn't sleeping in the fields");
    // A new day: Gerald's day is long past, so his first move gives his turns back.
    await play(gerald.id, { do: "sleep", where: "fields" });
    expect(Number(chips(gerald.id).turns)).toBe(15);
  } finally { stop(); }
}, 60_000);

test("the sheet and the town board draw the chips, and uninstalling refuses the moves with the reinstall command", async () => {
  const { one, play, store, client, draw, output, stop } = await realm();
  try {
    const town = one("type=wyrm-world");
    await play(town.id, { do: "join", name: "Ember" });
    const ember = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Ember" + " ["))!;
    await draw(ember.id);
    const sheet = await until("the sheet", () => output(ember.id).find(o => o?.includes("Ember")));
    expect(sheet).toContain("level 1");
    expect(sheet).toContain("forest");
    expect(sheet).toContain("Dozing Gerald"); // asleep in the fields, so on everyone's sheet
    await draw(town.id);
    const board = await until("the town board", () => output(town.id).find(o => o?.includes("Daily News")));
    expect(board).toContain("Ember");
    expect(board).toContain("Ember wanders into Wyrmhold");

    const removed = await client.request<{ removed: boolean }>({ action: "extensions.uninstall", extension: "wyrm", demo: "keep" });
    expect(removed.removed).toBe(true);
    expect(store.require(ember.id).text).toContain("wyrm-sheet::");
    await expect(client.request({ action: "extensions.act", extension: "script:wyrm", extensionAction: "run", blockId: ember.id, args: { do: "forest" } }))
      .rejects.toThrow();
  } finally { stop(); }
}, 60_000);
