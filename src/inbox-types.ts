import type { Block, RoadmapItemPriority } from "./types";

/** A single editorial decision. The service applies it; models never write directly. */
export interface InboxPlan {
  summary: string;
  source: { text: string; disposition: "file" | "archive" | "hold"; reason?: string };
  notes: Array<{ text: string; parentId?: string }>;
  tasks: Array<{
    title: string; body: string; priority: RoadmapItemPriority; project: string;
    arc: string; tracks: string[]; relatedTo?: string[];
  }>;
  updates: Array<{ blockId: string; expectedRevision: number; text: string }>;
}

export interface InboxUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  jevCalls: number;
  jevSuccessfulCalls?: number;
  jevWarning?: string;
  elapsedMs: number;
}

export interface InboxResult {
  id: string;
  sourceId: string;
  sourceTitle: string;
  summary: string;
  state: "applied" | "held" | "failed" | "undone";
  outputIds: string[];
  createdAt: string;
  error?: string;
  usage?: InboxUsage;
}

export interface InboxStatus {
  enabled: boolean;
  paused: boolean;
  state: "idle" | "working" | "paused" | "unavailable";
  message: string;
  pending: number;
  current?: { id: string; title: string };
  results: InboxResult[];
  resultsTruncated: boolean;
  attentionCount: number;
  attentionOnly: boolean;
  resultsOffset: number;
}

export interface InboxModelContext {
  source: Block;
  /** Read and search only. Read results are tracked for commit-time freshness. */
  read: (blockId: string) => Block | null;
  search: (query: string) => Block[];
  instructions?: string;
  signal: AbortSignal;
  progress: (message: string) => void;
}

export type InboxModel = (context: InboxModelContext) => Promise<{ plan: InboxPlan; usage: InboxUsage }>;
