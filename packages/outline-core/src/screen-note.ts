// A screen as a note: `[type::screen]`, read to the one `ScreenSpec` every door opens (packages/native/docs/DESIGN.md §2).
//
// A screen note has two bodies, and both lower to the same validated spec:
//
// - **The JSON fence** (the door's, PIE-565): the spec as data in the note's first ```json fence.
// - **The block form**: child blocks, where nesting is the layout tree and each block's properties are its fields.
//
//       Garden work [type::screen] [screen::garden-work] [lands::reader] [focus::beds]
//         split row [ratio::0.3]
//           tile query [name::beds] [query::type=bed NOT stage=done] [select::reader]
//           tabs
//             tile reader [name::reader]
//             tile backlinks [name::links] [source::tile:reader] [subject::follows]
//         keys
//           ctrl+l [action::bar.open source=query]
//
//   A block's first words say what it is (`split row|col`, `tabs`, `dock <edge>`, `columns`, `flow`, `tile <kind>`);
//   its properties are the node's own fields as the saved layout names them (`ratio` or `weights`, `key`, `active`,
//   `open`, `source`), a container's policy by its policy keys, and a tile's `TileSpec` fields as written. A tile's
//   wires are properties named by their verb: `[select::reader]`, `[open::reader]`. `keys` holds one block a key: the
//   key's name, then `[action::<an act line>]`. `floats` holds tiles with `[rect::col row cols rows]`, and `policy`
//   the screen's own policy (`policy [locked::true]`); `newNote` holds what a new note does, one rule a block.
//
// Pure: the caller hands over the note and its children's text. `screens.list` (the outline host) is the one reader in
// the service; `screenNoteBlocks` is the one writer of the block form (`screens.save`).
import { actRequestOf, lineWords } from "./action-line";
import { codeBlocks } from "./code-fence";
import { headerLine } from "./header-line";
import { ALT_RULES, POLICY_KEYS, WIRE_VERBS, isDir, leafNames, policyOf, readSpec, savedNodes, screenNameProblem, screenSlug, type ScreenSpec } from "./screen-spec";

/** The property value that makes a block a screen note. */
export const SCREEN_TYPE = "screen";

/** A block as the reader takes one: its text, and the blocks under it in order. */
export interface NoteBlock { id: string; text: string; revision?: number; children?: readonly NoteBlock[] }

/** A screen note read: the screen's name and title, its note and revision, which body held it, and its spec. */
export interface ScreenNote { name: string; title: string; id: string; revision: number; form: "json" | "blocks"; spec: ScreenSpec }
/** A screen note that doesn't read: why, with the name it gives and its id. */
export interface ScreenNoteProblem { problem: string; name: string; id: string }

/** A block to write: its text, and the blocks under it. */
export interface WrittenBlock { text: string; children: WrittenBlock[] }

/** The words a tree block starts with. */
const NODE_WORDS = ["split", "tabs", "dock", "columns", "flow", "tile"] as const;
/** A leaf's fields the block form writes another way, or the layout keeps itself. */
const LEAF_SKIP = new Set(["t", "kind", "wires"]);

