// `site.answer` (PIE-533): what a `{{ }}`, a path an agent asks, a figure's value operand or (later) a template and a
// script read of the note they sit in. The service binds a Site for the request (the note, or the host of a `::use`,
// with its ancestors and parent), reads each placeholder of the note's text through outline-core's one resolver
// (`resolvePath`), and answers values or problems, how each was found (`route`), and the notes the answer was computed
// from (`deps`), which query-watches uses to re-evaluate a watched answer only when one of them changed.
//
// Nothing here walks a note's values: this file supplies the resolver's lookups (`StoreWorld`: another note, the clock,
// the views' matcher) and binds the Site. A reference is looked up by `OutlinerStore.lookupBlockRef`, the same lookup
// `resolveBlockRef` throws from. Reads only.
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { interpolate, interpolationSpans, spanTail, type InterpolationSpan } from "@ep0ch/outline-core/interpolation";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { resolvePath, type PathAnswer, type FilterRow, type NoteLookup, type PathScope, type PathWorld } from "@ep0ch/outline-core/resolve-path";
import { deriveSite, type Site, type SiteAnswer, type SiteAnswerRequest, type SiteLink, type SiteValue } from "@ep0ch/outline-core/site";
import { BlockQueryError, type ValueBinder } from "./block-query";
import { textRecord } from "./block-records";
import { blockDisplayTitle } from "./references";
import type { BlockRefLookup } from "./store";
import { produce, unknowable, type ProducerStore } from "./site-producers";
import { StillCounting, type SiteBudget } from "./site-budget";
import type { Block } from "./types";

/** What the Site read needs of the store. */
export interface SiteStore extends ProducerStore {
  get(id: string): Block | null;
  children(parentId: string | null): Block[];
  lookupBlockRef(ref: string): BlockRefLookup;
  resolveBlockRef(ref: string): Block;
  filterRows(rows: readonly FilterRow[], filter: string, thisId?: string): ReturnType<import("./store").OutlinerStore["filterRows"]>;
}

const MAX_PATHS = 50;

/** The most placeholders one `interpolate` text is read for. */
const MAX_PAGE_PLACEHOLDERS = 200;
const MAX_CHAIN = 8;
const MAX_DEPTH = 64;

/** The resolver's lookups, over the store; it remembers every note it read (the answer's `deps`). */
class StoreWorld implements PathWorld {
  readonly deps = new Set<string>();
  /** Something it looked for isn't there yet (a `[[page]]` to be): any change may fill it, so the answer can't name its deps. */
  unresolved = false;
  private readonly records = new Map<string, BlockRecord>();

  /** The note a filter's `this` stands for; set once the Site is bound. */
  thisId?: string;
  /** How many times a read met a note the reader may not see (a value that did is left out whole). */
  hiddenHits = 0;

  /** The reader may not see every note (the request named `hidden`, even if none yet): what decides an answer is checked, not only what it returns. */
  constructor(private readonly store: SiteStore, private readonly clock: () => number, readonly hidden: ReadonlySet<string> = new Set(), readonly cut = false, private readonly budget?: SiteBudget) {}

  /** One unit of work done: past the request's budget, the answer stops with "still counting" (PIE-1047). */
  spend(what = "this answer"): void {
    if (this.budget && performance.now() > this.budget.deadline) throw new StillCounting(this.budget.ms, what);
  }

  now() { return this.clock(); }

  /** A note as a record: its text's properties, header, fields and checklist. Its children are read only when a path asks (`children`). */
  record(block: Block): BlockRecord {
    this.deps.add(block.id);
    let record = this.records.get(block.id);
    if (!record) this.records.set(block.id, record = textRecord(block));
    return record;
  }

  /** The text a note was read with (the saved one). */
  textOf(id: string): string | undefined { return this.records.get(id)?.text; }

  children(id: string): BlockRecord[] {
    this.deps.add(id);
    // One past the most a path reads, so the resolver can say there are more.
    const kids = this.store.children(id).slice(0, 1001);
    const shown = kids.filter(child => !this.hidden.has(child.id));
    if (shown.length < kids.length) this.hiddenHits += 1;
    return shown.map(child => this.record(child));
  }

