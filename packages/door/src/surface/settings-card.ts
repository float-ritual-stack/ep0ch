// The settings card (PIE-786): a configurable note (a rule note, a saved view, a callout type, a heading style, any
// component an extension declares with a declaring note) drawn as a card of its fields instead of a line of
// `[key::value]` soup. The fields are its component schema's (outline-core component-schema.ts, the service's merged
// `components.schemas`), never a list here: a note is configurable when it carries a schema's declaring property
// (`source.note.name`: `rule-name`, `query`, `callout-type`, `heading-style`). Each field's picker is a question in the
// power bar (src/bar/ask.ts) built from its type: an enum's values, a query built over the outline's own properties
// and values (`properties.catalog`), a note found by search, the actions extensions offer, the writers a rule hears, a
// duration, a property's name. A choice is written as an ordinary attributed property edit (`properties.patch`), so the
// note stays plain text. The card is a face of the property panel (the reader's `panel` mode): it draws here and turns
// keys into intents; the surface runs the `settings.*` actions.
import { checkValue as schemaCheck, settingsSchemas, type ComponentSchema, type PropSchema } from "@ep0ch/outline-core/component-schema";
export { settingsSchemas } from "@ep0ch/outline-core/component-schema";
import { isWritablePropertyValue } from "@ep0ch/outline-core/property-grammar";
import { querySuggestions } from "@ep0ch/outline-core/query-suggestions";
import type { BarQuestion, BarSuggestion } from "../bar/ask";
import { printable } from "../props";
import { RowView } from "../scroll";
import { selectedRow, bg, C, drawEllipsized, fg, pad, RESET, width } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { rowLines, rule } from "../text";

/**
 * One field of the card: a property a schema says the declaring note takes, its value on the note (null: unset), and
 * the section it's in (the index of its schema among the note's).
 */
export interface SettingField { n: number; prop: PropSchema; value: string | null; section: number }

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
 * that schema's order. A key two schemas both take is the first one's field (one property, one field).
 */
