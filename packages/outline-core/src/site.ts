// The Site (PIE-533): the one execution context for everything that runs in a note (a `{{ }}` value, a figure, a
// script, a template, an extension component, `::fields`). Where am I, what note contains me, what can I read, what can
// I reference, where can I render, what makes my output update: one shape, with the same answers for every kind.
// `resolvePath` (resolve-path.ts) reads it, `deriveSite` makes a nested producer's from its parent's, and the service
// fills it and answers it (`site.answer`: the wire types below). Pure: no I/O.
import type { BlockRecord } from "./block-record";
import type { BlockAuthor, QuestionGroup } from "./protocol";

/**
 * Where something sits: `((block^anchor))`, with the line's text as a mark to find it again by. A line number is a
 * render hint only: anything written is found again by anchor or by the line's text.
 */
export interface Address { block: string; anchor?: string; mark?: string; line?: number; page?: string }

/** Who runs a producer, and who asked. */
export interface SiteActor { id: string; author: BlockAuthor; requestedBy?: string }

/** What a rule matched: `{{match.text}}`, `{{match.level}}`, `{{match[N]}}`. */
export interface RuleMatched { text: string; level?: number; captures: string[] }

/** The producer's execution context. */
export interface Site {
  /** Where I am. */
  at: Address;
  /** The note that contains me (inside a live template: the host). Absent when a run has no note. */
  this?: BlockRecord;
  /** My definition (a script, a template, a component note, an extension's definition note). */
  self?: BlockRecord;
  /** Where I was invoked (the `::run` line, the button, the `@name` line, the `::use` line). */
  caller?: Address;
  /** For a rule: what matched. */
  match?: RuleMatched;
  /** Invocation arguments, checked against my `PropsSpec`. */
  props: Record<string, string[]>;
  actor: SiteActor;
  /** The door I may act in, when one asked. */
  door?: { client: string; screen: string };
  /** The Site I was drawn inside (nesting is passed down, never looked up). */
  parent?: Site;
}

/** Where output goes, and whether it is drawn (render) or written as text (materialize). */
export interface Placement {
  at: Address | "here";
  mode: "inline" | "prepend" | "append" | "replace" | "upsert" | "around";
  as: "render" | "materialize";
}

/**
 * The props a producer takes: one declaration for form fields, manifest arguments and component schemas to compile to.
 * A `default` is text and may itself be a `{{ }}` path.
 */
export interface PropsSpec {
  [name: string]: {
    kind: "text" | "choice" | "tag" | "note" | "property" | `property:${string}` | "number";
    choices?: string[];
    default?: string;
    required?: boolean;
  };
}

/** Call-site arguments every producer reads as its own settings, never as props. */
export const RESERVED_PROPS = ["of", "act", "at", "mode", "as", "label", "txn", "motion", "create", "freeze", "for"] as const;

/**
 * One nesting step, outermost first: where a producer is drawn inside another. `use`: a `::use` line (the template is
 * drawn with the host as `this`); `embed`: an embedded note (a fresh Site, the embedded note is `this`); `box`: a box
 * or callout (the Site passes through). `block` is the note the invocation is written in, `line`/`mark` where.
 */
export interface SiteLink { kind: "use" | "embed" | "box"; block: string; line?: number; mark?: string }

/**
 * The Site of a producer drawn inside `parent`'s: passed down, never looked up. `child` is the note the invocation names
 * (the template of a `use`, the embedded note of an `embed`).
 */
export function deriveSite(parent: Site, link: SiteLink, child: BlockRecord): Site {
  const at: Address = { block: child.id };
  const caller: Address = { block: link.block, ...(link.line !== undefined ? { line: link.line } : {}), ...(link.mark !== undefined ? { mark: link.mark } : {}) };
  switch (link.kind) {
    // The host stays `this`; the template is `self`; the scope walk starts at the `::use` line in the host.
    case "use": return { at, ...(parent.this ? { this: parent.this } : {}), self: child, caller, props: {}, actor: parent.actor, parent };
    case "embed": return { at, this: child, caller, props: {}, actor: parent.actor, parent };
    case "box": return { ...parent, at };
  }
}

