// The write review's asks kept as properties (PIE-1612). `settle`: a note an agent wrote has gone quiet, so the service
// reads it (`blocks.asks`: code, then Jev), a bigger model confirms what Jev passes (PIE-1620), and each line that asks
// gets a chip with a mark beside it. `clear` and `reply`: a tick, a reply or done takes a marked chip off. Each line is written once: a
// record under this extension's page remembers it, so a chip you removed never comes back.
import { join } from "node:path";
import { outline } from "./outline";
import { confirmPrompt, verdicts } from "./asks-confirm";
import { aboutLines, chippedLines, declineKey, hashOf, isAnswered, isClosed, linePatches, linesUnder, marksIn, withMark, withoutMarks, wordsOf, unchangedLines, type Anchor, type Mark } from "./asks-line";

interface Block { id: string; revision: number; text: string; parentId?: string | null; properties?: { key: string; value: string }[] }
interface Reading { line: number; text: string; noul: number; reads: "yes" | "unsure" | "no"; top: boolean }
interface Request {
  operation: "act";
  input: {
    action: "settle" | "clear" | "reply";
    target: { blockId: string; revision: number };
    args?: { dry?: string; sure?: string };
    requestedBy?: { author: "user" | "agent"; actorId?: string };
  };
  config?: { answer?: string[] };
}

const { input, config } = (await Bun.stdin.json()) as Request;
const done = (message: string, extra: Record<string, unknown> = {}) => process.stdout.write(JSON.stringify({ ok: true, value: { message, ...extra } }));

/** A message holds at most this (the service refuses more); the whole list goes in `answer`, for whoever asked. */
const MESSAGE = 500;
/** The list as far as a message holds it, cut at a line, with how many more; whole in `answer`. */
const listed = (head: string, said: readonly string[]) => {
  const whole = [head, ...said].join("\n");
  if (whole.length <= MESSAGE) return { message: whole, answer: whole };
  let message = head, shown = 0;
  while (shown < said.length && `${message}\n${said[shown]}\n+${said.length} more`.length <= MESSAGE) message += `\n${said[shown++]}`;
  return { message: `${message}\n+${said.length - shown} more`, answer: whole };
};

const prop = (block: Block, key: string) => block.properties?.find(p => p.key === key)?.value;
const recordsOf = async (note: string) => (await outline<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `asks.note=${note}`, machinery: "show", limit: 200 } })).blocks;
/** The lines the model said no to on this note, by `declineKey`: its word, kept apart from a mark, which is yours to take off for good. */
const declinedOf = (blocks: readonly Block[]) => new Set(blocks.flatMap(block => { const key = prop(block, "asks.declined"); return key ? [key] : []; }));
/** The lines this extension marked on a note, by each line's hash: how many lines sat under it when it last looked. */
async function records(note: string, blocks?: readonly Block[]): Promise<Map<string, { block: Block; under: number }>> {
  blocks ??= await recordsOf(note);
  return new Map(blocks.flatMap(block => { const line = prop(block, "asks.line"); return line ? [[line, { block, under: Number(prop(block, "asks.under") ?? 0) }] as const] : []; }));
}

/**
 * The change as `draft.patch` with deferred delivery: while Evan types in that passage it waits as a proposal beside the
 * note instead of being refused, with nobody here to retry.
 */
async function patch(block: { id: string; revision: number; text: string }, next: string): Promise<"applied" | "proposed"> {
  const { outcome } = await outline<{ outcome: "applied" | "proposed" }>({ action: "draft.patch", blockId: block.id, revision: block.revision, current: true, propose: "on-conflict", patches: linePatches(block.text, next.split("\n")) });
  return outcome;
}

// The model is a command (prompt on stdin, JSON on stdout): config.answer in this copy's config.json, else the schema's
// default, read from extension.json so the door's settings say what actually runs.
const DEFAULT_ANSWER: string[] = (await Bun.file(join(import.meta.dir, "extension.json")).json()).configSchema.properties.answer.default;
/** How long the model gets to answer for one note. */
const MODEL_MS = 120_000;
const FIX = `ep0ch act ext.asks.settings answer='/full/path/to/claude ${DEFAULT_ANSWER.slice(1).map(a => (a === "" || /\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}', or sign in with claude`;

/**
 * The bigger model's word on the lines Jev passed, one call for the note. It throws when there's no word, as the run's
 * error: a failed call is never a yes or a no, so nothing is written and the next save asks again.
 */
