// `template.stamp` (PIE-533 S4): a template written out as a new note, for editing. The live form of a template is
// `::use` (template-use.ts); a stamp is the other: text that is the person's from then on.
//
//   template.stamp of=[[daily-template]] as=new parent=[[Daily notes]] title={{now.date}}
//   template.stamp of=[[ticket]] as=new for="links:[[xyz]] type=pc" title="PC-{{props.for.number}}"
//   template.stamp of=type:week-log as=new freeze=all
//
// What is filled when it is stamped, and what stays: `props.*`, `self.*` and `now.*` are the stamp's own (the call's
// arguments, the template, the clock), so they become text now. `this.*`, `parent.*`, a bare key and a reference keep
// their meaning in the note they land in, so they stay `{{ }}` and read there; `freeze=all` writes those as values too,
// for a scaffold with no braces left. The template's own bookkeeping (`[type::template]`, `[template-for::…]`, its
// `[form-field::…]` chips) is not stamped; `[template-for::meeting]` becomes the stamped note's `[type::meeting]`, and
// `[from-template::((id))]` says where it came from, once, on text the person now owns. `for=` stamps once per match
// (each match is `props.for`), and a match already stamped from this template is skipped, so running it again adds only
// what is new. A template that is a subtree is stamped whole. A step's generated id (`^t-3fa9c1`) is not carried over (the new
// note's steps are its own to address), so an agent can fill a placeholder step in without declaring an identity change. Writes only through the store's normal paths, attributed
// as whoever asked; refuses before writing anything when the template, a prop or `for` is wrong.
import { escapeInterpolation, interpolationSpans, type InterpolationSpan } from "@ep0ch/outline-core/interpolation";
import { ADDRESS_KEYS } from "@ep0ch/outline-core/property-grammar";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { checkProps } from "@ep0ch/outline-core/props-spec";
import { substituteValues } from "@ep0ch/outline-core/site-values";
import { withPageTitle } from "@ep0ch/outline-core/page-title";
import type { BlockAuthor } from "@ep0ch/outline-core/protocol";
import { blockDisplayTitle } from "./references";
import { fragmentAnchors } from "./fragments";
import { answerSite, siteReader } from "./site-answer";
import type { Block, BlockProvenance, NewNoteReceipt } from "./types";
import { findTemplate, TEMPLATE_FOR_KEY, TEMPLATE_ONLY_KEYS, templateProps } from "./templates";
import type { TemplateUseStore } from "./template-use";

/** What a stamp needs of the store, beyond reading. */
export interface StampStore extends TemplateUseStore {
  create(text: string, parentId?: string | null, author?: BlockAuthor, provenance?: BlockProvenance): Block;
  createNote(text: string, intent: { kind: "note" }, author?: BlockAuthor, provenance?: BlockProvenance): NewNoteReceipt;
  update(id: string, text: string, expectedRevision: number, mutation?: { author: BlockAuthor; actorId?: string; sessionId?: string; taskId?: string }): Block;
  inTransaction<T>(run: () => T): T;
}

export interface TemplateStampRequest {
  of: string;
  /** Where the stamp goes: `new` (a new note, the only one so far). */
  as?: string;
  /** `into=((id^anchor))` is placement (PIE-533 S6): refused here with where it is coming. */
  into?: string;
  /** The note it is made under (a reference); left out, the top of the Inbox, as any new note. */
  parent?: string;
  /** The stamped note's title, in place of the template's first line's words. May hold `{{ }}` of the stamp (`now`, `props`). */
  title?: string;
  /** The call's props, `name: value`. */
  props?: Record<string, string>;
  /** A query: stamp once per note it matches (each is `props.for`). */
  for?: string;
  /** `all`: write the values of `this`, `parent` and bare keys too. */
  freeze?: string;
  author?: BlockAuthor;
  provenance?: BlockProvenance;
}

export interface Stamped { id: string; title: string; parentId: string | null; blocks: number; frozen: number; for?: string }
export interface TemplateStampResult {
  template: { id: string; title: string };
  stamped: Stamped[];
  /** Matches left alone: already stamped from this template. */
  skipped: { for: string; stamped: string }[];
  /** `{{ }}` of the stamp that couldn't be read, left as written (the save stands). */
  warnings: string[];
  /** One line: what happened. */
  said: string;
}

