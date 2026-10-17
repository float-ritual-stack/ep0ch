import { lineWords, splitWords } from "./component-block";
import { interpolate, interpolationSpans, type InterpolationSpan } from "./interpolation";

export { lineWords };

/** What the control socket sends: an action on the current screen, in one of its tiles (`tile=`), as someone. */
export interface ActRequest { action: string; tile?: string; args?: Record<string, unknown>; as?: string }

/** An action refused before anything happened, with the reason in plain words. */
export class ActionRefused extends Error {
  constructor(message: string) { super(message); this.name = "ActionRefused"; }
}

/** An action and its `key=value` words (`--as` and `--tile` too), every value as written: the CLI's and the power bar's. */
export function actRequestOf(words: readonly string[]): ActRequest {
  const [action, ...rest] = words;
  if (!action) throw new ActionRefused("act needs an action name; `actions` lists them");
  const req: ActRequest = { action, args: {} };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (w === "--as" || w === "--tile") { const v = rest[++i]; if (v === undefined) throw new ActionRefused(`${w} needs a value`); if (w === "--as") req.as = v; else req.tile = v; continue; }
    const eq = w.indexOf("=");
    if (eq <= 0) throw new ActionRefused(`arguments are key=value, not ${JSON.stringify(w)}`);
    const k = w.slice(0, eq), v = w.slice(eq + 1);
    if (k === "tile") req.tile = v;
    else if (k === "as") req.as = v;
    else req.args![k] = v;
  }
  return req;
}

/** Quotes preserve literal backslashes and line breaks through the power bar's word grammar. */
export function actionLine(req: ActRequest): string {
  const quote = (value: unknown) => '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return [req.action, ...Object.entries(req.args ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${quote(v)}`),
    ...(req.tile !== undefined ? [`tile=${quote(req.tile)}`] : [])].join(" ");
}

/** A slot of an action line: `{{props.name}}`, with its `|| default` when it has one (then it needn't be given). */
export interface ActionSlot { name: string; default?: string }

const slotName = (span: InterpolationSpan): string | undefined => {
  const first = span.parsed?.head === "props" ? span.parsed.steps[0] : undefined;
  return first && "key" in first && span.parsed!.steps.length === 1 ? first.key : undefined;
};

/** The slots an `actions` fence takes (`{{props.name}}`, in the order first written). Slots belong to argument values, so an answer can never inject another action or argument. */
export function actionSlots(source: string): ActionSlot[] {
  const slots = new Map<string, ActionSlot>();
  for (const span of interpolationSpans(source, { fences: "template" })) {
    const name = slotName(span);
    if (name !== undefined && !slots.has(name)) slots.set(name, { name, ...(span.default !== undefined ? { default: span.default } : {}) });
  }
  return [...slots.values()];
}

/**
 * An `actions` fence as script source: one `act` call per line, each argument value filled from `props` **after** the
 * line is split into words, so a value holding `x tile=other` or `"; layout.load` stays one value and can't become
 * another argument or action.
 */
export function actionScript(source: string, props: Record<string, string | readonly string[]>): string {
  return splitWords(source, true).map(row => row.map(word => word.value)).flatMap((words, index) => {
    if (!words.length) return [];
    const req = actRequestOf(words);
    if (req.as !== undefined) throw new ActionRefused(`Line ${index + 1}: scripts run as their author; leave out as=`);
    const fill = (text: string) => interpolate(text, span => {
      const name = slotName(span);
      if (name === undefined) throw new ActionRefused(`Line ${index + 1}: {{${span.expression.trim()}}} isn't a slot; an action line takes {{props.name}}`);
      if (!Object.hasOwn(props, name)) {
        if (span.default === undefined) throw new ActionRefused(`Line ${index + 1}: give ${name}= to fill {{props.${name}}}`);
        return undefined;
      }
      const value = props[name]!;
      return typeof value === "string" ? [value] : value;
    }, { fences: "template" });
    const args = Object.fromEntries(Object.entries(req.args ?? {}).map(([key, value]) => [key, fill(String(value))]));
    if (req.tile !== undefined) args.tile = fill(req.tile);
    return [`try { await act(${JSON.stringify(req.action)}, ${JSON.stringify(args)}); } catch (e) { throw new Error(${JSON.stringify(`Line ${index + 1} (${req.action}): `)} + e.message); }`];
  }).join("\n");
}
