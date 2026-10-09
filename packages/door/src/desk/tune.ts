// The tune inspector (PIE-673): a tile beside the one it tunes, like devtools' computed styles. It lists the look's
// values for that tile (or, in a reader, the `::box` its `[ ]` is in), each with where it comes from, and nudges them:
// a nudge goes into the connection's tuning (src/look.ts), in memory, and the tiles draw with it in the next frame,
// nothing read from the outline. `s` writes the nudges to the level picked (global, the tile's kind, the screen, the
// page), attributed and checked against the revision it read; `u` takes one back; `x` lets them go. A nudge can be for
// every width or for the width the tile is in now (its breakpoint's variant), so how a narrow tile feels is tuned
// apart from a wide one.
//
// Every key and click is an action (TUNE_ACTIONS), so an agent tunes the same way, said on the screen and never with
// the person's keys.
import {
  fieldKey, nudgeStyleValue, parseStyleValue, SAVE_LEVELS, STYLE_TOKENS, styleValueText, type Breakpoint, type SaveLevel, type StyleSource,
  type StyleToken, type StyleValue, parseStyleAttrs, resolveStyle,
} from "@ep0ch/outline-core/style-cascade";
import { saveTuning, sourceTarget, targetWords, tuneTarget, tuningOf, type Look, type TuneTarget } from "../look";
import { USER, type Actor } from "../socket";
import { ActionRefused, actionSet, agentLabel, def } from "../surface/actions";
import { C, chip, ellipsize, fg, pad, RESET, selected, width } from "../style";
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
  { name: "list.divider", tokens: ["list.divider"] },
  { name: "heading.margin", tokens: ["heading.margin"] },
  { name: "heading.padding", tokens: ["heading.padding"] },
  { name: "bp.narrow", tokens: ["bp.narrow"] },
  { name: "bp.wide", tokens: ["bp.wide"] },
];
const rowNamed = (name: string) => TUNE_ROWS.find(r => r.name === name.trim().toLowerCase());

/** What the inspector sees of the tile it tunes (DeskApi.tileLook). */
export interface TuneTargetInfo { look: Look; kind: string; title: string; cols: number; box: { attrs: string; line: number } | null }

/** Where a value came from, in a few words: `tile detail`, `page · tuning`, `built-in`, with its width variant. */
export const sourceWords = (s: StyleSource) => `${s.label}${s.variant ? ` · ${s.variant}` : ""}`;
/** The width the tile is in, in words. */
function widthWords(look: Look): string {
  const v = look.values;
  return look.breakpoint === "narrow" ? `narrow (under ${v["bp.narrow"]})` : look.breakpoint === "wide" ? `wide (${v["bp.wide"]} and up)` : `normal (${v["bp.narrow"]}–${v["bp.wide"] - 1})`;
}

