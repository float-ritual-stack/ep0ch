import type { ListOpenWhere } from "@ep0ch/outline-core/list-row";
import { leaves, node, type AltRule } from "./layout";
import { flowHolding, named, policyAt, type LayoutState, type TileFacts } from "./screen-layout";

/**
 * Where tile `id`'s opens land (PIE-794: every open from a tile asks this, and only this): its own link (when that tile
 * is here), else the opens-into of the nearest container that names a tile here (not itself), else its home (a list's
 * reader), else the open rule: the next column of its flow (`next`), beside it (`beside`), or none (a reader is its own
 * home: the note replaces its own; anything else lands in the first reader that isn't pinned).
 */
export function landing<I>(s: Pick<LayoutState<I>, "tree" | "policy" | "wires" | "names">, id: I, verb: "open" | "alt", facts?: TileFacts, tile?: (id: I) => TileFacts, preferred?: ListOpenWhere): { to: I; full?: true } | { float: true } | { into: string } | { next: true } | { beside: I } | { tab: I } | { across: string; rule: AltRule } | null {
  const wire = s.wires.find(w => w.from === id && w.verb === verb && s.names.has(w.to));
  if (verb === "alt") {
    const open = landing(s, id, "open", facts, tile);
    const policy = policyAt(s, id, facts);
    const altOpens = policy.altOpens;
    const rule = wire?.rule ?? (wire ? "tile" : altOpens ?? "beside");
    const target = wire?.to ?? (open && "to" in open ? open.to : id);
    if (rule === "first-unheld") {
      const available = leaves(s.tree).find(t => { const f = tile?.(t); return f?.notes && !f.follower && !f.pinned && !f.editing && !f.holds; });
      if (available !== undefined) return { to: available };
    }
    if (!wire && open && "across" in open) return { across: open.across, rule };
    if (rule === "tile") return { to: target };
    if (rule === "tab") return { tab: target };
    if (!wire && !policy.by.altOpens && open && ("into" in open || "next" in open)) return open;
    return { beside: target };
  }
  if (wire) return { to: wire.to };
  const e = policyAt(s, id, facts);
  const into = e.opensInto ? named(s, e.opensInto) : undefined;
  if (into !== undefined && into !== id) return { to: into };
  // A container by its key (the board's readers row): a tile opened into it holds the note.
  if (into === undefined && e.opensInto && node(s.tree, e.opensInto)) return { into: e.opensInto };
  if (preferred === "current" || preferred === "full") return { to: id, ...(preferred === "full" ? { full: true } : {}) };
  if (preferred === "beside") return { beside: id };
  if (preferred === "float") return { float: true };
  // A list (the links tile) opens in its home, the reader it belongs to, when no link or container says otherwise (PIE-794).
  const home = facts?.home !== undefined ? named(s, facts.home) : undefined;
  if (home !== undefined && home !== id) return { to: home };
  if (facts?.home?.includes("/")) return { across: facts.home, rule: "tile" };
  if (e.opens === "beside") return { beside: id };
  if (e.opens === "next" && flowHolding(s.tree, id)) return { next: true };
  return null;
}

