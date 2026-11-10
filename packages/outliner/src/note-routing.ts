// The note mover (PIE-1010, named PIE-1314): notes move themselves by rules written as notes, a core extension of the
// service like Obsidian's Auto Note Mover: a rule is a block `[note-mover::((id))] [query::<the views' grammar>]`, with
// an optional `[note-mover-when::create|edit|command]` (default create), `[note-mover-order::N]` and
// `[note-mover-at::top|end]`. A rule under the old names (`[type::route] [route-to::((id))]`, `route-*`) still works
// (outline-core's note-mover-rename.ts, which also says so on a save). First match wins: by order, then the Note mover
// view's hand order, then when the rule was written. The service owns the whole of
// it: the match is the store's one query matcher (`matchQuery`, `matchesText`: never a second one), the move is the
// one atomic move (note-move.ts, the rule `outline_move` runs), attributed `author: agent` `actorId: ext:note-mover` with
// who asked as `requestedBy`, and the Note mover view (`Note mover [page::note-mover] [system-view::note-mover]`, a saved view over
// the rules, one of the outline's own like Bookmarks) is seeded once so every rule is listed, editable and reorderable. Everything here is deletable: remove
// this file and its three hooks (placement, the change feed, `notes.route`) and nothing else in the service changes.
//
// When a note routes on its own: at `notes.create`, as the first placement rule (a note made with its text, a quick
// capture); on the change feed once a note has been quiet (a bare `create` with text, and a new note's first words: the
// person's ctrl+n makes an empty note first, so its first save is its creation to a rule); on every later save for an
// `edit` rule; never for a `command` rule, which waits for `ep0ch route` or the door's `note.route`, when every rule
// counts. A note a door holds a draft of is never moved under the person: it waits, and routes when the draft closes.
// Its own writes (the move, the history) set nothing off, and a rule written over notes that already match moves none
// of them until asked. The seam for PIE-1011 (a seeded rule that files snapshot records under `.system`): `SEEDED_RULES`.
import { noteWork } from "./loop-watch";
import type { NoteRouteResult, NoteRouteRun } from "@ep0ch/outline-core/protocol";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { NOTE_MOVER, NOTE_MOVER_HISTORY, NOTE_MOVER_VIEW_WORDS, OLD_HISTORY_TYPE, OLD_RULE_TYPE } from "@ep0ch/outline-core/note-mover-rename";
import { ruleWriter } from "@ep0ch/outline-core/rules";
import { moveNote } from "./note-move";
import { isSystemNote, systemNoteKind, type Placement } from "./note-placement";
import { blockDisplayTitle } from "./references";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance } from "./types";
import { getProperty } from "./properties";

/** The actor every routing write carries: the service's own, as an extension's. */
export const ROUTE_ACTOR = "ext:note-mover";
export const ROUTE_WHENS = ["create", "edit", "command"] as const;
export type RouteWhen = (typeof ROUTE_WHENS)[number];
/** The most history lines a rule keeps (newest first). */
export const HISTORY_LINES = 50;
const DEFAULT_QUIET_MS = 2_000;
const MAX_FRESH = 2_000;
/** Where the Note mover view is remembered once seeded (the outline's metadata), so a trashed one isn't given again. */
const HUB_METADATA = "routing.hub";
export const HUB_PAGE = NOTE_MOVER;
/** What lists every rule: the new name, and an old rule still waiting to be rewritten. */
const RULES_QUERY = `${NOTE_MOVER} OR type=${OLD_RULE_TYPE}`;

/** Rules the service seeds into the Note mover view when they're missing (PIE-1011 adds the snapshot-records rule here). */
export const SEEDED_RULES: readonly { key: string; text: (reads: { store: OutlinerStore }) => string | null }[] = [];

/** One rule note, as the engine reads it. */
export interface RouteRule {
  id: string;
  title: string;
  query: string;
  /** The target as written: inbox, root, an id, ((id)), [[page]] or a Work ID. */
  to: string;
  when: RouteWhen;
  order?: number;
  at: "top" | "end";
  createdAt: string;
}

export interface NoteRoutingOptions {
  readonly now?: () => number;
  /** How long a note must be still before it routes (every save in a burst is one). */
  readonly quietMs?: number;
  /** Whether a door holds a live draft of the note (the server's draft holds): a held note waits. */
  readonly held?: (blockId: string) => boolean;
}

