// One line asks an agent (PIE-1437): `@loki looking at my notes on [[x]], [[y]] can you pop it into %sometile`, typed
// in the power bar, each reference completed by its own sigil (`@` the agents here, `[[` pages, `((` notes, `%` tiles,
// all through the one completer), and ⏎ sends it. Sending is addressed mail (PIE-1404), the one delivery there is: the
// line becomes a comment naming `@loki` on the note in front of the person, which every session writing as loki hears
// at its addressed check and answers in the thread. Nothing here types into an agent's terminal.
//
// The agents here are the agent panel's (the sessions the door holds that write as a persona) and the outline's agent
// configs that name one: one list, `agentsHere`, for `@`'s completion, `to=`'s values and the bar's rows. A name typed
// whole that isn't listed is sent as typed: the mail reaches that persona wherever it runs (loki on another machine).
import { agentAtCursor, completionTargetAtCursor, type CompletionTarget } from "@ep0ch/outline-core/completion-triggers";
import { PERSONA_PATTERN } from "@ep0ch/outline-core/attribution";
import { ActionRefused, shownLine } from "../surface/actions";
import { headedTitle } from "../board";
import type { Actor } from "../socket";
import { tildeOf } from "../desk/agent-sessions";
import { registerArgKind, type KindValue } from "./arg-kinds";
import { filtered } from "./filter";
import type { BarHost, BarRow, BarSource } from "./source";

/** An ask line: `@name` first, then what's asked. */
const ASK_LINE = /^\s*@([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?)(?:[,:]?\s+([\s\S]*)|[,:]?$)/;

/** The agent an ask line names and what it asks (empty while only the name is typed), or null for any other line. */
export function askOf(line: string): { to: string; text: string } | null {
  const m = ASK_LINE.exec(line);
  return m ? { to: m[1]!, text: (m[2] ?? "").trim() } : null;
}

/**
 * The token the cursor is in on an ask line: the agent's name while it's typed (`@lo`), a `%tile`, or a `[[page` or
 * `((note` (outline-core's detector, the one every editor asks); null on any other line.
 */
export function askTargetAt(line: string, col: number): CompletionTarget | null {
  if (!/^\s*@/.test(line)) return null;
  const agent = agentAtCursor(line, col);
  if (agent) return { kind: "agent", ...agent };
  const before = line.slice(0, col), tile = /(?:^|\s)%([^\s%]*)$/.exec(before);
  if (tile) return { kind: "tile", start: col - tile[1]!.length - 1, end: col + /^\S*/.exec(line.slice(col))![0].length, query: tile[1]! };
  const t = completionTargetAtCursor(line, col);
  return t && (t.kind === "page" || t.kind === "block") ? t : null;
}

const CONFIGS_MS = 5000;
let configsRead: { layer: unknown; at: number; read: Promise<{ name: string; persona?: string }[]> } | null = null;

/**
 * The agents here, by persona: the sessions the door holds that write as one (the agent panel's rows, what each is
 * doing), then the outline's agent configs that name one and aren't running here.
 */
export async function agentsHere(host: BarHost): Promise<KindValue[]> {
  const layer = host.ctx.hostLayer, out = new Map<string, KindValue>();
  // The agent configs are an outline query: read once a few seconds, not on every key while a name is typed.
  const now = Date.now();
  if (!configsRead || configsRead.layer !== layer || now - configsRead.at > CONFIGS_MS) configsRead = { layer, at: now, read: layer?.programs?.().catch(() => []) ?? Promise.resolve([]) };
  const configs = await configsRead.read;
  for (const s of layer?.sessions?.() ?? []) {
    if (!s.persona || !PERSONA_PATTERN.test(s.persona) || out.has(s.persona)) continue;
    out.set(s.persona, { value: s.persona, label: `@${s.persona}`, detail: `${s.program} in ${tildeOf(s.folder)} · ${s.word}` });
  }
  for (const c of configs) {
    if (!c.persona || !PERSONA_PATTERN.test(c.persona) || out.has(c.persona)) continue;
    out.set(c.persona, { value: c.persona, label: `@${c.persona}`, detail: `agent config ${c.name} · no session here` });
  }
  return [...out.values()];
}

registerArgKind("agent", async (typed, host) => filtered(await agentsHere(host), typed.replace(/^@/, ""), r => [r.value, r.detail ?? ""]));

/** The `%tile` words of a line, each once. */
const tilesIn = (text: string) => [...new Set([...text.matchAll(/(?:^|\s)%([^\s%]+)/g)].map(m => m[1]!.replace(/[.,;:!?)]+$/, "")))];
/** The first `[[page]]` or `((note))` a line names, as written. */
const firstRef = (text: string) => /\[\[([^\]]+)\]\]|\(\(([^)]+)\)\)/.exec(text)?.[0] ?? null;

export interface Asked { to: string; note: string; title: string; thread: string; tiles: string[]; heard: string }

/**
 * Ask `to`: the words as a comment naming `@to` on `note` (left out: the note in front of the person, else the first note
 * the words link to), with a line naming each `%tile` as the door has it, so the agent can act on it (`door_act tile=`).
 */
