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
  const today = new Date().toISOString().slice(0, 10);
  /** A made-up player with exactly these chips, so a fight's outcome isn't left to the dice. */
  const player = (name: string, chipsOf: Record<string, string | number>, parent: string) =>
    h.store.create(`${name} [type::wyrm-player] ${Object.entries({ level: 1, maxhp: 20, str: 10, def: 1, gold: 0, turns: 15, ambushes: 3, day: today, ...chipsOf }).map(([k, v]) => `[${k}::${v}]`).join(" ")}\nwyrm-sheet::`, parent, "user").id;
  const chips = (id: string) => Object.fromEntries(h.store.require(id).properties.map(p => [p.key, p.value]));
  return { ...h, installed, one, play, chips, today, player, stop: () => watcher.stop() };
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
      const purse = chips(ash.id).gold;
      const bank = await play(ash.id, { do: "deposit" });
      expect(bank.message).toMatch(/^deposited [\d,]+ gold/);
      expect(chips(ash.id)).toMatchObject({ gold: "0", bank: purse });
    }
    // A verb it doesn't know names the ones it does.
    const wrong = await play(ash.id, { do: "dance" });
    expect(wrong.reason).not.toBe("done");
  } finally { stop(); }
}, 60_000);

test("a player asleep in the fields can be ambushed; the news says so and the inn keeps you safe", async () => {
  const { one, play, chips, store, today, player, stop } = await realm();
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
      // Gold moves, it isn't minted: Brick's 50 went to Gerald's 120.
      expect(ambush.message).toBe("Dozing Gerald wakes and kills you. They keep your 50 gold");
      expect(chips(brick.id).gold).toBe("0");
      expect(chips(gerald.id).gold).toBe("170");
    }
    // A death from an earlier day doesn't count: they've risen whole, so the ambush is a real fight and the kill is new.
    const ghost = player("Old Wren", { hp: 0, maxhp: 20, gold: 5, dead: 1, day: "2001-02-03", rest: "fields" }, town.id);
    const fen = player("Fen", { hp: 20, str: 200, gold: 0 }, town.id);
    const wren = await play(fen, { do: "ambush", target: ghost });
    expect(wren.message).toStartWith("you kill Old Wren in their sleep: +5 gold");
    expect(chips(ghost)).toMatchObject({ hp: "0", gold: "0", dead: "1", day: today });
    expect(chips(fen).gold).toBe("5");
    // The revision check before the two writes passes on an untouched pair: the ambush runs and spends one.
    await play(town.id, { do: "join", name: "Gnat" });
    const gnat = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Gnat ["))!;
    const mark = store.create("Pale Ivy [type::wyrm-player] [level::1] [hp::20] [maxhp::20] [str::10] [def::1] [gold::9] [day::2001-02-03] [rest::fields]\nwyrm-sheet::", town.id, "user");
    expect((await play(gnat.id, { do: "ambush", target: mark.id })).reason).toBe("done");
    expect(Number(chips(gnat.id).ambushes)).toBe(2);
    // Asleep at the inn, nobody reaches you.
    await play(town.id, { do: "join", name: "Cinder" });
    const cinder = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Cinder" + " ["))!;
    expect((await play(cinder.id, { do: "sleep", where: "inn" })).message).toContain("Nobody can reach you there");
    expect(chips(cinder.id)).toMatchObject({ rest: "inn", gold: "30" });
    await play(town.id, { do: "join", name: "Dusk" });
    const dusk = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Dusk" + " ["))!;
    expect((await play(dusk.id, { do: "ambush", target: cinder.id })).message).toBe("Cinder isn't sleeping in the fields");
    // A new day: a player whose day is long past, never ambushed, gets turns back at their first move.
    const sleeper = store.create("Moth Wick [type::wyrm-player] [level::1] [hp::12] [maxhp::20] [str::10] [def::1] [gold::0] [turns::0] [ambushes::0] [day::2002-03-04]\nwyrm-sheet::", town.id, "user");
    await play(sleeper.id, { do: "sleep", where: "fields" });
    expect(chips(sleeper.id)).toMatchObject({ turns: "15", ambushes: "3", rest: "fields" });
    expect(chips(sleeper.id).day).not.toBe("2002-03-04");
  } finally { stop(); }
}, 60_000);

test("a defender who died yesterday and wins the ambush has risen: the fight is saved with their morning, and the healer mends what's left", async () => {
  const { one, play, chips, today, player, stop } = await realm();
  try {
    const town = one("type=wyrm-world");
    const wren = player("Old Wren", { hp: 0, maxhp: 500, str: 100, def: 50, gold: 5, dead: 1, day: "2001-02-03", rest: "fields", turns: 2, ambushes: 0 }, town.id);
    const pip = player("Pip", { hp: 150, str: 100, gold: 40 }, town.id);
    expect((await play(pip, { do: "ambush", target: wren })).message).toBe("Old Wren wakes and kills you. They keep your 40 gold");
    expect(chips(pip)).toMatchObject({ dead: "1", gold: "0", hp: "0" });
    // She rose whole (500 hp) before the fight, took the blows, and keeps what's left: alive today, with a new morning's turns.
    const after = chips(wren);
    expect(after.dead).toBeUndefined();
    expect(after).toMatchObject({ gold: "45", day: today, turns: "15", ambushes: "3" });
    expect(Number(after.hp)).toBeGreaterThan(100); // Pip lands two to four blows of 25 to 75
    expect(Number(after.hp)).toBeLessThanOrEqual(450);
    // Her next move doesn't heal her to full: it's the same day, and the damage stands.
    const before = Number(after.hp);
    expect((await play(wren, { do: "heal" })).message).toBe(`healed 22 hp for 44 gold (${before + 22}/500)`);
    expect(chips(wren)).toMatchObject({ hp: String(before + 22), gold: "1" });
    expect(chips(wren).dead).toBeUndefined();
  } finally { stop(); }
}, 60_000);

test("the healer sells hp a point at a time, two gold a level", async () => {
  const { one, play, chips, player, stop } = await realm();
  try {
    const town = one("type=wyrm-world");
    const hurt = player("Bruise", { hp: 5, gold: 10 }, town.id);
    expect((await play(hurt, { do: "heal" })).message).toBe("healed 5 hp for 10 gold (10/20)");
    expect(chips(hurt)).toMatchObject({ hp: "10", gold: "0" });
    expect((await play(hurt, { do: "heal" })).message).toBe("healing costs 2 gold a point; you have 0");
    const flush = player("Coin", { hp: 18, gold: 100 }, town.id);
    expect((await play(flush, { do: "heal" })).message).toBe("healed 2 hp for 4 gold (20/20)");
    expect(chips(flush)).toMatchObject({ hp: "20", gold: "96" });
  } finally { stop(); }
}, 60_000);

test("the sheet and the town board draw the chips, and uninstalling keeps the notes and refuses the moves", async () => {
  const { one, play, store, client, draw, output, player, stop } = await realm();
  try {
    const town = one("type=wyrm-world");
    await play(town.id, { do: "join", name: "Ember" });
    const ember = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Ember" + " ["))!;
    player("Yester Rue", { hp: 0, dead: 1, day: "2001-02-03", rest: "fields" }, town.id);
    player("Tonight Vale", { hp: 0, dead: 1, rest: "fields" }, town.id);
    await draw(ember.id);
    const sheet = await until("the sheet", () => output(ember.id).find(o => o?.includes("Ember")));
    expect(sheet).toContain("level 1");
    expect(sheet).toContain("forest");
    expect(sheet).toContain("Dozing Gerald"); // asleep in the fields, so on everyone's sheet
    expect(sheet).toContain("Yester Rue"); // died yesterday: has risen, so can be found
    expect(sheet).not.toContain("Tonight Vale"); // died today: nothing to ambush
    // Yesterday's dead player, opening their own sheet before they move, is whole and has the moves.
    const rue = store.queryBlocks({ where: "type=wyrm-player" }).blocks.find(b => b.text.startsWith("Yester Rue"))!;
    await draw(rue.id);
    const own = await until("the risen sheet", () => output(rue.id).find(o => o?.includes("Yester Rue")));
    expect(own).toContain("20/20");
    expect(own).toContain("forest");
    expect(own).not.toContain("dead.");
    await draw(town.id);
    const board = await until("the town board", () => output(town.id).find(o => o?.includes("Daily News")));
    expect(board).toContain("Ember");
    expect(board).toContain("Ember wanders into Wyrmhold");

    const removed = await client.request<{ removed: boolean }>({ action: "extensions.uninstall", extension: "wyrm", demo: "keep" });
    expect(removed.removed).toBe(true);
    expect(store.require(ember.id).text).toContain("wyrm-sheet::");
    await expect(client.request({ action: "extensions.act", extension: "script:wyrm", extensionAction: "run", blockId: ember.id, args: { do: "forest" }, clientId: "wyrm-player" }))
      .rejects.toThrow("No extension script:wyrm is active here");
  } finally { stop(); }
}, 60_000);