async function confirm(text: string, passed: readonly number[]): Promise<Map<number, boolean>> {
  const command = config?.answer ?? DEFAULT_ANSWER;
  const failed = (why: string) => new Error(`The model couldn't confirm, so nothing was written: ${why}. To fix: ${FIX}`);
  if (!command.length) throw failed("config.answer is empty");
  const ran = command.join(" ").slice(0, 100);
  let proc;
  try { proc = Bun.spawn(command, { stdin: new Blob([confirmPrompt(text, passed)]), stdout: "pipe", stderr: "pipe", timeout: MODEL_MS, cwd: import.meta.dir }); }
  catch (e) { throw failed(`${ran} couldn't start (${(e as Error).message})`); }
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw failed(`${ran} exited ${code}${err.trim() ? `, saying "${err.trim().split("\n")[0]!.slice(0, 120)}"` : ""}`);
  try { return verdicts(out, passed); }
  catch (e) { throw failed(`${ran}: ${(e as Error).message}`); }
}

interface Written { id: string; author?: string; createdAt?: string }
interface Thread { block: Written; resolvedTarget?: { anchor?: Anchor } | null; replies?: { block: Written }[] }

/**
 * The lines you've answered (PIE-1620): each still as it was at your last save (a tick is one) or comment on the whole
 * note, and the lines a comment of yours is on. You've seen those; what an agent wrote since can still ask.
 */
async function answeredLines(note: string, text: string): Promise<Set<number>> {
  const { revisions } = await outline<{ revisions: { revision: number; savedAt: string; author?: string }[] }>({ action: "block.revisions", blockId: note }); // Newest first.
  const threads = await outline<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note }, includeResolved: true } });
  const yours = threads.flatMap(t => [t.block, ...(t.replies ?? []).map(r => r.block)].filter(b => b.author === "user").map(b => ({ at: Date.parse(b.createdAt ?? ""), anchor: t.resolvedTarget?.anchor })));
  const lastWhole = Math.max(0, ...yours.filter(c => c.anchor?.kind === "whole-subject").map(c => c.at));
  const onWhole = lastWhole ? revisions.find(r => Date.parse(r.savedAt) <= lastWhole)?.revision ?? 0 : 0;
  const seen = Math.max(revisions.find(r => r.author === "user")?.revision ?? 0, onWhole);
  const out = seen ? unchangedLines((await outline<{ text: string }>({ action: "block.revisions", blockId: note, revision: seen })).text, text) : new Set<number>();
  const lines = text.split("\n");
  for (const { anchor } of yours) {
    if (anchor?.kind === "whole-subject") continue;
    const about = aboutLines(anchor, text);
    if (about) lines.forEach((_, i) => { if (about(i, lines)) out.add(i); });
  }
  return out;
}

async function settle(note: string, dry: boolean, sure: boolean): Promise<void> {
  const block = await outline<Block>({ action: "get", blockId: note });
  if (isClosed(block.properties)) return done("left out: the note is closed");
  const read = await outline<{ revision: number; text: string; jev: string; lines: Reading[] }>({ action: "blocks.asks", blockId: note }, { timeoutMs: 110_000 });
  if (read.jev !== "asked") return done(`not asked: ${read.jev}`);
  const lines = read.text.split("\n");
  const chipped = chippedLines(read.text);
  const wanted = read.lines.filter(l => (l.reads === "yes" && !l.top) || (l.reads === "unsure" && !sure)).filter(l => !chipped.has(l.line));
  if (!wanted.length) return done("nothing asks here");
  const written = await recordsOf(note);
  const seen = await records(note, written), declined = declinedOf(written);
  const unseen = wanted.filter(l => !seen.has(hashOf(lines[l.line]!)) && !declined.has(declineKey(lines, l.line)));
  if (!unseen.length) return done("already marked or turned down once");
  const yours = await answeredLines(note, read.text);
  const fresh = unseen.filter(l => !yours.has(l.line));
  if (!fresh.length) return done("nothing asks here: you've answered what's left");
  // Only what Jev passed goes up, last, once everything code can rule out is out. Jev's unsure band stays a maybe, unconfirmed.
  const passed = fresh.filter(l => l.reads === "yes").map(l => l.line);
  const word = passed.length ? await confirm(read.text, passed) : new Map<number, boolean>();
  const kept = fresh.filter(l => l.reads !== "yes" || word.get(l.line));
  const struck = fresh.filter(l => l.reads === "yes" && !word.get(l.line));
  const said = kept.map(l => `L${l.line + 1} ${l.reads === "yes" ? "needs" : "maybe-needs"} (${l.noul.toFixed(2)}): ${wordsOf(lines[l.line]!)}`);
  const down = struck.map(l => `turned down: L${l.line + 1} (${l.noul.toFixed(2)}): ${wordsOf(lines[l.line]!)}`);
  const withDown = (answer: string) => [answer, ...down].join("\n");
  // A dry run lists what the write would do. Past it, a line turned down is remembered like a marked one: every later save isn't another call.
  const page = dry ? { block: undefined } : await outline<{ block?: { id: string } }>({ action: "pages.resolve", address: "ext-asks" });
  const record = async (line: number, tail: string) => (await outline<{ id: string }>({ action: "create", ...(page.block ? { parentId: page.block.id } : {}), text: `${wordsOf(lines[line]!)} [machine::asks] [ext.generated::asks] [asks.note::${note}] ${tail}` })).id;
  if (!dry) for (const l of struck) await record(l.line, `[asks.declined::${declineKey(lines, l.line)}]`);
  if (!kept.length) return done(`nothing confirmed: the model turned down ${struck.length}`, { answer: down.join("\n") });
  if (dry) { const { message, answer } = listed(`would write ${kept.length}`, said); return done(message, { answer: withDown(answer) }); }
  // Remembered either way: a proposal Evan dismisses is his answer, and it isn't sent again on the next save. Written before
  // the chips: a save the moment a chip shows is compared with its count, and an agent's line under it updates that count.
  const made: string[] = [];
  for (const l of kept) made.push(await record(l.line, `[asks.line::${hashOf(lines[l.line]!)}] [asks.under::${linesUnder(lines, l.line)}]`));
  for (const l of kept) lines[l.line] = withMark(lines[l.line]!, l.reads as "yes" | "unsure");
  let outcome: "applied" | "proposed";
  try { outcome = await patch({ id: note, revision: read.revision, text: read.text }, lines.join("\n")); }
  catch (error) {
    // Nothing landed: the next save asks again.
    for (const id of made) await outline({ action: "delete", blockId: id });
    throw error;
  }
  const { message, answer } = listed(`${outcome === "proposed" ? "proposed" : "wrote"} ${kept.length}${outcome === "proposed" ? ": you were typing there" : ""}`, said);
  done(message, { answer: withDown(answer) });
}

