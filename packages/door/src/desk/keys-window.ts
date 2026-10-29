// The keys window (PIE-492): every key binding the door has, filtered as you type, each with where it works, what it
// does, what it takes its key from and what takes it first, and a rebind that says what it would do before it lands,
// saved in the one keymap file (src/surface/keymap.ts). A tile kind (`keys`) and a screen of one (`keys`, `?` on every
// screen, `ep0ch --screen keys`); every key and click runs one of KEYS_WINDOW_ACTIONS, and its own keys are a table the
// keymap moves like any other. It draws what the catalog says (src/surface/key-catalog.ts) and words nothing of its own
// about a binding.
import { C, chip, ellipsize, fg, pad, RESET, selectedRow, width } from "../style";
import { RowView, wheelRows } from "../scroll";
import { wrap } from "../text";
import { keycap } from "../figures/keys";
import { ActionRefused, actionSet, actRequestOf, allActionSets, chordName, def, keyCaption, keyName, lineWords, shownLine } from "../surface/actions";
import { bindings, conflicts, fightOf, LAYERS, rebindEffects, shadowsOf, strayEntries, unbound, type Binding } from "../surface/key-catalog";
import { bindingId, entriesOf, keymapPath, keymapProblem, keymapVersion, keyTable, resetKeys, setKeys, undoKeymap } from "../surface/keymap";
import { filterLine, type LineField } from "../surface/line";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { chips, tabStrip } from "../surface/chip-rows";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";
import { TILE_ACTIONS } from "./tile-actions";
import { tileRegistry } from "./tile-registry";
import type { ScreenSpec } from "./screen-spec";
import type { KindHost, TileKind } from "./tile-kinds";

export const KEYS_TABS = ["bindings", "conflicts", "yours", "unbound"] as const;
export type KeysTab = (typeof KEYS_TABS)[number];


const row = (key: string, action: string, label: string, args?: Record<string, unknown>, says?: string): ModeKey => ({ key, action, label, ...(args ? { args } : {}), ...(says ? { says } : {}) });
/** The window's own keys: a table like any mode's, so the keymap moves them and the hint row says them. */
export const KEYS_WINDOW_KEYS: readonly ModeKey[] = keyTable("keys window", "the keys window (?)", [
  row("j", "keys.select", "select", { by: 1 }), row("down", "keys.select", "select", { by: 1 }),
  row("k", "keys.select", "select", { by: -1 }), row("up", "keys.select", "select", { by: -1 }),
  row("pgdn", "keys.select", "page", { by: 10 }, "select the binding a page down"), row("pgup", "keys.select", "page", { by: -10 }, "select the binding a page up"),
  // Tabs by digit (the screen has no tile digits); Tab stays the desk's focus key.
  row("/", "keys.filter", "filter"), row("1", "keys.tab", "bindings", { tab: "bindings" }), row("2", "keys.tab", "conflicts", { tab: "conflicts" }), row("3", "keys.tab", "yours", { tab: "yours" }, "show the keys your keymap gives"), row("4", "keys.tab", "unbound", { tab: "unbound" }, "show the actions no key reaches"),
  row("r", "keys.rebind", "rebind", undefined, "move the selected binding to another key"), row("u", "keys.unbind", "unbind", undefined, "take the selected binding's key away"), row("d", "keys.reset", "built-in keys"),
  row("enter", "keys.run", "run it"), row("ctrl+z", "keys.undo", "undo", undefined, "undo the last change to your keymap made here"), row("esc", "keys.close", "close"), row("q", "keys.close", "close"),
]);
/** While the filter is typed: the line editor has every other key. */
export const KEYS_FILTER_KEYS: readonly ModeKey[] = keyTable("keys filter", "the keys window's filter, being typed", [
  row("enter", "keys.filter", "done", { done: true }, "keep the filter typed in the keys window"), row("esc", "keys.filter", "clear", { text: "", done: true }, "clear the keys window's filter"),
]);
/** While a rebind waits for its key, and then for the person's yes. */
export const KEYS_RECORD_KEYS: readonly ModeKey[] = keyTable("keys record", "a rebind waiting for the new key", [
  row("enter", "keys.confirm", "save"), row("esc", "keys.cancel", "cancel"),
]);

interface Hit { y: number; from: number; to: number; action: string; args?: Record<string, unknown> }
interface Row { b: Binding; head?: string }

/** The words a filter matches a binding by: its keys, action, scope, layer and what it does. */
const words = (b: Binding) => `${b.cap} ${b.key} ${b.action} ${b.id} ${b.scope} ${b.layer} ${b.does}${b.yours ? " yours" : ""}`.toLowerCase();
/**
 * Whether binding `b` has every word of a filter: a word is in its words, except `in:<scope>`, which is its scope (or
 * one named after it: `in:river` is the river column's too) or layer exactly (`?` opens the window with `in:note` in a
 * reader, `in:board` on the board, `in:river` in the river's Library).
 */
export function matches(b: Binding, filter: string): boolean {
  const w = words(b);
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every(x => (x.startsWith("in:") ? b.scope.toLowerCase() === x.slice(3) || b.scope.toLowerCase().startsWith(`${x.slice(3)} `) || b.layer === x.slice(3) : w.includes(x)));
}
/** The bindings in the order the window lists them: by layer (the order a key passes them), then scope, as the parts say them. */
const listed = (all: readonly Binding[]) => [...all].sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) || a.scope.localeCompare(b.scope));

