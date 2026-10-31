// The one owner of the questions a note's lines watch (PIE-1463, PIE-1467). A query-fed handler line (the manifest's
// `query`) and a render script's `q()`/`query()` both end in the service's one QueryWatches; this is the one place
// that says which line holds which watch and when it ends:
//
// - a line holds a virtual QueryWatches connection, a watch per question (`input` for a handler's, `q0`, `q1`… for a
//   script's), and a change to any answer comes back as one `changed(blockId)`;
// - a line's watches end with it: its block saved without the line, trashed (or any note above it), the extension gone,
//   a question that no longer binds, the host stopping;
// - the service drops the oldest watch at its cap (WATCH_LIMITS.perService); the line is told once and says so
//   (`lostReason`) instead of showing an old answer as live, and watches again when its note is saved or `r` is pressed.
//
// Whether a drawing is out of date is a separate question with one answer, `answerShape`: what a script drew depended
// on (the rows listed, the counts over every match, whether the list was complete), compared when the line is opened
// and when a watch says something changed.
import { WATCH_LIMITS } from "@ep0ch/outline-core/protocol";
import type { BlockSearchQuery, VisibleBlockCollection } from "./types";
import type { QueryWatches, WatchConnection } from "./query-watches";

/** What a drawing depended on in one answer: the listed ids, the counts over every match (groups, facets), and whether the list was complete. */
export function answerShape(answer: { ids: readonly string[]; complete: boolean; groups?: readonly { value: string | null; count: number }[]; facets?: unknown }): string {
  return Bun.hash(JSON.stringify([answer.ids, answer.complete, answer.groups?.map(g => [g.value, g.count]) ?? null, answer.facets ?? null])).toString(36);
}

/** The shape of a service answer (`blocks.query`): the same function a script's recorded query used when it was drawn. */
export const shapeOfAnswer = (answer: VisibleBlockCollection): string => answerShape({
  ids: answer.blocks.map(b => b.id), complete: answer.completeness.kind === "complete",
  ...(answer.groups ? { groups: answer.groups.map(g => ({ value: g.value, count: g.count })) } : {}), ...(answer.facets ? { facets: answer.facets } : {}),
});

/** A question a render script asked (`q()`, `query()`), kept with its output: what it asked, the rows listed, and the shape of the answer it drew from. */
export interface ScriptQueryRecord { query: string; limit: number; ids: string[]; shape: string; group?: string; sort?: string; facets?: true | string[] }

/** The service question a recorded script query was: asked again to compare, and watched. */
export const scriptQuestion = (block: { id: string }, q: ScriptQueryRecord): BlockSearchQuery => ({
  where: q.query, limit: q.limit, this: block.id,
  ...(q.group ? { group: q.group } : {}), ...(q.sort ? { sort: q.sort } : {}), ...(q.facets ? { facets: q.facets } : {}),
});

export interface LineWatchHooks {
  /** An answer a line watches changed (or its watch was dropped): the line looks again. */
  changed(blockId: string, dropped: boolean): void;
}

interface Held { connection: WatchConnection; slots: Set<string> }

export class LineWatches {
  private readonly held = new Map<string, Held>();
  private readonly lost = new Map<string, string>();

  constructor(private readonly watches: QueryWatches, private readonly hooks: LineWatchHooks) {}

  private key(blockId: string, callKey: string): string { return `${blockId}\0${callKey}`; }

  /** Ask `question` for a line and keep it watched under `slot`: the service's answer, or the refusal as an error. */
  ask(blockId: string, callKey: string, slot: string, question: BlockSearchQuery): VisibleBlockCollection {
    const key = this.key(blockId, callKey);
    const reason = this.lost.get(key);
    if (reason) throw new Error(reason);
    let held = this.held.get(key);
    if (!held) {
      const connection: WatchConnection = { write: (line: string) => {
        const event = (JSON.parse(line) as { event?: { changes?: { dropped?: boolean }[] } }).event;
        if (!event?.changes?.length) return;
        const dropped = event.changes.some(change => change.dropped);
        if (dropped) {
          // The service let go of the oldest watch: release the line's others too, and remember why.
          this.lost.set(key, `live updates paused: the host watches at most ${WATCH_LIMITS.perService} questions at once and this note's was the oldest. Save the note, or press r on the line, to watch it again`);
          this.release(key);
        }
        this.hooks.changed(blockId, dropped);
      } };
      held = { connection, slots: new Set() };
      this.held.set(key, held);
    }
    const response = this.watches.ask(held.connection, { id: "line-watch", action: "blocks.query", watch: slot, query: question });
    if (!response.ok) {
      this.forgetLine(blockId, callKey);
      throw new Error(response.error);
    }
    held.slots.add(slot);
    return response.result as VisibleBlockCollection;
  }

  /** The line's watches other than these slots end (a script that now asks fewer questions). */
  keepOnly(blockId: string, callKey: string, slots: ReadonlySet<string>): void {
    const held = this.held.get(this.key(blockId, callKey));
    if (!held) return;
    // QueryWatches ends a connection's watches with it, so a smaller set is the line asked again from nothing.
    if (!slots.size || [...held.slots].some(slot => !slots.has(slot))) this.forgetLine(blockId, callKey);
  }

  /** Every watch of the line ends. */
  forgetLine(blockId: string, callKey: string): void { this.release(this.key(blockId, callKey)); }

  /** Every line of a block ends its watches (the block was deleted). */
  forgetBlock(blockId: string): void {
    for (const key of [...this.held.keys()]) if (key.startsWith(`${blockId}\0`)) this.release(key);
    for (const key of [...this.lost.keys()]) if (key.startsWith(`${blockId}\0`)) this.lost.delete(key);
  }

  /** Lines whose block is gone (trashed with a note above it, or deleted) end their watches. */
  forgetGone(gone: (blockId: string) => boolean): void {
    for (const key of [...this.held.keys(), ...this.lost.keys()]) {
      const blockId = key.slice(0, key.indexOf("\0"));
      if (gone(blockId)) { this.release(key); this.lost.delete(key); }
    }
  }

  /** The lines holding a watch, for a sweep of those that no longer should. */
  lines(): { blockId: string; callKey: string }[] {
    return [...this.held.keys()].map(key => { const at = key.indexOf("\0"); return { blockId: key.slice(0, at), callKey: key.slice(at + 1) }; });
  }

  /** Why a line's watch ended without it asking (the service's cap), or undefined while it holds one. */
  lostReason(blockId: string, callKey: string): string | undefined { return this.lost.get(this.key(blockId, callKey)); }

  /** The person saved the note or pressed r: its lines may watch again. */
  retry(blockId: string): void {
    for (const key of [...this.lost.keys()]) if (key.startsWith(`${blockId}\0`)) this.lost.delete(key);
  }

  stop(): void {
    for (const key of [...this.held.keys()]) this.release(key);
    this.lost.clear();
  }

  private release(key: string): void {
    const held = this.held.get(key);
    if (!held) return;
    this.held.delete(key);
    this.watches.closed(held.connection);
  }
}
