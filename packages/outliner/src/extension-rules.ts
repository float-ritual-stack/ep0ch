import { createHash } from "node:crypto";
import {
  builtInSpec,
  compileRulePattern,
  defaultPlace,
  expandTemplate,
  parseKindSpec,
  ruleHits,
  rulesFromBlocks,
  RULE_KEYS,
  type BuiltInSpec,
  type KindSpec,
  type Place,
  type RuleHit,
  type RuleMatch,
} from "@ep0ch/outline-core/rules";
import { ComponentError, renderComponent, validatePrimitive, type Primitive } from "./component-primitives";
import { DEFAULT_DEADLINE_MS, durationMs, type ExtensionRule, type LoadedExtension } from "./extension-manifest";
import { cleanExtensionText, inertBlockdown, isExtensionActor } from "./extension-records";
import type { ExtensionActRequest, ExtensionActResult } from "./extension-calls";
import type { ExtensionRegistry } from "./extension-registry";
import { parsePropertyRecords } from "./properties";
import type { ResourceExtensionRuntime } from "./resource-extensions";
import type { ExtensionOutputRow, OutlinerStore } from "./store";
import type { Block, MutationProvenance } from "./types";

/**
 * User-land rules (PIE-600): "when a block matches this, draw this, or run this".
 *
 * A rule comes from one of two tiers, and both are one thing here:
 * - **a rule note** in the outline (`[rule-name::name]` with `rule-*` properties, outline-core `rulesFromBlocks`): a
 *   match and a built-in decoration, no code. PIE-599's heading styles are this tier's built-in `band`.
 * - **an extension's rule** (`rules[]` in `extension.json`): a match, then `decorate` (a built-in decoration, or
 *   the `decorate` operation's view) and `on` (an action run when a block starts or stops matching, or changes
 *   while it matches).
 *
 * `match` is evaluated by the service: a property or a saved-view query through the store's own matcher
 * (`matchQuery`, the views' grammar and index), `under` as its subtree, a text pattern line by line outside code,
 * literal regions and property tokens, and a construct kind (outline-core `ruleHits`).
 *
 * **Decorations** are what readers draw (`resources.projection.read`'s `decorations`): view primitives (the
 * component catalogue plus `band` and `track`) placed above or below what matched, in its place, or around it. The
 * source text never changes. A code rule's view is kept like an output (`extension_outputs`, `rule:` keys) and run
 * again when the block's revision changes; until then the last one is shown.
 *
 * **Triggers** (`on`) are fed by the change feed and wait for the block to be quiet. Their writes are the
 * extension's (`ext:<id>`, `requestedBy` the one whose save set it off), and a save any extension made never sets
 * a trigger off (it only moves what the trigger remembers), so a trigger can't loop on its own writes or another's.
 */

/** Where a rule comes from. */
export type RuleSource =
  | { readonly kind: "extension"; readonly extension: string; readonly rule: string }
  | { readonly kind: "note"; readonly blockId: string };

/** One rule, from either tier, as the engine evaluates it. */
export interface RuleEntry {
  /** `ext:<extension>/<rule>` or `note:<block id>`: unique. */
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly source: RuleSource;
  readonly match: RuleMatch;
  readonly decorate?: { readonly place?: Place; readonly builtIn?: BuiltInSpec; readonly code: boolean; readonly deadline?: string };
  readonly on?: { readonly start?: string; readonly stop?: string; readonly change?: string; readonly quietMs: number };
}

/** What `extensions.list` says of a rule. */
export interface RuleListEntry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly source: RuleSource;
  readonly match: RuleMatch;
  readonly decorate?: { readonly place?: Place; readonly use?: string; readonly code: boolean };
  readonly on?: { readonly start?: string; readonly stop?: string; readonly change?: string; readonly quiet: string };
  /** How many blocks match it now (a trigger rule's count; absent for one without `on`). */
  readonly matching?: number;
  /** The last trigger that ran, and what came of it. */
  readonly lastRun?: { readonly at: string; readonly blockId: string; readonly when: "start" | "stop" | "change"; readonly message?: string; readonly error?: string };
  /** Why it matches nothing (a pattern or a kind that can't be used). */
  readonly problem?: string;
}