/** The help line under the rows: the door's own selection copies the text; a terminal's own copies the spacing as spaces. */
export const TUNE_HELP = "copy with the door's own selection (a drag; it copies the text over OSC 52): a terminal's shift-drag or copy-mode copies the spacing as spaces and blank lines";

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
  private view = new RowView();
  private head = 0;
  private controls: { y: number; x: number; cols: number; action: string; args: Record<string, unknown> }[] = [];
  /** The rows' screen lines as last drawn: the row each is, or the value cell a wheel nudges. */
  private rowAt = new Map<number, { row: number; valueFrom: number; valueTo: number }>();
  /** `source`: the tile it tunes, by name (re-resolved each frame: ADR 0001, a role). */
  constructor(public source: string) {}

  title() { return `tune · ${this.source}`; }
  hint() { return "j k pick · + − nudge · tab level · w width · s save · u undo · x reset"; }
  spec() { return { source: `tile:${this.source}` }; }

  info(desk: DeskApi): TuneTargetInfo | null { return desk.tileLook?.(this.source) ?? null; }

  /** The look a nudge is measured from: the tile's, or the box's in a reader. */
  values(t: TuneTargetInfo) {
    if (!t.box) return { values: t.look.values, sources: t.look.sources };
    const r = resolveStyle([...t.look.layers, { level: "block", label: "box", fields: parseStyleAttrs(t.box.attrs).fields }], t.cols);
    return { values: r.values, sources: r.sources };
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
    put([{ text: `${t.kind}${t.title !== t.kind ? ` ${t.title}` : ""} · ${t.cols} cols · `, sgr: fg(C.grey) }, { text: widthWords(t.look), sgr: fg(C.lcyan) }, ...(t.box ? [{ text: " · in a box", sgr: fg(C.yellow) }] : [])]);
    // The levels a save goes to; the one picked lit. A level this tile hasn't (no page shown) is dim.
    put([{ text: "nudge ", sgr: fg(C.dark) }, ...TUNE_LEVELS.flatMap(l => {
      const target = l === "auto" ? null : tuneTarget(l, t.look.place), on = l === this.level;
      return [{ text: ` ${l === "auto" ? "where it's set" : target ? targetWords(target) : l} `, sgr: on ? chip(C.blue) : fg(l === "auto" || target ? C.cyan : C.dark), action: "tune.level", args: { level: l } }, { text: " ", sgr: "" }];
    })]);
    put([
      { text: this.scope === "all" ? " all widths " : ` ${t.look.breakpoint ?? "normal"} only `, sgr: chip(this.scope === "all" ? C.dark : C.magenta), action: "tune.width", args: { scope: this.scope === "all" ? "this" : "all" } },
      { text: " ", sgr: "" },
      { text: "[save]", sgr: fg(unsaved ? C.lgreen : C.dark), action: "tune.save" }, { text: " ", sgr: "" },
      { text: "[undo]", sgr: fg(C.cyan), action: "tune.undo" }, { text: " ", sgr: "" },
      { text: "[reset]", sgr: fg(C.cyan), action: "tune.reset" },
      ...(unsaved ? [{ text: ` · ${unsaved} unsaved, s to save`, sgr: fg(C.yellow) }] : []),
    ]);
    lines.push("");
    this.head = lines.length;
    const { values, sources } = this.values(t);
    const nameW = 16, valW = 9, ctl = 8;
    const room = Math.max(1, h - this.head - 2);
    this.view.place(this.sel, TUNE_ROWS.length, room);
    for (let i = this.view.top; i < Math.min(TUNE_ROWS.length, this.view.top + room); i++) {
      const row = TUNE_ROWS[i]!, on = i === this.sel;
      const shown = row.tokens.map(tk => styleValueText(values[tk] as StyleValue)).join(" ");
      const src = sources[row.tokens[row.tokens.length - 1]!];
      const tuned = src.label.endsWith("tuning");
      const srcW = Math.max(0, w - nameW - valW - ctl - 1);
      const y = lines.length;
      const name = pad(row.name, nameW), value = pad(shown, valW);
      const body = (on ? selected(focused) : "") + fg(on ? C.white : C.grey) + name + (on ? "" : fg(tuned ? C.yellow : C.white)) + value + (on ? "" : fg(C.dark)) + pad(`${tuned ? "● " : "← "}${sourceWords(src)}`, srcW) + RESET;
      this.rowAt.set(y, { row: i, valueFrom: nameW, valueTo: nameW + valW });
      const minus = nameW + valW + srcW + 1;
      this.controls.push({ y, x: minus, cols: 3, action: "tune.nudge", args: { row: row.name, by: -1 } }, { y, x: minus + 4, cols: 3, action: "tune.nudge", args: { row: row.name, by: 1 } });
      lines.push(body + " " + fg(C.cyan) + "[−] [+]" + RESET);
    }
    // What the tile's look couldn't use (a value out of range, a style no note declares), then the help.
    const problems = t.look.problems;
    if (problems.length) lines.push(fg(C.yellow) + ellipsize(`⚠ ${problems.join(" · ")}`, w) + RESET);
    lines.push(fg(C.dark) + ellipsize(TUNE_HELP, w) + RESET);
    return { lines };
  }

  key(k: Key, desk: DeskApi): boolean {
    const c = ch(k);
    if (isUp(k)) return this.run(desk, "tune.pick", { n: Math.max(1, this.sel) }), true;
    if (isDown(k)) return this.run(desk, "tune.pick", { n: Math.min(TUNE_ROWS.length, this.sel + 2) }), true;
    if (c === "+" || c === "=" || c === "l" || k.kind === "right") return this.run(desk, "tune.nudge", { by: 1 }), true;
    if (c === "-" || c === "_" || c === "h" || k.kind === "left") return this.run(desk, "tune.nudge", { by: -1 }), true;
    if (k.kind === "tab") return this.run(desk, "tune.level", { level: TUNE_LEVELS[(TUNE_LEVELS.indexOf(this.level) + 1) % TUNE_LEVELS.length] }), true;
    if (c === "w") return this.run(desk, "tune.width", { scope: this.scope === "all" ? "this" : "all" }), true;
    if (c === "s") return this.run(desk, "tune.save", {}), true;
    if (c === "u") return this.run(desk, "tune.undo", {}), true;
    if (c === "x") return this.run(desk, "tune.reset", {}), true;
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

  /** What `peek` and `act` read: the tile tuned, its width, every value with its source, and the unsaved nudges. */
  describe(desk?: DeskApi) {
    const t = desk ? this.info(desk) : null;
    const tuning = desk ? tuningOf(desk.ctx.board) : null;
    if (!t) return { tile: this.source, level: this.level, scope: this.scope, found: false };
    const { values, sources } = this.values(t);
    return {
      tile: this.source, kind: t.kind, cols: t.cols, breakpoint: t.look.breakpoint, level: this.level, scope: this.scope, ...(t.box ? { box: t.box } : {}),
      selected: TUNE_ROWS[this.sel]!.name,
      values: Object.fromEntries((Object.keys(STYLE_TOKENS) as StyleToken[]).map(tk => [tk, { value: styleValueText(values[tk] as StyleValue), from: sourceWords(sources[tk]), ...(sources[tk].block ? { note: sources[tk].block } : {}) }])),
      unsaved: tuning?.unsaved() ?? [], problems: t.look.problems,
    };
  }
}

