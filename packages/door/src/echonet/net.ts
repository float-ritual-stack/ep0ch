// EchoNet (PIE-779): outlines as nodes on a FidoNet-style store-and-forward network. The tosser (the outliner's echonet
// extension) copies an area's messages from the outline it starts in (its origin) into each outline subscribed to it;
// this module is how the door reads those shapes. Pure: no I/O. The shapes are the extension's
// (packages/outliner/extensions/echonet/shapes.ts), and nothing else is assumed of a block:
//
//   an area:          [echo::<name>] on a block with a [query::…] (a view, a board lane): its messages are its children,
//                     what its query matches, and the notes tagged [echo::<name>]; a name only posted to is an area too
//   a posting:        [echo::<name>] on any other note (two values cross-post)
//   a subscription:   [subscribe::<mask>] [echo::<name or mask>]; under it a source board per node it reads,
//                     `<node> [echo-source::<node>]` (`[waiting::n]` while more wait), the copies under the board
//   a copy:           [from::<outline>@<machine>/<id>] [echo::<name>] [from-rev::n] [tossed::<iso>] ([upstream-newer::n],
//                     [upstream-gone::<day>]); never a message itself
//   seen-by:          a whole-note mark on the original per node it reached ([kind::echo-seen-by] [echo.node::…])
//   the nodelist:     [type::nodelist] [node::…] [last-toss::…], a `## <node>` section per node it knows (its state,
//                     netmail held, last toss, areas), its children the toss logs ([type::toss] [at::…] [copies::n] …)
//
// Every list is a query in the views' grammar the service answers (`blocks.query` `where`), never a scan of children
// in the door, and unread is the read marks' `unread:me`. A tag's value can be a list (`[echo::a, b]`), which a query's
// `echo=<name>` wouldn't match, so the tagged notes are the `echo` question's, filtered here.
import { subject, type Msg } from "../board";
import { ago, bbsDate } from "../text";

export const NODELIST = "nodelist";
export const TOSS = "toss";
/** A seen-by mark's kind: the tosser's whole-note mark on an original, one per node it reached. */
export const SEEN_BY = "echo-seen-by";
/** EchoNet's own notes: never a message. */
const OWN_TYPES: ReadonlySet<string> = new Set([NODELIST, TOSS, "echo-ledger", "echo-undeliverable"]);
/** Every note carrying a tag (areas, postings), every subscription, every source board: what an outline's areas are made of. */
export const TAGGED_QUERY = "echo";
export const SUBSCRIPTIONS_QUERY = "subscribe";
export const SOURCES_QUERY = "echo-source";
export const NODELIST_QUERY = `type=${NODELIST}`;
/** A nodelist's toss logs. */
export const tossesQuery = (nodelist: string) => `parent:((${nodelist})) type=${TOSS}`;

/** `outline@machine`: a node's address. */
export const nodeName = (outline: string, machine: string) => `${outline}@${machine}`;

/** `outline@machine/id` (a copy's `from`): the node it came from and the block it copies there. */
export function parseFrom(s: string | undefined): { node: string; id: string } | null {
  const m = /^\s*([a-z0-9][a-z0-9-]*@[A-Za-z0-9._-]+)\/([0-9a-f-]{36})\s*$/i.exec(s ?? "");
  return m ? { node: m[1]!, id: m[2]! } : null;
}