/** One decoration a reader draws on a block. */
export interface Decoration {
  /** The rule's key (`ext:meeting-card/meeting-card`, `note:<id>`). */
  readonly rule: string;
  readonly name: string;
  readonly source: RuleSource;
  /** What matched: the whole block, a construct, or a line a text pattern hit (whole-text lines; `end` after the last). */
  readonly hit: RuleHit;
  readonly place: Place;
  /** `ready`, `stale` (the last run failed or the block changed since; the last view is shown), `not-run`, `unavailable`. */
  readonly status: "ready" | "stale" | "not-run" | "unavailable";
  readonly view?: Primitive;
  readonly title?: string;
  /** The view as Markdown: what a client that doesn't draw primitives shows (Detail), and a band's plain heading. */
  readonly markdown?: string;
  readonly ranAt?: string;
  readonly fetching?: true;
  readonly reason?: string;
}

/** What the engine needs of the service around it. */
export interface ExtensionRulesOptions {
  readonly now?: () => number;
  /** A block's decorations changed without a content change (a code rule ran): readers read it again. */
  readonly changed?: (blockId: string) => void;
  /** The rules themselves changed (a rule note was written, an extension's rules): readers read every note again. */
  readonly rulesChanged?: () => void;
  /** Runs a trigger's action: `extensions.act`, the same path a key, a click and an agent take. */
  readonly act?: (request: ExtensionActRequest) => Promise<ExtensionActResult>;
  /** Overrides every trigger's quiet wait (tests). */
  readonly quietMs?: number;
}

const DEFAULT_QUIET_MS = 2_000;
const MAX_RUNNING = 4;
const MAX_DECORATIONS = 48;
const RETRY_FAILED_MS = 60_000;

const title = (text: string) => text.split("\n", 1)[0]!.replace(/\[[A-Za-z][A-Za-z0-9_.-]*::[^\]\n]*\]/g, "").replace(/\s+/g, " ").trim();
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Resource extension: /, "") : String(error));

/** A rule's manifest form, read into an entry. */
function extensionRule(extension: LoadedExtension, rule: ExtensionRule): RuleEntry {
  const match: RuleMatch = {
    ...(rule.match.property || rule.match.query ? { query: rule.match.property ?? rule.match.query } : {}),
    ...(rule.match.view ? { view: rule.match.view.toLowerCase() } : {}),
    ...(rule.match.under ? { under: rule.match.under.toLowerCase() } : {}),
    ...(rule.match.text ? { text: rule.match.text } : {}),
    ...(rule.match.kind ? { kind: rule.match.kind.toLowerCase() } : {}),
  };
  let builtIn: BuiltInSpec | undefined;
  if (rule.decorate?.use) {
    const read = builtInSpec({ use: rule.decorate.use, label: rule.decorate.label, tone: rule.decorate.tone, fields: rule.decorate.fields, pattern: rule.decorate.pattern, align: rule.decorate.align, style: rule.decorate.style });
    if ("spec" in read) builtIn = read.spec;
  }
  return {
    key: `ext:${extension.id}/${rule.id}`,
    name: `${extension.id}/${rule.id}`,
    ...(rule.description ? { description: rule.description } : {}),
    source: { kind: "extension", extension: extension.id, rule: rule.id },
    match,
    ...(rule.decorate ? { decorate: { ...(rule.decorate.place ? { place: rule.decorate.place } : {}), ...(builtIn ? { builtIn } : {}), code: !builtIn,
      ...(rule.decorate.deadline ? { deadline: rule.decorate.deadline } : {}) } } : {}),
    ...(rule.on ? { on: { ...(rule.on.start ? { start: rule.on.start } : {}), ...(rule.on.stop ? { stop: rule.on.stop } : {}),
      ...(rule.on.change ? { change: rule.on.change } : {}), quietMs: durationMs(rule.on.quiet) ?? DEFAULT_QUIET_MS } } : {}),
  };
}

/** The compiled conditions of a rule, cached by its key and match. */
interface Compiled { readonly text?: RegExp; readonly kind?: KindSpec; readonly problem?: string }

interface Pending {
  readonly before: boolean;
  requestedBy: MutationProvenance | undefined;
  timer: ReturnType<typeof setTimeout>;
}

export class ExtensionRules {
  private noteCache: { sequence: number; rules: RuleEntry[]; problems: string[]; signature: string } | null = null;
  private readonly compiled = new Map<string, Compiled>();
  private readonly running = new Set<string>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;
  private readonly failedAt = new Map<string, { at: number; error: string }>();
  /** Per trigger rule: the blocks that match it now (as of the last save the engine saw). */
  private readonly matching = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Pending>();
  private readonly lastRun = new Map<string, NonNullable<RuleListEntry["lastRun"]>>();
  /** Each trigger rule's match, as its baseline was taken: a rule whose match changes starts again. */
  private readonly printed = new Map<string, string>();
  /** Per rule and block, how many times an extension's write (or the Trash) has dropped what was waiting there. */
  private readonly generations = new Map<string, number>();
  /** Per block, the triggers running or waiting to run, one after another. */
  private readonly chains = new Map<string, Promise<void>>();
  private started = false;
  private stopped = false;

