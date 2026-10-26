// A completion source (PIE-1340): a tracker's open issues, under the triggers that already exist (`[[` with the
// pages, and `[issue::` for the property's value), never a sigil of its own. As pi's github-issue-autocomplete does
// with `gh`, it reads its list once (here a made-up issues.json beside it) and filters it locally; the person's
// completer ranks these rows with the built-ins by the one matcher. Nothing here reads the network or anything private.
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Issue { number: number; title: string; state: string; labels: string[]; body: string }
interface Request { operation: string; input: { source?: string; query?: string; limit?: number; trigger?: { kind: string; key?: string } } }

const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const request = (await Bun.stdin.json()) as Request;
const issues = JSON.parse(readFileSync(join(import.meta.dir, "issues.json"), "utf8")) as Issue[];

if (request.operation === "source") {
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
