// The extension returns one compare-and-replace; draft.patch owns attribution, conflict handling and undo.
import { tidyPassage } from "./tidy-line";

interface Request {
  operation: string;
  input: { agent: string; request: string; mark: string; note: { id: string; revision: number; text: string } };
  config?: { answer?: string[] };
}

const request = (await Bun.stdin.json()) as Request;
const ok = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

async function respond() {
  const lines = request.input.note.text.split("\n");
  const markAt = lines.indexOf(request.input.mark);
  let end = markAt - 1;
  // Adjacent asks are about the passage, never about each other's instructions.
  while (end >= 1 && (!lines[end]!.trim() || /^\s*(?:[-*+]\s+)?@[a-z][a-z0-9-]*(?:\s|$)/.test(lines[end]!))) end--;
  let start = end;
  const instruction = request.input.request.trim();
  const all = /^all$/i.test(instruction);
  if (all) start = 1;
  else while (start > 1 && lines[start - 1]!.trim() && !/^\s*(?:[-*+]\s+)?@/.test(lines[start - 1]!)) start--;
  start = Math.max(start, 1);
  const passage = lines.slice(start, end + 1);
  const observed = passage.join("\n");
  if (!observed.trim()) return { message: "nothing to tidy above" };
  let replacement: string, message: string;
  if (!instruction || all) {
    ({ replacement, message } = tidyPassage(passage));
  } else {
    // The same stdin/stdout command contract as marginalia's config.answer; Haiku is pie's cheap text model.
    const command = request.config?.answer ?? ["claude", "-p", "--model", "haiku", "--tools", "", "--bare"];
    if (!command.length) return { message: "no model: set tidy/config.json config.answer to a prompt-on-stdin command" };
    const prompt = [
      'Rewrite the Blockdown passage following the instruction. Return ONLY JSON: {"replacement":"the full rewritten passage","message":"short, specific account of what changed, e.g. rewrote 4 items as callouts"}.',
      "Keep facts, references, links, anchors and properties unless the instruction asks to remove them. Callouts use > [!note] Title followed by > body lines. Do not include the instruction, any ask lines, or an enclosing code fence. If no edit is needed, return the original passage and say why.",
      "INSTRUCTION:", instruction, "PASSAGE:", observed,
    ].join("\n");
    const proc = Bun.spawn(command, { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
    const [out, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`answer command exited ${code}; check tidy/config.json config.answer and its model login`);
    let result: unknown;
    try { result = JSON.parse(out.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")); } catch { throw new Error("model did not return JSON with replacement and message"); }
    if (!result || typeof result !== "object" || !("replacement" in result) || typeof result.replacement !== "string" || !("message" in result) || typeof result.message !== "string" || !result.message.trim() || result.message.length > 500) {
      throw new Error("model must return replacement text and a short message");
    }
    ({ replacement, message } = result);
  }
  if (replacement === observed) return { message };
  return { message, patches: [{ observed, replacement,
    before: lines.slice(0, start).join("\n").slice(-80), after: lines.slice(end + 1).join("\n").slice(0, 80),
  }] };
}

if (request.operation !== "respond") process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
else {
  try { ok(await respond()); }
  catch (error) { ok({ message: `couldn't rewrite: ${error instanceof Error ? error.message : String(error)}` }); }
}
