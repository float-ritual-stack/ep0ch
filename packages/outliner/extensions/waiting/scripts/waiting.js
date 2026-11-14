// ep0ch-script mode=render
// Waiting on others (PIE-1525; the door's built-in until then): every outbox item still waiting for an answer
// (`[type::outbox-item] [outbox::waiting]`), grouped by who it waits on, each group oldest first, the group waited on
// longest first. Picking one shows it in the reader its select wire goes to.
// [form-field::demo choice only]: only: list this extension's made-up demo items, nothing else
//
//   waiting::
//
// An item names who it waits on in `waiting-on` ("Ada: which shelf do the jars go on?"): the name before the colon is
// the group, the rest the question; without one, `to`, and the item's title. `sent` ("2026-01-05 4:23 PM", as people
// write a date) is when the wait began; an item without it waits from when it was written. Ages are the service
// host's clock.

const demoOnly = props.demo?.[0] === "only";
// How long a wait may be before it is drawn as a warning: this extension's own setting (`warn-days`, three when unset),
// which the service hands a script its extension ships as a prop.
const warnDays = Math.max(1, Number(props["warn-days"]?.[0]) || 3);
// The demo's made-up asks carry [demo::waiting] and no outbox type, so no real view (an outbox board, a kanban) lists
// them; only a demo line asks for them.
const where = demoOnly ? "demo=waiting" : "type=outbox-item outbox=waiting NOT demo=waiting";
const { rows: items } = await query({ where, limit: 500 });

const one = (item, key) => (item.props[key]?.[0] ?? "").trim();
// When each item's wait began: its `sent` (date() reads it as the views read a date), else when it was written.
const sent = new Map(await Promise.all(items.map(async item => [item.id, (await date(one(item, "sent")))?.ms])));
const unsent = items.filter(item => sent.get(item.id) === undefined).slice(0, 200);
const when = v => (typeof v === "number" ? v : Date.parse(v ?? "")) || undefined;
const written = new Map(unsent.length ? (await read(unsent.map(item => item.id))).filter(r => r && r.id).map(r => [r.id, when(r.created)]) : []);
const sentAt = item => sent.get(item.id) ?? written.get(item.id) ?? Date.now();

/** Who it waits on and what for: `waiting-on`'s "Name: question", else `to` and its title. */
const waitingOn = item => {
  const w = one(item, "waiting-on"), i = w.indexOf(":");
  if (i > 0 && i < 40) return { who: w.slice(0, i).trim(), what: w.slice(i + 1).trim() || item.title };
  return { who: one(item, "to") || "someone", what: w || item.title };
};
const ago = ms => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

// By who (any case), each group oldest first, the group waited on longest first.
const groups = new Map();
for (const item of [...items].sort((a, b) => sentAt(a) - sentAt(b))) {
  const { who } = waitingOn(item), key = who.toLowerCase();
  const g = groups.get(key) ?? { who, key, items: [], since: sentAt(item) };
  g.items.push(item);
  groups.set(key, g);
}
const ordered = [...groups.values()].sort((a, b) => a.since - b.since);
const ticketWidth = Math.min(10, Math.max(0, ...items.map(item => one(item, "ticket").length)));

const rows = ordered.flatMap(g => g.items.map(item => {
  const at = sentAt(item), ticket = one(item, "ticket");
  return {
    id: item.id, group: g.key,
    label: `${ago(at).padStart(4)} ${ticketWidth ? `${ticket.padEnd(ticketWidth)} ` : ""}${waitingOn(item).what}`,
    // Waited past the days its setting says: drawn as a warning.
    ...(Date.now() - at > warnDays * 86_400_000 ? { tone: "warn" } : {}),
    do: { open: item.id },
  };
}));
const people = ordered.length;
const title = items.length
  ? `outbox · ${items.length} waiting on ${people} ${people === 1 ? "person" : "people"}`
  : "waiting on others · none";

return view.list({
  title, rows,
  groups: ordered.map(g => ({ name: g.key, label: `${g.who} · ${g.items.length} waiting · longest ${ago(g.since)}`, count: g.items.length })),
  empty: "Nobody owes you an answer. An outbox item waits while it has [type::outbox-item] [outbox::waiting].",
});