export class KeysPane implements Pane {
  readonly kind = "keys";
  readonly bindings = KEYS_WINDOW_KEYS;
  tab: KeysTab = "bindings";
  filter = "";
  field: LineField | null = null;
  at = 0;
  /** A rebind in progress: the binding, the first key of a ^W chord typed so far, the key typed, what it would do. */
  record: { b: Binding; first?: string; key?: string } | null = null;
  /** What the last change did, said under the detail until the next. */
  said: string | null = null;
  readonly view = new RowView();
  private hits: Hit[] = [];
  private listRows = 0;
  private bodyAt = 0;
  private cached: { v: number; all: Binding[]; unbound: Binding[] } | null = null;

  /** It is the keys screen's own tile (q goes back to the screen under it), not a tile on a desk (q closes it). */
  readonly screen: boolean;
  constructor(spec: { filter?: string; tab?: string; screen?: boolean } = {}) {
    this.filter = spec.filter ?? "";
    this.screen = !!spec.screen;
    if ((KEYS_TABS as readonly string[]).includes(spec.tab ?? "")) this.tab = spec.tab as KeysTab;
  }

  title() { return `keys${this.filter ? ` · ${this.filter}` : ""}`; }
  hint() {
    if (this.record) return modeHint(KEYS_RECORD_KEYS, a => KEYS_WINDOW_ACTIONS.def(a)) + (this.record.key ? "" : ` · type the new key${this.record.b.key.startsWith("ctrl+w ") ? " (^W, then the key)" : ""}`);
    if (this.field) return `type to filter · ${modeHint(KEYS_FILTER_KEYS, a => KEYS_WINDOW_ACTIONS.def(a))}`;
    return modeHint(KEYS_WINDOW_KEYS, a => KEYS_WINDOW_ACTIONS.def(a));
  }
  typing() { return !!this.field || !!this.record; }
  claims(_k: Key) { return !!this.field || !!this.record; }
  spec() { return { state: { filter: this.filter, tab: this.tab, ...(this.screen ? { screen: true } : {}) } }; }

  /** Every binding now (worked out again when the keymap changes). */
  all(): Binding[] {
    const v = keymapVersion();
    if (!this.cached || this.cached.v !== v) { const all = bindings(); this.cached = { v, all, unbound: unbound(all) }; }
    return this.cached.all;
  }
  /** Every action no key reaches now (the Unbound tab), worked out with the bindings. */
  unbound(): Binding[] { this.all(); return this.cached!.unbound; }
  /** The rows of the tab shown, filtered: every word of the filter in a binding's keys, action, scope or words. */
  rows(): Row[] {
    const all = listed(this.all());
    const hit = (b: Binding) => matches(b, this.filter);
    if (this.tab === "bindings") return all.filter(hit).map(b => ({ b }));
    if (this.tab === "yours") return all.filter(b => b.yours && hit(b)).map(b => ({ b }));
    // Unbound: every action no key reaches, by where it runs (the layer, then the scope).
    if (this.tab === "unbound") return listed(this.unbound()).filter(hit).map(b => ({ b }));
    // Conflicts: keys two bindings really fight over (one lookup, both live), the one that runs first; the person's own first.
    const groups = conflicts(all).filter(g => g.some(hit)).sort((a, b) => Number(b.some(x => x.yours)) - Number(a.some(x => x.yours)));
    return groups.flatMap(g => { const f = fightOf(g), w = g.find(b => b.id === f.wins)!; return [w, ...g.filter(b => b !== w)].map((b, i) => ({ b, ...(i === 0 ? { head: `${b.cap} · ${b.scope}: ${f.wins} runs, ${f.loses.join(", ")} never does (${f.why})` } : {}) })); });
  }
  selected(): Binding | null { const r = this.rows(); return r[Math.min(this.at, r.length - 1)]?.b ?? null; }

