#!/usr/bin/env bun
// What a backfill of `[ticket::PIE-n]` on request copies would set (PIE-844), read-only: it reads through the running
// host and writes nothing. For each `[type::request]` note that names no ticket yet, the item it became, from (best
// first) a roadmap item whose `source-block` is the copy, the copy's `[where::PIE-n]`, a Work ID in a comment or reply
// on it, a Work ID in its own text (often prior art it cites, so marked to check). One line each, with the `work link` that would set it; several candidates, or none,
// are said so and left to a person.
//
//   bun packages/outliner/scripts/request-tickets.ts [--ws <outline>] [--prefix PIE] [--json]
//
// Delete it once the backfill has run on pie.
import { parseArgs } from "node:util";
import { createOutlinerClient } from "../src/client";
import { resolveClientPaths } from "../src/paths";
import { workIdReferences } from "../src/work-ids";
import type { AnnotationThread, Block } from "../src/types";

const { values } = parseArgs({
  args: process.argv.slice(2), strict: true,
  options: { ws: { type: "string" }, prefix: { type: "string", default: "PIE" }, json: { type: "boolean" } },
});
const env = values.ws ? { ...process.env, EP0CH_WS: values.ws } : process.env;
const client = createOutlinerClient(resolveClientPaths(env));
await client.requireCompatibleService();

const query = async (where: string) =>
  (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: 1000 } }, 30_000)).blocks;
const prop = (block: Block, key: string) => block.properties.filter((property) => property.key === key).map((property) => property.value);
const ids = (text: string) => workIdReferences(text, values.prefix!).map((reference) => reference.workId);

const items = await query("type=roadmap-item");
const known = new Set(items.flatMap((item) => prop(item, "work-id").map((id) => id.toUpperCase())));
const bySource = new Map<string, string[]>();
for (const item of items) {
  for (const source of prop(item, "source-block")) bySource.set(source, [...(bySource.get(source) ?? []), ...prop(item, "work-id")]);
}

interface Row { id: string; title: string; ticket: string | null; candidates: Array<{ workId: string; from: string }> }
const rows: Row[] = [];
for (const copy of await query("type=request")) {
  const title = (copy.text.split("\n")[0] ?? "").replace(/\s*\[[^\]]*::[^\]]*\]/g, "").trim().slice(0, 90);
  const ticket = prop(copy, "ticket")[0] ?? null;
  if (ticket) { rows.push({ id: copy.id, title, ticket, candidates: [] }); continue; }
  const threads = await client.request<AnnotationThread[]>({
    action: "annotations.list", query: { subject: { kind: "block", blockId: copy.id }, includeResolved: true },
  }, 30_000);
  const said = threads.flatMap((thread) => [thread, ...thread.replies]).map((record) => record.body).join("\n");
  const found = [
    ...(bySource.get(copy.id) ?? []).map((workId) => ({ workId, from: "source-block" })),
    ...prop(copy, "where").flatMap(ids).map((workId) => ({ workId, from: "where" })),
    ...ids(said).map((workId) => ({ workId, from: "comment" })),
    // Last: a Work ID in the request's own text is often prior art it cites, not the ticket it became.
    ...ids(copy.text).map((workId) => ({ workId, from: "text (check: may be prior art)" })),
  ].filter((candidate) => known.has(candidate.workId.toUpperCase()));
  const best = found[0]?.from;
  // The strongest kind of evidence decides; within it, each distinct Work ID once.
  const candidates = [...new Map(found.filter((candidate) => candidate.from === best).map((candidate) => [candidate.workId, candidate])).values()];
  rows.push({ id: copy.id, title, ticket: null, candidates });
}

if (values.json) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const named = rows.filter((row) => row.ticket);
  const one = rows.filter((row) => !row.ticket && row.candidates.length === 1);
  const several = rows.filter((row) => !row.ticket && row.candidates.length > 1);
  const none = rows.filter((row) => !row.ticket && row.candidates.length === 0);
  console.log(`${rows.length} request copies: ${named.length} name a ticket, ${one.length} would be set, ${several.length} have several candidates, ${none.length} have none.\n`);
  if (one.length) console.log("Would set (work link <copy> <ticket>):");
  for (const row of one) console.log(`  work link ${row.id} ${row.candidates[0]!.workId}   # ${row.candidates[0]!.from} · ${row.title}`);
  if (several.length) console.log("\nSeveral candidates (a person picks):");
  for (const row of several) console.log(`  ${row.id}  ${row.candidates.map((candidate) => candidate.workId).join(", ")} (${row.candidates[0]!.from}) · ${row.title}`);
  if (none.length) console.log("\nNo ticket found:");
  for (const row of none) console.log(`  ${row.id}  ${row.title}`);
}
