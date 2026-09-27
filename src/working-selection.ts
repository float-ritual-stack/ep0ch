import type {Database} from "bun:sqlite";
import type {WorkingSelection, WorkingSelectionRecovery, WorkingSelectionSaveInput, WorkingSelectionTarget} from "./types";

interface SelectionRow {
  id: string;
  owner_client_id: string;
  revision: number;
  updated_at: string;
  targets: string;
}

function selection(row: SelectionRow): WorkingSelection {
  return {id: row.id, ownerClientId: row.owner_client_id, revision: row.revision,
    updatedAt: row.updated_at, targets: JSON.parse(row.targets)};
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw Error("Invalid working selection identifier");
  }
}

function targets(value: WorkingSelectionTarget[]): WorkingSelectionTarget[] {
  if (!Array.isArray(value) || value.length > 1000) throw Error("Working selection limit is 1000 targets");
  const seen = new Set<string>();
  return value.map(target => {
    if (!target || typeof target !== "object") throw Error("Invalid working selection target");
    identifier(target.blockId); identifier(target.rowId);
    if (target.viewId !== undefined) identifier(target.viewId);
    if (target.parentRowId !== undefined && target.parentRowId !== null) identifier(target.parentRowId);
    if (target.rankRoot !== undefined && typeof target.rankRoot !== "boolean") throw Error("Invalid working selection rank context");
    if (seen.has(target.blockId)) throw Error("Duplicate canonical block in working selection");
    seen.add(target.blockId);
    // Persist identity only. Titles and content are always read from their current owner.
    return {blockId: target.blockId, rowId: target.rowId,
      ...(target.viewId !== undefined ? {viewId: target.viewId} : {}),
      ...(target.rankRoot !== undefined ? {rankRoot: target.rankRoot} : {}),
      ...(target.parentRowId !== undefined ? {parentRowId: target.parentRowId} : {})};
  });
}

/** Service-owned temporary state; intentionally independent of canonical focus and content. */
export class WorkingSelectionRepository {
  constructor(private readonly database: Database) {
    database.exec(`CREATE TABLE IF NOT EXISTS working_selections (
      id TEXT PRIMARY KEY,
      owner_client_id TEXT NOT NULL UNIQUE,
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      targets TEXT NOT NULL
    )`);
  }

  get(ownerClientId: string): WorkingSelection | null {
    identifier(ownerClientId);
    const row = this.database.query("SELECT * FROM working_selections WHERE owner_client_id = ?").get(ownerClientId) as SelectionRow | null;
    return row ? selection(row) : null;
  }

  save(input: WorkingSelectionSaveInput): WorkingSelection | null {
    identifier(input.ownerClientId);
    const nextTargets = targets(input.targets);
    return this.database.transaction(() => {
      const current = this.get(input.ownerClientId);
      if (input.expected) {
        const row = this.database.query("SELECT * FROM working_selections WHERE id = ?").get(input.expected.id) as SelectionRow | null;
        if (row && row.owner_client_id !== input.ownerClientId) throw Error("Working selection owner changed");
        if (!current || current.id !== input.expected.id || current.revision !== input.expected.revision) {
          throw Error("Working selection changed or is missing; refresh before changing it");
        }
      } else if (current) throw Error("Working selection already exists; refresh before changing it");

      if (!nextTargets.length) {
        if (current) this.database.query("DELETE FROM working_selections WHERE id = ?").run(current.id);
        return null;
      }
      const id = current?.id ?? crypto.randomUUID();
      const revision = (current?.revision ?? 0) + 1;
      this.database.query(`INSERT INTO working_selections (id, owner_client_id, revision, updated_at, targets)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision,
        updated_at = excluded.updated_at, targets = excluded.targets`).run(
        id, input.ownerClientId, revision, new Date().toISOString(), JSON.stringify(nextTargets));
      return this.get(input.ownerClientId);
    })();
  }

  recoverable(ownerClientId: string, liveClientIds: readonly string[]): WorkingSelectionRecovery {
    identifier(ownerClientId);
    const excluded = JSON.stringify([...new Set([...liveClientIds, ownerClientId])]);
    const rows = this.database.query(`SELECT * FROM working_selections
      WHERE owner_client_id NOT IN (SELECT value FROM json_each(?))
      ORDER BY updated_at DESC, id LIMIT 101`).all(excluded) as SelectionRow[];
    return {selections: rows.slice(0, 100).map(selection), completeness: rows.length > 100
      ? {kind: "truncated", limit: 100} : {kind: "complete"}};
  }

  resume(ownerClientId: string, selectionId: string, expectedRevision: number, liveClientIds: readonly string[]): WorkingSelection {
    identifier(ownerClientId); identifier(selectionId);
    return this.database.transaction(() => {
      const row = this.database.query("SELECT * FROM working_selections WHERE id = ?").get(selectionId) as SelectionRow | null;
      if (!row || row.revision !== expectedRevision) throw Error("Recoverable selection changed or is missing");
      if (row.owner_client_id !== ownerClientId && liveClientIds.includes(row.owner_client_id)) {
        throw Error("Selection belongs to a live connected pane");
      }
      if (this.get(ownerClientId)) throw Error("Clear the current selection before resuming another");
      this.database.query(`UPDATE working_selections SET owner_client_id = ?, revision = revision + 1,
        updated_at = ? WHERE id = ?`).run(ownerClientId, new Date().toISOString(), selectionId);
      return this.get(ownerClientId)!;
    })();
  }
}
