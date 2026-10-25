// ep0ch-script mode=render
// Draws a town note: who's playing, ranked, and today's Daily News. A player's row opens their sheet; *join the realm* makes a new one.
const today = (await resolve("now.date")).values[0];
const players = (await q("type=wyrm-player", { under: this.id, limit: 200 })).blocks;
const notes = await Promise.all(players.map(p => read(p.id)));
const v = (note, key) => note.properties.find(p => p.key === key)?.values[0];
const n = (note, key) => Number(v(note, key) ?? 0);
// Death lasts the day it happened (the script's rule, as the player sheet states it).
const deadToday = note => v(note, "dead") === "1" && v(note, "day") === today;
const status = note => deadToday(note) ? "dead" : v(note, "rest") === "inn" ? "at the inn" : v(note, "rest") === "fields" ? "in the fields" : "awake";
notes.sort((a, b) => n(b, "kills") - n(a, "kills") || n(b, "level") - n(a, "level") || n(b, "xp") - n(a, "xp"));

// q promises no order: take them all, newest first (by when each was made, so an edit doesn't move one), then the top 40.
const events = (await q(`type=wyrm-event day=${today}`, { under: this.id, limit: 200 })).blocks
  .sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 40);

return view.stack({ children: [
  view.band({ text: this.title, level: 1 }),
  view.row({ children: [view.button({ label: "join the realm", act: "wyrm do=join", tone: "accent" })] }),
  notes.length
    ? view.table({ columns: ["player", "level", "kills", "now"], rows: notes.map(note => [note.title, n(note, "level") || 1, n(note, "kills"), status(note)]), links: notes.map(note => note.id) })
    : view.text({ text: "nobody here yet", tone: "dim" }),
  view.box({ title: `Daily News · ${today}`, children: [
    events.length ? view.blockdown({ text: events.map(e => `- ${e.title}`).join("\n") }) : view.text({ text: "a quiet day in town", tone: "dim" }),
  ] }),
] });