  render(w: number, h: number, _focused: boolean, _desk: DeskApi): PaneView {
    this.hits = []; this.buttons = [];
    const rows = this.rows(), all = this.all();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const lines: string[] = [];
    const yours = all.filter(b => b.yours).length, clash = conflicts(all).length;
    // The count sits beside the tabs where there's room, else at the end of the filter line (a narrow tile keeps every tab,
    // and the Conflicts and Yours counts: Bindings' is the filter line's "of").
    const count = `${rows.length ? this.at + 1 : 0} of ${rows.length}`, roomy = w >= 80;
    const label = (t: KeysTab) => (t === "bindings" ? (w < 60 ? "Bindings" : `Bindings ${all.length}`) : t === "conflicts" ? `Conflicts ${clash}` : t === "yours" ? `Yours ${yours}` : `Unbound ${this.unbound().length}`);
    // Narrow, the tabs take two rows rather than cut a count.
    const strips = tabStrip(KEYS_TABS.map((t, i) => ({ key: String(i + 1), label: label(t), on: t === this.tab, hit: { action: "keys.tab", args: { tab: t } } })), { width: roomy ? w - width(count) - 1 : w, overflow: roomy ? "share" : "wrap", style: { ...chips(), gap: "" } });
    strips.forEach((strip, y) => {
      lines.push(roomy && y === 0 ? pad(strip.text, Math.max(0, w - width(count) - 1)) + " " + fg(C.dark) + count + RESET : strip.text);
      for (const x of strip.hits) this.hits.push({ y, ...x });
    });
    const tail = roomy ? "" : " " + fg(C.dark) + count + RESET, fieldW = Math.max(4, w - 10 - (roomy ? 0 : width(count) + 1));
    const filterText = this.field ? this.field.show(fieldW) : this.filter ? fg(C.white) + ellipsize(this.filter, fieldW) + RESET : fg(C.dark) + ellipsize("keys, an action, a scope or words", fieldW) + RESET;
    lines.push(pad(fg(C.yellow) + " / " + RESET + fg(C.grey) + "filter " + RESET + filterText, Math.max(0, w - width(tail))) + tail);
    this.hits.push({ y: lines.length - 1, from: 0, to: w, action: "keys.filter" });
    const problem = keymapProblem(), stray = strayEntries();
    if (problem) lines.push(fg(C.lred) + ellipsize(` ${problem}`, w) + RESET);
    if (stray.length) lines.push(fg(C.yellow) + ellipsize(` ${keymapPath()} names actions this door doesn't have: ${stray.map(e => e.id).join(", ")}`, w) + RESET);
    const wide = w >= 96, listW = this.listW = wide ? Math.floor(w * 0.56) : w;
    const sel = rows[this.at]?.b ?? null;
    const detail = sel ? this.detail(sel, wide ? w - listW - 3 : w, all)
      : [fg(C.dark) + ellipsize(this.filter ? ` no ${this.tab === "bindings" ? "binding" : this.tab === "yours" ? "key of yours" : this.tab === "unbound" ? "action without a key" : "conflict"} matches "${this.filter}": / then esc clears it` : this.tab === "yours" ? " your keymap gives no keys yet: r on a binding moves one" : this.tab === "conflicts" ? " no two bindings fight over a key: wherever a key works, it runs one action" : this.tab === "unbound" ? " every action has a key somewhere" : " nothing here", wide ? w - listW - 3 : w) + RESET, ...(this.said ? ["", fg(C.lgreen) + ellipsize(this.said, wide ? w - listW - 3 : w) + RESET] : [])];
    this.bodyAt = lines.length + 1;
    const room = Math.max(1, h - this.bodyAt - (wide ? 0 : Math.min(detail.length + 1, Math.max(4, Math.floor(h / 2)))));
    this.listRows = room;
    lines.push(fg(C.dark) + "─".repeat(w) + RESET);
    const top = this.view.place(rows.length ? this.at : null, rows.length, room);
    // The key column is as wide as the widest key shown (^W h to ctrl+space), so no key is cut.
    const shown = rows.slice(top, top + room);
    this.capW = Math.min(14, Math.max(listW < 60 ? 7 : 10, ...shown.map(r => (r.b.key ? width(r.b.cap) : listW < 60 ? 7 : 10))));
    const listed = shown.map((r, i) => this.rowLine(r, top + i === this.at, listW));
    if (wide) {
      for (let i = 0; i < Math.max(room, 0); i++) {
        const l = listed[i] ?? " ".repeat(listW), d = detail[i] ?? "";
        lines.push(pad(l, listW) + RESET + fg(C.dark) + " │ " + RESET + d);
      }
    } else {
      lines.push(...listed, ...Array.from({ length: Math.max(0, room - listed.length) }, () => ""));
      lines.push(fg(C.dark) + "─".repeat(w) + RESET, ...detail);
    }
    // The detail's buttons were placed in its own lines: lift them to where the detail is drawn.
    const detailTop = wide ? this.bodyAt : this.bodyAt + room + 1, detailX = wide ? listW + 3 : 0;
    for (const b of this.buttons) this.hits.push({ ...b, y: b.y + detailTop, from: b.from + detailX, to: b.to + detailX });
    return { lines: lines.slice(0, h).map(l => pad(l, w) + RESET), scroll: { top, total: rows.length, room } };
  }

  /** The key column's width as last drawn: the widest key shown. */
  private capW = 10;
  private rowLine(r: Row, on: boolean, w: number): string {
    // Narrow (a 44-column tile), the words get the room: the scope is in the detail, and the filter (`in:note`) says it.
    const narrow = w < 60, b = r.b, capW = this.capW + 2, cap = !b.key ? (narrow ? fg(C.brown) + ellipsize(b.scope, capW - 1) + RESET : fg(C.dark) + (b.rebind === true ? "no key" : "needs args") + RESET) : keycap(b.cap), scopeW = narrow ? 0 : Math.min(14, Math.max(6, Math.floor(w * 0.18)));
    const mark = b.yours ? fg(C.lcyan) + "●" + RESET : r.head ? fg(C.yellow) + "!" + RESET : " ";
    const scope = narrow ? "" : fg(C.brown) + pad(ellipsize(b.scope, scopeW), scopeW) + RESET + " ";
    const text = mark + pad(cap, capW) + " " + scope + fg(C.grey) + ellipsize(b.does, Math.max(4, w - capW - scopeW - (narrow ? 3 : 4))) + RESET;
    return on ? selectedRow(text, w) : text;
  }

