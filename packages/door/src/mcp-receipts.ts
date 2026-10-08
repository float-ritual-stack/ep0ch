// The remote MCP gateway's write receipts (PIE-648): what a queued write (src/mcp-netmail.ts) became, and what the
// caller's own still-waiting writes would look like. Pure: the handlers in src/mcp.ts read the queue and the mirror and
// hand what they found here.
//
//   outline_write_status(queueId)   one queued write: queued (with its home machine's last pull), applied (with the
//                                   revision), proposed (with the proposal's URI), superseded or rejected (with why).
//                                   The home machine told the hub what each entry became when it pulled it (`queue
//                                   settle`); a proposal's life after that is read from its block in the mirror.
//   outline_read's `pending`        the caller's own writes still waiting for that block, laid over the mirror's text and
//                                   marked pending, span by span. Only the caller's: another caller's waiting write is
//                                   not theirs to see.
import type { NetmailReceipt, NetmailSummary } from "./mcp-netmail";

/** A proposal's `[proposal-status::…]` in the mirror (outliner's draft-patch.ts), or why it can't be said. */
export type ProposalSeen = "open" | "applied" | "dismissed" | "missing";

export const PROPOSAL_STATUS_KEY = "proposal-status";
export const proposalSeen = (properties: readonly { key: string; values: string[] }[] | undefined): ProposalSeen => {
  const v = properties?.find(p => p.key === PROPOSAL_STATUS_KEY)?.values[0];
  return v === "applied" || v === "dismissed" ? v : "open";
};

/** The same from a proposal's text: an applied or dismissed proposal goes to the Trash, where only its text can be read. */
export const proposalSeenInText = (text: string): ProposalSeen => {
  const v = new RegExp(`\\[${PROPOSAL_STATUS_KEY}::(open|applied|dismissed)\\]`).exec(text)?.[1];
  return v === "applied" || v === "dismissed" ? v : "open";
};

export type WriteState = "queued" | "applied" | "proposed" | "superseded" | "rejected";

export interface WriteStatus {
  queueId: string;
  state: WriteState;
  uri: string;
  tool: string;
  queuedAt: string;
  said: string;
  /** applied: the block's revision once the write landed. */
  revision?: number;
  /** proposed, superseded: the proposal that holds the change. */
  proposal?: string;
  /** rejected: why. */
  reason?: string;
  /** superseded: the later write of this caller that replaced it. */
  supersededBy?: string;
  /** queued: the home machine's last pull from this gateway, and how many writes wait for it. */
  lastPull?: string | null;
  waiting?: number;
  settledAt?: string;
}

const spansOf = (e: NetmailReceipt): { observed: string; replacement: string }[] => strings(e.input.patches) ? e.input.patches : [];

/**
 * Whether write `l`, queued after `e`, takes `e`'s place: not refused, the same tool, and for a property the same key, for
 * a patch a span that is over the same text (the one holds the other's passage, or its replacement). A comment or a new
 * block is never replaced.
 */
function replaces(l: NetmailReceipt, e: NetmailReceipt): boolean {
  if (l.id === e.id || l.tool !== e.tool || l.state === "refused") return false;
  if (e.tool === "outline_set_property") return l.input.key === e.input.key;
  if (e.tool !== "outline_patch") return false;
  const [a, b] = [spansOf(e), spansOf(l)];
  return a.some(x => b.some(y => [x.observed, x.replacement].some(t => t && (y.observed.includes(t) || t.includes(y.observed)))));
}

/**
 * Where one queued write stands. `proposal`: its proposal as the mirror shows it (read only for a write that became
 * one). `later`: this caller's writes about the same block, oldest first, this one among them.
 */
