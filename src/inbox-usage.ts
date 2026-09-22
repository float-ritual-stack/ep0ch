import type { InboxUsage } from "./inbox-types";

export function combinedInboxUsage(first: InboxUsage, second: InboxUsage): InboxUsage {
  const revisions = [...first.promptRevisions ?? [], ...second.promptRevisions ?? []];
  return {
    provider: `${first.provider} + ${second.provider}`, model: `${first.model} + ${second.model}`,
    inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens,
    cost: first.cost + second.cost, elapsedMs: first.elapsedMs + second.elapsedMs,
    jevCalls: first.jevCalls + second.jevCalls,
    jevSuccessfulCalls: (first.jevSuccessfulCalls ?? 0) + (second.jevSuccessfulCalls ?? 0),
    piSessions: [...first.piSessions ?? [], ...second.piSessions ?? []],
    ...first.jevWarning || second.jevWarning ? { jevWarning: [first.jevWarning, second.jevWarning].filter(Boolean).join("; ") } : {},
    promptRevisions: revisions.filter((revision, index) => revisions.findIndex(other =>
      other.path === revision.path && other.sha256 === revision.sha256) === index),
  };
}

