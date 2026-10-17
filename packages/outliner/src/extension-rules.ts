import { createHash } from "node:crypto";
import {
  builtInSpec,
  compileRulePattern,
  defaultPlace,
  parseKindSpec,
  DEFAULT_RULE_FROM,
  parseRuleCap,
  parseRuleWriters,
  ruleHits,
  rulesFromBlocks,
  ruleWaitMs,
  ruleWriter,
  RULE_KEYS,
  VIA_TRIGGER,
  type ActionRef,
  type BuiltInSpec,
  type KindSpec,
  type Place,
  type RuleHit,
  type RuleMatch,
  type RuleWriter,
} from "@ep0ch/outline-core/rules";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ComponentError, renderComponent, validatePrimitive, type Primitive } from "./component-primitives";
import { DEFAULT_DEADLINE_MS, durationMs, type ExtensionRule, type LoadedExtension } from "./extension-manifest";
import { cleanExtensionText, inertBlockdown } from "./extension-records";
import { blockCallContext, type ExtensionActRequest, type ExtensionActResult } from "./extension-calls";
import type { ExtensionRegistry } from "./extension-registry";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { blockRecord, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { scanPropertyLiteralRanges } from "@ep0ch/outline-core/code-ranges";
import { interpolateWith } from "@ep0ch/outline-core/interpolation";
import { noteValues } from "@ep0ch/outline-core/resolve-path";
import type { Site } from "@ep0ch/outline-core/site";
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
 * **Triggers** (`on`; a rule note's `[rule-on::<extension>/<action>]`) are fed by the change feed and wait for the
 * block to be quiet. Their writes are the extension's (`ext:<id>`, `requestedBy` the one whose save set it off). A
 * rule hears a person's and agents' saves; `from` (`[rule-from::…]`, PIE-786) names the writers it hears instead, so
 * `ext:echonet` lets an EchoNet copy arriving set it off. A save it doesn't hear only moves what it remembers. What a
 * trigger writes never sets a rule off: its writes carry `taskId: trigger:<rule>`, and the blocks it makes
 * `[via-trigger::<rule>]`, which a copy of them tossed to another outline keeps (any writer but a person's saves of
 * such a block are skipped). Guards for a trigger that starts an agent: `batch` gathers a burst into one call, `cap`
 * the calls a day (kept in `runsFile` across restarts), `skip` a query whose blocks never set it off.
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
  readonly on?: {
    readonly start?: ActionRef; readonly stop?: ActionRef; readonly change?: ActionRef; readonly quietMs: number;
    readonly from?: readonly RuleWriter[]; readonly batchMs?: number; readonly cap?: number; readonly skip?: string;
  };
}

/** What `extensions.list` says of a rule. */
export interface RuleListEntry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly source: RuleSource;
  readonly match: RuleMatch;
  readonly decorate?: { readonly place?: Place; readonly use?: string; readonly code: boolean };
  /**
   * Its actions (an extension rule's own action by id; a rule note's as `<extension>/<action>`), the quiet wait, the
   * writers it hears, and its guards.
   */
  readonly on?: {
    readonly start?: string; readonly stop?: string; readonly change?: string; readonly quiet: string;
    readonly from: readonly string[]; readonly batch?: string; readonly cap?: number; readonly skip?: string;
  };
  /** How many blocks match it now (a trigger rule's count; absent for one without `on`). */
  readonly matching?: number;
  /** How many times its trigger called its action today (against its cap). */
  readonly ranToday?: number;
  /** The last trigger that ran, and what came of it. */
  readonly lastRun?: { readonly at: string; readonly blockId: string; readonly when: "start" | "stop" | "change"; readonly blocks?: number; readonly message?: string; readonly error?: string };
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
  /** Where each rule's runs today are kept, so a daily cap holds across a restart. */
  readonly runsFile?: string;
}

const DEFAULT_QUIET_MS = 2_000;
/** The most blocks one batched call takes: a bigger burst is several calls. */
const MAX_BATCH = 50;
const MAX_RUNNING = 4;
const MAX_DECORATIONS = 48;
const RETRY_FAILED_MS = 60_000;