  note(ref: string, as: "reference" | "value"): NoteLookup {
    let found: BlockRefLookup;
    try { found = this.store.lookupBlockRef(ref); } catch (error) { return { kind: "missing", message: error instanceof Error ? error.message : String(error), didYouMean: [] }; }
    switch (found.kind) {
      case "found":
        if (this.hidden.has(found.block.id)) { this.hiddenHits += 1; return { kind: "hidden", message: "that note isn't shown here" }; }
        // An id prefix is a link while it names one note; a later note with the same prefix would make it ambiguous.
        if (found.how === "block id prefix") this.unresolved = true;
        return { kind: "found", record: this.record(found.block), how: found.how };
      case "ambiguous": {
        // Every note the prefix starts is a dependency (a page asks whether it may show each), and a reader who may not see
        // one is not told its title: the answer says nothing.
        for (const id of found.ids) this.deps.add(id);
        const seen = found.ids.filter(id => !this.hidden.has(id));
        if (seen.length < found.ids.length) this.hiddenHits += 1;
        const matches = seen.map(id => ({ id, title: blockDisplayTitle(this.store.get(id)!) }));
        if (as === "reference") this.unresolved = true;
        return { kind: "ambiguous", matches, message: `${ref} starts ${found.ids.length} notes: ${matches.map(m => `${m.id.slice(0, 12)} ${m.title}`).join("; ")}; give more of it` };
      }
      case "trashed":
        if (as === "reference") this.unresolved = true;
        return { kind: "missing", message: found.message, didYouMean: [] };
      case "missing":
        if (as === "reference") this.unresolved = true;
        return { kind: "missing", message: found.message, didYouMean: found.didYouMean ? [found.didYouMean] : [] };
    }
  }

  filter(rows: readonly FilterRow[], filter: string) {
    const kept = this.store.filterRows(rows, filter, this.thisId);
    // A filter that reads the rows' children (`child:`) answers from notes the rows don't name: they join the deps, and one the reader may not see makes it say nothing.
    if (kept.ok && unknowable(this.store, this, rows.flatMap(row => row.id && !row.id.includes("^") ? [row.id] : []), filter).size) {
      return { ok: false as const, message: "this filter reads other notes, and some aren't shown here" };
    }
    // A filter that reads other notes (links:, child:, under:…) depends on notes the answer can't name.
    if (kept.ok && kept.open) {
      this.unresolved = true;
      // …so for a reader who may not see some notes, it says nothing: it could answer from one of them.
      if (this.hidden.size) { this.hiddenHits += 1; return { ok: false as const, message: "this filter reads other notes, and some aren't shown here" }; }
    }
    return kept;
  }
}

/** A bound Site: what `resolvePath` reads, and the notes it came from. */
export interface Bound {
  site: Site;
  scope: PathScope;
  world: StoreWorld;
  route: string[];
  deps: Set<string>;
  blockId: string;
  revision: number;
  text: string;
  /** A value a producer's question read depends on the clock alone (`{{now.time}}` in a query). */
  clock?: true;
  /** The unsaved text of the note read, when a draft was given. */
  draft?: { id: string; text: string };
}

const NEW_SITE_ACTOR = { id: "site.answer", author: "system" as const };

