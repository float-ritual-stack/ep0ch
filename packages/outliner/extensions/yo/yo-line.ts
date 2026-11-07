// What yo says, as text from records: no I/O. The code quotes and the model only picks, so a quote is always the action's own words.

/** An action's record, as `ep0ch actions --all` lists it. */
export interface ActionRecord {
  name: string;
  summary: string;
  words?: string;
  keys?: string | readonly ({ keys: string; does?: string } | { via: string })[];
  args?: Record<string, { type?: string; optional?: boolean; about?: string; choices?: readonly string[] }>;
  person?: string;
  scope?: string;
  touches?: string;
}
export interface Memory { id: string; asked: string; action: string; line: string; kind: string; text: string }

const STOP = new Set("a about again all am an and any are at be button can could do does for from get go going help how i if in into is it its just like make me my of on or please press put run set show so that the them then there this to up use want was way what when where which will with would you your yo".split(" "));

/** The words of an ask that carry its meaning: lower case, without the small ones. */
export function wordsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)))];
}

/** The action's own words, split at a clause, cut only at a clause or a word: every character is the summary's. */
export function quoteOf(a: ActionRecord, most = 110): string {
  // `words` is what it does as a person reads it, when the action says; else its summary's first clause.
  const first = (a.words ?? a.summary).split(/(?<=[.;:])\s/, 1)[0]!.replace(/[.;:]$/, "");
  const open = first.indexOf(" (");
  const whole = open > 30 ? first.slice(0, open) : first;
  if (whole.length <= most) return whole;
  const comma = whole.lastIndexOf(",", most);
  if (comma > 30) return whole.slice(0, comma);
  return whole.slice(0, whole.lastIndexOf(" ", most));
}

/** Its keys, in the keycap spelling its own rows use: a key or a way per part. */
export function keysOf(a: ActionRecord, most = 3): string {
  if (!a.keys) return "";
  if (typeof a.keys === "string") return a.keys.split(";", 1)[0]!.split(/,\s+/).slice(0, most).join(" · ");
  return a.keys.flatMap(row => ("via" in row ? (row.via.includes("::button") ? [] : [row.via]) : [row.keys])).slice(0, most).join(" · ");
}

/** The button's words: the label its own doc gives one (`::button{label="▲ lift" act="agent.lift"}`), else its verb. */
export function labelOf(a: ActionRecord): string {
  const rows = typeof a.keys === "string" || !a.keys ? [] : a.keys;
  for (const row of rows) {
    const m = "via" in row ? /::button\{label="([^"]+)"/.exec(row.via) : null;
    if (m) return m[1]!;
  }
  return `▸ ${a.name.split(".").at(-1)}`;
}

/** The action line a press runs: its arguments as given, a required one it lacks asked for (`{key}`, the button's own slot). */
export function pressLine(a: ActionRecord, given: Readonly<Record<string, string>> = {}): { line: string; slots: string[] } {
  const known = a.args ?? {};
  const parts = [a.name], slots: string[] = [];
  for (const [key, value] of Object.entries(given)) if (known[key] && /^[^\s"\\{}]+$/.test(value)) parts.push(`${key}=${value}`);
  for (const [key, arg] of Object.entries(known)) {
    if (arg.optional || parts.some(p => p.startsWith(`${key}=`)) || (arg as { context?: boolean }).context) continue;
    parts.push(`${key}={${key}}`); slots.push(key);
  }
  return { line: parts.join(" "), slots };
}

const slugOf = (asked: string) => wordsOf(asked).join("-").slice(0, 60);

/** An action line's arguments, without the tile it ran in: what's kept is what made it right, not where it was. */
export function argsOf(line: string): Record<string, string> {
  return Object.fromEntries(line.split(/\s+/).slice(1).flatMap(w => { const at = w.indexOf("="); return at > 0 && w.slice(0, at) !== "tile" ? [[w.slice(0, at), w.slice(at + 1)]] : []; }));
}
/** The arguments as one word of an action line: `on:false,reach:full`. */
export const argsWord = (line: string) => Object.entries(argsOf(line)).filter(([, v]) => !/[,:{}]/.test(v)).map(([k, v]) => `${k}:${v}`).join(",");
/** That word back as a line. */
export const lineOf = (action: string, word = "") => [action, ...word.split(",").filter(Boolean).map(p => p.replace(":", "="))].join(" ");

/** The line that draws the button; a press also tells yo it worked (`ext.yo.remember`). A comment draws no `::` line, so in a thread it's a link, naming the tile asked about. */
export function buttonLine(a: ActionRecord, press: { line: string; slots: string[] }, asked: string, o: { thread?: boolean; tile?: string } = {}): string {
  const label = labelOf(a), slug = slugOf(asked), slots = press.slots.map(s => ` ${s}=`).join("");
  if (o.thread && !press.slots.length) return `[${label}](act: ${press.line}${o.tile ? ` tile=${o.tile}` : ""})`;
  const word = argsWord(press.line);
  return slug && !press.slots.length
    ? `::button{label="${label}" act=["${press.line}", "ext.yo.remember act=${a.name} asked=${slug}${word ? ` args=${word}` : ""}"]}`
    : `::button{label="${label}" act="${press.line}"${slots}}`;
}

/** The row a press leaves: its undo only when the run can take it back. */
export function doneRow(label: string, undo: string, reversible: boolean): string {
  return `✓ yo pressed ${label} · ${reversible ? `[undo](act: ext.undo run=${undo})` : "no undo: it changes no note and no layout"}`;
}

/** The two quoted lines of an answer. */
export function quoted(a: ActionRecord): string[] {
  const keys = keysOf(a);
  return [`\`${a.name}\`: "${quoteOf(a)}"`, keys ? `keys: ${keys}` : `no keys: \`ep0ch act ${a.name}\`, or the button`];
}

/** The action a button line presses and its label: the first act of one yo drew, as a line or as a thread's link. */
export function buttonIn(line: string): { label: string; act: string } | null {
  const m = /::button\{label="([^"]*)" act=(?:\["([^"]*)"|"([^"]*)")/.exec(line);
  if (m) return { label: m[1]!, act: m[2] ?? m[3]! };
  const link = /\[([^\]]+)\]\(act: ([^)]+)\)/.exec(line);
  return link && !link[2]!.startsWith("ext.undo") ? { label: link[1]!, act: link[2]! } : null;
}

