import { splitWords } from "@ep0ch/outline-core/component-block";
import { actRequestOf, allActionSets, lineWords, shownLine } from "../surface/actions";
import { formFields } from "./form";
import { argKind, type KindValue } from "./arg-kinds";
import { argDefault } from "../surface/action-page";
import type { BarHost, BarPreview } from "./source";
import { BUTTON_NAME } from "@ep0ch/outline-core/button-call";

export interface BarRun { line: string; answer: string; refused: boolean }

/**
 * One completion of an act line's last word (PIE-1076): an argument's name (`tile=`), or a value for the one being typed
 * (a tile on this screen, a choice, a note). `line` is the line through the cursor with it in; what it says is the
 * argument's own declaration (`ArgSpec`) or its kind's value. The power bar's line and a note's `::button` step both
 * list these through the one completer (src/surface/completer.ts, the `steps` source), so they never disagree.
 */
export interface CommandRow { label: string; line: string; kind: "argument" | "value"; detail?: string; docs?: string; preview?: BarPreview }

/**
 * A sigil typed first in a value names what it is, whatever the argument's kind (PIE-1076, the power bar's own scopes):
 * `tile=%dr` lists tiles anywhere; where an argument names a thing, `to=/gard` notes, `[[gar` pages, `:Bo` screens.
 */
export const VALUE_SIGILS: readonly { sigil: string; kind: string }[] = [
  { sigil: "%", kind: "tile" }, { sigil: "[[", kind: "page" }, { sigil: "/", kind: "note" }, { sigil: ":", kind: "screen" },
];

/**
 * The completions of the last word of an act line, as the form's fields and value providers give them. Nothing after a
 * space unless `explicit` (Tab): typing a space ends a word, as in every editor, and ⏎ then runs the line; a value typed
 * whole is offered no more, for the same reason.
 */
export async function commandRows(line: string, host: BarHost, o: { explicit?: boolean } = {}): Promise<CommandRow[]> {
  const parts = splitWords(line, false).flat();
  const words = parts.map(p => p.value);
  const tail = parts.at(-1);
  const atEnd = !!tail && line.endsWith(tail.raw);
  let req;
  try { req = actRequestOf(words.length > 1 && atEnd && !words.at(-1)!.includes("=") ? words.slice(0, -1) : words); } catch { return []; }
  const info = host.dispatch.list().actions.find(a => a.name === req.action);
  if (!info || words.length < 2 && atEnd) return [];
  if (!atEnd && !o.explicit) return [];
  const fields = formFields(info);
  const last = atEnd ? tail.value : "";
  const equal = last.indexOf("=");
  const start = atEnd ? line.length - tail.raw.length : line.length;
  const before = line.slice(0, start);
  if (equal < 0) {
    const found = fields.filter(f => f.name.startsWith(last) && req.args?.[f.name] === undefined && (f.name !== "tile" || req.tile === undefined));
    return found.map(f => {
      const d = argDefault(f.spec);
      return { label: `${f.name}=`, line: `${before}${f.name}=`, kind: "argument" as const, detail: [f.spec.optional ? "optional" : "needed", d.value !== undefined ? `default ${d.value}` : ""].filter(Boolean).join(" · "), docs: d.about };
    });
  }
  const name = last.slice(0, equal), field = fields.find(f => f.name === name);
  if (!field) return [];
  let typed = last.slice(equal + 1);
  // `%` names a tile wherever it's typed (no path or word starts with it); the rest only where the argument names a
  // thing (a tile, a note, a screen), never in a plain value or a path, where `/` and `:` are its own text.
  const spec = field.spec, sigil = VALUE_SIGILS.find(s => typed.startsWith(s.sigil) && (s.sigil === "%" || (!!spec.kind && spec.kind !== "file")));
  const kind = sigil?.kind ?? spec.kind;
  if (sigil) typed = typed.slice(sigil.sigil.length);
  const choices = sigil ? [] : spec.type === "boolean" ? ["true", "false"] : spec.choices ?? [];
  const values: KindValue[] = choices.filter(v => v.startsWith(typed)).map(v => ({ value: v, label: v, detail: spec.type === "boolean" ? "true or false" : "a choice" }));
  if (kind) {
    const found = await argKind(kind)?.(typed, host, { of: spec.of ? String(req.args?.[spec.of] ?? "") : undefined }) ?? [];
    values.push(...found.sort((a, b) => Number(b.value.startsWith(typed)) - Number(a.value.startsWith(typed))));
  }
  const seen = new Set<string>(), rows: CommandRow[] = [];
  for (const v of values) {
    if (seen.has(v.value) || !v.value) continue;
    seen.add(v.value);
    rows.push({ label: v.label, line: before + shownLine(req.action, { [name]: v.value }).slice(req.action.length + 1), kind: "value", ...(v.detail ? { detail: v.detail } : {}), docs: argDefault(spec).about, ...(v.preview ? { preview: v.preview } : {}) });
  }
  // The value typed whole: nothing left to complete, so ⏎ runs the line rather than choosing it again.
  if (!o.explicit && !sigil && rows.some(r => r.line === line)) return [];
  return rows;
}

/** The line's next completion (an agent's `bar.edit op=complete`, the unseen line it supplies): the first row's line. */
export async function completeCommand(line: string, host: BarHost): Promise<string | null> {
  return (await commandRows(line, host, { explicit: true }))[0]?.line ?? null;
}

/** The button uses the same quoted attribute grammar as authored note buttons. */
export function commandButton(line: string): string {
  const req = actRequestOf(lineWords(line));
  return `::${BUTTON_NAME}{label=${JSON.stringify(req.action)} act=${JSON.stringify(line)}}`;
}


/** What a run did, in the action's own words (its `says`), else the answer as written. */
export function runAnswer(line: string, result: unknown): string {
  if (typeof result === "string") return result;
  const req = actRequestOf(lineWords(line));
  for (const set of allActionSets()) {
    const def = set.def(req.action);
    if (!def?.says) continue;
    try { const said = def.says(result, req.args ?? {}); const text = typeof said === "string" ? said : said?.text; if (text) return text; } catch { /* its words don't fit this answer: the answer as written */ }
  }
  return JSON.stringify(result);
}