  constructor(
    private readonly store: OutlinerStore,
    private readonly registry: ExtensionRegistry,
    private readonly runtime: ResourceExtensionRuntime,
    private readonly options: ExtensionRulesOptions = {},
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  // ── the rules ──────────────────────────────────────────────────────────

  /** The rule notes in the outline, read again after any write. */
  private notes(): { rules: RuleEntry[]; problems: string[]; signature: string } {
    const sequence = this.store.sequence;
    if (this.noteCache?.sequence === sequence) return this.noteCache;
    const declared = this.store.queryBlocks({ filters: [{ key: "rule-name" }], limit: 500 });
    const { rules, problems } = rulesFromBlocks(declared.blocks.map((block) => ({
      id: block.id,
      properties: parsePropertyRecords(block.text).filter((property) => property.scope === "block").map((property) => ({ key: property.key, value: property.value })),
    })));
    const entries = rules.map((rule): RuleEntry => ({
      key: `note:${rule.block}`,
      name: rule.name,
      source: { kind: "note", blockId: rule.block },
      match: rule.match,
      decorate: { ...(rule.place ? { place: rule.place } : {}), builtIn: rule.decorate, code: false },
    }));
    if (declared.completeness.kind === "truncated") problems.push("more than 500 notes declare rules: the first 500 are used");
    const signature = JSON.stringify([entries, problems]);
    this.noteCache = { sequence, rules: entries, problems, signature };
    return this.noteCache;
  }

  /** Every rule now: the extensions' (active, or failed on their last good copy), then the outline's notes. */
  rules(): RuleEntry[] {
    const fromExtensions = this.registry.serving().flatMap((extension) => (extension.manifest.rules ?? []).map((rule) => extensionRule(extension, rule)));
    return [...fromExtensions, ...this.notes().rules];
  }

  /** `extensions.list`'s `rules` and `ruleProblems`: every rule, what it matches and does, and what's wrong with the notes. */
  list(): { rules: RuleListEntry[]; ruleProblems: string[] } {
    const rules = this.rules().map((rule): RuleListEntry => {
      const problem = this.compile(rule).problem ?? this.queryProblem(rule);
      const last = this.lastRun.get(rule.key);
      return {
        key: rule.key, name: rule.name, ...(rule.description ? { description: rule.description } : {}), source: rule.source, match: rule.match,
        ...(rule.decorate ? { decorate: { ...(rule.decorate.place ? { place: rule.decorate.place } : {}), ...(rule.decorate.builtIn ? { use: rule.decorate.builtIn.use } : {}), code: rule.decorate.code } } : {}),
        ...(rule.on ? { on: { ...(rule.on.start ? { start: rule.on.start } : {}), ...(rule.on.stop ? { stop: rule.on.stop } : {}), ...(rule.on.change ? { change: rule.on.change } : {}), quiet: `${Math.round(rule.on.quietMs / 100) / 10}s` },
          matching: this.matching.get(rule.key)?.size ?? 0 } : {}),
        ...(last ? { lastRun: last } : {}),
        ...(problem ? { problem } : {}),
      };
    });
    return { rules, ruleProblems: this.notes().problems };
  }

  /**
   * What a rule note (its text, never saved) draws on a sample note's text (PIE-618: a component page's rule variations):
   * its no-code decorations, placed and drawn as `decorations` makes them for a block. A query, view or place in the
   * outline is taken to hold for the sample: what's asked is what the rule draws, not which notes it finds.
   */
  preview(note: string, text: string): { decorations: Decoration[]; problems: string[] } {
    const { rules, problems } = rulesFromBlocks([{
      id: "preview",
      properties: parsePropertyRecords(note).filter((property) => property.scope === "block").map((property) => ({ key: property.key, value: property.value })),
    }]);
    const decorations: Decoration[] = [];
    for (const rule of rules) {
      const pattern = rule.match.text ? compileRulePattern(rule.match.text) : undefined;
      const kind = rule.match.kind ? parseKindSpec(rule.match.kind) : undefined;
      if ((pattern && "problem" in pattern) || (kind && "problem" in kind)) continue;
      for (const hit of ruleHits(text, { ...(pattern ? { text: pattern } : {}), ...(kind ? { kind } : {}) })) {
        if (decorations.length >= MAX_DECORATIONS) break;
        const view = builtInView(rule.decorate, hit, { text } as Block);
        decorations.push({
          rule: "note:preview", name: rule.name, source: { kind: "note", blockId: "preview" }, hit,
          place: rule.place ?? defaultPlace(rule.decorate.use, hit.at), status: "ready", view, markdown: renderComponent({ data: null, view }, "markdown").body,
        });
      }
    }
    return { decorations, problems };
  }

  /** Why a rule's query or view can't be used: the grammar's refusal, or a view that isn't one. */
  private queryProblem(rule: RuleEntry): string | undefined {
    try {
      if (rule.match.query) this.store.matchQuery(rule.match.query, []);
      if (rule.match.view && this.viewQuery(rule.match.view) === null) return `view ${rule.match.view} isn't a saved view (a block with [query::…]) here`;
      if (rule.match.view) this.store.matchQuery(this.viewQuery(rule.match.view)!, []);
      if (rule.match.under && !this.store.get(rule.match.under)) return `under ${rule.match.under}: no such block here`;
    } catch (error) {
      return `the query doesn't parse: ${message(error)}`;
    }
    return undefined;
  }

  private compile(rule: RuleEntry): Compiled {
    const id = `${rule.key}\0${rule.match.text ?? ""}\0${rule.match.kind ?? ""}`;
    const hit = this.compiled.get(id);
    if (hit) return hit;
    let compiled: Compiled = {};
    if (rule.match.text) {
      const pattern = compileRulePattern(rule.match.text);
      compiled = "problem" in pattern ? { problem: pattern.problem } : { text: pattern };
    }
    if (!compiled.problem && rule.match.kind) {
      const kind = parseKindSpec(rule.match.kind);
      compiled = "problem" in kind ? { problem: kind.problem } : { ...compiled, kind };
    }
    if (this.compiled.size > 500) this.compiled.clear();
    this.compiled.set(id, compiled);
    return compiled;
  }

  // ── matching ───────────────────────────────────────────────────────────

  /** The query a rule's view names (its `[query::…]`), or null when the block isn't a view. */
  private viewQuery(viewId: string): string | null {
    const view = this.store.get(viewId);
    if (!view || view.effectiveDeletedRootId) return null;
    return parsePropertyRecords(view.text).find((property) => property.scope === "block" && property.key === "query")?.value ?? null;
  }

  /** Of `ids`, the blocks a rule's block conditions (query, view, under) hold for. */
  private blockMatches(rule: RuleEntry, ids: readonly string[]): Set<string> {
    const { query, view, under } = rule.match;
    let left = [...ids];
    const narrow = (expression: string | undefined, subtreeRootId?: string) => {
      const out: string[] = [];
      for (let at = 0; at < left.length; at += 1000) {
        out.push(...this.store.matchQuery(expression, left.slice(at, at + 1000), subtreeRootId ? { subtreeRootId } : {}).blockIds);
      }
      left = out;
    };
    try {
      if (query) narrow(query);
      if (view) {
        const viewed = this.viewQuery(view);
        if (viewed === null) return new Set();
        narrow(viewed);
      }
      if (under) {
        if (!this.store.get(under)) return new Set();
        narrow(undefined, under);
      }
    } catch {
      // A query the grammar refuses matches nothing (the rule's note or manifest says why when listed).
      return new Set();
    }
    return new Set(left);
  }

  /** Where a rule matches one block: its hits, or none. */
  private hitsIn(rule: RuleEntry, block: Block): RuleHit[] {
    if (block.effectiveDeletedRootId) return [];
    const compiled = this.compile(rule);
    if (compiled.problem) return [];
    if ((rule.match.query || rule.match.view || rule.match.under) && !this.blockMatches(rule, [block.id]).has(block.id)) return [];
    // A rule note never decorates itself or another rule note's own words.
    if (rule.source.kind === "note" && (compiled.text || compiled.kind) && parsePropertyRecords(block.text).some((property) => property.key === "rule-name" && property.scope === "block")) return [];
    return ruleHits(block.text, { ...(compiled.text ? { text: compiled.text } : {}), ...(compiled.kind ? { kind: compiled.kind } : {}) });
  }

  // ── decorations ────────────────────────────────────────────────────────

  /**
   * The decorations a reader draws on a block, in the order the rules are listed (extensions first, then notes),
   * each rule's hits in reading order. A code rule's view that isn't current runs in the background; the reader
   * is told (`changed`) when it lands.
   */
  decorations(blockId: string): Decoration[] {
    const block = this.store.get(blockId);
    if (!block || block.effectiveDeletedRootId) return [];
    const rules = this.rules().filter((rule) => rule.decorate);
    if (!rules.length) return [];
    const rows = this.store.extensionOutputs(blockId).filter((row) => row.callKey.startsWith("rule:"));
    const kept = new Map(rows.map((row) => [row.callKey, row]));
    const out: Decoration[] = [];
    const used = new Set<string>();
    for (const rule of rules) {
      if (out.length >= MAX_DECORATIONS) break;
      const seen = new Map<string, number>();
      for (const hit of this.hitsIn(rule, block)) {
        if (out.length >= MAX_DECORATIONS) break;
        const place = rule.decorate!.place ?? defaultPlace(rule.decorate!.builtIn?.use ?? null, hit.at);
        const base = { rule: rule.key, name: rule.name, source: rule.source, hit, place };
        if (rule.decorate!.builtIn) {
          const view = builtInView(rule.decorate!.builtIn, hit, block);
          out.push({ ...base, status: "ready", view, markdown: renderComponent({ data: null, view }, "markdown").body });
          continue;
        }
        // Identical hits (two `## Notes`) are told apart by their order among themselves, not by their line.
        const same = JSON.stringify([hit.at, hit.text, hit.captures ?? [], hit.level ?? null]);
        const occurrence = seen.get(same) ?? 0;
        seen.set(same, occurrence + 1);
        const callKey = this.callKey(rule, hit, occurrence);
        used.add(callKey);
        out.push(this.codeDecoration(base, rule, hit, block, kept.get(callKey), callKey));
      }
    }
    // Views of hits the block no longer has go.
    const gone = rows.filter((row) => !used.has(row.callKey));
    if (gone.length) this.store.pruneExtensionOutputs(blockId, this.store.extensionOutputs(blockId).map((row) => row.callKey).filter((key) => !gone.some((row) => row.callKey === key)));
    return out;
  }

  /** A code rule's hit is known by the rule, what it matched (its words and captures) and its order among identical hits, not by its line: moving it keeps its view. */
  private callKey(rule: RuleEntry, hit: RuleHit, occurrence: number): string {
    return `rule:${createHash("sha256").update(JSON.stringify([rule.key, hit.at, hit.text, hit.captures ?? [], hit.level ?? null, occurrence])).digest("hex").slice(0, 32)}`;
  }

  private codeDecoration(
    base: Pick<Decoration, "rule" | "name" | "source" | "hit" | "place">, rule: RuleEntry, hit: RuleHit, block: Block,
    row: ExtensionOutputRow | undefined, callKey: string,
  ): Decoration {
    const source = rule.source as Extract<RuleSource, { kind: "extension" }>;
    const extension = this.registry.extension(source.extension);
    if (!extension) return { ...base, status: "unavailable", reason: `${source.extension} isn't installed here` };
    const runKey = `${block.id}\0${callKey}`;
    const failed = this.failedAt.get(runKey);
    // A view depends on the block and its children (the context a call sees): either changing draws it again.
    const deps = this.dependencies(block);
    const current = !!row && row.result !== null && row.blockRevision === block.revision && row.extensionVersion === extension.version &&
      (row.request as { deps?: string } | null)?.deps === deps;
    const retry = !failed || this.now - failed.at > RETRY_FAILED_MS;
    if (!current && retry && !this.running.has(runKey)) void this.run(rule, extension, hit, block, callKey, deps);
    const fetching = this.running.has(runKey) ? { fetching: true as const } : {};
    const result = row?.result as { view?: Primitive; title?: string } | null | undefined;
    if (!result?.view) {
      const error = failed?.error ?? row?.error ?? undefined;
      return error ? { ...base, ...fetching, status: "unavailable", reason: error } : { ...base, ...fetching, status: "not-run", reason: `${extension.name} is drawing it` };
    }
    const why = failed?.error ?? row?.error ?? undefined;
    return {
      ...base, ...fetching,
      status: current && !why ? "ready" : "stale",
      view: result.view,
      ...(result.title ? { title: result.title } : {}),
      markdown: inertBlockdown(renderComponent({ data: null, view: result.view }, "markdown").body),
      ...(row!.ranAt ? { ranAt: row!.ranAt } : {}),
      ...(why ? { reason: `the last run failed: ${why}` } : !current ? { reason: "the block changed since: drawing it again" } : {}),
    };
  }

  /** At most MAX_RUNNING decorate calls at once, across the outline. */
  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_RUNNING) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  /** The children a decorate call sees, by id and revision: a child added, edited or moved makes a view stale. */
  private dependencies(block: Block): string {
    const children = this.store.blockContext(block.id).children.slice(0, 50).map((child) => `${child.id}:${child.revision}`);
    return createHash("sha256").update(children.join(",")).digest("hex").slice(0, 16);
  }

