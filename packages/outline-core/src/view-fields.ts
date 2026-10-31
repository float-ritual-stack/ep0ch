/** Record fields supplement the authored properties supplied by a view's facets. */
export const VIEW_TITLE_FIELD = { value: "title", meaning: "the note's title" };
export const VIEW_SORT_FIELDS = [
  { value: "created", meaning: "when the note was created" },
  { value: "updated", meaning: "when the note last changed" },
  VIEW_TITLE_FIELD,
];