type Target = { ok: true; id: string | null; title: string } | { ok: false; problem: string };

const title = (block: Block) => blockDisplayTitle(block).slice(0, 60).replace(/\s+/g, " ").trim() || "untitled";
const quoted = (s: string) => `“${s}”`;
/** A ((id|label)) with a label that can't break the reference. */
const ref = (block: Block) => `((${block.id}|${title(block).replace(/[|()]/g, " ").trim()}))`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const typeOf = (block: Block) => getProperty(block.properties, "type")?.trim().toLowerCase();
const isRuleNote = (block: Block) => typeOf(block) === OLD_RULE_TYPE || block.properties.some(p => p.key === NOTE_MOVER);

export class NoteRouting {
  /**
   * The rules as last read, and what they were read from (PIE-1413): the rule notes and their ancestors, the Note mover
   * view and its hand order, and the notes they send to. Asked on every new note and every settle, so a write elsewhere
   * (an import's thousands) never reads them again.
   */
  private cache: { sequence: number; stamp: string; unresolved: boolean; targets: string[]; rules: RouteRule[]; problems: string[] } | null = null;

  private stamp(targets: readonly string[]): string {
    const hub = this.hub();
    const also = hub ? [hub.id, ...targets] : targets;
    return `${hub?.id ?? ""}\0${this.store.propertyDependencyStamp(NOTE_MOVER, undefined, also, hub?.id)}\0${this.store.propertyDependencyStamp("type", OLD_RULE_TYPE)}`;
  }
  private readonly timers = new Map<string, { when: RouteWhen; timer: ReturnType<typeof setTimeout> }>();
  /** Notes made empty (the person's ctrl+n): their first words are their creation to a rule. */
  private readonly fresh = new Set<string>();
  /** Notes that were quiet while a door held their draft: routed when the draft closes. */
  private readonly parked = new Map<string, RouteWhen>();
  private stopped = false;

  constructor(private readonly store: OutlinerStore, private readonly options: NoteRoutingOptions = {}) {}

  private get now(): number { return (this.options.now ?? Date.now)(); }

  // ── the rules ──────────────────────────────────────────────────────────

  /** Every rule note now, in the order they're tried, and the rule notes that can't be used (and why). */
  rules(): { rules: RouteRule[]; problems: string[] } {
    const sequence = this.store.sequence;
    if (this.cache?.sequence === sequence) return this.cache;
    // Written since: still the same rules unless what they were read from changed (and none named a missing note).
    if (this.cache && !this.cache.unresolved && this.cache.stamp === this.stamp(this.cache.targets)) {
      this.cache.sequence = sequence;
      return this.cache;
    }
    const problems: string[] = [];
    const targets: string[] = [];
    // A rule whose target names nothing yet may start working with any note written: read again after every write.
    let unresolved = false;
    const read = (filter: { key: string; value?: string }) => this.store.queryBlocks({ filters: [filter], limit: 500, machinery: "show" }).blocks;
    const declared = [...new Map([...read({ key: NOTE_MOVER }), ...read({ key: "type", value: OLD_RULE_TYPE })].map(block => [block.id, block])).values()];
    if (declared.length >= 500) problems.push("more than 500 notes declare note mover rules: the first 500 are used");
    const hubOrder = this.hubOrder();
    const rules: RouteRule[] = [];
    for (const block of declared) {
      if (block.effectiveDeletedRootId) continue;
      const props = parsePropertyRecords(block.text).filter(p => p.scope === "block");
      const value = (key: string) => getProperty(props, key)?.trim();
      const where = `rule ${block.id.slice(0, 8)} ${quoted(title(block))}`;
      const named = (now: string, old: string) => value(now) ?? value(old);
      const query = value("query"), to = named(NOTE_MOVER, "route-to"), when = (named("note-mover-when", "route-when") ?? "create").toLowerCase(), at = (named("note-mover-at", "route-at") ?? "top").toLowerCase();
      const order = named("note-mover-order", "route-order");
      if (!query) { problems.push(`${where}: no [query::…]: say which notes it routes, in the saved views' grammar (type=recipe)`); continue; }
      if (!to) { problems.push(`${where}: no [note-mover::((id))]: say where they go (a note's ((id)), [[page]], Work ID, inbox or root)`); continue; }
      if (!(ROUTE_WHENS as readonly string[]).includes(when)) { problems.push(`${where}: [note-mover-when::${when}] isn't one of ${ROUTE_WHENS.join(", ")}`); continue; }
      if (at !== "top" && at !== "end") { problems.push(`${where}: [note-mover-at::${at}] is top or end`); continue; }
      try { this.store.matchQuery(query, []); } catch (error) { problems.push(`${where}: its query doesn't parse: ${message(error)}`); continue; }
      const target = this.target(to);
      if (target.ok && target.id) targets.push(target.id);
      if (!target.ok) { problems.push(`${where}: ${target.problem}`); unresolved = true; continue; }
      const parsedOrder = order === undefined ? undefined : Number(order);
      if (order !== undefined && !Number.isFinite(parsedOrder)) { problems.push(`${where}: [note-mover-order::${order}] isn't a number`); continue; }
      rules.push({ id: block.id, title: title(block), query, to, when: when as RouteWhen, at, createdAt: block.createdAt, ...(parsedOrder !== undefined ? { order: parsedOrder } : {}) });
    }
    const rank = (rule: RouteRule) => hubOrder.get(rule.id) ?? Number.MAX_SAFE_INTEGER;
    rules.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    this.cache = { sequence, stamp: unresolved ? "" : this.stamp(targets), unresolved, targets, rules, problems };
    return this.cache;
  }

