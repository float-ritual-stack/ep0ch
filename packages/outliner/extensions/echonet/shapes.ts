// EchoNet's shapes (PIE-779): what each block is to the network, read from its properties alone. Pure, no I/O: the
// tosser (echonet.ts) and `ep0ch echo` (src/echo-cli.ts) read blocks with it, so both name the same things the same way.
//
//   an area      [echo::<name>] on a block with a query (a view, a board lane): its messages are its children, the
//                notes tagged [echo::<name>], and what its query matches (`parent:this OR echo=<name> OR <query>`)
//   a posting    [echo::<name>] on any other note: a message in that area (two values cross-post), even with no view
//   a subscription  [subscribe::<node mask> or @<list page>] [echo::<name or mask>], optionally [since::] and [cap::]
//   a source     [echo-source::<node>] under a subscription: one per node it reads, the copies under it
//   a copy       [from::<outline>@<machine>/<id>] …: never a message itself, so nothing bounces between nodes
//   EchoNet's own  [type::nodelist], [type::toss], [type::echo-ledger], [type::echo-undeliverable]

export interface Property { key: string; value: string }
export interface Block {
  id: string; parentId: string | null; text: string; revision: number; properties: Property[];
  createdAt?: string; updatedAt?: string;
  author?: string; actorId?: string; deletedAt?: string; effectiveDeletedRootId?: string;
}

/** A node's address: an outline on a machine (`pie@float-2`). */
export interface Node { readonly outline: string; readonly machine: string; readonly id: string }
export const nodeOf = (outline: string, machine: string): Node => ({ outline, machine, id: `${outline}@${machine}` });
export function parseNode(text: string | undefined): Node | undefined {
  const match = text?.trim().match(/^([a-z0-9][a-z0-9-]*)@([A-Za-z0-9][\w.-]*)$/);
  return match ? nodeOf(match[1]!, match[2]!) : undefined;
}
/** One machine, whatever domain it was named with (`float-2` and `float-2.tailnet.ts.net`). */
export const sameMachine = (a: string, b: string) => a.toLowerCase().split(".")[0] === b.toLowerCase().split(".")[0];

/** A copy's `from`: the node it came from and the note it copies there. */
export const FROM = /^([a-z0-9][a-z0-9-]*@[\w.-]+)\/([0-9a-f-]{36})$/;
export const OWN_TYPES: ReadonlySet<string> = new Set(["nodelist", "toss", "echo-ledger", "echo-undeliverable"]);

export const prop = (block: Block, key: string) => block.properties.find((p) => p.key === key)?.value;
/** Every value of a key: repeated tokens and comma lists (`[echo::a] [echo::b]`, `[echo::a, b]`). */
export const values = (block: Block, key: string) =>
  [...new Set(block.properties.filter((p) => p.key === key).flatMap((p) => p.value.split(",")).map((v) => v.trim()).filter(Boolean))];
/** A copy's `from` in EchoNet's shape (`<node>/<id>`), whatever other `from` the note holds (`[from::karen]`). */
export const fromOf = (block: Block) => block.properties.find((p) => p.key === "from" && FROM.test(p.value.trim()))?.value.trim();
export const isCopy = (block: Block) => fromOf(block) !== undefined;
export const trashed = (block: Block) => !!(block.effectiveDeletedRootId || block.deletedAt);

export type Kind = "copy" | "own" | "source" | "subscription" | "area" | "posting" | "other";
/** What a block is to EchoNet. A copy is a copy before anything else: it never posts, names an area or subscribes. */
export function kindOf(block: Block): Kind {
  if (isCopy(block)) return "copy";
  if (OWN_TYPES.has(prop(block, "type") ?? "")) return "own";
  if (prop(block, "echo-source") !== undefined) return "source";
  if (prop(block, "subscribe") !== undefined) return "subscription";
  if (!values(block, "echo").length) return "other";
  return prop(block, "query") !== undefined ? "area" : "posting";
}
/** A message: a note an area may carry. Never a copy, a view, a subscription or EchoNet's own. */
export const isMessage = (block: Block) => {
  const kind = kindOf(block);
  return (kind === "posting" || kind === "other") && prop(block, "query") === undefined && prop(block, "type") !== "virtual-branch";
};

