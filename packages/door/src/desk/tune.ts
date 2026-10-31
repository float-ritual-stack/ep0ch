import { GLASS_SETTINGS, type GlassSetting } from "../glass";
import { declaredHints, HINT_SETTINGS } from "../surface/hints";
import { tabStrip, type TabRow } from "../surface/chip-rows";
import { wrap, rowLines } from "../text";
// The tune inspector (PIE-673, PIE-675): a tile under the one it tunes, like devtools' computed styles. It lists the
// look's values for that tile (or, in a reader, the `::box` its `[ ]` is in), each with where it comes from, and nudges
// them: a nudge goes into the connection's tuning (src/look.ts), in memory, and the tiles draw with it in the next frame,
// nothing read from the outline. `s` writes the nudges to the level picked (global, the tile's kind, the screen, the
// page), attributed and checked against the revision it read. A nudge can be for every width or for the width the tile
// is in now (its breakpoint's variant), so how a narrow tile feels is tuned apart from a wide one.
//
// Back to "as if I had done nothing" (PIE-675): `u` and `U` step back and forward through every nudge and save of the
// session, each said on the status line; `x` resets one value to what it inherits (a variant first, then its plain
// value); `X` resets the level picked (every value it sets here, off its style notes); `R` puts every style note this
// session wrote back as it was. The last two ask in place: the same key again, or a click on [confirm].
//
// With a level (or one width) picked, each row shows that level's own value beside the one in force, and a row where
// something nearer wins is marked: a nudge there asks first (nudge anyway, nudge what wins instead, or clear it).
//
// Every key and click is an action (TUNE_ACTIONS), so an agent tunes the same way, said on the screen and never with
// the person's keys.
import {
  fieldKey, isListField, levelOfSave, nudgeStyleValue, parseFieldKey, parseStyleAttrs, parseStyleValue, resolveStyle, SAVE_LEVELS, STYLE_LEVELS, STYLE_GROUPS, STYLE_TOKEN_NAMES, styleProperty, STYLE_TOKENS, styleValueText,
  SURFACE_STEPS, withoutRetiredLookKeys, type Breakpoint, type StyleGroup, type StyleLayer, type StyleSource, type StyleToken, type StyleValue, type Surface,
} from "@ep0ch/outline-core/style-cascade";
import { liveTokensInLine } from "@ep0ch/outline-core/heading-styles";
import { HERO_PROP_NAMES, HERO_PROPS, heroFromRetired, isHeroProp, withHeroLine, type HeroProp } from "@ep0ch/outline-core/media-line";
import { fullText } from "../overflow";
import {
  clearNotes, levelNotes, styleSheetProblems, listTarget, lookFor, parseListTarget, retiredLooks, styleSheetsStale, writeLine, writeText, writeTile, revertAll, rewrite, saveTuning, sourceTarget, stepWords, targetWords, tuneTarget, tuningOf, UNSET,
  type Look, type NoteWrite, type RetiredLook, type StyleWriteBoard, type TuneTarget,
} from "../look";
import { readState, writeState } from "../state";
import { surfaceMix } from "../theme";
import type { Actor } from "../socket";
import { ActionRefused, actionSet, agentLabel, def } from "../surface/actions";
import { bgRgb, C, drawEllipsized, fg, pad, RESET, selected, selectedRow, width } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { type RowPress } from "../scroll";
import { Inspector } from "../surface/inspector";
import { keyTable } from "../surface/keymap";
import { modeBinding, modeHint, type ModeKey } from "../surface/modes";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";

const TUNE_GLASS_KEYS = keyTable("tune glass", "the glass's delays and limits", [
  { key: "G", action: "tune.section", args: { section: "values" }, label: "values" },
  ...["k", "up"].map(key => ({ key, action: "tune.glass.pick", args: { by: -1 }, label: "pick" })),
  ...["j", "down"].map(key => ({ key, action: "tune.glass.pick", args: { by: 1 }, label: "pick" })),
  ...["+", "=", "l", "right"].map(key => ({ key, action: "glass.tune", args: { by: 1 }, label: "increase" })),
  ...["-", "h", "left"].map(key => ({ key, action: "glass.tune", args: { by: -1 }, label: "decrease" })),
  ...["e", "enter"].map(key => ({ key, action: "tune.glass.edit", label: "edit" })),
] satisfies ModeKey[]);

/** The levels the inspector offers: where each value comes from, or one level for every nudge. */
export const TUNE_LEVELS = ["auto", ...SAVE_LEVELS] as const;
export type TuneLevel = (typeof TUNE_LEVELS)[number];
export const TUNE_LEVEL_MEANINGS: Record<TuneLevel, string> = {
  auto: "whichever level the value already comes from",
  global: "everywhere",
  tile: "every detail tile",
  screen: "every tile on this screen",
  page: "saved with this note as its named style, so it follows the note into any tile",
  instance: "saved in this tile's place in the layout, whatever note it shows",
  list: "the list or component under the cursor",
};


/** One row of the inspector: a token, or a pair set together (`pad`: a row and two columns, cells being twice as tall as wide). */
interface TuneRow { name: string; tokens: readonly StyleToken[] }
const groupOf = (row: TuneRow): StyleGroup => (STYLE_TOKENS[row.tokens[0]!] as { group?: StyleGroup }).group ?? "Other";
export const TUNE_ROWS: readonly TuneRow[] = [
  ...STYLE_TOKEN_NAMES.flatMap(name => [
    ...(name === "pad.x" ? [{ name: "pad", tokens: ["pad.y", "pad.x"] as StyleToken[] }] : []),
    ...(name === "margin.x" ? [{ name: "margin", tokens: ["margin.y", "margin.x"] as StyleToken[] }] : []),
    { name, tokens: [name as StyleToken] },
  ]),
].sort((a, b) => STYLE_GROUPS.indexOf(groupOf(a)) - STYLE_GROUPS.indexOf(groupOf(b)));
const rowNamed = (name: string) => TUNE_ROWS.find(r => r.name === name.trim().toLowerCase());

/** What the inspector sees of the tile it tunes (DeskApi.tileLook). */
export interface TuneTargetInfo {
  look: Look; kind: string; title: string; cols: number; box: { attrs: string; line: number } | null;
  /**
   * The note's header image (a reader's, PIE-1361): its line and what that line writes for each of its look's
   * properties; null when the note has none. Its rows are the tune's Hero group, edited on that line (image.look).
   */
  hero?: TuneHero | null;
  /** The list the reader's [ ] is in (`this list`): where its save goes, and its own layers. */
  list?: { target: string | null; layers: StyleLayer[]; first: number; revision?: number; component?: boolean } | null;
}

/** A reader's header image as the tune shows it (DeskApi.tileLook): its line, its file, its properties as written, its rows drawn. */
export interface TuneHero { line: number; name: string; values: Partial<Record<HeroProp, string>>; rows: number | null }
/** A Hero row's name in actions and `peek`: `hero.tint`. */
const HERO_ROW = (p: HeroProp) => `hero.${p}`;
const heroRowNamed = (name: string): HeroProp | null => { const n = name.trim().toLowerCase(); return n.startsWith("hero.") && isHeroProp(n.slice(5)) ? n.slice(5) as HeroProp : null; };

/** The rows that are a surface (PIE-675): drawn with a swatch of it beside the value, at the strength they're shown at. */
const SWATCH: Partial<Record<StyleToken, StyleToken>> = { "bg": "bg.strength", "list.zebra.bg": "list.zebra.strength", "header.bg": "header.bg.opacity" };

/** Where a value came from, in a few words: `tile detail`, `page · tuning`, `built-in`, with its width variant. */
export const sourceWords = (s: StyleSource) => `${s.label}${s.variant ? ` · ${s.variant}` : ""}`;
/** The width the tile is in, in words. */
function widthWords(look: Look): string {
  const v = look.values;
  return look.breakpoint === "narrow" ? `narrow (under ${v["bp.narrow"]})` : look.breakpoint === "wide" ? `wide (${v["bp.wide"]} and up)` : `normal (${v["bp.narrow"]}–${v["bp.wide"] - 1})`;
}

/** The widest a row's source runs: a wide tune keeps its controls beside the values, not at the far edge. */
const SRC_MAX = 32;

/** The help line under the rows: the door's own selection copies the text; a terminal's own copies the spacing as spaces. */
export const TUNE_HELP = "copy with the door's own selection (a drag; it copies the text over OSC 52): a terminal's shift-drag or copy-mode copies the spacing as spaces and blank lines";

/** What a nudge on a row where something nearer wins can do instead of nudging blind (PIE-675). */
export type ShadowChoice = "anyway" | "instead" | "clear";
/** A row where the level (or width) a nudge writes is overridden: why, what overrides it, and what can be done. */
interface Shadow { why: string; kind: "level" | "variant"; src: StyleSource; can: ShadowChoice[]; instead: string; clear: string }
/** A step that asks in place before it writes: what it will do, in words. */
interface Armed { action: "tune.resetlevel" | "tune.revert"; words: string; target?: TuneTarget }

/** The label of the outline's layer a target writes (look.ts's layers): `global`, `tile detail`, `page`, `style lab`. */
const layerLabel = (target: TuneTarget) => (target === "global" ? "global" : target.startsWith("page:") ? "page" : target.startsWith("instance:") ? "this tile" : target.startsWith("list:") ? "this list" : target.includes(":") ? target.replace(":", " ") : `style ${target}`);
/** A hint's settings: the one it has green, the rest cyan, as Hints always drew them. */
const hintLook = () => ({ on: fg(C.lgreen), off: fg(C.cyan), gap: " " });
/** A strip row's tabs as the inspector's click targets on line `y`. */
const controlsOf = (row: TabRow, y: number) => row.hits.map(h => ({ y, x: h.from, cols: h.to - h.from, action: h.action, args: h.args ?? {} }));
/** The save level a source's target is, for the level picker: named styles are written "where it's set" (auto). */
const levelOfSource = (src: StyleSource): TuneLevel => (src.level === "global" || src.level === "tile" || src.level === "screen" || src.level === "instance" ? src.level : src.level === "page" && src.label === "page" ? "page" : src.label === "this list" ? "list" : "auto");

export class TunePane implements Pane {
  readonly kind = "tune";
  besideShort = false;
  sel = 0;
  group: StyleGroup | null = null;
  /** The Hero row picked (a reader's header image, PIE-1361), over `sel` and `group`. */
  heroSel: HeroProp | null = null;
  /** Nothing picked yet: a note with a header picture opens on its first Hero row, the rows a person came for. */
  fresh = true;
  foldedGroups = new Set(readState<StyleGroup[]>("tune-folds.json") ?? []);
  onlySet = false;
  /**
   * The level a nudge goes to and a save writes: `auto` (where the value comes from, as devtools edits the rule that
   * applies: a named style, the page, the tile's kind…; the tile's kind for a built-in), or one picked.
   */
  level: TuneLevel = "auto";
  section: "values" | "hints" | "glass" = "values";
  hintSel = 0;
  glassSel: GlassSetting = "open";
  /** A nudge is for every width, or for the width the tile is in now (its breakpoint's variant). */
  scope: "all" | "this" = "all";
  /** A nudge held on a row where something nearer wins: the choices it offers (a, o, c, or a click). */
  offer: { row: string; by: number; shadow: Shadow } | null = null;
  /** A reset of a level, or a revert, waiting for its confirmation (the same key again, or [confirm]). */
  armed: Armed | null = null;
  readonly view = new Inspector();
  private head = 0;
  private controls: { y: number; x: number; cols: number; action: string; args: Record<string, unknown> }[] = [];
  /** The rows' screen lines as last drawn: the row each is, or the value cell a wheel nudges. */
  private rowAt = new Map<number, { row: number; hero?: HeroProp; valueFrom: number; valueTo: number }>();
  /** Whether the last frame listed retired look keys (PIE-1365): the hint names D and M while it does. */
  retiredShown = false;
  /** `source`: the tile it tunes, by name (re-resolved each frame: ADR 0001, a role). */
  constructor(public source: string) {}

