// What yo says, as text from records: no I/O. The code quotes and the model only picks, so a quote is always the action's own words.

/** An action's record, as `ep0ch actions --all` lists it. */
export interface ActionRecord {
  name: string;
  summary: string;
  words?: string;
  keys?: string | readonly ({ keys: string; does?: string; args?: Readonly<Record<string, string | number | boolean>> } | { via: string })[];
  args?: Record<string, { type?: string; optional?: boolean; about?: string; choices?: readonly string[] }>;
  examples?: readonly { act: string; does?: string }[];
  /** The kind of tile it brings onto the screen (`links` opens the backlinks tile): the way to that tile's actions. */
  opens?: string;
  person?: string;
  scope?: string;
  touches?: string;
}
export interface Memory { id: string; asked: string; action: string; line: string; kind: string; text: string }

const STOP = new Set("a about again all am an and any are at be button by can could do does for from get go going help how i if in into is it its just like make me my of on or please press put run set show so that the them then there this to up use want was way what when where which will with would you your yo".split(" "));

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

/** The key rows that press it with these arguments (backlinks.view step=kind is K), when its rows say (PIE-1712). */
export function keyRowsFor(a: ActionRecord, given: Readonly<Record<string, string>>): { keys: string; does?: string }[] {
  if (!a.keys || typeof a.keys === "string" || !Object.keys(given).length) return [];
  return a.keys.flatMap(row => ("via" in row || !row.args || !Object.keys(row.args).length ? [] : Object.entries(row.args).every(([k, v]) => given[k] === String(v)) ? [row] : []));
}

/** Its keys, in the keycap spelling its own rows use: a key or a way per part; with arguments its rows name, only the key that presses those, and what it does (`K: by kind`). */
export function keysOf(a: ActionRecord, most = 3, given: Readonly<Record<string, string>> = {}): string {
  if (!a.keys) return "";
  const fit = keyRowsFor(a, given);
  if (fit.length) return fit.map(r => (r.does ? `${r.keys}: ${r.does.split(",", 1)[0]}` : r.keys)).join(" · ");
  if (typeof a.keys === "string") return a.keys.split(";", 1)[0]!.split(/,\s+/).slice(0, most).join(" · ");
  return a.keys.flatMap(row => ("via" in row ? (row.via.includes("::button") ? [] : [row.via]) : [row.keys])).slice(0, most).join(" · ");
}

/**
 * The button's words for pressing `line` (default the action bare): the label its own doc gives a button for those
 * arguments (`::button{label="▼ drop" act="agent.lift on=false"}`, PIE-1626), the one whose arguments the line has most
 * of, all with the same values (a bare `act="agent.lift"` fits any line); else its verb.
 */
