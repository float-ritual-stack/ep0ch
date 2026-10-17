// The Site (PIE-533): the one execution context for everything that runs in a note (a `{{ }}` value, a figure, a
// script, a template, an extension component, `::fields`). Where am I, what note contains me, what can I read, what can
// I reference, where can I render, what makes my output update: one shape, with the same answers for every kind.
// Types only (S0a); `resolvePath` (resolve-path.ts) reads it, and the service fills it (S1). Pure: no I/O.
import type { BlockRecord } from "./block-record";
import type { BlockAuthor } from "./protocol";

/**
 * Where something sits: `((block^anchor))`, with the line's text as a mark to find it again by. A line number is a
 * render hint only: anything written is found again by anchor or by the line's text.
 */
export interface Address { block: string; anchor?: string; mark?: string; line?: number; page?: string }

/** Who runs a producer, and who asked. */
export interface SiteActor { id: string; author: BlockAuthor; requestedBy?: string }

/** What a rule matched: `{{match.text}}`, `{{match.level}}`, `{{match[N]}}`. */
export interface RuleMatch { text: string; level?: number; captures: string[] }

/** The producer's execution context. */
export interface Site {
  /** Where I am. */
  at: Address;
  /** The note that contains me (inside a live template: the host). Absent when a run has no note. */
  this?: BlockRecord;
  /** My definition (a script, a template, a component note, a runbook root). */
  self?: BlockRecord;
  /** Where I was invoked (the `::run` line, the button, the `@name` line, the `::use` line). */
  caller?: Address;
  /** For a rule: what matched. */
  match?: RuleMatch;
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
    kind: "text" | "choice" | "tag" | "note" | `property:${string}` | "number";
    choices?: string[];
    default?: string;
    required?: boolean;
  };
}

/** Call-site arguments every producer reads as its own settings, never as props. */
export const RESERVED_PROPS = ["of", "act", "at", "mode", "as", "label", "txn", "motion", "create", "freeze", "for"] as const;
