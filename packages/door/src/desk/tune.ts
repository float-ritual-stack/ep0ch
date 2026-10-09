// The tune inspector (PIE-673, PIE-675): a tile beside the one it tunes, like devtools' computed styles. It lists the
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
  fieldKey, isListField, levelOfSave, nudgeStyleValue, parseFieldKey, parseStyleAttrs, parseStyleValue, resolveStyle, SAVE_LEVELS, STYLE_LEVELS, styleProperty, STYLE_TOKENS, styleValueText,
  SURFACE_STEPS, type Breakpoint, type StyleLayer, type StyleSource, type StyleToken, type StyleValue, type Surface,
} from "@ep0ch/outline-core/style-cascade";
import { liveTokensInLine } from "@ep0ch/outline-core/heading-styles";
import {
  clearNotes, levelNotes, listTarget, lookFor, parseListTarget, writeLine, writeTile, revertAll, rewrite, saveTuning, sourceTarget, stepWords, targetWords, tuneTarget, tuningOf, UNSET,
  type Look, type NoteWrite, type StyleWriteBoard, type TuneTarget,
} from "../look";
import { surfaceMix } from "../theme";
import type { Actor } from "../socket";
import { ActionRefused, actionSet, agentLabel, def } from "../surface/actions";
import { bgRgb, C, chip, ellipsize, fg, pad, RESET, selected, width } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { RowView, type RowPress } from "../scroll";
import { runOwn, type DeskApi, type Pane, type PaneView } from "./panes";

/** The levels the inspector offers: where each value comes from, or one level for every nudge. */
export const TUNE_LEVELS = ["auto", ...SAVE_LEVELS] as const;
export type TuneLevel = (typeof TUNE_LEVELS)[number];

/** One row of the inspector: a token, or a pair set together (`pad`: a row and two columns, cells being twice as tall as wide). */
interface TuneRow { name: string; tokens: readonly StyleToken[] }
export const TUNE_ROWS: readonly TuneRow[] = [
  { name: "measure", tokens: ["measure"] },
  { name: "pad", tokens: ["pad.y", "pad.x"] },
  { name: "pad.x", tokens: ["pad.x"] },
  { name: "pad.y", tokens: ["pad.y"] },
  { name: "margin", tokens: ["margin.y", "margin.x"] },
  { name: "margin.x", tokens: ["margin.x"] },
  { name: "margin.y", tokens: ["margin.y"] },
  { name: "list.gap", tokens: ["list.gap"] },
  { name: "list.zebra", tokens: ["list.zebra"] },
  { name: "list.zebra.bg", tokens: ["list.zebra.bg"] },
  { name: "list.zebra.strength", tokens: ["list.zebra.strength"] },
  { name: "list.divider", tokens: ["list.divider"] },
  { name: "list.divider.glyph", tokens: ["list.divider.glyph"] },
  { name: "list.divider.align", tokens: ["list.divider.align"] },
  { name: "bg", tokens: ["bg"] },
  { name: "bg.strength", tokens: ["bg.strength"] },
  { name: "border", tokens: ["border"] },
  { name: "edge", tokens: ["edge"] },
  { name: "tone", tokens: ["tone"] },
  { name: "header.bg", tokens: ["header.bg"] },
  { name: "header.bg.opacity", tokens: ["header.bg.opacity"] },
  { name: "header.image", tokens: ["header.image"] },
  { name: "header.image.x", tokens: ["header.image.x"] },
  { name: "header.image.y", tokens: ["header.image.y"] },
  { name: "heading.margin", tokens: ["heading.margin"] },
  { name: "heading.padding", tokens: ["heading.padding"] },
  { name: "bp.narrow", tokens: ["bp.narrow"] },
  { name: "bp.wide", tokens: ["bp.wide"] },
];
const rowNamed = (name: string) => TUNE_ROWS.find(r => r.name === name.trim().toLowerCase());