export function labelOf(a: ActionRecord, line = a.name): string {
  const rows = typeof a.keys === "string" || !a.keys ? [] : a.keys, given = argsOf(line);
  let best: { label: string; fits: number } | null = null;
  for (const row of rows) {
    const m = "via" in row ? /::button\{label="([^"]+)" act="([^"]+)"/.exec(row.via) : null;
    if (!m || m[2]!.split(/\s+/, 1)[0] !== a.name) continue;
    const own = Object.entries(argsOf(m[2]!));
    if (own.every(([k, v]) => given[k] === v) && own.length > (best?.fits ?? -1)) best = { label: m[1]!, fits: own.length };
  }
  // No button of its own for these arguments: the key row that presses them says what it does (`▸ by kind`, PIE-1712).
  const row = best?.fits ? null : keyRowsFor(a, given)[0];
  if (row?.does) return `▸ ${row.does.split(",", 1)[0]}`;
  // Else its verb, with the arguments it presses (`▸ view resolved`), so two buttons of one action read apart.
  const words = Object.entries(given).filter(([, v]) => !v.startsWith("{")).map(([k, v]) => (v === "true" ? k : `${k} ${v}`)).join(" ");
  return best?.label ?? `▸ ${a.name.split(".").at(-1)}${words ? ` ${words}` : ""}`;
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

/**
 * The line that draws the button; a press also tells yo it worked (`ext.yo.remember`). A comment draws no `::` line, so in a
 * thread it's a link, naming the tile asked about. `before`: the steps that get there first (`links`, which opens the
 * backlinks tile backlinks.view works in, PIE-1712), pressed in order as one sequence.
 */
export function buttonLine(a: ActionRecord, press: { line: string; slots: string[] }, asked: string, o: { thread?: boolean; tile?: string; before?: readonly string[] } = {}): string {
  const label = labelOf(a, press.line), slug = slugOf(asked), slots = press.slots.map(s => ` ${s}=`).join(""), before = o.before ?? [];
  if (o.thread && !press.slots.length) return `[${label}](act: ${press.line}${o.tile ? ` tile=${o.tile}` : ""})`;
  const word = argsWord(press.line);
  const steps = [...before, press.line, ...(slug && !press.slots.length ? [`ext.yo.remember act=${a.name} asked=${slug}${word ? ` args=${word}` : ""}`] : [])];
  return !press.slots.length && steps.length > 1
    ? `::button{label="${label}" act=[${steps.map(l => `"${l}"`).join(", ")}]}`
    : `::button{label="${label}" act="${press.line}"${slots}}`;
}

/**
 * The steps that get to an action's tile from where it was asked (PIE-1712): an action of a tile's own (its scope is a
 * tile kind) asked from elsewhere is pressed after the action that opens that kind (ActionRecord.opens), when one does.
 */
export function pathTo(a: ActionRecord, actions: readonly ActionRecord[], from?: string): string[] {
  if (!a.scope || a.scope === from) return [];
  const opener = actions.find(x => x.opens === a.scope && !Object.values(x.args ?? {}).some(arg => !arg.optional));
  return opener ? [opener.name] : [];
}

/**
 * The way to yo's settings from an answer that couldn't use its model (PIE-1709): a press opens the door's settings screen
 * at yo, where its model command reads as one line, changes and is tried. A thread's answer has it as a link.
 */
export const settingsButton = (thread = false): string => thread ? "[⚙ yo's settings](act: ext.yo.settings)" : '::button{label="⚙ yo\'s settings" act="ext.yo.settings"}';

/** The row a press leaves: its undo only when the run can take it back, and nothing to undo when it changed nothing (PIE-1626). */
export function doneRow(label: string, undo: string, reversible: boolean, changed = true): string {
  return `✓ yo pressed ${label} · ${!changed ? "nothing to undo: it was already so" : reversible ? `[undo](act: ext.undo run=${undo})` : "no undo: it changes no note and no layout"}`;
}

/**
 * The step that says memory wasn't read. No outline by that name yet is a first run, said plainly with the command that
 * makes one (PIE-1632); anything else (a machine that doesn't answer, a refusal) is said as it came.
 */
export function memoryStep(reason: string, outline: string, doing: "read" | "write" = "read"): string {
  if (/^No outline named\b/i.test(reason)) {
    return doing === "read" ? `no memory yet: yo remembers once an outline named ${outline} exists, \`ep0ch outline create ${outline}\`` : `not remembered: no outline named ${outline} yet, \`ep0ch outline create ${outline}\``;
  }
  return doing === "read" ? `memory skipped (${reason})` : `not remembered (${reason})`;
}

/** The two quoted lines of an answer: with arguments its keys name, the key for those alone (`keys: K: by kind`). */
export function quoted(a: ActionRecord, given: Readonly<Record<string, string>> = {}): string[] {
  const keys = keysOf(a, 3, given);
  return [`\`${a.name}\`: "${quoteOf(a)}"`, keys ? `keys: ${keys}` : `no keys: \`ep0ch act ${a.name}\`, or the button`];
}

/**
 * The action a button line presses and its label: the act of one yo drew (as a line or as a thread's link), and `steps`,
 * every line it presses in order but yo's own remember (the way there first, PIE-1712). `act` is the action asked about.
 */
export function buttonIn(line: string): { label: string; act: string; steps?: string[]; forget?: true } | null {
  const m = /::button\{label="([^"]*)" act=(?:\[((?:"[^"]*"(?:,\s*)?)+)\]|"([^"]*)")/.exec(line);
  if (m) {
    const all = m[2] !== undefined ? [...m[2].matchAll(/"([^"]*)"/g)].map(x => x[1]!) : [m[3]!];
    const steps = all.filter(l => !l.startsWith("ext.yo.remember"));
    const named = /ext\.yo\.remember act=(\S+)/.exec(all.find(l => l.startsWith("ext.yo.remember")) ?? "")?.[1];
    const act = steps.find(l => l.split(/\s/, 1)[0] === named) ?? steps.at(-1) ?? all[0]!;
    // Its settings button (PIE-1709) is a way to fix yo, never the answer: `do it` doesn't press it.
    if (act === SETTINGS_ACT) return null;
    // A press of several steps with no remember of its own (a find's open, edit or save) is nothing yo keeps (PIE-1711).
    return { label: m[1]!, act, ...(steps.length > 1 ? { steps } : {}), ...(all.length > 1 && !named ? { forget: true as const } : {}) };
  }
  const link = /\[([^\]]+)\]\(act: ([^)]+)\)/.exec(line);
  return link && !link[2]!.startsWith("ext.undo") && link[2] !== SETTINGS_ACT ? { label: link[1]!, act: link[2]! } : null;
}
const SETTINGS_ACT = "ext.yo.settings";

