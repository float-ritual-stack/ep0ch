// Marginalia (ADR 0004 contracts 5 and 6, PIE-735): reading with a pen, built only on the contracts any extension has.
//
// - `act` on a passage (`on: passage`): the service checked the passage (exact words, where they are now) and sends
//   it as `target.passage`, with the note's or the Resource's text as `target.text`.
//   - highlight: one `annotate` write with no body (a highlight is an annotation with no body), `kind: highlight`
//     and a theme tone as `color`;
//   - define: the words looked up in the text itself (a glossary line, `**term**: meaning` or `term — meaning`), written
//     in the margin as an annotation with `kind: define`; nothing found, nothing written, and it says so;
//   - cite: `copy`, the quote as a Blockdown quote and where it's from. Nothing is written.
// - `respond` as the agent `margin` (`threads: true`): a person's `@margin …` in a comment on a passage (a client's
//   Ask), or in a reply in its thread, is sent here with the passage, the text, the whole thread and the page's other
//   comments; the reply lands in that thread. With `config.answer` (a command: the prompt on stdin, the answer on
//   stdout) it asks that; without, it answers from the note's own sentences and says that's all it did.
// - A thread is one conversation: the first `@margin` starts a session (`config.session.start`, with a new id) and
//   returns its id, which the service keeps on the thread; a later `@margin` there resumes it (`config.session.resume`).
//   `claude` needs no config for it (`--session-id` and `--resume`). A session that can't be resumed (another machine,
//   cleared) starts again with the whole thread, so nothing said is lost. A reply without `@margin` is never sent.
//
// Self-contained on purpose: an extension folder is copied anywhere, so it imports nothing from the outline's code.

interface Passage { subject: string; revision: number | string; quote: string; start: number; end: number; prefix: string; suffix: string }
interface Request {
  operation: string;
  input: Record<string, any>;
  config?: { color?: string; answer?: string[]; session?: { start: string[]; resume: string[] } };
}
interface Said { author: string; body: string }

const TONES = ["default", "good", "warn", "bad", "dim", "accent"];
const request = (await Bun.stdin.json()) as Request;
const ok = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

/** The line of `text` an offset is on. */
function lineAt(text: string, at: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1, end = text.indexOf("\n", at);
  return text.slice(start, end < 0 ? text.length : end);
}

/** Where the passage is from: the fragment of its line (`^id` at the line's end), else the block; a Resource by its id. */
function reference(p: Passage, text: string): string {
  if (p.subject.startsWith("resource:")) return p.subject;
  const anchor = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/.exec(lineAt(text, p.start));
  return anchor ? `((${p.subject}^${anchor[1]}))` : `((${p.subject}))`;
}

