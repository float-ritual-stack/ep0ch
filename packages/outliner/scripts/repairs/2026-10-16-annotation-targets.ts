/*
 * Repair (PIE-933): every comment has its target. Comments written as plain text (an EchoNet toss copying a comment
 * before copies were kept as notes, an agent's plain write) landed with `[type::annotation]` and no row in
 * `annotation_targets`: no note showed them, and opening, answering or resolving one threw "Annotation target not
 * found". The service now gives any such comment its target in the same write (`AnnotationRepository.adopt`); this
 * script does the same for the ones already stored:
 *
 *   bun packages/outliner/scripts/repairs/2026-10-16-annotation-targets.ts <database>
 *
 * Each comment with no target becomes a comment on the note it sits under (a whole-note target and its first
 * resolution event, as a comment made through the service has). A reply copied under one whose `[parent-annotation::…]`
 * names a comment that isn't in this outline (the copy's original) is pointed at the comment it sits under. Everything
 * runs in one transaction. It opens the outline as the host does, so a file a host is serving is refused ("already
 * owned") and left as it was: stop the host, or work on a copy (`sqlite3 <db> "VACUUM INTO '<copy>'"`). It prints the
 * counts before and after; a second run changes nothing. A one-off: run it on pie, then delete it (git keeps it).
 */
import { OutlinerStore } from "../../src/store";
import { parsePropertyRecords, patchPropertyText } from "../../src/properties";

export interface AnnotationTargetRepair {
  /** Comments with no target before the run. */
  before: number;
  /** Comments with no target after it (0 when it worked; the unreadable ones are counted apart). */
  after: number;
  restored: string[];
  /** Replies whose `parent-annotation` was pointed at the comment they sit under. */
  relinked: string[];
  /** Comments whose own properties don't read; they stay as written, and `untargeted` says why. Not part of `after`'s zero. */
  unreadable: Array<{ id: string; why: string }>;
}

const untargetedRoots = (store: OutlinerStore): number => (store.database.query(`
  SELECT COUNT(DISTINCT p.block_id) AS n FROM block_properties p JOIN blocks b ON b.id = p.block_id
  WHERE p.scope = 'block' AND p.key = 'type' AND p.value = 'annotation' AND b.effective_deleted_root_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM annotation_targets t WHERE t.annotation_block_id = p.block_id)`).get() as { n: number }).n;

export function repairAnnotationTargets(path: string): AnnotationTargetRepair {
  const store = new OutlinerStore(path);
  try {
    return store.database.transaction((): AnnotationTargetRepair => {
      const before = untargetedRoots(store);
      const { adopted: restored, unreadable } = store.annotations.adoptStrays();
      // A reply whose named comment has no target here but whose own parent block is a comment that has one.
      const stray = store.database.query(`
        SELECT b.id AS id, b.parent_id AS parent, b.revision AS revision, b.text AS text, pa.value AS named
        FROM blocks b
        JOIN block_properties type ON type.block_id = b.id AND type.scope = 'block' AND type.key = 'type' AND type.value = 'annotation-reply'
        JOIN block_properties pa ON pa.block_id = b.id AND pa.scope = 'block' AND pa.key = 'parent-annotation'
        WHERE b.effective_deleted_root_id IS NULL AND b.parent_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM annotation_targets t WHERE t.annotation_block_id = pa.value)
          AND EXISTS (SELECT 1 FROM annotation_targets t WHERE t.annotation_block_id = b.parent_id)
        ORDER BY b.created_at, b.id`).all() as Array<{ id: string; parent: string; revision: number; text: string; named: string }>;
      const relinked: string[] = [];
      for (const reply of stray) {
        const ordinal = parsePropertyRecords(reply.text).findIndex((property) => property.scope === "block" && property.key === "parent-annotation");
        if (ordinal < 0) continue;
        const next = patchPropertyText(reply.text, [{ op: "replace", ordinal, value: reply.parent }]);
        store.update(reply.id, next, reply.revision, { author: "system" });
        relinked.push(reply.id);
      }
      const after = untargetedRoots(store) - unreadable.length;
      if (after !== 0) throw new Error(`${after} comments could not be given a target; nothing was changed`);
      return { before, after, restored, relinked, unreadable };
    })();
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("usage: bun packages/outliner/scripts/repairs/2026-10-16-annotation-targets.ts <database>");
    process.exit(2);
  }
  try {
    const result = repairAnnotationTargets(path);
    console.log(`comments with no target: ${result.before} before, ${result.after} after; restored ${result.restored.length}, replies re-pointed ${result.relinked.length}, unreadable ${result.unreadable.length}`);
    for (const { why } of result.unreadable) console.log(why);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