export function bind(store: SiteStore, request: SiteAnswerRequest, clock: () => number, budget?: SiteBudget): Bound {
  // Figures and extension argument templates can be asked outside a note: props are available, but no `this`.
  const noteless = !!request && typeof request === "object" && request.blockId === undefined && ((request.produce?.kind === "figure" || request.produce?.kind === "view") || request.interpolate !== undefined);
  if (!noteless && (!request || typeof request !== "object" || typeof request.blockId !== "string" || !request.blockId!.trim())) {
    throw new Error("site.answer needs blockId: the note to read (an id, ((id)), a Work ID or a [[page]]); for example { blockId: \"PIE-12\", paths: [\"this.owner\"] }");
  }
  const given = request.chain ?? [];
  if (!Array.isArray(given) || given.length > MAX_CHAIN) throw new Error(`chain is the invocations that draw this note, outermost first (at most ${MAX_CHAIN}): [{ kind: "use", block: "<host id>", line: 3 }]`);
  // A link's note may be named as a person would (a prefix, a Work ID, a [[page]]).
  const chain: SiteLink[] = given.map((link, i) => {
    if (!link || typeof link !== "object" || !["use", "embed", "box"].includes(link.kind) || typeof link.block !== "string") {
      throw new Error(`chain[${i}] is { kind: "use" | "embed" | "box", block: "<the note the invocation is written in>", line?: number }`);
    }
    const block = store.get(link.block) ?? (() => { try { return store.resolveBlockRef(link.block); } catch { return null; } })();
    if (!block) throw new Error(`chain[${i}].block ${link.block} is no note; it is the note the invocation is written in`);
    return { ...link, block: block.id };
  });
  if (request.draft !== undefined && (!request.draft || typeof request.draft.text !== "string")) throw new Error("draft is { text: \"<the note's unsaved text>\" }");
  if (request.paths !== undefined && (!Array.isArray(request.paths) || request.paths.length > MAX_PATHS || request.paths.some(p => typeof p !== "string"))) {
    throw new Error(`paths is a list of at most ${MAX_PATHS} strings, such as "this.owner" or "this.tasks | status=todo"`);
  }
  const props: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(request.props ?? {})) {
    if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw new Error(`props.${key} is a list of strings`);
    props[key] = value;
  }

  const hidden = new Set<string>();
  if (request.hidden !== undefined) {
    if (!Array.isArray(request.hidden) || request.hidden.some(id => typeof id !== "string")) throw new Error("hidden is a list of note ids the reader may not see");
    for (const id of request.hidden) hidden.add(id);
  }
  const refused = (id: string, what: string) => { if (hidden.has(id)) throw new Error(`((${id})) is ${what} the reader may not see; it supplies no values`); };

  if (noteless) {
    const world = new StoreWorld(store, clock, hidden, request.hidden !== undefined, budget);
    // Extension argument templates have only their supplied props; figures still query the outline.
    const scope: PathScope = { ancestors: [], ...(request.interpolate === undefined ? { world } : {}) };
    return { site: { at: { block: "" }, props, actor: NEW_SITE_ACTOR }, scope, world, route: ["no note: this request is outside any note, so `this` is unavailable"], deps: new Set(), blockId: "", revision: 0, text: "" };
  }
  const route: string[] = [];
  const target = store.resolveBlockRef(request.blockId!);
  const exact = target.id === request.blockId!.trim().toLowerCase();
  const text = request.draft?.text ?? target.text;
  if (hidden.has(target.id)) throw new Error(`((${target.id})) is a note the reader may not see; it has no values to read`);
  const world = new StoreWorld(store, clock, hidden, request.hidden !== undefined, budget);
  const deps = new Set<string>([target.id]);

  // The note read: its saved text, or the draft being typed (the record is built from that text, so values agree with the screen).
  const recordOf = (block: Block, draft?: string) => draft === undefined ? world.record(block) : (deps.add(block.id), textRecord({ ...block, text: draft }));
  route.push(`note ((${target.id.slice(0, 8)}))${exact ? "" : ` (from \`${request.blockId!.trim()}\`)`}: read from ${request.draft ? "the draft text" : `the saved text, revision ${target.revision}`}`);

  let site: Site;
  let line = request.line;
  if (!chain.length) {
    site = { at: { block: target.id }, this: recordOf(target, request.draft?.text), props, actor: NEW_SITE_ACTOR };
  } else {
    for (const link of chain) refused(link.block, "a note the chain is written in, which");
    const hostBlock = store.get(chain[0]!.block)!;
    site = { at: { block: hostBlock.id }, this: world.record(hostBlock), props: {}, actor: NEW_SITE_ACTOR };
    route.push(`chain starts in ((${hostBlock.id.slice(0, 8)}))`);
    for (const [k, link] of chain.entries()) {
      const next = k + 1 < chain.length ? chain[k + 1]!.block : target.id;
      const child = store.get(next);
      if (!child) throw new Error(`chain[${k}] names ((${next})), which is no note`);
      site = deriveSite(site, link, next === target.id ? recordOf(child, request.draft?.text) : world.record(child));
      route.push(`${link.kind} in ((${link.block.slice(0, 8)}))${link.line !== undefined ? ` line ${link.line}` : ""} → ${link.kind === "use" ? `this stays the host ((${site.this?.id.slice(0, 8)})), self is ((${next.slice(0, 8)}))` : link.kind === "embed" ? `a fresh Site: this is ((${next.slice(0, 8)}))` : "the Site passes through"}`);
      if (link.kind === "use" && link.line !== undefined) line = link.line;
    }
    site = { ...site, props };
  }
  if (request.self !== undefined) {
    const own = typeof request.self === "string" ? store.get(request.self) ?? (() => { try { return store.resolveBlockRef(request.self!); } catch { return null; } })() : null;
    if (!own) throw new Error(`self is the note that defines the producer (a script's note); ${String(request.self)} is no note`);
    refused(own.id, "the note that defines the producer, which");
    site = { ...site, self: world.record(own) };
    route.push(`self is ((${own.id.slice(0, 8)}))`);
  }
  if (request.caller !== undefined) {
    if (!request.caller || typeof request.caller !== "object" || typeof request.caller.block !== "string") throw new Error("caller is where the producer was invoked: { block: \"<id>\", line?: number }");
    site = { ...site, caller: request.caller };
    route.push(`caller is ((${request.caller.block.slice(0, 8)}))`);
  }

  // Its place in the outline: ancestors (the scope walk's), and the parent as a record.
  const here = site.this!;
  world.thisId = here.id;
  const ancestors: { id: string; text: string }[] = [];
  let parentBlock: Block | undefined;
  const parentHidden = !!here.parent && hidden.has(here.parent);
  for (let at = here.parent, depth = 0; at && depth < MAX_DEPTH; depth += 1) {
    const block = store.get(at);
    // Nothing above a note the reader may not see supplies a value: the walk stops there.
    if (!block || hidden.has(block.id)) break;
    deps.add(block.id);
    ancestors.push({ id: block.id, text: block.text });
    if (depth === 0) parentBlock = block;
    at = block.parentId;
  }
  const scope: PathScope = { ...(line !== undefined ? { line } : {}), ancestors, ...(parentBlock ? { parent: () => world.record(parentBlock!) } : parentHidden ? { parent: () => { world.hiddenHits += 1; return undefined; } } : {}), world };
  return { site, scope, world, route, deps, blockId: target.id, revision: target.revision, text, ...(request.draft ? { draft: { id: target.id, text } } : {}) };
}

