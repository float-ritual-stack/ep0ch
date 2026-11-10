// The settings card (PIE-786): a configurable note (a rule note, a saved view, a callout type, a heading style, any
// component an extension declares with a declaring note) drawn as a card of its fields instead of a line of
// `[key::value]` soup. The fields are its component schema's (outline-core component-schema.ts, the service's merged
// `components.schemas`), never a list here: a note is configurable when it carries a schema's declaring property
// (`source.note.name`: `rule-name`, `query`, `callout-type`, `heading-style`). Each field's picker is a question in the
// power bar (src/bar/ask.ts) built from its type: an enum's values, a query built over the outline's own properties
// and values (`properties.catalog`), a note found by search, the actions extensions offer, the writers a rule hears, a
// duration, a property's name. A view's schema declares toggle and ordered questions over its matched facets. The
// binding owner writes the note header or inline view's source. The card is a face of the property panel (`panel` mode): it draws here and turns
// keys into intents; the surface runs the `settings.*` actions.
import { checkValue as schemaCheck, settingsSchemas, type ComponentSchema, type PropSchema } from "@ep0ch/outline-core/component-schema";
export { settingsSchemas } from "@ep0ch/outline-core/component-schema";
import { isWritablePropertyValue } from "@ep0ch/outline-core/property-grammar";
import { missingPropertyHint } from "@ep0ch/outline-core/property-hint";
import type { BarQuestion, BarSuggestion } from "../bar/ask";
import { printable } from "../props";
import { RowView } from "../scroll";
import { selectedRow, C, drawEllipsized, fg, pad, RESET, width } from "../style";
import { rowLines, rule } from "../text";
import { type AttachedPlace, type FloatRect } from "./attached";
import { modeHint } from "./modes";
import { SETTINGS_KEYS } from "./attached-keys";
import { isBlockId } from "@ep0ch/outline-core/addressable-resource";
import type { ExtensionCardField } from "../extension-settings";
import type { LineField } from "./line";
import type { DraftSession } from "../draft-session";


/**
 * One field of the card: a property a schema says the declaring note takes, its value on the note (null: unset), and
 * the section it's in (the index of its schema among the note's).
 */
export interface SettingField { n: number; prop: PropSchema; value: string | null; section: number; order?: PropSchema;
  /** An extension's setting (PIE-1709): its state as the service says it (set, its default, unset, missing), and its try. */
  ext?: ExtensionCardField }

/** A value being typed in the card, in place (PIE-1709): an extension's setting, one line in the shared editor. */
export interface CardEdit { key: string; input: LineField; session: DraftSession }

/** A note's block properties, as the card reads them. */
type Props = readonly { key: string; value: string }[];

/**
 * The schemas a note is configured by, in the list's order (the built-ins, then the extensions'): each whose declaring
 * property (`source.note.name`) the note carries, with the others it `requires` (a view with `[echo::]` is a view and an
 * EchoNet area; a plain note with `[echo::]` is a posting, no area).
 */
/** The first schema a note is configured by, or null. */
export const settingsSchema = (schemas: readonly ComponentSchema[], props: Props): ComponentSchema | null => settingsSchemas(schemas, props)[0] ?? null;

/**
 * The card's fields, a section per schema: in each, the declaring property first, then the note's other properties in
 * that schema's order. A key two schemas both take is the first one's field (one property, one field). `where` is the
 * place the fields are written: a note's header (`note`), or a figure's YAML (`yaml`, PIE-1513).
 */
export function settingFields(schemas: ComponentSchema | readonly ComponentSchema[], props: Props, where: PropSchema["where"] = "note"): SettingField[] {
  const list: readonly ComponentSchema[] = Array.isArray(schemas) ? schemas : [schemas as ComponentSchema];
  const out: SettingField[] = [], seen = new Set<string>();
  list.forEach((schema, section) => {
    const name = schema.source.note?.name;
    const own = schema.props.filter(p => p.where === where && !seen.has(p.key));
    for (const prop of [...own.filter(p => p.key === name), ...own.filter(p => p.key !== name)]) {
      seen.add(prop.key);
      out.push({ n: out.length + 1, prop, order: schema.props.find(p => p.key === prop.question?.order), value: props.find(p => p.key.toLowerCase() === prop.key.toLowerCase())?.value ?? null, section });
    }
  });
  return out;
}