/** The newest button a yo answer drew in these lines, and its line as written. */
export function lastButton(lines: readonly string[]): { line: string; label: string; act: string; steps?: string[]; forget?: true } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = buttonIn(lines[i]!);
    if (found) return { line: lines[i]!, ...found };
  }
  return null;
}

/** "do it", "yes", "press it": an ask with nothing to work out. */
export const isGo = (request: string) => /^(do it|do that|yes|yep|yeah|yup|press it|go|go ahead|ok|okay|please do)[.!\s]*$/i.test(request.trim());

/** The line under a question's button: nothing was pressed, and how to have it pressed. */
export const ASKED_HOW = "a question: say `@yo do it` to press it.";

/**
 * Whether an ask is a question by its words (PIE-1629): code decides, before any model runs, so a how-do-I never
 * presses whatever the answer model says. A question word first, a "how"/"is there a way"/"the key for" anywhere, or a
 * closing "?" is a question, "can you lift the agent?" too; a polite ask to do it with no "?" ("can you lift the agent") is a
 * command, and stays the model's to read.
 */
export function asksHow(request: string): boolean {
  const asked = request.trim().toLowerCase().replace(/[’']/g, "'");
  if (/\?\s*$/.test(asked)) return true;
  if (/^(can|could|would|will) you\b/.test(asked) && !/\bhow\b/.test(asked)) return false;
  if (/^(how|what|what's|whats|where|where's|which|why|when|who|is|are|does|do i|did|can i|could i|should i|may i|tell me|show me|remind me|explain)\b/.test(asked)) return true;
  return /\bhow (do|can|could|would|should|to)\b|\b(is|are) there (a|any) (way|key|button)\b|\b(the|a|which|what) (key|keys|shortcut|button|command) (for|to)\b/.test(asked);
}

/**
 * Whether an ask is a find (PIE-1711), told by its words before any model: "find me all…", "list…", "show me the…",
 * "which notes…", "all … that …". The words left are what to find, for query.suggest; null when it's a how-do-I ("how do
 * I find backlinks", "find the key for zoom") or an action ("show the links", "lift the agent").
 */
export function findAsk(asked: string): string | null {
  const text = asked.trim().replace(/[?.!\s]+$/, ""), low = text.toLowerCase();
  if (!low || /\bhow\b/.test(low) || /\b(?:key|keys|shortcut|button|command|action)s? (?:for|to)\b/.test(low)) return null;
  const every = "(?:(?:all|every|each)(?: (?:of )?the)?|the|my)\\s+";
  const m = new RegExp(`^(?:please\\s+)?(?:(?:find|search(?: for)?|look(?: for| up)|list|pull up)(?: me)?\\s+(?:${every})?|(?:show|get|give)(?: me\\s+(?:${every})?|\\s+(?:all|every)(?: (?:of )?the)?\\s+)|(?:all|every)(?: (?:of )?the)?\\s+|(?:which|what)\\s+(?=(?:notes?|blocks?|items?|pages?)\\b))(.+)$`, "i").exec(text);
  return m?.[1]?.trim() || null;
}

/** The notes a find found (PIE-1711), as the service answered: at most ten, whether there are more, its hint on a key nobody has. */
export interface FoundNotes { notes: { id: string; title: string }[]; more: boolean; hint?: string; refused?: string; nearest?: string[] }

/** The facets tile a find's buttons open, by name: pressed again, the same tile takes the next query. */
export const FOUND_TILE = "found";

/**
 * A find's answer (PIE-1711): how many notes and the query that found them, each note as a link, how each word was read,
 * then the buttons: open it in a facets tile, edit the query there, save it as a view. Nothing found says the nearest keys;
 * words that couldn't be read into a query say why, with a button that types them on a facets tile's query line.
 */
export function findAnswer(o: { words: string; where?: string; why?: string; read?: readonly { clause: string; from: readonly string[]; widens?: true }[]; found?: FoundNotes; thread?: boolean }): string[] {
  const quoteable = (q: string) => !q.includes("'") && !q.includes('"') && !q.includes("\n");
  const button = (label: string, steps: string[]) => o.thread ? `[${label}](act: ${steps.at(-1)})` : `::button{label="${label}" act=[${steps.map(l => `"${l}"`).join(", ")}]}`;
  const open = `tile.open kind=facets name=${FOUND_TILE}`;
  if (!o.where) {
    const lines = [`I couldn't read "${o.words}" into a query (${o.why ?? "no answer"}).`];
    if (quoteable(o.words)) lines.push(button("▸ type it in facets", [open, `facets.edit text='${o.words}' tile=${FOUND_TILE}`]));
    return lines;
  }
  const f = o.found ?? { notes: [], more: false }, n = f.notes.length;
  const lines = [n ? `${n}${f.more ? "+" : ""} note${n === 1 ? "" : "s"}: \`${o.where}\`` : `no notes: \`${o.where}\``];
  for (const note of f.notes) lines.push(`- ((${note.id}|${note.title.replace(/[|)]/g, " ").trim()}))`);
  const read = (o.read ?? []).map(c => `${c.from.join(" ")} → ${c.clause}${c.widens ? " (the whole outline)" : ""}`);
  if (read.length) lines.push(`read: ${read.join(" · ")}`);
  if (f.refused) lines.push(`the outline refused it: ${f.refused}`);
  if (f.hint) lines.push(f.hint);
  if (!n && f.nearest?.length) lines.push(`keys here nearest the words: ${f.nearest.join(" · ")}`);
  if (quoteable(o.where)) {
    lines.push(button("▸ open in facets", [open, `facets.query text='${o.where}' tile=${FOUND_TILE}`]));
    lines.push(button("▸ edit the query", [open, `facets.edit text='${o.where}' tile=${FOUND_TILE}`]));
    // Named by the words that asked for it ("Hub items that are not sent yet"): one press saves it, renamed like any note.
    const name = `${o.words.charAt(0).toUpperCase()}${o.words.slice(1)}`.slice(0, 80);
    if (n) lines.push(button("▸ save as a view", [open, `facets.query text='${o.where}' tile=${FOUND_TILE}`, `facets.save ${quoteable(name) ? `name='${name}' ` : ""}tile=${FOUND_TILE}`]));
  }
  return lines;
}

/**
 * yo's newest answer above: what it answered and the button in it, never a button written anywhere else in the note.
 * The button says which line it is (`at`, from 0): the same answer can be written above it word for word (PIE-1632).
 */
export function lastAnswer(lines: readonly string[]): { ask: string; button: { line: string; at: number; label: string; act: string; steps?: string[]; forget?: true } | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^>\s*\[!note\][+-]?\s+@yo answered\s*$/.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && lines[end]!.startsWith(">")) end++;
    const ask = /^\s*(?:[-*+]\s+)?@yo\b[:,]?\s*(.*)$/.exec(lines[i - 1] ?? "")?.[1] ?? "";
    // Its first button is the answer (a find's opens it in facets; edit and save follow, PIE-1711).
    for (let at = i + 1; at < end; at++) {
      const found = lines[at]!.startsWith("> >") ? null : buttonIn(lines[at]!);
      if (found) return { ask, button: { line: lines[at]!, at, ...found } };
    }
    return { ask, button: null };
  }
  return null;
}

