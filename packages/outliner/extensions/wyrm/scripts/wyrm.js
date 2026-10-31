// ep0ch-script effects=write
// Legend of the Ep0ch Wyrm: a door game in the shape of the old BBS ones. Every player is a note, every stat a chip
// on its first line, every day's news a note under the town's Daily News. One action per press: `wyrm do=<verb>`.
// An ambush records one fact; each player's chips cache their fold of those facts.

const DAY_TURNS = 15;
const DAY_AMBUSHES = 3;
const NEED = [0, 100, 400, 1000, 4000, 10000, 40000, 100000, 400000, 1000000, 4000000, 10000000];
const MAX_LEVEL = 12;
const MONSTERS = [
  ["Bog Rat", "Gutter Imp", "Lantern Moth"],
  ["Rust Goblin", "Moss Hound", "Crypt Toad"],
  ["Ditch Troll", "Ash Wight", "Thorn Boar"],
  ["Bramble Ogre", "Mire Hag", "Barrow Wolf"],
  ["Glass Spider", "Cinder Witch", "Iron Bear"],
  ["Bone Warden", "Storm Harpy", "Fen Basilisk"],
  ["Night Gaunt", "Rot Golem", "Ember Drake"],
  ["Hex Knight", "Plague Wyrmling", "Tide Horror"],
  ["Static Wraith", "Obsidian Giant", "Glitch Leviathan"],
  ["Void Shepherd", "Signal Demon", "Chrome Hydra"],
  ["Null Seraph", "Carrier Wave", "Busy Signal"],
  ["Abyssal Modem", "Dial-Tone Revenant", "Corrupt Sector"],
];
const MASTERS = ["Old Kael", "Brindle", "Sister Vex", "Marrow", "Ondine", "the Twins", "Halberd Jo", "Gutter Saint", "Cassius Null", "the Archivist", "Sysop Prime"];
const WEAPONS = [["bare fists", 0, 0], ["rusty shiv", 3, 200], ["pipe wrench", 8, 1000], ["short sword", 15, 3000], ["serial cutlass", 25, 10000], ["packet axe", 40, 30000], ["arc lance", 60, 100000], ["glitch blade", 85, 300000], ["null edge", 115, 1000000], ["daemon scythe", 150, 4000000], ["root kit", 200, 10000000]];
const ARMOR = [["rags", 0, 0], ["leather jerkin", 1, 200], ["chain vest", 3, 1000], ["scale coat", 7, 3000], ["copper mesh", 12, 10000], ["faraday plate", 20, 30000], ["mirror mail", 30, 100000], ["static shell", 45, 300000], ["firewall aegis", 65, 1000000], ["kernel carapace", 90, 4000000], ["sysop regalia", 120, 10000000]];
const WYRM = { name: "the Ep0ch Wyrm", hp: 2400, str: 360, gold: 0, xp: 0 };
const START = { level: 1, hp: 20, maxhp: 20, str: 10, def: 1, gold: 50, bank: 0, gems: 0, xp: 0, weapon: 0, armor: 0 };
const FOE_KEYS = ["foe", "foe-hp", "foe-str", "foe-gold", "foe-xp"];

const verb = props.do?.[0] ?? "forest";
const today = (await resolve("now.date")).values[0];
const roll = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = list => list[Math.floor(Math.random() * list.length)];
const fmt = n => Number(n).toLocaleString("en-US");
/** "the Bog Rat", and the Wyrm (already "the …") once. */
const the = foe => foe.startsWith("the ") ? foe : `the ${foe}`;

// --- notes as state -------------------------------------------------------------------------------------------------
const valueOf = (note, key) => note.properties.find(p => p.key === key)?.values[0];
const numberOf = (note, key) => Number(valueOf(note, key) ?? 0);
const typeOf = note => valueOf(note, "type");

/** Each changed chip in one write: replaced, added, or (value null) removed. */
async function save(note, changes) {
  const properties = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value === null || value === undefined || value === "" ? null : String(value)]));
  return await tools.outline_set_property({ ref: note.id, revision: note.revision, properties });
}