/** Why `value` can't be written to `field`: the schema's own check, then the property grammar's (one line, balanced brackets). */
export function settingProblem(field: SettingField, value: string): string | null {
  const v = value.trim();
  if (!v) return `${field.prop.key} can't be empty · x clears it`;
  if (!isWritablePropertyValue(v)) return "a property value is one line with balanced brackets (a link such as ((id)) is fine)";
  return schemaCheck(field.prop, v);
}

/** What the pickers read: the outline's properties and values, the actions extensions offer, the extensions installed. */
export interface SettingSources {
  facets?(): readonly { key: string; count: number }[];
  facet?(key: string): Promise<{ key: string; count: number } | undefined>;
  /** `properties.catalog`: the keys starting with `prefix` (each value counted), or `key`'s values starting with it. */
  catalog(key: string | undefined, prefix: string): Promise<readonly { key: string; value: string; count: number }[]>;
  /** The actions a rule can run: `<extension>/<action>` on a block, with what they do. */
  actions(): readonly BarSuggestion[];
  /** The extensions installed here, by id (each a writer `ext:<id>`). */
  extensions(): readonly string[];
  /** The nodes the outline's nodelist knows (`<outline>@<machine>`, EchoNet's): none until it has one. */
  nodes(): Promise<readonly string[]>;
}

const BUILT_IN_WRITERS = ["user", "agent"];


