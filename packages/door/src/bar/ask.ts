import { clipText } from "../overflow";
// The power bar asks for what an action needs and wasn't given (PIE-784): an extension's declared arguments (a sort's
// by and order) and the door's own (where a quote of marks goes). One question at a time in the bar's `ask` scope (`?`),
// its choices as rows (the value it has now first); a number or text is what's typed; a note is a choice or any note
// the outline's search finds as the person types. ⏎ answers it; the next question opens, or the action runs.
// An agent is never asked: it names what it means, or the action takes its default.
//
// An action's form (PIE-1031, gum's input, choose and filter as the model) is the same prompt with every field shown:
// one per argument (src/bar/form.ts builds them from the action's ArgSpecs), each with what it means and its answer so
// far, the act line it will run under them. The field in focus lists its values (a kind of thing in the system: its
// values are src/bar/arg-kinds.ts's; its choices; true or false), typed words filter them, ⏎ answers it and goes on, and
// the act line's own rows run it or copy it; alt+⏎ answers and runs at once; shift+tab (or backspace on an empty line)
// goes back a field; a click on a field or on the act line goes there. The action's examples are rows too: one picked
// fills the form. Moving between fields, answering, copying and running are `bar.form`, an action, as every key is.
import { ActionRefused, shownLine, type ActionExample } from "../surface/actions";
import { actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import type { Actor } from "../socket";
import { headedTitle } from "../board";
import { C, fg, pad, RESET, width } from "../style";
import { argKind } from "./arg-kinds";
import { registerBarSource, unregisterBarSource, type BarHost, type BarPreview, type BarRow, type BarSource } from "./source";

/** One question: an extension's argument with its choices, or the door's own. */
export interface BarQuestion {
  name: string;
  masked?: boolean;
  /** `note`: one of `choices`, or a note found by its words (answered with its id). */
  type: "text" | "choice" | "property" | "number" | "note";
  label?: string;
  description?: string;
  choices?: string[];
  options?: string[];
  /** The words a choice is shown as (`inbox` as "the Inbox"). */
  says?: Record<string, string>;
  value?: string;
  /**
   * Answers built from what's typed (a settings card's query builder over the outline's facets, a list of writers): each
   * row is a whole answer, the typed words with a clause or a name put in.
   */
  suggest?: (typed: string) => Promise<readonly BarSuggestion[]> | readonly BarSuggestion[];
  /** What's typed is an answer too, as typed (a query, a duration). */
  free?: boolean;
  /** `note`: this note's parents (nearest first) and the notes changed lately are offered before what's typed finds more (PIE-943: where a move goes). */
  parentsOf?: string;
  /** How a note the search found is described (default "under this note", a quote's place). */
  found?: string;
  /** A text or number the action needs: without it, nothing typed offers "leave it empty" (a note's form, PIE-828). */
  required?: boolean;
  /** The kind of thing its value names (ArgKind): its values are that kind's (src/bar/arg-kinds.ts), after `choices`. */
  kind?: string;
  /** `kind: "value"`: the question whose answer is the property this one is a value of. */
  of?: string;
  /** What leaving it out means, said on its "leave it out" row and its field (`right`, `focused`). */
  default?: string;
}

/**
 * What makes the questions an action's form (PIE-1031): the action whose act line they make, its examples (a row
 * each: picked, it fills the form), its page (the preview beside values that have none of their own), and why the
 * line as answered can't run (a field it needs, a value of the wrong type), or null when it can.
 */
export interface AskForm {
  action: string;
  /** The question that is the dispatcher's tile= (the tile it runs on), not one of the action's arguments. */
  selector?: string;
  examples?: readonly ActionExample[];
  page?: string;
  check?(answers: Record<string, string>): string | null;
  cancel?(): void;
}

/** One answer a question's `suggest` offers: the whole value, and how it's shown. */
export interface BarSuggestion { value: string; label?: string; detail?: string }

const ASK_SCOPE = "ask";
/**
 * The action waiting on the person's answers: the next question is the first not answered; in a form, the one in
 * focus (`focus`, an index; one past the last is the act line).
 */
let waiting: { title: string; questions: BarQuestion[]; answers: Record<string, string>; run: (answers: Record<string, string>) => Promise<unknown>; form?: AskForm; focus: number } | null = null;

/** The question asked now, or null (a form's act line). */
export const maskedQuestion = () => !!question()?.masked;
export function clearPrivateForm() { if (waiting && (!waiting.form || waiting.questions.some(q => q.masked) || waiting.form?.cancel)) { const cancel = waiting.form?.cancel; waiting = null; unregisterBarSource(ASK_SCOPE); cancel?.(); } }
const question = () => (waiting?.form ? waiting.questions[waiting.focus] ?? null : waiting?.questions.find(q => waiting!.answers[q.name] === undefined) ?? null);

/** Simple in-note questions share the bar's editor and picker in a small frame by the status bar. */
export function compactQuestion(): { title: string; choice: boolean } | null {
  const q = question();
  if (!waiting || waiting.form || !q || q.suggest || q.kind || !["text", "number", "choice"].includes(q.type)) return null;
  return { title: `${waiting.title}${q.label === "" ? "" : ` ${q.label ?? q.name}`}:`, choice: q.type === "choice" };
}

/** The bar's host as asking needs it: the person's dispatcher, to open the bar. */
interface AskCtx { dispatch?: { act(req: { action: string; args: Record<string, unknown> }, actor: Actor): Promise<unknown> } }

/**
 * Ask the person, in the power bar, each of `questions` not in `given`, then `run` with every answer. Answers at once
 * with what it's asking; the action runs when the last is answered (or never, when the bar is put away).
 */
export async function askInBar<R>(ctx: AskCtx, title: string, questions: readonly BarQuestion[], given: Record<string, string>, actor: Actor, run: (answers: Record<string, string>) => Promise<R>, form?: AskForm): Promise<R | { asking: string; action: string }> {
  const open = questions.filter(q => given[q.name] === undefined);
  // A form opens even with every field answered (a line typed whole, an action with nothing it needs): it is read, then run.
  if (actor.kind !== "user" || (!open.length && !form) || !ctx.dispatch) return run(given);
  // A form starts at the first field it needs that isn't answered, else at its first field.
  const need = questions.findIndex(q => q.required && given[q.name] === undefined);
  waiting = { title, questions: [...questions], answers: { ...given }, run: answers => run(answers), ...(form ? { form } : {}), focus: form ? Math.max(0, need) : 0 };
  registerBarSource(ASK_SOURCE);
  await ctx.dispatch.act({ action: "bar.open", args: { scope: ASK_SCOPE } }, actor);
  return { asking: question()?.name ?? "run", action: title };
}

/** The form open in the ask scope now, or null (nothing asked, or questions that aren't a form). */
export const formOpen = (): boolean => !!waiting?.form;

/** The act line a form's answers make (`shownLine`): the action, its tile=, then each answer in the fields' order. */
function lineOf(w: NonNullable<typeof waiting>): string {
  const f = w.form!, sel = f.selector;
  const args = Object.fromEntries(w.questions.filter(q => q.name !== sel && w.answers[q.name] !== undefined).map(q => [q.name, q.masked ? "[hidden]" : w.answers[q.name]]));
  return shownLine(f.action, args, sel ? w.answers[sel] : undefined);
}

/** What a form says of itself, for `peek`, `bar.form` and a test: its action, fields, the one in focus and its act line. */
export function formState(): Record<string, unknown> | null {
  const w = waiting;
  if (!w?.form) return null;
  return {
    action: w.form.action, line: lineOf(w), focus: w.questions[w.focus]?.name ?? "run", ...(w.form.check?.(w.answers) ? { refused: w.form.check(w.answers) } : {}),
    fields: w.questions.map(q => ({ name: q.name, ...(w.answers[q.name] !== undefined ? { value: q.masked ? "[hidden]" : w.answers[q.name] } : {}), ...(q.required ? { required: true } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.default !== undefined ? { default: q.default } : {}) })),
  };
}

/** Move a form's focus: to field `field` (by name; `run` is the act line), or back a field (`back`). */
export function formFocus(field: string | "back"): void {
  const w = waiting;
  if (!w?.form) throw new ActionRefused("no form is open · pick an action that takes arguments in the power bar (ctrl+k then >)");
  if (field === "back") { w.focus = Math.max(0, w.focus - 1); return; }
  const at = field === "run" ? w.questions.length : w.questions.findIndex(q => q.name === field);
  if (at < 0) throw new ActionRefused(`${w.form.action}'s form has no field ${field}; its fields: ${w.questions.map(q => q.name).join(", ")}, or run`);
  w.focus = at;
}

/** Answer a form's field (`value` undefined: take its answer back, leaving it out); `advance`: then go on to the next. */
export function formSet(field: string, value: string | undefined, advance = false): void {
  const w = waiting;
  if (!w?.form) throw new ActionRefused("no form is open · pick an action that takes arguments in the power bar (ctrl+k then >)");
  const at = w.questions.findIndex(q => q.name === field);
  if (at < 0) throw new ActionRefused(`${w.form.action}'s form has no field ${field}; its fields: ${w.questions.map(q => q.name).join(", ")}`);
  if (value === undefined) delete w.answers[field]; else w.answers[field] = value;
  if (!advance) return;
  // On to the first field it needs that isn't answered, else the next; past the last, the act line.
  const need = w.questions.findIndex(q => q.required && w.answers[q.name] === undefined);
  w.focus = need >= 0 && need !== at ? need : Math.min(w.questions.length, at + 1);
}

/** The act line a form's answers make now, or null with none open. */
export const formLine = (): string | null => (waiting?.form ? lineOf(waiting) : null);

/** Run the form open now, as answered: refused (and kept open) when the line can't run. */
export async function formRun(): Promise<unknown> {
  const w = waiting;
  if (!w?.form) throw new ActionRefused("no form is open · pick an action that takes arguments in the power bar (ctrl+k then >)");
  const why = w.form.check?.(w.answers);
  if (why) throw new ActionRefused(why);
  // The form is put away once its action ran; one the action refuses stays, its answers kept (`?` brings it back).
  if (w.questions.some(q => q.masked)) { waiting = null; unregisterBarSource(ASK_SCOPE); }
  const out = await w.run(w.answers);
  if (waiting === w) { waiting = null; unregisterBarSource(ASK_SCOPE); }
  return out;
}

/** Fill a form from one of its examples (its n-th, from 0): its answers become the example's, the act line in focus. */
function fillFrom(w: NonNullable<typeof waiting>, n: number) {
  const ex = w.form?.examples?.[n];
  if (!ex) throw new ActionRefused(`no example ${n + 1}`);
  const req = actRequestOf(lineWords(ex.act));
  w.answers = Object.fromEntries(Object.entries(req.args ?? {}).map(([k, v]) => [k, String(v)]));
  if (req.tile !== undefined && w.form!.selector) w.answers[w.form!.selector] = req.tile;
  w.focus = w.questions.length;
}

/** The previews of the rows a form's kinds gave (a tile's note, a note), by row key: asked again with every rows. */
const kindPreviews = new Map<string, BarPreview>();

/** How many fields a form shows at once: around the one in focus, the rest said as a count. */
const FIELDS_SHOWN = 8;
/** The form's head as drawn last: which field (or `run`, the act line) each of its lines is, for a click. */
let headSpots: (string | null)[] = [];

/** The form's lines above its rows: the action, a line per field (name, answer, meaning), the act line. */
function formHead(w: NonNullable<typeof waiting>, width_: number): string[] {
  const f = w.form!, qs = w.questions, nameW = Math.min(14, Math.max(...qs.map(q => width(q.name)), 4));
  const lines: string[] = [fg(C.dark) + clipText(` ${w.title}`, width_) + RESET];
  headSpots = [null];
  let from = 0, to = qs.length;
  if (qs.length > FIELDS_SHOWN) { from = Math.max(0, Math.min(w.focus - Math.floor(FIELDS_SHOWN / 2), qs.length - FIELDS_SHOWN)); to = from + FIELDS_SHOWN; }
  if (from > 0) { lines.push(fg(C.dark) + `   … ${from} more above` + RESET); headSpots.push(qs[from - 1]!.name); }
  const valueW = Math.max(10, Math.min(28, Math.floor(width_ * 0.3)));
  for (let i = from; i < to; i++) {
    const q = qs[i]!, on = i === w.focus, v = w.answers[q.name];
    const shown = v !== undefined ? fg(C.white) + pad(clipText(q.masked ? "********" : v || '""', valueW), valueW)
      : q.required ? fg(C.lred) + pad("needed", valueW) : fg(C.dark) + pad(clipText(q.default !== undefined ? `(${q.default})` : "-", valueW), valueW);
    const name = (on ? fg(C.lcyan) + "▸ " : "  ") + (q.required ? fg(C.yellow) : fg(C.grey)) + pad(q.name, nameW) + RESET;
    lines.push(` ${name} ${shown}${RESET} ${fg(C.dark)}${clipText(q.description ?? "", Math.max(0, width_ - nameW - valueW - 6))}${RESET}`);
    headSpots.push(q.name);
  }
  if (to < qs.length) { lines.push(fg(C.dark) + `   … ${qs.length - to} more below` + RESET); headSpots.push(qs[to]!.name); }
  const why = f.check?.(w.answers), line = lineOf(w), on = w.focus >= qs.length;
  const tail = why ? `  ✕ ${why}` : "  ⏎ runs it";
  lines.push(` ${on ? fg(C.lcyan) + "▸ " : "  "}${fg(C.dark)}ep0ch act ${fg(why ? C.grey : C.lgreen)}${clipText(line, Math.max(10, width_ - 16 - Math.min(width(tail), 40)))}${fg(why ? C.lred : C.dark)}${clipText(tail, Math.max(0, width_ - width(line) - 16))}${RESET}`);
  headSpots.push("run");
  return lines;
}

/** The rows of a kind's values for what's typed, as answers under `head`, their previews kept for the preview. */
async function kindRows(q: BarQuestion, typed: string, host: BarHost, head: string): Promise<BarRow[]> {
  const values = argKind(q.kind!);
  if (!values) return [];
  const of = q.of ? waiting?.answers[q.of] : undefined;
  const found = await Promise.resolve(values(typed, host, { ...(of !== undefined ? { of } : {}) })).catch(() => []);
  return found.map(v => {
    const key = `answer:${v.value}`;
    if (v.preview) kindPreviews.set(key, v.preview);
    return { key, label: v.label, ...(v.detail ? { detail: v.detail } : {}), ...(v.depth ? { depth: v.depth } : {}), ...(v.mark ? { mark: v.mark } : {}), group: head, data: v.value };
  });
}

/** A field's rows in a form: its choices, then its kind's values; what's typed as typed when it takes a free value. */
async function fieldRows(q: BarQuestion, typed: string, host: BarHost, head: string): Promise<BarRow[]> {
  if (q.masked) return typed ? [{ key: "private-answer", label: "********", group: head, data: typed }] : [{ key: "type", label: `type the ${q.label ?? q.name}`, group: head }];
  const words = typed.trim().toLowerCase();
  const choices = (q.choices ?? []).filter(c => !words || c.toLowerCase().includes(words) || q.says?.[c]?.toLowerCase().includes(words))
    .map((c): BarRow => ({ key: `answer:${c}`, label: q.says?.[c] ?? c, ...(c === q.default ? { detail: "the default" } : {}), group: head, data: c }));
  const kinds = q.kind ? await kindRows(q, typed, host, head) : [];
  const rows = [...choices, ...kinds.filter(k => !choices.some(c => c.key === k.key))];
  if (q.free && typed.trim() && !rows.some(r => r.data === typed.trim())) rows.unshift({ key: `answer:${typed.trim()}`, label: typed.trim(), detail: "as typed", group: head, data: typed.trim() });
  if (!q.required && !words) rows.unshift({ key: "leave", label: "leave it out", detail: q.default !== undefined ? `the default: ${q.default}` : "not given", group: head });
  if (!rows.length) rows.push({ key: "type", label: `type the ${q.label ?? q.name}`, detail: q.type === "number" ? "a number" : "then ⏎", group: head });
  return rows;
}

/** A form's rows: the focused field's values (or, on the act line, running and copying it), then its examples, then running it. */
async function formRows(w: NonNullable<typeof waiting>, typed: string, host: BarHost): Promise<BarRow[]> {
  kindPreviews.clear();
  const f = w.form!, q = question(), why = f.check?.(w.answers) ?? undefined, line = lineOf(w);
  const run: BarRow = { key: "run", label: `run ${line}`, fill: line, detail: "as you, through the dispatcher", group: "run", ...(why ? { refused: why } : {}) };
  const examples = (f.examples ?? []).map((ex, i): BarRow => ({ key: `example:${i}`, label: ex.act, detail: ex.does, group: "examples · fill the form" }));
  if (!q) return [run, { key: "copy", label: "copy the act line", detail: line, group: "run" }, ...examples];
  return [...await fieldRows(q, typed, host, `${q.name} · ${q.description ?? ""}`), ...examples, run];
}

/** A note's parents (nearest first, three) and the notes changed lately (the `/` scope's own list), then the choices: where a note can go before anything is typed. */
async function places(of: string, host: Parameters<NonNullable<BarSource["rows"]>>[1], head: string, choices: BarRow[]): Promise<BarRow[]> {
  const chain = await host.ctx.board.ancestors(of).catch(() => []);
  const parents: BarRow[] = [...chain].reverse().slice(0, 3).map((a, i) => ({ key: `answer:${a.id}`, label: headedTitle(a), detail: i === 0 ? "its parent" : "above it", group: `${head} · parents`, data: a.id }));
  const seen = new Set(parents.map(p => p.data));
  // Loaded when asked: sources.ts reaches the desk, which reaches the actions that ask (a static import is a cycle).
  const { recentNotes } = await import("./sources");
  const recent: BarRow[] = (await recentNotes(host as never).catch(() => [])).filter(r => r.key !== of && !seen.has(r.key)).slice(0, 8)
    .map(r => ({ key: `answer:${r.key}`, label: r.label, detail: r.detail ?? "changed lately", group: `${head} · lately`, data: r.key }));
  return [...parents, ...choices, ...recent];
}

const ASK_SOURCE: BarSource = {
  id: ASK_SCOPE, title: "ask", prefix: "?", by: "door", alone: true,
  about: "what an action you ran asks for (a sort's by and order, where a quote goes): ⏎ on a choice answers it, then the next, then the action runs",
  main: { empty: false, typed: false },
  head(w) { return waiting?.form ? formHead(waiting, w) : []; },
  headClick(i, host) {
    const at = headSpots[i];
    if (!waiting?.form || !at) return false;
    void host.dispatch.press("bar.form", { op: "focus", field: at });
    return true;
  },
  foot: () => (waiting?.form ? "⏎ pick and go on · alt+⏎ pick and run · ⇧⇥ back a field · a click on a field · esc closes" : null),
  state: () => formState(),
  rows(query, host) {
    if (waiting?.form) return formRows(waiting, query, host);
    const q = question();
    if (!q || !waiting) return [];
    const head = `${waiting.title} · ${q.label ?? q.name}`;
    const typed = query.trim();
    if (q.suggest) {
      const typedRow = q.free && typed ? [{ key: `answer:${typed}`, label: typed, detail: "as typed", group: head, data: typed }] : [];
      const nowRow = !typed && q.value !== undefined ? [{ key: `answer:${q.value}`, label: q.value, detail: "now", group: head, data: q.value }] : [];
      const rows = (found: readonly BarSuggestion[]): BarRow[] => [...typedRow, ...nowRow, ...found.filter(f => f.value !== typed && !(nowRow.length && f.value === q.value))
        .map(f => ({ key: `answer:${f.value}`, label: f.label ?? f.value, ...(f.detail ? { detail: f.detail } : {}), group: head, data: f.value }))];
      return Promise.resolve(q.suggest(query)).then(rows, () => rows([]));
    }
    // A question of a kind (a note, a screen, a file) lists that kind's values, as the same field in a form does (PIE-1298: a
    // button's empty slot is asked alone, outside a form).
    if (q.kind) { kindPreviews.clear(); return fieldRows(q, query, host, head); }
    if (q.type === "text" || q.type === "number") {
      const value = typed || q.value;
      if (value !== undefined) return [{ key: q.masked ? "private-answer" : `answer:${value}`, label: q.masked ? "********" : value, detail: head, group: head, data: value }];
      // Nothing typed and nothing now: one that isn't needed can be left out (the action takes its default, or none).
      // A needed one says it's waiting on what's typed, so the person sees what's asked.
      return [q.required === false ? { key: "answer:", label: "leave it empty", detail: `${head} · type to answer`, group: head, data: "" }
        : { key: "type", label: `type the ${q.label ?? q.name}`, detail: q.type === "number" ? "a number" : "then ⏎", group: head }];
    }
    const choices = [...new Set([...(q.value !== undefined ? [q.value] : []), ...(q.choices ?? q.options ?? [])])];
    const words = typed.toLowerCase();
    const rows: BarRow[] = choices.filter(c => !words || c.toLowerCase().includes(words) || q.says?.[c]?.toLowerCase().includes(words))
      .map(c => ({ key: `answer:${c}`, label: q.says?.[c] ?? c, detail: c === q.value ? "now" : undefined, group: head, data: c }));
    if (q.free && typed && !choices.includes(typed)) rows.unshift({ key: `answer:${typed}`, label: typed, detail: "as typed", group: head, data: typed });
    // One that isn't needed and has no default (a note's form, PIE-828) can be left out.
    if (q.required === false && q.value === undefined && !words) rows.push({ key: "answer:", label: "leave it empty", detail: "no answer", group: head, data: "" });
    // A note: any the outline's search finds by the words typed, nearer the note in front first. The rest answer at once.
    if (q.type === "note" && q.parentsOf && typed.length < 2) return places(q.parentsOf, host, head, rows);
    if (q.type !== "note" || typed.length < 2) return rows;
    return host.ctx.board.search(typed, 20, { near: host.near() ?? undefined }).then(found => [
      ...rows, ...found.map(m => ({ key: `answer:${m.id}`, label: headedTitle(m), detail: q.found ?? "under this note", group: `${head} · notes`, data: m.id })),
    ]);
  },
  preview(row) {
    if (waiting?.form) return kindPreviews.get(row.key) ?? (waiting.form.page ? { markdown: waiting.form.page } : null);
    const q = question();
    if (!q || !waiting) return null;
    // A lone question of a kind (a button's slot): a found note previews itself, as in a form.
    if (q.kind && kindPreviews.has(row.key)) return kindPreviews.get(row.key)!;
    if (q.type === "note" && !(q.choices ?? []).includes(String(row.data))) return { note: String(row.data) };
    return { markdown: [`**${waiting.title}** asks for **${q.label ?? q.name}**`, "", q.description ?? "", "", ...waiting.questions.map(x => `- ${x.label ?? x.name}: ${waiting!.answers[x.name] ?? (x === q ? "…" : "next")}`)].join("\n") };
  },
  async pick(row, host, how) {
    if (waiting?.form) {
      // A form is the person's: an agent never answers it or runs the person's line (it runs the action itself).
      if (how.actor.kind === "agent") throw new ActionRefused(`the form in the power bar is the person's; an agent runs ${waiting.form.action} itself with its arguments (ep0ch act ${waiting.form.action} …)`);
      return formPick(row, host, how);
    }
    const q = question();
    if (!q || !waiting) throw new ActionRefused("nothing is waiting on an answer");
    if (row.data === undefined) throw new ActionRefused(`type the ${q.label ?? q.name} first, then ⏎`);
    waiting.answers[q.name] = String(row.data);
    if (question()) return how.actor.kind === "agent" ? { asking: question()!.name } : host.dispatch.press("bar.open", { scope: ASK_SCOPE });
    const done = waiting;
    waiting = null;
    unregisterBarSource(ASK_SCOPE);
    return done.run(done.answers);
  },
};

/** A form's row picked: a value answers its field and goes on (alt: and runs), an example fills it, the act line's rows run or copy it. */
async function formPick(row: BarRow, host: BarHost, how: { alt: boolean; actor: Actor }): Promise<unknown> {
  const w = waiting!;
  const again = (out: Record<string, unknown>) => how.actor.kind === "agent" ? out : host.dispatch.press("bar.open", { scope: ASK_SCOPE }).then(() => out);
  // A line that can't run yet: said, and the form stays open on it.
  const refused = async () => { const why = w.form!.check?.(w.answers); if (why) { await again({}); throw new ActionRefused(why); } };
  if (row.key === "run") { await refused(); return formRun(); }
  if (row.key === "copy") {
    const line = lineOf(w);
    host.ctx.copy?.(`ep0ch act ${line}`);
    host.ctx.flash(`copied: ep0ch act ${line}`);
    return again({ copied: `ep0ch act ${line}` });
  }
  if (row.key.startsWith("example:")) { fillFrom(w, Number(row.key.slice(8))); return again({ filled: lineOf(w) }); }
  const q = question();
  if (!q) throw new ActionRefused("pick run, or a field first");
  if (row.key === "type") throw new ActionRefused(`type the ${q.label ?? q.name} first, then ⏎`);
  if (q.kind === "file" && String(row.data).endsWith("/")) return host.dispatch.press("bar.open", { scope: ASK_SCOPE, query: String(row.data) });
  formSet(q.name, row.key === "leave" ? undefined : String(row.data), true);
  if (how.alt) { await refused(); return formRun(); }
  return again({ answered: q.name, line: lineOf(w) });
}
