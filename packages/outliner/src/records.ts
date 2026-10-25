import type { BlockAuthor } from "@ep0ch/outline-core/protocol";

export const RECORD_FIELDS = {
  "run-start": ["ticket", "harness", "branch", "worktree", "pid", "host", "summary"],
  "run-end": ["run", "exit", "pr", "duration", "report"],
  deploy: ["sha", "host", "protocol", "grammar", "observed", "previous", "when", "who", "session", "from", "to", "local", "clients", "sessions", "failed", "details"],
  finding: ["ticket", "pr", "source", "failure", "likelihood", "cost"],
  "finding-closed": ["finding", "fixed", "dismissed"],
  // Jev's figure suggestions (PIE-1251, jev-suggestions.ts): a fact per suggestion, a fact per settled outcome, and a daily tally of quiet asks.
  suggestion: ["note", "revision", "writer", "harness", "component", "gate", "confidence", "callout", "prompt", "source", "thread"],
  "suggestion-outcome": ["suggestion", "note", "outcome", "component", "writer", "harness", "because"],
  "suggestion-day": ["day", "quiet", "unavailable"],
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
      : ["run", "finding", "previous"].includes(key)
      ? `[${key}::(({{props.${key}}}))]`
      : ["clients", "local", "summary", "report", "failure", "likelihood", "cost", "dismissed", "sessions", "failed", "details"].includes(key)
        ? `\n${key}:\n{{props.${key}}}` : `[${key}::{{props.${key}}}]`),
  ].join("\n");
}

export async function writeRecord(board: RecordWriter, kind: RecordKind, props: Record<string, string>, who: RecordWho, o: { title?: string } = {}) {
  const find = async (where: string) => (await board.request<{ blocks: Note[] }>("blocks.query", { query: { where, machinery: "show" } })).blocks[0];
  const deploy = kind === "deploy";
  let root = await find(deploy ? "system-view=deploys" : "system-records=true");
  if (!root) root = await board.request<Note>("create", { text: deploy ? DEPLOYS_NOTE : "Records [page::Records] [machine::record] [system-records::true]", parentId: null, ...who });
  let template: Note | undefined;
  for (const name of (deploy ? ["deploy"] : Object.keys(RECORD_FIELDS).filter(name => name !== "deploy")) as RecordKind[]) {
    let found = await find(`template-for=${name}${name === "deploy" ? " machine=install" : ""}`);
    if (!found) found = await board.request<Note>("create", { text: recordTemplate(name), parentId: root.id, ...who });
    if (name === kind) template = found;
  }
  const result = await board.request<{ stamped: Note[]; warnings: string[] }>("template.stamp", {
    of: template!.id, parent: root.id, title: o.title ?? (deploy ? `Deploy ${props.when ?? new Date().toISOString()} on ${props.host ?? "unknown"}` : `${kind} ${new Date().toISOString()}`), props, ...who,
  });
  return { id: result.stamped[0]!.id, warnings: result.warnings };
}