/** What the inspector sees of the tile it tunes (DeskApi.tileLook). */
export interface TuneTargetInfo {
  look: Look; kind: string; title: string; cols: number; box: { attrs: string; line: number } | null;
  /** The note's pictures (a reader's), by path: what a nudge of `header.image` steps through, after the hero (empty). */
  pictures?: string[];
  /** The list the reader's [ ] is in (`this list`): where its save goes, and its own layers. */
  list?: { target: string | null; layers: StyleLayer[]; first: number; revision?: number } | null;
}

/** The rows that are a surface (PIE-675): drawn with a swatch of it beside the value, at the strength they're shown at. */
const SWATCH: Partial<Record<StyleToken, StyleToken>> = { "bg": "bg.strength", "list.zebra.bg": "list.zebra.strength", "header.bg": "header.bg.opacity" };

/** Where a value came from, in a few words: `tile detail`, `page · tuning`, `built-in`, with its width variant. */
export const sourceWords = (s: StyleSource) => `${s.label}${s.variant ? ` · ${s.variant}` : ""}`;
/** The width the tile is in, in words. */
function widthWords(look: Look): string {
  const v = look.values;
  return look.breakpoint === "narrow" ? `narrow (under ${v["bp.narrow"]})` : look.breakpoint === "wide" ? `wide (${v["bp.wide"]} and up)` : `normal (${v["bp.narrow"]}–${v["bp.wide"] - 1})`;
}

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
/** The save level a source's target is, for the level picker: named styles are written "where it's set" (auto). */
const levelOfSource = (src: StyleSource): TuneLevel => (src.level === "global" || src.level === "tile" || src.level === "screen" || src.level === "instance" ? src.level : src.level === "page" && src.label === "page" ? "page" : src.label === "this list" ? "list" : "auto");

export class TunePane implements Pane {
  readonly kind = "tune";
  sel = 0;
  /**
   * The level a nudge goes to and a save writes: `auto` (where the value comes from, as devtools edits the rule that
   * applies: a named style, the page, the tile's kind…; the tile's kind for a built-in), or one picked.
   */
  level: TuneLevel = "auto";
  /** A nudge is for every width, or for the width the tile is in now (its breakpoint's variant). */
  scope: "all" | "this" = "all";
  /** A nudge held on a row where something nearer wins: the choices it offers (a, o, c, or a click). */
  offer: { row: string; by: number; shadow: Shadow } | null = null;
  /** A reset of a level, or a revert, waiting for its confirmation (the same key again, or [confirm]). */
  armed: Armed | null = null;
  private view = new RowView();
  private head = 0;
  private controls: { y: number; x: number; cols: number; action: string; args: Record<string, unknown> }[] = [];
  /** The rows' screen lines as last drawn: the row each is, or the value cell a wheel nudges. */
  private rowAt = new Map<number, { row: number; valueFrom: number; valueTo: number }>();
  /** `source`: the tile it tunes, by name (re-resolved each frame: ADR 0001, a role). */
  constructor(public source: string) {}