  private async run(rule: RuleEntry, extension: LoadedExtension, hit: RuleHit, block: Block, callKey: string, deps: string): Promise<void> {
    const runKey = `${block.id}\0${callKey}`;
    this.running.add(runKey);
    const source = rule.source as Extract<RuleSource, { kind: "extension" }>;
    const attemptedAt = new Date(this.now).toISOString();
    const base = { blockId: block.id, callKey, extensionId: extension.id, handlerKey: `rule:${source.rule}`, kind: "component" as const,
      request: { rule: source.rule, hit, deps }, attemptedAt, blockRevision: block.revision, extensionVersion: extension.version };
    try {
      await this.slot(async () => {
        if (this.stopped) return;
        const answer = await this.runtime.invokeLoaded(extension, "decorate", { rule: source.rule, hit, context: this.context(block) },
          durationMs(rule.decorate?.deadline) ?? durationMs(extension.manifest.deadline) ?? DEFAULT_DEADLINE_MS);
        const value = answer.value as Record<string, unknown> | null;
        let view: Primitive;
        try {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComponentError("decorate returns { view, title? }");
          view = validatePrimitive(value.view);
        } catch (error) {
          throw new Error(`${extension.name} returned a decoration the service can't show: ${message(error)}`);
        }
        const shownTitle = typeof value.title === "string" ? cleanExtensionText(value.title.slice(0, 300)) : undefined;
        if (this.store.get(block.id)) this.store.putExtensionOutput({ ...base, result: { data: null, view, ...(shownTitle ? { title: shownTitle } : {}) } });
        this.failedAt.delete(runKey);
      });
    } catch (error) {
      if (this.store.get(block.id)) this.store.putExtensionOutput({ ...base, error: message(error) });
      this.failedAt.set(runKey, { at: this.now, error: message(error) });
    } finally {
      this.running.delete(runKey);
    }
    this.options.changed?.(block.id);
  }