export function valueOf(bound: Bound, expression: string, parsed: ReturnType<typeof interpolationSpans>[number], start?: number, end?: number): SiteValue {
  bound.world.spend(`reading {{${parsed.path}}}`);
  const hitsBefore = bound.world.hiddenHits;
  const read = valueRead(bound, expression, parsed, start, end);
  // A read that met a note the reader may not see says nothing of it: no value, not even a partial list.
  if (bound.world.hiddenHits === hitsBefore) return read;
  const { values: _values, links: _links, from: _from, lines: _lines, marks: _marks, usedDefault: _used, ...rest } = read;
  return { ...rest, hidden: true, problem: { message: "this reads a note that isn't shown here", didYouMean: [] } };
}

function valueRead(bound: Bound, expression: string, parsed: ReturnType<typeof interpolationSpans>[number], start?: number, end?: number): SiteValue {
  const answer = parsed.parsed
    ? resolvePath(parsed.parsed, bound.site, bound.scope, spanTail(parsed))
    : { ok: false as const, problem: { message: `\`${parsed.path}\` isn't a path: write head.key, such as this.owner`, didYouMean: [], example: "{{this.owner}}" }, route: [] };
  const base = { ...(start !== undefined ? { start, end } : {}), expression, path: parsed.path, ...(parsed.parsed ? { head: parsed.parsed.head } : {}) };
  if (answer.ok) {
    const empty = answer.values.length === 0 && parsed.default !== undefined;
    const source = parsed.parsed ? sourceOfValue(bound, parsed.parsed, answer) : undefined;
    return {
      ...base, values: empty ? [parsed.default!] : answer.values, ...(empty ? { usedDefault: true as const } : {}),
      ...(answer.lines ? { lines: answer.lines } : {}), ...(answer.marks ? { marks: answer.marks } : {}), ...(answer.offsets ? { offsets: answer.offsets } : {}),
      ...(answer.from ? { from: answer.from } : {}), ...(source ? { source } : {}), ...(answer.links ? { links: answer.links } : {}), ...(answer.clock ? { clock: answer.clock } : {}),
      route: empty ? [...answer.route, `no value: the \`|| ${parsed.default}\` default`] : answer.route,
    };
  }
  if (parsed.default !== undefined) {
    return { ...base, values: [parsed.default], usedDefault: true, problem: answer.problem, route: [...answer.route, `\`|| ${parsed.default}\` default used`] };
  }
  return { ...base, problem: answer.problem, route: answer.route };
}

