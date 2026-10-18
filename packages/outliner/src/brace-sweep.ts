// The brace sweep (PIE-533 S0c): one pass over an outline's notes that writes the old single-brace and old placement
// forms in the new grammar. It is a rewriter, not an expander: the only place the old forms are still named, so the
// runtime (outline-core's `interpolate`) reads one grammar and nothing else.
//
//   rule labels   `[rule-label::{title} · {when}]`     -> `[rule-label::{{this.title}} · {{this.when}}]`
//                 (`{text}` `{level}` `{$N}`           -> `{{match.text}}` `{{match.level}}` `{{match[N]}}`)
//   rule places   `[rule-place::above|below]`          -> `[rule-place::prepend|append]`
//   action slots  `{slot}` in a `[script::]` note's    -> `{{props.slot}}`
//                 `actions` fence
//   runbook steps `{{env}}` in a step's code fence     -> `{{self.env}}`
//                 (a note with a `run::` line)            (the runbook note's own value, as it always read)
//
// Each form is rewritten only where it was read: a rule's property value, a script's `actions` fence. Text that merely
// holds a `{word}` (code, prose) is left alone, and a second run changes nothing. `ep0ch install --apply` runs it on
// each outline in the step that hands it the new code, as it runs migrations; with the host stopped it opens the
// database itself (a served file is refused), in one transaction and one attributed change (`brace-sweep`), so every
// note's previous text is in its revisions and the install's backup is the rollback.
// It also stamps old peer-message copies with their plain query keys. Maintenance retains updated timestamps.
import { Database } from "bun:sqlite";
import { codeBlocks } from "@ep0ch/outline-core/code-fence";
import { scanLiteralRegions } from "@ep0ch/outline-core/code-ranges";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { patchPropertyText } from "./properties";
import { RECORD_KEYS } from "@ep0ch/outline-core/resolve-path";

export interface SweepChange { form: "rule-label" | "rule-place" | "action-slot" | "runbook-step" | "peer-message"; before: string; after: string }

const SINGLE = /(?<!\{)\{([A-Za-z$][A-Za-z0-9_.$-]{0,63})\}(?!\})/g;
/** Names that are already a head of the grammar: `{{now}}` is not a runbook value. */
const STEP_HEADS = new Set(["this", "parent", "self", "caller", "props", "match", "now"]);
const PLACES = new Map([["above", "prepend"], ["below", "append"]]);
/** A key `this.<key>` reads as a path: a plain name. Anything else (`margin.x`) has no path and is left as written. */
const PLAIN_KEY = /^[A-Za-z_][\w-]*$/;

/**
 * A rule label in the new grammar. `{key}` meant the block's own property of that name, so a key that is also a record
 * field (`{author}`, `{id}`) becomes `this.block.<key>`, which reads properties alone; a key a path can't spell is left.
 */
function label(value: string): string {
  return value.replace(SINGLE, (whole, name: string) => {
    if (name === "title") return "{{this.title}}";
    if (name === "text") return "{{match.text}}";
    if (name === "level") return "{{match.level}}";
    const capture = /^\$([0-9])$/.exec(name);
    if (capture) return `{{match[${capture[1]}]}}`;
    if (!PLAIN_KEY.test(name)) return whole;
    return (RECORD_KEYS as readonly string[]).includes(name.toLowerCase()) || ["block", "fields", "count"].includes(name.toLowerCase()) ? `{{this.block.${name}}}` : `{{this.${name}}}`;
  });
}

/** The edit that puts `value` where the property's own value is written, whichever way it is written (`[k::v]`, `k:: v`). */
function rewrite(text: string, record: { start: number; end: number; value: string }, value: string): { start: number; end: number; to: string } | null {
  const raw = text.slice(record.start, record.end);
  const at = raw.indexOf(record.value, raw.indexOf("::") + 2);
  if (at < 0) return null;
  return { start: record.start + at, end: record.start + at + record.value.length, to: value };
}