/** A glossary line's meaning for `term`: `**term**: meaning`, `term: meaning`, `term — meaning` (any case, a list mark allowed). */
function glossary(text: string, term: string): string | null {
  const t = term.trim().replace(/[*_`]/g, "").toLowerCase();
  if (!t) return null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    const m = /^\*{0,2}([^*:—–]{1,80}?)\*{0,2}\s*(?::|—|–| - )\s*(.+)$/.exec(line);
    if (m && m[1]!.trim().toLowerCase() === t) return m[2]!.trim();
  }
  return null;
}

/** The note's sentences that share the most words with the question and the passage: an honest answer without a model. */
function fromTheText(text: string, p: Passage | undefined, question: string): string {
  const words = new Set(`${p?.quote ?? ""} ${question}`.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const sentences = text.replace(/\[[A-Za-z][\w.-]*::[^\]]*\]/g, "").split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/^\s*(?:[-*+#>]+\s*)+/, "").trim()).filter(s => s.length > 12);
  const scored = sentences.map(s => ({ s, n: (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => words.has(w)).length })).filter(x => x.n > 0 && x.s !== p?.quote);
  scored.sort((a, b) => b.n - a.n);
  const picked = scored.slice(0, 2).map(x => `> ${x.s}`);
  return picked.length
    ? `From the note itself (no model is set up: config.answer names one):\n\n${picked.join("\n")}`
    : "The note says nothing more about this, and no model is set up to ask (config.answer names one).";
}

/** How the answer command starts and resumes a session (`{id}` is the session's id): `claude`'s own flags by default. */
function sessionArgs(command: string[]): { start: string[]; resume: string[] } | null {
  if (request.config?.session) return request.config.session;
  return /(?:^|\/)claude$/.test(command[0] ?? "") ? { start: ["--session-id", "{id}"], resume: ["--resume", "{id}"] } : null;
}

const said = (t: Said) => `${t.author === "user" ? "reader" : t.author}: ${t.body}`;

function prompt(input: Record<string, any>, resumed: boolean): string {
  const p = input.passage as Passage | undefined;
  const text = String(input.note?.text ?? "");
  const thread = (input.thread ?? []) as Said[];
  const comments = (input.comments ?? []) as { quote: string; thread: Said[] }[];
  const question = String(input.request ?? "").trim() || "what does this mean?";
  const others = comments.flatMap((c) => [c.quote ? `- on "${c.quote}":` : "- on the whole note:", ...c.thread.map((t) => `    ${said(t)}`)]);
  return [
    resumed
      ? "The reader asks again in the same margin thread. Here is the thread and the page as they are now."
      : "You answer in the margin of a note, beside the passage a reader asked about. Plain text, under 120 words. The first sentence answers. Don't write query or view syntax ([query::], [sort::]) unless you checked it against the outline; the outline checks any you write and says so under your answer.",
    "", "THE NOTE:", text.slice(0, 20_000), "",
    p ? `THE PASSAGE: "${p.quote}"` : "THE PASSAGE: (the whole note)",
    ...(thread.length > 1 ? ["", "THE THREAD SO FAR (the reader's own notes between asks included):", ...thread.slice(0, -1).map(said)] : []),
    ...(others.length ? ["", "THE PAGE'S OTHER COMMENTS:", ...others] : []),
    "", `THE QUESTION: ${question}`,
  ].join("\n");
}

async function run(command: string[], stdin: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(command, { stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, out: out.trim() };
}

async function answer(input: Record<string, any>): Promise<{ reply: string; session?: string }> {
  const command = request.config?.answer;
  if (!command?.length) {
    const question = String(input.request ?? "").trim() || "what does this mean?";
    return { reply: fromTheText(String(input.note?.text ?? ""), input.passage as Passage | undefined, question) };
  }
  const args = sessionArgs(command);
  const fill = (template: string[], id: string) => template.map((part) => part.replaceAll("{id}", id));
  const kept = typeof input.session === "string" ? input.session : "";
  if (args && kept) {
    const resumed = await run([...command, ...fill(args.resume, kept)], prompt(input, true));
    if (resumed.code === 0) return { reply: resumed.out || "(the answer command said nothing)", session: kept };
    // Not resumable here (another machine's, or cleared): a new session, told the whole thread.
  }
  const id = args ? crypto.randomUUID() : "";
  const started = await run(args ? [...command, ...fill(args.start, id)] : command, prompt(input, false));
  if (started.code !== 0) throw new Error(`the answer command exited ${started.code}`);
  return { reply: started.out || "(the answer command said nothing)", ...(args ? { session: id } : {}) };
}

if (request.operation === "act") {
  const { action, target, args } = request.input;
  const p = target?.passage as Passage | undefined;
  const text = String(target?.text ?? "");
  if (!p) ok({ message: "marginalia acts on a passage: select some words first" });
  else if (action === "highlight") {
    const wanted = String(args?.color ?? request.config?.color ?? "warn").toLowerCase();
    const color = TONES.includes(wanted) ? wanted : "warn";
    ok({ message: `highlighted "${p.quote.slice(0, 40)}"`, writes: [{ op: "annotate", body: "", properties: { kind: "highlight", color } }] });
  } else if (action === "define") {
    const meaning = glossary(text, p.quote);
    ok(meaning
      ? { message: `defined "${p.quote}"`, writes: [{ op: "annotate", body: meaning, properties: { kind: "define", tags: ["glossary"] } }] }
      : { message: `"${p.quote.slice(0, 40)}" isn't in this note's glossary (a line like **${p.quote.slice(0, 20)}**: its meaning) · ask @margin instead` });
  } else if (action === "cite") {
    const quoted = p.quote.trim().split("\n").map(l => `> ${l}`.trimEnd()).join("\n");
    ok({ message: "copied with a citation", copy: `${quoted}\n> — ${reference(p, text)}` });
  } else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
} else if (request.operation === "respond") {
  try {
    ok(await answer(request.input));
  } catch (error) {
    ok({ reply: `couldn't answer: ${error instanceof Error ? error.message : String(error)}` });
  }
} else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