  /** The detail's buttons, in its own lines and cells (render lifts them to the screen's). */
  private buttons: Hit[] = [];

  /** What the selected binding is, said from the catalog: runs, where, what it takes from and what takes it, how to move it. */
  private detail(b: Binding, w: number, all: readonly Binding[]): string[] {
    this.buttons = [];
    const out: string[] = [];
    const label = (k: string, v: string) => out.push(fg(C.dark) + pad(k, 9) + RESET + ellipsize(v, Math.max(4, w - 9)));
    // The selected row's sentence whole, wrapped under its key where the list cut it (a 40-column tile, PIE-1425).
    const capW = b.key ? width(b.cap) + 3 : 0, said = wrap(b.does, Math.max(8, w - capW - 1));
    said.slice(0, 3).forEach((l, i) => out.push((i === 0 ? (b.key ? keycap(b.cap) + " " : "") : " ".repeat(capW)) + fg(C.white) + (i === 2 && said.length > 3 ? ellipsize(`${l} ${said.slice(3).join(" ")}`, Math.max(8, w - capW - 1)) : l) + RESET));
    label("runs", fg(C.yellow) + b.id + RESET + (b.about !== b.does ? fg(C.grey) + `: ${b.about}` + RESET : ""));
    label("where", `${b.scope} · ${b.layer === "yours" ? "your keymap's layer" : `the ${b.layer} layer`}`);
    const s = b.key ? shadowsOf(b, all) : { over: [], under: [], terminal: true };
    if (s.over.length) for (const o of s.over.slice(0, 3)) label("taken by", `${o.id} (${o.scope}): the ${o.layer} layer gets it first`);
    if (s.under.length) for (const u of s.under.slice(0, 3)) label("takes", `${u.cap} from ${u.id} (${u.scope}), wherever both are`);
    if (b.key) label("terminal", s.terminal ? "in a terminal tile the program gets it" : "the door takes it even in a terminal tile");
    label("keymap", !b.key ? (b.rebind === true ? "no key on any screen: r gives it one, ⏎ runs it" : `no key: ${b.rebind}`) : b.yours ? `yours: ${keymapPath()}` : b.rebind === true ? "built-in: r moves it, u unbinds it" : `can't move: ${b.rebind}`);
    if (this.record && this.record.b.id === b.id) {
      out.push("");
      const r = this.record;
      if (!r.key) out.push(fg(C.lcyan) + ellipsize(`press the new key for ${b.id}${r.first ? `: ${keyCaption(r.first)} …` : b.key.startsWith("ctrl+w ") ? " (^W, then the key)" : ""} · esc cancels`, w) + RESET);
      else {
        const e = rebindEffects(b, r.key, all);
        if (e.problem) out.push(fg(C.lred) + ellipsize(`${keyCaption(r.key)}: ${e.problem}`, w) + RESET);
        else {
          out.push(fg(C.lcyan) + ellipsize(`${b.key ? b.cap : "no key"} → ${keyCaption(r.key)}`, w) + RESET);
          const cap = keyCaption(r.key);
          for (const t of e.takes.slice(0, 3)) out.push(fg(C.yellow) + ellipsize(`  takes ${cap} from ${t.id} (${t.does})`, w) + RESET);
          for (const o of e.over.slice(0, 2)) out.push(fg(C.grey) + ellipsize(`  ${o.id} (${o.scope}) still gets ${cap} first`, w) + RESET);
          for (const u of e.under.slice(0, 2)) out.push(fg(C.grey) + ellipsize(`  ${u.id} (${u.scope}: ${u.does}) stops getting ${cap} where both are`, w) + RESET);
          if (!e.takes.length && !e.over.length && !e.under.length) out.push(fg(C.grey) + `  ${keyCaption(r.key)} is free here` + RESET);
          this.button(out, "⏎ save", "keys.confirm");
        }
      }
      this.button(out, "esc cancel", "keys.cancel", true);
    } else if (b.rebind === true) {
      out.push("");
      this.button(out, b.key ? "r rebind" : "r give it a key", "keys.rebind");
      if (b.key) this.button(out, "u unbind", "keys.unbind", true);
      if (entriesOf(b.action).length) this.button(out, "d built-in keys", "keys.reset", true);
    }
    if (this.said) out.push("", fg(C.lgreen) + ellipsize(this.said, w) + RESET);
    return out;
  }
  /** A clickable button on the detail's last line (`same`: beside the one before it). */
  private button(out: string[], text: string, action: string, same = false) {
    if (!same || !out.length || !this.buttons.length || this.buttons.at(-1)!.y !== out.length - 1) out.push("");
    const y = out.length - 1, from = width(out[y]!) + (out[y] ? 1 : 0);
    out[y] = (out[y] ? out[y] + " " : "") + chip(C.blue) + ` ${text} ` + RESET;
    this.buttons.push({ y, from, to: from + width(text) + 2, action });
  }