/** The most notes one `for=` stamps. */
export const MAX_FOR = 50;
/** The most blocks one stamp writes (a template's subtree). */
const MAX_BLOCKS = 200;
/** The heads a stamp fills; the rest keep their meaning where they land. */
const STAMP_HEADS: ReadonlySet<string> = new Set(["props", "self", "now"]);
const STAMPED_FOR_KEY = "stamped-for";
/** What a template's comment threads and proposals are: not part of what it stamps. */
const NOT_STAMPED = new Set(["annotation", "annotation-reply", "draft-proposal"]);

const isStampSpan = (span: InterpolationSpan) => !!span.parsed && STAMP_HEADS.has(span.parsed.head.toLowerCase());

/** `text` with the stamp's own `{{ }}` replaced by their values; every other byte, a `\{{` and the other heads included, stays as written. */
function fill(text: string, read: ReturnType<typeof siteReader>, warnings: string[]): string {
  let out = "", at = 0;
  for (const span of interpolationSpans(text)) {
    if (!isStampSpan(span)) continue;
    const answer = read(span);
    let words: string;
    if (answer.ok && (answer.values.length || span.default === undefined)) words = literal(answer.values.join(", "));
    else if (span.default !== undefined) words = literal(span.default);
    else { warnings.push(`{{${span.expression}}}: ${answer.ok ? "no value" : answer.problem.message}; left as written`); continue; }
    out += text.slice(at, span.start) + words;
    at = span.end;
  }
  return out + text.slice(at);
}

/** The template's bookkeeping (and its own page address) taken out of a stamped text; a line that held only that goes. */
function withoutTemplateChips(text: string, addresses: ReadonlySet<string>): string {
  const drop = parsePropertyRecords(text).filter(r => r.syntax !== "hashtag" && (
    TEMPLATE_ONLY_KEYS.includes(r.key) || (r.key === "type" && r.value.trim().toLowerCase() === "template")
    // The template's own address is its identity, not part of what it makes; a page address of the stamp's own (`[page::{{now.date}}]`) is.
    || (ADDRESS_KEYS.has(r.key) && addresses.has(r.value.trim().toLowerCase()))));
  if (!drop.length) return text;
  let out = text;
  for (const r of [...drop].reverse()) {
    let start = r.start, end = r.end;
    if (out[start - 1] === " ") start -= 1;
    out = out.slice(0, start) + out.slice(end);
  }
  const before = text.split("\n"), after = out.split("\n");
  return after.filter((line, i) => line.trim() !== "" || (before[i] ?? "").trim() === "").join("\n");
}