  title() { return `tune · ${this.source}`; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  typing() { return !!this.view.field; }
  unsaved() { return this.view.unsaved(); }
  keepDrafts() { return this.view.keep(); }
  dispose() { void this.view.field?.session.leave(); }
  hint() { if (this.view.field) return "editing · Enter save · Esc cancel"; if (this.section === "glass") return modeHint(TUNE_GLASS_KEYS, () => undefined); if (this.section === "hints") return "H values · j k pick · c card · s status · o off · R reset all"; return `Enter fold · f set here · e edit · j k pick · + − nudge · v level · w width · s save · u undo · U redo · x reset value · X reset level · R revert all${this.retiredShown ? " · D drop retired keys · M move them to a hero line" : ""}`; }
  spec() { return { source: `tile:${this.source}` }; }

  info(desk: DeskApi): TuneTargetInfo | null { return desk.tileLook?.(this.source) ?? null; }

  /** The look a nudge is measured from: the tile's, or the box's in a reader. */
  values(t: TuneTargetInfo) {
    if (!t.box && !t.list?.layers.length) return { values: t.look.values, sources: t.look.sources };
    const r = resolveStyle([...this.layersOf(t)], t.look.width);
    return { values: r.values, sources: r.sources };
  }
  /** Every layer of the place the inspector looks at: the tile's, the box's around the [ ], the list's it's in (nearest). */
  layersOf(t: TuneTargetInfo): StyleLayer[] {
    return [...t.look.layers, ...(t.box ? [{ level: "block" as const, label: "box", fields: parseStyleAttrs(t.box.attrs).fields }] : []), ...(t.list?.layers ?? [])];
  }

  /**
   * The target and field a nudge of `token` writes: `auto`, where the value comes from (its width variant too; the tile's
   * kind for a built-in); a level picked, that level, for every width unless `scope` is this. Null where the tile has no
   * such level (no note shown for page).
   */
  aimAt(t: TuneTargetInfo, token: StyleToken, level: TuneLevel = this.level, scope: "all" | "this" = this.scope): { target: TuneTarget; field: string; variant: Breakpoint | null } | null {
    const src = this.values(t).sources[token];
    const from = level === "auto" ? sourceTarget(src, t.look.place) : null;
    const target = from ?? tuneTarget(level === "auto" ? "tile" : level, t.look.place, t.list?.target ?? null);
    if (!target) return null;
    const varies = !token.startsWith("bp.");
    const variant = !varies ? null : scope === "this" ? t.look.breakpoint : from ? (src.variant ?? null) : null;
    return { target, field: fieldKey(token, variant), variant };
  }

  /** What the level (and width) a nudge writes says itself for `token` here: its value as written, or null. */
  ownValue(t: TuneTargetInfo, token: StyleToken, level: TuneLevel = this.level, scope: "all" | "this" = this.scope): string | null {
    const a = this.aimAt(t, token, level, scope);
    if (!a) return null;
    const label = layerLabel(a.target), layers = this.layersOf(t), list = a.target.startsWith("list:") ? Number(a.target.slice(a.target.lastIndexOf(":") + 1)) : null;
    for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]!; if (l.label === label && (list === null || l.line === list) && l.fields[a.field] !== undefined) return l.fields[a.field]!; }
    return null;
  }

  /**
   * Whether what a nudge of `token` writes is overridden here, and by what: a nearer level (`page overrides`), or, at the
   * same level, the width variant for the width the tile is in while the nudge is for every width (`narrow overrides at
   * this width`). Null when the nudge would show.
   */
  shadowOf(t: TuneTargetInfo, token: StyleToken, level: TuneLevel = this.level, scope: "all" | "this" = this.scope): Shadow | null {
    const a = this.aimAt(t, token, level, scope);
    if (!a) return null;
    const src = this.values(t).sources[token], at = sourceTarget(src, t.look.place), sv = src.variant ?? null;
    if (at === a.target) {
      if (sv === a.variant || !sv || a.variant) return null;
      return { why: `${sv} overrides at this width`, kind: "variant", src, can: ["anyway", "instead", "clear"], instead: `nudge ${sv} instead`, clear: `clear ${sv} so every width shows it` };
    }
    const mine = level === "auto" ? -1 : STYLE_LEVELS.indexOf(levelOfSave(level)), theirs = STYLE_LEVELS.indexOf(src.level);
    if (mine < 0 || theirs <= mine) return null;
    // A box or a heading style is edited where it's written: only "anyway" is offered for those.
    const editable = !!at;
    return {
      why: `${sourceWords(src)} overrides`, kind: "level", src, can: editable ? ["anyway", "instead", "clear"] : ["anyway"],
      instead: `nudge ${src.label} instead`, clear: `clear ${src.label}'s so ${level} shows`,
    };
  }

  entries(t: TuneTargetInfo): ({ group: StyleGroup } | { index: number } | { hero: HeroProp })[] {
    return [...(t.hero ? HERO_PROP_NAMES.map(hero => ({ hero })) : []), ...STYLE_GROUPS.flatMap(group => [
      { group } as { group: StyleGroup } | { index: number },
      ...TUNE_ROWS.flatMap((row, index) => groupOf(row) === group && !this.foldedGroups.has(group) && (!this.onlySet || row.tokens.some(tk => this.ownValue(t, tk) !== null)) ? [{ index }] : []),
    ])];
  }
  /** The Hero row picked, while the note shown has a header picture (one without lets the pick go). */
  heroPicked(desk: DeskApi): HeroProp | null {
    if (this.heroSel && !this.info(desk)?.hero) this.heroSel = null;
    return this.heroSel;
  }
  /** Whether `r` is the entry picked. */
  private isPicked(r: { group: StyleGroup } | { index: number } | { hero: HeroProp }) {
    return "hero" in r ? this.heroSel === r.hero : this.heroSel !== null ? false : "group" in r ? r.group === this.group : this.group === null && r.index === this.sel;
  }

  move(by: number, desk: DeskApi) {
    const t = this.info(desk); if (!t) return;
    const rows = this.entries(t), at = rows.findIndex(r => this.isPicked(r));
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + by))]!;
    this.run(desk, "group" in next ? "tune.group.pick" : "tune.pick", "group" in next ? { group: next.group } : "hero" in next ? { row: HERO_ROW(next.hero) } : { n: next.index + 1 });
  }

  async editField(desk: DeskApi) {
    const t = this.info(desk), hp = this.heroSel;
    if (hp && t?.hero) {
      const choices = [...HERO_PROPS[hp].steps];
      await this.view.edit(HERO_ROW(hp), t.hero.values[hp] ?? "none", choices, false, `tune:hero:${hp}`,
        value => TUNE_ACTIONS.run("tune.set", { row: HERO_ROW(hp), value }, { pane: this, desk, standing: true }, { kind: "user" }), { redraw: () => desk.redraw(), said: text => desk.ctx.flash(text) });
      desk.redraw();
      return { editing: HERO_ROW(hp) };
    }
    const row = TUNE_ROWS[this.sel]!;
    if (!t || this.group || row.tokens.length !== 1) throw new ActionRefused("choose a single value row to edit");
    const token = row.tokens[0]!, kind = STYLE_TOKENS[token].type;
    const choices = kind.kind === "enum" ? [...kind.values] : kind.kind === "bool" ? ["on", "off"] : [];
    const target = this.aimAt(t, token);
    if (!target) throw new ActionRefused("choose a level this value can be written at");
    await this.view.edit(row.name, styleValueText(this.values(t).values[token]), choices, false, `tune:${target.target}:${row.name}`,
      value => TUNE_ACTIONS.run("tune.set", { row: row.name, value }, { pane: this, desk, standing: true }, { kind: "user" }), { redraw: () => desk.redraw(), said: text => desk.ctx.flash(text) });
    desk.redraw();
    return { editing: row.name };
  }

  hintRows(desk: DeskApi) { return declaredHints(this.info(desk)?.look.values.hints ?? "full"); }

  private renderHints(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    const rows = this.hintRows(desk), lines: string[] = [], starts: number[] = [];
    this.controls = [];
    const hits: typeof this.controls = [];
    rows.forEach((r, n) => {
      starts.push(lines.length);
      const start = lines.length;
      const body = `${n === this.hintSel ? ">" : " "} ${r.id}  ${r.setting}${r.own ? " (yours)" : " (default)"}`;
      lines.push(...rowLines(body, w).map(l => n === this.hintSel ? selectedRow(l, w, focused) : fg(C.grey) + l + RESET));
      lines.push(...rowLines(r.trigger, Math.max(1, w - 2)).map(l => "  " + fg(C.dark) + l + RESET));
      for (let row = start; row < lines.length; row++) hits.push({ y: row, x: 0, cols: w, action: "tune.hint.pick", args: { id: r.id } });
      const settings = tabStrip(HINT_SETTINGS.map(to => ({ label: `[${to}]`, on: to === r.setting, hit: { action: "hints.set", args: { id: r.id, to } } })), { width: w, lead: "  ", style: hintLook() });
      for (const row of settings) { hits.push(...controlsOf(row, lines.length)); lines.push(row.text); }
    });
    const section = this.sectionTabs(w), head = section.length + 1;
    const top = this.view.place(this.hintSel, lines.length, Math.max(1, h - head), [starts[this.hintSel] ?? 0, (starts[this.hintSel + 1] ?? lines.length) - 1]);
    this.controls = [
      ...section.flatMap((row, y) => controlsOf(row, y)),
      { y: head - 1, x: 0, cols: 11, action: "hints.reset", args: {} },
      ...hits.filter(c => c.y >= top && c.y < top + h - head).map(c => ({ ...c, y: c.y - top + head })),
    ];
    return { lines: [...section.map(r => r.text), fg(C.cyan) + "[reset all]" + RESET, ...lines.slice(top, top + h - head)] };
  }

  private renderGlass(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    const section = this.sectionTabs(w), lines = section.map(r => r.text);
    this.controls = section.flatMap((r, y) => controlsOf(r, y));
    for (const name of Object.keys(GLASS_SETTINGS) as GlassSetting[]) {
      const setting = GLASS_SETTINGS[name], value = desk.ctx.glass?.settings[name] ?? setting.base;
      const y = lines.length, label = `${name === this.glassSel ? ">" : " "} ${setting.about}: ${value}`;
      lines.push(...rowLines(label, w).map(l => name === this.glassSel ? selectedRow(l, w, focused) : l));
      for (let row = y; row < lines.length; row++) this.controls.push({ y: row, x: 0, cols: w, action: "tune.glass.pick", args: { name } });
      const buttons = tabStrip([{ label: "[−]", hit: { action: "glass.tune", args: { name, value: Math.max(setting.min, value - setting.step) } } }, { label: "[+]", hit: { action: "glass.tune", args: { name, value: value + setting.step } } }, { label: "[edit]", hit: { action: "tune.glass.edit", args: { name } } }], { width: w });
      for (const r of buttons) { this.controls.push(...controlsOf(r, lines.length)); lines.push(r.text); }
    }
    return { lines: lines.slice(0, h) };
  }

  /** Each settings owner supplies the values its section adjusts. */
  private sectionTabs(w: number): TabRow[] {
    return tabStrip([{ label: "[values]", on: this.section === "values", hit: { action: "tune.section", args: { section: "values" } } }, { label: "[Hints] H", on: this.section === "hints", hit: { action: "tune.section", args: { section: "hints" } } }, { label: "[Glass] G", on: this.section === "glass", hit: { action: "tune.section", args: { section: "glass" } } }], { width: w });
  }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    if (this.section === "glass" && !this.view.field) return this.renderGlass(w, h, focused, desk);
    if (this.section === "hints") return this.renderHints(w, h, focused, desk);
    if (this.view.field) {
      const field = this.view.fieldDraw(w), top = this.view.place(field.focus, field.lines.length, h);
      this.controls = field.hits.map(hit => ({ y: hit.row - top, x: hit.from, cols: hit.to - hit.from, action: "tune.field", args: hit.args }));
      return { lines: field.lines.slice(top, top + h) };
    }
    this.controls = []; this.rowAt.clear();
    const t = this.info(desk);
    if (!t) return { lines: [fg(C.dark) + pad(`tile ${this.source} isn't on this screen · tune.aim target=<name>, or alt+y in the tile to tune`, w) + RESET] };
    const tuning = tuningOf(desk.ctx.board), unsaved = tuning.unsavedCount();
    const lines: string[] = [];
    const put = (rows: TabRow[]) => { for (const row of rows) { this.controls.push(...controlsOf(row, lines.length)); lines.push(row.text); } };
    const chips = (items: { label: string; on?: boolean; action: string; args?: Record<string, unknown>; hint?: string }[], lead = "") =>
      put(tabStrip(items.map(it => ({ label: it.label, on: it.on ?? false, hint: it.hint, hit: { action: it.action, args: it.args } })), { width: w, lead }));
    const words = (text: string, colour: number = C.dark) => lines.push(...wrap(text, w).map(l => fg(colour) + l + RESET));
    put(this.sectionTabs(w));
    if (this.besideShort) words("too short to split; inspector beside it", C.yellow);
    else words(`${t.kind}${t.title !== t.kind ? ` ${t.title}` : ""} · ${t.cols} cols · ${widthWords(t.look)}${t.box ? " · in a box" : ""}`, C.grey);
    chips(TUNE_LEVELS.map(l => {
      const target = l === "auto" ? null : tuneTarget(l, t.look.place, t.list?.target ?? null);
      return { label: l === "auto" ? "where it's set" : l === "page" ? "this page" : l === "instance" ? "this tile" : l === "list" ? (t.list?.component ? "this component" : "this list") : target ? targetWords(target) : l,
        hint: TUNE_LEVEL_MEANINGS[l].replace("every detail tile", `every ${t.look.place.tile ?? t.kind} tile`), on: l === this.level, action: "tune.level", args: { level: l } };
    }), fg(C.dark) + "nudge " + RESET);
    words(TUNE_LEVEL_MEANINGS[this.level].replace("every detail tile", `every ${t.look.place.tile ?? t.kind} tile`), C.lcyan);
    chips([
      { label: this.scope === "all" ? "all widths" : `${t.look.breakpoint ?? "normal"} only`, on: true, action: "tune.width", args: { scope: this.scope === "all" ? "this" : "all" } },
      { label: "[save]", action: "tune.save" }, { label: "[undo]", action: "tune.undo" }, { label: "[redo]", action: "tune.redo" },
    ]);
    if (unsaved) words(`${unsaved} unsaved, s to save`, C.yellow);
    chips([{ label: "[reset value]", action: "tune.unset" }, { label: "[reset level]", action: "tune.resetlevel" }, { label: "[revert all]", action: "tune.revert" }]);
    if (this.armed) {
      words(`!! ${this.armed.words}`, C.yellow);
      chips([{ label: "[confirm]", action: this.armed.action, args: { confirm: true } }, { label: "[cancel]", action: "tune.cancel" }]);
    } else if (this.offer) {
      const o = this.offer, s = o.shadow;
      words(s.why, C.yellow);
      chips([
        { label: `[a nudge ${this.level === "auto" ? "it" : this.level} anyway]`, action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "anyway" } },
        ...(s.can.includes("instead") ? [{ label: `[o ${s.instead}]`, action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "instead" } }] : []),
        ...(s.can.includes("clear") ? [{ label: `[c ${s.clear}]`, action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "clear" } }] : []),
      ]);
    } else lines.push("");
    const problems = problemsOf(t, desk);
    if (problems.length) words(`!! ${problems.join(" · ")}`, C.yellow);
    // Retired look keys (PIE-1365): a line per note with its fix; why, once, under the pointer (and the actions' hint card).
    const retired = retiredOf(t, desk);
    this.retiredShown = retired.length > 0;
    for (const r of retired) {
      const n = r.keys.length, said = drawEllipsized(`!! ${r.where}: ${n} retired header-image key${n === 1 ? "" : "s"}`, w);
      const args = { note: r.note, ...(r.line !== undefined ? { line: r.line + 1 } : {}) };
      // Its fixes beside it when they fit, else on the row under it.
      const fixes = [{ label: "[remove]", action: "tune.retired.remove", args, hint: RETIRED_WHY }, ...(r.picture && t.look.place.page ? [{ label: "[move to a hero line]", action: "tune.retired.move", args, hint: RETIRED_WHY }] : [])];
      const beside = width(said) + 1 + fixes.reduce((k, f) => k + width(f.label) + 3, 0) <= w;
      const lead = fg(C.yellow) + fullText(RETIRED_WHY, said) + RESET + " ";
      if (beside) chips(fixes, lead);
      else { lines.push(lead); chips(fixes, "  "); }
    }
    chips([{ label: this.onlySet ? "[set here]" : "[all values]", on: this.onlySet, action: "tune.filter", args: { set: !this.onlySet } }]);
    const help = wrap(TUNE_HELP, w);
    this.head = lines.length;
    const { values, sources } = this.values(t);
    // A level (or one width) picked: a column of what it says itself, beside the value in force.
    const picked = this.level !== "auto" || this.scope === "this";
    // Columns that fit the tile: the source gives way first (to 6), then the value (to 8), then the name.
    // A wide tune gives its names and values the room (no `bg.stren…` beside empty columns).
    const ctl = 10, room0 = Math.max(0, w - ctl - 1), lvlW = picked ? 8 : 0;
    let valW = w >= 100 ? 18 : 12, nameW = Math.min(w >= 100 ? 26 : 20, room0 - valW - lvlW - 8);
    if (nameW < 14) { valW = 8; nameW = Math.max(6, Math.min(20, room0 - valW - lvlW - 6)); }
    const room = Math.max(2, h - this.head - help.length - 1);
    // With a level (or a width) picked, a header names the columns: the value in force, what that level says itself, where the value in force comes from.
    if (picked) {
      const lv = this.level === "auto" ? "where set" : this.level;
      lines.push(fg(C.dark) + pad("", nameW) + pad("in force", valW) + fg(C.lcyan) + " " + pad(drawEllipsized(`${lv}${this.scope === "this" && t.look.breakpoint ? ` ${t.look.breakpoint}` : ""}`, lvlW - 2), lvlW - 1) + fg(C.dark) + "from" + RESET);
    }
    if (this.fresh && t.hero) { this.fresh = false; this.heroSel = HERO_PROP_NAMES[0]!; }
    if (!t.hero) this.heroSel = null;
    const entries = this.entries(t);
    const cursor = entries.findIndex(r => this.isPicked(r));
    // The note's header image first (PIE-1361): its own line's properties, written there at once.
    // Without one, a row saying how to make one, when there's room to spare (it never takes the values' rows).
    const heroHead = t.hero ? 1 : t.hero === null && room >= 6 ? 1 : 0;
    if (heroHead) {
      if (t.hero) {
        const head = `▾ Hero · this note's · line ${t.hero.line + 1} · ${t.hero.name}`;
        lines.push(fg(C.lcyan) + pad(drawEllipsized(head, w), w) + RESET);
      } else lines.push(fg(C.dark) + pad(drawEllipsized("Hero · this note has no header picture: H on one of its images (image.hero) makes it one", w), w) + RESET);
    }
    const heroRows = t.hero ? HERO_PROP_NAMES.length : 0;
    this.view.place(Math.max(0, cursor), entries.length, (picked ? room - 1 : room) - heroHead - (heroRows ? 1 : 0));
    let heroDone = false;
    for (const entry of entries.slice(this.view.top, this.view.top + (picked ? room - 1 : room) - heroHead - (heroRows ? 1 : 0))) {
      if ("hero" in entry) {
        const hp = entry.hero, on = this.heroSel === hp, own = t.hero!.values[hp];
        const shown = own ?? (hp === "height" && t.hero!.rows !== null ? `${t.hero!.rows} rows` : HERO_PROPS[hp].none);
        const y = lines.length, srcW = Math.max(0, Math.min(SRC_MAX, w - nameW - valW - ctl - 1));
        const name = " " + pad(drawEllipsized(hp, nameW - 2), nameW - 1), value = pad(drawEllipsized(shown, valW - 1), valW);
        const whence = own === undefined ? "built in" : `[${HERO_PROPS[hp].attr}::]`;
        const body = (on ? "" : fg(C.grey)) + name + (on ? "" : fg(own === undefined ? C.dark : C.white)) + value + (on ? "" : fg(C.dark)) + pad(whence, srcW) + RESET;
        const unset = nameW + valW + srcW + 1, minus = unset + 2;
        this.rowAt.set(y, { row: -1, hero: hp, valueFrom: nameW, valueTo: nameW + valW });
        this.controls.push({ y, x: unset, cols: 1, action: "tune.unset", args: { row: HERO_ROW(hp) } }, { y, x: minus, cols: 3, action: "tune.nudge", args: { row: HERO_ROW(hp), by: -1 } }, { y, x: minus + 4, cols: 3, action: "tune.nudge", args: { row: HERO_ROW(hp), by: 1 } });
        lines.push((on ? selectedRow(body, nameW + valW + srcW, focused) : body) + " " + fg(C.dark) + "×" + RESET + " " + fg(C.cyan) + "[−] [+]" + RESET);
        continue;
      }
      if (heroRows && !heroDone) { heroDone = true; lines.push(fg(C.dark) + pad(drawEllipsized(" saved on the note's hero line at once · ctrl+z in the reader undoes", w), w) + RESET); }
      if ("group" in entry) {
        const group = entry.group, on = this.heroSel === null && this.group === group;
        const count = STYLE_TOKEN_NAMES.filter(tk => groupOf({ name: tk, tokens: [tk] }) === group && this.ownValue(t, tk) !== null).length;
        const body = `${this.foldedGroups.has(group) ? "▸" : "▾"} ${group} (${count} set here)`;
        this.controls.push({ y: lines.length, x: 0, cols: w, action: "tune.group", args: { group } });
        lines.push(on ? selectedRow(body, w, focused) : fg(C.lcyan) + body + RESET);
        continue;
      }
      const i = entry.index, row = TUNE_ROWS[i]!, on = this.heroSel === null && this.group === null && i === this.sel, last = row.tokens[row.tokens.length - 1]!;
      const text = row.tokens.map(tk => styleValueText(values[tk] as StyleValue)).join(" ");
      const shown = text;
      // A surface's row shows it: a swatch of the colour it draws, at the strength (or opacity) it's drawn at.
      const sw = SWATCH[row.tokens[0]!], swatch = sw ? swatchOf(values[row.tokens[0]!] as Surface, values[sw] as number, row.tokens[0] === "header.bg") : "";
      const src = sources[last];
      // Tuned here, not yet saved: the value is the inspector's nudge, drawn over the outline's (●).
      const at = sourceTarget(src, t.look.place), mark = at ? tuning.get(at, fieldKey(last, src.variant ?? null)) : undefined;
      const tuned = !!mark && !mark.saved;
      const shadow = picked ? this.shadowOf(t, last) : null;
      const aimed = picked ? this.aimAt(t, last) : null;
      const own = picked && aimed ? row.tokens.map(tk => this.ownValue(t, tk)) : [];
      const ownText = !picked ? "" : !aimed ? "—" : own.every(v => v === null) ? "—" : own.map(v => (v === UNSET ? "×" : v ?? "·")).join(" ");
      const srcW = Math.max(0, Math.min(SRC_MAX, w - nameW - valW - lvlW - ctl - 1));
      const y = lines.length;
      const name = " " + pad(drawEllipsized(row.name, nameW - 2), nameW - 1), value = swatch && valW > 6 ? pad(drawEllipsized(shown, valW - 4), valW - 3) + " " + swatch + (on ? selected(focused) : "") : pad(drawEllipsized(shown, valW - 1), valW);
      const lvl = picked ? " " + pad(drawEllipsized(ownText, lvlW - 2), lvlW - 1) : "";
      const whence = shadow ? `⊘ ${shadow.why}` : `${tuned ? "● " : "← "}${sourceWords(src)}`;
      const ink = (c: number) => (on ? "" : fg(shadow ? C.dark : c));
      const body = (on ? "" : fg(shadow ? C.dark : C.grey)) + name + ink(tuned ? C.yellow : C.white) + value + ink(C.lcyan) + lvl + (on ? "" : fg(shadow ? C.yellow : C.dark)) + pad(whence, srcW) + RESET;
      this.rowAt.set(y, { row: i, valueFrom: nameW, valueTo: nameW + valW });
      // × resets this row's value to what it inherits (tune.unset, as x); − and + nudge it.
      const unset = nameW + valW + lvlW + srcW + 1, minus = unset + 2;
      this.controls.push({ y, x: unset, cols: 1, action: "tune.unset", args: { row: row.name } }, { y, x: minus, cols: 3, action: "tune.nudge", args: { row: row.name, by: -1 } }, { y, x: minus + 4, cols: 3, action: "tune.nudge", args: { row: row.name, by: 1 } });
      lines.push((on ? selectedRow(body, nameW + valW + lvlW + srcW, focused) : body) + " " + fg(C.dark) + "×" + RESET + " " + fg(C.cyan) + "[−] [+]" + RESET);
    }
    lines.push(...help.map(l => fg(C.dark) + l + RESET));
    return { lines };
  }

  key(k: Key, desk: DeskApi): boolean {
    const intent = this.view.intent(k);
    if (intent) { this.run(desk, "tune.field", intent); return true; }
    const c = ch(k);
    if (c === "G" && this.section !== "glass") { this.run(desk, "tune.section", { section: "glass" }); return true; }
    if (c === "H") { this.run(desk, "tune.section", { section: this.section === "hints" ? "values" : "hints" }); return true; }
    if (this.section === "glass") {
      const names = Object.keys(GLASS_SETTINGS) as GlassSetting[], at = names.indexOf(this.glassSel), setting = GLASS_SETTINGS[this.glassSel];
      const bound = modeBinding(TUNE_GLASS_KEYS, k);
      if (!bound) return false;
      const by = bound.args?.by as number;
      const args = bound.action === "tune.glass.pick" ? { name: names[Math.max(0, Math.min(names.length - 1, at + by))] }
        : bound.action === "glass.tune" ? { name: this.glassSel, value: Math.max(setting.min, (desk.ctx.glass?.settings[this.glassSel] ?? setting.base) + by * setting.step) } : bound.args ?? {};
      this.run(desk, bound.action, args); return true;
    }
    if (this.section === "hints") {
      const rows = this.hintRows(desk);
      if (isUp(k) || isDown(k)) { this.run(desk, "tune.hint.pick", { id: rows[Math.max(0, Math.min(rows.length - 1, this.hintSel + (isUp(k) ? -1 : 1)))]!.id }); return true; }
      const to = c === "c" ? "card" : c === "s" ? "status" : c === "o" ? "off" : null;
      if (to) { this.run(desk, "hints.set", { id: rows[this.hintSel]!.id, to }); return true; }
      if (c === "R") { this.run(desk, "hints.reset", {}); return true; }
      return false;
    }
    if (k.kind === "enter" && this.group) return this.run(desk, "tune.group", { group: this.group }), true;
    if (c === "f") return this.run(desk, "tune.filter", { set: !this.onlySet }), true;
    if (c === "e" || k.kind === "enter") { this.run(desk, "tune.edit", {}); return true; }
    // A step waiting in place: its own key again confirms; any other lets it go (and esc is only that).
    if (this.armed) {
      const again = (c === "X" && this.armed.action === "tune.resetlevel") || (c === "R" && this.armed.action === "tune.revert");
      if (again) return this.run(desk, this.armed.action, { confirm: true }), true;
      this.run(desk, "tune.cancel", {});
      if (k.kind === "esc") return true;
    }
    // A nudge held on a shadowed row: a, o or c chooses; anything else lets it go.
    if (this.offer) {
      const o = this.offer, choice: ShadowChoice | null = c === "a" ? "anyway" : c === "o" ? "instead" : c === "c" ? "clear" : null;
      if (choice && o.shadow.can.includes(choice)) return this.run(desk, "tune.nudge", { row: o.row, by: o.by, shadow: choice }), true;
      this.offer = null; desk.redraw();
      if (k.kind === "esc") return true;
    }
    if (isUp(k)) return this.move(-1, desk), true;
    if (isDown(k)) return this.move(1, desk), true;
    if (c === "+" || c === "=" || c === "l" || k.kind === "right") return this.run(desk, "tune.nudge", { by: 1 }), true;
    if (c === "-" || c === "_" || c === "h" || k.kind === "left") return this.run(desk, "tune.nudge", { by: -1 }), true;
    // v, not tab: the desk takes tab to go to the next tile before a tile's own keys.
    if (c === "v") return this.run(desk, "tune.level", { level: TUNE_LEVELS[(TUNE_LEVELS.indexOf(this.level) + 1) % TUNE_LEVELS.length] }), true;
    if (c === "w") return this.run(desk, "tune.width", { scope: this.scope === "all" ? "this" : "all" }), true;
    if (c === "s") return this.run(desk, "tune.save", {}), true;
    if (c === "u") return this.run(desk, "tune.undo", {}), true;
    if (c === "U" || (k.kind === "char" && k.ctrl && k.ch === "r")) return this.run(desk, "tune.redo", {}), true;
    if (c === "x") return this.run(desk, "tune.unset", {}), true;
    if (c === "X") return this.run(desk, "tune.resetlevel", {}), true;
    if (c === "R") return this.run(desk, "tune.revert", {}), true;
    if (c === "D") return this.run(desk, "tune.retired.remove", {}), true;
    if (c === "M") return this.run(desk, "tune.retired.move", {}), true;
    return false;
  }

  /** A click on a control runs its action; on a row picks it; the wheel over a value nudges it, elsewhere moves the pick. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    if (this.section === "glass" && !this.view.field) {
      if (k.action === "wheel-up" || k.action === "wheel-down") this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, desk);
      else if (k.action === "down") { const hit = this.controls.find(c => c.y === y && x >= c.x && x < c.x + c.cols); if (hit) this.run(desk, hit.action, hit.args); }
      return true;
    }
    if (this.section === "hints") {
      if (k.action === "wheel-up" || k.action === "wheel-down") {
        const rows = this.hintRows(desk), n = Math.max(0, Math.min(rows.length - 1, this.hintSel + (k.action === "wheel-up" ? -1 : 1)));
        this.run(desk, "tune.hint.pick", { id: rows[n]!.id });
      } else if (k.action === "down") {
        const hit = this.controls.find(c => c.y === y && x >= c.x && x < c.x + c.cols);
        if (hit) this.run(desk, hit.action, hit.args);
      }
      return true;
    }
    if (this.view.field) {
      if (k.action === "down") {
        const hit = this.controls.find(c => c.y === y && x >= c.x && x < c.x + c.cols);
        if (hit) this.run(desk, hit.action, hit.args);
        else this.run(desk, "tune.field", { op: "start", row: y + this.view.top, col: x });
      } else if (k.action === "drag" && this.view.pressed) this.run(desk, "tune.field", { op: "drag", row: y + this.view.top, col: x });
      else if (k.action === "up" && this.view.pressed) this.run(desk, "tune.field", { op: "release" });
      return true;
    }
    const at = this.rowAt.get(y);
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const up = k.action === "wheel-up";
      if (at && x >= at.valueFrom && x < at.valueTo) this.run(desk, "tune.nudge", { row: at.hero ? HERO_ROW(at.hero) : TUNE_ROWS[at.row]!.name, by: up ? 1 : -1 });
      else this.move(up ? -1 : 1, desk);
      return true;
    }
    if (k.action !== "down") return true;
    const c = this.controls.find(s => s.y === y && x >= s.x && x < s.x + s.cols);
    if (c) { this.run(desk, c.action, c.args); return true; }
    if (at) { const gesture = this.view.press(at.hero ? -1 - HERO_PROP_NAMES.indexOf(at.hero) : at.row, press ?? {}); this.run(desk, "tune.pick", at.hero ? { row: HERO_ROW(at.hero) } : { n: at.row + 1 }); if (gesture === "open") this.run(desk, "tune.edit", {}); }
    return true;
  }

  run(desk: DeskApi, name: string, args: Record<string, unknown>) { if (name.startsWith("glass.")) { void desk.ctx.press!(name, args); return; } if (name.startsWith("hints.")) { void desk.perform?.(name, args); return; } runOwn(TUNE_ACTIONS, name, args, { pane: this, desk }); }

  /**
   * What `peek` and `act` read: the tile tuned, its width, every value with its source (and, with a level or a width
   * picked, what that level says itself and whether something nearer wins), the unsaved nudges, a held offer, a step
   * waiting for its confirmation.
   */
  describe(desk?: DeskApi) {
    if (this.section === "hints" && desk) return { section: "hints", hints: this.hintRows(desk), selected: this.hintRows(desk)[this.hintSel]?.id };
    const t = desk ? this.info(desk) : null;
    const tuning = desk ? tuningOf(desk.ctx.board) : null;
    if (!t) return { tile: this.source, level: this.level, scope: this.scope, found: false };
    const { values, sources } = this.values(t);
    const picked = this.level !== "auto" || this.scope === "this";
    return {
      tile: this.source, kind: t.kind, cols: t.cols, breakpoint: t.look.breakpoint, level: this.level, scope: this.scope, ...(t.box ? { box: t.box } : {}),
      selected: this.heroSel ? HERO_ROW(this.heroSel) : this.group ?? TUNE_ROWS[this.sel]!.name,
      hero: t.hero ? { line: t.hero.line + 1, image: t.hero.name, values: Object.fromEntries(HERO_PROP_NAMES.map(p => [p, { value: t.hero!.values[p] ?? HERO_PROPS[p].none, from: t.hero!.values[p] === undefined ? "built in" : "the hero line" }])) } : t.hero === null ? null : undefined,
      groups: STYLE_GROUPS.map(group => ({ group, folded: this.foldedGroups.has(group) })), onlySet: this.onlySet,
      values: Object.fromEntries((Object.keys(STYLE_TOKENS) as StyleToken[]).map(tk => {
        const a = picked ? this.aimAt(t, tk) : null, own = a ? this.ownValue(t, tk) : null, sh = picked ? this.shadowOf(t, tk) : null;
        return [tk, {
          value: styleValueText(values[tk] as StyleValue), from: sourceWords(sources[tk]), ...(sources[tk].block ? { note: sources[tk].block } : {}),
          ...(a ? { at: { level: targetWords(a.target), ...(a.variant ? { width: a.variant } : {}), value: own === UNSET ? "taken away" : own } } : {}),
          ...(sh ? { overridden: sh.why } : {}),
        }];
      })),
      unsaved: tuning?.unsaved() ?? [], problems: desk ? problemsOf(t, desk) : t.look.problems,
      ...(desk ? { retired: retiredOf(t, desk).map(r => ({ note: r.note, ...(r.line !== undefined ? { line: r.line + 1 } : {}), where: r.where, keys: r.keys.map(k => k.key), picture: r.picture, fixes: r.picture && t.look.place.page ? ["tune.retired.remove", "tune.retired.move"] : ["tune.retired.remove"] })) } : {}),
      ...(this.offer ? { offer: { row: this.offer.row, why: this.offer.shadow.why, choices: this.offer.shadow.can } } : {}),
      ...(this.armed ? { armed: this.armed } : {}),
    };
  }
}