  title() { return `tune · ${this.source}`; }
  hint() { return "j k pick · + − nudge · v level · w width · s save · u undo · U redo · x reset value · X reset level · R revert all"; }
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

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.controls = []; this.rowAt.clear();
    const t = this.info(desk);
    if (!t) return { lines: [fg(C.dark) + pad(`tile ${this.source} isn't on this screen · tune.aim tile=<name>, or alt+y in the tile to tune`, w) + RESET] };
    const tuning = tuningOf(desk.ctx.board), unsaved = tuning.unsavedCount();
    const lines: string[] = [];
    const put = (parts: { text: string; sgr: string; action?: string; args?: Record<string, unknown> }[]) => {
      let line = "", x = 0;
      for (const p of parts) {
        if (x >= w) break;
        const text = ellipsize(p.text, w - x);
        if (p.action) this.controls.push({ y: lines.length, x, cols: width(text), action: p.action, args: p.args ?? {} });
        line += p.sgr + text + RESET; x += width(text);
      }
      lines.push(line);
    };
    const sp = { text: " ", sgr: "" };
    put([{ text: `${t.kind}${t.title !== t.kind ? ` ${t.title}` : ""} · ${t.cols} cols · `, sgr: fg(C.grey) }, { text: widthWords(t.look), sgr: fg(C.lcyan) }, ...(t.box ? [{ text: " · in a box", sgr: fg(C.yellow) }] : [])]);
    // The levels a save goes to; the one picked lit. A level this tile hasn't (no page shown) is dim.
    put([{ text: "nudge ", sgr: fg(C.dark) }, ...TUNE_LEVELS.flatMap(l => {
      const target = l === "auto" ? null : tuneTarget(l, t.look.place, t.list?.target ?? null), on = l === this.level;
      return [{ text: ` ${l === "auto" ? "where it's set" : target ? targetWords(target) : l === "instance" ? "this tile" : l === "list" ? "this list" : l} `, sgr: on ? chip(C.blue) : fg(l === "auto" || target ? C.cyan : C.dark), action: "tune.level", args: { level: l } }, sp];
    })]);
    put([
      { text: this.scope === "all" ? " all widths " : ` ${t.look.breakpoint ?? "normal"} only `, sgr: chip(this.scope === "all" ? C.dark : C.magenta), action: "tune.width", args: { scope: this.scope === "all" ? "this" : "all" } }, sp,
      { text: "[save]", sgr: fg(unsaved ? C.lgreen : C.dark), action: "tune.save" }, sp,
      { text: "[undo]", sgr: fg(C.cyan), action: "tune.undo" }, sp,
      { text: "[redo]", sgr: fg(C.cyan), action: "tune.redo" },
      ...(unsaved ? [{ text: ` · ${unsaved} unsaved, s to save`, sgr: fg(C.yellow) }] : []),
    ]);
    put([
      { text: "[reset value]", sgr: fg(C.cyan), action: "tune.unset" }, sp,
      { text: "[reset level]", sgr: fg(this.level === "auto" ? C.dark : C.cyan), action: "tune.resetlevel" }, sp,
      { text: "[revert all]", sgr: fg(tuning.baseline.size || unsaved ? C.cyan : C.dark), action: "tune.revert" },
    ]);
    // A step waiting for its confirmation, or a nudge held on a row where something nearer wins: said in place, with its choices.
    // [confirm] first, so a narrow inspector still shows it; what it will do follows (and is on the status line).
    if (this.armed) put([{ text: "⚠ ", sgr: fg(C.yellow) }, { text: "[confirm]", sgr: fg(C.lred), action: this.armed.action, args: { confirm: true } }, { text: ` ${this.armed.words} · ${this.armed.action === "tune.revert" ? "R" : "X"} again · any other key keeps them`, sgr: fg(C.yellow) }]);
    else if (this.offer) {
      const o = this.offer, s = o.shadow;
      // The why is on the row (⊘) and the status line; the choices come first here, so a narrow inspector still shows them.
      put([{ text: "⊘ ", sgr: fg(C.yellow) },
        { text: `[a nudge ${this.level === "auto" ? "it" : this.level} anyway]`, sgr: fg(C.cyan), action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "anyway" } }, sp,
        ...(s.can.includes("instead") ? [{ text: `[o ${s.instead}]`, sgr: fg(C.cyan), action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "instead" } }, sp] : []),
        ...(s.can.includes("clear") ? [{ text: `[c ${s.clear}]`, sgr: fg(C.cyan), action: "tune.nudge", args: { row: o.row, by: o.by, shadow: "clear" } }] : [])]);
    } else lines.push("");
    this.head = lines.length;
    const { values, sources } = this.values(t);
    // A level (or one width) picked: a column of what it says itself, beside the value in force.
    const picked = this.level !== "auto" || this.scope === "this";
    // Columns that fit the tile: the source gives way first (to 6), then the value (to 8), then the name.
    const ctl = 10, room0 = Math.max(0, w - ctl - 1), lvlW = picked ? 8 : 0;
    let valW = 12, nameW = Math.min(20, room0 - valW - lvlW - 8);
    if (nameW < 14) { valW = 8; nameW = Math.max(6, Math.min(20, room0 - valW - lvlW - 6)); }
    const room = Math.max(2, h - this.head - 2);
    // With a level (or a width) picked, a header names the columns: the value in force, what that level says itself, where the value in force comes from.
    if (picked) {
      const lv = this.level === "auto" ? "where set" : this.level;
      lines.push(fg(C.dark) + pad("", nameW) + pad("in force", valW) + fg(C.lcyan) + " " + pad(ellipsize(`${lv}${this.scope === "this" && t.look.breakpoint ? ` ${t.look.breakpoint}` : ""}`, lvlW - 2), lvlW - 1) + fg(C.dark) + "from" + RESET);
    }
    this.view.place(this.sel, TUNE_ROWS.length, picked ? room - 1 : room);
    for (let i = this.view.top; i < Math.min(TUNE_ROWS.length, this.view.top + (picked ? room - 1 : room)); i++) {
      const row = TUNE_ROWS[i]!, on = i === this.sel, last = row.tokens[row.tokens.length - 1]!;
      const text = row.tokens.map(tk => styleValueText(values[tk] as StyleValue)).join(" ");
      const shown = text === "" ? "(the hero)" : text;
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
      const srcW = Math.max(0, w - nameW - valW - lvlW - ctl - 1);
      const y = lines.length;
      const name = pad(ellipsize(row.name, nameW - 1), nameW), value = swatch && valW > 6 ? pad(ellipsize(shown, valW - 4), valW - 3) + " " + swatch + (on ? selected(focused) : "") : pad(ellipsize(shown, valW - 1), valW);
      const lvl = picked ? " " + pad(ellipsize(ownText, lvlW - 2), lvlW - 1) : "";
      const whence = shadow ? `⊘ ${shadow.why}` : `${tuned ? "● " : "← "}${sourceWords(src)}`;
      const ink = (c: number) => (on ? "" : fg(shadow ? C.dark : c));
      const body = (on ? selected(focused) : "") + fg(on ? C.white : shadow ? C.dark : C.grey) + name + ink(tuned ? C.yellow : C.white) + value + ink(C.lcyan) + lvl + (on ? "" : fg(shadow ? C.yellow : C.dark)) + pad(whence, srcW) + RESET;
      this.rowAt.set(y, { row: i, valueFrom: nameW, valueTo: nameW + valW });
      // × resets this row's value to what it inherits (tune.unset, as x); − and + nudge it.
      const unset = nameW + valW + lvlW + srcW + 1, minus = unset + 2;
      this.controls.push({ y, x: unset, cols: 1, action: "tune.unset", args: { row: row.name } }, { y, x: minus, cols: 3, action: "tune.nudge", args: { row: row.name, by: -1 } }, { y, x: minus + 4, cols: 3, action: "tune.nudge", args: { row: row.name, by: 1 } });
      lines.push(body + " " + fg(C.dark) + "×" + RESET + " " + fg(C.cyan) + "[−] [+]" + RESET);
    }
    // What the tile's look couldn't use (a value out of range, a style no note declares), then the help.
    const problems = t.look.problems;
    if (problems.length) lines.push(fg(C.yellow) + ellipsize(`⚠ ${problems.join(" · ")}`, w) + RESET);
    lines.push(fg(C.dark) + ellipsize(TUNE_HELP, w) + RESET);
    return { lines };
  }

  key(k: Key, desk: DeskApi): boolean {
    const c = ch(k);
    // A step waiting in place: its own key again confirms; any other lets it go (and esc is only that).
    if (this.armed) {
      const again = (c === "X" && this.armed.action === "tune.resetlevel") || (c === "R" && this.armed.action === "tune.revert");
      if (again) return this.run(desk, this.armed.action, { confirm: true }), true;
      this.armed = null; desk.redraw();
      if (k.kind === "esc") return true;
    }
    // A nudge held on a shadowed row: a, o or c chooses; anything else lets it go.
    if (this.offer) {
      const o = this.offer, choice: ShadowChoice | null = c === "a" ? "anyway" : c === "o" ? "instead" : c === "c" ? "clear" : null;
      if (choice && o.shadow.can.includes(choice)) return this.run(desk, "tune.nudge", { row: o.row, by: o.by, shadow: choice }), true;
      this.offer = null; desk.redraw();
      if (k.kind === "esc") return true;
    }
    if (isUp(k)) return this.run(desk, "tune.pick", { n: Math.max(1, this.sel) }), true;
    if (isDown(k)) return this.run(desk, "tune.pick", { n: Math.min(TUNE_ROWS.length, this.sel + 2) }), true;
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
    return false;
  }

  /** A click on a control runs its action; on a row picks it; the wheel over a value nudges it, elsewhere moves the pick. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    const at = this.rowAt.get(y);
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const up = k.action === "wheel-up";
      if (at && x >= at.valueFrom && x < at.valueTo) this.run(desk, "tune.nudge", { row: TUNE_ROWS[at.row]!.name, by: up ? 1 : -1 });
      else this.run(desk, "tune.pick", { n: Math.max(1, Math.min(TUNE_ROWS.length, this.sel + 1 + (up ? -1 : 1))) });
      return true;
    }
    if (k.action !== "down") return true;
    const c = this.controls.find(s => s.y === y && x >= s.x && x < s.x + s.cols);
    if (c) { this.run(desk, c.action, c.args); return true; }
    if (at) { this.view.press(at.row, press ?? {}); this.run(desk, "tune.pick", { n: at.row + 1 }); }
    return true;
  }

  run(desk: DeskApi, name: string, args: Record<string, unknown>) { runOwn(TUNE_ACTIONS, name, args, { pane: this, desk }); }

  /**
   * What `peek` and `act` read: the tile tuned, its width, every value with its source (and, with a level or a width
   * picked, what that level says itself and whether something nearer wins), the unsaved nudges, a held offer, a step
   * waiting for its confirmation.
   */
  describe(desk?: DeskApi) {
    const t = desk ? this.info(desk) : null;
    const tuning = desk ? tuningOf(desk.ctx.board) : null;
    if (!t) return { tile: this.source, level: this.level, scope: this.scope, found: false };
    const { values, sources } = this.values(t);
    const picked = this.level !== "auto" || this.scope === "this";
    return {
      tile: this.source, kind: t.kind, cols: t.cols, breakpoint: t.look.breakpoint, level: this.level, scope: this.scope, ...(t.box ? { box: t.box } : {}),
      selected: TUNE_ROWS[this.sel]!.name,
      values: Object.fromEntries((Object.keys(STYLE_TOKENS) as StyleToken[]).map(tk => {
        const a = picked ? this.aimAt(t, tk) : null, own = a ? this.ownValue(t, tk) : null, sh = picked ? this.shadowOf(t, tk) : null;
        return [tk, {
          value: styleValueText(values[tk] as StyleValue), from: sourceWords(sources[tk]), ...(sources[tk].block ? { note: sources[tk].block } : {}),
          ...(a ? { at: { level: targetWords(a.target), ...(a.variant ? { width: a.variant } : {}), value: own === UNSET ? "taken away" : own } } : {}),
          ...(sh ? { overridden: sh.why } : {}),
        }];
      })),
      unsaved: tuning?.unsaved() ?? [], problems: t.look.problems,
      ...(this.offer ? { offer: { row: this.offer.row, why: this.offer.shadow.why, choices: this.offer.shadow.can } } : {}),
      ...(this.armed ? { armed: this.armed } : {}),
    };
  }
}