/** A tune tile's actions: the row picked, a nudge, a value set outright, the level and width a nudge targets, save, undo, reset. */
export interface TuneOn { pane: TunePane; desk: DeskApi }

/**
 * The target and field a nudge of `token` writes for the tile now. `auto`: where the value comes from, its width variant
 * too (else the tile's kind); a level picked: that level, for every width unless `scope` is this. Why not, refused.
 */
function aim(pane: TunePane, desk: DeskApi, token: StyleToken, level: TuneLevel, scope: "all" | "this"): { target: TuneTarget; field: string; t: TuneTargetInfo; variant: Breakpoint | null; shadowed: string | null } {
  const t = pane.info(desk);
  if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
  const src = pane.values(t).sources[token];
  const from = level === "auto" ? sourceTarget(src, t.look.place) : null;
  const target = from ?? tuneTarget(level === "auto" ? "tile" : level, t.look.place);
  if (!target) throw new ActionRefused(level === "page" ? `${pane.source} shows no note: pick tile, screen or global (tune.level)` : `${pane.source} has no ${level} level`);
  const varies = !token.startsWith("bp.");
  const variant = !varies ? null : scope === "this" ? t.look.breakpoint : from ? (src.variant ?? null) : null;
  // A level picked below the one the value comes from: it's kept, and shows only where that level says nothing.
  const order = ["base", "component", "global", "tile", "screen", "page", "block"];
  const at = level === "auto" ? null : order.indexOf(level), wins = order.indexOf(src.level);
  const shadowed = at !== null && wins > at && src.level !== "block" ? `${sourceWords(src)} sets ${token} and wins over ${level}` : null;
  return { target, field: fieldKey(token, variant), t, variant, shadowed };
}