// --- the wire: `site.answer` ---

/** `site.answer`'s question. `blockId` is the note whose text holds the placeholders being read. */
export interface SiteAnswerRequest {
  /** Absent for a figure or interpolation asked outside any note: it has no `this`. */
  blockId?: string;
  /** The unsaved text of `blockId` (a draft being typed): values, problems and deps agree with what is on screen. */
  draft?: { text: string };
  /** Where `blockId` is drawn: the invocations from the outermost host in (a `::use` in a host, an embed in a `::use`). */
  chain?: SiteLink[];
  /** The call's arguments (`{k=v}` of the `::use` line), as `props.k`. */
  props?: Record<string, string[]>;
  /** The producer's own definition (a script's note), as `self.*`. */
  self?: string;
  /** Where the producer was invoked (a rule's matched line, a key's note), as `caller.*`. */
  caller?: Address;
  /** The line of the note the scope walk starts at (default: the first). A `use` in the chain sets it to its own line. */
  line?: number;
  /** More paths to read besides the note's own `{{ }}` (a script's `resolve`, an agent's question): `this.tasks | status=todo`. */
  paths?: string[];
  /** A producer in the note (a figure, `::fields`, `::if`) asking its own question over this Site: answered in `produced`. */
  produce?: SiteProducer;
  /**
   * Text to fill in this Site besides the note's own (an extension step's command): its `{{ }}` are read like the note's, and
   * answered as `interpolated`. `fences: "template"` reads the ones inside code fences too, for a producer that owns its
   * fences as templates (a step's command); by default a fence is literal.
   */
  interpolate?: { text: string; fences?: "literal" | "template" };
  /**
   * Notes the reader may not see (a publisher's locked or non-public ones): a path that reads one answers `hidden` and no
   * value, and an ancestor in it supplies no bare key (nor any above it). A reader with no limits sends none. Sending it at all
   * (even `[]`) says the reader is limited: what decides an answer is then returned as `deps` (the children a `child:` clause
   * reads, the notes a prefix could start) so the reader can say which of them it shows, and asks again naming the rest.
   */
  hidden?: string[];
  /** Re-evaluate this render-script line with the reader’s query cut, without changing stored output. */
  scriptLine?: number;
  /** Include the page Sources inspector, using this same visibility cut. */
  sources?: boolean;
}

/**
 * What a producer in a note asks of its Site (S3). A figure sends its props as the client read them (its YAML over its
 * call-site args: `figureProps`); the service answers the question with `this` the Site's note and `{{ }}` operands
 * bound from the Site, so one figure copied onto two pages, or drawn through a `::use`, lists each host's own.
 */
export type SiteProducer =
  | { kind: "figure"; figure: string; props: Record<string, unknown> }
  /** A figure block's child bullets (`rows: children`): the note's children, the comments left out. */
  | { kind: "children" }
  /** `::fields{key=connectTo}`: one row per occurrence of the key in `of` (default: `this`). */
  | { kind: "fields"; key: string; of?: string }
  /** `::if{where="status=active"}`: whether `this` matches (the views' query atoms). */
  | { kind: "if"; where: string }
  /** Which of `ids` a question (`where`) can't be answered for by a reader who may not see every note it consults (a view's rows, a `::links` query's): for a reader sending `hidden`. */
  | { kind: "unknowable"; ids: string[]; where?: string };

/** One occurrence of a key in a note: its value, the line it is written on, and where, to open it lit. */
export interface FieldRow {
  value: string;
  /** The line index and its text: a row finds its line again by this text when the note was edited since. */
  line: number;
  mark: string;
  /** The field as written (`[connectTo::trust the drift]`, or its `key:: value` line): a reader finds it again by this text. */
  token?: string;
  /** The field's offset in the note's text. */
  offset?: number;
  /** A value that is a link to a note: shown by its title. */
  link?: { id: string; title: string };
}

