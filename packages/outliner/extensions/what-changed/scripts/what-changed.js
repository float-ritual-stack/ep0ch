// ep0ch-script mode=render
// What changed (PIE-647, an extension since PIE-1506): the notes others changed since a point, one row per note at its
// latest change, newest first, as `tools.outline_changes` answers it. The person's own edits are no news; what tools
// wrote for their own bookkeeping and extensions' writes are held back unless `machinery=show`.
// [form-field::since text]: list changes after this ISO time (default a week ago)
// [form-field::unseen text]: ids not looked at yet, comma-separated: their rows wear ●
// [form-field::machinery choice show|hide]: show tools' bookkeeping and extensions' writes too
//
//   what-changed:: since=2026-11-01T00:00:00Z
//
// The door's +N new (alt+o) opens this as a tile in your drawer with `since` and `unseen` from its own count; a
// `what-changed::` line in any note draws the same list there. ⏎ on a row opens its note where opens land.

const one = key => props[key]?.[0];
const since = one("since") || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const unseen = new Set((one("unseen") ?? "").split(",").map(s => s.trim()).filter(Boolean));
const showMachinery = one("machinery") === "show";

const { entries } = await tools.outline_changes({ since, limit: 100, ...(showMachinery ? { machinery: "show" } : {}) });

const KIND = { text: "edited", properties: "property set", move: "moved", delete: "trashed", restore: "restored" };
const ago = iso => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
// A title as the door shows it: a reference by its label, a page link by its name.
const plain = t => (t ?? "").replace(/\(\(([^)|]+)\|([^)]*)\)\)/g, "$2").replace(/\(\(([0-9a-f-]{8})[^)]*\)\)/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
const isExt = e => (e.actorId ?? "").startsWith("ext:");
const whoOf = e => `${e.actorId ?? e.author}${isExt(e) ? " (ext)" : e.author === "agent" && !(e.actorId ?? "agent").startsWith("agent") ? " (agent)" : ""}`;
const rowOf = (id, title, who, kind, at) => ({ id, label: plain(title) || id.slice(0, 8), detail: `${who} · ${kind} · ${ago(at)}`, mark: unseen.has(id) ? "●" : " ", ...(unseen.has(id) ? { tone: "warn" } : {}), do: { open: id } });
// The person's own edits are never news; an extension's writes are held back like a tool's bookkeeping.
const rows = entries
  .filter(e => !(e.author === "user" && !isExt(e)))
  .filter(e => showMachinery || !isExt(e))
  .map(e => rowOf(e.id, e.title, whoOf(e), KIND[e.kind] ?? "changed", e.at));

// A note not looked at that the activity feed doesn't list (a note made new, a comment: it records edits, property
// sets, moves, trashes and restores) is read by itself and listed at the top: what the count counts, the list shows.
const missing = [...unseen].filter(id => !rows.some(r => r.id === id));
if (missing.length) {
  const records = await read(missing.slice(0, 50));
  const extra = records.filter(r => r && !r.problem && r.id).map(r => rowOf(r.id, r.title, whoOf({ author: r.author, actorId: r.actorId }), "changed", r.updated ?? r.updatedAt ?? r.created ?? r.createdAt));
  extra.sort((a, b) => (a.detail < b.detail ? 1 : -1));
  rows.unshift(...extra);
}

return view.list({ rows, empty: "Nothing has changed since you looked. Notes an agent, another client or an extension changes show here, newest first; the status bar counts the ones you haven't seen." });
