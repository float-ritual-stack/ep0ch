// A completion source (PIE-1340): a tracker's open issues, under the triggers that already exist (`[[` with the
// pages, and `[issue::` for the property's value), never a sigil of its own. As pi's github-issue-autocomplete does
// with `gh`, it reads its list once (here a made-up issues.json beside it) and filters it locally; the person's
// completer ranks these rows with the built-ins by the one matcher. Nothing here reads the network or anything private.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outline } from "./outline";

interface Issue { number: number; title: string; state: string; labels: string[]; body: string }
interface Request { operation: string; input: { source?: string; query?: string; limit?: number; trigger?: { kind: string; key?: string; where?: string } } }

const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const request = (await Bun.stdin.json()) as Request;
const issues = JSON.parse(readFileSync(join(import.meta.dir, "issues.json"), "utf8")) as Issue[];

/**
 * A query line's last clause, after its last AND, OR, NOT or bracket: the words this source answers (PIE-1508). Under
 * the `query` trigger the token is the whole line through the cursor, and a row writes the whole line.
 */
function lastClause(line: string): { head: string; words: string } {
  const m = /^(.*(?:\s(?:AND|OR)\s+|\bNOT\s+|\())?(.*)$/s.exec(line)!;
  return { head: m[1] ?? "", words: m[2]! };
}

if (request.operation === "source" && request.input.source === "issue-words") {
  // The person's own words for a filter: an issue's number or title words become `issue=#N`, the notes about it.
  const { head, words } = lastClause(request.input.query ?? "");
  const typed = words.trim().replace(/^#/, "").toLowerCase().split(/\s+/).filter(Boolean);
  const answers = !typed.length || /[=:<>]/.test(words) ? [] : issues.filter(i => i.state === "open" && (typed.length === 1 && /^\d+$/.test(typed[0]!)
    ? String(i.number).startsWith(typed[0]!) : typed.every(w => i.title.toLowerCase().split(/\W+/).some(t => t.startsWith(w)))));
  say({ rows: answers.slice(0, request.input.limit ?? 20).map(i => ({
    id: `#${i.number}`, label: `issue="#${i.number}"`, kind: "issue", detail: i.title,
    insert: `${head}issue="#${i.number}"`,
    docs: `The notes about #${i.number} ${i.title}: those that write \`[issue::#${i.number}]\`.`,
  })) });
} else if (request.operation === "source" && request.input.source === "issue-notes") {
  // `$` in the power bar: the notes about an issue that the query typed selects. Its line completes as a query
  // (`grammar: "query"`), so the query words and the issue words above are offered on it, as on `=`.
  const where = (request.input.query ?? "").trim();
  const found = await outline<{ blocks: { id: string; text: string }[] }>({ action: "blocks.query", query: { where: where ? `issue AND (${where})` : "issue", limit: request.input.limit ?? 30 } });
  say({ rows: found.blocks.map(b => ({ id: b.id, label: b.text.split("\n")[0]!.replace(/\s*\[[^\]]*::[^\]]*\]/g, "").trim() || "(untitled)", block: b.id })) });
} else if (request.operation === "source" && request.input.source === "issue-button") {
  say({ rows: [{ label: "button · issue note", kind: "snippet", detail: "two slots: label and note", docs: "Opens an issue note. Fill the label, Tab to the note id, then Esc to keep writing. Ctrl+z removes the whole insertion.",
    insert: { snippet: '::button{label="{label}"}\nopen id={note}\n::' } }] });
} else if (request.operation === "source") {
  const q = (request.input.query ?? "").trim().replace(/^#/, "").toLowerCase();
  // A number finds its issue at once; words are the completer's to rank, so every open issue is offered.
  const found = /^\d+$/.test(q) ? issues.filter(i => String(i.number).startsWith(q)) : issues;
  // Under `[[` the row replaces the whole `[[…` token; under `[issue::` only the value.
  const value = request.input.trigger?.kind === "key::";
  say({ rows: found.filter(i => i.state === "open").slice(0, request.input.limit ?? 20).map(i => ({
    id: `#${i.number}`, label: `#${i.number} ${i.title}`, kind: "issue", detail: i.labels.join(", "),
    filter: String(i.number),
    insert: value ? `#${i.number}` : `[issue::#${i.number}]`,
    docs: `#${i.number} ${i.title} (${i.state})\n\n${i.body}`,
  })) });
} else {
  process.stdout.write(JSON.stringify({ ok: false, code: "not-found" }));
}
