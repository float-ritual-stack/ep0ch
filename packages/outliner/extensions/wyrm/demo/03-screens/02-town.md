Town board [script::wyrm-town] [mode::render]
Draws a town note: who's playing, ranked, and today's Daily News. A player's row opens their sheet; the town's own *join the realm* button makes a new one.
```js
const today = (await resolve("now.date")).values[0];
const players = (await q("type=wyrm-player", { under: this.id, limit: 200 })).blocks;
const notes = await Promise.all(players.map(p => read(p.id)));
const v = (note, key) => note.properties.find(p => p.key === key)?.values[0];
const n = (note, key) => Number(v(note, key) ?? 0);
const status = note => v(note, "dead") === "1" && v(note, "day") === today ? "dead" : v(note, "rest") === "inn" ? "at the inn" : v(note, "rest") === "fields" ? "in the fields" : "awake";
notes.sort((a, b) => n(b, "kills") - n(a, "kills") || n(b, "level") - n(a, "level") || n(b, "xp") - n(a, "xp"));

// q promises no order: take them all, newest first, then the top 40.
const events = (await q(`type=wyrm-event day=${today}`, { under: this.id, limit: 200 })).blocks
  .sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 40);

return view.stack({ children: [
  view.band({ text: this.title, level: 1 }),
  notes.length
    ? view.table({ columns: ["player", "level", "kills", "now"], rows: notes.map(note => [note.title, n(note, "level") || 1, n(note, "kills"), status(note)]), links: notes.map(note => note.id) })
    : view.text({ text: "nobody here yet", tone: "dim" }),
  view.box({ title: `Daily News · ${today}`, children: [
    events.length ? view.blockdown({ text: events.map(e => `- ${e.title}`).join("\n") }) : view.text({ text: "a quiet day in town", tone: "dim" }),
  ] }),
] });
```
