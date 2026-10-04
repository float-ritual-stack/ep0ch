import type {OutlinerRequester} from "./client-target";
import {parsePropertyRecords} from "./properties";
import type {Block, PageAddressResolution, VirtualBranchOrder, VirtualBranchPlacement, WorkingSelection, WorkingSelectionRecovery, WorkingSelectionTarget} from "./types";

/** A collected set is separate from cursor focus and never protects a reader. */
export class TreeWorkingSelection {
  current: WorkingSelection | null = null;
  recovery: WorkingSelectionRecovery = {selections: [], completeness: {kind: "complete"}};
  recovered = false;
  error = "";
  busy = false;
  private pending: Promise<unknown> = Promise.resolve();
  private loaded = false;

  constructor(private readonly requester: OutlinerRequester, private readonly ownerClientId: string, private readonly changed: () => void) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(async () => {
      this.busy = true; this.error = ""; this.changed();
      try { return await operation(); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); throw error; }
      finally { this.busy = false; this.changed(); }
    });
    this.pending = next.catch(() => {});
    return next;
  }

  private async load(): Promise<void> {
    this.current = await this.requester.request<WorkingSelection | null>({action: "working-selection.get", ownerClientId: this.ownerClientId}) ?? null;
    this.recovery = await this.requester.request<WorkingSelectionRecovery>({action: "working-selection.recoverable", ownerClientId: this.ownerClientId});
    this.loaded = true;
  }

  refresh(): Promise<void> { return this.run(() => this.load()); }

  ordered(rowIds: readonly string[]): WorkingSelectionTarget[] {
    const indices = new Map(rowIds.map((id, i) => [id, i]));
    return [...this.current?.targets ?? []].sort((a, b) =>
      (indices.get(a.rowId) ?? Infinity) - (indices.get(b.rowId) ?? Infinity));
  }

  toggle(target: WorkingSelectionTarget, rowIds: readonly string[]): Promise<void> {
    return this.run(async () => {
      if (!this.loaded) await this.load();
      const existing = this.current?.targets ?? [];
      const targets = existing.some(t => t.blockId === target.blockId)
        ? existing.filter(t => t.blockId !== target.blockId) : [...existing, target];
      const indices = new Map(rowIds.map((id, i) => [id, i]));
      targets.sort((a, b) => (indices.get(a.rowId) ?? Infinity) - (indices.get(b.rowId) ?? Infinity));
      this.current = await this.requester.request({action: "working-selection.save", input: {
        ownerClientId: this.ownerClientId, expected: this.current, targets,
      }});
      if (!this.current) this.recovered = false;
    });
  }

  clear(): Promise<void> {
    return this.run(async () => {
      if (!this.loaded) await this.load();
      this.current = await this.requester.request({action: "working-selection.save", input: {
        ownerClientId: this.ownerClientId, expected: this.current, targets: [],
      }});
      this.recovered = false;
    });
  }

  resume(id: string): Promise<void> {
    return this.run(async () => {
      const record = this.recovery.selections.find(s => s.id === id);
      if (!record) throw Error("Recovery choice changed; reopen the selection menu");
      this.current = await this.requester.request({action: "working-selection.resume", ownerClientId: this.ownerClientId,
        selectionId: record.id, expectedRevision: record.revision});
      this.recovered = true;
      await this.load();
    });
  }

  private async verifyCurrent(): Promise<void> {
    const saved = await this.requester.request<WorkingSelection | null>({action: "working-selection.get", ownerClientId: this.ownerClientId});
    if (saved?.id !== this.current?.id || saved?.revision !== this.current?.revision) {
      throw Error("Selection changed; reopen Selected items before acting on it");
    }
  }

  rankReason(): string | null {
    const targets = this.current?.targets ?? [];
    const first = targets[0];
    if (!first) return "Select items first";
    if (targets.some(t => !t.rankRoot || !t.viewId)) return "Ranking requires matched roots in a virtual branch; contextual children cannot be ranked";
    if (targets.some(t => t.viewId !== first.viewId || t.parentRowId !== first.parentRowId)) return "Select items from one virtual branch appearance to rank them";
    return null;
  }

  rank(placement: VirtualBranchPlacement): Promise<void> {
    return this.run(async () => {
      await this.verifyCurrent();
      const reason = this.rankReason();
      if (reason) throw Error(reason);
      const targets = this.current!.targets;
      const expected = await this.requester.request<VirtualBranchOrder>({action: "virtual.occurrences.order", viewId: targets[0]!.viewId!});
      if (targets.some(t => !expected.blockIds.includes(t.blockId))) throw Error("Selected targets no longer match this branch; inspect and remove them before ranking");
      await this.requester.request({action: "virtual.occurrences.place", mutation: {author: "user", actorId: "tree"}, input: {expected, selectedBlockIds: targets.map(t => t.blockId), placement, selection:this.current!}});
    });
  }

  copy(kind: "ids" | "references" | "pages", rowIds: readonly string[]): Promise<string> {
    return this.run(async () => {
      await this.verifyCurrent();
      const targets = this.ordered(rowIds);
      if (!targets.length) throw Error("Select items first");
      const lines: string[] = [];
      for (const target of targets) {
        const block = await this.requester.request<Block | null>({action: "get", blockId: target.blockId});
        if (!block || block.effectiveDeletedRootId || block.deletedAt) throw Error("Selection includes unavailable targets; inspect and remove them before copying");
        if (kind === "ids") lines.push(block.id);
        else if (kind === "references") lines.push(`((${block.id}))`);
        else {
          const addresses = parsePropertyRecords(block.text).filter(p => p.scope === "block" && ["page", "alias", "work-id"].includes(p.key));
          let address: string | undefined;
          for (const p of addresses) {
            const resolved = await this.requester.request<PageAddressResolution>({action: "pages.resolve", address: p.value});
            if (resolved.status === "resolved" && resolved.block?.id === block.id) { address = resolved.registeredAddress ?? p.value; break; }
          }
          if (!address) throw Error(`No page address for ${block.id}; choose Copy block references instead`);
          lines.push(`[[${address}]]`);
        }
      }
      await this.verifyCurrent();
      return lines.join("\n");
    });
  }
}