/** Every value of a key: repeated tokens and comma lists. */
export function values(m: Msg, key: string): string[] {
  const raw = m.properties?.filter(p => p.key === key).map(p => p.value) ?? (m.props[key] !== undefined ? [m.props[key]!] : []);
  return [...new Set(raw.flatMap(v => v.split(",")).map(v => v.trim()).filter(Boolean))];
}
/** A copy's `from` in EchoNet's shape, whatever other `from` the note holds (`[from::karen]`). */
export const fromOf = (m: Msg): { node: string; id: string } | null => {
  for (const v of m.properties?.filter(p => p.key === "from").map(p => p.value) ?? [m.props.from ?? ""]) { const f = parseFrom(v); if (f) return f; }
  return null;
};
const has = (m: Msg, key: string) => m.props[key] !== undefined;
/** A message: a note an area may carry. Never a copy, a view, a subscription, a source board or EchoNet's own. */
export const isMessage = (m: Msg) =>
  !fromOf(m) && !OWN_TYPES.has(m.props.type?.trim() ?? "") && !has(m, "echo-source") && !has(m, "subscribe") && !has(m, "query") && m.props.type?.trim() !== "virtual-branch";
/** Whether a note posts to the area `name` (one of its `echo` values, any case). */
export const postsTo = (m: Msg, name: string) => values(m, "echo").some(v => v.toLowerCase() === name.toLowerCase());

export type AreaKind = "local" | "sub";

/** An echo area as a reader sees it: where it is read, where it comes from, and the questions that list its messages. */
export interface Area {
  /** Unique across outlines: the node it's read at and its name or board. */
  key: string;
  /** The outline holding it (where its messages are read), and that outline as a node. */
  outline: string;
  node: string;
  /** The block it is read from: a local area's first view (null when it's only posted to), a subscription's source board. */
  block: Msg | null;
  /** `local`: this outline is its origin; `sub`: a source board of a subscription, its messages copies. */
  kind: AreaKind;
  /** Its name (`[echo::…]`), as written; a subscription's names, joined. */
  tag: string;
  /** Its title: the view's, or the subscription's; the tag when it's only posted to. */
  name: string;
  /** The node it comes from: a source board's node, a local area's own node. */
  origin: string;
  /** Its messages in the views' grammar (a view's `parent:((id)) OR (<query>)`; a board's copies). */
  queries: string[];
  /** The name whose tagged notes are its messages too (a local area's), else null. */
  tagged: string | null;
  /** Messages in it, new to the person, and the last time one was tossed in (null until counted). */
  total: number | null;
  fresh: number | null;
  lastToss: number | null;
  /** How many more the origin has for it than the last toss brought (a source board's `[waiting::n]`). */
  waiting: number | null;
  /** Why it can't be read, shown on its row. */
  problem?: string;
}

/**
 * The areas an outline holds, from three questions: the notes carrying a tag (`TAGGED_QUERY`), its subscriptions
 * (`SUBSCRIPTIONS_QUERY`) and their source boards (`SOURCES_QUERY`). Local areas by name (each view naming it, and the
 * notes posting to it), then each source board.
 */
export function areasIn(tagged: readonly Msg[], subscriptions: readonly Msg[], sources: readonly Msg[], outline: string, machine: string): Area[] {
  const node = nodeName(outline, machine), out: Area[] = [];
  const local = new Map<string, Area>();
  const entry = (tag: string): Area => {
    const k = tag.toLowerCase();
    let a = local.get(k);
    if (!a) {
      a = { key: `${node}/area:${k}`, outline, node, block: null, kind: "local", tag, name: tag, origin: node, queries: [], tagged: tag, total: null, fresh: null, lastToss: null, waiting: null };
      local.set(k, a);
    }
    return a;
  };
  for (const b of tagged) {
    if (b.deleted || fromOf(b) || has(b, "subscribe") || has(b, "echo-source") || OWN_TYPES.has(b.props.type?.trim() ?? "")) continue;
    const query = b.props.query?.trim();
    for (const tag of values(b, "echo")) {
      const a = entry(tag);
      if (query === undefined) continue;
      a.queries.push(query ? `parent:((${b.id})) OR (${query})` : `parent:((${b.id}))`);
      if (!a.block) { a.block = b; a.name = subject(b) || tag; }
    }
  }
  out.push(...[...local.values()].sort((a, b) => a.tag.localeCompare(b.tag)));
  const subs = new Map(subscriptions.map(s => [s.id, s]));
  for (const board of sources) {
    const from = board.props["echo-source"]?.trim(), sub = board.parentId ? subs.get(board.parentId) : undefined;
    if (!from || !sub || board.deleted || sub.deleted) continue;
    const waiting = Number(board.props.waiting);
    out.push({
      key: `${node}/${board.id}`, outline, node, block: board, kind: "sub", tag: values(sub, "echo").join(",") || "?", name: subject(sub) || from,
      origin: from, queries: [`parent:((${board.id})) from`], tagged: null, total: null, fresh: null, lastToss: null,
      waiting: Number.isFinite(waiting) && waiting > 0 ? waiting : null,
    });
  }
  return out;
}