const title = (text: string) => text.split("\n", 1)[0]!.replace(/\[[A-Za-z][A-Za-z0-9_.-]*::[^\]\n]*\]/g, "").replace(/\s+/g, " ").trim();
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Resource extension: /, "") : String(error));
const VIA = new RegExp(`\\[${VIA_TRIGGER}::`, "i");
const durationText = (ms: number) => ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 100) / 10}s`;

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
    ...(rule.on ? { on: triggerOn({ ...rule.on, extension: extension.id }) } : {}),
  };
}

/** A trigger's `on`, from a manifest's (its actions by id, in `extension`) or a rule note's (actions by `<extension>/<action>`). */
function triggerOn(on: {
  start?: string | ActionRef; stop?: string | ActionRef; change?: string | ActionRef; extension?: string;
  quiet?: string; from?: string | readonly string[]; batch?: string; cap?: string | number; skip?: string;
}): NonNullable<RuleEntry["on"]> {
  const ref = (value: string | ActionRef | undefined): ActionRef | undefined =>
    value === undefined ? undefined : typeof value === "string" ? { extension: on.extension!, action: value } : value;
  const start = ref(on.start), stop = ref(on.stop), change = ref(on.change);
  const from = on.from === undefined ? undefined : parseRuleWriters(on.from).writers;
  const cap = on.cap === undefined ? undefined : typeof on.cap === "number" ? on.cap : parseRuleCap(on.cap);
  const wait = (raw: string | undefined) => { const ms = raw === undefined ? undefined : ruleWaitMs(raw); return typeof ms === "number" ? ms : undefined; };
  const batchMs = wait(on.batch);
  return {
    ...(start ? { start } : {}), ...(stop ? { stop } : {}), ...(change ? { change } : {}),
    quietMs: wait(on.quiet) ?? DEFAULT_QUIET_MS,
    ...(from?.length ? { from } : {}), ...(batchMs ? { batchMs } : {}), ...(typeof cap === "number" ? { cap } : {}), ...(on.skip ? { skip: on.skip } : {}),
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
  /** Per rule and action: the blocks a burst gathered (`batch`), called together when its window closes. */
  private readonly batches = new Map<string, {
    ruleKey: string; when: "start" | "stop" | "change"; requestedBy: MutationProvenance | undefined; timer: ReturnType<typeof setTimeout>;
    /** Each block, with the generation it joined at: a write that drops what waits there drops it from the batch too. */
    blocks: Map<string, number>;
  }>();
  /** Each rule's calls today (`cap`), by its key: the day they're for, kept in `runsFile`; `broken` when that file can't be read. */
  private runs: { day: string; counts: Record<string, number>; broken?: string } | null = null;
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
      ...(rule.decorate ? { decorate: { ...(rule.place ? { place: rule.place } : {}), builtIn: rule.decorate, code: false } } : {}),
      ...(rule.on ? { on: triggerOn(rule.on) } : {}),
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
    const ruleProblems = [...this.notes().problems];
    const rules = this.rules().map((rule): RuleListEntry => {
      const problem = this.compile(rule).problem ?? this.queryProblem(rule) ?? this.triggerProblem(rule);
      // A rule note's action that can't run is the note's to fix: said with the note's other problems.
      if (problem && rule.source.kind === "note" && !this.compile(rule).problem && !this.queryProblem(rule)) ruleProblems.push(`note ${rule.source.blockId.slice(0, 8)}: ${problem}`);
      const last = this.lastRun.get(rule.key);
      const named = (ref: ActionRef | undefined) => ref && (rule.source.kind === "extension" && ref.extension === rule.source.extension ? ref.action : `${ref.extension}/${ref.action}`);
      const on = rule.on;
      return {
        key: rule.key, name: rule.name, ...(rule.description ? { description: rule.description } : {}), source: rule.source, match: rule.match,
        ...(rule.decorate ? { decorate: { ...(rule.decorate.place ? { place: rule.decorate.place } : {}), ...(rule.decorate.builtIn ? { use: rule.decorate.builtIn.use } : {}), code: rule.decorate.code } } : {}),
        ...(on ? { on: { ...(on.start ? { start: named(on.start) } : {}), ...(on.stop ? { stop: named(on.stop) } : {}), ...(on.change ? { change: named(on.change) } : {}), quiet: `${Math.round(on.quietMs / 100) / 10}s`,
          from: [...(on.from ?? DEFAULT_RULE_FROM)], ...(on.batchMs ? { batch: durationText(on.batchMs) } : {}), ...(on.cap ? { cap: on.cap } : {}), ...(on.skip ? { skip: on.skip } : {}) },
          matching: this.matching.get(rule.key)?.size ?? 0, ranToday: this.ranToday(rule.key) } : {}),
        ...(last ? { lastRun: last } : {}),
        ...(problem ? { problem } : {}),
      };
    });
    return { rules, ruleProblems };
  }

  /** Why a rule's trigger can't run: an action that isn't installed or doesn't act on a block, a skip query that doesn't parse. */
  private triggerProblem(rule: RuleEntry): string | undefined {
    if (!rule.on) return undefined;
    for (const [when, ref] of [["rule-on", rule.on.start], ["rule-on-stop", rule.on.stop], ["rule-on-change", rule.on.change]] as const) {
      if (!ref) continue;
      const name = `${ref.extension}/${ref.action}`;
      if (!this.registry.extension(ref.extension)) return `${when} names ${name}, but ${ref.extension} isn't installed here (ep0ch ext ls lists what is)`;
      const action = this.registry.action(ref.extension, ref.action);
      if (!action) return `${when} names ${name}, but ${ref.extension} has no action ${ref.action}`;
      if ((action.on ?? "block") !== "block" && !this.registry.extension(ref.extension)?.script) return `${when} names ${name}, which acts on ${action.on}; a rule's action acts on the block`;
    }
    if (rule.on.skip) {
      try {
        this.store.matchQuery(rule.on.skip, []);
      } catch (error) {
        return `the skip query doesn't parse: ${message(error)}`;
      }
    }
    return undefined;
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
      if (!rule.decorate) continue;
      const pattern = rule.match.text ? compileRulePattern(rule.match.text) : undefined;
      const kind = rule.match.kind ? parseKindSpec(rule.match.kind) : undefined;
      if ((pattern && "problem" in pattern) || (kind && "problem" in kind)) continue;
      for (const hit of ruleHits(text, { ...(pattern ? { text: pattern } : {}), ...(kind ? { kind } : {}) })) {
        if (decorations.length >= MAX_DECORATIONS) break;
        const view = builtInView(rule.decorate!, hit, { text } as Block);
        decorations.push({
          rule: "note:preview", name: rule.name, source: { kind: "note", blockId: "preview" }, hit,
          place: rule.place ?? defaultPlace(rule.decorate!.use, hit.at), status: "ready", view, markdown: renderComponent({ data: null, view }, "markdown").body,
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

  /** What a decorate call sees of the outline: the one context every call gets (records, extension-calls.ts). */
  private context(block: Block): Record<string, unknown> {
    return blockCallContext(this.store, block, undefined, this.now);
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
    for (const batch of this.batches.values()) clearTimeout(batch.timer);
    this.batches.clear();
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
    if (wasRule || (block && /\[rule(?:-[a-z-]+)?::/i.test(block.text))) {
      const before = this.noteCache?.signature;
      if (this.notes().signature !== before) {
        this.options.rulesChanged?.();
        this.rebaseline();
      }
    }
    if (block?.parentId && this.store.extensionOutputs(block.parentId).some((row) => row.callKey.startsWith("rule:"))) this.options.changed?.(block.parentId);
    if (!this.started) return;
    const writer = ruleWriter(actor);
    // What a trigger wrote, here (its writes' task) or in another outline (a tossed copy keeps its mark), sets nothing off.
    const triggered = actor?.taskId?.startsWith("trigger:") === true || (!!block && writer !== "user" && VIA.test(block.text));
    for (const rule of this.triggerRules()) {
      const set = this.matching.get(rule.key);
      if (!set) continue;
      // A view's query edited: what its rules match is taken again, with nothing run.
      if (rule.match.view === blockId && kind === "edit") { this.recompute(rule); continue; }
      const id = `${rule.key}\n${blockId}`;
      const pending = this.pending.get(id);
      const hears = !triggered && (rule.on!.from ?? DEFAULT_RULE_FROM).includes(writer);
      if (kind === "delete" || !hears) {
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
    // `skip`: a block its query holds for (already handled, say) never sets the rule off.
    if (rule.on!.skip && this.skips(rule.on!.skip, blockId)) return;
    if (rule.on!.batchMs) { this.gather(rule, when, blockId, pending.requestedBy, this.generations.get(`${ruleKey}\n${blockId}`) ?? 0); return; }
    await this.call(rule, when, [blockId], pending.requestedBy);
  }

  private skips(query: string, blockId: string): boolean {
    try {
      return this.store.matchQuery(query, [blockId]).blockIds.includes(blockId);
    } catch {
      // A skip query that doesn't parse skips nothing (the rule's listing says why).
      return false;
    }
  }

  /** A burst's block joins its rule's batch; the first opens the window, which closes `batch` later with one call for all. */
  private gather(rule: RuleEntry, when: "start" | "stop" | "change", blockId: string, requestedBy: MutationProvenance | undefined, generation: number): void {
    const key = `${rule.key}\n${when}`;
    const open = this.batches.get(key);
    if (open) {
      open.blocks.set(blockId, generation);
      open.requestedBy ??= requestedBy;
      return;
    }
    const timer = setTimeout(() => {
      const batch = this.batches.get(key);
      this.batches.delete(key);
      if (!batch) return;
      this.queue(`batch:${key}`, async () => {
        const current = this.triggerRules().find((candidate) => candidate.key === batch.ruleKey);
        if (!current || this.stopped) return;
        // Each block as it is now: still in the state that set it off (a start still matches, a stop doesn't), nothing
        // written over what waited there since it joined, not skipped since. Nothing left, nothing called.
        const blocks = [...batch.blocks].filter(([id, joined]) =>
          (this.generations.get(`${current.key}\n${id}`) ?? 0) === joined &&
          this.matchesNow(current, id) === (batch.when !== "stop") &&
          !(current.on?.skip && this.skips(current.on.skip, id))).map(([id]) => id);
        // A call takes 50 blocks at most: a bigger burst is several calls, each counted against the cap.
        for (let at = 0; at < blocks.length && !this.stopped; at += MAX_BATCH) await this.call(current, batch.when, blocks.slice(at, at + MAX_BATCH), batch.requestedBy, true);
      });
    }, rule.on!.batchMs);
    timer.unref?.();
    this.batches.set(key, { ruleKey: rule.key, when, blocks: new Map([[blockId, generation]]), requestedBy, timer });
  }

  /** Runs a rule's action once for `blocks` (one, or a batch's, the first acted on), within its daily cap. */
  private async call(rule: RuleEntry, when: "start" | "stop" | "change", blocks: readonly string[], requestedBy: MutationProvenance | undefined, batch = false): Promise<void> {
    const action = rule.on![when]!;
    const blockId = blocks[0]!;
    const at = new Date(this.now).toISOString();
    const cap = rule.on!.cap;
    if (cap !== undefined && this.runsBroken()) {
      this.lastRun.set(rule.key, { at, blockId, when, error: `held: ${this.runsBroken()}, so a capped rule can't count its runs; it runs again once the file can be read and written (remove it to count today from nothing)` });
      return;
    }
    if (cap !== undefined && this.ranToday(rule.key) >= cap) {
      this.lastRun.set(rule.key, { at, blockId, when, error: `capped: it ran ${cap} time${cap === 1 ? "" : "s"} today (its cap is ${cap}/day); ${blocks.length === 1 ? "this block" : `these ${blocks.length} blocks`} didn't set it off, and it runs again tomorrow` });
      return;
    }
    const kept = this.countRun(rule.key);
    if (cap !== undefined && kept !== true) {
      this.lastRun.set(rule.key, { at, blockId, when, error: `held: ${kept}, so a capped rule can't count its runs` });
      return;
    }
    try {
      const result = await this.options.act!({
        extension: action.extension, action: action.action, blockId, ...(requestedBy ? { requestedBy } : {}),
        trigger: { rule: rule.name, ...(batch ? { blocks } : {}) },
      });
      this.lastRun.set(rule.key, { at, blockId, when, ...(batch ? { blocks: blocks.length } : {}), ...(result.message ? { message: result.message } : {}) });
    } catch (error) {
      this.lastRun.set(rule.key, { at, blockId, when, ...(batch ? { blocks: blocks.length } : {}), error: message(error) });
    }
  }

  // ── the daily cap ──────────────────────────────────────────────────────

  private today(): string {
    const date = new Date(this.now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  private counts(): Record<string, number> {
    const day = this.today();
    if (!this.runs) {
      this.runs = { day, counts: {} };
      const file = this.options.runsFile;
      if (file && existsSync(file)) {
        try {
          const read = JSON.parse(readFileSync(file, "utf8")) as { day?: unknown; counts?: unknown };
          if (!read || typeof read !== "object" || typeof read.day !== "string" || !read.counts || typeof read.counts !== "object") throw new Error("not a day and its counts");
          if (read.day === day) this.runs.counts = Object.fromEntries(Object.entries(read.counts).filter(([, n]) => Number.isSafeInteger(n))) as Record<string, number>;
        } catch (error) {
          // A file there that can't be read isn't counted from nothing: a capped rule holds until it can be.
          this.runs = null;
          return {};
        }
      }
    }
    if (this.runs.day !== day) this.runs = { day, counts: {} };
    return this.runs.counts;
  }

  /** Why the runs file can't be used (it's there and can't be read), or nothing. */
  private runsBroken(): string | undefined {
    this.counts();
    return this.runs ? undefined : `${this.options.runsFile} can't be read`;
  }

  private ranToday(ruleKey: string): number {
    return this.counts()[ruleKey] ?? 0;
  }

  /** Counts a run, kept in the runs file: true, or why it couldn't be kept (the count stays as it was). */
  private countRun(ruleKey: string): true | string {
    const counts = this.counts();
    if (!this.runs) return `${this.options.runsFile} can't be read`;
    counts[ruleKey] = (counts[ruleKey] ?? 0) + 1;
    const file = this.options.runsFile;
    if (!file) return true;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ day: this.runs.day, counts }));
      renameSync(`${file}.tmp`, file);
      return true;
    } catch (error) {
      counts[ruleKey] -= 1;
      return `${file} can't be written (${message(error)})`;
    }
  }

  /** Waits for every trigger that is waiting or running to have finished (tests, and a service stopping cleanly). */
  async settle(): Promise<void> {
    while (this.pending.size || this.chains.size || this.batches.size) {
      await Promise.all([...this.chains.values()].map((chain) => chain.catch(() => {})));
      if (this.pending.size || this.batches.size) await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// ── the built-in decorations ─────────────────────────────────────────────────────────────────────────

/**
 * The matched block as a record, for a label's `{{this.…}}`: its title and properties (a rule note's own `rule-*` words
 * aren't the block's), without the links and tasks a label never reads. Only a preview has just the text.
 */
function ruleRecord(block: Block): BlockRecord {
  const text = block.text;
  const properties = parsePropertyRecords(text).filter((property) => !(RULE_KEYS as readonly string[]).includes(property.key));
  return blockRecord({
    block: { id: block.id ?? "", parentId: block.parentId ?? null, text, revision: block.revision ?? 0, author: block.author ?? "user", ...(block.actorId ? { actorId: block.actorId } : {}), createdAt: block.createdAt ?? "1970-01-01T00:00:00.000Z", updatedAt: block.updatedAt ?? "1970-01-01T00:00:00.000Z" },
    title: title(text), properties, literal: scanPropertyLiteralRanges(text), children: [], tasks: [], links: [], backlinks: [], resources: [],
  });
}

/** A built-in decoration's view for one hit: the no-code tier, composed from the same primitives a code rule returns. */
export function builtInView(spec: BuiltInSpec, hit: RuleHit, block: Block): Primitive {
  const record = ruleRecord(block);
  // The matched block is the rule's `this`, and what matched is its `match` (a pattern's capture 1, else 0, is its text).
  const site: Site = {
    at: { block: record.id }, this: record, props: {}, actor: { id: "rule", author: "system" },
    match: {
      text: hit.at === "block" ? record.title : hit.at === "construct" ? hit.text : (hit.captures?.[1] ?? hit.captures?.[0] ?? hit.text),
      ...(hit.level !== undefined ? { level: hit.level } : {}),
      captures: hit.captures ? [...hit.captures] : [],
    },
  };
  // A label naming nothing the block has is empty, as a rule's label always was; a person's text is never refused.
  const words = (fallback: string) => cleanExtensionText(interpolateWith(spec.label ?? fallback, site, {}, { missing: "empty" })).slice(0, 300);
  const tone = spec.tone ? { tone: spec.tone } : {};
  switch (spec.use) {
    case "band": {
      const level = Math.min(3, Math.max(1, hit.kind === "heading" ? hit.level ?? 1 : 1)) as 1 | 2 | 3;
      return validatePrimitive({ type: "band", text: words("{{match.text}}"), level, ...(spec.style ? { style: spec.style } : {}), ...(spec.pattern ? { pattern: spec.pattern } : {}), ...(spec.align ? { align: spec.align } : {}), ...tone });
    }
    case "divider":
      return validatePrimitive({ type: "track", ...(spec.style ? { style: spec.style } : {}), ...(spec.pattern ? { pattern: spec.pattern } : {}), ...tone });
    case "badge":
      return validatePrimitive({ type: "badge", label: words("{{match.text}}"), ...tone });
    case "text":
      return validatePrimitive({ type: "text", text: words("{{match.text}}"), strong: true, ...tone });
    case "box":
      return validatePrimitive({ type: "box", title: words(""), children: [] });
    case "card": {
      const fields = (spec.fields ?? []).map((key) => ({ type: "stat", label: key, value: noteValues(record, key).join(", ") || "—" }));
      return validatePrimitive({ type: "card", title: words("{{this.title}}"), ...(fields.length ? { children: [{ type: "row", children: fields }] } : {}) });
    }
  }
}
