import { actRequestOf, lineWords, shownLine } from "../surface/actions";
import { formFields } from "./form";
import { argKind } from "./arg-kinds";
import type { BarHost } from "./source";
import { BUTTON_NAME } from "@ep0ch/outline-core/button-call";

export interface BarRun { line: string; answer: string; refused: boolean }

/** Complete the last word with the form's fields and value providers. */
export async function completeCommand(line: string, host: BarHost): Promise<string | null> {
  const words = lineWords(line);
  let req;
  try { req = actRequestOf(words.length > 1 && !/\s$/.test(line) && !words.at(-1)!.includes("=") ? words.slice(0, -1) : words); } catch { return null; }
  const info = host.dispatch.list().actions.find(a => a.name === req.action);
  if (!info || words.length < 2 && !/\s$/.test(line)) return null;
  const fields = formFields(info);
  const last = /\s$/.test(line) ? "" : words.at(-1)!;
  const equal = last.indexOf("=");
  const start = last ? line.lastIndexOf(last.split("=")[0]!) : line.length;
  if (equal < 0) {
    const field = fields.find(f => f.name.startsWith(last) && req.args?.[f.name] === undefined && (f.name !== "tile" || req.tile === undefined));
    return field ? line.slice(0, start) + field.name + "=" : null;
  }
  const name = last.slice(0, equal), typed = last.slice(equal + 1), field = fields.find(f => f.name === name);
  if (!field) return null;
  const spec = field.spec;
  const choices = spec.type === "boolean" ? ["true", "false"] : spec.choices ?? [];
  let values = choices.filter(v => v.startsWith(typed));
  if (spec.kind) {
    const found = await argKind(spec.kind)?.(typed, host, { of: spec.of ? String(req.args?.[spec.of] ?? "") : undefined }) ?? [];
    values = [...values, ...found.sort((a, b) => Number(b.value.startsWith(typed)) - Number(a.value.startsWith(typed))).map(v => v.value)];
  }
  if (!values.length) return null;
  const word = shownLine(req.action, { [name]: values[0] }).slice(req.action.length + 1);
  return line.slice(0, start) + word;
}

/** The button uses the same quoted attribute grammar as authored note buttons. */
export function commandButton(line: string): string {
  const req = actRequestOf(lineWords(line));
  return `::${BUTTON_NAME}{label=${JSON.stringify(req.action)} act=${JSON.stringify(line)}}`;
}
