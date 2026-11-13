/*
 * The lists about one note, and about the asker's own parts (`lists.read`, packages/native/docs/DESIGN.md §3, W6):
 *
 * - `threads`: the note's comment threads (`annotations.list`), a row a thread with its replies under it.
 * - `proposals`: the edits waiting beside the note (`draft.proposals.list`), a row a proposal with its change.
 * - `revisions`: the texts the note had (`block.revisions`), a row a revision; an open one carries its change
 *   against the note as it is now.
 * - `actions`: the asker's own actions (it hands over their rows, outline-core's `ActionRow`), a row a way to press
 *   one: the keys screen of any door, read from the rows that bind the keys, with the keys of the screen it has open
 *   (`screen`: that screen's own `keys`, as `screens.list` serves them) first.
 * - `components`: every component there is to write (`components.schemas`), a row a component; an open one carries
 *   its own example, drawn as a page draws it.
 *
 * Each is a list like any other: a row says what it shows and the act line a press runs. What a row shows under
 * itself is its `view`, a primitive a client draws as any other (a change is a `diff`: the service finds it, and
 * no client diffs a text). A press of its own inside a row (apply, dismiss, reply, resolve, restore) is a cell with
 * its act line, by the door's own action names, so the line reads in every door.
 */
import { actionLine } from "@ep0ch/outline-core/action-line";
import type { KeyRow } from "@ep0ch/outline-core/action-row";
import { markCurrent } from "@ep0ch/outline-core/annotation-marks";
import { actorName, revisionByline } from "@ep0ch/outline-core/attribution";
import { variation, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { listRowMatches, type ListCell, type ListGroup, type ListRow } from "@ep0ch/outline-core/list-row";
import type { PagePrimitive } from "@ep0ch/outline-core/note-page";
import type { BlockRevisionEntry, BlockRevisions } from "@ep0ch/outline-core/protocol";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { parseProposal, proposalChanges, type DraftProposalsBeside } from "./draft-patch";
import { press, row, subject, titled, type Answered, type ListsRequest, type Own, type Producer } from "./list-producer";
import { drawnParts } from "./note-page";
import type { ScreensList } from "./screens";
import { diffsJoined, textDiff } from "./text-diff";
import type { AnnotationRecord, AnnotationThread, Block } from "./types";

const when = (iso: string | undefined) => iso?.slice(0, 16).replace("T", " ") ?? "";
/** Who wrote something, as a row says it: an agent by its name, the person as "you" (as a revision's byline does). */
const who = (w: { author?: string; actorId?: string }) => w.author === "agent" ? actorName(w.actorId) || "an agent" : w.author === "user" ? "you" : w.author ?? "someone";
const firstLine = (text: string) => text.split("\n").find(line => line.trim())?.trim() ?? "";
const quoted = (text: string) => { const one = text.replace(/\s+/g, " ").trim(); return `“${one.length > 80 ? `${one.slice(0, 79)}…` : one}”`; };
const open = (request: ListsRequest) => new Set((request.open ?? []).filter(id => typeof id === "string"));
const OF = { name: "of", about: "the note", required: true as const };
const OPEN = { name: "open", about: "the rows shown whole, by id: each carries what it shows under itself" };
const WORDS = { name: "query", about: "words that narrow the rows" };

// ── threads ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The words a comment is on, when it is on some: where its passage is now, else where it was made. */
function passageOf(record: AnnotationRecord): string | null {
  const anchor = (record.resolvedTarget ?? record.originalTarget).anchor;
  return anchor.kind === "text-quote" || anchor.kind === "dom-range" ? anchor.exact : null;
}

/**
 * A note's comment threads (`of`), newest first: the ones in its margin now (open and kept), then the earlier ones
 * (seen and resolved). A row is a thread: its first words, who wrote it and what it is on; under it the passage, the
 * comment whole and its replies; and its own presses, `reply` and `resolve` (the door's names for both).
 */
async function threads(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const listed = await own.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: of }, includeResolved: true } });
  const said = (record: AnnotationRecord): PagePrimitive[] => [
    { type: "text", strong: true, text: `${who(record.block)} · ${when(record.block.createdAt)}${record.edited ? " · edited" : ""}` },
    ...(record.body.trim() ? [{ type: "blockdown" as const, text: record.body }] : []),
  ];
  const rows = [...listed].sort((a, b) => b.block.createdAt.localeCompare(a.block.createdAt)).map((thread): ListRow => {
    const passage = passageOf(thread), current = markCurrent(thread.lifecycle), id = thread.block.id;
    const replies = thread.replies.length;
    return row({
      id, label: firstLine(thread.body) || (passage ? "A highlight" : "A mark on the note"),
      detail: [who(thread.block), when(thread.block.createdAt), replies ? `${replies} repl${replies === 1 ? "y" : "ies"}` : "", passage ? `on ${quoted(passage)}` : "on the whole note"].filter(Boolean).join(" · "),
      group: current ? "open" : "earlier", ...(thread.lifecycle !== "open" ? { mark: thread.lifecycle } : {}),
      cells: [press("Reply", "reply", { thread: id }), current ? press("Resolve", "resolve", { thread: id }) : press("Reopen", "resolve", { thread: id, open: "true" })],
      view: { type: "box", children: [...(passage ? [{ type: "text" as const, tone: "dim" as const, text: quoted(passage) }] : []), ...said(thread), ...thread.replies.flatMap(said)] },
    });
  });
  const count = (group: string) => rows.filter(r => r.group === group).length;
  const groups: ListGroup[] = [{ name: "open", label: "Open", count: count("open"), ...(count("open") ? {} : { note: "None." }) }, ...(count("earlier") ? [{ name: "earlier", label: "Earlier", count: count("earlier") }] : [])];
  return { list: { type: "list", arrange: "rows", rows, groups, title: `Comments · ${count("open")} open`, empty: "No comments on this note yet." } };
}

