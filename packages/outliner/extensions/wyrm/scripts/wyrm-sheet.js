// ep0ch-script mode=render
// Draws a player's note: the chips the `wyrm` script keeps, and a press for every move. Each press is `wyrm do=…` on the note it's drawn in.
const today = (await resolve("now.date")).values[0];
const of = (note, key) => note.properties.find(p => p.key === key)?.values[0];
const v = key => of(this, key);
const n = key => Number(v(key) ?? 0);
// Death lasts the day it happened (the script's rule): an earlier day's dead player has risen.
const deadToday = note => of(note, "dead") === "1" && of(note, "day") === today;
const fresh = v("day") !== today;
const dead = deadToday(this);
const level = n("level") || 1, maxhp = n("maxhp") || 1;
// A dead player from an earlier day has risen whole, though their note says so only at their next move.
const hp = v("dead") === "1" && !dead ? maxhp : n("hp");
const press = (label, line, tone) => view.button({ label, act: `wyrm ${line}`, tone });

const parts = [
  view.band({ text: `${this.title} · level ${level}`, level: 2 }),
  view.row({ minWidth: 14, children: [
    view.bar({ label: "hp", value: Math.max(0, hp), max: maxhp, tone: dead ? "dim" : hp * 3 < maxhp ? "bad" : "good" }),
    v("next") ? view.bar({ label: "xp", value: Math.min(n("xp"), n("next")), max: n("next"), tone: n("xp") >= n("next") ? "accent" : "default" }) : view.text({ text: "xp: no master left", tone: "accent" }),
  ] }),
  view.row({ minWidth: 10, children: [
    view.stat({ label: "gold", value: n("gold") }), view.stat({ label: "bank", value: n("bank") }),
    view.stat({ label: "gems", value: n("gems") }), view.stat({ label: "fights", value: fresh ? "new day" : n("turns") }),
    view.stat({ label: "kills", value: n("kills"), tone: n("kills") ? "accent" : "dim" }),
  ] }),
  view.text({ text: `wields ${v("wields") ?? "bare fists"} · wears ${v("wears") ?? "rags"}`, tone: "dim" }),
];

if (dead) {
  parts.push(view.text({ text: "dead. You rise at the next day.", tone: "bad", strong: true }));
} else if (v("foe")) {
  parts.push(view.card({ title: `${v("foe").startsWith("the ") ? v("foe") : `a ${v("foe")}`} blocks the path`, badge: { label: `${n("foe-hp")} hp`, tone: "bad" }, children: [
    view.row({ children: [press("hit it", "do=hit", "bad"), press("run", "do=run")] }),
  ] }));
} else {
  if (v("rest")) parts.push(view.text({ text: v("rest") === "inn" ? "asleep at the inn" : "asleep in the fields (anyone can find you)", tone: v("rest") === "inn" ? "good" : "warn" }));
  parts.push(view.row({ minWidth: 8, children: [
    press("forest", "do=forest", "accent"), press("healer", "do=heal", "good"), press("master", "do=train"),
    press("weapon+", "do=buy item=weapon"), press("armor+", "do=buy item=armor"),
  ] }));
  parts.push(view.row({ minWidth: 8, children: [
    press("bank it", "do=deposit"), press("withdraw", "do=withdraw"), press("inn", "do=sleep where=inn", "good"), press("fields", "do=sleep where=fields", "warn"),
    ...(level >= 12 ? [press("the wyrm", "do=wyrm", "bad")] : []),
  ] }));
  // The fields: who's asleep out there, and a press to find them.
  const sleepers = this.parent ? (await q("type=wyrm-player rest=fields", { under: this.parent, limit: 50 })).blocks.filter(b => b.id !== this.id) : [];
  const notes = await Promise.all(sleepers.map(b => read(b.id)));
  const alive = notes.filter(note => !deadToday(note));
  if (alive.length) parts.push(view.box({ title: "asleep in the fields", children: [view.table({
    columns: ["who", "level"],
    rows: alive.map(note => [note.title, of(note, "level") ?? "1"]),
    acts: alive.map(note => `wyrm do=ambush target=${note.id}`),
  })] }));
}
return view.stack({ children: parts });