/** A death from an earlier day is over: that player has risen, whole, though their note says so only at their next move. */
const risen = note => valueOf(note, "dead") === "1" && valueOf(note, "day") !== today;
const stats = note => ({
  level: numberOf(note, "level") || 1, hp: risen(note) ? (numberOf(note, "maxhp") || 20) : numberOf(note, "hp"), maxhp: numberOf(note, "maxhp") || 20,
  str: numberOf(note, "str") || 10, def: numberOf(note, "def"), gold: numberOf(note, "gold"), bank: numberOf(note, "bank"),
  gems: numberOf(note, "gems"), xp: numberOf(note, "xp"), weapon: numberOf(note, "weapon"), armor: numberOf(note, "armor"),
  turns: numberOf(note, "turns"), ambushes: numberOf(note, "ambushes"), kills: numberOf(note, "kills"),
  // Death lasts the day it happened: a stale [dead::1] rises at the player's next move.
  day: valueOf(note, "day"), rest: valueOf(note, "rest"), dead: valueOf(note, "dead") === "1" && valueOf(note, "day") === today,
  foe: valueOf(note, "foe"), foeHp: numberOf(note, "foe-hp"), foeStr: numberOf(note, "foe-str"),
  foeGold: numberOf(note, "foe-gold"), foeXp: numberOf(note, "foe-xp"),
});
/** What a new day does to a note: turns and ambushes back, the dead risen whole. A move applies it to the player pressing,
 *  an ambush to the defender, so both lazy resets are this one. {} when the note's day is today. */
const morning = (note, s) => s.day === today ? {} : {
  day: today, turns: DAY_TURNS, ambushes: DAY_AMBUSHES,
  ...(valueOf(note, "dead") === "1" ? { dead: null, hp: s.maxhp } : {}),
};
const attack = s => s.str + WEAPONS[s.weapon][1];
const defence = s => s.def + ARMOR[s.armor][1];

async function worldOf(note) {
  let at = note;
  for (let i = 0; i < 8 && at; i++) {
    if (typeOf(at) === "wyrm-world") return at;
    at = at.parent ? await read(at.parent) : null;
  }
  throw new Error("this note isn't in a Wyrm town: press from a player's sheet or the town note");
}

/** Fold only events after this player's checkpoint: ordinary moves can still spend or earn the cached gold. */
async function foldPlayer(world, id) {
  for (;;) {
    const note = await read(id);
    const through = valueOf(note, "wyrm-through");
    const ref = JSON.stringify(`((${id}))`);
    const found = await query({ where: `parent:((${world.id})) type=wyrm-event verb=ambush (by=${ref} OR on=${ref})${through ? ` created > ${through}` : ""}`, sort: "created asc", limit: 200 });
    if (!found.rows.length) return note;
    const changes = {};
    const value = key => Object.hasOwn(changes, key) ? changes[key] : valueOf(note, key);
    const number = key => Number(value(key) ?? 0);
    for (const row of found.rows) {
      const event = await read(row.id), day = valueOf(event, "day");
      if (value("day") !== day) Object.assign(changes, { day, turns: DAY_TURNS, ambushes: DAY_AMBUSHES });
      const side = valueOf(event, "by") === `((${id}))` ? "by" : "on";
      const won = valueOf(event, "winner") === side;
      const hp = numberOf(event, `${side}-hp`);
      changes.hp = hp;
      changes.dead = hp === 0 ? 1 : null;
      changes.gold = number("gold") + (won ? 1 : -1) * numberOf(event, "gold");
      if (side === "by" || !won) changes.rest = null;
      if (side === "by") {
        changes.ambushes = number("ambushes") - 1;
        changes.xp = number("xp") + numberOf(event, "xp");
      }
      changes["wyrm-through"] = event.created;
    }
    try {
      const saved = await save(note, changes);
      if (saved.outcome === "proposed") throw new Error(saved.reason);
      // A held editor owns these chips until save; rereading the saved note would replay this same event into its draft.
      if (saved.edits?.some(edit => edit.route === "draft")) return { ...note, foldInDraft: true };
    } catch (error) {
      // Another fold or move won the revision: rebuild from its chips and checkpoint, never replay our old totals.
      if ((await read(id)).revision === note.revision) throw error;
    }
  }
}

