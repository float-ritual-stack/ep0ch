import { facetRows, readFacetRows, type FacetRequest, type FacetResult, type FacetRow } from "@ep0ch/outline-core/facet-source";
import { subject, type Msg } from "./board";
import type { Actor, FacetAnswer } from "./socket";
import type { DeskApi, Pane } from "./desk/panes";
import { ActionRefused } from "./surface/actions";

export interface SourceRow extends FacetRow { note?: Msg }
export interface FacetSource {
  id: string;
  title: string;
  /** Notes alone expose the note-writing actions (pin and tag). */
  notes?: boolean;
  query(request: FacetRequest, desk: DeskApi): Promise<FacetResult<SourceRow>>;
  /** Local changes invalidate an open tile just as outline events do. */
  subscribe?(desk: DeskApi, changed: () => void): () => void;
  open(row: SourceRow, desk: DeskApi, pane: Pane, actor: Actor, fresh?: boolean): Promise<unknown>;
  preview?(row: SourceRow, desk: DeskApi, pane: Pane, actor: Actor): void;
}

const sources = new Map<string, FacetSource>();
export function registerFacetSource(source: FacetSource) { sources.set(source.id, source); }
export function unregisterFacetSource(id: string) { sources.delete(id); }
export function facetSources(): FacetSource[] { return [...sources.values()]; }
export function facetSource(id: string): FacetSource {
  const source = sources.get(id);
  if (!source) throw new ActionRefused(`unavailable source ${id} · choose ${facetSources().map(s => s.id).join(", ")} with facets.source source=`);
  return source;
}

export function sourceMessage(row: SourceRow): Msg {
  return row.note ?? { id: row.id, text: row.title, properties: Object.entries(row.properties).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
    parentId: null, childIds: [], createdAt: Date.parse(row.createdAt), updatedAt: Date.parse(row.updatedAt), author: null };
}
export function sourceAnswer(result: FacetResult<SourceRow>): FacetAnswer {
  return { ...result, notes: result.rows.map(sourceMessage), facets: result.facets.map(f => ({ ...f, more: f.more ?? 0, values: f.values.map(v => ({ ...v, last: Date.parse(v.last) })) })) };
}

registerFacetSource({
  id: "notes", title: "Notes", notes: true,
  async query({ where, limit, ...options }, desk) {
    const answer = await desk.ctx.board.facetList(where, limit, options);
    return { ...answer, rows: answer.notes.map(note => {
      const properties: Record<string, string[]> = {};
      for (const p of note.properties) (properties[p.key] ??= []).push(p.value);
      return { id: note.id, title: subject(note), properties, createdAt: new Date(note.createdAt).toISOString(), updatedAt: new Date(note.updatedAt).toISOString(), note };
    }), facets: answer.facets.map(f => ({ ...f, values: f.values.map(v => ({ ...v, last: new Date(v.last).toISOString() })) })) };
  },
  async open(row, desk, pane, actor, fresh) {
    desk.openFromTile(row.note!, { from: pane, link: true, ...(fresh ? { fresh: true } : {}), by: actor });
    return { id: row.id, title: row.title };
  },
  preview(row, desk, pane, actor) { desk.showFrom?.(pane, row.note!, actor); },
});

/** Extensions return rows through an existing read action; all narrowing stays in the shared grammar. */
export function extensionFacetSource(extension: string, declaration: { id: string; title: string; read: string }): FacetSource {
  return {
    id: `ext.${extension}.${declaration.id}`, title: declaration.title,
    async query(request, desk) {
      const answer = await desk.ctx.board.actExtension(extension, declaration.read);
      if (answer.answer === undefined) throw new Error(`${declaration.title} returned no rows; its read action must return answer as a JSON array`);
      const rows = readFacetRows(answer.answer);
      return facetRows(rows, request);
    },
    async open(row, desk, pane, actor) {
      if (!row.open) throw new ActionRefused(`${row.title} has no open action`);
      return desk.within!(row.open.action, row.open.args ?? {}, actor, pane);
    },
  };
}