// ── proposals ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The edits proposed beside a note (`of`) and not yet applied or dismissed, oldest first: a row a proposal, who sent
 * it and why it didn't apply, and under it what it would change, each passage against what it becomes. Its presses
 * are `proposal.apply` (when its passage is still there) and `proposal.dismiss`.
 */
async function proposals(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const [beside, note] = await Promise.all([own.request<DraftProposalsBeside>({ action: "draft.proposals.list", blockId: of }), own.request<Block>({ action: "get", blockId: of })]);
  const lines = note.text.split("\n");
  const rows: ListRow[] = [];
  for (const listed of beside.proposals) {
    const block = await own.request<Block>({ action: "get", blockId: listed.id });
    const proposal = parseProposal(block.text);
    if (!proposal) continue;
    const changes = proposalChanges(proposal);
    // Each span as the passage it saw against what it becomes, under where that passage is in the note now.
    const spans = proposal.edits.flatMap(edit => edit.patches.map(span => {
      const at = edit.blockId === of && span.observed ? note.text.indexOf(span.observed) : -1;
      const where = edit.blockId !== of ? "in another note" : !span.observed ? "added at the end" : at < 0 ? "its passage isn't in the note now" : `line ${note.text.slice(0, at).split("\n").length} of ${lines.length}`;
      return { head: where, diff: textDiff(span.observed, span.replacement) };
    }));
    const structural = proposal.group?.writes.length ?? 0;
    const view = diffsJoined([...spans, ...(structural ? [{ head: `and ${structural} change${structural === 1 ? "" : "s"} to the notes around it: open the proposal to read ${structural === 1 ? "it" : "them"}`, diff: diffsJoined([]) }] : [])], { from: "the note now", to: "with the edit" });
    rows.push(row({
      id: listed.id, label: `${changes > 1 ? `${changes} changes` : "An edit"} from ${who({ author: proposal.actor?.author ?? listed.author, ...(proposal.actor?.actorId ?? listed.actorId ? { actorId: proposal.actor?.actorId ?? listed.actorId! } : {}) })}`,
      detail: [when(block.createdAt), typeof proposal.reason === "string" ? `not applied: ${proposal.reason}` : "", listed.applies ? "" : "its passage is gone: it can only be dismissed"].filter(Boolean).join(" · "),
      ...(listed.applies ? {} : { tone: "warn" as const }),
      cells: [...(listed.applies ? [press("Apply", "proposal.apply", { id: listed.id })] : []), press("Dismiss", "proposal.dismiss", { id: listed.id })],
      view,
    }));
  }
  return { list: { type: "list", arrange: "rows", rows, title: `Proposals · ${rows.length}`, empty: "No edits are waiting beside this note." } };
}

// ── revisions ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The texts a note (`of`) had, the one it has now first, then the earlier ones the service keeps, newest first. A row
 * is a revision, keyed by its number: when it was saved, by whom, its size and first line. An earlier one folds: named
 * in `open`, it carries its text against the note as it is now (what was there, what came since), and its press is
 * `revision.restore`.
 */