  /** What a decorate call sees of the outline: the block (properties too), its children and its ancestors, bounded. */
  private context(block: Block): Record<string, unknown> {
    const context = this.store.blockContext(block.id);
    return {
      block: { id: block.id, text: block.text.slice(0, 16_000), revision: block.revision,
        properties: parsePropertyRecords(block.text).filter((property) => property.scope === "block").map((property) => ({ key: property.key, value: property.value })) },
      children: context.children.slice(0, 50).map((child) => ({ id: child.id, text: child.text.slice(0, 2_000) })),
      ancestors: context.ancestors.slice(-8).map((ancestor) => ({ id: ancestor.id, title: title(ancestor.text) })),
      now: new Date(this.now).toISOString(),
    };
  }

  // ── triggers ───────────────────────────────────────────────────────────

  private triggerRules(): RuleEntry[] {
    return this.rules().filter((rule) => rule.on);
  }

  /** Starts watching: what each trigger rule matches now is its baseline (nothing runs for blocks that already match). */
  start(): void {
    this.started = true;
    this.rebaseline();
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }

  /**
   * The registry or the rule notes changed: a trigger rule that is new, or whose match changed, starts from what
   * matches now (a rule installed over existing meetings runs nothing for them) and forgets what was waiting; a rule
   * that is gone is forgotten.
   */
  rebaseline(): void {
    if (!this.started || this.stopped) return;
    const rules = this.triggerRules();
    const prints = new Map(rules.map((rule) => [rule.key, JSON.stringify(rule.match)]));
    for (const key of [...this.matching.keys()]) {
      if (prints.get(key) === this.printed.get(key)) continue;
      this.matching.delete(key);
      this.printed.delete(key);
      for (const [id, pending] of [...this.pending]) if (id.startsWith(`${key}\n`)) { clearTimeout(pending.timer); this.pending.delete(id); }
    }
    const fresh = rules.filter((rule) => !this.matching.has(rule.key));
    if (!fresh.length) return;
    const blocks = this.store.liveBlocks();
    for (const rule of fresh) this.recompute(rule, blocks);
  }

