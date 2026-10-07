// The note surface: one note, shown, edited and commented on the same way wherever it is hosted — the
// board's preview, details and floats, the desk's reader, and (next) a river column. It owns the note's
// rendering, links, the edit control (a Draft, with Ctrl+E handing it to $EDITOR), passage selection
// and comment threads, the property warning, "changed elsewhere", and keeping unsaved text safe.
//
// A host gives it a rectangle of any width and a SurfaceHost (the door's context, a redraw, and where
// a followed link opens). Everything a person can do here is also a named action (NOTE_ACTIONS), so an
// agent driving the door through its control socket goes through the same code as the keys.
import { onlyScrolled, scrolled, wheelRows } from "../scroll";
import type { Ctx } from "../app";
import { subject, titleLine, type Msg } from "../board";
import { editArmMs } from "../arm";
import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { literalLines } from "@ep0ch/outline-core/code-ranges";
import { fragmentAnchorMatch, linkOccurrences, referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { CommentSession, type CommentEnv } from "../comment";
import { foldPoints, heroBox, mediaLines, renderDoc, type Doc, type DocEnv, type DocImage, type FoldPoint, type ImageControl } from "../doc";
import { DENSITIES, isDensity, type Density, type FigureControl, type FigureInfo } from "../graphs";
import { embedRegion, embedsLoading, viewResults, embedStepChanged, isOpenProposal, NOT_APPLICABLE, proposalApplies, proposalControls, SHADE, type EmbedBody } from "../embeds";
import { extensionRegion, projectionRegion, projectionsOf, resourceChanged, RUN_AGAIN, ticketBlocksOf, ticketRegion, type ResourceProjection, type TicketPart } from "../projection";
import { EXT_ACTIONS, extensionNamed, handlerKeyAction } from "../extensions";
import { metadataLines, printable, setUserSummaryKeys, summaryKeys, summarySegments, tokensFor, tokensOf, type Source } from "../props";
import { type CalloutRef, type ImageRef, LINK_OFF, LINK_ON, outlineChanged, pageView, pageOf, presentLinks, resourceTokensOf, refKey, referencesIn, refView, workIdPrefix, shortId, type LinkTarget } from "../refs";
import { isOutlineNote, openResource, RESOURCE_NOTE, resourceTarget, UNSENT_NOTE } from "../authored";
import { changeOf, parseStatus, STEP_CHOICES, STEP_MARKS, stepChanged, UndoHistory, stepLink, stepsLoading, stepsOf, stepStillOn, stepTitle, statusWord, type StepChoice, type StepRef } from "../steps";
import { destinationOf, external, externalOpenCommand, fileOpenCommand } from "../open";
import { Draft, DRAFT_ACTIONS, sameParty, tidy, whenPut, type DraftActionArgs } from "../edit";
import { agentRefusal, blockTarget, DraftSession, hasStrays, keepUnsent, leaveSaid, propertyChange, takeStrays, unsent, unshelve, type Ended, type LeaveResult, type Unsent } from "../draft-session";
import { copyNote, diffNote, oldUnsentLine, takeBackSpans, UNSENT_LABEL, unsentEntries, unsentView, type UnsentEntry, type UnsentKind, type UnsentOp } from "../unsent";
import { inWindow, type Placement } from "../kitty";
import { ALIGNS, media, parseDim, parseMediaLine, parseSize, rewriteMediaLine, sized, sizeText, type Focus, type MediaAttr, type MediaSpec } from "../media";
import { backdrop, heroHeaderMode, heroHeaderOn, heroStep, HERO_RAMP_ROWS, HERO_STEPS, overColours, type CellGrid, type HeroMode } from "./hero-header";
import type { Scroll } from "../canvas";
import { whoOf, changedSinceRead, EditConflict, mutationFor, Offline, recordedActorId, Refused, USER, type Actor, type ChecklistStep, type Comment, type OutlineEvent, type PropertyRecord } from "../socket";
import { ellipsize, dim, C, extractLinks, fg, LINK_END, linkTag, pad, RESET, width } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { ago, bbsDate, rule, wrap } from "../text";
import { ActionRefused, actionSet, boundNow, def, agentLabel, asActor, type ActionDef, type ArgsOf, type ArgsOfSet, type MenuEntry, type MenuNow } from "./actions";
import { Dispatcher } from "./dispatch";
import { NOBODY } from "../whereabouts";
import { draftState, editHint, editorClick, openInEditor, renderEditor, writtenBy } from "./editor";
import { pickInto, type Picked } from "../pick";
import { completerFor, completerOf, completionOf, insertCompletion, lookupCompletion, nearOf, type CompletionBoard } from "./completer";
import { completionTargetAtCursor } from "../completion";
import { checkValue, propertyRows, PropertyPanel, valueTarget, valueView, type PropRow } from "./props-panel";
import { ModeStack, type ReaderMode } from "./modes";
import { LineInput } from "./line";
import { ListPicker } from "./picker";
import { calloutProblems, calloutsOf, calloutsStamp, TONE } from "../callouts";
import { calloutBlocks, rewriteCalloutHeader, type CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { AGENT_BG, cellsOf, Gesture, isCopyKey, lineAt, modeKey, paintRange, RULER_BG, SELECT_BG, Selection, selectionHint, THREAD_BG, wordAt, type Pos, type SelectRows } from "./selection";

/**
 * How a note is being opened (PIE-441), for the host to decide where: `link`, a link the person followed
 * (⏎ or a click; the board's preview opens it in a detail, as ⏎ on a card does); `fresh`, in a new reader
 * (alt+⏎: a new detail, a new desk reader, a new river column); `agent`, an agent's, which never takes the
 * person's focus. Neither link nor fresh: `u`, and whatever else opens.
 */
/**
 * How a note was opened: a followed link (`link`), into a new reader (`fresh`), and by whom (`by`, PIE-514: the actor
 * itself, carried to where it lands, so an agent's open is an agent's there too: it never takes the person's keys).
 */
export interface OpenHow { link?: boolean; fresh?: boolean; by?: Actor }
/**
 * A link that names something outside the door: a web page (`browser`) or a file (`viewer`, a figure). The person's
 * follow opens it there; an agent's never does (`launched: false`): it is given the address instead.
 */
export interface Outside { outside: "browser" | "viewer"; url: string; launched: boolean }

/** What a surface needs from whatever hosts it. */
export interface SurfaceHost {
  ctx: Ctx;
  redraw(): void;
  /** A followed link or `u` (up): the host decides where the note opens (in place, or as the current note). */
  navigate(m: Msg, how?: OpenHow): void;
  /** The summary keys of the view this note is shown from (a lane's `[summary-properties::…]`), if any. */
  summaryKeys?(m: Msg): readonly string[] | null | undefined;
  /**
   * Start a session as the person's key does, where the host keeps track of which session the person is in: the
   * thread list (⏎ or a click on a comment mark), an armed edit confirmed (edit.arm). Without it the surface opens it itself.
   */
  startSession?(kind: SessionKind): void;
  /**
   * A view's own header rows for the note (the BBS message header: Date, To, From, Subj, Conf), drawn in
   * place of the surface's title, byline and crumb rows. The summary line, notices, an agent's line, a
   * focus mark and the property panel still follow it, and clicks and `[ ]` count its rows.
   */
  header?(m: Msg, w: number, info: HeaderInfo): string[];
  /**
   * Back and forward kept by the view instead of the surface (PIE-453), where a followed link doesn't open in
   * this reader: the BBS reader's screen stack, the river's columns. Without it the surface keeps its own.
   */
  history?: ReaderHistory;
  /**
   * The note shown went to the trash (an empty new note, PIE-544) and this reader had nowhere back to go: a screen
   * that was opened for it alone closes. Without it the reader stays on it.
   */
  gone?(id: string): void;
  /** This is the reader the person has focused (for the reader on its own, `NoteSurface.alone`); false: it isn't. */
  focused?: boolean;
  /** Whose action runs through this host: an agent's (NoteSurface.run sets it), else the person's. */
  actor?: Actor;
  /**
   * A note action in this reader as the person (its keys and clicks), through the host's dispatcher, where the
   * reader is a tile (PIE-514); `quiet`: the action says its own refusal. Without it the reader's own dispatcher runs it.
   */
  press?(name: string, args: Record<string, unknown>, quiet?: boolean | ((why: string) => string | null), host?: SurfaceHost): Promise<unknown>;
  /**
   * The person's key started this and they may move on while the note is read (esc, another tile): once it
   * has been read, whether they still want the edit, comment or thread list. Without it, it opens anyway.
   */
  still?: () => boolean;
  /**
   * The keys the host binds itself, before or after the surface (the BBS reader's `n p t`, a following
   * reader's `p`): an extension's key on a line never takes one of them (PIE-512).
   */
  ownKeys?: string;
  /**
   * This note's links (Outlinks, Resources, Backlinks) in the screen's links tile, as `b` asks: where the host has
   * one, or can open one beside the reader. Without it `b` says so and points at the inline `::links`.
   */
  links?(actor: Actor): Promise<Record<string, unknown>>;
}

/** Back and forward where a view keeps them (SurfaceHost.history). */
export interface ReaderHistory {
  /** The title back (-1) or forward (1) goes to, or null when there's nowhere to go. */
  peek(dir: -1 | 1): string | null;
  /** Go there: null when it went, else why not. */
  go(dir: -1 | 1): string | null;
  /** Why an agent can't go back or forward here: it would move the person's screen or focus. */
  agentRefusal: string;
}

/**
 * Where a reader was (PIE-453), so back comes back to it as it was: the note, how far down, the `[ ]`
 * position (the current element and link), and the reading state kept per note (folds, expanded threads).
 */
interface Place { msg: Msg; scroll: number; cur: string | null; link: number; folded: string[]; expanded: string[]; seen: string[]; figures: [string, FigureChoice][] }
/** What the person (or an agent) chose for one live figure in a reader: its tab, its density. Never the note's text. */
type FigureChoice = { tab?: string; density?: Density };
/** How many places back (and forward) a reader keeps. */
const HISTORY = 50;

/**
 * A fragment link just followed (PIE-425), kept on the note object that follow handed its host: whichever
 * reader the host shows that object in (in place, a detail, a new column) reveals the fragment, once. It's
 * scoped to that navigation: another show of the same note (a refresh, another follow) is a different object.
 * `by`: whose follow it was; an agent's never scrolls or marks the reader the person has focused.
 */
const revealOn = new WeakMap<Msg, { fragment: string; by: Actor }>();

/**
 * A reader's history keys (PIE-453): alt+←, backspace or the mouse's back button go back; alt+→ or its forward
 * button go forward. alt+b and alt+f too: some macOS terminals send them for option+← and option+→.
 */
export function historyKey(k: Key): -1 | 1 | 0 {
  if (k.kind === "alt-left" || k.kind === "backspace" || k.kind === "back" || (k.kind === "alt" && k.ch === "b")) return -1;
  if (k.kind === "alt-right" || k.kind === "forward" || (k.kind === "alt" && k.ch === "f")) return 1;
  return 0;
}

/**
 * The history row a reader draws last while it has somewhere to go (PIE-453): `← back · <title>` on the left,
 * `<title> · forward →` on the right, each a click (`hits`, in the row's cells). Null with nowhere to go.
 */
export function historyRow(w: number, back: string | null, forward: string | null): { line: string; hits: { from: number; to: number; dir: -1 | 1 }[] } | null {
  if ((!back && !forward) || w < 12) return null;
  const room = back && forward ? Math.floor((w - 3) / 2) : w - 2;
  const b = back ? ellipsize(`← back · ${printable(back)}`, room) : "", f = forward ? ellipsize(`${printable(forward)} · forward →`, room) : "";
  const hits: { from: number; to: number; dir: -1 | 1 }[] = [];
  let line = "";
  if (b) { line += " " + fg(C.lcyan) + "← back" + fg(C.dark) + b.slice("← back".length) + RESET; hits.push({ from: 0, to: 1 + width(b), dir: -1 }); }
  if (f) {
    const at = w - 1 - width(f), gap = at - (b ? 1 + width(b) : 0);
    const arrow = f.endsWith("forward →") ? f.length - "forward →".length : f.length;
    line += " ".repeat(Math.max(1, gap)) + fg(C.dark) + f.slice(0, arrow) + fg(C.lcyan) + f.slice(arrow) + RESET;
    hits.push({ from: at, to: w, dir: 1 });
  }
  return { line, hits };
}

/** What a host's header can say that only the surface knows: where the note sits, its comments and properties. */
export interface HeaderInfo {
  /** The note's ancestors, "…" while they're read, "top level" for a root. */
  crumbs: string;
  /** Comment threads on the note, once read (null until then). */
  comments: { open: number; total: number } | null;
  /** How many properties the panel (`i`) lists. */
  properties: number;
}

/** A note laid out by a reader (NoteSurface.layOut), and what it was laid out for (`m`, `key`). */
interface Laid {
  m: Msg; key: string; doc: Doc; drawn: Link[]; picks: { at: number; lines: number; rows: number[] } | null;
  controls: Control[]; body: string[]; marks: Mark[]; lines: number[]; elems: Element[];
}

/** `scroll`: where a reading view is in its note (the frames draw a thumb and `· NN%` from it). */
export interface SurfaceView { lines: string[]; placements?: Placement[]; scroll?: Scroll }
export type Link = LinkTarget;
/** Two links name the same target the same way (a click finds the `[ ]` link it is). */
/** The density after `d`, round again: compact, cozy, comfortable. */
const nextDensity = (d: Density): Density => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]!;
/** A live figure's tab or density control, named across renders (its figure's key, then which). */
const figureElemBase = (c: FigureControl) => `figure:${c.figure}|${c.tab !== undefined ? `tab:${c.tab}` : "density"}`;
const sameLink = (a: Link, b: Link) => a.resource?.key === b.resource?.key && a.block === b.block && a.fragment === b.fragment && a.label === b.label && a.page === b.page && a.media === b.media && a.url === b.url;
/**
 * Where a click lands in the last render, in the surface's own cells: a link (the body's, an embed's
 * title or result, a summary value), or a row of the property panel (`follow`: its value names a target).
 */
/** `value`: a summary-line value's property key; it follows as the panel's `o` does (followValue). */
/** `copy`: the selection's copy control (PIE-419), which copies what's drawn or its source. */
/** `elem`: the `[ ]` element the link is (PIE-441); `thread`: a comment mark in the margin, or a control of a thread expanded under its passage (PIE-420). */
/** `history`: the history row's `← back` (-1) or `forward →` (1), PIE-453. */
/** `pick`: a row of the open choice (a step's status, PIE-472; a callout's type, PIE-538), by its index. */
type Hit = { row: number; from: number; to: number } & ({ link: Link; value?: string; elem?: string } | { prop: number; follow: boolean } | { copy: "visible" | "source" } | { thread: string; elem: string } | { history: -1 | 1 } | { pick: number } | { image: string });

/**
 * What `[ ]` stops on (PIE-441), in reading order: a link (in the text, the summary line, or an image or
 * video), a fold point (a heading or a list item with lines under it), a row that stands for a note (a live
 * figure's row, an embedded view's result), an embed (its title), a resource projection (its region, PIE-445)
 * and a comment mark (in the margin).
 */
export type ElementKind = "link" | "fold" | "row" | "embed" | "comment" | "control" | "resource" | "task" | "callout" | "figure";
/** The controls of a comment thread expanded inline (PIE-420), as Detail has them: Select, Reply, Resolve or Reopen. */
export type ThreadControl = "select" | "reply" | "resolve";
/**
 * One element where the last render drew it. Rows are content rows: the header's, then the body's (so the
 * header's stay put and the body's move with the scroll). `ruler`: the rows [from, to) of the block it's in,
 * which the reading ruler tints while it's current. `key` names it across renders.
 */
interface Element {
  key: string; kind: ElementKind; row: number; from: number; to: number; ruler: [number, number]; label: string;
  link?: Link; value?: string; fold?: string; thread?: string; control?: ThreadControl;
  /** A checklist step's box (PIE-472): the step as it was read where it's drawn. */
  task?: StepRef;
  /** A callout's icon and type (PIE-538): the callout as it was read where it's drawn. */
  callout?: CalloutRef;
}
/** What ⏎ does on an `■ unsent` line's control. */
const UNSENT_VERB: Record<UnsentOp, string> = { diff: "show it against the note now", copy: "open its copy", dismiss: "dismiss it (its copy stays on disk)", take: "take it back into an edit", show: "show the old unsent edit" };
/** What ⏎ does on an element, for the hint. `open`: a fold is folded, a comment mark's thread is expanded. */
const verbOf = (e: Element, open: boolean) =>
  e.link?.ext ? extVerb(e.link.ext)
  : e.kind === "fold" ? (open ? "unfold" : "fold") : e.kind === "comment" ? (open ? "collapse its thread" : "expand its thread")
  : e.kind === "control" && e.link?.proposal?.op ? (e.link.proposal.op === "apply" ? "apply it anyway" : "dismiss it")
  : e.kind === "control" && e.link?.unsent ? UNSENT_VERB[e.link.unsent.op]
  : e.kind === "control" ? (e.control === "select" ? "select its passage" : e.control === "reply" ? "reply" : e.label.startsWith("Reopen") ? "reopen" : "resolve")
  : e.kind === "figure" ? (e.link?.figure?.tab !== undefined ? "show this tab" : "change the density") : e.kind === "row" ? "open its note" : e.kind === "embed" ? "open it" : e.kind === "task" ? "status" : e.kind === "callout" ? "choose its type"
  : e.kind === "resource" ? (e.link?.url ? "open the ticket's page" : "say why there's nothing to open") : e.link?.resource ? "show the resource" : e.link?.media || e.link?.url ? "open" : "follow";
/** What ⏎ does on an extension's line or control (PIE-512): its action's label, or run it again. */
function extVerb(x: NonNullable<LinkTarget["ext"]>): string {
  if (x.action === RUN_AGAIN) return "run it again";
  const a = extensionNamed(x.extension)?.actions.find(y => y.name === x.action);
  return a ? a.label.toLowerCase() : x.action;
}
/** The keys an extension's line answers to while it's the current element: its actions' (the reader's own stay its own), and r. */
function extKeys(x: NonNullable<LinkTarget["ext"]>, hostKeys: string): string {
  const own = (extensionNamed(x.extension)?.actions ?? []).filter(a => a.on === `handler:${x.handler}` && a.key && handlerKeyAction(x.extension, x.handler, a.key, hostKeys) === a);
  return [...own.map(a => `${a.key} ${a.id}`), "r again"].join(" · ");
}
/** Links, rows and embeds open a note, so alt+⏎ can open it in a new reader. */
const opens = (e: Element) => e.kind === "link" || e.kind === "row" || e.kind === "embed";

/**
 * An agent's (or the person's) focus mark in this reader (the door side of PIE-423): a block, and in it
 * maybe a passage, drawn with the reading ruler's tint and the one who set it named in the header. Kept as
 * what was named, and found again on each render, so a rewrap or a refresh keeps it on its text.
 */
/** What `block.tint` marks: a block, note lines or a passage (PIE-423's focus mark). */
const TINT_ARGS = {
  block: { type: "string", optional: true, about: "a block id (or its first 8+ characters): this note, or one it embeds or links" },
  line: { type: "number", optional: true, about: "a note line (1 is the subject)" },
  to: { type: "number", optional: true, about: "with line: the last note line" },
  quote: { type: "string", optional: true, about: "the note's exact words, as stored (the same shape as a comment's quote)" },
  near: { type: "number", optional: true, about: "with quote, when the words occur more than once: the offset to be nearest" },
} as const;
export type FocusSpec = ArgsOf<typeof TINT_ARGS>;
/** A comment mark: the margin row it's drawn on, and the rows of the lines its quote spans. */
interface Mark { thread: string; open: boolean; row: number; rows: [number, number]; label: string }
/** A thread control where the last render drew it: its body row, and columns in the body's own cells (no margin). */
interface Control { thread: string; control: ThreadControl; row: number; from: number; to: number; label: string }

/**
 * The note's links in reading order, as outline-core's scan finds them: `((…))` (transclusions too), `[[…]]` and
 * Markdown `[text](url)`.
 */
const linksOf = (m: Msg): Link[] => linkOccurrences(m.text).map((l): Link => {
  if (l.kind === "block") return { block: l.blockId, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
  if (l.kind === "page") return { page: l.displayAddress, ...(l.label !== undefined ? { label: l.label } : {}) };
  return { url: l.url, label: l.text };
});
/** How a link reads in the hint and `peek`: its title or label, as the note shows it. */
const linkText = (l: Link, text: string, src: Source | null) => l.block
  ? refView(l.block, l.fragment, l.label, referencesIn(text, src)?.get(refKey(l.block, l.fragment))).text
  : l.page ? pageView(l.page, l.label, pageOf(l.page, src)).text : l.url !== undefined ? l.label ?? l.url : l.media?.split("/").pop() ?? "";

/**
 * The readable body before its links are presented, line for line: `lines[i]` is the note line (from 0,
 * the subject) body line i comes from, `anchors[i]` the fragment anchor read mode hid from it. Matched
 * literal-region markers (PIE-422) are hidden, as Detail hides them; `literal` holds the body lines inside
 * a region, where `[key::value]` is text, and `unterminated` the note line of an opener without a closer.
 */
export function readableSource(m: Msg, src: Source | null): { text: string; lines: number[]; anchors: (string | undefined)[]; literal: Set<number>; unterminated: number | null } {
  const tokens = tokensOf(m.text, src);
  const hidden = metadataLines(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  const lit = literalLines(m.text);
  // The title may come from a later line (a marker or a props-only line first): what's above it isn't body.
  const title = Math.max(0, titleLine(m.text).line);
  const all = m.text.split("\n"), code = codeFenceLines(all);
  const rows = all.map((l, i) => ({ l, i })).filter(({ i }) => i > title && !hidden.has(i) && !lit.markers.has(i))
    // A stable fragment anchor (`## Beds ^beds`) is an address, not prose: read mode hides it, as Detail does.
    .map(({ l, i }) => {
      const a = code[i]! >= 0 ? null : fragmentAnchorMatch(l);
      return a ? { l: l.slice(0, a.index).trimEnd(), i, anchor: a[1] } : { l, i };
    });
  // Blank lines before the first line with text aren't drawn.
  let lead = 0;
  while (lead < rows.length - 1 && rows[lead]!.l === "") lead++;
  const kept = rows.slice(lead);
  const literal = new Set<number>();
  kept.forEach((r, k) => { if (lit.inside.has(r.i)) literal.add(k); });
  return { text: kept.map(r => r.l).join("\n"), lines: kept.map(r => r.i), anchors: kept.map(r => ("anchor" in r ? r.anchor : undefined)), literal, unterminated: lit.unterminated };
}
/** Text from elsewhere (an extension's output) without control characters, its lines and tabs kept. */
const printableBlock = (s: string) => printable(s, "", { lines: true });
/** A link drawn: its text, tagged with its place in `drawn` (what [ ], ⏎ and a click find it by). */
const tagged = (drawn: Link[], to: Link, text: string) => linkTag(drawn.push(to) - 1) + text + LINK_END;
/** ctrl+s on a comment or reply being written (not while its completion popup is open, which takes keys first). */
const sessionKey = (s: CommentSession, k: Key, c: string) => s.mode === "compose" && !!s.composer && !s.busy && !s.composer.busy && k.kind === "char" && !!k.ctrl && k.ch === c && !completerOf(s.composer)?.shown;
const sessionSend = (s: CommentSession, k: Key) => sessionKey(s, k, "s");

export { leaveSaid, propertyChange, type LeaveResult };

/**
 * A step's status choice, open under its box (PIE-472): the step's element key, the choice the keys are on,
 * and what the last choice said. The person's alone (an agent sets a status by `task.status`).
 */
/**
 * The choice open under an element: a step's status (PIE-472) or a callout's type (PIE-538). The element (its key),
 * the choices as a list picker, what the last choice said.
 */
interface Choice { id: string; label: string; key: string }
interface Picker { key: string; kind?: "callout"; list: ListPicker<Choice, SurfaceHost>; note: string; busy: boolean; types?: CalloutRegistry }
/** The reader's four modes (src/surface/modes.ts), each with what it's about. */
type DraftMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: DraftSession; describe(): ReturnType<DraftSession["describe"]> & { writtenBy: string | null } };
type CommentMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { session: CommentSession; describe(): ReturnType<CommentSession["describe"]> };
type PanelMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { panel: PropertyPanel; describe(): { open: string; selected: number; note: string | null; editing: { n: number; key: string; text: string; revision: number; changedElsewhere: boolean; note: string | null } | null; rows: ReturnType<typeof describeRow>[] } | null };
type PickerMode = Omit<ReaderMode<SurfaceHost>, "describe"> & { picker: Picker; describe(): { step?: string | null; callout?: string | null; choices?: string[]; selected: string | undefined; note: string | null } };

/** How long a missing page's offer stands (PIE-544): the next ⏎ or click on its link within it makes the page. */
const PAGE_OFFER_MS = 60_000;

/** Agent actions that open an edit or a comment session on the note. */
const STARTS_SESSION = new Set(["edit", "edit.text", "passage.select", "comment.write", "comment", "threads", "reply", "resolve"]);

export class NoteSurface {
  msg: Msg | null = null;
  scroll = 0;
  /** The furthest the note scrolls, from its last render (keys and the wheel stop there). */
  private maxScroll = Infinity;
  /** The last layout, reused by a frame that only scrolled. */
  private laid: Laid | null = null;
  private crumbs = "";
  /** Shown under the header after a save that changed the note's properties, until the surface moves on. */
  notice = "";
  private links: Link[] = [];
  /** What the last render put where, for clicks (PIE-415). */
  private hits: Hit[] = [];
  unfold = false;
  /**
   * Drawn for print (`ep0ch show`, `--cells`): nobody presses a key in what it draws, so a tabs figure draws every
   * group in turn under a heading, and no figure draws a control.
   */
  printed = false;
  /** The link `[ ]` or a click selected, as an index into `links` (the river steps these; it draws its own body). */
  private link = -1;
  /** The elements the last reading render drew, in reading order; empty until one (and in the river). */
  private elems: Element[] = [];
  /** The current element (its key): where `[ ]` is, what ⏎ acts on, what the ruler tints (PIE-441). */
  private cur: string | null = null;
  /** Bring the current element into view on the next render (after `[ ]`, `( )` or a fold). */
  private reveal = false;
  /** A focus mark an agent (or the person, through `act`) set here: never the person's `[ ]` position. */
  focusMark: { by: Actor; spec: FocusSpec; label: string; at: number; fragment?: boolean } | null = null;
  private revealMark = false;
  /**
   * Folded headings and list items (their FoldPoint keys): this reader's reading state, never the note's
   * text. Kept while the note refreshes or is edited elsewhere; cleared when the reader shows another note.
   */
  folded = new Set<string>();
  /**
   * Comment threads expanded inline under their passage (PIE-420), by thread id: like `folded`, this
   * reader's reading state and the person's alone (an agent's action never expands or collapses one).
   */
  expanded = new Set<string>();
  /**
   * Each live figure's chosen tab and density (src/graphs.ts), by the figure's key (its place among the note's figures
   * and its title): like `folded`, this reader's reading state, kept across repaints and live answers, never written
   * into the note, cleared when the reader shows another note.
   */
  figureUI = new Map<string, FigureChoice>();
  /** The figures the last layout drew (their tabs, counts, what's chosen): what `figure.tab` and `figures` name. */
  figuresDrawn: FigureInfo[] = [];
  /** The thread a Reply control asked to answer: the thread list opening next starts the reply there. */
  private replyOn: string | null = null;
  /** The fold point selected (its key), which `f` and ⏎ fold or unfold: the current element, when it's a fold. */
  private get foldSel(): string | null { return this.cur?.startsWith("fold:") ? this.cur.slice(5) : null; }
  private set foldSel(key: string | null) {
    if (key !== null) { this.cur = `fold:${key}`; this.link = -1; }
    else if (this.foldSel !== null) this.cur = null;
  }
  private foldsOf: string | null = null;
  /**
   * The fold points this reader has met in its note: a callout written `[!type]-` is folded when it's first met
   * (PIE-538), and after that it's the person's to open or fold, like any other.
   */
  private foldSeen = new Set<string>();
  private foldCache: { text: string; points: FoldPoint[]; lines: number[] } | null = null;
  /** The last reading render: where the body starts, how far it's scrolled, and its rows' sources and fold heads. */
  /** What the last render drew: `heroRows`, the rows of the header image above it (PIE-532), which every row here is under. */
  private drawn: { w: number; top: number; scroll: number; room: number; doc: Doc; lines: number[]; head: string[]; body: string[]; heroRows: number } | null = null;
  /** The last render brought the current element in (reveal), so it's brought in again once the header's rows are known. */
  private lastReveal = false;
  /** The last draw was a host's digest (`digest`): its elements are current, whole, with no scroll of the surface's own. */
  private digesting = false;
  /**
   * The person's selected text (PIE-419), in content rows: the header's rows, then the body's, so it
   * stays on its text as the note scrolls. Only `y`, `Y` or the copy control copy it; selecting never does.
   */
  selection: Selection | null = null;
  /** What an agent selected here: drawn in its own tint, never the person's, never on their clipboard. */
  agentSelection: { id: string; sel: Selection } | null = null;
  private gesture = new Gesture();
  /** A press landed in the draft's text: a drag from it selects there. */
  private editPress = false;
  private dragging = false;
  /**
   * What takes the reader's keys besides reading (src/surface/modes.ts): a step's status choice, the property
   * panel, the edit, the comment session, in their precedence. The fields below are views of it.
   */
  private readonly modes = new ModeStack<SurfaceHost>();
  /**
   * An open edit of `msg`: a draft session with the block adapter (src/draft-session.ts). While it exists
   * every key goes to it and the surface stays on its note.
   */
  get drafting(): DraftSession | null { return (this.modes.get("draft") as DraftMode | null)?.session ?? null; }
  /** The edit's text (the session's draft). */
  get draft(): Draft | null { return this.drafting?.draft ?? null; }
  /** The draft session the reader holds: its edit's, else its comment's text (the draft rule asks it, PIE-514). */
  draftSession(): DraftSession | null { return this.drafting ?? this.session?.writing ?? null; }
  /**
   * The person is in this reader's edit, comment or panel: it holds the keys, and it isn't an agent's own that the
   * person hasn't typed in (an agent's comment holds a reader's keys from the start; it's the person's once they type).
   * What a reader with no desk around it says is where the person types (the desk asks whether they entered it).
   */
  get personHolds(): boolean {
    if (!this.holdsKeys) return false;
    const s = this.draftSession();
    if (s) return !(s.openedBy.kind === "agent" && s.draft.writers.every(w => w.kind === "agent"));
    return this.session?.startedBy.kind !== "agent";
  }
  /** It holds an edit or a comment that's `actor`'s own: one they opened or typed in (a tile named by a block id prefers it). */
  heldBy(actor: Actor): boolean {
    const s = this.draftSession();
    return !!s && (sameParty(s.openedBy, actor) || s.draft.writers.some(w => sameParty(w, actor)));
  }
  /** Commenting on `msg` (picking a passage, writing, the thread list). Holds keys and the note like a draft. */
  get session(): CommentSession | null { return (this.modes.get("comment") as CommentMode | null)?.session ?? null; }
  set session(s: CommentSession | null) { if (s) this.modes.push(this.commentMode(s)); else this.modes.drop("comment"); }
  /** The note's comment threads, for the count in the header and the marks while picking a passage. */
  comments: Comment[] | null = null;
  private commentsFor = "";
  private commentTimer: Timer | null = null;
  /** Why the whole note behind a list row couldn't be read; empty while reading or once read. */
  unread = "";
  /**
   * The last thing an agent did here, shown in the header until the surface shows another note, or, when it
   * was done to the draft being written (`agentDraft`), until that draft closes.
   */
  agent: { id: string; did: string; at: number } | null = null;
  private agentDraft: Draft | null = null;
  /** The property panel, while open (`i`). It holds the reader's keys; editing a value also holds the note. */
  get panel(): PropertyPanel | null { return (this.modes.get("panel") as PanelMode | null)?.panel ?? null; }
  set panel(p: PropertyPanel | null) { if (p) this.modes.push(this.panelMode(p)); else this.modes.drop("panel"); }
  /** The summary keys the host gave for the note shown (a lane's), refreshed on every render. */
  private viewKeys: readonly string[] | null = null;
  /** Where this reader's property, link and embed reads go (its host's connection), from the last host seen. */
  src: Source | null = null;
  /** Back and forward (PIE-453): the places this reader showed before, nearest last, and those back came from. */
  private backs: Place[] = [];
  private aheads: Place[] = [];
  /** The view's own history, from the last host seen (SurfaceHost.history), for `peek` and the hint. */
  private kept: ReaderHistory | null = null;
  private tracking = 0;
  /**
   * A step's status choice, open under its box (PIE-472): the step's element key, the choice the keys are
   * on, and what the last choice said. The person's alone (an agent sets a status by `task.status`); it
   * holds the reader's keys until a choice is made or esc.
   */
  get picker(): Picker | null { return (this.modes.get("picker") as PickerMode | null)?.picker ?? null; }
  set picker(p: Picker | null) { if (p) this.modes.push(this.pickerMode(p)); else this.modes.drop("picker"); }
  /** The header image the last render drew above the note (PIE-532): its rows, and its image's element. */
  private hero: { line: number; full: number } | null = null;
  /** The header's backdrop the last render drew (PIE-598): its image and note line, its step, and how it was drawn. */
  private backdropShown: { image: string; line: number; step: number; of: number; mode: HeroMode; drawn: "kitty" | "cells" | "making" | null; over?: string } | null = null;
  /** The step changes made in this reader, for Undo (ctrl+z, `task.undo`): each party undoes its own. */
  readonly stepHistory = new UndoHistory();
  /** The callout changes made in this reader (PIE-538), for Undo: each party undoes its own. */
  readonly calloutHistory = new UndoHistory<LineUndo>();
  /** Image layout changes (PIE-532) made here, for image.undo. */
  readonly imageHistory = new UndoHistory<LineUndo>();
  /** The step that last got its id here: its element key before and after (see keepCurrent). */
  private stepRenamed: { was: string; now: string } | null = null;
  /** The keys the last host keeps for itself (SurfaceHost.ownKeys), for the hint. */
  private hostKeys = "";
  private use(host: SurfaceHost | undefined): Source | null {
    if (host) { this.src = { board: host.ctx.board, redraw: () => host.redraw() }; this.kept = host.history ?? null; this.hostKeys = host.ownKeys ?? ""; }
    return this.src;
  }

  /** An edit, a comment, or a property value being typed: the surface stays on its note and takes every key. */
  get editing() { return this.modes.editing; }
  /**
   * The surface wants every key, the host's shortcuts included (Tab, o, …): while editing, and while the
   * property panel is open. Unlike `editing`, an open panel doesn't hold the note or refuse clicks.
   */
  get holdsKeys() { return this.modes.holdsKeys; }
  /**
   * A step's status choice is open (PIE-472): the person opened it with their own ⏎ or click, so their next
   * keys are its (x o w ! y a, j k, ⏎, esc) until they choose or cancel. Hosts give it every key first; it
   * isn't a session (it holds no note, and an agent never opens one).
   */
  get choosing() { return this.modes.get("picker") !== null; }
  /** The current element's kind while it's in view (a host's ⏎ and space defer to it on a step). */
  currentKind(): ElementKind | null { return this.inView()?.kind ?? null; }
  /** The note itself is shown, so j k PgDn scroll it: not while a draft, a comment session or the full property panel is drawn instead. */
  scrolls(): boolean { return !this.modes.covers; }
  /**
   * What holds the surface's keys now: the draft, the comment session or the property panel (null while
   * reading). Hosts compare it by identity to know whether the person is in this one (PIE-411).
   */
  sessionOf(): object | null { return this.sessionMode()?.of ?? null; }
  /**
   * The mode the person is in, as hosts track it (Entered): the edit, else the comment, else the panel. A status
   * choice opened over one of them isn't a session: it holds no note.
   */
  private sessionMode() { return this.modes.get("draft") ?? this.modes.get("comment") ?? this.modes.get("panel"); }
  /** What the person is in here, by name ("edit", "comment", "property panel"), or null while reading. */
  sessionWord(): string | null { return this.sessionMode()?.word ?? null; }
  /** Typed text that isn't saved or sent: an edit, a comment being written, a property value. */
  unsaved() { return this.modes.unsaved(); }
  /** Copy unsaved text to disk (the screen is closing anyway); kept where it was written too, so opening it again brings it back. */
  keepDrafts(): string[] { return this.modes.keep(); }

  /** "editing · unsaved", "writing", "quoting", "comments", "properties", or null while reading. For the host's title. */
  state(): string | null {
    for (const m of this.modes.all()) { const st = m.state(); if (st) return st; }
    return null;
  }

  /** The keys that work right now. `extra` goes before the reading keys (a host's own, like `p pin`). */
  hint(extra = ""): string {
    const mode = this.modes.top();
    if (mode) return mode.hint();
    const rows = this.selection && this.selRows();
    if (rows) return selectionHint(this.selection!, [...this.selection!.text(rows)].length);
    const points = this.msg && !this.msg.partial ? this.visibleFolds(this.msg) : [];
    const sel = this.selectedFold(), f = sel ? points.indexOf(sel) : -1;
    if (f >= 0) { const p = points[f]!; return `fold ${f + 1}/${points.length} ${foldLabel(p).slice(0, 60)} · ⏎ f ${this.folded.has(p.key) ? "unfold" : "fold"} · F all · ( ) next · [ ] elements`; }
    // The current element, named (PIE-441); one an agent's mark scrolled away is named, but ⏎ waits for it.
    const away = !this.inView() && this.drawn ? this.elems.find(x => x.key === this.cur) : undefined;
    if (away) return `[ ] ${this.elems.indexOf(away) + 1}/${this.elems.length} · ${away.kind} ${printable(away.label).slice(0, 60)} · out of view · [ ] steps on from it`;
    const e = this.inView(), i = e ? this.elems.indexOf(e) : -1;
    // A proposal's keys go first: in a narrow tile the hint is cut from the end.
    // An extension's line or control: its keys go first, as a proposal's do.
    if (e?.link?.ext) return `[ ] ${i + 1}/${this.elems.length} · ${extKeys(e.link.ext, this.hostKeys)} · ${e.kind === "control" ? "control" : "line"} ${printable(e.label).slice(0, 50)} · ⏎ ${verbOf(e, false)}${e.kind === "resource" ? " · y copy" : ""}`;
    if (e && e.kind !== "fold") return `[ ] ${i + 1}/${this.elems.length} · ${e.link?.proposal ? this.proposalKeys(e.link.proposal.id) : ""}${e.kind === "task" ? "step" : e.kind} ${e.link?.media ? "▣ " : ""}${printable(e.label).slice(0, 60)} · ⏎ ${verbOf(e, e.kind === "comment" && this.expanded.has(e.thread!))}${opens(e) ? " · alt⏎ new" : ""}${e.kind === "resource" ? " · y copy" : ""}${e.kind === "task" ? " · space done/to do · ctrl+z undo" : ""}${this.figureHint()}`;
    // A link selected without a drawn body (the river's column, or one `link.select` named that isn't drawn).
    const l = !this.cur ? this.links[this.link] : undefined;
    if (l) return `link ${this.link + 1}/${this.links.length} ${l.media ? "▣ " : ""}${printable(linkText(l, this.msg?.text ?? "", this.src)).slice(0, 60)} · ⏎ ${l.media || l.url ? "open" : "follow"}`;
    const back = this.peek(-1) ? "alt← back · " : "";
    // A proposal an agent's patch left (PIE-501): A applies it anyway (unless it can't be applied), X dismisses it.
    const proposal = this.msg && isOpenProposal(this.msg) ? (proposalApplies(this.msg) ? "A apply anyway · X dismiss · " : "X dismiss · ") : "";
    return `${extra}${proposal}${back}[ ] elements · ( ) f folds · i properties · z callouts · u up · C comment · m comments`;
  }

  // ── which note ─────────────────────────────────────────────────────────────

  /**
   * Whether outline event `e` means the note shown should be read again (every reader asks this: the desk's,
   * the board's, the river's and the BBS message reader; each then calls `reread`): a change that names it
   * with a revision other than the one shown (not its own save coming back), a reset after a reconnect that
   * couldn't catch up, or any trash, restore or purge. The service's event names only the root of what was
   * trashed and moves no revision, so a note trashed with an ancestor is told only by reading it again ("in
   * the Trash"); `reread` keeps a burst of them to one more read per reader.
   */
  staleOn(e: OutlineEvent): boolean {
    const m = this.msg;
    if (!m) return false;
    if (e.action === "reset") return true;
    const c = e.change;
    if (c && (c.kind === "delete" || c.kind === "restore" || c.kind === "purge")) return true;
    return e.blockId === m.id && !(c?.revision !== undefined && m.revision === c.revision && !m.partial);
  }

  private rereading = false;
  private rereadAgain = false;

  /**
   * Read the note shown again and take it in (`refresh`: the scroll, the selection and an open draft stay;
   * a draft is only marked). One read at a time: changes that come while one is out (a burst of trashes, a
   * catch-up after a reconnect) make one more read when it's back, never one each.
   */
  reread(host: SurfaceHost) {
    const m = this.msg;
    if (!m || !isOutlineNote(m)) return;
    if (this.rereading) { this.rereadAgain = true; return; }
    this.rereading = true;
    host.ctx.board.get(m.id).then(n => { if (n) { this.refresh(n); host.redraw(); } }, () => {}).finally(() => {
      this.rereading = false;
      if (this.rereadAgain) { this.rereadAgain = false; this.reread(host); }
    });
  }

  /**
   * Same note, new text: keep the scroll position and link selection. An open draft is never replaced;
   * it is marked "changed elsewhere" and the save's revision check decides.
   */
  refresh(m: Msg) {
    if (this.msg?.id !== m.id) return;
    // What a mode holds (an edit, a value being typed) is marked "changed elsewhere", never replaced.
    if (m.revision !== undefined) this.modes.changed(m.revision, !!m.partial);
    if (m.partial && !this.msg.partial) return;           // a list row never replaces the whole note
    if (!m.partial) this.unread = "";
    this.msg = m;
    if (!this.draft) this.links = linksOf(m);
  }

  /** Show a note (or nothing). Refused, returning false, while an edit or a comment holds the surface on its note. */
  show(m: Msg | null, host: SurfaceHost): boolean {
    this.use(host);
    // An edit, a comment or a value being typed holds the reader on its note.
    if (this.modes.editing && m?.id !== this.msg?.id) return false;
    if (m?.id !== this.msg?.id) { this.notice = ""; this.pageOffer = null; this.agent = null; this.agentDraft = null; this.focusMark = null; this.picker = null; this.clearSelections(); if (this.panel) { this.panel.sel = 0; this.panel.view.reset(); this.panel.note = ""; } }
    if ((m?.id ?? null) !== this.foldsOf) { this.folded.clear(); this.foldSeen.clear(); this.expanded.clear(); this.figureUI.clear(); this.figuresDrawn = []; this.foldsOf = m?.id ?? null; }
    this.msg = m; this.scroll = 0; this.maxScroll = Infinity; this.letGo(); this.elems = []; this.crumbs = "…"; this.unread = "";
    this.links = m ? linksOf(m) : [];
    if (m?.id !== this.commentsFor) { this.comments = null; this.commentsFor = ""; }
    if (!m) return true;
    // A Resource or a file shown as a note: nothing in the outline to read for it.
    if (!isOutlineNote(m)) { this.crumbs = m.id.startsWith(RESOURCE_NOTE) ? "a Resource · not a note in the outline" : m.id.startsWith(UNSENT_NOTE) ? "an unsent draft · read here, never written" : "a file"; return true; }
    // Lists carry title, properties and revision only; the surface fetches the whole note.
    if (m.partial) this.readWhole(host);
    void this.loadComments(host);
    // A followed `((id^fragment))` opened here: the fragment comes into view, marked (PIE-425).
    this.takeReveal(m, host);
    host.ctx.board.ancestors(m.id).then(a => {
      if (this.msg?.id !== m.id) return;
      this.crumbs = a.map(subject).join(" › ") || "top level"; host.redraw();
    }, () => {});
    return true;
  }

  /** A list row's whole note. A failure is shown, and `retry` (on reconnect) asks again. */
  private readWhole(host: SurfaceHost) {
    const id = this.msg?.id;
    if (!id) return;
    this.unread = "";
    host.ctx.board.get(id).then(full => {
      if (this.msg?.id !== id || !this.msg.partial) return;
      if (full) { this.msg = full; this.links = linksOf(full); }
      else this.unread = "it isn't in the outline any more";
      host.redraw();
    }, (e: Error) => {
      if (this.msg?.id !== id || !this.msg.partial) return;
      this.unread = e.message || String(e);
      host.redraw();
    });
  }

  /** Still showing a list row (its read failed or was cut off): read the whole note again. */
  retry(host: SurfaceHost) { if (this.msg?.partial) this.readWhole(host); }

  // ── drawing ────────────────────────────────────────────────────────────────

  /**
   * The surface at any width: a board reader, a desk pane, or a narrow river column. A note with a header image
   * (PIE-532) has it drawn above everything else, the full width (heroOf), and the note under it (`renderNote`), which
   * decides how many of its rows show (`drawn.heroRows`, after the scroll is clamped): every row the note drew, and
   * every click on it, is that many rows down.
   */
  render(w: number, h: number, host?: SurfaceHost): SurfaceView {
    const hero = this.heroOf(w, h, host);
    this.hero = hero && { line: hero.line, full: hero.box.rows };
    const v = this.renderNote(w, h, host);
    const shown = this.drawn?.heroRows ?? 0;
    if (!hero || !shown) return v;
    const cut = hero.box.rows - shown, lines = Array.from({ length: shown }, () => "");
    if (!hero.placement && hero.loading) lines[shown >> 1] = dim(pad(`  ◌ header · ${hero.name} · loading…`, w));
    const p = hero.placement && inWindow(hero.placement, cut, shown);
    return { ...v, lines: [...lines, ...v.lines], placements: [...(p ? [p] : []), ...(v.placements ?? []).map(x => ({ ...x, row: x.row + shown }))] };
  }

  /**
   * The header image this render draws above the note (PIE-532), or null: the note's first `[layout::hero]` image, when
   * the host draws Kitty graphics, nothing covers the note and the pane is tall enough to give it rows (at most a third
   * of the pane, or `[height::…]`, never more than half). The full width, the whole image when it fits; taller, cropped
   * to fill (`[fit::contain]`: shown whole, centred). Dimmed as every image is (`[dim::…]`). While the file loads its
   * rows (the cap's) are kept dark, so nothing flashes when it arrives; an image shorter than the cap then takes
   * fewer rows, and the note moves up once.
   */
  private heroOf(w: number, h: number, host?: SurfaceHost): { line: number; box: ReturnType<typeof heroBox>; placement: Placement | null; loading: boolean; name: string } | null {
    const m = this.msg;
    if (!m || m.partial || !host?.ctx.graphics || this.modes.covers || this.panel?.full || h < HERO_MIN_PANE) return null;
    const ref = this.imagesIn(m).find(x => x.spec.layout === "hero");
    if (!ref) return null;
    const entry = media(ref.path, ref.spec.kind);
    if (entry.state === "error") return null;
    const cap = Math.max(3, Math.min(ref.spec.height ?? Math.floor(h / 3), Math.floor(h / 2)));
    const name = ref.path.split("/").pop() ?? ref.path;
    const [cw, chh] = cellOf(host);
    // Its rows come from its size, read from its header before it's decoded: the note never moves when it arrives.
    if (entry.state === "loading") {
      const box = entry.width && entry.height ? heroBox({ width: entry.width, height: entry.height }, ref.spec, w, cap, cw, chh) : { col: 0, cols: w, rows: cap };
      return { line: ref.line, box, placement: null, loading: true, name };
    }
    const box = heroBox(entry, ref.spec, w, cap, cw, chh);
    const [placement] = imagePlacements([{ line: 0, media: entry, ...(ref.spec.dim !== undefined ? { dim: ref.spec.dim } : {}), ...box }], 0, cw, chh);
    return { line: ref.line, box, placement: placement ? { ...placement, key: `hero:${placement.key}` } : null, loading: false, name };
  }

  /**
   * The header's backdrop this render draws (PIE-598): the picture that has gone under the header (heroSources), at
   * the step for how far it has gone; in follow mode, a picture still coming in is drawn over the one before it at
   * full, so one fades into the next and the header never drops to plain between them. Kitty: their placements (the
   * one before a layer lower); cells: the colours under each header cell. Kept for describe (`header.backdrop`).
   */
  private heroBackdrop(m: Msg, doc: Doc, noteLines: number[], w: number, rows: number, host?: SurfaceHost): { placements: Placement[]; grid: CellGrid | null } {
    this.backdropShown = null;
    const none = { placements: [], grid: null };
    if (!heroHeaderOn() || !host || rows < 1) return none;
    const mode = heroHeaderMode(), all = this.heroSources(m, doc, noteLines, mode);
    if (!all.length) return none;
    // The last that has gone under (the first, before any has); in first mode there's only the hero.
    const at = Math.max(0, all.findLastIndex(x => x.gone > 0)), pick = all[at]!, step = heroStep(pick.gone);
    const graphics = !!host.ctx.graphics, cell = cellOf(host);
    const draw = (x: (typeof all)[number], n: number, over: { grid?: CellGrid; z?: number } = {}) => {
      const entry = media(x.path, x.kind);
      return entry.state === "ready" ? backdrop(entry, x.focus, x.dim, n, w, rows, ...cell, graphics, over) : null;
    };
    const before = mode === "follow" && at > 0 && step < HERO_STEPS ? all[at - 1]! : null;
    const under = before ? draw(before, HERO_STEPS, { z: -3 }) : null;
    const shade = draw(pick, step, under && "grid" in under ? { grid: under.grid } : {});
    const name = (x: { path: string }) => x.path.split("/").pop() ?? x.path;
    this.backdropShown = {
      image: name(pick), line: pick.line + 1, step, of: HERO_STEPS, mode, drawn: !step && !under ? null : !shade && !under ? "making" : graphics ? "kitty" : "cells",
      ...(before && under ? { over: name(before) } : {}),
    };
    if (!graphics) return { placements: [], grid: shade && "grid" in shade ? shade.grid : under && "grid" in under ? under.grid : null };
    return { placements: [under, shade].flatMap(b => (b && "placement" in b ? [b.placement] : [])), grid: null };
  }

  /**
   * The pictures a header's backdrop can be made from, in reading order, each with its note line and how far it has
   * gone under the header (0–1): the header image's rows scrolled away, a body image's rows scrolled above the note,
   * or (not drawn: cells) the rows scrolled past its line. First mode: the hero only (the header image drawn above the
   * title, else the first `[layout::hero]` image, else an image that is the note's first block). Follow: the header
   * image, then every image in the body.
   */
  private heroSources(m: Msg, doc: Doc, noteLines: number[], mode: HeroMode): { path: string; kind: "img" | "video"; focus?: Focus; dim?: number; line: number; gone: number }[] {
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const look = (spec: MediaSpec) => ({ ...(spec.focus ? { focus: spec.focus } : {}), ...(spec.dim !== undefined ? { dim: spec.dim } : {}) });
    const out: ReturnType<NoteSurface["heroSources"]> = [];
    if (this.hero) {
      const ref = this.imagesIn(m).find(x => x.line === this.hero!.line);
      if (ref) out.push({ path: ref.path, kind: ref.spec.kind, ...look(ref.spec), line: ref.line, gone: clamp(this.scroll / Math.max(1, this.hero.full)) });
      if (mode === "first") return out;
    }
    const all = m.text.split("\n"), first = doc.media[0];
    const firstBlock = first && noteLines[first.line] !== undefined && all.slice(1, noteLines[first.line]).every(l => !l.trim()) ? first : undefined;
    const body = mode === "follow" ? doc.media : [doc.media.find(x => x.spec.layout === "hero") ?? firstBlock].filter(x => x !== undefined);
    for (const x of body) {
      const line = noteLines[x.line];
      if (line === undefined || x.spec.kind !== "img" || line === this.hero?.line) continue;
      const im = x.image !== undefined ? doc.images[x.image] : undefined;
      const gone = im ? (this.scroll - im.line) / Math.max(1, im.rows) : (this.scroll - x.row) / HERO_RAMP_ROWS;
      out.push({ path: x.path, kind: x.spec.kind, ...look(x.spec), line, gone: clamp(gone) });
    }
    return out;
  }

  /** The note itself, under its header image if it has one (render). */
  private renderNote(w: number, h: number, host?: SurfaceHost): SurfaceView {
    this.hits = [];
    const m = this.msg;
    this.drawn = null;
    this.digesting = false;
    this.backdropShown = null;
    if (!m) return { lines: [dim("pick something in the outline")] };
    // An edit or a comment session draws in place of the note (a reply that landed has let its session go).
    this.use(host);
    const covered = this.modes.rows(w, h, host);
    if (covered) return { lines: covered };
    if (m.partial) return { lines: [...(host?.header ? host.header(m, w, this.headerInfo(m, 0)) : [fg(C.white) + pad(subject(m), w) + RESET]), this.unread ? fg(C.lred) + pad(`couldn't read the note: ${this.unread}`, w) + RESET : dim("reading the note…"), ...(this.unread ? [dim("it's read again when the door reconnects")] : [])] };
    this.viewKeys = host?.summaryKeys?.(m) ?? null;
    const src = this.use(host);
    // Back and forward (PIE-453): the reader's last row, while it has somewhere to go.
    const foot = this.panel?.full || h <= 3 ? null : historyRow(w, this.peek(-1), this.peek(1));
    if (foot) h -= 1;
    const meta = [m.author ?? "?", bbsDate(m.updatedAt), m.props["work-id"]].filter(Boolean).join(" · ");
    const unterminated = m.text.includes("<!--") ? literalLines(m.text).unterminated : null;
    const open = this.comments?.filter(c => c.open).length ?? 0;
    const said = this.comments?.length ? `${fg(open ? C.yellow : C.dark)} · ■ ${open ? `${open} open comment${open === 1 ? "" : "s"}` : `${this.comments.length} resolved`} (m)` : "";
    // Detail's summary line: the chosen keys only; everything else is in the property panel (`i`).
    // A value that names a block, a page or a Work ID reads as a link, and a click opens it.
    const { text: summary, line: summaryLine, links: summaryLinks } = this.summaryView(m, src);
    const count = this.rows(m).length;
    // A host's own header (the BBS message header) stands in for the title, byline and crumbs; the
    // summary line comes after it, so its row is counted rather than assumed.
    const own = host?.header?.(m, w, this.headerInfo(m, count));
    const summaryRow = own ? own.length : 1;
    const summaryRows = summary ? [pad(fg(C.lgreen) + summaryLine + (this.panel ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`), w) + RESET] : [];
    // An agent's proposal, opened (PIE-501): its [apply] [dismiss] on a row of their own under the byline.
    const proposalTags: Link[] = [];
    const proposalHead = isOpenProposal(m) ? { row: own ? own.length + summaryRows.length : 3 + summaryRows.length, ...extractLinks([pad(fg(C.yellow) + "proposal ·" + proposalControls(m, proposalTags) + fg(C.dark) + (proposalApplies(m) ? " · A apply anyway · X dismiss" : " · X dismiss · it can't be applied: its passage was already gone"), w) + RESET]) } : null;
    const head = [
      ...(own ? [...own, ...summaryRows] : [
        fg(C.white) + pad(subject(m), w) + RESET,
        ...summaryRows,
        pad(fg(C.brown) + meta + (summary || this.panel || !count ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`) + said, w) + RESET,
        fg(C.cyan) + pad(this.crumbs, w) + RESET,
      ]),
      ...(proposalHead ? proposalHead.lines : []),
      // A note trashed while it's shown (a proposal dismissed, a card or an ancestor trashed elsewhere: staleOn) says so: it's still readable.
      ...(m.deleted ? [fg(C.lred) + pad(IN_TRASH, w) + RESET] : []),
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
    ];
    // A draft put aside on this note (esc twice, a closed screen, the door quitting) says so, with its controls:
    // [diff] [open copy] [dismiss] [take it back]; an old one on an older revision folds into one dim line.
    const unsentHead = this.unsentHead(m, w, head.length);
    head.push(...unsentHead.lines,
      // An opener without a closer protects nothing: say so, as Detail does (PIE-422).
      ...(unterminated !== null ? [fg(C.yellow) + pad(`⚠ the <!-- literal --> on line ${unterminated + 1} has no closing <!-- /literal --> line, so properties after it are still read`, w) + RESET] : []),
      ...(this.agent ? [fg(C.lmagenta) + pad(`an agent (${this.agent.id}) ${this.agent.did}`, w) + RESET] : []),
      // A focus mark says whose it is, in the ruler's own tint (PIE-423).
      ...(this.focusMark ? [RULER_BG + fg(C.lmagenta) + pad(this.focusMark.fragment ? `◆ ${this.focusMark.label} · the fragment the link names${this.focusMark.by.kind === "agent" ? ` · ${agentLabel(this.focusMark.by)} followed it` : ""} · esc lets go` : `◆ focus · ${agentLabel(this.focusMark.by)} marked ${this.focusMark.label}`, w).split(RESET).join(RESET + RULER_BG) + RESET] : []),
    );
    if (this.panel) {
      const rows = this.rows(m);
      const tokens = tokensOf(m.text, src);
      const info = { revision: m.revision, summary: this.summary(m).keys, source: this.summary(m).source, scopes: tokens === null ? "loading" as const : tokens.state === "ready" ? "ready" as const : "block" as const, src, text: m.text };
      const at = head.length;
      const panelHits = () => { for (const r of this.panel!.at) this.hits.push({ row: at + r.y, from: 0, to: w, prop: r.n, follow: false }, ...(r.target ? [{ row: at + r.y, from: r.from, to: w, prop: r.n, follow: true }] : [])); };
      if (this.panel.full) { const lines = [...head, ...this.panel.render(rows, w, Math.max(2, h - head.length), info)]; panelHits(); return { lines }; }
      const ph = Math.min(rows.length + 2 + (this.panel.note || this.panel.field?.note ? 1 : 0), Math.max(4, Math.floor((h - head.length) * 0.5)));
      head.push(...this.panel.render(rows, w, ph, info));
      panelHits();
    }
    head.push(rule(w));
    const top = head.length;
    const laid = this.layOut(m, w, h, head, summaryRow, summary ? summaryLinks : [], host, src);
    const { doc, drawn, picks, controls, body, marks, lines: noteLines } = laid;
    this.elems = laid.elems;
    // An opened proposal's [apply] [dismiss] (in the header, so not part of the kept layout): elements and click targets.
    if (proposalHead) {
      const own: Element[] = proposalHead.ranges.map(r => {
        const l = proposalTags[r.n]!, key = `control:proposal:${l.proposal!.op}:${m.id}#0`;
        this.hits.push({ row: proposalHead.row, from: r.from, to: r.to, link: l, elem: key });
        return { key, kind: "control", row: proposalHead.row, from: r.from, to: r.to, ruler: [proposalHead.row, proposalHead.row + 1], label: `[${l.proposal!.op}] this proposal`, link: l };
      });
      this.elems = [...laid.elems, ...own].sort((a, b) => a.row - b.row || a.from - b.from);
    }
    if (unsentHead.elems.length) this.elems = [...this.elems, ...unsentHead.elems].sort((a, b) => a.row - b.row || a.from - b.from);
    this.keepCurrent(host);
    // The body rows actually shown: none when the header fills the pane (then there's no scroll to show). A header
    // image above it (PIE-532) gives a row back for each row scrolled, so the furthest scroll is where the last body
    // row shows: S ≤ body − (roomFull − (full − S)) while the image shows, S ≤ body − roomFull once it's gone.
    const full = this.hero?.full ?? 0, roomFull = Math.max(0, h - top);
    const roomAt = (s: number) => Math.max(0, roomFull - Math.max(0, full - s));
    const over = body.length - Math.max(1, roomFull);
    this.maxScroll = !full || over >= full ? Math.max(0, over) : Math.max(0, Math.ceil((over + full) / 2));
    let room = roomAt(this.scroll);
    // The element just stepped to, or the fold point just folded, comes into view; so does an agent's mark
    // (only as far as needed: one already in view doesn't move the note).
    const bringIn = (rows: [number, number]) => {
      const a = rows[0] - top, b = rows[1] - top;
      if (room <= 0 || b <= 0) return;
      if (a < this.scroll) this.scroll = Math.max(0, a);
      else if (b > this.scroll + room) this.scroll = Math.max(0, Math.min(a, b - room));
    };
    const current = this.elems.find(e => e.key === this.cur);
    // An open choice under it (a step's status, a callout's type) comes in with it, as far as the element allows.
    this.lastReveal = this.reveal && !!current;
    if (this.reveal && current) bringIn([current.row, picks && this.picker?.key === current.key ? Math.max(current.row + 1, top + picks.at + picks.lines) : current.row + 1]);
    this.reveal = false;
    const markRows = this.focusMark ? this.focusRows(this.focusMark.spec, m, doc, noteLines, top) : null;
    // A followed fragment comes to the top (a line of what's above it kept); an agent's mark only as far as needed.
    if (this.revealMark && markRows) { if (this.focusMark?.fragment) this.scroll = Math.max(0, markRows[0] - top - 1); else bringIn(markRows); }
    this.revealMark = false;
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    room = roomAt(this.scroll);
    // What scrolling into the header image moved in is brought in once more, at the room it has now.
    if (full && current && this.lastReveal) bringIn([current.row, current.row + 1]);
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    room = roomAt(this.scroll);
    const heroRows = full ? Math.max(0, full - this.scroll) : 0;
    h -= heroRows;
    this.drawn = { w, top: head.length, scroll: this.scroll, room, doc, lines: noteLines, head, body, heroRows };
    this.selectionControl(w);
    // The body's images, one column in (its margin), cut to the rows shown.
    const placements = imagePlacements(doc.images, 1, ...cellOf(host)).flatMap(p => inWindow(p, this.scroll, room, head.length) ?? []);
    // Where the links landed on screen: below the header, one column in (the body's margin), scrolled.
    // Each is the element it is, so a click also puts `[ ]` there.
    const keyOf = new Map(this.elems.filter(e => e.link).map(e => [`${e.row}:${e.from}`, e.key]));
    if (summary) for (const l of summaryLinks) this.hits.push({ row: summaryRow, from: l.from, to: Math.min(w, l.to), link: l.link, value: l.key, elem: keyOf.get(`${summaryRow}:${l.from}`) });
    const firstOf = new Map<number, string>();
    for (const r of doc.links) if (!firstOf.has(r.n)) firstOf.set(r.n, keyOf.get(`${top + r.line}:${r.from + 1}`) ?? "");
    for (const r of doc.links) {
      const row = r.line - this.scroll;
      const link = drawn[r.n];
      if (link && row >= 0 && row < room && r.from + 1 < w) this.hits.push({ row: top + row, from: r.from + 1, to: Math.min(w, r.to + 1), link, elem: firstOf.get(r.n) || undefined });
    }
    // An image's caption opens it (its controls, tagged above, come first); a click on the image makes it the `[ ]` position.
    for (const e of this.elems) {
      if (!e.link?.media) continue;
      const row = e.row - top - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: e.row - this.scroll, from: e.from, to: Math.min(w, e.to), link: e.link, elem: e.key });
      const x = doc.media.find(x => top + x.row === e.row), im = x?.image !== undefined ? doc.images[x.image] : undefined;
      if (im) for (let r = im.line; r < im.line + im.rows; r++) {
        const at = r - this.scroll;
        if (at >= 0 && at < room) this.hits.push({ row: top + at, from: 1 + im.col, to: Math.min(w, 1 + im.col + im.cols), image: e.key });
      }
    }
    for (const k of marks) {
      const row = k.row - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: top + row, from: 0, to: 1, thread: k.thread, elem: `comment:${k.thread}` });
    }
    for (const c of controls) {
      const row = c.row - this.scroll;
      if (row >= 0 && row < room && c.from + 1 < w) this.hits.push({ row: top + row, from: c.from + 1, to: Math.min(w, c.to + 1), thread: c.thread, elem: controlKey(c.thread, c.control) });
    }
    for (const [i, r] of (picks?.rows ?? []).entries()) {
      const row = r - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: top + row, from: 1, to: w, pick: i });
    }
    // The reading ruler: the current element's block, and a focus mark's, in one calm tint. An expanded
    // thread's passage is highlighted while it's open (the ruler, where both are, wins).
    const rulers = [current?.ruler, markRows].filter((r): r is [number, number] => !!r);
    const ruled = (row: number) => rulers.some(([a, b]) => row >= a && row < b);
    const quoted = marks.filter(k => this.expanded.has(k.thread)).map(k => [top + k.rows[0], top + k.rows[1]] as const);
    const inQuote = (row: number) => quoted.some(([a, b]) => row >= a && row < b);
    const lines = [...head, ...body.slice(this.scroll, this.scroll + room)].slice(0, Math.max(1, h)).map((l, i) => {
      const row = i < top ? i : i + this.scroll;
      const tint = ruled(row) ? RULER_BG : inQuote(row) ? THREAD_BG : null;
      return this.paintSelection(tint ? paintRange(pad(l, w), 0, w, tint) : l, row);
    });
    // The header's backdrop (PIE-598): the hero image, muted, under the title, summary, byline and crumbs once it
    // goes under them.
    const headerRows = Math.min(lines.length, own ? own.length + summaryRows.length : 3 + summaryRows.length);
    const shade = this.heroBackdrop(m, doc, noteLines, w, headerRows, host);
    if (shade.grid) for (let r = 0; r < headerRows; r++) lines[r] = overColours(lines[r]!, w, shade.grid[r] ?? []);
    placements.unshift(...shade.placements);
    if (foot) {
      while (lines.length < h) lines.push("");
      lines.push(foot.line);
      for (const x of foot.hits) this.hits.push({ row: h, from: x.from, to: x.to, history: x.dir });
    }
    return room > 0 ? { lines, placements, scroll: { top: this.scroll, room, total: body.length } } : { lines, placements };
  }

  /**
   * The note laid out at this width: its rows, links, elements and comment marks, everything but where it's
   * scrolled to. A frame in which only scrolling happened (onlyScrolled: the wheel and nothing else since the
   * last paint) reuses the last layout when the note and the pane's size are the same, so scrolling a long
   * note costs a slice, not a layout. Every other frame lays it out again.
   */
  private layOut(m: Msg, w: number, h: number, head: string[], summaryRow: number, summaryLinks: { from: number; to: number; link: Link; key: string }[], host: SurfaceHost | undefined, src: Source | null): Laid {
    const top = head.length, t = host?.ctx.t;
    // The outline's callout types too: a type declared (or its answer arriving) draws the note again.
    const key = `${w}x${h}|${top}|${summaryRow}|${m.revision ?? ""}|${m.text.length}|${host?.ctx.graphics ? 1 : 0}|${t?.cellW}x${t?.cellH}|${calloutsStamp(calloutsOf(src))}|${this.hero?.line ?? ""}`;
    if (onlyScrolled() && this.laid?.m === m && this.laid.key === key) return this.laid;
    // The header image is drawn above the title (render), so its line here is only its caption.
    const env = { ...this.docEnv(Math.max(1, w - 1), host, Math.max(4, Math.round((h - head.length) * 0.8))), hero: !!this.hero };
    // Every link drawn (the body's, an embed's title, results, text and step boxes) is tagged with its place in `drawn`.
    const drawn: Link[] = [];
    // Resource projections (PIE-445): each drawn after the last body line at or above its anchor (a ticket
    // page's, on the subject or its preamble, above the first), its age painted now.
    // A Resource or a file shown as a note isn't a block: nothing the outline keeps for blocks is asked for it.
    const outline = isOutlineNote(m), now = Date.now();
    // Resource tokens (`[file::…]`, `[jira::KEY]`) as the service names them: links that show the Resource.
    const tokens = resourceTokensOf(m, src);
    // An extension's output (PIE-512) is drawn as this reader draws a note's body: its Markdown, inert (no
    // links to follow, no properties), each row then shaded into the line's region.
    const extDraw = {
      note: m.id,
      markdown: (text: string, width: number) => renderDoc(presentLinks(printableBlock(text), false, null), {
        ...env, width, graphics: false, noImages: undefined, folds: undefined, after: undefined, embed: undefined, task: undefined, link: undefined, literal: undefined, keepTags: false,
      }).lines,
      row: (block: string, text: string) => tagged(drawn, { block, role: "row" }, text),
      hostKeys: host?.ownKeys ?? "",
    };
    const { doc: rendered, points, lines: noteLines } = this.body(m, env, src, drawn, tokens, (source, noteLines) => {
      const regions = this.projectionRegions(outline ? projectionsOf(m, src) : [], noteLines), bodyText = source.split("\n");
      // A view note's results under its body, drawn as an embedded view (the service's answer).
      const last = bodyText.length - 1, results = outline ? (width: number) => viewResults(m, width, src, drawn) : null;
      const view = !!results && (m.props.type ?? "").toLowerCase() === "virtual-branch";
      return regions.size || view ? {
        after: (line: number, width: number) => {
          const ps = regions.get(line);
          const tail = view && line === last ? ["", ...(results!(width) ?? [])] : [];
          if (!ps) return tail.length > 1 ? tail : [];
          const indent = line >= 0 ? /^[ \t]*/.exec(bodyText[line] ?? "")![0].length : 0;
          const tag = (to: LinkTarget, text: string) => tagged(drawn, to, text);
          // A ticket kept as a block (PIE-445), and an extension's record (PIE-507), is drawn from that block:
          // on a page, all of it under its line; on the ticket block itself, its header on top and its
          // comments after the body. An extension's other lines (an output, a component, an @name request)
          // draw their result with their actions (PIE-512).
          return [...ps.flatMap(({ p, part }) => p.record
            ? ticketRegion(p, ticketBlocksOf(p, src), part, width, indent, now, tag)
            : p.kind ? extensionRegion(p, width, indent, now, tag, extDraw)
            : projectionRegion([p], width, indent, now, tag)), ...(tail.length > 1 ? tail : [])];
        },
      } : {};
    });
    // Expanded comment threads (PIE-420) are drawn under their passage, as rows of the body; an open status
    // choice (PIE-472) under its step.
    const threads = this.threadPanels(m, rendered, noteLines, Math.max(1, w - 1));
    const { doc, picks } = this.pickerRows(threads.doc, drawn, Math.max(1, w - 1));
    const controls = threads.controls.map(c => ({ ...c, row: c.row + (picks && c.row >= picks.at ? picks.lines : 0) }));
    // Media become followable links too: [ ] selects, ⏎ opens with the system viewer. Media in a folded
    // section aren't drawn, so they aren't links until it's unfolded.
    const mediaLinks = doc.media.map(x => ({ media: x.path }));
    if (this.links.filter(l => l.media).map(l => l.media).join("\n") !== mediaLinks.map(l => l.media).join("\n")) {
      const sel = this.links[this.link];
      this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
      this.link = sel ? this.links.findIndex(l => (sel.media ? l.media === sel.media : l === sel)) : -1;
    }
    // The document keeps a minimum width of its own (callouts, tables); a narrower column clips it.
    const body = doc.lines.map(l => (width(l) + 1 > w ? pad(" " + l, w) : " " + l));
    // Comment marks sit in the body's margin, on the first row of the lines each quote spans. Threads on one
    // row share its one margin cell (PIE-541: drawing each in turn cut the escape of the one before), yellow
    // while any of them is open; each stays its own element.
    const marks = this.commentMarks(m, doc, noteLines);
    const margin = new Map<number, boolean>();
    for (const k of marks) margin.set(k.row, (margin.get(k.row) ?? false) || k.open);
    for (const [row, open] of margin) body[row] = fg(open ? C.yellow : C.dark) + "▐" + RESET + body[row]!.slice(1);
    const elems = this.elementsOf(doc, drawn, marks, controls, summaryLinks, points, top, head, summaryRow, this.imageRefOf(m, noteLines));
    return (this.laid = { m, key, doc, drawn, picks, controls, body, marks, lines: noteLines, elems });
  }

  /**
   * What the note's body is drawn with, at `width`: images laid out when the host draws Kitty graphics (and why not
   * when it doesn't).
   */
  private docEnv(width: number, host: SurfaceHost | undefined, maxImageRows: number): DocEnv {
    const t = host?.ctx.t, graphics = !!host?.ctx.graphics;
    const noImages = graphics ? undefined : t?.kitty ? "video: cells · alt+v draws images" : "no Kitty graphics in this terminal";
    return { width, cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics, noImages, maxImageRows, unfold: this.unfold, callouts: calloutsOf(this.src), printed: this.printed };
  }

  /** The note's body for the reader and a host's digest (folds, links, embeds, steps, tagged into `drawn`); `more`: the reader's own. */
  private body(m: Msg, env: DocEnv, src: Source | null, drawn: Link[], tokens?: ReturnType<typeof resourceTokensOf>, more?: (text: string, lines: readonly number[]) => Partial<DocEnv>) {
    const { text, points, lines, literal } = this.foldsIn(m);
    this.keepFolds(points);
    // The live figures this layout draws, each told here; a tab or the density drawn as a control.
    const figures: FigureInfo[] = [];
    this.figuresDrawn = figures;
    const doc = renderDoc(presentLinks(text, true, src, m.text, drawn, tokens), {
      ...env, literal, ...this.bodyHooks(m, lines, env, src, drawn),
      callout: this.calloutHook(m, lines, points, drawn),
      image: this.imageHook(m, lines, drawn),
      folds: { points, folded: this.folded, selected: this.foldSel },
      link: (block, x, figure) => tagged(drawn, { block, role: "row", ...(figure ? { figure: { figure } } : {}) }, x),
      figures: this.printed ? { all: true, seen: f => figures.push(f) } : {
        ui: key => this.figureUI.get(key),
        tag: (c, x) => tagged(drawn, { role: "figure", figure: c, label: c.tab ?? `≡ density ${this.figureUI.get(c.figure)?.density ?? ""}`.trim() }, x),
        seen: f => figures.push(f),
      },
      tag: (to, x) => tagged(drawn, to, x), note: m.id,
      ...more?.(text, lines),
    });
    return { doc, points, lines };
  }

  /**
   * The controls on each image's caption (PIE-532): − + its size, ◂ ▸ where it sits, ▀ the header. Each names the
   * image by its note line and how that line reads now, so a change is checked against what was drawn.
   */
  private imageHook(m: Msg, noteLines: readonly number[], drawn: Link[]): DocEnv["image"] {
    // Printed (`ep0ch show`), nothing can be clicked: the caption says what the image is, without controls.
    const ref = this.printed ? null : this.imageRefOf(m, noteLines);
    if (!ref) return undefined;
    return (i, control, x) => {
      const r = ref(i);
      return r ? tagged(drawn, { role: "image", label: imageControlLabel(control), image: { ...r, control } }, x) : x;
    };
  }

  /** The image on body line `i` (of the text drawn, whose note lines are `noteLines`) as an ImageRef, or null; null for a note that isn't the outline's. */
  private imageRefOf(m: Msg, noteLines: readonly number[]): ((i: number) => ImageRef | null) | null {
    if (!isOutlineNote(m) || m.partial) return null;
    const text = m.text.split("\n");
    return i => {
      const line = noteLines[i], source = line === undefined ? undefined : text[line];
      const spec = source === undefined ? null : parseMediaLine(source);
      return spec ? { block: m.id, line: line!, source: source!, path: spec.path } : null;
    };
  }

  /**
   * Each callout's icon and type as one control (PIE-538): ⏎ or a click opens its type choice. It names the callout by
   * its header's note line and how that line reads now, so a type change is checked against what was drawn.
   */
  private calloutHook(m: Msg, noteLines: readonly number[], points: readonly FoldPoint[], drawn: Link[]): DocEnv["callout"] {
    if (!isOutlineNote(m) || m.partial) return undefined;
    const text = m.text.split("\n");
    return (i, b) => {
      const line = noteLines[i];
      if (line === undefined) return null;
      const ref: CalloutRef = { block: m.id, line, header: text[line] ?? "", type: b.type, fold: b.fold, foldKey: points.find(p => p.line === i && p.kind === "callout")?.key ?? null };
      const n = drawn.push({ role: "callout", block: m.id, callout: ref }) - 1;
      // Tagged only: the top edge is drawn in the callout's tone, not as a link.
      return (x: string) => linkTag(n) + x + LINK_END;
    };
  }

  /**
   * The body's transclusions and steps, the same for the reader's own render and a host's digest: each
   * `!((…))` drawn by src/embeds.ts from the service's projection, its body drawn the way this reader draws
   * a note (its own embeds nested, its links and step boxes elements like the note's; its literal regions
   * judged by its own text, PIE-422); each of the note's own steps a control where the service reads one
   * at this revision (PIE-472).
   */
  private bodyHooks(m: Msg, noteLines: readonly number[], env: DocEnv, src: Source | null, drawn: Link[]): Pick<DocEnv, "embed" | "task"> {
    const inner: EmbedBody = (target, part, width, hooks) => {
      let text: string, lines: number[], lit: Set<number>;
      if (part) {
        text = part.text;
        lines = text.split("\n").map((_, i) => part.startLine + i);
        const inside = target.text.includes("<!--") ? literalLines(target.text).inside : new Set<number>();
        lit = new Set(lines.flatMap((l, i) => (inside.has(l) ? [i] : [])));
      } else ({ text, lines, literal: lit } = readableSource(target, src));
      return renderDoc(presentLinks(text, true, src, target.text, drawn), {
        ...env, width, graphics: false, noImages: undefined, literal: lit, keepTags: true, folds: undefined, after: undefined,
        // A fragment's figure isn't its note's figure block: the note's child bullets are the whole note's rows.
        nested: !!part,
        link: (block, t) => tagged(drawn, { block, role: "row" }, t),
        tag: (to, t) => tagged(drawn, to, t), note: target.id,
        embed: hooks.embed, task: (i, box) => hooks.task(lines[i] ?? -1, box),
      }).lines;
    };
    // A Resource or a file shown as a note has no steps, and its `!((…))` isn't the outline's to transclude.
    const outline = isOutlineNote(m);
    const steps = outline ? stepsOf(m, src) : null;
    const stepAt = new Map((steps?.items ?? []).map(st => [st.span.startLine, st]));
    return {
      ...(outline ? { embed: (id: string, fragment: string | undefined, n: number, width: number) => embedRegion(id, fragment, n, width, src, inner, drawn, m.id) } : {}),
      task: (i, box) => {
        const line = noteLines[i] ?? -1, st = stepAt.get(line);
        // A read of an earlier revision (the note is being read again) offers a step only where it still stands.
        if (st && steps && steps.revision !== m.revision && !stepStillOn(st, m.text, line)) return null;
        return st && steps ? LINK_ON + tagged(drawn, { role: "task", block: m.id, task: { block: m.id, revision: steps.revision, step: st } }, box) + LINK_OFF : null;
      },
    };
  }

  /**
   * The note's body for a host that draws its own column around it (the river's): the same renderer as
   * `render` (Markdown, links, transclusions nested, step controls and an open status choice), `w` wide,
   * without the reader's header or scroll. Its links, embeds, steps and fold points are this surface's elements:
   * `[ ]` walks them, ⏎ and space act on the current one, a click on one goes through `open`; its folds are this
   * surface's (`( )`, `f`, `F`, `fold n=`), drawn ▾/▸ as a reader draws them. `current`: the row of the current
   * element (a fold `( )` selected is one), for the host to keep in view; `links`: where each link, step box
   * and status-choice row landed, by row, in the returned lines' cells; `folds`: each fold point's heading row,
   * its width in cells and its number (`fold.toggle n=`), for a click on it; `placements`: its images, laid out as the
   * reader lays them out whenever the host draws Kitty graphics (at most `maxImageRows` tall), by row and column of
   * the returned lines, for the host to cut to what it shows (`inWindow`) and hand to the desk as a reader tile does.
   */
  digest(m: Msg, w: number, host: SurfaceHost, maxImageRows = 8): { lines: string[]; links: { row: number; from: number; to: number; link: Link }[]; folds: { row: number; cols: number; n: number }[]; placements: Placement[]; current: number | null; key: string | null } {
    const src = this.use(host);
    this.drawn = null;
    this.digesting = true;
    const drawn: Link[] = [];
    // A digest draws no header image above the note: it's drawn where it's written.
    this.hero = null;
    const { doc: rendered, points, lines: noteLines } = this.body(m, this.docEnv(Math.max(1, w), host, maxImageRows), src, drawn);
    const { doc, picks } = this.pickerRows(rendered, drawn, Math.max(1, w));
    this.elems = this.elementsOf(doc, drawn, [], [], [], points, 0, [], 0, this.imageRefOf(m, noteLines));
    this.keepCurrent(host);
    const current = this.elems.find(e => e.key === this.cur);
    const lines = doc.lines.map((l, r) => (current && r >= current.ruler[0] && r < current.ruler[1] ? paintRange(pad(l, w), 0, w, RULER_BG) : l));
    const links = doc.links.flatMap(r => (drawn[r.n] ? [{ row: r.line, from: r.from, to: r.to, link: drawn[r.n]! }] : []));
    for (const [i, row] of (picks?.rows ?? []).entries()) links.push({ row, from: 0, to: w, link: { role: this.picker?.kind === "callout" ? "callout" : "task", choice: i } });
    const folds = doc.heads.flatMap(h => { const n = points.findIndex(p => p.key === h.key); return n < 0 ? [] : [{ row: h.row, cols: h.cols, n: n + 1 }]; });
    return { lines, links, folds, placements: imagePlacements(doc.images, 0, ...cellOf(host)), current: current ? current.row : null, key: current?.key ?? null };
  }

  /** A fold whose heading or item is gone (or reworded) is dropped, so it never hides a different section. */
  private keepFolds(points: readonly FoldPoint[]) {
    const keys = new Set(points.map(p => p.key));
    // A callout that starts folded (`[!type]-`) is folded when the reader first meets it (unless z shows callouts).
    for (const p of points) if (!this.foldSeen.has(p.key)) { this.foldSeen.add(p.key); if (p.start === "folded" && !this.unfold) this.folded.add(p.key); }
    for (const k of this.folded) if (!keys.has(k)) this.folded.delete(k);
    if (this.foldSel && !keys.has(this.foldSel)) this.foldSel = null;
  }

  /** What a host's header is told (SurfaceHost.header). */
  private headerInfo(m: Msg, properties: number): HeaderInfo {
    const c = this.comments && this.commentsFor === m.id ? this.comments : null;
    return { crumbs: this.crumbs, comments: c ? { open: c.filter(x => x.open).length, total: c.length } : null, properties };
  }

  // ── properties ─────────────────────────────────────────────────────────────

  /** The summary line for `m`: its keys (the view's, yours, the environment's or the default) and text. */
  summary(m: Msg): { keys: string[]; source: string; text: string } {
    const { keys, source } = summaryKeys(this.viewKeys);
    return { keys, source, text: summarySegments(m.properties ?? [], keys).map(s => s.plain).join(" · ") };
  }

  /**
   * The summary line as drawn: its text, the line with linked values coloured as links, and where each
   * linked value sits (columns from the line's start).
   */
  private summaryView(m: Msg, src: Source | null) {
    const segs = summarySegments(m.properties ?? [], this.summary(m).keys);
    const prefix = workIdPrefix(src) ?? null;
    const links: { from: number; to: number; link: Link; key: string }[] = [];
    let col = 0, line = "";
    segs.forEach((s, i) => {
      if (i) { line += " · "; col += 3; }
      line += s.label + " "; col += [...s.label].length + 1;
      s.value.split(", ").forEach((v, j) => {
        if (j) { line += ", "; col += 2; }
        const t = valueTarget(s.key, v, prefix), n = [...v].length;
        if (t) { links.push({ from: col, to: col + n, link: t, key: s.key }); line += fg(C.lcyan) + v + fg(C.lgreen); }
        else line += v;
        col += n;
      });
    });
    return { text: segs.map(s => s.plain).join(" · "), line, links };
  }

  /** The panel's rows for `m`: the service's tokens once it has answered, the block properties until then. */
  rows(m: Msg, tokens: PropertyRecord[] | null = null): PropRow[] {
    const t = tokens ? { state: "ready", tokens } : tokensOf(m.text, this.src);
    return propertyRows(m, t?.state === "ready" ? t.tokens : null, workIdPrefix(this.src) ?? null);
  }

  /** Open (or switch to full) the property panel. */
  openPanel(full = false) {
    if (!this.panel) this.panel = new PropertyPanel();
    this.panel.full = full;
  }

  closePanel(): boolean {
    if (this.panel?.field && this.panel.field.input.text !== this.panel.field.row.value && !this.panel.field.saving) return false;
    this.panel = null;
    return true;
  }

  /** The value of row `n` (from 1), after checking it exists. */
  row(m: Msg, n: number, rows = this.rows(m)): PropRow {
    const r = rows[n - 1];
    if (!r) throw new ActionRefused(`there is no property ${n}; the note has ${rows.length} (props lists them)`);
    return r;
  }

  /**
   * `y`: the value to the terminal's clipboard (OSC 52), as authored. Only for the person at the keys:
   * the clipboard is theirs, so an agent gets the value in its reply instead.
   */
  copyValue(r: PropRow, host: SurfaceHost) {
    if (host.ctx.copy?.(r.value) === false) return;
    if (this.panel) this.panel.note = `copied ${r.key}: ${printable(r.value).slice(0, 60)}`;
  }

  /** `o`: open what a block, page or Work-ID value names. Pages resolve read-only (never creating a stub). */
  async followValue(r: Pick<PropRow, "key" | "target">, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | null> {
    const t = r.target;
    let target: Msg | null = null, why = "";
    if (!t) why = `${r.key} holds plain text; there is nothing to follow`;
    else if ("block" in t) { target = await host.ctx.board.get(t.block); if (!target) why = `nothing answers at ((${shortId(t.block)}))`; }
    else {
      const p = await host.ctx.board.resolvePage(t.page).catch((e: Error) => ({ status: "failed", error: e.message } as const));
      if ("block" in p && p.block) target = p.block.partial ? await host.ctx.board.get(p.block.id) ?? p.block : p.block;
      else why = "error" in p ? `couldn't resolve ${t.page}: ${p.error}` : `no page is named ${t.page} yet`;
    }
    if (!target) { if (this.panel) this.panel.note = why; host.ctx.flash(why); host.redraw(); return null; }
    // The panel has done its job; the target opens to be read (in place or in another reader).
    this.panel = null;
    this.track(() => host.navigate(target, how));
    return target;
  }

  /** `⏎`/`e` on a value: a one-line field over it, at the revision the panel read. */
  editValue(r: PropRow): void {
    const m = this.msg!;
    if (!this.panel || m.revision === undefined) throw new ActionRefused("the note's revision is unknown, so a value edit couldn't be checked; open it again");
    this.panel.field = { row: r, input: new LineInput(r.value), revision: m.revision, saving: false, note: "", changedElsewhere: false };
  }

  /**
   * One `properties.patch` of `row`'s token in `m`, at `revision`: the revision `row`'s ordinal was read
   * from, so the service refuses it if the note has moved on. Returns the saved note (also shown here).
   */
  async patchValue(m: Msg, revision: number, row: PropRow, value: string, host: SurfaceHost, actor: Actor): Promise<Msg> {
    // Never underneath a draft someone has open on that note (the draft session's agent rule).
    const no = agentRefusal(actor, { board: host.ctx.board, blockId: m.id });
    if (no) throw new ActionRefused(no);
    let ordinal = row.ordinal;
    if (ordinal === null) {
      // No properties.preview on this service: ask it for this key's tokens, at the same revision.
      const t = await host.ctx.board.propertyTokens(m.id, row.key);
      if (t.revision !== revision) throw new EditConflict(m.id, "changed since the panel read it");
      const nth = this.rows(m).filter(r => r.key === row.key && r.n <= row.n).length - 1;
      ordinal = t.tokens.filter(x => x.scope === "block")[nth]?.ordinal ?? null;
      if (ordinal === null) throw new Error(`the service doesn't list ${row.key} on the note any more`);
    }
    const saved = await host.ctx.board.patchProperties(m.id, revision, [{ op: "replace", ordinal, value }], actor);
    if (this.msg?.id === m.id) { this.refresh({ ...saved, childIds: this.msg.childIds }); this.links = linksOf(this.msg!); }
    return saved;
  }

  /**
   * Save the value being typed: one `properties.patch` of that token, refused by the service if the note
   * changed since the panel read it (nothing is retried over someone else's change). Returns the new
   * revision, or null with the reason in the field's note.
   */
  async saveValue(host: SurfaceHost, actor: Actor = host.actor ?? USER): Promise<number | null> {
    const f = this.panel?.field, m = this.msg;
    if (!f || !m || f.saving) return null;
    const why = checkValue(f.row, f.input.text);
    if (why) { f.note = why; host.redraw(); return null; }
    const value = f.input.text.trim();
    if (value === f.row.value) { this.panel!.field = null; this.panel!.note = "unchanged"; host.redraw(); return m.revision ?? null; }
    f.saving = true; f.note = "saving…"; host.redraw();
    try {
      const saved = await this.patchValue(m, f.revision, f.row, value, host, actor);
      if (this.panel?.field === f) this.panel.field = null;
      const said = `saved · revision ${saved.revision} · ${f.row.key}: ${printable(f.row.value).slice(0, 30)} → ${printable(value).slice(0, 30)}`;
      if (this.panel) this.panel.note = said;
      host.ctx.flash(said);
      return saved.revision ?? null;
    } catch (e) {
      f.saving = false;
      if (e instanceof EditConflict) { f.changedElsewhere = true; f.note = "changed elsewhere since the panel read it · not saved · esc, then enter edits the current value"; }
      else f.note = `not saved: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    } finally { host.redraw(); }
  }

  /** `s`: show or hide this key in the summary line, as your own choice (kept on this machine). */
  toggleSummary(key: string, host: SurfaceHost): { keys: string[]; source: string } {
    const cur = summaryKeys(null).keys;
    const k = key.toLowerCase();
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    setUserSummaryKeys(next);
    const said = `summary shows ${next.join(", ") || "nothing"}${this.viewKeys ? " · this view's [summary-properties::] still decides here" : ""}`;
    if (this.panel) this.panel.note = said;
    host.ctx.flash(said);
    return { keys: next, source: "yours" };
  }

  private panelKey(k: Key, host: SurfaceHost): boolean {
    const P = this.panel!, m = this.msg;
    // Scrolling always works (PIE-411): PgDn, PgUp and Space (unless it's being typed) page the note,
    // or the property list when it fills the reader and the note isn't drawn.
    const page = k.kind === "pgdn" || (ch(k) === " " && !P.field) ? 1 : k.kind === "pgup" ? -1 : 0;
    if (page) {
      if (P.full && m && !m.partial) { const n = this.rows(m).length; if (n) P.sel = Math.max(0, Math.min(n - 1, P.sel + page * 15)); P.note = ""; }
      else this.scroll = scrolled(this.scroll, page * 15, this.maxScroll);
      host.redraw();
      return true;
    }
    if (!m || m.partial) { if (k.kind === "esc" || ch(k) === "i") void this.runKey("props.close", {}, host); host.redraw(); return true; }
    const rows = this.rows(m);
    const intent = P.key(k, rows.length);
    const r = rows[P.sel];
    // The panel's commands are the props.* actions (PIE-506); moving its selection and typing a value are its own.
    if (intent === "close") void this.runKey("props.close", {}, host);
    else if (intent === "full") P.full = !P.full;
    else if (intent === "cancel") { P.field = null; P.note = ""; }
    else if (intent === "save") void this.saveValue(host);
    else if (r && intent === "copy") void this.runKey("props.copy", { n: r.n }, host);
    else if (r && intent === "follow") void this.runKey("props.follow", { n: r.n }, host, true);
    else if (r && intent === "summary") void this.runKey("props.summary", { toggle: r.key }, host);
    else if (r && intent === "edit") { try { this.editValue(r); } catch (e) { P.note = (e as Error).message; } }
    host.redraw();
    return true;
  }

  private renderDraft(d: Draft, m: Msg, w: number, h: number, src: Source | null): string[] {
    const by = writtenBy(d, "save");
    return renderEditor(d, {
      preview: (t, pw) => draftPreview(t, pw, src), pick: true,
      title: `editing · ${subject(m)}`,
      status: [
        fg(C.brown) + pad(`rev ${d.base} · ${draftState(d)}`, w) + RESET,
        // Who typed it takes the hint's row, not a row of its own: an agent's patch landing never moves the text down.
        d.note ? fg(C.cyan) + pad(d.note, w) + RESET
          : by ? fg(C.lmagenta) + pad(by, w) + RESET
          : fg(C.cyan) + pad("whole text: subject, body and [key::value] properties", w) + RESET,
      ],
    }, w, h);
  }

  // ── editing ────────────────────────────────────────────────────────────────

  /**
   * Open a draft on the note as the service has it now, not as this surface last drew it. `still` is the
   * host's say, once the service has answered, that the draft is still wanted (the person may have pressed
   * esc or moved on while it was read); without it the draft opens anyway.
   */
  async edit(host: SurfaceHost, external = false, still?: () => boolean): Promise<string | void> {
    const m = this.msg;
    if (!m || this.editing) return;
    let fresh: Msg | null;
    try { fresh = await host.ctx.board.get(m.id); }
    catch (e) {
      // The first thing said when the tether drops is that it dropped, not something about revisions.
      const why = e instanceof Offline ? "offline · the edit will work when the outline is back" : `can't edit: ${(e as Error).message}`;
      if (!still || still()) host.ctx.flash(why);
      return why;
    }
    if (still && !still()) return;
    if (!fresh || fresh.revision === undefined) { host.ctx.flash("can't edit: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    try { this.startDraft(fresh, host); }
    catch (e) { const why = e instanceof Error ? e.message : String(e); host.ctx.flash(why); return why; }
    host.redraw();
    if (external) this.external(host);
  }

  /**
   * The edit's draft session on `fresh` (the note as the service has it now): the block adapter writes it
   * against `fresh.revision`. The session brings back an edit the person put aside here (esc twice, a closed
   * screen, the door quitting; never for an agent), holds it on the service while it's open (an agent's
   * `draft.patch` lands in it), and refuses an agent a second draft of a note someone has open in one.
   */
  startDraft(fresh: Msg, host: SurfaceHost) {
    const redraw = () => host.redraw();
    const target = blockTarget(fresh, {
      board: host.ctx.board, isNew: this.newNotes.has(fresh.id),
      saved: (m, by, asked, change) => this.saved(m, by, asked, change, host),
      reread: m => { if (this.msg?.id === m.id) this.msg = m; },
      redraw,
    });
    const s: DraftSession = DraftSession.open(target, { text: fresh.text, base: fresh.revision ?? 0, props: fresh.props, by: host.actor ?? USER }, {
      board: host.ctx.board, redraw,
      agentDid: (by, did) => this.noteAgent(by, did, s.draft),
      closed: how => this.draftClosed(s, how, host),
    });
    this.msg = fresh;
    this.modes.push(this.draftMode(s));
    return s;
  }

  private draftKey(k: Key, host: SurfaceHost): boolean {
    const s = this.drafting!;
    // What ends or hands off the draft is an action (PIE-506); the rest is typing.
    s.key(k, {
      completer: this.completer(s.draft, host),
      run: cmd => {
        if (cmd === "save") void this.runKey("edit.save", {}, host, true);
        else if (cmd === "editor") void this.runKey("edit.external", {}, host);
        else if (cmd === "pick") void this.runKey("draft.pick", {}, host);
        else if (cmd === "reload") void this.runKey("edit.reload", {}, host);
        else if (cmd === "copy") void this.runKey("draft.copy", {}, host);
        // Esc closes an unchanged edit; esc, esc on changed text puts it aside as unsent (never dropped), and says where.
        else void this.runKey("edit.close", cmd === "discard" ? { discard: true } : {}, host);
      },
    });
    host.redraw();
    return true;
  }

  /**
   * The draft's reference completion (PIE-416), from this reader's connection. A note draft can point at
   * its own headings (`((#`), as typed so far; a comment or reply has no note of its own.
   */
  completer(d: Draft, host: SurfaceHost) {
    return completerFor(d, host.ctx.board, () => host.redraw(), () => (d === this.draft ? { blockId: d.blockId, text: d.text } : undefined));
  }

  /**
   * The surface is going away with its screen (the reader, the river, a desk that isn't kept). Its draft's
   * hold is let go, so an agent's patch goes to the saved note and never into a draft no one can see or save.
   * Unsaved text was already copied to disk (keepDrafts) by the screen that asked before closing.
   */
  dispose() {
    this.drafting?.dispose();
  }

  /**
   * The edit's session ended: written, closed with nothing changed, or put aside as unsent. What an agent did
   * to it is said no longer as if it were still open: gone once saved or closed, in the past tense once put aside.
   */
  private draftClosed(s: DraftSession, how: Ended, host?: SurfaceHost) {
    if (this.drafting !== s) return;
    this.modes.drop("draft");
    if (this.msg) this.links = linksOf(this.msg);
    if (this.agentDraft === s.draft) {
      this.agent = this.agent && how === "aside" ? { ...this.agent, did: "edited the draft you put aside" } : null;
      this.agentDraft = null;
    }
    // A new note (note.new, PIE-544) closed still empty was never written: it goes to the trash, and the reader back.
    const id = s.target.blockId;
    if (id && this.newNotes.delete(id) && how === "closed" && !s.draft.text.trim() && host) void this.dropEmptyNote(id, s.draft.base, host);
  }

  /**
   * A new note the person is about to write (`note.new`, PIE-544): its edit saves at once (it has no properties to
   * lose), and closing it still empty puts it in the trash. Kept until its edit ends.
   */
  private readonly newNotes = new Set<string>();
  /** Open the edit on `m`, a note `note.new` just made, as the person's e does; true when the edit is open on it. */
  async editNew(m: Msg, host: SurfaceHost, still?: () => boolean): Promise<boolean> {
    if (this.msg?.id !== m.id) return false;
    this.newNotes.add(m.id);
    await this.startAsPerson("edit", host, still).catch(() => {});
    if (this.draft?.blockId === m.id) return true;
    this.newNotes.delete(m.id);
    return false;
  }
  /** The draft open here is a new note's (`note.new`) with nothing typed in it yet (PIE-591): a click away leaves it open. */
  newAndUntouched(): boolean { const s = this.drafting, id = s?.target.blockId; return !!s && !!id && this.newNotes.has(id) && !s.dirty; }
  /** `editNew` by a host that starts the edit its own way (the desk's session start): mark it first, or unmark it. */
  markNew(id: string, on = true) { if (on) this.newNotes.add(id); else this.newNotes.delete(id); }

  /**
   * The empty new note an edit closed on goes to the trash (as the person: they made it), and the reader goes back.
   * Read again first: only a note still empty at the revision the edit began from (nobody wrote it meanwhile).
   */
  private async dropEmptyNote(id: string, base: number, host: SurfaceHost) {
    try {
      const now = await host.ctx.board.get(id);
      // A child someone added leaves its revision as it was, and the trash would take the child too.
      if (!now || now.text.trim() || now.childIds.length || (now.revision !== undefined && now.revision !== base)) return;
      // At that revision and still empty only: a save or a child by another client after this read is refused, and the note stays.
      await host.ctx.board.trash(id, undefined, { revision: base, ifEmpty: true });
    } catch (e) {
      host.ctx.flash(changedSinceRead(e) ? "the new note was written meanwhile, so it stays" : `the empty new note stays: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    host.ctx.flash("nothing written · the empty new note went to the trash");
    if (this.msg?.id === id) await this.runKey("back", {}, host, true).catch(() => {});
    if (this.msg?.id === id) host.gone?.(id);
    host.redraw();
  }

  /** The block adapter saved the edit: show the saved note, and say so (and how it was recorded). */
  private saved(m: Msg, by: Actor, asked: Actor, change: string, host: SurfaceHost) {
    this.msg = { ...m, childIds: this.msg?.id === m.id ? this.msg.childIds : m.childIds };
    this.links = linksOf(this.msg);
    // The service decides which [key::value] tokens are properties (a token followed by more text on
    // its line is plain text), so say plainly when a save changed them: a card can leave its lane.
    this.notice = change ? `properties changed: ${change}` : "";
    const whose = sameParty(by, asked) && !by.with?.length ? "" : ` · recorded as ${recordedAs(by)}`;
    host.ctx.flash(`saved · revision ${m.revision}${change ? ` · properties changed: ${change}` : ""}${whose}`);
  }

  /**
   * Save the edit (ctrl+s, `edit.save`): its session writes it through the block adapter, recorded as whoever
   * wrote the text (recordAs), which is not always `actor`, who pressed save. Returns that, or null when
   * nothing was written (unchanged, a property change shown first, or refused: the draft says why).
   */
  async save(host: SurfaceHost, actor: Actor = host.actor ?? USER): Promise<Actor | null> {
    const s = this.drafting;
    if (!s || s.busy) return null;
    if (!s.dirty) { s.close(); host.ctx.flash("nothing changed"); host.redraw(); return null; }
    const r = await s.submit(actor);
    host.redraw();
    return r.ok ? (r.result as Actor) : null;
  }

  /**
   * Why a click can't leave what the person is in here, or null when it can. Only a changed property value
   * holds on: it has no unsent place to be put aside in (⏎ saves it, esc cancels it).
   */
  leaveRefusal(): string | null { return this.modes.leaveRefusal(); }

  /**
   * The person clicked (or ^W'd) away from the edit or comment they're in, as in any editor: its draft
   * session leaves (DraftSession.leave: an unchanged edit closes, a changed one is saved against its
   * revision or kept as unsent, a comment or reply is kept as unsent, never sent), and the comment session
   * closes with it. What was kept is flashed. An agent may leave only a session it opened.
   */
  async leave(host: SurfaceHost, actor: Actor = host.actor ?? USER): Promise<LeaveResult> {
    const why = this.modes.leaveRefusal();
    if (why) throw new ActionRefused(why);
    // Each open mode leaves, the one with the keys first; what the last of them did is the answer.
    let r: LeaveResult = { left: "nothing" };
    for (const m of [...this.modes.all()]) { const x = await m.leave(host, actor); if (x.left !== "nothing") r = x; }
    return r;
  }

  /** ctrl+r: drop the draft for the note's current text (the block adapter's reload). Typed work is copied to disk first. */
  async reload(host: SurfaceHost): Promise<void> {
    await this.drafting?.reload();
    host.redraw();
  }

  /** $EDITOR (ctrl+x ctrl+e in a draft, ctrl+e from a reader): the draft (or a comment being written) goes there and comes back. */
  external(host: SurfaceHost, d: Draft | null = this.draft) {
    if (!d) return;
    void openInEditor(host.ctx, d, () => this.draft === d || this.session?.composer === d).then(() => host.redraw());
    host.redraw();
  }

  /**
   * Ctrl+T: insert from a picker (src/pick.ts) into the edit or the comment being written: the picker opens in a
   * terminal tile beside the reader (the person's terminal on a screen without tiles), and what they chose comes back
   * at the cursor. Resolves once it's in (or said why not).
   */
  async pick(host: SurfaceHost, channel?: string): Promise<Picked> {
    const d = this.draft ?? (this.session?.mode === "compose" ? this.session.composer : null);
    if (!d) throw new ActionRefused("nothing is being written in this reader; edit, or comment.write, opens a draft");
    if (d.busy) throw new ActionRefused("the save is still landing");
    const r = await pickInto(host.ctx, d, { socket: host.ctx.board.path, name: host.ctx.board.outline }, {
      ...(channel !== undefined ? { channel } : {}),
      held: () => this.draft === d || this.session?.composer === d,
    });
    if ("kept" in r) host.ctx.flash(`${r.why}: ${r.kept} · copied to ${r.at}`, 12000);
    else if ("nothing" in r) d.note = r.nothing;
    host.redraw();
    return r;
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(host: SurfaceHost): Promise<void> {
    const id = this.msg?.id;
    if (!id) return;
    try {
      const c = await host.ctx.board.comments(id);
      if (this.msg?.id !== id) return;
      this.comments = c; this.commentsFor = id;
      // A thread that's gone (deleted, or the note's comments re-read elsewhere) isn't kept expanded.
      for (const t of this.expanded) if (!c.some(x => x.id === t)) this.expanded.delete(t);
      if (this.session?.mode === "threads" && !this.session.busy) this.session.threads = c;
      host.redraw();
    } catch { /* comments are extra; the note still reads */ }
  }

  /** Outline changed: a comment on this note may have been added, answered or resolved anywhere. */
  onEvent(host: SurfaceHost) {
    if (!this.msg) return;
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = setTimeout(() => void this.loadComments(host), 700);
  }

  private commentEnv(host: SurfaceHost, actor: Actor = host.actor ?? USER): CommentEnv {
    return {
      board: host.ctx.board,
      fetch: id => host.ctx.board.get(id),
      setMsg: m => { if (this.msg?.id === m.id) { this.msg = { ...m, childIds: m.childIds.length ? m.childIds : this.msg.childIds }; this.links = linksOf(this.msg); } },
      reloadComments: async () => { await this.loadComments(host); return this.comments ?? []; },
      external: () => void this.runKey("edit.external", {}, host),
      pick: () => void this.runKey("draft.pick", {}, host),
      complete: d => this.completer(d, host),
      flash: m => host.ctx.flash(m),
      redraw: () => host.redraw(),
      actor,
    };
  }

  /**
   * `C`: pick a passage of the note as the service has it now; `m`: the thread list. `still` as for `edit`.
   * `mine`: the person's own keys, so the text they selected is where the passage starts (an agent's
   * comment never takes the person's selection).
   */
  async comment(host: SurfaceHost, mode: "select" | "threads", still?: () => boolean, mine = true): Promise<string | void> {
    const m = this.msg;
    // A Reply control (PIE-420) asked for this: the list opens with the reply started, and goes when it's done.
    const replyOn = mine && mode === "threads" ? this.replyOn : null;
    this.replyOn = null;
    if (!m || this.editing) return;
    // Text selected in the reader is where the passage picker starts: the same text, as a quote.
    const picked = mine && mode === "select" && this.selection ? this.sourceOf(this.selection) : null;
    const fresh = mode === "select" || m.partial ? await host.ctx.board.get(m.id) : m;
    if (still && !still()) return;
    if (!fresh || fresh.revision === undefined) { const why = "can't comment: the outline didn't say which revision this note is at"; host.ctx.flash(why); return why; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    if (this.commentsFor !== m.id) await this.loadComments(host);
    if ((still && !still()) || this.msg?.id !== m.id || this.editing) return;
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    // From a comment mark (⏎, a click, or `m` while on one): the list opens on its thread.
    const on = mine && mode === "threads" && this.cur?.startsWith("comment:") ? this.cur.slice(8) : null;
    const t = on ? this.session.threads.findIndex(x => x.id === on) : -1;
    if (t >= 0) this.session.sel = t;
    const r = replyOn ? this.session.threads.findIndex(x => x.id === replyOn) : -1;
    if (r >= 0) { this.session.replyTo(r); this.session.inline = true; }
    const p = this.session.passage;
    if (p && picked && fresh.text === m.text && picked.to > picked.from) { p.from = picked.from; p.to = picked.to; this.selection = null; }
    host.redraw();
  }

  // ── the reader's modes: what takes its keys besides reading (src/surface/modes.ts) ──

  /** The edit: its draft session's keys, clicks, wheel and rows; leaving saves it or keeps it as unsent. */
  private draftMode(s: DraftSession): DraftMode {
    const d = s.draft;
    return {
      name: "draft", of: d, session: s, holdsKeys: true, noun: "the edit",
      word: "edit",
      changed: revision => { if (!d.saving && revision !== d.base) d.changedElsewhere = true; },
      editing: () => true, covers: () => true,
      key: (k, host) => this.draftKey(k, host),
      click: (x, y, host) => this.writeClick(d, x, y, host),
      press: (x, y, _host, drag) => this.writePress(d, x, y, drag),
      wheel: dir => this.writeWheel(d, dir),
      rows: (w, h, host) => (this.msg ? this.renderDraft(d, this.msg, w, h, this.use(host)) : null),
      leave: async (host, actor) => {
        const r = await s.leave(actor);
        host.redraw();
        if (r.left === "kept") host.ctx.flash(r.said, 10000);
        return r;
      },
      unsaved: () => s.dirty,
      keep: () => (s.dirty ? [s.keep()] : []),
      hint: () => editHint(d, { save: "save", reload: d.conflict || d.changedElsewhere ? "reload" : null }),
      state: () => `editing${d.dirty ? " · unsaved" : ""}`,
      describe: () => ({ ...s.describe(), writtenBy: writtenBy(d, "save") }),
    };
  }

  /** Commenting: picking a passage, writing (its own draft session), the thread list. */
  private commentMode(cs: CommentSession): CommentMode {
    const writing = () => (cs.mode === "compose" ? cs.composer : null);
    return {
      name: "comment", of: cs, session: cs, holdsKeys: true, noun: "the comment", word: "comment",
      editing: () => true, covers: () => true,
      key: (k, host) => this.commentKey(cs, k, host),
      click: (x, y, host) => { const d = writing(); return d ? this.writeClick(d, x, y, host) : false; },
      press: (x, y, _host, drag) => { const d = writing(); return !!d && this.writePress(d, x, y, drag); },
      wheel: dir => { const d = writing(); if (d) return this.writeWheel(d, dir); cs.wheel(dir); return true; },
      rows: (w, h, host) => { const src = this.use(host); return this.msg ? cs.render(w, h, subject(this.msg), (t, pw) => draftPreview(t, pw, src)) : null; },
      leave: async (host, actor) => {
        const w = cs.writing;
        // An agent leaves only a comment it opened and alone typed in (the draft session's rule).
        const no = actor.kind !== "agent" ? null : w ? agentRefusal(actor, w, { op: "leave" }) : "the person is in this comment; an agent doesn't save or close it (block.mark gets their attention)";
        if (no) throw new ActionRefused(no);
        // A send already on its way lands (or is refused) as it would have; the session waits in the reader.
        if (cs.busy) return { left: "sending" };
        // Kept at once (a comment or reply is never sent by a click), then the session closes.
        const leaving: Promise<LeaveResult> = w ? w.leave(actor) : Promise.resolve({ left: "closed" });
        this.closeSession();
        host.redraw();
        const r = await leaving;
        if (r.left === "kept") host.ctx.flash(r.said, 8000);
        return r;
      },
      unsaved: () => cs.dirty,
      keep: () => (cs.writing?.dirty ? [cs.writing.keep()] : []),
      hint: () => cs.hint(),
      state: () => (cs.mode === "compose" ? `writing${cs.dirty ? " · unsent" : ""}` : cs.mode === "select" ? "quoting" : "comments"),
      describe: () => cs.describe(),
      // A reply from an expanded thread landed: back to reading, the thread still open under its passage.
      ended: () => cs.finished,
    };
  }

  /** The property panel (`i`, `I`): its rows take the keys; a value being typed holds the note too. */
  private panelMode(P: PropertyPanel): PanelMode {
    return {
      name: "panel", of: P, panel: P, holdsKeys: true, noun: "the property value",
      word: "property panel",
      changed: (revision, partial) => {
        // A list row's revision says nothing about the value's token: only a whole read marks it.
        const f = P.field;
        if (partial || !f || f.saving || revision === f.revision) return;
        f.changedElsewhere = true;
        f.note = "the note changed elsewhere since this value was read · saving would be refused · esc, then enter edits the current value";
      },
      editing: () => !!P.field, covers: () => P.full,
      key: (k, host) => this.panelKey(k, host),
      click: (x, y, host) => {
        // A value being typed keeps the reader's clicks; a click on a row selects it (on its value, follows it).
        if (P.field) return false;
        const h = this.hitAt(x, y);
        if (!h || !("prop" in h)) return undefined;
        const m = this.msg, r = m ? this.rows(m)[h.prop - 1] : undefined;
        if (!r) return false;
        if (this.selection) void this.runKey("select.clear", {}, host);
        P.sel = h.prop - 1; P.note = "";
        if (h.follow) void this.runKey("props.follow", { n: r.n }, host, true);
        host.redraw();
        return true;
      },
      wheel: dir => {
        const m = this.msg;
        if (!P.full || !m || m.partial || P.field) return false;
        const n = this.rows(m).length;
        if (n) P.sel = scrolled(P.sel, dir, n - 1);
        return true;
      },
      // Drawn by the reading render: above the note, or filling the reader under its header (full).
      rows: () => null,
      leave: async host => { if (P.field) { P.field = null; host.redraw(); } return { left: "nothing" }; },
      leaveRefusal: () => { const f = P.field; return f && f.input.text !== f.row.value ? "finish the property value first · ⏎ saves · esc cancels" : null; },
      unsaved: () => !!P.field && P.field.input.text !== P.field.row.value,
      hint: () => P.hint(),
      state: () => (P.field ? "editing a property" : "properties"),
      describe: () => {
        const m = this.msg;
        return m ? {
          open: P.full ? "full" : "inline", selected: P.sel + 1, note: P.note || null,
          editing: P.field ? { n: P.field.row.n, key: P.field.row.key, text: P.field.input.text, revision: P.field.revision, changedElsewhere: P.field.changedElsewhere, note: P.field.note || null } : null,
          rows: this.rows(m).map(r => describeRow(r, this.src, m.text)),
        } : null;
      },
    };
  }

  /** A step's status choice (PIE-472), open under its box: its keys until a choice or esc; a click elsewhere closes it. */
  private pickerMode(p: Picker): PickerMode {
    return {
      name: "picker", of: p, picker: p, word: p.kind === "callout" ? "type choice" : "status choice",
      // Not a session: it holds no note, and hosts give it the keys first by `choosing`.
      holdsKeys: false, editing: () => false, covers: () => false,
      key: (k, host) => this.pickerKey(k, host),
      click: (x, y, host) => {
        const h = this.hitAt(x, y);
        if (h && "pick" in h) { void this.choose(h.pick, host); return true; }
        this.picker = null; host.redraw();
        return h ? undefined : true;
      },
      rows: () => null,
      leave: async () => ({ left: "nothing" }),
      hint: () => p.kind === "callout" ? "callout type · j k ⏎ choose · - start folded · + start open · esc cancel"
        : `status · ${STEP_CHOICES.map(c => `${c.key} ${c.id === "copy-link" ? "copy link" : c.id === "address" ? "addressable" : statusWord(c.id)}`).join(" · ")} · j k ⏎ choose · esc cancel`,
      state: () => null,
      describe: () => p.kind === "callout"
        ? { callout: this.elems.find(e => e.key === p.key)?.label ?? null, selected: p.list.items[p.list.sel]?.id, choices: p.list.items.map(c => c.id), note: p.note || null }
        : { step: this.elems.find(e => e.key === p.key)?.label ?? null, selected: STEP_CHOICES[p.list.sel]?.id, note: p.note || null },
    };
  }

  /** The comment session's keys: its commands are actions (PIE-506); picking, moving and typing are its own. */
  private commentKey(s: CommentSession, k: Key, host: SurfaceHost): boolean {
    const writing = s.writing;
    // ctrl+s sends, x resolves or reopens, and the esc that ends it closes it.
    if (sessionSend(s, k)) { void this.runKey("comment.send", {}, host, true); return true; }
    // cmd+c in the comment being written copies its selection (the draft's copy, as in an edit).
    if (s.mode === "compose" && s.composer && isCopyKey(k)) { void this.runKey("draft.copy", {}, host); return true; }
    // The comment's ctrl+r is the edit's: find the quote again. Its ctrl+x ctrl+e ($EDITOR) is the draft's chord (edit.external).
    if (sessionKey(s, k, "r")) { void this.runKey("comment.reload", {}, host, true); return true; }
    const t = s.mode === "threads" && !s.busy && ch(k) === "x" ? s.threads[s.sel] : undefined;
    if (t) { void this.runKey("resolve", { thread: t.id, ...(t.open ? {} : { open: true }) }, host, true); return true; }
    if (s.key(k, this.commentEnv(host)) === "close" || s.finished) void this.runKey("comment.close", {}, host);
    // A comment closed by esc, esc is put aside, like an edit: said where, and how it comes back.
    if (k.kind === "esc" && writing && s.writing !== writing && writing.closedWith) host.ctx.flash(writing.closedWith, 8000);
    host.redraw();
    return true;
  }

  /** A click in text being written (an edit's or a comment's): a completion candidate, the preview control, or the cursor placed. */
  private writeClick(d: Draft, x: number, y: number, host: SurfaceHost): boolean {
    if (d.busy) return false;
    if (completerOf(d)?.click(y)) return true;
    if (completionOf(d)) return false;
    this.editPress = editorClick(d, x, y, false, USER, { pick: () => void this.runKey("draft.pick", {}, host) });
    if (this.editPress) host.redraw();
    return this.editPress;
  }
  /** A press puts the cursor there; a drag from it selects (Draft's own selection). */
  private writePress(d: Draft, x: number, y: number, drag: boolean): boolean {
    return !d.busy && (drag || !completionOf(d)) && editorClick(d, x, y, drag);
  }
  /** The wheel over text being written: through an open completion popup's candidates, else the draft's view (its cursor stays). */
  private writeWheel(d: Draft, dir: 1 | -1): boolean {
    const c = completerOf(d);
    if (c?.shown) { c.move(dir); return true; }
    if (!d.busy) void DRAFT_ACTIONS.run("draft.scroll", { by: wheelRows(dir) }, d, USER);
    return true;
  }

  /** A right-click at the surface's cell `x`, `y` is an element's own (a step's box, a callout's type: its choice opens there). */
  ownsRightClick(x: number, y: number): boolean {
    const h = this.hitAt(x, y);
    return !!h && "link" in h && (h.link.role === "task" || h.link.role === "callout");
  }

  /** What the last render put at the surface's cell `x`, `y` (a link, a copy control, a panel row, a choice…). */
  private hitAt(x: number, y: number): Hit | undefined {
    const at = this.hits.filter(h => h.row === y && x >= h.from && x < h.to);
    return at.find(h => "copy" in h || "link" in h || "thread" in h || "history" in h || "pick" in h || "image" in h || ("follow" in h && h.follow)) ?? at[0];
  }

  // ── keys: each one is an action, the same ones an agent calls ─────────────

  key(k: Key, host: SurfaceHost): boolean {
    this.use(host);
    // A step's status choice, the property panel, the edit or the comment: the first open one takes the key.
    const taken = this.modes.key(k, host);
    if (taken !== null) return taken;
    // Back and forward (PIE-453): where the reader was before a follow, scrolled and with its [ ] position.
    const dir = historyKey(k);
    if (dir) { void this.runKey(dir < 0 ? "back" : "forward", {}, host); return true; }
    const c = ch(k);
    // An extension's line that is the current element (PIE-512): a key its actions answer to runs that
    // action (`w` wards); the reader's own keys stay the reader's (READER_OWN_KEYS).
    const xe = c ? this.inView()?.link?.ext : undefined;
    const xa = xe ? handlerKeyAction(xe.extension, xe.handler, c, host.ownKeys) : undefined;
    if (xe && xa) { void this.pressExt(xa.name, xe, host); return true; }
    // Selecting text (PIE-419): v starts the keyboard mode, y Y and cmd+c copy, esc lets go; the rest read on.
    if ((c === "v" || c === "y" || c === "Y" || isCopyKey(k) || this.selection) && this.msg && this.selectKey(k, host)) return true;
    // e ctrl+e C m i I start a session: the note's action for that key (SESSION_ACTIONS), as the desk and the river run it.
    const starts = this.msg ? sessionStart(k) : null;
    if (starts) {
      // e and ctrl+e arm the edit first (edit.arm): ⏎ or the key again opens it.
      if (armsEdit(starts)) { void this.runKey("edit.arm", starts === "external" ? { external: true } : {}, host); return true; }
      // The edit and the comment say their own refusals (a flash, the draft's note); the panel's are said here.
      void this.startAsPerson(starts, host).catch(e => { if (starts === "props" || starts === "props-full") host.ctx.flash(e instanceof Error ? e.message : String(e)); host.redraw(); });
      return true;
    }
    // c collapses where a pane can (the board's readers and lanes, which take it first); comment is C.
    if (c === "c") { host.ctx.flash("nothing collapses here · C comments on a passage"); return true; }
    // A: apply anyway (PIE-501), on the proposal shown, or the one whose embed or control is the current element.
    if (c === "A" && this.msg && (isOpenProposal(this.msg) || this.currentProposal())) { void this.proposalControl("apply", undefined, host); return true; }
    // X: dismiss it (the proposal shown, or the one whose embed or control is the current element).
    if (c === "X" && this.msg && (isOpenProposal(this.msg) || this.currentProposal())) { void this.proposalControl("dismiss", undefined, host); return true; }
    // The current element (`[ ]`, `( )`, a click) is let go by esc and by moving on (scrolling, following,
    // u), so ⏎ has its usual meaning again (in the board's preview: open the note in a detail). Then esc
    // lets go of a focus mark someone set here.
    if (k.kind === "esc" && (this.cur || this.link >= 0)) { void this.runKey("element.select", { n: 0 }, host); return true; }
    if (k.kind === "esc" && this.focusMark) { void this.runKey("block.untint", {}, host); return true; }
    if (isUp(k) || isDown(k)) { void this.runKey("scroll", { by: isUp(k) ? -1 : 1 }, host); return true; }
    // A step that's the current element in view (PIE-472): space toggles it done or to do, as Detail's does;
    // ctrl+z undoes the last step change made here.
    if (c === " ") { const e = this.inView(); if (e?.kind === "task" && e.task) { void this.runKey("task.status", { to: e.task.step.status === "done" ? "todo" : "done" }, host, true); return true; } }
    // ctrl+z undoes the last change made here, a step's status, a callout's header or an image's layout, whichever came last.
    if (k.kind === "char" && k.ctrl && k.ch === "z") {
      const at = this.msg?.id ?? "";
      // Right after esc dropped an edit's stray characters (src/stray.ts): they come back first.
      if (at && hasStrays(`edit:${at}`)) { void this.runKey("edit.strays", {}, host); return true; }
      const last = ([["callout.undo", this.calloutHistory.last("you", at)], ["image.undo", this.imageHistory.last("you", at)], ["task.undo", this.stepHistory.last("you", at)]] as const)
        .reduce<{ name: "callout.undo" | "image.undo" | "task.undo"; seq: number }>((a, [name, e]) => e && (e.seq ?? 0) > a.seq ? { name, seq: e.seq ?? 0 } : a, { name: "task.undo", seq: -1 });
      void this.runKey(last.name, {}, host, true);
      return true;
    }
    if (k.kind === "pgdn" || c === " " || k.kind === "pgup") { void this.runKey("scroll", { by: k.kind === "pgup" ? -15 : 15 }, host); return true; }
    // A live figure's element is current: its tabs, its density (figureKey).
    const fk = this.figureKey(k);
    if (fk) { void this.runKey(fk.name, fk.args as never, host); return true; }
    // An image is current (PIE-532): its size, where it sits, the header (imageKey).
    const ik = this.imageKey(k);
    if (ik) { void this.runKey(ik.name, ik.args as never, host); return true; }
    // [ ] walk every element in reading order (PIE-441); ( ) below stays the folds-only jump.
    if (c === "]" || c === "[") { void this.runKey("element.select", { by: c === "]" ? 1 : -1 }, host); return true; }
    if (c === "z") { void this.runKey("callouts", {}, host); return true; }
    // ⏎ acts on the current element while the person can see it: a link follows (where is the host's call),
    // a fold toggles, a row or an embed opens its note, a comment mark its thread. alt+⏎ opens a link, a
    // row or an embed in a new reader. Otherwise ⏎ isn't the reader's.
    if (k.kind === "enter" || k.kind === "alt-enter") {
      const fresh = k.kind === "alt-enter", e = this.inView();
      if (e) { if (fresh && !opens(e)) return false; void this.runKey("element.open", fresh ? { fresh } : {}, host); return true; }
      if (!this.cur && this.links[this.link]) { void this.runKey("link.follow", fresh ? { fresh } : {}, host); return true; }
      return false;
    }
    if ((c === "(" || c === ")") && this.msg && !this.msg.partial) { void this.runKey("fold.select", { by: c === ")" ? 1 : -1 }, host); return true; }
    if (c === "f" && this.msg && !this.msg.partial) { void this.runKey("fold.toggle", {}, host); return true; }
    if (c === "F" && this.msg && !this.msg.partial) { void this.runKey(this.folded.size === 0 ? "fold" : "unfold", { all: true }, host); return true; }
    if (c === "u" && this.msg?.parentId) { void this.runKey("up", {}, host, true); return true; }
    // b: this note's links (Outlinks, Resources, Backlinks) in the screen's links tile.
    if (c === "b" && this.msg && !this.msg.partial) { void this.runKey("links", {}, host, true); return true; }
    // r: fetch the tickets this note shows now (PIE-445): the one the [ ] position is on, else the note's.
    if (c === "r" && this.msg && isOutlineNote(this.msg)) { void this.runKey("projection.refresh", {}, host, true); return true; }
    return false;
  }

  /**
   * The person's key or click: the note action by name, as `you`, through the same code an agent's runs
   * (PIE-506). A refusal is said in the status bar, unless `quiet` (the action already said it where it
   * happened: the draft's own note, the session's error, a flash of its own).
   */
  runKey<K extends keyof NoteActionArgs & string>(name: K, args: NoteActionArgs[K], host: SurfaceHost, quiet: boolean | ((why: string) => string | null) = false): Promise<unknown> {
    // Through the host's dispatcher (this reader is its tile there), else the reader's own (a host with no screen).
    return host.press ? host.press(name, args as Record<string, unknown>, quiet, host) : this.alone(host).pressIn(NOTE_ACTIONS, name, args as Record<string, unknown>, undefined, quiet);
  }

  /**
   * The reader on its own, behind a dispatcher of its own (PIE-514): for a caller with no screen around it (a test's
   * host, a surface shown by itself). The same actor rule as on any screen: the reader is the person's while its
   * host doesn't say it isn't focused, they type in it while it holds their keys.
   */
  private alone(host: SurfaceHost): Dispatcher {
    const me = "reader";
    return new Dispatcher({
      title: "reader", ctx: () => host.ctx,
      where: () => ({ ...(host.ctx.person?.() ?? NOBODY), focus: host.focused === false ? null : me, typingIn: this.personHolds ? me : null, ...(this.holdsKeys ? { busy: true } : {}) }),
      tiles: () => [{ name: me, kind: "reader", shows: this.msg?.id ?? null, editing: this.editing, holds: a => this.heldBy(a) }],
      draftOf: () => ({ board: host.ctx.board, blockId: this.msg?.id ?? null, session: this.draftSession() }),
    }, [{ set: NOTE_ACTIONS, takes: "tile", noun: "a reader", on: () => ({ surface: this, host }), run: (name, args, _on, actor, typed) => this.run(name, args, host, actor, typed) }]);
  }

  /**
   * An extension line's action as the person (a key, a click, ⏎ on its head or a control): the line's own action
   * (EXT_ACTIONS), or `r` (run it again, ask the agent again) through projection.refresh.
   */
  pressExt(action: string, x: NonNullable<Link["ext"]>, host: SurfaceHost): Promise<unknown> {
    if (action === RUN_AGAIN) return this.runKey("projection.refresh", { block: x.block, line: x.line }, host, true);
    if (!EXT_ACTIONS.has(action)) { host.ctx.flash(`${action} isn't here any more: its extension was removed or reloaded`); return Promise.resolve(null); }
    return Dispatcher.of(EXT_ACTIONS, { ctx: host.ctx as Ctx }, () => host.ctx).press(action, { block: x.block, line: x.line });
  }
  /** The same, inside an action already running for `actor` (element.open on a line's head): run as that actor. */
  runExt(action: string, x: NonNullable<Link["ext"]>, host: SurfaceHost, actor: Actor): Promise<unknown> {
    if (action === RUN_AGAIN) return NOTE_ACTIONS.run("projection.refresh", { block: x.block, line: x.line }, { surface: this, host }, actor);
    if (!EXT_ACTIONS.has(action)) { host.ctx.flash(`${action} isn't here any more: its extension was removed or reloaded`); return Promise.resolve(null); }
    return EXT_ACTIONS.run(action, { block: x.block, line: x.line }, { ctx: host.ctx as Ctx }, actor);
  }

  /** The block `r` refreshes: a ticket region's page (or ticket block) under the [ ] position, else this note. */
  refreshTarget(): { block: string; line?: number } {
    const x = this.inView()?.link?.ext;
    if (x) return { block: x.block, line: x.line };
    const l = this.inView()?.link;
    if (l?.refresh) return { block: l.refresh, ...(l.refreshLine !== undefined ? { line: l.refreshLine } : {}) };
    return { block: l?.role === "resource" && l.block ? l.block : this.msg!.id };
  }

  /**
   * Fetch the tickets `blockId` shows now (`resources.projection.refresh`), as `actor`; the region repaints
   * when the service has written them. Said on the status bar either way.
   */
  async refreshTickets(host: SurfaceHost, blockId: string, actor: Actor = host.actor ?? USER, line?: number): Promise<{ refreshed: string; tickets: string[] }> {
    host.ctx.flash("fetching…");
    try {
      // Who pressed r (or ran projection.refresh) is who asked: an @name line asked again records them.
      const read = await host.ctx.board.refreshProjections(blockId, line, actor);
      resourceChanged(null);
      const keys = read.projections.flatMap(p => p.key ? [p.key] : []);
      const failed = read.projections.filter(p => p.fetchError);
      // A ticket or a record is fetched; an output or a component is run; an @name request is asked.
      const shown = (p: ResourceProjection) => (p.kind === "agent" ? `${p.key} asked` : p.kind && p.kind !== "data" ? `${p.propertyKey}:: ${p.key ?? ""}`.trim() + " ran" : `${p.key} fetched`);
      const fetched = read.projections.filter(p => p.key && !p.fetchError).map(shown);
      const said = [fetched.length ? fetched.join(", ") : "",
        ...failed.map(p => `${p.key}: can't fetch (${p.fetchError!.replace(/^Resource extension: /, "")})`)].filter(Boolean).join(" · ");
      host.ctx.flash(said || "nothing to fetch here");
      if (actor.kind === "agent") this.noteAgent(actor, `refreshed ${keys.join(", ") || "nothing"}`);
      host.redraw();
      return { refreshed: blockId, tickets: keys };
    } catch (e) {
      host.ctx.flash(`not fetched: ${(e as Error).message}`);
      host.redraw();
      throw e;
    }
  }

  /**
   * The wheel, whatever the surface is doing: the note scrolls (under an inline property panel too), a
   * full panel moves its selection, a draft or a comment being written scrolls its view (the cursor stays),
   * and a comment session scrolls its thread list.
   */
  wheel(dir: 1 | -1, host: SurfaceHost) {
    // A mode first (a draft's view, a comment's thread list, the full panel's rows), else the note scrolls.
    if (this.modes.wheel(dir, host)) { host.redraw(); return; }
    void this.runKey("scroll", { by: wheelRows(dir) }, host);
  }

  /** The note scrolled `by` rows within its length (the wheel, j k, PgUp PgDn): the current element is let go, nothing else moves. */
  scrollBy(by: number, letGo = true) { if (letGo) this.letGo(); this.scroll = scrolled(this.scroll, by, this.maxScroll); }


  /**
   * Reading keys only (j k, arrows, PgUp PgDn, space, Home End): scroll the note without starting or
   * touching an edit, a comment or the panel. Hosts use it for a reader holding a session the person
   * isn't in. True when the key was one of them.
   */
  scrollKey(k: Key, host: SurfaceHost): boolean {
    // A draft or a comment session renders in place of the note, and its view follows its own cursor:
    // there is no note to scroll, so the keys aren't claimed (and the agent's cursor isn't moved).
    if (!this.scrolls()) return false;
    const c = ch(k);
    const by = isUp(k) ? -1 : isDown(k) ? 1 : k.kind === "pgdn" || c === " " ? 15 : k.kind === "pgup" ? -15 : 0;
    const to = k.kind === "home" ? "top" : k.kind === "end" ? "end" : undefined;
    if (!by && !to) return false;
    void this.runKey("scroll", to ? { to } : { by }, host);
    return true;
  }

  // ── folds ──────────────────────────────────────────────────────────────────

  /** The note's readable source, the note line each of its lines comes from, and its fold points. */
  foldsIn(m: Msg): { text: string; lines: number[]; points: FoldPoint[]; literal: Set<number>; unterminated: number | null } {
    const r = readableSource(m, this.src);
    const sig = r.text + "\0" + r.anchors.join("\0");
    if (this.foldCache?.text !== sig) this.foldCache = { text: sig, points: foldPoints(r.text, r.anchors), lines: r.lines };
    return { text: r.text, lines: r.lines, points: this.foldCache.points, literal: r.literal, unterminated: r.unterminated };
  }

  /** The fold points drawn now: none inside a folded section or item. */
  visibleFolds(m: Msg): FoldPoint[] {
    const out: FoldPoint[] = [];
    let hideTo = -1;
    for (const p of this.foldsIn(m).points) {
      if (p.line < hideTo) continue;
      out.push(p);
      if (this.folded.has(p.key)) hideTo = p.end;
    }
    return out;
  }

  /**
   * Fold (or unfold) `p`. By the person's keys or click it becomes the selected fold point, kept in view;
   * an agent's fold leaves their selection and scroll where they were.
   */
  setFold(p: FoldPoint, on: boolean, select = true) {
    if (on) this.folded.add(p.key); else this.folded.delete(p.key);
    if (select) { this.foldSel = p.key; this.link = -1; this.reveal = true; }
  }

  /** z: every callout open (`open`), or each back as written (`[!type]-` folded, the rest open). Reading state only. */
  showCallouts(open: boolean) {
    if (!this.msg || this.msg.partial) return;
    for (const p of this.foldsIn(this.msg).points) if (p.kind === "callout") { if (!open && p.start === "folded") this.folded.add(p.key); else this.folded.delete(p.key); }
  }

  /**
   * Fold every outermost heading and list item, or unfold everything. How many changed. By the person's
   * keys (`select`) their selection stays in view, or is let go when a fold hides it; an agent's leaves
   * their selection and scroll where they were.
   */
  foldAll(on: boolean, select = true): number {
    if (!on) { const n = this.folded.size; this.folded.clear(); if (select) this.reveal = !!this.foldSel; return n; }
    const all = this.msg ? this.foldsIn(this.msg).points : [];
    const outer = all.filter(p => !all.some(q => q.line < p.line && p.line < q.end));
    for (const p of outer) this.folded.add(p.key);
    if (select && this.foldSel && !outer.some(p => p.key === this.foldSel)) this.foldSel = null;
    return outer.length;
  }

  /**
   * The fold point `( )` selected, while it's in view (drawn there, or about to be brought there by the
   * next render): what ⏎ folds.
   */
  private selectedFold(): FoldPoint | null {
    const m = this.msg, d = this.drawn;
    if (!this.foldSel || !m || m.partial) return null;
    const p = this.visibleFolds(m).find(p => p.key === this.foldSel);
    // A host's digest (a river column) draws it whole, with no scroll of the surface's own: it's in view.
    if (!p || this.reveal || this.digesting) return p ?? null;
    const row = d?.doc.heads.find(h => h.key === p.key)?.row;
    return d && row !== undefined && row >= d.scroll && row < d.scroll + d.room ? p : null;
  }

  /** `( )`: the previous or next fold point drawn (from the view when none is selected). False when there are none. */
  stepFold(d: 1 | -1): boolean {
    const vis = this.visibleFolds(this.msg!);
    if (!vis.length) return false;
    const rowOf = (p: FoldPoint) => this.drawn?.doc.heads.find(h => h.key === p.key)?.row ?? 0;
    let i = vis.findIndex(p => p.key === this.foldSel);
    if (i >= 0) i = (i + d + vis.length) % vis.length;
    else if (d === 1) { i = vis.findIndex(p => rowOf(p) >= this.scroll); if (i < 0) i = 0; }
    else { const bottom = this.scroll + (this.drawn?.room ?? 0); i = vis.findLastIndex(p => rowOf(p) < bottom); if (i < 0) i = vis.length - 1; }
    this.foldSel = vis[i]!.key; this.link = -1; this.reveal = true;
    return true;
  }

  /**
   * What `f` folds: the selected fold point, or else the section being read (the innermost heading around
   * the top of the view; failing that, the innermost list item there).
   */
  foldTargetAtKeys(): FoldPoint | null {
    const m = this.msg!;
    const vis = this.visibleFolds(m);
    const sel = vis.find(p => p.key === this.foldSel);
    if (sel) return sel;
    const d = this.drawn;
    const top = d ? d.doc.source[d.scroll] ?? 0 : 0;
    const around = vis.filter(p => p.line <= top && top < Math.max(p.end, p.line + 1));
    return around.findLast(p => p.kind === "heading") ?? around.at(-1) ?? null;
  }

  /**
   * A click in the reader, at column `x` and row `y` of what `render` returned, that isn't on a link: on a
   * heading, or on a list item's mark, it folds or unfolds it. False when the click wasn't on one.
   */
  private clickFold(x: number, y: number, host: SurfaceHost): boolean {
    const d = this.drawn, m = this.msg;
    if (!d || !m || this.modes.covers) return false;
    const row = y - d.top;
    // Only the surface's own cells: a host's frame and its scroll thumb (drawn on the border) never fold.
    if (row < 0 || row >= d.room || x < 0 || x >= d.w) return false;
    const h = d.doc.heads.find(x => x.row === d.scroll + row);
    // The body is drawn one column in from the reader's edge.
    if (!h || x > h.cols + 1) return false;
    const n = this.foldsIn(m).points.findIndex(p => p.key === h.key);
    if (n < 0) return false;
    void this.runKey("fold.toggle", { n: n + 1 }, host);
    return true;
  }

  /** The folds for `peek`: how many fold points, which are folded, and the one the keys selected. */
  private describeFolds(m: Msg) {
    const points = this.foldsIn(m).points, sel = points.find(p => p.key === this.foldSel);
    return { points: points.length, folded: points.filter(p => this.folded.has(p.key)).map(foldLabel), selected: sel ? foldLabel(sel) : null };
  }

  /** The note line (from 0, the subject line) reader row `y` of the last render shows, or null off the note's body. */
  /**
   * What the reader has in view (PIE-413's view.get and view.subscribe): the note lines in its body rows, first
   * and last (1 is the subject), and the body's scroll. Null before it's drawn.
   */
  viewport(): { first: number | null; last: number | null; top: number; room: number; total: number } | null {
    const d = this.drawn;
    if (!d) return null;
    // The drawn rows' note lines are 0-based; a line here is 1-based, as block.tint and comments count them.
    const lineOf = (row: number) => { const b = d.doc.source[row]; const l = b === undefined ? undefined : d.lines[b]; return l === undefined ? null : l + 1; };
    const shown = Array.from({ length: Math.max(0, Math.min(d.room, d.body.length - d.scroll)) }, (_, i) => lineOf(d.scroll + i)).filter((x): x is number => x !== null);
    return { first: shown[0] ?? null, last: shown.at(-1) ?? null, top: d.scroll, room: d.room, total: d.body.length };
  }

  /** Scroll so note line `line` (1 is the subject) is the first body row in view (view.scrollTo). False before it's drawn. */
  scrollToLine(line: number): boolean {
    const d = this.drawn;
    if (!d) return false;
    const row = d.doc.source.findIndex(b => b !== undefined && (d.lines[b] ?? 0) + 1 >= line);
    this.scroll = Math.max(0, Math.min(this.maxScroll, row < 0 ? d.body.length : row));
    return true;
  }

  sourceLineAt(y: number): number | null {
    const d = this.drawn;
    if (!d) return null;
    const row = y - d.heroRows - d.top;
    if (row < 0 || row >= d.room) return null;
    const body = d.doc.source[d.scroll + row];
    return body === undefined ? null : d.lines[body] ?? null;
  }

  private stepLink(d: 1 | -1) {
    const n = this.links.length;
    if (n) this.link = d === 1 ? (this.link + 1) % n : this.link <= 0 ? n - 1 : this.link - 1;
  }

  /** ⏎ on a selected link: media open in the system viewer, blocks and pages open through the host. */
  private follow(i: number, host: SurfaceHost, fresh = false): Promise<Msg | Outside | null> {
    const l = this.links[i];
    return l ? this.followTarget(l, host, { link: true, fresh }) : Promise.resolve(null);
  }

  // ── elements: what [ ] walks, ⏎ acts on and the ruler tints (PIE-441) ─────

  /** The current element's figure's keys, for the hint: its tabs and its density. */
  private figureHint(): string {
    const f = this.currentFigure();
    return f ? `${f.tabs ? " · ← → tab · ⇥ ⇤" : ""} · = ${nextDensity(f.density)}` : "";
  }

  /** Nothing is current: the next `[ ]` starts from the view, and ⏎ is the host's again. */
  letGo() { this.cur = null; this.link = -1; }

  private setElem(e: Element) {
    this.cur = e.key;
    const l = e.link;
    this.link = l ? this.links.findIndex(x => sameLink(x, l)) : -1;
  }

  /** The current element while the person can see it (or it's about to be brought into view). */
  inView(): Element | null {
    const e = this.elems.find(x => x.key === this.cur), d = this.drawn;
    // A host's digest: its column keeps the current element in view.
    if (e && !d && this.digesting) return e;
    if (!e || !d) return null;
    if (this.reveal || e.row < d.top) return e;
    const r = e.row - d.top;
    return r >= d.scroll && r < d.scroll + d.room ? e : null;
  }

  /**
   * `[ ]`: the previous or next element in reading order, from the current one, or from the view when none
   * is current. Where nothing is drawn (the river draws its own body), the links.
   * False when there's nothing to step to.
   */
  step(d: 1 | -1): boolean {
    const v = this.drawn ?? (this.digesting ? { top: 0, scroll: 0, room: Infinity } : null), es = this.elems;
    if (!v) { if (!this.links.length) return false; this.cur = null; this.stepLink(d); return true; }
    const n = es.length;
    if (!n) return false;
    // From the current element even when it's out of view (an agent's focus mark scrolled the reader):
    // only the person's own scrolling lets go of it.
    let i = es.findIndex(e => e.key === this.cur);
    if (i >= 0) i = (i + d + n) % n;
    else if (d === 1) { const from = v.scroll ? v.top + v.scroll : 0; i = es.findIndex(e => e.row >= from); if (i < 0) i = 0; }
    else { const bottom = v.top + v.scroll + v.room; i = es.findLastIndex(e => e.row < bottom); if (i < 0) i = n - 1; }
    this.setElem(es[i]!);
    this.reveal = true;
    return true;
  }

  /**
   * ⏎ (or a click) on an element. The person's (`select`, the default) becomes their `[ ]` position; an
   * agent's leaves it where it was (a fold it toggles isn't selected, a thread list is its own session).
   */
  private async enterElement(e: Element, host: SurfaceHost, { fresh = false, select = true }: { fresh?: boolean; select?: boolean } = {}): Promise<unknown> {
    if (select) this.setElem(e);
    if (e.kind === "fold") {
      const p = this.msg ? this.foldsIn(this.msg).points.find(p => `fold:${p.key}` === e.key) : undefined;
      if (!p) return null;
      this.setFold(p, !this.folded.has(p.key), select);
      host.redraw();
      return { folded: this.folded.has(p.key) };
    }
    // A comment mark expands its thread under the passage, or collapses it (PIE-420): the person's only.
    if (e.kind === "comment") { if (select) this.setExpanded(e.thread!, !this.expanded.has(e.thread!)); host.redraw(); return { thread: e.thread, expanded: this.expanded.has(e.thread!) }; }
    if (e.kind === "control" && e.link?.proposal?.op) return this.proposalControl(e.link.proposal.op, e.link.proposal.id, host);
    if (e.kind === "control" && e.link?.unsent) return this.runKey(`unsent.${e.link.unsent.op}`, { kind: e.link.unsent.kind }, host);
    // A live figure's tab shows it; its density control steps to the next density.
    // (element.open sends an agent's through figure.tab and figure.density itself, with their rules.)
    if (e.kind === "figure" && e.link?.figure) { this.pressFigure(e.link.figure, host); return null; }
    if (e.kind === "control") return this.useControl(e, host);
    // A step's box opens its status choice under it (the person's; an agent sets a status by task.status).
    if (e.kind === "task") { if (select) this.openPicker(e); host.redraw(); return { step: e.task?.step.itemId ?? null, choice: select }; }
    // A callout's icon or type opens its type choice under it (the person's; an agent changes it by callout.type).
    if (e.kind === "callout") { if (select) this.openCalloutPicker(e); host.redraw(); return { callout: e.label, choice: select, types: calloutsOf(this.src).types.map(t => t.name) }; }
    const how: OpenHow = { link: true, fresh };
    const l = e.link!;
    if (e.value !== undefined) return this.followValue({ key: e.value, target: l.block ? { block: l.block } : { page: l.page! } }, host, how);
    return this.followTarget(l, host, how);
  }

  /** The thread list, on the current comment mark's thread, as the person's `m` opens it (their session). */
  private openThread(host: SurfaceHost) {
    if (host.startSession) host.startSession("threads");
    else void this.runKey("threads", {}, host, true);
  }

  // ── comment threads expanded inline (PIE-420) ─────────────────────────────

  /** Expand a thread under its passage, or collapse it. The person's reading state, never an agent's. */
  setExpanded(thread: string, on: boolean) {
    if (on) this.expanded.add(thread); else this.expanded.delete(thread);
    this.reveal = true;
  }

  /** A thread of the note shown, by id or its first 6+ characters. */
  threadId(named: string): string {
    const c = (this.comments ?? []).find(t => t.id === named || (named.length >= 6 && t.id.startsWith(named)));
    if (!c) throw new ActionRefused(`no comment thread ${named} on this note; peek lists them under comments.threads`);
    return c.id;
  }

  /** Each expanded thread's rows, spliced into the body under the last row of its passage, and its controls. */
  private threadPanels(m: Msg, doc: Doc, noteLines: number[], W: number): { doc: Doc; controls: Control[] } {
    if (!this.expanded.size) return { doc, controls: [] };
    const cs = this.comments ?? [];
    const panels = this.commentMarks(m, doc, noteLines).flatMap(k => {
      const c = this.expanded.has(k.thread) ? cs.find(x => x.id === k.thread) : undefined;
      return c ? [{ at: k.rows[1], ...threadPanel(c, W, this.cur) }] : [];
    });
    if (!panels.length) return { doc, controls: [] };
    const { doc: out, starts } = withRows(doc, panels);
    return { doc: out, controls: panels.flatMap((p, i) => p.controls.map(c => ({ ...c, row: starts[i]! + c.row }))) };
  }

  /**
   * An expanded thread's control, by ⏎ or a click, through the comment code the thread list uses: Select
   * selects its passage (the reader's text selection, PIE-419); Reply opens the thread list as the person's
   * session with a reply to it started (Esc, or the reply landing, comes back here); Resolve or Reopen sets
   * its lifecycle as `x` in the list does.
   */
  private async useControl(e: Element, host: SurfaceHost): Promise<unknown> {
    const c = this.comments?.find(x => x.id === e.thread);
    if (!c || !this.msg) return null;
    if (e.control === "select") {
      const sel = this.passageSelection(c);
      if (!sel) { host.ctx.flash("its passage isn't drawn here (the quoted words moved, or they're folded away)"); return { selected: null }; }
      this.selection = this.stamp(sel);
      host.redraw();
      return { selected: this.describeSelection(this.selection)?.text ?? null };
    }
    if (e.control === "reply") { this.replyOn = c.id; this.openThread(host); return { replying: c.id }; }
    const s = new CommentSession(this.msg, this.comments ?? [], "threads");
    s.sel = s.threads.findIndex(t => t.id === c.id);
    await s.toggle(this.commentEnv(host));
    if (s.error) host.ctx.flash(s.error);
    host.redraw();
    return { thread: c.id, lifecycle: this.comments?.find(x => x.id === c.id)?.open ? "open" : "resolved" };
  }

  /** The drawn text of a thread's quote, where it's drawn in its passage's rows; else the passage's whole lines. */
  private passageSelection(c: Comment): Selection | null {
    const d = this.drawn, m = this.msg;
    if (!d || !m || c.start === null || c.end === null) return null;
    const lineOf = lineAtOffset(m.text), lo = lineOf(c.start), hi = lineOf(Math.max(c.start, c.end - 1));
    const rows = rowsOfLines(d.doc, d.lines, lo, hi);
    if (!rows) return null;
    for (let n = 1; n < 50; n++) {
      let s: Selection;
      try { s = this.selectBy({ text: c.quote, n }); } catch { break; }
      if (s.start.row >= d.top + rows[0] && s.start.row < d.top + rows[1]) return s;
    }
    try { return this.selectBy({ line: lo + 1, to: hi + 1 }); } catch { return null; }
  }

  /** The comment threads placed in the note, each on the rows of the lines its quote spans. */
  private commentMarks(m: Msg, doc: Doc, noteLines: number[]): Mark[] {
    const cs = this.commentsFor === m.id ? this.comments ?? [] : [];
    if (!cs.length) return [];
    const lineOf = lineAtOffset(m.text);
    const out: Mark[] = [];
    for (const c of cs) {
      if (c.start === null || c.end === null) continue;
      const lo = lineOf(c.start), hi = lineOf(Math.max(c.start, c.end - 1));
      const rows = rowsOfLines(doc, noteLines, lo, hi);
      if (!rows) continue;
      const q = printable(c.quote).trim();
      out.push({ thread: c.id, open: c.open, row: rows[0], rows, label: `"${ellipsize(q, 40)}" · ${c.author}${c.open ? "" : " · resolved"}` });
    }
    return out;
  }

  /**
   * The projections to draw, by the body line (index into `noteLines`) each follows: the last one at or
   * above its anchor line, or -1 (above the body) when none is (a ticket page's subject or preamble).
   */
  private projectionRegions(ps: readonly ResourceProjection[], noteLines: readonly number[]): Map<number, { p: ResourceProjection; part: TicketPart }[]> {
    const out = new Map<number, { p: ResourceProjection; part: TicketPart }[]>();
    const put = (at: number, p: ResourceProjection, part: TicketPart) => { const g = out.get(at); if (g) g.push({ p, part }); else out.set(at, [{ p, part }]); };
    const last = Math.max(-1, noteLines.length - 1);
    for (const p of ps) {
      // A ticket page's ticket is a child block: it follows the person's own notes, as the outline has it.
      if (p.anchor.kind === "page" && p.record) { put(last, p, "page"); continue; }
      if (p.anchor.kind !== "record") { put(noteLines.findLastIndex(n => n <= p.anchor.line), p, "page"); continue; }
      // The ticket block itself: its header on top, its comments after its body.
      put(-1, p, "head");
      if (p.record?.commentBlockIds.length) put(last, p, "comments");
    }
    return out;
  }

  /** Everything `[ ]` can stop on in this render, in reading order (content rows, then columns). */
  private elementsOf(doc: Doc, drawn: Link[], marks: Mark[], controls: Control[], summary: { from: number; to: number; link: Link; key: string }[], points: readonly FoldPoint[], top: number, head: string[], summaryRow = 1, imageRef: ((i: number) => ImageRef | null) | null = null): Element[] {
    const out: Element[] = [];
    const seen = new Map<string, number>();
    const keyOf = (kind: string, l: Link) => {
      const id = kind === "task" && l.task ? taskBase(l.task) : kind === "callout" && l.callout ? calloutBase(l.callout) : kind === "figure" && l.figure ? figureElemBase(l.figure) : l.proposal?.op ? `control:proposal:${l.proposal.op}:${l.proposal.id}` : `${kind}:${[l.block ?? "", l.fragment ?? "", l.label ?? "", l.page ?? "", l.media ?? "", l.url ?? ""].join("|")}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return `${id}#${n}`;
    };
    // The block a body row is in: the rows drawn from the same source line (a paragraph, a list item, a
    // heading, a whole table, callout or figure).
    const block = (r: number): [number, number] => {
      const s = doc.source[r];
      let a = r, b = r + 1;
      while (a > 0 && doc.source[a - 1] === s) a--;
      while (b < doc.source.length && doc.source[b] === s) b++;
      return [top + a, top + b];
    };
    const text = (line: string, from: number, to: number) => cellsOf(line).slice(from, to).join("").trim();
    const sum = head[summaryRow] ?? "";
    for (const l of summary) out.push({ key: keyOf("link", l.link), kind: "link", row: summaryRow, from: l.from, to: l.to, ruler: [summaryRow, summaryRow + 1], label: `${l.key} ${text(sum, l.from, l.to)}`, link: l.link, value: l.key });
    const heads = new Set(doc.links.filter(r => drawn[r.n]?.role === "resource").map(r => r.line));
    const byN = new Map<number, typeof doc.links>();
    for (const r of doc.links) { const g = byN.get(r.n); if (g) g.push(r); else byN.set(r.n, [r]); }
    for (const [n, rs] of byN) {
      const l = drawn[n], r = rs[0]!;
      // An image's caption controls are click targets only: [ ] stops on the image, and its keys change it.
      if (!l || l.role === "image") continue;
      const kind: ElementKind = l.role ?? "link";
      // An embed's ruler is its shaded region; a row's is itself; a link's is the block it's in.
      let ruler = block(r.line);
      // A row a density wraps is its lines; a figure's tab or density control is its own row.
      if (kind === "row") ruler = [top + r.line, top + rs.at(-1)!.line + 1];
      else if (kind === "figure") ruler = [top + r.line, top + r.line + 1];
      else if (kind === "embed") { let b = r.line + 1; while (b < doc.lines.length && doc.lines[b]!.startsWith(SHADE)) b++; ruler = [top + r.line, top + b]; }
      // A resource projection's is its shaded region, up to the next projection's head.
      else if (kind === "resource") { let b = r.line + 1; while (b < doc.lines.length && doc.lines[b]!.startsWith(SHADE) && !heads.has(b)) b++; ruler = [top + r.line, top + b]; }
      // A step's is its item in the note, or its row in an embed (the whole region is one note line).
      else if (kind === "task" && l.task?.via) ruler = [top + r.line, top + r.line + 1];
      // An extension's control is its own row.
      else if (kind === "control" && l.ext) ruler = [top + r.line, top + r.line + 1];
      const label = kind === "task" && l.task ? `${STEP_MARKS[l.task.step.status]} ${stepTitle(l.task.step)}${l.task.via ? ` · in ${l.task.via}` : ""}`
        : kind === "callout" && l.callout ? `[!${l.callout.type}] ${calloutTitle(l.callout)}` : rs.map(x => text(doc.lines[x.line]!, x.from, x.to)).join(" ");
      out.push({ key: keyOf(kind, l), kind, row: top + r.line, from: r.from + 1, to: r.to + 1, ruler, label, link: l, ...(l.task ? { task: l.task } : {}), ...(l.callout ? { callout: l.callout } : {}) });
    }
    for (const x of doc.media) {
      const image = imageRef?.(x.line) ?? undefined;
      out.push({ key: keyOf("link", { media: x.path }), kind: "link", row: top + x.row, from: 1, to: 1 + width(doc.lines[x.row] ?? ""), ruler: block(x.row), label: x.path.split("/").pop() ?? x.path, link: { media: x.path, ...(image ? { image } : {}) } });
    }
    for (const hd of doc.heads) {
      const p = points.find(p => p.key === hd.key);
      if (p) out.push({ key: `fold:${p.key}`, kind: "fold", row: top + hd.row, from: 1, to: hd.cols + 1, ruler: block(hd.row), label: foldLabel(p), fold: p.key });
    }
    for (const k of marks) out.push({ key: `comment:${k.thread}`, kind: "comment", row: top + k.row, from: 0, to: 1, ruler: [top + k.rows[0], top + k.rows[1]], label: k.label, thread: k.thread });
    const quoteOf = new Map(marks.map(k => [k.thread, k.label.split(" · ")[0]!]));
    for (const c of controls) out.push({ key: controlKey(c.thread, c.control), kind: "control", row: top + c.row, from: c.from + 1, to: c.to + 1, ruler: [top + c.row, top + c.row + 1], label: `${c.label} · ${quoteOf.get(c.thread) ?? "a thread"}`, thread: c.thread, control: c.control });
    return out.sort((a, b) => a.row - b.row || a.from - b.from);
  }

  /** The content rows [from, to) a focus mark covers in this render, or null when it isn't drawn. */
  private focusRows(spec: FocusSpec, m: Msg, doc: Doc, noteLines: number[], top: number): [number, number] | null {
    const body = (lo: number, hi: number): [number, number] | null => {
      const r = rowsOfLines(doc, noteLines, lo, hi);
      const t = Math.max(0, titleLine(m.text).line);
      return r ? [top + r[0], top + r[1]] : lo <= t && hi >= t ? [0, 1] : null;
    };
    if (spec.quote !== undefined) {
      const at = findQuote(m.text, spec.quote, spec.near);
      if (at < 0) return null;
      const lineOf = lineAtOffset(m.text);
      return body(lineOf(at), lineOf(at + Math.max(0, spec.quote.length - 1)));
    }
    if (spec.line !== undefined) return body(spec.line - 1, (spec.to ?? spec.line) - 1);
    if (spec.block !== undefined) {
      if (sameId(spec.block, m.id)) return [0, 1];      // the note itself: its title
      const e = this.elems.find(e => e.kind === "embed" && sameId(spec.block!, e.link!.block)) ?? this.elems.find(e => sameId(spec.block!, e.link?.block));
      return e ? e.ruler : null;
    }
    return null;
  }

  /**
   * Set a focus mark (PIE-423's door side): a block (the note, or one it embeds or links), note lines, or
   * an exact passage of the note's text, checked against what this reader draws now. It's drawn in the
   * ruler's tint, whoever set it named in the header, and scrolled into view when it isn't; the person's
   * `[ ]` position, selection and keys stay theirs.
   */
  setFocus(spec: FocusSpec, by: Actor): { marked: string; rows: number } {
    const m = this.msg, d = this.drawn;
    if (!m || !d) throw new ActionRefused("this reader doesn't draw the note now (it's editing, commenting, reading the note, showing the full property panel, or it's a river column's digest)");
    // A block, and in it maybe a passage (lines or exact words): the passage is found in the note shown.
    const within = [spec.line, spec.quote].filter(x => x !== undefined).length;
    if (within > 1 || (!within && spec.block === undefined)) throw new ActionRefused("say what to mark: block= (this note, or one it embeds or links), and in this note maybe line= (with to= for a range; 1 is the subject) or quote= (its exact words; near= picks among repeats)");
    if (within && spec.block !== undefined && !sameId(spec.block, m.id)) throw new ActionRefused(`a passage is found in the note this reader shows (${m.id.slice(0, 8)}); name it as block=, or leave block out`);
    if (spec.to !== undefined && spec.line === undefined) throw new ActionRefused("to= goes with line=");
    if (spec.near !== undefined && spec.quote === undefined) throw new ActionRefused("near= goes with quote=");
    if (spec.line !== undefined && (spec.line < 1 || (spec.to ?? spec.line) < spec.line)) throw new ActionRefused("line is from 1 (the subject), and to isn't before it");
    if (spec.quote !== undefined && !spec.quote.trim()) throw new ActionRefused("quote is empty");
    if (spec.quote !== undefined && findQuote(m.text, spec.quote, spec.near) < 0) throw new ActionRefused(`"${ellipsize(spec.quote, 40)}" isn't in the note's current text`);
    const rows = this.focusRows(spec, m, d.doc, d.lines, d.top);
    if (!rows) {
      if (spec.block !== undefined) throw new ActionRefused(`this note doesn't embed or link ${spec.block} where it's drawn; to mark another note, open it first`);
      throw new ActionRefused("nothing of that is drawn here (past the end, only properties, or in a folded section; unfold it first)");
    }
    const q = spec.quote?.trim() ?? "";
    const label = spec.quote !== undefined ? `"${ellipsize(q, 40)}"`
      : spec.line !== undefined ? `line${spec.to && spec.to !== spec.line ? `s ${spec.line}–${spec.to}` : ` ${spec.line}`}`
      : sameId(spec.block!, m.id) ? "this note" : (this.elems.find(e => sameId(spec.block!, e.link?.block))?.label ?? spec.block!).slice(0, 40);
    this.focusMark = { by, spec, label, at: Date.now() };
    this.revealMark = true;
    return { marked: label, rows: rows[1] - rows[0] };
  }

  /** The elements as `peek` and the `elements` action list them. */
  // ── live figures: a tabs figure's tab, a table's density (src/graphs.ts); this reader's, never the note's ──

  /** The figures the last layout drew: each one's number, kind, title, density, and a tabs figure's tabs and counts. */
  describeFigures() {
    return this.figuresDrawn.map(f => ({ n: f.n, kind: f.kind, title: f.title, density: f.density, ...(f.tabs ? { tab: f.tab ?? null, tabs: f.tabs.map((t, i) => ({ n: i + 1, ...t, shown: t.value === f.tab })) } : {}) }));
  }

  /** The figure the current element is in (one of its tabs, its density, one of its rows), while it's in view. */
  currentFigure(): FigureInfo | null {
    const key = this.inView()?.link?.figure?.figure;
    return key ? this.figuresDrawn.find(f => f.key === key) ?? null : null;
  }

  /**
   * Figure `which` of the last layout: its number among the note's figures (from 1) or its title; left out, the one
   * the current element is in, else the note's only one of the kind asked. Refused, saying what's there, otherwise.
   */
  figureNamed(which: string | undefined, want: "tabs" | "rows"): FigureInfo {
    this.requireDrawn();
    const fits = (f: FigureInfo) => (want === "tabs" ? f.kind === "tabs" : f.kind === "tabs" || f.kind === "table");
    const fs = this.figuresDrawn.filter(fits), what = want === "tabs" ? "tabs figure" : "table or tabs figure";
    if (!fs.length) throw new ActionRefused(`this note draws no ${what} now (figures lists what it draws)`);
    const s = which?.trim();
    const f = !s ? (this.currentFigure() && fits(this.currentFigure()!) ? this.currentFigure() : fs.length === 1 ? fs[0] : undefined)
      : /^\d+$/.test(s) ? this.figuresDrawn.find(x => x.n === Number(s)) : fs.find(x => x.title.toLowerCase() === s.toLowerCase());
    const listed = fs.map(x => `${x.n} ${x.title}`).join(", ");
    if (!f) throw new ActionRefused(s ? `no ${what} ${s} in this note; there are: ${listed}` : `this note draws ${fs.length} ${what}s; say which: figure=<n or title> (${listed})`);
    if (!fits(f)) throw new ActionRefused(`figure ${s} is a ${f.kind}, not a ${what}; there are: ${listed}`);
    return f;
  }

  /**
   * Show tab `value` of figure `f`. `select` (the person's): when their `[ ]` position is in that figure (a tab, a row
   * of the tab that's going), it moves to the new tab's label, so ← → go on from there.
   */
  setFigureTab(f: FigureInfo, value: string, select: boolean) {
    this.figureUI.set(f.key, { ...this.figureUI.get(f.key), tab: value });
    f.tab = value;
    if (select && this.inView()?.link?.figure?.figure === f.key) { this.cur = `${figureElemBase({ figure: f.key, tab: value })}#0`; this.link = -1; this.reveal = true; }
  }

  /** Draw figure `f` at density `d`. */
  setFigureDensity(f: FigureInfo, d: Density) {
    this.figureUI.set(f.key, { ...this.figureUI.get(f.key), density: d });
    f.density = d;
  }

  /**
   * The figure action key `k` runs while the current element is in a live figure: tab shift+tab ← → a tabs figure's
   * next or previous tab, = the next density, ⏎ on a tab or the density control that one. Null for any other key.
   */
  private figureKey(k: Key): { name: "figure.tab" | "figure.density"; args: Record<string, unknown> } | null {
    if (this.modes.top()) return null;
    const f = this.currentFigure();
    if (!f) return null;
    const figure = String(f.n), e = this.inView();
    if (f.tabs && (k.kind === "tab" || k.kind === "backtab" || k.kind === "left" || k.kind === "right")) return { name: "figure.tab", args: { figure, by: k.kind === "tab" || k.kind === "right" ? 1 : -1 } };
    if (ch(k) === "=") return { name: "figure.density", args: { figure } };
    if (k.kind === "enter" && e?.kind === "figure") return e.link?.figure?.tab !== undefined ? { name: "figure.tab", args: { figure, tab: e.link.figure.tab } } : { name: "figure.density", args: { figure } };
    return null;
  }

  /**
   * A key this reader takes ahead of its host's own while a live figure's element is current (tab and shift+tab
   * cycle a desk's tiles, ← → step a river's columns or a BBS reader's messages otherwise): the host asks first.
   */
  claims(k: Key): boolean { return !!this.figureKey(k) || (!!this.imageKey(k) && ch(k) !== "H"); }

  /**
   * The image action key `k` runs while an image is the current element (PIE-532): + - its size (a header's height),
   * ← → where it sits, H the note's header on or off. Null for any other key. The host asks first for all but H
   * (claims): in a float, H stays the float's (float.place), and the caption's [▀] makes it the header.
   */
  /** Whether `k` is an image's key here now (imageKey): a host that owns H too (the river) asks this. */
  imageKeyOf(k: Key): boolean { return !!this.imageKey(k); }

  private imageKey(k: Key): { name: "image.size" | "image.align" | "image.hero" | "image.fit"; args: Record<string, unknown> } | null {
    if (this.modes.top()) return null;
    const e = this.inView();
    if (!e?.link?.image || !e.link.media) return null;
    const c = ch(k);
    if (c === "+" || c === "-") return { name: "image.size", args: { by: c === "+" ? 1 : -1 } };
    if (c === "H") return { name: "image.hero", args: {} };
    const hero = parseMediaLine(e.link.image.source)?.layout === "hero";
    if (!hero && (k.kind === "left" || k.kind === "right")) return { name: "image.align", args: { by: k.kind === "right" ? 1 : -1 } };
    if (hero && c === "=") return { name: "image.fit", args: {} };
    return null;
  }

  /** A click on an image's caption control: the image becomes the `[ ]` position, and the control's action runs as the person's. */
  private pressImage(ref: ImageRef, host: SurfaceHost) {
    const e = this.elems.find(x => x.link?.image && !x.link.image.control && x.link.image.block === ref.block && x.link.image.line === ref.line);
    if (e) this.setElem(e);
    const c = ref.control, line = ref.line + 1;
    if (!c) return;
    if ("size" in c) void this.runKey("image.size", { by: c.size, line }, host);
    else if ("align" in c) void this.runKey("image.align", { by: c.align, line }, host);
    else if ("fit" in c) void this.runKey("image.fit", { to: c.fit, line }, host);
    else void this.runKey("image.hero", { on: c.hero, line }, host);
    host.redraw();
  }

  /** The images in note `m` as written (outside code fences), in reading order. */
  imagesIn(m: Msg): (ImageRef & { spec: MediaSpec })[] {
    // The reader's own scan of the body it draws (mediaLines), each line mapped back to the note's.
    const { text, lines } = this.foldsIn(m), all = m.text.split("\n");
    return [...mediaLines(text.split("\n"))].flatMap(([i, spec]) => {
      const line = lines[i], source = line === undefined ? undefined : all[line];
      return line === undefined || source === undefined ? [] : [{ block: m.id, line, source, path: spec.path, spec }];
    });
  }


  /**
   * The image a person's key means when it names none (the current element in view), or the one `n` (from images) or
   * `line` (its note line, 1 the subject) names.
   */
  async imageNamed({ n, line }: { n?: number; line?: number }, actor: Actor): Promise<ImageRef & { spec: MediaSpec }> {
    if (n === undefined && line === undefined) {
      if (actor.kind === "agent") throw new ActionRefused("say which image: n= (images lists them) or line=");
      // Its line as the note reads now (a change just saved, + pressed twice, has moved on from the last render).
      const r = this.inView()?.link?.image;
      const source = r && this.msg?.id === r.block ? this.msg.text.split("\n")[r.line] ?? r.source : r?.source;
      const spec = source !== undefined ? parseMediaLine(source) : null;
      if (r && spec) return { block: r.block, line: r.line, source: source!, path: spec.path, spec };
      throw new ActionRefused("say which image: n= or line= (images lists them), or put [ ] on an image");
    }
    const all = this.imagesIn(await this.whole());
    const listed = () => all.slice(0, 12).map((x, i) => `${i + 1} line ${x.line + 1} ${x.path.split("/").pop()}`).join("; ") || "none";
    const hit = n !== undefined ? all[n - 1] : all.find(x => x.line + 1 === line);
    if (!hit) throw new ActionRefused(`no such image in this note (${listed()})`);
    return hit;
  }

  /** How wide image `ref` is drawn now, as a share of the body (0–100), or null when it isn't drawn. */
  private drawnShare(ref: ImageRef): number | null {
    const d = this.drawn;
    const x = d?.doc.media.find(x => d.lines[x.line] === ref.line);
    const im = x?.image !== undefined ? d!.doc.images[x.image] : undefined;
    return im && d ? (im.cols / Math.max(1, d.w - 1)) * 100 : null;
  }
  /** How each image is drawn now, by its note line: its cells and where it sits, or the header's rows. */
  drawnImages(): Map<number, { cols: number; rows: number; col: number } | { header: number }> {
    const out = new Map<number, { cols: number; rows: number; col: number } | { header: number }>(), d = this.drawn;
    if (this.hero) out.set(this.hero.line, { header: this.hero.full });
    if (!d) return out;
    for (const x of d.doc.media) {
      const im = x.image !== undefined ? d.doc.images[x.image] : undefined, line = d.lines[x.line];
      if (im && line !== undefined) out.set(line, { cols: im.cols, rows: im.rows, col: im.col });
    }
    return out;
  }
  /** How many rows the header image takes now, or null when the reader doesn't draw one. */
  heroRowsDrawn(): number | null { return this.hero?.full ?? null; }

  /**
   * Change an image's line (PIE-532): its layout properties (`set`), and with `others`, other image lines of the
   * note too (the header moving from one image to another), as one save through rewriteLines, recorded as `actor`'s;
   * image.undo (ctrl+z) puts the lines back.
   */
  async changeImage(ref: ImageRef & { spec: MediaSpec }, set: Partial<Record<MediaAttr, string | null>>, what: string, host: SurfaceHost, actor: Actor, others: { line: number; source: string; set: Partial<Record<MediaAttr, string | null>> }[] = []) {
    const edits: LineEdit[] = [];
    for (const x of [{ line: ref.line, source: ref.source, set }, ...others]) {
      const after = rewriteMediaLine(x.source, x.set);
      if (after === null) throw new ActionRefused("that line isn't an image any more");
      if (after !== x.source) edits.push({ line: x.line, before: x.source, after });
    }
    const name = ref.path.split("/").pop() ?? ref.path;
    const r = await this.rewriteLines(ref.block, edits, this.imageHistory, host, actor, IMAGE_STALE);
    if (!edits.length) return { block: ref.block, line: ref.line + 1, changed: false, image: ref.source, revision: r.revision ?? null };
    // The person's image stays in view as it grows or moves, so its keys keep working on it.
    if (actor.kind === "user") this.reveal = true;
    const said = `image ${printable(name).slice(0, 30)}: ${what}`;
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: ref.block, line: ref.line + 1, changed: true, image: edits.find(e => e.line === ref.line)?.after ?? ref.source, revision: r.revision ?? null, recordedAs: mutationFor(actor) };
  }

  /**
   * Line changes (an image's, a callout's, their undo) run one after another, so a key pressed again before the last
   * save landed builds on it, and an undo finds the change before it.
   */
  private lineTurn: Promise<unknown> = Promise.resolve();
  inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lineTurn.catch(() => {}).then(fn);
    this.lineTurn = next;
    return next;
  }

  /** Undo the last image change `actor` made while reading this note. */
  async undoImage(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.imageHistory, "image", host, actor));
    return { block: r.block, lines: r.edits.map(e => ({ line: e.line + 1, image: e.before })), revision: r.revision, recordedAs: mutationFor(actor) };
  }

  /** The width `ref` steps to by `by` (one of the reader's steps: a quarter, a third, a half, two thirds, three quarters, all). */
  sizeStep(ref: ImageRef & { spec: MediaSpec }, by: number): string | null {
    const s = ref.spec.size, W = Math.max(1, (this.drawn?.w ?? 81) - 1);
    const now = s === "full" ? 100 : s && "percent" in s ? s.percent : s ? (s.cells / W) * 100 : this.drawnShare(ref) ?? 50;
    const next = by > 0 ? SIZE_STEPS.find(p => p > now + 1) : SIZE_STEPS.findLast(p => p < now - 1);
    return next === undefined ? null : next === 100 ? "full" : `${next}%`;
  }

  /** A click (or ⏎ through `open`) on a figure's control: the action its key runs. */
  /** An agent's (or anyone's) `element.open` on a figure's control: figure.tab or figure.density as `actor`. */
  runFigureControl(c: FigureControl, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const f = this.figuresDrawn.find(x => x.key === c.figure);
    if (!f) throw new ActionRefused("that figure isn't drawn now (figures lists what is)");
    return NOTE_ACTIONS.run(c.tab !== undefined ? "figure.tab" : "figure.density", c.tab !== undefined ? { figure: String(f.n), tab: c.tab } : { figure: String(f.n) }, { surface: this, host }, actor);
  }

  pressFigure(c: FigureControl, host: SurfaceHost) {
    const f = this.figuresDrawn.find(x => x.key === c.figure);
    if (!f) return;
    if (c.tab !== undefined) void this.runKey("figure.tab", { figure: String(f.n), tab: c.tab }, host);
    else void this.runKey("figure.density", { figure: String(f.n) }, host);
  }

  describeElements() {
    return this.elems.map((e, i) => ({
      n: i + 1, kind: e.kind, label: printable(e.label), current: e.key === this.cur,
      ...(e.link ? { target: e.link.block ?? e.link.page ?? e.link.media ?? e.link.url } : {}), ...(e.thread ? { thread: e.thread } : {}), ...(e.control ? { control: e.control } : {}),
      ...(e.link?.proposal?.op ? { control: e.link.proposal.op, proposal: e.link.proposal.id } : {}),
      ...(e.link?.unsent ? { control: e.link.unsent.op, unsent: e.link.unsent.kind } : {}),
    }));
  }

  /** Refused unless the last render drew the note (the elements come from it). */
  requireDrawn() {
    if (!this.drawn && !this.digesting) throw new ActionRefused("this reader doesn't draw the note now (it's editing, commenting, reading the note, or it's a river column's digest; link.select steps a river column's links)");
  }

  /** Element `n` (from 1) of the last render. */
  element(n: number): Element {
    this.requireDrawn();
    const e = this.elems[n - 1];
    if (!e) throw new ActionRefused(`there is no element ${n}; the reader draws ${this.elems.length} (elements lists them)`);
    return e;
  }

  /** `element.select`: the person's `[ ]` position, brought into view. */
  selectElement(e: Element) { this.setElem(e); this.reveal = true; }
  /** `element.open`: ⏎ on element `e` (see enterElement). */
  openElement(e: Element, host: SurfaceHost, fresh: boolean, select: boolean) { return this.enterElement(e, host, { fresh, select }); }

  /**
   * A click in the last render (`x`, `y` in the surface's cells). While an edit, a comment or a value
   * being typed holds the surface, only a completion candidate takes it (chosen and inserted, as Enter
   * does). Otherwise a link opens where ⏎ on it would (and becomes the selected `[ ]` link when it is one
   * of them); a property panel row is selected, and a click on its linked value follows it. Elsewhere on
   * a heading, or on a list item's mark, it folds or unfolds it (clickFold). False when nothing is there.
   */
  click(x: number, y: number, host: SurfaceHost): boolean {
    this.use(host);
    // The note's rows are under its header image (PIE-532).
    y -= this.drawn?.heroRows ?? 0;
    // An open mode first (in its precedence): the edit's or comment's own click, a status choice's row, a panel row.
    const taken = this.modes.click(x, y, host);
    if (taken !== undefined) return taken;
    // The header image: a click on it makes it the `[ ]` position, as a click on any image does.
    if (y < 0) { const i = this.elems.findIndex(e => !!e.link?.media && e.link.image?.line === this.hero?.line); if (i >= 0) void this.runKey("element.select", { n: i + 1 }, host); return i >= 0; }
    const h = this.hitAt(x, y);
    // Each click is the action its key is (PIE-506): copy, back and forward, select.clear, element.open, …
    if (h && "copy" in h) { void this.runKey("select.copy", h.copy === "source" ? { source: true } : {}, host); return true; }
    if (h && "history" in h) { void this.runKey(h.history < 0 ? "back" : "forward", {}, host); return true; }
    // A click anywhere else lets go of the selection, and does what it always did.
    if (this.selection) void this.runKey("select.clear", {}, host);
    if (!h) return this.clickFold(x, y, host);
    // A comment mark: its thread opens, as ⏎ on it does, and it's the `[ ]` position (PIE-441).
    if ("thread" in h) {
      const i = this.elems.findIndex(e => e.key === h.elem);
      if (i >= 0) void this.runKey("element.open", { n: i + 1 }, host);
      host.redraw();
      return i >= 0;
    }
    // A panel row or a status choice is its mode's (above); with that mode gone, nothing.
    if ("prop" in h || "pick" in h) return false;
    // An image itself: it becomes the `[ ]` position, so its keys (+ - ← → H) change it; ⏎ or a click on its caption opens it.
    if ("image" in h) { void this.runKey("element.select", { n: this.elems.findIndex(x => x.key === h.image) + 1 }, host); return true; }
    // A link (in the text, the summary line, an embed's title, a figure's row): the `[ ]` position, then
    // it opens where ⏎ on it would.
    const e = h.elem ? this.elems.find(e => e.key === h.elem) : undefined;
    // A proposal's [apply] or [dismiss] (PIE-501): it becomes the `[ ]` position, and its action runs.
    const pc = h.link.proposal;
    if (pc?.op) { if (e) this.setElem(e); host.redraw(); void this.proposalControl(pc.op, pc.id, host); return true; }
    // An `■ unsent` line's control: it becomes the `[ ]` position, and its action runs.
    const uc = h.link.unsent;
    if (uc) { if (e) this.setElem(e); host.redraw(); void this.runKey(`unsent.${uc.op}`, { kind: uc.kind }, host); return true; }
    // A live figure's tab or density: it becomes the `[ ]` position, and figure.tab or figure.density runs.
    if (h.link.role === "figure" && h.link.figure) { if (e) this.setElem(e); this.pressFigure(h.link.figure, host); host.redraw(); return true; }
    // An image's caption control (PIE-532): the image becomes the `[ ]` position, and the control's action runs.
    if (h.link.role === "image" && h.link.image) { this.pressImage(h.link.image, host); return true; }
    // A step's box: its status choice opens under it, as ⏎ on it does (PIE-472); a link (or a summary-line
    // value) opens where ⏎ on it would. Both are element.open on that element.
    if (e) { void this.runKey("element.open", { n: this.elems.indexOf(e) + 1 }, host); host.redraw(); return true; }
    const i = this.links.findIndex(x => sameLink(x, h.link));
    if (i >= 0 && h.value === undefined) { void this.runKey("link.follow", { n: i + 1 }, host); return true; }
    // A link drawn outside the note's elements and links (none today): opened as ⏎ on it would.
    host.redraw();
    if (h.value !== undefined) void this.followValue({ key: h.value, target: h.link.block ? { block: h.link.block } : { page: h.link.page! } }, host, { link: true });
    else void this.followTarget(h.link, host, { link: true });
    return true;
  }

  /**
   * Open a link the host drew itself (the river's note body): it becomes the selected `[ ]` link when
   * it is one of them, then opens where ⏎ on it would.
   */
  open(l: Link, host: SurfaceHost, fresh = false): Promise<Msg | Outside | null> {
    // A step's box opens its status choice; a row of an open choice chooses it (PIE-472).
    if ((l.role === "task" || l.role === "callout") && l.choice !== undefined) { void this.choose(l.choice, host); return Promise.resolve(null); }
    if (l.role === "callout" && l.callout) {
      const e = this.elems.find(x => x.link === l) ?? this.elems.find(x => x.callout && calloutBase(x.callout) === calloutBase(l.callout!));
      if (e) { this.openCalloutPicker(e); host.redraw(); }
      return Promise.resolve(null);
    }
    if (l.proposal?.op) { void this.proposalControl(l.proposal.op, l.proposal.id, host); return Promise.resolve(null); }
    if (l.unsent) { void this.runKey(`unsent.${l.unsent.op}`, { kind: l.unsent.kind }, host); return Promise.resolve(null); }
    if (l.role === "image" && l.image) { this.pressImage(l.image, host); return Promise.resolve(null); }
    if (l.role === "figure" && l.figure) {
      const e = this.elems.find(x => x.link === l) ?? this.elems.find(x => x.link?.figure && figureElemBase(x.link.figure) === figureElemBase(l.figure!));
      if (e) this.setElem(e);
      this.pressFigure(l.figure, host);
      host.redraw();
      return Promise.resolve(null);
    }
    if (l.role === "task" && l.task) {
      const e = this.elems.find(x => x.link === l) ?? this.elems.find(x => x.task && taskBase(x.task) === taskBase(l.task!));
      if (e) { this.openPicker(e); host.redraw(); }
      return Promise.resolve(null);
    }
    const i = this.links.findIndex(x => sameLink(x, l));
    if (i >= 0) { this.cur = null; this.link = i; }
    host.redraw();
    return this.followTarget(l, host, { link: true, fresh });
  }

  /**
   * Open what a link names outside the door, in the person's browser or system viewer: theirs alone. An agent's
   * follow never opens anything there (it would take their screen); it gets the address back in its answer, and
   * the reader says so.
   */
  private openOutside(where: Outside["outside"], url: string, host: SurfaceHost): Outside {
    const by = host.actor, app = where === "browser" ? "the browser" : "the system viewer";
    if (by?.kind === "agent") {
      this.noteAgent(by, `was given ${url} · an agent doesn't open ${app}`);
      host.ctx.flash(`was given ${url} · an agent doesn't open ${app}`);
      host.redraw();
      return { outside: where, url, launched: false };
    }
    external.run(where === "browser" ? externalOpenCommand(url) : fileOpenCommand(url));
    host.ctx.flash(`opened ${where === "browser" ? url : "it"} in ${app}`);
    return { outside: where, url, launched: true };
  }

  /** Open what a link names: media in the system viewer, web pages in the browser (openOutside), blocks and pages through the host (`how`, where). */
  private async followTarget(l: Link, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | Outside | null> {
    if (l.media) return this.openOutside("viewer", l.media, host);
    // A resource token: its Resource's stored content, registered and fetched first if it must be (src/authored.ts).
    if (l.resource) {
      const to = resourceTarget(l.resource);
      if ("refused" in to) { host.ctx.flash(to.refused); return null; }
      host.ctx.flash(`reading ${l.resource.label}…`);
      const shown = await openResource(host.ctx.board, to, host.actor ?? USER).catch((e: Error) => { host.ctx.flash(`couldn't show ${l.resource!.label}: ${e.message}`); return null; });
      if (!shown) return null;
      this.track(() => host.navigate(shown.note, how));
      if (shown.registered) host.ctx.flash(`${l.resource.label} registered and shown`);
      return shown.note;
    }
    // A ticket's age refreshes it (PIE-445), as r does.
    if (l.refresh) { void this.refreshTickets(host, l.refresh, host.actor ?? USER, l.refreshLine).catch(() => {}); return null; }
    // A resource projection opens its ticket block, or its ticket's page; without one it says why (no key, not fetched yet, …).
    if (l.role === "resource" && l.url === undefined && !l.block) { host.ctx.flash(l.reason ?? "nothing to open here"); return null; }
    // A Markdown link: a web page opens in the browser; a pi-outliner:// block or page link opens here.
    if (l.url !== undefined) {
      const to = destinationOf(l.url);
      if ("refused" in to) { host.ctx.flash(to.refused); return null; }
      if ("web" in to) return this.openOutside("browser", to.web, host);
      return this.followTarget(to.target, host, how);
    }
    let target: Msg | null = null;
    if (l.block) target = await host.ctx.board.get(l.block);
    else if (l.page) {
      // The service's page and Work-ID registry first (read-only: a dangling address isn't created).
      const p = await host.ctx.board.resolvePage(l.page).catch(() => null);
      if (p?.block) target = p.block.partial ? await host.ctx.board.get(p.block.id) ?? p.block : p.block;
      else if (p?.status === "missing") return this.offerPage(l.page, host);
    }
    if (!target && l.page) {
      // Not a registered address: the one search's answer, when it is exactly that (an id, or the title as folded).
      const hit = (await host.ctx.board.searchBlocks(l.page).catch(() => null))?.matches[0];
      if (hit?.exact) target = await host.ctx.board.get(hit.block.id);
    }
    if (!target) { host.ctx.flash(`nothing answers at ${l.block ?? `[[${l.page}]]`}`); return null; }
    // `((id^fragment))` (PIE-425): the reader the note opens in scrolls to the fragment and marks it.
    if (l.fragment) revealOn.set(target, { fragment: l.fragment, by: host.actor ?? USER });
    this.track(() => host.navigate(target, how));
    // A host that kept the note in this reader without showing it again (it already showed it).
    if (this.msg?.id === target.id) this.takeReveal(target, host);
    return target;
  }

  /**
   * A followed `[[address]]` nothing answers (PIE-544): never made silently. The first ⏎ or click offers it (said, and
   * kept under the header while this note is shown); the person's next ⏎ or click on that link makes it (`page.create`)
   * and opens it here. An agent following one is told, and makes it with page.create.
   */
  private async offerPage(page: string, host: SurfaceHost): Promise<null> {
    const by = host.actor ?? USER;
    if (by.kind === "agent") throw new ActionRefused(`[[${page}]] doesn't exist yet: no page has that name; page.create address=${JSON.stringify(page)} makes it`);
    // The offer stands while it's still said under the header, for a minute: never a create long after, unannounced.
    const o = this.pageOffer;
    if (o && o.page === page && this.notice === o.notice && Date.now() - o.at < PAGE_OFFER_MS) {
      this.pageOffer = null;
      this.notice = "";
      await this.runKey("page.create", { address: page }, host);
      return null;
    }
    this.notice = `no page [[${page}]] · ⏎ or click it again: create it`;
    this.pageOffer = { page, notice: this.notice, at: Date.now() };
    host.ctx.flash(`[[${page}]] doesn't exist yet · ⏎ or click it again to create the page`, 8000);
    host.redraw();
    return null;
  }
  /** The `[[address]]` whose page the next ⏎ or click on its link makes (offerPage), as said; gone with the note. */
  private pageOffer: { page: string; notice: string; at: number } | null = null;

  /**
   * `page.create`: the page an `[[address]]` names, made where new notes go (the service's placement rule, today the
   * top of the Inbox) as `X [page::X]`, then opened as a followed link opens; one that exists already is opened. An
   * agent's is made and said, opening nothing.
   */
  async createPage(address: string, host: SurfaceHost, actor: Actor): Promise<{ id: string; created: boolean; said?: string }> {
    const r = await host.ctx.board.followPage(address, actor).catch((e: Error) => { throw new ActionRefused(`no page ${address}: ${e.message}`); });
    if (!r.note) throw new ActionRefused(r.status === "deleted" ? `[[${address}]] is a page in the trash: restore it there` : `no page ${address}`);
    const said = r.created ? `created page ${subject(r.note)} ${r.placement?.said ?? ""}`.trim() : `${subject(r.note)} was there already`;
    if (actor.kind !== "agent") {
      const target = r.note;
      this.track(() => host.navigate(target, { link: true }));
      host.ctx.flash(said);
    }
    host.redraw();
    return { id: r.note.id, created: r.created, said };
  }

  /** Reveal the fragment a follow left on `m`, unless it's an agent's and this is the person's focused reader. */
  private takeReveal(m: Msg, host: SurfaceHost) {
    const r = revealOn.get(m);
    if (!r) return;
    if (r.by.kind === "agent" && host.focused !== false) return;
    revealOn.delete(m);
    void this.revealFragment(r.fragment, host, r.by);
  }

  /** `u`: the note's parent. */
  private async up(host: SurfaceHost): Promise<Msg | null> {
    const id = this.msg?.parentId;
    if (!id) return null;
    const p = await host.ctx.board.get(id).catch(() => null);
    if (p) this.track(() => host.navigate(p));
    return p;
  }

  // ── checklist steps (PIE-472) ──────────────────────────────────────────────

  /**
   * The current element is still drawn (or let go). A step that just got its id is named by it from now on;
   * until every place it's drawn has been read again (an embed a moment late) it may still be drawn under
   * its old name, and the person's `[ ]` position follows it either way.
   */
  private keepCurrent(host?: SurfaceHost) {
    const drawn = (key: string) => this.elems.some(e => e.key === key);
    const loading = !!this.src && (stepsLoading(this.src.board) || embedsLoading(this.src.board));
    if (this.cur && !drawn(this.cur)) {
      const a = this.stepRenamed, cur = this.cur;
      const other = !a ? null : cur.startsWith(`${a.now}#`) ? a.was + cur.slice(a.now.length) : cur.startsWith(`${a.was}#`) ? a.now + cur.slice(a.was.length) : null;
      if (other && drawn(other)) { if (this.picker?.key === cur) this.picker.key = other; this.cur = other; }
      // A step isn't let go of while the steps are read again: it's back once they are.
      else if (!(cur.startsWith("task:") && loading)) this.letGo();
    }
    // The step under an open status choice changed (its text, or it's gone): the choice closes rather than
    // act on whatever is there now.
    const P = this.picker;
    if (P && !drawn(P.key) && !loading && !P.busy) {
      this.picker = null;
      if (this.cur === P.key) this.letGo();
      host?.ctx.flash(P.kind === "callout" ? "that callout changed while its type choice was open · nothing was changed · choose again" : "that step changed while its status choice was open · nothing was changed · choose again");
    }
  }

  /** A step's status choice, opened on its box (⏎, a click): the person's, the current element meanwhile. */
  openPicker(e: Element) {
    if (!e.task) return;
    this.setElem(e);
    this.reveal = true;
    // Mark done first, as Detail's menu; on a done step, Mark to do.
    this.picker = { key: e.key, list: this.choices(e.task.step.status === "done" ? 1 : 0), note: "", busy: false };
  }

  /**
   * A callout's type choice (PIE-538), opened on its icon or type (⏎, a click): the person's, the current element
   * meanwhile. It lists the outline's types (the one list) and offers to make it start folded or open.
   */
  openCalloutPicker(e: Element) {
    const c = e.callout;
    if (!c) return;
    this.setElem(e);
    this.reveal = true;
    const types = calloutsOf(this.src);
    const items: Choice[] = [
      ...types.types.map(t => ({ id: `type:${t.name}`, label: `${t.name}${t.aliases.length ? ` · ${t.aliases.join(", ")}` : ""}${t.block ? " · this outline's" : ""}`, key: "" })),
      c.fold === "-" ? { id: "start:open", label: "make it start open (+)", key: "+" } : { id: "start:folded", label: "make it start folded (-)", key: "-" },
    ];
    const list = new ListPicker<Choice, SurfaceHost>({
      name: "choice", items: () => items, wraps: true, closers: "q", stays: true, row: () => [],
      choose: (_, i, host) => void this.choose(i, host),
      closed: host => { this.picker = null; host.redraw(); },
      keys: (k, host) => {
        const want = ch(k) === "-" ? "start:folded" : ch(k) === "+" ? "start:open" : null;
        if (!want) return false;
        const i = items.findIndex(x => x.id === want);
        if (i >= 0) void this.choose(i, host); else host.ctx.flash(`it starts ${want === "start:open" ? "open" : "folded"} already`);
        return true;
      },
    });
    list.sel = Math.max(0, items.findIndex(x => x.id === `type:${types.resolve(c.type)?.name ?? ""}`));
    this.picker = { key: e.key, kind: "callout", list, note: "", busy: false, types };
  }

  /** A status choice's list, from choice `sel`: j k Tab round it, ⏎ or a choice's letter chooses, esc or q cancels. */
  choices(sel: number): Picker["list"] {
    const list = new ListPicker<Choice, SurfaceHost>({
      name: "choice", items: () => STEP_CHOICES, wraps: true, closers: "q", stays: true, row: () => [],
      choose: (_, i, host) => void this.choose(i, host),
      closed: host => { this.picker = null; host.redraw(); },                                  // a cancel: as it was
      keys: (k, host) => { const i = STEP_CHOICES.findIndex(x => x.key === ch(k)); if (i >= 0) void this.choose(i, host); return i >= 0; },
    });
    list.sel = sel;
    return list;
  }

  private pickerKey(k: Key, host: SurfaceHost): boolean {
    const P = this.picker!;
    if (!P.busy || k.kind === "esc" || ch(k) === "q") P.list.key(k, host);
    host.redraw();
    return true;
  }


  /** Choice `i` of the open status choice, for the person: the step as drawn now. */
  private async choose(i: number, host: SurfaceHost) {
    if (this.picker?.kind === "callout") return this.chooseCallout(i, host);
    const P = this.picker, choice = STEP_CHOICES[i];
    if (!P || P.busy || !choice) return;
    const e = this.elems.find(x => x.key === P.key);
    if (!e?.task) { this.picker = null; host.ctx.flash("that step isn't drawn here any more"); host.redraw(); return; }
    P.busy = true; P.list.sel = i; P.note = "…"; host.redraw();
    try {
      // The choice is the step's action (PIE-506): task.status, or task.link for its link and its id, as the person's
      // key, through the host's dispatcher; a refusal is the picker's note.
      let refused: string | null = null;
      const note = (why: string) => { refused = why; return null; };
      if (choice.id === "copy-link" || choice.id === "address") await this.runKey("task.link", choice.id === "address" ? { copy: false } : {}, host, note);
      else await this.runKey("task.status", { to: choice.id }, host, note);
      if (refused) throw new Error(refused);
      if (this.picker === P) this.picker = null;
    } catch (err) {
      if (this.picker === P) { P.busy = false; P.note = err instanceof Error ? err.message : String(err); }
    }
    host.redraw();
  }

  /** The element of a callout's icon drawn now, or null (folded away). */
  calloutElement(c: CalloutRef): Element | null {
    return this.elems.find(e => e.kind === "callout" && e.callout && e.callout.block === c.block && e.callout.line === c.line) ?? null;
  }

  /** Choice `i` of the open callout type choice, for the person: callout.type or callout.start, as their key. */
  private async chooseCallout(i: number, host: SurfaceHost) {
    const P = this.picker, choice = P?.list.items[i];
    if (!P || P.busy || !choice) return;
    P.busy = true; P.list.sel = i; P.note = "…"; host.redraw();
    try {
      let refused: string | null = null;
      const note = (why: string) => { refused = why; return null; };
      if (choice.id.startsWith("type:")) await this.runKey("callout.type", { to: choice.id.slice(5) }, host, note);
      else await this.runKey("callout.start", { folded: choice.id === "start:folded" }, host, note);
      if (refused) throw new Error(refused);
      if (this.picker === P) this.picker = null;
    } catch (err) {
      if (this.picker === P) { P.busy = false; P.note = err instanceof Error ? err.message : String(err); }
    }
    host.redraw();
  }

  /** The callouts in the note as written (outermost first, in reading order), each as the reader would name it. */
  calloutsIn(m: Msg): CalloutRef[] {
    const { text, lines, points } = this.foldsIn(m), all = m.text.split("\n");
    return calloutBlocks(text.split("\n")).map(b => ({
      block: m.id, line: lines[b.line]!, header: all[lines[b.line]!] ?? "", type: b.type, fold: b.fold,
      foldKey: points.find(p => p.line === b.line && p.kind === "callout")?.key ?? null,
    }));
  }

  /**
   * The callout a person's key means when it names none (the one whose type choice is open, else the current
   * element in view), or the one `n` (from callout.list) or `line` (its header's note line, 1 the subject) names.
   */
  async calloutNamed({ n, line }: { n?: number; line?: number }, actor: Actor): Promise<CalloutRef> {
    if (n === undefined && line === undefined) {
      if (actor.kind === "agent") throw new ActionRefused("say which callout: n= (callout.list lists them) or line=");
      const P = this.picker, e = P?.kind === "callout" ? this.elems.find(x => x.key === P.key) : this.inView();
      if (e?.kind === "callout" && e.callout) return e.callout;
      throw new ActionRefused("say which callout: n= or line= (callout.list lists them), or put [ ] on a callout's icon");
    }
    const all = this.calloutsIn(await this.whole());
    const listed = () => all.slice(0, 12).map((c, i) => `${i + 1} line ${c.line + 1} [!${c.type}] ${calloutTitle(c).slice(0, 24)}`).join("; ") || "none";
    const hit = n !== undefined ? all[n - 1] : all.find(c => c.line + 1 === line);
    if (!hit) throw new ActionRefused(`no such callout in this note (${listed()})`);
    return hit;
  }

  /**
   * Change a callout's header (PIE-538): its type, or whether it starts folded (its `+`/`-`), one line rewritten
   * through the note's ordinary save (rewriteLines). Undo (ctrl+z, callout.undo) puts the line back.
   */
  changeCallout(ref: CalloutRef, change: { type?: string; fold?: "+" | "-" | null }, host: SurfaceHost, actor: Actor) {
    return this.inTurn(() => this.writeCallout(ref, change, host, actor));
  }
  private async writeCallout(ref: CalloutRef, change: { type?: string; fold?: "+" | "-" | null }, host: SurfaceHost, actor: Actor) {
    const next = rewriteCalloutHeader(ref.header, change);
    if (next === null) throw new ActionRefused("that line isn't a callout's header any more");
    const what = change.type !== undefined ? `[!${ref.type}] → [!${change.type}]` : `starts ${change.fold === "-" ? "folded" : "open"}`;
    const r = await this.rewriteLines(ref.block, next === ref.header ? [] : [{ line: ref.line, before: ref.header, after: next }], this.calloutHistory, host, actor, CALLOUT_STALE);
    if (next === ref.header) return { block: ref.block, line: ref.line + 1, changed: false, header: ref.header, revision: r.revision ?? null };
    // "Make it start folded" folds it here too; "start open" opens it.
    if (change.fold !== undefined && ref.foldKey && actor.kind === "user") { if (change.fold === "-") this.folded.add(ref.foldKey); else this.folded.delete(ref.foldKey); }
    const said = `callout ${printable(calloutTitle(ref)).slice(0, 30)}: ${what}`;
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: ref.block, line: ref.line + 1, changed: true, header: next, revision: r.revision ?? null, recordedAs: mutationFor(actor) };
  }

  /** Undo the last callout change `actor` made while reading this note: its header line back, if it still reads as left. */
  async undoCallout(host: SurfaceHost, actor: Actor) {
    const r = await this.inTurn(() => this.undoLines(this.calloutHistory, "callout", host, actor));
    return { block: r.block, line: r.edits[0]!.line + 1, header: r.edits[0]!.before, revision: r.revision, recordedAs: mutationFor(actor) };
  }

  /**
   * Lines of note `blockId` rewritten (`edits`: each line's text as it was read and what it becomes) through the
   * note's ordinary save (`update`): one change, recorded as `actor`'s, checked against the revision the service has
   * now and against each line as it was read (`stale` is said when one isn't); an agent never underneath a draft
   * someone has open on the note. Kept in `history` for undo. The callout header and the image line changes.
   */
  private async rewriteLines(blockId: string, edits: LineEdit[], history: UndoHistory<LineUndo>, host: SurfaceHost, actor: Actor, stale: Stale): Promise<Msg> {
    const board = host.ctx.board;
    const no = agentRefusal(actor, { board, blockId });
    if (no) throw new ActionRefused(no);
    // The note as the service has it now: each line must still read as drawn, and the save names this revision.
    const m = await board.get(blockId);
    if (!m) throw new ActionRefused("that note isn't there any more");
    if (m.revision === undefined) throw new ActionRefused("this note has no revision to check a change against; nothing was changed");
    const lines = m.text.split("\n");
    if (edits.some(e => lines[e.line] !== e.before)) { host.ctx.flash(stale.flash); throw new ActionRefused(stale.refused); }
    // Nothing to change (it reads that way already): checked and refused as a change would be, nothing written.
    if (!edits.length) return m;
    for (const e of edits) lines[e.line] = e.after;
    let saved: Msg;
    try { saved = await board.update(m.id, lines.join("\n"), m.revision, actor); } catch (e) {
      outlineChanged([m.id]);
      const why = `not changed: ${e instanceof EditConflict ? `the note changed elsewhere since it was read; ${stale.again}` : e instanceof Error ? e.message : String(e)}`;
      host.ctx.flash(why); host.redraw();
      throw new ActionRefused(why);
    }
    outlineChanged([m.id]);
    if (this.msg?.id === m.id) this.refresh({ ...saved, childIds: this.msg.childIds });
    history.push({ block: m.id, edits, by: partyOf(actor), context: this.msg?.id ?? m.id });
    return saved;
  }

  /** Undo the last change in `history` that `actor` made while reading this note: its lines back, if they still read as left. */
  private async undoLines(history: UndoHistory<LineUndo>, what: string, host: SurfaceHost, actor: Actor) {
    const e = this.msg ? history.last(partyOf(actor), this.msg.id) : null;
    if (!e) { const why = `no ${what} change to undo in this note`; host.ctx.flash(why); throw new ActionRefused(why); }
    const no = agentRefusal(actor, { board: host.ctx.board, blockId: e.block });
    if (no) { host.ctx.flash(no); throw new ActionRefused(no); }
    const m = (await host.ctx.board.get(e.block)) ?? { id: "", text: "", revision: undefined } as unknown as Msg, lines = m.text.split("\n");
    if (m.id !== e.block || e.edits.some(x => lines[x.line] !== x.after) || m.revision === undefined) {
      history.drop(e);
      const why = `couldn't undo: that ${what} changed again since`; host.ctx.flash(why); throw new ActionRefused(why);
    }
    for (const x of e.edits) lines[x.line] = x.before;
    let saved: Msg;
    try { saved = await host.ctx.board.update(m.id, lines.join("\n"), m.revision, actor); } catch (err) {
      outlineChanged([m.id]);
      const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`; host.ctx.flash(why); host.redraw(); throw new ActionRefused(why);
    }
    history.drop(e);
    outlineChanged([m.id]);
    if (this.msg?.id === m.id) this.refresh({ ...saved, childIds: this.msg.childIds });
    const said = `undid the ${what} change: ${printable(e.edits[0]!.before.trim()).slice(0, 40)}`;
    host.ctx.flash(said); this.noteAgent(actor, said); host.redraw();
    return { block: m.id, edits: e.edits, revision: saved.revision ?? null };
  }

  /**
   * One step change through `checklist.update`, recorded as `actor`'s (the person, or the agent by its id): a
   * status, or only the step's stable id (Copy step link, Make addressable). It's checked against the step as
   * this reader read it; a refusal writes nothing, and the step is read again. What changed is said in the
   * status bar, and an agent's in the reader's header too; nobody's `[ ]` position, scroll or selection moves
   * (the person's position follows a step that just got its id). Every reader showing the note or an embed
   * of it redraws from the change.
   */
  async changeStep(ref: StepRef, choice: StepChoice, host: SurfaceHost, actor: Actor) {
    const before = ref.step.status, title = stepTitle(ref.step);
    let r: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["changeStep"]>>;
    try {
      r = await this.stepUpdate(ref, choice, host, actor);
    } catch (e) {
      outlineChanged([ref.block]);
      const why = `not changed: ${e instanceof Error ? e.message : String(e)}${e instanceof Refused ? " · the step is read again" : ""}`;
      host.ctx.flash(why);
      host.redraw();
      throw new ActionRefused(why);
    }
    // The change is known now: every kept read of the note takes it at once (the re-read confirms it), so
    // the step stays offered, with its new evidence, wherever it's drawn.
    stepChanged(host.ctx.board, ref.block, ref.step, r.item, r.block.revision);
    embedStepChanged(host.ctx.board, r.block, ref.step, r.item);
    outlineChanged([ref.block]);
    if (this.msg?.id === ref.block && !this.msg.partial) this.refresh({ ...r.block, childIds: this.msg.childIds });
    const was = taskBase(ref), now = taskBase({ ...ref, step: r.item });
    if (was !== now) this.stepRenamed = { was, now };
    const where = ref.via ? ` · in ${ref.via}` : "";
    let said: string, link: string | undefined;
    if (choice === "copy-link" || choice === "address") {
      link = stepLink(ref.block, r.item.itemId!);
      if (choice === "copy-link" && actor.kind === "user") host.ctx.copy?.(link);
      said = choice === "copy-link" && actor.kind === "user" ? `copied ${link} · "${title}"` : `made "${title}" addressable: ${link}`;
    } else {
      if (r.changed && before !== choice) this.stepHistory.push({ block: ref.block, itemId: r.item.itemId!, evidence: r.item.evidence, status: before, to: choice, title, by: partyOf(actor), context: this.msg?.id ?? ref.block });
      said = r.changed ? `set "${title}" ${statusWord(before)} → ${statusWord(choice)}${where}` : `"${title}" is already ${statusWord(choice)}`;
    }
    // An agent's host says who it is (asActor); the person's says it plainly.
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: ref.block, step: r.item.itemId ?? null, status: r.item.status, from: before, changed: r.changed, revision: r.block.revision ?? null, ...(link ? { link } : {}), recordedAs: mutationFor(actor) };
  }

  /**
   * `checklist.update` for a step as drawn. A step without an id is addressed by where it starts in the
   * revision it was read at; if the note has moved on since (an embed redrawn a moment late), the step is
   * looked up again and addressed afresh only when exactly one step in the note now has the same evidence
   * (the same text). Otherwise the refusal stands: nothing is guessed.
   */
  private async stepUpdate(ref: StepRef, choice: StepChoice, host: SurfaceHost, actor: Actor) {
    const board = host.ctx.board;
    // Never underneath a draft someone has open on that note (the draft session's agent rule).
    const no = agentRefusal(actor, { board, blockId: ref.block });
    if (no) throw new ActionRefused(no);
    try {
      return await board.changeStep(ref.block, ref.step, ref.revision, changeOf(choice), actor);
    } catch (e) {
      if (!(e instanceof Refused) || ref.step.identity === "unique" || !/location changed/i.test(e.message)) throw e;
      const now = await board.checklist(ref.block, 1000);
      const same = now.items.filter(i => i.evidence === ref.step.evidence);
      if (same.length !== 1) throw e;
      return board.changeStep(ref.block, same[0]!, now.revision, changeOf(choice), actor);
    }
  }

  /**
   * Undo (ctrl+z, `task.undo`): the last status change `actor` made in this reader while reading this note,
   * back to what it was, by the step's id and the evidence it had after the change. Refused (and forgotten)
   * when the step changed again since, as Detail's is.
   */
  async undoStep(host: SurfaceHost, actor: Actor) {
    const context = this.msg?.id;
    const e = context ? this.stepHistory.last(partyOf(actor), context) : null;
    if (!e) {
      const why = "no step change to undo in this note";
      host.ctx.flash(why);
      throw new ActionRefused(why);
    }
    // Never underneath a draft someone has open on that note (the draft session's agent rule).
    const no = agentRefusal(actor, { board: host.ctx.board, blockId: e.block });
    if (no) { host.ctx.flash(no); throw new ActionRefused(no); }
    const step: ChecklistStep = { itemId: e.itemId, identity: "unique", status: e.to, evidence: e.evidence, span: { start: 0, end: 0, startLine: 0, endLine: 0 }, depth: 0, text: e.title };
    let r: Awaited<ReturnType<SurfaceHost["ctx"]["board"]["changeStep"]>>;
    try {
      r = await host.ctx.board.changeStep(e.block, step, 0, { kind: "status", status: e.status }, actor);
    } catch (err) {
      if (err instanceof Refused) this.stepHistory.drop(e);
      outlineChanged([e.block]);
      const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`;
      host.ctx.flash(why);
      host.redraw();
      throw new ActionRefused(why);
    }
    this.stepHistory.drop(e);
    stepChanged(host.ctx.board, e.block, step, r.item, r.block.revision);
    embedStepChanged(host.ctx.board, r.block, step, r.item);
    outlineChanged([e.block]);
    if (this.msg?.id === e.block && !this.msg.partial) this.refresh({ ...r.block, childIds: this.msg.childIds });
    const said = `undid: "${e.title}" ${statusWord(e.to)} → ${statusWord(e.status)}`;
    // An agent's host says who it is (asActor); the person's says it plainly.
    host.ctx.flash(said);
    this.noteAgent(actor, said);
    host.redraw();
    return { block: e.block, step: e.itemId, status: r.item.status, from: e.to, revision: r.block.revision ?? null, recordedAs: mutationFor(actor) };
  }

  /** The steps this reader draws, in reading order, as `tasks` lists them. */
  describeSteps() {
    return this.elems.filter(e => e.kind === "task" && e.task).map((e, i) => {
      const t = e.task!;
      return { n: i + 1, id: t.step.itemId ?? null, block: t.block, in: t.via ?? "this note", status: t.step.status, text: printable(stepTitle(t.step)), line: t.step.span.startLine + 1, current: e.key === this.cur };
    });
  }

  /** The step `n` (from `tasks`) or `id` (`t-8a6d7f`, `^t-8a6d7f`, `<block>^t-8a6d7f`; `block` narrows it) names among those drawn. */
  /**
   * The step a person's key or click means when it names none: the one whose status choice is open, else the
   * step that is the current element in view. Null for an agent's, or when a step is named (stepNamed then).
   */
  stepFor(which: { n?: number; id?: string }, actor: Actor): Element | null {
    if (which.n !== undefined || which.id !== undefined || actor.kind === "agent") return null;
    const P = this.picker;
    const e = P ? this.elems.find(x => x.key === P.key) : this.inView();
    if (e?.kind === "task" && e.task) return e;
    throw new ActionRefused("say which step: n= or id= (tasks lists them), or put [ ] on a step");
  }

  stepNamed({ n, id, block }: { n?: number; id?: string; block?: string }): Element {
    this.requireDrawn();
    const all = this.elems.filter(e => e.kind === "task" && e.task);
    const list = () => this.describeSteps().slice(0, 12).map(t => `${t.n} ${t.id ?? "(no id)"} ${STEP_MARKS[t.status]} ${t.text.slice(0, 30)}`).join("; ");
    if (!all.length) throw new ActionRefused("this reader draws no checklist steps (in the note or its embeds)");
    if ((n === undefined) === (id === undefined)) throw new ActionRefused(`say which step: n= or id= (tasks lists them: ${list()})`);
    if (n !== undefined) {
      const e = all[n - 1];
      if (!e) throw new ActionRefused(`there is no step ${n}; this reader draws ${all.length} (${list()})`);
      return e;
    }
    let want = id!.trim(), inBlock = block;
    // `((id^step))` as a reference writes it, `id^step`, or `^step`.
    const ref = referencedBlock(want), hat = want.lastIndexOf("^");
    if (ref?.fragment) { inBlock = ref.blockId; want = ref.fragment; }
    else if (hat > 0) { inBlock = want.slice(0, hat); want = want.slice(hat + 1); }
    want = want.replace(/^\^/, "");
    const hits = all.filter(e => e.task!.step.itemId === want && (!inBlock || sameId(inBlock, e.task!.block)));
    if (!hits.length) throw new ActionRefused(`no step ^${want}${inBlock ? ` in ${inBlock}` : ""} is drawn in this reader (${list()})`);
    if (new Set(hits.map(e => e.task!.block)).size > 1) throw new ActionRefused(`^${want} names steps in ${new Set(hits.map(e => e.task!.block)).size} notes; pass block=`);
    return hits[0]!;
  }

  /**
   * The rows of the open status choice, put in under its step (after the item's rows in the note; under the
   * box's row in an embed), and where each choice landed. The step is found by its element key, counted as
   * elementsOf counts it.
   */
  private pickerRows(doc: Doc, drawn: Link[], W: number): { doc: Doc; picks: { at: number; lines: number; rows: number[] } | null } {
    const P = this.picker;
    if (!P) return { doc, picks: null };
    const seen = new Map<string, number>(), first = new Map<number, number>();
    for (const r of doc.links) if (!first.has(r.n)) first.set(r.n, r.line);
    let hit: { line: number; ref?: StepRef; callout?: CalloutRef } | null = null;
    for (const [n, line] of first) {
      const l = drawn[n];
      const base = l?.role === "task" && l.task ? taskBase(l.task) : l?.role === "callout" && l.callout ? calloutBase(l.callout) : null;
      if (!base) continue;
      const k = seen.get(base) ?? 0;
      seen.set(base, k + 1);
      if (`${base}#${k}` === P.key) { hit = { line, ref: l!.task, callout: l!.callout }; break; }
    }
    if (!hit) return { doc, picks: null };
    let at = hit.line + 1;
    // A step's choice goes under its item; a callout's right under its top edge.
    if (hit.ref && !hit.ref.via) while (at < doc.source.length && doc.source[at] === doc.source[hit.line]) at++;
    const { lines, rows } = hit.callout ? calloutPanel(hit.callout, P, W) : pickerPanel(hit.ref!, P.list.sel, P.note, P.busy, W);
    const { doc: out } = withRows(doc, [{ at, lines }]);
    return { doc: out, picks: { at, lines: lines.length, rows: rows.map(r => at + r) } };
  }

  /**
   * A followed `((id^fragment))` (PIE-425): the service says where the fragment is (`fragments.read`); what
   * folds hide it unfolds, and it's scrolled to the top and marked in the reading ruler's tint until esc or
   * the reader moves on. Missing and duplicate fragments are said.
   */
  async revealFragment(fragment: string, host: SurfaceHost, by: Actor = USER) {
    const m = this.msg;
    if (!m) return;
    // A scroll made while the fragment is looked up is the reader's own: it isn't undone.
    const from = this.scroll;
    const read = await host.ctx.board.readFragment(m.id, fragment).catch((e: Error) => ({ error: e.message }));
    let now: Msg;
    try { now = await this.whole(); } catch { return; }
    if (now.id !== m.id) return;
    const name = `${subject(m).slice(0, 40)} ^${fragment}`;
    if ("error" in read) { host.ctx.flash(`${name}: ${read.error}`); return; }
    if (read.status === "missing") { host.ctx.flash(`${name} · Missing fragment: no ^${fragment} in the note now`); return; }
    if (read.status === "duplicate") { host.ctx.flash(`${name} · Duplicate fragment: ^${fragment} is on ${read.duplicates.length} lines (${read.duplicates.map(d => d.line + 1).join(", ")})`); return; }
    const { startLine, endLine } = read.fragment;
    const { points, lines } = this.foldsIn(now);
    const at = lines.indexOf(startLine);
    for (const p of points) if (this.folded.has(p.key) && at >= 0 && p.line < at && at < p.end) this.folded.delete(p.key);
    this.focusMark = { by, spec: { line: startLine + 1, to: endLine + 1 }, label: `^${fragment}`, at: Date.now(), fragment: true };
    this.revealMark = this.scroll === from;
    host.redraw();
  }

  // ── back and forward (PIE-453) ─────────────────────────────────────────────

  /** Where the reader is now, as back would come back to it. */
  private place(): Place | null {
    const m = this.msg;
    return m ? { msg: m, scroll: this.scroll, cur: this.cur, link: this.link, folded: [...this.folded], expanded: [...this.expanded], seen: [...this.foldSeen], figures: [...this.figureUI] } : null;
  }

  /**
   * Run a navigation (a followed link, `u`, or a host opening a note into this reader on purpose: an agent's
   * `open`, a card's ⏎ into a detail) so that, when it leaves this reader on another note, back comes here.
   * A reader following a selection (the board's preview, a desk reader following the current note) isn't
   * navigating, so the host shows it without this.
   */
  track<T>(open: () => T): T {
    const from = this.place();
    // A navigation inside a navigation (a host's open reached from a follow) is recorded once, by the outer one.
    const outer = this.tracking++ === 0;
    let out: T;
    try { out = open(); } finally { this.tracking--; }
    if (outer && from && this.msg && this.msg.id !== from.msg.id) {
      this.backs.push(from);
      if (this.backs.length > HISTORY) this.backs.shift();
      this.aheads = [];
    }
    return out;
  }

  /** The title back (-1) or forward (1) would show, or null. */
  peek(dir: -1 | 1): string | null {
    if (this.kept) return this.kept.peek(dir);
    const p = (dir < 0 ? this.backs : this.aheads).at(-1);
    return p ? subject(p.msg) : null;
  }

  /**
   * Back (-1) or forward (1): this reader shows the note it showed there, re-read, scrolled and with its `[ ]`
   * position, folds and expanded threads as they were, so ⏎ and alt+⏎ act on the same element at once. Only
   * this reader moves (in place, not through the host's navigate: nothing else follows it). Where the view
   * keeps the history (SurfaceHost.history), the view goes. Null when it went, else why not.
   */
  async travel(dir: -1 | 1, host: SurfaceHost): Promise<string | null> {
    this.use(host);
    if (host.history) return host.history.go(dir);
    const stack = dir < 0 ? this.backs : this.aheads, to = stack.at(-1);
    if (!to) return dir < 0 ? "nothing to go back to: this reader hasn't followed a link here" : "nothing ahead: go back first";
    const holding = this.modes.holding();
    if (holding) return `finish ${holding} first · ctrl+s saves · esc closes`;
    const fresh = await host.ctx.board.get(to.msg.id).catch(() => null);
    if (stack.at(-1) !== to) return "the reader moved meanwhile";
    const here = this.place();
    if (!this.show(fresh ?? to.msg, host)) return "the reader is holding an edit or a comment";
    stack.pop();
    if (here) (dir < 0 ? this.aheads : this.backs).push(here);
    this.scroll = to.scroll; this.cur = to.cur; this.link = to.link;
    this.folded = new Set(to.folded); this.expanded = new Set(to.expanded); this.foldSeen = new Set(to.seen); this.figureUI = new Map(to.figures);
    // The element comes into view if the history row now under the note would hide it (only that far).
    this.reveal = to.cur !== null;
    host.redraw();
    return null;
  }

  /** The history as `peek` shows it: the titles back and forward go to, nearest first. */
  describeHistory() {
    if (this.kept) return { back: [this.kept.peek(-1)].filter(Boolean), forward: [this.kept.peek(1)].filter(Boolean), keptBy: "view" };
    const titles = (ps: Place[]) => ps.map(p => ({ id: p.msg.id, title: subject(p.msg) })).reverse();
    return { back: titles(this.backs), forward: titles(this.aheads) };
  }

  // ── selecting text (PIE-419) ───────────────────────────────────────────────

  /** The last render's rows, by content row: the header's (its rule isn't text), then the body's (margin left out). */
  private selRows(): SelectRows | null {
    const d = this.drawn;
    if (!d) return null;
    const cache = new Map<number, string[]>();
    return {
      count: d.top + d.body.length,
      cells: r => {
        let c = cache.get(r);
        if (!c) cache.set(r, c = r === d.top - 1 || r < 0 ? [] : cellsOf((r < d.top ? d.head[r] : d.body[r - d.top]) ?? ""));
        return c;
      },
      // A shaded region's gutter (an embed's, a resource projection's) is drawn like the margin, and isn't copied.
      margin: r => (r < d.top ? 0 : d.body[r - d.top]?.startsWith(" " + SHADE) ? 2 : 1),
    };
  }

  /**
   * The content cell under `x`, `y` of the last render, or null outside it. `edge` (a drag): past the
   * body's bottom or top the note scrolls a row and the selection follows it to the edge.
   */
  private posAt(x: number, y: number, edge = false): Pos | null {
    const d = this.drawn;
    if (!d) return null;
    // The note's rows start under its header image.
    y -= d.heroRows;
    const col = Math.max(0, Math.min(d.w - 1, x));
    if (!edge && (x < 0 || x >= d.w || y < 0 || y >= d.top + d.room)) return null;
    const body = (row: number) => ({ row: d.top + this.scroll + row, col });
    if (y >= d.top + d.room) {
      if (this.scroll < this.maxScroll) this.scroll++;
      return d.room > 0 ? body(d.room - 1) : null;
    }
    if (y < d.top && edge && this.scroll > 0 && this.selection && this.selection.anchor.row >= d.top) {
      this.scroll--;
      return body(0);
    }
    if (y < d.top) return { row: Math.max(0, y), col };
    return body(y - d.top);
  }

  private stamp(s: Selection): Selection { s.w = this.drawn?.w ?? 0; s.top = this.drawn?.top ?? 0; return s; }

  renderedWidth() { return this.drawn?.w ?? 0; }
  renderedTop() { return this.drawn?.top ?? 0; }

  clearSelections() { this.selection = null; this.agentSelection = null; this.gesture.cancel(); this.dragging = false; }

  /** The last press placed the cursor in a draft the person opened here (not an agent's): a click that enters it. */
  get pressedIntoOwn(): boolean { const w = this.editing ? this.drafting ?? this.session?.writing : null; return this.editPress && !!w && w.openedBy.kind === "user"; }

  /**
   * The mouse button went down at `x`, `y`. Nothing happens yet (release decides: a click, or a drag that
   * selected), except a second or third press on the same cell: it selects the word, then the row.
   */
  press(x: number, y: number, host: SurfaceHost): void {
    this.use(host);
    this.dragging = false;
    const n = this.gesture.press(x, y);
    // In a draft a press puts the cursor there, and a drag from it selects (Draft's own selection).
    if (this.editing) { this.editPress = this.modes.press(x, y, host, false); if (this.editPress) host.redraw(); return; }
    if (n < 2) return;
    const rows = this.selRows(), p = this.posAt(x, y);
    if (!rows || !p || !rows.cells(p.row).length) return;
    this.selection = this.stamp(n === 2 ? wordAt(rows, p) : lineAt(rows, p.row));
    host.redraw();
  }

  /** The pointer moved with the button down: once off the pressed cell, it selects from there. */
  drag(x: number, y: number, host: SurfaceHost): void {
    const g = this.gesture.pressed;
    if (this.editing) { if (this.editPress && this.modes.press(x, y, host, true)) host.redraw(); return; }
    if (!g || !this.gesture.drag(x, y) || !this.drawn) return;
    if (!this.dragging) {
      // After a double or triple click, the drag extends from the word or row it selected.
      const from = g.n > 1 && this.selection ? this.selection.start : this.posAt(g.x, g.y);
      if (!from) { this.gesture.cancel(); return; }
      this.dragging = true;
      this.selection = this.stamp(new Selection({ ...from }, { ...from }));
    }
    const at = this.posAt(x, y, true);
    if (at && this.selection) this.selection.head = at;
    host.redraw();
  }

  /**
   * The button came up. On the cell it went down on, with no drag, it's a click (`click`: a link, a fold, a
   * panel row, the copy control; anywhere else it lets go of the selection). A drag, a double or a triple
   * click keeps what it selected and copies it (copy on select, selection.ts): `select.copy`, as `y` runs
   * it. A selection of blanks, or none, copies nothing. True when the release did something.
   */
  release(x: number, y: number, host: SurfaceHost): boolean {
    const r = this.gesture.release(x, y);
    this.dragging = false;
    if (r.click) {
      // A click that did something (a link, a fold, a panel row) isn't the first half of a double click.
      const acted = this.click(x, y, host);
      if (acted) this.gesture.forget();
      return acted;
    }
    // Not in a draft: a drag there is the draft's own selection, which typing or a paste replaces (cmd+c copies it).
    const s = this.selection, rows = s && !this.editing && r.copy ? this.selRows() : null;
    if (s && rows && s.text(rows).trim()) void this.runKey("select.copy", {}, host);
    host.redraw();
    return r.moved || r.n > 1;
  }

  /** The selection's line in the header: how much is selected, and the copy control. */
  private selectionControl(w: number) {
    const d = this.drawn!;
    // Another width rewraps the body: the selection would point at other text, so it goes. A header that
    // grew or shrank (a notice, an agent's line, the inline panel: all drawn just above the rule) moves
    // the rule and the body; a selection's ends there move with them, and ends on the title, summary,
    // byline or crumbs stay. So an agent's action never takes the person's selection away.
    const keep = (s: Selection | undefined): boolean => {
      if (!s) return true;
      if (s.w !== w) return false;
      const by = d.top - s.top;
      if (by) {
        const move = (p: Pos): Pos => (p.row >= s.top - 1 ? { ...p, row: p.row + by } : p);
        s.anchor = move(s.anchor); s.head = move(s.head); s.top = d.top;
      }
      return true;
    };
    if (!keep(this.selection ?? undefined)) this.selection = null;
    if (!keep(this.agentSelection?.sel)) this.agentSelection = null;
    const s = this.selection, rows = s && this.selRows();
    if (!s || !rows || d.top < 1) return;
    const n = [...s.text(rows)].length, copy = "[y copy]", source = "[Y source]";
    const lead = `── ${n} chars `;
    const at = d.top - 1, wide = lead.length + copy.length + 1 + source.length <= w, fits = lead.length + copy.length <= w;
    const from = fits ? lead.length : 0;
    if (copy.length > w) return;
    this.hits.push({ row: at, from, to: from + copy.length, copy: "visible" });
    if (wide) this.hits.push({ row: at, from: from + copy.length + 1, to: from + copy.length + 1 + source.length, copy: "source" });
    const shown = (fits ? fg(C.blue) + "── " + fg(C.white) + `${n} chars ` : "") + fg(C.lcyan) + copy + (wide ? " " + source : "");
    d.head[at] = pad(shown + fg(C.blue) + "─".repeat(Math.max(0, w - width(shown))), w) + RESET;
  }

  /** Row `row`'s drawn line with the selections on it painted: an agent's, then the person's over it. */
  private paintSelection(line: string, row: number): string {
    // The body's margin cell is never copied, so it isn't tinted either.
    const m = this.drawn && row >= this.drawn.top ? 1 : 0;
    const a = this.agentSelection?.sel.span(row), p = this.selection?.span(row);
    if (a) line = paintRange(line, Math.max(m, a[0]), a[1], AGENT_BG);
    if (p) line = paintRange(line, Math.max(m, p[0]), p[1], SELECT_BG);
    return line;
  }

  /**
   * `v`, `y`, `Y`, and while there's a selection esc (and in the keyboard mode its movement keys). True
   * when the key was the selection's; the reader's other keys keep their meaning.
   */
  private selectKey(k: Key, host: SurfaceHost): boolean {
    // cmd+c is y: the same copy.
    const c = isCopyKey(k) ? "y" : ch(k), rows = this.selRows(), s = this.selection;
    if (!rows) return false;
    if (!s) {
      // y on a resource projection (the current element) selects its region and copies it as drawn.
      const e = c === "y" ? this.inView() : null;
      if (e?.kind === "resource") {
        const last = e.ruler[1] - 1;
        this.selection = this.stamp(new Selection({ row: e.ruler[0], col: rows.margin?.(e.ruler[0]) ?? 0 }, { row: last, col: Math.max(0, rows.cells(last).length - 1) }));
        void this.runKey("select.copy", {}, host);
        return true;
      }
      if (c === "y" || c === "Y") { host.ctx.flash("nothing is selected · drag across the text, or v and move"); return true; }
      if (c !== "v") return false;
      void this.runKey("select.mode", {}, host);
      return true;
    }
    if (c === "y" || c === "Y") { void this.runKey("select.copy", c === "Y" ? { source: true } : {}, host); return true; }
    if (!s.keys) {
      if (c === "v") { void this.runKey("select.mode", {}, host); return true; }
      if (k.kind === "esc") { void this.runKey("select.clear", {}, host); return true; }
      return false;
    }
    const d = this.drawn!;
    const r = modeKey(k, s, rows, Math.max(1, d.room - 1));
    if (r === null) return false;
    if (r === "done") { void this.runKey("select.clear", {}, host); return true; }
    else {
      // Keep the moving end in view.
      const b = s.head.row - d.top;
      if (b >= 0 && d.room > 0) { if (b < this.scroll) this.scroll = b; else if (b >= this.scroll + d.room) this.scroll = b - d.room + 1; }
    }
    host.redraw();
    return true;
  }

  /**
   * `v`: select by keys (h j k l, w b, …) from where the reading is (the first row of the body in view), or
   * switch a selection made with the mouse to the keys. False when nothing is drawn to select.
   */
  selectByKeys(): boolean {
    const rows = this.selRows(), d = this.drawn;
    if (!rows || !d) return false;
    if (this.selection) { this.selection.keys = true; return true; }
    const row = d.room > 0 && d.body.length ? d.top + this.scroll : 0;
    const at = { row, col: rows.margin?.(row) ?? 0 };
    this.selection = this.stamp(new Selection({ ...at }, { ...at }, true));
    this.letGo();
    return true;
  }

  /**
   * The note's own text behind a selection: exactly the selected words when they read the same in the
   * source (no link or formatting inside), else the whole source lines it covers. Offsets are into the
   * note's text, as the comment passage picker takes them. Null when only the header's details are selected.
   */
  sourceOf(s: Selection): { text: string; exact: boolean; from: number; to: number; lines: [number, number] } | null {
    const d = this.drawn, m = this.msg, rows = this.selRows();
    if (!d || !m || !rows) return null;
    const lines: number[] = [];
    for (let r = s.start.row; r <= s.end.row; r++) {
      if (r === 0) lines.push(Math.max(0, titleLine(m.text).line));   // the subject line
      else if (r >= d.top) { const b = d.doc.source[r - d.top], l = b === undefined ? undefined : d.lines[b]; if (l !== undefined) lines.push(l); }
    }
    if (!lines.length) return null;
    const lo = Math.min(...lines), hi = Math.max(...lines), all = m.text.split("\n");
    const start = all.slice(0, lo).reduce((n, l) => n + l.length + 1, 0);
    const span = all.slice(lo, hi + 1).join("\n");
    const seen = s.text(rows);
    // A wrapped paragraph reads with a space where the reader broke it.
    for (const t of [seen, seen.replace(/\n/g, " ")]) {
      const at = t.trim() ? span.indexOf(t) : -1;
      if (at >= 0) return { text: t, exact: true, from: start + at, to: start + at + t.length, lines: [lo, hi] };
    }
    const lead = span.length - span.trimStart().length;
    return { text: span, exact: false, from: start + lead, to: start + span.trimEnd().length, lines: [lo, hi] };
  }

  /** `y` (what's drawn) or `Y` (its source) to the person's clipboard, said in the status bar. */
  copySelection(source: boolean, host: SurfaceHost): { text: string; chars: number; exact?: boolean; lines?: [number, number] } | null {
    const s = this.selection, rows = this.selRows();
    if (!s || !rows) return null;
    let text = s.text(rows), said = "";
    let src: ReturnType<NoteSurface["sourceOf"]> = null;
    if (source) {
      src = this.sourceOf(s);
      if (!src) { host.ctx.flash("no source to copy: only the header's details are selected · y copies them"); return null; }
      text = src.text;
      said = src.exact ? " of source" : ` of source · whole line${src.lines[0] === src.lines[1] ? ` ${src.lines[0] + 1}` : `s ${src.lines[0] + 1}–${src.lines[1] + 1}`}`;
    }
    if (!text.trim()) { host.ctx.flash("nothing to copy: only blanks are selected"); return null; }
    const chars = [...text].length;
    // Over COPY_MAX nothing is copied: App.copy's toast says why, and the action is refused.
    if (host.ctx.copy?.(text) === false) throw new ActionRefused(`not copied: ${chars} chars is more than the clipboard takes`);
    host.ctx.flash(`copied ${chars} chars${said}`);
    return { text, chars, ...(src ? { exact: src.exact, lines: [src.lines[0] + 1, src.lines[1] + 1] as [number, number] } : {}) };
  }

  /**
   * A selection made by name, for `select`: `text` (as it's drawn, blanks and row breaks alike; `n` picks
   * the nth time it's drawn) or note lines `line` to `to` (1 is the subject). The whole drawn note, not
   * just the rows in view.
   */
  selectBy({ text, line, to, n }: { text?: string; line?: number; to?: number; n?: number }): Selection {
    const d = this.drawn, rows = this.selRows();
    if (!d || !rows || !this.msg) throw new ActionRefused("this reader doesn't show the note's text now (it's editing, commenting, reading the note, or the full property panel is open)");
    if ((text === undefined) === (line === undefined)) throw new ActionRefused("say what to select: text= (as the note reads) or line= (with to= for a range; 1 is the subject)");
    if (text !== undefined) {
      if (!text.trim()) throw new ActionRefused("text is empty");
      // The drawn rows as one text, remembering where each row starts.
      const starts: number[] = [];
      let flat = "";
      for (let r = 0; r < rows.count; r++) {
        starts.push(flat.length);
        flat += rows.cells(r).slice(rows.margin?.(r) ?? 0).join("").trimEnd() + "\n";
      }
      const re = new RegExp(text.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
      const hits = [...flat.matchAll(re)];
      const hit = hits[(n ?? 1) - 1];
      if (!hit) throw new ActionRefused(hits.length ? `it's drawn ${hits.length} time${hits.length === 1 ? "" : "s"}; n is 1 to ${hits.length}` : `"${ellipsize(text, 40)}" isn't drawn in this reader (links read as their titles; folded sections aren't drawn)`);
      const at = (off: number): Pos => {
        const row = starts.findLastIndex(s => s <= off);
        return { row, col: (rows.margin?.(row) ?? 0) + off - starts[row]! };
      };
      return new Selection(at(hit.index!), at(hit.index! + hit[0].length - 1));
    }
    const lo = line! - 1, hi = (to ?? line!) - 1;
    if (lo < 0 || hi < lo) throw new ActionRefused("line is from 1 (the subject), and to isn't before it");
    const hitRows: number[] = [];
    if (lo === 0) hitRows.push(0);
    d.doc.source.forEach((b, i) => { const l = d.lines[b]; if (l !== undefined && l >= lo && l <= hi) hitRows.push(d.top + i); });
    if (!hitRows.length) throw new ActionRefused(`nothing of lines ${line}${to ? `–${to}` : ""} is drawn (past the end, only properties, or folded)`);
    const first = hitRows[0]!, last = hitRows.at(-1)!;
    return new Selection({ row: first, col: rows.margin?.(first) ?? 0 }, lineAt(rows, last).end);
  }

  /** What a selection holds, for `peek` and the select actions. */
  describeSelection(s: Selection | null | undefined) {
    const rows = this.selRows();
    if (!s || !rows) return null;
    const text = s.text(rows), src = this.sourceOf(s);
    return { chars: [...text].length, text, keys: s.keys, ...(src ? { source: src.text, sourceExact: src.exact, lines: [src.lines[0] + 1, src.lines[1] + 1] } : {}) };
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /**
   * Run a named action as `actor`, on this reader alone (its own dispatcher, `alone`): a caller with a screen around
   * the reader goes through that screen's dispatcher instead. Keys run the same code; what an agent adds is the
   * actor rule (a refusal says why, nothing is half-done), waiting for the write to land, and saying on screen that it did it.
   */
  act(name: string, args: Record<string, unknown>, host: SurfaceHost, actor: Actor): Promise<unknown> {
    return this.alone(host).act({ action: name, args }, actor);
  }

  /**
   * The note actions' adapter on this reader, for a dispatcher that registered them (a screen's, or the reader's own):
   * the reader's own modes keep their rule (the property panel), and an agent's run gets a host that says who acts.
   * The actor rule is the dispatcher's, checked before this.
   */
  run(name: string, args: Record<string, unknown>, host: SurfaceHost, actor: Actor, typed = false): Promise<unknown> {
    this.use(host);
    // The property panel is the person's (only their `i` opens it); an agent doesn't start an edit or a
    // comment under it, where the panel would take the keys meant for the agent's session (the mode stack's own rule).
    if (actor.kind === "agent" && this.sessionMode()?.name === "panel" && STARTS_SESSION.has(name))
      return Promise.reject(new ActionRefused("the person has the property panel open on this note; try again once they close it"));
    const h: SurfaceHost = actor.kind === "agent" ? { ...host, ctx: asActor(host.ctx, actor), redraw: () => host.redraw(), navigate: (m, how) => host.navigate(m, { ...how, by: actor }), startSession: undefined, actor } : host;
    try { return Promise.resolve(typed ? NOTE_ACTIONS.run(name as never, args as never, { surface: this, host: h }, actor) : NOTE_ACTIONS.runUntyped(name, args, { surface: this, host: h }, actor)); }
    catch (e) { return Promise.reject(e); }
  }

  /**
   * The person's key that starts an edit, a comment or the property panel (e, ctrl+e, C, m, i, I), as the note
   * action it is (PIE-510), with `still` the host's say once the note is read. A refusal rejects, for the host
   * to say or let go (one the action said already, or the person moved on).
   */
  startAsPerson(kind: SessionKind, host: SurfaceHost, still?: () => boolean): Promise<unknown> {
    const a = SESSION_ACTIONS[kind];
    return this.act(a.name, a.args, still ? { ...host, still } : host, USER);
  }

  /** What the surface is doing, for `peek`. */
  describe() {
    return {
      showing: this.msg ? { id: this.msg.id, title: subject(this.msg), revision: this.msg.revision } : null,
      editing: (this.modes.get("draft") as DraftMode | null)?.describe(),
      commenting: (this.modes.get("comment") as CommentMode | null)?.describe(),
      comments: this.comments ? { open: this.comments.filter(c => c.open).length, total: this.comments.length, threads: this.comments.map(c => ({ id: c.id, open: c.open, author: c.author, quote: c.quote, replies: c.replies.length, expanded: this.expanded.has(c.id) })) } : null,
      links: this.links.map((l, i) => ({ n: i + 1, ...l, reads: printable(linkText(l, this.msg?.text ?? "", this.src)), selected: i === this.link })),
      summary: this.msg ? (({ keys, source, text }) => ({ keys, source, text }))(this.summary(this.msg)) : null,
      folds: this.msg && !this.msg.partial ? this.describeFolds(this.msg) : null,
      elements: this.drawn || this.digesting ? { count: this.elems.length, current: this.describeElements().find(e => e.current) ?? null } : null,
      focus: this.focusMark ? { by: whoOf(this.focusMark.by), marked: this.focusMark.label, ...this.focusMark.spec } : null,
      properties: (this.modes.get("panel") as PanelMode | null)?.describe() ?? null,
      selection: this.describeSelection(this.selection),
      agentSelection: this.agentSelection ? { id: this.agentSelection.id, ...this.describeSelection(this.agentSelection.sel) } : null,
      history: this.describeHistory(),
      steps: this.drawn || this.digesting ? { drawn: this.elems.filter(e => e.kind === "task").length, undo: this.stepHistory.size, choosing: (this.modes.get("picker") as PickerMode | null)?.describe() ?? null } : null,
      agent: this.agent,
      header: this.headerBackdrop(),
    };
  }

  /** What the header's backdrop drew last (PIE-598: its image, note line, step, kitty or cells) and whether it's on. */
  headerBackdrop() { return { backdrop: this.backdropShown, on: heroHeaderOn(), mode: heroHeaderMode() }; }

  // Used by the actions below: each wraps the key path with the checks an agent needs.

  /**
   * Say in the surface what an agent just did (the flash says it too, but goes away). `draft`: it was done to
   * the draft being written, so the words go (or are put in the past) when that draft closes.
   */
  noteAgent(actor: Actor, did: string, draft?: Draft) {
    if (actor.kind !== "agent") return;
    this.agent = { id: actor.id, did, at: Date.now() };
    this.agentDraft = draft ?? null;
  }

  /** The whole note this reader shows, waiting a moment when only its list row has arrived. */
  async whole(ms = 5000): Promise<Msg> {
    const m = this.requireNote();
    for (const end = Date.now() + ms; this.msg?.id === m.id && this.msg.partial && !this.unread && Date.now() < end;) await Bun.sleep(25);
    const now = this.msg;
    if (!now || now.id !== m.id) throw new ActionRefused("the reader moved to another note");
    if (now.partial) throw new ActionRefused(this.unread ? `the note couldn't be read: ${this.unread}` : "the whole note isn't read yet; try again in a moment");
    return now;
  }

  /** The open proposal (PIE-501) whose embed or `[apply]` `[dismiss]` control is the current element while it's in view, if one is. */
  currentProposal(): string | undefined {
    return this.inView()?.link?.proposal?.id;
  }

  /** The keys a proposal's element offers, for the hint: `X` alone when it can't be applied (it was drawn with no `[apply]`). */
  /** Notes whose old unsent edits the person unfolded ([show] on "■ 1 old unsent edit"). */
  private oldUnsentShown = new Set<string>();
  /** Unfold the old unsent edits on note `of` (`unsent.show`). */
  showOldUnsent(of: string) { this.oldUnsentShown.add(of); }

  /**
   * The `■ unsent` lines for note `m` (or, in a view of what's put aside, for the note it's about), each with its
   * controls as elements and click targets from header row `row`. Old edits put aside on an older revision fold into
   * one dim line until [show].
   */
  private unsentHead(m: Msg, w: number, row: number): { lines: string[]; elems: Element[] } {
    const view = unsentView(m.id), of = view?.of ?? m.id;
    const all = unsentEntries(of, m.revision, whenPut);
    const folded = this.oldUnsentShown.has(of) ? [] : all.filter(e => e.old), shown = all.filter(e => !folded.includes(e));
    const tags: Link[] = [];
    const mine = (ops: UnsentOp[]) => ops.filter(op => op !== view?.view);
    const control = (kind: UnsentKind, op: UnsentOp) => " " + fg(C.lcyan) + tagged(tags, { block: of, role: "control", unsent: { of, kind, op } }, UNSENT_LABEL[op]);
    const controls = (kind: UnsentKind, ops: UnsentOp[]) => mine(ops).map(op => control(kind, op)).join("");
    /** The controls on rows of their own, as many to a row as fit. */
    const controlRows = (kind: UnsentKind, ops: UnsentOp[]) => mine(ops).reduce<UnsentOp[][]>((rows, op) => {
      const last = rows.at(-1);
      if (last && last.reduce((n, o) => n + UNSENT_LABEL[o].length + 1, 0) + UNSENT_LABEL[op].length + 1 <= w) last.push(op); else rows.push([op]);
      return rows;
    }, []).map(r => pad(r.map(op => control(kind, op)).join(""), w) + RESET);
    // Its controls after the words when both fit, else on rows of their own under them (a narrow reader).
    const wide = (e: UnsentEntry) => e.ops.filter(op => op !== view?.view).reduce((n, op) => n + UNSENT_LABEL[op].length + 1, 0);
    const raw = [
      ...shown.flatMap(e => width(e.text) + wide(e) <= w
        ? [pad(fg(C.yellow) + e.text + controls(e.kind, e.ops), w) + RESET]
        : [pad(fg(C.yellow) + ellipsize(e.text, w), w) + RESET, ...controlRows(e.kind, e.ops)]),
      ...(folded.length ? [pad(fg(C.dark) + oldUnsentLine(folded.length) + " ·" + controls("edit", ["show"]), w) + RESET] : []),
    ];
    const { lines, ranges } = extractLinks(raw);
    const elems: Element[] = ranges.map(r => {
      const l = tags[r.n]!, u = l.unsent!, key = `control:unsent:${u.op}:${u.kind}:${of}#0`, at = row + r.line;
      this.hits.push({ row: at, from: r.from, to: r.to, link: l, elem: key });
      return { key, kind: "control", row: at, from: r.from, to: r.to, ruler: [at, at + 1], label: `${UNSENT_LABEL[u.op]} the unsent ${u.kind === "child" ? "note" : u.kind}`, link: l };
    });
    return { lines, elems };
  }

  private proposalKeys(id: string): string {
    return this.elems.some(x => x.link?.proposal?.op === "apply" && x.link.proposal.id === id) ? "A apply anyway · X dismiss · " : "X dismiss · ";
  }

  /** The person's `A`, `X`, or a click or ⏎ on a proposal's control: `proposal.apply` or `proposal.dismiss`, its refusal flashed. */
  private proposalControl(op: "apply" | "dismiss", id: string | undefined, host: SurfaceHost): Promise<unknown> {
    return this.runKey(op === "apply" ? "proposal.apply" : "proposal.dismiss", id ? { id } : {}, host).then(r => r ?? null);
  }


  requireNote(): Msg {
    if (!this.msg) throw new ActionRefused("this reader shows no note; open one first");
    return this.msg;
  }

  async ensureDraft(host: SurfaceHost): Promise<DraftSession> {
    if (this.session) throw new ActionRefused("this reader is commenting; finish or close the comment first (comment.close)");
    if (!this.drafting) {
      const was = this.requireNote().id;
      const why = await this.edit(host, false, host.still);
      if (!this.drafting) throw new ActionRefused(movedOn(host, this, was) ?? (why || "the note couldn't be opened for editing (its revision is unknown)"));
    }
    return this.drafting;
  }

  /**
   * Replace the draft's text, as the $EDITOR handoff does. Text someone else changed last (the person's
   * typing, or another agent's) is copied to disk first, however often each of them has typed before.
   */
  closeDraftAction(discard: boolean): { closed: boolean; keptAt?: string; said?: string } {
    const s = this.drafting;
    if (!s) return { closed: false };
    if (s.dirty && !discard && !s.busy) throw new ActionRefused("the draft has unsaved changes; edit.save saves it, discard=true closes it anyway (put aside as unsent first, as esc twice does)");
    return s.close(discard);
  }

  async ensureSession(host: SurfaceHost, mode: "select" | "threads", by: Actor = USER): Promise<CommentSession> {
    if (this.draft) throw new ActionRefused("this reader is editing; save or close the edit first (edit.save, edit.close)");
    if (!this.session) {
      this.requireNote();
      await this.comment(host, mode, undefined, false);
      const made = this.session as CommentSession | null;
      if (!made) throw new ActionRefused("the note couldn't be opened for commenting (its revision is unknown)");
      made.startedBy = by;
      return made;
    }
    const s = this.session;
    if (s.busy) throw new ActionRefused(`wait: ${s.busy}`);
    if (mode === "threads" && s.mode !== "threads") {
      if (s.dirty) throw new ActionRefused("a comment is being written here; send it (comment.send) or close it (comment.close discard=true)");
      s.writing?.dispose(); s.writing = null; s.target = null; s.passage = null; s.mode = "threads";
    }
    if (mode === "select" && s.mode !== "select") {
      if (s.mode === "compose" && s.target?.kind === "reply") throw new ActionRefused("a reply is being written here; send or close it first");
      // `c` from the thread list, or picking again while writing: the text written so far rides along.
      await s.pick(this.commentEnv(host), s.mode === "compose");
    }
    return s;
  }

  env(host: SurfaceHost, actor: Actor) { return this.commentEnv(host, actor); }
  closeSession() { this.session = null; }
  followLink(i: number, host: SurfaceHost, fresh = false) { return this.follow(i, host, fresh); }
  clearLink() { this.letGo(); }
  /** Where the reader's cursor is (its current element, its selected link) and what it folded: a host that reuses a digest keys on it. */
  get cursorKey(): string { return `${this.cur ?? ""}|${this.link}|${[...this.folded].join("\u0001")}|${[...this.figureUI].map(([k, v]) => `${k}=${v.tab ?? ""}/${v.density ?? ""}`).join("\u0001")}`; }
  selectLink(i: number) {
    const l = this.links[i];
    if (!l) throw new ActionRefused(`there is no link ${i + 1}; the note has ${this.links.length}`);
    // The element it's drawn as becomes current (the ruler and ⏎ agree); none when it isn't drawn.
    this.cur = this.elems.find(e => e.link && sameLink(e.link, l))?.key ?? null;
    this.link = i;
  }
  goUp(host: SurfaceHost) { return this.up(host); }
  /** The `[[address]]` the selected link names (the current element's, else `[ ]`'s), for `page.create`. */
  selectedPage(): string | null {
    const e = this.cur ? this.elems.find(x => x.key === this.cur) : undefined;
    return e?.link?.page ?? this.links[this.link]?.page ?? null;
  }
}

/**
 * A step's element key, before its `#n` (which occurrence: the same step shown twice): by its id, or,
 * without one, by its evidence (its text), never by where it sits, so a step moved by an edit elsewhere is
 * still itself and another step that moved into its place is not it.
 */
const taskBase = (t: StepRef) => `task:${t.block}|${t.step.itemId ? `^${t.step.itemId}` : `ev:${t.step.evidence}`}`;
/**
 * A callout's element key, before its `#n`: its note, depth and title as written, never its line or its type, so
 * choosing another type keeps the `[ ]` position on it (as its fold point's key does).
 */
const calloutBase = (c: CalloutRef) => { const b = calloutBlocks([c.header])[0]; return `callout:${c.block}|${b?.depth ?? 0}|${b?.title ?? c.header.trim()}`; };
/** A callout's title as written, else its type's. */
const calloutTitle = (c: CalloutRef) => calloutBlocks([c.header])[0]?.title || c.type;
/** A callout type change, for undo: the header line before and after, and who made it while reading which note. */
/** The fewest rows a pane has for the reader to draw a header image above its note. */
const HERO_MIN_PANE = 16;
/** A header image's rows when the pane's height isn't known. */
const HERO_ROWS = 10;
/** The widths + and - step an image through, as shares of the reader (100 is `full`). */
const SIZE_STEPS = [25, 33, 50, 66, 75, 100];
/** What a caption control of an image does, said as its element's label. */
const imageControlLabel = (c: ImageControl) => "size" in c ? `size ${c.size > 0 ? "+" : "−"}` : "align" in c ? `align ${c.align > 0 ? "▸" : "◂"}` : "fit" in c ? (c.fit === "contain" ? "show it whole" : "crop it to fill") : c.hero ? "make it the header" : "not the header";
/** What a line change says when its line no longer reads as drawn (`flash`, `refused`), and after a conflict (`again`). */
interface Stale { flash: string; refused: string; again: string }
const CALLOUT_STALE: Stale = { flash: "that callout changed since it was drawn · nothing was changed · choose again", refused: "that callout changed since it was drawn; nothing was changed (callout.list reads it again)", again: "choose again" };
const IMAGE_STALE: Stale = { flash: "that image's line changed since it was drawn · nothing was changed · try again", refused: "that image's line changed since it was drawn; nothing was changed (images reads it again)", again: "try again" };
/** One line of a note rewritten: its index, its text as it was read, and what it became. */
interface LineEdit { line: number; before: string; after: string }
/** A change of whole lines (a callout's header, an image's layout) for undo. */
interface LineUndo { block: string; edits: LineEdit[]; by: string; context: string }
/** Who a step change is for Undo: the person, or the agent by its id. */
const partyOf = (a: Actor) => (a.kind === "agent" ? `agent:${a.id}` : "you");

/**
 * A step's status choice (PIE-472), `W` cells wide: Detail's choices in its order, each with its key, the
 * one the keys are on lit, the step's current status marked, and what the last choice said.
 */
function pickerPanel(ref: StepRef, sel: number, note: string, busy: boolean, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2);
  const title = ` ${STEP_MARKS[ref.step.status]} ${printable(stepTitle(ref.step))} `;
  const room = Math.max(0, W - 2);
  const lines = [edge + "┌─" + fg(C.white) + (width(title) > room ? pad(title, room) : title + edge + "─".repeat(Math.max(0, room - width(title)))) + RESET];
  const rows: number[] = [];
  STEP_CHOICES.forEach((c, i) => {
    const now = (c.id === ref.step.status ? " · now" : "");
    const text = pad(` ${c.label}${now}`, Math.max(1, inner - 3)) + ` ${c.key} `;
    rows.push(lines.length);
    lines.push(edge + "│" + (i === sel ? SELECT_BG + fg(C.white) : fg(C.lcyan)) + pad(text, inner) + RESET);
  });
  if (note) lines.push(edge + "│" + fg(busy ? C.dark : C.lred) + pad(` ${printable(note)}`, inner) + RESET);
  const foot = ` ⏎ choose · esc cancel${ref.via ? ` · in ${ref.via}` : ""} `;
  lines.push(edge + "└─" + fg(C.dark) + (width(foot) > room ? pad(foot, room) : foot + edge + "─".repeat(Math.max(0, room - width(foot)))) + RESET);
  return { lines, rows };
}

/**
 * A callout's type choice (PIE-538), `W` cells wide: the outline's types (the one list, src/callouts.ts), each with its
 * icon in its tone and its other names, its type now marked; then whether it starts folded or open, the `-` or `+`.
 */
function calloutPanel(ref: CalloutRef, P: Picker, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2), room = Math.max(0, W - 2), types = P.types!;
  const now = types.resolve(ref.type)?.name ?? ref.type;
  const title = ` [!${printable(ref.type)}] ${printable(calloutTitle(ref))} `;
  const lines = [edge + "┌─" + fg(C.white) + (width(title) > room ? pad(title, room) : title + edge + "─".repeat(Math.max(0, room - width(title)))) + RESET];
  // Every choice drawn, as the step choice draws its own, so each is a click away; the reader brings the panel into
  // view when it opens, and scrolls (the wheel) over a tall one.
  const items = P.list.items, rows: number[] = [];
  items.forEach((c, i) => {
    const t = c.id.startsWith("type:") ? types.resolve(c.id.slice(5)) : null;
    const on = i === P.list.sel, base = on ? SELECT_BG + fg(C.white) : fg(C.lcyan);
    const icon = t ? (on ? "" : fg(TONE[t.tone])) + t.icon + base + " " : "  ";
    // "now" next to the name, before the aliases a narrow reader cuts.
    const mark = t?.name === now ? " · now" : "";
    const label = t ? `${t.name}${mark}${t.aliases.length ? ` · ${t.aliases.join(", ")}` : ""}${t.block ? " · this outline's" : ""}` : c.label;
    rows.push(lines.length);
    lines.push(edge + "│" + base + " " + icon + pad(label, Math.max(1, inner - 3 - (c.key ? 3 : 0))) + (c.key ? ` ${c.key} ` : "") + RESET);
  });
  if (P.note) lines.push(edge + "│" + fg(P.busy ? C.dark : C.lred) + pad(` ${printable(P.note)}`, inner) + RESET);
  const foot = " ⏎ choose · - folded · + open · esc cancel ";
  lines.push(edge + "└─" + fg(C.dark) + (width(foot) > room ? pad(foot, room) : foot + edge + "─".repeat(Math.max(0, room - width(foot)))) + RESET);
  return { lines, rows };
}

/** A thread control's element key: stable across renders while its thread stays expanded. */
const controlKey = (thread: string, c: ThreadControl) => `ctl:${thread}:${c}`;

/**
 * A comment thread drawn under its passage (PIE-420), `W` cells wide: who and when, open or resolved, the
 * comment and its replies, and the Select, Reply and Resolve (or Reopen) controls, the current one lit.
 * Controls' rows and columns are the panel's own (no margin).
 */
function threadPanel(c: Comment, W: number, cur: string | null): { lines: string[]; controls: Control[] } {
  const edge = fg(c.open ? C.yellow : C.dark);
  const inner = Math.max(4, W - 2);
  const n = c.replies.length;
  const title = ` ${c.open ? "■" : "·"} ${printable(c.author)} · ${ago(c.at)} · ${c.open ? "open" : "resolved"}${n ? ` · ${n} repl${n === 1 ? "y" : "ies"}` : ""} `;
  const room = Math.max(0, W - 2), head = width(title) > room ? pad(title, room) : title + edge + "─".repeat(room - width(title));
  const lines = [edge + "┌─" + fg(c.open ? C.white : C.grey) + head + RESET];
  const text = (s: string, w: number) => printable(s.replace(/\t/g, " "), "", { lines: true }).split("\n").flatMap(l => (l ? wrap(l, w) : [""]));
  for (const l of text(c.body, inner)) lines.push(edge + "│ " + fg(c.open ? C.white : C.grey) + l + RESET);
  if (c.start === null && c.quote) lines.push(edge + "│ " + fg(C.brown) + "(the quoted words moved; the service couldn't place them)" + RESET);
  for (const r of c.replies) text(`${r.author} · ${ago(r.at)}: ${r.body}`, Math.max(2, inner - 2)).forEach((l, j) => lines.push(edge + "│ " + fg(C.cyan) + (j ? "  " : "└ ") + l + RESET));
  // The controls on one row, or as many as a narrow reader needs: each is whole, never cut off.
  const controls: Control[] = [];
  let row = edge + "│ ", col = 2;
  ([["select", "Select"], ["reply", "Reply"], ["resolve", c.open ? "Resolve" : "Reopen"]] as const).forEach(([k, label]) => {
    const shown = `[${label}]`, on = cur === controlKey(c.id, k);
    if (col > 2 && col + 3 + shown.length > W) { lines.push(row + RESET); row = edge + "│ "; col = 2; }
    if (col > 2) { row += fg(C.dark) + " · "; col += 3; }
    row += (on ? SELECT_BG + fg(C.white) : fg(C.lcyan)) + shown + RESET;
    controls.push({ thread: c.id, control: k, row: lines.length, from: col, to: col + shown.length, label });
    col += shown.length;
  });
  lines.push(row + RESET, edge + "└" + "─".repeat(Math.max(0, W - 1)) + RESET);
  return { lines, controls };
}

/**
 * `doc` with rows put in: each insert's `lines` before body row `at` (in order, for the same `at`), drawn
 * from no note line (source -1), so selection, focus and fold lookups pass over them. Links, images,
 * media rows and fold heads move down with the rows under them. `starts[i]`: where insert i landed.
 */
function withRows(doc: Doc, inserts: readonly { at: number; lines: readonly string[] }[]): { doc: Doc; starts: number[] } {
  const order = inserts.map((p, i) => ({ ...p, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  const starts: number[] = [], lines: string[] = [], source: number[] = [], moved: number[] = [];
  let k = 0;
  for (let r = 0; r <= doc.lines.length; r++) {
    for (; k < order.length && order[k]!.at <= r; k++) { starts[order[k]!.i] = lines.length; for (const l of order[k]!.lines) { lines.push(l); source.push(-1); } }
    if (r < doc.lines.length) { moved[r] = lines.length; lines.push(doc.lines[r]!); source.push(doc.source[r]!); }
  }
  const mv = (r: number) => (r < doc.lines.length ? moved[r]! : r + lines.length - doc.lines.length);
  return {
    doc: {
      lines, source,
      links: doc.links.map(l => ({ ...l, line: mv(l.line) })),
      images: doc.images.map(im => ({ ...im, line: mv(im.line) })),
      media: doc.media.map(x => ({ ...x, row: mv(x.row) })),
      heads: doc.heads.map(h => ({ ...h, row: mv(h.row) })),
    },
    starts,
  };
}

/** The note line (from 0, the subject) each offset of `text` is on. */
const lineAtOffset = (text: string) => {
  const starts: number[] = [];
  let o = 0;
  for (const l of text.split("\n")) { starts.push(o); o += l.length + 1; }
  return (off: number) => Math.max(0, starts.findLastIndex(s => s <= off));
};

/** The body rows [from, to) drawn from note lines `lo` to `hi` (from 0, the subject), or null when none is drawn. */
function rowsOfLines(doc: Doc, noteLines: number[], lo: number, hi: number): [number, number] | null {
  let a = -1, b = -1;
  doc.source.forEach((s, r) => { const l = noteLines[s]; if (l !== undefined && l >= lo && l <= hi) { if (a < 0) a = r; b = r; } });
  return a < 0 ? null : [a, b + 1];
}

/** Where `quote` is in `text`: the occurrence nearest `near` (an offset), or the first; -1 when it isn't. */
function findQuote(text: string, quote: string, near?: number): number {
  const hits: number[] = [];
  if (quote) for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) hits.push(i);
  if (!hits.length) return -1;
  return near === undefined ? hits[0]! : hits.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
}

/** A block id as an agent names it: the whole id, or its first 8+ characters. */
const sameId = (named: string, id: string | undefined) => !!id && (named === id || (named.length >= 8 && id.startsWith(named)));

/** `## Beds`, `- dig the bed`: a fold point as the hint, `peek` and the fold actions name it. */
const foldLabel = (p: FoldPoint) => `${p.kind === "heading" ? "#".repeat(p.level) : p.kind === "callout" ? ">".repeat(p.level) : "-"} ${printable(p.text)}`;

/** A panel row as `peek` and the props actions report it. */
const describeRow = (r: PropRow, src: Source | null, text: string) => ({
  n: r.n, key: r.key, value: r.value, scope: r.scope, ...(r.placement ? { placement: r.placement } : {}),
  ordinal: r.ordinal, ...(r.target ? { target: r.target, reads: printable(valueView(r, src, text)) } : {}),
});

/** "yours", "an agent (x)'s", with anyone else who wrote part of it: how a save was recorded. */
function recordedAs(by: Actor): string {
  const whose = by.kind === "agent" ? `${agentLabel(by)}'s` : "yours";
  return by.with?.length ? `${whose}, naming ${recordedActorId(by)}` : whose;
}


/** A draft action (src/edit.ts, DRAFT_ACTIONS) run on the reader's edit or comment being written. */
function forwardDraft<K extends keyof DraftActionArgs>(name: K): ActionDef<DraftActionArgs[K], On> {
  const info = DRAFT_ACTIONS.list().find(a => a.name === name)!, def = DRAFT_ACTIONS.def(name)!;
  return {
    summary: `${info.summary} (in this reader's edit or comment)`, keys: info.keys,
    touches: def.touches, ...(def.draft ? { draft: def.draft } : {}), replay: def.replay,
    args: info.args as ActionDef<DraftActionArgs[K], On>["args"],
    async run(args, { surface, host }, actor) {
      const w = surface.drafting ?? (surface.session?.mode === "compose" ? surface.session.writing : null);
      if (!w) throw new ActionRefused("nothing is being written in this reader; edit, or comment.write, opens a draft");
      const d = w.draft;
      if (d.busy) throw new ActionRefused("the save is still landing");
      // The person's draft is theirs: its cursor, view and preview move only by their keys and mouse (the session's rule).
      const r = await w.act(name, args, actor);
      // The person's copy reaches their clipboard, as the reader's select.copy does; an agent's is only returned.
      if (name === "draft.copy" && actor.kind === "user") {
        const c = r as { text: string; chars: number };
        if (host.ctx.copy?.(c.text) !== false) host.ctx.flash(`copied ${c.chars} chars`);
      }
      surface.noteAgent(actor, `used ${name} in the draft`);
      host.redraw();
      return r;
    },
  };
}

/** The cell size, in pixels, of the terminal the host draws in. */
const cellOf = (host?: SurfaceHost): [number, number] => [host?.ctx.t?.cellW ?? 9, host?.ctx.t?.cellH ?? 18];

/**
 * A body's images as placements on its own rows, `col` cells in (plus each one's own), under the text (cut to a window
 * with `inWindow`): each drawn from the PNG scaled for its box at cells `cellW` × `cellH` pixels, cropped as laid out.
 */
export const imagePlacements = (images: readonly DocImage[], col: number, cellW: number, cellH: number): Placement[] =>
  images.flatMap(im => {
    // Not drawn until a PNG dimmed for the part it shows is ready: its rows stay dark, never a bright first frame.
    const c = im.crop, png = sized(im.media, im.cols * cellW, im.rows * cellH, { ...(im.dim !== undefined ? { dim: im.dim } : {}), ...(c ? { crop: c } : {}) });
    if (!png) return [];
    const crop = c ? { x: Math.round(c.x * png.width), y: Math.round(c.y * png.height), w: Math.max(1, Math.round(c.w * png.width)), h: Math.max(1, Math.round(c.h * png.height)) } : undefined;
    return [{ key: `img:${png.key}:${im.line}`, image: png, col: col + im.col, row: im.line, cols: im.cols, rows: im.rows, z: -1, ...(crop ? { crop } : {}) }];
  });


/** A draft's live preview (PIE-496): the readers' own body renderer, without folds, embeds or link tags. */
export function draftPreview(text: string, w: number, src: Source | null = null): string[] {
  return renderDoc(presentLinks(text, false, src, text), { width: Math.max(10, w), cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: true, callouts: calloutsOf(src) }).lines;
}

/** The proposal `proposal.apply` or `proposal.dismiss` acts on: `id`, else the one whose embed or control is the current element, else the open proposal shown. */
function proposalTarget(id: string | undefined, surface: NoteSurface): string {
  const shown = surface.msg && isOpenProposal(surface.msg) ? surface.msg.id : undefined;
  const target = id ?? surface.currentProposal() ?? shown;
  if (!target) throw new ActionRefused("say which proposal: id=, or put [ ] on a proposal's embed");
  return target;
}

/** What a reader showing a trashed note says under its header (the river's column says it too). */
export const IN_TRASH = "■ in the Trash · still readable here";


// ── the actions ──────────────────────────────────────────────────────────────

interface On { surface: NoteSurface; host: SurfaceHost }

/**
 * A note action's row in its reader's menu (tile.menu, PIE-492): under "Note", hidden while the reader shows no note,
 * and dimmed (`busy`) while an edit or a comment holds it.
 */
/** An unsent action's argument: which put-aside draft on the note. */
const UNSENT_ARGS = { kind: { type: "string" as const, optional: true, about: "edit (default), comment, child (a note under this one) or card: what's put aside on the note" } };
/** The note what's put aside belongs to: the note shown, or the one a diff or copy view is about. */
const unsentOf = (surface: NoteSurface) => { const m = surface.requireNote(); return unsentView(m.id)?.of ?? m.id; };
/** The first kind put aside on the note shown (what [open copy] and [dismiss] mean without kind=). */
const firstUnsent = (surface: NoteSurface): UnsentKind | undefined => { const m = surface.msg; if (!m) return undefined; const of = unsentView(m.id)?.of ?? m.id; return (["edit", "comment", "child", "card"] as const).find(k => unsent(`${k}:${of}`)); };
/** What's put aside on the note shown, as `kind`, refused when there's nothing; `fetch`: the note as it is now too. */
async function unsentHere(surface: NoteSurface, host: SurfaceHost, kind: string, fetch: boolean): Promise<{ of: string; u: Unsent; now: Msg | null }> {
  if (!["edit", "comment", "child", "card"].includes(kind)) throw new ActionRefused(`kind is edit, comment, child or card, not ${kind}`);
  const of = unsentOf(surface), u = unsent(`${kind}:${of}`);
  if (!u) throw new ActionRefused(`nothing is put aside as unsent here (${kind})`);
  const now = fetch || kind === "edit" ? await host.ctx.board.get(of) : null;
  if (fetch && !now) throw new ActionRefused("the note is gone from the outline; [open copy] still has the unsent text");
  return { of, u, now };
}
/** A tile menu row for an unsent action: shown while something (an edit, with `edit`) is put aside on the note shown. */
const unsentRow = (label: string, only?: "edit"): MenuEntry<any, On> => ({
  label, group: "Note",
  now: on => { const m = on.surface.msg; if (!m) return { hide: true }; const of = unsentView(m.id)?.of ?? m.id; return (only ? unsent(`edit:${of}`) : firstUnsent(on.surface)) ? null : { hide: true }; },
});

/** The comment or reply being written in this reader, if one is. */
const writingIn = (surface: NoteSurface): Draft | null => (surface.session?.mode === "compose" ? surface.session.composer : null);
/** The reader's open edit, or else the comment or reply being written, handed to $EDITOR (it comes back when the editor exits). */
function handToEditor(surface: NoteSurface, host: SurfaceHost) {
  if (surface.draft) { surface.external(host); return { id: surface.draft.blockId, baseRevision: surface.draft.base, external: true }; }
  surface.external(host, writingIn(surface));
  return { comment: surface.session!.blockId, external: true };
}

const noteRow = (label: string, key: string, o: { busy?: true; now?: (on: On) => MenuNow<any> | null } = {}): MenuEntry<any, On> => ({
  label, group: "Note", key,
  now: on => (!on.surface.msg ? { hide: true } : o.busy && (on.surface.draft || on.surface.session) ? { refused: "this reader is editing or commenting; close that first" } : o.now?.(on) ?? null),
});

/**
 * The person moved on (esc, another tile) while the note was read for their edit or comment, or the reader went
 * to another note meanwhile: nothing opened, and that's the reason (not an unknown revision).
 */
const movedOn = (host: SurfaceHost, surface: NoteSurface, was: string) =>
  host.still && !host.still() ? "not opened: you moved on while the note was read"
  : surface.msg?.id !== was ? "not opened: this reader went to another note while it was read"
  : null;

/**
 * The person's C or m: the comment session opens from their selection (and their put-aside comment), once the
 * note is read; refused, with the reason already said, when it didn't open.
 */
async function personComments(surface: NoteSurface, host: SurfaceHost, mode: "select" | "threads"): Promise<CommentSession> {
  const was = surface.requireNote().id;
  const why = await surface.comment(host, mode, host.still);
  if (!surface.session) throw new ActionRefused(movedOn(host, surface, was) ?? (why || "the note couldn't be opened for commenting"));
  return surface.session;
}

/** A key that starts a session in a reader: e edit, ctrl+e $EDITOR, C quote, m threads, i / I properties. */
export type SessionKind = "edit" | "external" | "select" | "threads" | "props" | "props-full";
/** The key that starts a session in a reader (e, ctrl+e, C, m, i, I; c collapses), or null: one table for every reader. */
export function sessionStart(k: Key): SessionKind | null {
  if (k.kind !== "char") return null;
  if (k.ctrl) return k.ch === "e" ? "external" : null;
  return k.ch === "e" ? "edit" : k.ch === "C" ? "select" : k.ch === "m" ? "threads" : k.ch === "i" ? "props" : k.ch === "I" ? "props-full" : null;
}
/** The person's e and ctrl+e arm the edit (edit.arm, src/arm.ts) where the others start at once; a click on a hint's e opens it. */
export const armsEdit = (kind: SessionKind): boolean => (kind === "edit" || kind === "external") && !clickedKey();
/** The key running now came from a click (a hint's key: asBoundKey "click"): the mouse's, so an edit opens at once. */
const clickedKey = () => !!boundNow()?.split("; ").includes("click");
/** The note action each of those keys runs (PIE-510): the key, a click and `act` all start it the same way. */
export const SESSION_ACTIONS: Record<SessionKind, { name: "edit" | "passage.select" | "threads" | "props"; args: Record<string, unknown> }> = {
  edit: { name: "edit", args: {} },
  external: { name: "edit", args: { external: true } },
  select: { name: "passage.select", args: {} },
  threads: { name: "threads", args: {} },
  props: { name: "props", args: {} },
  "props-full": { name: "props", args: { full: true } },
};

/** Each action's arguments. */
export type NoteActionArgs = ArgsOfSet<typeof NOTE_ACTIONS>;

const STEP_ARGS = {
  n: { type: "number", optional: true, about: "which step, from 1, as tasks lists them (in the note and inside its embeds)" },
  id: { type: "string", optional: true, about: "the step's id: t-8a6d7f, ^t-8a6d7f, or <block>^t-8a6d7f" },
  block: { type: "string", optional: true, about: "with id: the note the step is in (its id or first 8+ characters), when the id is in more than one" },
} as const;

const CALLOUT_ARGS = {
  n: { type: "number", optional: true, about: "which callout, from 1, as callout.list lists them (outermost first, in reading order)" },
  line: { type: "number", optional: true, about: "its header's line in the note (1 is the subject)" },
} as const;

const IMAGE_ARGS = {
  n: { type: "number", optional: true, about: "which image, from 1, as images lists them (in reading order)" },
  line: { type: "number", optional: true, about: "its line in the note (1 is the subject)" },
} as const;

const FOLD_ARGS = {
  text: { type: "string", optional: true, about: "a heading's, list item's or callout's text (## optional; a unique start is enough)" },
  line: { type: "number", optional: true, about: "a line of the note (1 is the subject): the heading or item on it, or else the innermost one around it" },
  n: { type: "number", optional: true, about: "which fold point, from 1, as folds lists them" },
} as const;
type FoldArgs = ArgsOf<typeof FOLD_ARGS>;

/** The fold point `text`, `line` or `n` names in the note the reader shows (the whole note, waited for). */
async function foldTarget(surface: NoteSurface, args: FoldArgs): Promise<FoldPoint> {
  return foldPointIn(surface, await surface.whole(), args);
}

/** The same in a note already read whole: a key or click on what's drawn doesn't wait (PIE-506). */
function foldPointIn(surface: NoteSurface, m: Msg, { text, line, n }: FoldArgs): FoldPoint {
  const { points, lines } = surface.foldsIn(m);
  if ([text, line, n].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say which heading, list item or callout: one of text=, line= or n= (folds lists them)");
  if (!points.length) throw new ActionRefused("this note has no headings, nested lists or callouts to fold");
  const listed = (ps: FoldPoint[]) => ps.slice(0, 8).map(p => `line ${lines[p.line]! + 1} ${foldLabel(p)}`).join("; ");
  if (n !== undefined) {
    const p = points[n - 1];
    if (!p) throw new ActionRefused(`there is no fold point ${n}; the note has ${points.length} (folds lists them)`);
    return p;
  }
  if (line !== undefined) {
    const at = lines.indexOf(line - 1);
    if (at < 0) throw new ActionRefused(line === 1 ? "line 1 is the subject; it doesn't fold" : `line ${line} isn't part of the note's readable body (it's past the end, or holds only properties)`);
    const p = points.find(p => p.line === at) ?? points.filter(p => p.line < at && at < p.end).at(-1);
    if (!p) throw new ActionRefused(`line ${line} isn't a heading or a list item with nested lines, nor inside one; the note's are: ${listed(points)}`);
    return p;
  }
  const want = text!.trim().replace(/^(#{1,6}|[-*]|\d+[.)])\s+/, "").replace(/\s+/g, " ").toLowerCase();
  const heading = /^#{1,6}\s/.test(text!.trim()) ? text!.trim().match(/^#+/)![0].length : null;
  const pool = points.filter(p => heading === null || (p.kind === "heading" && p.level === heading));
  // A task's box ([ ], [x]) needn't be said.
  const reads = (p: FoldPoint) => [p.text.toLowerCase(), p.text.replace(/^\[.\]\s+/, "").toLowerCase()];
  let hits = pool.filter(p => reads(p).includes(want));
  if (!hits.length) hits = pool.filter(p => reads(p).some(r => r.startsWith(want)));
  if (!hits.length) throw new ActionRefused(`nothing foldable reads ${JSON.stringify(text)}; the note's are: ${listed(points)}`);
  if (hits.length > 1) throw new ActionRefused(`${hits.length} match ${JSON.stringify(text)} (${listed(hits)}); pass line= or n=`);
  return hits[0]!;
}

/** What a fold action reports: the fold point, whether it's folded now, and every fold in the reader. */
function foldResult(surface: NoteSurface, p: FoldPoint) {
  const { points, lines } = surface.foldsIn(surface.msg!);
  return {
    n: points.indexOf(p) + 1, kind: p.kind, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.folded.has(p.key),
    foldedNow: points.filter(q => surface.folded.has(q.key)).map(foldLabel),
  };
}

/** fold, unfold: one fold point, or with all=true every outermost one (fold) or all of them (unfold). */
async function runFold(on: boolean, { all, ...which }: FoldArgs & { all?: boolean }, { surface, host }: On, actor: Actor) {
  const now = surface.msg && !surface.msg.partial ? surface.msg : null;
  if (all) {
    if (Object.values(which).some(x => x !== undefined)) throw new ActionRefused("all=true folds or unfolds every one; leave out text, line and n");
    const m = now ?? await surface.whole();
    const changed = surface.foldAll(on, actor.kind === "user");
    surface.noteAgent(actor, on ? "folded the note's sections" : "unfolded the whole note");
    if (actor.kind === "user") host.ctx.flash(changed ? `${on ? "folded" : "unfolded"} ${changed}` : "this note has no headings, nested lists or callouts to fold");
    host.redraw();
    return { changed, foldedNow: surface.foldsIn(m).points.filter(q => surface.folded.has(q.key)).map(foldLabel) };
  }
  const p = now ? foldPointIn(surface, now, which) : await foldTarget(surface, which);
  surface.setFold(p, on, actor.kind === "user");
  surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p).slice(0, 40)}`);
  host.redraw();
  return foldResult(surface, p);
}

/**
 * The note's property rows as the service reads its current text (waiting for that answer), and the one
 * `n` or `key` names. A repeated key needs `n`.
 */
async function propRow(surface: NoteSurface, n: number | undefined, key: string | undefined): Promise<{ m: Msg; rows: PropRow[]; row: PropRow }> {
  const m = await surface.whole();
  const t = await tokensFor(m.text, surface.src);
  const rows = surface.rows(m, t.state === "ready" ? t.tokens : null);
  if (n !== undefined) return { m, rows, row: surface.row(m, n, rows) };
  if (!key) throw new ActionRefused("say which property: n (from props) or key");
  const hits = rows.filter(r => r.key === key.toLowerCase());
  if (!hits.length) throw new ActionRefused(`the note has no ${key} property; it has ${[...new Set(rows.map(r => r.key))].join(", ") || "none"}`);
  if (hits.length > 1) throw new ActionRefused(`the note has ${hits.length} ${key} values (${hits.map(r => `n=${r.n} ${r.value}`).join(", ")}); pass n`);
  return { m, rows, row: hits[0]! };
}

const ROW_ARGS = {
  n: { type: "number", optional: true, about: "which property, from 1, as props lists them" },
  key: { type: "string", optional: true, about: "the property's key, when it appears once" },
} as const;

const findThread = (s: CommentSession, id: string): number => {
  const i = s.threads.findIndex(t => t.id === id || (id.length >= 6 && t.id.startsWith(id)));
  if (i < 0) throw new ActionRefused(`no comment thread ${id} on this note; peek lists them under comments.threads`);
  return i;
};

/** A save, a send: done when the service answered. Throws with the surface's own words when it didn't take. */
async function saveDraft(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const d = surface.draft;
  if (!d) throw new ActionRefused("nothing is being edited here");
  if (d.busy) throw new ActionRefused("the save is still landing");
  const before = surface.msg?.revision;
  const by = await surface.save(host, actor);
  if (surface.draft === d) {
    if (d.propertyWarned === d.text && d.note.startsWith("this save changes properties")) return { saved: false, warning: d.note, next: "edit.save again saves it" };
    throw new ActionRefused(d.conflict ? `${d.conflict} · ${d.note}` : d.note || "not saved");
  }
  surface.noteAgent(actor, "saved this note");
  return { saved: true, revision: surface.msg?.revision, from: before, recordedAs: by ? mutationFor(by) : undefined };
}

async function sendComment(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const s = surface.session;
  if (!s || s.mode !== "compose" || !s.composer) throw new ActionRefused("no comment is being written here; comment.write first");
  const kind = s.target?.kind;
  await s.send(surface.env(host, actor));
  if (s.error || s.mode === "compose") throw new ActionRefused(s.error ?? s.composer?.note ?? "not sent");
  surface.noteAgent(actor, kind === "reply" ? "replied to a comment" : "commented on this note");
  return { sent: kind === "reply" ? "reply" : "comment", threads: s.threads.map(t => ({ id: t.id, open: t.open, quote: t.quote, replies: t.replies.length })) };
}

/**
 * back, forward (PIE-453). An agent's never moves what the person is reading: refused on the reader they have
 * focused, and where the view keeps the history (it would move their screen or focus).
 */
async function travelAction(dir: -1 | 1, { surface, host }: On, actor: Actor) {
  const word = dir < 0 ? "back" : "forward";
  // Where the view keeps the history itself (the river's columns), it moves the person's keys: theirs alone.
  if (actor.kind === "agent" && host.history) throw new ActionRefused(host.history.agentRefusal);
  const why = await surface.travel(dir, host);
  if (why) throw new ActionRefused(why);
  surface.noteAgent(actor, `went ${word} here`);
  host.redraw();
  const m = surface.msg;
  return { went: word, showing: m ? { id: m.id, title: subject(m) } : null, history: surface.describeHistory() };
}

export const NOTE_ACTIONS = actionSet<On>()("note", {
  // The draft's own actions (Enter's list continuation, Tab, Shift+Tab, a click, the wheel, the preview),
  // on this reader's edit or the comment being written: the same code its keys and mouse run.
  "draft.newline": forwardDraft("draft.newline"),
  "draft.indent": forwardDraft("draft.indent"),
  "draft.outdent": forwardDraft("draft.outdent"),
  "draft.place": forwardDraft("draft.place"),
  "draft.scroll": forwardDraft("draft.scroll"),
  "draft.preview": forwardDraft("draft.preview"),
  "draft.undo": forwardDraft("draft.undo"),
  "draft.copy": forwardDraft("draft.copy"),
  "complete": def({
    summary: "reference completion, as typing [[, (( or [file:: offers it: the candidates for text (such as [[PIE-4, ((beds, ((garden#, [file::src/), or at the open draft's cursor; insert=n puts the nth into the draft (expect=<its insertion> refuses it if the list changed meanwhile)",
    keys: "[[ (( [file:: while writing; tab, ctrl+space · up/down, enter/tab, esc",
    // Looking candidates up reads; putting one in types in the draft at its cursor: an agent's only in a draft it
    // opened and alone typed in, or one the person invited it into (an @name line; the insert uses the invitation up).
    touches: "draft", draft: "type", replay: "ask",
    touchesWith: ({ insert }) => (insert === undefined ? "nothing" : "draft"),
    args: {
      text: { type: "string", optional: true, about: "text ending in the token to complete; leave out to complete at the draft's cursor" },
      insert: { type: "number", optional: true, about: "put the nth candidate (from 1) into the draft at its cursor, as enter does" },
      expect: { type: "string", optional: true, about: "with insert=: the nth candidate's insertion as listed; refused when the list has changed since (a pause can have Jev re-order it)" },
      invitation: { type: "string", optional: true, about: "insert= in the person's draft: the invitation their @name line gave this agent (one step, used up only when it lands); not for a draft of the agent's own" },
    },
    async run({ text, insert, invitation, expect }, { surface, host }, actor) {
      const board = host.ctx.board as unknown as CompletionBoard;
      if (typeof board?.completePages !== "function") throw new ActionRefused("this connection can't look references up");
      const d = surface.draft ?? (surface.session?.mode === "compose" ? surface.session.composer : null);
      if (insert !== undefined && text !== undefined) throw new ActionRefused("insert completes at the draft's cursor; leave text out");
      let target;
      if (text !== undefined) {
        const line = text.split("\n").at(-1)!;
        target = completionTargetAtCursor(line, line.length);
        if (!target) throw new ActionRefused(`nothing to complete: text should end inside [[, (( or [file:: (it ends ${JSON.stringify(line.slice(-20))})`);
      } else {
        if (!d) throw new ActionRefused("nothing is being written here; pass text=\"[[...\" or open an edit first");
        target = completionTargetAtCursor(d.lines[d.row] ?? "", d.col);
        if (!target) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't inside [[, (( or [file::`);
      }
      // The draft as the target was read from it: typing during the lookups below moves the token, and a
      // splice at the old span would land in the wrong place, so any change refuses the insert.
      const at = d && { text: d.text, row: d.row, col: d.col };
      const still = () => !!d && !!at && d.text === at.text && d.row === at.row && d.col === at.col;
      const own = surface.draft ? { blockId: surface.draft.blockId, text: surface.draft.text } : undefined;
      const prefix = await board.workIdPrefix().catch(() => null);
      // What the person's popup shows, when it is open on this token (Jev's order included), so insert=n is
      // the nth they see; else the same lookup it makes, from the same note (with no draft, the note read here).
      const shown = d ? completionOf(d) : null;
      const r = text === undefined && shown && !shown.loading && shown.target.kind === target.kind && shown.target.start === target.start && shown.target.query === target.query
        ? shown : await lookupCompletion(board, target, prefix, own, { near: nearOf(d, own) ?? surface.msg?.id });
      const out = {
        kind: target.kind, query: target.query, message: r.message || undefined, truncated: r.truncated ?? undefined,
        items: r.items.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion, kind: it.kind, blockId: it.blockId, address: it.address, fragmentId: it.fragmentId, context: it.context || undefined })),
      };
      if (insert === undefined) return out;
      const item = r.items[insert - 1];
      if (!item) throw new ActionRefused(`there is no candidate ${insert}; there are ${r.items.length}`);
      if (expect !== undefined && item.insertion !== expect) throw new ActionRefused(`candidate ${insert} is now ${item.insertion}, not ${expect}: the list changed (Jev may have re-ordered it); list it again`);
      if (!d || d.busy) throw new ActionRefused(d ? "the save is still landing" : "nothing is being written here");
      try {
        if (!still()) throw new Error("the draft changed while the references were looked up; ask again");
        const ds = surface.draftSession();
        if (invitation !== undefined && (!ds || ds.draft !== d)) throw new Error("the invitation is for another draft");
        const spend = invitation !== undefined ? () => ds!.spend(invitation, actor) : undefined;
        if (!await insertCompletion(board, d, target, item, own, still, actor, spend)) throw new Error("the draft changed while the reference was checked; ask again");
      } catch (e) { throw new ActionRefused(`not inserted: ${e instanceof Error ? e.message : String(e)}`); }
      surface.noteAgent(actor, `inserted ${item.insertion.slice(0, 60)}`);
      host.redraw();
      return { ...out, inserted: item.insertion, dirty: d.dirty };
    },
  }),
  "edit": def({
    summary: "open the note for editing (its whole text, at the revision the service has now); external=true opens it in $EDITOR (a reader's ctrl+e; in an open edit, or a comment or reply being written, edit.external, ctrl+x ctrl+e, hands that over). The person's e arms it first (edit.arm) and ⏎ or e again opens it; a click on an edit control opens it at once", keys: "e then ⏎/e, ctrl+e then ⏎/ctrl+e (e or ctrl+e alone with edit.arm.set on=false)",
    touches: "draft", draft: "write", replay: "ask",
    menu: noteRow("edit", "e", { now: ({ surface }) => (surface.draft ? { hide: true } : null) }),
    args: { external: { type: "boolean", optional: true, about: "hand the draft to $EDITOR (the person's keys only)" } },
    async run({ external }, { surface, host }, actor) {
      if (external && actor.kind === "agent") throw new ActionRefused("the $EDITOR handoff takes over the person's terminal; send the text with edit.text");
      // Already writing here: that draft, or the comment or reply, goes to $EDITOR (edit.external's).
      if (external && (surface.draft || writingIn(surface))) return handToEditor(surface, host);
      if (surface.draft) return { already: true, id: surface.draft.blockId, baseRevision: surface.draft.base };
      const { draft: d } = await surface.ensureDraft(host);
      if (external) void openInEditor(host.ctx, d, () => surface.draft === d).then(() => host.redraw());
      surface.noteAgent(actor, "opened this note for editing");
      return { id: d.blockId, baseRevision: d.base };
    },
  }),
  "edit.arm": def({
    summary: "the person's e (ctrl+e: for $EDITOR) in a reader: arm the edit instead of opening it. The status bar asks `edit <title>? ⏎ · any other key cancels` and the reader's frame turns the edit's colour; ⏎ or the same key again within the window (edit.arm.set, or EP0CH_EDIT_ARM over it; default 2000 ms) opens it (edit), any other key lets it go and does what it does, and the window running out lets it go. edit.arm.set on=false (or EP0CH_EDIT_ARM=off) opens it at once. A click on an edit control, and an agent's edit, open at once",
    keys: "e, ctrl+e", touches: "nothing", replay: "ask",
    person: "arming is the person's e key, so a stray key never opens an edit; an agent opens one with edit (edit.text puts text in it)",
    args: { external: { type: "boolean", optional: true, about: "arm ctrl+e's $EDITOR handoff instead" } },
    run({ external }, { surface, host }) {
      const m = surface.requireNote();
      const kind: SessionKind = external ? "external" : "edit";
      // Opened as the key did before arming: through the host where it keeps track of the person's session.
      const open = () => {
        // The reader moved on while it was armed (a lane's preview followed another card, the note was opened over):
        // the question named this note, so nothing opens on another.
        if (surface.msg?.id !== m.id) { host.ctx.flash("not opened: the reader shows another note now · e edits it"); host.redraw(); return; }
        if (host.startSession) return void host.startSession(kind);
        void surface.startAsPerson(kind, host).catch(e => { host.ctx.flash(e instanceof Error ? e.message : String(e)); host.redraw(); });
      };
      const ms = editArmMs();
      // Already editing here (ctrl+e hands that draft over), arming off, or a door that can't hold an arm: at once.
      if (surface.draft || surface.session || !ms || !host.ctx.arm) { open(); return { opened: m.id }; }
      const title = subject(m), short = title.length > 48 ? `${title.slice(0, 47)}…` : title;
      host.ctx.arm({ of: surface, what: title, say: `edit ${short}${external ? " in $EDITOR" : ""}? ⏎ · any other key cancels`, key: external ? { kind: "char", ch: "e", ctrl: true } : { kind: "char", ch: "e" }, ms, run: open });
      host.redraw();
      return { armed: m.id, ms };
    },
  }),
  "edit.external": def({
    summary: "hand this reader's open edit, or the comment or reply being written, to $EDITOR (VISUAL, else EDITOR): it runs in a terminal tile beside the reader (the person's whole terminal on a screen without tiles), and its text comes back into the draft when it exits. In a draft ctrl+e alone is the line's end, as ctrl+a is its start. The person's only: it takes their terminal",
    keys: "ctrl+x then ctrl+e",
    touches: "draft", draft: "type", replay: "ask",
    person: "the $EDITOR handoff takes over the person's terminal; send the text with edit.text, or draft.patch into theirs",
    menu: noteRow("edit in $EDITOR", "ctrl+x ctrl+e", { now: ({ surface }) => (surface.draft || writingIn(surface) ? null : { hide: true }) }),
    args: {},
    run(_, { surface, host }) {
      if (!surface.draft && !writingIn(surface)) throw new ActionRefused("nothing is being written in this reader; ctrl+e (edit external=true) opens the note in $EDITOR");
      return handToEditor(surface, host);
    },
  }),
  "draft.pick": def({
    summary: "insert from a picker in this reader's edit or comment: the picker (EP0CH_PICKER, default tv) opens in a terminal tile beside the reader with the person's keys (their whole terminal on a screen without tiles or a locked one) on a channel (default EP0CH_PICK_CHANNEL, else ep0ch), and what they choose goes in at the cursor, space-separated. The person's only: it takes their keys",
    keys: "ctrl+t, a click on [insert] in the edit's, comment's or reply's title row",
    touches: "draft", draft: "type", replay: "ask",
    person: "an agent doesn't hand the person's terminal to a picker; put text in their draft with draft.patch, or in an edit it opened with edit.text",
    args: { channel: { type: "string", optional: true, about: "the picker's argument (a television channel: ep0ch, ep0ch-files …); empty for none" } },
    async run({ channel }, { surface, host }) {
      return await surface.pick(host, channel);
    },
  }),
  "edit.text": def({
    summary: "replace the draft's whole text (opens the edit first if needed); like text coming back from $EDITOR. An agent's replaces only an edit it opened, never while the person types in that reader (draft.patch lands in theirs)",
    touches: "draft", draft: "replace", replay: "ask",
    args: { text: { type: "string", about: "subject line, body and [key::value] properties" } },
    async run({ text }, { surface, host }, actor) {
      const s = await surface.ensureDraft(host);
      if (s.busy) throw new ActionRefused("the save is still landing");
      const kept = s.replace(text, actor);
      surface.noteAgent(actor, "is editing this note");
      host.redraw();
      return { dirty: s.dirty, keptYourDraftAt: kept ?? undefined };
    },
  }),
  "edit.save": def({
    summary: "save the draft, checked against the revision it started from; a property change is shown first and needs a second save", keys: "ctrl+s",
    touches: "draft", draft: "leave", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => saveDraft(surface, host, actor),
  }),
  "edit.reload": def({
    summary: "after the note changed elsewhere: start over from its current text (the draft is copied to disk first)", keys: "ctrl+r",
    touches: "draft", draft: "type", replay: "ask",
    args: {},
    async run(_, { surface, host }) {
      if (!surface.draft) throw new ActionRefused("nothing is being edited here");
      if (surface.draft.busy) throw new ActionRefused("the save is still landing");
      await surface.reload(host);
      return { baseRevision: surface.draft?.base, note: surface.draft?.note };
    },
  }),
  "edit.close": def({
    summary: "close the edit; unsaved changes need discard=true (and are put aside as unsent, with a copy on disk: e brings the person's back)", keys: "esc (twice when unsaved)",
    touches: "draft", draft: "leave", replay: "ask",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsaved changes" } },
    run({ discard }, { surface, host }, actor) {
      const r = surface.closeDraftAction(!!discard);
      // Put aside (or dropped, when it was brought back and left unchanged): said where, and how it comes back.
      if (r.said && actor.kind === "user") host.ctx.flash(r.said, 8000);
      host.redraw();
      return r;
    },
  }),
  "session.leave": def({
    summary: "leave the edit or comment as a click elsewhere does: an unchanged edit closes; a changed one is saved against its revision, or kept as unsent (e brings it back) when the save is refused; a comment or reply is kept as unsent, never sent. The person's gesture: an agent leaves only a session it opened",
    keys: "a click outside it, ^W then a window key (desk)",
    touches: "draft", draft: "leave", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.leave(host, actor),
  }),
  "page.create": def({
    summary: "make the page a [[address]] names when nothing answers it yet (address=, or the selected link's): `X [page::X]` where new notes go (the outline's placement rule: today the top of the Inbox), then open it as the link would; a page there already is opened. Following a missing [[page]] offers this first (⏎ or a click on it again). An agent's makes it, attributed and said, and opens nothing",
    keys: "⏎ or a click on a [[missing page]] link, twice (the first offers it)",
    touches: "nothing", replay: "ask",
    says: out => (out?.said ? `· ${out.said}` : null),
    args: { address: { type: "string", optional: true, about: "the page's address (its name); default: the selected link's" } },
    async run({ address }, { surface, host }, actor) {
      const page = address ?? surface.selectedPage();
      if (!page) throw new ActionRefused("name the page: address=<its name>, or select a [[page]] link first");
      return surface.createPage(page, host, actor);
    },
  }),
  "link.select": def({
    summary: "select the note's nth link (1 is the first); element.select picks any element a reader draws", keys: "[ ] (on a link)",
    touches: "tile", replay: "safe", way: "an agent selects a link in a reader the person isn't in, or follows one by number (link.follow n=)",
    args: { n: { type: "number", about: "which link, from 1" } },
    run({ n }, { surface, host }) { surface.requireNote(); surface.selectLink(n - 1); host.redraw(); return surface.describe().links[n - 1]; },
  }),
  "link.follow": def({
    summary: "follow the selected link (or the nth); where it opens is the view's call; fresh=true opens it in a new reader", keys: "enter, alt+enter, click on a link",
    touches: "tile", replay: "ask", way: "following a link there would move what they're reading · an agent follows one in another reader (tile=), or opens the note with open id= naming no tile (it lands where opens land)",
    args: {
      n: { type: "number", optional: true, about: "which link, from 1; default the selected one" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    async run({ n, fresh }, { surface, host }, actor) {
      surface.requireNote();
      // The person's n= becomes their [ ] position; an agent's follows that link and leaves the position alone.
      if (n !== undefined && actor.kind !== "agent") surface.selectLink(n - 1);
      const links = surface.describe().links;
      if (n !== undefined && !links[n - 1]) throw new ActionRefused(`there is no link ${n}; the note has ${links.length}`);
      const i = n !== undefined && actor.kind === "agent" ? n - 1 : links.findIndex(l => l.selected);
      if (i < 0) throw new ActionRefused("no link is selected; pass n");
      const m = await surface.followLink(i, host, !!fresh);
      // Outside the door (a web page, a file): the person's opened there; an agent's is given the address.
      if (m && "outside" in m) return { opened: null, ...m };
      if (m) surface.noteAgent(actor, `followed a link to ${subject(m).slice(0, 40)}`);
      return m ? { opened: m.id, title: subject(m) } : { opened: null };
    },
  }),
  "elements": def({
    summary: "list what [ ] steps through in this reader, in reading order: links, folds, figure rows, embeds, comment marks (the current one marked)",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { elements: surface.describeElements() };
    },
  }),
  "element.select": def({
    summary: "put the person's [ ] position on the nth element (elements lists them), or by=1 / by=-1 the next or previous one (from the view when none is current); n=0 lets go of it. The reading ruler follows. An agent's is refused: the position is the person's (block.tint marks something for them)", keys: "[ ], click, esc lets go",
    touches: "tile", replay: "safe", person: "the [ ] position is the person's; block.tint marks a block for them without moving it",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1, as elements lists them; 0 lets go" },
      by: { type: "number", optional: true, about: "1 the next element, -1 the previous one" },
    },
    async run({ n, by }, { surface, host }, actor) {
      if ((n === undefined) === (by === undefined)) throw new ActionRefused("say n= (an element, 0 lets go) or by=1 / by=-1");
      if (n === 0) { surface.letGo(); host.redraw(); return { current: null }; }
      if (by !== undefined) {
        if (!surface.step(by < 0 ? -1 : 1)) throw new ActionRefused("nothing to step to: this note has no links, folds, figure rows, embeds, resource projections or comments");
        host.redraw();
        return surface.describeElements().find(e => e.current) ?? null;
      }
      await surface.whole();
      surface.selectElement(surface.element(n!));
      host.redraw();
      return surface.describeElements()[n! - 1];
    },
  }),
  "element.open": def({
    summary: "do what enter does on an element: a link follows (where is the view's call), a fold toggles, a row or an embed opens its note, a comment mark opens its thread; fresh=true opens a link, row or embed in a new reader. An agent's leaves the person's [ ] position alone, is refused in the reader they have, and never opens the browser (it is given the address)", keys: "enter, alt+enter, a click",
    touches: "tile", replay: "ask", way: "opening an element there would move what they're reading · an agent opens one in another reader (tile=), opens the note with open id=, or folds a section with fold or unfold",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them); default the current one (the person's own only)" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    async run({ n, fresh }, on, actor) {
      const { surface, host } = on;
      // The person's key or click is on what's drawn now: no wait for the whole note.
      if (actor.kind === "agent") await surface.whole();
      if (n === undefined && actor.kind === "agent") throw new ActionRefused("say which element: n (elements lists them); the current one is the person's");
      const cur = actor.kind === "user" ? surface.inView() : null;
      const i = n ?? (cur ? surface.describeElements().findIndex(e => e.current) + 1 : 0);
      if (!i) throw new ActionRefused("no element is current in view; pass n");
      const e = surface.element(i);
      if (fresh && e.kind !== "link" && e.kind !== "row" && e.kind !== "embed") throw new ActionRefused(`fresh opens a link, a row or an embed; element ${i} is a ${e.kind}`);
      // A step's box opens the person's status choice; an agent sets the status itself.
      // A live figure's tab or density control: the figure's own action, with its rules and its provenance.
      if (e.kind === "figure" && e.link?.figure) {
        return surface.runFigureControl(e.link.figure, host, actor);
      }
      if (e.kind === "task" && actor.kind === "agent") throw new ActionRefused(`element ${i} is a step's status control; an agent sets it with task.status n=… to=done|todo|waiting|problem (tasks lists the steps)`);
      // An extension's line (PIE-512): its head runs the line's primary action, a control its own; an agent's
      // run is the agent's (said on the status bar), and what it writes is the extension's (ext:<id>).
      if (e.link?.ext && (e.kind === "control" || e.kind === "resource")) {
        const r = await surface.runExt(e.link.ext.action, e.link.ext, host, actor);
        surface.noteAgent(actor, `ran ${e.link.ext.action} on ${e.label.slice(0, 40)}`);
        return { element: i, kind: e.kind, action: e.link.ext.action, ...(r && typeof r === "object" ? r : {}) };
      }
      // An `■ unsent` line's control runs its action as whoever asks (an agent's is refused: the unsent text is the person's).
      if (e.kind === "control" && e.link?.unsent) {
        const r: unknown = await NOTE_ACTIONS.run(`unsent.${e.link.unsent.op}`, { kind: e.link.unsent.kind }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // A proposal's [apply] [dismiss] run its action as whoever asks (an agent dismisses only its own).
      if (e.kind === "control" && e.link?.proposal?.op) {
        const r: unknown = await NOTE_ACTIONS.run(e.link.proposal.op === "apply" ? "proposal.apply" : "proposal.dismiss", { id: e.link.proposal.id }, on, actor);
        return { element: i, kind: e.kind, ...(r && typeof r === "object" ? r : {}) };
      }
      // An expanded thread's controls are the person's view of it; an agent acts on the thread itself.
      if (e.kind === "control" && actor.kind === "agent") throw new ActionRefused(`that's the person's ${e.control} control on an expanded thread; an agent uses ${e.control === "select" ? "select text=…" : e.control === "reply" ? `reply thread=${e.thread!.slice(0, 8)} body=…` : `resolve thread=${e.thread!.slice(0, 8)} (open=true reopens)`}`);
      // An agent's comment mark opens the thread list as its own session, on that thread (never under the
      // person's property panel, which would take the keys meant for it).
      if (e.kind === "comment" && actor.kind === "agent") {
        if (surface.panel && !surface.draft && !surface.session) throw new ActionRefused("the person has the property panel open on this note; try again once they close it");
        const r = await NOTE_ACTIONS.run("threads", {}, on, actor) as { threads: { id: string }[] };
        const s = surface.session;
        const t = s ? s.threads.findIndex(x => x.id === e.thread) : -1;
        if (s && t >= 0) s.sel = t;
        host.redraw();
        return { thread: e.thread, ...r };
      }
      const r = await surface.openElement(e, host, !!fresh, actor.kind === "user");
      // Outside the door, an agent's was given the address (openOutside said so); it opened nothing.
      if (!(r && typeof r === "object" && "outside" in r)) surface.noteAgent(actor, `${e.kind === "fold" ? "toggled" : "opened"} ${e.label.slice(0, 40)}`);
      host.redraw();
      return { element: i, kind: e.kind, ...(r && typeof r === "object" && "id" in r ? { opened: (r as Msg).id, title: subject(r as Msg) } : r && typeof r === "object" ? r : {}) };
    },
  }),
  // A tint (PIE-423's focus mark): "focus" is the person's keys only, so the tint is block.tint.
  // A tint in the reading ruler's colour, with who set it.
  "block.tint": def({
    summary: "tint a block in this reader (PIE-423's focus mark): a block (this note, or one it embeds or links), note lines, or an exact passage, tinted like the reading ruler with who set it named, and scrolled into view. The person's [ ] position, selection and keys aren't moved",
    touches: "nothing", replay: "safe",
    args: TINT_ARGS,
    async run(spec, { surface, host }, actor) {
      await surface.whole();
      const r = surface.setFocus(spec, actor);
      host.ctx.flash(`${agentLabel(actor)} marked ${r.marked}`);
      host.redraw();
      return { ...r, by: whoOf(actor) };
    },
  }),
  "block.untint": def({
    summary: "take away the tint (block.tint) in this reader (esc does it for the person once nothing else is selected)", keys: "esc",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface, host }, actor) {
      const had = surface.focusMark;
      surface.focusMark = null;
      if (had && actor.kind === "user") host.ctx.flash(`let go of the focus mark ${agentLabel(had.by)} set`);
      host.redraw();
      return { cleared: !!had, ...(had ? { by: whoOf(had.by) } : {}) };
    },
  }),
  "projection.refresh": def({
    summary: "fetch the tickets a note shows now (a page's, or the ticket block's own), and run its extensions' lines again (PIE-507): block=<id> (line=<index> for one line: an output, a component, an @name request is asked again, a record fetched), else the one the [ ] position is on, else the note's (every ticket and handler line, and every @name request not answered yet). Who runs it is who asked (an @name line says so). The service runs them and writes as the extension; the region repaints", keys: "r, a click on a ticket's age or a line's [r run again]",
    touches: "nothing", replay: "ask",
    args: {
      block: { type: "string", optional: true, about: "the block whose tickets and lines to fetch or run (a page or a ticket block); default: the reader's" },
      line: { type: "number", optional: true, about: "only that line (its index in the note's text, 0 the first), of block= or else the reader's note" },
    },
    async run(a, { surface, host }, actor) {
      const m = surface.msg;
      const t = typeof a.block === "string" && a.block ? { block: a.block, ...(a.line !== undefined ? { line: a.line } : {}) }
        : m && isOutlineNote(m) ? (a.line !== undefined ? { block: m.id, line: a.line } : surface.refreshTarget()) : null;
      if (!t) throw new ActionRefused("no note with tickets here");
      return surface.refreshTickets(host, t.block, actor, t.line);
    },
  }),
  "up": def({
    summary: "go to the note's parent. An agent's is refused on the reader the person has", keys: "u (U too in the message reader)",
    touches: "tile", replay: "safe", way: "up would move what they're reading · an agent goes up in another reader (tile=), or opens the parent with open id=",
    menu: noteRow("up to the parent", "u", { busy: true }),
    args: {},
    async run(_, { surface, host }, actor) {
      if (actor.kind === "user") surface.letGo();
      const m = await surface.goUp(host);
      if (!m) throw new ActionRefused("the note has no parent");
      return { opened: m.id, title: subject(m) };
    },
  }),
  "links": def({
    summary: "show this reader's note's links (its Outlinks, Resources and Backlinks, the links model the outliner's Tree shows) in the screen's links tile: it aims at this note, its dock opens, and the person's keys go to it; on a screen without one a links tile opens below the reader with a preview following its selection. An agent's never aims the person's links tile: where the screen has one, it answers this note's links (the tile keeps its note and selection); where there's none, it opens one of its own below the reader, on this note. Either way the person's keys stay where they are. A note can list them inline too: ::links, ::resources, ::backlinks",
    keys: "b",
    touches: "shape", replay: "safe", says: () => "showed the links",
    menu: noteRow("links", "b", { now: ({ surface, host }) => (!host.links || !surface.msg || !isOutlineNote(surface.msg) ? { hide: true } : null) }),
    args: {},
    async run(_, { surface, host }, actor) {
      const m = surface.msg;
      if (!m) throw new ActionRefused("no note here to show the links of");
      if (!isOutlineNote(m)) throw new ActionRefused("a resource or a file isn't a block: it has no links here");
      if (!host.links) throw new ActionRefused("this screen has no room for a links tile · write ::links in a note to list them inline");
      return host.links(actor);
    },
  }),
  "back": def({
    summary: "go back to the note this reader showed before it followed a link, went up, or had a note opened into it (an agent's open too), scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: "alt+←, alt+b, backspace, the mouse's back button, a click on ← back",
    touches: "tile", replay: "safe", way: "back would move what they're reading · an agent goes back only in another reader (name it with tile=)",
    menu: noteRow("back", "alt+left", { busy: true, now: ({ surface }) => (surface.describeHistory().back.length ? null : { hide: true }) }),
    args: {},
    run: (_, on, actor) => travelAction(-1, on, actor),
  }),
  "forward": def({
    summary: "go forward again to where back came from, scrolled and with its [ ] position as it was. An agent's is refused on the reader the person has focused",
    keys: "alt+→, alt+f, the mouse's forward button, a click on forward →",
    touches: "tile", replay: "safe", way: "forward would move what they're reading · an agent goes forward only in another reader (name it with tile=)",
    menu: noteRow("forward", "alt+right", { busy: true, now: ({ surface }) => (surface.describeHistory().forward.length ? null : { hide: true }) }),
    args: {},
    run: (_, on, actor) => travelAction(1, on, actor),
  }),
  "passage.select": def({
    summary: "start a comment: pick a passage of the note's source text by its exact words (default: the first line with text)", keys: "C, then j k J K h l H L",
    touches: "draft", draft: "type", replay: "ask",
    menu: noteRow("comment on a passage", "C", { busy: true }),
    args: {
      quote: { type: "string", optional: true, about: "the exact words to quote, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    async run({ quote, near }, { surface, host }, actor) {
      // The person's C starts from their selected text (the quote) and their put-aside comment; an agent's never.
      const s = actor.kind === "user" && !surface.session && !surface.draft ? await personComments(surface, host, "select") : await surface.ensureSession(host, "select", actor);
      // Picking reads the note again; when that fails the session stays where it was, with the reason.
      const p = s.mode === "select" ? s.passage : null;
      if (!p) throw new ActionRefused(s.error ?? "the passage couldn't be picked: the note's current text wasn't read");
      if (quote !== undefined) { const why = p.selectText(quote, near); if (why) { p.note = why; host.redraw(); throw new ActionRefused(why); } }
      surface.noteAgent(actor, "is quoting a passage");
      host.redraw();
      return { revision: s.msg.revision, quote: p.quote, start: p.from };
    },
  }),
  "comment.write": def({
    summary: "write the comment (or reply) text: on a picked passage this is Enter, then the text. An agent's replaces only a comment it opened, never one the person is writing; invited (their @name line), it rewrites the text above that line, once", keys: "enter, then typing",
    touches: "draft", draft: "text", replay: "ask",
    args: {
      body: { type: "string", about: "the comment's text" },
      invitation: { type: "string", optional: true, about: "the invitation the person's @name line gave this agent: body replaces the text above that line (one reply)" },
      base: { type: "string", optional: true, about: "with invitation=: the hash of the text the reply was written on, as the invitation gave it" },
    },
    async run({ body, invitation, base }, { surface, host }, actor) {
      const s = surface.session;
      if (!s) throw new ActionRefused("no comment is being written here; passage.select or reply first");
      if (s.busy) throw new ActionRefused(`wait: ${s.busy}`);
      // Invited into the person's comment: the reply seam edits use (DraftSession.reply), compared on the invited range.
      if (invitation !== undefined) {
        if (s.mode !== "compose" || !s.writing) throw new ActionRefused("no comment is being written here to be invited into");
        if (base === undefined) throw new ActionRefused("invitation= needs base=, the hash of the text the reply was written on");
        const r = s.writing.reply(invitation, base, body, actor);
        host.redraw();
        return { ...r, dirty: s.writing.dirty };
      }
      // An agent's comment is its own: the person's put-aside text stays put aside.
      if (s.mode === "select") { const why = s.write(actor); if (why) throw new ActionRefused(why); }
      if (s.mode !== "compose" || !s.composer) throw new ActionRefused("pick a passage first (passage.select) or reply to a thread");
      const kept = s.writing!.replace(body, actor);
      host.redraw();
      return { dirty: s.composer.dirty, keptYourDraftAt: kept ?? undefined };
    },
  }),
  "comment.reload": def({
    summary: "after a send refused because the note moved on: find the quote again in the note's current text (nearest where it was), or pick the passage again when its words are gone; the comment's text stays", keys: "ctrl+r",
    touches: "draft", draft: "type", replay: "ask",
    args: {},
    async run(_, { surface, host }, actor) {
      const s = surface.session;
      if (!s || s.mode !== "compose" || !s.composer) throw new ActionRefused("no comment is being written here");
      await s.relocate(surface.env(host, actor));
      if (s.error) throw new ActionRefused(s.error);
      host.redraw();
      return { mode: s.mode, note: s.note || s.composer?.note || null };
    },
  }),
  "comment.send": def({
    summary: "send the comment or reply; a retry of the same text can't land twice", keys: "ctrl+s",
    touches: "draft", draft: "leave", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => sendComment(surface, host, actor),
  }),
  "comment": def({
    summary: "comment on a passage in one step: passage.select, comment.write, comment.send",
    touches: "draft", draft: "type", replay: "ask",
    args: {
      quote: { type: "string", about: "the exact words to quote, as stored" },
      body: { type: "string", about: "the comment's text" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    async run({ quote, body, near }, on, actor): Promise<unknown> {
      await NOTE_ACTIONS.run("passage.select", { quote, near }, on, actor);
      await NOTE_ACTIONS.run("comment.write", { body }, on, actor);
      return NOTE_ACTIONS.run("comment.send", {}, on, actor);
    },
  }),
  "comment.close": def({
    summary: "close the comment session; unsent text needs discard=true (and is put aside as unsent, with a copy on disk)", keys: "esc",
    touches: "draft", draft: "leave", replay: "ask",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsent text" } },
    run({ discard }, { surface, host }) {
      const s = surface.session;
      if (!s) return { closed: false };
      if (s.dirty && !discard) throw new ActionRefused("the comment isn't sent; comment.send sends it, discard=true closes it anyway (put aside as unsent first, as esc twice does)");
      const r = s.writing?.close(true);
      surface.closeSession(); host.redraw();
      return { closed: true, keptAt: r?.keptAt };
    },
  }),
  "threads": def({
    summary: "show the note's comment threads (the person's opens on the comment mark the [ ] position is on); in the list, j k move and PgUp PgDn and the wheel scroll it", keys: "m; j k PgUp PgDn wheel in the list",
    touches: "tile", replay: "safe", way: "the thread list would cover what they're reading · an agent lists threads in another reader (tile=)",
    menu: noteRow("comments", "m", { busy: true }),
    args: {},
    async run(_, { surface, host }, actor) {
      // The person's opens as it was asked for: on a comment mark's thread, or with a Reply control's reply started.
      const s = actor.kind === "user" && !surface.session && !surface.draft ? await personComments(surface, host, "threads") : await surface.ensureSession(host, "threads", actor);
      host.redraw();
      return { threads: s.threads.map(t => ({ id: t.id, open: t.open, author: t.author, quote: t.quote, body: t.body, replies: t.replies.length })) };
    },
  }),
  "thread.toggle": def({
    summary: "expand a comment thread inline under its passage (its comment, replies and Select, Reply, Resolve controls), or collapse it; expand=true or false sets it. The person's reading state: an agent's is refused (threads, reply and resolve act on a thread without changing their view)", keys: "enter or a click on a comment mark",
    touches: "tile", replay: "safe", person: "which threads are expanded is the person's reading state; threads, reply and resolve act on a thread without changing their view",
    args: {
      thread: { type: "string", about: "the thread's id (or its first 6+ characters)" },
      expand: { type: "boolean", optional: true, about: "true expands, false collapses; left out, it toggles" },
    },
    async run({ thread, expand }, { surface, host }, actor) {
      await surface.whole();
      const id = surface.threadId(thread);
      surface.setExpanded(id, expand ?? !surface.expanded.has(id));
      host.redraw();
      return { thread: id, expanded: surface.expanded.has(id) };
    },
  }),
  "reply": def({
    summary: "reply to a comment thread and send it", keys: "m, j k, r, typing, ctrl+s",
    touches: "draft", draft: "type", replay: "ask",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", about: "the reply's text" } },
    async run({ thread, body }, on, actor) {
      const s = await on.surface.ensureSession(on.host, "threads");
      const why = s.replyTo(findThread(s, thread), actor);
      if (why) throw new ActionRefused(why);
      s.writing!.replace(body, actor);
      return sendComment(on.surface, on.host, actor);
    },
  }),
  "resolve": def({
    summary: "resolve a comment thread, or reopen it with open=true. It opens the thread list in the reader: an agent's is refused on the reader the person has", keys: "m, j k, x",
    touches: "tile", replay: "ask", way: "the thread list would cover what they're reading · an agent resolves it in another reader (tile=)",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, open: { type: "boolean", optional: true, about: "reopen instead of resolving" } },
    async run({ thread, open }, { surface, host }, actor) {
      const s = await surface.ensureSession(host, "threads");
      const i = findThread(s, thread), t = s.threads[i]!;
      s.sel = i;
      const want = open ? "open" : "resolved";
      if (t.open === !!open) { host.redraw(); return { already: want }; }
      await s.toggle(surface.env(host, actor));
      if (s.error) throw new ActionRefused(s.error);
      surface.noteAgent(actor, open ? "reopened a comment" : "resolved a comment");
      return { lifecycle: want };
    },
  }),
  "props": def({
    summary: "open the property panel: every property token (repeats and block/line/inline scope kept), with the summary line's keys", keys: "i, I (full)",
    touches: "nothing", replay: "safe",
    menu: noteRow("properties", "i", { busy: true }),
    args: { full: { type: "boolean", optional: true, about: "fill the reader instead of sitting above the note" } },
    async run({ full }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      // The panel holds the reader's keys: an agent reads the rows in its reply and leaves the panel be.
      if (actor.kind === "user") { surface.requireNote(); surface.openPanel(!!full); host.redraw(); }
      const m = await surface.whole();
      const t = await tokensFor(m.text, surface.src);
      host.redraw();
      return { id: m.id, revision: m.revision, summary: surface.summary(m), scopes: t.state === "ready" ? "service" : "block only", rows: surface.rows(m, t.state === "ready" ? t.tokens : null).map(r => describeRow(r, surface.src, m.text)) };
    },
  }),
  "props.copy": def({
    summary: "a property's value, returned (the person's own y copies it to their clipboard; an agent's never does)", keys: "i, tab, y",
    touches: "nothing", replay: "safe",
    args: ROW_ARGS,
    async run({ n, key }, { surface, host }, actor) {
      // The person's y in their open panel copies the row they're on, as drawn now (no wait).
      const now = surface.msg;
      const { row } = actor.kind === "user" && surface.panel && now && !now.partial && n !== undefined ? { row: surface.row(now, n) } : await propRow(surface, n, key);
      // The clipboard and the panel are the person's: an agent gets the value here, and nothing moves.
      if (actor.kind === "user") {
        surface.openPanel(surface.panel?.full);
        surface.panel!.sel = row.n - 1;
        surface.copyValue(row, host);
      }
      host.redraw();
      return { key: row.key, value: row.value };
    },
  }),
  "props.follow": def({
    summary: "open what a block, page or Work-ID value names; where it opens is the view's call. An agent's is refused on the reader the person has", keys: "i, tab, o",
    touches: "tile", replay: "ask", way: "following it there would move what they're reading · an agent follows it in another reader (tile=), or opens the note with open id=",
    args: ROW_ARGS,
    async run({ n, key }, { surface, host }, actor) {
      const { row } = await propRow(surface, n, key);
      if (!row.target) throw new ActionRefused(`${row.key} holds plain text (${row.value}); there is nothing to follow`);
      const m = await surface.followValue(row, host);
      if (!m) throw new ActionRefused(surface.panel?.note || `nothing answers at ${row.value}`);
      surface.noteAgent(actor, `followed ${row.key} to ${subject(m).slice(0, 40)}`);
      return { opened: m.id, title: subject(m) };
    },
  }),
  "props.edit": def({
    summary: "replace one property value: a properties.patch of that token, refused if the note changed since it was read", keys: "i, tab, enter or e, typing, enter",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      ...ROW_ARGS,
      value: { type: "string", about: "the new value (one line, no ])" },
      revision: { type: "number", optional: true, about: "the revision you read the properties at; refused if the note is past it" },
    },
    async run({ n, key, value, revision }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      const f = surface.panel?.field;
      if (f && (f.saving || f.input.text !== f.row.value)) throw new ActionRefused(f.saving ? "a value is being saved here" : `a value (${f.row.key}) is being typed here; it's someone else's until saved or cancelled`);
      const { m, row } = await propRow(surface, n, key);
      if (revision !== undefined && m.revision !== revision) throw new ActionRefused(`the note is at revision ${m.revision}, not ${revision}; read the properties again (props)`);
      if (m.revision === undefined) throw new ActionRefused("the note's revision is unknown, so a value edit couldn't be checked");
      // The ordinal belongs to the text it was read from: if the reader moved on meanwhile, don't guess.
      const now = surface.msg;
      if (!now || now.id !== m.id || now.revision !== m.revision || now.text !== m.text)
        throw new ActionRefused(`the note changed while its properties were read (now revision ${now?.id === m.id ? now.revision : "?"}); read them again (props)`);
      const why = checkValue(row, value);
      if (why) throw new ActionRefused(why);
      const to = value.trim();
      if (to === row.value) return { saved: false, unchanged: true, key: row.key, revision: m.revision };
      // Straight to the service at the revision the ordinal came from; the person's panel and keys are left alone.
      let saved: Msg;
      try { saved = await surface.patchValue(m, m.revision, row, to, host, actor); } catch (e) {
        throw new ActionRefused(e instanceof EditConflict ? "the note changed elsewhere since its properties were read · not saved; read them again (props)" : `not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
      host.ctx.flash(`saved · revision ${saved.revision} · ${row.key}: ${printable(row.value).slice(0, 30)} → ${printable(to).slice(0, 30)}`);
      surface.noteAgent(actor, `set ${row.key} to ${to.slice(0, 40)}`);
      host.redraw();
      return { saved: true, key: row.key, from: row.value, to, revision: saved.revision ?? null, fromRevision: m.revision, recordedAs: mutationFor(actor) };
    },
  }),
  "props.close": def({
    summary: "close the property panel (a value being typed must be saved or cancelled first)", keys: "esc, i, q",
    touches: "tile", while: "typing", replay: "safe", way: "the property panel they're in is theirs to close",
    args: {},
    run(_, { surface, host }) {
      if (!surface.panel) return { closed: false };
      if (!surface.closePanel()) throw new ActionRefused("a property value is being typed; enter saves it, esc cancels");
      host.redraw();
      return { closed: true };
    },
  }),
  "props.summary": def({
    summary: "choose the summary line's keys (yours, on this machine); a view's [summary-properties::] still decides for its notes", keys: "i, tab, s",
    touches: "screen", replay: "safe",
    args: {
      keys: { type: "string", optional: true, about: "comma-separated keys in order; empty shows no summary" },
      toggle: { type: "string", optional: true, about: "show or hide one key" },
      reset: { type: "boolean", optional: true, about: "forget your choice (back to OUTLINER_PROPERTY_SUMMARY_KEYS or the default)" },
    },
    run({ keys, toggle, reset }, { surface, host }) {
      if ([keys, toggle, reset].filter(x => x !== undefined).length !== 1) throw new ActionRefused("pass one of keys=a,b toggle=key reset=true");
      if (toggle) surface.toggleSummary(toggle, host);
      else { setUserSummaryKeys(reset ? null : keys!.split(",").map(k => k.trim().toLowerCase()).filter(Boolean)); host.redraw(); }
      const m = surface.msg;
      return { yours: summaryKeys(null), here: m ? surface.summary(m) : null };
    },
  }),
  "fold.select": def({
    summary: "put the person's ( ) fold selection on the next (by=1) or previous (by=-1) heading, list item or callout drawn; f or enter then folds it. The person's reading state: an agent's is refused (fold, unfold and fold.toggle name a fold point)", keys: "( )",
    touches: "tile", replay: "safe", person: "the ( ) selection is the person's; fold, unfold and fold.toggle name a fold point (folds lists them)",
    args: { by: { type: "number", about: "1 the next fold point, -1 the previous one" } },
    run({ by }, { surface, host }, actor) {
      const m = surface.requireNote();
      if (m.partial || !surface.stepFold(by < 0 ? -1 : 1)) throw new ActionRefused("this note has no headings, nested lists or callouts to fold");
      host.redraw();
      return surface.describe().folds ?? null;
    },
  }),
  "scroll": def({
    summary: "scroll the reader's note by rows (by=, negative is up) or to=top / to=end; the person's [ ] position is let go, as their own scrolling does. An agent's is refused on the reader the person has focused (view.scrollTo on the desk scrolls without touching their position)", keys: "j k ↑ ↓, PgUp PgDn, space, Home End, wheel",
    touches: "tile", replay: "safe", way: "its scroll is theirs; an agent scrolls a reader with view.scrollTo (desk), which leaves their [ ] position alone",
    args: {
      by: { type: "number", optional: true, about: "rows to scroll; negative scrolls up" },
      to: { type: "string", optional: true, about: "top or end" },
    },
    run({ by, to }, { surface, host }, actor) {
      if (to !== undefined && to !== "top" && to !== "end") throw new ActionRefused(`to is top or end, not ${to}`);
      if ((by === undefined) === (to === undefined)) throw new ActionRefused("say by= (rows) or to=top|end");
      surface.requireNote();
      // The person's own scrolling lets go of their [ ] position; an agent's never touches it.
      surface.scrollBy(to === "top" ? -1e9 : to === "end" ? 1e9 : by!, actor.kind === "user");
      surface.noteAgent(actor, "scrolled this reader");
      host.redraw();
      return surface.viewport();
    },
  }),
  "callouts": def({
    summary: "open every callout, or put them back as written (those with [!type]- folded); show= sets it, else it toggles. The person's reading state: an agent's is refused (fold and unfold name one callout)", keys: "z",
    touches: "tile", replay: "safe", person: "whether callouts are open is the person's reading state; an agent reads the note's text (peek, elements)",
    menu: noteRow("open or fold callouts", "z", { now: ({ surface }) => (surface.msg && surface.calloutsIn(surface.msg).length ? null : { hide: true }) }),
    args: { show: { type: "boolean", optional: true, about: "true shows the bodies, false folds them; left out, it toggles" } },
    run({ show }, { surface, host }) {
      surface.unfold = show ?? !surface.unfold;
      surface.showCallouts(surface.unfold);
      host.redraw();
      return { callouts: surface.unfold ? "shown" : "folded" };
    },
  }),
  "select.mode": def({
    summary: "select by keys: v starts where the reading is (h j k l, PgUp PgDn, Home End move the end; y copies, esc or v leaves), or takes over a selection made with the mouse. The person's only: an agent selects with select text= or line=", keys: "v",
    touches: "tile", replay: "safe", person: "the keyboard selection is the person's; an agent selects with select text=… or line=…, drawn as its own",
    menu: noteRow("select text by keys", "v", { busy: true }),
    args: {},
    run(_, { surface, host }, actor) {
      surface.requireNote();
      if (!surface.selectByKeys()) throw new ActionRefused("nothing is drawn to select yet");
      host.redraw();
      return surface.describeSelection(surface.selection!);
    },
  }),
  "folds": def({
    summary: "list the note's fold points (headings, and list items with nested lines): which are folded, and the line each is on",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole();
      const { points, lines } = surface.foldsIn(m);
      const shown = new Set(surface.visibleFolds(m).map(p => p.key));
      return { folds: points.map((p, i) => ({ n: i + 1, kind: p.kind, level: p.level, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.folded.has(p.key), shown: shown.has(p.key) })) };
    },
  }),
  "fold": def({
    summary: "fold a heading (hiding through the next heading of its level or higher) , a list item (hiding its nested items and continuation lines) or a callout (to its title); all=true folds every outermost one (F when nothing is folded). Reading state only: the note's text never changes", keys: "( ) then f or enter, click, F",
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "fold every outermost heading and list item" } },
    run: (args, on, actor) => runFold(true, args, on, actor),
  }),
  "unfold": def({
    summary: "unfold a heading, list item or callout; all=true unfolds everything (F when something is folded)", keys: "( ) then f or enter, click, F",
    touches: "tile", while: "typing", replay: "safe", way: "an agent unfolds a reader the person isn't typing in",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "unfold everything in this reader" } },
    run: (args, on, actor) => runFold(false, args, on, actor),
  }),
  "fold.toggle": def({
    summary: "fold a heading, list item or callout, or unfold it if it's folded; with none named, the person's: the one ( ) selected, else the section being read", keys: "f, enter, click",
    touches: "tile", while: "typing", replay: "safe", way: "an agent folds a reader the person isn't typing in",
    args: FOLD_ARGS,
    async run(args, { surface, host }, actor) {
      const none = args.text === undefined && args.line === undefined && args.n === undefined;
      if (none && actor.kind === "agent") throw new ActionRefused("say which heading, list item or callout: one of text=, line= or n= (folds lists them)");
      const at = none ? surface.foldTargetAtKeys() : null;
      if (none && !at) throw new ActionRefused("nothing to fold here · ( ) pick a heading or a list item");
      const now = surface.msg;
      const p = at ?? (now && !now.partial ? foldPointIn(surface, now, args) : await foldTarget(surface, args));
      const on = !surface.folded.has(p.key);
      surface.setFold(p, on, actor.kind === "user");
      surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p).slice(0, 40)}`);
      host.redraw();
      return foldResult(surface, p);
    },
  }),
  "figures": def({
    summary: "list the live figures the reader draws in its note: each one's number, kind, title and density, and a tabs figure's tabs with their counts and which is shown (this reader's choice; the note never changes)",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface }) {
      surface.requireDrawn();
      return { figures: surface.describeFigures() };
    },
  }),
  "figure.tab": def({
    summary: "show another tab of a live tabs figure (::graph-tabs): n= a tab's number (from 1) or its value, or by=1 (next) / by=-1 (previous), round again; figure= which (its number among the note's figures, or its title; left out, the one the [ ] position is in, else the note's only one). Reading state, kept across repaints and live answers; the note's text never changes",
    keys: "tab shift+tab or ← → while a figure's tab or row is the [ ] position, ⏎ on a tab, click a tab",
    touches: "tile", while: "typing", replay: "safe", way: "an agent switches tabs in a reader the person isn't typing in",
    args: {
      n: { type: "string", optional: true, about: "the tab: its number from 1, or its value (doing, review…) when that isn't a number" },
      tab: { type: "string", optional: true, about: "the tab by its value exactly, a number too (a click and enter on a tab pass this)" },
      by: { type: "number", optional: true, about: "1 the next tab, -1 the previous one" },
      figure: { type: "string", optional: true, about: "which tabs figure: its number among the note's figures (figures lists them), or its title" },
    },
    run({ n, by, tab, figure }, { surface, host }, actor) {
      surface.requireNote();
      if ([n, by, tab].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say one of n= (a tab's number or value), tab= (its value) or by=1|-1");
      const f = surface.figureNamed(figure, "tabs"), tabs = f.tabs ?? [];
      if (!tabs.length) throw new ActionRefused(`${f.title} has no tabs: its question has no results yet`);
      let i: number;
      if (by !== undefined) { const at = Math.max(0, tabs.findIndex(t => t.value === f.tab)); i = (at + (by < 0 ? -1 : 1) + tabs.length) % tabs.length; }
      else if (tab !== undefined) i = tabs.findIndex(t => t.value === tab);
      else { const v = String(n).trim(); i = /^\d+$/.test(v) ? Number(v) - 1 : tabs.findIndex(t => t.value.toLowerCase() === v.toLowerCase()); }
      const t = tabs[i];
      if (!t) throw new ActionRefused(`${f.title} has no tab ${n ?? tab}; its tabs: ${tabs.map((x, j) => `${j + 1} ${x.value}`).join(", ")}`);
      surface.setFigureTab(f, t.value, actor.kind === "user");
      surface.noteAgent(actor, `showed the ${t.value} tab of ${f.title}`);
      host.redraw();
      return { figure: f.n, title: f.title, tab: t.value, count: t.count, tabs: tabs.map((x, j) => ({ n: j + 1, ...x, shown: x === t })) };
    },
  }),
  "figure.density": def({
    summary: "draw a live table or tabs figure's rows compact (one line a title, cut with …), cozy (titles up to two lines) or comfortable (three, a blank line between rows): to= sets it, else the next one round; a wrapped title hangs under its text, past a work id. figure= as figure.tab. Reading state: the figure's density: line is only where it starts, and the note never changes",
    keys: "= while a figure's tab or row is the [ ] position, ⏎ on its ≡ control, click it",
    touches: "tile", while: "typing", replay: "safe", way: "an agent changes the density in a reader the person isn't typing in",
    args: {
      to: { type: "string", optional: true, about: "compact, cozy or comfortable; left out, the next one round" },
      figure: { type: "string", optional: true, about: "which table or tabs figure: its number among the note's figures (figures lists them), or its title" },
    },
    run({ to, figure }, { surface, host }, actor) {
      surface.requireNote();
      if (to !== undefined && !isDensity(to)) throw new ActionRefused(`to is ${DENSITIES.join(", ")}, not ${to}`);
      const f = surface.figureNamed(figure, "rows");
      const d: Density = (to as Density | undefined) ?? nextDensity(f.density);
      surface.setFigureDensity(f, d);
      surface.noteAgent(actor, `drew ${f.title} ${d}`);
      host.redraw();
      return { figure: f.n, title: f.title, density: d };
    },
  }),
  "select": def({
    summary: "select text in the note as the reader draws it: text= (links read as their titles) or line= to= (1 is the subject). An agent's selection is its own, drawn in its own tint; the person's is never touched", keys: "drag, double/triple click, v then h j k l",
    touches: "nothing", replay: "safe",
    args: {
      text: { type: "string", optional: true, about: "the words as they're drawn (blanks and row breaks match any blank)" },
      line: { type: "number", optional: true, about: "the first note line to select (1 is the subject)" },
      to: { type: "number", optional: true, about: "with line: the last note line" },
      n: { type: "number", optional: true, about: "with text: which time it's drawn, from 1" },
    },
    async run(args, { surface, host }, actor) {
      await surface.whole();
      const s = surface.selectBy(args);
      s.w = surface.renderedWidth(); s.top = surface.renderedTop();
      if (actor.kind === "agent") surface.agentSelection = { id: actor.id, sel: s };
      else surface.selection = s;
      const out = surface.describeSelection(s)!;
      surface.noteAgent(actor, `selected ${out.chars} chars`);
      host.redraw();
      return out;
    },
  }),
  "select.copy": def({
    summary: "copy the selection: what's drawn, or source=true for its markup. The person's goes to their clipboard (OSC 52), and a selection they make with the mouse is copied when the button comes up (copy on select; EP0CH_COPY_ON_SELECT=0 turns it off); an agent's is returned to it and never touches the person's clipboard", keys: "y, Y, cmd+c, the [y copy] control, the release of a drag (or a double or triple click)",
    touches: "nothing", replay: "safe",
    args: { source: { type: "boolean", optional: true, about: "the note's own text (markup) instead of what's drawn" } },
    run({ source }, { surface, host }, actor) {
      if (actor.kind === "user") {
        if (!surface.selection) throw new ActionRefused("nothing is selected");
        const r = surface.copySelection(!!source, host);
        if (!r) throw new ActionRefused(source ? "no source to copy: only the header's details are selected" : "only blanks are selected");
        host.redraw();
        return { copied: r.chars, text: r.text, clipboard: true };
      }
      const mine = surface.agentSelection?.id === actor.id ? surface.agentSelection.sel : null;
      if (!mine) throw new ActionRefused("you've selected nothing in this reader; select first (the person's own selection is theirs)");
      const d = surface.describeSelection(mine);
      if (!d) throw new ActionRefused("this reader doesn't show the note's text now");
      if (source && d.source === undefined) throw new ActionRefused("no source to copy: only the header's details are selected");
      const text = source ? d.source! : d.text;
      host.ctx.flash(`copied ${[...text].length} chars${source ? " of source" : ""} for itself · your clipboard is untouched`);
      surface.noteAgent(actor, `copied ${[...text].length} chars`);
      return { copied: [...text].length, text, clipboard: false };
    },
  }),
  "tasks": def({
    summary: "list the checklist steps this reader draws, in the note and inside its embeds (anchored ones too), in reading order: status, id, the note each is in",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { steps: surface.describeSteps() };
    },
  }),
  "task.status": def({
    summary: "set a checklist step's status (done, todo, waiting, problem) through checklist.update, checked against the step as it was read; recorded as whoever asks (an agent by its id) and said on screen. Works on steps inside embeds: the change is to the note the step is in",
    keys: "[ ] to a step, then ⏎ or a click on its box and x o w !; space toggles done / to do. With no step named, the person's: the status choice open, else the step that is the current element",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...STEP_ARGS, to: { type: "string", about: "done, todo, waiting or problem" } },
    async run({ to, ...which }, { surface, host }, actor) {
      const status = parseStatus(to);
      if (!status) throw new ActionRefused(`to is done, todo, waiting or problem, not ${JSON.stringify(to)}`);
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      return surface.changeStep(e.task!, status, host, actor);
    },
  }),
  "callout.list": def({
    summary: "list the note's callouts (PIE-538), outermost first in reading order: line, type, title, whether it starts folded and whether it's folded here; and the outline's callout types (the built-ins and those its notes declare with [callout-type::name])",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole(), types = calloutsOf(surface.src);
      return {
        callouts: surface.calloutsIn(m).map((c, i) => ({ n: i + 1, line: c.line + 1, type: c.type, known: !!types.resolve(c.type), title: calloutBlocks([c.header])[0]?.title || types.style(c.type).title, starts: c.fold === "-" ? "folded" : "open", folded: !!c.foldKey && surface.folded.has(c.foldKey) })),
        types: types.types.map(t => ({ name: t.name, title: t.title, icon: t.icon, tone: t.tone, aliases: t.aliases, ...(t.block ? { declaredIn: t.block } : {}) })),
        problems: surface.src ? calloutProblems(surface.src.board) : [],
      };
    },
  }),
  "callout.menu": def({
    summary: "open a callout's type choice under its top edge, as ⏎ or a click on its icon or type does (the person's; an agent uses callout.type and callout.start)",
    keys: "⏎ or a click on a callout's icon or type",
    touches: "tile", replay: "safe", person: "the type choice is the person's; an agent changes a callout with callout.type or callout.start",
    args: CALLOUT_ARGS,
    async run(which, { surface, host }, actor) {
      const c = await surface.calloutNamed(which, actor);
      surface.requireDrawn();
      const e = surface.calloutElement(c);
      if (!e) throw new ActionRefused("that callout's icon isn't drawn here (it's inside a folded callout or section; unfold it first)");
      surface.openCalloutPicker(e);
      host.redraw();
      return { open: true, callout: e.label, types: calloutsOf(surface.src).types.map(t => t.name) };
    },
  }),
  "callout.type": def({
    summary: "change a callout's type (PIE-538): its header's [!type] rewritten through the note's save, checked against the revision read now and the header as drawn, recorded as whoever asks and said on screen; ctrl+z (callout.undo) puts it back. to= is any type the outline has (callout.list), or a new name",
    keys: "the type choice's ⏎ (open it with ⏎ or a click on a callout's icon or type)",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...CALLOUT_ARGS, to: { type: "string", about: "the type to write: a name or alias the outline has (callout.list), or a new name" } },
    async run({ to, ...which }, { surface, host }, actor) {
      const name = to.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new ActionRefused(`to is a type's name (letters, digits, - and _), not ${JSON.stringify(to)}`);
      const c = await surface.calloutNamed(which, actor);
      return surface.changeCallout(c, { type: name }, host, actor);
    },
  }),
  "callout.start": def({
    summary: "make a callout start folded (folded=true writes [!type]-) or open (folded=false writes [!type]+): the one change to the text that folding ever makes, through the note's save like callout.type. Folding it in a reader is fold or f, which never writes",
    keys: "the type choice's - and +",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...CALLOUT_ARGS, folded: { type: "boolean", about: "true: it starts folded (-); false: it starts open (+)" } },
    async run({ folded, ...which }, { surface, host }, actor) {
      const c = await surface.calloutNamed(which, actor);
      return surface.changeCallout(c, { fold: folded ? "-" : "+" }, host, actor);
    },
  }),
  "callout.undo": def({
    summary: "undo the last callout change (type or start) made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the callout changed again since",
    keys: "ctrl+z (when a callout change was the last change made here)",
    touches: "draft", draft: "write", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.undoCallout(host, actor),
  }),
  "images": def({
    summary: "list the note's images and videos (PIE-532) in reading order: n, line, path, the layout written on the line (size, height, align, layout, fit, dim, alt) and what's wrong with it, and how it's drawn here (cells, or the header's rows)",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole(), d = surface.drawnImages();
      return {
        images: surface.imagesIn(m).map((x, i) => ({
          n: i + 1, line: x.line + 1, path: x.path, kind: x.spec.kind,
          ...(x.spec.size ? { size: sizeText(x.spec.size) } : {}), ...(x.spec.height ? { height: x.spec.height } : {}),
          ...(x.spec.align ? { align: x.spec.align } : {}), ...(x.spec.layout ? { layout: x.spec.layout } : {}), ...(x.spec.fit ? { fit: x.spec.fit } : {}), ...(x.spec.dim !== undefined ? { dim: x.spec.dim } : {}), ...(x.spec.alt ? { alt: x.spec.alt } : {}),
          ...(x.spec.problems.length ? { problems: x.spec.problems } : {}),
          drawn: d.get(x.line) ?? null,
        })),
      };
    },
  }),
  "image.size": def({
    summary: "size an image (PIE-532): to= its width (cells, N% of the reader, full, or none for its own), height= its rows (a number, or none), or by=1|-1 one step (a quarter, a third, a half, two thirds, three quarters, full; on the header, its height by 2 rows). Its aspect is kept. Written as [size::…] [height::…] on its line through the note's save, checked against the line as drawn and the revision read now, recorded as whoever asks; ctrl+z (image.undo) puts it back",
    keys: "+ - while an image is the [ ] position, a click on its caption's − or +",
    touches: "draft", draft: "write", replay: "ask",
    args: {
      ...IMAGE_ARGS,
      to: { type: "string", optional: true, about: "its width: cells (40), a share of the reader (50%), full, or none" },
      height: { type: "string", optional: true, about: "its height in rows (12), or none" },
      by: { type: "number", optional: true, about: "1 a step bigger, -1 a step smaller" },
    },
    async run({ to, height, by, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        if (to === undefined && height === undefined && by === undefined) throw new ActionRefused("say to= (a width: 40, 50% or full), height= (rows) or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (a step), not ${by}`);
        if (by !== undefined && (to !== undefined || height !== undefined)) throw new ActionRefused("say by= alone, or to= and height=");
        const ref = await surface.imageNamed(which, actor), hero = ref.spec.layout === "hero";
        const set: Partial<Record<MediaAttr, string | null>> = {};
        if (by !== undefined && hero) {
          const now = ref.spec.height ?? surface.heroRowsDrawn() ?? HERO_ROWS;
          set.height = String(Math.max(3, Math.min(60, now + (by > 0 ? 2 : -2))));
        } else if (by !== undefined) {
          const next = surface.sizeStep(ref, by);
          if (next === null) { const why = by > 0 ? "it's the full width already" : "it's at the smallest step (25%) already: image.size to= any width"; host.ctx.flash(why); throw new ActionRefused(why); }
          set.size = next;
        }
        if (to !== undefined) {
          if (hero) throw new ActionRefused("a header image is the reader's full width; its height is image.size height=");
          if (to.trim().toLowerCase() === "none") set.size = null;
          else { const sz = parseSize(to); if (!sz) throw new ActionRefused(`to is a width: cells (40), a share (50%) or full; not ${JSON.stringify(to)}`); set.size = sizeText(sz); }
        }
        if (height !== undefined) {
          const v = height.trim().toLowerCase();
          if (v === "none") set.height = null;
          else if (/^\d{1,3}$/.test(v) && +v > 0) set.height = v;
          else throw new ActionRefused(`height is a number of rows or none; not ${JSON.stringify(height)}`);
        }
        const what = [set.size !== undefined ? `width ${set.size ?? "its own"}` : "", set.height !== undefined ? `height ${set.height === null ? "its own" : `${set.height} rows`}` : ""].filter(Boolean).join(", ");
        return surface.changeImage(ref, set, what, host, actor);
      });
    },
  }),
  "image.align": def({
    summary: "place an image left, center or right in the reader (PIE-532): to=, or by=1|-1 one place right or left. Written as [align::…] on its line (left takes it out: it's where an image is) through the note's save like image.size",
    keys: "← → while an image is the [ ] position, a click on its caption's ◂ or ▸",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...IMAGE_ARGS, to: { type: "string", optional: true, about: "left, center or right" }, by: { type: "number", optional: true, about: "1 one place right, -1 one place left" } },
    async run({ to, by, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        if ((to === undefined) === (by === undefined)) throw new ActionRefused("say to=left|center|right or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (one place), not ${by}`);
        const ref = await surface.imageNamed(which, actor);
        if (ref.spec.layout === "hero") throw new ActionRefused("a header image is the reader's full width: it has no place to move to (image.hero on=false makes it an image in the text)");
        const now = ALIGNS.indexOf(ref.spec.align ?? "left");
        const want = to !== undefined ? to.trim().toLowerCase() : ALIGNS[Math.max(0, Math.min(2, now + (by! > 0 ? 1 : -1)))]!;
        if (!(ALIGNS as readonly string[]).includes(want)) throw new ActionRefused(`to is left, center or right; not ${JSON.stringify(to)}`);
        return surface.changeImage(ref, { align: want === "left" ? null : want }, want, host, actor);
      });
    },
  }),
  "image.hero": def({
    summary: "make an image the note's header (PIE-532): drawn above the title, the reader's full width, at most a third of its height (height= on image.size sets its rows), cropped to fill. on=true writes [layout::hero] on its line and takes it off any other image's (one save); on=false takes it off; left out, it toggles. Through the note's save like image.size",
    keys: "H while an image is the [ ] position, a click on its caption's ▀ header",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...IMAGE_ARGS, on: { type: "boolean", optional: true, about: "true: it's the header; false: it isn't; left out, it toggles" } },
    async run({ on, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = await surface.imageNamed(which, actor);
        const want = on ?? ref.spec.layout !== "hero";
        const m = await surface.whole();
        const others = want ? surface.imagesIn(m).filter(x => x.line !== ref.line && x.spec.layout === "hero").map(x => ({ line: x.line, source: x.source, set: { layout: null } })) : [];
        return surface.changeImage(ref, { layout: want ? "hero" : null }, want ? "the note's header" : "not the header", host, actor, others);
      });
    },
  }),
  "image.fit": def({
    summary: "how a header image too tall for its rows is drawn (PIE-532): to=cover crops it to fill the width, to=contain shows it whole, centred; left out, the other one. Written as [fit::…] on its line (cover takes it out: it's the default) through the note's save like image.size",
    keys: "= while the header image is the [ ] position, a click on its caption's [whole] or [fill]",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...IMAGE_ARGS, to: { type: "string", optional: true, about: "cover or contain; left out, the other one" } },
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = await surface.imageNamed(which, actor);
        const want = to === undefined ? (ref.spec.fit === "contain" ? "cover" : "contain") : to.trim().toLowerCase();
        if (want !== "cover" && want !== "contain") throw new ActionRefused(`to is cover or contain, not ${JSON.stringify(to)}`);
        return surface.changeImage(ref, { fit: want === "cover" ? null : want }, want === "contain" ? "shown whole" : "cropped to fill", host, actor);
      });
    },
  }),
  "image.dim": def({
    summary: "how much an image is dimmed (PIE-532): to= a number from 0 (as it is) to 1 (black), or auto (the default: a bright image's mean luminance held at 0.3). Written as [dim::…] on its line through the note's save like image.size. No key brightens an image: the door is dark-first",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...IMAGE_ARGS, to: { type: "string", about: "0 to 1, or auto" } },
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const v = to.trim().toLowerCase();
        const d = v === "auto" ? null : parseDim(v);
        if (v !== "auto" && d === null) throw new ActionRefused(`to is a number from 0 (as it is) to 1 (black), or auto; not ${JSON.stringify(to)}`);
        const ref = await surface.imageNamed(which, actor);
        return surface.changeImage(ref, { dim: d === null ? null : String(d) }, d === null ? "dimmed as bright images are" : `dim ${d}`, host, actor);
      });
    },
  }),
  "image.undo": def({
    summary: "undo the last image change (size, place, header) made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the line changed again since",
    keys: "ctrl+z (when an image change was the last change made here)",
    touches: "draft", draft: "write", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.undoImage(host, actor),
  }),
  "task.undo": def({
    summary: "undo the last step status change made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the step changed again since",
    keys: "ctrl+z",
    touches: "draft", draft: "write", replay: "ask",
    args: {},
    run: (_, { surface, host }, actor) => surface.undoStep(host, actor),
  }),
  "task.link": def({
    summary: "a step's link ((note^id)), giving the step a stable id first if it has none; the person's copies it to their clipboard, an agent's is returned. copy=false only gives the step its id (Make addressable)",
    keys: "the status choice's y (Copy step link) and a (Make addressable)",
    touches: "draft", draft: "write", replay: "ask",
    args: { ...STEP_ARGS, copy: { type: "boolean", optional: true, about: "false: only give the step a stable id, copying nothing" } },
    async run({ copy, ...which }, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      return surface.changeStep(e.task!, copy === false ? "address" : "copy-link", host, actor);
    },
  }),
  "task.menu": def({
    summary: "open a step's status choice under its box, as ⏎ or a click does (the person's; an agent uses task.status)",
    keys: "⏎ or a click (or right-click) on a step's box",
    touches: "tile", replay: "safe", person: "the status choice is the person's; an agent sets a step with task.status",
    args: STEP_ARGS,
    async run(which, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      surface.openPicker(e);
      host.redraw();
      return { open: true, step: e.task!.step.itemId ?? null, choices: STEP_CHOICES.map(c => ({ id: c.id, key: c.key, label: c.label })) };
    },
  }),
  "proposal.apply": def({
    summary: "apply anyway (PIE-501): the edit an agent's draft.patch proposed when it couldn't apply, as an ordinary edit by whoever runs this; on the proposal whose embed or control is the current element, the proposal shown, or id. Refused, with why, on one whose passage was already gone when it was proposed ([proposal-applies::no]: only dismiss is offered)", keys: "A, a click on [apply]",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      const p = await host.ctx.board.get(target);
      if (p && isOpenProposal(p) && !proposalApplies(p)) throw new ActionRefused(NOT_APPLICABLE);
      try {
        const r = await host.ctx.board.applyProposal(target, actor);
        // Its embeds and the notes it changed are drawn again now, not when the outline's event comes.
        outlineChanged([target, ...r.edits.map(x => x.blockId)]);
        host.ctx.flash(`applied the proposal · ${r.edits.map(x => x.route === "draft" ? "into the draft being written" : "saved").join(", ")}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface.noteAgent(actor, "applied a proposal anyway");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
  "proposal.dismiss": def({
    summary: "dismiss a proposal (PIE-501) without applying it: the service (draft.proposal.dismiss) takes its embed line out of the note it was proposed under (or the draft of it being written), marks it dismissed and puts it in Trash, all recorded as whoever runs this. An agent dismisses only its own proposals; the person, any", keys: "X, a click on [dismiss]",
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      try {
        const r = await host.ctx.board.dismissProposal(target, actor);
        outlineChanged([target, ...(surface.msg ? [surface.msg.id] : [])]);
        const line = r.embedRemoved === "saved" ? " · its embed line is out of the note" : r.embedRemoved === "draft" ? " · its embed line is out of the draft being written" : "";
        host.ctx.flash(`dismissed the proposal${line}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface.noteAgent(actor, "dismissed a proposal");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
  // ── what's put aside on this note (src/unsent.ts): the `■ unsent` line's controls ──
  "unsent.diff": def({
    summary: "what's put aside as unsent on this note (its edit) against the note as it is now: a line diff (- the note now, + the unsent edit), and the revision it was written on. The person's opens in a reader beside this one (read-only, with [dismiss] and [take it back]); an agent gets the rows",
    keys: "⏎ or a click on [diff] on the ■ unsent line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("unsent: diff against the note now", "edit"),
    args: UNSENT_ARGS,
    async run({ kind }, { surface, host }, actor) {
      const { of, u, now } = await unsentHere(surface, host, kind ?? "edit", true);
      const view = diffNote(now!, u);
      if (actor.kind === "agent") return { of, base: u.base, revision: now!.revision ?? null, at: u.at, diff: view.text };
      host.navigate(view, { fresh: true });
      return { of, base: u.base, revision: now!.revision ?? null, opened: view.id };
    },
  }),
  "unsent.copy": def({
    summary: "the text put aside as unsent on this note (kind=edit, comment, child or card), as it was written: the person's opens in a reader beside this one (read-only); an agent gets the text and where its copy is on disk",
    keys: "⏎ or a click on [open copy] on the ■ unsent line",
    touches: "nothing", replay: "safe",
    menu: unsentRow("unsent: open its copy"),
    args: UNSENT_ARGS,
    async run({ kind }, { surface, host }, actor) {
      const { of, u, now } = await unsentHere(surface, host, kind ?? firstUnsent(surface) ?? "edit", false);
      if (actor.kind === "agent") return { of, kind: kind ?? "edit", text: u.text, copy: u.copy, at: u.at };
      const view = copyNote(now ?? ({ id: of, text: "", parentId: null, childIds: [], createdAt: u.at, updatedAt: u.at, author: "unsent", props: {} } as Msg), u);
      host.navigate(view, { fresh: true });
      return { of, opened: view.id, copy: u.copy };
    },
  }),
  "unsent.dismiss": def({
    summary: "forget what's put aside as unsent on this note (kind=edit, comment, child or card): its ■ unsent line goes; its copy stays on disk (drafts/). The person's only",
    keys: "⏎ or a click on [dismiss] on the ■ unsent line or in its diff",
    touches: "nothing", replay: "ask",
    person: "the unsent text is the person's to keep or let go; an agent reads it with unsent.diff or unsent.copy",
    menu: unsentRow("unsent: dismiss (its copy stays)"),
    args: UNSENT_ARGS,
    async run({ kind }, { surface, host }) {
      const k = kind ?? firstUnsent(surface) ?? "edit";
      const { of, u } = await unsentHere(surface, host, k, false);
      unshelve(`${k}:${of}`);
      host.ctx.flash(`dismissed the unsent ${k === "child" ? "note" : k}${u.copy ? ` · its copy stays at ${tidy(u.copy)}` : ""}`);
      host.redraw();
      return { of, kind: k, dismissed: true, copy: u.copy };
    },
  }),
  "unsent.take": def({
    summary: "take an unsent edit back: open this note's edit on the revision it's at now, with the unsent changes in it. One written on that revision comes back whole; one on an older revision is replayed change by change from the text it started from (draft.patch's compare, as the person's own apply), so a passage changed since is left as it is now and said, never overwritten. The person's only: it opens an edit with their keys",
    keys: "⏎ or a click on [take it back] on the ■ unsent line or in its diff",
    touches: "draft", draft: "write", replay: "ask",
    person: "taking an unsent edit back opens an edit with the person's keys; an agent proposes text with draft.patch",
    menu: unsentRow("unsent: take it back into an edit", "edit"),
    args: UNSENT_ARGS,
    async run(_, { surface, host }) {
      const { of, u, now } = await unsentHere(surface, host, "edit", true);
      // In the diff view: this reader shows the note itself again, to edit it.
      if (surface.msg?.id !== of) surface.show(now!, host);
      if (surface.draft) throw new ActionRefused("this reader is already editing the note; save or close that edit first");
      if (u.base === now!.revision) {
        await surface.ensureDraft(host);                       // brought back whole (DraftSession.restore)
        host.redraw();
        return { of, taken: "whole", base: u.base };
      }
      if (u.from === undefined) throw new ActionRefused(`this unsent edit was put aside before the door kept the text it started from, so its changes can't be told from newer ones · [diff] shows it against the note now, [open copy] has it whole${u.copy ? ` (${tidy(u.copy)})` : ""}`);
      const s = await surface.ensureDraft(host);
      s.draft.straysClose = false;                               // taken back on purpose: never "stray" on the next esc
      const spans = takeBackSpans(u.from, u.text);
      let applied = 0, missed = 0;
      // From the bottom up, each its own change (ctrl+z takes back the last), compared against the text as it is now.
      spans.reverse().forEach((span, i) => {
        const a = s.draft.applyPatch({ patchId: `unsent-${u.at}-${i}`, patches: [span], revision: s.draft.base, force: true }, USER);
        if (a.applied) applied++; else missed++;
      });
      if (!missed) unshelve(`edit:${of}`);
      s.draft.note = !spans.length ? "nothing in the unsent edit differs from the text it started from"
        : missed ? `took back ${applied} of ${spans.length} changes · ${missed} left out: ${missed === 1 ? "its passage" : "their passages"} changed since · the unsent edit stays ([diff] shows it)`
        : `took back the unsent edit from ${whenPut(u.at)}: ${applied} change${applied === 1 ? "" : "s"}, lit · ctrl+s saves · ctrl+z takes back the last`;
      host.redraw();
      return { of, taken: missed ? "partly" : "all", applied, missed, base: u.base, revision: s.draft.base };
    },
  }),
  "unsent.show": def({
    summary: "unfold old unsent edits (put aside on an older revision more than a few days ago), folded into one dim line on this note",
    keys: "⏎ or a click on [show] on the ■ old unsent edit line",
    touches: "nothing", replay: "safe",
    args: UNSENT_ARGS,
    run(_, { surface, host }) {
      const of = unsentOf(surface);
      surface.showOldUnsent(of);
      host.redraw();
      return { of, shown: true };
    },
  }),
  "edit.strays": def({
    summary: "bring back the stray characters esc just dropped from an edit opened by mistake (src/stray.ts: open under 10s, up to 3 characters typed, nothing taken out): the edit opens again with them, as it was",
    keys: "ctrl+z right after esc dropped them (within a minute)",
    touches: "draft", draft: "write", replay: "ask",
    person: "the strays were the person's keys; an agent writes with edit.text or draft.patch",
    args: {},
    async run(_, { surface, host }) {
      const m = surface.requireNote();
      // Never over an edit put aside here since (DraftSession.open forgets superseded strays too); asked before they're taken.
      if (unsent(`edit:${m.id}`)) throw new ActionRefused("an edit was put aside on this note since; it comes back with e");
      const s = takeStrays(`edit:${m.id}`);
      if (!s) throw new ActionRefused("no stray characters were dropped here in the last minute");
      keepUnsent(s.u);                                           // put aside for a moment: the edit brings it back
      const d = (await surface.ensureDraft(host)).draft;
      if (d.text === s.u.text) {
        d.row = Math.min(s.row, d.lines.length - 1); d.col = Math.min(s.col, d.lines[d.row]!.length);
        d.note = `brought back ${s.u.text.length - (s.u.from ?? "").length} stray character${s.u.text.length - (s.u.from ?? "").length === 1 ? "" : "s"} · esc twice drops them`;
      }
      host.redraw();
      return { id: m.id, restored: d.text === s.u.text };
    },
  }),
  "select.clear": def({
    summary: "let go of the selection (an agent's own; the person's is theirs to clear)", keys: "esc, v (leaving the keyboard selection), click",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { surface, host }, actor) {
      const had = actor.kind === "agent" ? surface.agentSelection?.id === actor.id : !!surface.selection;
      if (actor.kind === "agent") { if (had) surface.agentSelection = null; } else surface.selection = null;
      host.redraw();
      return { cleared: had };
    },
  }),
});