/** A property's value as data: `true`, `false`, a number, a quoted or JSON value as itself, anything else its words. */
function typed(value: string): unknown {
  const v = value.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if (/^["[{]/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

/** `typed`'s inverse: a value as a property writes it, words that would read as something else quoted. */
function written(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value);
  return value === "" || typed(value) !== value || value !== value.trim() || value.includes("\n") ? JSON.stringify(value) : value;
}

const numbers = (value: string): number[] => value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
const words = (value: string): string[] => value.trim().split(/[\s,]+/).filter(Boolean);

/** A block's first line, split: its words before the properties, and each property once (the last said). */
function head(block: NoteBlock): { words: string[]; props: Map<string, string> } {
  const h = headerLine(block.text);
  return { words: h.prose.replace(/^[-*]\s+/, "").trim().split(/\s+/).filter(Boolean), props: new Map(h.chips.map(c => [c.key, c.value] as const)) };
}

class Unread extends Error {}
const where = (block: NoteBlock) => `block ((${block.id}))`;

/** The policy among a block's properties: every policy key it names. */
function policyIn(props: Map<string, string>): Record<string, unknown> | undefined {
  const given: Record<string, unknown> = {};
  for (const k of POLICY_KEYS) if (props.has(k)) given[k] = k === "accepts" ? words(props.get(k)!) : typed(props.get(k)!);
  const policy = policyOf(given);
  return Object.keys(policy).length ? { ...policy } : undefined;
}

/** The object in a block's own ```json fence: the fields a property can't hold (a list, an object, a typed argument). */
function fenceOf(block: NoteBlock): Record<string, unknown> {
  const lines = block.text.split("\n"), fence = codeBlocks(lines).fences.find(f => f.closed && f.fence.info.trim() === "json");
  if (!fence) return {};
  let more: unknown;
  try { more = JSON.parse(lines.slice(fence.start + 1, fence.end).join("\n")); } catch (e) { throw new Unread(`${where(block)}: its \`\`\`json fence isn't JSON (${(e as Error).message})`); }
  return more && typeof more === "object" && !Array.isArray(more) ? more as Record<string, unknown> : {};
}

/** A `tile <kind>` block as a saved leaf: its properties are its fields, a wire verb's its wires. */
function leafOf(block: NoteBlock, h = head(block)): Record<string, unknown> {
  const kind = h.words[1];
  if (!kind) throw new Unread(`${where(block)} is a tile with no kind: write tile <kind>, as in tile reader [name::reader]`);
  const leaf: Record<string, unknown> = { t: "leaf", kind };
  const wires: { verb: string; to: string; rule?: string }[] = [];
  for (const [key, value] of h.props) {
    if ((WIRE_VERBS as readonly string[]).includes(key)) {
      // A selection may feed several tiles; an open lands in one, by a rule when it says one.
      const [to, rule, ...more] = words(value);
      if (!to) throw new Unread(`${where(block)}: [${key}::] names the tile it sends to, as in [${key}::reader]`);
      if (key === "select") for (const each of [to, ...(rule ? [rule] : []), ...more]) wires.push({ verb: key, to: each });
      else wires.push({ verb: key, to, ...(rule && (ALT_RULES as readonly string[]).includes(rule) ? { rule } : {}) });
    } else leaf[key] = typed(value);
  }
  if (wires.length) leaf.wires = wires;
  for (const [k, v] of Object.entries(fenceOf(block))) if (!LEAF_SKIP.has(k)) leaf[k] = v;
  return leaf;
}

/** A tree block as a saved node (the form written with `kids`). */
function nodeOf(block: NoteBlock): Record<string, unknown> {
  const h = head(block), kind = h.words[0];
  const kids = (block.children ?? []).filter(isNode);
  const strays = (block.children ?? []).filter(c => !isNode(c) && c.text.trim());
  const own = (keys: readonly string[]) => Object.fromEntries(keys.filter(k => h.props.has(k)).map(k => [k, typed(h.props.get(k)!)]));
  // What a container remembers that no property holds (a flow's wide column, a dock's view) is its own json fence.
  const meta = { ...(kind === "tile" ? {} : fenceOf(block)), ...own(["id", "key"]), ...(policyIn(h.props) ? { policy: policyIn(h.props) } : {}) };
  if (kind === "tile") {
    if (kids.length) throw new Unread(`${where(block)} is a tile with blocks under it: a tile holds none (a tabs block holds tiles)`);
    return leafOf(block, h);
  }
  if (strays.length) throw new Unread(`${where(strays[0]!)} reads ${JSON.stringify(head(strays[0]!).words.join(" "))}: under a ${kind} go ${NODE_WORDS.map(w => (w === "tile" ? "tile <kind>" : w)).join(", ")}`);
  if (kind === "tabs") {
    const bad = kids.find(k => head(k).words[0] !== "tile");
    if (bad) throw new Unread(`${where(bad)}: a tabs block holds tiles, one a tab`);
    return { t: "tabs", tabs: kids.map(k => leafOf(k)), active: Number.isInteger(typed(h.props.get("active") ?? "0")) ? typed(h.props.get("active") ?? "0") : 0, ...meta };
  }
  if (kind === "dock") {
    const edge = h.words[1];
    if (!isDir(edge)) throw new Unread(`${where(block)}: a dock names its edge: dock left, right, up or down`);
    if (kids.length !== 1) throw new Unread(`${where(block)}: a dock holds one block (a tile, or a container of them), not ${kids.length}`);
    return { t: "dock", edge, open: typed(h.props.get("open") ?? "false") === true, kid: nodeOf(kids[0]!), ...(typed(h.props.get("keeps") ?? "") === true ? { keeps: true } : {}), ...meta };
  }
  // A container filled later (columns from its source, a keyed row or flow by what opens into it) may start empty.
  if (!kids.length && kind === "split" && !h.props.has("key")) throw new Unread(`${where(block)}: a split holds the blocks under it, and has none`);
  if (kind === "flow") return { t: "flow", kids: kids.map(nodeOf), ...meta };
  const weights = h.props.has("weights") ? numbers(h.props.get("weights")!) : h.props.has("ratio") && kids.length === 2 ? [Number(h.props.get("ratio")), 1 - Number(h.props.get("ratio"))] : kids.map(() => 1 / kids.length);
  if (kids.length && (weights.length !== kids.length || !weights.every(w => Number.isFinite(w) && w > 0))) throw new Unread(`${where(block)}: its shares are one positive number a block under it (${kids.length}), as in [weights::${kids.map(() => (1 / kids.length).toFixed(2)).join(" ")}]`);
  if (kind === "columns") return { t: "columns", kids: kids.map(nodeOf), weights: kids.length ? weights : [], ...own(["source"]), ...meta };
  const dir = h.words[1] ?? "row";
  if (dir !== "row" && dir !== "col") throw new Unread(`${where(block)}: a split runs row (side by side) or col (stacked), not ${dir}`);
  return { t: "split", dir, kids: kids.map(nodeOf), weights: kids.length ? weights : [], ...(typed(h.props.get("pair") ?? "") === true ? { pair: true } : {}), ...meta };
}

const isNode = (block: NoteBlock): boolean => (NODE_WORDS as readonly string[]).includes(head(block).words[0] ?? "");

/** A `keys` block's children as key bindings: the key's name, then the act line it runs. */
function keysOf(block: NoteBlock): Record<string, unknown>[] {
  return (block.children ?? []).filter(c => c.text.trim()).map(c => {
    const h = head(c), key = h.words.join(" ");
    const line = h.props.get("action");
    if (!line) throw new Unread(`${where(c)}: key ${key || "(none)"} names no action: write [action::<an act line>], as in ctrl+l [action::bar.open source=query]`);
    let request;
    try { request = actRequestOf(lineWords(line)); } catch (e) { throw new Unread(`${where(c)}: key ${key}'s action doesn't read as an act line (${(e as Error).message})`); }
    const list = (k: string) => (h.props.has(k) ? { [k]: words(h.props.get(k)!) } : {});
    const tile = h.props.get("tile") ?? request.tile;
    // Arguments that aren't words (a number, a flag) are the key block's own json fence.
    const args = { ...request.args, ...fenceOf(c) };
    return {
      key, action: request.action, ...(Object.keys(args).length ? { args } : {}),
      ...(h.props.has("label") ? { label: h.props.get("label") } : {}), ...(h.props.has("says") ? { says: h.props.get("says") } : {}),
      ...(tile !== undefined ? { tile } : {}), ...list("only"), ...list("unless"),
    };
  });
}

/** A `floats` block's children as saved floats: a tile and its rectangle. */
function floatsOf(block: NoteBlock): Record<string, unknown>[] {
  return (block.children ?? []).filter(c => c.text.trim()).map(c => {
    const h = head(c);
    if (h.words[0] !== "tile") throw new Unread(`${where(c)}: a float is a tile: tile <kind> [rect::col row cols rows]`);
    const [col, row, cols, rows] = numbers(h.props.get("rect") ?? "");
    if (![col, row, cols, rows].every(n => Number.isFinite(n))) throw new Unread(`${where(c)}: a float says where it sits: [rect::col row cols rows]`);
    const peekOf = h.props.get("peekOf");
    h.props.delete("rect"); h.props.delete("peekOf");
    return { tile: leafOf(c, h), rect: { col, row, cols, rows }, ...(peekOf ? { peekOf } : {}) };
  });
}

/** A `newNote` block's children as rules: `opens <where>` or `action <name>`, for the tile kinds it says. */
function newNoteOf(block: NoteBlock): Record<string, unknown>[] {
  return (block.children ?? []).filter(c => c.text.trim()).map(c => {
    const h = head(c), [word, value] = h.words, args = fenceOf(c);
    if ((word !== "opens" && word !== "action") || !value) throw new Unread(`${where(c)}: a new note's rule is opens <where> or action <name>, as in opens tab [only::reader]`);
    const list = (k: string) => (h.props.has(k) ? { [k]: words(h.props.get(k)!) } : {});
    return { [word]: value, ...(Object.keys(args).length ? { args } : {}), ...list("only"), ...list("unless") };
  });
}

/** The spec's own fields a screen note's header carries as properties. */
const SPEC_TEXT = ["lands", "home", "band", "fresh", "saves", "hint"] as const;

/**
 * The block form lowered: the data `readSpec` takes, from the note's header properties and the blocks under it. Throws
 * `Unread` with the block and what is wrong.
 */
function lowered(note: NoteBlock, name: string, title: string): Record<string, unknown> {
  const h = head(note), kids = (note.children ?? []).filter(c => c.text.trim());
  const roots = kids.filter(isNode), keys = kids.filter(c => head(c).words[0] === "keys"), floats = kids.filter(c => head(c).words[0] === "floats");
  // The screen's own policy is a block of its own (`policy [locked::true]`): `stays` in the header is the spec's field.
  // Its hint row: one for the screen (`hint`, then its words on the next line), or one a tile kind under `hints`.
  const rest = (c: NoteBlock) => c.text.split("\n").slice(1).join("\n").trim();
  const hint = kids.find(c => head(c).words[0] === "hint"), hints = kids.find(c => head(c).words[0] === "hints");
  const hintMap = hints ? Object.fromEntries((hints.children ?? []).filter(c => c.text.trim()).map(c => [c.text.split("\n")[0]!.trim(), rest(c)])) : undefined;
  const policies = kids.filter(c => head(c).words[0] === "policy"), newNotes = kids.filter(c => head(c).words[0] === "newNote");
  if (!roots.length) throw new Unread(`has no layout under it: its first block is a split, tabs, dock, columns, flow or tile <kind>`);
  if (roots.length > 1) throw new Unread(`has ${roots.length} layouts under it (${roots.map(r => `((${r.id}))`).join(", ")}): a screen has one root · put them under a split`);
  const policy = policies.length ? policyIn(new Map(policies.flatMap(c => [...head(c).props]))) : undefined;
  const menu = h.props.get("menu")?.trim();
  return {
    name, title,
    layout: {
      root: nodeOf(roots[0]!),
      ...(h.props.has("focus") ? { focus: h.props.get("focus") } : {}), ...(h.props.has("rule") ? { rule: h.props.get("rule") } : {}),
      ...(h.props.has("layout") ? { name: h.props.get("layout") } : {}), ...(policy ? { policy } : {}), ...(floats.length ? { floats: floats.flatMap(floatsOf) } : {}),
    },
    ...(keys.length ? { keys: keys.flatMap(keysOf) } : {}), ...(newNotes.length ? { newNote: newNotes.flatMap(newNoteOf) } : {}),
    ...Object.fromEntries(SPEC_TEXT.filter(k => h.props.has(k)).map(k => [k, h.props.get(k)!])),
    ...(hint ? { hint: rest(hint) } : {}), ...(hintMap ? { hint: hintMap } : {}),
    ...(h.props.get("frame") === "dotted" ? { frame: "dotted" } : {}), ...(h.props.get("digits") === "false" ? { digits: false } : {}),
    ...(h.props.get("layouts") === "true" ? { layouts: true } : {}), ...(h.props.get("stays") === "true" ? { stays: true } : {}),
    ...(menu ? { menu: { key: [...menu][0], label: menu.slice([...menu][0]!.length).trim() } } : {}),
  };
}

/** The name a screen note gives its screen, and its title: its `screen::` property, else its title's slug. */
export function screenNoteName(text: string): { name: string; title: string } {
  const h = headerLine(text), heading = h.prose.trim();
  const name = (h.chips.filter(c => c.key === SCREEN_TYPE).at(-1)?.value ?? "").trim() || screenSlug(heading) || heading;
  // Its title is the note's own when that makes this name (renaming the property renames the screen, title and all).
  return { name, title: heading && screenSlug(heading) === name ? heading : name };
}

/**
 * A screen note read to its spec, from whichever body it has: the JSON fence when the note holds one (the door's
 * form), else the blocks under it. `isKind`: which tile kinds exist, when the caller checks them.
 */
export function readScreenNote(note: NoteBlock, isKind?: (kind: string) => boolean): ScreenNote | ScreenNoteProblem {
  const { name, title } = screenNoteName(note.text);
  const said = `the screen note ((${note.id}))`;
  const wrong = (problem: string): ScreenNoteProblem => ({ problem, name, id: note.id });
  const bad = screenNameProblem(name);
  if (bad) return wrong(`${said}: ${bad} · set its [${SCREEN_TYPE}::…]`);
  const lines = note.text.split("\n");
  const json = codeBlocks(lines).fences.find(f => f.closed && f.fence.info.trim() === "json");
  let data: unknown, form: ScreenNote["form"];
  if (json) {
    form = "json";
    try { data = JSON.parse(lines.slice(json.start + 1, json.end).join("\n")); } catch (e) { return wrong(`${said} (${name}): its layout isn't JSON (${(e as Error).message})`); }
    data = { ...(data && typeof data === "object" ? data : {}), name, title };
  } else if ((note.children ?? []).some(c => c.text.trim())) {
    form = "blocks";
    try { data = lowered(note, name, title); } catch (e) { if (!(e instanceof Unread)) throw e; return wrong(`${said} (${name}): ${e.message.startsWith("block ") ? e.message : `it ${e.message}`}`); }
  } else return wrong(`${said} (${name}) has no layout: neither blocks under it (a split, tabs, a tile …) nor a \`\`\`json fence · save the screen again to write one`);
  try { return { name, title, id: note.id, revision: note.revision ?? 0, form, spec: readSpec(data, isKind) }; }
  catch (e) { return wrong(`${said}: ${(e as Error).message}`); }
}

/** What a spec names by name that its layout hasn't: a wire's target, the tile a source follows. Each said for its tile. */
export function addressProblems(spec: ScreenSpec): { tile?: string; said: string }[] {
  const names = new Set(leafNames(spec.layout.root).concat((spec.layout.floats ?? []).flatMap(f => (typeof f.tile.name === "string" ? [f.tile.name] : []))));
  const out: { tile?: string; said: string }[] = [];
  const leaves = [...savedNodes(spec.layout.root), ...(spec.layout.floats ?? []).map(f => f.tile)].filter(n => n?.t === "leaf");
  for (const leaf of leaves) {
    const tile = typeof leaf.name === "string" ? leaf.name : undefined, label = tile ?? `a ${leaf.kind} tile`;
    for (const w of Array.isArray(leaf.wires) ? leaf.wires : []) {
      // A name with a slash is another screen's tile (`board/detail`): not this layout's to hold.
      if (typeof w?.to === "string" && !names.has(w.to) && !w.to.includes("/")) out.push({ ...(tile ? { tile } : {}), said: `${label} sends its ${w.verb} to ${w.to}, a tile this screen hasn't` });
    }
    const follows = typeof leaf.source === "string" && leaf.source.startsWith("tile:") ? leaf.source.slice(5) : undefined;
    if (follows !== undefined && !names.has(follows)) out.push({ ...(tile ? { tile } : {}), said: `${label} follows tile ${follows}, which this screen hasn't` });
  }
  if (typeof spec.layout.focus === "string" && !names.has(spec.layout.focus)) out.push({ said: `its focus is ${spec.layout.focus}, a tile it hasn't: the first tile takes the keys` });
  return out;
}

// ── writing the block form ──

const chip = (key: string, value: unknown) => `[${key}::${written(value)}]`;
const policyChips = (policy: unknown): string[] => Object.entries(policyOf(policy)).map(([k, v]) => chip(k, Array.isArray(v) ? v.join(" ") : v));
const share = (w: number) => String(w);

/** A value a property can hold: one line with no `]` in it. */
const fitsChip = (value: unknown) => !/[\]\n]/.test(written(value));

function leafBlock(leaf: Record<string, unknown>, extra: string[] = []): WrittenBlock {
  const own = Object.entries(leaf).filter(([k, v]) => !LEAF_SKIP.has(k) && v !== undefined);
  const fields = own.filter(([, v]) => fitsChip(v)).map(([k, v]) => chip(k, v)), rest = own.filter(([, v]) => !fitsChip(v));
  const byVerb = new Map<string, string[]>();
  for (const w of (Array.isArray(leaf.wires) ? leaf.wires : []) as { verb: string; to: string; rule?: string }[]) byVerb.set(w.verb, [...(byVerb.get(w.verb) ?? []), w.rule ? `${w.to} ${w.rule}` : w.to]);
  const first = [`tile ${String(leaf.kind)}`, ...fields, ...[...byVerb].map(([verb, to]) => chip(verb, to.join(" "))), ...extra].join(" ");
  return { text: rest.length ? [first, "```json", JSON.stringify(Object.fromEntries(rest), null, 2), "```"].join("\n") : first, children: [] };
}

/** A container's fields its block writes as words and properties: the rest is its json fence. */
const NODE_WRITTEN = new Set(["t", "kids", "tabs", "kid", "a", "b", "weights", "ratio", "dir", "edge", "open", "keeps", "id", "key", "policy", "pair", "active", "source"]);

function nodeBlock(n: any): WrittenBlock {
  if (!n || typeof n !== "object" || n.t === "leaf") return leafBlock(n ?? { kind: "blank" });
  const made = containerBlock(n), rest = Object.fromEntries(Object.entries(n).filter(([k, v]) => !NODE_WRITTEN.has(k) && v !== undefined));
  return Object.keys(rest).length ? { ...made, text: [made.text, "```json", JSON.stringify(rest), "```"].join("\n") } : made;
}

function containerBlock(n: any): WrittenBlock {
  const meta = [...(typeof n.id === "string" ? [chip("id", n.id)] : []), ...(typeof n.key === "string" ? [chip("key", n.key)] : []), ...policyChips(n.policy)];
  if (n.t === "tabs") return { text: ["tabs", ...(n.active ? [chip("active", n.active)] : []), ...meta].join(" "), children: (n.tabs ?? []).map((l: Record<string, unknown>) => leafBlock(l)) };
  if (n.t === "dock") return { text: [`dock ${n.edge}`, chip("open", n.open === true), ...(n.keeps ? [chip("keeps", true)] : []), ...meta].join(" "), children: [nodeBlock(n.kid)] };
  if (n.t === "flow") return { text: ["flow", ...meta].join(" "), children: (n.kids ?? []).map(nodeBlock) };
  // The older two-kid form says its first share; both are written as weights, one a kid.
  const kids: any[] = Array.isArray(n.kids) ? n.kids : [n.a, n.b];
  const weights: number[] = Array.isArray(n.weights) ? n.weights : [n.ratio ?? 0.5, 1 - (n.ratio ?? 0.5)];
  // Two kids whose shares are one number and what is left of one say that number; anything else says each share.
  const shares = kids.length === 2 && weights[1] === 1 - weights[0]! ? chip("ratio", weights[0]) : `[weights::${weights.map(share).join(" ")}]`;
  if (n.t === "columns") return { text: ["columns", ...(kids.length ? [`[weights::${weights.map(share).join(" ")}]`] : []), ...(n.source ? [chip("source", n.source)] : []), ...meta].join(" "), children: kids.map(nodeBlock) };
  return { text: [`split ${n.dir === "col" ? "col" : "row"}`, ...(kids.length ? [shares] : []), ...(n.pair ? [chip("pair", true)] : []), ...meta].join(" "), children: kids.map(nodeBlock) };
}

/**
 * A spec as a screen note in the block form: its header (title, `[type::screen]`, its name and its own fields), then
 * the layout tree, its keys and its floats as blocks. What `readScreenNote` reads back to the same spec.
 */
export function screenNoteBlocks(spec: ScreenSpec): WrittenBlock {
  const title = spec.title && screenSlug(spec.title) === spec.name ? spec.title.trim() : spec.name;
  const s = spec as unknown as Record<string, unknown>, layout = spec.layout;
  const header = [
    title, chip("type", SCREEN_TYPE), chip(SCREEN_TYPE, spec.name),
    ...(typeof layout.focus === "string" ? [chip("focus", layout.focus)] : []), ...(layout.rule ? [chip("rule", layout.rule)] : []),
    ...SPEC_TEXT.filter(k => k !== "hint" && typeof s[k] === "string").map(k => chip(k, s[k])),
    ...(spec.frame ? [chip("frame", spec.frame)] : []), ...(spec.digits === false ? [chip("digits", false)] : []),
    ...(spec.layouts ? [chip("layouts", true)] : []), ...(spec.stays ? [chip("stays", true)] : []),
    ...(typeof layout.name === "string" ? [chip("layout", layout.name)] : []), ...(spec.menu ? [chip("menu", `${spec.menu.key} ${spec.menu.label}`)] : []),
  ].join(" ");
  const policy = policyChips(layout.policy);
  const keys: WrittenBlock[] = (spec.keys ?? []).map(b => {
    const args = Object.entries(b.args ?? {}), worded = args.filter(([, v]) => typeof v === "string" && !/[\]\n]/.test(v)), rest = args.filter(a => !worded.includes(a));
    const line = [b.key, chip("action", [b.action, ...worded.map(([k, v]) => `${k}=${/[\s"'\\]/.test(v as string) || v === "" ? JSON.stringify(v) : v}`)].join(" ")),
      ...(b.label ? [chip("label", b.label)] : []), ...(b.says ? [chip("says", b.says)] : []), ...(b.tile ? [chip("tile", b.tile)] : []),
      ...(b.only ? [chip("only", b.only.join(" "))] : []), ...(b.unless ? [chip("unless", b.unless.join(" "))] : [])].join(" ");
    return { text: rest.length ? [line, "```json", JSON.stringify(Object.fromEntries(rest)), "```"].join("\n") : line, children: [] };
  });
  const floats: WrittenBlock[] = (layout.floats ?? []).map(f => leafBlock(f.tile as unknown as Record<string, unknown>, [`[rect::${[f.rect.col, f.rect.row, f.rect.cols, f.rect.rows].join(" ")}]`, ...(f.peekOf ? [chip("peekOf", f.peekOf)] : [])]));
  const fenced = (line: string, rest: object) => (Object.keys(rest).length ? [line, "```json", JSON.stringify(rest), "```"].join("\n") : line);
  const newNote: WrittenBlock[] = (spec.newNote ?? []).map(r => ({ text: fenced([r.opens !== undefined ? `opens ${r.opens}` : `action ${r.action}`, ...(r.only ? [chip("only", r.only.join(" "))] : []), ...(r.unless ? [chip("unless", r.unless.join(" "))] : [])].join(" "), r.args ?? {}), children: [] }));
  const hint: WrittenBlock[] = typeof spec.hint === "string" ? [{ text: `hint\n${spec.hint}`, children: [] }]
    : spec.hint ? [{ text: "hints", children: Object.entries(spec.hint).map(([kind, said]) => ({ text: `${kind}\n${said}`, children: [] })) }] : [];
  return { text: header, children: [nodeBlock(layout.root), ...hint, ...(newNote.length ? [{ text: "newNote", children: newNote }] : []), ...(policy.length ? [{ text: ["policy", ...policy].join(" "), children: [] }] : []), ...(keys.length ? [{ text: "keys", children: keys }] : []), ...(floats.length ? [{ text: "floats", children: floats }] : [])] };
}
