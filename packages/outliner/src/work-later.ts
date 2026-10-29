// What a groom parks, and the way back (PIE-1421). Evan, Oct 29: "stuff gets flagged, then deferred, then never done":
// the Oct 24 cut aimed at a count and parked 268 items in `later` with `[wreckage::<day>]`, among them high-priority,
// decided, two-day-old work, and `later` had no reader.
//
// - **The cut** (`park`): a groom parks only what nobody still holds. `keptBecause` is the one answer to "may this be
//   parked?": high priority, under 14 days old, or decided stays queued, and the pass says why. `work set … later`
//   by hand asks the same question and warns.
// - **The way back** (`revive`): over what's parked, code finds what wants it again since the day it was parked: a
//   comment on it (nudged), a note made since that names or links it, or live work that links it. Jev reads each new
//   note ("does it ask for this work now, or only cite it?"); a nudge needs no Jev. What comes back is queued again
//   with a line saying why, and a `groom-later` record per item, so "how many came back this week" is a query. One
//   parked against the keep rule (the Oct 24 cut's high and decided items) is listed `misparked` with the command
//   that restores it, not restored wholesale: dozens of old high items back in queued at once is a second flood.
//
// Read-only unless `apply`. Jev never closes anything: the groom's own pass (work-groom.ts, `--where` over later) is
// how a parked item that shipped gets its comment for the verifier.
import { workIdOf } from "@ep0ch/outline-core/work-id-title";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { isMachinery } from "@ep0ch/outline-core/machinery";
import { askNouls, board, chips, clip, costOf, jevWho, noul, recordRun, YES, type JevOptions, type JevReading, type WorkJevClient } from "./work-jev";
import { itemTitle } from "./work-twins";
import { KEEP_DAYS, keptBecause } from "./work-keep";

export { KEEP_DAYS, keptBecause };
import { propertyTransition } from "./work-tools";
import { writeRecord } from "./records";
import type { BacklinkCollection, Block, VisibleBlockCollection } from "./types";

const LOOP = "work-later";
const DAY = 86_400_000;
/** The stages an item is live in: a link from one of these is current work asking for it. */
const LIVE = new Set(["unprioritized", "queued", "doing", "review", "validate"]);
const PARKED_OR_CLOSED = new Set(["later", "done", "superseded"]);

const propOf = (b: Pick<Block, "properties">, key: string) => b.properties.find(p => p.key === key)?.value;
const bodyLines = (text: string) => text.split("\n").slice(1);

/**
 * When `item` was parked: its `[parked-at::<time>]` (the cut writes it beside the day), else the end of its
 * `[wreckage::<day>]` (a whole UTC day: what an older cut wrote that day isn't news), or null.
 */
export function parkedAt(item: Pick<Block, "properties">): Date | null {
  const exact = new Date(propOf(item, "parked-at")?.trim() ?? "");
  if (!Number.isNaN(exact.getTime())) return exact;
  const day = propOf(item, "wreckage")?.trim();
  if (!day) return null;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : day);
  if (Number.isNaN(at.getTime())) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(at.getTime() + DAY) : at;
}

export type LaterOutcome = "parked" | "kept" | "restored" | "misparked" | "stays";
export interface LaterRow {
  ticket: string;
  id: string;
  title: string;
  outcome: LaterOutcome;
  /** Why, in a line: the keep rule, or what wants it again. */
  why: string;
  /** The note that asked for it again, when one did. */
  source?: string;
  by: "code" | "jev";
}
export interface LaterReport { mode: "park" | "revive"; rows: LaterRow[]; counts: Record<LaterOutcome, number>; tokens: number; cost: string; jev: string; reading?: JevReading; applied: boolean }

export interface LaterOptions extends JevOptions {
  /** Which items: a query in the views' grammar. */
  where?: string;
  limit?: number;
  /** Write it: park, or restore. Without, the pass reads only. */
  apply?: boolean;
  /** park: only items nobody touched for this many days (default 30). */
  olderThanDays?: number;
  /** Whether Jev is asked at all (revive). */
  jev?: boolean;
  /** Who the writes are attributed to: an agent's name (default jev/work-later). */
  actor?: string;
  now?: Date;
  progress?: (line: string) => void;
}