/** `text` with its old forms rewritten, and each rewrite named. Pure. */
export function sweepText(text: string): { text: string; changes: SweepChange[] } {
  const changes: SweepChange[] = [];
  // Offsets in the original, edited from the end so earlier ones stay true.
  const edits: { start: number; end: number; to: string }[] = [];
  const records = parsePropertyRecords(text);
  for (const record of records) {
    if (record.scope !== "block") continue;
    if (record.key === "rule-label") {
      const after = label(record.value);
      const edit = after !== record.value ? rewrite(text, record, after) : null;
      if (edit) { edits.push(edit); changes.push({ form: "rule-label", before: record.value, after }); }
    } else if (record.key === "rule-place") {
      const after = PLACES.get(record.value.trim().toLowerCase());
      const edit = after ? rewrite(text, record, after) : null;
      if (edit) { edits.push(edit); changes.push({ form: "rule-place", before: record.value, after: after! }); }
    }
  }
  if (records.some(r => r.scope === "block" && r.key === "script") && text.includes("{")) {
    const lines = text.split("\n");
    const starts: number[] = [];
    for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
    // An example inside a `<!-- literal -->` region is text, not a script.
    const literal = scanLiteralRegions(text).regions;
    for (const fence of codeBlocks(lines).fences) {
      if (fence.fence.info !== "actions" || !fence.closed) continue;
      if (literal.some(region => starts[fence.start]! >= region.start && starts[fence.start]! < region.end)) continue;
      for (let i = fence.start + 1; i < fence.end; i++) {
        const line = lines[i]!;
        const after = line.replace(/(?<!\{)\{([a-z][a-z0-9_-]*)\}(?!\})/g, "{{props.$1}}");
        if (after !== line) { edits.push({ start: starts[i]!, end: starts[i]! + line.length, to: after }); changes.push({ form: "action-slot", before: line.trim(), after: after.trim() }); }
      }
    }
  }
  // A runbook step's `{{env}}` read the runbook note's own `[env::…]`; that is `self` now, and a bare key would walk the step's scope.
  if (records.some(r => r.key === "run") && text.includes("{{")) {
    const lines = text.split("\n");
    const starts: number[] = [];
    for (let i = 0, at = 0; i < lines.length; at += lines[i]!.length + 1, i++) starts.push(at);
    const literal = scanLiteralRegions(text).regions;
    // Only the first fence is the step (the runbook's commandOf runs that one); a later example keeps its text.
    for (const fence of codeBlocks(lines).fences.slice(0, 1)) {
      if (!fence.closed || literal.some(region => starts[fence.start]! >= region.start && starts[fence.start]! < region.end)) continue;
      for (let i = fence.start + 1; i < fence.end; i++) {
        const line = lines[i]!;
        const after = line.replace(/(?<![\\$])\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, (whole, name: string) => STEP_HEADS.has(name.toLowerCase()) ? whole : `{{self.${name}}}`);
        if (after !== line) { edits.push({ start: starts[i]!, end: starts[i]! + line.length, to: after }); changes.push({ form: "runbook-step", before: line.trim(), after: after.trim() }); }
      }
    }
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.to + out.slice(edit.end);
  return { text: out, changes };
}

export interface SweepNote { id: string; revision: number; before: string; after: string; changes: SweepChange[] }
export interface SweepReport { database: string; applied: boolean; notes: SweepNote[] }

/** A unified-style diff of the lines that changed in one note, for the dry run. */
export function sweepDiff(note: SweepNote): string {
  const was = note.before.split("\n"), now = note.after.split("\n");
  const out = [`@@ ${note.id} (revision ${note.revision}) @@`];
  for (let i = 0; i < was.length; i++) if (was[i] !== now[i]) out.push(`- ${was[i]}`, `+ ${now[i]}`);
  return out.join("\n");
}

const CANDIDATES = `SELECT id, parent_id, text, revision FROM blocks WHERE effective_deleted_root_id IS NULL
  AND (text LIKE '%rule-label::%' OR text LIKE '%rule-place::%' OR text LIKE '%script::%' OR text LIKE '%run::%'
    OR parent_id IN (SELECT block_id FROM block_properties WHERE key = 'page' AND value = 'peer-messages' AND scope = 'block')
    OR id IN (SELECT block_id FROM block_properties WHERE key = 'echo' AND scope = 'block')) ORDER BY created_at, id`;

/** What the sweep would change in `database`, read without opening it for writing (so a served file can be looked at). */
export function planSweep(database: string): SweepReport {
  const db = new Database(database, { readonly: true });
  try {
    const rows = db.query(CANDIDATES).all() as { id: string; parent_id: string | null; text: string; revision: number }[];
    const peerPages = new Set((db.query("SELECT block_id FROM block_properties WHERE key = 'page' AND value = 'peer-messages' AND scope = 'block'").all() as { block_id: string }[]).map(p => p.block_id));
    const notes: SweepNote[] = [];
    for (const row of rows) {
      const swept = sweepText(row.text);
      const peer = /^(?:← from|→ to) (.+?) · \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: |$)/.exec(row.text.split("\n")[0]!);
      // A copy: under [[peer-messages]], or an EchoNet copy (it carries both [echo::] and the [from::] it came from);
      // an original posting with [echo::] alone isn't one.
      const own = parsePropertyRecords(row.text).filter(p => p.scope === "block");
      const echoCopy = own.some(p => p.key === "echo") && own.some(p => p.key === "from");
      if (peer && (peerPages.has(row.parent_id!) || echoCopy)) {
        const properties = parsePropertyRecords(swept.text).filter(p => p.scope === "block");
        // By key, not value: a [peer::] already there (trimmed or not) is kept, so a second sweep finds nothing to add.
        const additions = [{ key: "type", value: "peer-message" }, { key: "peer", value: peer[1]!.trim() }]
          .filter(p => p.key === "type" ? !properties.some(e => e.key === "type" && e.value.trim() === "peer-message") : !properties.some(e => e.key === "peer"));
        if (additions.length) {
          const before = swept.text;
          swept.text = patchPropertyText(before, additions.map(p => ({ op: "append" as const, ...p })));
          swept.changes.push({ form: "peer-message", before: before.split("\n")[0]!, after: swept.text.split("\n")[0]! });
        }
      }
      if (swept.changes.length) notes.push({ id: row.id, revision: row.revision, before: row.text, after: swept.text, changes: swept.changes });
    }
    return { database, applied: false, notes };
  } finally {
    db.close();
  }
}

/** Writes the plan: every note in one transaction and one attributed change, or none of it. Refuses a served file. */
export async function applySweep(database: string): Promise<SweepReport> {
  const { OutlinerStore } = await import("./store");
  const plan = planSweep(database);
  if (!plan.notes.length) return plan;
  const store = new OutlinerStore(database);
  try {
    const actor = { author: "system" as const, actorId: "brace-sweep" };
    store.changes.run(store.changes.attribution({ action: "brace-sweep", actor }), () => store.database.transaction(() => {
      for (const note of plan.notes) store.update(note.id, note.after, note.revision, actor, "text", [], store.require(note.id).updatedAt);
    })());
  } finally {
    store.close();
  }
  return { ...plan, applied: true };
}
