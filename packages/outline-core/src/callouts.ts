// Callouts (Obsidian's `> [!type]± title`, PIE-538): the one list of types and the one grammar every client
// draws, completes and rewrites them by. The service answers an outline's list (`callouts.types`: these
// built-ins plus the types the outline declares with `[callout-type::name]`); the door's reader, completer and
// type picker, and the outliner's Detail, all resolve a written type through it. Pure: no I/O.

/** A callout's colour family. Each client maps it to its own palette (the door's 16 colours, Detail's theme). */
export type CalloutTone = "blue" | "green" | "violet" | "amber" | "coral" | "neutral";
export const CALLOUT_TONES: readonly CalloutTone[] = ["blue", "green", "violet", "amber", "coral", "neutral"];

/**
 * One callout type: its name (what `[!name]` writes), the title a callout without one shows, its icon (one
 * terminal column), its tone, and the other names that mean it. `block`: the note that declares it, for a
 * type the outline adds (or restyles).
 */
export interface CalloutType { name: string; title: string; icon: string; tone: CalloutTone; aliases: readonly string[]; block?: string }

/** Obsidian's types and aliases (https://obsidian.md/help/callouts), in its order. */
export const BUILTIN_CALLOUTS: readonly CalloutType[] = [
  { name: "note", title: "Note", icon: "✎", tone: "blue", aliases: [] },
  { name: "abstract", title: "Abstract", icon: "≡", tone: "blue", aliases: ["summary", "tldr"] },
  { name: "info", title: "Info", icon: "ℹ", tone: "blue", aliases: [] },
  { name: "todo", title: "Todo", icon: "☐", tone: "blue", aliases: [] },
  { name: "tip", title: "Tip", icon: "✦", tone: "green", aliases: ["hint", "important"] },
  { name: "success", title: "Success", icon: "✓", tone: "green", aliases: ["check", "done"] },
  { name: "question", title: "Question", icon: "?", tone: "violet", aliases: ["help", "faq"] },
  { name: "warning", title: "Warning", icon: "⚠", tone: "amber", aliases: ["caution", "attention"] },
  { name: "failure", title: "Failure", icon: "✗", tone: "coral", aliases: ["fail", "missing"] },
  { name: "danger", title: "Danger", icon: "△", tone: "coral", aliases: ["error"] },
  { name: "bug", title: "Bug", icon: "※", tone: "coral", aliases: [] },
  { name: "example", title: "Example", icon: "◆", tone: "violet", aliases: [] },
  { name: "quote", title: "Quote", icon: "❝", tone: "neutral", aliases: ["cite"] },
];

/** A type nobody declared (`[!recipe]` with no `[callout-type::recipe]`): drawn, in neutral, under its own name. */
export const UNKNOWN_CALLOUT_ICON = "●";

/** The outline's callout types, each findable by its name or an alias, any case. */
export interface CalloutRegistry {
  readonly types: readonly CalloutType[];
  /** The type `name` (a name or an alias) means, or null when nothing declares it. */
  resolve(name: string): CalloutType | null;
  /** The type `name` means, or a neutral one under its own name: what a client draws for `[!name]`. */
  style(name: string): CalloutType;
}

/** The title a callout of a type nobody declared shows: its name in words (`my-type` → "My Type"). */
export const calloutTitleOf = (name: string) => name.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, l => l.toUpperCase());

/**
 * The registry of the built-ins and `custom` types. A custom type named as a built-in restyles it (its title, icon,
 * tone; its aliases are added); its other names are its own.
 */
export function calloutRegistry(custom: readonly CalloutType[] = []): CalloutRegistry {
  const types: CalloutType[] = BUILTIN_CALLOUTS.map(t => ({ ...t }));
  for (const c of custom) {
    const at = types.findIndex(t => t.name === c.name);
    if (at >= 0) types[at] = { ...types[at]!, ...c, aliases: [...new Set([...types[at]!.aliases, ...c.aliases])] };
    else types.push(c);
  }
  const by = new Map<string, CalloutType>();
  for (const t of types) by.set(t.name, t);
  for (const t of types) for (const a of t.aliases) if (!by.has(a)) by.set(a, t);
  const resolve = (name: string) => by.get(name.trim().toLowerCase()) ?? null;
  return {
    types,
    resolve,
    style: name => resolve(name) ?? { name: name.trim().toLowerCase(), title: calloutTitleOf(name.trim().toLowerCase()), icon: UNKNOWN_CALLOUT_ICON, tone: "neutral", aliases: [] },
  };
}

/** The built-ins alone: what a client draws with before (or without) the outline's list. */
export const BUILTIN_CALLOUT_REGISTRY = calloutRegistry();

