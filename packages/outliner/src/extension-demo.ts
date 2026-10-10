import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * An extension's demo notes (its manifest's `demo`, a folder in the extension): Blockdown notes, one file per note,
 * that installing the extension puts in the outline under its page (src/extension-pages.ts), once.
 *
 * - **One `.md` file is one note**, its whole text (first line the title, properties and all). Files and folders are
 *   taken in name order; a leading `01-` orders them and is not part of the name.
 * - **Nesting by folder:** `board.md` and `board/unread.md` make Unread a child of Board. A folder with no note of
 *   its own nests under the page. Or by front matter: `parent: <id>`.
 * - **Front matter** (optional, the file's first lines between `---`): `id: <name>` (what references in the demo use;
 *   default the note's path, `board/unread`) and `parent: <id>`.
 * - **References inside the demo** (`((unread))`, `((unread|Unread))`, `!((unread))`, `((unread^a1))`) name a demo
 *   note by its id; seeding rewrites each to the id the outline minted for it.
 */

export interface DemoNote {
  /** Stable across versions: the file's path in the demo folder, without `.md` or order prefixes. */
  readonly key: string;
  /** What references in the demo name it by. */
  readonly id: string;
  /** The demo note it sits under (its key), or none: under the extension's page. */
  readonly parent?: string;
  readonly text: string;
}

export interface Demo {
  readonly notes: readonly DemoNote[];
  /** Why the folder can't be used, in words that name the file; nothing is seeded then. */
  readonly problem?: string;
}

export const MAX_DEMO_NOTES = 64;
const MAX_NOTE_BYTES = 32 * 1024;
const ID = /^[a-z0-9][a-z0-9._/-]{0,95}$/;

const strip = (name: string) => name.replace(/\.md$/, "").replace(/^\d+-/, "");

/** Front matter's fields and the text after it. */
function frontMatter(raw: string, file: string): { fields: Record<string, string>; text: string } {
  const text = raw.replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { fields: {}, text };
  const end = text.indexOf("\n---\n", 3);
  const close = end >= 0 ? end : text.endsWith("\n---") ? text.length - 4 : -1;
  if (close < 0) throw new Error(`${file}: front matter opened with --- and never closed`);
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, close).split("\n")) {
    if (!line.trim()) continue;
    const match = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error(`${file}: front matter line "${line}" isn't key: value`);
    if (match[1] !== "id" && match[1] !== "parent") throw new Error(`${file}: front matter takes id and parent, not ${match[1]}`);
    fields[match[1]!] = match[2]!;
  }
  return { fields, text: text.slice(Math.min(text.length, close + 5)) };
}

/** The demo folder's notes, parents before children. A problem empties it and says why. */
export function readDemo(directory: string, folder: string | undefined): Demo {
  if (!folder) return { notes: [] };
  const root = join(directory, folder);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { notes: [], problem: `demo folder ${folder}/ isn't there` };
  const notes: DemoNote[] = [];
  try {
    const walk = (dir: string, parentKey: string | undefined): void => {
      const names = readdirSync(dir).filter((name) => !name.startsWith(".")).sort();
      for (const name of names) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) continue;
        if (!name.endsWith(".md")) continue;
        const file = relative(root, path).split(sep).join("/");
        if (statSync(path).size > MAX_NOTE_BYTES) throw new Error(`${file} is larger than 32 KiB`);
        const key = [...(parentKey ? [parentKey] : []), strip(name)].join("/");
        const { fields, text } = frontMatter(readFileSync(path, "utf8"), file);
        const id = fields.id ?? key;
        if (!ID.test(id)) throw new Error(`${file}: id ${id} is lowercase letters, digits, . _ / and -`);
        if (!text.trim()) throw new Error(`${file} has no text`);
        notes.push({ key, id, ...(fields.parent ? { parent: fields.parent } : parentKey ? { parent: parentKey } : {}), text: text.replace(/\n+$/, "") });
        if (notes.length > MAX_DEMO_NOTES) throw new Error(`more than ${MAX_DEMO_NOTES} notes`);
        // Its folder (board/ beside board.md) holds its children.
        const own = names.find((other) => other !== name && strip(other) === strip(name) && statSync(join(dir, other)).isDirectory());
        if (own) walk(join(dir, own), key);
      }
      // A folder with no note of its own: its notes nest where the folder sits.
      for (const name of names) {
        const path = join(dir, name);
        if (!statSync(path).isDirectory() || names.some((other) => other.endsWith(".md") && strip(other) === strip(name))) continue;
        walk(path, parentKey);
      }
    };
    walk(root, undefined);
    // `parent:` names an id; checked, and turned into a key, parents first.
    const byId = new Map<string, DemoNote>();
    for (const note of notes) {
      if (byId.has(note.id)) throw new Error(`two notes have the id ${note.id}`);
      byId.set(note.id, note);
    }
    const keyed = notes.map((note) => {
      if (!note.parent || notes.some((other) => other.key === note.parent && other.key !== note.key)) return note;
      const parent = byId.get(note.parent);
      if (!parent) throw new Error(`${note.key}: parent ${note.parent} is no note in the demo`);
      return { ...note, parent: parent.key };
    });
    const ordered: DemoNote[] = [];
    const placed = new Set<string>();
    for (let pass = 0; ordered.length < keyed.length; pass++) {
      if (pass > keyed.length) throw new Error(`a parent: loop among ${keyed.filter((note) => !placed.has(note.key)).map((note) => note.key).join(", ")}`);
      for (const note of keyed) {
        if (placed.has(note.key) || (note.parent && !placed.has(note.parent))) continue;
        ordered.push(note);
        placed.add(note.key);
      }
    }
    return { notes: ordered };
  } catch (error) {
    return { notes: [], problem: `demo: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with each reference to a demo id (`((id`, then `)`, `|`, `^` or `#`) pointing at the block it became. */
export function rewriteDemoReferences(text: string, ids: ReadonlyMap<string, string>): string {
  if (!ids.size || !text.includes("((")) return text;
  const names = [...ids.keys()].sort((a, b) => b.length - a.length).map(escape);
  return text.replace(new RegExp(`\\(\\((${names.join("|")})(?=[)|^#])`, "g"), (_, id: string) => `((${ids.get(id)}`);
}

/** Whether the text names a demo id (so it is written again once every id is minted). */
export function namesDemoIds(text: string, ids: Iterable<string>): boolean {
  for (const id of ids) if (new RegExp(`\\(\\(${escape(id)}(?=[)|^#])`).test(text)) return true;
  return false;
}