/** A tune tile's actions: the row picked, a nudge, a value set outright, the level and width a nudge targets, save, the history, resets and revert. */
export interface TuneOn { pane: TunePane; desk: DeskApi; standing: boolean }

const says = (actor: Actor, did: string) => (actor.kind === "agent" ? `${agentLabel(actor)} ${did}` : did);
const refuse = <T>(f: () => T): T => { try { return f(); } catch (e) { throw e instanceof ActionRefused ? e : new ActionRefused((e as Error).message); } };
const refuseAsync = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw e instanceof ActionRefused ? e : new ActionRefused((e as Error).message); } };
const board = (desk: DeskApi) => desk.ctx.board as unknown as StyleWriteBoard;
/**
 * The tile's info with its look resolved now: what the tile was last drawn with misses the nudges made since the last
 * frame (an agent's, one after another), so an action measures from this.
 */
function fresh(pane: TunePane, desk: DeskApi): TuneTargetInfo {
  const t = pane.info(desk);
  if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
  return { ...t, look: lookFor({ board: desk.ctx.board, redraw: () => desk.redraw() }, t.look.place, t.look.width) };
}

/**
 * What resetting `token`'s value does (it returns to what it inherits): its source's own setting is taken away from the
 * note that wrote it (in memory until s, the save removing the property), or, set only by a nudge, the nudge let go. A
 * variant goes first: what shows at this width is what's reset. Refused: a built-in, a box's or a heading style's (edited
 * where written), and one a shorthand or a tier gives (taking that away would take more, or it would come back).
 */
