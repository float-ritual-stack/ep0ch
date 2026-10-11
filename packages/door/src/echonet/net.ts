// EchoNet (the spike): outlines as nodes on a FidoNet-style store-and-forward network. The tosser (outliner side) copies
// an echo area's messages from the outline it starts in (its origin) into each outline subscribed to it; this module is
// how the door reads those shapes. Pure: no I/O. The shapes are the tosser's, and nothing else is assumed of a block:
//
//   an echo area, in its origin:  [type::echo-area] [echo::<tag>] [query::<the views' grammar: its messages>]
//   a subscription:               [type::echo-sub] [subscribe::<outline>@<machine>] [echo::<tag>], its children the copies
//   a copy:                       [from::<outline>@<machine>/<id>] [echo::<tag>] [from-rev::n] [tossed::<iso>] ([upstream-newer::n])
//   seen-by:                      a whole-note mark on the original per node it reached ([kind::echo-seen-by] [echo.node::…])
//   the nodelist:                 [type::nodelist] [node::…] [last-toss::…], a `## <node>` section per node it knows (its
//                                 state, access, last toss, areas), its children the toss logs ([type::toss] [at::…] [copies::n] …)
//
// Every list is a query in the views' grammar the service answers (`blocks.query` `where`), never a scan of children
// in the door, and unread is the read marks' `unread:me`.
import { subject, type Msg } from "../board";
import { bbsDate } from "../text";

export const ECHO_AREA = "echo-area";
export const ECHO_SUB = "echo-sub";
export const NODELIST = "nodelist";
export const TOSS = "toss";
/** A seen-by mark's kind: the tosser's whole-note mark on an original, one per node it reached. */
export const SEEN_BY = "echo-seen-by";
/** Every area an outline holds: the ones it is the origin of, and the ones it subscribes to. */
export const AREAS_QUERY = `type=${ECHO_AREA} OR type=${ECHO_SUB}`;
export const NODELIST_QUERY = `type=${NODELIST}`;
/** A nodelist's toss logs. */
export const tossesQuery = (nodelist: string) => `parent:((${nodelist})) type=${TOSS}`;

/** `outline@machine`: a node's address. */
export const nodeName = (outline: string, machine: string) => `${outline}@${machine}`;

/** `outline@machine/id` (a copy's `from`): the node it came from and the block it copies there. */
export function parseFrom(s: string | undefined): { node: string; id: string } | null {
  const m = /^\s*([a-z0-9][a-z0-9-]*@[A-Za-z0-9._-]+)\/([0-9a-f-]{8,})\s*$/i.exec(s ?? "");
  return m ? { node: m[1]!, id: m[2]! } : null;
}

export type AreaKind = "local" | "sub";

/** An echo area as a reader sees it: where it is read, where it comes from, and the query that lists its messages. */
export interface Area {
  /** Unique across outlines: the node it's read at and its block. */
  key: string;
  /** The outline holding it (where its messages are read), and that outline as a node. */
  outline: string;
  node: string;
  block: Msg;
  /** `local`: this outline is its origin; `sub`: a subscription, its messages copies. */
  kind: AreaKind;
  /** Its echo tag (`[echo::…]`), as written. */
  tag: string;
  /** Its name: the block's title. */
  name: string;
  /** The node it comes from: a subscription's `subscribe`, a local area's own node. */
  origin: string;
  /** Its messages, in the views' grammar. */
  query: string;
  /** Messages in it, new to the person, and the last time one was tossed in (null until counted). */
  total: number | null;
  fresh: number | null;
  lastToss: number | null;
  /** Why it can't be read (no query), shown on its row. */
  problem?: string;
}

/** An area from its block, read at `outline` on `machine`; null when the block isn't one. */
export function areaOf(block: Msg, outline: string, machine: string): Area | null {
  const type = block.props.type?.trim(), node = nodeName(outline, machine);
  if (type !== ECHO_AREA && type !== ECHO_SUB) return null;
  const kind: AreaKind = type === ECHO_SUB ? "sub" : "local";
  const tag = block.props.echo?.trim() || "?";
  const query = kind === "sub" ? `parent:((${block.id})) from` : block.props.query?.trim() ?? "";
  const origin = kind === "sub" ? block.props.subscribe?.trim() || "?" : node;
  return {
    key: `${node}/${block.id}`, outline, node, block, kind, tag, name: subject(block) || tag, origin, query, total: null, fresh: null, lastToss: null,
    ...(query ? {} : { problem: `an echo area names its messages with [query::…]` }),
  };
}

/** Its messages new to the person: the same query, unread by them (the read marks). */
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
  const said = m.props.by?.trim() || m.props.author?.trim(), from = parseFrom(m.props.from);
  if (said) return said;
  if (from) return from.node.split("@")[0]!;
  return !m.author || m.author === "user" ? "sysop" : m.author;
}

