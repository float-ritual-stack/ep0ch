// What a query being typed can become next (the views' grammar, `block-query.ts`): the words typed kept, the last
// clause offered as everything the grammar can say there: the outline's own properties and values, the atoms
// (`under:`, `links:`, `#tag`...), `this` and `{{this.key}}`, AND/OR/NOT, and a relative date after a comparison.
// Each row's detail is the grammar's own description (query-atoms.ts, dates.ts), never a list written again here.
// The settings card's picker and the service's completion of every query-typed place (a lens slot, a figure's `query:`,
// a `[query::]` value) ask this one. Pure: the catalog is passed in.

import { QUERY_ATOM_HELP, QUERY_BY_AUTHORS, QUERY_CONNECTIVE_HELP, QUERY_RANGE_HELP, ME_READER, THIS_TARGET } from "./query-atoms";
import { QUERY_DATE_HELP } from "./dates";

/** `properties.catalog`: the keys starting with `prefix` (each value counted), or `key`'s values starting with it. */
export type PropertyCatalog = (key: string | undefined, prefix: string) => Promise<readonly { key: string; value: string; count: number }[]>;

/** `open`: the row is the start of a clause (`under:`, `NOT`, `(`), so a place that closes what it inserts (a `]`, a quote) leaves it open. */
export type QuerySuggestion = { value: string; detail: string; open?: true };
type Row = QuerySuggestion;

const CMP = /^(<=|>=|<|>)$/;
const RANGE = /^([^\s<>=:~"()]+)(<=|>=|<|>)(.*)$/s;
/** An atom's head as written (`links:`, `title~`, `#`), from its help entry; `this` and `{{this.key}}` are targets and values, not heads. */
const headOf = (atom: string) => /^(?:#|[a-z]+[:~])/.exec(atom)?.[0];
const startsWith = (word: string, typed: string) => word.toLowerCase().startsWith(typed.toLowerCase());
const TARGET_ATOMS = new Set(["links", "linkedfrom", "under", "parent"]);

/**
 * A query being built: the words typed, the last clause offered as what the grammar can say there. Properties come
 * from the catalog (never a list in code: whatever keys the notes have); the rest from the grammar's own tables.
 */
export async function querySuggestions(typed: string, catalog: PropertyCatalog): Promise<QuerySuggestion[]> {
  // An open quote (`title~"weekly rev`) is text, not a clause: nothing to offer inside it.
  if ((typed.replace(/\\./g, "").match(/"/g)?.length ?? 0) % 2 === 1) return [];
  const m = /^(.*?)(\S*)$/s.exec(typed)!;
  const before = m[1]!, token = m[2]!;
  const words = before.trim().split(/\s+/).filter(Boolean);
  const prev = words.at(-1)?.toUpperCase(), prev2 = words.at(-2);
  const out: Row[] = [], seen = new Set<string>();
  const add = (value: string, detail: string, open?: true) => { if (!seen.has(value)) { seen.add(value); out.push({ value, detail, ...(open ? { open } : {}) }); } };
  const dates = (stem: string, typedBound: string) => { for (const d of QUERY_DATE_HELP) if (startsWith(d.word, typedBound)) add(`${stem}${d.word}`, d.means); };

  // After a comparison written apart (`updated >= `) or together (`updated>=-`): the bounds a date reads as.
  if (prev && CMP.test(prev) && prev2 && !/\s/.test(prev2)) { dates(before, token); return out; }
  const range = /^\(*child>=\d/i.test(token) ? null : RANGE.exec(token.replace(/^\(+/, ""));
  if (range) { dates(`${before}${token.slice(0, token.length - range[3]!.length)}`, range[3]!); return out; }

  // A clause may open groups and be a child's: `((child:` keeps both.
  const rel = /^(\(*(?:child(?:>=\d+)?:)?)(.*)$/i.exec(token)!;
  const lead = rel[1]!, clause = rel[2]!;
  const colon = /^([a-z]+):(.*)$/i.exec(clause);

  // An atom's target or reader: `under:th` -> `under:this`; `by:ag` -> `by:agent`; `unread:m` -> `unread:me`.
  if (colon && !lead.toLowerCase().endsWith("child:") && colon[1]!.toLowerCase() !== "child") {
    const atom = colon[1]!.toLowerCase(), part = colon[2]!, stem = `${before}${lead}${colon[1]}:`;
    const help = QUERY_ATOM_HELP.find(h => h.atom.startsWith(`${atom}:`));
    if (TARGET_ATOMS.has(atom) && startsWith(THIS_TARGET, part)) add(`${stem}${THIS_TARGET}`, QUERY_ATOM_HELP.find(h => h.atom === "this")!.gist);
    if (atom === "by") for (const who of QUERY_BY_AUTHORS) if (startsWith(who, part)) add(`${stem}${who}`, `blocks last written by ${who}`);
    if ((atom === "unread" || atom === "thread") && startsWith(ME_READER, part)) add(`${stem}${ME_READER}`, "the person");
    if (help && atom !== "child") return out;
  }

  const eq = clause.indexOf("=");
  const keyed = async () => {
    const rows = eq >= 0 ? await catalog(clause.slice(0, eq), clause.slice(eq + 1)) : await catalog(undefined, clause);
    for (const r of rows) add(`${before}${lead}${r.key}=${r.value}`, `${r.count} note${r.count === 1 ? "" : "s"}`);
    // A value may read the note the question is asked for: `owner={{this.owner}}`, `when={{this.page}}`.
    if (eq > 0) {
      const key = clause.slice(0, eq), rest = clause.slice(eq + 1), help = QUERY_ATOM_HELP.find(h => h.atom === "{{this.key}}")!;
      for (const v of [`{{this.${key}}}`, "{{this.page}}"]) if (v.startsWith(rest)) add(`${before}${lead}${key}=${v}`, help.gist);
    }
  };
  const open = eq < 0 && !lead.toLowerCase().endsWith("child:");
  // AND and OR join two clauses; NOT and a group open one. They're few, so a typed `NO` finds NOT before the notes' keys.
  const connectives = () => {
    if (!open) return;
    const joined = words.length > 0 && !["AND", "OR", "NOT", "("].includes(prev ?? "") && !prev?.endsWith("(") && !lead;
    for (const c of QUERY_CONNECTIVE_HELP) {
      if (c.word === "(") { if (clause === "" && !lead) add(`${before}(`, c.means, true); continue; }
      if (!startsWith(c.word, clause) || ((c.word === "AND" || c.word === "OR") && !joined)) continue;
      add(`${before}${lead}${c.word}`, c.means, true);
    }
  };
  const atoms = () => {
    if (!open) return;
    for (const h of QUERY_ATOM_HELP) { const head = headOf(h.atom); if (head && startsWith(head, clause) && !(lead && head.toLowerCase() === "child:")) add(`${before}${lead}${head}`, h.gist, true); }
    for (const r of QUERY_RANGE_HELP) if (startsWith(r.key, clause)) add(`${before}${lead}${r.key} >= -7d`, r.means);
  };
  // Nothing typed yet: the grammar's vocabulary first. Otherwise the connectives, what the notes carry, then the atoms.
  if (clause === "" && !lead) { connectives(); atoms(); await keyed(); } else { connectives(); await keyed(); atoms(); }
  return out;
}
