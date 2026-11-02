import type { DoorOpen } from "@ep0ch/outline-core/door-open";
import { matchesSearchText } from "@ep0ch/outline-core/search-match";
import { outlineState, readState, writeState } from "./state";
import type { At } from "./desk/screen-layout";

export interface TrailPlace { name: string; screen: string; drawer: boolean; mount?: string; at?: At<string>; closed?: number }
export interface Visit {
  open: DoorOpen;
  title: string;
  left?: number;
  attention: { first?: number; last?: number; active: number; scrolls: number; selections: number; opens: number; returns: number };
}
export interface TrailSettings { days: number; linger: number; read: number; held: number; idle: number }
const DEFAULTS: TrailSettings = { days: 7, linger: 5, read: 60, held: 300, idle: 60 };
export const visitDay = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export function dayLabel(day: string, now = Date.now()): string {
  if (day === visitDay(now)) return "Today";
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return day === visitDay(+yesterday) ? "Yesterday" : day;
}

/** Facts from the local open feed. Tile history and layout undo remain their own owners. */
export class Trail {
  visits: Visit[];
  places: Record<string, TrailPlace>;
  settings: TrailSettings;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly dir = outlineState();
  private readonly titles = new Map<string, string>();
  constructor(private readonly visitChanged?: (visit: Visit) => void) {
    const kept = readState<{ visits: Visit[]; places: Record<string, TrailPlace>; settings: TrailSettings }>("trail.json", this.dir);
    this.visits = kept?.visits ?? [];
    this.places = kept?.places ?? {};
    this.settings = kept?.settings ?? { ...DEFAULTS };
    this.prune();
  }
  current(tile: string): Visit | undefined { return this.visits.findLast(v => v.open.target.tile === tile && v.left === undefined); }
  get(id: string): Visit | undefined { return this.visits.find(v => v.open.target.visit === id); }
  locate(tile: string, place: TrailPlace, note: string, title: string) {
    this.places[tile] = place;
    this.titles.set(note, title);
  }
  hear(event: DoorOpen) {
    const prior = this.current(event.target.tile);
    if (prior) { this.touch(prior, event.at); prior.left = event.at; }
    const parent = event.source?.visit && this.get(event.source.visit);
    if (parent) { this.touch(parent, event.at); parent.attention.opens++; }
    if (parent) this.visitChanged?.(parent);
    if (prior) this.visitChanged?.(prior);
    const returned = event.method === "back" || event.method === "forward";
    this.visits.push({ open: event, title: this.titles.get(event.target.note) ?? event.target.note,
      attention: { active: 0, scrolls: 0, selections: 0, opens: 0, returns: returned ? 1 : 0 } });
    this.prune(); this.changed();
  }
  private touch(v: Visit, now: number) {
    now = Math.min(now, v.left ?? now);
    const a = v.attention;
    a.active += Math.max(0, Math.min(now - (a.last ?? v.open.at), this.settings.idle * 1000));
    a.first ??= now; a.last = now;
  }
  attend(tile: string, what: "scrolls" | "selections" | "returns", now = Date.now()) {
    const v = this.current(tile); if (!v) return;
    this.touch(v, now); v.attention[what]++; this.visitChanged?.(v); this.changed();
  }
  close(tile: string, at = Date.now()) {
    const p = this.places[tile]; if (p) p.closed = at;
    const v = this.current(tile); if (v) { this.touch(v, at); v.left = at; this.visitChanged?.(v); }
    this.changed();
  }
  seconds(v: Visit, now = Date.now()): number {
    return (v.attention.active + (v.left === undefined ? Math.max(0, Math.min(now - (v.attention.last ?? v.open.at), this.settings.idle * 1000)) : 0)) / 1000;
  }
  dwell(v: Visit, now = Date.now()): "flipped" | "read" | "held" {
    const n = this.seconds(v, now);
    return n >= this.settings.held ? "held" : n >= this.settings.read || v.attention.opens > 0 ? "read" : "flipped";
  }
  skim(v: Visit, now = Date.now()): boolean {
    return (v.open.method === "select" || v.open.method === "hover") && this.seconds(v, now) < this.settings.linger && !v.attention.scrolls && !v.attention.selections && !v.attention.opens;
  }
  branch(id: string): Visit[] {
    const ids = new Set([id]);
    return this.visits.filter(v => { if (v.open.source?.visit && ids.has(v.open.source.visit)) ids.add(v.open.target.visit); return ids.has(v.open.target.visit); });
  }
  query(kind: string, args: { visit?: string; note?: string; from?: string; q?: string } = {}): Visit[] {
    this.prune();
    const all = kind === "branch" ? this.branch(args.visit ?? this.visits.at(-1)?.open.target.visit ?? "") : this.visits;
    return all.filter(v => (!args.q || matchesSearchText(args.q, [v.title, this.places[v.open.target.tile]?.name ?? ""])) &&
      (kind !== "children" || v.open.source?.visit === args.visit) && (kind !== "visits" || v.open.target.note === args.note) &&
      (kind !== "from" || v.open.target.tile === args.from) && (kind !== "closed" || this.places[v.open.target.tile]?.closed !== undefined) &&
      (kind !== "held" || this.dwell(v) === "held")).slice().reverse();
  }
  forget(args: { visit?: string; day?: string; all?: boolean }): number {
    const ids = new Set(args.visit ? this.branch(args.visit).map(v => v.open.target.visit) : []);
    const before = this.visits.length;
    this.visits = this.visits.filter(v => !(args.all || ids.has(v.open.target.visit) || (args.day && visitDay(v.open.at) === args.day)));
    this.prune(); this.changed(); return before - this.visits.length;
  }
  configure(settings: Partial<TrailSettings>) { Object.assign(this.settings, settings); this.prune(); this.changed(); return this.settings; }
  private prune() {
    const since = Date.now() - this.settings.days * 86_400_000;
    this.visits = this.visits.filter(v => v.open.at >= since);
  }
  changed() { this.timer ??= setTimeout(() => { this.timer = undefined; this.flush(); }, 200); this.timer.unref?.(); }
  flush() { const tiles = new Set(this.visits.flatMap(v => [v.open.target.tile, ...(v.open.source ? [v.open.source.tile] : [])])); for (const tile of Object.keys(this.places)) if (!tiles.has(tile)) delete this.places[tile]; if (this.timer) clearTimeout(this.timer); this.timer = undefined; writeState("trail.json", { visits: this.visits, places: this.places, settings: this.settings }, this.dir); }
}
