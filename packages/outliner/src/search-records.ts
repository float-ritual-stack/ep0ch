// What ranked search leaves behind (PIE-1197, PIE-1198), so its cost and its judgment can be read and measured:
//
// - the day's `jev-run` (`experiment::search-live`), counted up in place as figure-fit's is: `items` searches Jev ranked,
//   `suggested` the ones that said "no strong match", `quiet` the sure ones, `unavailable` the asks Jev couldn't answer,
//   and the tokens. pie's Jev's suggestions page reads every `jev-run`, so the loop's cost shows beside the others.
// - the picks (`search.picked`): the query, the row opened and its place, kept in the outline's metadata (the last
//   PICKS_KEPT, not note content) for the search eval to label a query with what was wanted.
// Best-effort: a search's answer never waits on, or fails for, its bookkeeping.
import type { SearchCertainty, SearchPickedRequest } from "@ep0ch/outline-core/protocol";
import { chipNumber, chipValue, dayOf, promptRevOf, setChip, type SuggestionClient } from "./jev-suggestions";
import type { JevReading } from "./jev";
import { writeRecord, type RecordWho } from "./records";
import type { Block, VisibleBlockCollection } from "./types";

export const SEARCH_LIVE_EXPERIMENT = "search-live";
export const SEARCH_PICKS_METADATA_KEY = "search.picks";
export const PICKS_KEPT = 500;
const JEV: RecordWho = { author: "agent", provenance: { actorId: "jev/search" } };

export interface SearchPick extends SearchPickedRequest { at: string }

/** The picks kept, oldest first; a value that can't be read is none. */
export function readSearchPicks(raw: string | undefined): SearchPick[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(p => p && typeof p.query === "string" && typeof p.blockId === "string") : []; } catch { return []; }
}

/** The request checked at the boundary: what a pick must carry. */
export function readSearchPicked(input: Record<string, unknown>): SearchPickedRequest {
  const { query, blockId, rank, surface } = input;
  if (typeof query !== "string" || !query.trim() || query.length > 500) throw new Error("search.picked needs query: the words searched (up to 500 characters)");
  if (typeof blockId !== "string" || !blockId) throw new Error("search.picked needs blockId: the row opened");
  if (!Number.isSafeInteger(rank) || (rank as number) < 0) throw new Error("search.picked needs rank: the row's place, 0 first");
  if (typeof surface !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(surface)) throw new Error("search.picked needs surface: where it was opened (power-bar, complete, goto)");
  return { query: query.trim(), blockId, rank: rank as number, surface };
}

export function keepSearchPick(picks: readonly SearchPick[], pick: SearchPickedRequest, now = new Date()): SearchPick[] {
  return [...picks, { ...pick, at: now.toISOString() }].slice(-PICKS_KEPT);
}

export type SearchTally =
  | { kind: "ranked"; sure: SearchCertainty | undefined; reading: Pick<JevReading, "model" | "prompt" | "usage"> }
  | { kind: "unavailable" };

/** One ranked search (or one Jev couldn't answer) counted on the day's run. Never throws. */
export async function tallySearch(client: SuggestionClient, tally: SearchTally, now = new Date()): Promise<void> {
  try {
    const day = dayOf(now);
    const find = async () => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `type=jev-run experiment=${SEARCH_LIVE_EXPERIMENT} run=${day}`, machinery: "show", limit: 1 } })).blocks[0];
    let run = await find();
    if (!run) {
      const zero = Object.fromEntries(["items", "agreed", "agreement", "suggested", "different", "ignored", "quiet", "unavailable", "tokens-in", "tokens-out"].map(k => [k, "0"]));
      await writeRecord({ request: (action, params) => client.request({ action, ...params } as never) }, "jev-run", { experiment: SEARCH_LIVE_EXPERIMENT, run: day, model: "unknown", "prompt-rev": "unknown", ...zero }, JEV, { title: `search ${day}` });
      run = await find();
      if (!run) return;
    }
    let text = run.text;
    const add = (key: string, n: number) => { text = setChip(text, key, chipNumber(text, key) + n); };
    if (tally.kind === "unavailable") add("unavailable", 1);
    else {
      add("items", 1);
      if (tally.sure?.verdict === "strong") add("quiet", 1); else if (tally.sure) add("suggested", 1);
      text = setChip(text, "model", chipValue(tally.reading.model));
      text = setChip(text, "prompt-rev", chipValue(promptRevOf(tally.reading)));
      add("tokens-in", tally.reading.usage?.input ?? 0);
      add("tokens-out", tally.reading.usage?.output ?? 0);
    }
    if (text !== run.text) await client.request<Block>({ action: "update", blockId: run.id, text, expectedRevision: run.revision, mutation: { author: "agent", actorId: JEV.provenance!.actorId! } });
  } catch { /* best-effort */ }
}