async function takeAway(pane: TunePane, desk: DeskApi, t: TuneTargetInfo, tk: StyleToken, src: StyleSource, actor: Actor): Promise<() => void> {
  const tuning = tuningOf(desk.ctx.board), target = sourceTarget(src, t.look.place), field = fieldKey(tk, src.variant ?? null);
  if (!target) throw new ActionRefused(src.level === "base" ? `${tk} is the built-in already` : src.level === "block" ? `${tk} is the box's own (line ${(t.box?.line ?? 0) + 1}): edit the box` : `${tk} comes from ${src.label}: edit it there`);
  const mine = tuning.get(target, field), at = src.block;
  // This tile's own: taken out of its spec (a save writes the spec without it).
  if (target.startsWith("instance:")) {
    if (t.look.place.instance?.fields[field] !== undefined) return () => tuning.set(target, field, UNSET, actor, target);
    if (mine && mine.value !== UNSET) return () => { tuning.drop(target, field, actor); };
    throw new ActionRefused(`${tk} isn't this tile's own`);
  }
  // This list's own: taken off its line (the line as written, read now).
  if (target.startsWith("list:") && at && src.line !== undefined) {
    const line = (await board(desk).get(at))?.text.split("\n")[src.line] ?? "";
    const tokens = liveTokensInLine(line).filter(x => x.key.toLowerCase() === styleProperty(tk, src.variant ?? null));
    if (tokens.some(x => x.value.includes("|"))) throw new ActionRefused(`${tk} on line ${src.line + 1} of note ${at.slice(0, 8)} is a tier: edit the line (or set it here with + −)`);
    if (tokens.length || (t.list?.component && t.list.layers.some(l => l.fields[field] !== undefined))) return () => { if (t.list?.revision !== undefined && !tuning.listSeen.has(target)) tuning.listSeen.set(target, t.list.revision); tuning.set(target, field, UNSET, actor, at); };
    if (mine && mine.value !== UNSET) return () => { tuning.drop(target, field, actor); };
    throw new ActionRefused(`${tk} on line ${src.line + 1} of note ${at.slice(0, 8)} is set by a shorthand: edit the line`);
  }
  if (at && src.line === undefined) {
    const own = async (k: string) => (await board(desk).propertyTokens(at, k)).tokens.filter(x => x.scope === "block");
    const written = await own(styleProperty(tk, src.variant ?? null));
    if (written.length) {
      const base = tk.split(".")[0]!, pair = /^(pad|margin)\.[xy]$/.test(tk);
      const also = [
        ...(pair ? await own(`style.${src.variant ? `${src.variant}.` : ""}${base}`) : []),
        ...(pair ? (await own(`style.${base}`)).filter(x => x.value.includes("|")) : []),
        ...(src.variant ? (await own(styleProperty(tk, null))).filter(x => x.value.includes("|")) : []),
      ];
      if (written.some(x => x.value.includes("|")) || also.length) throw new ActionRefused(`${tk} on note ${at.slice(0, 8)} is ${also[0] ? `also set by ${also[0].key}` : `a tier of ${written[0]!.key}`}: edit the note (or set it here with + −)`);
      return () => tuning.set(target, field, UNSET, actor, at);
    }
  }
  if (mine && mine.value !== UNSET) return () => { tuning.drop(target, field, actor); };
  throw new ActionRefused(src.line !== undefined ? `${tk} is set on line ${src.line + 1} of note ${at?.slice(0, 8) ?? "?"}: take it away there` : `${tk} on note ${at?.slice(0, 8) ?? "?"} is set by a shorthand or a tier: edit the note (or set it here with + −)`);
}