/**
 * Where a value is written, for a reader that opens its source line: the property the path ends in (`this.owner`, a bare
 * `owner`, `person.firstName`), its first record in the note the value was read from. Absent for a computed value
 * (`now.date`, `this.title`, a filter's count) and for one the note doesn't write as a property.
 */
function sourceOfValue(bound: Bound, parsed: NonNullable<ReturnType<typeof interpolationSpans>[number]["parsed"]>, answer: Extract<ReturnType<typeof resolvePath>, { ok: true }>): SiteValue["source"] {
  if (!answer.from || answer.lines) return undefined;
  const last = parsed.steps.at(-1);
  const key = (last ? ("key" in last ? last.key : undefined) : parsed.head)?.toLowerCase();
  const text = answer.from === bound.blockId ? bound.text : bound.world.textOf(answer.from);
  if (!key || text === undefined) return undefined;
  const record = parsePropertyRecords(text).find(r => r.key === key && r.syntax !== "hashtag");
  if (!record) return undefined;
  return { block: answer.from, start: record.start, line: record.line, mark: text.slice(record.start, record.end) };
}

/** A path as asked (`this.tasks | status=todo .count`), read as a span would be. */
export function pathSpan(path: string) {
  const span = interpolationSpans(`{{${path}}}`, { fences: "template" })[0];
  if (!span) throw new Error(`\`${path}\` isn't a path: write head.key, such as this.owner or this.tasks | status=todo`);
  return span;
}

const MAX_INTERPOLATE = 64 * 1024;

/** `request.interpolate`: the text's `{{ }}` read in the bound Site, and the text with each value in place (an unanswered one as written). */
function fill(bound: Bound, ask: NonNullable<SiteAnswerRequest["interpolate"]>): NonNullable<SiteAnswer["interpolated"]> {
  if (!ask || typeof ask !== "object" || typeof ask.text !== "string" || ask.text.length > MAX_INTERPOLATE || (ask.fences !== undefined && ask.fences !== "literal" && ask.fences !== "template")) {
    throw new Error(`interpolate is { text: "<text with {{ }}>", fences?: "template" } of at most ${MAX_INTERPOLATE} characters`);
  }
  const spans = interpolationSpans(ask.text, { fences: ask.fences ?? "literal" });
  // Never read some and leave the rest unchecked: a caller that runs the filled text (a command) must know every placeholder was.
  if (spans.length > MAX_PAGE_PLACEHOLDERS) throw new Error(`interpolate reads at most ${MAX_PAGE_PLACEHOLDERS} placeholders; this text has ${spans.length}`);
  const values = spans.map(span => valueOf(bound, span.expression, span, span.start, span.end));
  const answered = new Map<number, SiteValue>(values.map((value, i) => [spans[i]!.start, value]));
  return { text: interpolate(ask.text, span => { const v = answered.get(span.start); return v && v.values && !v.hidden ? v.values : undefined; }, { fences: ask.fences ?? "literal" }), values };
}

// Backlink reads can ask for the address currently being evaluated.
const answeringSites = new WeakMap<SiteStore, Set<string>>();

/**
 * `site.answer`: every `{{ }}` of the note (or its draft), and any `paths` asked, answered with how and from what. With a
 * `budget` (the service's own requests), past it the answer throws `StillCounting` instead of holding the loop.
 */