async function revisions(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request), shown = open(request);
  const listed = await own.request<BlockRevisions>({ action: "block.revisions", blockId: of });
  const text = async (revision: number) => (await own.request<BlockRevisionEntry & { text: string }>({ action: "block.revisions", blockId: of, revision })).text;
  const now = listed.revisions.some(r => shown.has(String(r.revision)) && r.revision !== listed.revision) ? await text(listed.revision) : "";
  const rows = await Promise.all(listed.revisions.map(async (r): Promise<ListRow> => {
    const id = String(r.revision), current = r.revision === listed.revision, unfolded = !current && shown.has(id);
    return row({
      id, label: `Revision ${r.revision}${current ? " · the note now" : ""}`,
      detail: [`${when(r.savedAt)} ${revisionByline(r)}`.trim(), `${r.lines} line${r.lines === 1 ? "" : "s"}`, r.firstLine].filter(Boolean).join(" · "),
      ...(current ? {} : { folds: true, cells: [press("Restore", "revision.restore", { revision: id })] }),
      ...(unfolded ? { open: true, view: textDiff(await text(r.revision), now, { from: `revision ${r.revision}`, to: `the note now (revision ${listed.revision})` }) } : {}),
    });
  }));
  return { list: { type: "list", arrange: "rows", rows, title: `Revisions · ${rows.length} kept`, empty: "No earlier text of this note is kept." }, open: rows.filter(r => r.open).map(r => r.id) };
}

// ── actions: the asker's own, as the ways to press them ──────────────────────────────────────────────────────────

/** Where a key holds when its row names no place of its own. */
const EVERYWHERE = "everywhere";
/** The group of the actions no key runs. */
const NO_KEY = "no key";
/** The group, and the place, of the keys that are the open screen's own. */
const SCREEN = "this screen";

/**
 * The asker's actions (`actions`: each as its row, outline-core's `ActionRow`), a row a way to press one: its keys as
 * the row writes them, the act line they run (the action and that key's arguments, by the one writer, `actionLine`),
 * where they hold and what they do. An action with no key at all is listed after, under what else runs it. A table,
 * so a keys screen is these rows and nothing a client keeps beside them; a pick runs the line.
 */
async function actions(own: Own, request: ListsRequest): Promise<Answered> {
  if (!Array.isArray(request.actions)) throw new Refusal("invalid", "lists.read from=actions lists the asker's own actions: hand them over as actions=[<each action's row>]");
  const words = prepareSearchQuery(request.query ?? "");
  const rows: ListRow[] = [], order: string[] = [];
  const add = (group: string, r: Omit<ListRow, "act" | "group">) => {
    if (!listRowMatches({ label: r.label, detail: r.detail ?? "", mark: r.mark ?? "" }, words)) return;
    if (!order.includes(group)) order.push(group);
    rows.push(row({ ...r, group }));
  };
  // The keys of the screen the asker has open come first, as they are tried first: each as its screen wrote it (the
  // key by the name screens give keys, the action and what it runs with), and what it does in the screen's words, else
  // the action's own.
  const screen = typeof request.screen === "string" && request.screen ? (await own.request<ScreensList>({ action: "screens.list" })).screens.find(s => s.name === request.screen) : undefined;
  for (const [n, key] of (screen?.spec?.keys ?? []).entries()) {
    const args = { ...key.args, ...(key.tile ? { tile: key.tile } : {}) };
    const does = key.says ?? key.label ?? request.actions.find(action => action?.id === key.action)?.summary ?? "";
    const where = [SCREEN, ...(key.only ? [`on ${key.only.join(", ")}`] : []), ...(key.unless ? [`not on ${key.unless.join(", ")}`] : [])].join(" · ");
    add(SCREEN, { id: `${SCREEN}#${n}`, label: key.key, detail: does, mark: key.action, cells: [key.key, actionLine({ action: key.action, args }), where, does], do: { run: { action: key.action, args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])) } } });
  }
  for (const action of request.actions) {
    if (!action || typeof action.id !== "string") continue;
    // Its arguments it can't run without: a line that leaves one out is shown, and runs nothing when picked.
    const needs = Object.entries(action.args ?? {}).filter(([, spec]) => !spec.optional).map(([name]) => name);
    const ways: readonly (KeyRow | { keys: string; does: string })[] = typeof action.keys === "string" ? [{ keys: action.keys, does: action.summary }] : action.keys ?? [];
    let keyed = 0;
    for (const [n, way] of ways.entries()) {
      if (!("keys" in way)) continue;
      keyed += 1;
      const args = "args" in way && way.args ? way.args : {};
      const line = actionLine({ action: action.id, args }), where = ("on" in way && way.on) || EVERYWHERE;
      const runs = needs.every(name => name in args);
      add(where, { id: `${action.id}#${n}`, label: way.keys, detail: way.does, mark: action.id, cells: [way.keys, line, where, way.does], ...(runs ? { do: { run: { action: action.id, args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])) } } } : {}) });
    }
    if (!keyed) {
      const via = ways.flatMap(way => "via" in way ? [way.via] : []).join("; ");
      add(NO_KEY, { id: action.id, label: action.id, detail: action.summary, mark: action.id, cells: ["", actionLine({ action: action.id }), via, action.summary], ...(needs.length ? {} : { do: { run: { action: action.id } } }) });
    }
  }
  const sorted = [...order.filter(g => g !== NO_KEY), ...order.filter(g => g === NO_KEY)];
  const groups: ListGroup[] = sorted.map(name => ({ name, label: name, count: rows.filter(r => r.group === name).length }));
  const columns = ["keys", "act", "where", "does"];
  return { list: { type: "list", arrange: "table", columns, headers: columns, rows, groups, title: `Keys · ${rows.filter(r => r.group !== NO_KEY).length} bound`, empty: "No action matches." } };
}