/** What a producer's question answered. Blocks are the service's wire blocks (the questions' own shape). */
export type SiteProduced =
  | {
    kind: "figure";
    blocks: unknown[];
    truncated: boolean;
    groups?: QuestionGroup[];
    done?: string[];
    now?: string[];
    hint?: string;
    error?: string;
    /** The figure's `title:` with its `{{ }}` read in the figure's Site, as its query's are (PIE-1362); only when it has one. */
    title?: string;
    /** A `stat`/`kpi` whose items ask for themselves: each item's results (a page counts the ones it shows) or its problem, in the items' order. */
    counts?: { ids: string[]; truncated: boolean; error?: string }[];
    /**
     * A table's (or tabs') cells whose value names a note by its id: each such note's title, by id (PIE-1388), so a
     * record table draws "Status tonight", linked, where its `note::` holds a uuid. Only ids of notes that exist.
     */
    titles?: Record<string, string>;
  }
  | { kind: "children"; blocks: unknown[] }
  | { kind: "fields"; key: string; /** The note read (its id) and its revision. */ from: string; revision: number; rows: FieldRow[]; problem?: SiteProblem }
  | { kind: "if"; holds: boolean; problem?: SiteProblem }
  | { kind: "unknowable"; ids: string[] };

/** A path that has no answer: why, the nearest keys, and a path that works. */
export interface SiteProblem { message: string; didYouMean: string[]; example?: string }

/** One read: a `{{ }}` of the note (with its place in the text), or a path that was asked. */
export interface SiteValue {
  /** The whole `{{ … }}` in the note's text (absent for an asked path). */
  start?: number;
  end?: number;
  /** The expression as written, and its path. */
  expression: string;
  path: string;
  /** The path's head as written (`self`, `props`, `((id))`, a bare key): which of the Site's parts answered. */
  head?: string;
  /** The values (always a list); absent with a `problem`. A `|| default` fills in for a problem and says so. */
  values?: string[];
  problem?: SiteProblem;
  usedDefault?: true;
  /** For `.fields.key`: the line each value was written on, and its text. */
  lines?: number[];
  marks?: string[];
  /** For `.fields.key`: where each value's field starts in the note's text. */
  offsets?: number[];
  /** The note the values were read from. */
  from?: string;
  /**
   * Where the first value is written: the note, the offset and line of its property token, and the token's text (to find it
   * again by when the note has been edited). Absent for a computed value.
   */
  source?: { block: string; start: number; line: number; mark: string };
  /** Values that are links to a note (shown by its title). */
  links?: { text: string; id: string; title: string; how: string }[];
  /** The value depends on the clock alone (`now.time`). */
  clock?: "minute";
  /** It read a note the request said the reader may not see: no value, and nothing of it is to be drawn (`problem` says so). */
  hidden?: true;
  /** How: which head, which resolver answered, which fallback was taken. */
  route: string[];
}

/** `site.answer`'s answer. `deps` are the notes it was computed from: it changes only when one of them does. */
export interface SiteAnswer {
  sources?: import("./sources").SourcesAnswer;
  script?: { markdown: string; view?: unknown; reads: { ids: string[]; untracked?: true } };
  blockId: string;
  revision: number;
  /** The Site, in ids: `this` is the host in a `use`. */
  site: { this?: string; self?: string; caller?: Address; props: Record<string, string[]> };
  values: SiteValue[];
  paths?: SiteValue[];
  /** For `interpolate`: its text with each placeholder that has a value replaced by it (the rest as written), and each one's answer. */
  interpolated?: { text: string; values: SiteValue[] };
  /** The producer's answer (`produce`). */
  produced?: SiteProduced;
  /** How the Site was bound (the chain, the draft). */
  route: string[];
  deps: string[];
  /** Something it looked for isn't there yet (a `[[page]]` to be): any change may fill it, so `deps` can't be trusted to name every change. */
  anyChange?: true;
  /** Some value depends on the clock alone (`now.time`): a watch of this answer is evaluated again each minute. */
  clock?: "minute";
  /** The `{{ }}` placeholders and paths that have a problem (and no default). */
  problems: number;
  generation?: number;
}