  /** What a trigger rule matches now, across the outline, with nothing run: its baseline. */
  private recompute(rule: RuleEntry, blocks: readonly Block[] = this.store.liveBlocks()): void {
    const candidates = rule.match.query || rule.match.view || rule.match.under ? this.blockMatches(rule, blocks.map((block) => block.id)) : null;
    const set = new Set<string>();
    for (const block of blocks) {
      if (candidates && !candidates.has(block.id)) continue;
      if (this.hitsWithout(rule, block).length) set.add(block.id);
    }
    this.matching.set(rule.key, set);
    this.printed.set(rule.key, JSON.stringify(rule.match));
  }

  /** The hits of a rule whose block conditions are already known to hold. */
  private hitsWithout(rule: RuleEntry, block: Block): RuleHit[] {
    const compiled = this.compile(rule);
    if (compiled.problem) return [];
    return ruleHits(block.text, { ...(compiled.text ? { text: compiled.text } : {}), ...(compiled.kind ? { kind: compiled.kind } : {}) });
  }

  private matchesNow(rule: RuleEntry, blockId: string): boolean {
    const block = this.store.get(blockId);
    return !!block && !block.effectiveDeletedRootId && this.hitsIn(rule, block).length > 0;
  }

  /**
   * A block was created, edited, moved, restored or trashed (`actor` its writer). Rule notes may have changed:
   * readers hear of it. A code rule's view over its parent may be stale: that parent's readers hear of it. A save an
   * extension made only moves what each trigger remembers (and drops a person's change still waiting on that block,
   * so a trigger never runs for what an extension did); anyone else's waits for the block to be quiet, then runs the
   * trigger the change calls for. A block in the Trash stops matching, and nothing runs for it.
   */
  blockChanged(blockId: string, actor: MutationProvenance | undefined, kind: "create" | "edit" | "move" | "restore" | "delete" = "edit"): void {
    if (this.stopped) return;
    const block = this.store.get(blockId);
    // A rule note written, or one that was a rule note: the rules may have changed, and readers draw every note again.
    const wasRule = this.noteCache?.rules.some((rule) => rule.source.kind === "note" && rule.source.blockId === blockId);
    if (wasRule || (block && /\[rule(?:-[a-z]+)?::/i.test(block.text))) {
      const before = this.noteCache?.signature;
      if (this.notes().signature !== before) {
        this.options.rulesChanged?.();
        this.rebaseline();
      }
    }
    if (block?.parentId && this.store.extensionOutputs(block.parentId).some((row) => row.callKey.startsWith("rule:"))) this.options.changed?.(block.parentId);
    if (!this.started) return;
    for (const rule of this.triggerRules()) {
      const set = this.matching.get(rule.key);
      if (!set) continue;
      // A view's query edited: what its rules match is taken again, with nothing run.
      if (rule.match.view === blockId && kind === "edit") { this.recompute(rule); continue; }
      const id = `${rule.key}\n${blockId}`;
      const pending = this.pending.get(id);
      if (kind === "delete" || isExtensionActor(actor?.actorId)) {
        if (pending) { clearTimeout(pending.timer); this.pending.delete(id); }
        // Work already queued behind another action (its quiet wait over) is dropped too: it would compare from before this write.
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
        if (kind !== "delete" && this.matchesNow(rule, blockId)) set.add(blockId);
        else set.delete(blockId);
        continue;
      }
      if (pending) {
        clearTimeout(pending.timer);
        pending.requestedBy = actor;
        pending.timer = this.arm(rule, blockId, id);
        continue;
      }
      const was = set.has(blockId);
      // A block that neither matched nor matches now has nothing to wait for.
      if (!was && !this.matchesNow(rule, blockId)) continue;
      this.pending.set(id, { before: was, requestedBy: actor, timer: this.arm(rule, blockId, id) });
    }
  }

  private arm(rule: RuleEntry, blockId: string, id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      const generation = this.generations.get(id) ?? 0;
      if (pending) this.queue(blockId, () => (this.generations.get(id) ?? 0) === generation ? this.fire(rule.key, blockId, pending) : this.remember(rule.key, blockId));
    }, this.options.quietMs ?? rule.on!.quietMs);
    timer.unref?.();
    return timer;
  }

  /** One trigger at a time per block: each action reads the block as the last one left it. */
  private queue(blockId: string, work: () => Promise<void>): void {
    const before = this.chains.get(blockId) ?? Promise.resolve();
    const next = before.then(work, work).finally(() => { if (this.chains.get(blockId) === next) this.chains.delete(blockId); });
    this.chains.set(blockId, next);
  }

  /** What a rule matches on a block now, remembered with nothing run (an extension wrote it while a trigger waited). */
  private async remember(ruleKey: string, blockId: string): Promise<void> {
    const rule = this.triggerRules().find((candidate) => candidate.key === ruleKey);
    const set = this.matching.get(ruleKey);
    if (!rule || !set) return;
    if (this.matchesNow(rule, blockId)) set.add(blockId);
    else set.delete(blockId);
  }

  private async fire(ruleKey: string, blockId: string, pending: Pending): Promise<void> {
    const rule = this.triggerRules().find((candidate) => candidate.key === ruleKey);
    const set = this.matching.get(ruleKey);
    if (!rule || !set || this.stopped) return;
    const now = this.matchesNow(rule, blockId);
    if (now) set.add(blockId);
    else set.delete(blockId);
    const when = !pending.before && now ? "start" : pending.before && !now ? "stop" : pending.before && now ? "change" : null;
    const action = when ? rule.on![when] : undefined;
    if (!when || !action || !this.options.act) return;
    const source = rule.source as Extract<RuleSource, { kind: "extension" }>;
    const at = new Date(this.now).toISOString();
    try {
      const result = await this.options.act({ extension: source.extension, action, blockId, ...(pending.requestedBy ? { requestedBy: pending.requestedBy } : {}) });
      this.lastRun.set(ruleKey, { at, blockId, when, ...(result.message ? { message: result.message } : {}) });
    } catch (error) {
      this.lastRun.set(ruleKey, { at, blockId, when, error: message(error) });
    }
  }

  /** Waits for every trigger that is waiting or running to have finished (tests, and a service stopping cleanly). */
  async settle(): Promise<void> {
    while (this.pending.size || this.chains.size) {
      await Promise.all([...this.chains.values()].map((chain) => chain.catch(() => {})));
      if (this.pending.size) await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// ── the built-in decorations ─────────────────────────────────────────────────────────────────────────

/** A built-in decoration's view for one hit: the no-code tier, composed from the same primitives a code rule returns. */
export function builtInView(spec: BuiltInSpec, hit: RuleHit, block: Block): Primitive {
  const properties = parsePropertyRecords(block.text).filter((property) => property.scope === "block" && !(RULE_KEYS as readonly string[]).includes(property.key));
  const values = {
    title: title(block.text),
    text: hit.at === "block" ? title(block.text) : hit.at === "construct" ? hit.text : (hit.captures?.[1] ?? hit.captures?.[0] ?? hit.text),
    ...(hit.level !== undefined ? { level: hit.level } : {}),
    ...(hit.captures ? { captures: hit.captures } : {}),
    property: (key: string) => properties.filter((property) => property.key === key).map((property) => property.value),
  };
  const words = (fallback: string) => cleanExtensionText(expandTemplate(spec.label ?? fallback, values)).slice(0, 300);
  const tone = spec.tone ? { tone: spec.tone } : {};
  switch (spec.use) {
    case "band": {
      const level = Math.min(3, Math.max(1, hit.kind === "heading" ? hit.level ?? 1 : 1)) as 1 | 2 | 3;
      return validatePrimitive({ type: "band", text: words("{text}"), level, ...(spec.style ? { style: spec.style } : {}), ...(spec.pattern ? { pattern: spec.pattern } : {}), ...(spec.align ? { align: spec.align } : {}), ...tone });
    }
    case "divider":
      return validatePrimitive({ type: "track", ...(spec.style ? { style: spec.style } : {}), ...(spec.pattern ? { pattern: spec.pattern } : {}), ...tone });
    case "badge":
      return validatePrimitive({ type: "badge", label: words("{text}"), ...tone });
    case "text":
      return validatePrimitive({ type: "text", text: words("{text}"), strong: true, ...tone });
    case "box":
      return validatePrimitive({ type: "box", title: words(""), children: [] });
    case "card": {
      const fields = (spec.fields ?? []).map((key) => ({ type: "stat", label: key, value: values.property(key).join(", ") || "—" }));
      return validatePrimitive({ type: "card", title: words("{title}"), ...(fields.length ? { children: [{ type: "row", children: fields }] } : {}) });
    }
  }
}
