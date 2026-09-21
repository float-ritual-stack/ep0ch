import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import { checkInboxModelConfiguration, createInboxModel, InboxModelUnavailableError, type InboxModelOptions } from "../src/inbox-model";
import type { InboxModelContext, InboxPlan, InboxUsage } from "../src/inbox-types";
import type { Block } from "../src/types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function block(id: string, text: string, overrides: Partial<Block> = {}): Block {
  return { id, text, parentId: null, revision: 1, position: 0, properties: [], author: "user", createdAt: "2026-09-20", updatedAt: "2026-09-20", ...overrides };
}
const source = block("capture", "Shopping\nuh, oats and limes");
const filed: InboxPlan = {
  summary: "Cleaned the shopping list", source: { disposition: "file", text: "Shopping\n- Oats\n- Limes" },
  notes: [], tasks: [], updates: [],
};
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id: crypto.randomUUID(), name, arguments: args });

function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
  return {
    role: "assistant", api: "openai-responses", provider: "openai", model: "gpt-4.1", content, stopReason, timestamp: Date.now(),
    usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0, totalTokens: 130, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
  };
}
function streamMessage(value: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  if (value.stopReason === "error" || value.stopReason === "aborted") stream.push({ type: "error", reason: value.stopReason, error: value });
  else stream.push({ type: "done", reason: value.stopReason as "toolUse", message: value });
  return stream;
}
function scripted(steps: Array<ToolCall[] | ((context: Context) => ToolCall[])>): NonNullable<InboxModelOptions["stream"]> {
  let turn = 0;
  return (_model, context) => {
    const step = steps[turn++];
    if (!step) throw new Error("Unexpected model continuation");
    return streamMessage(message(typeof step === "function" ? step(context) : step));
  };
}
function lastResult(context: Context) {
  const last = context.messages.at(-1)!;
  if (last.role !== "toolResult") throw new Error("Expected tool result");
  return { last, value: JSON.parse(last.content.filter(c => c.type === "text").map(c => c.text).join("")) };
}

async function rejected(promise: Promise<unknown>): Promise<Error & { usage?: InboxUsage }> {
  try { await promise; }
  catch (error) { if (error instanceof Error) return error; throw error; }
  throw new Error("Expected the editor to reject this request");
}

async function fixture(options: Partial<InboxModelOptions> = {}, values: Partial<InboxModelContext> = {}) {
  const root = await mkdtemp(join(tmpdir(), "inbox-model-")); roots.push(root);
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4.1", defaultThinkingLevel: "off" }));
  // A local fixture credential satisfies discovery. Every provider stream is replaced below.
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "inbox-test-not-a-real-key" } }));
  const modelOptions: InboxModelOptions = {
    workspaceRoot: root, agentDir, jevApiKey: "", stream: scripted([[call("search_notes", { query: "shopping" })], [call("finish_cleanup", filed as unknown as Record<string, unknown>)]]),
    ...options,
  };
  const context: InboxModelContext = { source, read: () => null, search: () => [], signal: new AbortController().signal, progress() {}, ...values };
  return { root, agentDir, options: modelOptions, context, run: () => createInboxModel(modelOptions)(context) };
}

