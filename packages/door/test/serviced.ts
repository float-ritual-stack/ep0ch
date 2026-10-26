// A fake board answering `completion.rows` (PIE-1340) the way the service does: the outliner's own completion sources,
// run over the fake's lookups (`completePages`, `searchBlocks`, `fragmentCandidates`, …), so a test that fakes those
// still sees the rows the door would. Only for test doubles; a scratch host answers it for real.
import { completionRows } from "../../outliner/src/completion-sources";

type Fake = Record<string, any>;

export function serviced<B extends Fake>(board: B): B & { completionRows: (r: any) => Promise<any>; completionPicked: () => Promise<unknown> } {
  const svc = { async request<T>(action: string, input: Record<string, any>): Promise<T> {
    const near = input.contextBlockId ? { near: input.contextBlockId } : {};
    switch (action) {
      case "references.resolve": return { workIdPrefix: board.workIdPrefix ? await board.workIdPrefix() : null } as T;
      case "pages.complete": return await board.completePages(input.query, input.limit, { ...(input.semantic ? { semantic: true } : {}), ...near }) as T;
      case "tree.search": return await board.searchBlocks(input.query, { ...(input.semantic ? { semantic: true } : {}), ...near, ...(input.limit ? { limit: input.limit } : {}) }) as T;
      case "fragments.candidates": if (!board.fragmentCandidates) throw new Error("no fragments here"); return await board.fragmentCandidates(input.query) as T;
      case "files.complete": return await board.completeFiles(input.prefix) as T;
      case "extensions.list": return (board.listExtensions ? await board.listExtensions() : { extensions: [] }) as T;
      case "blocks.context": { const c = await board.blockContext(input.blockId); return { selected: c.selected && { ...c.selected, title: c.selected.text?.split("\n")[0] }, ancestors: c.ancestors } as T; }
    }
    throw new Error(`the fake has no ${action}`);
  } };
  return Object.assign(board, {
    completionRows: (r: any) => completionRows(svc, r, [], async () => [], {}),
    completionPicked: async () => ({}),
  });
}