/**
 * A list's own level takes only a list's fields (`list.gap`, `list.divider`, …: what its line can say), and remembers
 * the note's revision it was tuned at, so the save writes the line it means.
 */
function listOnly(target: TuneTarget, field: string, t: TuneTargetInfo, tuning: ReturnType<typeof tuningOf>) {
  if (!target.startsWith("list:")) return;
  if (!isListField(field)) throw new ActionRefused(`this list sets only a list's values (list.gap, list.zebra…, list.divider…): ${field} is the page's, the tile's or a box's`);
  if (t.list?.revision !== undefined && !tuning.listSeen.has(target)) tuning.listSeen.set(target, t.list.revision);
}

/**
 * A Hero row's change (PIE-1361): the reader's header image's own line, through the reader's image.look, saved at once
 * and attributed (ctrl+z there undoes it). Not a nudge: no level, nothing to save, nothing in the tune's history.
 */
async function writeHeroRow(pane: TunePane, desk: DeskApi, actor: Actor, prop: HeroProp, change: { by: number } | { to: string }) {
  const t = pane.info(desk);
  if (!t?.hero) throw new ActionRefused(t?.hero === null ? `${pane.source}'s note has no header picture: H on one of its images (image.hero) makes it one` : `${pane.source} isn't a reader showing a note`);
  const args = { prop, ...change };
  const reader = desk.paneNamed?.(pane.source);
  const out = actor.kind === "agent" && desk.within ? await desk.within("image.look", args, actor, reader) : await desk.perform?.("image.look", args, actor, pane.source);
  desk.redraw();
  // A person's refused press has said why already (perform flashes it): nothing more to say.
  if (!out || typeof out !== "object") return { row: HERO_ROW(prop), refused: true };
  return { row: HERO_ROW(prop), ...out, at: "the hero line" };
}

/** The retired look keys the outline still writes (PIE-1365): the shown note's own, then each style note's. */
const retiredOf = (t: TuneTargetInfo, desk: DeskApi) => retiredLooks({ board: desk.ctx.board, redraw: () => desk.redraw() }, t.look.place.page);

/** Why retired keys are listed, said once: under the pointer on their line, and as the fix's hint card. */
const RETIRED_WHY = "Since PIE-1361 a header picture is the note's own [img::…] [layout::hero] line, its look that line's properties (height, blur, fade, tint, dim, fit, bleed, scroll, title, hero-focus): style.header.image… and style.header.title draw nothing at any level. Remove takes them off the note; move writes the picture they name as this note's hero line with their look on it, then removes them. Either is one step: u in the tune undoes it.";

/** The fixes' hint card: the why (the hint settings say whether it shows again: card, status or off). */
const retiredHint = { title: "Retired look keys", lines: [RETIRED_WHY] };

/**
 * Fixes one note's retired look keys (PIE-1365), as one tune step u takes back: `remove` takes them off the note (or its
 * line), `move` also writes the picture they name as the shown note's hero line, the look moved over (heroFromRetired),
 * what has no place on the line said. Attributed to `actor` like every tune write.
 */
async function fixRetired(op: "remove" | "move", pane: TunePane, desk: DeskApi, actor: Actor, note: string | undefined, line: number | undefined) {
  const t = fresh(pane, desk), all = retiredOf(t, desk);
  if (!all.length) throw new ActionRefused("no note writes retired look keys");
  const r: RetiredLook | undefined = note === undefined ? all[0] : all.find(x => (x.note === note || x.note.startsWith(note)) && (line === undefined ? x.line === undefined : x.line === line - 1));
  if (!r) throw new ActionRefused(`no retired look keys on ${note}${line !== undefined ? ` line ${line}` : ""}: ${all.map(x => `${x.note.slice(0, 8)}${x.line !== undefined ? ` line=${x.line + 1}` : ""}`).join(", ")}`);
  const page = t.look.place.page, mig = heroFromRetired(r.keys);
  if (op === "move" && !mig.path) throw new ActionRefused(`${r.where} names no picture (no style.header.image): remove is its fix`);
  if (op === "move" && !page) throw new ActionRefused(`${pane.source} shows no note to give the picture to`);
  if (op === "move") {
    const own = page && desk.ctx.board ? await refuseAsync(async () => (await board(desk).get(page.id))?.text ?? "") : "";
    const kept = withHeroLine(own, mig.path!, {}).left.find(l => l.startsWith("the picture "));
    if (kept) throw new ActionRefused(`${kept}: nothing of ${r.where}'s picture would move; remove is its fix`);
  }
  const tuning = tuningOf(desk.ctx.board), before = tuning.snapshot(), writes: NoteWrite[] = [];
  let hero: { note: string; line: number } | null = null, kept: string[] = [];
  const what = op === "move" ? `move of ${r.where}'s picture to a hero line` : `removal of ${r.where}'s retired keys`;
  // writeText runs `change` before it answers: `hero` is set by the time it's read.
  const toHero = (text: string) => { const h = withHeroLine(text, mig.path!, mig.set); hero = { note: page!.id, line: h.line + 1 }; kept = h.left; return h.text; };
  // The page's own keys and its hero line are one write; a style note's keys and the page's line are two, one step.
  const together = op === "move" && r.note === page?.id && r.line === undefined;
  try {
    await refuseAsync(async () => {
      // The hero line first: a refusal part way loses no picture (the keys are still there to try again).
      if (op === "move" && !together) { const w = await writeText(board(desk), tuning, page!.id, toHero, null, actor); if (w) writes.push(w); }
      const off = await writeText(board(desk), tuning, r.note, text => (together ? toHero : (x: string) => x)(withoutRetiredLookKeys(text, r.line)), null, actor);
      if (off) writes.push(off);
    });
  } finally {
    if (writes.length) tuning.record({ kind: "write", what, writes, tuningBefore: before, tuningAfter: tuning.snapshot(), by: actor });
    styleSheetsStale(desk.ctx.board as object);
  }
  desk.redraw();
  const leftOut = [...mig.left, ...kept], left = op === "move" && leftOut.length ? ` · left out: ${leftOut.join("; ")}` : "";
  const did = op === "move" ? `${r.where}: ${r.keys.length} retired keys moved to the hero line (line ${hero!.line})` : `${r.where}: ${r.keys.length} retired keys removed`;
  desk.ctx.flash(says(actor, `${did}${left} · u takes it back`));
  return { note: r.note, ...(r.line !== undefined ? { line: r.line + 1 } : {}), removed: r.keys.map(k => k.key), ...(hero ? { hero } : {}), ...(op === "move" ? { set: mig.set, left: leftOut } : {}) };
}

/** What's wrong with the look here: the tile's layers, then the outline's style notes (a key one no longer reads, PIE-1361). */
const problemsOf = (t: TuneTargetInfo, desk: DeskApi) => [...new Set([...t.look.problems, ...styleSheetProblems(desk.ctx.board as object)])];

/** The step words for the status line and the result. */
const stepSaid = (actor: Actor, desk: DeskApi, words: string) => { desk.ctx.flash(says(actor, words)); return words; };