// ── types the outline declares ────────────────────────────────────────────────

/** A callout type's name: a slug, as `[!name]` writes it. */
export const CALLOUT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Whether `icon` is one printable glyph a terminal draws one column wide (both clients frame callouts by columns):
 * one code point, no control character, nothing East Asian wide or an emoji.
 */
export function calloutIconFits(icon: string): boolean {
  const cps = [...icon];
  if (cps.length !== 1) return false;
  const c = cps[0]!.codePointAt(0)!;
  if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
  // Nothing that takes no column of its own: a combining mark, a zero-width space or joiner, a format character.
  if (/[\p{M}\p{Cf}\p{Z}]/u.test(cps[0]!)) return false;
  const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf && EMOJI_PRESENTATION.has(c));
  return !wide;
}
/** Symbols in the Miscellaneous Symbols and Dingbats blocks that terminals draw as two-column emoji. */
const EMOJI_PRESENTATION = new Set([0x2614, 0x2615, 0x2648, 0x2649, 0x264a, 0x264b, 0x264c, 0x264d, 0x264e, 0x264f, 0x2650, 0x2651, 0x2652, 0x2653, 0x267f, 0x2693, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa, 0x26fd, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27b0, 0x27bf]);

/** A note's properties, as the service lists them. */
export interface CalloutDeclaringBlock { id: string; properties: readonly { key: string; value: string }[] }

/**
 * The callout types an outline declares: each note with `[callout-type::name]`, and on the same note
 * `[callout-icon::♨]` (one column wide), `[callout-tone::green]` (blue, green, violet, amber, coral or neutral),
 * `[callout-title::Recipe]` and `[callout-aliases::dish, meal]`. What can't be used is said in `problems` and
 * left out (a bad icon or tone falls back), so one mistake never hides the rest. The first note to claim a name or
 * an alias has it.
 */
export function calloutTypesFromBlocks(blocks: readonly CalloutDeclaringBlock[]): { types: CalloutType[]; problems: string[] } {
  const types: CalloutType[] = [], problems: string[] = [];
  const taken = new Map<string, string>();
  for (const t of BUILTIN_CALLOUTS) for (const a of t.aliases) taken.set(a, t.name);
  for (const b of blocks) {
    const prop = (k: string) => b.properties.find(p => p.key.toLowerCase() === k)?.value.trim();
    const raw = prop("callout-type");
    if (raw === undefined) continue;
    const name = raw.toLowerCase(), where = `note ${b.id.slice(0, 8)}`;
    if (!CALLOUT_NAME.test(name)) { problems.push(`${where}: callout-type ${JSON.stringify(raw)} isn't a name (letters, digits, - and _)`); continue; }
    if (types.some(t => t.name === name)) { problems.push(`${where}: callout type ${name} is declared already`); continue; }
    if (taken.has(name)) { problems.push(`${where}: ${name} already means ${taken.get(name)}`); continue; }
    const base = BUILTIN_CALLOUTS.find(t => t.name === name);
    let icon = prop("callout-icon") ?? base?.icon ?? UNKNOWN_CALLOUT_ICON;
    if (!calloutIconFits(icon)) { problems.push(`${where}: callout-icon ${JSON.stringify(icon)} isn't one glyph one column wide`); icon = base?.icon ?? UNKNOWN_CALLOUT_ICON; }
    let tone = (prop("callout-tone") ?? base?.tone ?? "neutral").toLowerCase() as CalloutTone;
    if (!CALLOUT_TONES.includes(tone)) { problems.push(`${where}: callout-tone ${JSON.stringify(tone)} is one of ${CALLOUT_TONES.join(", ")}`); tone = base?.tone ?? "neutral"; }
    const aliases: string[] = [];
    for (const a of (prop("callout-aliases") ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) {
      if (!CALLOUT_NAME.test(a)) problems.push(`${where}: alias ${JSON.stringify(a)} isn't a name`);
      else if (taken.has(a) || BUILTIN_CALLOUTS.some(t => t.name === a) || types.some(t => t.name === a)) problems.push(`${where}: alias ${a} already means ${taken.get(a) ?? a}`);
      else { aliases.push(a); taken.set(a, name); }
    }
    taken.set(name, name);
    types.push({ name, title: prop("callout-title") || base?.title || calloutTitleOf(name), icon, tone, aliases, block: b.id });
  }
  return { types, problems };
}

// ── the grammar ───────────────────────────────────────────────────────────────

/** One level of blockquote at the start of a line, as CommonMark reads it. */
const QUOTE = /^[ \t]{0,3}>[ \t]?/;
/** A callout's first line, once its quote markers are taken off: `[!type]`, `+` or `-`, a title. */
export const CALLOUT_HEADER = /^\[!([^\]\r\n]+)\]([+-]?)(?:[ \t]+(.*?))?[ \t]*$/;

