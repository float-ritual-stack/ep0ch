#!/usr/bin/env bun
// Rewrites one outline's note mover rules from the old name (PIE-1314): each `[type::route]` rule, its history, the
// seeded view and any saved view asking for `type=route`, through the running host, attributed. A dry run by default:
// it lists every note it would change, and the notes it leaves as written (a rule with no target yet, words about the
// old name). Running it twice changes nothing the second time.
//
//   bun packages/outliner/scripts/rename-route-to-note-mover.ts --ws <outline> [--apply] [--author agent] [--actor loki]
//
// Delete it once pie, gurgle and float-hub have run it.
import { parseArgs } from "node:util";
import { renamedHistoryText, renamedRuleText, renamedView } from "@ep0ch/outline-core/note-mover-rename";
import { createOutlinerClient } from "../src/client";
import { resolveClientPaths } from "../src/paths";
import type { Block } from "../src/types";

const { values } = parseArgs({
  args: process.argv.slice(2), strict: true,
  options: { ws: { type: "string" }, apply: { type: "boolean" }, author: { type: "string", default: "agent" }, actor: { type: "string", default: "loki" } },
});
if (!values.ws) {
  console.error("usage: bun packages/outliner/scripts/rename-route-to-note-mover.ts --ws <outline> [--apply] [--author agent] [--actor loki]");
  process.exit(2);
}
const client = createOutlinerClient(resolveClientPaths({ ...process.env, EP0CH_WS: values.ws }));
await client.requireCompatibleService();

const find = async (query: Record<string, unknown>) =>
  (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { limit: 1000, machinery: "show", ...query } }, 30_000)).blocks;
const notes = new Map<string, Block>();
for (const asked of [{ where: "type=route" }, { where: "type=route-history" }, { where: "system-view=routing" }, { text: "type=route" }]) {
  for (const block of await find(asked)) if (!block.effectiveDeletedRootId) notes.set(block.id, block);
}

/** The note under the new names, and what it is; null when there's nothing here to rewrite. */
function rewritten(text: string): { text: string; was: string[] } | null {
  let now = text;
  const was: string[] = [];
  for (const [kind, rewrite] of [["rule", renamedRuleText], ["history", renamedHistoryText], ["view", renamedView]] as const) {
    const next = rewrite(now);
    if (next !== null && next !== now) { now = next; was.push(kind); }
  }
  return was.length ? { text: now, was } : null;
}

const firstLine = (text: string) => text.split("\n", 1)[0]!.slice(0, 120);
let changed = 0, failed = 0;
const left: Block[] = [];
for (const block of notes.values()) {
  const next = rewritten(block.text);
  if (!next) { left.push(block); continue; }
  console.log(`${block.id.slice(0, 8)} ${next.was.join("+")}\n  was ${firstLine(block.text)}\n  now ${firstLine(next.text)}`);
  if (!values.apply) { changed += 1; continue; }
  try {
    await client.request({
      action: "update", blockId: block.id, text: next.text, expectedRevision: block.revision,
      mutation: { author: values.author, actorId: values.actor, taskId: "PIE-1314" },
    }, 30_000);
    changed += 1;
  } catch (error) {
    failed += 1;
    console.error(`  couldn't write it: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const block of left) console.log(`${block.id.slice(0, 8)} left as written: ${firstLine(block.text)}`);
console.log(values.apply ? `${changed} changed, ${failed} failed, ${left.length} left as written` : `${changed} would change, ${left.length} left as written. A dry run: add --apply to write them.`);
process.exit(failed ? 1 : 0);