  key(k: Key, desk: DeskApi): boolean {
    if (this.record && k.kind !== "mouse") return this.recordKey(k, desk);
    if (this.field && k.kind !== "mouse") {
      const b = modeBinding(KEYS_FILTER_KEYS, k);
      if (b) { this.act(desk, b.action, b.args ?? {}); return true; }
      if (this.field.take(k)) { this.filter = this.field.text; this.at = 0; desk.redraw(); }
      return true;
    }
    const b = modeBinding(KEYS_WINDOW_KEYS, k);
    if (b) { this.act(desk, b.action, b.args ?? {}); return true; }
    return false;
  }
  /** A rebind's next key: the new key (a ^W chord takes two), ⏎ saves it, esc cancels. */
  private recordKey(k: Key, desk: DeskApi): boolean {
    const r = this.record!;
    if (r.key) { const b = modeBinding(KEYS_RECORD_KEYS, k); if (b) { this.act(desk, b.action); return true; } }
    else if (k.kind === "esc") { this.act(desk, "keys.cancel"); return true; }
    const name = keyName(k);
    if (!name) return true;
    if (!r.b.key && !r.first && name === "ctrl+w") { r.first = name; desk.redraw(); return true; }
    if (r.b.key.startsWith("ctrl+w ") && !r.first) { if (name === "ctrl+w") { r.first = name; desk.redraw(); } else this.said = "a ^W key: press ^W, then the key"; desk.redraw(); return true; }
    r.key = r.first ? `${r.first} ${name === "space" ? "space" : name}` : name;
    desk.redraw();
    return true;
  }
  private act(desk: DeskApi, name: string, args: Record<string, unknown> = {}) { void desk.press?.(this, KEYS_WINDOW_ACTIONS, name, args); }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.act(desk, "keys.select", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    const hit = this.hits.find(h => h.y === y && x >= h.from && x < h.to);
    if (hit) { this.act(desk, hit.action, hit.args ?? {}); return true; }
    // A row of the list (beside the detail on a wide tile, above it on a narrow one).
    const n = y - this.bodyAt;
    // The selected row clicked again runs it, as ⏎ does.
    const row = this.view.top + n;
    if (n >= 0 && n < this.listRows && x < this.listW) this.act(desk, row === this.at && row < this.rows().length ? "keys.run" : "keys.select", row === this.at ? {} : { n: row + 1 });
    return true;
  }
  private listW = 0;

  describe() {
    const b = this.selected();
    return { tab: this.tab, filter: this.filter, rows: this.rows().length, at: this.at + 1, typing: !!this.field, ...(b ? { selected: { key: b.key, id: b.id, scope: b.scope, layer: b.layer, does: b.does, rebind: b.rebind } } : {}), ...(this.record ? { record: { id: this.record.b.id, key: this.record.key ?? null } } : {}), ...(this.said ? { said: this.said } : {}), file: keymapPath() };
  }
}

const paneOf = (p: unknown): KeysPane => { if (!(p instanceof KeysPane)) throw new ActionRefused("that isn't a keys window"); return p; };
const pick = (p: KeysPane, n?: number, by?: number) => {
  const total = p.rows().length;
  if (!total) throw new ActionRefused("nothing matches the filter: keys.filter text= changes it");
  p.at = n !== undefined ? Math.max(0, Math.min(total - 1, n - 1)) : Math.max(0, Math.min(total - 1, p.at + (by ?? 1)));
  p.view.reveal();
  return p.selected()!;
};
/** A binding's name from an act line as the file and `act` write it (quotes and all). */
const idOf = (line: string) => { const r = actRequestOf(lineWords(line)); return bindingId(r.action, r.args ?? {}); };
const said = (b: Binding) => ({ key: b.key, id: b.id, scope: b.scope, does: b.does });
/** The binding an action works on: `id=` with `key=` (its key now) names one; else the selected row. */
const target = (p: KeysPane, id?: string, key?: string): Binding => {
  if (id === undefined) { const b = p.selected(); if (!b) throw new ActionRefused("no binding selected: keys.select n= or keys.filter text= first"); return b; }
  const name = idOf(id);
  const all = [...p.all(), ...p.unbound()].filter(b => b.id === name);
  const b = key !== undefined ? all.find(x => x.key === key || x.cap === key) : all[0];
  if (!b) throw new ActionRefused(`no binding ${id}${key ? ` on ${key}` : ""} here; keys.find text=${id.split(" ")[0]} lists its keys`);
  return b;
};

/**
 * The new keys of a binding when its key `b.key` is moved to `to` (or unbound): every key it has now, without that one
 * and with `to`.
 */
function keysAfter(p: KeysPane, b: Binding, to: string | null): string[] {
  // Every key the binding has now, wherever: the file's entry is all of them (moving ^W x leaves the board's x alone).
  // A key after another key (`e then ⏎`) isn't a key the file holds: it stays the code's.
  const now = [...new Set(p.all().filter(x => x.id === b.id && chordName(x.key) !== null).map(x => x.key))];
  const keep = now.filter(k => k !== b.key);
  return to && !keep.includes(to) ? [...keep, to] : keep;
}