// ── components ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every component there is to write (`components.schemas`: the built-ins with the outline's own styles and types, and
 * its extensions'), under the group each says it is in. A row folds: named in `open`, it carries what the component
 * is, its own example as written and that example drawn, the parts a page would answer for a note that held it
 * (asked about `of`, else the outline's first note, where an example asks about `this`).
 */
async function components(own: Own, request: ListsRequest): Promise<Answered> {
  const { schemas } = await own.request<{ schemas: ComponentSchema[] }>({ action: "components.schemas" });
  const words = prepareSearchQuery(request.query ?? ""), shown = open(request);
  const kept = schemas.filter(s => listRowMatches({ label: s.title, detail: s.where, mark: s.id }, words));
  const about = typeof request.of === "string" && request.of ? request.of : (await own.request<{ blocks: { id: string }[] }>({ action: "blocks.read", under: null, fields: [] })).blocks[0]?.id ?? "";
  const rows = await Promise.all(kept.map(async (schema): Promise<ListRow> => {
    const unfolded = shown.has(schema.id);
    const cells: ListCell[] = [schema.origin && schema.origin !== "built-in" ? schema.origin : ""].filter(Boolean);
    if (!unfolded) return row({ id: schema.id, label: schema.title, detail: schema.where, mark: schema.id, group: schema.group, folds: true, ...(cells.length ? { cells } : {}) });
    const example = variation(schema, {});
    const parts = await drawnParts(own, about, `${titled(schema.title)} example\n${example.use}`);
    const view: PagePrimitive = { type: "box", children: [
      { type: "blockdown", text: schema.intro },
      { type: "box", title: "As written", children: [{ type: "source", text: [example.note, example.use].filter(Boolean).join("\n\n") }] },
      { type: "box", title: "As drawn", children: parts },
    ] };
    return row({ id: schema.id, label: schema.title, detail: schema.where, mark: schema.id, group: schema.group, folds: true, open: true, ...(cells.length ? { cells } : {}), view });
  }));
  const groups: ListGroup[] = [...new Set(kept.map(s => s.group))].map(name => ({ name, label: name, count: kept.filter(s => s.group === name).length }));
  return { list: { type: "list", arrange: "rows", rows, groups, title: `Components · ${kept.length}`, empty: "No component matches." }, open: rows.filter(r => r.open).map(r => r.id) };
}

/** The producers of this file, each as it says of itself: `list-producers.ts` lists them with the rest. */
export const ABOUT_PRODUCERS: readonly Producer[] = [
  { row: { from: "threads", about: "Comments", params: [OF] }, read: threads },
  { row: { from: "proposals", about: "Proposals", params: [OF] }, read: proposals },
  { row: { from: "revisions", about: "Revisions", params: [OF, OPEN] }, read: revisions },
  { row: { from: "actions", about: "Keys", placeholder: "A key, an action or what it does", params: [{ name: "actions", about: "the asker's own actions, each as its row", required: true }, { name: "screen", about: "the screen the asker has open, by name: its own keys are listed first" }, WORDS] }, read: actions },
  { row: { from: "components", about: "Components", placeholder: "A component's name", params: [WORDS, OPEN, { name: "of", about: "the note an example asks about as `this` (left out: the outline's first)" }] }, read: components },
];
