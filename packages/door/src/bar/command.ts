import { splitWords } from "@ep0ch/outline-core/component-block";
import { actRequestOf, allActionSets, lineWords, shownLine } from "../surface/actions";
import { formFields } from "./form";
import { argKind } from "./arg-kinds";
import type { BarHost } from "./source";
import { BUTTON_NAME } from "@ep0ch/outline-core/button-call";

export interface BarRun { line: string; answer: string; refused: boolean }

/** Complete the last word with the form's fields and value providers. */
export async function commandCandidates(line: string, host: BarHost): Promise<string[]> {
  const parts = splitWords(line, false).flat();
  const words = parts.map(p => p.value);
  const tail = parts.at(-1);
  const atEnd = !!tail && line.endsWith(tail.raw);
  let req;
  try { req = actRequestOf(words.length > 1 && atEnd && !words.at(-1)!.includes("=") ? words.slice(0, -1) : words); } catch { return []; }
  const info = host.dispatch.list().actions.find(a => a.name === req.action);
  if (!info || words.length < 2 && atEnd) return [];
  const fields = formFields(info);
  const last = atEnd ? tail.value : "";
  const equal = last.indexOf("=");
  const start = atEnd ? line.length - tail.raw.length : line.length;
  if (equal < 0) {
    const found = fields.filter(f => f.name.startsWith(last) && req.args?.[f.name] === undefined && (f.name !== "tile" || req.tile === undefined));
    return found.map(field => line.slice(0, start) + field.name + "=");
  }
  const name = last.slice(0, equal), typed = last.slice(equal + 1), field = fields.find(f => f.name === name);
  if (!field) return [];
  const spec = field.spec;
  const choices = spec.type === "boolean" ? ["true", "false"] : spec.choices ?? [];
  let values = choices.filter(v => v.startsWith(typed));
  if (spec.kind) {
    const found = await argKind(spec.kind)?.(typed, host, { of: spec.of ? String(req.args?.[spec.of] ?? "") : undefined }) ?? [];
    values = [...values, ...found.sort((a, b) => Number(b.value.startsWith(typed)) - Number(a.value.startsWith(typed))).map(v => v.value)];
  }
  if (!values.length) return [];
  return [...new Set(values)].map(value => line.slice(0, start) + shownLine(req.action, { [name]: value }).slice(req.action.length + 1));
}

/** Tab advances to the first candidate offered by the form's pickers. */
export async function completeCommand(line: string, host: BarHost): Promise<string | null> {
  return (await commandCandidates(line, host))[0] ?? null;
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
