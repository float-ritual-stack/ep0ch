import type { BlockAuthor } from "@ep0ch/outline-core/protocol";

export const RECORD_FIELDS = {
  "run-start": ["ticket", "harness", "branch", "worktree", "pid", "host", "summary"],
  "run-end": ["run", "exit", "pr", "duration", "report"],
  deploy: ["sha", "host", "protocol", "grammar", "observed", "previous", "when", "who", "session", "from", "to", "local", "clients", "sessions", "failed", "details"],
  finding: ["ticket", "pr", "source", "failure", "likelihood", "cost"],
  "finding-closed": ["finding", "fixed", "dismissed"],
  // Jev's figure suggestions (PIE-1251, jev-suggestions.ts): a fact per suggestion, a fact per settled outcome, and the day's
  // run (`jev-run`, the keys kitty's lab runs share, so one query reads both): asks, agreement, tokens.
  suggestion: ["day", "note", "revision", "writer", "harness", "component", "gate", "confidence", "callout", "model", "prompt-rev", "source", "thread", "query", "words"],
  // PIE-1388: what a write's review told its writer, a fact per finding: its rule, Evan's rubric item, the passage, what was
  // said and whether a ready patch came with it (model and tokens are the day's run). Settled by the same outcome record,
  // which repeats the passage and what was said, so one row reads whole. `fix` is the ready patch's new text, under the
  // chips in a code fence its writer adds (the fix offered, as the card shows it, and how a later write is checked for it; PIE-1402).
  // (A template holds at most 16 fields; the review's verdict is the record's title.)
  "review-finding": ["day", "note", "revision", "writer", "harness", "rule", "rubric", "component", "key", "line", "title", "passage", "said", "patch", "source", "fix"],
  // A backfill's note reviewed with nothing to say (PIE-1402): kept, so a rerun doesn't ask Jev about it again.
  "review-quiet": ["day", "note", "revision", "writer", "harness", "source"],
  "suggestion-outcome": ["day", "suggestion", "note", "outcome", "component", "writer", "harness", "because", "rule", "rubric", "title", "passage", "said", "patched", "query", "words"],
  // PIE-1197: a real query and the note(s) that should come first (`expect`: ids, or `none` when nothing should), and who
  // said so (`source`: an agent's read after its search, the note it made, or Evan's pick). The search eval reads them.
  "search-eval-case": ["query", "outline", "expect", "source", "surface", "rank", "asked", "note"],
  // `hit5` is the search eval's (PIE-1409): how often the label was in Jev's first five; the others are every loop's.
  "jev-run": ["experiment", "run", "model", "prompt-rev", "items", "agreed", "agreement", "hit5", "suggested", "different", "ignored", "quiet", "unavailable", "tokens-in", "tokens-out", "cost"],
  // The workboard's Jev loops (work-jev.ts): the groom's verdict per queued ticket, and each twin offered at filing with
  // what became of it (offered, filed-anyway, attached).
  "groom-verdict": ["item", "verdict", "confidence", "evidence", "by", "pass", "thread"],
  // PIE-1421: what a groom parked or kept, and what came back from later, with why and the note that asked for it again.
  "groom-later": ["item", "outcome", "why", "source", "by", "pass"],
  "work-twin": ["day", "title", "twin", "same", "outcome", "item", "writer", "by"],
} as const;
export type RecordKind = keyof typeof RECORD_FIELDS;

/**
 * A value as a record's chip holds it, the writer's words kept (PIE-1402: `[needs::sysop]` read back as `needs:sysop`):
 * one line; a bracketed run (`[needs::sysop: …]`) quoted as code, which a chip's value may hold whole; a stray bracket,
 * which would end the chip, dropped. `::` is fine inside a value.
 */
export function chipValue(v: string, max = 400): string {
  const quoted = v.replace(/[\r\n]+/g, " ").split(/(`[^`]*`)/).map((part, i) => i % 2 ? part : part.replace(/\[[^\[\]`]*\]/g, m => `\`${m}\``)).join("");
  const kept = quoted.split(/(`[^`]*`)/).map((part, i) => i % 2 ? part : part.replace(/[\[\]]/g, " ")).join("").replace(/\s{2,}/g, " ").trim();
  // Cut outside a code span, so a quoted chip never loses its closing tick.
  if (kept.length <= max) return kept || "none";
  let cut = kept.slice(0, max - 1);
  if ((cut.match(/`/g) ?? []).length % 2) cut = cut.slice(0, cut.lastIndexOf("`"));
  return `${cut.trimEnd()}…`;
}
export const chips = (props: Record<string, string>) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, chipValue(v)]));
interface Note { id: string }

const DEPLOYS_NOTE = [
  "Deploys [system-view::deploys] [machine::install] [type::virtual-branch] [query::type=deploy machine=install] [sort::created] [direction::desc]", "",
  "Install runs, newest first. Copy this figure into the build log for the latest five:", "",
  "::graph-table", "---", "query: type=deploy machine=install", "sort: created", "direction: desc", "limit: 5", "columns: [title, created]", "---", "::",
].join("\n");
export interface RecordWriter { request<T>(action: string, params?: Record<string, unknown>): Promise<T> }
export interface RecordWho { author: BlockAuthor; provenance?: { actorId?: string; sessionId?: string } }