async function news(world, line) {
  const board = (await q("type=wyrm-news", { under: world.id, limit: 1 })).blocks[0];
  await tools.outline_create({ parent: board?.id ?? world.id, text: `${line} [type::wyrm-event] [day::${today}]`, position: 0 });
}

// --- join: a new player under the town --------------------------------------------------------------------------------
let here = await read(this.id);
if (verb === "join") {
  const world = await worldOf(here);
  const count = (await q("type=wyrm-player", { under: world.id, limit: 200 })).blocks.length;
  const name = (props.name?.[0] ?? `Stranger ${count + 1}`).replace(/[\[\]()]/g, "").trim() || `Stranger ${count + 1}`;
  const chips = Object.entries({ type: "wyrm-player", ...START, turns: DAY_TURNS, ambushes: DAY_AMBUSHES, day: today, wields: WEAPONS[0][0], wears: ARMOR[0][0], next: NEED[1] })
    .map(([k, v]) => `[${k}::${v}]`).join(" ");
  await tools.outline_create({ parent: world.id, text: `${name} ${chips}\nwyrm-sheet::` });
  await news(world, `${name} wanders into ${world.title} with ${START.gold} gold and a bad feeling.`);
  return `${name} joins ${world.title}: open their note to play`;
}

if (typeOf(here) !== "wyrm-player") throw new Error("press this from a player's sheet (a note with [type::wyrm-player]); join from the town note");
const world = await worldOf(here);
// Read the log head before either balance: one next event admits the fight for both participants together.
const ambushAfter = verb === "ambush"
  ? (await query({ where: `parent:((${world.id})) type=wyrm-event verb=ambush`, sort: "created desc", limit: 1 })).rows[0]?.id ?? "start"
  : null;
here = await foldPlayer(world, here.id);
if (here.foldInDraft) return `${here.title}'s pending ambush is folded into the open draft; save it before the next move`;
let me = stats(here);
const name = here.title;
const change = {};
const set = (key, value) => { change[key] = value; };

// --- a new day: turns back, the dead rise ------------------------------------------------------------------------------
const dawn = morning(here, me);
if (dawn.day) { Object.assign(change, dawn); me.turns = DAY_TURNS; me.ambushes = DAY_AMBUSHES; } // me.hp: stats() already rose the dead
// Every save restamps what the sheet shows but can't compute without these tables: gear names and the next level's xp.
const finish = async message => {
  const final = key => change[key] ?? me[key];
  const level = Number(final("level")) || 1;
  set("wields", WEAPONS[Number(final("weapon")) || 0][0]);
  set("wears", ARMOR[Number(final("armor")) || 0][0]);
  set("next", level >= MAX_LEVEL ? null : NEED[level]);
  await save(here, change);
  return message;
};

if (me.dead) return await finish(`${name} is dead until tomorrow`);
// Any action but sleeping wakes you.
if (me.rest && verb !== "sleep") set("rest", null);

const gain = async (gold, xp, line) => {
  me.gold += gold; me.xp += xp; set("gold", me.gold); set("xp", me.xp);
  return line;
};
const clearFoe = () => { for (const key of FOE_KEYS) set(key, null); me.foe = undefined; };