/** The node a message came from: a copy's `from`, else the area's own node. */
export const originOf = (m: Msg, area: Area): string => parseFrom(m.props.from)?.node ?? (area.kind === "local" ? area.node : area.origin);

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
  const m = msg.msg, newer = upstreamNewer(m), from = parseFrom(m.props.from);
  return [
    `|09Msg  : |15${msg.n} |08of ${of}${msg.fresh ? " |14new" : ""}`,
    // A copy that doesn't say who wrote it is from its node, said once.
    `|09From : ${messageFrom(m) === originOf(m, area).split("@")[0] ? "" : `|14${messageFrom(m)} |08@ `}|11${originOf(m, area)}|08 · ${bbsDate(arrived(m))}`,
    `|09To   : |07${m.props.to?.trim() || "All"}`,
    `|09Subj : |15${subject(m)}`,
    `|09Area : |11${area.tag.toUpperCase()} |08· |07${area.name}${area.kind === "sub" ? ` |08· from ${area.origin}` : " |08· local"}${from && m.props["from-rev"] ? ` |08· copy of rev ${m.props["from-rev"]}` : ""}`,
    ...(newer ? [`|14 ! a newer version is upstream |08(rev ${newer.upstream}${newer.here !== null ? `, this copy is rev ${newer.here}` : ""}) · the next toss brings it`] : []),
  ];
}

/** A node as the nodelist knows it: whether it answered, its access, last toss, areas and subscriptions. */
export interface NodeEntry { node: string; self: boolean; reachable: boolean | null; why: string; access: string; roles: string; lastToss: number | null; areas: string[]; subscriptions: string[] }

/**
 * The nodes in a nodelist's text, as the tosser writes it: a `## <node>` heading each, then `- <state> · access <level>
 * · <roles>`, `- last toss: …`, `- areas: <tag> (<name>); …`, `- subscriptions: …`. A line it doesn't know is skipped.
 */
export function nodesOf(text: string): NodeEntry[] {
  const out: NodeEntry[] = [];
  let at: NodeEntry | null = null;
  const tags = (v: string) => (/^(none|unknown)$/.test(v.trim()) ? [] : v.split(";").map(x => x.trim().split(/\s+/)[0]!).filter(Boolean));
  for (const line of text.split("\n")) {
    const head = /^##\s+(\S+)/.exec(line);
    if (head) { out.push(at = { node: head[1]!, self: false, reachable: null, why: "", access: "unknown", roles: "", lastToss: null, areas: [], subscriptions: [] }); continue; }
    const item = /^\s*-\s+(.*)$/.exec(line)?.[1];
    if (!at || item === undefined) continue;
    const field = /^(last toss|areas|subscriptions):\s*(.*)$/.exec(item);
    if (field) {
      if (field[1] === "last toss") { const t = Date.parse(field[2]!); at.lastToss = Number.isFinite(t) ? t : null; }
      else if (field[1] === "areas") at.areas = tags(field[2]!);
      else at.subscriptions = tags(field[2]!);
      continue;
    }
    const [state = "", ...rest] = item.split(" · ");
    at.self = state === "this node";
    at.reachable = state === "this node" || state === "reachable" ? true : state.startsWith("unreachable") ? false : null;
    at.why = state.startsWith("unreachable:") ? state.slice("unreachable:".length).trim() : "";
    at.access = /^access\s+(\S+)/.exec(rest[0] ?? "")?.[1] ?? "unknown";
    at.roles = rest.slice(1).join(", ");
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
 * The nodelist as FidoNet wrote it: a comment header, a line per node (`,n,node,status,last toss,access,areas`), commas
 * and all; then the last tosses, as a tosser's log. `|NN` colours.
 */
export function nodelistLines(title: string, nodes: readonly NodeEntry[], tosses: readonly TossLog[] = [], now = Date.now()): string[] {
  const day = new Date(now), start = new Date(day.getFullYear(), 0, 0);
  const dayNo = Math.floor((day.getTime() - start.getTime()) / 86_400_000);
  const when = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const nodeW = Math.min(28, Math.max(8, ...nodes.map(n => n.node.length)));
  return [
    `|08;A |15EchoNet Nodelist |08for ${when} -- Day number ${dayNo}`,
    `|08;A |07${title}`,
    "|08;",
    `|08;  #  ${"node".padEnd(nodeW)}  status  last toss         access   areas`,
    ...nodes.map((n, i) => {
      const status = n.self ? "|15HOME " : n.reachable === null ? "|08?    " : n.reachable ? "|10UP   " : "|12DOWN ";
      return `|08,|15${String(i + 1).padStart(2)}|08,|11${n.node.padEnd(nodeW)}|08,${status}|08,|07${(n.lastToss ? bbsDate(n.lastToss) : "never").padEnd(16)}|08,|05${n.access.padEnd(7)}|08,|03${n.areas.map(a => a.toUpperCase()).join(" ") || "-"}${n.why ? ` |08; ${n.why}` : ""}`;
    }),
    ...(nodes.length ? [] : ["|08;  (no nodes in it yet: the tosser writes them at its next toss)"]),
    ...(tosses.length ? ["|08;", "|08;S last tosses", ...tosses.map(t => t.failed ? `|08;  ${t.at ? bbsDate(t.at) : "?"} |07${t.node} |12stopped |08(its log says why)` : `|08;  ${t.at ? bbsDate(t.at) : "?"} |07${t.node} |08copies |07${t.copies}|08 newer |07${t.updated}|08 netmail |07${t.netmailOut}|08 out |07${t.netmailIn}|08 in${t.queued ? ` |14${t.queued} queued` : ""}`)] : []),
  ];
}