export function settingFields(schemas: ComponentSchema | readonly ComponentSchema[], props: Props): SettingField[] {
  const list: readonly ComponentSchema[] = Array.isArray(schemas) ? schemas : [schemas as ComponentSchema];
  const out: SettingField[] = [], seen = new Set<string>();
  list.forEach((schema, section) => {
    const name = schema.source.note?.name;
    const own = schema.props.filter(p => p.where === "note" && !seen.has(p.key));
    for (const prop of [...own.filter(p => p.key === name), ...own.filter(p => p.key !== name)]) {
      seen.add(prop.key);
      out.push({ n: out.length + 1, prop, value: props.find(p => p.key.toLowerCase() === prop.key)?.value ?? null, section });
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

/** The power bar's question for a field: its picker, by the field's type. */
export function settingQuestion(field: SettingField, src: SettingSources): BarQuestion {
  const p = field.prop;
  const base = { name: p.key, label: p.key, description: `${p.meaning}${p.default !== undefined ? ` (left out: ${p.default})` : ""}`, ...(field.value !== null ? { value: field.value } : {}) };
  const samples = (typed: string): BarSuggestion[] => {
    const t = typed.trim().toLowerCase();
    return [...new Set([...(p.samples ?? []), ...(p.default !== undefined ? [p.default] : [])])].filter(s => !t || s.toLowerCase().includes(t)).map(value => ({ value, ...(value === p.default ? { detail: "the default" } : {}) }));
  };
  switch (p.type) {
    case "enum":
      return { ...base, type: "choice", choices: (p.values ?? []).map(v => v.value), says: Object.fromEntries((p.values ?? []).map(v => [v.value, `${v.value} · ${v.meaning}`])) };
    case "query":
      return { ...base, type: "text", free: true, suggest: typed => querySuggestions(typed, (key, prefix) => src.catalog(key, prefix)) };
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
  return field.prop.type === "ref" && /^[0-9a-f-]{36}$/i.test(v) ? `((${v}))` : v;
}

export type CardIntent = "pick" | "clear" | "tokens" | "close" | null;

/** The card's state while it's the panel's face: which field is selected, what it last said, where its rows were drawn. */
export class SettingsCard {
  sel = 0;
  view = new RowView();
  note = "";
  /** Where the last render drew each field (`y` in its lines), for clicks. */
  at: { y: number; n: number }[] = [];

  constructor(readonly schemas: readonly ComponentSchema[]) {}

  /** The schemas' ids, joined: whether a card drawn before still fits the note. */
  get id(): string { return this.schemas.map(s => s.id).join("+"); }

  key(k: Key, rows: number): CardIntent {
    const c = ch(k);
    const move = (d: number) => { if (rows) { this.sel = (this.sel + d + rows) % rows; this.note = ""; } };
    if (k.kind === "tab" || isDown(k)) move(1);
    else if (k.kind === "backtab" || isUp(k)) move(-1);
    else if (k.kind === "enter" || c === "e") return "pick";
    else if (c === "x" || k.kind === "delete") return "clear";
    else if (c === "i") return "tokens";
    else if (k.kind === "esc" || c === "q" || c === ",") return "close";
    return null;
  }

  hint(): string {
    return "tab/j k field · enter picks · x clears · i every property · esc close";
  }

  /** The card's lines, at most `h`, `w` wide: a heading per section when the note is more than one thing. */
  render(fields: readonly SettingField[], w: number, h: number, revision: number | undefined): string[] {
    const first = this.schemas[0]!, name = first.source.note?.name;
    const named = fields.find(f => f.prop.key === name)?.value;
    const title = `settings · ${this.schemas.map(s => s.title).join(" + ")}${named ? ` · ${printable(named)}` : ""}${revision !== undefined ? ` · rev ${revision}` : ""}`;
    const out = [rule(w, drawEllipsized(title, Math.max(2, w - 8)))];
    this.sel = Math.max(0, Math.min(this.sel, fields.length - 1));
    const sel = fields[this.sel];
    const about = sel ? `${sel.prop.key} · ${sel.prop.type} · ${sel.prop.meaning}` : "";
    const foot = this.note || about;
    const room = Math.max(1, h - 1 - (foot ? 1 : 0));
    // The rows: a section's heading (only with more than one), then its fields.
    const rows: ({ field: SettingField } | { heading: string })[] = [];
    for (const f of fields) {
      if (this.schemas.length > 1 && (rows.length === 0 || f.section !== fields[f.n - 2]?.section)) rows.push({ heading: this.schemas[f.section]!.title });
      rows.push({ field: f });
    }
    const keyW = Math.min(18, Math.max(4, ...fields.map(f => width(f.prop.key))));
    const drawn = rows.flatMap(r => {
      if ("heading" in r) return [{ text: fg(C.lcyan) + `  ${r.heading}` + RESET, n: 0 }];
      const f = r.field;
      const value = f.value !== null ? fg(C.yellow) + printable(f.value)
        : f.prop.default !== undefined ? fg(C.dark) + `${f.prop.default} (default)` : fg(C.dark) + "—";
      return rowLines("  " + fg(C.brown) + f.prop.key + "  " + value + " " + fg(C.dark) + f.prop.type + RESET, w, undefined, { hang: 2 }).map(text => ({ text, n: f.n }));
    });
    const at = drawn.findIndex(r => r.n - 1 === this.sel), end = drawn.findLastIndex(r => r.n - 1 === this.sel);
    this.view.place(at < 0 ? null : at, drawn.length, room, at < 0 ? null : [at, end]);
    this.at = [];
    for (const r of drawn.slice(this.view.top, this.view.top + room)) {
      if (r.n) this.at.push({ y: out.length, n: r.n });
      out.push(r.n - 1 === this.sel ? selectedRow(r.text, w) : pad(r.text, w));
    }
    if (foot) out.push(fg(/not saved|can't|refused|failed|isn't|is one of|is a /.test(this.note) ? C.lred : this.note ? C.yellow : C.dark) + pad(drawEllipsized(foot, w), w) + RESET);
    return out.slice(0, h);
  }
}
