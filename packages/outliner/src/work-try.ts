// What to try, for validation (PIE-1258, pie's "Jev first": "Jev writes what to try from the ticket's purpose, so the
// agent skips reading code cold"). Jev selects, it doesn't write: for each merged ticket, code finds the candidates (the
// door's actions whose own descriptions share the ticket's words, and the ticket's lines that say what someone opens,
// sees or does), Jev answers one Noul per candidate in one request (would someone checking it use this action? does this
// line say what should show?), and code lays out the journeys in the parts' own words: the action's summary, its keys
// and its `ep0ch act` call, and the ticket's line as what should show. A ticket that yields none is a finding: it never
// said what Evan opens and does. The plan goes to the verifier, who drives the app from it; Evan never gets it as a job.
import { noteStructure } from "@ep0ch/outline-core/component-block";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { searchFold } from "@ep0ch/outline-core/search-match";
import { workIdOf } from "@ep0ch/outline-core/work-id-title";
import { askNouls, clip, jevWho, noul, recordRun, YES, type JevOptions, type JevReading, type WorkJevClient } from "./work-jev";
import { itemTitle } from "./work-twins";
import type { Block } from "./types";

const LOOP = "work-try";
const MAX_ACTIONS = 8, MAX_LINES = 6, KEEP = 3;
const FILLER = new Set("the and for with that this from into when then than what which where while have has had will would should could does done make made each every more most only also just their there they them its it's not but are was were been being your you about over under after before once again here".split(" "));
/** A line that says what someone opens, sees or does once it works. */
const EXPERIENCE = /\b(?:opens?|sees?|shows?|draws?|reads?|clicks?|types?|press(?:es)?|finds?|gets?|lands?|can|says?|done[- ]when)\b/i;

/** An action as the door describes it (its `ActionInfo`): the parts describe themselves, and this reads that. */
export interface TryAction { name: string; summary: string; keys?: string; examples?: readonly { act: string; does: string }[] }

export interface Journey { action: TryAction; p?: number }
export interface TicketPlan {
  ticket: string;
  title: string;
  journeys: Journey[];
  shows: { line: string; p?: number }[];
  /** `jev` when Jev chose; `text` when the matcher's best were taken (Jev off or unreachable). */
  by: "jev" | "text";
}

const terms = (text: string) => new Set(searchFold(text).split(" ").filter(t => t.length >= 4 && !FILLER.has(t) && !/^\d+$/.test(t)));

/** The ticket's lines that may say what should show: outside code and components, past the title. Pure. */
export function experienceLines(text: string): string[] {
  const lines = text.split("\n"), structure = noteStructure(lines), title = headerLine(text).line;
  return lines.flatMap((line, i) => {
    const flat = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").replace(/\[[^\]]+::[^\]]*\]/g, "").trim();
    return i > title && structure[i] === -1 && flat.length >= 12 && EXPERIENCE.test(flat) ? [clip(flat, 240)] : [];
  }).slice(0, MAX_LINES);
}

/** The actions sharing most of the ticket's words, by their own name, summary and examples. Pure. */
export function actionCandidates(ticket: Pick<Block, "text" | "properties">, actions: readonly TryAction[]): { action: TryAction; shared: number }[] {
  const want = terms(`${itemTitle(ticket)} ${experienceLines(ticket.text).join(" ")}`);
  return actions.map(action => {
    const has = terms(`${action.name.replace(/[.-]/g, " ")} ${action.summary} ${(action.examples ?? []).map(e => e.does).join(" ")}`);
    return { action, shared: [...want].filter(t => has.has(t)).length };
  }).filter(c => c.shared > 0).sort((a, b) => b.shared - a.shared || a.action.name.localeCompare(b.action.name)).slice(0, MAX_ACTIONS);
}

export interface TryReport { plans: TicketPlan[]; tokens: number; jev: string; reading?: JevReading }