/** One exchange of blows with the foe on the sheet: your swing, then theirs if it still stands. */
async function exchange() {
  const mine = Math.max(1, Math.round(roll(0.5, 1) * attack(me)));
  me.foeHp -= mine;
  if (me.foeHp <= 0) {
    const foe = me.foe;
    const wyrm = foe === WYRM.name;
    clearFoe();
    if (wyrm) {
      const kills = me.kills + 1;
      for (const [k, v] of Object.entries(START)) { set(k, v); me[k] = v; }
      set("kills", kills); set("turns", 0);
      await news(world, `**${name} has slain ${WYRM.name}!** The town rings its bell. ${name} wakes up level 1, a legend (${kills}×).`);
      return `you slay ${WYRM.name}. The realm forgets your name but not your deed: back to level 1, ${kills} kill${kills > 1 ? "s" : ""}`;
    }
    const gems = Math.random() < 0.08 ? 1 : 0;
    if (gems) { me.gems += 1; set("gems", me.gems); }
    return await gain(me.foeGold, me.foeXp, `you hit for ${mine}; ${the(foe)} falls. +${fmt(me.foeGold)} gold, +${fmt(me.foeXp)} xp${gems ? ", and a gem" : ""}`);
  }
  set("foe-hp", me.foeHp);
  const theirs = Math.max(0, Math.round(roll(0.5, 1) * me.foeStr - defence(me)));
  me.hp -= theirs;
  if (me.hp <= 0) {
    const foe = me.foe;
    set("hp", 0); set("dead", 1); set("gold", 0); set("xp", Math.round(me.xp * 0.9));
    clearFoe();
    await news(world, `${name} was killed by ${foe.startsWith("the ") ? foe : `a ${foe}`} in the forest and dropped ${fmt(me.gold)} gold.`);
    return `you hit for ${mine}; ${the(foe)} hits for ${theirs}. You die. Tomorrow you rise, lighter in the purse`;
  }
  set("hp", me.hp);
  return `you hit for ${mine}; ${the(me.foe)} hits for ${theirs}. ${me.hp}/${me.maxhp} hp`;
}

