import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession, createExtensionRuntime, defineTool, estimateTokens, getAgentDir, ModelRuntime,
  SessionManager, SettingsManager, type AgentSession, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadInboxPrompts, PromptFileError, type InboxPrompts } from "./ai-prompts";
import type { InboxModel, InboxModelContext, InboxPlan, InboxUsage } from "./inbox-types";
import type { Block } from "./types";

const JEV_MODEL = "jev-1.13.0";
const JEV_INPUT_PRICE = 0.042 / 1_000_000;
const MAX_SOURCE_CHARS = 60_000;
const READ_CHARS = 12_000;
const SEARCH_LIMIT = 6;
const TOOL_NAMES = ["read_note", "search_notes", "finish_cleanup"];

export interface InboxModelOptions {
  workspaceRoot?: string;
  promptDirectory?: string;
  agentDir?: string;
  timeoutMs?: number;
  maxTurns?: number;
  maxTotalTokens?: number;
  maxOutputTokens?: number;
  maxToolCalls?: number;
  jevApiKey?: string;
  jevTimeoutMs?: number;
  /** Provider transport seam for deterministic SDK tests; production uses Pi's authenticated runtime. */
  stream?: AgentSession["agent"]["streamFunction"];
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export class InboxModelUnavailableError extends Error {
  usage?: InboxUsage;
  constructor(message = "Inbox model unavailable; check Pi authentication and provider availability") {
    super(message);
    this.name = "InboxModelUnavailableError";
  }
}

/** This note needs intervention; unrelated captures can still be processed. */
export class InboxNoteError extends Error {
  constructor(message: string) { super(message); this.name = "InboxNoteError"; }
}

async function configuration(options: InboxModelOptions, signal?: AbortSignal) {
  const agentDir = options.agentDir ?? getAgentDir();
  let settings: { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: string };
  try { settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")); }
  catch { throw new InboxModelUnavailableError("Inbox needs a configured model in Pi settings"); }
  const provider = settings.defaultProvider;
  const modelId = settings.defaultModel;
  if (!provider || !modelId) throw new InboxModelUnavailableError("Inbox needs a default provider and model in Pi settings");
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: false, signal,
  });
  const model = runtime.getModel(provider, modelId);
  if (!model || !runtime.hasConfiguredAuth(provider)) {
    throw new InboxModelUnavailableError("Inbox needs an available authenticated model in Pi");
  }
  const thinking = settings.defaultThinkingLevel;
  const thinkingLevel = thinking === "off" || thinking === "minimal" || thinking === "low" || thinking === "high" || thinking === "xhigh"
    ? thinking : "medium";
  return { runtime, model, thinkingLevel, agentDir } as const;
}

export async function checkInboxModelConfiguration(options: InboxModelOptions = {}): Promise<{
  configured: boolean; message: string; provider?: string; model?: string;
}> {
  try {
    const { model } = await configuration(options, AbortSignal.timeout(10_000));
    return {
      configured: true, provider: model.provider, model: model.id,
      message: options.jevApiKey ?? process.env.TYPESAFE_API_KEY
        ? "Inbox editor ready" : "Inbox editor ready; Jev relationship checks are not configured",
    };
  } catch (error) {
    return { configured: false, message: error instanceof InboxModelUnavailableError ? error.message : "Inbox model configuration could not be loaded" };
  }
}

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const id = text(200);
const planSchema = Type.Object({
  summary: text(1600),
  source: Type.Object({
    text: text(MAX_SOURCE_CHARS),
    disposition: Type.Union([Type.Literal("file"), Type.Literal("archive"), Type.Literal("hold")]),
    reason: Type.Optional(text(1600)),
  }, { additionalProperties: false }),
  notes: Type.Array(Type.Object({ text: text(30_000), parentId: Type.Optional(id) }, { additionalProperties: false }), { maxItems: 8 }),
  tasks: Type.Array(Type.Object({
    title: text(250), body: text(20_000),
    priority: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
    project: Type.Literal("pi-outliner"), arc: text(100),
    tracks: Type.Array(text(100), { maxItems: 8 }), relatedTo: Type.Optional(Type.Array(id, { maxItems: 8 })),
  }, { additionalProperties: false }), { maxItems: 6 }),
  updates: Type.Array(Type.Object({
    blockId: id, expectedRevision: Type.Integer({ minimum: 1 }), text: text(MAX_SOURCE_CHARS),
  }, { additionalProperties: false }), { maxItems: 4 }),
}, { additionalProperties: false });