/** The first line with its words replaced by `title`, its marker (`# `, `- `) and its trailing chips kept. */
function withTitle(text: string, title: string): string {
  const [first = "", ...rest] = text.split("\n");
  title = title.replace(/\s*\n\s*/g, " ");
  const m = /^(\s*(?:#{1,6}\s+|[-*+]\s+)?)(.*?)((?:\s*\[[^\]\n]*::[^\]\n]*\])*)\s*$/.exec(first)!;
  return [`${m[1]}${title}${m[3]}`, ...rest].join("\n");
}

/**
 * The generated step ids (`^t-3fa9c1`, a checklist step made addressable) taken out of a stamped text. They are the template's
 * steps' addresses, and nothing links to the new note's: a placeholder step an agent then fills in is not an address it must
 * protect (PIE-818). A name the author wrote (`^weekly`, `## Log ^log`) stays: a script may place into it.
 */
function withoutStepIds(text: string): string {
  if (!text.includes("^t-")) return text;
  let out = text;
  for (const anchor of [...fragmentAnchors(text)].reverse()) {
    if (anchor.kind !== "list-item" || !GENERATED_STEP_ID.test(anchor.id)) continue;
    const at = out.indexOf(`^${anchor.id}`, anchor.markerStart);
    if (at < 0) continue;
    let start = at;
    while (start > 0 && out[start - 1] === " ") start -= 1;
    out = out.slice(0, start) + out.slice(at + 1 + anchor.id.length);
  }
  return out;
}
const GENERATED_STEP_ID = /^t-[0-9a-f]{6,}$/;

/** A value written into a stamped text is words: a `{{` in it never becomes a live placeholder of the new note. */
const literal = (words: string) => escapeInterpolation(words);

const lineEnd = (text: string) => { const i = text.indexOf("\n"); return i < 0 ? text.length : i; };
/** `[key::value]` added at the end of the first line. */
const withChip = (text: string, key: string, value: string) => { const at = lineEnd(text); return `${text.slice(0, at)} [${key}::${value}]${text.slice(at)}`; };

/** The note's own title words, for a line that says what happened. */
const said = (text: string) => blockDisplayTitle({ id: "", text } as Block).slice(0, 60);

interface Node { text: string; children: Node[] }

/** The template and its subtree as text, comments and proposals left out. */
function subtreeOf(store: StampStore, block: Block, count: { n: number }): Node {
  count.n += 1;
  if (count.n > MAX_BLOCKS) throw new Error(`the template holds more than ${MAX_BLOCKS} blocks; a stamp writes at most that many`);
  const children = store.children(block.id)
    .filter(child => !NOT_STAMPED.has(String(child.properties.find(p => p.key === "type")?.value ?? "").toLowerCase()))
    .map(child => subtreeOf(store, child, count));
  return { text: block.text, children };
}

function alreadyStamped(store: StampStore, template: Block, match: Block): Block | null {
  const rows = store.queryBlocks({ where: `${STAMPED_FOR_KEY}=((${match.id}))`, limit: 50 }).blocks;
  return rows.find(row => parsePropertyRecords(row.text).some(r => r.key === "from-template" && r.value.includes(template.id))) ?? null;
}

export function stampTemplate(store: StampStore, request: TemplateStampRequest, clock: () => number = Date.now): TemplateStampResult {
  if (!request || typeof request !== "object" || typeof request.of !== "string" || !request.of.trim()) {
    throw new Error("template.stamp needs of: the template ([[page]], ((id)), a Work ID, or type:meeting); for example { of: \"[[daily-template]]\", as: \"new\", title: \"{{now.date}}\" }");
  }
  if (request.into !== undefined) throw new Error(`template.stamp into=${request.into} writes into a note's anchor (output regions); that arrives with place(). Until then stamp a new note: as=new parent=${request.into.replace(/\^.*$/, "")}`);
  if ((request.as ?? "new") !== "new") throw new Error(`template.stamp as=${request.as}: the only placement so far is as=new (a new note); for example as=new parent=[[Daily notes]]`);
  if (request.freeze !== undefined && request.freeze !== "all") throw new Error(`freeze=${request.freeze}: the only value is freeze=all (write every {{ }} as its value)`);
  const found = findTemplate(store, request.of);
  if (!found.ok) throw new Error(`${found.message}${found.didYouMean.length ? `; did you mean ${found.didYouMean.join(" or ")}?` : ""}${found.example ? ` (for example ${found.example})` : ""}`);
  const template = found.block;
  const title = blockDisplayTitle(template);
  const declared = templateProps(template);
  const warnings: string[] = declared.problems.map(problem => `${title}: ${problem}`);
  const author = request.author ?? "user";
  const mutation = { author, ...(request.provenance?.actorId ? { actorId: request.provenance.actorId } : {}) };

  // The notes to stamp for: one, or one per match.
  let matches: (Block | null)[] = [null];
  if (request.for !== undefined) {
    if (typeof request.for !== "string" || !request.for.trim()) throw new Error("for= is a query: stamp once per note it matches; for example for=\"type=client\"");
    const rows = store.queryBlocks({ where: request.for, limit: MAX_FOR + 1 }).blocks;
    if (rows.length > MAX_FOR) throw new Error(`for=${request.for} matches more than ${MAX_FOR} notes; a stamp makes at most ${MAX_FOR} at once. Narrow the query`);
    matches = rows;
  }
  const parent = request.parent === undefined || request.parent === "inbox" ? null : store.resolveBlockRef(request.parent);
  const given = Object.entries(request.props ?? {}).map(([key, value]) => ({ key, value: String(value) }));
  const checked = checkProps(declared.spec, given, title, request.of);
  if (checked.problems.length) {
    throw new Error(`${title}'s props: ${checked.problems.map(p => p.message).join("; ")}${checked.problems[0]!.example ? ` (for example ${checked.problems[0]!.example})` : ""}`);
  }
  // A default that is itself a path (`default={{now.date}}`) is read in the stamp's own Site.
  const settle = siteReader(store, { self: template, props: checked.values }, clock);
  for (const name of checked.defaulted) checked.values[name] = checked.values[name]!.map(value => fill(value, settle, warnings));
  const root = subtreeOf(store, template, { n: 0 });
  const addresses = new Set(parsePropertyRecords(template.text).filter(r => ADDRESS_KEYS.has(r.key)).map(r => r.value.trim().toLowerCase()));
  const forWord = (template.properties.find(p => p.key === TEMPLATE_FOR_KEY)?.value ?? "").trim().split(/[\s,]+/)[0] || undefined;

  const stamped: Stamped[] = [];
  const skipped: TemplateStampResult["skipped"] = [];
  store.inTransaction(() => {
    for (const match of matches) {
      if (match) {
        const prior = alreadyStamped(store, template, match);
        if (prior) { skipped.push({ for: match.id, stamped: prior.id }); continue; }
      }
      const props: Record<string, string[]> = { ...checked.values, ...(match ? { for: [match.id] } : {}) };
      const read = siteReader(store, { self: template, props }, clock);
      const own: string[] = [];
      const make = (node: Node, first: boolean): string => {
        let text = fill(withoutStepIds(withoutTemplateChips(node.text, addresses)), read, own);
        if (first) {
          if (request.title !== undefined) text = withTitle(text, fill(request.title, read, own));
          if (forWord && !parsePropertyRecords(text).some(r => r.key === "type")) text = withChip(text, "type", forWord);
          text = withChip(text, "from-template", `((${template.id}))`);
          if (match) text = withChip(text, STAMPED_FOR_KEY, `((${match.id}))`);
        }
        return withPageTitle(text);
      };
      const ids: string[] = [];
      const write = (node: Node, under: string | null, first: boolean): void => {
        const text = make(node, first);
        const block = first && under === null && !parent
          ? store.createNote(text, { kind: "note" }, author, request.provenance).block
          : store.create(text, under, author, request.provenance);
        ids.push(block.id);
        for (const child of node.children) write(child, block.id, false);
      };
      write(root, parent?.id ?? null, true);
      warnings.push(...own);
      let frozen = 0;
      if (request.freeze === "all") {
        for (const id of ids) {
          const block = store.resolveBlockRef(id);
          if (!block.text.includes("{{")) continue;
          const answer = answerSite(store, { blockId: id }, clock);
          const next = substituteValues(block.text, answer.values, { words: literal });
          if (next !== block.text) {
            frozen += answer.values.filter(v => v.values !== undefined).length;
            store.update(id, next, block.revision, mutation);
          }
          for (const v of answer.values) if (v.problem && !v.usedDefault) warnings.push(`{{${v.expression}}}: ${v.problem.message}; left as written`);
        }
      }
      const head = store.resolveBlockRef(ids[0]!);
      stamped.push({ id: head.id, title: said(head.text), parentId: head.parentId, blocks: ids.length, frozen, ...(match ? { for: match.id } : {}) });
    }
  });

  const whatFilled = request.freeze === "all" ? "every {{ }} written as its value" : "props, self and now filled; this, parent and bare keys stay as {{ }} to read where they land";
  const sentence = !stamped.length && skipped.length
    ? `nothing new: ${skipped.length} match${skipped.length === 1 ? " was" : "es were"} already stamped from ${title}`
    : stamped.length === 0 ? `for=${request.for} matches no note, so nothing was stamped`
    : `stamped ${stamped.length === 1 ? `“${stamped[0]!.title}”` : `${stamped.length} notes`} from ${title} (${whatFilled})${skipped.length ? `; ${skipped.length} already stamped` : ""}${warnings.length ? `; ${warnings.length} {{ }} left as written` : ""}`;
  return { template: { id: template.id, title }, stamped, skipped, warnings, said: sentence };
}