export function answerSite(store: SiteStore, request: SiteAnswerRequest, clock: () => number = Date.now, budget?: SiteBudget): SiteAnswer {
  const active = answeringSites.get(store) ?? new Set<string>();
  const id = request.blockId ?? "";
  if (active.has(id)) throw new Error("value link cycle: this address reads its own backlinks");
  answeringSites.set(store, active);
  active.add(id);
  try {
    const bound = bind(store, request, clock, budget);
    // A producer's question (a figure, `::fields`, `::if`): asked of the bound Site, so `this` and its `{{ }}` operands are its host's.
    if (request.produce && request.draft && request.produce.kind !== "fields" && request.produce.kind !== "if") bound.route.push("draft not read: this producer asks the saved note and the outline (a draft is read for `{{ }}` values, ::fields and ::if)");
    const produced = request.produce ? produce(store, bound, request.produce, { read: path => valueOf(bound, path, pathSpan(path)), binder: boundBinder(bound), spend: what => bound.world.spend(what) }) : undefined;
    // With a producer asking, only its question is answered: the note's own `{{ }}` are the client's other watch.
    const values = request.produce ? [] : interpolationSpans(bound.text).map(span => valueOf(bound, span.expression, span, span.start, span.end));
    const paths = (request.paths ?? []).map(path => valueOf(bound, path, pathSpan(path)));
    const interpolated = request.interpolate ? fill(bound, request.interpolate) : undefined;
    for (const id of bound.world.deps) bound.deps.add(id);
    const { site } = bound;
    return {
      blockId: bound.blockId,
      revision: bound.revision,
      site: { ...(site.this ? { this: site.this.id } : {}), ...(site.self ? { self: site.self.id } : {}), ...(site.caller ? { caller: site.caller } : {}), props: site.props },
      values,
      ...(request.paths ? { paths } : {}),
      ...(interpolated ? { interpolated } : {}),
      ...(produced ? { produced: produced.answer } : {}),
      route: bound.route,
      deps: [...bound.deps].sort(),
      // A question about the outline at large (a figure's query, an `::if` over links:) depends on notes the answer can't name.
      ...(bound.world.unresolved || produced?.anyChange ? { anyChange: true as const } : {}),
      ...([...values, ...paths, ...(interpolated?.values ?? [])].some(v => v.clock) || bound.clock ? { clock: "minute" as const } : {}),
      problems: [...values, ...paths, ...(interpolated?.values ?? [])].filter(v => v.problem && !v.usedDefault).length,
    };
  } finally {
    active.delete(id);
  }
}

/**
 * What a `{{path}}` operand of a question reads, in the Site already bound for it (the figure's host, its props): the
 * path's values, or a corrective error, never an empty list for a typo.
 */
export function boundBinder(bound: Bound): ValueBinder {
  return path => {
    const read = valueOf(bound, path, pathSpan(path));
    if (read.clock) bound.clock = true;
    if (read.problem) {
      const hint = read.problem.example ? ` (for example ${read.problem.example})` : "";
      throw new BlockQueryError(`{{${path}}} in a query: ${read.problem.message}${hint}`);
    }
    return read.values ?? [];
  };
}

/**
 * The values of one Site path for the note `thisId`, for a question's value operand (`project={{this.project}}`). A path
 * with no answer throws a corrective error, never an empty list: a typo can't silently match nothing.
 */
export function pathValues(store: SiteStore, thisId: string, path: string, clock: () => number = Date.now): string[] {
  return boundBinder(bind(store, { blockId: thisId }, clock))(path);
}

/**
 * A reader of `{{ }}` for a producer that has no host note (a stamp, PIE-533 S4): `self` the template, `props` the call's,
 * and the clock (`now`); another note by a reference. The same resolver and lookups `site.answer` uses, so a stamp's
 * `{{props.for.title}}` and a live `{{props.for.title}}` read the same. A span with no path answers a problem.
 */
export function siteReader(store: SiteStore, parts: { self?: Block; props: Record<string, string[]> }, clock: () => number = Date.now): (span: InterpolationSpan) => PathAnswer {
  const world = new StoreWorld(store, clock);
  const site: Site = { at: { block: parts.self?.id ?? "" }, ...(parts.self ? { self: world.record(parts.self) } : {}), props: parts.props, actor: { id: "template.stamp", author: "system" } };
  const scope: PathScope = { ancestors: [], world };
  return span => span.parsed
    ? resolvePath(span.parsed, site, scope, spanTail(span))
    : { ok: false, problem: { message: `\`${span.path}\` isn't a path: write head.key, such as props.owner`, didYouMean: [], example: "{{props.owner}}" }, route: [] };
}