  /** The Note mover view's hand order, when it's there: a rule's place in it, from 0. */
  private hubOrder(): Map<string, number> {
    const hub = this.hub();
    if (!hub) return new Map();
    try {
      return new Map(this.store.virtualBranchOrder(hub.id).blockIds.map((id, i) => [id, i] as const));
    } catch {
      return new Map();
    }
  }

  /** Where a rule sends notes: resolved now (a target that moved, went to Trash or became a system note is a problem). */
  private target(to: string): Target {
    const word = to.trim().toLowerCase();
    if (word === "root") return { ok: true, id: null, title: "the top level" };
    if (word === "inbox") {
      const inbox = this.store.queryBlocks({ filters: [{ key: "system-view", value: "inbox" }], limit: 1 }).blocks[0];
      return inbox ? { ok: true, id: inbox.id, title: title(inbox) } : { ok: false, problem: "this outline has no Inbox to route to" };
    }
    const found = this.store.lookupBlockRef(to, NOTE_MOVER);
    if (found.kind === "trashed") return { ok: false, problem: `[note-mover::${to}] is in Trash: restore it or name another note` };
    if (found.kind !== "found") return { ok: false, problem: `[note-mover::${to}] doesn't name a note: ${found.message}` };
    if (isSystemNote(found.block) && !found.block.properties.some(p => p.key === "system-view" && p.value.toLowerCase() === "inbox")) {
      return { ok: false, problem: `[note-mover::${to}] is ${systemNoteKind(found.block)}, which the service fills itself: name a note of the outline's, the Inbox or root` };
    }
    return { ok: true, id: found.block.id, title: title(found.block) };
  }

  /** Which rules an event consults: a creation tries the create and edit rules, a save the edit rules, a command every rule. */
  private forWhen(rules: readonly RouteRule[], when: RouteWhen | "command"): RouteRule[] {
    if (when === "command") return [...rules];
    if (when === "create") return rules.filter(rule => rule.when !== "command");
    return rules.filter(rule => rule.when === "edit");
  }

  /** A note routing may move: live, not a system note, not a rule or a rule's history. */
  private candidate(block: Block | null | undefined): boolean {
    if (!block || block.effectiveDeletedRootId || isSystemNote(block)) return false;
    const type = typeOf(block);
    return !isRuleNote(block) && type !== NOTE_MOVER_HISTORY && type !== OLD_HISTORY_TYPE;
  }

  // ── placing a new note ─────────────────────────────────────────────────

  /**
   * Where a note with this text goes, by the first rule whose query holds for its words and properties alone (a clause
   * about other notes, `links:` or `under:`, can't hold for a note that isn't anywhere yet: the create event catches it).
   */
  place(text: string): Placement | null {
    if (!text.trim()) return null;
    const { rules } = this.rules();
    for (const rule of this.forWhen(rules, "create")) {
      if (this.store.matchesText(rule.query, text) !== true) continue;
      const target = this.target(rule.to);
      if (!target.ok || target.id === null) continue;
      return { parentId: target.id, at: rule.at, rule: "route", said: `in ${quoted(target.title)} (routed by ${quoted(rule.title)})`, routeRule: { id: rule.id, title: rule.title } };
    }
    return null;
  }