function isolatedResources(editorPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => editorPrompt, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
}

function live(block: Block | null): block is Block {
  return !!block && !block.deletedAt && !block.effectiveDeletedRootId;
}

function evidence(block: Block, offset = 0, length = READ_CHARS) {
  return {
    id: block.id, parentId: block.parentId, revision: block.revision, text: block.text.slice(offset, offset + length),
    offset, totalCharacters: block.text.length, complete: offset === 0 && block.text.length <= length,
    nextOffset: offset + length < block.text.length ? offset + length : null,
    author: block.author, createdAt: block.createdAt, updatedAt: block.updatedAt, properties: block.properties,
  };
}

interface Relationship {
  blockId: string; relationship: "duplicate" | "related" | "unrelated";
  confidence: number; probabilities: Record<string, number>; sourceCovered: number;
}

/** Relationships describe only the actual supplied candidate text; retrieval still owns coverage. */
async function relationships(source: Block, candidates: Block[], prompts: InboxPrompts["relationships"], options: InboxModelOptions, signal: AbortSignal, tokenAllowance: number) {
  const apiKey = options.jevApiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey || !candidates.length) return null;
  const questions = Object.fromEntries(candidates.flatMap((_, i) => [
    [`relationship_${i}`, {
      type: "choice",
      instructions: `The candidate is \`candidates[${i}]\`; the source is \`source\`.\n${prompts.relationship.instructions}`,
      criteria: prompts.relationship.criteria,
    }],
    [`covered_${i}`, {
      type: "noul",
      instructions: `The candidate is \`candidates[${i}]\`; the source is \`source\`.\n${prompts.coverage.instructions}`,
      criteria: prompts.coverage.criteria,
    }],
  ]));
  const body = JSON.stringify({ model: JEV_MODEL, state: { source: evidence(source, 0, 18_000), candidates: candidates.map(b => evidence(b, 0, 6000)) }, questions });
  // Estimate before sending and account observed provider usage afterward. Bytes are
  // not tokens: treating them as equal rejected ordinary notes far below the budget.
  if (Math.ceil(body.length / 4) + 2048 > tokenAllowance) return null;
  const response = await (options.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, redirect: "error",
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(options.jevTimeoutMs ?? 8000)]),
  });
  if (!response.ok) throw new Error("Jev relationship checks unavailable");
  const result = await response.json() as {
    answers?: Record<string, { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const probability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  const judged: Relationship[] = candidates.map((block, i) => {
    const a = result.answers?.[`relationship_${i}`]; const covered = result.answers?.[`covered_${i}`];
    if (a?.type !== "choice" || !["duplicate", "related", "unrelated"].includes(a.choice ?? "") || !probability(a.confidence)
      || !a.probabilities || !["duplicate", "related", "unrelated"].every(key => probability(a.probabilities![key]))
      || covered?.type !== "noul" || !probability(covered.noul)) throw new Error("Invalid Jev relationship response");
    return { blockId: block.id, relationship: a.choice as Relationship["relationship"], confidence: a.confidence, probabilities: a.probabilities, sourceCovered: covered.noul };
  });
  return { judged, inputTokens: safeTokens(result.usage?.input_tokens), outputTokens: safeTokens(result.usage?.output_tokens) };
}

function safeTokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createInboxModel(options: InboxModelOptions = {}): InboxModel {
  return async (context: InboxModelContext) => {
    const started = performance.now();
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    const signal = AbortSignal.any([context.signal, deadline]);
    const maxTurns = options.maxTurns ?? 10;
    // This is cumulative across Pi turns (including cached input) and Jev requests,
    // not a single context window. Leave room to retrieve, read, and then edit a note.
    const maxTokens = options.maxTotalTokens ?? 150_000;
    const usage: InboxUsage = { provider: "", model: "", inputTokens: 0, outputTokens: 0, cost: 0, jevCalls: 0, elapsedMs: 0 };
    usage.jevSuccessfulCalls = 0;
    if (!(options.jevApiKey ?? process.env.TYPESAFE_API_KEY)) usage.jevWarning = "Jev is not configured; Pi edited without relationship judgments";
    const reads = new Map<string, { block: Block; ranges: Array<[number, number]> }>();
    const source = structuredClone(context.source);
    let plan: InboxPlan | undefined;
    let session: AgentSession | undefined;
    let searches = 0; let turns = 0; let toolCalls = 0; let contextCharacters = source.text.length;
    let stopped: Error | undefined;
    let providerFailed = false;
    let jevInput = 0; let jevOutput = 0;
    const relationshipCache = new Map<string, Relationship>();
    const snapshotUsage = () => {
      const stats = session?.getSessionStats();
      usage.inputTokens = (stats ? stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite : 0) + jevInput;
      usage.outputTokens = (stats?.tokens.output ?? 0) + jevOutput;
      usage.cost = (stats?.cost ?? 0) + jevInput * JEV_INPUT_PRICE;
      usage.elapsedMs = Math.round(performance.now() - started);
      return { ...usage };
    };
    const assertActive = () => {
      if (signal.aborted) throw new Error(deadline.aborted ? "Inbox cleanup timed out" : "Inbox cleanup canceled");
      if (stopped) throw stopped;
      if (plan) throw new Error("Inbox cleanup plan is already complete");
    };
    const budget = (message: string): never => { stopped = new Error(message); throw stopped; };
    const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: undefined });
    const recordRead = (block: Block, offset: number, count: number) => {
      const old = reads.get(block.id);
      const ranges = old?.block.revision === block.revision ? old.ranges : [];
      ranges.push([offset, Math.min(block.text.length, offset + count)]);
      reads.set(block.id, { block: structuredClone(block), ranges });
    };
    const fullyRead = (blockId: string) => {
      const read = reads.get(blockId); if (!read) return undefined;
      let end = 0;
      for (const [start, limit] of [...read.ranges].sort((a, b) => a[0] - b[0])) { if (start > end) return undefined; end = Math.max(end, limit); }
      return end >= read.block.text.length ? read.block : undefined;
    };
    try {
      assertActive();
      if (source.text.length > MAX_SOURCE_CHARS) throw new Error("Inbox note exceeds the editor's 60,000-character input limit");
      const prompts = await loadInboxPrompts(options.promptDirectory);
      usage.promptRevisions = prompts.revisions;
      const config = await configuration(options, signal);
      assertActive(); usage.provider = config.model.provider; usage.model = config.model.id;
      const customTools = [
        defineTool({
          name: "read_note", label: "Read note", description: "Read a canonical note and its revision. Follow nextOffset until all text is read before replacing it.",
          parameters: Type.Object({ blockId: id, offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
          async execute(_call, params) {
            assertActive(); context.progress("Reading a related note");
            const block = context.read(params.blockId);
            if (!live(block)) return result({ found: false });
            const offset = params.offset ?? 0;
            if (offset > block.text.length) throw new Error("Read offset exceeds note length");
            contextCharacters += Math.min(READ_CHARS, block.text.length - offset);
            if (contextCharacters > 150_000) budget("Inbox note-reading budget exhausted");
            recordRead(block, offset, READ_CHARS);
            return result(evidence(block, offset));
          },
        }),
        defineTool({
          name: "search_notes", label: "Search notes", description: "Find a bounded shortlist of canonical notes by a short subject query; includes fallible Jev relationship hints when available. Search is not exhaustive.",
          parameters: Type.Object({ query: text(500) }, { additionalProperties: false }),
          async execute(_call, params) {
            assertActive(); searches++; context.progress("Looking for prior notes and related work");
            const candidates = context.search(params.query).filter(b => live(b) && b.id !== source.id).slice(0, SEARCH_LIMIT);
            let status = "unavailable";
            const missing = candidates.filter(b => !relationshipCache.has(`${b.id}:${b.revision}`));
            if (usage.jevCalls < 4 && missing.length && (options.jevApiKey ?? process.env.TYPESAFE_API_KEY)) {
              usage.jevCalls++; context.progress("Jev is comparing duplicate and related notes");
              try {
                const stats = session?.getSessionStats();
                const hints = await relationships(source, missing, prompts.relationships, options, signal, maxTokens - (stats?.tokens.total ?? 0) - jevInput - jevOutput);
                if (hints) {
                  usage.jevSuccessfulCalls!++;
                  jevInput += hints.inputTokens; jevOutput += hints.outputTokens;
                  missing.forEach((b, i) => relationshipCache.set(`${b.id}:${b.revision}`, hints.judged[i]!));
                } else { usage.jevCalls--; status = "budget"; usage.jevWarning = "Some Jev comparisons were skipped to stay within this note's budget"; }
              } catch {
                assertActive();
                // Provider bodies may echo note content or credentials.
                usage.jevWarning = "Some Jev comparisons failed; Pi continued with the retrieved notes";
              }
            }
            assertActive();
            const hints = candidates.flatMap(b => { const hint = relationshipCache.get(`${b.id}:${b.revision}`); return hint ? [hint] : []; });
            if (hints.length) status = hints.length === candidates.length ? "judged" : "partial";
            return result({
              candidates: candidates.map(b => ({
                id: b.id, revision: b.revision, text: b.text.slice(0, 900),
                totalCharacters: b.text.length, complete: b.text.length <= 900,
              })),
              completeness: { kind: "bounded", limit: SEARCH_LIMIT, message: "This shortlist cannot establish absence of other notes." },
              jev: { status, model: JEV_MODEL, relationships: hints },
            });
          },
        }),
        defineTool({
          name: "finish_cleanup", label: "Finish cleanup", description: "Submit the final editorial plan. This records a proposal only; the service checks revisions and applies changes.",
          parameters: planSchema,
          async execute(_call, proposed) {
            assertActive();
            if (!searches && proposed.source.disposition !== "hold") throw new Error("Search prior notes before finishing");
            if (proposed.source.disposition === "hold" && (!proposed.source.reason || proposed.notes.length || proposed.tasks.length || proposed.updates.length || proposed.source.text !== source.text)) {
              throw new Error("A held note needs a specific reason, unchanged source text, and no other changes");
            }
            const updated = new Set<string>();
            for (const update of proposed.updates) {
              const read = fullyRead(update.blockId);
              if (update.blockId === source.id || updated.has(update.blockId)) throw new Error("Use source.text for the source and update each related note at most once");
              if (!read || read.revision !== update.expectedRevision) throw new Error("Read the complete current note before replacing it");
              updated.add(update.blockId);
            }
            for (const note of proposed.notes) if (note.parentId && (!fullyRead(note.parentId) || note.parentId === source.id)) throw new Error("Read a suitable existing container before filing under it");
            for (const task of proposed.tasks) if (task.relatedTo?.some(blockId => !fullyRead(blockId))) throw new Error("Read related work before linking a task");
            plan = structuredClone(proposed);
            return { ...result({ accepted: true }), terminate: true };
          },
        }),
      ];
      const created = await createAgentSession({
        cwd: options.workspaceRoot ?? process.cwd(), agentDir: config.agentDir, model: config.model,
        modelRuntime: config.runtime, thinkingLevel: config.thinkingLevel,
        tools: TOOL_NAMES, noTools: "builtin", customTools, resourceLoader: isolatedResources(prompts.editor),
        sessionManager: SessionManager.inMemory(options.workspaceRoot ?? process.cwd()),
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: options.timeoutMs ?? 120_000 } },
          enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false,
        }),
      });
      session = created.session;
      assertActive();
      const stream = options.stream ?? session.agent.streamFunction.bind(session.agent);
      session.agent.streamFunction = (model, modelContext, streamOptions) => {
        assertActive();
        if (++turns > maxTurns) budget("Inbox editor turn budget exhausted");
        const stats = session!.getSessionStats();
        const consumed = stats.tokens.total + jevInput + jevOutput;
        const inputAllowance = modelContext.messages.reduce((sum, message) => sum + estimateTokens(message), 0)
          + Math.ceil(JSON.stringify({ system: modelContext.systemPrompt, tools: modelContext.tools }).length / 4) + 2048;
        if (consumed + inputAllowance >= maxTokens) budget("Inbox editor token budget exhausted");
        context.progress(`Editing note · turn ${turns}/${maxTurns}`);
        return stream(model, modelContext, {
          ...streamOptions, maxTokens: Math.min(options.maxOutputTokens ?? 5000, maxTokens - consumed - inputAllowance),
          signal: AbortSignal.any([signal, ...(streamOptions?.signal ? [streamOptions.signal] : [])]), maxRetries: 0,
        });
      };
      const beforeTool = session.agent.beforeToolCall;
      session.agent.beforeToolCall = async (call, toolSignal) => {
        assertActive();
        if (++toolCalls > (options.maxToolCalls ?? 20)) budget("Inbox editor tool budget exhausted");
        return beforeTool?.(call, toolSignal);
      };
      session.agent.toolExecution = "sequential";
      session.agent.shouldStopAfterTurn = () => !!plan || !!stopped || signal.aborted;
      session.subscribe(event => {
        if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") providerFailed = true;
      });
      let rejectAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => { session?.agent.abort(); reject(new Error(deadline.aborted ? "Inbox cleanup timed out" : "Inbox cleanup canceled")); };
        signal.addEventListener("abort", rejectAbort, { once: true });
      });
      try {
        await Promise.race([
          session.prompt(JSON.stringify({
            instruction: "Edit and organize this Inbox capture. Search existing notes, then submit the useful result with finish_cleanup.",
            source: evidence(source, 0, MAX_SOURCE_CHARS),
            ...(context.instructions ? { userPreferences: context.instructions.slice(0, 12_000) } : {}),
          }), { expandPromptTemplates: false }), aborted,
        ]);
      } finally { if (rejectAbort) signal.removeEventListener("abort", rejectAbort); }
      if (signal.aborted) throw new Error(deadline.aborted ? "Inbox cleanup timed out" : "Inbox cleanup canceled");
      if (stopped) throw stopped;
      if (providerFailed) throw new InboxModelUnavailableError();
      if (!plan) throw new Error("Inbox editor did not return a cleanup plan");
      const measured = snapshotUsage();
      if (measured.inputTokens + measured.outputTokens > maxTokens) budget("Inbox editor token budget exhausted");
      return { plan, usage: measured };
    } catch (error) {
      let failure: Error;
      if (signal.aborted) failure = new Error(deadline.aborted ? "Inbox cleanup timed out" : "Inbox cleanup canceled");
      else if (stopped) failure = new InboxNoteError(stopped.message);
      else if (error instanceof PromptFileError) failure = error;
      else if (error instanceof InboxModelUnavailableError) failure = error;
      // Known local validation failures are useful; provider/auth error bodies are not safe UI text.
      else if (error instanceof Error && /^(Inbox note exceeds|Inbox editor did not)/.test(error.message)) failure = new InboxNoteError(error.message);
      else failure = new InboxModelUnavailableError();
      // An interrupted provider may not report its final usage; this is observed usage, not a billing receipt.
      // Configuration failures made no inference attempt and have no valid provider usage to persist.
      if (usage.provider) Object.assign(failure, { usage: snapshotUsage() });
      throw failure;
    } finally { session?.agent.abort(); session?.dispose(); }
  };
}