/** A comma-separated list being built (writers): the last name offered from `names`, the ones already listed kept. */
export function listSuggestions(typed: string, names: readonly string[]): BarSuggestion[] {
  const at = typed.lastIndexOf(",");
  const before = at >= 0 ? `${typed.slice(0, at + 1).trimEnd()} ` : "";
  const token = (at >= 0 ? typed.slice(at + 1) : typed).trim().toLowerCase();
  const have = new Set(before.split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
  return names.filter(n => !have.has(n) && n.startsWith(token)).map(n => ({ value: `${before}${n}` }));
}

/** One candidate set for the question, completion, validation and saved-value warnings. */
export function settingOptions(field: SettingField, facets: readonly { key: string; count: number }[]): BarSuggestion[] {
  const p = field.prop, values = (p.values ?? []).map(v => ({ value: v.value, detail: v.meaning }));
  if (p.question?.source === "facets") for (const f of facets) if (!values.some(v => v.value === f.key)) values.push({ value: f.key, detail: `on ${f.count} notes` });
  return values;
}

/** The power bar's question for a field: its picker, by the field's type. */
export function settingQuestion(field: SettingField, src: SettingSources): BarQuestion {
  const p = field.prop;
  const base = { name: p.key, label: p.key, description: `${p.meaning}${p.default !== undefined ? ` (left out: ${p.default})` : ""}`, ...(field.value !== null ? { value: field.value } : {}) };
  const samples = (typed: string): BarSuggestion[] => {
    const t = typed.trim().toLowerCase();
    return [...new Set([...(p.samples ?? []), ...(p.default !== undefined ? [p.default] : [])])].filter(s => !t || s.toLowerCase().includes(t)).map(value => ({ value, ...(value === p.default ? { detail: "the default" } : {}) }));
  };
  if (p.question) {
    const options = settingOptions(field, src.facets?.() ?? []);
    const ordered = (options: BarSuggestion[]) => p.question!.order ? options.flatMap(option => (field.order?.values ?? []).map(direction => ({ ...option, value: `${option.value} ${direction.value}` }))) : [...options];
    const choices = ordered(options);
    const lookedUp = new Set<string>();
    const suggest = p.question.source === "facets" && src.facet ? (typed: string) => {
      const key = p.question!.order ? typed.trim().replace(/\s+(asc|desc)$/i, "") : typed.trim();
      // Known choices answer during the bar's background refresh, including the checkbox just changed.
      if (!key || options.some(o => o.value === key) || lookedUp.has(key)) return choices;
      return src.facet!(key).then(found => {
        lookedUp.add(key);
        if (found) {
          const extra = settingOptions(field, [found]).filter(o => !options.some(known => known.value === o.value));
          options.push(...extra); choices.push(...ordered(extra));
        }
        return choices;
      });
    } : undefined;
    return { ...base, value: field.value ?? p.default ?? "", type: p.question.type, choices: choices.map(c => c.value),
      ...(suggest ? { suggest } : {}),
      empty: typed => p.question!.source === "facets" ? missingPropertyHint(typed.replace(/\s+(asc|desc)$/i, ""), options.map(c => c.value)) : `${p.key} is one of ${choices.map(c => c.value).join(", ")}`,
      says: Object.fromEntries(choices.map(c => [c.value, `${c.value} · ${c.detail}`])), complete: { valueKey: p.key, candidates: choices } };
  }
  switch (p.type) {
    case "enum":
      return { ...base, type: "choice", complete: { valueKey: p.key, candidates: (p.values ?? []).map(v => ({ value: v.value, detail: v.meaning })) }, choices: (p.values ?? []).map(v => v.value), says: Object.fromEntries((p.values ?? []).map(v => [v.value, `${v.value} · ${v.meaning}`])) };
    case "query":
      return { ...base, type: "text", free: true, complete: { grammar: "query", where: field.value ?? undefined } };
    case "property":
      return { ...base, type: "text", free: true, suggest: async typed => {
        const keys = [...new Set([...samples(typed).map(s => s.value), ...(await src.catalog(undefined, typed.trim())).map(r => r.key)])];
        return keys.map(value => ({ value }));
      } };
    case "ref":
      return { ...base, type: "note", found: "a note", choices: [] };
    case "action": {
      const actions = src.actions();
      return { ...base, type: "text", free: true, suggest: typed => actions.filter(a => !typed.trim() || a.value.includes(typed.trim().toLowerCase())) };
    }
    case "node":
      return { ...base, type: "text", free: true, suggest: async typed => {
        const t = typed.trim().toLowerCase(), nodes = await src.nodes();
        // The nodes themselves, then a mask for each machine they're on and every node anywhere.
        const machines = [...new Set(nodes.map(n => n.slice(n.indexOf("@") + 1)))];
        const all = [...nodes, ...machines.map(m => `*@${m}`), ...(nodes.length ? ["*@*"] : [])];
        return all.filter(n => !t || n.toLowerCase().includes(t)).map(value => ({ value, ...(value.includes("*") ? { detail: "a mask" } : {}) }));
      } };
    case "writers":
      return { ...base, type: "text", free: true, suggest: typed => listSuggestions(typed, [...BUILT_IN_WRITERS, ...src.extensions().map(id => `ext:${id}`)]) };
    default:
      // Samples, then the values this outline's notes already have for the key (an area name in use, a cap): open properties.
      return { ...base, type: "text", free: true, suggest: async typed => {
        const own = await src.catalog(p.key, typed.trim()).catch(() => []);
        const values = [...samples(typed)];
        for (const r of own) if (!values.some(v => v.value === r.value)) values.push({ value: r.value, detail: `on ${r.count} note${r.count === 1 ? "" : "s"}` });
        return values;
      } };
  }
}

/** A value as written: a note picked for a block reference becomes `((id))`. */
export function settingValue(field: SettingField, answer: string): string {
  const v = answer.trim();
  return field.prop.type === "ref" && isBlockId(v) ? `((${v}))` : v;
}

/** The card's state while it's the panel's face: which field is selected, what it last said, where its rows were drawn. */
export class SettingsCard {
  /** Where it sits: inline until its reader's attachments say where the card was left (openSettings, PIE-1671). */
  place: AttachedPlace = "inline";
  float: FloatRect | null = null;
  frame: FloatRect | null = null;
  room: { w: number; h: number; col?: number; row?: number } = { w: 0, h: 0 };
  rect: FloatRect = { col: 0, row: 0, cols: 0, rows: 0 };
  sel = 0;
  view = new RowView();
  /** What the card says under its fields (a save, an undo) and its tone: a problem is red, news yellow (PIE-1293: said by whoever writes it, never guessed from its words). */
  private said: { text: string; tone: "news" | "problem" } = { text: "", tone: "news" };
  get note(): string { return this.said.text; }
  set note(text: string) { this.said = { text, tone: "news" }; }
  /** Say `text` under the fields, as news or as a problem. */
  say(text: string, tone: "news" | "problem" = "news") { this.said = { text, tone }; }
  /** Where the last render drew each field (`y` in its lines), for clicks; `tries`: the row is that field's `[try]` (from `x0` to `x1`). */
  at: { y: number; n: number; tries?: { x0: number; x1: number }; reset?: { x0: number; x1: number } }[] = [];
  /** An extension's card (PIE-1709): the machine its config.json is on, said in the title. */
  on?: string;
  /** The value being typed in place, when one is (an extension's setting). */
  editing: CardEdit | null = null;
  /** The field whose try is running, said under the fields until it answers. */
  trying: string | null = null;
  /** The card is its tile's whole content (the settings screen's card, PIE-1709), not a band above the note. */
  fills = false;

  constructor(readonly schemas: readonly ComponentSchema[], readonly list?: string) {}

  /** The schemas' ids, joined: whether a card drawn before still fits the note. */
  get id(): string { return this.schemas.map(s => s.id).join("+"); }

  /** An extension's card (PIE-1709): its try and its reset of every setting are its keys; a note's card hints neither. */
  ext = false;
  hint(): string {
    return modeHint(this.ext ? SETTINGS_KEYS : SETTINGS_KEYS.filter(r => r.action !== "settings.try" && r.action !== "settings.reset"), () => undefined);
  }

  draw(fields: readonly SettingField[], w: number, h: number, row: number, col: number, revision?: number): string[] {
    this.rect = { row, col, cols: w, rows: h };
    const chip = `[${this.place} ▸]`, left = Math.max(0, w - width(chip));
    // An extension's card resets every setting at once (PIE-1709): `[↺ all]` beside where it sits.
    const all = fields.some(f => f.ext?.state === "set") ? RESET_ALL : "";
    this.resetAll = all ? { x0: left - width(all) - 1, x1: left - 1 } : null;
    const lines = [pad("Settings", Math.max(0, left - (all ? width(all) + 1 : 0))) + (all ? fg(C.lcyan) + all + RESET + " " : "") + fg(C.lcyan) + chip + RESET, ...this.render(fields, w, h - 1, revision)];
    // A card that is its tile (the settings screen's, PIE-1709) fills it: the note's body isn't drawn under it.
    while (this.fills && lines[h - 1] === undefined) lines.push(pad("", w));
    return lines;
  }
  /** Where `[↺ all]` was drawn on the header row, when it was. */
  resetAll: { x0: number; x1: number } | null = null;

  hit(x: number, y: number): number | { tries: number } | { reset: number } | "place" | "resetAll" | "body" | null {
    const r = this.rect;
    if (x < r.col || x >= r.col + r.cols || y < r.row || y >= r.row + r.rows) return null;
    if (y === r.row) return this.resetAll && x - r.col >= this.resetAll.x0 && x - r.col < this.resetAll.x1 ? "resetAll" : "place";
    const at = this.at.find(hit => hit.y === y - r.row - 1);
    if (at?.tries && x - r.col >= at.tries.x0 && x - r.col < at.tries.x1) return { tries: at.n };
    if (at?.reset && x - r.col >= at.reset.x0 && x - r.col < at.reset.x1) return { reset: at.n };
    return at?.n ?? "body";
  }

  /** Where the value being typed was drawn, in the card's own cells (row and column from its top left): a click there is the line's. */
  editAt: { x: number; y: number; w: number } | null = null;

  /** The card's lines, at most `h`, `w` wide: a heading per section when the note is more than one thing. */
  render(fields: readonly SettingField[], w: number, h: number, revision: number | undefined): string[] {
    const first = this.schemas[0]!, name = first.source.note?.name;
    const named = fields.find(f => f.prop.key === name)?.value;
    // An extension's card is its settings, not a note's (PIE-1709): the machine its config.json is on, never a revision.
    const ext = fields.some(f => f.ext);
    const title = ext ? `settings · ${this.schemas[0]!.title}${this.on ? ` · on ${this.on}` : ""}`
      : `settings · ${this.schemas.map(s => s.title).join(" + ")}${named ? ` · ${printable(named)}` : ""}${revision !== undefined ? ` · rev ${revision}` : ""}`;
    const out = [rule(w, drawEllipsized(title, Math.max(2, w - 8)))];
    // The settings screen's card on a page whose extension went (uninstalled, its config.json with it): said, not blank.
    if (!fields.length && this.fills) return [...out, fg(C.dark) + pad(drawEllipsized("  nothing to set here now: its extension isn't installed · & installs it again", w), w) + RESET];
    this.sel = Math.max(0, Math.min(this.sel, fields.length - 1));
    const sel = fields[this.sel];
    const edit = sel?.prop.question ? (sel.prop.question.type === "toggle" ? "show or hide choices" : "choose and reorder") : sel?.prop.values ? "choose a value" : "edit the value";
    // An extension's fields each say what they do on the card itself; its foot is what was last said, or the keys.
    const about = ext ? (this.editing ? `editing ${this.editing.key} · ⏎ saves · esc keeps the old value` : sel ? `${sel.prop.key} · ⏎ edit${sel.ext?.tries ? " · t try" : ""} · x ${sel.prop.default !== undefined ? "back to its default" : "takes it out"}` : "")
      : sel ? `${sel.prop.key} · ${edit} · ${sel.prop.meaning}` : "";
    const foot = this.trying ? `trying ${this.trying}…` : this.editing ? (this.note || this.editing.session.status.note || about) : this.note || about;
    const room = Math.max(1, h - 1 - (foot ? 1 : 0));
    // The rows: a section's heading (only with more than one), then its fields.
    const rows: ({ field: SettingField } | { heading: string })[] = [];
    for (const f of fields) {
      if (this.schemas.length > 1 && (rows.length === 0 || f.section !== fields[f.n - 2]?.section)) rows.push({ heading: this.schemas[f.section]!.title });
      rows.push({ field: f });
    }
    const keyW = ext ? Math.min(Math.max(8, Math.floor(w / 4)), Math.max(...fields.map(f => width(f.prop.key)))) : 0;
    this.editAt = null;
    const drawn = rows.flatMap((r): { text: string; n: number; tries?: { x0: number; x1: number }; reset?: { x0: number; x1: number }; edit?: true }[] => {
      if ("heading" in r) return [{ text: fg(C.lcyan) + `  ${r.heading}` + RESET, n: 0 }];
      const f = r.field;
      if (f.ext) return extensionRows(f, w, keyW, this.editing?.key === f.prop.key ? this.editing : null);
      const value = f.value !== null ? fg(C.yellow) + printable(f.value)
        : f.prop.default !== undefined ? fg(C.dark) + `${f.prop.default} (default)` : fg(C.dark) + "—";
      return rowLines("  " + fg(C.brown) + f.prop.key + "  " + value + RESET, w, Infinity, { hang: 2 }).map(text => ({ text, n: f.n }));
    });
    const at = drawn.findIndex(r => r.n - 1 === this.sel), end = drawn.findLastIndex(r => r.n - 1 === this.sel);
    this.view.place(at < 0 ? null : at, drawn.length, room, at < 0 ? null : [at, end]);
    this.at = [];
    for (const r of drawn.slice(this.view.top, this.view.top + room)) {
      if (r.n) this.at.push({ y: out.length, n: r.n, ...(r.tries ? { tries: r.tries } : {}), ...(r.reset ? { reset: r.reset } : {}) });
      if (r.edit) this.editAt = w < NARROW ? { x: 3, y: out.length, w: Math.max(1, w - 3) } : { x: keyW + 4, y: out.length, w: Math.max(1, w - keyW - 4) };
      // The line being typed keeps its own lit cursor and selection: never the selected row's wash over it.
      out.push(r.n - 1 === this.sel && !r.edit ? selectedRow(r.text, w) : pad(r.text, w));
    }
    // An extension's foot is a try's answer or a refusal in the command's own words: wrapped, never cut (PIE-1709).
    const tone = this.trying || !this.note ? C.dark : this.said.tone === "problem" ? C.lred : C.yellow;
    if (foot) for (const line of ext ? rowLines(foot, w, 3, { hang: 2 }) : [drawEllipsized(foot, w)]) out.push(fg(tone) + pad(line, w) + RESET);
    return out.slice(0, h);
  }
}

const STATE_WORDS: Record<string, string> = { set: "set", default: "its default", unset: "not set", missing: "needed" };
/** The `[try]` chip on a setting's second row: from its third cell. */
const TRY_CHIP = "[try]", TRY_AT = 3, RESET_CHIP = "[↺]", RESET_ALL = "[↺ all]";

/**
 * An extension's setting as rows (PIE-1709): its label and value (set, else its default, dim), then what it does, said
 * by its schema, and the `[try]` its extension declares for it. The value being typed is one line in the shared editor.
 */
function extensionRows(f: SettingField, w: number, keyW: number, editing: CardEdit | null): { text: string; n: number; tries?: { x0: number; x1: number }; reset?: { x0: number; x1: number }; edit?: true }[] {
  const e = f.ext!, valueAt = keyW + 4, label = "  " + fg(C.brown) + pad(printable(f.prop.key), keyW) + RESET + "  ";
  const value = e.value !== null ? fg(C.yellow) + printable(e.value) + (e.value === "[]" ? fg(C.dark) + " none" : "")
    : e.state === "missing" ? fg(C.lred) + "missing"
    : f.prop.default !== undefined ? fg(C.dark) + printable(f.prop.default) : fg(C.dark) + "—";
  // Narrow (a phone's 44 columns): the label on its own row, its value under it, so neither is cut.
  if (w < NARROW) {
    const top = { text: "  " + fg(C.brown) + printable(f.prop.key) + RESET, n: f.n };
    const val = editing ? [{ text: "   " + editing.input.show(Math.max(1, w - 3)), n: f.n, edit: true as const }]
      : rowLines("   " + value + RESET, w, Infinity, { hang: 3 }).map(text => ({ text, n: f.n }));
    return [top, ...val, ...describe(f, e, w)];
  }
  const head = editing ? [{ text: label + editing.input.show(Math.max(1, w - valueAt)), n: f.n, edit: true as const }]
    : rowLines(label + value + RESET, w, Infinity, { hang: valueAt }).map(text => ({ text, n: f.n }));
  return [...head, ...describe(f, e, w)];
}

/** Under a setting: the `[try]` its extension declares for it, its state and what it does, in the schema's words. */
function describe(f: SettingField, e: ExtensionCardField, w: number): { text: string; n: number; tries?: { x0: number; x1: number }; reset?: { x0: number; x1: number } }[] {
  const said = `${STATE_WORDS[e.state] ?? e.state} · ${f.prop.meaning}`;
  const chip = e.tries ? fg(C.lcyan) + TRY_CHIP + RESET + " " : "";
  // ↺ on a setting that's set: back to its default (or out), as x does.
  const reset = e.state === "set" ? fg(C.lcyan) + RESET_CHIP + RESET + " " : "";
  const resetAt = TRY_AT + (e.tries ? width(TRY_CHIP) + 1 : 0);
  const about = rowLines(" ".repeat(TRY_AT) + chip + reset + fg(C.dark) + said + RESET, w, Infinity, { hang: TRY_AT }).map((text, i) => ({
    text, n: f.n, ...(i === 0 && e.tries ? { tries: { x0: TRY_AT, x1: TRY_AT + width(TRY_CHIP) } } : {}),
    ...(i === 0 && reset ? { reset: { x0: resetAt, x1: resetAt + width(RESET_CHIP) } } : {}),
  }));
  return about;
}
/** Below this width an extension's setting draws its label and value on rows of their own. */
const NARROW = 60;