  // ── routing a note ─────────────────────────────────────────────────────

  /** The first rule, among `rules`, whose query holds for the block. */
  private firstMatch(block: Block, rules: readonly RouteRule[]): RouteRule | null {
    for (const rule of rules) {
      try {
        if (this.store.matchQuery(rule.query, [block.id]).blockIds.length) return rule;
      } catch { /* listed as a problem by rules() */ }
    }
    return null;
  }

  /** What routing does, or would do, with one note by `rule` (none: the first that holds for it). */
  private apply(block: Block, rule: RouteRule | null, how: { dryRun?: boolean; requestedBy?: MutationProvenance; when: RouteWhen }): NoteRouteResult {
    const from = block.parentId ? this.store.get(block.parentId) : null;
    const base = { blockId: block.id, title: title(block), from: { id: block.parentId, title: from ? title(from) : "the top level" } };
    if (!rule) return { ...base, outcome: "no-rule", said: `no note mover rule holds for ${quoted(base.title)}` };
    const named = { rule: { id: rule.id, title: rule.title, query: rule.query } };
    const target = this.target(rule.to);
    if (!target.ok) return { ...base, ...named, outcome: "refused", said: `${quoted(base.title)} matches ${quoted(rule.title)}, but ${target.problem}` };
    const to = { id: target.id ?? "", title: target.title };
    const by = ` (rule ${quoted(rule.title)})`;
    if (block.parentId === target.id) return { ...base, ...named, to, outcome: "unchanged", said: `${quoted(base.title)} is already in ${quoted(target.title)}${by}` };
    if (this.options.held?.(block.id)) {
      // Asked while a door holds its draft: it routes when the draft closes, by the rules asked for now (a command's: every rule).
      if (!how.dryRun) this.park(block.id, how.when);
      return { ...base, ...named, to, outcome: "held", said: `${quoted(base.title)} is being written in a door: it routes to ${quoted(target.title)} when the draft closes${by}` };
    }
    if (how.dryRun) return { ...base, ...named, to, outcome: "would-move", said: `would move ${quoted(base.title)} from ${quoted(base.from.title)} to ${quoted(target.title)}${by}` };
    const actor: MutationProvenance = { author: "agent", actorId: ROUTE_ACTOR, taskId: `route:${rule.id}` };
    const attribution = this.store.changes.attribution({ action: "notes.route", actor, ...(how.requestedBy ? { requestedBy: how.requestedBy } : {}) });
    try {
      // The move and its history line land together or not at all.
      return this.store.changes.run(attribution, () => this.store.inTransaction(() => {
        const moved = moveNote(this.store, block.id, { to: target.id === null ? "root" : target.id, ...(rule.at === "top" ? { position: 0 } : {}) }, block.revision, actor);
        this.remember(rule, block, from, target, actor);
        return {
          ...base, ...named, to, outcome: "moved" as const, previousPosition: moved.previousPosition, position: moved.position, revision: moved.revision,
          said: `moved ${quoted(base.title)} from ${quoted(base.from.title)} to ${quoted(target.title)}${by}`,
        };
      }));
    } catch (error) {
      return { ...base, ...named, to, outcome: "refused", said: `couldn't move ${quoted(base.title)} to ${quoted(target.title)}${by}: ${message(error)}` };
    }
  }

  /** Append a line to the rule's history (a child `[type::note-mover-history]`, newest first, HISTORY_LINES at most). */
  private remember(rule: RouteRule, block: Block, from: Block | null, target: { title: string; id: string | null }, actor: MutationProvenance): void {
    const stamp = new Date(this.now).toISOString().slice(0, 16).replace("T", " ") + "Z";
    const toRef = target.id ? ref(this.store.get(target.id)!) : "the top level";
    const line = `- ${stamp} ${ref(block)} from ${from ? ref(from) : "the top level"} to ${toRef}`;
    const existing = this.store.children(rule.id).find(child => typeOf(child) === NOTE_MOVER_HISTORY || typeOf(child) === OLD_HISTORY_TYPE);
    const head = `Moves [type::${NOTE_MOVER_HISTORY}] [machine::${NOTE_MOVER}]`;
    if (!existing) {
      this.store.create(`${head}\n\n${line}`, rule.id, "agent", { actorId: ROUTE_ACTOR, taskId: actor.taskId });
      return;
    }
    const lines = existing.text.split("\n").filter(l => l.startsWith("- "));
    const text = `${head}\n\n${[line, ...lines].slice(0, HISTORY_LINES).join("\n")}`;
    this.store.update(existing.id, text, existing.revision, actor);
  }