const who = (o: Pick<LaterOptions, "actor">) => ({ author: "agent" as const, actorId: o.actor ?? `jev/${LOOP}` });
const countsOf = (rows: readonly LaterRow[]) => {
  const counts = { parked: 0, kept: 0, restored: 0, misparked: 0, stays: 0 } as Record<LaterOutcome, number>;
  for (const r of rows) counts[r.outcome]++;
  return counts;
};

async function query(client: WorkJevClient, where: string, limit = 1000): Promise<Block[]> {
  return (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, limit: Math.min(limit, 1000) } })).blocks;
}

/** The cut: items matching `where` untouched for `olderThanDays` go to later with `[wreckage::<day>]`, unless kept. */
export async function park(client: WorkJevClient, o: LaterOptions = {}): Promise<LaterReport> {
  const now = o.now ?? new Date(), day = now.toISOString().slice(0, 10), stale = (o.olderThanDays ?? 30) * DAY;
  // The service filters by age before the limit, so --limit counts stale items, not the first few looked at.
  const items = (await query(client, `(${o.where ?? "type=roadmap-item work-stage=queued"}) updated <= ${new Date(now.getTime() - stale).toISOString()}`, o.limit)).filter(b => now.getTime() - new Date(b.updatedAt).getTime() >= stale);
  const rows: LaterRow[] = [];
  for (const item of items) {
    const ticket = workIdOf(item) ?? item.id.slice(0, 8), title = itemTitle(item), kept = keptBecause(item, now);
    if (kept) { rows.push({ ticket, id: item.id, title, outcome: "kept", why: kept, by: "code" }); continue; }
    rows.push({ ticket, id: item.id, title, outcome: "parked", why: `untouched since ${item.updatedAt.slice(0, 10)}`, by: "code" });
    if (!o.apply) continue;
    const fresh = await client.request<Block>({ action: "get", blockId: item.id });
    await client.request<Block>({ action: "properties.patch", blockId: item.id, expectedRevision: fresh.revision, mutation: who(o),
      operations: [propertyTransition(fresh, "work-stage", "later"), propertyTransition(fresh, "wreckage", day), propertyTransition(fresh, "parked-at", now.toISOString())] });
  }
  const report: LaterReport = { mode: "park", rows, counts: countsOf(rows), tokens: 0, cost: costOf(0), jev: "not asked", applied: !!o.apply };
  if (o.apply) await keepLater(client, report, o);
  return report;
}

interface Signal { kind: "nudged" | "named" | "linked"; note: Block; line: string }

/**
 * What asked for `item` since `since`: comments on it, notes made since that link or name it (the service's backlinks:
 * `((id))`, `[[PIE-n]]` and a Work ID written plainly), and live work linking it. Machinery and the loops' own notes
 * don't count. A failed lookup throws: an item is never "nothing asked" because a read failed.
 */
export async function wantedAgain(client: WorkJevClient, item: Block, since: Date): Promise<Signal[]> {
  const workId = workIdOf(item), after = (iso: string) => new Date(iso).getTime() > since.getTime();
  const isJev = (b: Pick<Block, "actorId">) => (b.actorId ?? "").startsWith("jev/");
  const out: Signal[] = [];
  // Nudged: a comment on it, by anyone but a loop.
  const under = (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "type=annotation OR type=annotation-reply", subtreeRootId: item.id, limit: 200 } })).blocks;
  for (const c of under) if (after(c.createdAt) && !isJev(c)) out.push({ kind: "nudged", note: c, line: clip(bodyLines(c.text).filter(l => !/^\s*\[[^\]]+::[^\]]*\]/.test(l)).join(" "), 160) });
  // Linked or named: the service's backlinks, which say each source's placement and stage (backlink-facets.ts).
  const back = await client.request<BacklinkCollection>({ action: "references.backlinks", query: { targetBlockId: item.id, limit: 100 } });
  const others = back.sources.filter(s => s.facets?.placement !== "self" && s.facets?.placement !== "descendant" && (after(s.createdAt) || after(s.updatedAt)));
  const blocks = await Promise.all(others.map(s => client.request<Block>({ action: "get", blockId: s.blockId })));
  for (const [i, s] of others.entries()) {
    const b = blocks[i]!;
    if (isJev(b) || isMachinery(b.properties)) continue;
    // The workboard owns what a work-stage means: a later, done or superseded item asks for nothing.
    const stage = s.facets?.stage?.property === "work-stage" ? s.facets.stage.value.toLowerCase() : undefined;
    if (stage && PARKED_OR_CLOSED.has(stage)) continue;
    const line = clip(b.text.split("\n").find(l => (workId && l.includes(workId)) || l.includes(item.id)) ?? b.text.split("\n")[0]!, 160);
    if (after(b.createdAt)) out.push({ kind: "named", note: b, line });
    else if (stage && LIVE.has(stage)) out.push({ kind: "linked", note: b, line });
  }
  return out;
}

