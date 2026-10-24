import type { BlockAuthor } from "@ep0ch/outline-core/protocol";

export const RECORD_FIELDS = {
  "run-start": ["ticket", "harness", "branch", "worktree", "pid", "host", "summary"],
  "run-end": ["run", "exit", "pr", "duration", "report"],
  deploy: ["sha", "host", "sessions", "protocol", "grammar", "failed", "observed", "previous", "details"],
  finding: ["ticket", "pr", "source", "failure", "likelihood", "cost"],
  "finding-closed": ["finding", "fixed", "dismissed"],
} as const;
export type RecordKind = keyof typeof RECORD_FIELDS;
interface Note { id: string }
export interface RecordWriter { request<T>(action: string, params?: Record<string, unknown>): Promise<T> }
export interface RecordWho { author: BlockAuthor; provenance?: { actorId?: string; sessionId?: string } }

// The stored template is the shape every writer uses, including outline_create + ::use callers.
function recordTemplate(kind: RecordKind): string {
  return [
    `${kind} template [type::template] [template-for::${kind}]`,
    ...RECORD_FIELDS[kind].map(key => `[form-field::${key} text default=unknown]`),
    "[machine::record]",
    "[recorded::{{now.iso}}]",
    ...RECORD_FIELDS[kind].map(key => ["run", "finding", "previous"].includes(key)
      ? `[${key}::(({{props.${key}}}))]`
      : ["summary", "report", "failure", "likelihood", "cost", "dismissed", "sessions", "failed", "details"].includes(key)
        ? `\n${key}:\n{{props.${key}}}` : `[${key}::{{props.${key}}}]`),
  ].join("\n");
}

export async function writeRecord(board: RecordWriter, kind: RecordKind, props: Record<string, string>, who: RecordWho) {
  const find = async (where: string) => (await board.request<{ blocks: Note[] }>("blocks.query", { query: { where, machinery: "show" } })).blocks[0];
  let root = await find("system-records=true");
  if (!root) root = await board.request<Note>("create", { text: "Records [page::Records] [machine::record] [system-records::true]", parentId: null, ...who });
  let template: Note | undefined;
  for (const name of Object.keys(RECORD_FIELDS) as RecordKind[]) {
    let found = await find(`template-for=${name}`);
    if (!found) found = await board.request<Note>("create", { text: recordTemplate(name), parentId: root.id, ...who });
    if (name === kind) template = found;
  }
  const result = await board.request<{ stamped: Note[]; warnings: string[] }>("template.stamp", {
    of: template!.id, parent: root.id, title: `${kind} ${new Date().toISOString()}`, props, ...who,
  });
  return { id: result.stamped[0]!.id, warnings: result.warnings };
}