/** How many `>` a line starts with, and the rest. */
export function quoteDepth(line: string): { depth: number; content: string } {
  let depth = 0, rest = line;
  for (let m = QUOTE.exec(rest); m; m = QUOTE.exec(rest)) { rest = rest.slice(m[0].length); depth++; }
  return { depth, content: rest };
}

/** `line` without its first `n` levels of quote. */
export function stripQuotes(line: string, n: number): string {
  let rest = line;
  for (let i = 0; i < n; i++) { const m = QUOTE.exec(rest); if (!m) break; rest = rest.slice(m[0].length); }
  return rest;
}

/** A callout's header, as written: its type (lowercased), its `+` or `-`, its title (empty: the type's title). */
export interface CalloutHeader { type: string; fold: "+" | "-" | null; title: string }

/** The callout header `content` (a line without its quote markers) is, or null. */
export function parseCalloutHeader(content: string): CalloutHeader | null {
  const m = CALLOUT_HEADER.exec(content);
  const type = m?.[1]!.trim().toLowerCase();
  if (!m || !type) return null;
  return { type, fold: m[2] === "+" || m[2] === "-" ? m[2] : null, title: m[3]?.trim() ?? "" };
}

/**
 * Each callout in `lines`, outermost first in reading order: its header line, `end` (the line after its last), its
 * quote depth, and its header. A callout runs over the lines quoted at least as deep as its header, up to one
 * less deep or another callout's header at its depth; one inside it is quoted deeper (`> > [!warning]`). A line
 * inside a code fence (at any depth: ```` > ``` ```` opens one in a callout) is code, never a header. A line
 * without `>` ends a callout (no lazy continuation), as in Detail and the door alike.
 */
export interface CalloutBlock extends CalloutHeader { line: number; end: number; depth: number }
export function calloutBlocks(lines: readonly string[]): CalloutBlock[] {
  const q = lines.map(quoteDepth), out: CalloutBlock[] = [];
  const header = (i: number) => (q[i]!.depth && !fenced[i] ? parseCalloutHeader(q[i]!.content) : null);
  // Which lines are code: a fence opens at the depth its line is quoted to and closes there (or when the quote it's
  // in ends).
  const fenced: boolean[] = [];
  let fence: { depth: number; mark: string } | null = null;
  q.forEach(({ depth, content }, i) => {
    if (fence && depth < fence.depth) fence = null;
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(fence ? stripQuotes(lines[i]!, fence.depth) : content);
    if (fence) { fenced.push(true); if (m && m[1]![0] === fence.mark[0] && m[1]!.length >= fence.mark.length) fence = null; return; }
    fenced.push(false);
    if (m) fence = { depth, mark: m[1]! };
  });
  q.forEach(({ depth }, i) => {
    const h = header(i);
    if (!h) return;
    let end = i + 1;
    while (end < lines.length && q[end]!.depth >= depth && !(q[end]!.depth === depth && header(end))) end++;
    out.push({ ...h, line: i, end, depth });
  });
  return out;
}

/**
 * `line` (a callout's header) with its type and/or its `+`/`-` changed (`fold: null` takes the marker off), its
 * quote markers and title kept as written. Null when `line` isn't a callout header.
 */
export function rewriteCalloutHeader(line: string, change: { type?: string; fold?: "+" | "-" | null }): string | null {
  const { depth, content } = quoteDepth(line);
  const m = depth ? /^\[!([^\]\r\n]+)\]([+-]?)/.exec(content) : null;
  if (!m || !parseCalloutHeader(content)) return null;
  const prefix = line.slice(0, line.length - content.length);
  const type = change.type ?? m[1]!, fold = change.fold === undefined ? m[2]! : change.fold ?? "";
  return `${prefix}[!${type}]${fold}${content.slice(m[0].length)}`;
}

/**
 * The callout type being typed at column `col` of `line` (`> [!wa`, `> > [!`): where its `[!` starts, where a choice
 * replaces up to (through a `]` already there; a `+` or `-` after it stays), and what's typed. Null anywhere else.
 */
export function calloutTypeAtCursor(line: string, col: number): { start: number; end: number; query: string } | null {
  const before = line.slice(0, Math.max(0, Math.min(col, line.length)));
  const { depth, content } = quoteDepth(before);
  const m = depth ? /^\[!([^\]\s]*)$/.exec(content) : null;
  if (!m) return null;
  const start = before.length - content.length;
  const after = /^[^\]\s[]*\]/.exec(line.slice(before.length));
  return { start, end: before.length + (after ? after[0].length : 0), query: m[1]! };
}