const says = (actor: Actor, did: string) => (actor.kind === "agent" ? `${agentLabel(actor)} ${did}` : did);

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
    summary: "nudge a look value by steps (by=1 or -1): a number by its step (columns by 2, rows by 1: cells are twice as tall as wide; pad and margin move a row and two columns), on/off flipped, a choice to the next. It draws in the next frame, from memory; s saves it. level= and width= (all, or this: the breakpoint the tile is in now) default to the inspector's",
    keys: "+ − (= l → and - h ←), a click on [−] [+], the wheel over a value",
    touches: "nothing", replay: "ask", says: out => `· ${out.row} ${out.value} (${out.at})`,
    args: {
      by: { type: "number", about: "steps: 1 up, -1 down" },
      row: { type: "string", optional: true, about: "the row (measure, pad, pad.x, margin, list.gap, …); default the picked one" },
      level: { type: "string", optional: true, about: "global, tile, screen or page; default the inspector's" },
      width: { type: "string", optional: true, about: "all, or this (the tile's breakpoint now); default the inspector's" },
    },
    run({ by, row, level, width }, { pane, desk }, actor) {
      const r = row === undefined ? TUNE_ROWS[pane.sel]! : rowNamed(row);
      if (!r) throw new ActionRefused(`row is one of ${TUNE_ROWS.map(x => x.name).join(", ")}`);
      const lv = (level ?? pane.level) as TuneLevel;
      if (!TUNE_LEVELS.includes(lv)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      const scope = (width ?? pane.scope) === "this" ? "this" : "all";
      const tuning = tuningOf(desk.ctx.board);
      let at = "";
      const t0 = pane.info(desk);
      if (!t0) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
      const { values } = pane.values(t0);
      const shown: string[] = [];
      let shadowed: string | null = null;
      for (const tk of r.tokens) {
        const a = aim(pane, desk, tk, lv, scope);
        const next = nudgeStyleValue(tk, values[tk] as StyleValue, Math.sign(by) || 0);
        tuning.set(a.target, a.field, styleValueText(next), actor);
        shown.push(styleValueText(next));
        at = `${targetWords(a.target)}${a.variant ? `, ${a.variant} only` : ""}`;
        shadowed ??= a.shadowed;
      }
      if (shadowed) desk.ctx.flash(`${shadowed}: tab to "where it's set" to change what shows`);
      desk.redraw();
      if (actor.kind === "agent") desk.ctx.flash(says(actor, `tuned ${r.name} to ${shown.join(" ")} (${at}) · s saves`));
      return { row: r.name, value: shown.join(" "), at, unsaved: tuning.unsavedCount() };
    },
  }),
  "tune.set": def({
    summary: "set a look value outright, as a nudge does (in memory until saved): row= a token, value= as a style note writes it (88, on, dots, \"1 0 1\")",
    keys: "`ep0ch act tune.set row=measure value=72`",
    touches: "nothing", replay: "ask", says: out => `· ${out.row} ${out.value}`,
    args: {
      row: { type: "string", about: "a token (measure, pad.x, list.gap, …)" },
      value: { type: "string", about: "its value" },
      level: { type: "string", optional: true, about: "global, tile, screen or page; default the inspector's" },
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
      const a = aim(pane, desk, tk, lv, (width ?? pane.scope) === "this" ? "this" : "all");
      tuningOf(desk.ctx.board).set(a.target, a.field, styleValueText(ok.value), actor);
      desk.redraw();
      if (actor.kind === "agent") desk.ctx.flash(says(actor, `set ${tk} to ${styleValueText(ok.value)} (${targetWords(a.target)}) · s saves`));
      return { row: tk, value: styleValueText(ok.value), at: targetWords(a.target) };
    },
  }),
  "tune.level": def({
    summary: "the level a nudge goes to: auto (where the value comes from, its width variant too: a named style, the page, the tile's kind…; the tile's kind for a built-in), or global, tile (its kind), screen, or page (the note it shows)",
    keys: "tab, a click on a level",
    touches: "tile", replay: "safe",
    args: { level: { type: "string", about: "auto, global, tile, screen or page" } },
    run({ level }, { pane, desk }) {
      if (!TUNE_LEVELS.includes(level as TuneLevel)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      pane.level = level as TuneLevel;
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
      const bp = pane.info(desk)?.look.breakpoint ?? null;
      if (scope === "this" && !bp) desk.ctx.flash("between the breakpoints a nudge is for every width: narrow or widen the tile for its own");
      desk.redraw();
      return { scope, breakpoint: bp };
    },
  }),
  "tune.save": def({
    summary: "write the nudges to the outline: every level's this tile has (auto), or the level picked's: a page's onto its note, a named style's or a level's onto its style note (a new one when it has none, under the outline's Looks note); attributed, checked against the revision it read",
    keys: "s, a click on [save]",
    touches: "nothing", replay: "ask", says: out => (out.saved ? `· saved ${out.fields} to ${out.at}` : "· nothing to save there"),
    args: { level: { type: "string", optional: true, about: "auto, global, tile, screen or page; default the inspector's" } },
    async run({ level }, { pane, desk }, actor) {
      const lv = (level ?? pane.level) as TuneLevel;
      if (!TUNE_LEVELS.includes(lv)) throw new ActionRefused(`level is ${TUNE_LEVELS.join(", ")}`);
      const t = pane.info(desk);
      if (!t) throw new ActionRefused(`tile ${pane.source} isn't on this screen`);
      const tuning = tuningOf(desk.ctx.board), place = t.look.place;
      // auto: each target this tile's look reads (global, its kind, its screen, its page and the style it names).
      const named = place.page?.properties.find(p => p.key.toLowerCase() === "style")?.value.trim().toLowerCase();
      const reads = new Set([...SAVE_LEVELS.map(l => tuneTarget(l, place)), named].filter((x): x is string => !!x));
      const targets = lv === "auto" ? tuning.unsaved().map(u => u.target).filter(x => reads.has(x)) : [tuneTarget(lv, place)].filter((x): x is string => !!x);
      if (lv !== "auto" && !targets.length) throw new ActionRefused(`${pane.source} has no ${lv} level`);
      const done: { at: string; fields: string[]; created: boolean; note: string }[] = [];
      for (const target of targets) {
        const r = await saveTuning({ board: desk.ctx.board, redraw: () => desk.redraw() } as Parameters<typeof saveTuning>[0], target, actor);
        if (r) done.push({ at: targetWords(target), fields: r.fields, created: r.created, note: r.note });
      }
      desk.redraw();
      if (!done.length) return { saved: false, at: lv === "auto" ? "nothing unsaved" : targetWords(targets[0]!) };
      const words = done.map(d => `${d.fields.join(" ")} to ${d.at}${d.created ? " (a new style note)" : ""}`).join("; ");
      desk.ctx.flash(says(actor, `saved ${words}`));
      return { saved: true, at: done.map(d => d.at).join(", "), fields: done.flatMap(d => d.fields).join(" "), notes: done.map(d => d.note), created: done.some(d => d.created) };
    },
  }),
  "tune.undo": def({
    summary: "take back the last nudge (an agent's: its own last)",
    keys: "u, a click on [undo]",
    touches: "nothing", replay: "ask",
    args: {},
    run(_, { desk }, actor) {
      const u = tuningOf(desk.ctx.board).undo(actor);
      if (!u) throw new ActionRefused("nothing to take back");
      desk.redraw();
      return { undone: u.field, at: targetWords(u.target) };
    },
  }),
  "tune.reset": def({
    summary: "let go of the nudges: the level picked's, or every level's (all=true, or the level is auto): the outline's values stand again",
    keys: "x, a click on [reset]",
    touches: "nothing", replay: "ask",
    args: { all: { type: "boolean", optional: true, about: "every level's" } },
    run({ all }, { pane, desk }) {
      const t = pane.info(desk), tuning = tuningOf(desk.ctx.board);
      const target = t && pane.level !== "auto" ? tuneTarget(pane.level, t.look.place) : null;
      if (all || pane.level === "auto") tuning.clear(); else if (target) tuning.clear(target);
      desk.redraw();
      return { reset: all || pane.level === "auto" ? "every level" : target ? targetWords(target) : "nothing" };
    },
  }),
  "tune.aim": def({
    summary: "point the tune inspector at another tile on this screen",
    touches: "tile", replay: "safe",
    args: { tile: { type: "string", about: "the tile's name" } },
    run({ tile }, { pane, desk }) {
      if (!desk.tileLook?.(tile)) throw new ActionRefused(`no tile ${tile} drawn on this screen`);
      pane.source = tile;
      desk.redraw();
      return { tile };
    },
  }),
});