/** A mask's `*` matches anything, dots included (`ep0ch.*`, `rexall-*`, `*`); the rest is literal, any case. */
export function glob(mask: string): RegExp {
  return new RegExp(`^${mask.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
}
export const hasStar = (mask: string) => mask.includes("*");

/**
 * What a subscription reads: a node mask (`pie@float-2`, `*@float-2`, `rexall-*@laptop`, `*@*`; with no `@`, any
 * machine), or a named list of nodes (`@<page>`: a page whose text and notes name nodes or masks).
 */
export type Mask = { readonly kind: "node"; readonly outline: string; readonly machine: string; readonly text: string } | { readonly kind: "list"; readonly page: string; readonly text: string };
export function parseMask(text: string): Mask | undefined {
  const t = text.trim();
  if (t.startsWith("@")) return t.length > 1 ? { kind: "list", page: t.slice(1), text: t } : undefined;
  const [outline, machine = "*", extra] = t.split("@");
  if (extra !== undefined || !outline || !/^[a-z0-9*][a-z0-9*-]*$/i.test(outline) || !/^[A-Za-z0-9*][\w.*-]*$/.test(machine)) return undefined;
  return { kind: "node", outline: outline.toLowerCase(), machine, text: t };
}
/** Node masks written in a list page's text: every `outline@machine` token, `*` allowed. */
export const masksIn = (text: string) => [...text.matchAll(/(?<![\w@*.-])([a-z0-9*][a-z0-9*-]*@[A-Za-z0-9*][\w*-]*(?:\.[\w*-]+)*)/gi)].map((m) => m[1]!);

/**
 * An area block's own messages in the views' grammar: its children and what its query matches. The notes tagged with
 * its name are the rest (`postsTo`, read from the same `echo` question that found the areas: a tag's value can be a
 * list, which a query's `echo=<name>` wouldn't match). What isn't a message is left out by `isMessage` after.
 */
export function areaQuery(area: Block): string {
  const query = prop(area, "query")?.trim();
  return query ? `parent:((${area.id})) OR (${query})` : `parent:((${area.id}))`;
}
/** Whether a note posts to the area `name` (one of its `echo` values, any case). */
export const postsTo = (block: Block, name: string) => values(block, "echo").some((value) => value.toLowerCase() === name.toLowerCase());

/** The areas a node offers, by name: the area blocks that name each (views, lanes) and whether notes post to it. */
export interface AreaEntry { readonly name: string; readonly blocks: Block[]; readonly postings: number }
/** Areas from the blocks that carry `echo` (a `blocks.query` for `echo`): copies, subscriptions and sources aren't. */
export function areasIn(tagged: readonly Block[]): Map<string, AreaEntry> {
  const areas = new Map<string, { name: string; blocks: Block[]; postings: number }>();
  const entry = (name: string) => {
    const key = name.toLowerCase();
    if (!areas.has(key)) areas.set(key, { name, blocks: [], postings: 0 });
    return areas.get(key)!;
  };
  for (const block of tagged) {
    if (trashed(block)) continue;
    const kind = kindOf(block);
    if (kind === "area") for (const name of values(block, "echo")) entry(name).blocks.push(block);
    else if (kind === "posting") for (const name of values(block, "echo")) entry(name).postings += 1;
  }
  return areas;
}

/** The first line without its properties: a note's title. */
export const firstLine = (text: string) => text.split("\n", 1)[0]!.replace(/\s*\[[A-Za-z][\w.-]*::[^\]]*\]/g, "").trim();

/** `[key::value]` set on a note's first line: replaced where it is, else added at its end; `undefined` takes it out. */
export function setHeaderProperty(text: string, key: string, value: string | undefined): string {
  const [head, ...rest] = text.split("\n");
  const pattern = new RegExp(`\\s*\\[${key.replace(/[.-]/g, "\\$&")}::[^\\]]*\\]`);
  let next: string;
  if (value === undefined) next = head!.replace(pattern, "");
  else {
    const token = `[${key}::${value}]`;
    next = pattern.test(head!) ? head!.replace(pattern, ` ${token}`).replace(/^ /, "") : `${head!.trimEnd()} ${token}`;
  }
  return [next, ...rest].join("\n");
}
