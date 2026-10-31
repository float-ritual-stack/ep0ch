import { subtitleOf, valuesOf } from "./block-record";
import type { FigureItem } from "./figure-live";

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fields: { value: string; meaning: string; read: (item: FigureItem, body: readonly string[]) => string }[] = [
  { value: "title", meaning: "the note's title", read: m => m.title },
  { value: "subtitle", meaning: "the note's subtitle", read: m => subtitleOf(m) ?? "" },
  { value: "created", meaning: "when the note was created", read: m => date(m.createdAt) },
  { value: "updated", meaning: "when the note last changed", read: m => date(m.updatedAt) },
  { value: "author", meaning: "who wrote the note", read: m => m.author ?? "" },
  { value: "description", meaning: "the note's description, or its first body line", read: (m, body) => valuesOf(m, "description").join(", ") || body[0] || "" },
];

/** The renderer's record fields supplement the authored properties supplied by a view's facets. */
export const VIEW_SUMMARY_FIELDS = fields.map(({ value, meaning }) => ({ value, meaning }));
export const VIEW_SORT_FIELDS = ["created", "updated", "title"].map(key => VIEW_SUMMARY_FIELDS.find(f => f.value === key)!);
export const viewField = (item: FigureItem, key: string, body: readonly string[] = []): string | undefined => fields.find(f => f.value === key)?.read(item, body);