/** The plan for a batch of tickets: one Jev request per ticket. Reads only. */
export async function planTries(tickets: readonly Block[], actions: readonly TryAction[], o: JevOptions & { jev?: boolean } = {}): Promise<TryReport> {
  const plans: TicketPlan[] = [];
  let tokens = 0, jev = o.jev === false ? "off" : "not asked", reading: JevReading | undefined;
  for (const t of tickets) {
    const ticket = workIdOf(t) ?? t.id.slice(0, 8), title = itemTitle(t);
    const acts = actionCandidates(t, actions), lines = experienceLines(t.text);
    const fallback = (): TicketPlan => ({ ticket, title, journeys: acts.slice(0, 2).map(c => ({ action: c.action })), shows: lines.slice(0, 2).map(line => ({ line })), by: "text" });
    if (o.jev === false || (!acts.length && !lines.length)) { plans.push(fallback()); continue; }
    const questions = Object.fromEntries([
      ...acts.map((c, i) => [`tries::${i}`, { ask: "tries" as const, candidate: JSON.stringify({ action: c.action.name, does: c.action.summary, ...(c.action.keys ? { keys: c.action.keys } : {}) }) }] as const),
      ...lines.map((line, i) => [`shows::${i}`, { ask: "shows" as const, candidate: JSON.stringify(line) }] as const),
    ]);
    const body = clip(t.text.split("\n").slice(headerLine(t.text).line + 1).join("\n"), 1200);
    const asked = await askNouls({ ticket: { id: ticket, title, body } }, questions, o);
    if ("unavailable" in asked) { jev = asked.unavailable; plans.push(fallback()); continue; }
    jev = "asked"; reading = asked.reading; tokens += asked.reading.usage?.input ?? 0;
    const scored = acts.map((c, i) => ({ action: c.action, p: noul(asked.answers, `tries::${i}`) ?? 0 })).sort((a, b) => b.p - a.p);
    // Yes, else the best one Jev leans toward (between the thresholds), so the validator has a place to start.
    const journeys = scored.filter(j => j.p >= YES).slice(0, KEEP);
    if (!journeys.length && scored[0] && scored[0].p >= 0.5) journeys.push(scored[0]);
    const shows = lines.map((line, i) => ({ line, p: noul(asked.answers, `shows::${i}`) })).filter(s => (s.p ?? 0) >= YES).sort((a, b) => b.p! - a.p!).slice(0, KEEP);
    plans.push({ ticket, title, journeys, shows, by: "jev" });
  }
  return { plans, tokens, jev, ...(reading ? { reading: { ...reading, usage: { input: tokens, output: 0 } } } : {}) };
}

/** The plan as a note's body (Blockdown): a heading per ticket, a box per journey, what should show under it. */
export function tryMarkdown(report: TryReport): string {
  const out: string[] = [];
  for (const p of report.plans) {
    out.push(`## [[${p.ticket}]] ${p.title}`);
    if (!p.journeys.length && !p.shows.length) {
      out.push("- [ ] **Finding:** the ticket never says what Evan opens and does, and no action reads like it: drive it from its purpose, and say what's missing");
      out.push("");
      continue;
    }
    for (const j of p.journeys) {
      const a = j.action, example = a.examples?.[0];
      out.push(`- [ ] **Try:** ${a.summary.split(/[.;:]\s/)[0]}${a.keys ? ` · keys ${a.keys}` : ""} · \`ep0ch act ${example ? example.act : a.name}\`${j.p !== undefined && j.p < YES ? " (a place to start: Jev leans to it, unsure)" : ""}`);
    }
    if (!p.journeys.length) out.push("- [ ] **Try:** no action reads like it; open what the line below names, by mouse and by keys");
    for (const s of p.shows) out.push(`  - **Should show:** ${s.line}`);
    if (p.by === "text") out.push("  - (text matches: Jev wasn't asked)");
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/** Keeps the plan in `into` as a `[type::validation-plan]` note, and the pass's run. Returns the note's id. */
export async function keepTries(into: WorkJevClient, report: TryReport, o: { batch?: string } = {}): Promise<{ note: string; run: string }> {
  const when = new Date().toISOString().slice(0, 16);
  const tickets = report.plans.map(p => p.ticket);
  const text = [
    `What to try: ${clip(tickets.join(", "), 60)} [type::validation-plan] [tickets::${tickets.join(" ")}]${o.batch ? ` [batch::${o.batch}]` : ""}`,
    "",
    "> [!summary] The journeys a validator drives for this batch, from each ticket's purpose.",
    "> Jev chose the actions and the lines; the words are the actions' own and the tickets'. Use them together, as Evan's day would.",
    "",
    tryMarkdown(report),
  ].join("\n");
  const note = await into.request<Block>({ action: "create", text, parentId: null, ...jevWho(LOOP) });
  const run = await recordRun(into, LOOP, when, { items: report.plans.length, suggested: report.plans.filter(p => p.journeys.length || p.shows.length).length }, report.reading);
  return { note: note.id, run };
}
