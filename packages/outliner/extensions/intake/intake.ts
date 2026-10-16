// Intake (PIE-786): prior art for a new request, set off by a rule note, answered by an agent in the note.
//
// - `act` prior-art, on a request (or, from a rule with `rule-batch`, every request a burst brought: `trigger.blocks`):
//   a child under each, "Prior art and related [type::prior-art]", unless one is there already.
//   - Run by a rule (`input.trigger`): the child asks this extension's own agent (`@prior-art what came before
//     ((id))?`), which the service asks at once. A trigger's new block may ask its own extension's agents; nothing it
//     writes sets a rule off again (it carries `[via-trigger::<rule>]`).
//   - Run by hand: no agent; the search runs now and its list is the child's text.
// - `respond` as `@prior-art`: searches this outline (`tree.search`), each outline in `config.outlines` (by name, and
//   on another machine through `machine`), and `config.archive` (a command) for the request's words, and puts what it
//   found in place of the child's "Looking in …" line: links, and a line on likely duplicates. `config.answer` (a
//   command: what was found on stdin, the note's words on stdout) writes that part with a model; without it, the
//   duplicate line comes from the titles alone, and says so.
//
// Self-contained on purpose: an extension folder is copied anywhere, so it imports nothing from the outline's code.
import { hostname } from "node:os";
import { outline, type Route } from "./outline";

interface Block { id: string; text: string; revision: number; parentId?: string | null }
interface Match { block: { id: string; revision: number }; title: string; path?: string; snippet?: string }
interface Config { outlines?: { outline: string; machine?: string }[]; archive?: string[]; answer?: string[]; limit?: number }
interface Request { operation: string; input: Record<string, any>; config?: Config }
interface Hit { title: string; link: string; where: string; score: number }

const request = (await Bun.stdin.json()) as Request;
const config = request.config ?? {};
const LIMIT = Math.min(20, Math.max(1, config.limit ?? 6));
const ok = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const fail = (code: string) => process.stdout.write(JSON.stringify({ ok: false, code }));

/** The note's title, and its first line: `[type::prior-art]` is what a rule's skip and a query find it by. */
const NOTE_TITLE = "Prior art and related";
const NOTE_LINE = `${NOTE_TITLE} [type::prior-art] [machine::intake]`;
const LOOKING = "Looking in ";
const STOP = new Set("a an and are as at be but by can do does for from has have how i if in into is it its not of on or our so that the their them then there these this to too was we were what when where which who why will with would you your again also any just more need needs should some still want".split(" "));