  /** `notes.route`: one note (`ref`) or every note (`all`), moved or, with `dryRun`, said. */
  run(input: { ref?: string; all?: boolean; dryRun?: boolean; requestedBy?: MutationProvenance }): NoteRouteRun {
    const { rules, problems } = this.rules();
    const how = { dryRun: input.dryRun === true, when: "command" as const, ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}) };
    const results: NoteRouteResult[] = [];
    let unmatched = 0;
    if (input.ref) {
      const block: Block = this.store.resolveBlockRef(input.ref, "note");
      if (!this.candidate(block)) {
        const why = block.effectiveDeletedRootId ? "it's in Trash" : isSystemNote(block) ? `it's ${systemNoteKind(block)}` : isRuleNote(block) ? "it's a note mover rule" : "it's a rule's history";
        results.push({ blockId: block.id, title: title(block), from: { id: block.parentId, title: "" }, outcome: "refused", said: `${quoted(title(block))} isn't routed: ${why}` });
      } else results.push(this.apply(block, this.firstMatch(block, rules), how));
    } else if (input.all) {
      const candidates = this.store.liveBlocks().filter(block => this.candidate(block));
      let remaining = candidates.map(block => block.id);
      const assigned = new Map<string, RouteRule>();
      for (const rule of rules) {
        if (!remaining.length) break;
        const matched = new Set<string>();
        for (let at = 0; at < remaining.length; at += 1000) {
          try { for (const id of this.store.matchQuery(rule.query, remaining.slice(at, at + 1000)).blockIds) matched.add(id); } catch { /* listed */ }
        }
        for (const id of matched) assigned.set(id, rule);
        remaining = remaining.filter(id => !matched.has(id));
      }
      unmatched = remaining.length;
      for (const block of candidates) {
        const rule = assigned.get(block.id);
        if (!rule) continue;
        const fresh = this.store.get(block.id);
        if (!fresh || !this.candidate(fresh)) continue;
        results.push(this.apply(fresh, rule, how));
      }
    } else throw new Error("Say which note to route (ref: an id, ((id)), [[page]] or Work ID) or all: true for every note; dryRun: true says what would move");
    return { dryRun: how.dryRun, results, problems, rules: rules.length, unmatched };
  }

  // ── the change feed ────────────────────────────────────────────────────

  /**
   * A block was created or saved by `actor`. A person's or an agent's save (never an extension's, never routing's own)
   * arms a quiet wait; when it ends, the note routes (a bare creation and a new note's first words by the create rules,
   * a later save by the edit rules), or waits for the door holding its draft to close.
   */
  blockChanged(blockId: string, actor: MutationProvenance | undefined, kind: "create" | "edit"): void {
    if (this.stopped) return;
    const block = this.store.get(blockId);
    if (!block || block.effectiveDeletedRootId) { this.forget(blockId); return; }
    const writer = ruleWriter(actor);
    if (writer !== "user" && writer !== "agent") return;
    if (actor?.taskId?.startsWith("route:")) return;
    if (kind === "create" && !block.text.trim()) { this.markFresh(blockId); return; }
    if (!this.candidate(block)) return;
    let when: RouteWhen = kind === "create" ? "create" : "edit";
    if (kind === "edit" && this.fresh.has(blockId)) {
      if (!block.text.trim()) return;
      this.fresh.delete(blockId);
      when = "create";
    }
    const pending = this.timers.get(blockId);
    if (pending) { clearTimeout(pending.timer); if (pending.when === "create") when = "create"; }
    // A note parked while a door held it, saved again: the new quiet wait takes over, and keeps what was asked (`park`).
    const timer = setTimeout(() => {
      this.timers.delete(blockId);
      const started = performance.now();
      this.settle(blockId, when);
      noteWork("routing settle", performance.now() - started);
    }, this.options.quietMs ?? DEFAULT_QUIET_MS);
    timer.unref?.();
    this.timers.set(blockId, { when, timer });
  }

  private markFresh(blockId: string): void {
    this.fresh.add(blockId);
    if (this.fresh.size > MAX_FRESH) { const oldest = this.fresh.values().next().value; if (oldest) this.fresh.delete(oldest); }
  }

  private forget(blockId: string): void {
    const pending = this.timers.get(blockId);
    if (pending) { clearTimeout(pending.timer); this.timers.delete(blockId); }
    this.parked.delete(blockId);
    this.fresh.delete(blockId);
  }

  /**
   * Remember that a held note is to route when its draft closes, by at least the rules `when` consults: a command's ask
   * (every rule) outranks a creation's (the create and edit rules), which outranks a save's (the edit rules).
   */
  private park(blockId: string, when: RouteWhen): void {
    const rank = (w: RouteWhen) => (w === "command" ? 2 : w === "create" ? 1 : 0);
    const was = this.parked.get(blockId);
    this.parked.set(blockId, was !== undefined && rank(was) > rank(when) ? was : when);
  }

  /** The quiet wait is over: route it (by what was asked meanwhile too), or park it while a door holds its draft. */
  private settle(blockId: string, asked: RouteWhen): void {
    if (this.stopped) return;
    this.park(blockId, asked);
    const when = this.parked.get(blockId)!;
    const block = this.store.get(blockId);
    if (!block || !this.candidate(block)) { this.parked.delete(blockId); return; }
    if (this.options.held?.(blockId)) return;
    this.parked.delete(blockId);
    const rule = this.firstMatch(block, this.forWhen(this.rules().rules, when));
    if (!rule) return;
    this.apply(block, rule, { when });
  }

  /**
   * A door released its draft of the note: a parked note routes now, unless another door still holds it or a save since
   * started a quiet wait of its own (that wait routes it when it ends).
   */
  draftReleased(blockId: string): void {
    const when = this.parked.get(blockId);
    if (when === undefined || this.stopped) return;
    if (this.options.held?.(blockId) || this.timers.has(blockId)) return;
    this.settle(blockId, when);
  }

  // ── the Note mover view ───────────────────────────────────────────────────

  /** The Note mover view, when the outline still has it. */
  hub(): Block | null {
    const remembered = this.store.readMetadata(HUB_METADATA);
    const block = remembered ? this.store.get(remembered) : null;
    if (block && !block.effectiveDeletedRootId) return block;
    const found = this.store.lookupBlockRef(`[[${HUB_PAGE}]]`);
    return found.kind === "found" ? found.block : null;
  }

  /**
   * Seeds the Note mover view once: a saved view over the rules (every rule is listed wherever it's written, and its
   * hand order is the rules' tie order), one of the outline's own views like Bookmarks (`system-view`, author system:
   * never a change to catch up on), which the person can rename or move. Gone, it isn't given again. Then the seeded rules (PIE-1011's seam), each once.
   */
  ensureHub(): void {
    if (!this.store.readMetadata(HUB_METADATA)) {
      const existing = this.hub();
      if (existing) this.store.writeMetadata(HUB_METADATA, existing.id);
      else {
        const hub = this.store.create([
          `Note mover [page::${HUB_PAGE}] [type::virtual-branch] [system-view::${HUB_PAGE}] [query::${RULES_QUERY}] [limit::200]`,
          "",
          NOTE_MOVER_VIEW_WORDS,
        ].join("\n"), null, "system");
        this.store.writeMetadata(HUB_METADATA, hub.id);
      }
    }
    for (const seed of SEEDED_RULES) {
      const key = `routing.seed.${seed.key}`;
      if (this.store.readMetadata(key)) continue;
      const text = seed.text({ store: this.store });
      if (!text) continue;
      const hub = this.hub();
      const made = this.store.create(text, hub && !hub.properties.some(p => p.key === "type" && p.value === "virtual-branch") ? hub.id : null, "agent", { actorId: ROUTE_ACTOR });
      this.store.writeMetadata(key, made.id);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.timers.values()) clearTimeout(pending.timer);
    this.timers.clear();
    this.parked.clear();
  }
}