/** Where line `at` starts in `text` (UTF-16, as draft.patch's range counts): the lines before it and their newlines. */
export const lineStart = (text: string, at: number) => (at ? text.split("\n").slice(0, at).join("\n").length + 1 : 0);

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

/** An action's arguments as the model reads them (PIE-1712): each name, its choices or what it takes, and an example line, so an ask that names a value ("by kind") fills it. */
function argsLine(a: ActionRecord): string {
  const args = Object.entries(a.args ?? {});
  if (!args.length) return "";
  const each = args.slice(0, 8).map(([k, v]) => `${k}${v.choices?.length ? ` (${v.choices.join("|")})` : v.about ? ` (${v.about.slice(0, 90)})` : ""}`);
  const example = a.examples?.find(e => e.act.split(/\s/, 1)[0] === a.name);
  // Its keys that press it with arguments say what each does: the words an ask uses ("by a type" is K, step=kind).
  const rows = typeof a.keys === "string" || !a.keys ? [] : a.keys.flatMap(r => ("via" in r || !r.args ? [] : [`${Object.entries(r.args).map(([k, v]) => `${k}=${v}`).join(" ")}: ${r.does ?? ""}`]));
  return ` args: ${each.join("; ")}${rows.length ? `; presets: ${rows.join("; ")}` : ""}${example ? ` e.g. ${example.act}` : ""}`;
}