/** A note's title: its first line without property tokens. */
const titleOf = (text: string) => text.split("\n", 1)[0]!.replace(/\[[A-Za-z][\w.-]*::[^\]\n]*\]/g, "").replace(/\s+/g, " ").trim();
/** Words worth searching for, most telling first (longer, then first written). */
const words = (title: string) => [...new Set(title.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])].filter((w) => !STOP.has(w));
const keywords = (title: string) => words(title).map((w, at) => ({ w, at })).sort((a, b) => b.w.length - a.w.length || a.at - b.at).slice(0, 4).map((x) => x.w);
/** How alike two titles are: the share of their words in common (Jaccard). */
function alike(a: string, b: string): number {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}
/** A label safe inside `((id|label))`. */
const label = (title: string) => title.replace(/[|()[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "a note";
const isPriorArt = (text: string) => text.startsWith(NOTE_TITLE);
const here = () => hostname().split(".", 1)[0]!;

/** The places a search looks, as the note says them. */
function places(): string[] {
  return ["this outline", ...(config.outlines ?? []).map((o) => o.machine ? `${o.outline} on ${o.machine}` : o.outline), ...(config.archive?.length ? ["the archive"] : [])];
}

/** One outline's hits for a request's words: each keyword searched, a block scored by how many it holds and how alike its title is. */
async function searchOutline(title: string, skip: ReadonlySet<string>, route: Route | undefined): Promise<Hit[]> {
  const scored = new Map<string, { match: Match; n: number }>();
  for (const word of keywords(title)) {
    const found = await outline<{ matches: Match[] }>({ action: "tree.search", query: word }, route ?? {});
    for (const match of found.matches ?? []) {
      if (skip.has(match.block.id) || isPriorArt(match.title) || /\[(?:rule-name|via-trigger)::/.test(match.snippet ?? "")) continue;
      const known = scored.get(match.block.id);
      if (known) known.n += 1;
      else scored.set(match.block.id, { match, n: 1 });
    }
  }
  const where = route?.outline ? (route.machine ? `${route.outline} on ${route.machine}` : route.outline) : "this outline";
  return [...scored.values()].map(({ match, n }) => {
    const t = titleOf(match.title) || "a note";
    const link = route?.outline
      ? `[${label(t)}](ep0ch://${route.outline}@${route.machine ?? here()}/b/${match.block.id})`
      : `((${match.block.id}|${label(t)}))`;
    return { title: t, link, where, score: n + 2 * alike(title, t) };
  }).filter((hit) => hit.score >= 2 || alike(title, hit.title) >= 0.25).sort((a, b) => b.score - a.score).slice(0, LIMIT);
}

/**
 * The archive's hits: what its command prints, a line each. `{word}` is the request's most telling word, letters,
 * digits and `-` only, so it is one argument even where a remote shell reads the command again (ssh); every word, a
 * line each, is on its stdin. Exit 1 with nothing printed is no hits (grep's and rg's way); any other failure is said.
 */
async function searchArchive(title: string): Promise<string[]> {
  if (!config.archive?.length) return [];
  const all = keywords(title).map((w) => w.replace(/[^a-z0-9-]/g, "")).filter(Boolean);
  if (!all.length) return [];
  const proc = Bun.spawn(config.archive.map((part) => part.replaceAll("{word}", all[0]!)), { stdin: new Blob([`${all.join("\n")}\n`]), stdout: "pipe", stderr: "pipe" });
  let late = false;
  const timer = setTimeout(() => { late = true; proc.kill(); }, 60_000);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (late) throw new Error("the archive command took longer than a minute");
  if (code === 1 && !out.trim()) return [];
  if (code !== 0) throw new Error(`the archive command exited ${code}${err.trim() ? `: ${err.trim().split("\n").at(-1)!.slice(0, 200)}` : ""}`);
  return out.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, LIMIT);
}

/** Everything found for a request, as the note's body: a list per place, then a line on likely duplicates. */
async function findings(request: Block, ask: { model: boolean; words?: string }): Promise<{ body: string; found: number }> {
  const title = ask.words ?? titleOf(request.text);
  if (!keywords(title).length) return { body: "Nothing to search for: the request's title has no words worth looking up.", found: 0 };
  const skip = new Set([request.id]);
  const sections: { where: string; lines: string[]; error?: string }[] = [];
  const all: Hit[] = [];
  const local = await searchOutline(title, skip, undefined).catch((error: Error) => error);
  sections.push(local instanceof Error ? { where: "this outline", lines: [], error: local.message } : { where: "this outline", lines: local.map((h) => `- ${h.link}`) });
  if (!(local instanceof Error)) all.push(...local);
  for (const other of config.outlines ?? []) {
    const where = other.machine ? `${other.outline} on ${other.machine}` : other.outline;
    const hits = await searchOutline(title, skip, { outline: other.outline, ...(other.machine ? { machine: other.machine } : {}), timeoutMs: 30_000 }).catch((error: Error) => error);
    sections.push(hits instanceof Error ? { where, lines: [], error: hits.message } : { where, lines: hits.map((h) => `- ${h.link}`) });
    if (!(hits instanceof Error)) all.push(...hits);
  }
  if (config.archive?.length) {
    const lines = await searchArchive(title).catch((error: Error) => error);
    sections.push(lines instanceof Error ? { where: "the archive", lines: [], error: lines.message } : { where: "the archive", lines: lines.map((l) => `- \`${l.replace(/`/g, "'")}\``) });
  }
  const list = sections.flatMap((s) => [`**In ${s.where}**`, ...(s.error ? [`- couldn't search: ${s.error}`] : s.lines.length ? s.lines : ["- nothing"]), ""]);
  const dupes = all.filter((h) => alike(title, h.title) >= 0.5);
  let verdict = dupes.length
    ? `Likely duplicate${dupes.length === 1 ? "" : "s"}: ${dupes.slice(0, 3).map((h) => h.link).join(", ")} (most of the same words in the title).`
    : all.length ? "No likely duplicates (judged by the titles' words alone)." : "Nothing like this yet.";
  // Only the agent (effects: spend) asks the model; the action run by hand never does.
  if (ask.model && config.answer?.length) verdict = await judged(request, list.join("\n")).catch((error: Error) => `${verdict} The answer command failed: ${error.message}`);
  return { body: [...list, verdict].join("\n").trim(), found: all.length };
}

/** The model's line on what was found: the request and the list on stdin. */
async function judged(request: Block, list: string): Promise<string> {
  const prompt = [
    "A new request arrived in an outline. Below are notes a search found that may be prior art. In at most 80 words of plain",
    "text: say which (if any) look like duplicates of the request and why, and what earlier work it should build on. Keep",
    "the links exactly as written (((id|title)) and [title](ep0ch://…)); write no property syntax.",
    "", "THE REQUEST:", request.text.slice(0, 4_000), "", "WHAT THE SEARCH FOUND:", list,
  ].join("\n");
  const proc = Bun.spawn(config.answer!, { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  let late = false;
  const timer = setTimeout(() => { late = true; proc.kill(); }, 60_000);
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  if (late) throw new Error("it took longer than a minute");
  if (code !== 0) throw new Error(`exited ${code}`);
  return out.trim().replace(/\[[A-Za-z][\w.-]*::[^\]\n]*\]/g, "") || "(the answer command said nothing)";
}

if (request.operation === "act" && request.input.action === "prior-art") {
  const input = request.input;
  const trigger = input.trigger as { rule: string; blocks?: { blockId: string; text: string }[] } | undefined;
  const targets: { blockId: string; text: string }[] = trigger?.blocks?.length ? trigger.blocks : [{ blockId: input.target.blockId, text: input.context.block.text }];
  const writes: unknown[] = [];
  let already = 0;
  for (const target of targets) {
    const children = await outline<Block[]>({ action: "children", parentId: target.blockId });
    if (children.some((child) => isPriorArt(child.text))) { already += 1; continue; }
    const title = titleOf(target.text);
    if (trigger) {
      writes.push({ op: "create", parentId: target.blockId, text: [NOTE_LINE, "", `${LOOKING}${places().join(", ")}…`, "", `@prior-art what came before ((${target.blockId}|${label(title)}))?`].join("\n") });
    } else {
      const { body } = await findings({ id: target.blockId, text: target.text, revision: 0 }, { model: false });
      writes.push({ op: "create", parentId: target.blockId, text: [NOTE_LINE, "", body].join("\n") });
    }
  }
  const asked = writes.length;
  ok({
    writes,
    message: asked
      ? `${trigger ? "asked @prior-art about" : "looked for prior art for"} ${asked} request${asked === 1 ? "" : "s"}${already ? ` (${already} had it already)` : ""}`
      : "every request here has its prior art already",
  });
} else if (request.operation === "respond" && request.input.agent === "prior-art") {
  const input = request.input;
  const note = input.note as { id: string; text: string };
  const ref = /\(\(([0-9a-f-]{36})/i.exec(String(input.request ?? ""))?.[1];
  const target = ref ? await outline<Block>({ action: "get", blockId: ref }).catch(() => null) : { ...note, revision: 0 };
  const capability = "I find earlier related notes using this ask and the note's text.";
  if (!target || (!ref && /^(?:when|why|how)\b.*\btrigger(?:ed)?\b/i.test(input.request.trim()))) {
    ok({ reply: capability });
  } else {
    // An inline ask has no separate request block: search its words and the prose around it, not earlier answers.
    const prose = note.text.split("\n").filter(line => !/^\s*(?:>|@)/.test(line)).join(" ");
    const { body, found } = await findings(target, { model: true, ...(!ref ? { words: `${input.request} ${prose}` } : {}) });
    const looking = note.text.split("\n").find((line) => line.startsWith(LOOKING));
    // The "Looking in …" line is where it goes; gone (the person rewrote the note), the answer is a reply instead.
    ok(looking
      ? { patches: [{ observed: looking, replacement: body }], message: `found ${found} related note${found === 1 ? "" : "s"}` }
      : { reply: body });
  }
} else {
  fail("invalid-config");
}
