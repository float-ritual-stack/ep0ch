// The settings screen's index (PIE-1709): every place a setting lives, in one list a search reads. The door's own come
// first: the trail's settings as a card like an extension's (PIE-1725, src/door-settings.ts), the keys window's
// rebinding and the outline's settings note in the windows that keep them; then each installed extension with settings, its state in the chip's words (set, its defaults, needs setup,
// failing). Typed words find a section by its name and a setting by its name or what it does, the setting shown under its
// extension. Picking one shows its settings card in the screen's card tile (the open wire); ⏎ gives that card the keys.
// The rows are the extensions' own words (extensions.list), never a list written here; every key and click is an action.
import { C, fg, pad, RESET, selectedRow, ellipsize } from "../style";
import { RowView, wheelRows } from "../scroll";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { keyTable } from "../surface/keymap";
import { filterLine, type LineField } from "../surface/line";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import type { Key } from "../term";
import type { Msg } from "../board";
import { extensionList, type ExtensionEntry } from "../extensions";
import { extensionCardSchema, settingsChip, settingsNow } from "../extension-settings";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import type { ScreenSpec } from "./screen-spec";
import { DOOR_PAGE, doorOwner, doorPage } from "../door-settings";

/** One row: a heading, a door place (`page`: its card's door page; `act`: the action that opens its window), an extension, or one of its settings. */
export interface IndexRow { label: string; detail?: string; head?: true; ext?: string; page?: string; field?: string; act?: { action: string; args?: Record<string, unknown> } }

/** The door's own settings places (Evan, Nov 10: the windows that keep them now; a schema of their own makes them rows here). */
const DOOR_ROWS: readonly IndexRow[] = [
  { label: "keys", detail: "rebind any key · the keys window", act: { action: "screen.open", args: { name: "keys" } } },
  { label: "trail", detail: "how long it keeps visits, when one counts as read", page: "trail" },
  { label: "outline settings note", detail: "[query-suggest::off] and the like", act: { action: "settings.index.note" } },
];

/** The words a search finds an extension by, and each of its settings by. */
function extensionRows(e: ExtensionEntry, words: readonly string[]): IndexRow[] {
  const s = settingsNow(e);
  if (!s) return [];
  const name = e.name ?? e.id, row: IndexRow = { label: name, detail: settingsChip(s), ext: e.id };
  if (!words.length) return [row];
  const has = (text: string) => words.every(w => text.toLowerCase().includes(w));
  const schema = extensionCardSchema(e, s);
  const fields = schema.props.filter(p => has(`${p.key} ${p.meaning}`)).map((p): IndexRow => ({ label: `  ${p.key}`, detail: p.meaning, ext: e.id, field: p.key }));
  return has(`${name} ${e.id} ${e.description ?? ""}`) || fields.length ? [row, ...fields] : [];
}

/** A door place's settings a search finds by name or words, from its card's own schema (the trail's: its action's arguments). */
function doorFields(r: IndexRow, words: readonly string[]): IndexRow[] {
  const owner = r.page && words.length ? doorOwner(`${DOOR_PAGE}${r.page}`) : null;
  return owner ? owner.schema(owner.settings).props.filter(p => words.every(w => `${p.key} ${p.meaning}`.toLowerCase().includes(w))).map(p => ({ label: `  ${p.key}`, detail: p.meaning, page: r.page!, field: p.key })) : [];
}

/** Every row for the words typed: the door's places, then the extensions, each under its heading. */
export function indexRows(filter: string): IndexRow[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const door = DOOR_ROWS.flatMap(r => { const found = doorFields(r, words), named = words.every(w => `${r.label} ${r.detail}`.toLowerCase().includes(w)); return named || found[0] ? [r, ...found] : []; });
  const exts = (extensionList()?.extensions ?? []).filter(e => e.state !== "shadowed" && !e.script && settingsNow(e)).flatMap(e => extensionRows(e, words));
  const count = exts.filter(r => !r.field).length;
  return [
    ...(door.length ? [{ label: "Door", head: true as const }, ...door] : []),
    ...(exts.length ? [{ label: `Extensions · ${count}`, head: true as const }, ...exts] : []),
  ];
}