const noteName = (b: Block) => workIdOf(b) ?? clip(itemTitle(b) || b.text.split("\n")[0]!, 60);

/** The way back: each parked item that's wanted again is queued, with a line saying why. */
export async function revive(client: WorkJevClient, o: LaterOptions = {}): Promise<LaterReport> {
  const items = await query(client, o.where ?? "type=roadmap-item work-stage=later wreckage", o.limit);
  const rows: LaterRow[] = [];
  let tokens = 0, jev = o.jev === false ? "off" : "not asked", reading: JevReading | undefined;
  for (const [n, item] of items.entries()) {
    const ticket = workIdOf(item) ?? item.id.slice(0, 8), title = itemTitle(item), since = parkedAt(item) ?? new Date(item.updatedAt);
    const row = (outcome: LaterOutcome, why: string, by: "code" | "jev" = "code", source?: string): LaterRow => ({ ticket, id: item.id, title, outcome, why, by, ...(source ? { source } : {}) });
    o.progress?.(`${n + 1}/${items.length} ${ticket}`);
    const signals = await wantedAgain(client, item, since);
    const nudge = signals.find(s => s.kind === "nudged");
    if (nudge) { rows.push(row("restored", `nudged: a comment ${nudge.note.createdAt.slice(0, 10)}: ${nudge.line}`, "code", nudge.note.id)); continue; }
    // Parked against the rule and nothing asked since: listed with its restore command, for a person or agent to judge.
    // A wreckage day reads as its end (parkedAt): the keep rule is asked as of its start, when the cut ran.
    const kept = keptBecause(item, propOf(item, "parked-at") ? since : since.getTime() - DAY);
    if (!signals.length) { rows.push(kept ? row("misparked", `parked though ${kept}: ep0ch work stage ${ticket} queued`) : row("stays", "nothing asked for it since")); continue; }
    const say = (s: Signal) => {
      const name = noteName(s.note), line = s.line.startsWith(name.replace(/…$/, "")) ? "" : `: ${s.line}`;
      return `${s.kind === "linked" ? "linked from live work" : "named in a note since"}, ${s.note.updatedAt.slice(0, 10)}, ${name}${line}`;
    };
    // Jev reads each note that names it: wanted now, or only cited (prior art, a list of what was parked)?
    if (o.jev === false) { rows.push(row("restored", say(signals[0]!), "code", signals[0]!.note.id)); continue; }
    const questions = Object.fromEntries(signals.map((s, i) => [`wanted::${i}`, { ask: "wanted" as const, candidate: JSON.stringify({ title: noteName(s.note), line: s.line, text: clip(s.note.text, 600) }) }]));
    const asked = await askNouls({ ticket: { id: ticket, title, body: clip(bodyLines(item.text).join(" "), 600) } }, questions, o);
    if ("unavailable" in asked) {
      // Code alone, said so: Jev off brings it back on the link (capture over interpretation); a person sets it back.
      jev = asked.unavailable;
      rows.push(row("restored", `${say(signals[0]!)} (Jev ${asked.unavailable})`, "code", signals[0]!.note.id));
      continue;
    }
    jev = "asked"; reading = asked.reading; tokens += asked.reading.usage?.input ?? 0;
    const best = signals.map((s, i) => ({ s, p: noul(asked.answers, `wanted::${i}`) ?? 0 })).sort((a, b) => b.p - a.p)[0]!;
    rows.push(best.p >= YES ? row("restored", `${say(best.s)} (Jev ${best.p.toFixed(2)})`, "jev", best.s.note.id) : row("stays", `only cited: ${say(best.s)} (Jev ${best.p.toFixed(2)})`, "jev", best.s.note.id));
  }
  if (o.apply) for (const r of rows.filter(r => r.outcome === "restored")) await restore(client, r.id, r.why, r.source, o);
  const report: LaterReport = { mode: "revive", rows, counts: countsOf(rows), tokens, cost: costOf(tokens), jev, ...(reading ? { reading: { ...reading, usage: { input: tokens, output: 0 } } } : {}), applied: !!o.apply };
  if (o.apply) await keepLater(client, report, o);
  return report;
}