/** The prompt that picks. */
export function planPrompt(o: { asked: string; question?: boolean; candidates: readonly ActionRecord[]; docs: readonly string[]; habits: readonly string[]; tile?: string }): string {
  return [
    "You are yo, the regular at an ep0ch terminal BBS who knows the door's actions and nothing about the person's projects. Pick what answers this ask. Return ONLY JSON, one of:",
    '{"kind":"quote","action":"<name from ACTIONS>","args":{}}  the person asks how to do something',
    ...(o.question ? [] : ['{"kind":"act","action":"<name from ACTIONS>","args":{}}  the person tells you to do it now, as an order ("lift the agent"); any question, however it is worded, is a quote']),
    '{"kind":"doc","quote":"<one line copied exactly from DOCS>"}  no action answers, a doc line does',
    '{"kind":"chat","line":"<one short line in character>"}  it is banter, not a question',
    '{"kind":"none","line":"<one line: what you do not know>"}  nothing here answers it',
    'An ask "about this tile" means: what is the most useful thing to know here; pick the action that is most useful on that kind of tile, as a quote.',
    "args: fill the ones the ask names a value for (\"by kind\" is step=kind where step takes kind), and only those. Never invent an action. Never answer about building features or the repository: that is kind none.",
    ...(o.tile ? [`ASKED FROM: a ${o.tile} tile`] : []),
    ...(o.habits.length ? ["HABITS:", ...o.habits] : []),
    "ACTIONS:", ...o.candidates.map(a => `${a.name}: ${a.summary.slice(0, 200)}${keysOf(a) ? ` [${keysOf(a)}]` : ""}${argsLine(a)}`),
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

/**
 * What a model command said when it failed, in its own words (PIE-1709): its stderr's first line, else what its JSON on
 * stdout carries (`claude --output-format json` says "Not logged in · Please run /login" as the envelope's `result`, with
 * `is_error`, and exits 1), else stdout's first line; empty when it said nothing at all.
 */
export function failureWords(out: string, err: string): string {
  if (err.trim()) return shortReason(err);
  const text = out.trim();
  try {
    const said = JSON.parse(text) as Record<string, unknown> | null;
    const words = said && typeof said === "object" ? [said.result, said.error, said.message].find(w => typeof w === "string" && w.trim()) : undefined;
    if (typeof words === "string") return shortReason(words);
  } catch { /* not JSON: its first line */ }
  return text ? shortReason(text) : "";
}

/** The ask a try sends a model setting (PIE-1709): short, and answered with the JSON every model command here answers with. */
export const TRY_PROMPT = 'Answer with JSON only: {"line": "<three words saying you are ready>"}.';

/** A try's answer in a line: what came back, its time and cost, or why not. */
export function triedLine(which: string, r: { ok: true; seconds: number; cost?: string; line?: string } | { ok: false; why: string }): string {
  if (!r.ok) return `✗ the ${which} model: ${r.why}`;
  return `✓ the ${which} model answered in ${r.seconds.toFixed(1)} s${r.cost ?? ""}${r.line ? `: "${shortReason(r.line)}"` : ""}`;
}

/** A refusal in a step's few words: its first line, ended at a sentence when it runs long, never mid-word or inside a code span. */
export function shortReason(said: string): string {
  const line = said.split("\n", 1)[0]!.trim();
  if (line.length <= 160) return line;
  // The last sentence end before the limit that sits outside code spans (an even count of backticks before it).
  const ends = [...line.slice(0, 160).matchAll(/[.!?)](?=\s)/g)].map(m => m.index! + 1)
    .filter(at => at >= 21 && (line.slice(0, at).match(/`/g)?.length ?? 0) % 2 === 0);
  if (ends.length) return line.slice(0, ends.at(-1)).replace(/\.$/, "");
  const cut = line.slice(0, 159).replace(/\s+\S*$/, "");
  return `${(cut.match(/`/g)?.length ?? 0) % 2 ? cut.replace(/`[^`]*$/, "").trimEnd() : cut}…`;
}

/** The steps under an answer, folded under their count. */
export function stepsFold(steps: readonly string[]): string[] {
  return steps.length ? [`> [!note]- ${steps.length} step${steps.length === 1 ? "" : "s"}`, ...steps.map(s => `> - ${s}`)] : [];
}

// ── yo about itself (PIE-1710) ───────────────────────────────────────────────────────────────────────────────────────

/** Whether two words are one slip apart (a letter wrong, missing, extra, or two swapped: "sue" for "use"). */
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]! <= 1;
}

/** The words an ask about yo is told by, each read through one slip ("sue" is "use", "seup" is "setup"). */
const SELF_WORDS = ["use", "using", "work", "works", "set", "setup", "configure", "config", "settings", "setting", "model", "models", "install", "login", "yourself"];
const GREETING = /^(hi+|hey+|hello|hiya|howdy|sup|yo+|gm|morning|whats? ?(good|up)|what'?s (good|up)|what can (you|u|yo) do|who are (you|u)|what are (you|u)|help)[\s!?.]*$/;

/**
 * What an ask about yo itself is (PIE-1710), told by its words, before any model: a greeting ("whats good", "hi", "what
 * can you do"), how to use it ("how do I use yo"), or how to set it up ("how do I set you up", "which model do you use");
 * null when it's about the door, the actions' business ("how do you split a tile", "can you set the trail to 7 days").
 * yo has to be what the ask is about: the object of use, set up, configure or install, or the one whose model or
 * settings are asked. A slip in a word is read through ("how do i sue yo"). An empty ask (ask yo about this tile) is the
 * tile's, never a greeting.
 */
export function selfAsk(asked: string): "greeting" | "use" | "setup" | null {
  const text = asked.toLowerCase().trim();
  if (!text) return null;
  if (GREETING.test(text)) return "greeting";
  const said = text.split(/[^a-z0-9']+/).filter(Boolean).map(w => SELF_WORDS.find(k => oneSlip(w, k)) ?? w).join(" ");
  const me = "(?:yo|you|u|yourself)";
  if (new RegExp(`\\b(?:set|setup|configure|config|install)\\b(?: \\S+)? ${me}\\b`).test(said)) return "setup";
  if (new RegExp(`\\b(?:your|yo's|yos) (?:settings?|models?|config|setup)\\b`).test(said) || new RegExp(`\\bmodels?\\b(?: \\S+){0,2} (?:do|does|are|is) ${me}\\b|\\b${me}(?:'re| are)? (?:using|on) (?:\\S+ )?models?\\b`).test(said)) return "setup";
  if (new RegExp(`\\b(?:use|using)\\b(?: \\S+)? ${me}\\b|\\b(?:what|how) (?:do|can|does) ${me} (?:do|work|works)\\b|\\b${me} (?:work|works)\\b`).test(said)) return "use";
  return null;
}

/** A section of yo's README by its heading ("What you do"), its bullets' first lines, at most `most`. */
export function readmeBullets(readme: string, heading: string, most = 3): string[] {
  const at = readme.indexOf(`\n## ${heading}\n`);
  if (at < 0) return [];
  const body = readme.slice(at + heading.length + 5).split(/\n## /, 1)[0]!;
  return body.split("\n").filter(l => l.startsWith("- ")).slice(0, most).map(l => l.slice(2).trim());
}

/** The asks yo's README shows (its example's `@yo …` lines), the first `most`, as you'd type them. */
export const exampleAsks = (readme: string, most = 2): string[] =>
  [...new Set(readme.split("\n").map(l => /^@yo [^←]+/.exec(l)?.[0]?.trim()).filter((l): l is string => !!l))].slice(0, most);

/** A model command in a few words: its model by name when it says one (`--model haiku`), else its program; none for []. */
export function modelWords(command: readonly string[]): string {
  if (!command.length) return "none (it quotes its closest match by its words)";
  const at = command.indexOf("--model");
  return at >= 0 && command[at + 1] ? `${command[at + 1]} (${command[0]})` : command[0]!.split("/").pop()!;
}

/**
 * yo's answer about itself (PIE-1710): from its own README and settings, never the closest action by its words. A
 * greeting says what it's for and two asks to try; how to use it, its first moves; how to set it up, its models as they
 * are and its settings, one press away.
 */
export function selfAnswer(kind: "greeting" | "use" | "setup", o: { readme: string; answer: readonly string[]; act: readonly string[]; answerDefault: boolean; memory?: string; thread?: boolean }): string[] {
  const intro = o.readme.split("\n\n")[1]?.split(/(?<=\.)\s/)[0] ?? "I answer how to do an ep0ch thing, from the actions' own docs.";
  const tryLines = exampleAsks(o.readme).map(a => `- \`${a}\``);
  if (kind === "greeting") return [`yo. ${intro}`, "Try:", ...tryLines];
  if (kind === "use") return [intro, ...readmeBullets(o.readme, "What you do", 3).map(b => `- ${b}`), "Try:", ...tryLines, settingsButton(o.thread)];
  return [
    `My answer model: ${modelWords(o.answer)}${o.answerDefault ? ", its default" : ""}.`,
    `My act model: ${modelWords(o.act)}. My memory: ${o.memory ? `the ${o.memory} outline` : "this outline"}.`,
    "Change any of them, and try each, in my settings:",
    settingsButton(o.thread),
  ];
}

/**
 * PIE-1708: a `claude` with no login says so on stdout ("Not logged in · Please run /login", inside its JSON envelope
 * with --output-format json) and exits 1. The host gives every extension the login `with-secrets` holds; this names the
 * command that stores one, in place of "exited 1".
 */
export const CLAUDE_LOGIN_FIX = "claude isn't logged in where the outline host runs; store its login: with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN";
export const notLoggedIn = (out: string, err: string) => /\bNot logged in\b/.test(`${out}\n${err}`);