// The stored template is the shape every writer uses, including outline_create + ::use callers.
function recordTemplate(kind: RecordKind): string {
  return [
    `${kind} template [type::template] [template-for::${kind}]`,
    ...RECORD_FIELDS[kind].map(key => `[form-field::${key} text default=unknown]`),
    kind === "deploy" ? "[machine::install]" : "[machine::record]",
    "[recorded::{{now.iso}}]",
    ...RECORD_FIELDS[kind].map(key => kind === "deploy" && ["when", "who", "session", "from", "to", "local", "clients"].includes(key)
      ? `\n${key === "clients" ? "Client legs" : key[0]!.toUpperCase() + key.slice(1)}: {{props.${key}}}`
      : ["run", "finding", "previous"].includes(key) && kind !== "jev-run"
      ? `[${key}::(({{props.${key}}}))]`
      : key === "fix" ? `\nfix:\n{{props.fix}}`
      // A run's cost is a number its tables read (a chip); a finding's is its words.
      : ["clients", "local", "summary", "report", "failure", "likelihood", "cost", "dismissed", "sessions", "failed", "details"].includes(key) && !(kind === "jev-run" && key === "cost")
        ? `\n${key}:\n{{props.${key}}}` : `[${key}::{{props.${key}}}]`),
  ].join("\n");
}

/** The first note `where` holds, machinery included. */
async function findNote(board: RecordWriter, where: string): Promise<Note | undefined> {
  return (await board.request<{ blocks: Note[] }>("blocks.query", { query: { where, machinery: "show" } })).blocks[0];
}

/** The outline's Records page, made on the first record. */
export async function recordsRoot(board: RecordWriter, who: RecordWho): Promise<Note> {
  return await findNote(board, "system-records=true")
    ?? await board.request<Note>("create", { text: "Records [page::Records] [machine::record] [system-records::true]", parentId: null, ...who });
}

/**
 * What a run of records looks up once, not per record (PIE-1402: a backfill's keep looked every kind's template up again
 * for each record, ~1 s a record on pie, and stalled the host): the Records page, and each kind's template, checked.
 */
export interface RecordCache { root?: Note; deploys?: Note; templates?: Map<string, Note>; checked?: Set<string> }

export async function writeRecord(board: RecordWriter, kind: RecordKind, props: Record<string, string>, who: RecordWho, o: { title?: string; cache?: RecordCache } = {}): Promise<{ id: string; warnings: string[] }> {
  if (!o.cache) return stampRecord(board, kind, props, who, o.title, {});
  try { return await stampRecord(board, kind, props, who, o.title, o.cache); }
  catch {
    // What was kept may be gone (the Records page or a template trashed): looked up again, once.
    for (const key of Object.keys(o.cache) as (keyof RecordCache)[]) delete o.cache[key];
    return stampRecord(board, kind, props, who, o.title, o.cache);
  }
}

async function stampRecord(board: RecordWriter, kind: RecordKind, props: Record<string, string>, who: RecordWho, title: string | undefined, cache: RecordCache): Promise<{ id: string; warnings: string[] }> {
  // What a long-lived cache kept may have been trashed since (a tidy pass): checked each call, looked up again if so.
  if (cache.root) {
    const root = await board.request<{ deletedAt?: string | null; effectiveDeletedRootId?: string | null } | null>("get", { blockId: cache.root.id }).catch(() => null);
    if (!root || root.deletedAt || root.effectiveDeletedRootId) for (const key of Object.keys(cache) as (keyof RecordCache)[]) delete cache[key];
  }
  const deploy = kind === "deploy";
  let root = deploy ? cache.deploys ??= await findNote(board, "system-view=deploys") : cache.root ??= await recordsRoot(board, who);
  if (!root) root = cache.deploys = await board.request<Note>("create", { text: DEPLOYS_NOTE, parentId: null, ...who });
  // Every template in one question, then each kind's made where it's missing (the deploy template is the install's).
  cache.templates ??= new Map((await board.request<{ blocks: { id: string; text: string }[] }>("blocks.query", { query: { where: "type=template", machinery: "show", limit: 1000 } })).blocks.flatMap(b => {
    const of = /\[template-for::([^\]]+)\]/.exec(b.text)?.[1];
    return of && (of !== "deploy" || /\[machine::install\]/.test(b.text)) ? [[of, b] as const] : [];
  }).reverse());
  for (const name of (deploy ? ["deploy"] : Object.keys(RECORD_FIELDS).filter(name => name !== "deploy")) as RecordKind[]) {
    // Missing from the one question (it reads at most 1000 templates): asked by name before one is made.
    if (!cache.templates.has(name)) cache.templates.set(name, await findNote(board, `template-for=${name}${name === "deploy" ? " machine=install" : ""}`) ?? await board.request<Note>("create", { text: recordTemplate(name), parentId: root.id, ...who }));
  }
  const template = cache.templates.get(kind)!;
  // A template made before its kind gained fields, or with a field stamped another way since (jev-run's cost, once
  // words, now a chip), stamps the old shape: brought up to the code's, once. Only the fields' own lines are compared.
  if (!(cache.checked ??= new Set()).has(kind)) {
    const stored = await board.request<{ id: string; text: string; revision: number } | null>("get", { blockId: template.id });
    let current = !!stored;
    if (stored && recordTemplate(kind).split("\n").some(line => /\{\{props\.|\[form-field::/.test(line) && !stored.text.includes(line))) {
      current = await board.request("update", { blockId: stored.id, text: recordTemplate(kind), expectedRevision: stored.revision, mutation: { author: who.author, ...(who.provenance?.actorId ? { actorId: who.provenance.actorId } : {}) } }).then(() => true, () => false);
    }
    // Checked only once it is known current: a failed upgrade is tried again by the next record.
    if (current) cache.checked.add(kind);
  }
  const result = await board.request<{ stamped: Note[]; warnings: string[] }>("template.stamp", {
    of: template.id, parent: root.id, title: title ?? (deploy ? `Deploy ${props.when ?? new Date().toISOString()} on ${props.host ?? "unknown"}` : `${kind} ${new Date().toISOString()}`), props, ...who,
  });
  return { id: result.stamped[0]!.id, warnings: result.warnings };
}
