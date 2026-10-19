import type { OutlinerStore } from "./store";
import type { WaitingAsk } from "@ep0ch/outline-core/protocol";
import { firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { markdownSourceTokens } from "./markdown-structure";
import { checklistItems } from "./checklist-items";

// The waiting-on-Evan view's query: needs is a reason-bearing value, not an exact-value filter.
const NEEDS = "needs NOT work-stage=done NOT work-stage=superseded";

export function waitingAsks(store: OutlinerStore): WaitingAsk[] {
  const { blocks } = store.queryBlocks({ where: `(${NEEDS}) OR (type=draft-proposal proposal-status=open) OR type=capability OR type=design`, limit: 1000 });
  const rows: WaitingAsk[] = [];
  for (const b of blocks) {
    const values = (key: string) => b.properties.filter(p => p.key === key).map(p => p.value);
    const base = { properties: b.properties, block: b.id, title: firstLineWithoutPropertyTokens(b.text) ?? "Untitled", by: b.actorId ?? b.author, revision: b.revision };
    const needs = values("needs").filter(v => /^sysop(?:\s*:|$)/i.test(v));
    if (!values("work-stage").some(v => v === "done" || v === "superseded") && needs.length) {
      rows.push({ ...base, kind: "decision", reason: needs.map(v => v.replace(/^sysop\s*:?\s*/i, "")).join("; ") });
    }
    if (values("type").includes("draft-proposal") && values("proposal-status").includes("open")) rows.push({ ...base, kind: "proposal", reason: "open proposal" });
    if (!values("type").some(v => v === "capability" || v === "design")) continue;
    const headings = markdownSourceTokens(b.text).filter(h => h.token.type === "heading");
    const calls = new Set<number>();
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i]!;
      if (h.token.type !== "heading" || !/Decisions for Evan|NEEDS A GO/i.test(h.token.text)) continue;
      const depth = h.token.depth;
      const end = headings.slice(i + 1).find(next => next.token.type === "heading" && next.token.depth <= depth)?.span.startLine ?? b.text.split("\n").length;
      for (let line = h.span.endLine + 1; line < end; line++) calls.add(line);
    }
    for (const item of checklistItems(b.text)) if (item.status === "todo" && calls.has(item.span.startLine)) {
      rows.push({ ...base, kind: "call", reason: item.text.replace(/^\s*[-+*]\s+\[ \]\s*/, ""), line: item.span.startLine, at: item.span.start, label: item.text });
    }
  }
  return rows.sort((a, b) => ["decision", "proposal", "call"].indexOf(a.kind) - ["decision", "proposal", "call"].indexOf(b.kind));
}