async function takeOff(block: Block, which: (mark: Mark, lines: readonly string[]) => boolean, why: string): Promise<void> {
  const lines = block.text.split("\n");
  const going = marksIn(block.text).filter(mark => which(mark, lines));
  if (!going.length) return done("nothing to take off");
  const outcome = await patch(block, withoutMarks(block.text, going));
  done(`${outcome === "proposed" ? "proposed taking" : "took"} ${going.length} off: ${why}`);
}

/** How many lines sat under each line, by its hash, in your newest save of the note. */
async function underInYourSave(note: string): Promise<Map<string, number>> {
  const { revisions } = await outline<{ revisions: { revision: number; author?: string }[] }>({ action: "block.revisions", blockId: note });
  const yours = revisions.find(r => r.author === "user")?.revision;
  if (yours === undefined) return new Map();
  const lines = (await outline<{ text: string }>({ action: "block.revisions", blockId: note, revision: yours })).text.split("\n");
  return new Map(lines.map((line, i) => [hashOf(line), linesUnder(lines, i)] as const));
}

async function clear(note: string): Promise<void> {
  const block = await outline<Block>({ action: "get", blockId: note });
  if (isClosed(block.properties)) return takeOff(block, () => true, "the note is done");
  const seen = await records(note), person = input.requestedBy?.author === "user";
  // A run starts after its quiet wait and behind others: an agent may have saved since, so a reply is counted in the text you saved.
  const underYours = person ? await underInYourSave(note) : new Map<string, number>();
  const replied = (i: number, lines: readonly string[]) => (underYours.get(hashOf(lines[i]!)) ?? 0) > (seen.get(hashOf(lines[i]!))?.under ?? 0);
  // An agent's own lines under its ask are no reply: they count as already there, so your next save isn't taken for one.
  if (!person) {
    const lines = block.text.split("\n");
    for (const { line: i } of marksIn(block.text)) {
      const record = seen.get(hashOf(lines[i]!));
      if (record && linesUnder(lines, i) !== record.under) await outline({ action: "update", blockId: record.block.id, expectedRevision: record.block.revision, text: record.block.text.replace(/\[asks\.under::\d+\]/, `[asks.under::${linesUnder(lines, i)}]`) });
    }
  }
  return takeOff(block, ({ line: i }, lines) => isAnswered(lines[i]!) || replied(i, lines), "ticked or replied to");
}


/** A comment on a marked line answers that mark; a comment on the whole note answers them all. */
async function reply(mark: string): Promise<void> {
  let at = await outline<Block>({ action: "get", blockId: mark });
  while (at.parentId && /\[type::annotation(?:-reply)?\]/.test(at.text)) at = await outline<Block>({ action: "get", blockId: at.parentId });
  if (!marksIn(at.text).length) return done("nothing to take off");
  const threads = await outline<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: at.id } } });
  const thread = threads.find(t => t.block.id === mark || t.replies?.some(r => r.block.id === mark));
  const about = aboutLines(thread?.resolvedTarget?.anchor, at.text);
  if (!about) return done("nothing to take off: the comment can't be placed on a line");
  return takeOff(at, ({ line }, lines) => about(line, lines), "you commented on it");
}

if (input.action === "settle") await settle(input.target.blockId, input.args?.dry === "yes", input.args?.sure === "yes");
else if (input.action === "clear") await clear(input.target.blockId);
else await reply(input.target.blockId);
