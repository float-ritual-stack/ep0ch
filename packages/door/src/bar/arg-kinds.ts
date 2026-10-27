import { readdir } from "node:fs/promises";
import { dirname, basename, resolve, join } from "node:path";
import { homedir } from "node:os";
// The values of each kind of thing an action's argument names (PIE-1031, ArgKind in src/surface/actions.ts), for the
// power bar's form (src/bar/ask.ts): typed words filter them, ↑ ↓ pick one. None keeps a list of its own: a tile is the
// layout's (the screen shown's tiles, as `tile=` reaches them), a note the service's one search, a page the service's
// page completion, a screen `screen.list`, a saved view the outline's virtual branches (`blocks.query`), a property's
// key or value the outline's property index (`properties.catalog`), a tile kind the tile-kind registry. A kind is
// registered here once (`registerArgKind`), as a bar source is, so a new kind of thing is one entry, never a branch in
// the bar.
import { headedTitle } from "../board";
import type { ArgKind } from "../surface/actions";
import { USER, hostRequest } from "../socket";
import { filtered } from "./filter";
import { barSource, type BarHost, type BarPreview } from "./source";

/** One value a kind offers: what the argument is given, and how it's shown. */
export interface KindValue { value: string; label: string; detail?: string; depth?: number; mark?: string; preview?: BarPreview }

/** A kind's values for what's typed; `of`: the value the argument it belongs to has (a property value's key). */
export type KindValues = (typed: string, host: BarHost, o: { of?: string }) => KindValue[] | Promise<KindValue[]>;

const kinds = new Map<string, KindValues>();
/** Add (or replace) the values of a kind of thing. */
export function registerArgKind(kind: ArgKind | (string & {}), values: KindValues) { kinds.set(kind, values); }
/** The values of `kind`, or none when no kind of that name is registered. */
export const argKind = (kind: string): KindValues | undefined => kinds.get(kind);

registerArgKind("outline", async (typed, host) => {
  const result = await hostRequest<{ outlines: { name: string; archived?: boolean }[] }>(host.ctx.board.path, "outlines.list");
  return filtered(result.outlines.filter(o => !o.archived).map(o => ({ value: o.name, label: o.name })), typed, r => [r.label]);
});

registerArgKind("tile", async (typed, host) => {
  // Loaded when asked: sources.ts reaches the desk, which reaches the actions (a static import is a cycle).
  const { shownTileRows } = await import("./sources");
  const tiles = barSource("tiles");
  return shownTileRows(host, typed).map(r => {
    let preview: BarPreview = null;
    try { const p = tiles?.preview(r, host); preview = p instanceof Promise ? null : p ?? null; } catch { /* no preview */ }
    return { value: r.fill ?? r.label, label: r.label, ...(r.detail ? { detail: r.detail } : {}), ...(r.depth ? { depth: r.depth } : {}), ...(r.mark ? { mark: r.mark } : {}), preview };
  });
});

registerArgKind("note", async (typed, host) => {
  const t = typed.trim();
  if (t.length < 2) {
    const { recentNotes } = await import("./sources");
    return (await recentNotes(host).catch(() => [])).map(r => ({ value: r.key, label: r.label, detail: r.detail ?? "changed lately", preview: { note: r.key } }));
  }
  return (await host.ctx.board.search(t, 20, { near: host.near() ?? undefined })).map(m => ({ value: m.id, label: headedTitle(m), detail: "found", preview: { note: m.id } }));
});

registerArgKind("page", async (typed, host) => {
  const r = await host.ctx.board.completePages(typed.trim() || undefined, 20, { near: host.near() ?? undefined });
  return r.addresses.map(a => ({ value: a.address, label: a.address, detail: a.title && a.title !== a.address ? `${a.kind} · ${a.title}` : a.kind, preview: { note: a.blockId } }));
});

registerArgKind("screen", async (typed, host) => {
  const l = await host.dispatch.act({ action: "screen.list" }, USER) as { screens: { key: string; label: string; about: string }[]; named: { name: string; title?: string; made?: boolean }[] };
  const rows: KindValue[] = l.screens.map(s => ({ value: s.label.toLowerCase(), label: s.label, detail: s.about || `the menu's ${s.key}` }));
  for (const n of l.named) if (!rows.some(r => r.value === n.name.toLowerCase())) rows.push({ value: n.name, label: n.title ?? n.name, detail: n.made ? "a screen you made" : "a screen" });
  return filtered(rows, typed, r => [r.label, r.value, r.detail ?? ""]);
});

registerArgKind("view", async (typed, host) => {
  const views = await host.ctx.board.byProp("type", "virtual-branch", 200);
  const rows = views.filter(m => !m.deleted).map(m => ({ value: m.id, label: headedTitle(m), detail: "a saved view", preview: { note: m.id } as BarPreview }));
  return filtered(rows, typed, r => [r.label]);
});

registerArgKind("key", async (typed, host) => {
  const found = await host.ctx.board.propertyCatalog(undefined, typed.trim(), 60, true);
  const uses = new Map<string, number>();
  for (const f of found) uses.set(f.key, (uses.get(f.key) ?? 0) + f.count);
  return [...uses].map(([key, n]) => ({ value: key, label: key, detail: `${n} use${n === 1 ? "" : "s"}` }));
});

registerArgKind("value", async (typed, host, { of }) => {
  if (!of) return [];
  const found = await host.ctx.board.propertyCatalog(of, typed.trim(), 60);
  return found.map(f => ({ value: f.value, label: f.value, detail: `${of} · ${f.count} use${f.count === 1 ? "" : "s"}` }));
});

registerArgKind("tile-kind", async typed => {
  const { tileKinds } = await import("../desk/tile-kinds");
  return filtered(tileKinds().map(k => ({ value: k.kind, label: k.kind, detail: k.about })), typed, r => [r.label, r.detail ?? ""]);
});

registerArgKind("file", async typed => {
  const path = resolve(typed.replace(/^~(?=\/|$)/, homedir()) || ".");
  const folder = !typed || typed.endsWith("/") ? path : dirname(path);
  const prefix = !typed || typed.endsWith("/") ? "" : basename(path);
  const entries = await readdir(folder, { withFileTypes: true });
  return entries.filter(e => e.name.startsWith(prefix)).map(e => ({ value: join(folder, e.name) + (e.isDirectory() ? "/" : ""), label: e.name + (e.isDirectory() ? "/" : "") }));
});

registerArgKind("layout", async (typed, host) => {
  const result = await host.dispatch.act({ action: "layout.list" }, USER) as { layouts: { name: string; title?: string }[] };
  return filtered(result.layouts.map(l => ({ value: l.name, label: l.title ?? l.name })), typed, r => [r.value, r.label]);
});