const row = (key: string, action: string, label: string, args?: Record<string, unknown>, says?: string): ModeKey => ({ key, action, label, ...(args ? { args } : {}), ...(says ? { says } : {}) });
/** The index's own keys: a table like any mode's, so the keymap moves them and the hint row says them. */
export const SETTINGS_INDEX_KEYS: readonly ModeKey[] = keyTable("settings index", "the settings screen's list", [
  row("j", "settings.index.select", "select", { by: 1 }), row("down", "settings.index.select", "select", { by: 1 }),
  row("k", "settings.index.select", "select", { by: -1 }), row("up", "settings.index.select", "select", { by: -1 }),
  row("/", "settings.index.filter", "search", undefined, "search every setting by its name or what it does"),
  row("enter", "settings.index.open", "open", undefined, "open the selected section: its settings card takes the keys, a door place opens its window"),
  row("l", "settings.index.open", "open"), row("right", "settings.index.open", "open"),
]);
/** While the search is typed: the line editor has every other key. */
export const SETTINGS_INDEX_FILTER_KEYS: readonly ModeKey[] = keyTable("settings search", "the settings screen's search, being typed", [
  row("enter", "settings.index.filter", "done", { done: true }, "keep the search typed"), row("esc", "settings.index.filter", "clear", { text: "", done: true }, "clear the search"),
]);

/** The index tile: the list, its search line and what's selected. */
export class SettingsIndexPane implements Pane {
  readonly kind = "settings-index";
  filter = "";
  field: LineField | null = null;
  at = 0;
  private view = new RowView();
  private hits: { y: number; n: number }[] = [];
  private searchRow = -1;
  /** What the index last opened in the card, so moving onto the same section opens nothing again. */
  shown: string | null = null;
  constructor(o: { filter?: string; ext?: string } = {}) {
    this.filter = o.filter ?? "";
    if (o.ext) { const n = this.rows().findIndex(r => r.ext === o.ext && !r.field); if (n >= 0) this.at = n; }
  }
  rows(): IndexRow[] { return indexRows(this.filter); }
  /** The row selected now, past the headings. */
  selected(): IndexRow | undefined {
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    if (rows[this.at]?.head) this.at = Math.min(rows.length - 1, this.at + 1);
    return rows[this.at];
  }
  title() { return "settings"; }
  hint() { return modeHint(this.field ? SETTINGS_INDEX_FILTER_KEYS : SETTINGS_INDEX_KEYS, () => undefined); }
  typing() { return !!this.field; }
  spec() { return { ...(this.filter ? { filter: this.filter } : {}), ...(this.selected()?.ext ? { ext: this.selected()!.ext } : {}) }; }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows(), sel = this.selected();
    const out: string[] = [];
    this.searchRow = 0;
    const search = this.field ? this.field.show(Math.max(1, w - 4)) : this.filter ? fg(C.yellow) + this.filter + RESET : fg(C.dark) + "search every setting" + RESET;
    out.push(pad(`${fg(C.lcyan)}/ ${RESET}${search}`, w));
    const none = !rows.length;
    if (none) out.push(pad(fg(C.dark) + `  nothing here has "${this.filter}"` + RESET, w));
    const room = Math.max(1, h - (none ? 2 : 1));
    const drawn = rows.map((r, n) => {
      if (r.head) return { n, text: fg(C.lcyan) + ellipsize(r.label, w) + RESET };
      const label = r.field ? fg(C.brown) + r.label : r.ext ? fg(C.yellow) + r.label : fg(C.white) + r.label;
      const chip = r.detail ? fg(C.dark) + ` · ${r.detail}` : "";
      return { n, text: ellipsize(`  ${label}${chip}`, w) + RESET };
    });
    this.view.place(this.at, drawn.length, room, [this.at, this.at]);
    this.hits = [];
    for (const d of drawn.slice(this.view.top, this.view.top + room)) {
      this.hits.push({ y: out.length, n: d.n });
      out.push(d.n === this.at && sel && !sel.head && (focused || !this.field) ? selectedRow(d.text, w) : pad(d.text, w));
    }
    return { lines: out.slice(0, h) };
  }

  key(k: Key, desk: DeskApi): boolean {
    if (this.field && k.kind !== "mouse") {
      const b = modeBinding(SETTINGS_INDEX_FILTER_KEYS, k);
      if (b) { this.act(desk, b.action, b.args ?? {}); return true; }
      if (this.field.take(k)) { this.filter = this.field.text; this.at = 0; desk.redraw(); }
      return true;
    }
    const b = modeBinding(SETTINGS_INDEX_KEYS, k);
    if (!b) return false;
    this.act(desk, b.action, b.args ?? {});
    return true;
  }
  private act(desk: DeskApi, name: string, args: Record<string, unknown> = {}) { void desk.press?.(this, SETTINGS_INDEX_ACTIONS, name, args); }

  mouse(k: Extract<Key, { kind: "mouse" }>, _x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "wheel-up" || k.action === "wheel-down") { this.act(desk, "settings.index.select", { by: wheelRows(k.action === "wheel-up" ? -1 : 1) }); return true; }
    if (k.action !== "down") return true;
    if (y === this.searchRow) { this.act(desk, "settings.index.filter", {}); return true; }
    const hit = this.hits.find(h => h.y === y);
    if (!hit) return true;
    // A click selects (its card shows beside); a second click on the selected row opens it.
    this.act(desk, hit.n === this.at ? "settings.index.open" : "settings.index.select", hit.n === this.at ? {} : { n: hit.n + 1 });
    return true;
  }
}