describe("Inbox editorial model", () => {
  test("runs the real SDK with only bounded note tools and no ambient files, extensions or prompts", async () => {
    const f = await fixture({ stream: scripted([
      context => {
        expect(context.tools?.map(t => t.name).sort()).toEqual(["finish_cleanup", "read_note", "search_notes"]);
        expect(context.systemPrompt).not.toContain("AMBIENT-INJECTION");
        expect(context.systemPrompt).toContain("Most captures are general notes");
        return [call("search_notes", { query: "shopping" })];
      },
      [call("finish_cleanup", filed as unknown as Record<string, unknown>)],
    ]) });
    await writeFile(join(f.root, "AGENTS.md"), "AMBIENT-INJECTION project context");
    await writeFile(join(f.agentDir, "APPEND_SYSTEM.md"), "AMBIENT-INJECTION appended prompt");
    await mkdir(join(f.agentDir, "extensions"));
    await writeFile(join(f.agentDir, "extensions", "never.ts"), "throw new Error('AMBIENT-INJECTION extension executed');");
    const output = await f.run();
    expect(output.plan).toEqual(filed);
    expect(output.usage).toMatchObject({ provider: "openai", model: "gpt-4.1", inputTokens: 220, outputTokens: 40, jevCalls: 0, cost: 0.006 });
    expect(f.context.source.text).toBe(source.text);
  });

  test("requires a search and every current canonical page before accepting replacement text", async () => {
    const existing = block("existing", "a".repeat(12_010), { revision: 4 });
    const merged: InboxPlan = { ...filed, source: { disposition: "archive", text: "Merged shopping detail into ((existing))." }, updates: [{ blockId: existing.id, expectedRevision: 4, text: "Combined note" }] };
    const finish = call("finish_cleanup", merged as unknown as Record<string, unknown>);
    const f = await fixture({ stream: scripted([
      [finish],
      context => { expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true }); return [call("search_notes", { query: "shopping" })]; },
      [call("read_note", { blockId: "existing" })],
      context => { expect(lastResult(context).value).toMatchObject({ revision: 4, complete: false, nextOffset: 12000 }); return [finish]; },
      context => { expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true }); return [call("read_note", { blockId: "existing", offset: 12000 })]; },
      [finish],
    ]) }, { read: () => existing, search: () => [existing] });
    expect((await f.run()).plan).toEqual(merged);
    expect(existing.text).toHaveLength(12_010);
  });

  test("does not authorize replacement from pages belonging to different revisions", async () => {
    let reads = 0;
    const merged: InboxPlan = { ...filed, updates: [{ blockId: "existing", expectedRevision: 2, text: "replacement" }] };
    const f = await fixture({ stream: scripted([
      [call("search_notes", { query: "shopping" })],
      [call("read_note", { blockId: "existing" })],
      [call("read_note", { blockId: "existing", offset: 12000 })],
      [call("finish_cleanup", merged as unknown as Record<string, unknown>)],
      context => { expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true }); return [call("finish_cleanup", filed as unknown as Record<string, unknown>)]; },
    ]) }, { read: () => block("existing", "a".repeat(12_010), { revision: ++reads }) });
    expect((await f.run()).plan.updates).toEqual([]);
  });

  test("asks typed duplicate and coverage questions over actual bounded candidates and accounts for Jev usage", async () => {
    const candidates = Array.from({ length: 8 }, (_, i) => block(`note-${i}`, `Shopping ${i}\nOats and limes, plus detail ${i}.\n` + "More note detail. ".repeat(60)));
    let requests = 0;
    const f = await fixture({
      jevApiKey: "fixture-key",
      fetch: (async (_url, init) => {
        requests++; const body = JSON.parse(init!.body as string);
        expect(body.state.source.text).toBe(source.text);
        expect(body.state.candidates).toHaveLength(6);
        expect(body.state.candidates[0].text).toBe(candidates[0]!.text);
        expect(Object.keys(body.questions)).toHaveLength(12);
        expect(body.questions.relationship_0.type).toBe("choice");
        expect(body.questions.covered_0.type).toBe("noul");
        return Response.json({ answers: Object.fromEntries(candidates.slice(0, 6).flatMap((_, i) => [
          [`relationship_${i}`, { type: "choice", choice: "related", confidence: 0.8, probabilities: { duplicate: 0.1, related: 0.9, unrelated: 0 } }],
          [`covered_${i}`, { type: "noul", noul: 0.15 }],
        ])), usage: { input_tokens: 1000, output_tokens: 100 } });
      }),
      stream: scripted([
        [call("search_notes", { query: "shopping" })],
        context => {
          const value = lastResult(context).value;
          expect(value.candidates).toHaveLength(6);
          expect(value.candidates[0].text).toBe(candidates[0]!.text.slice(0, 900));
          expect(value.candidates[0].complete).toBe(false);
          expect(value.completeness.kind).toBe("bounded");
          expect(value.jev).toMatchObject({ status: "judged", model: "jev-1.13.0" });
          expect(value.jev.relationships[0]).toMatchObject({ blockId: "note-0", relationship: "related", sourceCovered: 0.15 });
          return [call("finish_cleanup", filed as unknown as Record<string, unknown>)];
        },
      ]),
    }, { search: () => [source, block("deleted", "shopping", { deletedAt: "today" }), ...candidates] });
    const output = await f.run();
    expect(requests).toBe(1);
    expect(output.usage).toMatchObject({ inputTokens: 1220, outputTokens: 140, jevCalls: 1 });
    expect(output.usage.cost).toBeCloseTo(0.006042, 8);
  });

  test("Jev failures remain an explicit unavailable hint without leaking provider errors", async () => {
    const f = await fixture({ jevApiKey: "fixture", fetch: async () => { throw new Error("SECRET provider body"); },
      stream: scripted([
        [call("search_notes", { query: "shopping" })],
        context => {
          const value = lastResult(context).value;
          expect(value.jev.status).toBe("unavailable");
          expect(JSON.stringify(value)).not.toContain("SECRET");
          return [call("finish_cleanup", filed as unknown as Record<string, unknown>)];
        },
      ]),
    }, { search: () => [block("existing", "Shopping list")] });
    const output = await f.run();
    expect(output.usage.jevCalls).toBe(1);
    expect(output.usage.jevSuccessfulCalls).toBe(0);
    expect(output.usage.jevWarning).toContain("failed");
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  test("holds require a precise reason, unchanged source, and no side effects", async () => {
    const hold: InboxPlan = { summary: "Needs a date", source: { text: source.text, disposition: "hold", reason: "Which Saturday does the list refer to?" }, notes: [], tasks: [], updates: [] };
    const invalid = { ...hold, notes: [{ text: "Unexpected extra note" }] };
    const f = await fixture({ stream: scripted([
      [call("finish_cleanup", invalid as unknown as Record<string, unknown>)],
      context => { expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true }); return [call("finish_cleanup", hold as unknown as Record<string, unknown>)]; },
    ]) });
    expect((await f.run()).plan).toEqual(hold);
  });

  test("turn and token budgets stop the SDK loop and attach observed usage", async () => {
    for (const limit of [{ maxTurns: 1 }, { maxTotalTokens: 100 }]) {
      const f = await fixture({ ...limit, stream: scripted([[call("search_notes", { query: "shopping" })]]) });
      const error = await rejected(f.run());
      expect(error.message).toMatch(/Inbox editor (turn|token) budget exhausted/);
      expect(error.usage).toMatchObject("maxTurns" in limit ? { inputTokens: 110, outputTokens: 20 } : { inputTokens: 0, outputTokens: 0 });
    }
  });

  test("ordinary text is budgeted as tokens rather than one token per source byte", async () => {
    const f = await fixture({ maxTotalTokens: 18_000 }, {
      source: block("capture", "Shopping notes\n" + "Oats and limes. ".repeat(1000)),
    });
    const output = await f.run();
    expect(output.plan).toEqual(filed);
    expect(output.usage.inputTokens).toBe(220);
  });

  test("a research capture can finish after bounded search, Jev comparisons and cached Pi context", async () => {
    const capture = block("capture", "File-record design notes\n" + "Keep Markdown in Git; retain canonical file identities and authored relationships.\n".repeat(180));
    const candidate = block("reference", "Prior file-record design\n" + "One canonical identity per file.\n".repeat(180));
    const plan: InboxPlan = { ...filed, summary: "Filed the design research with its existing reference", source: { disposition: "file", text: "File-record design\nKeep Markdown in Git and retain one canonical identity per file. Related prior design: ((reference))." } };
    let turn = 0;
    const f = await fixture({
      jevApiKey: "fixture",
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body as string);
        return Response.json({ answers: Object.fromEntries(body.state.candidates.flatMap((_candidate: unknown, i: number) => [
          [`relationship_${i}`, { type: "choice", choice: "related", confidence: 0.8, probabilities: { duplicate: 0.1, related: 0.9, unrelated: 0 } }],
          [`covered_${i}`, { type: "noul", noul: 0.1 }],
        ])), usage: { input_tokens: 9000, output_tokens: 100 } });
      },
      stream: () => {
        const calls = turn === 0
          ? Array.from({ length: 4 }, (_, i) => call("search_notes", { query: `file identity ${i}` }))
          : turn === 1 ? [call("read_note", { blockId: "reference" })]
            : [call("finish_cleanup", plan as unknown as Record<string, unknown>)];
        turn++;
        const response = message(calls);
        response.usage = { ...response.usage, input: 6000, cacheRead: 9000, output: 500, totalTokens: 15_500 };
        return streamMessage(response);
      },
    }, {
      source: capture, read: () => candidate,
      search: query => Array.from({ length: 6 }, (_, i) => ({ ...candidate, id: `${query}-${i}` })),
    });
    const output = await f.run();
    expect(output.plan).toEqual(plan);
    expect(output.usage).toMatchObject({ inputTokens: 81_000, outputTokens: 1900, jevCalls: 4, jevSuccessfulCalls: 4 });
    expect(turn).toBe(3);
  });

  test("cancellation aborts a stalled provider and does not return a plan", async () => {
    const controller = new AbortController(); let aborted = false;
    const f = await fixture({ stream: (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      options!.signal!.addEventListener("abort", () => { aborted = true; stream.end(message([], "aborted")); }, { once: true });
      queueMicrotask(() => controller.abort());
      return stream;
    } }, { signal: controller.signal });
    const error = await rejected(f.run());
    expect(error.message).toBe("Inbox cleanup canceled"); expect(aborted).toBe(true);
    expect(error.usage?.provider).toBe("openai");
  });

  test("provider failures expose a sanitized unavailable error with observed usage", async () => {
    const f = await fixture({ stream: () => streamMessage({ ...message([], "error"), errorMessage: "SECRET provider response" }) });
    const error = await rejected(f.run());
    expect(error).toBeInstanceOf(InboxModelUnavailableError);
    expect(error.message).not.toContain("SECRET");
    expect(error.usage).toMatchObject({ inputTokens: 110, outputTokens: 20 });
  });

  test("missing configuration is reported before an editor session is started", async () => {
    const f = await fixture(); await rm(join(f.agentDir, "settings.json"));
    expect(await checkInboxModelConfiguration(f.options)).toMatchObject({ configured: false, message: "Inbox needs a configured model in Pi settings" });
    await expect(f.run()).rejects.toBeInstanceOf(InboxModelUnavailableError);
  });
});