/** A tune tile's actions: the row picked, a nudge, a value set outright, the level and width a nudge targets, save, the history, resets and revert. */
export interface TuneOn { pane: TunePane; desk: DeskApi }

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
    if (tokens.length) return () => { if (t.list?.revision !== undefined && !tuning.listSeen.has(target)) tuning.listSeen.set(target, t.list.revision); tuning.set(target, field, UNSET, actor, at); };
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

/** The step words for the status line and the result. */
const stepSaid = (actor: Actor, desk: DeskApi, words: string) => { desk.ctx.flash(says(actor, words)); return words; };

export const TUNE_ACTIONS = actionSet<TuneOn>()("tune", {
  "tune.pick": def({
    summary: "pick a row of the tune inspector (n from 1, as peek lists them)",
    keys: "j k ↑ ↓, a click on a row, the wheel off the values",
    touches: "tile", replay: "safe",
    args: { n: { type: "number", about: "the row, from 1" } },
    run({ n }, { pane, desk }) {
      if (!Number.isInteger(n) || n < 1 || n > TUNE_ROWS.length) throw new ActionRefused(`n is 1-${TUNE_ROWS.length}`);
      pane.sel = n - 1;
      desk.redraw();
      return { row: TUNE_ROWS[pane.sel]!.name };
    },
  }),
  "tune.nudge": def({
    summary: "nudge a look value by steps (by=1 or -1): a number by its step (columns by 2, rows by 1: cells are twice as tall as wide; pad and margin move a row and two columns), on/off flipped, a choice to the next, header.image through the note's pictures. It draws in the next frame, from memory; s saves it. level= and width= (all, or this: the breakpoint the tile is in now) default to the inspector's. Where something nearer wins over the level (or the width) it writes, it asks first: shadow=anyway (nudge it; it shows only where nothing nearer sets it), shadow=instead (nudge what wins), shadow=clear (take what wins away, then nudge)",
    keys: "+ − (= l → and - h ←), a click on [−] [+], the wheel over a value; on a row that asks: a, o, c, or a click on a choice",
    touches: "nothing", replay: "ask", says: out => (out.offered ? `· ${out.row}: ${out.why}` : `· ${out.row} ${out.value} (${out.at})`),
    args: {
      by: { type: "number", about: "steps: 1 up, -1 down" },
      row: { type: "string", optional: true, about: "the row (measure, pad, pad.x, margin, list.gap, …); default the picked one" },
      level: { type: "string", optional: true, about: "global, tile, screen, page, instance (this tile) or list (this list); default the inspector's" },
      width: { type: "string", optional: true, about: "all, or this (the tile's breakpoint now); default the inspector's" },
      shadow: { type: "string", optional: true, about: "where something nearer wins: anyway, instead or clear" },
    },
    async run({ by, row, level, width, shadow }, { pane, desk }, actor) {
      const r = row === undefined ? TUNE_ROWS[pane.sel]! : rowNamed(row);
      if (!r) throw new ActionRefused(`row is one of ${TUNE_ROWS.map(x => x.name).join(", ")}`);
      if (level !== undefined && !TUNE_LEVELS.includes(level as TuneLevel)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      if (shadow !== undefined && !["anyway", "instead", "clear"].includes(shadow)) throw new ActionRefused("shadow is anyway, instead or clear");
      // The level and width it writes: the inspector's, or the ones asked for (an agent's never change the inspector's).
      const person = actor.kind !== "agent";
      let lv = (level ?? pane.level) as TuneLevel, sc: "all" | "this" = width === undefined ? pane.scope : width === "this" ? "this" : "all";
      if (person) { pane.level = lv; pane.scope = sc; }
      const tuning = tuningOf(desk.ctx.board);
      let t = fresh(pane, desk);
      const step = Math.sign(by) || 0, last = r.tokens[r.tokens.length - 1]!;
      // Where something nearer wins: ask before nudging blind (the person: in place; an agent: refused with its choices).
      const sh = pane.shadowOf(t, last, lv, sc);
      if (sh && !shadow) {
        const choices = sh.can.map(c => (c === "anyway" ? `shadow=anyway (it shows only where nothing nearer sets it)` : c === "instead" ? `shadow=instead (${sh.instead})` : `shadow=clear (${sh.clear})`)).join(", ");
        if (actor.kind === "agent") throw new ActionRefused(`${r.name}: ${sh.why}: ${choices}`);
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
        const next = tk === "header.image" ? stepPicture(from as string, t.pictures ?? [], step) : nudgeStyleValue(tk, from as StyleValue, step);
        listOnly(a.target, a.field, t, tuning);
        tuning.set(a.target, a.field, styleValueText(next), actor);
        shown.push(styleValueText(next));
        at = `${targetWords(a.target)}${a.variant ? `, ${a.variant} only` : ""}`;
      }
      desk.redraw();
      if (actor.kind === "agent") desk.ctx.flash(says(actor, `tuned ${r.name} to ${shown.join(" ")} (${at}) · s saves`));
      return { row: r.name, value: shown.join(" "), at, unsaved: tuning.unsavedCount(), ...(shadow ? { shadow } : {}) };
    },
  }),
  "tune.set": def({
    summary: "set a look value outright, as a nudge does (in memory until saved): row= a token, value= as a style note writes it (88, on, dots, \"1 0 1\")",
    keys: "`ep0ch act tune.set row=measure value=72`",
    touches: "nothing", replay: "ask", says: out => `· ${out.row} ${out.value}`,
    args: {
      row: { type: "string", about: "a token (measure, pad.x, list.gap, …)" },
      value: { type: "string", about: "its value" },
      level: { type: "string", optional: true, about: "global, tile, screen, page, instance (this tile) or list (this list); default the inspector's" },
      width: { type: "string", optional: true, about: "all, or this; default the inspector's" },
    },
    run({ row, value, level, width }, { pane, desk }, actor) {
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
      if (actor.kind === "agent") desk.ctx.flash(says(actor, `set ${tk} to ${styleValueText(ok.value)} (${targetWords(a.target)}) · s saves`));
      return { row: tk, value: styleValueText(ok.value), at: targetWords(a.target) };
    },
  }),
  "tune.unset": def({
    summary: "reset a row's value to what it inherits: what sets it here is taken away (a width variant first, then its plain value), off the note that wrote it (in memory until s, the save removing the property), or, set only by a nudge, the nudge let go. A built-in, a box's or a heading style's is edited where it's written; one a shorthand or a tier gives is refused, naming the note",
    keys: "x, a click on a row's × or on [reset value]",
    touches: "nothing", replay: "ask", says: out => `· ${out.row} ${out.value} (${out.from})`,
    args: { row: { type: "string", optional: true, about: "the row (measure, pad, bg, list.divider, …); default the picked one" } },
    async run({ row }, { pane, desk }, actor) {
      const r = row === undefined ? TUNE_ROWS[pane.sel]! : rowNamed(row);
      if (!r) throw new ActionRefused(`row is one of ${TUNE_ROWS.map(x => x.name).join(", ")}`);
      const t = fresh(pane, desk);
      // Decided for every token before any is changed: a pair (pad) is reset whole or not at all.
      const plan: (() => void)[] = [];
      for (const tk of r.tokens) plan.push(await takeAway(pane, desk, t, tk, pane.values(t).sources[tk], actor));
      for (const f of plan) f();
      if (actor.kind !== "agent") pane.offer = null;
      desk.redraw();
      // What shows now, resolved again (the tile's look as drawn is the frame before this one).
      const now = pane.values(fresh(pane, desk)), last = r.tokens[r.tokens.length - 1]!;
      const value = r.tokens.map(tk => styleValueText(now.values[tk] as StyleValue)).join(" "), from = sourceWords(now.sources[last]);
      if (actor.kind === "agent") desk.ctx.flash(says(actor, `reset ${r.name} to ${value} (${from}) · s saves`));
      return { row: r.name, value, from, unsaved: tuningOf(desk.ctx.board).unsavedCount() };
    },
  }),
  "tune.level": def({
    summary: "the level a nudge goes to: auto (where the value comes from, its width variant too: a named style, the page, the tile's kind…; the tile's kind for a built-in), or global, tile (its kind), screen, page (the note it shows), instance (this tile alone, kept in its tile spec) or list (the list the reader's [ ] is in, on its lead-in line or its section's heading). Picked, each row shows what that level says itself, and a row where something nearer wins is marked",
    keys: "v, a click on a level",
    touches: "tile", replay: "safe",
    args: { level: { type: "string", about: "auto, global, tile, screen, page, instance (this tile) or list (this list)" } },
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
    async run({ level }, { pane, desk }, actor) {
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
    async run(_, { pane, desk }, actor) {
      const tuning = tuningOf(desk.ctx.board), s = refuse(() => tuning.nextUndo(actor));
      if (!s) throw new ActionRefused("nothing to take back");
      if (s.kind === "write") await refuseAsync(() => rewrite(board(desk), tuning, s.writes, true, actor, desk.tileLooks));
      tuning.undone(s);
      if (actor.kind !== "agent") { pane.offer = null; pane.armed = null; }
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
    async run(_, { pane, desk }, actor) {
      const tuning = tuningOf(desk.ctx.board), s = refuse(() => tuning.nextRedo(actor));
      if (!s) throw new ActionRefused("nothing to redo");
      if (s.kind === "write") await refuseAsync(() => rewrite(board(desk), tuning, s.writes, false, actor, desk.tileLooks));
      tuning.redone(s);
      if (actor.kind !== "agent") { pane.offer = null; pane.armed = null; }
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
    async run({ confirm }, { pane, desk }, actor) {
      const t = pane.info(desk);
      if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
      if (pane.level === "auto") throw new ActionRefused("pick the level to reset first (v, or tune.level): global, tile, screen, page, instance (this tile) or list (this list)");
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
        if (actor.kind === "agent") return { armed: true, words, confirm: "send confirm=true to do it" };
        pane.armed = { action: "tune.resetlevel", words, target }; pane.offer = null;
        desk.ctx.flash(`${words} · X again or [confirm] to do it`);
        desk.redraw();
        return { armed: true, words };
      }
      if (actor.kind !== "agent") pane.armed = null;
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
  "tune.revert": def({
    summary: "revert all: every style note this session wrote put back as it was before the first write (saved changes too), one attributed write each, and every nudge let go; refused, naming the note, when one changed since (another door or an agent). It asks in place first: confirm=true (or R again, or [confirm]) does it. One step: u takes it back",
    keys: "R then R, a click on [revert all] then [confirm]",
    touches: "nothing", replay: "ask", says: out => (out.armed ? `· ${out.words}: confirm` : `· reverted ${out.notes.length} notes`),
    args: { confirm: { type: "boolean", optional: true, about: "do it (without: it asks)" } },
    async run({ confirm }, { pane, desk }, actor) {
      const tuning = tuningOf(desk.ctx.board), notes = tuning.baseline.size, nudges = tuning.unsavedCount();
      if (!notes && !nudges) throw new ActionRefused("nothing changed this session: no style note written, no nudge");
      const words = `revert all: ${notes} style note${notes === 1 ? "" : "s"} back as they were when this session started${nudges ? `, ${nudges} nudge${nudges === 1 ? "" : "s"} let go` : ""}`;
      if (!confirm) {
        if (actor.kind === "agent") return { armed: true, words, confirm: "send confirm=true to do it", notes: [] as string[] };
        pane.armed = { action: "tune.revert", words }; pane.offer = null;
        desk.ctx.flash(`${words} · R again or [confirm] to do it`);
        desk.redraw();
        return { armed: true, words, notes: [] as string[] };
      }
      if (actor.kind !== "agent") pane.armed = null;
      const before = tuning.snapshot(), writes: NoteWrite[] = [];
      try { await refuseAsync(() => revertAll(board(desk), tuning, actor, writes, desk.tileLooks)); tuning.clear(); }
      finally { if (writes.length) tuning.record({ kind: "write", what: "revert of the session", writes, tuningBefore: before, tuningAfter: tuning.snapshot(), by: actor }); }
      desk.redraw();
      desk.ctx.flash(says(actor, `${words} · u takes it back`));
      return { reverted: true, notes: writes.map(w => w.note) };
    },
  }),
  "tune.aim": def({
    summary: "point the tune inspector at another tile on this screen",
    touches: "tile", replay: "safe",
    args: { tile: { type: "string", about: "the tile's name" } },
    run({ tile }, { pane, desk }) {
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

/** The next of the header's pictures by `by`: the hero (empty) first, then the note's pictures in order. */
function stepPicture(now: string, pictures: readonly string[], by: number): string {
  const all = ["", ...pictures.filter((p, i) => p && pictures.indexOf(p) === i)];
  if (all.length < 2 || by === 0) return now;
  const i = all.indexOf(now);
  return all[i < 0 ? (by > 0 ? 1 : all.length - 1) : (((i + by) % all.length) + all.length) % all.length]!;
}