/** A query's messages new to the person: the same query, unread by them (the read marks). */
export const unreadOf = (query: string) => `(${query}) unread:me`;

/** When a message arrived: a copy's `tossed`, else when it was written. */
export function arrived(m: Msg): number {
  const t = Date.parse(m.props.tossed ?? "");
  return Number.isFinite(t) ? t : m.createdAt;
}

/** Messages in arrival order, oldest first: message 1 is the first that came in, as a BBS numbers them. */
export const inArrivalOrder = (list: readonly Msg[]): Msg[] => [...list].sort((a, b) => arrived(a) - arrived(b) || a.createdAt - b.createdAt);

/**
 * Who wrote it: its `by` or `author`, if it says; a copy (written by the tosser) by the outline it came from; else who
 * wrote the block, the person being the sysop.
 */
export function messageFrom(m: Msg): string {
  const said = m.props.by?.trim() || m.props.author?.trim(), from = fromOf(m);
  if (said) return said;
  if (from) return from.node.split("@")[0]!;
  return !m.author || m.author === "user" ? "sysop" : m.author;
}

/** The node a message came from: a copy's `from`, else the area's own node. */
export const originOf = (m: Msg, area: Area): string => fromOf(m)?.node ?? (area.kind === "local" ? area.node : area.origin);

/** The nodes the seen-by marks on a message name (the tosser's, on an original), sorted as a SEEN-BY line is. */
export function seenByMarks(threads: readonly { props?: Record<string, string[]> }[]): string[] {
  return [...new Set(threads.filter(t => t.props?.kind?.includes(SEEN_BY)).flatMap(t => t.props?.["echo.node"] ?? []))].sort();
}

/** The nodes a message has been echoed to: where it came from, here, and every node its seen-by marks name. */
export const seenBy = (m: Msg, area: Area, marked: readonly string[] = []): string[] => [...new Set([originOf(m, area), area.node, ...marked])];