/**
 * One parked item back to queued, as the Oct 25 audit restored them: `[restored::<day>: why]` in place of the
 * wreckage marks (so `wreckage` still means "parked now"), and a line saying why in full, linking the note that asked.
 */
export async function restore(client: WorkJevClient, id: string, why: string, source: string | undefined, o: Pick<LaterOptions, "actor" | "now"> = {}): Promise<Block> {
  const day = (o.now ?? new Date()).toISOString().slice(0, 10), kind = why.split(/[,:]/)[0]!;
  const item = await client.request<Block>({ action: "get", blockId: id });
  const marks = parsePropertyRecords(item.text).filter(p => p.scope === "block" && (p.key === "wreckage" || p.key === "parked-at"));
  const patched = await client.request<Block>({ action: "properties.patch", blockId: id, expectedRevision: item.revision, mutation: who(o),
    operations: [propertyTransition(item, "work-stage", "queued"), ...marks.map(p => ({ op: "remove" as const, ordinal: p.ordinal })), { op: "append" as const, key: "restored", value: `${day}: ${kind}, ${o.actor ?? LOOP}` }] });
  const line = `**Back from later, ${day}:** ${why}${source ? ` ((${source}))` : ""}`;
  return client.request<Block>({ action: "update", blockId: id, text: `${patched.text.trimEnd()}\n\n${line}`, expectedRevision: patched.revision, mutation: who(o) });
}

/** A `groom-later` record per item that moved or was kept, and the pass's `jev-run`. */
async function keepLater(client: WorkJevClient, report: LaterReport, o: LaterOptions): Promise<void> {
  const pass = (o.now ?? new Date()).toISOString().slice(0, 16);
  for (const r of report.rows.filter(r => r.outcome !== "stays" && r.outcome !== "misparked")) {
    await writeRecord(board(client), "groom-later", chips({ item: r.ticket, outcome: r.outcome, why: r.why, source: r.source ?? "none", by: r.by, pass }), jevWho(LOOP), { title: `${r.ticket} ${r.outcome}` });
  }
  await recordRun(client, LOOP, pass, { items: report.rows.length, suggested: report.counts.restored + report.counts.parked, quiet: report.counts.stays + report.counts.kept }, report.reading);
}

/** The pass as a person reads it: counts, then each item that moves or was kept, with why. */
export function laterSummary(report: LaterReport): string {
  const c = report.counts;
  const head = report.mode === "park"
    ? `${report.rows.length} stale items · ${c.parked} ${report.applied ? "parked" : "would park"} · ${c.kept} kept`
    : `${report.rows.length} parked items · ${c.restored} ${report.applied ? "came back" : "would come back"} · ${c.misparked} parked against the keep rule · ${c.stays} stay`;
  const lines = [head, ...(report.mode === "revive" ? [`Jev: ${report.jev} · ${report.tokens} tokens in · $${report.cost}`] : [])];
  for (const outcome of ["restored", "misparked", "kept", "parked"] as const) {
    const rows = report.rows.filter(r => r.outcome === outcome);
    if (!rows.length) continue;
    lines.push("", `${outcome === "restored" ? "back to queued" : outcome === "misparked" ? "parked against the keep rule (high, new or decided; restore what's still wanted)" : outcome}:`);
    for (const r of rows) lines.push(`  ${r.ticket} ${clip(r.title, 70)} · ${clip(r.why, 140)}`);
  }
  if (!report.applied && (c.restored || c.parked)) lines.push("", "read only: --apply writes it");
  return lines.join("\n");
}
