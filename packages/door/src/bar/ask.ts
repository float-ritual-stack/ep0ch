// The power bar asks for what an action needs and wasn't given (PIE-784): an extension's declared arguments (a sort's
// by and order) and the door's own (where a quote of marks goes). One question at a time in the bar's `ask` scope (`?`),
// its choices as rows (the value it has now first); a number or text is what's typed; a note is a choice or any note
// the outline's search finds as the person types. ⏎ answers it; the next question opens, or the action runs.
// An agent is never asked: it names what it means, or the action takes its default.
import { ActionRefused } from "../surface/actions";
import type { Actor } from "../socket";
import { noteLabel } from "../board";
import { registerBarSource, unregisterBarSource, type BarRow, type BarSource } from "./source";

/** One question: an extension's argument with its choices, or the door's own. */
export interface BarQuestion {
  name: string;
  /** `note`: one of `choices`, or a note found by its words (answered with its id). */
  type: "text" | "choice" | "property" | "number" | "note";
  label?: string;
  description?: string;
  choices?: string[];
  options?: string[];
  /** The words a choice is shown as (`inbox` as "the Inbox"). */
  says?: Record<string, string>;
  value?: string;
}

const ASK_SCOPE = "ask";
/** The action waiting on the person's answers: the next question is the first not answered. */
let waiting: { title: string; questions: BarQuestion[]; answers: Record<string, string>; run: (answers: Record<string, string>) => Promise<unknown> } | null = null;

/** The question asked now, or null. */
const question = () => waiting?.questions.find(q => waiting!.answers[q.name] === undefined) ?? null;

/** The bar's host as asking needs it: the person's dispatcher, to open the bar. */
interface AskCtx { dispatch?: { act(req: { action: string; args: Record<string, unknown> }, actor: Actor): Promise<unknown> } }

/**
 * Ask the person, in the power bar, each of `questions` not in `given`, then `run` with every answer. Answers at once
 * with what it's asking; the action runs when the last is answered (or never, when the bar is put away).
 */
export async function askInBar<R>(ctx: AskCtx, title: string, questions: readonly BarQuestion[], given: Record<string, string>, actor: Actor, run: (answers: Record<string, string>) => Promise<R>): Promise<R | { asking: string; action: string }> {
  const open = questions.filter(q => given[q.name] === undefined);
  if (actor.kind !== "user" || !open.length || !ctx.dispatch) return run(given);
  waiting = { title, questions: [...questions], answers: { ...given }, run: answers => run(answers) };
  registerBarSource(ASK_SOURCE);
  await ctx.dispatch.act({ action: "bar.open", args: { scope: ASK_SCOPE } }, actor);
  return { asking: open[0]!.name, action: title };
}

const ASK_SOURCE: BarSource = {
  id: ASK_SCOPE, title: "ask", prefix: "?", by: "door",
  about: "what an action you ran asks for (a sort's by and order, where a quote goes): ⏎ on a choice answers it, then the next, then the action runs",
  main: { empty: false, typed: false },
  rows(query, host) {
    const q = question();
    if (!q || !waiting) return [];
    const head = `${waiting.title} · ${q.label ?? q.name}`;
    const typed = query.trim();
    if (q.type === "text" || q.type === "number") {
      const value = typed || q.value;
      return value === undefined ? [] : [{ key: `answer:${value}`, label: value, detail: head, group: head, data: value }];
    }
    const choices = [...new Set([...(q.value !== undefined ? [q.value] : []), ...(q.choices ?? q.options ?? [])])];
    const words = typed.toLowerCase();
    const rows: BarRow[] = choices.filter(c => !words || c.toLowerCase().includes(words) || q.says?.[c]?.toLowerCase().includes(words))
      .map(c => ({ key: `answer:${c}`, label: q.says?.[c] ?? c, detail: c === q.value ? "now" : undefined, group: head, data: c }));
    // A note: any the outline's search finds by the words typed, nearer the note in front first. The rest answer at once.
    if (q.type !== "note" || typed.length < 2) return rows;
    return host.ctx.board.search(typed, 20, { near: host.near() ?? undefined }).then(found => [
      ...rows, ...found.map(m => ({ key: `answer:${m.id}`, label: noteLabel(m), detail: "under this note", group: `${head} · notes`, data: m.id })),
    ]);
  },
  preview(row) {
    const q = question();
    if (!q || !waiting) return null;
    if (q.type === "note" && !(q.choices ?? []).includes(String(row.data))) return { note: String(row.data) };
    return { markdown: [`**${waiting.title}** asks for **${q.label ?? q.name}**`, "", q.description ?? "", "", ...waiting.questions.map(x => `- ${x.label ?? x.name}: ${waiting!.answers[x.name] ?? (x === q ? "…" : "next")}`)].join("\n") };
  },
  async pick(row, host, how) {
    const q = question();
    if (!q || !waiting) throw new ActionRefused("nothing is waiting on an answer");
    waiting.answers[q.name] = String(row.data);
    if (question()) return how.actor.kind === "agent" ? { asking: question()!.name } : host.dispatch.press("bar.open", { scope: ASK_SCOPE });
    const done = waiting;
    waiting = null;
    unregisterBarSource(ASK_SCOPE);
    return done.run(done.answers);
  },
};