const paneOf = (p: unknown): SettingsIndexPane => {
  if (!(p instanceof SettingsIndexPane)) throw new ActionRefused("this isn't the settings list · ep0ch act screen.open name=settings opens it");
  return p;
};

/** The selected extension's page, or door place's (the trail's), shown in the screen's card tile (the open wire), its setting `field` selected there. */
async function show(p: SettingsIndexPane, desk: DeskApi, keys: boolean): Promise<{ extension?: string; place?: string; field?: string } | null> {
  const r = p.selected(), of = r?.ext ?? r?.page;
  if (!r || !of) return null;
  let m: Msg | null;
  if (r.page) m = doorPage(r.page);
  else {
    const page = extensionList()?.pages?.[of];
    if (!page) throw new ActionRefused(`${of}'s page isn't written yet`);
    m = await desk.ctx.board.get(page);
    if (!m) throw new ActionRefused(`${of}'s page isn't in the outline`);
  }
  if (!m) return null;
  // Moving onto it shows it (the select wire, the keys stay in the list); opening it gives the card the keys (the open wire).
  if (r.field) cardField.set(m.id, r.field);
  if (p.shown !== `${of}:${r.field ?? ""}` || keys) desk.openFromTile(m, keys ? { from: p, link: true } : { from: p });
  p.shown = `${of}:${r.field ?? ""}`;
  desk.redraw();
  return { ...(r.ext ? { extension: r.ext } : { place: of }), ...(r.field ? { field: r.field } : {}) };
}

/** The setting a pick in the index asked the card to select, by the page it's on: the card tile reads it as it opens. */
export const cardField = new Map<string, string>();