switch (verb) {
  case "forest": {
    if (me.foe) return await finish(`${the(me.foe)} is still in front of you (${me.foeHp} hp): hit or run`);
    if (me.turns <= 0) return await finish("you're too tired to fight any more today");
    me.turns -= 1; set("turns", me.turns);
    const luck = Math.random();
    if (luck < 0.06) { me.gems += 1; set("gems", me.gems); return await finish("you find a gem glinting under a root"); }
    if (luck < 0.12) { const g = Math.round(roll(10, 40) * me.level * me.level); return await finish(await gain(g, 0, `a dead adventurer's purse: +${fmt(g)} gold`)); }
    if (luck < 0.15) { set("hp", me.maxhp); return await finish("a fairy circle hums; you leave it whole again"); }
    const L = me.level;
    const spawned = {
      name: pick(MONSTERS[L - 1]),
      hp: Math.round(10 * Math.pow(L, 1.7) * roll(0.8, 1.2)),
      str: Math.round(7 * Math.pow(L, 1.6) * roll(0.85, 1.15)),
      gold: Math.round(25 * Math.pow(L, 2.3) * roll(0.7, 1.3)),
      xp: Math.max(5, Math.round((NEED[L] || NEED[MAX_LEVEL - 1]) / 14 * roll(0.8, 1.2))),
    };
    set("foe", spawned.name); set("foe-hp", spawned.hp); set("foe-str", spawned.str); set("foe-gold", spawned.gold); set("foe-xp", spawned.xp);
    return await finish(`a ${spawned.name} steps out of the trees (${spawned.hp} hp)`);
  }
  case "hit": {
    if (!me.foe) return await finish("nothing to hit: go into the forest");
    return await finish(await exchange());
  }
  case "run": {
    if (!me.foe) return await finish("nothing to run from");
    if (me.foe === WYRM.name || Math.random() < 0.25) {
      const out = await exchange();
      return await finish(`you couldn't get away. ${out}`);
    }
    const from = me.foe; clearFoe();
    return await finish(`you slip away from ${the(from)}`);
  }
  case "heal": {
    const missing = me.maxhp - me.hp;
    if (missing <= 0) return await finish("the healer looks you over and shrugs: nothing to mend");
    const each = me.level * 2;
    const afford = Math.min(missing, Math.floor(me.gold / each));
    if (afford <= 0) return await finish(`healing costs ${each} gold a point; you have ${fmt(me.gold)}`);
    me.hp += afford; me.gold -= afford * each; set("hp", me.hp); set("gold", me.gold);
    return await finish(`healed ${afford} hp for ${fmt(afford * each)} gold (${me.hp}/${me.maxhp})`);
  }
  case "train": {
    if (me.foe) return await finish("finish your fight first");
    if (me.level >= MAX_LEVEL) return await finish(`no master left to teach you. Only ${WYRM.name} remains`);
    const need = NEED[me.level];
    if (me.xp < need) return await finish(`${MASTERS[me.level - 1]} waves you off: ${fmt(need - me.xp)} more xp`);
    // The master's duel: a sparring match to three touches.
    const yours = attack(me) * roll(0.7, 1.3), theirs = (7 * Math.pow(me.level + 1, 1.6)) * roll(0.7, 1.3) - defence(me) * 0.5;
    if (yours < theirs) { me.hp = Math.max(1, Math.floor(me.hp / 2)); set("hp", me.hp); return await finish(`${MASTERS[me.level - 1]} knocks you flat. Not yet (${me.hp} hp)`); }
    const L = me.level + 1;
    me.maxhp += 10 + L * 5; me.str += 5 + L * 2; me.def += 2 + L;
    for (const [k, v] of Object.entries({ level: L, maxhp: me.maxhp, hp: me.maxhp, str: me.str, def: me.def })) set(k, v);
    await news(world, `${name} bested ${MASTERS[L - 2]} and is now level ${L}.`);
    return await finish(`you best ${MASTERS[L - 2]}: level ${L}, ${me.maxhp} hp`);
  }
  case "buy": {
    const kind = props.item?.[0] === "armor" ? "armor" : "weapon";
    const table = kind === "armor" ? ARMOR : WEAPONS;
    const now = me[kind];
    if (now + 1 >= table.length) return await finish(`there's no better ${kind} in the realm`);
    const [itemName, , price] = table[now + 1];
    const tradeIn = Math.floor(table[now][2] / 2);
    if (me.gold + tradeIn < price) return await finish(`a ${itemName} costs ${fmt(price)} gold (your ${table[now][0]} trades for ${fmt(tradeIn)}); you have ${fmt(me.gold)}`);
    me.gold = me.gold + tradeIn - price; me[kind] = now + 1; set("gold", me.gold); set(kind, now + 1);
    return await finish(`you buy a ${itemName}${tradeIn ? ` (traded your ${table[now][0]} for ${fmt(tradeIn)})` : ""}`);
  }
  case "deposit": {
    if (!me.gold) return await finish("nothing in your purse to deposit");
    const g = me.gold; me.bank += g; me.gold = 0; set("bank", me.bank); set("gold", 0);
    return await finish(`deposited ${fmt(g)} gold; ${fmt(me.bank)} in the bank`);
  }
  case "withdraw": {
    if (!me.bank) return await finish("your account is empty");
    const g = me.bank; me.gold += g; me.bank = 0; set("gold", me.gold); set("bank", 0);
    return await finish(`withdrew ${fmt(g)} gold`);
  }
  case "sleep": {
    if (me.foe) return await finish("you can't sleep with a monster watching");
    const where = props.where?.[0] === "inn" ? "inn" : "fields";
    if (where === "inn") {
      const cost = 20 * me.level;
      if (me.gold < cost) return await finish(`a room is ${cost} gold; you have ${fmt(me.gold)}. The fields are free`);
      me.gold -= cost; set("gold", me.gold);
    }
    set("rest", where);
    return await finish(where === "inn" ? "you take a room at the inn. Nobody can reach you there" : "you curl up in the fields. Anyone could find you");
  }
  case "ambush": {
    const target = props.target?.[0];
    if (!target) throw new Error("ambush needs target=<a sleeping player's note>");
    if (me.foe) return await finish("finish your fight first");
    if (me.ambushes <= 0) return await finish("you've ambushed enough for one day");
    let victimNote = await read(target);
    if (victimNote.id === here.id) return await finish("you can't ambush yourself");
    const victimWorld = typeOf(victimNote) === "wyrm-player" ? await worldOf(victimNote).catch(() => null) : null;
    if (victimWorld?.id !== world.id) return await finish("that isn't a player in this town");
    victimNote = await foldPlayer(world, victimNote.id);
    if (victimNote.foldInDraft) return `${victimNote.title}'s pending ambush is folded into the open draft; save it before the next move`;
    const them = stats(victimNote);
    if (them.dead) return await finish(`${victimNote.title} is already dead`);
    if (them.rest !== "fields") return await finish(`${victimNote.title} isn't sleeping in the fields`);
    // A whole fight at once: they wake mid-swing.
    let a = me.hp, b = them.hp;
    for (let round = 0; round < 200 && a > 0 && b > 0; round++) {
      b -= Math.max(1, Math.round(roll(0.5, 1) * attack(me) - defence(them) * 0.5));
      if (b > 0) a -= Math.max(0, Math.round(roll(0.5, 1) * attack(them) - defence(me)));
    }
    const won = b <= 0, gold = won ? them.gold : me.gold;
    const xp = won ? Math.round(them.level * 50 * roll(0.8, 1.2)) : 0;
    const line = won
      ? `${name} found ${victimNote.title} asleep in the fields and killed them, taking ${fmt(gold)} gold.`
      : `${name} tried to kill ${victimNote.title} in their sleep. ${victimNote.title} woke up and won.`;
    const event = { type: "wyrm-event", verb: "ambush", by: `((${here.id}))`, on: `((${victimNote.id}))`, gold,
      winner: won ? "by" : "on", "by-hp": won ? Math.max(1, a) : 0, "on-hp": won ? 0 : Math.max(1, b), xp, day: today };
    try {
      await tools.outline_create({ parent: world.id,
        requestId: `wyrm:ambush:${world.id}:${ambushAfter}`,
        text: `${line} ${Object.entries(event).map(([key, value]) => `[${key}::${value}]`).join(" ")}` });
    } catch (error) {
      if (!String(error).includes("Create request ID was already used with different input")) throw error;
      await foldPlayer(world, here.id);
      await foldPlayer(world, victimNote.id);
      throw new Error("Another ambush landed first; the players' sheets are refreshed. Press ambush again.");
    }
    await foldPlayer(world, here.id);
    await foldPlayer(world, victimNote.id);
    if (won) {
      try { await tools.outline_comment({ ref: victimNote.id, whole: true, body: `${name} killed you in your sleep and took ${fmt(gold)} gold. Bank it next time.` }); } catch { /* the event has it */ }
    }
    return won ? `you kill ${victimNote.title} in their sleep: +${fmt(gold)} gold, +${fmt(xp)} xp`
      : `${victimNote.title} wakes and kills you. They keep your ${fmt(gold)} gold`;
  }
  case "wyrm": {
    if (me.level < MAX_LEVEL) return await finish(`only a level ${MAX_LEVEL} fool hunts ${WYRM.name}`);
    if (me.foe) return await finish("finish your fight first");
    if (me.turns <= 0) return await finish("too tired to climb the mountain today");
    me.turns -= 1; set("turns", me.turns);
    set("foe", WYRM.name); set("foe-hp", WYRM.hp); set("foe-str", WYRM.str); set("foe-gold", 0); set("foe-xp", 0);
    await news(world, `${name} has gone up the mountain after ${WYRM.name}.`);
    return await finish(`${WYRM.name} uncoils (${WYRM.hp} hp)`);
  }
  default:
    throw new Error(`wyrm knows do=forest, hit, run, heal, train, buy (item=weapon|armor), deposit, withdraw, sleep (where=inn|fields), ambush (target=), wyrm, join; not ${verb}`);
}