export function receiptStatus(r: NetmailReceipt, ctx: { summary: NetmailSummary | null; proposal?: ProposalSeen; later: readonly NetmailReceipt[] }): WriteStatus {
  const base = { queueId: r.id, uri: r.uri, tool: r.tool, queuedAt: r.queuedAt };
  const target = `${r.outline}@${r.machine}`;
  if (r.state === "queued") {
    const lastPull = ctx.summary?.lastPull ?? null;
    return { ...base, state: "queued", lastPull, waiting: ctx.summary?.waiting ?? 1,
      said: `still queued for ${target}: ${lastPull ? `${r.machine} last pulled ${lastPull}, before or without it` : `${r.machine} hasn't pulled yet`}; it lands when ${r.machine} next pulls` };
  }
  const settled = { ...base, ...(r.settledAt ? { settledAt: r.settledAt } : {}) };
  if (r.state === "refused") return { ...settled, state: "rejected", reason: r.said ?? "refused", said: `rejected by ${target}: ${r.said ?? "refused"}` };
  if (r.state === "applied" || r.state === "unchanged") {
    return { ...settled, ...(r.state === "applied" && r.resultUri ? { uri: r.resultUri } : {}), state: "applied", ...(r.resultRevision !== null ? { revision: r.resultRevision } : {}), said: `${r.state === "unchanged" ? "already in place on" : "applied to"} ${target}${r.resultRevision !== null ? `, now revision ${r.resultRevision}` : ""}: ${r.said ?? ""}`.trim() };
  }
  // proposed: the home machine made a proposal under the note; its owner may since have applied or dismissed it.
  const proposal = r.proposalUri ?? undefined;
  const withProposal = { ...settled, ...(proposal ? { proposal } : {}) };
  switch (ctx.proposal) {
    case "applied": return { ...withProposal, state: "applied", said: `proposed on ${target}, then applied by its owner (${proposal})` };
    case "dismissed": return { ...withProposal, state: "rejected", reason: "its owner dismissed the proposal", said: `proposed on ${target}, then dismissed by its owner (${proposal})` };
    default: {
      // `later` is the caller's writes on the note in the order queued: the first after this one that replaces it.
      const next = ctx.later.slice(ctx.later.findIndex(l => l.id === r.id) + 1).find(l => replaces(l, r));
      if (next) return { ...withProposal, state: "superseded", supersededBy: next.id, said: `proposed on ${target} (${proposal}), then superseded by your later ${next.tool} (${next.id}) on the same note; the proposal is still open for its owner unless they dismiss it` };
      return { ...withProposal, state: "proposed", said: `proposed on ${target}, not applied: ${r.said ?? "the note changed"}; the proposal ${proposal ?? ""} waits under the note for its owner${ctx.proposal === "missing" ? " (this gateway's mirror doesn't hold it yet)" : ""}`.replace(/\s+/g, " ").trim() };
    }
  }
}

// ─── Read-your-writes ────────────────────────────────────────────────────────

export interface PendingOverlay {
  said: string;
  entries: { queueId: string; tool: string; queuedAt: string; state: "queued" | "applied" }[];
  /** The block's body with each waiting patch laid over it, each replacement fenced {{pending <id>}}…{{/pending}}; absent when no patch is waiting. */
  body?: string;
  /** Per patch span: whether it was found in the body (a span in the header chips or one that no longer matches isn't laid over). */
  spans: { queueId: string; observed: string; replacement: string; shown: boolean }[];
  properties: { queueId: string; key: string; value: string }[];
  newBlocks: { queueId: string; text: string; position?: number }[];
  comments: { queueId: string; body: string; quote?: string }[];
}

const short = (id: string) => id.slice(0, 8);
const strings = (v: unknown): v is { observed: string; replacement: string }[] =>
  Array.isArray(v) && v.every(p => p && typeof p.observed === "string" && typeof p.replacement === "string");

/** The caller's waiting writes laid over `body`, or null when none touches the block. `waiting` is oldest first. */
export function pendingOverlay(body: string, waiting: readonly NetmailReceipt[]): PendingOverlay | null {
  if (!waiting.length) return null;
  const out: PendingOverlay = { said: "", entries: [], spans: [], properties: [], newBlocks: [], comments: [] };
  let text = body;
  // The replaced stretches of `text`, kept as the text is edited under them.
  const marks: { start: number; end: number; id: string; observed: string }[] = [];
  let patched = false;
  for (const w of waiting) {
    out.entries.push({ queueId: w.id, tool: w.tool, queuedAt: w.queuedAt, state: w.state === "applied" ? "applied" : "queued" });
    const input = w.input;
    if (w.tool === "outline_patch" && strings(input.patches)) {
      for (const p of input.patches) {
        const at = text.indexOf(p.observed);
        if (at < 0 || !p.observed) { out.spans.push({ queueId: w.id, observed: p.observed, replacement: p.replacement, shown: false }); continue; }
        const delta = p.replacement.length - p.observed.length;
        for (const m of marks) {
          if (m.start >= at + p.observed.length) { m.start += delta; m.end += delta; }
          else if (m.end > at && m.start < at + p.observed.length) { m.start = Math.min(m.start, at); m.end = Math.max(m.end + delta, at + p.replacement.length); }
        }
        text = text.slice(0, at) + p.replacement + text.slice(at + p.observed.length);
        marks.push({ start: at, end: at + p.replacement.length, id: w.id, observed: p.observed });
        out.spans.push({ queueId: w.id, observed: p.observed, replacement: p.replacement, shown: true });
        patched = true;
      }
    } else if (w.tool === "outline_set_property") out.properties.push({ queueId: w.id, key: String(input.key), value: String(input.value) });
    else if (w.tool === "outline_create") out.newBlocks.push({ queueId: w.id, text: String(input.text), ...(typeof input.position === "number" ? { position: input.position } : {}) });
    else if (w.tool === "outline_comment") out.comments.push({ queueId: w.id, body: String(input.body), ...(typeof input.quote === "string" ? { quote: input.quote } : {}) });
  }
  if (patched) {
    // Fences are put in at their offsets in one pass, so a replacement inside another's keeps both whole.
    const at: { pos: number; order: number; end: number; text: string }[] = [];
    for (const m of marks) {
      if (m.end === m.start) at.push({ pos: m.start, order: 1, end: m.end, text: `{{pending ${short(m.id)}: removes “${m.observed}”}}` });
      else {
        at.push({ pos: m.start, order: 1, end: m.end, text: `{{pending ${short(m.id)}}}` });
        at.push({ pos: m.end, order: 0, end: m.end, text: "{{/pending}}" });
      }
    }
    at.sort((x, y) => x.pos - y.pos || x.order - y.order || y.end - x.end);
    let shown = "", from = 0;
    for (const t of at) { shown += text.slice(from, t.pos) + t.text; from = t.pos; }
    shown += text.slice(from);
    out.body = shown;
  }
  out.said = `${waiting.length} of your write${waiting.length === 1 ? "" : "s"} to this note ${waiting.length === 1 ? "is" : "are"} not in this copy yet (state queued: waiting for its home machine; applied: done there, the copy hasn't caught up): ` +
    "record.body is the mirror's text; pending.body lays them over it, each replacement between {{pending …}} and {{/pending}}. A patch can quote either; they apply in the order queued. Only your own writes are shown.";
  return out;
}

/** outline_write_status's definition, for tools/list (offered where the write tools are). */
export const writeStatusDefinition = {
  name: "outline_write_status",
  description: "What a queued write became. A write to an outline whose home is another machine answers `queued` with a queueId; this follows it: " +
    "queued (still waiting, with that machine's last pull), applied (with the block's revision), proposed (with the proposal's URI: the note had changed, so it is a proposal under the note for its owner), " +
    "superseded (proposed, then replaced by your later write of the same kind to the same note) or rejected (with why: refused there, or its owner dismissed the proposal). " +
    "Only your own writes. outline_read also lays your still-queued writes over the mirror's text (its `pending`).",
  inputSchema: { type: "object", properties: { queueId: { type: "string", description: "The queueId a queued write answered" } }, required: ["queueId"], additionalProperties: false },
};
