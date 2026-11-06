// The write review's asks kept as properties (PIE-1612). `settle`: a note an agent wrote has gone quiet, so the service
// reads it (`blocks.asks`: the review's candidates, prompt and thresholds) and each line that asks gets a chip with a
// mark beside it. `clear` and `reply`: a tick, a reply or done takes a marked chip off. Each line is written once: a
// record under this extension's page remembers it, so a chip you removed never comes back.
import { outline } from "./outline";
import { carries, chipFor, hashOf, isAnswered, isMarked, linesUnder, withMark, withoutMark, wordsOf } from "./asks-line";

interface Block { id: string; revision: number; text: string; parentId?: string | null; properties?: { key: string; value: string }[] }
interface Reading { line: number; text: string; noul: number; reads: "yes" | "unsure" | "no"; top: boolean }
interface Request {
  operation: "act";
  input: {
    action: "settle" | "clear" | "reply";
    target: { blockId: string; revision: number };
    args?: { dry?: string };
    requestedBy?: { author: "user" | "agent"; actorId?: string };
  };
}

const { input } = (await Bun.stdin.json()) as Request;
const done = (message: string, extra: Record<string, unknown> = {}) => process.stdout.write(JSON.stringify({ ok: true, value: { message, ...extra } }));

const prop = (block: Block, key: string) => block.properties?.find(p => p.key === key)?.value;
/** What this extension wrote on a note: each line's hash, and how many lines sat under it then. */
async function records(note: string): Promise<Map<string, number>> {
  const { blocks } = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `asks.note=${note}`, machinery: "show", limit: 200 } });
  return new Map(blocks.flatMap(b => { const line = prop(b, "asks.line"); return line ? [[line, Number(prop(b, "asks.under") ?? 0)] as const] : []; }));
}

async function settle(note: string, dry: boolean): Promise<void> {
  const read = await outline<{ revision: number; text: string; jev: string; lines: Reading[] }>({ action: "blocks.asks", blockId: note }, { timeoutMs: 30_000 });
  if (read.jev !== "asked") return done(`not asked: ${read.jev}`);
  const lines = read.text.split("\n");
  const wanted = read.lines.filter(l => (l.reads === "yes" && !l.top) || l.reads === "unsure").filter(l => carries(lines[l.line]!));
  if (!wanted.length) return done("nothing asks here");
  const seen = await records(note);
  const fresh = wanted.filter(l => !seen.has(hashOf(lines[l.line]!)));
  if (!fresh.length) return done("already marked once");
  const said = fresh.map(l => `L${l.line + 1} ${l.reads === "yes" ? "needs" : "maybe-needs"} (${l.noul.toFixed(2)}): ${wordsOf(lines[l.line]!)}`);
  if (dry) return done(`would write ${fresh.length}\n${said.join("\n")}`);
  const made = fresh.map(l => ({ under: linesUnder(lines, l.line), hash: hashOf(lines[l.line]!), words: wordsOf(lines[l.line]!) }));
  for (const l of fresh) lines[l.line] = withMark(lines[l.line]!, chipFor(l.reads as "yes" | "unsure", lines[l.line]!));
  const written = await outline<{ outcome?: string }>({ action: "update", blockId: note, expectedRevision: read.revision, text: lines.join("\n") });
  // Held by a door's typing: a proposal beside the note, and the next settle sends the same one, so nothing is remembered yet.
  if (written.outcome === "proposed") return done(`proposed ${fresh.length}: you were typing there`);
  const page = await outline<{ block?: { id: string } }>({ action: "pages.resolve", address: "ext-asks" });
  for (const r of made) {
    await outline({ action: "create", ...(page.block ? { parentId: page.block.id } : {}), text: `${r.words} [machine::asks] [ext.generated::asks] [asks.note::${note}] [asks.line::${r.hash}] [asks.under::${r.under}]` });
  }
  done(`wrote ${fresh.length}\n${said.join("\n")}`);
}

const isDone = (block: Block) => (block.properties ?? []).some(p => (
  (p.key === "status" && p.value === "done") || (p.key === "outbox" && p.value === "done") || (p.key === "work-stage" && (p.value === "done" || p.value === "superseded"))));

async function takeOff(block: Block, which: (line: string, i: number, lines: readonly string[]) => boolean, why: string): Promise<void> {
  const lines = block.text.split("\n");
  let n = 0;
  const next = lines.map((line, i) => { if (!isMarked(line) || !which(line, i, lines)) return line; n++; return withoutMark(line); });
  if (!n) return done("nothing to take off");
  await outline({ action: "update", blockId: block.id, expectedRevision: block.revision, text: next.join("\n") });
  done(`took ${n} off: ${why}`);
}

async function clear(note: string): Promise<void> {
  const block = await outline<Block>({ action: "get", blockId: note });
  if (isDone(block)) return takeOff(block, () => true, "the note is done");
  const seen = input.requestedBy?.author === "user" ? await records(note) : new Map<string, number>();
  const replied = (line: string, i: number, lines: readonly string[]) => input.requestedBy?.author === "user" && linesUnder(lines, i) > (seen.get(hashOf(line)) ?? 0);
  return takeOff(block, (line, i, lines) => isAnswered(line) || replied(line, i, lines), "ticked or replied to");
}

interface Thread { block: { id: string }; originalTarget?: { anchor?: { kind: string; exact?: string } }; resolvedTarget?: { anchor?: { kind: string; exact?: string } } | null; replies?: { block: { id: string } }[] }

/** A comment on a marked line answers that mark; a comment on the whole note answers them all. */
async function reply(mark: string): Promise<void> {
  let at = await outline<Block>({ action: "get", blockId: mark });
  while (at.parentId && /\[type::annotation(?:-reply)?\]/.test(at.text)) at = await outline<Block>({ action: "get", blockId: at.parentId });
  if (!at.text.includes("[asks.derived::")) return done("nothing to take off");
  const threads = await outline<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: at.id } } });
  const thread = threads.find(t => t.block.id === mark || t.replies?.some(r => r.block.id === mark));
  const anchor = thread?.resolvedTarget?.anchor ?? thread?.originalTarget?.anchor;
  const quote = anchor?.kind === "text-quote" ? anchor.exact?.trim() : undefined;
  if (!quote) return takeOff(at, () => true, "you commented on the note");
  return takeOff(at, line => line.includes(quote) || quote.includes(wordsOf(line)), "you commented on the line");
}

if (input.action === "settle") await settle(input.target.blockId, input.args?.dry === "yes");
else if (input.action === "clear") await clear(input.target.blockId);
else await reply(input.target.blockId);