export const KEYS_WINDOW_ACTIONS = actionSet<KindHost>()("keys window", {
  "keys.select": def({
    summary: "select a binding in the keys window: n=<from 1> or by=<rows> (negative up)",
    keys: [{ keys: "j k ↓ ↑", does: "a row" }, { keys: "pgdn pgup", does: "a page" }, { keys: "click", does: "on a row" }, { keys: "wheel", does: "scrolls the list" }],
    touches: "tile", replay: "safe", way: "an agent reads the rows with keys.find, which moves nothing",
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, by: { type: "number", optional: true, about: "rows to move, negative up" } },
    examples: [{ act: "keys.select n=3 tile=keys", does: "selects the third binding listed" }, { act: "keys.select by=1 tile=keys", does: "selects the next one" }],
    run({ n, by }, { pane }) { const p = paneOf(pane); p.record = null; return said(pick(p, n, by)); },
  }),
  "keys.filter": def({
    summary: "filter the keys window: text= the words (each must be in a binding's keys, action, scope or what it does); without text= the person types it (/), done=true stops typing",
    keys: [{ keys: "/", does: "then typing filters" }, { keys: "⏎", does: "done" }, { keys: "esc", does: "clears it" }, { keys: "click", does: "on the filter line" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent passes text=",
    args: { text: { type: "string", optional: true, about: "the filter's words; empty clears it" }, done: { type: "boolean", optional: true, about: "stop typing it" } },
    examples: [{ act: "keys.filter text=\"tile close\" tile=keys", does: "lists the bindings that close a tile" }, { act: "keys.filter text=yours tile=keys", does: "lists the keys your keymap gives" }],
    run({ text, done }, { pane }, actor) {
      const p = paneOf(pane);
      if (text !== undefined) { p.filter = text; p.at = 0; if (p.field) p.field = null; }
      if (done) p.field = null;
      // Typing goes on after the words it was opened with (`in:note `), never into them.
      else if (text === undefined && actor.kind !== "agent") p.field = filterLine(p.filter && !p.filter.endsWith(" ") ? `${p.filter} ` : p.filter);
      return { filter: p.filter, rows: p.rows().length };
    },
  }),
  "keys.tab": def({
    summary: "show the keys window's Bindings, Conflicts (keys two bindings really fight over: two rows of one key table on one key, or two entries of your keymap, so one never runs), Yours (what your keymap gives) or Unbound (every action no key reaches on any screen, by where it runs: r gives one a key): tab=<name>, or by=1/-1",
    keys: [{ keys: "1 2 3 4", does: "Bindings, Conflicts, Yours, Unbound" }, { keys: "click", does: "on a tab" }],
    touches: "tile", replay: "safe", way: "an agent passes tab=",
    args: { tab: { type: "string", optional: true, choices: KEYS_TABS, about: "bindings, conflicts, yours or unbound" }, by: { type: "number", optional: true, about: "1 the next tab, -1 the previous" } },
    examples: [{ act: "keys.tab tab=conflicts tile=keys", does: "lists the keys two bindings fight over, and which one runs" }, { act: "keys.tab by=1 tile=keys", does: "shows the next tab" }],
    run({ tab, by }, { pane }) {
      const p = paneOf(pane), i = KEYS_TABS.indexOf(p.tab);
      p.tab = (tab as KeysTab | undefined) ?? KEYS_TABS[(((i + (by ?? 1)) % KEYS_TABS.length) + KEYS_TABS.length) % KEYS_TABS.length]!;
      p.at = 0; p.record = null;
      return { tab: p.tab, rows: p.rows().length };
    },
  }),
  "keys.rebind": def({
    summary: "move a binding to another key: the selected one (or id=<its act line> with key=<its key now>) to to=<key> (one key, alt+n, or a ^W chord, ctrl+w q), said first and saved when confirmed; without to= the person's next key is the new one, then ⏎ saves it",
    keys: [{ keys: "r", does: "then the new key, then ⏎" }, { keys: "click", does: "on r rebind" }],
    touches: "tile", touchesWith: a => (a.to !== undefined ? "nothing" : "tile"), replay: "ask", way: "an agent passes to= (and id=, key=): it's saved at once and said",
    says: r => r.saved ? `${r.from} → ${r.to}: ${r.id}` : null, confirms: true,
    args: {
      id: { type: "string", optional: true, about: "the binding's act line (tile.close, element.select by=1); default the selected row" },
      key: { type: "string", optional: true, about: "with id=: which of its keys moves (^W x, x)" },
      to: { type: "string", optional: true, about: "the new key: one key or a ^W chord" },
    },
    examples: [{ act: "keys.rebind id=tile.close key=\"^W x\" to=\"ctrl+w q\" tile=keys", does: "moves closing a tile from ^W x to ^W q" }, { act: "keys.rebind to=alt+n tile=keys", does: "gives the selected binding alt+n in place of its key" }],
    run({ id, key, to }, { pane, desk }, actor) {
      const p = paneOf(pane), b = target(p, id, key);
      if (b.rebind !== true) throw new ActionRefused(`${b.cap || b.id} can't move: ${b.rebind}`);
      if (to === undefined) {
        if (actor.kind === "agent") throw new ActionRefused("an agent names the key: keys.rebind to=<key>");
        p.record = { b }; p.said = null;
        return { recording: b.id };
      }
      return save(p, b, to, desk);
    },
  }),
  "keys.confirm": def({
    summary: "save the rebind the keys window is showing (what it takes from what was said above it)", keys: [{ keys: "⏎", does: "while a rebind shows its key" }, { keys: "click", does: "on ⏎ save" }],
    touches: "tile", replay: "ask", says: r => r.saved ? `${r.from} → ${r.to}: ${r.id}` : null, confirms: true, args: {},
    run(_, { pane, desk }) {
      const p = paneOf(pane), r = p.record;
      if (!r?.key) throw new ActionRefused("no new key yet: r, then press the key");
      return save(p, r.b, r.key, desk);
    },
  }),
  "keys.cancel": def({
    summary: "cancel the rebind waiting in the keys window; nothing is saved", keys: [{ keys: "esc", does: "while a rebind waits" }, { keys: "click", does: "on esc cancel" }],
    touches: "tile", replay: "safe", args: {},
    run(_, { pane }) { const p = paneOf(pane), was = p.record?.b.id ?? null; p.record = null; return { cancelled: was }; },
  }),
  "keys.unbind": def({
    summary: "take a key away from its binding (the selected one, or id= with key=): saved in your keymap, so the key does nothing there; d gives the built-in keys back",
    keys: [{ keys: "u", does: "the selected binding" }, { keys: "click", does: "on u unbind" }],
    touches: "tile", touchesWith: a => (a.id !== undefined ? "nothing" : "tile"), replay: "ask", says: r => `${r.cap} unbound: ${r.id}`, confirms: true, way: "an agent passes id= and key=",
    args: { id: { type: "string", optional: true, about: "the binding's act line; default the selected row" }, key: { type: "string", optional: true, about: "with id=: which of its keys" } },
    examples: [{ act: "keys.unbind id=callouts key=z tile=keys", does: "takes z away from the reader's callouts" }],
    run({ id, key }, { pane }) {
      const p = paneOf(pane), b = target(p, id, key);
      if (!b.key) throw new ActionRefused(`${b.id} has no key to take away`);
      if (b.rebind !== true) throw new ActionRefused(`${b.cap || b.id} can't move: ${b.rebind}`);
      setKeys(b.id, keysAfter(p, b, null));
      p.said = `${b.cap} unbound from ${b.id} · ctrl+z undoes`;
      return { cap: b.cap, id: b.id, file: keymapPath() };
    },
  }),
  "keys.reset": def({
    summary: "give a binding its built-in keys back (the selected one, or id=): its entry leaves your keymap",
    keys: [{ keys: "d", does: "the selected binding" }, { keys: "click", does: "on d built-in keys" }],
    touches: "tile", touchesWith: a => (a.id !== undefined ? "nothing" : "tile"), replay: "ask", says: r => `${r.id}: its built-in keys again`, confirms: true, way: "an agent passes id=",
    args: { id: { type: "string", optional: true, about: "the binding's act line; default the selected row" } },
    examples: [{ act: "keys.reset id=tile.close tile=keys", does: "gives closing a tile its ^W x back" }],
    run({ id }, { pane }) {
      const p = paneOf(pane), name = id === undefined ? p.selected()?.id : idOf(id);
      if (!name) throw new ActionRefused("no binding selected: keys.select n= first, or id=");
      if (!resetKeys(name)) throw new ActionRefused(`${name} has its built-in keys already`);
      p.said = `${name}: its built-in keys again · ctrl+z undoes`;
      return { id: name };
    },
  }),
  "keys.undo": def({
    summary: "put your keymap back as it was before the last change made here (a rebind, an unbind, built-in keys again)",
    keys: [{ keys: "ctrl+z", does: "in the keys window" }], touches: "nothing", replay: "ask", says: r => r.undone ? "keymap: the last change undone" : "keymap: nothing to undo", confirms: true, args: {},
    run(_, { pane }) { const p = paneOf(pane), undone = undoKeymap(); p.said = undone ? "the last change undone" : "nothing to undo here"; p.record = null; return { undone }; },
  }),
  "keys.find": def({
    words: "list the bindings matching some words, as the keys window does",
    summary: "the bindings matching text= (words in their keys, action, scope or what they do), as the window lists them, each with where it works and whether it can move; moves nothing",
    touches: "nothing", replay: "safe",
    args: { text: { type: "string", optional: true, about: "the words; left out, the window's own filter" }, limit: { type: "number", optional: true, about: "at most this many (default 40)" } },
    examples: [{ act: "keys.find text=\"tile.close\" tile=keys", does: "lists every key that closes a tile, and where" }],
    run({ text, limit }, { pane }) {
      // Every binding, then the actions no key reaches (key "", unbound: true), so an agent finds those too.
      const p = paneOf(pane), all = p.all(), rows = [...listed(all), ...listed(p.unbound())].filter(b => matches(b, text ?? p.filter));
      return { total: rows.length, bindings: rows.slice(0, limit ?? 40).map(b => ({ key: b.key, cap: b.cap, id: b.id, scope: b.scope, layer: b.layer, does: b.does, rebind: b.rebind, ...(b.yours ? { yours: true } : {}), ...(!b.key ? { unbound: true } : {}), ...(() => { const s = shadowsOf(b, all); return { takesFrom: s.under.map(u => u.id), takenBy: s.over.map(o => o.id), terminal: s.terminal ? "the program gets it" : "the door takes it" }; })() })) };
    },
  }),
  "keys.run": def({
    summary: "run the selected binding (or row n=) where the keys window was opened from, as its key does there: the tile it opened beside gets the person's keys back and the action runs in it (the keys screen goes back first). One that needs arguments the binding doesn't give opens its form in the power bar, the way the bar asks for them",
    keys: [{ keys: "⏎", does: "on the selected binding" }, { keys: "click", does: "on the selected row again" }],
    touches: "screen", replay: "ask",
    person: "⏎ in the keys window runs a binding as the person's own key would, in their tile; an agent runs the action itself (ep0ch act <its act line>, keys.find lists them)",
    args: { n: { type: "number", optional: true, about: "the row, from 1; default the selected one" } },
    examples: [{ act: "keys.run n=2 tile=keys", does: "runs the second binding listed in the tile the window was opened from" }],
    async run({ n }, { pane, desk }) {
      const p = paneOf(pane), b = n !== undefined ? pick(p, n) : p.selected();
      if (!b) throw new ActionRefused("no binding selected: keys.select n= or keys.filter text= first");
      const ctx = desk.ctx;
      if (!ctx.press) throw new ActionRefused("this screen isn't given the door's actions: run it with its key where it works");
      const args = { ...b.args }, asks = needs(b.action).filter(a => args[a] === undefined);
      // The window's own keys run here, in it.
      if (KEYS_WINDOW_ACTIONS.has(b.action) && !asks.length) { await desk.press?.(p, KEYS_WINDOW_ACTIONS, b.action, args); return { ran: b.id }; }
      // Back where it was opened from, so the action runs on that tile as its key would there.
      const opener = tileRegistry.openerOf(p);
      if (p.screen) await ctx.press("screen.back");
      else if (opener !== undefined) { try { await ctx.press("tile.focus", {}, opener); } catch { /* that tile is gone: the action runs where the keys are */ } }
      p.said = null;
      if (asks.length) await ctx.press("bar.form", { op: "open", line: shownLine(b.action, args) });
      else await ctx.press(b.action, args);
      return { ran: b.id, ...(asks.length ? { asks } : {}) };
    },
  }),
  "keys.close": def({
    summary: "close the keys window: the keys screen goes back to the screen it was opened over; a keys tile closes as a tile does, the keys back in the tile it opened beside", keys: [{ keys: "esc q", does: "close it" }],
    touches: "screen", replay: "safe", args: {},
    async run(_, { pane, desk }) {
      if (paneOf(pane).screen) await desk.ctx.press?.("screen.back");
      else await desk.press?.(pane, TILE_ACTIONS, "tile.close", {});
      return { closed: true };
    },
  }),
});

/** The arguments action `name` can't run without (its def's, not optional). */
const needs = (name: string): string[] => Object.entries(allActionSets().find(s => s.has(name))?.def(name)?.args ?? {}).filter(([, a]) => !(a as { optional?: boolean }).optional).map(([k]) => k);

/** Give binding `b` key `to` in its place: what it would take is said in the answer, and the window says what changed. */
function save(p: KeysPane, b: Binding, to: string, desk: DeskApi): Record<string, unknown> {
  const e = rebindEffects(b, to, p.all());
  if (e.problem) throw new ActionRefused(`${keyCaption(to)}: ${e.problem}`);
  setKeys(b.id, keysAfter(p, b, to));
  p.record = null;
  const took = e.takes.map(t => t.id);
  p.said = `${b.cap || "no key"} → ${keyCaption(to)} for ${b.id}${took.length ? `; ${took.join(", ")} lost it` : ""} · ctrl+z undoes`;
  desk.redraw();
  return { saved: true, id: b.id, from: b.cap || null, to: keyCaption(to), took, still: e.over.map(o => o.id), file: keymapPath() };
}

/** The keys window as a tile kind: one list, opened by the `keys` screen (`?`) or ^W o. */
export const KEYS_KIND: TileKind = {
  kind: "keys", about: "every key binding with where it works, what it takes its key from, and a rebind that says what it does before it lands (the keys window)",
  noun: "the keys window",
  make: spec => new KeysPane({ ...(typeof spec.state?.filter === "string" ? { filter: spec.state.filter } : {}), ...(typeof spec.state?.tab === "string" ? { tab: spec.state.tab } : {}), screen: spec.state?.screen === true }),
  actions: KEYS_WINDOW_ACTIONS,
  takesKeys: p => (p as KeysPane).typing(),
  save: p => (p as KeysPane).spec(),
  peek: p => ({ keys: (p as KeysPane).describe() }),
};

/** The keys screen: one keys window, its filter the words it was opened with (`?` passes where you were). */
export function keysSpec(args: Record<string, unknown> = {}): ScreenSpec {
  const filter = typeof args.filter === "string" ? args.filter : "";
  return { name: "keys", title: "keys", digits: false, layout: { focus: "keys", root: { t: "leaf", kind: "keys", name: "keys", state: { screen: true, ...(filter ? { filter } : {}) } } } };
}