/** The newest button a yo answer drew in these lines, and its line as written. */
export function lastButton(lines: readonly string[]): { line: string; label: string; act: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = buttonIn(lines[i]!);
    if (found) return { line: lines[i]!, ...found };
  }
  return null;
}

/** "do it", "yes", "press it": an ask with nothing to work out. */
export const isGo = (request: string) => /^(do it|do that|yes|yep|yeah|yup|press it|go|go ahead|ok|okay|please do)[.!\s]*$/i.test(request.trim());

/** yo's newest answer above: what it answered and the button in it, never a button written anywhere else in the note. */
export function lastAnswer(lines: readonly string[]): { ask: string; button: { line: string; label: string; act: string } | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^>\s*\[!note\][+-]?\s+@yo answered\s*$/.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && lines[end]!.startsWith(">")) end++;
    const ask = /^\s*(?:[-*+]\s+)?@yo\b[:,]?\s*(.*)$/.exec(lines[i - 1] ?? "")?.[1] ?? "";
    return { ask, button: lastButton(lines.slice(i + 1, end).filter(l => !l.startsWith("> >"))) };
  }
  return null;
}

/**
 * What memory says of an ask: an exact note first, whatever order they're in; else the notes whose words cover it, when
 * they agree. Notes that disagree are a conflict to show, never a guess.
 */
export function recalled(memories: readonly Memory[], asked: string): { hit?: Memory; conflict?: Memory[] } {
  const words = wordsOf(asked);
  if (!words.length) return {};
  const said = memories.filter(m => m.action);
  const same = said.filter(m => { const have = wordsOf(m.asked); return have.length === words.length && words.every(w => have.includes(w)); });
  const covering = same.length ? same : said.filter(m => { const have = new Set(wordsOf(`${m.asked} ${m.action}`)); return words.every(w => have.has(w)); });
  const lines = [...new Set(covering.map(m => m.line))];
  if (lines.length > 1) return { conflict: lines.map(l => covering.find(m => m.line === l)!) };
  return covering[0] ? { hit: covering[0] } : {};
}

/** The actions an ask's words point at, best first: a name's word counts most, then its own words, then its summary. */
export function ranked(actions: readonly ActionRecord[], asked: string, boost: readonly string[] = []): ActionRecord[] {
  const words = wordsOf(asked);
  const scored = actions.map(a => {
    const name = new Set(wordsOf(a.name)), said = wordsOf(a.words ?? ""), summary = a.summary.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (name.has(w)) score += 6;
      if (said.includes(w)) score += 3;
      if (new RegExp(`\\b${w}`).test(summary)) score += 1;
    }
    for (const b of boost) if (name.has(b) || a.name.startsWith(`${b}.`)) score += 2;
    return { a, score };
  });
  return scored.filter(s => s.score > 0).sort((x, y) => y.score - x.score || x.a.name.length - y.a.name.length).map(s => s.a);
}

