import type { QueryAtom } from "./query-atoms";
import type { PropertyScope } from "./property-parse";
export type PropertyQueryScope = PropertyScope | "all";
export interface PropertyFilter { key: string; value?: string }
export type QueryTimeField = "created" | "updated";
export type QueryComparison = "<" | "<=" | ">" | ">=";

/**
 * Boolean property/timestamp predicate. Property leaves have filter semantics
 * (presence or case-insensitive equality within propertyScope; a value that reads as a date also holds for the
 * values on that day, or a span holding it). Time values are
 * YYYY-MM-DD, an ISO datetime, now, today, yesterday or -N{m,h,d,w}; relative
 * values resolve when the service evaluates the query.
 */
export type QueryExpression =
  /**
   * `relation: "child"` (`child:key=value` in query text): some active direct
   * child has the property, not the block itself. It lets a view compare a
   * block with what sits under it (a ticket page's `[status::]` with its
   * Jira record's `jira.status`).
   */
  | {
    kind: "property"; key: string; value?: string; relation?: "child"; /** `child>=N:`: at least N children have it (default 1). */ count?: number;
    /**
     * `key={{this.project}}`: the value is read from the Site when the question is bound (`bindThis`), as an operand: the
     * values it gives are compared as values, never pasted into the query text, so one that holds `OR` or a quote can't
     * change the query. A list means any of them; none matches nothing. Never present once bound.
     */
    from?: string;
  }
  | { kind: "time"; field: QueryTimeField; op: QueryComparison; value: string }
  /**
   * `due <= +3d`, `rating > 3`, `stage >= beta`: any property against a bound, as dates when the bound reads as one
   * (outline-core `dates.ts`: relative ones resolve when the service evaluates the query), numbers when it is a
   * number, text otherwise (PIE-769). A block holds when any of its values for the key does.
   */
  | { kind: "compare"; key: string; op: QueryComparison; value: string }
  /** `#tag`, `links:`, `linkedfrom:`, `under:`, `parent:`, `title~`, `text~`, `call:`, `unread:` and `thread:` (outline-core `query-atoms.ts`); the service evaluates them. */
  | QueryAtom
  | { kind: "not"; operand: QueryExpression }
  | { kind: "and" | "or"; operands: QueryExpression[] };

