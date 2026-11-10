// The words a service file holds, escaped for it (PIE-1647): a launchd plist's text and a systemd unit's quoted word.
// host.ts and link.ts write both kinds of file; backup/setup.ts keeps its own pair, which quote only when needed.

/** `s` as a plist's XML text or attribute value: `&`, `<` and `"`. */
export const plistText = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** `s` as one double-quoted systemd word, `%` doubled so systemd never expands it. */
export const unitWord = (s: string) => '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") + '"';
