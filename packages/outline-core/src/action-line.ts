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

/** The quotes a typed or pasted line may use, each with the one that closes it (a chat's curly ones too). */
const QUOTES: Record<string, string> = { '"': '"', "'": "'", "\u201c": "\u201d", "\u2018": "\u2019" };

/**
 * A line split into words as a shell splits a command: spaces between words, and a quote, anywhere in a word, keeps
 * what's inside it in that word without the quotes (`query="#build report"` is `query=#build report`). A backslash
 * keeps the next character as it is (`\ `, `\"`; inside double quotes only `\"` and `\\`, as a shell's), never inside single
 * quotes. An unclosed quote runs to the end.
 */
export function lineWords(line: string): string[] { return wordsOf(line, false).flat(); }

function wordsOf(line: string, lines: boolean): string[][] {
  const rows: string[][] = [];
  let out: string[] = [];
  let word = "", inWord = false, close: string | null = null, escaped = false;
  for (const c of line) {
    if (escaped) { word += close && c !== close && c !== "\\" ? `\\${c}` : c; escaped = false; continue; }
    if (c === "\\" && close !== "'" && close !== "\u2019") { escaped = true; inWord = true; continue; }
    if (close) { if (c === close) close = null; else word += c; continue; }
    if (QUOTES[c]) { close = QUOTES[c]!; inWord = true; continue; }
    if (/\s/.test(c)) { if (inWord) out.push(word); word = ""; inWord = false; if (lines && c === "\n") { rows.push(out); out = []; } continue; }
    word += c; inWord = true;
  }
  if (inWord) out.push(word);
  rows.push(out);
  return rows;
}

/** Quotes preserve literal backslashes and line breaks through the power bar's word grammar. */
export function actionLine(req: ActRequest): string {
  const quote = (value: unknown) => '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return [req.action, ...Object.entries(req.args ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${quote(v)}`),
    ...(req.tile !== undefined ? [`tile=${quote(req.tile)}`] : [])].join(" ");
}

/** Slots belong to argument values, so an answer can never inject another action or argument. */
export function actionSlots(source: string): string[] {
  return [...new Set([...source.matchAll(/\{([a-z][a-z0-9_-]*)\}/g)].map(m => m[1]!))];
}

export function actionScript(source: string, slots: Record<string, string>): string {
  return wordsOf(source, true).flatMap((words, index) => {
    if (!words.length) return [];
    const req = actRequestOf(words);
    if (req.as !== undefined) throw new ActionRefused(`Line ${index + 1}: scripts run as their author; leave out as=`);
    const fill = (text: string) => text.replace(/\{([a-z][a-z0-9_-]*)\}/g, (_, name: string) => {
      if (!Object.hasOwn(slots, name)) throw new ActionRefused(`Line ${index + 1}: give ${name}= to fill {${name}}`);
      return slots[name]!;
    });
    const args = Object.fromEntries(Object.entries(req.args ?? {}).map(([key, value]) => [key, fill(String(value))]));
    if (req.tile !== undefined) args.tile = fill(req.tile);
    return [`try { await act(${JSON.stringify(req.action)}, ${JSON.stringify(args)}); } catch (e) { throw new Error(${JSON.stringify(`Line ${index + 1} (${req.action}): `)} + e.message); }`];
  }).join("\n");
}