export const SETTINGS_INDEX_ACTIONS = actionSet<KindHost>()("settings-index", {
  "settings.index.select": def({
    summary: "select a row of the settings list (by=, or n= from one): an extension's or one of its settings shows its settings card beside, without moving the keys",
    keys: [{ keys: "j k ↑ ↓", does: "the row below or above" }, { keys: "wheel", does: "rows down or up" }, { keys: "click", does: "on a row: selects it" }], touches: "tile", replay: "safe", person: "the selection is the person's",
    args: { by: { type: "number", optional: true, about: "rows to move, negative up" }, n: { type: "number", optional: true, about: "the row, from one" }, ext: { type: "string", optional: true, about: "the extension's row, by its id" } },
    examples: [{ act: "settings.index.select n=3 tile=index", does: "selects the third row; its card shows beside" }, { act: "settings.index.select ext=yo tile=index", does: "selects yo; its card shows beside" }],
    async run({ by, n, ext }, { pane, desk }) {
      const p = paneOf(pane), rows = p.rows();
      if (!rows.length) throw new ActionRefused("nothing to select · / searches, esc clears the search");
      if (ext !== undefined && !rows.some(r => r.ext === ext && !r.field)) { p.filter = ""; p.field = null; }
      const found = ext !== undefined ? p.rows().findIndex(r => r.ext === ext && !r.field) : -1;
      if (ext !== undefined && found < 0) throw new ActionRefused(`no settings for ${ext} here · ${p.rows().filter(r => r.ext && !r.field).map(r => r.ext).join(", ")} have some`);
      const step = by !== undefined && by < 0 ? -1 : 1;
      let at = found >= 0 ? found : n !== undefined ? n - 1 : p.at + (by ?? 0);
      at = Math.max(0, Math.min(rows.length - 1, at));
      while (rows[at]?.head && at + step >= 0 && at + step < rows.length) at += step;
      p.at = at;
      const shown = await show(p, desk, false);
      return { selected: at + 1, label: rows[at]!.label.trim(), ...(shown ?? {}) };
    },
  }),
  "settings.index.open": def({
    summary: "open the selected row: its settings card takes the keys (an extension's, the trail's; a setting selected in it), and a door place without one opens its own window (the keys window, the outline's settings note)",
    keys: "⏎, l or → on a row, or a second click on it", touches: "tile", replay: "ask", person: "the keys are the person's",
    args: { n: { type: "number", optional: true, about: "the row, from one; default the selected one" } },
    examples: [{ act: "settings.index.open n=6 tile=index", does: "opens the sixth row's settings" }],
    async run({ n }, { pane, desk }, actor) {
      const p = paneOf(pane);
      if (n !== undefined) p.at = n - 1;
      const r = p.selected();
      if (!r) throw new ActionRefused("nothing selected");
      if (r.act) return desk.ctx.dispatch!.act({ action: r.act.action, ...(r.act.args ? { args: r.act.args } : {}) }, actor);
      const shown = await show(p, desk, true);
      // Its card takes the keys, the one already showing that page too (PIE-1725).
      await desk.ctx.dispatch?.act({ action: "settings", tile: "card" }, actor).catch(() => { /* no card tile: the open wire's tile has them */ });
      return shown;
    },
  }),
  "settings.index.filter": def({
    summary: "search the settings list: text= finds sections by name and settings by name or what they do (empty shows every one); with no text= the person types it, ⏎ keeps it, esc clears it",
    keys: "/ or a click on the search line; ⏎ keeps it, esc clears it", touches: "tile", replay: "safe",
    args: { text: { type: "string", optional: true, about: "the words; empty clears" }, done: { type: "boolean", optional: true, about: "stop typing it" } },
    examples: [{ act: "settings.index.filter text=model tile=index", does: "lists the settings whose name or words say model, each under its extension" }],
    run({ text, done }, { pane, desk }, actor) {
      const p = paneOf(pane);
      if (text !== undefined) { p.filter = text; p.at = 0; if (p.field && text === "") p.field = null; }
      if (done) p.field = null;
      else if (text === undefined && actor.kind === "user") p.field = filterLine(p.filter);
      desk.redraw();
      return { filter: p.filter, rows: p.rows().filter(r => !r.head).map(r => ({ label: r.label.trim(), ...(r.ext ? { extension: r.ext } : {}), ...(r.field ? { field: r.field } : {}), ...(r.detail ? { detail: r.detail } : {}) })) };
    },
  }),
  "settings.index.note": def({
    summary: "open the outline's settings note (type=settings or page=settings: [query-suggest::off] and the like) where opens land",
    keys: "⏎ on its row in the settings list", touches: "tile", replay: "ask", args: {},
    async run(_, { pane, desk }) {
      const { notes } = await desk.ctx.board.queryNotes("type=settings OR page=settings", 1, "show");
      const first = notes[0];
      if (!first) throw new ActionRefused("this outline has no settings note yet · ep0ch new \"Settings [page::settings]\" makes one");
      const m = await desk.ctx.board.get(first.id);
      if (!m) throw new ActionRefused("its settings note is gone");
      desk.openFromTile(m, { from: paneOf(pane) });
      return { opened: m.id };
    },
  }),
});

export const SETTINGS_INDEX_KIND: TileKind = {
  kind: "settings-index", about: "every place a setting lives: the door's own windows, then each installed extension's settings, with a search over every setting's name and words; picking one shows its settings card in the screen's card tile",
  noun: "the settings list",
  make: spec => new SettingsIndexPane({ ...(typeof spec.state?.filter === "string" ? { filter: spec.state.filter } : {}), ...(typeof spec.state?.ext === "string" ? { ext: spec.state.ext } : {}) }),
  actions: SETTINGS_INDEX_ACTIONS,
  takesKeys: p => (p as SettingsIndexPane).typing(),
  save: p => ({ state: (p as SettingsIndexPane).spec() }),
  start: async (p, env) => { const pane = p as SettingsIndexPane; try { await show(pane, env.desk, false); } catch { /* no extension yet: the list says so */ } },
};

/**
 * The settings screen (PIE-1709, after Obsidian's): the list on the left, the chosen extension's settings card filling
 * the right. `ext=<id>` opens it at that extension (its page's `settings` button, `ext.<id>.settings`, a failing line).
 */
export function settingsScreenSpec(args: { ext?: unknown; extension?: unknown } = {}): ScreenSpec {
  const ext = typeof args.ext === "string" ? args.ext : typeof args.extension === "string" ? args.extension : undefined;
  return {
    name: "settings", title: "settings", lands: "card",
    // A flow, as the navigator's: side by side where both read, and at a phone's 44 columns the one not in use folds to a
    // spine beside the other, so neither is squeezed past reading.
    layout: { focus: ext ? "card" : "index", root: { t: "flow", key: "settings", anchor: 1, held: [0, 1], kids: [
      { t: "leaf", kind: "settings-index", name: "index", ...(ext ? { state: { ext } } : {}), wires: [{ verb: "select", to: "card" }, { verb: "open", to: "card" }] },
      { t: "leaf", kind: "settings", name: "card", args: { fills: true } },
    ] } },
  };
}