/** A doc's sections that an ask's words point at, best first, each as written. */
export function sections(doc: string, asked: string, most = 2): string[] {
  const words = wordsOf(asked);
  if (!words.length) return [];
  const parts = doc.split(/\n(?=#{1,3} )/);
  return parts.map(part => {
    const low = part.toLowerCase();
    return { part, score: words.reduce((n, w) => n + (low.split(w).length - 1), 0) + (words.every(w => low.includes(w)) ? 5 : 0) };
  }).filter(s => s.score > 2).sort((x, y) => y.score - x.score).slice(0, most).map(s => s.part.slice(0, 1800));
}

/** What the model picks: never words about an action, only which action. */
export type Plan =
  | { kind: "quote"; action: string; args?: Record<string, string> }
  | { kind: "act"; action: string; args?: Record<string, string> }
  | { kind: "doc"; quote: string }
  | { kind: "chat"; line: string }
  | { kind: "none"; line: string };

/** The prompt that picks. */
export function planPrompt(o: { asked: string; candidates: readonly ActionRecord[]; docs: readonly string[]; habits: readonly string[]; tile?: string }): string {
  return [
    "You are yo, the regular at an ep0ch terminal BBS who knows the door's actions and nothing about the person's projects. Pick what answers this ask. Return ONLY JSON, one of:",
    '{"kind":"quote","action":"<name from ACTIONS>","args":{}}  the person asks how to do something',
    '{"kind":"act","action":"<name from ACTIONS>","args":{}}  the person asks you to do it now',
    '{"kind":"doc","quote":"<one line copied exactly from DOCS>"}  no action answers, a doc line does',
    '{"kind":"chat","line":"<one short line in character>"}  it is banter, not a question',
    '{"kind":"none","line":"<one line: what you do not know>"}  nothing here answers it',
    'An ask "about this tile" means: what is the most useful thing to know here; pick the action that is most useful on that kind of tile, as a quote.',
    "args only when the ask says the value. Never invent an action. Never answer about building features or the repository: that is kind none.",
    ...(o.tile ? [`ASKED FROM: a ${o.tile} tile`] : []),
    ...(o.habits.length ? ["HABITS:", ...o.habits] : []),
    "ACTIONS:", ...o.candidates.map(a => `${a.name}: ${a.summary.slice(0, 200)}${keysOf(a) ? ` [${keysOf(a)}]` : ""}${Object.keys(a.args ?? {}).length ? ` args: ${Object.keys(a.args!).join(", ")}` : ""}`),
    ...(o.docs.length ? ["DOCS:", ...o.docs] : []),
    "ASK:", o.asked,
  ].join("\n");
}

/** The prompt that fills an action in, once code has decided it's an act. */
export function actPrompt(o: { asked: string; action: string; page: string }): string {
  return [
    "You are about to press this ep0ch door action for the person. Return ONLY JSON: {\"press\":true,\"args\":{\"key\":\"value\"}} with only the arguments the ask says, or {\"press\":false,\"line\":\"one line: why not\"} when this action is not what was asked.",
    "ACTION PAGE:", o.page, "ASK:", o.asked,
  ].join("\n");
}

/** A plan from the model's JSON, or null when it isn't one or names what wasn't offered. */
export function planOf(value: unknown, offered: readonly ActionRecord[], docs: readonly string[]): Plan | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const args = v.args && typeof v.args === "object" ? Object.fromEntries(Object.entries(v.args as Record<string, unknown>).map(([k, x]) => [k, String(x)])) : undefined;
  if ((v.kind === "quote" || v.kind === "act") && typeof v.action === "string" && offered.some(a => a.name === v.action)) return { kind: v.kind, action: v.action, ...(args ? { args } : {}) };
  if (v.kind === "doc" && typeof v.quote === "string" && v.quote.trim() && docs.some(d => d.includes(v.quote as string))) return { kind: "doc", quote: v.quote };
  if ((v.kind === "chat" || v.kind === "none") && typeof v.line === "string" && v.line.trim()) return { kind: v.kind, line: v.line.split("\n")[0]!.slice(0, 200) };
  return null;
}

/** The title and property line of a memory note: one fact, which Evan reads, fixes and deletes. */
export function memoryText(asked: string, pressed: string): string {
  const action = pressed.split(/\s+/, 1)[0]!;
  const line = [action, ...Object.entries(argsOf(pressed)).map(([k, v]) => `${k}=${v}`)].join(" ");
  const said = wordsOf(asked).join(" ") || action;
  return `${said}: ${line} [yo-memory::answer] [yo-action::${action}] [yo-asked::${said}] [yo-line::${line}]`;
}

/** A refusal in a step's few words: its first line, ended at a sentence when it runs long, never mid-word or inside a code span. */
export function shortReason(said: string): string {
  const line = said.split("\n", 1)[0]!.trim();
  if (line.length <= 160) return line;
  const sentences = /^.{20,159}[.!?)](?=\s)/.exec(line)?.[0];
  if (sentences) return sentences.replace(/\.$/, "");
  const cut = line.slice(0, 159).replace(/\s+\S*$/, "");
  return `${(cut.match(/`/g)?.length ?? 0) % 2 ? cut.replace(/`[^`]*$/, "").trimEnd() : cut}…`;
}

/** The steps under an answer, folded under their count. */
export function stepsFold(steps: readonly string[]): string[] {
  return steps.length ? [`> [!note]- ${steps.length} step${steps.length === 1 ? "" : "s"}`, ...steps.map(s => `> - ${s}`)] : [];
}
