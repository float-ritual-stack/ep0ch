import type { BlockAuthor } from "@ep0ch/outline-core/protocol";

export const RECORD_FIELDS = {
  "run-start": ["ticket", "harness", "branch", "worktree", "pid", "host", "summary"],
  "run-end": ["run", "exit", "pr", "duration", "report"],
  deploy: ["sha", "host", "protocol", "grammar", "observed", "previous", "when", "who", "session", "from", "to", "local", "clients", "sessions", "failed", "details"],
  finding: ["ticket", "pr", "source", "failure", "likelihood", "cost"],
  "finding-closed": ["finding", "fixed", "dismissed"],
  // Jev's figure suggestions (PIE-1251, jev-suggestions.ts): a fact per suggestion, a fact per settled outcome, and the day's
  // run (`jev-run`, the keys kitty's lab runs share, so one query reads both): asks, agreement, tokens.
  // PIE-1388: a review's findings are suggestions too, each with its rule, Evan's rubric item, the passage, what was said
  // and whether a ready patch came with it; the outcome repeats the passage and what was said, so one row reads whole.
  suggestion: ["day", "note", "revision", "writer", "harness", "component", "gate", "confidence", "callout", "model", "prompt-rev", "source", "thread", "rule", "rubric", "key", "line", "title", "passage", "said", "verdict", "patch"],
  "suggestion-outcome": ["day", "suggestion", "note", "outcome", "component", "writer", "harness", "because", "rule", "rubric", "title", "passage", "said", "patched"],
  "jev-run": ["experiment", "run", "model", "prompt-rev", "items", "agreed", "agreement", "suggested", "different", "ignored", "quiet", "unavailable", "tokens-in", "tokens-out"],
} as const;
export type RecordKind = keyof typeof RECORD_FIELDS;
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
      : ["clients", "local", "summary", "report", "failure", "likelihood", "cost", "dismissed", "sessions", "failed", "details"].includes(key)
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

export async function writeRecord(board: RecordWriter, kind: RecordKind, props: Record<string, string>, who: RecordWho, o: { title?: string } = {}) {
  const find = (where: string) => findNote(board, where);
  const deploy = kind === "deploy";
  let root = deploy ? await find("system-view=deploys") : await recordsRoot(board, who);
  if (!root) root = await board.request<Note>("create", { text: DEPLOYS_NOTE, parentId: null, ...who });
  let template: Note | undefined;
  for (const name of (deploy ? ["deploy"] : Object.keys(RECORD_FIELDS).filter(name => name !== "deploy")) as RecordKind[]) {
    let found = await find(`template-for=${name}${name === "deploy" ? " machine=install" : ""}`);
    if (!found) found = await board.request<Note>("create", { text: recordTemplate(name), parentId: root.id, ...who });
    if (name === kind) template = found;
  }
  // A template made before its kind gained fields stamps without them: brought up to the fields in code, once.
  const stored = await board.request<{ id: string; text: string; revision: number } | null>("get", { blockId: template!.id });
  if (stored && RECORD_FIELDS[kind].some(key => !stored.text.includes(`[form-field::${key} `))) {
    await board.request("update", { blockId: stored.id, text: recordTemplate(kind), expectedRevision: stored.revision, mutation: { author: who.author, ...(who.provenance?.actorId ? { actorId: who.provenance.actorId } : {}) } }).catch(() => undefined);
  }
  const result = await board.request<{ stamped: Note[]; warnings: string[] }>("template.stamp", {
    of: template!.id, parent: root.id, title: o.title ?? (deploy ? `Deploy ${props.when ?? new Date().toISOString()} on ${props.host ?? "unknown"}` : `${kind} ${new Date().toISOString()}`), props, ...who,
  });
  return { id: result.stamped[0]!.id, warnings: result.warnings };
}