/** `[upstream-newer::n]`: the origin has revision n, newer than this copy's `from-rev`; null when it hasn't. */
export function upstreamNewer(m: Msg): { upstream: number; here: number | null } | null {
  const n = Number(m.props["upstream-newer"]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const here = Number(m.props["from-rev"]);
  return { upstream: n, here: Number.isFinite(here) ? here : null };
}

/** `words` after `lead`, wrapped at `w`, each further line starting with `cont`. */
const wrapWords = (words: string[], w: number, lead: string, cont: string): string[] => {
  const out: string[] = [];
  let line = lead;
  for (const word of words) {
    if (line.length + word.length + 1 > w && line.trim() !== lead.trim()) { out.push(line); line = cont; }
    line += (line.endsWith(" ") ? "" : " ") + word;
  }
  out.push(line);
  return out;
};

/**
 * The FidoNet footer under a message (SurfaceHost.footer): the tear line, the origin line naming the node it came from
 * and the area, and SEEN-BY with the nodes it has been echoed to, wrapped at `w`. Plain text with `|NN` colours.
 */
export function footerOf(m: Msg, area: Area, w: number, marked: readonly string[] = []): string[] {
  const seen = wrapWords(seenBy(m, area, marked), Math.max(20, w), "SEEN-BY:", "        ");
  return [
    "",
    "|08--- |07ep0ch echonet",
    `|15 * Origin: |11${originOf(m, area)} |08(|07${area.name}|08)`,
    ...seen.map(l => `|08${l}`),
  ];
}

/** One message as the list and the reader number it. */
export interface Message { msg: Msg; n: number; fresh: boolean }

/** The reader's header for a message (SurfaceHost.header): GoldED's, from the copy's properties. Plain text with `|NN`. */
export function headerOf(msg: Message, of: number, area: Area): string[] {
  const m = msg.msg, newer = upstreamNewer(m), from = fromOf(m);
  return [
    `|09Msg  : |15${msg.n} |08of ${of}${msg.fresh ? " |14new" : ""}`,
    // A copy that doesn't say who wrote it is from its node, said once.
    `|09From : ${messageFrom(m) === originOf(m, area).split("@")[0] ? "" : `|14${messageFrom(m)} |08@ `}|11${originOf(m, area)}|08 · ${bbsDate(arrived(m))}`,
    `|09To   : |07${m.props.to?.trim() || "All"}`,
    `|09Subj : |15${subject(m)}`,
    `|09Area : |11${(m.props.echo?.trim() || area.tag).toUpperCase()} |08· |07${area.name}${area.kind === "sub" ? ` |08· from ${area.origin}` : " |08· local"}${from && m.props["from-rev"] ? ` |08· copy of rev ${m.props["from-rev"]}` : ""}`,
    // Drift is the point: a newer original is there to take or compare, never brought in by itself.
    ...(newer ? [
      `|14 ! a newer version is upstream |08(rev ${newer.upstream}${newer.here !== null ? `, this copy is rev ${newer.here}` : ""})`,
      "|08   take it: |07ext.echonet.take-newer|08 · compare: |07ext.echonet.compare-newer",
    ] : []),
    ...(m.props["upstream-gone"] ? [`|12 ! gone upstream |08since ${m.props["upstream-gone"]}: the original was trashed at ${from?.node ?? "its node"}; this copy stays`] : []),
  ];
}

/**
 * A node as the nodelist knows it: whether it answered, the netmail held for it, last toss, areas and subscriptions. `dialsIn`: it
 * calls and is never called (its last call is its last toss), `held` the netmail waiting here for its call.
 */
export interface NodeEntry { node: string; self: boolean; reachable: boolean | null; dialsIn: boolean; held: number; why: string; roles: string; lastToss: number | null; areas: string[]; subscriptions: string[] }

/**
 * The nodes in a nodelist's text, as the tosser writes it: a `## <node>` heading each, then `- <state> · <roles>` (a node that dials in: `- dials in · last call <when> · <roles>` and `- netmail held: n`), `- last toss: …`,
 * `- areas: <tag> (<name>); …`, `- subscriptions: …`. A line it doesn't know is skipped.
 */
export function nodesOf(text: string): NodeEntry[] {
  const out: NodeEntry[] = [];
  let at: NodeEntry | null = null;
  const tags = (v: string) => (/^(none|unknown)$/.test(v.trim()) ? [] : v.split(";").map(x => x.trim().split(/\s+/)[0]!).filter(Boolean));
  for (const line of text.split("\n")) {
    const head = /^##\s+(\S+)/.exec(line);
    if (head) { out.push(at = { node: head[1]!, self: false, reachable: null, dialsIn: false, held: 0, why: "", roles: "", lastToss: null, areas: [], subscriptions: [] }); continue; }
    const item = /^\s*-\s+(.*)$/.exec(line)?.[1];
    if (!at || item === undefined) continue;
    const field = /^(last toss|areas|subscriptions|netmail held):\s*(.*)$/.exec(item);
    if (field) {
      if (field[1] === "netmail held") at.held = Number.parseInt(field[2]!, 10) || 0;
      else if (field[1] === "last toss") { const t = Date.parse(field[2]!); at.lastToss = Number.isFinite(t) ? t : null; }
      else if (field[1] === "areas") at.areas = tags(field[2]!);
      else at.subscriptions = tags(field[2]!);
      continue;
    }
    const [state = "", ...rest] = item.split(" · ");
    at.self = state === "this node";
    at.reachable = state === "this node" || state === "reachable" ? true : state.startsWith("unreachable") ? false : null;
    at.why = state.startsWith("unreachable:") ? state.slice("unreachable:".length).trim() : "";
    at.dialsIn = state === "dials in";
    at.roles = rest.filter(part => !part.startsWith("last call ")).join(", ");
  }
  return out;
}

/** One toss, from its log's properties: when, by which node, and what it carried. */
export interface TossLog { at: number | null; node: string; copies: number; updated: number; netmailOut: number; netmailIn: number; queued: number; failed: boolean }
export function tossOf(m: Msg): TossLog {
  const n = (k: string) => Number(m.props[k] ?? 0) || 0, at = Date.parse(m.props.at ?? "");
  return { at: Number.isFinite(at) ? at : null, node: m.props.node ?? "?", copies: n("copies"), updated: n("updated"), netmailOut: n("netmail-out"), netmailIn: n("netmail-in"), queued: n("queued"), failed: m.props.failed === "yes" };
}

/**
 * The nodelist as FidoNet wrote it: a comment header, a line per node (`,n,node,status,last toss,held,areas`), commas
 * and all; then the last tosses, as a tosser's log. `|NN` colours.
 */
export function nodelistLines(title: string, nodes: readonly NodeEntry[], tosses: readonly TossLog[] = [], now = Date.now()): string[] {
  const day = new Date(now), start = new Date(day.getFullYear(), 0, 0);
  const dayNo = Math.floor((day.getTime() - start.getTime()) / 86_400_000);
  const when = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const nodeW = Math.min(28, Math.max(8, ...nodes.map(n => n.node.length)));
  const self = nodes.find(n => n.self);
  return [
    `|08;A |15EchoNet Nodelist |08for ${when} -- Day number ${dayNo}`,
    // The heartbeat: a toss that moved nothing writes no log, so how long since this node last tossed is said here.
    `|08;A |07${title}${self?.lastToss ? ` |08· tossed ${ago(self.lastToss, now)} ago` : ""}`,
    "|08;",
    `|08;  #  ${"node".padEnd(nodeW)}  status  last toss         held     areas`,
    ...nodes.map((n, i) => {
      // A node that dials in is never down: it calls when it can, and what waits for it is held.
      const status = n.self ? "|15HOME " : n.dialsIn ? "|11DIAL " : n.reachable === null ? "|08?    " : n.reachable ? "|10UP   " : "|12DOWN ";
      const why = n.dialsIn ? (n.held ? `${n.held} netmail held for its call` : "") : n.why;
      return `|08,|15${String(i + 1).padStart(2)}|08,|11${n.node.padEnd(nodeW)}|08,${status}|08,|07${(n.lastToss ? bbsDate(n.lastToss) : "never").padEnd(16)}|08,|05${(n.held ? String(n.held) : "-").padEnd(7)}|08,|03${n.areas.map(a => a.toUpperCase()).join(" ") || "-"}${why ? ` |08; ${why}` : ""}`;
    }),
    ...(nodes.length ? [] : ["|08;  (no nodes in it yet: the tosser writes them at its next toss)"]),
    ...(tosses.length ? ["|08;", "|08;S last tosses", ...tosses.map(t => t.failed ? `|08;  ${t.at ? bbsDate(t.at) : "?"} |07${t.node} |12stopped |08(its log says why)` : `|08;  ${t.at ? bbsDate(t.at) : "?"} |07${t.node} |08copies |07${t.copies}|08 newer |07${t.updated}|08 netmail |07${t.netmailOut}|08 out |07${t.netmailIn}|08 in${t.queued ? ` |14${t.queued} queued` : ""}`)] : []),
  ];
}
