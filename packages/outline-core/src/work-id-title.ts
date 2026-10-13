// A note's title as every client heads it (PIE-809): a note with a Work ID shows it first, `HUB-011 · <title>`, in
// the client's accent, and the metadata line no longer carries it. Many titles already start with their Work ID
// (`PIE-809 — A note's title…`): it isn't said twice. Each client draws it its own way (the door's header, Detail's,
// a web page's heading); this is only what the two parts are.

/** The Work ID to put first (null when the note has none), and the title without it at its start. */
export function workIdTitle(title: string, workId: string | null | undefined): { workId: string | null; title: string } {
  const id = workId?.trim();
  if (!id) return { workId: null, title };
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The Work ID at the start, then a dash, colon or dot (or only a blank), as titles write it.
  const rest = title.replace(new RegExp(`^\\s*${esc}(?:\\s*[—–:·-]\\s*|\\s+|$)`, "i"), "");
  return { workId: id, title: rest };
}
