import type { OutlinerStore } from "./store";
import type { WaitingAsk } from "@ep0ch/outline-core/protocol";
import { firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { markdownSourceTokens } from "./markdown-structure";
import { checklistItems } from "./checklist-items";
import { textMemo } from "./text-memo";

// The waiting-on-Evan view's query: needs is a reason-bearing value, not an exact-value filter.
const NEEDS = "needs NOT work-stage=done NOT work-stage=superseded";

/**
 * The open steps under a "Decisions for Evan" or "NEEDS A GO" heading of a capability or design note: a function of
 * its text, kept per text (PIE-1413: every door asks after every change, and parsing pie's long notes took ~350 ms).
 */
const openCalls = textMemo((text: string): readonly { reason: string; line: number; at: number; label: string }[] => {
  const headings = markdownSourceTokens(text).filter(h => h.token.type === "heading");
  const calls = new Set<number>();
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    if (h.token.type !== "heading" || !/Decisions for Evan|NEEDS A GO/i.test(h.token.text)) continue;
    const depth = h.token.depth;
    const end = headings.slice(i + 1).find(next => next.token.type === "heading" && next.token.depth <= depth)?.span.startLine ?? text.split("\n").length;
    for (let line = h.span.endLine + 1; line < end; line++) calls.add(line);
  }
  return Object.freeze(checklistItems(text).filter(item => item.status === "todo" && calls.has(item.span.startLine))
    .map(item => Object.freeze({ reason: item.text.replace(/^\s*[-+*]\s+\[ \]\s*/, ""), line: item.span.startLine, at: item.span.start, label: item.text })));
}, 1_024);

export function waitingAsks(store: OutlinerStore): WaitingAsk[] {
  // Every scope (PIE-1277): a `- [ ] … [needs::sysop: …]` on line 30 of a long note is an ask too, opened at its line.
  // NOT reads the note's own header at any scope, so a body line's `[work-stage::done]` never hides the note.
  const { blocks } = store.queryBlocks({ where: `(${NEEDS}) OR (type=draft-proposal proposal-status=open) OR type=capability OR type=design`, propertyScope: "all", limit: 1000 });
  const rows: WaitingAsk[] = [];
  for (const b of blocks) {
    const values = (key: string) => b.properties.filter(p => p.key === key).map(p => p.value);
    const base = { properties: b.properties, block: b.id, title: firstLineWithoutPropertyTokens(b.text) ?? "Untitled", by: b.actorId ?? b.author, revision: b.revision };
    const needs = values("needs").filter(v => /^sysop(?:\s*:|$)/i.test(v));
    const settled = values("work-stage").some(v => v === "done" || v === "superseded");
    if (!settled && needs.length) {
      rows.push({ ...base, kind: "decision", reason: needs.map(v => v.replace(/^sysop\s*:?\s*/i, "")).join("; ") });
    }
    // An ask written on a line of its own: the query's matches say where (a ticked step's chip no longer matches).
    for (const m of b.propertyMatches ?? []) if (!settled && m.scope !== "block" && m.key === "needs" && /^sysop(?:\s*:|$)/i.test(m.value)) {
      const label = b.text.slice(m.start, m.end);
      rows.push({ ...base, kind: "decision", reason: m.value.replace(/^sysop\s*:?\s*/i, ""), line: m.line, at: m.start, label });
    }
    if (values("type").includes("draft-proposal") && values("proposal-status").includes("open")) rows.push({ ...base, kind: "proposal", reason: "open proposal" });
    if (!values("type").some(v => v === "capability" || v === "design")) continue;
    // A step that is already a decision row (its own [needs::sysop: …]) isn't listed twice.
    const asked = new Set(rows.filter(r => r.block === b.id && r.line !== undefined).map(r => r.line));
    for (const call of openCalls(b.text)) if (!asked.has(call.line)) rows.push({ ...base, kind: "call", ...call });
  }
  return rows.sort((a, b) => ["decision", "proposal", "call"].indexOf(a.kind) - ["decision", "proposal", "call"].indexOf(b.kind));
}