export async function askAgent(host: BarHost, o: { to: string; text: string; note?: string }, actor: Actor): Promise<Asked> {
  const to = o.to.trim().replace(/^@/, "");
  if (!PERSONA_PATTERN.test(to) || !to) throw new ActionRefused(`to=${JSON.stringify(o.to)} isn't a persona name (letters, digits, . _ -): to=loki`);
  let words = o.text.trim();
  if (askOf(words)?.to === to) words = askOf(words)!.text;
  if (!words) throw new ActionRefused(`what should @${to} do? text="…" (in the bar: @${to} and then the words)`);
  const board = host.ctx.board;
  const named = o.note?.trim() || (actor.kind === "agent" ? null : host.near()) || firstRef(words);
  if (!named) throw new ActionRefused(`the ask goes as a comment on a note: open one, name one in the words ([[page]] or ((id))), or give note=`);
  const [hit] = await board.resolveRefs([named]);
  if (!hit?.id) throw new ActionRefused(`note=${named}: ${hit?.error ?? "no such note"}`);
  const note = await host.note(hit.id);
  if (!note) throw new ActionRefused(`note=${named} is gone (in the Trash?)`);
  const { shownTileRows } = await import("./sources");
  const tiles = tilesIn(words);
  const tileLines = tiles.map(name => {
    const row = shownTileRows(host, name).find(r => (r.fill ?? r.label) === name);
    return `- %${name}: ${row ? `the tile ${name} in the door${row.detail ? ` (${row.detail})` : ""}` : `no tile ${name} on the screen shown now`} · door_act tile=${name}`;
  });
  const body = [`@${to} ${words}`, ...(tileLines.length ? ["", ...tileLines] : [])].join("\n");
  const receipt = await board.comment(crypto.randomUUID(), note.id, note.revision ?? 0, body, null, actor);
  const title = headedTitle(note);
  return { to, note: note.id, title, thread: receipt.id, tiles, heard: `a comment naming @${to}: each session writing as ${to} hears it at its next addressed check (the Claude mod's settle clock) and answers in the thread` };
}

/** What an ask did, in words: who, on which note, and when it's heard. */
export const askedWords = (a: Asked) => `· asked @${a.to} on ${a.title} · a comment there: @${a.to} hears it at its next check and answers in the thread`;

/** The row a typed ask line is: ⏎ (or a click) sends it. */
function askRow(a: { to: string; text: string }): BarRow {
  return { key: `ask:${a.to}`, label: `ask @${a.to}`, detail: a.text.length > 60 ? `${a.text.slice(0, 59)}…` : a.text, exact: true, data: a };
}

/**
 * The power bar's `@`: an ask line typed on the line is one row, ⏎ sends it (`agent.ask`); with only `@` and part of a
 * name, the agents here (a pick puts `@name ` on the line). Its prefix stays on the line as typed (`inline`), so the
 * words after it complete as any line's do.
 */
export const AGENTS: BarSource = {
  id: "agents", title: "agents", prefix: "@", inline: true, by: "door",
  about: "ask an agent: @name and what you ask, [[pages]], ((notes)) and %tiles completed as you type; ⏎ sends it as a comment naming @name on the note in front of you (agent.ask), which that agent's sessions hear and answer in the thread",
  main: { empty: false, typed: true, most: 6 },
  named(query) { const a = askOf(query); return a?.text ? askRow(a) : null; },
  async rows(q, host, scope) {
    const a = askOf(scope === "agents" && !q.trimStart().startsWith("@") ? `@${q}` : q) ?? ((scope === "agents" && !q.trim()) || q.trim() === "@" ? { to: "", text: "" } : null);
    if (!a) return [];
    if (a.text) return [askRow(a)];
    return filtered(await agentsHere(host), a.to, r => [r.value, r.detail ?? ""]).map(v => ({ key: `agent:${v.value}`, label: v.label, fill: `@${v.value} `, ...(v.detail ? { detail: v.detail } : {}), data: { to: v.value, text: "" } }));
  },
  async preview(row, host) {
    const a = row.data as { to: string; text: string };
    if (!a.text) return { markdown: `**@${a.to}**\n\n${row.detail ?? ""}\n\n⏎ puts @${a.to} on the line: type what to ask, then ⏎ sends it.` };
    const near = host.near(), note = near ? await host.note(near).catch(() => null) : null;
    return { markdown: `**Ask @${a.to}**\n\n> @${a.to} ${a.text}\n\nSent as a comment on ${note ? `**${headedTitle(note)}**` : "the first note it links to"}; @${a.to}'s sessions hear it at their addressed check and answer in the thread.` };
  },
  // The note it lands on goes in the line, so the copy runs the same ask from a shell or an agent.
  command: (row, host) => { const a = row.data as { to: string; text: string }, note = host.near(); return a.text ? shownLine("agent.ask", { to: a.to, text: a.text, ...(note ? { note } : {}) }) : null; },
  pick(row, host, how) {
    const a = row.data as { to: string; text: string };
    if (!a.text) {
      if (how.actor.kind === "agent") throw new ActionRefused(`what should @${a.to} do? agent.ask to=${a.to} text="…"`);
      return host.dispatch.as(how.actor, { action: "bar.open", args: { query: `@${a.to} ` } });
    }
    return host.dispatch.as(how.actor, { action: "agent.ask", args: { to: a.to, text: a.text } });
  },
};
