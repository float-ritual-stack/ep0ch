// Recent replies (the capability "Conversations in the margin", primitive 2): every reply someone else wrote on a thread
// the reader started or wrote in, newest first. The question is the views' grammar, answered by the service; a saved
// view in the outline asks it (`recentRepliesView`), and the tailnet web client's `/replies` page asks the same, with
// `unread:me` for which ones are new. Opening a thread marks it read (`annotations.read`). Pure: no I/O.

/** The replies on the reader's threads that the reader didn't write. */
export const RECENT_REPLIES_QUERY = "type=annotation-reply AND thread:me AND NOT annotation-source=user";

/** The same, narrowed to the ones the reader hasn't read (never opened, or changed since). */
export const UNREAD_REPLIES_QUERY = `${RECENT_REPLIES_QUERY} AND unread:me`;

/** A saved view's line for Recent replies: `title` with the query, newest first. */
export function recentRepliesView(title = "Recent replies"): string {
  return `${title} [type::virtual-branch] [query::${RECENT_REPLIES_QUERY}] [sort::created] [direction::desc] [limit::50]`;
}
