// Finding a template and reading what it declares (PIE-533 S4): the one place `::use` (the live draw, template-use.ts) and
// `template.stamp` (template-stamp.ts) turn "the template" as a person writes it into a note and its props.
//
//   of=[[meeting-template]]   a page, ((id)), a Work ID or an id, resolved as any reference is (did-you-mean on a miss)
//   of=type:meeting           the one note that says [template-for::meeting] (a convention, so a note shape written
//                             often, a week-log or a ticket, is found by what it is, not by where its skeleton was copied)
//
// A template is a note: `[type::template]` marks it, `[template-for::meeting]` says which notes it makes, and its
// `[form-field::…]` chips declare its props (outline-core's form-fields.ts and props-spec.ts).
import { FORM_FIELD_KEY } from "@ep0ch/outline-core/form-fields";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { propsSpecOf } from "@ep0ch/outline-core/props-spec";
import type { PropsSpec } from "@ep0ch/outline-core/site";
import { blockDisplayTitle } from "./references";
import type { BlockRefLookup } from "./store";
import type { Block } from "./types";

/** The property that says which notes a template makes. */
export const TEMPLATE_FOR_KEY = "template-for";
/** The properties that belong to the template and are not part of what it stamps. */
export const TEMPLATE_ONLY_KEYS: readonly string[] = [FORM_FIELD_KEY, TEMPLATE_FOR_KEY];

/** What template lookup needs of the store. */
export interface TemplateStore {
  lookupBlockRef(ref: string): BlockRefLookup;
  queryBlocks(query: { where: string; limit?: number }): { blocks: Block[] };
}

export type TemplateFound =
  | { ok: true; block: Block; how: string }
  | { ok: false; message: string; didYouMean: string[]; example?: string };

/** The note `of` names, or why none and what to write. */
export function findTemplate(store: TemplateStore, of: string): TemplateFound {
  const written = of.trim();
  const typed = /^type:\s*(\S+)$/i.exec(written);
  if (typed) {
    const kind = typed[1]!;
    const found = store.queryBlocks({ where: `${TEMPLATE_FOR_KEY}=${kind}`, limit: 5 }).blocks;
    if (found.length === 1) return { ok: true, block: found[0]!, how: `the note that says [${TEMPLATE_FOR_KEY}::${kind}]` };
    if (!found.length) return { ok: false, message: `no note says [${TEMPLATE_FOR_KEY}::${kind}], so there is no template for ${kind}; write that property on the template (with [type::template])`, didYouMean: [], example: `[type::template] [${TEMPLATE_FOR_KEY}::${kind}]` };
    return { ok: false, message: `${found.length} notes say [${TEMPLATE_FOR_KEY}::${kind}] (${found.map(b => `${b.id.slice(0, 8)} ${blockDisplayTitle(b)}`).join("; ")}); name one: of=((${found[0]!.id.slice(0, 8)}))`, didYouMean: found.map(b => `((${b.id.slice(0, 8)}))`) };
  }
  const found = store.lookupBlockRef(written);
  switch (found.kind) {
    case "found": return { ok: true, block: found.block, how: found.how };
    case "ambiguous": return { ok: false, message: found.message, didYouMean: found.ids.map(id => `((${id.slice(0, 8)}))`) };
    case "trashed": return { ok: false, message: found.message, didYouMean: [] };
    case "missing": return { ok: false, message: found.message, didYouMean: found.didYouMean ? [found.didYouMean] : [], example: "of=[[meeting-template]]" };
  }
}

/** The props a template note declares, and what is wrong with how it declares them. */
export function templateProps(block: Block): { spec: PropsSpec; problems: string[] } {
  return propsSpecOf(parsePropertyRecords(block.text).filter(property => property.key === FORM_FIELD_KEY).map(property => property.value));
}
