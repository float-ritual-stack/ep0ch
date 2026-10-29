// An action's form (PIE-1031): its arguments as fields in the power bar, built from its ActionDef's declarations
// (ArgSpec: type, optional, about, kind, choices, of, default) and asked through the one action-argument prompt
// (askInBar, src/bar/ask.ts), never a form of the bar's own. The fields are the ones it needs first, then tile= when it
// runs on a tile (the dispatcher's selector, PIE-1038: never an argument), then the rest in the order it declares them.
// Its act line runs through the dispatcher as the person, as the line typed whole would; an agent is never asked: it
// reads the same fields (`bar.form op=open`, `actions`) and runs the action itself.
import { ActionRefused, coerceActionArgs, type ActionInfo, type ActRequest, type ArgSpec } from "../surface/actions";
import { actionPage, argDefault } from "../surface/action-page";
import type { Actor } from "../socket";
import { askInBar, type BarQuestion } from "./ask";
import type { BarHost } from "./source";

/** The name of the field that is tile=: the tile the action runs on. */
export const SELECTOR = "tile";

/** Whether an action runs on a tile (its tile= picks which): it touches a tile, the layout or a draft in one, or it is a tile action (tile.focus moves the keys from one). */
const onATile = (info: ActionInfo) => info.touches === "tile" || info.touches === "shape" || info.touches === "draft" || info.scope === "tile";

/** One field: its argument's name and declaration; `selector`: it is tile=, not an argument. */
export interface FormField { name: string; spec: ArgSpec; selector?: true }

/** The fields of an action's form: the arguments it needs, then tile= when it runs on a tile, then the rest. */
export function formFields(info: ActionInfo): FormField[] {
  const args = Object.entries(info.args).filter(([name]) => name !== SELECTOR);
  const needed = args.filter(([, s]) => !s.optional).map(([name, spec]) => ({ name, spec }));
  const rest = args.filter(([, s]) => s.optional).map(([name, spec]) => ({ name, spec }));
  // An argument named tile can't be reached from an act line (tile= is the selector): its meaning is the selector's.
  const own = info.args[SELECTOR];
  const selector: FormField[] = onATile(info) || own ? [{
    name: SELECTOR, selector: true,
    spec: { type: "string", optional: true, kind: "tile", default: "focused", about: own?.about ?? "the tile it runs on (tile=), the one with your keys when left out" },
  }] : [];
  return [...needed, ...selector, ...rest];
}

/** A field as the prompt asks it: its type, what it means, its kind and choices; a boolean is true or false. */
export function fieldQuestion(f: FormField): BarQuestion {
  const s = f.spec, d = argDefault(s);
  const choices = s.type === "boolean" ? ["true", "false"] : s.choices ? [...s.choices] : undefined;
  return {
    name: f.name, label: f.name, description: d.about,
    type: s.type === "number" ? "number" : choices && !s.kind ? "choice" : "text",
    ...(choices ? { choices } : {}), ...(s.kind ? { kind: s.kind } : {}), ...(s.of ? { of: s.of } : {}),
    ...(d.value !== undefined ? { default: d.value } : {}),
    required: !s.optional,
    // Anything typed is an answer, except to a fixed list of values (or true or false).
    free: !(choices && !s.kind),
  };
}

/**
 * The question argument `arg` of `action` asks (PIE-1298), from the action's own declaration: what a button's empty slot is asked in
 * (its kind, choices and meaning), answered as `value`. Null when the door has no such action or argument.
 */
export function argQuestion(host: BarHost, action: string, arg: string): BarQuestion | null {
  let info: ActionInfo;
  try { info = actionInfo(host, action); } catch { return null; }
  const f = formFields(info).find(x => x.name === arg);
  if (!f) return null;
  const { default: _focused, ...q } = fieldQuestion(f);
  return { ...q, name: "value", required: true, free: !f.spec.choices || !!f.spec.kind };
}

/** The arguments a form's answers give the action, and its tile=. */
function callOf(info: ActionInfo, answers: Record<string, string>): { args: Record<string, unknown>; tile?: string } {
  const { [SELECTOR]: tile, ...rest } = answers;
  const spec = Object.fromEntries(Object.entries(info.args).filter(([k]) => k !== SELECTOR));
  return { args: coerceActionArgs(info.name, spec, rest), ...(tile !== undefined ? { tile } : {}) };
}

/** The action `name` as the door lists it now, or a refusal that says how to find one. */
export function actionInfo(host: BarHost, name: string): ActionInfo {
  const info = host.dispatch.list().actions.find(a => a.name === name);
  if (!info) throw new ActionRefused(`no action ${name} here · ctrl+k then > lists the ones on this screen (ep0ch actions)`);
  return info;
}

/**
 * Open action `req.action`'s form in the power bar, its fields answered from `req` (a line typed with some of its
 * arguments, `tile=` too); enter on its act line runs it as the person. An agent is never asked: the call runs as given.
 */
export async function openActionForm(host: BarHost, req: ActRequest, actor: Actor): Promise<unknown> {
  const info = actionInfo(host, req.action);
  const fields = formFields(info);
  const given: Record<string, string> = Object.fromEntries(Object.entries(req.args ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  if (req.tile !== undefined && fields.some(f => f.selector)) given[SELECTOR] = req.tile;
  const run = (answers: Record<string, string>) => {
    const call = callOf(info, answers);
    return host.dispatch.as(actor, { action: info.name, ...call });
  };
  return askInBar(host as never, info.name, fields.map(fieldQuestion), given, actor, run, {
    action: info.name, ...(fields.some(f => f.selector) ? { selector: SELECTOR } : {}),
    ...(info.examples?.length ? { examples: info.examples } : {}),
    page: actionPage(info),
    check: answers => { try { callOf(info, answers); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } },
  });
}

/** What an agent reads of an action's form (`bar.form op=open`): its fields as the person sees them, and the act line. */
export function formFor(host: BarHost, req: ActRequest): Record<string, unknown> {
  const info = actionInfo(host, req.action);
  const fields = formFields(info).map(f => {
    const q = fieldQuestion(f), v = f.selector ? req.tile : req.args?.[f.name];
    return { name: f.name, about: q.description, type: f.spec.type, ...(q.required ? { required: true } : {}), ...(f.selector ? { selector: true } : {}), ...(f.spec.kind ? { kind: f.spec.kind } : {}), ...(q.choices ? { choices: q.choices } : {}), ...(q.default !== undefined ? { default: q.default } : {}), ...(v !== undefined ? { value: String(v) } : {}) };
  });
  return { action: info.name, fields, ...(info.examples?.length ? { examples: info.examples } : {}) };
}