export const TUNE_ACTIONS = actionSet<TuneOn>()("tune", {
  "tune.group.pick": def({
    summary: "pick a token group heading", keys: [{ keys: "j k ← ↑ ↓ →", does: "pick a group heading" }, { keys: "wheel", does: "pick a group heading" }], touches: "tile", replay: "safe",
    examples: [{ act: "tune.group.pick group=Header tile=tune", does: "picks the Header heading" }],
    args: { group: { type: "string", about: "the group heading" } },
    run({ group }, { pane, desk }) {
      const found = STYLE_GROUPS.find(g => g === group);
      if (!found) throw new ActionRefused(`choose a group: ${STYLE_GROUPS.join(", ")}`);
      pane.group = found; pane.heroSel = null; pane.fresh = false; desk.redraw(); return { group: found };
    },
  }),
  "tune.group": def({
    summary: "fold or open a token group, kept for this person", keys: "Enter on a group, click its heading", touches: "tile", replay: "safe",
    examples: [{ act: "tune.group group=Header tile=tune", does: "folds or opens the header tokens" }],
    args: { group: { type: "string", about: "the group heading" } },
    run({ group }, { pane, desk }) {
      const found = STYLE_GROUPS.find(g => g === group);
      if (!found) throw new ActionRefused(`choose a group: ${STYLE_GROUPS.join(", ")}`);
      pane.group = found;
      if (pane.foldedGroups.has(found)) pane.foldedGroups.delete(found); else pane.foldedGroups.add(found);
      writeState("tune-folds.json", [...pane.foldedGroups]);
      desk.redraw(); return { group: found, folded: pane.foldedGroups.has(found) };
    },
  }),
  "tune.filter": def({
    summary: "show all tokens or only values set at the chosen level, keeping declaration order", keys: "f, click the filter", touches: "tile", replay: "safe",
    examples: [{ act: "tune.filter set=true tile=tune", does: "shows only values set at the chosen level" }],
    args: { set: { type: "boolean", about: "only values set here" } },
    run({ set }, { pane, desk }) { pane.onlySet = set; desk.redraw(); return { set }; },
  }),
  "tune.glass.pick": def({ summary: "pick a Glass setting in Tune", keys: "j k up down, click, wheel", touches: "tile", replay: "safe", args: { name: { type: "string", choices: Object.keys(GLASS_SETTINGS), about: "setting" } }, run({ name }, { pane, desk }) { pane.glassSel = name as GlassSetting; desk.redraw(); return { name }; } }),
  "tune.glass.edit": def({ summary: "edit a Glass delay or limit in Tune", keys: "e enter, click edit", touches: "tile", replay: "safe", args: { name: { type: "string", optional: true, choices: Object.keys(GLASS_SETTINGS), about: "setting; picked when omitted" } }, async run({ name }, { pane, desk }) {
    const field = (name ?? pane.glassSel) as GlassSetting;
    pane.glassSel = field;
    await pane.view.edit(field, String(desk.ctx.glass?.settings[field] ?? GLASS_SETTINGS[field].base), [], false, `glass:${field}`, value => desk.ctx.press!("glass.tune", { name: field, value: Number(value) }), { redraw: () => desk.redraw(), said: text => desk.ctx.flash(text) });
    desk.redraw(); return { editing: field };
  } }),
  "tune.section": def({ summary: "show values, the personal Hints list or Glass settings in the tune inspector", keys: "H G, click", touches: "tile", replay: "safe", args: { section: { type: "string", about: "values, hints or glass" } }, examples: [{ act: "tune.section section=hints", does: "shows every hint and its setting" }], run: (a, { pane, desk }) => {
    if (a.section !== "hints" && a.section !== "values" && a.section !== "glass") throw new ActionRefused("section is values, hints or glass");
    pane.section = a.section; pane.view.top = 0; desk.redraw(); return { section: pane.section };
  } }),
  "tune.hint.pick": def({ summary: "select a hint in the inspector", keys: "j, k, up, down, wheel, click", touches: "tile", replay: "safe", args: { id: { type: "string", about: "hint id" } }, examples: [{ act: "tune.hint.pick id=tile.collapse", does: "selects the folding hint" }], run: (a, { pane, desk }) => {
    const n = pane.hintRows(desk).findIndex(r => r.id === a.id);
    if (n < 0) throw new ActionRefused("hints.list shows the declared hints");
    pane.hintSel = n; desk.redraw(); return { selected: a.id };
  } }),
  "tune.edit": def({
    summary: "edit the selected inspector value in place with the shared property field", keys: "e enter, a double click on a value row",
    touches: "tile", replay: "ask", person: "the field belongs to the person; an agent uses tune.set",
    args: {}, run: (_, { pane, desk }) => pane.editField(desk),
  }),
  "tune.field": def({
    summary: "type, choose, save or cancel the shared inspector field", keys: [{ via: "typing in the field" }, { keys: "paste", does: "into the field" }, { keys: "← ↑ ↓ → j k", does: "choose" }, { keys: "⏎", does: "in a field: save" }, { keys: "esc", does: "in a field: cancel" }, { keys: "click", does: "saves" }],
    touches: "tile", replay: "ask", person: "the field belongs to the person; an agent uses tune.set",
    args: { op: { type: "string", about: "text, key, pick, save or cancel" }, value: { type: "string", optional: true, about: "typed text or key name" }, n: { type: "number", optional: true, about: "choice from zero" }, row: { type: "number", optional: true, about: "content row from zero" }, col: { type: "number", optional: true, about: "content column from zero" } },
    examples: [{ act: "tune.field op=save", does: "sets the typed value" }],
    run: async ({ op, value, n, row, col }, { pane, desk }) => { const copied = await pane.view.input(op, value, n, row, col); if (copied) desk.ctx.copy?.(copied); desk.redraw(); return { edited: true }; },
  }),
  "tune.pick": def({
    summary: "pick a row of the tune inspector (n from 1, as peek lists them), or a Hero row by its name (row=hero.tint)",
    keys: [{ keys: "j k ↑ ↓", does: "pick a row" }, { keys: "click", does: "on a row" }, { keys: "wheel", does: "off the values" }],
    touches: "tile", replay: "safe",
    args: { n: { type: "number", optional: true, about: "the row, from 1" }, row: { type: "string", optional: true, about: "a Hero row: hero.height, hero.tint, …" } },
    examples: [
      { act: "tune.pick n=3 tile=tune", does: "picks the third row of the tune inspector and answers its name" },
      { act: "tune.pick row=hero.fade tile=tune", does: "picks the header picture's fade row" },
    ],
    run({ n, row }, { pane, desk }) {
      if (row !== undefined) {
        const hp = heroRowNamed(row);
        if (!hp) throw new ActionRefused(`row is a Hero row: ${HERO_PROP_NAMES.map(HERO_ROW).join(", ")}`);
        pane.heroSel = hp; pane.fresh = false; desk.redraw();
        return { row: HERO_ROW(hp) };
      }
      if (n === undefined) throw new ActionRefused("say n= (a row, from 1) or row=hero.<property>");
      pane.heroSel = null; pane.fresh = false;
      if (!Number.isInteger(n) || n < 1 || n > TUNE_ROWS.length) throw new ActionRefused(`n is 1-${TUNE_ROWS.length}`);
      pane.sel = n - 1; pane.group = null; pane.foldedGroups.delete(groupOf(TUNE_ROWS[pane.sel]!));
      desk.redraw();
      return { row: TUNE_ROWS[pane.sel]!.name };
    },
  }),
  "tune.nudge": def({
    summary: "nudge a look value by steps (by=1 or -1): a number by its step (columns by 2, rows by 1: cells are twice as tall as wide; pad and margin move a row and two columns), on/off flipped, a choice to the next. A Hero row (row=hero.tint, …: the reader's header image) is written on the hero's own line at once (image.look). It draws in the next frame, from memory; s saves it. level= and width= (all, or this: the breakpoint the tile is in now) default to the inspector's. Where something nearer wins over the level (or the width) it writes, it asks first: shadow=anyway (nudge it; it shows only where nothing nearer sets it), shadow=instead (nudge what wins), shadow=clear (take what wins away, then nudge)",
    keys: [{ keys: "+ = l →", does: "nudge up", says: "nudge the look value up a step" }, { keys: "- h ←", does: "nudge down", says: "nudge the look value down a step" }, { keys: "click", does: "on [−] [+]" }, { keys: "wheel", does: "over a value" }, { keys: "a o c", does: "on a row that asks" }, { keys: "click", does: "on a choice of a row that asks" }],
    touches: "nothing", replay: "ask", says: out => (out.refused ? null : out.offered ? `· ${out.row}: ${out.why}` : out.at === "the hero line" ? `· ${out.row} ${out.value}, written on the hero line` : `· ${out.row} ${out.value} (${out.at}) · s saves`),
    args: {
      by: { type: "number", about: "steps: 1 up, -1 down" },
      row: { type: "string", optional: true, about: "the row (measure, pad, pad.x, margin, list.gap, …); default the picked one" },
      level: { type: "string", optional: true, about: "global, tile, screen, page, instance (this tile) or list (this list or component); default the inspector's" },
      width: { type: "string", optional: true, about: "all, or this (the tile's breakpoint now); default the inspector's" },
      shadow: { type: "string", optional: true, about: "where something nearer wins: anyway, instead or clear" },
    },
    examples: [
      { act: "tune.nudge by=1 row=measure tile=tune", does: "widens the tuned tile's text measure by one step, in memory until saved" },
      { act: "tune.nudge by=-1 row=list.gap level=screen width=this tile=tune", does: "tightens the list gap for this screen's current width only" },
    ],
    async run({ by, row, level, width, shadow }, { pane, desk, standing }, actor) {
      const hp = row === undefined ? pane.heroPicked(desk) : heroRowNamed(row);
      if (hp) return writeHeroRow(pane, desk, actor, hp, { by: Math.sign(by) || 1 });
      const r = row === undefined ? (pane.group ? undefined : TUNE_ROWS[pane.sel]) : rowNamed(row);
      if (!r) throw new ActionRefused(`row is one of ${TUNE_ROWS.map(x => x.name).join(", ")}`);
      if (level !== undefined && !TUNE_LEVELS.includes(level as TuneLevel)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      if (shadow !== undefined && !["anyway", "instead", "clear"].includes(shadow)) throw new ActionRefused("shadow is anyway, instead or clear");
      // The level and width it writes: the inspector's, or the ones asked for (an agent's never change the inspector's).
      const person = standing;
      let lv = (level ?? pane.level) as TuneLevel, sc: "all" | "this" = width === undefined ? pane.scope : width === "this" ? "this" : "all";
      if (person) { pane.level = lv; pane.scope = sc; }
      const tuning = tuningOf(desk.ctx.board);
      let t = fresh(pane, desk);
      const step = Math.sign(by) || 0, last = r.tokens[r.tokens.length - 1]!;
      // Where something nearer wins: ask before nudging blind (the person: in place; an agent: refused with its choices).
      const sh = pane.shadowOf(t, last, lv, sc);
      if (sh && !shadow) {
        const choices = sh.can.map(c => (c === "anyway" ? `shadow=anyway (it shows only where nothing nearer sets it)` : c === "instead" ? `shadow=instead (${sh.instead})` : `shadow=clear (${sh.clear})`)).join(", ");
        if (!standing) throw new ActionRefused(`${r.name}: ${sh.why}: ${choices}`);
        pane.offer = { row: r.name, by: step, shadow: sh };
        desk.ctx.flash(`${r.name}: ${sh.why} · a: nudge ${lv === "auto" ? "it" : lv} anyway${sh.can.includes("instead") ? ` · o: ${sh.instead}` : ""}${sh.can.includes("clear") ? ` · c: ${sh.clear}` : ""}`);
        desk.redraw();
        return { row: r.name, offered: true, why: sh.why, choices: sh.can };
      }
      if (person) pane.offer = null;
      if (sh && shadow) {
        if (!sh.can.includes(shadow as ShadowChoice)) throw new ActionRefused(`${r.name}: ${sh.why}: only shadow=${sh.can.join(" or ")}`);
        if (shadow === "instead") { if (sh.kind === "variant") sc = "this"; else lv = levelOfSource(sh.src); if (person) { pane.level = lv; pane.scope = sc; } }
        if (shadow === "clear") {
          const plan: (() => void)[] = [];
          for (const tk of r.tokens) plan.push(await takeAway(pane, desk, t, tk, pane.values(t).sources[tk], actor));
          for (const f of plan) f();
          t = fresh(pane, desk);
        }
      }
      const { values } = pane.values(t);
      const shown: string[] = [];
      let at = "";
      for (const tk of r.tokens) {
        const a = pane.aimAt(t, tk, lv, sc);
        if (!a) throw new ActionRefused(lv === "page" ? `${pane.source} shows no note: pick tile, screen or global (tune.level)` : `${pane.source} has no ${lv} level`);
        // From the level's own value when it sets one (what it will say), else the value in force.
        const own = pane.ownValue(t, tk, lv, sc), parsed = own !== null && own !== UNSET ? parseStyleValue(tk, own) : null;
        const from = parsed && "value" in parsed ? parsed.value : values[tk];
        const next = nudgeStyleValue(tk, from as StyleValue, step);
        listOnly(a.target, a.field, t, tuning);
        tuning.set(a.target, a.field, styleValueText(next), actor);
        shown.push(styleValueText(next));
        at = `${targetWords(a.target)}${a.variant ? `, ${a.variant} only` : ""}`;
      }
      desk.redraw();
      return { row: r.name, value: shown.join(" "), at, unsaved: tuning.unsavedCount(), ...(shadow ? { shadow } : {}) };
    },
  }),
  "tune.set": def({
    summary: "set a look value outright, as a nudge does (in memory until saved): row= a token, value= as a style note writes it (88, on, dots, \"1 0 1\"). A Hero row (row=hero.tint) is written on the note's hero line at once (image.look)",
    keys: [{ via: "ep0ch act tune.set row=measure value=72" }],
    touches: "nothing", replay: "ask", says: out => (out.refused ? null : out.at === "the hero line" ? `· ${out.row} ${out.value}, written on the hero line` : `· ${out.row} ${out.value} (${out.at}) · s saves`),
    args: {
      row: { type: "string", about: "a token (measure, pad.x, list.gap, …)" },
      value: { type: "string", about: "its value" },
      level: { type: "string", optional: true, about: "global, tile, screen, page, instance (this tile) or list (this list or component); default the inspector's" },
      width: { type: "string", optional: true, about: "all, or this; default the inspector's" },
    },
    examples: [
      { act: "tune.set row=measure value=72 tile=tune", does: "sets the text measure to 72 cells at the inspector's level, until saved" },
      { act: "tune.set row=list.zebra value=on level=global tile=tune", does: "turns zebra stripes on in every list, until saved" },
    ],
    run({ row, value, level, width }, { pane, desk, standing }, actor) {
      const hp = heroRowNamed(row);
      if (hp) return writeHeroRow(pane, desk, actor, hp, { to: value });
      const r = rowNamed(row);
      if (!r || r.tokens.length !== 1) throw new ActionRefused(`row is one token: ${TUNE_ROWS.filter(x => x.tokens.length === 1).map(x => x.name).join(", ")}`);
      const tk = r.tokens[0]!;
      const ok = parseStyleValue(tk, value);
      if ("problem" in ok) throw new ActionRefused(ok.problem);
      const lv = (level ?? pane.level) as TuneLevel;
      if (!TUNE_LEVELS.includes(lv)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      const t = fresh(pane, desk);
      const a = pane.aimAt(t, tk, lv, (width ?? pane.scope) === "this" ? "this" : "all");
      if (!a) throw new ActionRefused(`${pane.source} has no ${lv} level`);
      listOnly(a.target, a.field, t, tuningOf(desk.ctx.board));
      tuningOf(desk.ctx.board).set(a.target, a.field, styleValueText(ok.value), actor);
      desk.redraw();
      return { row: tk, value: styleValueText(ok.value), at: targetWords(a.target) };
    },
  }),
  "tune.unset": def({
    summary: "reset a row's value to what it inherits: what sets it here is taken away (a width variant first, then its plain value), off the note that wrote it (in memory until s, the save removing the property), or, set only by a nudge, the nudge let go. A Hero row (row=hero.tint) is taken off the note's hero line at once. A built-in, a box's or a heading style's is edited where it's written; one a shorthand or a tier gives is refused, naming the note",
    keys: "x, a click on a row's × or on [reset value]",
    touches: "nothing", replay: "ask", says: out => (out.refused ? null : out.at === "the hero line" ? `· ${out.row} back to the built-in, written on the hero line` : `· ${out.row} ${out.value} (${out.from}) · s saves`),
    args: { row: { type: "string", optional: true, about: "the row (measure, pad, bg, list.divider, …); default the picked one" } },
    examples: [
      { act: "tune.unset row=measure tile=tune", does: "takes away what sets the measure here, so it falls back to what it inherits" },
    ],
    async run({ row }, { pane, desk, standing }, actor) {
      const hp = row === undefined ? pane.heroPicked(desk) : heroRowNamed(row);
      if (hp) return writeHeroRow(pane, desk, actor, hp, { to: "none" });
      const r = row === undefined ? (pane.group ? undefined : TUNE_ROWS[pane.sel]) : rowNamed(row);
      if (!r) throw new ActionRefused(`row is one of ${TUNE_ROWS.map(x => x.name).join(", ")}`);
      const t = fresh(pane, desk);
      // Decided for every token before any is changed: a pair (pad) is reset whole or not at all.
      const plan: (() => void)[] = [];
      for (const tk of r.tokens) plan.push(await takeAway(pane, desk, t, tk, pane.values(t).sources[tk], actor));
      for (const f of plan) f();
      if (standing) pane.offer = null;
      desk.redraw();
      // What shows now, resolved again (the tile's look as drawn is the frame before this one).
      const now = pane.values(fresh(pane, desk)), last = r.tokens[r.tokens.length - 1]!;
      const value = r.tokens.map(tk => styleValueText(now.values[tk] as StyleValue)).join(" "), from = sourceWords(now.sources[last]);
      return { row: r.name, value, from, unsaved: tuningOf(desk.ctx.board).unsavedCount() };
    },
  }),
  "tune.level": def({
    summary: "the level a nudge goes to: auto (where the value comes from, its width variant too: a named style, the page, the tile's kind…; the tile's kind for a built-in), or global, tile (its kind), screen, page (the note it shows), instance (this tile alone, kept in its tile spec) or list (the list the reader's [ ] is in, on its first item, over its heading and lead-in defaults). Picked, each row shows what that level says itself, and a row where something nearer wins is marked",
    keys: "v, a click on a level",
    touches: "tile", replay: "safe",
    args: { level: { type: "string", about: "auto, global, tile, screen, page, instance (this tile) or list (this list or component)" } },
    examples: [
      { act: "tune.level level=screen tile=tune", does: "sends the inspector's nudges to this screen's style note" },
      { act: "tune.level level=auto tile=tune", does: "sends each nudge to where its value comes from" },
    ],
    run({ level }, { pane, desk }) {
      if (!TUNE_LEVELS.includes(level as TuneLevel)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      pane.level = level as TuneLevel;
      pane.offer = null; pane.armed = null;
      desk.redraw();
      return { level };
    },
  }),
  "tune.width": def({
    summary: "whether a nudge is for every width (all) or only the width the tile is in now (this: its breakpoint's variant, narrow or wide)",
    keys: "w, a click on the width chip",
    touches: "tile", replay: "safe",
    args: { scope: { type: "string", about: "all or this" } },
    examples: [
      { act: "tune.width scope=this tile=tune", does: "makes nudges apply only to the width variant the tile is in now" },
      { act: "tune.width scope=all tile=tune", does: "makes nudges apply at every width" },
    ],
    run({ scope }, { pane, desk }) {
      if (scope !== "all" && scope !== "this") throw new ActionRefused("scope is all or this");
      pane.scope = scope;
      pane.offer = null;
      const bp = pane.info(desk)?.look.breakpoint ?? null;
      if (scope === "this" && !bp) desk.ctx.flash("between the breakpoints a nudge is for every width: narrow or widen the tile for its own");
      desk.redraw();
      return { scope, breakpoint: bp };
    },
  }),
  "tune.save": def({
    summary: "write the nudges to the outline: every level's this tile has (auto), or the level picked's: a page's onto its note, a named style's or a level's onto its style note (a new one when it has none, under the outline's Looks note), a value reset off the note it came from; attributed, checked against the revision it read. One step of the history: u takes it back",
    keys: "s, a click on [save]",
    touches: "nothing", replay: "ask", says: out => (out.saved ? `· saved ${out.fields} to ${out.at}` : "· nothing to save there"),
    args: { level: { type: "string", optional: true, about: "auto, global, tile, screen, page, instance or list; default the inspector's" } },
    examples: [
      { act: "tune.save tile=tune", does: "writes the tuned tile's nudges to the style notes they belong to" },
      { act: "tune.save level=page tile=tune", does: "writes the page-level nudges onto the note the tile shows" },
    ],
    async run({ level }, { pane, desk, standing }, actor) {
      const lv = (level ?? pane.level) as TuneLevel;
      if (!TUNE_LEVELS.includes(lv)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      const t = pane.info(desk);
      if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
      const tuning = tuningOf(desk.ctx.board), place = t.look.place;
      // auto: each target this tile's look reads (global, its kind, its screen, its page and the style it names).
      const named = place.page?.properties.find(p => p.key.toLowerCase() === "style")?.value.trim().toLowerCase();
      const list = t.list?.target ?? null, ownLists = new Set((t.list?.layers ?? []).flatMap(l => (l.block && l.line !== undefined ? [listTarget(l.block, l.line)] : [])));
      const reads = new Set([...SAVE_LEVELS.map(l => tuneTarget(l, place, list)), named, ...ownLists].filter((x): x is string => !!x));
      const targets = lv === "auto" ? tuning.unsaved().map(u => u.target).filter(x => reads.has(x)) : [tuneTarget(lv, place, list)].filter((x): x is string => !!x);
      // This list's: also a nudge made on another line of the note shown, as when an edit since moved the list (the
      // reader's [ ] is on another line now, or on none): saved against the revision it was tuned at, so it's refused,
      // never dropped as "nothing to save" or "no list level".
      const on = lv === "list" ? (list ? parseListTarget(list)?.note : place.page?.id) : undefined;
      if (on) for (const u of tuning.unsaved()) if (!targets.includes(u.target) && parseListTarget(u.target)?.note === on) targets.push(u.target);
      if (lv !== "auto" && !targets.length) throw new ActionRefused(`${pane.source} has no ${lv} level`);
      const done: { at: string; fields: string[]; created: boolean; note: string }[] = [], writes: NoteWrite[] = [];
      const before = tuning.snapshot();
      try {
        for (const target of targets) {
          const r = await refuseAsync(() => saveTuning({ board: desk.ctx.board, redraw: () => desk.redraw() } as Parameters<typeof saveTuning>[0], target, actor, writes, desk.tileLooks));
          if (r) done.push({ at: targetWords(target), fields: r.fields, created: r.created, note: r.note });
        }
      } finally {
        // What was written is one step, even when a later note refused: u takes back what was saved.
        if (writes.length) tuning.record({ kind: "write", what: `save of ${done.flatMap(d => d.fields).join(" ") || "the nudges"} to ${done.map(d => d.at).join(", ") || "the outline"}`, writes, tuningBefore: before, tuningAfter: tuning.snapshot(), by: actor });
      }
      desk.redraw();
      if (!done.length) return { saved: false, at: lv === "auto" ? "nothing unsaved" : targetWords(targets[0]!) };
      const words = done.map(d => `${d.fields.join(" ")} to ${d.at}${d.created ? " (a new style note)" : ""}`).join("; ");
      desk.ctx.flash(says(actor, `saved ${words}`));
      return { saved: true, at: done.map(d => d.at).join(", "), fields: done.flatMap(d => d.fields).join(" "), notes: done.map(d => d.note), created: done.some(d => d.created) };
    },
  }),
  "tune.undo": def({
    summary: "step back through the session's history, one step a time: a nudge (or a value reset), or a write (a save, a level reset, a revert), whose notes are written back as they were, refused when one changed since. An agent takes back only its own. Said on the status line",
    keys: "u, a click on [undo]",
    touches: "nothing", replay: "ask", says: out => `· undo: ${out.words}`,
    args: {},
    async run(_, { pane, desk, standing }, actor) {
      const tuning = tuningOf(desk.ctx.board), s = refuse(() => tuning.nextUndo(actor));
      if (!s) throw new ActionRefused("nothing to take back");
      if (s.kind === "write") await refuseAsync(() => rewrite(board(desk), tuning, s.writes, true, actor, desk.tileLooks));
      tuning.undone(s);
      if (standing) { pane.offer = null; pane.armed = null; }
      desk.redraw();
      const words = stepSaid(actor, desk, `undo: ${stepWords(s, true)}`).slice(6);
      return { undone: s.kind === "nudge" ? s.field : s.what, ...(s.kind === "nudge" ? { at: targetWords(s.target) } : {}), words };
    },
  }),
  "tune.redo": def({
    summary: "do again what undo took back, one step a time (a write's notes written again, refused when one changed since); a new nudge or write ends what can be redone",
    keys: "U, ctrl+r, a click on [redo]",
    touches: "nothing", replay: "ask", says: out => `· redo: ${out.words}`,
    args: {},
    async run(_, { pane, desk, standing }, actor) {
      const tuning = tuningOf(desk.ctx.board), s = refuse(() => tuning.nextRedo(actor));
      if (!s) throw new ActionRefused("nothing to redo");
      if (s.kind === "write") await refuseAsync(() => rewrite(board(desk), tuning, s.writes, false, actor, desk.tileLooks));
      tuning.redone(s);
      if (standing) { pane.offer = null; pane.armed = null; }
      desk.redraw();
      const words = stepSaid(actor, desk, `redo: ${stepWords(s, false)}`).slice(6);
      return { redone: s.kind === "nudge" ? s.field : s.what, words };
    },
  }),
  "tune.resetlevel": def({
    summary: "reset the level picked (not auto): every value it sets for this tile (the global style notes, the tile kind's, the screen's, the page's own) taken off its style notes in one attributed write each, and its nudges let go. It asks in place first: confirm=true (or X again, or [confirm]) does it. One step: u takes it back",
    keys: "X then X, a click on [reset level] then [confirm]",
    touches: "nothing", replay: "ask", says: out => (out.armed ? `· ${out.words}: confirm` : `· reset ${out.reset}`),
    args: { confirm: { type: "boolean", optional: true, about: "do it (without: it asks)" } },
    examples: [
      { act: "tune.resetlevel confirm=true tile=tune", does: "takes every value the picked level sets for this tile off its style notes" },
    ],
    async run({ confirm }, { pane, desk, standing }, actor) {
      const t = pane.info(desk);
      if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
      if (pane.level === "auto") throw new ActionRefused("pick the level to reset first (v, or tune.level): global, tile, screen, page, instance (this tile) or list (this list or component)");
      const target = tuneTarget(pane.level, t.look.place, t.list?.target ?? null);
      if (!target) throw new ActionRefused(pane.level === "list" ? "the [ ] isn't in a list with a heading or a line above it" : `${pane.source} has no ${pane.level} level`);
      const tuning = tuningOf(desk.ctx.board), src = { board: desk.ctx.board, redraw: () => desk.redraw() };
      // This tile's: its spec's look. This list's: the list tokens on its owner line. Else the level's style notes.
      const tileOwn = target.startsWith("instance:") ? Object.keys(t.look.place.instance?.fields ?? {}) : [];
      const listLine = parseListTarget(target), listOwn = listLine ? Object.keys(t.list?.layers.find(l => l.line === listLine.line)?.fields ?? {}) : [];
      const { notes, lines } = tileOwn.length || listLine ? { notes: [] as { id: string; fields: number }[], lines: [] as string[] } : levelNotes(src, target, t.look.place), nudges = tuning.layers.get(target)?.size ?? 0;
      const n = notes.reduce((k, x) => k + x.fields, 0) + tileOwn.length + listOwn.length;
      if (!n && !nudges) throw new ActionRefused(`${targetWords(target)} sets nothing here${lines.length ? ` (its values on lines of notes are edited there)` : ""}`);
      const off = tileOwn.length ? "its tile spec" : listLine ? "its line" : `${notes.length} style note${notes.length === 1 ? "" : "s"}`;
      const words = `reset ${targetWords(target)}: ${n} value${n === 1 ? "" : "s"} off ${off}${nudges ? `, ${nudges} nudge${nudges === 1 ? "" : "s"} let go` : ""}${lines.length ? ` (not those on lines: edit those notes)` : ""}`;
      // Asked in place: the person's inspector arms (X again, or [confirm]); an agent is told to send confirm=true, and the
      // person's inspector is left as it was.
      if (!confirm) {
        if (!standing) return { armed: true, words, confirm: "send confirm=true to do it" };
        pane.armed = { action: "tune.resetlevel", words, target }; pane.offer = null;
        desk.ctx.flash(`${words} · X again or [confirm] to do it`);
        desk.redraw();
        return { armed: true, words };
      }
      if (standing) pane.armed = null;
      const before = tuning.snapshot(), writes: NoteWrite[] = [];
      try {
        await refuseAsync(async () => {
          if (tileOwn.length) { const w = writeTile(desk.tileLooks, tuning, target, Object.fromEntries(tileOwn.map(k => [k, null]))); if (w) writes.push(w); }
          else if (listLine) {
            const keys = listOwn.map(k => { const f = parseFieldKey(k)!; return styleProperty(f.token, f.variant); });
            const w = await writeLine(board(desk), tuning, listLine.note, listLine.line, Object.fromEntries(keys.map(k => [k, null])), null, actor);
            if (w) writes.push(w);
          } else await clearNotes(board(desk), tuning, notes.map(x => x.id), actor, writes);
        });
        tuning.clear(target);
      }
      finally { if (writes.length || tuning.snapshot().size !== before.size) tuning.record({ kind: "write", what: `reset of ${targetWords(target)}`, writes, tuningBefore: before, tuningAfter: tuning.snapshot(), by: actor }); }
      desk.redraw();
      desk.ctx.flash(says(actor, `${words} · u takes it back`));
      return { reset: targetWords(target), values: n, notes: writes.map(w => w.note) };
    },
  }),
  "tune.cancel": def({
    summary: "keep the changes and dismiss the tune confirmation",
    keys: [{ keys: "esc", does: "cancel", says: "dismiss the confirmation and keep the changes" }, { via: "any other key" }, { keys: "click", does: "on [cancel]" }], touches: "tile", replay: "safe", args: {},
    run(_, { pane, desk }) { pane.armed = null; pane.offer = null; desk.redraw(); return { cancelled: true }; },
  }),
  "tune.revert": def({
    summary: "revert all: every style note this session wrote put back as it was before the first write (saved changes too), one attributed write each, and every nudge let go; refused, naming the note, when one changed since (another door or an agent). It asks in place first: confirm=true (or R again, or [confirm]) does it. One step: u takes it back",
    keys: "R then R, a click on [revert all] then [confirm]",
    touches: "nothing", replay: "ask", says: out => (out.armed ? `· ${out.words}: confirm` : `· reverted ${out.notes.length} notes`),
    args: { confirm: { type: "boolean", optional: true, about: "do it (without: it asks)" } },
    examples: [
      { act: "tune.revert confirm=true tile=tune", does: "puts every style note this session wrote back as it was and lets nudges go" },
    ],
    async run({ confirm }, { pane, desk, standing }, actor) {
      const tuning = tuningOf(desk.ctx.board), notes = tuning.baseline.size, nudges = tuning.unsavedCount();
      if (!notes && !nudges) throw new ActionRefused("nothing changed this session: no style note written, no nudge");
      const words = `revert all: ${nudges} unsaved nudge${nudges === 1 ? "" : "s"} let go, ${notes} saved style note${notes === 1 ? "" : "s"} put back`;
      if (!confirm) {
        if (!standing) return { armed: true, words, confirm: "send confirm=true to do it", notes: [] as string[] };
        pane.armed = { action: "tune.revert", words }; pane.offer = null;
        desk.ctx.flash(`${words} · R again or [confirm] to do it`);
        desk.redraw();
        return { armed: true, words, notes: [] as string[] };
      }
      if (standing) pane.armed = null;
      const before = tuning.snapshot(), writes: NoteWrite[] = [];
      try { await refuseAsync(() => revertAll(board(desk), tuning, actor, writes, desk.tileLooks)); tuning.clear(); }
      finally { if (writes.length) tuning.record({ kind: "write", what: "revert of the session", writes, tuningBefore: before, tuningAfter: tuning.snapshot(), by: actor }); }
      desk.redraw();
      desk.ctx.flash(says(actor, `${words} · u takes it back`));
      return { reverted: true, notes: writes.map(w => w.note) };
    },
  }),
  "tune.retired.remove": def({
    summary: "take a note's retired look keys off it (PIE-1365: style.header.image… and style.header.title, inert since PIE-1361): note= its id (or the start of it; default the first the tune lists), line= for a declaration on a line. One attributed write; u in the tune takes it back",
    keys: "D (the first listed), a click on [remove] on its line",
    touches: "nothing", replay: "ask", hintId: "tune.retired", hint: retiredHint,
    says: out => `· ${out.removed.length} retired keys removed from ${out.note.slice(0, 8)}`,
    args: { note: { type: "string", optional: true, about: "the note writing them (its id, or the start of it)" }, line: { type: "number", optional: true, about: "the line declaring them, from 1" } },
    examples: [
      { act: "tune.retired.remove note=7d9a1f40 tile=tune", does: "takes the retired header-image keys off that note" },
    ],
    run: ({ note, line }, { pane, desk }, actor) => fixRetired("remove", pane, desk, actor, note, line),
  }),
  "tune.retired.move": def({
    summary: "move a note's retired look keys to a hero line (PIE-1365): the picture style.header.image names written as the shown note's [img::…] [layout::hero] line (the image line naming it made the hero, else a new line under the subject), the look mapped onto it (height, blur, fade, tint, dim, fit, bleed, scroll, title; x/y as hero-focus), what has no place there said, and the keys removed. note= and line= as tune.retired.remove. One attributed step; u in the tune takes it back",
    keys: "M (the first listed), a click on [move to a hero line] on its line",
    touches: "nothing", replay: "ask", hintId: "tune.retired", hint: retiredHint,
    says: out => `· ${out.removed.length} retired keys moved to the hero line of ${out.hero?.note.slice(0, 8)}`,
    args: { note: { type: "string", optional: true, about: "the note writing them (its id, or the start of it)" }, line: { type: "number", optional: true, about: "the line declaring them, from 1" } },
    examples: [
      { act: "tune.retired.move note=7d9a1f40 tile=tune", does: "writes that note's old header picture as the shown note's hero line, with its look, and removes the keys" },
    ],
    run: ({ note, line }, { pane, desk }, actor) => fixRetired("move", pane, desk, actor, note, line),
  }),
  "tune.aim": def({
    summary: "point the tune inspector at another tile on this screen",
    touches: "tile", replay: "safe",
    // `target`, not `tile`: an act line's tile= names the tile the action runs in, so it would never arrive (PIE-1032).
    args: { target: { type: "string", kind: "tile", about: "the tile's name" } },
    examples: [
      { act: "tune.aim target=activity", does: "points the tune inspector at the activity tile" },
    ],
    run({ target: tile }, { pane, desk }) {
      if (!desk.tileLook?.(tile)) throw new ActionRefused(`no tile ${tile} drawn on this screen`);
      pane.source = tile;
      pane.offer = null; pane.armed = null;
      desk.redraw();
      return { tile };
    },
  }),
});

/** A swatch of surface `role` (two cells) at `n` (a strength, 1 to SURFACE_STEPS; an opacity, 0 to 100); a dim dash for none. */
function swatchOf(role: Surface, n: number, opacity: boolean): string {
  const c = surfaceMix(role, opacity ? n / 100 : n / SURFACE_STEPS);
  return c ? bgRgb(c) + "  " + RESET : fg(C.dark) + "--" + RESET;
}
