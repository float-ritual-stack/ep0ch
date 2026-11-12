import { Refusal } from "@ep0ch/outline-core/refusal";
import { completionRows, PICKS_METADATA_KEY, readPicks } from "./completion-sources";
import { asksAtCursor, completionAt } from "./completion-at";
import { recordPick } from "@ep0ch/outline-core/completion-source";
import type { OutlinerStore } from "./store";
import type { OutlinerRequester } from "./client-target";
import type { RequestInput } from "./client";
import type { ExtensionRegistry } from "./extension-registry";
import type { ExtensionCalls } from "./extension-calls";
import type { OutlinerRequest } from "./types";
import type { WireAnswer } from "./wire";

type CompletionRequest = Extract<OutlinerRequest, { action: "completion.rows" | "completion.picked" | "completion.cancel" }>;

/** The host owns picks and in-flight sources, so closing either client's popup stops the same work. */
export class CompletionRequests {
  private turns = new Map<string, AbortController>();
  constructor(private store: OutlinerStore, private own: OutlinerRequester, private registry: ExtensionRegistry, private calls: ExtensionCalls, private readOnly: boolean) {}

  async run(request: CompletionRequest): Promise<WireAnswer<CompletionRequest["action"]>> {
    if (request.action === "completion.cancel") { this.turns.get(request.turn)?.abort(); return {}; }
    const picks = readPicks(this.store.readMetadata(PICKS_METADATA_KEY));
    let result: WireAnswer<CompletionRequest["action"]>;
    if (request.action === "completion.picked") {
      const outcome = request.outcome ?? "accepted";
      if (typeof request.key !== "string" || !request.key || request.key.length > 80) throw new Error("completion.picked needs key: the trigger's pick key");
      if (!["accepted", "edited", "ignored"].includes(outcome)) throw new Error(`completion.picked outcome is accepted, edited or ignored; got ${JSON.stringify(request.outcome)}`);
      if (outcome === "accepted" && (typeof request.insert !== "string" || !request.insert || request.insert.length > 16)) throw new Error("completion.picked needs insert: the row’s pick identity");
      if (request.source !== undefined && (typeof request.source !== "string" || request.source.length > 120)) throw new Error("completion.picked source is the row's source id, as completion.rows named it");
      if (outcome !== "ignored" && request.source && (!request.row || typeof request.row.label !== "string" || typeof request.row.insertion !== "string")) throw new Error("completion.picked with a source needs row: { label, insertion }");
      // Only a choice counts for ranking; what became of an extension's rows is told to it, never kept here.
      if (outcome === "accepted") {
        if (this.readOnly) throw new Refusal("no-access", "This outline is read-only.");
        const next = recordPick(picks, request.key, request.insert!, new Date());
        this.store.writeMetadata(PICKS_METADATA_KEY, JSON.stringify(next));
        result = { picks: next[request.key] };
      } else result = {};
      const source = request.source ? this.registry.list().completionSources.find(s => s.name === request.source && s.picks) : undefined;
      // Told without waiting (PIE-1508): a slow or failing extension never holds up, or fails, the person's pick.
      if (source) void this.calls.picked({
        extension: source.extension, source: source.id, outcome, key: request.key,
        ...(request.query !== undefined ? { query: String(request.query).slice(0, 500) } : {}),
        ...(request.row ? { row: { ...(request.row.id ? { id: String(request.row.id).slice(0, 200) } : {}), label: String(request.row.label).slice(0, 500), insertion: String(request.row.insertion).slice(0, 2000) } } : {}),
        ...(request.text !== undefined ? { text: String(request.text).slice(0, 2000) } : {}),
      }).catch(() => {});
    } else if (asksAtCursor(request)) {
      // A client that reads no Blockdown sends the text and the cursor: the token is found here, and its rows merged.
      result = await completionAt(request, asked => this.run({ ...asked, id: request.id, action: "completion.rows" }) as Promise<WireAnswer<"completion.rows">>);
    } else {
      const t = request.target as Record<string, unknown> | undefined;
      if (!t || typeof t !== "object" || typeof t.kind !== "string" || typeof t.query !== "string" || t.query.length > 500) throw new Error("completion.rows needs target: { kind, query } (query up to 500 characters)");
      if (t.attrs !== undefined && (!Array.isArray(t.attrs) || t.attrs.length > 100 || !t.attrs.every(a => a && typeof a === "object" && typeof (a as { key?: unknown }).key === "string" && typeof (a as { value?: unknown }).value === "string"))) throw new Error("target.attrs must be a list of { key, value } strings (at most 100)");
      if (t.quote !== undefined && t.quote !== '"' && t.quote !== "'") throw new Error(`target.quote must be " or '`);
      if (request.near !== undefined && typeof request.near !== "string") throw new Error("near must be a block id");
      if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1)) throw new Error("limit must be a positive whole number");
      const own = { request: <T>(action: string, input: Record<string, unknown>): Promise<T> => this.own.request<T>({ action, ...input } as RequestInput) };
      const listed = this.registry.list().completionSources;
      const controller = new AbortController();
      if (request.turn) this.turns.set(request.turn, controller);
      result = await completionRows(own, request, listed, (source, ask, signal) => this.calls.complete({
        extension: source.extension, source: source.id, query: ask.query,
        trigger: { kind: ask.trigger!, ...(ask.key ? { key: ask.key } : {}), ...(ask.component ? { component: ask.component } : {}), ...(ask.where ? { where: ask.where } : {}) },
        ...(request.near ? { near: request.near } : {}),
      }, signal), picks, controller.signal).finally(() => { if (request.turn) this.turns.delete(request.turn); });
    }
    return result;
  }
}
